import { useEffect, useId, useState } from "react";
import type { DesktopBridge, HelpSession } from "../shared";

type Props = {
  bridge: Pick<DesktopBridge, "getHelp" | "onHelpSession" | "resumeHelp" | "openHelp">;
  conversationId: string;
  revision: number;
  onVisibilityChange: (visible: boolean) => void;
};

export default function SharedSource({ bridge, conversationId, revision, onVisibilityChange }: Props) {
  const [source, setSource] = useState<HelpSession | null>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [markMessage, setMarkMessage] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const arrowId = useId();

  useEffect(() => {
    const refreshSource = () => setRefresh((value) => value + 1);
    const becameVisible = () => { if (document.visibilityState === "visible") refreshSource(); };
    window.addEventListener("focus", refreshSource);
    document.addEventListener("visibilitychange", becameVisible);
    const unsubscribe = bridge.onHelpSession(refreshSource);
    return () => {
      window.removeEventListener("focus", refreshSource);
      document.removeEventListener("visibilitychange", becameVisible);
      unsubscribe();
    };
  }, [bridge]);

  useEffect(() => {
    setSource(null); setVisible(false); setError(""); setMarkMessage(null); setLoading(false);
  }, [conversationId]);

  useEffect(() => { onVisibilityChange(visible); }, [visible, onVisibilityChange]);

  useEffect(() => {
    let cancelled = false;
    if (!conversationId.startsWith("help-")) return;
    setLoading(true); setError("");
    bridge.getHelp(conversationId).then((session) => {
      if (cancelled) return;
      setSource(session);
      if (!session?.source) {
        setVisible(false);
        setError("The saved screen selection is unavailable. This chat will continue using text only.");
      }
      const marked = session?.messages.filter((message) => message.sourceId || message.marks?.length) ?? [];
      setMarkMessage((previous) => previous !== null && (previous === "" || marked.some((message) => message.id === previous)) ? previous : marked.at(-1)?.id ?? "");
    }).catch((failure) => {
      if (!cancelled) {
        setSource(null); setVisible(false);
        setError(failure instanceof Error ? failure.message : "The original source could not be opened.");
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bridge, conversationId, revision, refresh]);

  const markedMessages = source?.messages.filter((message) => message.sourceId || message.marks?.length) ?? [];
  const selectedMessage = markedMessages.find((message) => message.id === markMessage);
  const image = selectedMessage?.sourceId ? [source?.source, ...(source?.sources ?? [])].find((item) => item?.id === selectedMessage.sourceId) : source?.source;
  const safeImage = image && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image.image) ? image.image : null;
  const marks = selectedMessage?.marks ?? [];
  const markerSize = image ? Math.max(image.width, image.height) * 0.025 : 20;
  return <>
    {(image || loading) && <div className="desktop-source-control">
      <button className="desktop-source-toggle" onClick={() => setVisible((value) => !value)} aria-expanded={visible} disabled={loading && !image}>{loading && !image ? "Opening source…" : "Shared source"}</button>
      {image && <span>Saved screen context</span>}
    </div>}
    {error && <div className="desktop-source-error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss source error">×</button></div>}
    {visible && source && image && <aside className="desktop-source-panel" aria-label="Original shared source">
      <header><span>Shared source</span><button onClick={() => setVisible(false)} aria-label="Close shared source">×</button></header>
      <h2>{image.title || image.appName}</h2>
      <p>{image.appName} · {new Date(image.capturedAt).toLocaleString()}</p>
      {markedMessages.length > 0 && <label className="source-marks-picker">Source and annotations<select value={markMessage ?? ""} onChange={(event) => setMarkMessage(event.target.value)}><option value="">Latest snapshot</option>{markedMessages.map((message, index) => <option key={message.id} value={message.id}>{index + 1}. {message.role === "user" ? "You" : "Metafor"}: {message.text.slice(0, 65)}</option>)}</select></label>}
      {safeImage ? <div className="source-image-wrap"><img src={safeImage} alt={`Screen selection from ${image.appName}: ${image.title}`} />{marks.length > 0 && <svg viewBox={`0 0 ${image.width} ${image.height}`} role="img" aria-label="Annotations on the shared source"><defs><marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth={markerSize} markerHeight={markerSize} orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#a7d5e6" /></marker></defs>{marks.map((mark) => mark.kind === "rect" ? <rect key={mark.id} x={mark.x * image.width} y={mark.y * image.height} width={mark.width * image.width} height={mark.height * image.height} /> : mark.kind === "arrow" ? <line key={mark.id} x1={mark.x * image.width} y1={mark.y * image.height} x2={(mark.x + mark.width) * image.width} y2={(mark.y + mark.height) * image.height} markerEnd={`url(#${arrowId})`} /> : <circle key={mark.id} cx={mark.x * image.width} cy={mark.y * image.height} r={markerSize * 0.65} />)}</svg>}</div> : <p>The original image is unavailable.</p>}
      {marks.some((mark) => mark.label) && <ul className="source-mark-labels">{marks.filter((mark) => mark.label).map((mark) => <li key={mark.id}>{mark.label}</li>)}</ul>}
      <p className="source-caption">Chat uses the saved screen context from this exchange. These are captured views; Chat does not read your current screen. Open Help to ask about your screen now.</p>
      <button className="desktop-source-return" onClick={() => { void bridge.resumeHelp(source.id).then(() => bridge.openHelp()).catch((failure) => setError(failure instanceof Error ? failure.message : "Could not reopen Help.")); }}>Open in Help ↗</button>
    </aside>}
  </>;
}
