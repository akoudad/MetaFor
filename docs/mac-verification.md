# Mac verification — 2026-11-05

Desktop worktree: `metafor-mac`, branch `feat/macos-app`.
The original web checkout remains unchanged.

## Verified

- 234 existing conversation tests and 86 desktop tests pass.
- TypeScript and the Next.js production build pass.
- The Apple silicon DMG builds successfully. Its checksum passes; the app and
  bundled helper pass recursive strict signature verification, including the
  copy inside the mounted DMG.
- Packaged Electron app launches from local `metafor://app` assets without a
  web server; native shortcut registration succeeds.
- Preview 0.2.0 starts with a clean profile in 453 ms and a profile
  containing corrupt preferences and ciphertext in 488 ms. Both create a visible
  window that finishes loading without a renderer crash. The recovery test keeps
  both original files unchanged. Clean-profile shutdown completes in 248 ms.
- Preview 0.2.1 also launches with a clean profile, registers its shortcut, and
  fully loads the local renderer without a crash. Launch takes 2,431 ms in this
  run and clean shutdown completes in 639 ms. These are individual lifecycle
  observations, not performance benchmarks.
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
- Capture cancellation and failures restore previously visible windows without
  focusing them. Selection load failures and renderer crashes close the overlay,
  discard the full frame, and permit retry; a late failure cannot close a newer
  selection. Capture consent and Settings saves cannot race preference writes.
- Unreadable Help files remain visible and deletable without hiding healthy
  exchanges. Assistant highlights survive Chat handoff and older imports can
  gain missing marks without overwriting text. A late initial Help lookup cannot
  replace a newer capture or erase its draft.

## Remaining native checks

Screen Recording is denied on this Mac. Actual screen capture from another
application, Retina/multiple-display crop alignment, and shortcut-to-capture
cannot be confirmed until the user enables permission and relaunches Metafor.
Application/window labels describe the frontmost app at capture time; a crop
can contain another app or several windows. Exact crop provenance is not
verified. The approved frozen pixels, rather than that label, define the source.

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

## Current artifact

`artifacts/mac/Metafor-0.2.1-arm64.dmg`

SHA-256: `580a3a6a647727b607b3ee1ee9934b83d4ff35e4573c8d294aaeb9dd829e3fb7`
