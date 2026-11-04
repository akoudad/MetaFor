# metaphore

Explore an AI conversation by topic and depth. Select part of an answer, ask a
follow-up, and return to where you left off.

Live answers use Meta's Model API. Auto placement chooses whether to continue the
current topic or open a branch; you can override it. Source arrows preserve where
each branch began. Related connections are suggestions you can keep or remove.

Conversations save in your browser. Export and reopen `.ingx` files to carry the
text, connections, and navigation state with you. A prewritten sample is also
available. This is a working prototype; the interaction is still being tested.

## Run locally

Use Node.js 22:

```sh
npm ci
cp -n .env.example .env.local
```

Set `MODEL_API_KEY` in `.env.local`. The default model is `muse-spark-1.3`; the key
stays on the server. Then run:

```sh
npm run dev
```

Open [127.0.0.1:3000](http://127.0.0.1:3000). Without a key, choose the sample.

## Navigate

- Scroll over space to zoom; scroll inside an answer to read.
- Drag empty space to pan; drag a topic's handle to move it.
- Click a topic to focus. Use its outline to jump between sections.
- Pinch or use `+` / `−` to zoom, `0` for overview, and `Esc` to return.

## Check and run a production build

```sh
npm test
npm run typecheck
npm run build
npm start
```

Optional live check, against the running local app: `npx tsx scripts/live-smoke.ts`.
It makes **at most three paid model requests**.

An [example conversation](examples/browser-cache.ingx) contains a verified live
answer, passage-based branch, and clarification. Open it from the app menu.

[Product](docs/product.md) · [Architecture](docs/architecture.md) ·
[Demo](docs/demo.md) · [Deployment](docs/deployment.md)
