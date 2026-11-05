# Product brief

Working design · 2026-11-05

Metaphore lets you explore an idea within an AI answer and return without losing
your place. Depth represents detail. Relationships come from sources and explicit
connections, independently of where topics appear on screen.

## Current experience

1. Enter an empty black space and type beside the orb. Receive a sectioned, live
   answer from a Meta model. No prewritten job conversation opens by default.
   On submission the input clears, and the question appears in a pending card.
   The orb pulses with **Thinking…** and **Stop**, visible even if you visit
   another topic. You can write the next draft while waiting.
2. Select a passage and click **Ask about this** beside the highlight. The quote
   attaches above the question input, which receives focus without losing your
   draft. Highlighting alone does not attach it or submit anything. You can also
   use a section's ask action. A writer model produces the answer; a second
   organizer call decides how its sections fit the conversation. Brief replies
   and shortlists can stay together. Substantial independent subjects can split
   into separate topics, while an existing topic can receive further detail.
   Placement is automatic; there are no branch/continue controls to manage.
3. Follow the new topic while its source remains intact. A selected passage keeps
   its exact source. An unselected topic change retains its parent connection
   without claiming it came from an arbitrary section.
   The camera briefly reveals the source and new topic together before entering
   the answer. Several new topics fan out together and stop at a fitted choice,
   without selecting the first one for you. Reused topics stay in place.
   Navigating or typing interrupts the movement.
4. Ask to compare or combine ideas. The organizer can create one or more new
   synthesis topics with arrows from their contributing inputs. Originals remain
   available; the automatic layout places the new topic below its inputs. Grouping depends on the
   model's interpretation; no domain-specific split rules are built in.
5. Pull back from full answers to summaries and titles. Topics stay in the same
   space in a compact, stable arrangement. Focus a topic, drag it by its handle,
   or jump through the navigation rail or mini-map. **Reset layout** restores the
   automatic arrangement. Longer topics have an **In this topic** section outline.
6. Return through the path or `Esc`. Drafts, selected passages, reading positions,
   and camera views are remembered. A pending answer remains attached to the
   question's original topic, even when you navigate elsewhere.
   Stopped, failed, or interrupted questions can be retried or dismissed. Reload
   never sends a question automatically, and recovery keeps the next draft intact.
7. Use **New chat** for a different conversation and **Saved chats** to return.
   Existing content and unfinished drafts are retained. Export/import `.ingx`
   files to carry conversations between browsers. Older saved samples remain
   available in the library but are not restored automatically at startup.

Scroll inside a topic, including its header or padding, to read that topic.
Reaching its edge never leaves it. Scroll in empty space down to explore details,
or up to its parent; upward from the root opens the overview. One gesture moves
at most one level, and reading momentum cannot turn into navigation when the
pointer leaves a card.

Downward exploration opens one child directly. Several children appear as titles
in the graph: choose a title to enter, or scroll up to return. Scrolling down again
does not choose a path for you. Arrow keys move between choices and Enter opens
one. A zoomed-out topic first returns to reading before a further downward gesture
explores its children. Downward scrolling from the overview resumes the active topic.

**Back** retraces visited views and restores reading position and draft. The
breadcrumb follows ancestry, while the rail switches to another topic and
**Conversation map** shows the whole conversation. `Esc` closes an overlay first;
in a draft it leaves typing mode; otherwise it performs Back. A source link
reveals its passage without attaching it to your next question. Use selection or
**Ask about** to attach a passage.

Ordinary topic navigation shows one reader. Following a passage reply can keep
its source alongside it when there is room. Returning preserves a passage
halfway through a long answer, independently of related and synthesis links.
A choice shown after an answer may also list several affected topics from
different parts of the conversation.

Drag empty space to pan; click a topic to focus. Pinch, Ctrl-wheel, and `+` / `−`
still control visual zoom; `0` shows the overview. The left rail and mini-map
provide direct jumps when you want a different path.

On touchscreens, swipe inside the answer to read and use **Explore topics**,
topic titles, source links, or **Back** to move between topics.

**Conversation map** shows the conversation's spatial shape and highlights the
active topic. Hover or keyboard-focus a dot to preview its title, then select it
to jump there. Its diamond marks the camera destination. The space stays monochrome,
with a softly colored input orb, a star cursor, and a slowly drifting starfield.
Text keeps its normal selection cursor. Reduced motion disables the ambient
movement and the arrival journey.

The selection action stays within the visible reading area. Escape, an outside
click, scrolling, or navigation dismisses it; Escape here does not leave the
topic. The attached quote remains removable before sending.

The **Connections** panel separates suggested relationships from those you keep.
Use **Include in next question** to explicitly add another topic's context.
Keeping a visual connection does not automatically include all its text.

## Current limits

Each completed answer normally uses two paid model calls. The organizer assigns
validated sections; it does not guarantee the grouping you would have chosen.
Existing saved answers keep their structure rather than being converted
retroactively. A response can add up to eight separate topic outputs.

Context is bounded to 60,000 characters, with excerpts from up to eight direct
children of the active topic in addition to prioritized context. Some material
is summarized or shortened; source links do not imply every word was included.

Answers arrive whole after a pending state; there is no text streaming. The model
has no browsing or retrieval tools. Voice, collaboration, accounts, and GPTea
integration are outside this build.

Storage belongs to this browser and site address, with no cloud sync. Live
questions send conversation data to the app server, which selects context for
the model. Export files contain readable conversation content; they are not
encrypted backups.

## Release checks

The latest localhost check passed four app requests / eight model calls. It kept
a shortlist inline, created four city topics, continued three relevant existing
city topics independently, then created a seven-day itinerary with four incoming
synthesis edges. Replay and `.ingx` round trips passed. These examples test general
behavior; they are not hardcoded rules about cities or histories.

Automated tests cover section partitioning, atomic multi-topic application,
synthesis references, selection, navigation, and recovery. Earlier native Safari checks
on the local production build verified the imported graph's four-city layout,
synthesis and source links, exact reading-position restoration, the section ask
action and composer focus, the former topic chooser, and the compact final overview.
The current direct graph choice and pointer-owned scrolling update requires its
own verification; see the [experience review](experience-review.md).
Physical trackpad/touch gestures, device performance, live arrival motion, and
public deployment remain unverified.

See the [acceptance checklist](hackathon.md) and [demo](demo.md).

## Passage annotations

Select text, choose **Ask about this**, and write a question. Selecting a second
passage queues the first question; **Add another annotation** provides an explicit
alternative. Edit or remove queued questions, then send up to six together. Each
question retains its own source and receives a separate answer destination.
On wide screens, a chosen source-linked reply sits beside its source. Smaller
screens focus the reply with a source return link. Existing answers remain intact.
