import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers

/**
 * A folder the person picks for the automatic backups — iCloud Drive, a sync app's folder, any
 * folder the Files app can show — and the backups written there. The same calls as the Android
 * BackupFolder plugin (android/.../BackupFolderPlugin.java), so src/lib/mobile.js drives both:
 *
 *   pick()                               → { uri, label } | {} when cancelled
 *   check({ uri })                       → { ok }
 *   write({ uri, name, data })           → {}            (data is the backup's text)
 *   prune({ uri, keep, pattern, written })→ { deleted } (only names the pattern matches)
 *   release({ uri })                     → {}
 *
 * iOS hands the app a folder outside its own sandbox only through the document picker, and keeps
 * the access across launches through a bookmark: `uri` is "bookmark:<id>", the bookmark itself
 * stays in this phone's UserDefaults. Every read and write runs inside start/stopAccessing and an
 * NSFileCoordinator, which is what iCloud Drive needs to upload the file and not clash with a sync.
 */
@objc(BackupFolderPlugin)
public class BackupFolderPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "BackupFolderPlugin"
    public let jsName = "BackupFolder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "check", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prune", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise)
    ]

    private static let keyPrefix = "backupFolder.bookmark."
    private static let uriPrefix = "bookmark:"
    private var pending: CAPPluginCall?

    private static func key(for uri: String) -> String? {
        guard uri.hasPrefix(uriPrefix) else { return nil }
        let id = String(uri.dropFirst(uriPrefix.count))
        return id.isEmpty ? nil : keyPrefix + id
    }

    /// The folder a uri stands for, its bookmark refreshed when iOS says it went stale.
    private func folder(_ uri: String) -> URL? {
        guard let key = BackupFolderPlugin.key(for: uri), let data = UserDefaults.standard.data(forKey: key) else { return nil }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }
        if stale {
            let access = url.startAccessingSecurityScopedResource()
            if let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
                UserDefaults.standard.set(fresh, forKey: key)
            }
            if access { url.stopAccessingSecurityScopedResource() }
        }
        return url
    }

    @objc func pick(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let picker: UIDocumentPickerViewController
            if #available(iOS 14.0, *) {
                picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder])
            } else {
                picker = UIDocumentPickerViewController(documentTypes: ["public.folder"], in: .open)
            }
            picker.delegate = self
            picker.allowsMultipleSelection = false
            self.pending?.resolve([:])
            self.pending = call
            guard let presenter = self.bridge?.viewController else {
                self.pending = nil
                call.reject("Nothing to show the folder picker on", "failed")
                return
            }
            presenter.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pending else { return }
        pending = nil
        guard let url = urls.first else { call.resolve([:]); return }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            let id = UUID().uuidString
            UserDefaults.standard.set(data, forKey: BackupFolderPlugin.keyPrefix + id)
            call.resolve(["uri": BackupFolderPlugin.uriPrefix + id, "label": url.lastPathComponent])
        } catch {
            call.reject("This folder can't be kept: " + error.localizedDescription, "failed")
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pending?.resolve([:])
        pending = nil
    }

    @objc func check(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri"), let url = folder(uri) else {
            call.resolve(["ok": false])
            return
        }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        var isDir: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
        call.resolve(["ok": exists && isDir.boolValue])
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri"), let name = call.getString("name"), let text = call.getString("data") else {
            call.reject("uri, name and data are required")
            return
        }
        guard !name.isEmpty, !name.contains("/"), !name.hasPrefix(".") else {
            call.reject("Not a file name", "failed")
            return
        }
        guard let url = folder(uri) else {
            call.reject("The folder is gone", "failed")
            return
        }
        DispatchQueue.global(qos: .utility).async {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let target = url.appendingPathComponent(name)
            var coordinationError: NSError?
            var writeError: Error?
            NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: target, options: .forReplacing, error: &coordinationError) { dest in
                do { try Data(text.utf8).write(to: dest, options: .atomic) } catch { writeError = error }
            }
            if let error = coordinationError ?? writeError {
                call.reject(error.localizedDescription, "failed")
            } else {
                call.resolve([:])
            }
        }
    }

    @objc func prune(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri"), let url = folder(uri),
              let pattern = call.getString("pattern"), let re = try? NSRegularExpression(pattern: pattern) else {
            call.resolve(["deleted": 0])
            return
        }
        let keep = max(1, call.getInt("keep") ?? 14)
        let written = call.getString("written") ?? ""
        DispatchQueue.global(qos: .utility).async {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let names = ((try? FileManager.default.contentsOfDirectory(atPath: url.path)) ?? [])
                .filter { n in n != written && re.firstMatch(in: n, options: [], range: NSRange(n.startIndex..., in: n)) != nil }
                .sorted(by: >)
            var deleted = 0
            for n in names.dropFirst(max(0, keep - 1)) {
                var coordinationError: NSError?
                NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url.appendingPathComponent(n), options: .forDeleting, error: &coordinationError) { dest in
                    if (try? FileManager.default.removeItem(at: dest)) != nil { deleted += 1 }
                }
            }
            call.resolve(["deleted": deleted])
        }
    }

    @objc(release:) func releaseFolder(_ call: CAPPluginCall) {
        if let uri = call.getString("uri"), let key = BackupFolderPlugin.key(for: uri) {
            UserDefaults.standard.removeObject(forKey: key)
        }
        call.resolve([:])
    }
}

/**
 * When this install stops opening. A sideloaded app is signed with a provisioning profile that
 * runs out — seven days after signing with a free Apple ID — and the profile rides inside the app
 * as embedded.mobileprovision: a signed envelope around a plain XML property list, read here.
 *
 *   info() → { found, expires, created (ms), team, name, healthKit, devices, bundleId }
 *
 * An App Store or TestFlight build has no such file to read; `found` is then false.
 */
@objc(AppSigningPlugin)
public class AppSigningPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppSigningPlugin"
    public let jsName = "AppSigning"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise)
    ]

    @objc func info(_ call: CAPPluginCall) {
        var out: [String: Any] = ["found": false, "bundleId": Bundle.main.bundleIdentifier ?? ""]
        guard let file = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: file),
              let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), options: [], in: start.lowerBound..<data.endIndex) else {
            call.resolve(out)
            return
        }
        let xml = data.subdata(in: start.lowerBound..<end.upperBound)
        guard let plist = (try? PropertyListSerialization.propertyList(from: xml, options: [], format: nil)) as? [String: Any] else {
            call.resolve(out)
            return
        }
        out["found"] = true
        if let date = plist["ExpirationDate"] as? Date { out["expires"] = (date.timeIntervalSince1970 * 1000).rounded() }
        if let date = plist["CreationDate"] as? Date { out["created"] = (date.timeIntervalSince1970 * 1000).rounded() }
        out["team"] = (plist["TeamName"] as? String) ?? ""
        out["name"] = (plist["Name"] as? String) ?? ""
        if let entitlements = plist["Entitlements"] as? [String: Any] {
            out["healthKit"] = (entitlements["com.apple.developer.healthkit"] as? Bool) ?? false
        }
        out["devices"] = (plist["ProvisionedDevices"] as? [Any])?.count ?? 0
        call.resolve(out)
    }
}
