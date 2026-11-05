# Hackathon build

Local release candidate · 2026-11-05

## Implemented and checked

- [x] Real Meta answers with readable sections.
- [x] Select text in any completed answer; use the nearby Ask about this action to reply.
- [x] Queue up to six passage questions and receive separate source-linked replies.
- [x] Read a focused reply beside its source on wide screens, with a source link on smaller screens.
- [x] Automatic topic placement with no branch/continue controls in the interface.
- [x] Separate answer-writing and organizing calls; the organizer keeps, splits, reuses, or combines topics.
- [x] Several topics can arrive together; synthesis connects its source topics without deleting them.
- [x] Retain drafts, selected passages, reading positions, and camera views.
- [x] Keep a returning answer attached to its original question without stealing focus.
- [x] Truthful source arrows, optional related topics, manual placement, and Reset layout.
- [x] Empty start, visible New chat / Saved chats, and preserved unfinished drafts.
- [x] Clear submitted input immediately; retain pending questions separately for retry.
- [x] Saved-conversation library, reload recovery, and validated `.ingx` import/export.
- [x] Preserve existing work when a request, save, or import fails.
- [x] Long-answer outline and keyboard navigation through a crowded space.
- [x] Source-to-detail arrival motion and a navigable isometric mini-map.
- [x] Wheel/trackpad reading with parent/child navigation at edges and an explicit path chooser.
- [x] Preserve reading positions and drafts when returning, including after a chooser reload.
- [x] Varied drifting stars, a faint galaxy, restrained meteors, a glowing orb, and star cursor.
- [x] Setup, deployment instructions, example file, and a short demo script.

## Verification

- 183 automated tests pass, including 57 integrated conversation UI tests,
  organizer validation, atomic batches, synthesis, and scene DOM checks.
- Type checking and the production build pass.
- Four real app requests (eight `muse-spark-1.3` calls) kept a short city list
  together, created four city guides, placed three briefings in their existing
  city topics, and produced an itinerary with four incoming synthesis links.
  Replay and `.ingx` round trips passed. This verifies organization, not the
  factual accuracy of the generated travel information.
- The annotation regression passed three real app requests / six model calls:
  a Wydad-only selected follow-up, two independent annotated club questions, and
  seven country profiles. Exact sources, individual questions, replay and file
  round trips passed. No domain-specific splitting logic was introduced.
- A further live Safari submission queued two selected paragraphs and received
  replies in their two existing dedicated topics (two more model calls).
  Opening a reply kept its source visible beside it; refreshing restored the
  paired view and both readers' positions.
- The live conversation passed `.ingx` serialization/import. An example is in
  `examples/browser-cache.ingx`.
- A 35-topic fixture with a 16,440-character answer passed keyboard navigation,
  outline, selection, and return-state checks in the DOM test environment.
- Projection tests cover wide and deep conversations up to 200 topics without
  automatic-layout overlaps in five viewport shapes. See the [logic review](review.md).
- The production server serves the page and model-status endpoint. Invalid
  requests and cross-origin requests are rejected before model generation.
- No configured API key or demo access code was found in client build files.
- A manual-frame DOM check verified idle canvas animation leaves cards and links
  unchanged, pauses in hidden tabs, respects reduced motion, and cleans up on
  unmount. It does not measure real-browser rendering performance.
- Arrival tests cover source/child framing, exact final position, interruption,
  reduced motion, and cleanup. Mini-map tests cover large/extreme layouts and
  keyboard navigation. Pending-question tests cover Stop, retry, Dismiss, reload
  without automatic sending, and preservation of a separately typed next draft.
- Semantic-scroll tests cover native and empty-space reading, one transition per
  gesture, parent/child paths, chooser scrolling, keyboard focus, leaf guidance,
  zoom isolation, and saved-place recovery. These simulate wheel sequences;
  physical trackpad inertia still needs a browser check.
- Safari inspection of the production build verified importing the real graph,
  reading individual city topics, section follow-up selection, the topic chooser,
  synthesis source links, and restoring a previous reading position.

## Remaining release checks

- [ ] Check physical trackpad inertia and touch behavior on their target devices.
  Native browser inspection and simulated gestures do not cover those devices.
- [ ] Deploy and submit the hackathon entry once authorized. Neither has been
  performed; pushing source to GitHub does not publish the app.

The API key stays on the server. `.ingx` contains conversation content and view
state. The app owns IDs, sources, layout, and connection validation; the model
supplies content and routing advice.
