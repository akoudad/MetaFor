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
- GP-Tea's `TargetDisplay.swift` retains display identity and scale. Metafor
  stores normalized selection coordinates and converts them against the actual
  captured pixel dimensions; Retina captures must not use CSS point dimensions.
- GP-Tea separates click-through highlights from the interactive answer panel.
  Metafor's selection/annotation interface likewise separates the source from
  the answer. Follow-ups use the approved source until the user updates it.
- GP-Tea's `DisplayCaptureService.swift` explicitly requests Screen Recording
  and excludes its own UI. Metafor uses Electron's capture permissions and hides
  its capture UI before taking a still frame. Nothing is continuously recorded.
- `desktop/native/SourceInfo.swift` reads only frontmost application identity and
  its visible window title through NSWorkspace and CGWindowListCopyWindowInfo.
  The caller can exclude its own PID. Missing window titles remain unavailable;
  they are never inferred from another application's windows. The helper neither
  requests Accessibility access nor captures pixels.
- Help sends the approved frozen source and the last 16 messages only when the
  user submits a question. Historical annotation coordinates accompany those
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
as the user's source. Screen capture and external application interactions still
require verification with the launched application.
