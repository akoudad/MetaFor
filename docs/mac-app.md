# Metafor for Mac

The Mac app combines the spatial conversation view with **Help**, a small window
for asking about a selected part of your screen. It runs locally; it does not need
the web development server. Model answers require an internet connection and
your own API key.

See [verification notes](mac-verification.md) for tested workflows and remaining
macOS permission checks.

This desktop work lives in the separate `metafor-mac` worktree on
`feat/macos-app`. The web checkout and its run commands remain separate.

## Install and connect

1. Open the generated DMG and drag **Metafor** into **Applications**.
2. Open Metafor, then **Metafor → Settings…** (`⌘,`). Enter your API key.
3. The default provider is Meta, with model `muse-spark-1.3` and API base
   `https://api.meta.ai/v1`. Save settings, then ask a question in Chat.

The current packaging signs the app and its bundled helper with a local ad-hoc
signature. Hardened Runtime is disabled for this development build. It is **not
Developer ID signed or notarized**. macOS may require approval in
**System Settings → Privacy & Security** before opening it. A public distribution
build still needs signing and notarization. Do not disable Gatekeeper globally.

Chat opens before its saved key is unlocked asynchronously through macOS Keychain.
While unlocking, model requests and settings saves wait; browsing chats and
removing the saved key remain available. Removing a key does not require Keychain
access and discards any late unlock result. Status changes preserve your question
and unsaved Settings edits. If unlocking times out, Settings
shows recovery guidance and leaves the encrypted file unchanged.

If saved settings or the encrypted key cannot be read, Chat still opens and
Settings shows the recovery details. Existing files remain unchanged until you
save a replacement or remove the key. Saving model settings without a new key
does not dismiss a key recovery warning.
While model settings need recovery, Chat and Help cannot send requests. A retained
key becomes usable only after you review and save the model and API URL; it can
also be removed directly in Settings.

## Use Chat and Help

**Chat** keeps topics, passage annotations, the conversation map, and saved
reading positions. Scroll inside a topic to read; scroll in empty space to
explore its structure. Saved chats in this app are separate from browser chats.

For **Help**:

1. Open the page, document, diagram, or paused video you want to discuss.
2. Press **⌃⌥⌘M**, or choose a screen region from the Help window. The shortcut
   can be changed in Settings.
3. Allow macOS Screen Recording permission when prompted. If permission was
   changed in System Settings, quit and reopen Metafor.
4. Drag a rectangle around the content. Review the frozen crop, optionally add
   numbered marks, write your question beside it, and press **Send**.
5. Ask follow-ups there, or choose **Continue in Chat** to explore the exchange
   as topics. **Shared source** opens the original crop and its annotations.

Drawing a point, box, or arrow opens an annotation editor directly below the
crop. Write and send there; the ordinary question at the bottom keeps its own
draft. Each numbered mark has a separate question draft. Select its number to
reopen it. An annotation submission sends that mark with the selected crop,
and keeps the source visible beside the exchange.

Each new capture starts a separate Help exchange. History reopens saved Help
exchanges. **Open in Help** in Chat returns to the original Help transcript;
later Chat answers remain in Chat.
To remove a saved crop and its Help transcript, open **History**, choose its
delete control, and confirm. Text already copied into Chat remains there.
**Stop sharing** starts a fresh exchange; it does not delete saved history.
When you return to Chat after deleting its source, the source panel disappears
and a notice explains that further answers use text only.

## Bring a web conversation

In the browser app, open the conversation and choose **⋯ → Export .ingx**. In
the Mac app, use **File → Import Conversation…** (`⌘O`) and select that file.
Browser storage is not read or moved automatically; the original stays in your
browser. `.ingx` preserves the conversation, topic connections, and saved view.

Help exports also include source descriptions and visual annotation coordinates.
The screenshot attachment stays in the desktop Help store: it is **not embedded
in `.ingx`** and will not travel to a browser or another Mac with that file.
File imports open a separate conversation without attaching any locally saved
crop. Use **Continue in Chat** from the original Help exchange to retain that
source link.

## What is shared and saved

- Activating capture takes a still frame for region selection. Only the selected
  crop is sent to the configured model provider when you send a Help question.
  The request also includes your question, annotations, app/window label, and
  recent exchange context.
  The full selection frame is discarded after cropping or cancellation.
- Follow-ups in a Chat continued from Help also send that same frozen crop with
  the question. Hiding the source panel does not remove it from model context.
  The **Shared source** control keeps this visible when the panel is closed.
- Metafor does not continuously watch your screen, record audio, or click/type
  in other apps. A video source is one frame, not the video stream.
- Help transcripts and crops are saved locally after a successful answer, under
  Metafor's application data directory (`~/Library/Application Support/Metafor`
  in the packaged app). These files are not encrypted by Metafor. Chats use the
  app's local storage. There is no cloud sync.
- The API key is encrypted with Electron's macOS Keychain-backed storage. It is
  not exposed to the page renderer or included in conversation exports. Provider
  handling of submitted content is governed by that provider's policies.

## Build from source

Run these commands in the `metafor-mac` worktree. Building requires Node.js 22+,
npm, and Apple's command-line developer tools (`swiftc`). The packaged app does
not require Node.js or a terminal.

```sh
npm ci
npm run desktop:test
npm run typecheck
npm run desktop:dev
```

`desktop:dev` builds and launches Electron. To produce an Apple silicon app
folder or an installable DMG:

```sh
npm run desktop:pack
npm run desktop:dmg
```

Outputs go to `artifacts/mac/`; the app folder is
`artifacts/mac/mac-arm64/Metafor.app`. These commands currently target **arm64**.
Build and automated-test results do not by themselves verify macOS permission
prompts, capture alignment, or the installed app workflow; those need a manual
pass on the target Mac.
