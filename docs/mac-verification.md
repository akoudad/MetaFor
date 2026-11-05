# Mac verification — 2026-11-05

Desktop worktree: `metafor-mac`, branch `feat/macos-app`.
The original web checkout remains unchanged.

## Verified

- 234 existing conversation tests and 74 desktop tests pass.
- TypeScript and the Next.js production build pass.
- The Apple silicon DMG builds successfully. Its checksum passes; the app and
  bundled helper pass recursive strict signature verification, including the
  copy inside the mounted DMG.
- Packaged Electron app launches from local `metafor://app` assets without a
  web server; native shortcut registration succeeds.
- The final packaged build starts with a clean profile in 453 ms and a profile
  containing corrupt preferences and ciphertext in 488 ms. Both create a visible
  window that finishes loading without a renderer crash. The recovery test keeps
  both original files unchanged. Clean-profile shutdown completes in 248 ms.
- A real Chat question receives a Meta reply in the native window.
- An annotation is written and submitted in the editor beside its source.
  The annotation produces a separate linked reply. Returning to the source
  restores the unrelated bottom draft.
- The native capture consent flow reports denied Screen Recording permission
  without sending a screenshot.
- Two real Help model requests using a **synthetic water-cycle image**, not a
  captured screen, identify the marked region and preserve that mark in a
  follow-up. Saving and reading the exchange preserves all four messages.
- Help-to-Chat conversion preserves source metadata and visual coordinates in
  the context supplied for further answers.
- Automated tests cover explicit crop submission, normalized marks, inline
  annotation drafts, cancellation, stale replies, history deletion, source
  refresh, import identity, and preserving existing Chat branches on handoff.

## Remaining native checks

Screen Recording is denied on this Mac. Actual screen capture from another
application, Retina/multiple-display crop alignment, and shortcut-to-capture
cannot be confirmed until the user enables permission and relaunches Metafor.

Native UI inspection timed out after relaunch. A process-level check confirmed
an application-ready, visible window with local assets fully loaded, but that
is not proof of a visually correct restored session. The complete interactive
Help capture → annotation → reply → Continue in Chat workflow still needs a
native pass. Synthetic-image tests do not substitute for that pass.

macOS Keychain access also remained pending in this session. Moving encryption
to Electron's asynchronous APIs fixes the startup freeze and leaves Chat usable,
with a bounded wait and recovery status. The underlying macOS request cannot be
canceled by that timeout: it can still stall process shutdown until Keychain
responds. A clean profile shuts down normally. This requires a further installed
app test with Keychain access approved; the local preview does not claim this
lifecycle is fully verified. An `app.exit(0)` experiment did not resolve the
blocked native shutdown and was not retained as a workaround.

The package is a local ad-hoc build. It is not Developer ID signed or notarized;
Gatekeeper assessment rejects it as expected. Public distribution requires that
separate release step.
