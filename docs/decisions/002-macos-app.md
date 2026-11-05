# ADR-002: Local macOS application

**Status:** Accepted · **Date:** 2026-11-05

## Decision

Bundle the existing React/Three conversation renderer with Electron. Vite builds
local assets; Electron runs the existing writer and organizer in its main process.
There is no hosted web page and no localhost server. A separate worktree and branch
keep the released Next.js web app unchanged.

Electron was chosen over a Swift/WebKit shell because the current renderer, model
validation, storage, and tests can be reused directly. A Swift shell would also
need a JavaScript service runtime or a second model implementation. The trade-off
is a larger download and memory footprint.

## Help

Reuse GP-Tea's explicit capture, region selection, coordinate normalization,
annotation anchors, floating companion, and permission handling. Do not include
its Accessibility execution engine, clicking, typing, AppleScript actions, or
computer-control agent. The default shortcut is ⌃⌥⌘M and remains configurable. Adding Control avoids
macOS's standard [minimize-all-windows shortcut](https://support.apple.com/en-us/102650).
Registration failure reports global reservations; it cannot detect every
application-specific shortcut. Existing saved shortcuts are preserved.

The user activates Help, captures a still frame, selects a region, reviews it,
optionally marks it, and presses Send. Only the selected crop is sent to the
configured model. Follow-ups use that same frozen source until a new selection.
No background capture, microphone, or continuous video stream is used.

Help sessions and source crops stay in the user's Application Support directory.
Conversations retain the existing .ingx format. Help source metadata and images
remain separate attachments linked by conversation ID, available when continuing
in Chat. Existing web chats transfer through the existing .ingx export/import.

## Boundaries

Renderers are sandboxed with context isolation and no Node integration. The preload
exposes individual bounded operations. Main-process IPC verifies the calling
window and main frame. Credential operations use Electron’s asynchronous APIs
with bounded waits, so
Keychain prompts cannot block window creation or the main event loop. Removing
a key deletes its encrypted file and invalidates pending unlocks. Credentials
are encrypted with macOS Keychain-backed Electron safeStorage and are never returned to renderers. Packaged files contain
no development environment secrets. Network model calls use HTTPS and do not
follow redirects. Third-party pages cannot run inside privileged app windows.
Renderer permission requests are denied; the main process owns explicit screen
capture. External conversation imports receive fresh IDs and cannot attach a
private Help crop by claiming its ID. Settings changes keep the old shortcut
active until preferences and the encrypted credential have both been saved.
Closing or reloading Chat cancels its pending model request.

Reference: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[GP-Tea](https://github.com/akoudad/gp-tea), inspected at eafa90ef.

## Local signing

Electron Builder signs the app and bundled `source-info` executable ad hoc.
Hardened Runtime is disabled for this local development artifact; a distributed
release needs a Developer ID signature, Hardened Runtime, and notarization.
No OS-wide security setting is changed. Verify the final bundle recursively and
verify the DMG after packaging.

## Verification

Build and launch the actual .app; test Chat, saved .ingx migration, annotation
follow-ups, explicit capture, crop and mark geometry, Help follow-ups, Help-to-Chat
handoff, relaunch persistence, denied permission, invalid credentials, cancellation,
and shortcut registration. Keep signing/notarization status explicit in delivery.
