import Foundation
import Capacitor
import HealthKit

/**
 * Apple Health, read only: the steps of each day, the nights' sleep, body weight and workouts,
 * for the daily log. Garmin Connect, an Apple Watch, the iPhone itself or a smart scale write
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
 *     { steps: [{ d, steps }], sleep: [{ start, end, value, source }], weights: [{ t, kg, source }],
 *       workouts: [{ start, end, type, source, name }], errors: [String] }   (times in ms)
 */
@objc(AppleHealthPlugin)
public class AppleHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleHealthPlugin"
    public let jsName = "AppleHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
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
        var result: [String: Any] = ["steps": [], "sleep": [], "weights": [], "workouts": []]
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
                for case let sample as HKQuantitySample in samples ?? [] {
                    rows.append([
                        "t": AppleHealthPlugin.millis(sample.startDate),
                        "kg": sample.quantity.doubleValue(for: HKUnit.gramUnit(with: .kilo)),
                        "source": sample.sourceRevision.source.bundleIdentifier
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
