# Mac app reference

For installation, start with the [quick start](mac-app.md). This optional
reference covers settings, Help, saved screen context, storage, and recovery.
For build commands, see [development](development.md).

## Settings and recovery


1. Open the generated DMG and drag **MetaFor** into **Applications**.
2. Open MetaFor. The first-open guide introduces Chat, Help, and the **Option + M**
   shortcut. Choose **Add API key** and enter your own API key. Settings remains
   available from **Settings…** (`⌘,`).
3. The default provider is Meta, with model `muse-spark-1.3` and API base
   `https://api.meta.ai/v1`. Save settings, then choose **Check connection** to
   verify API access and selected-model availability. Choose **Done** to use Chat.
   The chooser below the prompt switches the model and reasoning level for both
   Chat and Help. **Balanced** is the default; see [model choices](model-selection.md).

Without a saved API key, setup opens prominently. Empty keys are rejected.
**Browse saved chats** (or close Settings) keeps existing content accessible and
leaves an **Add API key** reminder; AI requests still require a key. Relaunching
without a key reopens setup. Saving confirms local storage, not provider access.
**Check connection** verifies the saved Meta key through the model-list endpoint
and reports rejected credentials or unavailable models. Custom providers are
checked when you ask a question. No connection check sends conversation content.
Accounts with a
saved key can choose **Get started**; **Quick start…** opens the guide
again. Guide completion is stored
in `onboarding.json` in the app's user-data directory, separately from settings,
credentials, and conversation history. If saving fails, retry or choose **Close
for now** (or **Continue to setup** when a key is required). The guide appears
inside Chat and never opens Chat when Help is active.
Existing settings or Keychain recovery messages take priority over the guide.

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
An unused Mac profile starts with no conversations or Help history. Reinstalling
the app preserves that Mac's existing chats in
`~/Library/Application Support/Metafor`; the installer contains no user profile,
saved chats, or API keys.

For **Help**:

1. Open the website, document, diagram, or video you want to discuss.
2. Press **⌥M (Option + M)**. Help reads the current display automatically and
   opens a small orb and prompt at the bottom center. Change the shortcut in
   Settings if another app uses it. Settings reports an unavailable shortcut,
   including conflicts detected at launch; File → Use Current Screen still works.
   Press it again to hide Help and its highlights. Dismissal also cancels an
   unfinished capture, so it cannot reopen the bar afterward.
3. Allow macOS Screen Recording and the first-use screen-sharing disclosure.
   If permission changes in System Settings, quit and reopen MetaFor.
4. Ask your question and press **Send**. No selection or manual screenshot is
   required. Normal questions refresh the screen in the background.
5. The answer opens above the prompt. When useful, pointers and labels appear
   directly over your original app; clicks pass through them. They clear after
   12 seconds, on another capture, or when Help closes. The saved answer stays
   available. **Show on screen** displays its pointers again if the source still
   matches. MetaFor gives directions; you perform any clicks.
6. Ask follow-ups, or **Continue in Chat** to explore the exchange as topics.
   Help keeps the full Chat window hidden until you explicitly open Chat.

The normal bar contains no screenshot preview. It shows the latest answer in a
compact, scrollable panel. **Expand answer** gives longer explanations more room;
**Show question** or **Earlier messages** reveals the exchange. Reading controls
and **Continue in MetaFor Chat** stay reachable while scrolling. The screen-sharing
explanation appears during first use rather than below every prompt.

Highlights have a cyan edge, dark outline, and soft glow to stand out on light
and dark pages. Their interiors stay transparent. Help moves to an available
position away from marked targets, and pointer labels adjust around it. On a
crowded screen, complete separation may be impossible; **Compact answer** or
**Hide answer** frees more space. Concise explanations or translated phrases can
appear beside their source elements when the screen still matches.

**History → Inspect source**, or **View source** on a saved answer, opens its
saved frame explicitly. This optional inspection contains the **This snapshot**
control for asking about an older view. A point, box, or arrow on that image opens an
annotation editor beside it. Each mark keeps its own draft, separate from the
ordinary question. An annotation always uses its original snapshot, even when
later questions have refreshed the screen. **View source** returns to that exact
frame. Previewing another frame preserves unfinished annotation drafts.

Each new capture starts a separate Help exchange. History reopens saved Help
exchanges. **Open in Help** in Chat returns to the original Help transcript;
later Chat answers remain in Chat.
An unreadable saved exchange is labeled in History while other exchanges remain
available. Its file stays unchanged unless you confirm deletion.
To remove saved snapshots and their Help transcript, open **History**, choose its
delete control, and confirm. Text already copied into Chat remains there.
**Stop sharing** starts a fresh exchange; it does not delete saved history.
When you return to Chat after deleting its source, the source panel disappears
and a notice explains that further answers use text only.

## Bring a web conversation

In the browser app, open the conversation and choose **⋯ → Export .ingx**. In
the Mac app, use **File → Import Conversation…** (`⌘O`) and select that file.
Browser storage is not read or moved automatically; the original stays in your
browser. `.ingx` preserves the conversation, topic connections, and saved view.

Help continues in Chat as readable questions and answers. **Shared source**
keeps the original images and marks available, and follow-ups receive their
matching saved context. New `.ingx` exports contain the transcript and stable
message IDs; captured images, source metadata, and visual marks stay in the
desktop Help store and do not travel to a browser or another Mac with that file.
File imports open a separate conversation without attaching any locally saved
screen context. Use **Continue in Chat** from the original Help exchange to retain that
source link.

## What is shared and saved

- The shortcut captures one display locally. Sending a normal question refreshes
  that display and sends the frame to the configured model with your question.
  The request can include up to two recent prior frames from this exchange for
  follow-ups, limited to 8 MiB of prior images. Each turn records its source.
  An unsent capture is kept in memory only. Optional region selection discards
  the full frame and shares just that crop.
- Chat continued from Help uses saved screen context rather than capturing again.
  Hiding the source panel does not remove that context from model requests.
  **Shared source** identifies the attachment when the panel is closed.
- MetaFor does not continuously watch your screen, record audio, or click/type
  in other apps. A video source is one frame, not the video stream.
- Before placing pointers, MetaFor checks a fresh frame locally against the
  target and nearby content in their saved source. A compact moving area elsewhere
  can be tolerated; broad changes or large animations can suppress pointers.
  This check is not sent to the model. A changed target keeps the text answer
  and asks for a new question to locate it again. While guidance is visible,
  a read-only native observer dismisses it on external clicks, scrolling, or
  application changes. Marks also expire after 12 seconds. This is not continuous
  tracking: video or automatic page changes can move content before expiry.
- Help transcripts and snapshots are saved locally after a successful answer, under
  MetaFor's application data directory (`~/Library/Application Support/Metafor`
  in the packaged app). These files are not encrypted by MetaFor. Chats use the
  app's local storage. There is no cloud sync.
- Each Help exchange has a 16 MiB local archive limit. Snapshots are stored once,
  with each turn retaining its source reference. Before sending a question,
  MetaFor checks the archive and reserves room for the reply. A full exchange
  asks you to start a new one; it does not send the question or discard history.
  Existing saved exchanges remain readable.
- The API key is encrypted with Electron's macOS Keychain-backed storage. It is
  not exposed to the page renderer or included in conversation exports. Provider
  handling of submitted content is governed by that provider's policies.

