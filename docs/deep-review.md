# Deep review

2026-11-05 · baseline `43f257a`

Scope: reading and graph navigation, selected-passage replies, delayed answers,
model context and routing, request failure handling, saved conversations,
`.ingx` validation, and release checks. Three independent reviewers covered
the model pipeline, data integrity, and spatial interaction.

## Fixes

| Problem | Change |
| --- | --- |
| Overview and detail views lacked an obvious next action. | Visible parent, Explore, and Return to reading controls accompany the graph. The composer identifies the topic being asked about. |
| One organized answer still required choosing from a one-item fork. | A single destination opens for reading; several destinations remain a graph choice. |
| Opening a late answer could lose its scroll target or add an unvisited origin to Back history. | Explicit Open answer restores the answer target and navigates directly to its destination. Back returns to the place actually visited. |
| A failed or stopped question could be difficult to recover after leaving its topic. | View question, Retry, and Dismiss stay available beside the composer. Dismiss clears stale answer notices. |
| Small, nearby map dots could jump to the wrong topic. | Pointer hit testing uses the nearest actual dot and matches the title preview, including SVG letterboxing. Keyboard navigation remains available. |
| Passage replies appeared at the end of the whole answer. | Follow-up links now appear under the section they refer to. |
| Generic follow-ups to combined topics could omit their contributing discussions. | Accepted synthesis inputs receive bounded context allocation before lexical matches, including exact source passages and scoped requirements. |
| Repeated wording could erase a distinct requirement or a later correction. | Requirements retain their topic, message identity, and order; only the separately stored original prompt is excluded. |
| Upload and model timeouts could exceed the hosting deadline together. | A 55-second deadline covers the complete route, with a separate 10-second upload limit. Rejected response streams are cancelled. |
| A delayed save could replace a newer saved snapshot. | Timestamp comparison and write share one IndexedDB transaction; stale save completion cannot change the visible save status. |
| One damaged stored copy could block otherwise intact conversations. | Load valid alternatives, show partial-library warnings, and preserve damaged raw copies. |
| Imported message sources could point forward or create a source cycle. | Validate message chronology and provenance cycles independently of legitimate graph connections. |

The local development server was also restarted from the renamed `metafor`
folder after detecting that it still served compiled code from before the rename.
Existing browser storage identifiers and `.ingx` version 1 remain unchanged.

## Verification

- **225 automated tests passed**, including the new recovery, navigation,
  context, and provenance regressions. TypeScript and the production build pass.
- Native Chrome inspected the refreshed production build on port 3002 using
  the authored navigation fixture. Overview → topic → grandchild → Back twice
  restored the original section heading and reading position.
- Empty-space scrolling returned to the overview and back into reading. Graph
  choices, visible depth controls, and keyboard map-title preview/navigation
  worked. These checks used automation-generated input, not a physical trackpad.
- New chat opened an empty space; Saved chats and a page reload restored the
  prior topic and its unsent draft. No extra model call was made in this journey.
- Dependency audit reported zero known vulnerabilities. A fresh scan of all
  11 client build files found no configured API secret. These checks do not
  constitute a penetration test or a guarantee against unknown vulnerabilities.
- Browser-console inspection was not performed in this pass. Component tests,
  native UI inspection, and server/build output are separate evidence.

## Real-model verification

Two app requests / four `muse-spark-1.3` calls completed without retries against
the refreshed development server. The authored fixture contained 28 unrelated
topics plus two inputs to a synthesis. A pronoun-only follow-up retained both
inputs and all seven explicit constraints in the answer. A focused clarification
reused an existing dedicated topic and left orientation text in the synthesis.

These are observed examples, not a guarantee of model judgment or accuracy.
Local evidence and an importable replay are under ignored
`artifacts/deep-review/pipeline-live/`. No user chat was sent for this check.

## Remaining limits

- Edit a conversation in one tab at a time. Timestamp ordering prevents delayed
  writes; it does not merge concurrent edits from different tabs.
- Context is bounded and selection is not embedding-based retrieval. The model
  can choose an imperfect grouping. Validation protects structure, not meaning.
- Physical trackpad momentum, touch behavior, and real-device performance still
  need device testing. Simulated gestures are not a substitute.
- Browser storage is local to the browser and origin. Export `.ingx` for a
  portable copy; there is no account sync or shared conversation editing.
- This review does not deploy the web app, submit the entry, or build the macOS
  wrapper. Those are separate steps.
