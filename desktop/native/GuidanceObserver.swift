import AppKit
import CoreGraphics
import Foundation

let guidanceEventMask: NSEvent.EventTypeMask = [.scrollWheel, .leftMouseDown, .rightMouseDown, .otherMouseDown]

func invalidatesGuidance(_ type: NSEvent.EventType, targetPID: pid_t?, excluding: Set<pid_t>) -> Bool {
    guard [.scrollWheel, .leftMouseDown, .rightMouseDown, .otherMouseDown].contains(type) else { return false }
    // The helper is a separate process, so the global monitor also sees events
    // sent to Metafor. Keep Help usable; unknown destinations fail closed.
    guard let targetPID, targetPID > 0 else { return true }
    return !excluding.contains(targetPID)
}

func activationInvalidatesGuidance(_ pid: pid_t?, excluding: Set<pid_t>) -> Bool {
    guard let pid, pid > 0 else { return true }
    return !excluding.contains(pid)
}

#if !GUIDANCE_OBSERVER_TESTING
let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count == 2, arguments[0] == "--exclude-pid",
      let parentPID = Int32(arguments[1]), parentPID > 0 else {
    FileHandle.standardError.write(Data("Usage: guidance-observer --exclude-pid PID\n".utf8))
    exit(64)
}

// Read-only mouse observation: no keyboard mask, event taps, Accessibility
// requests, screen capture, or event injection. No windows or Dock presence.
let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
let excluded: Set<pid_t> = [parentPID, getpid()]
var mouseMonitor: Any?
var activationMonitor: NSObjectProtocol?
var ended = false

func finish(_ token: String? = nil, status: Int32 = 0) -> Never {
    ended = true
    if let mouseMonitor { NSEvent.removeMonitor(mouseMonitor) }
    if let activationMonitor { NSWorkspace.shared.notificationCenter.removeObserver(activationMonitor) }
    if let token { FileHandle.standardOutput.write(Data("\(token)\n".utf8)) }
    exit(status)
}

mouseMonitor = NSEvent.addGlobalMonitorForEvents(matching: guidanceEventMask) { event in
    let pid = event.cgEvent.map { pid_t($0.getIntegerValueField(.eventTargetUnixProcessID)) }
    if !ended && invalidatesGuidance(event.type, targetPID: pid, excluding: excluded) { finish("invalidate") }
}
guard mouseMonitor != nil else { finish("unavailable", status: 1) }
activationMonitor = NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
) { notification in
    let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
    if !ended && activationInvalidatesGuidance(app?.processIdentifier, excluding: excluded) { finish("invalidate") }
}

// The observer exists only for one short-lived overlay. Parent termination,
// normal cancellation and a hard lifetime limit all remove its observers.
signal(SIGTERM, SIG_IGN)
let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
termination.setEventHandler { finish() }
termination.resume()
DispatchQueue.global(qos: .utility).async {
    while !FileHandle.standardInput.availableData.isEmpty {}
    DispatchQueue.main.async { finish() }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 30) { finish("unavailable", status: 1) }
FileHandle.standardOutput.write(Data("ready\n".utf8))
application.run()
#endif
