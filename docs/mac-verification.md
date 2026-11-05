# Mac verification — 2026-11-05

Desktop worktree: `metafor-mac`, branch `feat/macos-app`.
The original web checkout remains unchanged.

## Current build: 0.4.4

- All 193 desktop tests and 248 web conversation tests pass; TypeScript and
  `git diff --check` pass.
- The Apple silicon package builds successfully. The app passes recursive
  strict signature verification and the DMG passes `hdiutil verify`.
- The native renderer, main-process bundles, and Next.js production build pass.
- Tests cover Help-only activation and reopening, capture/window restoration
  races, cancellation, failed captures, bounded IPC inputs, source-linked
  history, inline annotations, and preserving existing Chat branches on handoff.
- Help storage keeps each source image once and checks capacity before a model
  request, reserving room for the reply. Tests cover legacy history, oversized
  captures, and shortcut registration warnings.
- Guidance tests cover transparent rendering without a screenshot, labels,
  clipping, Retina coordinates, negative display origins, and reduced motion.
  Native integration tests verify click-through window configuration and that
  guidance is cleared on capture, dismissal, and timeout.
- Observer tests cover its readiness handshake, cancellation, failure, helper
  cleanup, and packaged execution path. Labels avoid targets, other labels,
  and the current Help window bounds.
- Local image checks test target regions and nearby pixels before showing
  guidance. They tolerate a bounded changed region away from the target and
  reject changed targets or broadly changed backgrounds. This is a heuristic,
  not live element tracking or proof of semantic identity.

## Conversation reader and Fast mode — 0.4.4

Fast mode returns the answer and its topic organization in one validated model
call. Balanced and Deep retain the separate organizer. The classic Conversation
reader shows full messages and supports jumping to their topics. The model picker
no longer overlaps the navigation controls, and the repeated Help footer was
removed. The 0.4.4 Apple silicon app and DMG passed signature and checksum checks.
The native workflow observations below refer to their stated earlier versions.

## Help shortcut toggle

Option + M now hides a visible Help bar and its guidance, or opens Help when
hidden. Dismissing a pending capture invalidates it before any asynchronous
completion can reopen a window. A running model answer stays in its session and
can be reopened without another capture or provider request; late automatic
guidance requests from hidden Help are ignored.

All 44 focused capture and startup tests pass. New cases cover open/hide/reopen,
pending capture replacement, consent and region-selection cancellation, guidance
dismissal, a running answer, and a refresh that temporarily hides Help. These
exercise the registered shortcut callback against the real main-process code
with isolated native fixtures; no physical shortcut check was performed for
this revision.

## Model selection and compact Help — 0.4.3

The shared picker offers Spark 1.3 with Minimal reasoning (Fast), Spark 1.3
with Medium reasoning (Balanced, the default), and Wonder 1.0 with High reasoning
(Deep). Tests verify persistence, synchronization between Chat and Help, account
availability checks, and the actual outgoing model and reasoning fields in the
Chat writer, organizer, and Help requests. A running request retains its choice.

All three choices completed real Chat and Help requests using a synthetic input.
The first Deep writer response was incomplete and failed validation with a
retry message; an explicit retry completed all three stages. No model fallback
was used. These checks establish routing for the tested calls, not latency or
answer-quality guarantees. Reports:

- `artifacts/qa/model-selector-live-result.json`
- `artifacts/qa/model-selector-deep-result.json`

Isolated browser checks verified the compact latest-answer view, long-answer
scrolling, Expand/Compact, the persistent composer and action controls, and the
model picker. The default panel stayed within 330 pixels; expanded reading is
bounded at 580 pixels. No resize feedback loop or browser error was observed.
Native integration tests cover resizing while guidance remains visible and
placing the Help window away from individual target regions.

Visual fixtures verified cyan outlines with a dark keyline and soft halo on a
light page, transparent target interiors, and a compact panel clear of both
targets. In crowded scenes an expanded panel can still overlap a target; the
placement algorithm minimizes overlap, and Compact/Hide answer remain available.
These checks used isolated fixtures rather than taking over the user's screen.

## Fresh profiles and reinstall behavior

Reinstalling the app preserves `~/Library/Application Support/Metafor`, which
contains Chromium's saved Chat data and native Help history. Chat currently
resumes the latest saved live conversation; replacing the `.app` is not a reset.
The reported old graph is consistent with that restore path. No football content
or startup seed was found in the source, and the packaged ASAR contains only
the app code, renderer, native helpers, and image assets. No saved profile or
conversation files are included.

A hidden Electron check ran the packaged 0.4.3 main process, preload, renderer,
and real Chromium storage against two separate temporary native profiles:

- Both fresh profiles showed the welcome screen, zero topics, an empty prompt,
  no saved Chats, no Help history, and no saved credential.
- Importing the existing two-topic browser-cache fixture, writing an unsent
  draft, quitting, and reopening the same profile preserved the full conversation
  and restored the draft. A second fresh profile remained empty.
- Native window presentation, tray creation, and global shortcuts were suppressed
  by the test harness. The real user profile was not read or changed, and no
  screen capture or model call occurred.

Seven focused Chat UI tests also pass, including new regressions for empty first
launch, live conversation/draft restoration, and retaining legacy sample chats
in storage without opening them automatically. No startup reset was added.
Report: `artifacts/qa/fresh-profile-result.json`.

## Isolated real-model checks

Three real `muse-spark-1.3` requests passed without retries using only a synthetic
water-cycle image:

1. Identify the middle process and place a highlight: correctly identified and
   located condensation.
2. Translate the phrase into French: returned the useful local label
   `Vapeur → gouttelettes` over the phrase.
3. Explain why that change happens: retained the prior context and explained
   cooling, distinguishing general explanation from visible content.

Saving and reloading preserved all six messages, source IDs, and visual marks.
The Help-to-Chat context included the correct saved image and earlier mark.
These calls did not open an app, capture the user's screen, or touch their
history. A fresh temporary HelpStore was removed after verification.

Local report: `artifacts/qa/isolated-help-result-1793876469667.json`.
This is evidence for these requests, not a guarantee for arbitrary screens.

## Earlier native observations and remaining checks

The packaged app runs from `metafor://app` without a web server. macOS reports
Screen Recording permission granted. The user physically confirmed that
**Option + M** opens the small Help bar.

The earlier native run verified automatic background capture of a separate
fictional-camera page in Brave. The real model correctly recommended Summit
Travel at $799, with 4K video and 390 g weight, and returned a mark for its View
button. The native guidance accessibility tree contained the corresponding
label. An earlier capture of the wrong foreground app did not invent camera
details. These are observed results for those inputs, not a general accuracy
guarantee.

Help-only capture now keeps Chat hidden; the earlier activation race is fixed
and covered by regression tests. The collapsed bar and expanded answer panel
were visually inspected. Normal use does not show a screenshot preview;
inspection remains available through History.

The run also exposed incorrect source attribution to a temporary macOS
`UserNotificationCenter` process. Source provenance now follows the front
visible application window on the captured display, excluding Metafor, rather
than trusting the frontmost process alone.

The native Help annotation → reply → Continue in Chat flow passed. A follow-up
in Chat used the saved camera image correctly ($300 more and 130 g heavier),
and quitting/relaunching retained the exchange and follow-up. Earlier checks
also preserved an unrelated prompt draft.

With 0.4.2, reopening that Help exchange and continuing in Chat removed exact
generated metadata sections from the older transfer while retaining the original
questions, replies, branches and tested follow-up. A subsequent relaunch retained
the cleaned conversation. Source metadata and marks remain available to the
model separately from the readable transcript.

A fresh 0.4.2 capture correctly described VS Code when that was the visible app
and refused to invent the absent camera-page button. Follow-up requests located
its Explorer icon and displayed native guidance with a label outside the target.
A coordinate click reached the underlying Explorer control and toggled its
sidebar; the sidebar was restored. The overlay screenshot placed the mark in
the corresponding screen region, but an app-only screenshot does not prove
pixel-perfect composited alignment.

The user physically confirmed that clicking or scrolling in the underlying app
immediately dismisses the highlight. Automated scrolling did not reliably
exercise the macOS global event monitor, so that confirmation is recorded
separately from automated evidence. The final Help view retained the answer and
offered Show on screen again after the guidance had cleared.

Remaining limits:

- General placement accuracy across arbitrary screens has not been established;
  model-generated coordinates can be imprecise.
- Multiple-display behavior on physical hardware; coordinate coverage so far
  comes from fixtures, including Retina and negative display origins.
- Content moving without mouse/app activity, such as video or automatic page
  refreshes, is not tracked continuously. Guidance expires after 12 seconds.

Synthetic and mocked checks do not establish these hardware and accuracy claims.

## Artifact

`artifacts/mac/Metafor-0.4.3-arm64.dmg`

SHA-256: `730cf207b53091eddf24dd3408cbfdcc461a7174fd1f351ed78f1bf0639d914e`

This is a local ad-hoc signed preview, not a Developer ID signed or notarized
public release. Signing verification checks package integrity; it does not
establish Gatekeeper approval or completion of the remaining native checks.
