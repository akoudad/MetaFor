# Screen provenance

`SourceInfo.swift` reads window metadata only. It uses the frontmost visible
normal window on the captured display, excluding Metafor and background services.
This avoids naming an invisible notification or permission service as the source
when Help hides itself for capture. It returns unknown when no eligible window
exists. It does not use Accessibility, capture pixels, or control other apps.

The caller passes `--exclude-pid PID --display-id ID`. Display IDs must identify an
active display. The native fixture test covers transient services, excluded and
transparent windows, front-to-back ordering, and displays with negative origins.
Image matching in the main process remains the check before placing guidance.

# Guidance lifetime

`GuidanceObserver.swift` is a read-only observer for one guidance overlay. It
observes external scroll and mouse-down events plus application activation, then
asks the main process to remove the overlay. Events targeting Metafor are ignored
so Help remains usable. Unknown event destinations invalidate conservatively.
The answer remains in Help; input details are neither retained nor sent anywhere.

The main process waits for `ready` before displaying annotations. Registration
failure, a missing/crashed helper, malformed output or a startup timeout prevents
or closes guidance. Closing Help, changing its layout, expiry (12 seconds),
renderer failure and quitting stop the observer. A closed parent pipe and a
30-second native backstop also end it. Helpers are unpacked and explicitly listed
for signing in the Mac package.

This uses Apple's [global event monitor](https://developer.apple.com/documentation/appkit/nsevent/addglobalmonitorforevents(matching:handler:))
for mouse events only; it cannot change or block an event. Apple requires
Accessibility trust for key-related monitoring, which this helper never requests
or performs. The [event target PID](https://developer.apple.com/documentation/coregraphics/cgeventfield/eventtargetunixprocessid)
distinguishes Help interaction from other apps. There are no event taps,
permission prompts, continuous screenshots or computer controls.

Native fixture tests exercise the event policy without installing a monitor.
Main-process tests cover readiness, failure, late events, load cancellation and
cleanup. In the 0.4.2 packaged-app check, the user physically confirmed immediate
dismissal on external clicks or scrolling. CUA's automated scrolling did not
reliably exercise global event delivery. Content that moves without mouse/app
activity (for example video or an automatic page refresh) is not continuously
tracked; the initial image check and short expiry still apply.
