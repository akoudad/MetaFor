import { useLayoutEffect, useMemo, useState } from "react";
import ConversationSpace from "../../src/components/ConversationSpace";
import type { DesktopChatBridge } from "../../src/components/ConversationSpace";
import { loadSnapshot, parseSnapshot } from "../../src/lib/storage";
import { mergeHelpSnapshotFromArchive } from "../chat-transfer";
import SharedSource from "./SharedSource";
import ModelSelector from "./ModelSelector";
import { installDesktopFetch } from "../chat-fetch";
import "../../src/app/globals.css";
import "./chat.css";

export default function Chat() {
  const bridge = window.metaforDesktop;
  const [conversationId, setConversationId] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [sourceRevision, setSourceRevision] = useState(0);
  const [apiReady, setAPIReady] = useState(false);
  useLayoutEffect(() => {
    const restore = installDesktopFetch(bridge);
    setAPIReady(true);
    return restore;
  }, [bridge]);
  const desktop = useMemo<DesktopChatBridge>(() => ({
    onOpenConversation: (callback) => {
      const unsubscribe = bridge.onOpenConversation((content) => { callback(content); setSourceRevision((value) => value + 1); });
      void bridge.ready().catch((error) => setSourceError(error instanceof Error ? error.message : "The desktop connection is unavailable."));
      return unsubscribe;
    },
    prepareImport: async (content) => {
      const incoming = parseSnapshot(content);
      if (!incoming.conversation.id.startsWith("help-")) {
        incoming.conversation.id = `space-${crypto.randomUUID()}`;
        incoming.savedAt = new Date().toISOString();
        return incoming;
      }
      return mergeHelpSnapshotFromArchive(await loadSnapshot(incoming.conversation.id), incoming, (id) => bridge.getHelp(id));
    },
    onConversationChanged: setConversationId,
    renderModelSelector: (busy) => <ModelSelector disabled={busy} />,
    openHelp: () => { void bridge.openHelp().catch((error) => setSourceError(error instanceof Error ? error.message : "Could not open Help.")); },
    openSettings: () => { void bridge.openSettings().catch((error) => setSourceError(error instanceof Error ? error.message : "Could not open Settings.")); },
  }), [bridge]);

  return <div className={`desktop-chat${showSource ? " with-source" : ""}`}>
    {apiReady && <ConversationSpace desktop={desktop} />}
    <SharedSource bridge={bridge} conversationId={conversationId} revision={sourceRevision} onVisibilityChange={setShowSource} />
    {sourceError && <div className="desktop-source-error" role="alert">{sourceError}<button onClick={() => setSourceError("")} aria-label="Dismiss desktop error">×</button></div>}
  </div>;
}
