# Hackathon build

Local release candidate · 2026-11-04

## Implemented and checked

- [x] Real Meta answers with readable sections.
- [x] Select text in any completed answer; use the nearby Ask about this action to reply.
- [x] Automatic topic placement with no branch/continue controls in the interface.
- [x] Retain drafts, selected passages, reading positions, and camera views.
- [x] Keep a returning answer attached to its original question without stealing focus.
- [x] Truthful source arrows, optional related topics, manual placement, and Reset layout.
- [x] Empty start, visible New chat / Saved chats, and preserved unfinished drafts.
- [x] Clear submitted input immediately; retain pending questions separately for retry.
- [x] Saved-conversation library, reload recovery, and validated `.ingx` import/export.
- [x] Preserve existing work when a request, save, or import fails.
- [x] Long-answer outline and keyboard navigation through a crowded space.
- [x] Source-to-detail arrival motion and a navigable isometric mini-map.
- [x] Varied drifting stars, a faint galaxy, restrained meteors, a glowing orb, and star cursor.
- [x] Setup, deployment instructions, example file, and a short demo script.

## Verification

- 108 automated tests pass, including 35 integrated conversation UI tests and
  three mini-map/scene DOM tests.
- Type checking and the production build pass.
- Three real `muse-spark-1.3` calls during backend verification covered the first answer,
  deeper selected topic, and short clarification with automatic placement
  throughout. Parent content and exact quotes survived.
- The live conversation passed `.ingx` serialization/import. An example is in
  `examples/browser-cache.ingx`.
- A 35-topic fixture with a 16,440-character answer passed keyboard navigation,
  outline, selection, and return-state checks in the DOM test environment.
- Projection tests cover wide and deep conversations up to 200 topics without
  automatic-layout overlaps in four viewport shapes. See the [logic review](review.md).
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

## Remaining release checks

- [ ] Inspect the actual rendered interface, camera motion, and pointer/touch
  behavior. Browser-control hosts were unavailable; DOM tests do not prove
  visual composition or physical gesture behavior.
- [ ] Deploy and submit the hackathon entry once authorized. Neither has been
  performed; pushing source to GitHub does not publish the app.

The API key stays on the server. `.ingx` contains conversation content and view
state. The app owns IDs, sources, layout, and connection validation; the model
supplies content and routing advice.
