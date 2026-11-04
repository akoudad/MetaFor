# Demo

A three-minute outline, excluding live generation waits. Rehearse in the actual
browser before recording. The latest backend run passed four app requests / eight
model calls: an inline shortlist, four city topics, three existing-city
continuations, and a seven-day itinerary with four incoming synthesis edges.
Replay and `.ingx` round trips passed. Native Safari checks on the local production
build verified the imported graph's layout, synthesis source links, reading-position
restoration, section ask action and composer focus, chooser, and final overview.
Physical trackpad/touch gestures, device performance, live arrival motion, and
public deployment remain unverified.

## Prepare

Run the app with a configured Meta key and choose **New chat**. For a hosted demo,
enter its access code first. Keep a saved `.ingx` copy available and identify it
as a saved conversation if you use it instead of live generation.

Each completed question uses two sequential paid calls: writer, then organizer.
The prompts below are examples, not routing rules. Show the model's actual
placement rather than promising a particular graph.

## Walkthrough

1. **Start simply.** Ask: “What are four cities worth visiting in Morocco? Give
   me a short recommendation.” Show that a brief shortlist can stay readable in
   one topic.
2. **Explore independent subjects.** Ask for substantial details for each city,
   such as places to visit. Show separate topics if the organizer chooses them.
   New topics fan out together; the camera stops at a choice rather than entering
   an arbitrary first answer. Enter one and read it.
3. **Follow a passage.** Highlight an interesting detail and click **Ask about
   this**. Ask a focused follow-up. Show its exact source, whether the answer
   continues an existing topic or opens a deeper one. Return to the saved place.
4. **Combine ideas.** Ask for one practical itinerary comparing the cities and
   their trade-offs. If a synthesis topic is created, show its directed input
   arrows and the original topics that remain available. This is a new answer,
   not a destructive merge of the old discussions.
5. **Navigate and resume.** Read with the wheel. After reaching an edge, pause
   and continue to explore or return. Use **Explore topics** and the mini-map as
   alternatives. Drag a topic, reset the layout, then reopen the conversation
   through **Saved chats**. Export an `.ingx` copy.
6. **Explain the implementation.** “The writer creates content. The organizer
   assigns its sections to the conversation. The app checks every section is
   used exactly once, validates references, and applies the result together.”

Keep the explanation tied to what appears. Do not claim unlimited context, web
browsing, automatic conversion of old chats, or guaranteed grouping. The orb
focuses text input; voice input is outside this build.

## Repeatable backend checks

With a configured local server running and no demo access gate:

```sh
npx tsx scripts/live-smoke.ts
```

This makes up to **three app requests / six paid model calls**. It checks the
focused browser-cache workflow, source preservation, unchanged original content,
replay protection, and `.ingx` round-trip validity.

```sh
npx tsx scripts/live-graph-smoke.ts
```

This makes up to **four app requests / eight paid model calls**: a brief
recommendation, independent city details, focused follow-ups in or under their
relevant cities, and a synthesis. It checks separate destinations, input edges,
retained originals, replay protection, and file round trips. These fixture-specific
assertions test an example; they do not define the app's routing logic.

Both scripts save result JSON and `.ingx` artifacts to a temporary directory and
print its path. The graph script saves after each successful step and can resume
from that directory, avoiding repeated successful requests:

```sh
npx tsx scripts/live-graph-smoke.ts http://127.0.0.1:3000 /path/to/artifacts
```

Retries can incur additional paid calls. Neither script tests actual browser
paint, physical gestures, or device performance. See [release checks](hackathon.md)
for the current verification record.
