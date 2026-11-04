# Product brief

Working design · 2026-11-04

Metaphore lets you explore an idea within an AI answer and return without losing
your place. Depth represents detail. Relationships come from sources and explicit
connections, independently of where topics appear on screen.

## Current experience

1. Enter an empty black space and type beside the orb. Receive a sectioned, live
   answer from a Meta model. No prewritten job conversation opens by default.
   On submission the input clears, and the question appears in a pending card.
   You can write the next draft while waiting.
2. Select a passage and click **Ask about this** beside the highlight. The quote
   attaches above the question input, which receives focus without losing your
   draft. Highlighting alone does not attach it or submit anything. You can also
   use a section's ask action. The model keeps a clarification
   in the current topic or opens a connected topic for a separate exploration.
   Placement is automatic; there are no branch/continue controls to manage.
3. Follow the new topic while its source remains intact. A selected passage keeps
   its exact source. An unselected topic change retains its parent connection
   without claiming it came from an arbitrary section.
   The camera briefly reveals the source and new topic together before entering
   the answer. Navigating or typing interrupts the movement.
4. Pull back from full answers to summaries and titles. Topics stay in the same
   space. Focus a topic, drag it by its handle, or jump through the navigation
   rail or mini-map. **Reset layout** restores the automatic arrangement. Longer topics have
   an **In this topic** section outline.
5. Return through the path or `Esc`. Drafts, selected passages, reading positions,
   and camera views are remembered. A pending answer remains attached to the
   question's original topic, even when you navigate elsewhere.
   Stopped, failed, or interrupted questions can be retried or dismissed. Reload
   never sends a question automatically, and recovery keeps the next draft intact.
6. Use **New chat** for a different conversation and **Saved chats** to return.
   Existing content and unfinished drafts are retained. Export/import `.ingx`
   files to carry conversations between browsers. Older saved samples remain
   available in the library but are not restored automatically at startup.

Scroll over space to zoom and inside an answer to read. Drag empty space to pan;
click a topic to focus. Pinch and `+` / `−` zoom; `0` shows the overview. The left
rail supports arrow keys and Enter. These controls remain a working design.

The mini-map shows the conversation's spatial shape and highlights the active
topic. Its diamond marks the camera destination. The space stays monochrome,
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

Answers arrive whole after a pending state; there is no text streaming. The model
has no browsing or retrieval tools. Voice, collaboration, accounts, and GPTea
integration are outside this build.

Storage belongs to this browser and site address, with no cloud sync. Live
questions send conversation data to the app server, which selects context for
the model. Export files contain readable conversation content; they are not
encrypted backups.

## Release checks

The revised localhost backend completed three live requests using automatic
placement throughout: an initial answer, a deeper topic from a selected passage,
then a short clarification in that topic. React DOM integration
tests cover selection, placement, navigation, and recovery. Actual browser
visuals and gestures remain unverified because
the automation bridge was unavailable. No public deployment has been verified.

See the [acceptance checklist](hackathon.md) and [demo](demo.md).
