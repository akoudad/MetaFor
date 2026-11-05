# metafor

Explore an AI conversation by topic without losing your place.

Select a passage and click **Ask about this**. Write and send your annotation
beside the passage; your normal question draft stays separate. Read its explanation,
explore connected topics, and return to the original answer. Reading positions, drafts,
and exact passage sources are preserved. Add questions to several passages and
send them together for separate replies. On a wide screen, a focused reply opens
beside its source.

The model can keep a brief answer together, split substantial independent
subjects, reuse existing topics, or combine ideas into a new synthesis topic.
Synthesis links back to its inputs and keeps the originals. Placement is a model
decision; it is not guaranteed to match your preferred grouping.

Scroll inside a topic to read; scroll in empty space to move toward details or
back toward the overview. Choose a title when the conversation splits.
**Back** restores your previous reading place. **Conversation map** shows the
whole shape; hover a dot to see its title and click to jump. Drag topics to arrange
them, or pinch to zoom. The controls above the question input show how to return
to the parent, explore deeper topics, or resume reading from the overview.
Chats save in your browser. Export `.ingx` to carry the
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
`scripts/live-graph-smoke.ts` uses up to eight;
`scripts/live-annotation-smoke.ts` uses six. Run them with `npx tsx` against a
configured local server. See the [demo instructions](docs/demo.md).

Voice, collaboration, and cloud sync are outside this build.

## macOS app

The separate `metafor-mac` worktree adds an Electron app with the same spatial
Chat and a floating **Help** window for questions about a screen selection.
Run `npm run desktop:dev`; package an Apple silicon installer with
`npm run desktop:dmg`. Drag Metafor from the DMG into Applications and add your
API key in Settings. This local build is ad-hoc signed, not Developer ID signed or notarized.

Browser chats stay in the browser. Move them using `.ingx` export and
**File → Import Conversation**. Help sends the approved frozen crop on Send
and on follow-ups in its linked Chat; it does not continuously watch or control
your computer. Help screenshots stay in desktop storage and are not included in
`.ingx` exports. See the [Mac app guide](docs/mac-app.md) for setup, privacy,
build commands, and current limits.
