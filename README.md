# Metaphore

Explore any part of an AI answer and return without losing your place.

A useful answer often opens several directions. Following one can bury the rest
of the discussion. Metaphore keeps those directions connected: select a passage,
ask about it, explore the detail, and return to the original answer.

[Demo walkthrough](docs/demo.md) · [Architecture](docs/architecture.md) ·
[Run and deploy](docs/deployment.md)

## The experience

- **Ask naturally.** Start with an empty chat. The AI decides whether a follow-up
  belongs in the current topic or needs its own connected space.
- **Explore a passage.** Select text in any answer and click **Ask about this**
  beside it. The quote attaches to your question and keeps its exact source.
- **Move between levels.** Scroll to read, then continue past the end to explore
  a topic's children. Choose a path when there are several. Scroll up at the
  beginning to return, with your reading position and draft preserved.
- **Arrange your space.** Drag topics into place. Reset layout restores their
  automatic arrangement without changing the conversation.
- **Come back later.** Chats save locally and remain available under Saved chats.
  Export an `.ingx` file to keep the text, connections, and view state together.

New topics emerge from their source before the camera moves into the answer.
You can interrupt that movement by navigating or typing.

## How Meta AI is used

The server asks Meta's `muse-spark-1.3` for an answer and a placement decision in
one structured response. Context follows the selected passage and its connected
topics, with bounded excerpts and summaries for longer conversations.

The app validates the response and assigns IDs, sources, and positions. Moving
a topic changes its location, not what it is connected to. API credentials stay
on the server.

Built with Next.js, React, TypeScript, and Three.js projection. Answers remain
selectable HTML; the starfield uses a separate canvas. See the
[architecture](docs/architecture.md) for context selection, persistence, and
the versioned `.ingx` format.

## Run locally

Requires Node.js 22 and a Meta Model API key.

```sh
npm ci
cp -n .env.example .env.local
```

Set `MODEL_API_KEY` in `.env.local`, then:

```sh
npm run dev
```

Open [127.0.0.1:3000](http://127.0.0.1:3000). For a saved example instead of a live
request, import [browser-cache.ingx](examples/browser-cache.ingx) from the menu.

## Verify

```sh
npm test
npm run typecheck
npm run build
```

[GitHub checks](https://github.com/akoudad/metaphore/actions/workflows/checks.yml)
run the same commands. The optional `npx tsx scripts/live-smoke.ts` exercises
the local API with at most three paid model requests.

This hackathon build has local storage and file export. Voice, cloud sync, and
collaboration are outside its current scope. See the
[release checks](docs/hackathon.md) for verified behavior and remaining work.
