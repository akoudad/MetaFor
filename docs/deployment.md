# Deployment

## Public website

[metafor.pages.dev](https://metafor.pages.dev/) serves the static files in
[`website/`](../website/README.md) through Cloudflare Pages. It links to the Mac
installer and does not run the AI backend or receive API keys.

Preview and check the page before uploading the contents of `website/`, including
`_redirects`. There is no build step. `/download` redirects to the current GitHub
Release installer; update that rule when publishing a new version. Keep the
previous release available for rollback. The old Sites address remains a mirror
with a link to the new address.

## Web prototype

The Next.js prototype is separate and needs a Node.js 22 server. Its public
deployment has not been verified. Follow [development setup](development.md),
then run `npm run build` and `npm start`.

The start script binds to `127.0.0.1:3000`. A host that needs all interfaces can
use `npx next start --hostname 0.0.0.0`. Use HTTPS and configure the reverse proxy
to preserve `Host` and overwrite `x-forwarded-proto` with the public scheme.
Allow at least 60 seconds for `/api/answer`.

Keep model credentials in server environment variables. Set `DEMO_ACCESS_CODE`
before sharing live generation. Configure provider spending controls: in-memory
request limits are per server instance and are not a billing cap. Each completed
answer normally uses two paid model calls.

Verify generation, errors, saved chats, and export/import on the deployed URL.
Browser storage belongs to its site address; use exports when moving between hosts.
