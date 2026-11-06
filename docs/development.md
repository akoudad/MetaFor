# Development

This checkout runs the **web prototype** and contains the static website.
For the desktop app, use the
[Mac development guide on `feat/macos-app`](https://github.com/akoudad/MetaFor/blob/feat/macos-app/docs/development.md).

## Run locally

Use Node.js 22 and a Meta Model API key:

```sh
npm ci
cp -n .env.example .env.local
```

Set `MODEL_API_KEY` in `.env.local`, then start the app:

```sh
npm run dev
```

Open [127.0.0.1:3000](http://127.0.0.1:3000).
The default model and endpoint are in [`.env.example`](../.env.example).
`MODEL_API_MODEL` and `MODEL_API_BASE_URL` override them. Keep `.env.local`
uncommitted; these variables belong on the server, without a `NEXT_PUBLIC_` prefix.
`DEMO_ACCESS_CODE` optionally protects a shared demo.

## Check changes

```sh
npm test
npm run typecheck
npm run build
```

These checks do not need a model key or make paid model calls. After building,
`node scripts/check-client-secrets.mjs` checks client assets for configured secrets.
Use `npm start` to check the production build locally.

Optional live checks require the running, configured server:
[answer flow](../scripts/live-smoke.ts), [graph flow](../scripts/live-graph-smoke.ts),
and [annotations](../scripts/live-annotation-smoke.ts). They make paid model calls
and write temporary artifacts. Backend checks do not replace trying selection,
navigation, persistence, and errors in the browser.

For static website changes, use the [website preview instructions](../website/README.md).
Read `AGENTS.md` and the relevant installed Next.js documentation before changing
application code.
