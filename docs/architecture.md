# Architecture

MetaFor has three parts:

| Part | Implementation |
| --- | --- |
| Mac app | Electron with native macOS helpers, on [`feat/macos-app`](https://github.com/akoudad/MetaFor/tree/feat/macos-app). |
| Web prototype | Next.js with a React and TypeScript interface, on `main`. |
| Public website | Static HTML, CSS, and JavaScript in [`website/`](../website/README.md). |

## Conversation flow

In the web prototype, the interface sends a question and conversation snapshot
to `/api/answer`. The server selects bounded context, calls an answer writer,
then calls an organizer to place the answer's sections into topics.

The organizer assigns sections; it does not rewrite their text. The app validates
references and section coverage before applying the result together. A completed
answer normally uses two model calls. Grouping remains a model judgment.

[Provider](../src/lib/provider.ts) · [Context](../src/lib/ai.ts) ·
[Organizer](../src/lib/organizer.ts)

## State and rendering

A conversation contains topics, messages, exact passage references, and connections.
Each topic has one navigation parent; related and synthesis links form a separate
graph. React renders selectable HTML text and SVG connections using a Three.js
camera for projection.

The web prototype saves conversations and reading state in IndexedDB, with a
localStorage fallback. `.ingx` exports contain readable conversation data. Storage
belongs to the browser and site address; there is no cloud sync or cross-tab merge.

Web API keys stay in server environment variables. Live questions send selected
context to the model provider. Mac Help also sends screen snapshots with questions;
see the [Mac guide](https://github.com/akoudad/MetaFor/blob/feat/macos-app/docs/mac-app.md).
