# Metaphore

Explore an AI conversation by topic without losing your place.

Select a passage and click **Ask about this**. Read its explanation, explore
connected topics, and return to the original answer. Reading positions, drafts,
and exact passage sources are preserved.

The model can keep a brief answer together, split substantial independent
subjects, reuse existing topics, or combine ideas into a new synthesis topic.
Synthesis links back to its inputs and keeps the originals. Placement is a model
decision; it is not guaranteed to match your preferred grouping.

Scroll to read and continue through connected topics. Choose a path when there
are several. Drag topics to arrange them; pinch or use the zoom controls to see
the wider space. Chats save in your browser. Export `.ingx` to carry the
conversation, connections, and view state together.

[Demo](docs/demo.md) · [Architecture](docs/architecture.md) ·
[Deployment](docs/deployment.md) · [Release checks](docs/hackathon.md)

## Run locally

Requires Node.js 22 and a Meta Model API key.

```sh
npm ci
cp -n .env.example .env.local
```

Set `MODEL_API_KEY` in `.env.local`, then run `npm run dev` and open
[127.0.0.1:3000](http://127.0.0.1:3000).

Each answer uses two sequential `muse-spark-1.3` calls: a writer produces content,
then an organizer assigns its sections to topics. The app validates the plan
before changing the conversation. Credentials stay on the server.

## Verify

```sh
npm test
npm run typecheck
npm run build
npm start
```

Optional live checks make paid calls: `scripts/live-smoke.ts` uses up to six;
`scripts/live-graph-smoke.ts` uses up to eight. Run them with `npx tsx` against a
configured local server. See the [demo instructions](docs/demo.md).

Voice, collaboration, and cloud sync are outside this build.
