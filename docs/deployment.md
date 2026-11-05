# Deployment

The local production build has been checked in native Safari; public deployment
remains unverified. These are setup instructions, and publication remains a separate
step. The app needs a Node.js server because live AI uses `/api/answer`.

## Configuration

Use Node.js 22 and the included lockfile. Set these **server** environment
variables in the hosting platform; do not prefix them with `NEXT_PUBLIC_`:

| Variable | Value |
| --- | --- |
| `MODEL_API_KEY` | Your Meta Model API key. |
| `MODEL_API_BASE_URL` | `https://api.meta.ai/v1` (default). |
| `MODEL_API_MODEL` | `muse-spark-1.3` (default). |
| `DEMO_ACCESS_CODE` | A private shared code for a public demo. |

For local development, copy `.env.example` to `.env.local`. Never commit that
file or bake it into a container image. Next.js keeps variables without the
public prefix on the server. [Environment variables](https://nextjs.org/docs/app/guides/environment-variables).

## Node server

```sh
npm ci
npm test
npm run typecheck
npm run build
npm start
```

`npm start` binds to `127.0.0.1:3000`, suitable behind a local reverse proxy. If
the host requires listening on all interfaces, use:

```sh
npx next start --hostname 0.0.0.0
```

Set `PORT` through the host if needed. Use HTTPS at the proxy and preserve the
public `Host` and overwrite `x-forwarded-proto` with the actual public scheme;
the API checks request origin and does not trust a forwarded host header.
Allow at least 60 seconds for the answer route. Upload, answer writing, and
organization share a 55-second route deadline; upload also has a 10-second
limit. The two model calls run sequentially, and cancellation aborts the active
call. The app returns only after both stages validate.
See [Next.js deployment](https://nextjs.org/docs/app/getting-started/deploying)
and [CLI options](https://nextjs.org/docs/app/api-reference/cli/next).

## Docker

No Dockerfile is included yet. Use a Node.js 22 image, install with `npm ci`, and
run `npm run build` during the image build. Run the built app as a non-root user
with `next start --hostname 0.0.0.0`, exposing port 3000. Inject the variables
above at runtime. Exclude `.env*`, `.git`, `node_modules`, and `.next` from the
build context; install and build inside the image instead.

For a smaller image, adapt the official
[Next.js container example](https://docs.docker.com/guides/nextjs/); its standalone
output requires a matching Next.js configuration. Test the resulting image
before publishing it.

The included GitHub Actions workflow runs tests, type checks, and a build after
pushes and pull requests. It does not need a model key or make paid model calls.

## Vercel

Import the repository with the Next.js framework preset. Select Node.js **22.x**
in project settings, add the server variables to the intended deployment
environment, and use `npm run build`. Vercel runs the server routes; no custom
start command is required. Check that the function duration supports the answer
route before sharing the URL. See
[Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs) and
[Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

## Public demo limits

Set `DEMO_ACCESS_CODE` before exposing live generation. Configure provider and
hosting spending controls and monitor usage. The app's in-memory limits are
best effort per server instance: one in-flight request per IP, three overall,
ten requests per IP per minute, and thirty overall. They reset on restart and
do not coordinate across instances. Limits count app requests; each completed
answer normally uses **two paid model calls**, and retries can repeat both. They
are **not a billing cap**.

There are no user accounts or cloud conversation storage. Saved spaces belong
to the current browser and site origin; moving from localhost to a hosted URL
requires export/import. Live requests send the conversation snapshot to the
server and selected context to Meta. This is not an offline-only privacy model.

The optional backend checks use the already configured server:

```sh
npx tsx scripts/live-smoke.ts
npx tsx scripts/live-graph-smoke.ts
```

Run these deliberately: the first makes up to three app requests / six paid
model calls; the second makes up to four app requests / eight paid model calls.
They write temporary artifacts, and the graph check supports resuming successful
steps. See the [demo instructions](demo.md) before running either.

Before sharing, run the [demo](demo.md) on the deployed URL: check a live answer,
passage selection, return navigation, reload, export/import, access-code rejection,
and readable failure states. Keep the [release checklist](hackathon.md) current.
