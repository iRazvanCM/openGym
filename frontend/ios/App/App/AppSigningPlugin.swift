import Foundation
import Capacitor

/**
 * When this install stops opening. A sideloaded app (Sideloadly, AltStore) carries the
 * provisioning profile it was signed with as embedded.mobileprovision; with a free Apple ID that
 * profile lasts seven days. Its dates are what src/lib/renewal.js warns about. An App Store or
 * TestFlight install has no such file, and the answer is then just the bundle's own facts.
 *
 * Usage from JS:
 *   const AppSigning = registerPlugin('AppSigning')
 *   await AppSigning.info() → { expires?, created?, team?, profile?, installed?, bundle }   (times in ms)
 */
@objc(AppSigningPlugin)
public class AppSigningPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppSigningPlugin"
    public let jsName = "AppSigning"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise)
    ]

    @objc func info(_ call: CAPPluginCall) {
        var out: [String: Any] = ["bundle": Bundle.main.bundleIdentifier ?? ""]
        if let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
           let data = try? Data(contentsOf: url),
           let profile = AppSigningPlugin.propertyList(in: data) {
            if let date = profile["ExpirationDate"] as? Date { out["expires"] = AppSigningPlugin.millis(date) }
            if let date = profile["CreationDate"] as? Date { out["created"] = AppSigningPlugin.millis(date) }
            if let team = profile["TeamName"] as? String { out["team"] = team }
            if let name = profile["Name"] as? String { out["profile"] = name }
        }
        if let attributes = try? FileManager.default.attributesOfItem(atPath: Bundle.main.bundlePath),
           let date = attributes[FileAttributeKey.creationDate] as? Date {
            out["installed"] = AppSigningPlugin.millis(date)
        }
        call.resolve(out)
    }

    // The profile is a signed envelope (CMS) around an XML property list. The list is found by its
    // own first and last bytes rather than by opening the envelope, which needs no Security calls.
    private static func propertyList(in data: Data) -> [String: Any]? {
        guard let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), options: [], in: start.lowerBound..<data.endIndex) else {
            return nil
        }
        let body = data.subdata(in: start.lowerBound..<end.upperBound)
        guard let parsed = try? PropertyListSerialization.propertyList(from: body, options: [], format: nil) else {
            return nil
        }
        return parsed as? [String: Any]
    }

    private static func millis(_ date: Date) -> Double {
        return (date.timeIntervalSince1970 * 1000).rounded()
    }
}
