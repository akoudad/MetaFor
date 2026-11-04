# Hackathon build

Local release candidate · 2026-11-04

## Implemented and checked

- [x] Real Meta answers with readable sections.
- [x] Select text in any completed answer and ask about that passage.
- [x] Automatic continue/branch placement, explicit modes, and latest-answer overrides.
- [x] Retain drafts, selected passages, reading positions, and camera views.
- [x] Keep a returning answer attached to its original question without stealing focus.
- [x] Origin arrows, optional suggested relationships, and stable manual placement.
- [x] Saved-conversation library, reload recovery, and validated `.ingx` import/export.
- [x] Preserve existing work when a request, save, or import fails.
- [x] Long-answer outline and keyboard navigation through a crowded space.
- [x] Varied stars with gentle drift and occasional faint shooting stars.
- [x] Setup, deployment instructions, example file, and a short demo script.

## Verification

- 65 automated tests pass, including 13 integrated React DOM tests.
- Type checking and the production build pass.
- Three real `muse-spark-1.3` calls verified the first answer, automatic passage
  branching, and forced continuation. Parent content and exact quotes survived.
- The live conversation passed `.ingx` serialization/import. An example is in
  `examples/browser-cache.ingx`.
- A 35-topic fixture with a 16,440-character answer passed keyboard navigation,
  outline, selection, and return-state checks in the DOM test environment.
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
