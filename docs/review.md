# Interaction and logic review

2026-11-04 · Findings reproduced before correction

| Finding | Change | Evidence |
| --- | --- | --- |
| Cards overlapped or spread too far apart as topics accumulated. | Stable compact sibling slots form small groups; synthesis topics sit below their inputs. Manual placements remain separate. | Spatial tests cover compact groups, existing-position stability, and synthesis placement. The imported live graph's overview was inspected in production Safari. |
| Dragging revalidated all source text on every pointer update. | Compute the automatic layout when conversation data changes; apply manual positions separately. | The same 31-topic fixture went from roughly 240 ms for layout/validation to 0.0013 ms per override call. This is a local function measurement, not a browser frame-rate benchmark. |
| Grabbing a topic during camera easing used the destination camera's scale. | Freeze at the currently rendered camera before panning or dragging. | A manual-frame UI test verifies the grabbed projection and pointer-to-world movement ratio. |
| Later follow-ups could lose the older passage that started a topic. | Reserve bounded source anchors before filling context with recent excerpts. | Context tests retain an old quoted constant after large later messages, and flag omitted material. |
| An unselected topic change pointed to the previous answer's last section. | Keep its parent connection with no passage source. | Session and UI tests verify there is no invented quote or section link. |
| Corrections never updated the topic's initial summary. | Refresh the validated cumulative summary on continuation; keep the topic title stable. | Session tests verify updated summaries without rewriting existing answer text. |
| Routing controls exposed implementation decisions in the main interaction. | The interface requests automatic placement; a writer produces content and a separate organizer places its sections. | Provider tests verify both sequential calls, shared timeout, and cancellation. UI tests retain placement without a mode selector. |
| The sent question remained in the composer while its answer was pending. | Clear the input on submission; store the unfinished request separately from the next draft. | UI tests cover immediate clearing, identical next drafts, failed and stopped requests, retry, and reload without automatic sending. |
| New topics appeared without showing their relationship to the source. | Reveal the source, child, and connection before moving into the answer; show the wider shape in a navigable mini-map. | Geometry tests cover the transition and map; manual-frame component checks cover interruption, reduced motion, hidden tabs, and cleanup. Synthesis sources and navigation were inspected in production Safari; live arrival motion remains unverified. |
| Changing context for the next question could let an arriving answer clear that choice. | Treat context-checkbox changes as user interaction, preventing automatic follow. | UI regression verifies the active topic and next context choice survive the returning answer. |
| Selecting text gave no nearby reply action. | Show Ask about this beside the highlight; attach the quote and focus the input only when chosen. | Component tests cover draft preservation, cross-section quotes without UI controls, invalid selections, dismissal, and viewport clamping. |
| Edge scrolling could unexpectedly leave the answer being read. | Topic wheel input only reads; empty-space gestures navigate one hierarchy level. Multiple children remain a direct graph choice. Back retraces visits; breadcrumbs follow ancestry. | Earlier native Safari checks reproduced and then verified the inside-reader edge fix. The new pointer-owned rules require separate checks; see [experience review](experience-review.md). |
| A local child overview could replace the parent's saved reading camera. | Keep the choice transient and serialize the parent's reading view; keep hidden readers mounted. | Reload and scene tests preserve camera, draft, selected quote, and exact scroll position. |
| Several independent subjects shared one long destination. | Support up to eight additional outputs, reuse existing topics, and show affected topics in a fitted choice. | Session tests create four city topics, place later history details independently, and verify all-or-nothing application and replay. The live check produced four city topics and three existing-city continuations. |
| Combining ideas had no explicit representation. | Create new synthesis topics with accepted input-to-output edges; retain the originals and a single navigation parent. | Model, session, and spatial tests cover source validation, unchanged originals, and placement below inputs. The live check created one itinerary topic with four incoming synthesis edges. |
| An organizer plan could reorder dependent sections. | Require each writer section exactly once and increasing original section indices within each group. | Organizer tests reject missing, repeated, invented, empty, and reordered assignments. |
| Root-level comparisons saw child summaries without their recent details. | Add bounded excerpts from up to eight direct children after higher-priority context. | Context tests verify the 60,000-character bound, omitted-child flags, and exclusion of unrelated sibling bodies. |
| A failed second model call could be mistaken for a complete answer. | Return only after the organizer plan validates; preserve the pending question on failure. | Mocked provider tests cover organizer failure, cancellation before its call, cancellation during its call, and the shared timeout. |
| An unopened batch could redirect a later failed question to its old topic choice. | Clear prior unread destinations when a request starts or fails. | UI regression opens the later retry card and preserves the earlier batch and next draft. |

Saved-chat tests cover returning to unfinished drafts, keeping legacy samples
without opening them by default, failed-save recovery, and resetting placement
without changing content or reading state. Offscreen saved automatic views are
recentered after layout changes, while valid cameras and manual positions remain
intact. Mobile readers reserve space for a two-line title at its rendered size.

The layout uses hierarchy, spacing, and node-size principles described in
[D3's tree layout](https://d3js.org/d3-hierarchy/tree), with fixed slot reservation
to preserve existing automatic positions as the conversation grows.
Source anchors follow the practical need to preserve critical dependencies during
context reduction; see [Anthropic's context engineering discussion](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

The latest live graph check passed four app requests / eight model calls: an
inline shortlist, four city topics, three relevant existing-topic continuations,
and a new seven-day itinerary with four incoming synthesis edges. Replay and
`.ingx` round trips passed. These observations do not guarantee future model
grouping. Existing saved answers are not automatically reorganized. See
[release checks](hackathon.md) for the authoritative status.

Production Safari checks covered an imported live graph's overview, synthesis
sources and navigation, restored reading position, section Ask controls, and
topic choices. Physical trackpad and touch gestures, device performance, and
live arrival motion remain unverified; automated geometry and DOM checks do not
establish those.

## Annotation revision · 2026-11-05

The reported broad-topic failures were reproduced as selection and partitioning
cases. Writer instructions now resolve pronouns against the actual passage and
keep independent detailed subjects in separate sections; the organizer receives
resolved passages rather than IDs alone. Annotation batches carry immutable IDs
through both calls, with complete section ownership and atomic application.

Review caught and fixed draft/pending budget mismatches, cross-topic selection
persistence, source-reader focus stealing, paired-view reload/zoom issues, and
reused topics opening at old answers. Tests cover these boundaries. Real model
checks exercised selected-club scope, two annotations, and separate country
profiles; native Safari exercised exact paragraph selection, queueing, and a live
batch that reused existing topics. The source/reply view and both reading
positions survived a refresh. Grouping remains a model judgment. This build
does not repartition previously saved answers automatically.
