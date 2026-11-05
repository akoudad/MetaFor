# Reading and exploration review

2026-11-05. Baseline: `3ba1c10`. This review distinguishes native Safari use,
component regressions, and live model calls. It is not a usability score or a
claim that every device has been tested.

## Previous pass: before and after

| Task | Observed baseline | Revised behavior and evidence |
| --- | --- | --- |
| Scroll upward to reread a child answer | A fresh upward gesture at the top jumped to the parent, at the parent's bottom. | Repeated native Safari upward scrolling stays in the child. Component tests also exercise small, large, and repeated wheel bursts at both edges. |
| Jump to a section in a long answer | Choosing Retry delivery in the outline skipped its heading and first paragraphs. | The same section in the same 19,741-character authored fixture aligns at its heading after the outline collapses. Verified in Safari. |
| Explore deeply, then return | Edge traversal and visited-view history had different implicit routes. | Explicit topic visits followed by Back return from grandchild to child to the exact original section. Verified in Safari with the long fixture. |
| Visit a passage's source | Opening a source also attached that passage to the next question. | Source visits reveal the text only. A component regression submits the saved general draft and verifies no source was attached. |
| Read while an answer is pending | Keyboard and scrollbar reading did not invalidate automatic following. | Independent keyboard and scrollbar regressions verify that a delayed reply does not change the reader, camera, or reading place. |
| Center a paired reply | Temporary source/reply coordinates could be used after leaving the pair. | Single-topic focus uses canonical graph positions. Tests cover Center and Escape with empty history. |
| Read beside nearby topics | Nearby cards could also become full readers and appear clipped at the viewport edge. | Focus keeps other topics compact; explicit source pairs can still show both readers. A regression covers focused, paired, and overview states; Safari verified single reading, paired reading, and Center returning to single reading. |
| Keep constraints in deeper discussions | A long assistant answer could crowd earlier user requirements out of context. | User requests and later corrections get a separate bounded allocation. Regression and live checks retain budget, privacy, and offline-export requirements. |
| Find a reply to a later selected passage | Reused topics were discoverable only from their original creation passage. | Forward links also include later message sources and multi-section selections, without duplicate or self-links. Model regression covers these cases. |

## Reproducible journeys

`npx tsx scripts/live-journey-smoke.ts --fixture` creates a long, authored QA
conversation under ignored `artifacts/journey-check/`. Import
`navigation-baseline.ingx` through the app. It includes children, a grandchild,
and a synthesis; the initial text is deliberately not represented as model output.

With a configured local API, the script can exercise coherent continuations,
independent subjects, existing-topic reuse, synthesis, and two annotations.
Results and validated `.ingx` snapshots are retained there. `--resume` reuses
successful checkpoints rather than paying for the same calls again.

For the navigation walkthrough: use **In this topic** to jump to a middle
section, visit Retry delivery and Atomic acknowledgement, then press **Back**
twice. Repeated scrolling inside the reader at either edge should leave you in
the current topic. Use **Conversation map** to inspect the conversation; choose a
topic to resume reading.

## Scope and limits

Saved conversations and `.ingx` version 1 remain compatible. Grouping is still a
model decision, validated before any graph mutation. Retrieval is bounded lexical
ranking, not semantic search or unlimited memory. Individual model requests can
fail validation and remain retryable without changing the graph.

Native automation sends scrolling and keyboard events; it cannot establish the
feel of a physical trackpad, its momentum, or touch gestures. Those still need
device testing. Browser-console inspection and final live results are recorded
below.

## Live results

All six scripted model scenarios completed: coherent clarification, related
follow-up, independent subject, exact-passage reuse, two separate annotations,
and comparison/synthesis. Actual answer text retained the four project
constraints: budget, no third-party analytics, offline export, and team scope.
The synthesis initially failed validation because it continued an existing
synthesis with its established inputs. After fixing that generic rule, the
captured writer output completed through a real organizer call and was applied
offline. The report preserves the original failure and recovery; this was not a
fresh end-to-end HTTP retry.

Safari imported the completed eight-topic `.ingx` graph, displayed both synthesis
source links, and returned an annotation to its original source section. A
separate native batch submitted two annotation questions, then switched topics,
scrolled, and typed a new unsent draft before the response arrived. The late
answer left that view and draft alone. Reload retained the topic, reading
position, and draft.

Safari's developer console was unavailable through the connected native controls.
No claim of a clean browser console is made. Build, TypeScript, component tests,
and server logs are separate evidence, not substitutes for console inspection.

Previous-pass checks: **185 tests passed**, `npm run typecheck` passed, and
`npm run build` passed. That production build was reloaded and inspected in
Safari. Navigation and backend changes received separate agent reviews; their
regressions are included in the suite.


## Follow-up: direct graph navigation

This update follows the user's revised interaction rules:

- Inside a topic, wheel input reads that topic, including over its header or
  padding. Reaching an edge does not navigate.
- In empty space, scroll up toward the parent and overview, or down toward
  details. A compact topic first centers for reading. Several paths remain a
  choice in the graph; their title buttons replace the bottom chooser panel.
- One wheel burst can move at most one level. Reading momentum crossing out of
  a card cannot trigger navigation. Back still retraces visits independently.
- A pulsing orb and **Thinking…** with **Stop** remain visible while a reply is
  pending, including after visiting another topic.
- **Conversation map** names both map controls. Hovering or keyboard-focusing a
  map dot previews its title before jumping.

Safari verified reading at a topic's edge, parent and child traversal from empty
space, six direct graph choices, and keyboard entry into a readable topic. The
Conversation map showed a title on keyboard focus before Enter navigated. Hover,
focus, dismissal, and navigation are also covered by component tests.

One real follow-up kept **Thinking…** visible while another topic was active.
Completion cleared the indicator and offered the answer without moving that
view. The final production build was reloaded and its graph keyboard navigation
checked again.

Current checks: **200 tests passed**, TypeScript passed, and the production build
passed. Wheel-burst regressions cover ownership and one-level traversal; native
scroll checks do not reproduce every physical trackpad's momentum behavior.
