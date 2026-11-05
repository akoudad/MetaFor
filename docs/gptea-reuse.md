# GP-Tea mechanisms used in Metafor Help

Inspected [akoudad/gp-tea](https://github.com/akoudad/gp-tea) at
`eafa90ef240a333b268ee7c7a7ecc6ab1d134afb`. Metafor retains its assistance idea:
invoke deliberately, identify relevant screen content, ask alongside it, and
keep the source attached to follow-ups.

## Reuse and changes

- GP-Tea's `AnnotationOverlayController.swift` tries adjacent placements before
  overlapping evidence. `desktop/geometry.ts` adapts that policy to Electron's
  top-left screen coordinates: right, left, below, above, then minimum overlap.
  Panels fit the display work area, including negative secondary-display origins.
- Live labels use the same adjacent-placement idea with all highlighted targets,
  earlier labels, and the actual Help window as obstacles. Candidate positions
  stay inside the viewport; crowded layouts use deterministic minimum overlap
  before proximity. Marks keep their source coordinates rather than moving to
  accommodate a label.
- GP-Tea's `TargetDisplay.swift` retains display identity and scale. Metafor
  stores normalized selection coordinates and converts them against the actual
  captured pixel dimensions; Retina captures must not use CSS point dimensions.
- GP-Tea's `LauncherPanelController.swift` anchors its prompt at the display's
  bottom center and grows upward. Metafor adapts that behavior to a compact
  frameless Electron Help window with an orb and an answer above the prompt.
- GP-Tea's `AnnotationOverlayController.swift` separates a transparent,
  click-through decoration panel from interactive answers. Metafor uses a
  nonfocusable transparent window for marks directly over the original app;
  answers remain in the Help bar. The decoration contains no screenshot.
  A local comparison checks for changed content before showing marks, and a
  short lifetime limits stale pointers. Saved frames remain optional references.
- GP-Tea's `AnnotationInvalidationMonitor.swift` dismisses stale marks after
  external mouse activity or an app switch. Metafor uses a scoped native observer
  with a readiness handshake and cleanup when guidance closes. It observes no
  keyboard input and stores no events. Automatic page redraws are not tracked.
- GP-Tea's `DisplayCaptureService.swift` explicitly requests Screen Recording
  and excludes its own UI. Metafor uses Electron's capture permissions and hides
  its capture UI before taking a still frame. Nothing is continuously recorded.
- `desktop/native/SourceInfo.swift` reads metadata for the front visible normal
  application window on the captured display, excluding Metafor and transient
  system services. This avoids attributing a capture to an invisible notification
  process. Missing titles remain unavailable. The helper neither requests
  Accessibility access nor captures pixels.
- Help captures the current display on invocation and refreshes it when the
  user submits an ordinary question. Snapshot questions and annotations stay
  pinned. Requests include the last 16 messages and at most two recent prior
  frames, bounded to 8 MiB. Historical annotation coordinates accompany those
  turns, so a follow-up can refer to a mark without redrawing it. If a mark ID
  was reused for another region, older regions receive distinct qualified IDs;
  model highlights must match the supplied coordinates and remain capped at 12.
  Help can explain mechanisms using general knowledge, while distinguishing
  those explanations from observations visible in the crop.
- GP-Tea's Keychain and text-history design informed the credential boundary.
  Metafor credentials stay in the main process; source crops, unlike GP-Tea's
  text-only history, are local attachments so returning to Chat preserves the
  approved evidence. See [the desktop decision](decisions/002-macos-app.md).

## Excluded

No GP-Tea action loop, control manifests, shell execution, UI action service,
AppleScript navigation, Accessibility control, or synthetic input is included.
Its mixed assistance/action `AppDelegate.swift` and model service are not copied.

## Checks

`desktop/tests/geometry.test.ts` covers malformed crop input, clipping, Retina
pixels, subpixel selections, negative display origins, edge placement, and small
screens. The native helper emits one JSON record with `appName` and optional
`bundleId`, `pid`, and `windowTitle`; invalid command arguments return an error.
It accepts `--exclude-pid PID` so capture provenance cannot label Metafor itself
as the user's source. See [Mac verification](mac-verification.md) for the isolated
model checks, native observations, and remaining live guidance checks.
