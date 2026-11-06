# Development

Use the `feat/macos-app` branch. For the downloadable app, use the
[installation guide](mac-app.md).

## Run the Mac app

Requires macOS, Node.js 22+, npm, and Apple’s command-line developer tools
(`swiftc`). Model answers need internet access and your own API key.

```sh
git clone --branch feat/macos-app https://github.com/akoudad/MetaFor.git
cd MetaFor
npm ci
npm run desktop:dev
```

`desktop:dev` builds and launches Electron. Add your key in Settings (`⌘,`).
Meta is the default provider; the model chooser applies to Chat and Help.

## Run the browser app

The browser app provides MetaFor Chat. Its API key stays on the server.

```sh
npm ci
cp -n .env.example .env.local
```

Set `MODEL_API_KEY` in `.env.local`, then run `npm run dev` and open
[127.0.0.1:3000](http://127.0.0.1:3000).

## Verify

```sh
npm test
npm run desktop:test
npm run typecheck
npm run build
npm run desktop:build
```

See [Mac verification](mac-verification.md) for tested workflows and remaining
native checks. Builds and automated tests do not verify macOS permission
prompts, capture alignment, or the installed workflow; check those on the target Mac.

## Package for Apple silicon

```sh
npm run desktop:pack
npm run desktop:dmg
```

Both commands build first and target **arm64**. Outputs go to `artifacts/mac/`;
the app folder is `artifacts/mac/mac-arm64/Metafor.app`.

The current build signs the app and bundled helpers locally with an ad-hoc
signature. Hardened Runtime is disabled. Public distribution still needs
Developer ID signing and notarization.

[Architecture](architecture.md) · [Native helpers](../desktop/native/README.md) · [Documentation](README.md)
