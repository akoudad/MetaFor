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

struct SourceWindow {
    let pid: pid_t
    let layer: Int
    let alpha: Double
    let bounds: CGRect
    let title: String?
}

// Window order comes from CGWindowList (front to back). FrontmostApplication can
// temporarily be an invisible notification/permission service after we hide Help.
// Only a visible normal window on the captured display is useful provenance.
func sourceWindow(_ windows: [SourceWindow], excluding excludedPIDs: Set<pid_t>,
                  regularPIDs: Set<pid_t>, displayBounds: CGRect?) -> SourceWindow? {
    windows.first { window in
        guard !excludedPIDs.contains(window.pid), regularPIDs.contains(window.pid),
              window.layer == 0, window.alpha > 0,
              !window.bounds.isEmpty, !window.bounds.isInfinite,
              window.bounds.width.isFinite, window.bounds.height.isFinite
        else { return false }
        guard let displayBounds else { return true }
        let visible = window.bounds.intersection(displayBounds)
        return !visible.isNull && !visible.isEmpty
    }
}

func sourceInfo(excluding excludedPID: pid_t?, displayBounds: CGRect?) -> SourceInfo {
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] ?? []
    let candidates = windows.compactMap { window -> SourceWindow? in
        guard let owner = window[kCGWindowOwnerPID as String] as? NSNumber,
              let layer = window[kCGWindowLayer as String] as? NSNumber,
              let alpha = window[kCGWindowAlpha as String] as? NSNumber,
              let bounds = window[kCGWindowBounds as String] as? NSDictionary,
              let rect = CGRect(dictionaryRepresentation: bounds)
        else { return nil }
        let title = (window[kCGWindowName as String] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return SourceWindow(pid: owner.int32Value, layer: layer.intValue,
                            alpha: alpha.doubleValue, bounds: rect,
                            title: title.flatMap { $0.isEmpty ? nil : String($0.prefix(1_024)) })
    }
    let applications = Dictionary(uniqueKeysWithValues: NSWorkspace.shared.runningApplications
        .filter { $0.activationPolicy == .regular }
        .map { ($0.processIdentifier, $0) })
    var excludedPIDs: Set<pid_t> = [getpid()]
    if let excludedPID { excludedPIDs.insert(excludedPID) }
    guard let window = sourceWindow(candidates, excluding: excludedPIDs,
                                    regularPIDs: Set(applications.keys), displayBounds: displayBounds),
          let application = applications[window.pid]
    else {
        return SourceInfo(appName: "Unknown application", bundleId: nil, pid: nil, windowTitle: nil)
    }

    return SourceInfo(
        appName: application.localizedName ?? "Unknown application",
        bundleId: application.bundleIdentifier,
        pid: application.processIdentifier,
        windowTitle: window.title
    )
}

#if !SOURCE_INFO_TESTING
let arguments = Array(CommandLine.arguments.dropFirst())
var excludedPID: pid_t?
var displayID: CGDirectDisplayID?
func usage() -> Never {
    FileHandle.standardError.write(Data("Usage: source-info [--exclude-pid PID] [--display-id ID]\n".utf8))
    exit(64)
}
guard arguments.count.isMultiple(of: 2) else { usage() }
for offset in stride(from: 0, to: arguments.count, by: 2) {
    switch arguments[offset] {
    case "--exclude-pid":
        guard excludedPID == nil, let pid = Int32(arguments[offset + 1]), pid > 0 else { usage() }
        excludedPID = pid
    case "--display-id":
        guard displayID == nil, let id = UInt32(arguments[offset + 1]), CGDisplayIsActive(id) != 0 else { usage() }
        displayID = id
    default:
        usage()
    }
}

do {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(sourceInfo(excluding: excludedPID, displayBounds: displayID.map(CGDisplayBounds)))
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    FileHandle.standardError.write(Data("Could not read the source application: \(error.localizedDescription)\n".utf8))
    exit(1)
}
#endif
