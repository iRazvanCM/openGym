import Foundation
import Capacitor
import HealthKit

/**
 * Apple Health: the steps of each day, the nights' sleep, body weight and workouts read into the
 * daily log — and, when switched on, the weigh-ins logged in the app and each day's calories and
 * macros written back, for other apps to read. Garmin Connect, an Apple Watch, the iPhone itself or a smart scale write
 * there; reading Apple Health is how their numbers reach openGym without an account anywhere.
 * What goes where — which day a night belongs to, overlapping sources, what counts as cardio —
 * is worked out in JavaScript (src/lib/apple-health.js), where it has tests.
 *
 * Steps come from a statistics query, so Apple Health itself merges the phone's and a watch's
 * count of the same walk (by the source order set in Health) instead of adding them up.
 *
 * Usage from JS:
 *   const AH = registerPlugin('AppleHealth')
 *   await AH.isAvailable()            → { available }
 *   await AH.requestAuthorization()   → { requested }   (rejects 'entitlement' when this install
 *                                                       was signed without the HealthKit entitlement)
 *   await AH.read({ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }) →
 *     { steps: [{ d, steps }], sleep: [{ start, end, value, source }], weights: [{ t, kg, source, own }],
 *       workouts: [{ start, end, type, source, name }], errors: [String] }   (times in ms; `own`: written by this app)
 *   await AH.requestWrite()           → { requested, allowed }   (allowed: how many of the five types may be written)
 *   await AH.write({ from, to, days: JSON.stringify([{ d, kcal?, protein?, carbs?, fat?, weightKg?, weighedAt? }]) })
 *     → { written, errors }   Replaces what this app wrote between `from` and `to` (and nothing else).
 */
@objc(AppleHealthPlugin)
public class AppleHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleHealthPlugin"
    public let jsName = "AppleHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestWrite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise)
    ]

    private let store = HKHealthStore()

    private func readTypes() -> Set<HKObjectType> {
        var types = Set<HKObjectType>()
        if let t = HKObjectType.quantityType(forIdentifier: .stepCount) { types.insert(t) }
        if let t = HKObjectType.quantityType(forIdentifier: .bodyMass) { types.insert(t) }
        if let t = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(t) }
        types.insert(HKObjectType.workoutType())
        return types
    }

    // What the app writes: the weigh-ins logged in it, and each day's calories and macros.
    private func shareTypes() -> Set<HKSampleType> {
        var types = Set<HKSampleType>()
        let ids: [HKQuantityTypeIdentifier] = [.bodyMass, .dietaryEnergyConsumed, .dietaryProtein, .dietaryCarbohydrates, .dietaryFatTotal]
        for id in ids {
            if let t = HKQuantityType.quantityType(forIdentifier: id) { types.insert(t) }
        }
        return types
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Health data is not available on this device", "unavailable")
            return
        }
        store.requestAuthorization(toShare: nil, read: readTypes()) { success, error in
            if let error = error {
                let message = error.localizedDescription
                call.reject(message, message.lowercased().contains("entitlement") ? "entitlement" : "failed")
                return
            }
            call.resolve(["requested": success])
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Health data is not available on this device", "unavailable")
            return
        }
        guard let fromText = call.getString("from"), let toText = call.getString("to"),
              let fromDay = AppleHealthPlugin.parseDay(fromText), let toDay = AppleHealthPlugin.parseDay(toText) else {
            call.reject("from and to are required, as YYYY-MM-DD")
            return
        }
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: fromDay)
        guard let end = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: toDay)), end > start else {
            call.reject("to must not be before from")
            return
        }
        // The night that ends on the first morning began the evening before it.
        let nightStart = calendar.date(byAdding: .hour, value: -12, to: start) ?? start
        let byStart = [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]

        let group = DispatchGroup()
        let lock = NSLock()
        let none = [[String: Any]]()
        var result: [String: Any] = ["steps": none, "sleep": none, "weights": none, "workouts": none]
        var errors: [String] = []
        func finish(_ key: String, _ rows: [[String: Any]], _ error: Error?) {
            lock.lock()
            result[key] = rows
            if let error = error { errors.append(key + ": " + error.localizedDescription) }
            lock.unlock()
            group.leave()
        }

        // Steps: one sum a day, sources merged by Apple Health.
        if let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) {
            group.enter()
            let query = HKStatisticsCollectionQuery(
                quantityType: stepType,
                quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate),
                options: .cumulativeSum,
                anchorDate: start,
                intervalComponents: DateComponents(day: 1))
            query.initialResultsHandler = { _, collection, error in
                var rows: [[String: Any]] = []
                collection?.enumerateStatistics(from: start, to: end) { statistics, _ in
                    if let sum = statistics.sumQuantity() {
                        rows.append(["d": AppleHealthPlugin.formatDay(statistics.startDate), "steps": sum.doubleValue(for: HKUnit.count())])
                    }
                }
                finish("steps", rows, error)
            }
            store.execute(query)
        }

        // Sleep: every stage sample of every source; the night is put together in JavaScript.
        if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            group.enter()
            let query = HKSampleQuery(
                sampleType: sleepType,
                predicate: HKQuery.predicateForSamples(withStart: nightStart, end: end, options: []),
                limit: HKObjectQueryNoLimit,
                sortDescriptors: byStart) { _, samples, error in
                var rows: [[String: Any]] = []
                for case let sample as HKCategorySample in samples ?? [] {
                    rows.append([
                        "start": AppleHealthPlugin.millis(sample.startDate),
                        "end": AppleHealthPlugin.millis(sample.endDate),
                        "value": AppleHealthPlugin.sleepKind(sample.value),
                        "source": sample.sourceRevision.source.bundleIdentifier
                    ])
                }
                finish("sleep", rows, error)
            }
            store.execute(query)
        }

        // Body weight, in kilograms.
        if let massType = HKQuantityType.quantityType(forIdentifier: .bodyMass) {
            group.enter()
            let query = HKSampleQuery(
                sampleType: massType,
                predicate: HKQuery.predicateForSamples(withStart: start, end: end, options: []),
                limit: HKObjectQueryNoLimit,
                sortDescriptors: byStart) { _, samples, error in
                var rows: [[String: Any]] = []
                let mine = Bundle.main.bundleIdentifier ?? ""
                for case let sample as HKQuantitySample in samples ?? [] {
                    let source = sample.sourceRevision.source.bundleIdentifier
                    rows.append([
                        "t": AppleHealthPlugin.millis(sample.startDate),
                        "kg": sample.quantity.doubleValue(for: HKUnit.gramUnit(with: .kilo)),
                        "source": source,
                        "own": !mine.isEmpty && source == mine
                    ])
                }
                finish("weights", rows, error)
            }
            store.execute(query)
        }

        // Workouts: when, and what kind (HKWorkoutActivityType's raw value).
        group.enter()
        let workoutQuery = HKSampleQuery(
            sampleType: HKObjectType.workoutType(),
            predicate: HKQuery.predicateForSamples(withStart: start, end: end, options: []),
            limit: HKObjectQueryNoLimit,
            sortDescriptors: byStart) { _, samples, error in
            var rows: [[String: Any]] = []
            for case let workout as HKWorkout in samples ?? [] {
                rows.append([
                    "start": AppleHealthPlugin.millis(workout.startDate),
                    "end": AppleHealthPlugin.millis(workout.endDate),
                    "type": Int(workout.workoutActivityType.rawValue),
                    "source": workout.sourceRevision.source.bundleIdentifier,
                    "name": workout.sourceRevision.source.name
                ])
            }
            finish("workouts", rows, error)
        }
        store.execute(workoutQuery)

        group.notify(queue: .main) {
            lock.lock()
            result["errors"] = errors
            let out = result
            lock.unlock()
            call.resolve(out)
        }
    }

    @objc func requestWrite(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Health data is not available on this device", "unavailable")
            return
        }
        let share = shareTypes()
        store.requestAuthorization(toShare: share, read: readTypes()) { success, error in
            if let error = error {
                let message = error.localizedDescription
                call.reject(message, message.lowercased().contains("entitlement") ? "entitlement" : "failed")
                return
            }
            // Unlike reading, whether writing was allowed can be asked.
            let allowed = share.filter { self.store.authorizationStatus(for: $0) == .sharingAuthorized }.count
            call.resolve(["requested": success, "allowed": allowed])
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Health data is not available on this device", "unavailable")
            return
        }
        guard let fromText = call.getString("from"), let toText = call.getString("to"),
              let fromDay = AppleHealthPlugin.parseDay(fromText), let toDay = AppleHealthPlugin.parseDay(toText) else {
            call.reject("from and to are required, as YYYY-MM-DD")
            return
        }
        guard let json = call.getString("days"),
              let days = (try? JSONSerialization.jsonObject(with: Data(json.utf8), options: [])) as? [[String: Any]] else {
            call.reject("days is required, as JSON")
            return
        }
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: fromDay)
        guard let end = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: toDay)), end > start else {
            call.reject("to must not be before from")
            return
        }

        var samples: [HKQuantitySample] = []
        for day in days {
            guard let d = day["d"] as? String, let date = AppleHealthPlugin.parseDay(d) else { continue }
            let midnight = calendar.startOfDay(for: date)
            guard midnight >= start, midnight < end else { continue }
            let noon = calendar.date(byAdding: .hour, value: 12, to: midnight) ?? midnight
            var weighed = calendar.date(byAdding: .hour, value: 7, to: midnight) ?? midnight
            if let ms = day["weighedAt"] as? Double, ms > 0 { weighed = Date(timeIntervalSince1970: ms / 1000) }
            let rows: [(HKQuantityTypeIdentifier, String, HKUnit, Date)] = [
                (.dietaryEnergyConsumed, "kcal", HKUnit.kilocalorie(), noon),
                (.dietaryProtein, "protein", HKUnit.gram(), noon),
                (.dietaryCarbohydrates, "carbs", HKUnit.gram(), noon),
                (.dietaryFatTotal, "fat", HKUnit.gram(), noon),
                (.bodyMass, "weightKg", HKUnit.gramUnit(with: .kilo), weighed)
            ]
            for (id, key, unit, at) in rows {
                guard let value = day[key] as? Double, value > 0, let type = HKQuantityType.quantityType(forIdentifier: id) else { continue }
                samples.append(HKQuantitySample(type: type, quantity: HKQuantity(unit: unit, doubleValue: value), start: at, end: at))
            }
        }

        // What this app wrote over the range goes first, so writing the same days again replaces
        // them instead of adding to them. Another app's samples are never touched.
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForObjects(from: HKSource.default()),
            HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        ])
        let group = DispatchGroup()
        let lock = NSLock()
        var errors: [String] = []
        for type in shareTypes() {
            group.enter()
            store.deleteObjects(of: type, predicate: predicate) { _, _, error in
                if let error = error {
                    lock.lock()
                    errors.append(error.localizedDescription)
                    lock.unlock()
                }
                group.leave()
            }
        }
        let toSave = samples
        group.notify(queue: .global(qos: .utility)) {
            lock.lock()
            let found = errors
            lock.unlock()
            if toSave.isEmpty {
                call.resolve(["written": 0, "errors": found])
                return
            }
            self.store.save(toSave) { _, error in
                if let error = error {
                    call.reject(error.localizedDescription, "failed")
                    return
                }
                call.resolve(["written": toSave.count, "errors": found])
            }
        }
    }

    // HKCategoryValueSleepAnalysis by raw value, so no iOS 16 availability check is needed:
    // 0 in bed, 1 asleep (unspecified), 2 awake, 3 core, 4 deep, 5 REM.
    private static func sleepKind(_ value: Int) -> String {
        switch value {
        case 0: return "inBed"
        case 2: return "awake"
        case 3: return "core"
        case 4: return "deep"
        case 5: return "rem"
        default: return "asleep"
        }
    }

    private static func millis(_ date: Date) -> Double {
        return (date.timeIntervalSince1970 * 1000).rounded()
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static func parseDay(_ text: String) -> Date? {
        dayFormatter.timeZone = TimeZone.current
        return dayFormatter.date(from: text)
    }

    private static func formatDay(_ date: Date) -> String {
        dayFormatter.timeZone = TimeZone.current
        return dayFormatter.string(from: date)
    }
}
