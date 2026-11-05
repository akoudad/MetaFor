import { useEffect, useRef, useState } from "react";
import type { FormEvent, PointerEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DesktopSettings, HelpHistoryItem, HelpSession, VisualMark } from "../shared";
import ModelSelector from "./ModelSelector";
import "./help.css";

type Point = { x: number; y: number };
type Tool = "point" | "rect" | "arrow";
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const describeError = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "Something went wrong. Your question is kept; please retry.";

function Mark({ mark, viewHeight, index, draft = false }: { mark: VisualMark; viewHeight: number; index?: number; draft?: boolean }) {
  const x = mark.x * 1000;
  const y = mark.y * viewHeight;
  const width = mark.width * 1000;
  const height = mark.height * viewHeight;
  return <g className={draft ? "visual-mark draft" : "visual-mark"}>
    <title>{mark.label || mark.id}</title>
    {mark.kind === "rect" ? <rect x={x} y={y} width={width} height={height} rx="4" /> : mark.kind === "arrow" ? <path d={`M ${x} ${y} L ${x + width} ${y + height}`} markerEnd="url(#help-arrowhead)" /> : <circle cx={x} cy={y} r="15" />}
    {!draft && <><circle className="mark-label-bg" cx={x} cy={y} r="21" /><text className="mark-label" x={x} y={y + 1}>{mark.label && mark.label.length <= 3 ? mark.label : (index ?? 0) + 1}</text></>}
  </g>;
}

export default function Help() {
  const [session, setSession] = useState<HelpSession | null>(null);
  const [question, setQuestion] = useState("");
  const [marks, setMarks] = useState<VisualMark[]>([]);
  const [previewMarks, setPreviewMarks] = useState<VisualMark[] | null>(null);
  const [viewSourceId, setViewSourceId] = useState<string | null>(null);
  const [screenContext, setScreenContext] = useState(true);
  const [annotationDrafts, setAnnotationDrafts] = useState<Record<string, string>>({});
  const [annotationId, setAnnotationId] = useState<string | null>(null);
  const [keepSourceInView, setKeepSourceInView] = useState(false);
  const [tool, setTool] = useState<Tool>("point");
  const [drawing, setDrawing] = useState<VisualMark | null>(null);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HelpHistoryItem[] | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const [answerExpanded, setAnswerExpanded] = useState(true);
  const [answerRoomy, setAnswerRoomy] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  const [guidanceVisible, setGuidanceVisible] = useState(false);
  const [showMarks, setShowMarks] = useState(true);
  const [shortcut, setShortcut] = useState("⌥M");
  const [configured, setConfigured] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [credentialLoading, setCredentialLoading] = useState(false);
  const imageArea = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const annotationInput = useRef<HTMLTextAreaElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const answerContent = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const answerActions = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLElement>(null);
  const lastLayout = useRef("");
  const sessionRef = useRef<HelpSession | null>(null);
  const annotationCacheDetached = useRef(false);
  const annotationCache = useRef<Record<string, { marks: VisualMark[]; drafts: Record<string, string> }>>({});
  const start = useRef<Point | null>(null);
  const busyRef = useRef(false);
  const questionRef = useRef(question);
  questionRef.current = question;

  const acceptSession = (value: HelpSession) => {
    const previous = sessionRef.current;
    if (previous?.id !== value.id || previous?.source?.id !== value.source?.id) {
      annotationCacheDetached.current = false;
      setScreenContext(value.contextMode === "screen" || !value.source);
      setMarks([]); setPreviewMarks(null); setViewSourceId(null); setAnnotationDrafts({}); setAnnotationId(null); setKeepSourceInView(false); setDrawing(null); setSourceExpanded(false); setError("");
    }
    if (previous?.id !== value.id) {
      annotationCache.current = {};
      setShowEarlier(false); setAnswerExpanded(true); setAnswerRoomy(false); setGuidanceVisible(false);
      setQuestion("");
    }
    sessionRef.current = value;
    setSession(value); setCapturing(false);
  };

  useEffect(() => {
    let mounted = true;
    let revision = 0;
    let sessionRevision = 0;
    const acceptSettings = (value: DesktopSettings) => { setSettingsReady(true); setShortcut(value.shortcut.replace(/CommandOrControl|Command/g, "⌘").replace(/Control/g, "⌃").replace(/Alt/g, "⌥").replace(/Shift/g, "⇧").replace(/\+/g, "")); setConfigured(value.configured && !value.credentialLoading); setCredentialLoading(Boolean(value.credentialLoading)); };
    const refreshSettings = () => { const current = ++revision; void window.metaforDesktop.getSettings().then((value) => { if (mounted && current === revision) acceptSettings(value); }).catch(() => { if (mounted && current === revision) setSettingsReady(true); }); };
    const changed = (event: Event) => { const value = (event as CustomEvent<DesktopSettings>).detail; if (value) { revision++; acceptSettings(value); } else refreshSettings(); };
    window.metaforDesktop.getHelpSession().then((value) => { if (mounted && sessionRevision === 0) acceptSession(value); }).catch((failure) => { if (mounted && sessionRevision === 0) setError(describeError(failure)); });
    refreshSettings();
    const unsubscribe = window.metaforDesktop.onHelpSession((value) => { sessionRevision++; if (mounted) acceptSession(value); });
    const unsubscribeGuidance = window.metaforDesktop.onGuidanceChanged?.((visible) => { if (mounted) setGuidanceVisible(visible === true); });
    const focus = () => { refreshSettings(); if (!document.activeElement?.closest(".help-inline-annotation")) input.current?.focus({ preventScroll: true }); };
    window.addEventListener("focus", focus);
    window.addEventListener("metafor-settings-changed", changed);
    return () => { mounted = false; unsubscribe(); unsubscribeGuidance?.(); window.removeEventListener("focus", focus); window.removeEventListener("metafor-settings-changed", changed); };
  }, []);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, [session?.id, session?.source?.id]);

  useEffect(() => {
    if (!keepSourceInView && scrollArea.current) scrollArea.current.scrollTop = 0;
  }, [session?.messages.at(-1)?.id, answerExpanded, showEarlier, keepSourceInView]);

  useEffect(() => {
    if (sourceExpanded && scrollArea.current) scrollArea.current.scrollTop = 0;
  }, [sourceExpanded, viewSourceId]);

  useEffect(() => {
    if (!annotationId || !sourceExpanded) return;
    annotationInput.current?.focus({ preventScroll: true });
    annotationInput.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [annotationId, sourceExpanded]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setGuidanceVisible(false); void window.metaforDesktop.closeGuidance?.().catch((failure) => setError(describeError(failure))); }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const switchSource = (id: string | null, refresh = false) => {
    const previousId = viewSourceId ?? sessionRef.current?.source?.id;
    const nextId = id ?? sessionRef.current?.source?.id;
    if (previousId && !annotationCacheDetached.current) annotationCache.current[previousId] = { marks, drafts: annotationDrafts };
    const cached = nextId ? annotationCache.current[nextId] : undefined;
    annotationCacheDetached.current = refresh;
    setMarks(refresh ? [] : cached?.marks ?? []);
    setAnnotationDrafts(refresh ? {} : cached?.drafts ?? {});
    setViewSourceId(id); setPreviewMarks(null); setAnnotationId(null);
  };

  const capture = async (mode: "screen" | "region" = "screen") => {
    if (busy || capturing) return;
    setError(""); setCapturing(true); setHistory(null);
    try { await window.metaforDesktop.captureScreen(mode); } catch (failure) { setError(describeError(failure)); }
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
    if (busyRef.current || !configured || !active || !text) return;
    if (markedId && !selectedMark) return;
    const refreshScreen = screenContext && !markedId && !marks.length && !viewSourceId;
    const pinnedId = viewSourceId ?? active.source?.id;
    if (!refreshScreen && !pinnedId) return;
    setKeepSourceInView(Boolean(markedId)); setHistory(null);
    if (!markedId) setSourceExpanded(false);
    busyRef.current = true; setBusy(true); setError("");
    try {
      const result = await window.metaforDesktop.askHelp({ sessionId: active.id, question: text, marks: selectedMark ? [selectedMark] : marks, ...(refreshScreen ? { refreshScreen: true } : { sourceId: pinnedId }) });
      if (sessionRef.current?.id !== active.id) return;
      acceptSession(result); setAnswerExpanded(true); setAnswerRoomy(false); setShowEarlier(false);
      if (markedId) {
        setAnnotationDrafts((previous) => ({ ...previous, [markedId]: "" }));
        setAnnotationId(null); setSourceExpanded(true);
      } else { setQuestion(""); setSourceExpanded(false); }
      const answer = result.messages.at(-1);
      if (answer?.role === "assistant" && answer.marks?.length && window.metaforDesktop.showGuidance) {
        void window.metaforDesktop.showGuidance({ sessionId: result.id, messageId: answer.id }).then(() => { if (!window.metaforDesktop.onGuidanceChanged) setGuidanceVisible(true); }).catch((failure) => setError(describeError(failure)));
      }
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
  const source = viewSourceId ? [session?.source, ...(session?.sources ?? [])].find((item) => item?.id === viewSourceId) : session?.source;
  const activeMark = marks.find((mark) => mark.id === annotationId);
  const imageViewHeight = source ? 1000 * source.height / source.width : 1000;
  const visibleMarks = previewMarks ?? (marks.length ? marks : [...(session?.messages ?? [])].reverse().find((message) => message.marks?.length && (message.sourceId ?? session?.source?.id) === source?.id)?.marks ?? []);


  const lastAnswer = session?.messages.findLastIndex((message) => message.role === "assistant") ?? -1;
  const latestStart = lastAnswer > 0 && session?.messages[lastAnswer - 1].role === "user" ? lastAnswer - 1 : Math.max(0, (session?.messages.length ?? 0) - 1);
  const hasAnswer = Boolean(session?.messages.length);
  const expanded = history !== null || sourceExpanded || (answerExpanded && hasAnswer) || Boolean(error) || credentialLoading || (settingsReady && !configured);
  const roomy = history !== null || sourceExpanded || showEarlier || answerRoomy;
  useEffect(() => {
    const resize = () => {
      // Measure the natural content, not the constrained scrolling viewport.
      // Short answers stay short; long ones scroll until the reader expands them.
      const contentHeight = answerContent.current?.scrollHeight ?? surface.current?.scrollHeight ?? 0;
      const notices = [...(surface.current?.querySelectorAll<HTMLElement>(".help-error, .help-setup") ?? [])].reduce((sum, element) => sum + element.offsetHeight, 0);
      const measured = contentHeight + notices + (answerActions.current?.offsetHeight ?? 0) + (footer.current?.offsetHeight ?? 90) + 44;
      const height = expanded ? Math.min(roomy ? 580 : 330, Math.max(190, contentHeight ? measured : roomy ? 580 : 330)) : 110;
      const layout = { expanded: expanded || modelPickerOpen, height: Math.ceil(modelPickerOpen ? Math.max(370, height) : height) };
      const signature = JSON.stringify(layout);
      if (signature === lastLayout.current) return;
      lastLayout.current = signature;
      void window.metaforDesktop.setHelpLayout?.(layout).catch((failure) => { lastLayout.current = ""; setError(describeError(failure)); });
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    for (const element of [answerContent.current, surface.current, answerActions.current, footer.current]) if (element) observer?.observe(element);
    return () => observer?.disconnect();
  }, [expanded, roomy, modelPickerOpen, session?.messages, sourceExpanded, error, history, credentialLoading, settingsReady, configured]);

  return <main className={`metafor-help ${expanded ? "expanded" : "compact"} ${roomy ? "roomy-answer" : "brief-answer"}`}>
    {expanded && <div className="help-surface" ref={surface}>
      {error && <p className="help-error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError("")}>×</button></p>}
      {credentialLoading ? <p className="help-setup" role="status">Waiting for macOS Keychain… Your question stays here.</p> : settingsReady && !configured && <p className="help-setup">Add your model API key in <button type="button" onClick={() => void window.metaforDesktop.openSettings().catch((failure) => setError(describeError(failure)))}>Settings</button> to ask questions.</p>}
    {history !== null && <aside className="help-history" aria-label="Saved Help exchanges">
      <div className="help-history-heading"><strong>Saved exchanges</strong><button type="button" disabled={busy || deleting} onClick={() => void newSession()}>New</button></div>
      <div className="help-history-tools" aria-label="Source tools">
        <button type="button" disabled={!source} onClick={() => { setSourceExpanded(true); setHistory(null); }}>Inspect source</button>
        <button type="button" disabled={busy || capturing} onClick={() => { setScreenContext(true); switchSource(null, true); setSourceExpanded(false); setHistory(null); if (!session?.source) void capture(); }}>Use current screen</button>
      </div>
      {!history.length && <p>No saved exchanges yet.</p>}
      {history.map((item) => <div className="help-history-item" key={item.id}>
        <div className="help-history-row"><button type="button" className={`help-history-choice ${session?.id === item.id ? "current" : ""}`} disabled={busy || deleting || item.status === "unreadable"} onClick={async () => {
          try { acceptSession(await window.metaforDesktop.resumeHelp(item.id)); setHistory(null); setDeleteId(null); } catch (failure) { setError(describeError(failure)); }
        }}><span>{item.title}</span><small>{item.status === "unreadable" ? "Could not open · file kept unchanged" : item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : "Date unavailable"}</small></button><button type="button" className="help-history-delete" aria-label={`Delete ${item.title}`} disabled={busy || deleting} onClick={() => setDeleteId(item.id)}>×</button></div>
        {deleteId === item.id && <div className="help-delete-confirm" role="group" aria-label={`Confirm deletion of ${item.title}`}><p>Delete this exchange and its saved screen snapshots? Text already copied into Chat stays there.</p><button type="button" disabled={deleting} onClick={() => setDeleteId(null)}>Keep exchange</button><button type="button" disabled={deleting} onClick={() => void deleteExchange(item.id)}>{deleting ? "Deleting…" : "Delete exchange"}</button></div>}
      </div>)}
    </aside>}
      {history === null && <div className="help-scroll" ref={scrollArea}>
      <div className="help-content" ref={answerContent}>
      {source && sourceExpanded && <section className="help-source" aria-label="Selected screen source">
        <div className="help-source-heading">
          <button type="button" className="help-source-title" aria-label="Close source" aria-expanded={sourceExpanded} onClick={() => setSourceExpanded((value) => !value)}><span>{sourceExpanded ? "⌄" : "›"}</span><span>{source.title || source.appName || "Current screen"}<small>{viewSourceId ? "Earlier view" : "Snapshot"} · {new Date(source.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span></button>
          <button type="button" disabled={busy} onClick={() => void newSession()} title="Start a new exchange without sharing this source">Stop sharing</button>
        </div>
        <div className="help-source-context" aria-label="Question context">
          <button type="button" aria-pressed={screenContext && !viewSourceId && !marks.length} disabled={busy} onClick={() => { setScreenContext(true); switchSource(null, true); }}>Current screen</button>
          <button type="button" aria-pressed={!screenContext || Boolean(viewSourceId) || marks.length > 0} disabled={busy} onClick={() => setScreenContext(false)}>This snapshot</button>
        </div>
        {sourceExpanded && <>
          <div className="help-image" ref={imageArea} onPointerDown={(event) => {
            if (event.button !== 0 || busy || marks.length >= 8) return;
            event.currentTarget.setPointerCapture(event.pointerId); start.current = position(event); setPreviewMarks(null); setDrawing(buildMark(start.current, start.current)); setShowMarks(true);
          }} onPointerMove={(event) => { if (start.current) setDrawing(buildMark(start.current, position(event))); }} onPointerUp={(event) => {
            if (!start.current) return;
            const mark = buildMark(start.current, position(event)); start.current = null; setDrawing(null);
            if (mark.kind !== "point" && Math.abs(mark.width) + Math.abs(mark.height) < 0.015) return;
            annotationCacheDetached.current = false;
            setMarks((previous) => [...previous, mark]); setAnnotationId(mark.id); setKeepSourceInView(true);
          }} onPointerCancel={() => { start.current = null; setDrawing(null); }}>
            <img src={source.image} alt={`Selected content from ${source.appName || "your screen"}`} draggable={false} />
            <svg viewBox={`0 0 1000 ${imageViewHeight}`} preserveAspectRatio="none" aria-hidden="true">
              <defs><marker id="help-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
              {showMarks && visibleMarks.map((mark, index) => <Mark key={mark.id} mark={mark} index={index} viewHeight={imageViewHeight} />)}
              {drawing && <Mark mark={drawing} viewHeight={imageViewHeight} draft />}
            </svg>
          </div>
          {showMarks && visibleMarks.some((mark) => (mark.label?.length ?? 0) > 3) && <ol className="help-mark-legend">{visibleMarks.map((mark) => <li key={mark.id}>{mark.label || mark.id}</li>)}</ol>}
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
        <div className="help-source-actions"><button type="button" disabled={busy || capturing} onClick={() => void capture("region")}>Select an area…</button>{viewSourceId && <button type="button" disabled={busy} onClick={() => { switchSource(null); }}>Return to current view</button>}<span>{screenContext && !viewSourceId && !marks.length ? "Updates when you ask" : "Using this snapshot"}</span></div>
      </section>}
      {session && answerExpanded && session.messages.length > 0 && <section className="help-messages" aria-label="Help conversation">
        <div className="help-answer-tools"><span>metafor</span>{session.messages.some((message) => message.role === "user") && <button type="button" aria-expanded={showEarlier} onClick={() => setShowEarlier((value) => !value)}>{showEarlier ? "Latest answer" : latestStart > 0 ? "Earlier messages" : "Show question"}</button>}<button type="button" aria-expanded={answerRoomy} onClick={() => setAnswerRoomy((value) => !value)}>{answerRoomy ? "Compact answer" : "Expand answer"}</button><button type="button" onClick={() => setAnswerExpanded(false)}>Hide answer</button></div>
        {(showEarlier ? session.messages : session.messages.slice(lastAnswer >= 0 ? lastAnswer : latestStart)).map((message) => <article key={message.id} className={`help-message ${message.role}`}>
          <div className="help-message-author">{message.role === "user" ? "You" : "metafor"}<button type="button" disabled={busy} onClick={() => { switchSource(message.sourceId ?? session.source?.id ?? null); setSourceExpanded(true); setShowMarks(true); setPreviewMarks(message.marks ?? []); setAnnotationId(null); imageArea.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{message.marks?.length ? `${message.marks.length} marked ${message.marks.length === 1 ? "detail" : "details"}` : "View source"} ↗</button></div>
          <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span>{alt}</span>, table: ({ children }) => <div className="help-table">{children && <table>{children}</table>}</div> }}>{message.text}</Markdown>
          {message.role === "assistant" && message.id !== session.messages[lastAnswer]?.id && Boolean(message.marks?.length) && <button className="help-guidance" type="button" onClick={() => void window.metaforDesktop.showGuidance({ sessionId: session.id, messageId: message.id }).then(() => { if (!window.metaforDesktop.onGuidanceChanged) setGuidanceVisible(true); }).catch((failure) => setError(describeError(failure)))}>Show on screen</button>}
        </article>)}
      </section>}
      </div>
      </div>}
      {history === null && session && answerExpanded && lastAnswer >= 0 && <div className="help-answer-footer" ref={answerActions}><button type="button" className="help-continue" disabled={busy} onClick={() => void window.metaforDesktop.openHelpInChat(session.id).catch((failure) => setError(describeError(failure)))}>Continue in Metafor Chat ↗</button>{!guidanceVisible && Boolean(session.messages[lastAnswer]?.marks?.length) && <button type="button" onClick={() => void window.metaforDesktop.showGuidance({ sessionId: session.id, messageId: session.messages[lastAnswer].id }).then(() => { if (!window.metaforDesktop.onGuidanceChanged) setGuidanceVisible(true); }).catch((failure) => setError(describeError(failure)))}>Show on screen</button>}{guidanceVisible && <button type="button" onClick={() => { setGuidanceVisible(false); void window.metaforDesktop.closeGuidance().catch((failure) => setError(describeError(failure))); }}>Hide screen highlights</button>}</div>}
    </div>}

    <footer className="help-footer" ref={footer}>
      {session && <form onSubmit={(event) => void send(event)} className="help-composer">
        <span className={`help-orb ${busy || capturing ? "thinking" : ""}`} aria-hidden="true" />
        <textarea ref={input} value={question} maxLength={8000} rows={1} placeholder={busy ? "Preparing your answer…" : session.messages.length ? "Ask a follow-up…" : "Ask about anything on your screen…"} aria-label="Question about selected content" onChange={(event) => setQuestion(event.target.value)} disabled={busy} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
        }} />
        {busy ? <button type="button" className="help-stop" onClick={() => void window.metaforDesktop.cancelHelp(session.id).catch((failure) => setError(describeError(failure)))}>Stop</button> : <button type="submit" className="help-send" disabled={!question.trim() || !configured} aria-label="Send question and selected image">↑</button>}
      </form>}
      <div className="help-utility-row">
        <div className="help-context-status">
          <ModelSelector disabled={busy || capturing} onOpenChange={setModelPickerOpen} />
          {session && (!screenContext || viewSourceId || marks.length > 0) && <span>Selected detail</span>}
          {!answerExpanded && hasAnswer && <button type="button" onClick={() => { setAnswerExpanded(true); setHistory(null); }}>Show answer</button>}
        </div>
        <div className="help-utilities">
          <button type="button" title="Saved Help exchanges" aria-expanded={history !== null} onClick={async () => {
            if (history) { setHistory(null); setDeleteId(null); return; }
            try { setHistory(await window.metaforDesktop.listHelp()); } catch (failure) { setError(describeError(failure)); }
          }}>History</button>
          <button type="button" title="Settings" aria-label="Settings" onClick={() => void window.metaforDesktop.openSettings().catch((failure) => setError(describeError(failure)))}>⚙</button>
          <button type="button" title={`Hide Help (${shortcut})`} aria-label="Hide Help" onClick={() => { setSourceExpanded(false); setHistory(null); void window.metaforDesktop.hideHelp().catch((failure) => setError(describeError(failure))); }}>×</button>
        </div>
      </div>
      {busy ? <p className="help-send-note" role="status">Preparing your answer…</p> : session && (!screenContext || viewSourceId || marks.length > 0) && <p className="help-send-note">Uses the selected detail. Shared with your model.</p>}
    </footer>
  </main>;
}
