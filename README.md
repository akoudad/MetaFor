# Metafor

Metafor combines spatial AI conversations with screen assistance in a macOS app.

## Metafor Chat

Explore a conversation as connected topics. Ask follow-up questions about a
selected passage, read related answers, and return to your previous reading
position. The model organizes answers into topics and can connect a synthesis
to its source topics.

A narrow conversation panel above **Conversation map** keeps the full exchange
available in reading order. It scrolls independently; click an answer to reveal
its section in the graph. Chats save locally. Export and import `.ingx` files to
move conversations between the browser and Mac app.

## Metafor Help

Press **⌥M (Option + M)** to open a compact bar above your current app. Ask about
your screen, select a region, or annotate a saved snapshot. Answers can include
visual pointers over the original app. Use **Continue in Chat** to explore a
Help exchange as connected topics.

Normal questions capture the current screen and send it to your configured
model. Annotations use their saved snapshot. Metafor does not continuously
watch your screen or control other apps. Help history and screenshots stay in
local storage; screenshots are not included in `.ingx` exports.

## Run the Mac app

Requires macOS, Node.js 22+, npm, and Apple's command-line developer tools
(`swiftc`). Model answers require internet access and your own API key.

```sh
npm ci
npm run desktop:dev
```

Open **Metafor → Settings…** (`⌘,`) and add your API key. Meta is the default
provider. The model chooser applies to both Chat and Help. Allow macOS Screen
Recording when using Help.

Build an Apple silicon installer with `npm run desktop:dmg`. Output is in
`artifacts/mac/`. The current build is ad-hoc signed, not Developer ID signed or
notarized. See the [Mac app guide](docs/mac-app.md) for installation, permissions,
storage, and build details.

## Run the browser app

The browser app provides Metafor Chat.

```sh
npm ci
cp -n .env.example .env.local
```

Set `MODEL_API_KEY` in `.env.local`, then run `npm run dev` and open
[127.0.0.1:3000](http://127.0.0.1:3000). The API key stays on the server.

## Verify

```sh
npm test
npm run desktop:test
npm run typecheck
npm run build
npm run desktop:build
```

[Conversation reader](docs/conversation-reader.md) ·
[Model selection](docs/model-selection.md) ·
[Architecture](docs/architecture.md) ·
[Mac verification](docs/mac-verification.md)
