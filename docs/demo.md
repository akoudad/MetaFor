# Demo

A roughly 90-second walkthrough; live generation time varies. Rehearse on the
actual browser before recording. The localhost backend has been tested with three
live requests; visual and public deployment checks are still pending.

## Prepare

Run the app with a configured Meta key. Start a new conversation from the `⋯`
menu. For a hosted demo, enter its access code first. Keep a saved `.ingx` copy
available in case the provider is unavailable; identify it as a saved conversation
if you use it.

## Walkthrough

1. **Ask.** “Explain how a browser decides whether to use a cached HTTP response.
   Cover freshness, Cache-Control, ETag revalidation, and one small example.”
   While waiting: “An answer starts as one readable topic.”
2. **Select.** Highlight the sentence about ETag. Ask: “Explore this in a separate,
   deeper topic. Show an ETag request and a 304 response.” Leave placement on
   **Auto**. “This follow-up keeps the passage it came from.”
3. **Continue.** In that branch, choose **Continue here** and ask: “Does a 304
   response include the full representation body? Keep it brief.” Show that the
   clarification stays in the branch.
4. **Return.** Use the parent breadcrumb. Pull back with the wheel over empty
   space, then focus the branch again. Point out the source arrow and preserved
   original answer. Drag the topic handle to show that position does not change
   the relationship.
5. **Resume.** Wait for the saved indicator, then reload. Optionally open `⋯` →
   **Export .ingx**. “The file carries the discussion and its navigation state.”

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
