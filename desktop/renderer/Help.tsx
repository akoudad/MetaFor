import { useEffect, useRef, useState } from "react";
import type { FormEvent, PointerEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DesktopSettings, HelpSession, VisualMark } from "../shared";
import "./help.css";

type Point = { x: number; y: number };
type Tool = "point" | "rect" | "arrow";
type HistoryItem = { id: string; title: string; updatedAt: string };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const describeError = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "Something went wrong. Your question is kept; please retry.";

function Mark({ mark, viewHeight, draft = false }: { mark: VisualMark; viewHeight: number; draft?: boolean }) {
  const x = mark.x * 1000;
  const y = mark.y * viewHeight;
  const width = mark.width * 1000;
  const height = mark.height * viewHeight;
  return <g className={draft ? "visual-mark draft" : "visual-mark"}>
    {mark.kind === "rect" ? <rect x={x} y={y} width={width} height={height} rx="4" /> : mark.kind === "arrow" ? <path d={`M ${x} ${y} L ${x + width} ${y + height}`} markerEnd="url(#help-arrowhead)" /> : <circle cx={x} cy={y} r="15" />}
    {!draft && <><circle className="mark-label-bg" cx={x} cy={y} r="21" /><text className="mark-label" x={x} y={y + 1}>{mark.label || mark.id}</text></>}
  </g>;
}

export default function Help() {
  const [session, setSession] = useState<HelpSession | null>(null);
  const [question, setQuestion] = useState("");
  const [marks, setMarks] = useState<VisualMark[]>([]);
  const [previewMarks, setPreviewMarks] = useState<VisualMark[] | null>(null);
  const [annotationDrafts, setAnnotationDrafts] = useState<Record<string, string>>({});
  const [annotationId, setAnnotationId] = useState<string | null>(null);
  const [keepSourceInView, setKeepSourceInView] = useState(false);
  const [tool, setTool] = useState<Tool>("point");
  const [drawing, setDrawing] = useState<VisualMark | null>(null);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(true);
  const [showMarks, setShowMarks] = useState(true);
  const [shortcut, setShortcut] = useState("⌘⇧H");
  const [configured, setConfigured] = useState(false);
  const [credentialLoading, setCredentialLoading] = useState(false);
  const imageArea = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const annotationInput = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<HelpSession | null>(null);
  const start = useRef<Point | null>(null);
  const busyRef = useRef(false);
  const questionRef = useRef(question);
  questionRef.current = question;

  const acceptSession = (value: HelpSession) => {
    const previous = sessionRef.current;
    if (previous?.id !== value.id || previous?.source?.id !== value.source?.id) {
      setMarks([]); setPreviewMarks(null); setAnnotationDrafts({}); setAnnotationId(null); setKeepSourceInView(false); setDrawing(null); setQuestion(""); setSourceExpanded(true); setError("");
    }
    sessionRef.current = value;
    setSession(value); setCapturing(false);
  };

  useEffect(() => {
    let mounted = true;
    let revision = 0;
    const acceptSettings = (value: DesktopSettings) => { setShortcut(value.shortcut); setConfigured(value.configured && !value.credentialLoading); setCredentialLoading(Boolean(value.credentialLoading)); };
    const refreshSettings = () => { const current = ++revision; void window.metaforDesktop.getSettings().then((value) => { if (mounted && current === revision) acceptSettings(value); }).catch(() => {}); };
    const changed = (event: Event) => { const value = (event as CustomEvent<DesktopSettings>).detail; if (value) { revision++; acceptSettings(value); } else refreshSettings(); };
    window.metaforDesktop.getHelpSession().then((value) => { if (mounted) acceptSession(value); }).catch((failure) => { if (mounted) setError(describeError(failure)); });
    refreshSettings();
    const unsubscribe = window.metaforDesktop.onHelpSession(acceptSession);
    window.addEventListener("focus", refreshSettings);
    window.addEventListener("metafor-settings-changed", changed);
    return () => { mounted = false; unsubscribe(); window.removeEventListener("focus", refreshSettings); window.removeEventListener("metafor-settings-changed", changed); };
  }, []);

  useEffect(() => {
    if (!keepSourceInView) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session?.messages.length, busy, keepSourceInView]);

  useEffect(() => {
    if (!annotationId || !sourceExpanded) return;
    annotationInput.current?.focus({ preventScroll: true });
    annotationInput.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [annotationId, sourceExpanded]);

  const capture = async () => {
    if (busy || capturing) return;
    setError(""); setCapturing(true); setHistory(null);
    try { await window.metaforDesktop.captureScreen(); } catch (failure) { setError(describeError(failure)); }
    finally { setCapturing(false); }
  };

  const newSession = async () => {
    if (busy) return;
    setError("");
    try { acceptSession(await window.metaforDesktop.newHelp()); setHistory(null); } catch (failure) { setError(describeError(failure)); }
  };

  const send = async (event?: FormEvent, markedId?: string) => {
    event?.preventDefault();
    const active = sessionRef.current;
    const selectedMark = markedId ? marks.find((mark) => mark.id === markedId) : null;
    const text = (markedId ? annotationDrafts[markedId] ?? "" : questionRef.current).trim();
    if (busyRef.current || !configured || !active?.source || !text) return;
    if (markedId && !selectedMark) return;
    setKeepSourceInView(Boolean(markedId));
    busyRef.current = true; setBusy(true); setError("");
    try {
      const result = await window.metaforDesktop.askHelp({ sessionId: active.id, question: text, marks: selectedMark ? [selectedMark] : marks });
      if (sessionRef.current?.id !== active.id || sessionRef.current?.source?.id !== active.source.id) return;
      acceptSession(result);
      if (markedId) {
        setAnnotationDrafts((previous) => ({ ...previous, [markedId]: "" }));
        setAnnotationId(null); setSourceExpanded(true);
      } else { setQuestion(""); setSourceExpanded(false); }
    } catch (failure) { if (sessionRef.current?.id === active.id) setError(describeError(failure)); }
    finally {
      busyRef.current = false; setBusy(false);
      if (sessionRef.current?.id === active.id) {
        if (markedId) annotationInput.current?.focus({ preventScroll: true });
        else input.current?.focus();
      }
    }
  };

  const deleteExchange = async (id: string) => {
    if (busy || deleting) return;
    setDeleting(true); setError("");
    try {
      await window.metaforDesktop.deleteHelp(id);
      const [saved, active] = await Promise.all([window.metaforDesktop.listHelp(), window.metaforDesktop.getHelpSession()]);
      setHistory(saved); acceptSession(active); setDeleteId(null);
    } catch (failure) { setError(describeError(failure)); }
    finally { setDeleting(false); }
  };

  const position = (event: PointerEvent): Point => {
    const rect = imageArea.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  };
  const buildMark = (from: Point, to: Point): VisualMark => ({
    id: `mark-${marks.length + 1}`,
    label: String(marks.length + 1),
    kind: tool,
    x: tool === "rect" ? Math.min(from.x, to.x) : from.x,
    y: tool === "rect" ? Math.min(from.y, to.y) : from.y,
    width: tool === "point" ? 0 : tool === "rect" ? Math.abs(to.x - from.x) : to.x - from.x,
    height: tool === "point" ? 0 : tool === "rect" ? Math.abs(to.y - from.y) : to.y - from.y,
  });
  const source = session?.source;
  const activeMark = marks.find((mark) => mark.id === annotationId);
  const imageViewHeight = source ? 1000 * source.height / source.width : 1000;
  const visibleMarks = previewMarks ?? (marks.length ? marks : [...(session?.messages ?? [])].reverse().find((message) => message.marks?.length)?.marks ?? []);

  return <main className="metafor-help">
    <header className="help-header">
      <div className="help-brand"><span className={`help-orb ${busy ? "thinking" : ""}`} aria-hidden="true" /><span>metafor <strong>help</strong></span></div>
      <div className="help-header-actions">
        <button type="button" title="Saved Help exchanges" aria-expanded={history !== null} onClick={async () => {
          if (history) { setHistory(null); setDeleteId(null); return; }
          try { setHistory(await window.metaforDesktop.listHelp()); } catch (failure) { setError(describeError(failure)); }
        }}>History</button>
        <button type="button" title="Settings" onClick={() => void window.metaforDesktop.openSettings().catch((failure) => setError(describeError(failure)))}>⚙</button>
        <button type="button" title="Hide Help" aria-label="Hide Help" onClick={() => void window.metaforDesktop.hideHelp().catch((failure) => setError(describeError(failure)))}>×</button>
      </div>
    </header>

    {history !== null && <aside className="help-history" aria-label="Saved Help exchanges">
      <div className="help-history-heading"><strong>Saved exchanges</strong><button type="button" disabled={busy || deleting} onClick={() => void newSession()}>New</button></div>
      {!history.length && <p>No saved exchanges yet.</p>}
      {history.map((item) => <div className="help-history-item" key={item.id}>
        <div className="help-history-row"><button type="button" className={`help-history-choice ${session?.id === item.id ? "current" : ""}`} disabled={busy || deleting} onClick={async () => {
          try { acceptSession(await window.metaforDesktop.resumeHelp(item.id)); setHistory(null); setDeleteId(null); } catch (failure) { setError(describeError(failure)); }
        }}><span>{item.title}</span><small>{new Date(item.updatedAt).toLocaleDateString()}</small></button><button type="button" className="help-history-delete" aria-label={`Delete ${item.title}`} disabled={busy || deleting} onClick={() => setDeleteId(item.id)}>×</button></div>
        {deleteId === item.id && <div className="help-delete-confirm" role="group" aria-label={`Confirm deletion of ${item.title}`}><p>Delete this exchange and its saved screen selection? Text already copied into Chat stays there.</p><button type="button" disabled={deleting} onClick={() => setDeleteId(null)}>Keep exchange</button><button type="button" disabled={deleting} onClick={() => void deleteExchange(item.id)}>{deleting ? "Deleting…" : "Delete exchange"}</button></div>}
      </div>)}
    </aside>}

    <div className="help-scroll">
      {!source ? <section className="help-empty">
        <span className="help-empty-symbol" aria-hidden="true">⌖</span>
        <h1>Ask about what’s in front of you.</h1>
        <p>Point to a passage, diagram, video frame, or anything on your screen. Add marks, then ask here.</p>
        <button type="button" className="help-primary" onClick={() => void capture()} disabled={capturing}>{capturing ? "Opening screen selection…" : "Select something on screen"}</button>
        <p className="help-privacy">macOS will ask for screen recording permission. Only your chosen region is sent when you press Send. There is no continuous sharing.</p>
        <p className="help-shortcut">Open Help anytime with <kbd>{shortcut}</kbd></p>
      </section> : <section className="help-source" aria-label="Selected screen source">
        <div className="help-source-heading">
          <button type="button" className="help-source-title" aria-expanded={sourceExpanded} onClick={() => setSourceExpanded((value) => !value)}><span>{sourceExpanded ? "⌄" : "›"}</span><span>{source.title || source.appName || "Screen selection"}<small>Snapshot · {new Date(source.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span></button>
          <button type="button" disabled={busy} onClick={() => void newSession()} title="Start a new exchange without sharing this source">Stop sharing</button>
        </div>
        {sourceExpanded && <>
          <div className="help-image" ref={imageArea} onPointerDown={(event) => {
            if (event.button !== 0 || busy || marks.length >= 8) return;
            event.currentTarget.setPointerCapture(event.pointerId); start.current = position(event); setPreviewMarks(null); setDrawing(buildMark(start.current, start.current)); setShowMarks(true);
          }} onPointerMove={(event) => { if (start.current) setDrawing(buildMark(start.current, position(event))); }} onPointerUp={(event) => {
            if (!start.current) return;
            const mark = buildMark(start.current, position(event)); start.current = null; setDrawing(null);
            if (mark.kind !== "point" && Math.abs(mark.width) + Math.abs(mark.height) < 0.015) return;
            setMarks((previous) => [...previous, mark]); setAnnotationId(mark.id); setKeepSourceInView(true);
          }} onPointerCancel={() => { start.current = null; setDrawing(null); }}>
            <img src={source.image} alt={`Selected content from ${source.appName || "your screen"}`} draggable={false} />
            <svg viewBox={`0 0 1000 ${imageViewHeight}`} preserveAspectRatio="none" aria-hidden="true">
              <defs><marker id="help-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
              {showMarks && visibleMarks.map((mark) => <Mark key={mark.id} mark={mark} viewHeight={imageViewHeight} />)}
              {drawing && <Mark mark={drawing} viewHeight={imageViewHeight} draft />}
            </svg>
          </div>
          {activeMark && <form className="help-inline-annotation" aria-label={`Annotation ${activeMark.label || activeMark.id}`} onSubmit={(event) => void send(event, activeMark.id)}>
            <div className="help-inline-heading"><span>Annotation {activeMark.label || activeMark.id}</span><button type="button" aria-label="Close annotation editor" onClick={() => setAnnotationId(null)}>×</button></div>
            <textarea ref={annotationInput} value={annotationDrafts[activeMark.id] ?? ""} maxLength={8000} placeholder="Ask about this marked detail…" aria-label="Question about marked detail" disabled={busy} onChange={(event) => setAnnotationDrafts((previous) => ({ ...previous, [activeMark.id]: event.target.value }))} onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); setAnnotationId(null); }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(undefined, activeMark.id); }
            }} />
            {error && <p className="help-inline-error">{error}</p>}
            <div className="help-inline-actions"><span>About marked detail {activeMark.label || activeMark.id}</span><button type="submit" disabled={busy || !configured || !annotationDrafts[activeMark.id]?.trim()}>{busy ? "Thinking…" : "Send annotation ↑"}</button></div>
          </form>}
          <div className="help-mark-tools" aria-label="Annotation tools">
            {(["point", "rect", "arrow"] as const).map((kind) => <button key={kind} type="button" aria-pressed={tool === kind} disabled={busy} onClick={() => setTool(kind)}>{kind === "point" ? "Point" : kind === "rect" ? "Box" : "Arrow"}</button>)}
            <button type="button" disabled={!marks.length || busy} onClick={() => { const last = marks.at(-1); setPreviewMarks(null); setMarks((previous) => previous.slice(0, -1)); if (annotationId === last?.id) setAnnotationId(null); if (last) setAnnotationDrafts((previous) => { const next = { ...previous }; delete next[last.id]; return next; }); }}>Undo</button>
            <button type="button" disabled={!visibleMarks.length} aria-pressed={showMarks} onClick={() => setShowMarks((value) => !value)}>{showMarks ? "Hide marks" : "Show marks"}</button>
          </div>
          {marks.length > 0 && <div className="help-annotation-links" aria-label="Marked detail annotations">{marks.map((mark) => <button key={mark.id} type="button" aria-label={`Edit annotation ${mark.label || mark.id}`} aria-pressed={annotationId === mark.id} disabled={busy} onClick={() => { setPreviewMarks(null); setAnnotationId(mark.id); setKeepSourceInView(true); }}>{mark.label || mark.id}{annotationDrafts[mark.id]?.trim() ? " · Draft" : ""}</button>)}</div>}
          <p className="help-source-note">{marks.length ? `${marks.length} ${marks.length === 1 ? "mark" : "marks"} added. Write beside the image, or choose a number to reopen its annotation.` : "Mark the image to point out a detail. This is a frozen snapshot."}</p>
        </>}
        <div className="help-source-actions"><button type="button" disabled={busy || capturing} onClick={() => void capture()}>Select new content ↗</button><span>Only this selection is shared</span></div>
      </section>}

      {session && session.messages.length > 0 && <section className="help-messages" aria-label="Help conversation">
        {session.messages.map((message) => <article key={message.id} className={`help-message ${message.role}`}>
          <div className="help-message-author">{message.role === "user" ? "You" : "metafor"}{Boolean(message.marks?.length) && <button type="button" onClick={() => { setSourceExpanded(true); setShowMarks(true); setPreviewMarks(message.marks ?? []); setAnnotationId(null); imageArea.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{message.marks!.length} marked {message.marks!.length === 1 ? "detail" : "details"} ↗</button>}</div>
          <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span>{alt}</span>, table: ({ children }) => <div className="help-table">{children && <table>{children}</table>}</div> }}>{message.text}</Markdown>
        </article>)}
      </section>}

      {busy && <div className="help-thinking" role="status"><span className="help-orb thinking" aria-hidden="true" /><span>Looking closely at your question…</span><button type="button" onClick={() => { if (session) void window.metaforDesktop.cancelHelp(session.id).catch((failure) => setError(describeError(failure))); }}>Stop</button></div>}
      <div ref={bottom} />
    </div>

    <footer className="help-footer">
      {error && <p className="help-error" role="alert">{error}</p>}
      {credentialLoading ? <p className="help-setup" role="status">Waiting for macOS Keychain… Your question stays here.</p> : !configured && <p className="help-setup">Add your model API key in <button type="button" onClick={() => void window.metaforDesktop.openSettings().catch((failure) => setError(describeError(failure)))}>Settings</button> to ask questions.</p>}
      {source && <form onSubmit={(event) => void send(event)} className="help-composer">
        <textarea ref={input} value={question} maxLength={8000} placeholder={session?.messages.length ? "Ask a follow-up…" : "What would you like to understand?"} aria-label="Question about selected content" onChange={(event) => setQuestion(event.target.value)} disabled={busy} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
        }} />
        <button type="submit" className="help-send" disabled={busy || !question.trim() || !configured} aria-label="Send question and selected image">{busy ? "…" : "↑"}</button>
      </form>}
      {source && <p className="help-send-note">Send shares this selected image and your question with your model provider.</p>}
      {session && session.messages.some((message) => message.role === "assistant") && <button type="button" className="help-continue" disabled={busy} onClick={() => void window.metaforDesktop.openHelpInChat(session.id).catch((failure) => setError(describeError(failure)))}>Continue in Metafor Chat <span>↗</span></button>}
    </footer>
  </main>;
}
