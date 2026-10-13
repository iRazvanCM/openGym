import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers

/**
 * The folder auto-backup writes into on the iPhone, chosen once by the person: a folder in iCloud
 * Drive, or any other place the Files app offers. The same five calls as the Android plugin
 * (android/.../BackupFolderPlugin.java), so lib/mobile.js drives both the same way.
 *
 * The system folder picker hands back a security-scoped URL; a bookmark of it is what keeps the
 * right to write there after the app is closed, with no entitlement and no iCloud container of
 * our own. The bookmark travels to JavaScript as the folder's "uri" ("bookmark:<base64>") and is
 * kept there, in a private file of this phone (never in the synced state: it means nothing
 * anywhere else).
 *
 * Usage from JS (lib/mobile.js):
 *   const BackupFolder = registerPlugin('BackupFolder')
 *   const { uri, label } = await BackupFolder.pick()          // {} when cancelled
 *   const { ok, uri? } = await BackupFolder.check({ uri })    // still there and writable? (a renewed bookmark)
 *   await BackupFolder.write({ uri, name, data })
 *   await BackupFolder.prune({ uri, keep, pattern, written }) // keeps the newest `keep`
 *   await BackupFolder.release({ uri })
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

    private static let prefix = "bookmark:"
    // A cloud folder can be slow: off the main thread, and one at a time so two backups never
    // race for the same name.
    private let io = DispatchQueue(label: "ro.irazvancm.liftlog.backup-folder")
    private var pickCall: CAPPluginCall?

    @objc func pick(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("there is no screen to show the folder picker on")
                return
            }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            self.pickCall = call
            presenter.present(picker, animated: true, completion: nil)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickCall else { return }
        pickCall = nil
        guard let url = urls.first else {
            call.resolve([:])
            return
        }
        let granted = url.startAccessingSecurityScopedResource()
        defer { if granted { url.stopAccessingSecurityScopedResource() } }
        do {
            let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            call.resolve([
                "uri": BackupFolderPlugin.prefix + bookmark.base64EncodedString(),
                "label": url.lastPathComponent
            ])
        } catch {
            call.reject("this folder cannot be kept for later writes", nil, error)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickCall?.resolve([:])
        pickCall = nil
    }

    @objc func check(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri") else {
            call.resolve(["ok": false])
            return
        }
        io.async {
            guard let resolved = try? BackupFolderPlugin.resolve(uri) else {
                call.resolve(["ok": false])
                return
            }
            let (folder, stale) = resolved
            let granted = folder.startAccessingSecurityScopedResource()
            defer { if granted { folder.stopAccessingSecurityScopedResource() } }
            var isDirectory: ObjCBool = false
            let exists = FileManager.default.fileExists(atPath: folder.path, isDirectory: &isDirectory)
            var result: [String: Any] = ["ok": granted && exists && isDirectory.boolValue]
            // A bookmark the system calls stale still opens the folder once; a fresh one keeps it.
            if stale, granted, let fresh = try? folder.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
                result["uri"] = BackupFolderPlugin.prefix + fresh.base64EncodedString()
            }
            call.resolve(result)
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri"), let name = call.getString("name"), let text = call.getString("data") else {
            call.reject("uri, name and data are required")
            return
        }
        guard !name.isEmpty, !name.contains("/"), !name.hasPrefix(".") else {
            call.reject("a plain file name is required")
            return
        }
        io.async {
            do {
                let (folder, _) = try BackupFolderPlugin.resolve(uri)
                let granted = folder.startAccessingSecurityScopedResource()
                defer { if granted { folder.stopAccessingSecurityScopedResource() } }
                guard granted else { throw BackupFolderPlugin.failure("the folder no longer lets this app in") }
                let target = folder.appendingPathComponent(name)
                let bytes = Data(text.utf8)
                var coordinatorError: NSError?
                var writeError: Error?
                // Coordinated, so iCloud Drive (or another app's provider) sees one clean change.
                NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: target, options: .forReplacing, error: &coordinatorError) { url in
                    do { try bytes.write(to: url) } catch { writeError = error }
                }
                if let error = coordinatorError { throw error }
                if let error = writeError { throw error }
                call.resolve(["ok": true])
            } catch {
                call.reject("could not write to the backup folder: " + error.localizedDescription, nil, error)
            }
        }
    }

    @objc func prune(_ call: CAPPluginCall) {
        guard let uri = call.getString("uri"), let pattern = call.getString("pattern") else {
            call.reject("uri and pattern are required")
            return
        }
        let keep = max(1, call.getInt("keep") ?? 14)
        let written = call.getString("written") ?? ""
        io.async {
            var deleted = 0
            do {
                let (folder, _) = try BackupFolderPlugin.resolve(uri)
                let granted = folder.startAccessingSecurityScopedResource()
                defer { if granted { folder.stopAccessingSecurityScopedResource() } }
                let only = try NSRegularExpression(pattern: pattern, options: [])
                let names = try FileManager.default.contentsOfDirectory(atPath: folder.path)
                // Newest first by the date in the name, as the Documents/openGym prune does; the copy
                // just written is never a candidate.
                let older = names.filter { name in
                    name != written && only.firstMatch(in: name, options: [], range: NSRange(name.startIndex..., in: name)) != nil
                }.sorted(by: >)
                if older.count > keep - 1 {
                    for name in older[(keep - 1)...] {
                        let target = folder.appendingPathComponent(name)
                        var coordinatorError: NSError?
                        NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: target, options: .forDeleting, error: &coordinatorError) { url in
                            if (try? FileManager.default.removeItem(at: url)) != nil { deleted += 1 }
                        }
                    }
                }
            } catch {
                // pruning is housekeeping; the copy is already written
            }
            call.resolve(["deleted": deleted])
        }
    }

    @objc func release(_ call: CAPPluginCall) {
        // Nothing is held on this side: the bookmark lives in JavaScript and goes with it.
        call.resolve()
    }

    private static func resolve(_ uri: String) throws -> (URL, Bool) {
        guard uri.hasPrefix(prefix), let bookmark = Data(base64Encoded: String(uri.dropFirst(prefix.count))) else {
            throw failure("not a folder chosen in this app")
        }
        var stale = false
        let url = try URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        return (url, stale)
    }

    private static func failure(_ message: String) -> NSError {
        return NSError(domain: "BackupFolder", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
