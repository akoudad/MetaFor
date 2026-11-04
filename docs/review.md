# Interaction and logic review

2026-11-04 · Findings reproduced before correction

| Finding | Change | Evidence |
| --- | --- | --- |
| Cards at different depths overlapped in overview. | Stable depth rows and reserved horizontal lanes account for perspective. Overview titles stay within their projected bounds. | Spatial tests project wide and deep graphs up to 200 topics across four viewport shapes. |
| Dragging revalidated all source text on every pointer update. | Compute the automatic layout when conversation data changes; apply manual positions separately. | The same 31-topic fixture went from roughly 240 ms for layout/validation to 0.0013 ms per override call. This is a local function measurement, not a browser frame-rate benchmark. |
| Grabbing a topic during camera easing used the destination camera's scale. | Freeze at the currently rendered camera before panning or dragging. | A manual-frame UI test verifies the grabbed projection and pointer-to-world movement ratio. |
| Later follow-ups could lose the older passage that started a topic. | Reserve bounded source anchors before filling context with recent excerpts. | Context tests retain an old quoted constant after large later messages, and flag omitted material. |
| An unselected topic change pointed to the previous answer's last section. | Keep its parent connection with no passage source. | Session and UI tests verify there is no invented quote or section link. |
| Corrections never updated the topic's initial summary. | Refresh the validated cumulative summary on continuation; keep the topic title stable. | Session tests verify updated summaries without rewriting existing answer text. |
| Routing controls exposed implementation decisions in the main interaction. | The interface always requests automatic placement. | UI tests cover both outcomes without a mode selector; three live Meta requests produced an initial answer, deeper topic, then same-topic clarification. |
| The sent question remained in the composer while its answer was pending. | Clear the input on submission; store the unfinished request separately from the next draft. | UI tests cover immediate clearing, identical next drafts, failed and stopped requests, retry, and reload without automatic sending. |
| New topics appeared without showing their relationship to the source. | Reveal the source, child, and connection before moving into the answer; show the wider shape in a navigable mini-map. | Geometry tests cover the transition and map; manual-frame component checks cover interruption, reduced motion, hidden tabs, and cleanup. Visual acceptance remains pending. |
| Changing context for the next question could let an arriving answer clear that choice. | Treat context-checkbox changes as user interaction, preventing automatic follow. | UI regression verifies the active topic and next context choice survive the returning answer. |
| Selecting text gave no nearby reply action. | Show Ask about this beside the highlight; attach the quote and focus the input only when chosen. | Component tests cover draft preservation, cross-section quotes without UI controls, invalid selections, dismissal, and viewport clamping. |
| Reading and spatial zoom used different scroll meanings without a path through the discussion. | Ordinary wheel input reads a topic and follows navigation parents at its edges; multiple children open a local choice. | Gesture and UI tests cover boundary intent, momentum, parent traversal, explicit child choice, and reading-state restoration. |
| A local child overview could replace the parent's saved reading camera. | Keep the choice transient and serialize the parent's reading view; keep hidden readers mounted. | Reload and scene tests preserve camera, draft, selected quote, and exact scroll position. |

Saved-chat tests cover returning to unfinished drafts, keeping legacy samples
without opening them by default, failed-save recovery, and resetting placement
without changing content or reading state. Offscreen saved automatic views are
recentered after layout changes, while valid cameras and manual positions remain
intact. Mobile readers reserve space for a two-line title at its rendered size.

The layout approach uses established hierarchy, spacing, and node-size principles
described in [D3's tree layout](https://d3js.org/d3-hierarchy/tree). Reserved lanes
are used here to keep existing positions stable as the conversation grows.
Source anchors follow the practical need to preserve critical dependencies during
context reduction; see [Anthropic's context engineering discussion](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

Actual browser paint, physical gestures, and device performance still require
visual acceptance. Automated geometry and DOM checks do not establish those.
