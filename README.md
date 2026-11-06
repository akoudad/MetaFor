# MetaFor

Spatial AI conversations and assistance beside your work.

[Website](https://getmetafor.akoudad-karim-contac.chatgpt.site) ·
[Download for Mac — Apple silicon](https://github.com/akoudad/MetaFor/releases/download/v0.4.8/Metafor-0.4.8-arm64.dmg)

## MetaFor Chat

Explore conversations as connected topics. Ask about a selected passage, follow
related ideas, and return to your reading position. The conversation map keeps
the structure visible. Chats save locally and can be exported as `.ingx` files.

## MetaFor Help

Press **⌥M (Option + M)** to open a compact screen assistant. Ask about your
current app, select a region, or annotate a saved snapshot. Answers can include
visual pointers over the screen. Continue an exchange in Chat to explore it
further.

Help sends screen snapshots to your configured model when you ask a question;
it does not continuously watch or control your computer. See the
[Mac app guide](https://github.com/akoudad/MetaFor/blob/feat/macos-app/docs/mac-app.md)
for setup, permissions, and storage details.

## Development

This branch contains the web prototype and website. The Mac app lives on
[`feat/macos-app`](https://github.com/akoudad/MetaFor/tree/feat/macos-app).

To run the web prototype, use Node.js 22 and a Meta Model API key:

```sh
npm ci
cp -n .env.example .env.local
```

Set `MODEL_API_KEY` in `.env.local`, then run `npm run dev` and open
[127.0.0.1:3000](http://127.0.0.1:3000). Credentials stay on the server.

```sh
npm test
npm run typecheck
npm run build
npm start
```

[Demo](docs/demo.md) · [Architecture](docs/architecture.md) ·
[Deployment](docs/deployment.md) · [Release checks](docs/hackathon.md)
