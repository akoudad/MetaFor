# Demo

A three-minute recording outline. Rehearse in the actual browser before recording;
live generation time varies. The localhost backend has been tested with three
live requests. Visual and public deployment checks are still pending.

## Prepare

Run the app with a configured Meta key. Choose **New chat** in the header.
For a hosted demo, enter its access code first. Keep a saved `.ingx` copy
available in case the provider is unavailable; identify it as a saved conversation
if you use it.

## Walkthrough

1. **0:00–0:20 · Show the problem.** “I want to explore one part of an answer
   without burying the rest. Metaphore keeps the discussion connected while I
   move between detail and overview.” Start on the empty chat.
2. **0:20–0:55 · Ask.** “Explain how a browser decides whether to use a cached HTTP response.
   Cover freshness, Cache-Control, ETag revalidation, and one small example.”
   While waiting: “An answer starts as one readable topic.”
3. **0:55–1:30 · Explore.** Highlight the sentence about ETag and click **Ask about this**.
   The passage appears above the focused input. Ask: “Walk me
   through ETag validation in depth, with a request and a 304 response.”
   “The model places the follow-up automatically; the app keeps the exact passage
   it came from.” If a new topic opens, let the source-to-detail movement finish
   and point out the new shape in the mini-map. Show the actual placement rather
   than claiming a fixed outcome.
4. **1:30–1:55 · Clarify and return.** Ask: “Does a 304 response include the full
   representation body? Keep it brief.” Use the parent breadcrumb or source link.
   “A short clarification can stay in its topic; the original answer is intact.”
5. **1:55–2:20 · Navigate and arrange.** At the beginning of a detail, scroll up
   to return to the parent's saved place. At its end, use **Explore topics**
   or a fresh downward gesture to revisit the detail. Use the zoom-out control
   to show the wider space, then the mini-map to focus a topic. Point out the source arrow and preserved
   original answer. Drag the topic handle, then use `⋯` → **Reset layout**.
   “Position and meaning are separate. I can arrange the space without changing
   the discussion.”
6. **2:20–2:40 · Resume.** Choose **New chat**, then **Saved chats** and reopen
   the previous discussion. Export through `⋯` → **Export .ingx**.
   “The file carries the discussion, its sources, and its navigation state.”
7. **2:40–3:00 · Explain the implementation.** “Meta's model generates structured
   answers and chooses their placement. The app validates sources and layout,
   and sends relevant context within a fixed budget.” Identify the code built
   during the event accurately. Finish on the working product.

Avoid claiming that the model browsed the web, that context is unlimited, or that
suggested connections are verified facts. The orb is an input focus control;
voice input is not part of this build.

## Repeatable backend check

With a local server running and no demo access gate:

```sh
npx tsx scripts/live-smoke.ts
```

This makes **at most three paid model requests**. It checks routing, exact source
preservation, unchanged original content, duplicate-answer protection, and `.ingx`
round-trip validity. It writes results and a demo file to a temporary directory
outside the repo. It does not test mouse, keyboard, or visual behavior.
