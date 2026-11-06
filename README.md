# MetaFor

**[Website](https://metafor.pages.dev/)** ·
[Download for Mac](https://github.com/akoudad/MetaFor/releases/download/v0.4.10/Metafor-0.4.10-arm64.dmg) ·
[Watch demo](https://youtu.be/hBM_tifGJJk)

## Architecture

MetaFor uses a shared React and TypeScript conversation engine:

- **Mac app:** Electron with native macOS helpers, on [`feat/macos-app`](https://github.com/akoudad/MetaFor/tree/feat/macos-app).
- **Web prototype:** Next.js, with server-side model requests, on `main`.
- **Website:** a standalone HTML, CSS, and JavaScript showcase in [`website/`](website/).

Chat stores topics, source references, and connections as a graph. A writer
produces the answer; an organizer assigns its sections to topics. The interface
preserves the original text and validates connections before applying changes.
Conversations save locally and can be exported as `.ingx` files.

## MetaFor Chat

Explore an answer as connected topics. Select a passage to ask a focused
question, follow its branch, and return to your reading position. The
conversation map keeps the larger structure accessible.

## MetaFor Help

Press **⌥M (Option + M)** to open a compact overlay above your current app.
Ask about the screen and receive an answer, translation, or visual pointer in
place. Continue the exchange in Chat when you want to explore further.
Help sends screen snapshots with your questions and requires Screen Recording
permission.

## Get started

The Mac app requires **Apple silicon, macOS 26+**, an internet connection, and
**your own model API key**. Move the app from the DMG into Applications, then
choose **Add API key** in the welcome guide or open **Settings** (`⌘,`).
Save your key, then use **Check connection** for the default Meta provider.
Saved chats remain readable without a key; reinstalling preserves your local data.
This preview is ad-hoc signed, not Developer ID signed or notarized. See the
[Mac app guide](https://github.com/akoudad/MetaFor/blob/feat/macos-app/docs/mac-app.md)
for installation, permissions, and source builds.

## Development

For the web prototype, use Node.js 22 and a Meta Model API key:

```sh
npm ci
cp -n .env.example .env.local
```

Set `MODEL_API_KEY` in `.env.local`, run `npm run dev`, and open
[127.0.0.1:3000](http://127.0.0.1:3000). Credentials stay on the server.

```sh
npm test
npm run typecheck
npm run build
```

[Architecture](docs/architecture.md) · [Demo](docs/demo.md) ·
[Deployment](docs/deployment.md) · [Release progress](docs/release-progress.md)
