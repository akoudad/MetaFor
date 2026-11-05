import AppKit
import CoreGraphics
import Foundation

// Read-only provenance for a user-invoked capture. No Accessibility access,
// Apple Events, event injection, screen pixels, or application controls.
struct SourceInfo: Encodable {
    let appName: String
    let bundleId: String?
    let pid: Int32?
    let windowTitle: String?
}

func sourceInfo(excluding excludedPID: pid_t?) -> SourceInfo {
    guard let application = NSWorkspace.shared.frontmostApplication,
          application.processIdentifier != getpid(),
          application.processIdentifier != excludedPID
    else {
        return SourceInfo(appName: "Unknown application", bundleId: nil, pid: nil, windowTitle: nil)
    }

    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] ?? []
    let title = windows.lazy.compactMap { window -> String? in
        guard let owner = window[kCGWindowOwnerPID as String] as? NSNumber,
              owner.int32Value == application.processIdentifier,
              let layer = window[kCGWindowLayer as String] as? NSNumber,
              layer.intValue == 0,
              let name = window[kCGWindowName as String] as? String
        else { return nil }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : String(trimmed.prefix(1_024))
    }.first

    return SourceInfo(
        appName: application.localizedName ?? "Unknown application",
        bundleId: application.bundleIdentifier,
        pid: application.processIdentifier,
        windowTitle: title
    )
}

let arguments = Array(CommandLine.arguments.dropFirst())
var excludedPID: pid_t?
if !arguments.isEmpty {
    guard arguments.count == 2, arguments[0] == "--exclude-pid",
          let pid = Int32(arguments[1]), pid > 0
    else {
        FileHandle.standardError.write(Data("Usage: source-info [--exclude-pid PID]\n".utf8))
        exit(64)
    }
    excludedPID = pid
}

do {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(sourceInfo(excluding: excludedPID))
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    FileHandle.standardError.write(Data("Could not read the source application: \(error.localizedDescription)\n".utf8))
    exit(1)
}
