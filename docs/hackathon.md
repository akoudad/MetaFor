# Hackathon build

Local release candidate · 2026-11-04

## Implemented and checked

- [x] Real Meta answers with readable sections.
- [x] Select text in any completed answer and ask about that passage.
- [x] Automatic topic placement with no branch/continue controls in the interface.
- [x] Retain drafts, selected passages, reading positions, and camera views.
- [x] Keep a returning answer attached to its original question without stealing focus.
- [x] Truthful source arrows, optional related topics, manual placement, and Reset layout.
- [x] Empty start, visible New chat / Saved chats, and preserved unfinished drafts.
- [x] Saved-conversation library, reload recovery, and validated `.ingx` import/export.
- [x] Preserve existing work when a request, save, or import fails.
- [x] Long-answer outline and keyboard navigation through a crowded space.
- [x] Varied stars with gentle drift and occasional faint shooting stars.
- [x] Setup, deployment instructions, example file, and a short demo script.

## Verification

- 80 automated tests pass, including 20 integrated React DOM tests.
- Type checking and the production build pass.
- Three real `muse-spark-1.3` calls on the revised build verified the first answer,
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

## Remaining release checks

- [ ] Inspect the actual rendered interface, camera motion, and pointer/touch
  behavior. Browser-control hosts were unavailable; DOM tests do not prove
  visual composition or physical gesture behavior.
- [ ] Deploy and submit the hackathon entry once authorized. Neither has been
  performed; pushing source to GitHub does not publish the app.

The API key stays on the server. `.ingx` contains conversation content and view
state. The app owns IDs, sources, layout, and connection validation; the model
supplies content and routing advice.
