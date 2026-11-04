# Product brief

Working design · 2026-11-04

Metaphore lets you explore an idea within an AI answer and return without losing
your place. Depth represents detail. Relationships come from sources and explicit
connections, independently of where topics appear on screen.

## Current experience

1. Enter a black space and type beside the orb. Receive a sectioned, live answer
   from a Meta model. A labeled, prewritten sample is available separately.
2. Select a passage or a section and ask about it. **Auto** chooses a continuation
   for a clarification or a branch for a separate exploration. Selection alone
   does not force a branch. Choose **Continue here** or **New branch** to override.
3. Follow a branch while its source remains intact. Arrows retain the origin;
   the latest answer's placement can be changed before continuing the discussion.
4. Pull back from full answers to summaries and titles. Topics stay in the same
   space. Focus a topic, drag it by its handle, or jump through the navigation
   rail. Longer topics have an **In this topic** section outline.
5. Return through the path or `Esc`. Drafts, selected passages, reading positions,
   and camera views are remembered. A pending answer remains attached to the
   question's original topic, even when you navigate elsewhere.
6. Resume from the local saved library, or export/import an `.ingx` file. Starting
   or importing another conversation keeps existing saved spaces.

Scroll over space to zoom and inside an answer to read. Drag empty space to pan;
click a topic to focus. Pinch and `+` / `−` zoom; `0` shows the overview. The left
rail supports arrow keys and Enter. These controls remain a working design.

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

The localhost backend completed three live requests: an initial answer, an
automatic branch from a selected passage, and a forced continuation. Thirteen React DOM integration tests cover selection, placement, navigation,
and recovery. Actual browser visuals and gestures remain unverified because
the automation bridge was unavailable. No public deployment has been verified.

See the [acceptance checklist](hackathon.md) and [demo](demo.md).
