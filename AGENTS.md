# Project instructions

- Keep communication and documentation concise and clear.
- Match existing indentation, naming, and formatting.
- Test changes before pushing; fix failures first.
- Use Conventional Commits with a subject no longer than 50 characters.
- Handle errors with useful messages and appropriate logging.
- Keep documentation aligned with implemented behavior.
- Validate input and keep secrets in environment variables.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
