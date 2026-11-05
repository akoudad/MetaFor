"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent, PointerEvent } from "react";
import SpatialWorld from "./SpatialWorld";
import NavigationRail from "./NavigationRail";
import SpaceMap from "./SpaceMap";
import TopicCard from "./TopicCard";
import { getDepth, getPath } from "@/lib/model";
import type { Conversation, SourceReference } from "@/lib/model";
import { validateAnnotations } from "@/lib/ai";
import { createConversation, applyAnswer } from "@/lib/session";
import { loadSnapshot, saveSnapshot, backupSnapshot, listSnapshots, serializeSnapshot, parseSnapshot } from "@/lib/storage";
import type { Snapshot } from "@/lib/storage";
import type { AnnotationRequest, AnswerRequest, AnswerResult, ModelStatus } from "@/lib/contracts";
import { normalizeText, messageText } from "@/lib/markdown";
import { CARD_HEIGHT, CARD_WIDTH, FIELD_OF_VIEW, applyPositionOverrides, annotationView, fitOverview, focusView, layoutSpace, normalizeWheel, zoomView } from "@/lib/spatial";
import type { SpatialPoint } from "@/lib/spatial";
import { advanceSpatialScroll } from "@/lib/spatial-scroll";
import type { SpatialScrollState } from "@/lib/spatial-scroll";

type SavedPlace = { view: SpatialPoint; draft: string; selection: SourceReference | null; scrollTop: number; annotations?: AnnotationRequest[] };
type Pointer = { x: number; y: number };
type Pending = { request: AnswerRequest; error?: string; navigation: number };
type TopicTransition = { key: string; fromId: string; toId: string; toIds?: string[]; follow: boolean };
type SelectionPreview = { source: SourceReference; x: number; y: number };
const INITIAL_VIEW = { x: 0, y: 0, z: 900 };

function selectedAnswerText(range: Range): string {
  const fragment = range.cloneContents();
  fragment.querySelectorAll("[data-no-selection]").forEach((element) => element.remove());
  const textOf = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    const text = Array.from(node.childNodes).map(textOf).join("");
    const block = node.nodeType === Node.ELEMENT_NODE && /^(DIV|SECTION|P|H[1-6]|BR|LI|UL|OL|BLOCKQUOTE|PRE|TABLE|THEAD|TBODY|TR|TD|TH)$/.test((node as Element).tagName);
    return block ? `\n${text}\n` : text;
  };
  return normalizeText(textOf(fragment));
}

export default function ConversationSpace() {
  const [space, setSpace] = useState(createConversation);
  const [ready, setReady] = useState(false);
  const [switching, setSwitching] = useState(false);
  const switchingNow = useRef(false);
  const [started, setStarted] = useState(false);
  const [activeId, setActiveId] = useState(space.rootId);
  const [view, setView] = useState<SpatialPoint>(INITIAL_VIEW);
  const [positions, setPositions] = useState<Record<string, SpatialPoint>>({});
  const baseNodes = useMemo(() => layoutSpace(space), [space]);
  const nodes = useMemo(() => applyPositionOverrides(baseNodes, positions), [baseNodes, positions]);
  const [annotationPair, setAnnotationPair] = useState<{ sourceId: string; replyId: string } | null>(null);
  const [stageSize, setStageSize] = useState({ width: 1000, height: 700 });
  const annotationFrame = useMemo(() => annotationPair ? annotationView(nodes, annotationPair.sourceId, annotationPair.replyId, stageSize.width, stageSize.height) : null, [nodes, annotationPair, stageSize]);
  const presentedNodes = useMemo(() => annotationFrame ? applyPositionOverrides(nodes, annotationFrame.positions) : nodes, [nodes, annotationFrame]);
  const [overview, setOverview] = useState(false);
  const [choiceParentId, setChoiceParentState] = useState<string | null>(null);
  const [choiceTopicIds, setChoiceTopicIds] = useState<string[] | null>(null);
  const choiceNow = useRef<string | null>(null);
  const setChoiceParent = useCallback((id: string | null, topicIds: string[] | null = null) => { choiceNow.current = id; setChoiceParentState(id); setChoiceTopicIds(topicIds); }, []);
  const [scrollHint, setScrollHint] = useState("");
  const [draft, setDraftState] = useState("");
  const draftNow = useRef("");
  const setDraft = useCallback((value: string) => { draftNow.current = value; setDraftState(value); }, []);
  const [selection, setSelectionState] = useState<SourceReference | null>(null);
  const selectionNow = useRef<SourceReference | null>(null);
  const setSelection = useCallback((value: SourceReference | null) => { selectionNow.current = value; setSelectionState(value); }, []);
  const [annotations, setAnnotationsState] = useState<AnnotationRequest[]>([]);
  const annotationsNow = useRef<AnnotationRequest[]>([]);
  const setAnnotations = useCallback((value: AnnotationRequest[]) => { annotationsNow.current = value; setAnnotationsState(value); }, []);
  const [selectionPreview, setSelectionPreview] = useState<SelectionPreview | null>(null);
  const selectionAction = useRef<HTMLButtonElement>(null);
  const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedRange = useRef<Range | null>(null);
  const dismissSelectionPreview = useCallback(() => {
    if (selectionTimer.current) clearTimeout(selectionTimer.current);
    selectionTimer.current = null;
    const chosen = window.getSelection();
    dismissedRange.current = chosen && !chosen.isCollapsed && chosen.rangeCount ? chosen.getRangeAt(0).cloneRange() : null;
    setSelectionPreview(null);
  }, []);
  const [includeIds, setIncludeIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState(false);
  const [savedChats, setSavedChats] = useState(false);
  const [connections, setConnections] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pending, setPendingState] = useState<Pending | null>(null);
  const pendingNow = useRef<Pending | null>(null);
  const setPending = useCallback((value: Pending | null) => { pendingNow.current = value; setPendingState(value); }, []);
  const [transition, setTransitionState] = useState<TopicTransition | null>(null);
  const transitionNow = useRef<TopicTransition | null>(null);
  const setTransition = useCallback((value: TopicTransition | null) => { transitionNow.current = value; setTransitionState(value); }, []);
  const [unreadId, setUnreadId] = useState<string | null>(null);
  const [unreadMessageId, setUnreadMessageId] = useState<string | null>(null);
  const unreadTopics = useRef<string[]>([]);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [showAccess, setShowAccess] = useState(false);
  const [saveState, setSaveState] = useState("Saved locally");
  const [library, setLibrary] = useState<{ id: string; title: string; savedAt: string }[]>([]);
  const [scrollRevision, setScrollRevision] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const spatialScroll = useRef<SpatialScrollState | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const saved = useRef<Record<string, SavedPlace>>({});
  const history = useRef<string[]>([]);
  const pushHistory = useCallback((id: string) => { history.current = [...history.current, id].slice(-1000); }, []);
  const readers = useRef(new Map<string, HTMLDivElement>());
  const hover = useRef<string | null>(null);
  const pointers = useRef(new Map<number, Pointer>());
  const pinchDistance = useRef(0);
  const moving = useRef<{ id: string; point: SpatialPoint; pointer: Pointer } | null>(null);
  const wheelAnchor = useRef<{ point: SpatialPoint; id: string; time: number } | null>(null);
  const viewNow = useRef(view);
  const renderedView = useRef(view);
  const rememberRenderedView = useCallback((current: SpatialPoint) => { renderedView.current = current; }, []);
  const activeNow = useRef(activeId);
  const spaceNow = useRef(space);
  const abort = useRef<AbortController | null>(null);
  const navigation = useRef(0);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readerFocusFrame = useRef<number | null>(null);
  const answerFocusFrame = useRef<number | null>(null);
  const answerTargets = useRef(new Map<string, string>());
  const cancelReaderFocus = useCallback(() => {
    if (readerFocusFrame.current !== null) cancelAnimationFrame(readerFocusFrame.current);
    readerFocusFrame.current = null;
    if (answerFocusFrame.current !== null) cancelAnimationFrame(answerFocusFrame.current);
    answerFocusFrame.current = null;
  }, []);
  const active = space.explorations[activeId] ?? space.explorations[space.rootId];
  const path = getPath(space, active.id);
  const links = useMemo(() => [
    ...Object.values(space.explorations).filter((item) => item.parentId).map((item) => ({ from: item.parentId!, to: item.id, type: "origin" as const })),
    ...(space.connections ?? []).filter((link) => link.status === "accepted" || connections).filter((link) => link.type === "synthesis" || connections || link.from === activeId || link.to === activeId).map((link) => ({ from: link.from, to: link.to, type: link.type, status: link.status, reason: link.reason })),
  ], [space, activeId, connections]);
  const choices = useMemo(() => choiceParentId ? choiceTopicIds ? choiceTopicIds.map((id) => space.explorations[id]).filter(Boolean) : Object.values(space.explorations).filter((item) => item.parentId === choiceParentId) : [], [choiceParentId, choiceTopicIds, space]);
  const choiceIds = useMemo(() => choiceParentId ? [...new Set([choiceParentId, ...choices.flatMap((item) => getPath(space, item.id).map((ancestor) => ancestor.id)), ...(space.connections ?? []).filter((link) => link.type === "synthesis" && choices.some((item) => item.id === link.to)).map((link) => link.from)])] : undefined, [choiceParentId, choices, space]);
  const pointFor = useCallback((id: string) => presentedNodes.find((node) => node.id === id)?.position ?? { x: 0, y: 0, z: 0 }, [presentedNodes]);
  const size = () => ({ width: stage.current?.clientWidth ?? 1000, height: stage.current?.clientHeight ?? 700 });
  const setCamera = (next: SpatialPoint) => { viewNow.current = next; setView(next); };
  useEffect(() => { viewNow.current = view; activeNow.current = activeId; spaceNow.current = space; }, [view, activeId, space]);
  useEffect(() => {
    const measure = () => { const next = size(); setStageSize((previous) => previous.width === next.width && previous.height === next.height ? previous : next); };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (stage.current) observer?.observe(stage.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const priorStageSize = useRef(stageSize);
  useEffect(() => {
    const changed = priorStageSize.current.width !== stageSize.width || priorStageSize.current.height !== stageSize.height;
    priorStageSize.current = stageSize;
    if (changed && annotationFrame) setCamera(annotationFrame.view);
  }, [stageSize, annotationFrame]);

  const markInteraction = useCallback(() => {
    dismissSelectionPreview(); cancelReaderFocus(); setScrollHint("");
    if (!choiceNow.current) answerTargets.current.delete(activeNow.current);
    navigation.current += 1;
    if (transitionNow.current) {
      // A text edit or selection has no new camera target of its own. Stop an
      // arrival journey at the rendered camera instead of continuing it behind typing.
      setCamera({ ...renderedView.current }); setTransition(null);
    }
  }, [dismissSelectionPreview, cancelReaderFocus, setTransition]);

  const remember = useCallback(() => {
    const id = activeNow.current;
    const canonicalPoint = nodes.find((node) => node.id === id)?.position;
    const readingView = annotationPair && canonicalPoint ? focusView(canonicalPoint, size().width, size().height) : overview || choiceNow.current ? saved.current[id]?.view ?? viewNow.current : viewNow.current;
    saved.current[id] = { view: readingView, draft: draftNow.current, selection: selectionNow.current, annotations: annotationsNow.current, scrollTop: readers.current.get(id)?.scrollTop ?? saved.current[id]?.scrollTop ?? 0 };
  }, [overview, annotationPair, nodes]);

  const snapshot = useCallback((): Snapshot => {
    remember();
    const request = pendingNow.current?.request;
    const recovery = request ? { requestId: request.requestId, activeId: request.activeId, question: request.question, selection: request.selection, includeIds: request.includeIds, annotations: request.annotations } : undefined;
    return { format: "ingx", version: 1, savedAt: new Date().toISOString(), conversation: spaceNow.current, view: { activeId: activeNow.current, view: choiceNow.current ? saved.current[activeNow.current]?.view ?? viewNow.current : viewNow.current, overview: choiceNow.current ? false : overview, started: started || Boolean(request), places: { ...saved.current }, history: [...history.current], positions, ...(annotationPair && !overview && !choiceNow.current ? { annotationPair } : {}), ...(recovery ? { pending: recovery } : {}) } };
  }, [remember, space, active.id, view, overview, started, positions, annotationPair]);
  const snapshotNow = useRef(snapshot);
  useLayoutEffect(() => { snapshotNow.current = snapshot; }, [snapshot]);

  const restore = (next: Snapshot) => {
    abort.current?.abort();
    markInteraction();
    setChoiceParent(null); setAnnotationPair(null);
    setPending(null); setUnreadId(null); setUnreadMessageId(null); unreadTopics.current = [];
    answerTargets.current.clear();
    saved.current = next.view.places;
    history.current = next.view.history;
    let camera = next.view.view;
    if (next.view.annotationPair) {
      const { sourceId, replyId } = next.view.annotationPair;
      const frame = annotationView(layoutSpace(next.conversation, next.view.positions), sourceId, replyId, size().width, size().height);
      if (frame) camera = frame.view;
    }
    if (next.view.started && !next.view.overview && !next.view.annotationPair && !Object.hasOwn(next.view.positions ?? {}, next.view.activeId)) {
      const point = layoutSpace(next.conversation).find((node) => node.id === next.view.activeId)!.position;
      const { width, height } = size();
      const distance = camera.z - point.z;
      const scale = height / (2 * Math.tan(FIELD_OF_VIEW * Math.PI / 360) * distance);
      const x = width / 2 + (point.x - camera.x) * scale;
      const y = height / 2 - (point.y - camera.y) * scale;
      // Older automatic layouts used different coordinates. Keep valid saved
      // views; recover only when their active card would no longer be visible.
      if (distance <= 0 || x + CARD_WIDTH * scale / 2 < 0 || x - CARD_WIDTH * scale / 2 > width || y + CARD_HEIGHT * scale / 2 < 0 || y - CARD_HEIGHT * scale / 2 > height) {
        camera = focusView(point, width, height);
        const place = saved.current[next.view.activeId];
        if (place) saved.current = { ...saved.current, [next.view.activeId]: { ...place, view: camera } };
      }
    }
    spaceNow.current = next.conversation; setSpace(next.conversation);
    activeNow.current = next.view.activeId; setActiveId(next.view.activeId);
    setCamera(camera); setOverview(next.view.overview); setStarted(next.view.started);
    setPositions(next.view.positions ?? {});
    setAnnotationPair(next.view.annotationPair ?? null);
    setDraft(next.view.places[next.view.activeId]?.draft ?? "");
    setSelection(next.view.places[next.view.activeId]?.selection ?? null);
    setAnnotations(next.view.places[next.view.activeId]?.annotations ?? []);
    setIncludeIds([]); setMenu(false); setSavedChats(false); setConnections(false); setNotice("");
    hover.current = null; wheelAnchor.current = null;
    const recovery = next.view.pending;
    const completed = recovery && Object.values(next.conversation.explorations).some((item) => item.messages.some((message) => message.role === "assistant" && message.requestId === recovery.requestId));
    if (recovery && !completed) {
      setPending({ request: { ...recovery, conversation: next.conversation, mode: "auto" }, navigation: -1, error: "This question was interrupted. Retry when you’re ready." });
      if (recovery.activeId !== next.view.activeId) { setNotice("An unfinished question is saved in another topic."); setUnreadId(recovery.activeId); }
    }
  };

  useEffect(() => {
    let cancelled = false;
    // Keep older demo snapshots in the library, but never present one as a new
    // user's conversation. Real saved chats still resume normally.
    loadSnapshot().then((value) => { if (!cancelled && value && value.conversation.kind !== "sample") restore(value); }).catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : "Could not restore the saved conversation."); }).finally(() => { if (!cancelled) setReady(true); });
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update(); query.addEventListener("change", update);
    return () => { cancelled = true; query.removeEventListener("change", update); abort.current?.abort(); cancelReaderFocus(); if (scrollTimer.current) clearTimeout(scrollTimer.current); };
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Model connection is unavailable.");
      setModelStatus(await response.json()); setStatusError("");
    } catch (error) { setStatusError(error instanceof Error ? error.message : "Model connection is unavailable."); }
  }, []);
  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    if (!ready || (!started && !draft && !annotations.length)) return;
    setSaveState("Saving…");
    const timer = setTimeout(() => {
      saveSnapshot(snapshotNow.current()).then(() => setSaveState("Saved locally")).catch((error) => {
        setSaveState("Save failed"); setNotice(error instanceof Error ? error.message : "Could not save. Export an .ingx copy to keep your work.");
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [ready, space, view, activeId, draft, selection, annotations, positions, overview, started, scrollRevision, pending]);

  useEffect(() => {
    const save = () => {
      if (!ready || (!started && !draft && !annotations.length)) return;
      try { backupSnapshot(snapshotNow.current()); }
      catch { setSaveState("Save failed"); setNotice("Could not save the latest changes. Export an .ingx copy before leaving."); }
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") save(); };
    window.addEventListener("pagehide", save); document.addEventListener("visibilitychange", onVisibility);
    return () => { window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", onVisibility); };
  }, [ready, started, draft, annotations]);

  useEffect(() => {
    if (!savedChats) return;
    let cancelled = false;
    listSnapshots().then((items) => { if (!cancelled) setLibrary(items); }).catch(() => { if (!cancelled) setNotice("Could not read saved chats. Your current chat is still open."); });
    return () => { cancelled = true; };
  }, [savedChats, saveState]);

  const revealNewAnswer = useCallback((id: string) => {
    const messageId = answerTargets.current.get(id);
    if (!messageId) return;
    if (answerFocusFrame.current !== null) cancelAnimationFrame(answerFocusFrame.current);
    const generation = navigation.current;
    const deadline = performance.now() + 2200;
    const reveal = () => {
      answerFocusFrame.current = null;
      if (navigation.current !== generation || activeNow.current !== id || choiceNow.current || performance.now() > deadline) return;
      const reader = readers.current.get(id);
      const node = reader?.closest<HTMLElement>("[data-node-id]");
      const answer = reader?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
      if (reader && answer && node?.dataset.detail === "full" && node.style.visibility === "visible" && !node.inert) {
        const scale = reader.getBoundingClientRect().height / reader.offsetHeight;
        if (scale > 0) {
          reader.scrollTop += (answer.getBoundingClientRect().top - reader.getBoundingClientRect().top) / scale - 16;
          answerTargets.current.delete(id);
          if (saved.current[id]) saved.current[id].scrollTop = reader.scrollTop;
          setScrollRevision((value) => value + 1);
          return;
        }
      }
      answerFocusFrame.current = requestAnimationFrame(reveal);
    };
    answerFocusFrame.current = requestAnimationFrame(reveal);
  }, []);

  const focus = useCallback((id: string, withSource = false) => {
    if (switchingNow.current || !space.explorations[id]) return;
    remember(); markInteraction(); setChoiceParent(null);
    if (id !== activeId) pushHistory(activeId);
    const previous = saved.current[id];
    const { width, height } = size();
    const source = space.explorations[id].source;
    const frame = withSource && source ? annotationView(nodes, source.explorationId, id, width, height) : null;
    setAnnotationPair(frame && source ? { sourceId: source.explorationId, replyId: id } : null);
    const point = nodes.find((node) => node.id === id)!.position;
    setCamera(frame?.view ?? focusView(point, width, height));
    activeNow.current = id; setActiveId(id);
    setDraft(previous?.draft ?? ""); setSelection(previous?.selection ?? null); setAnnotations(previous?.annotations ?? []);
    setIncludeIds([]); setStarted(true); setOverview(false); setNotice(""); setUnreadId(null);
    hover.current = id; wheelAnchor.current = null; revealNewAnswer(id);
  }, [activeId, pointFor, remember, space, nodes, revealNewAnswer]);

  const showOverview = useCallback(() => {
    if (switchingNow.current || overview) return;
    remember(); markInteraction(); setChoiceParent(null);
    const { width, height } = size();
    setAnnotationPair(null); setCamera(fitOverview(nodes, width, height)); setStarted(true); setOverview(true);
    hover.current = null; wheelAnchor.current = null;
  }, [nodes, overview, remember]);

  const back = useCallback(() => {
    if (switchingNow.current) return;
    if (!choiceNow.current && !overview && !history.current.length) return;
    markInteraction(); setAnnotationPair(null);
    if (choiceNow.current) { const id = choiceNow.current; focus(id); setCamera(saved.current[id]?.view ?? focusView(pointFor(id), size().width, size().height)); return; }
    if (overview) { setCamera(saved.current[activeId]?.view ?? focusView(pointFor(activeId), size().width, size().height)); setOverview(false); return; }
    const id = history.current.pop();
    if (!id || !space.explorations[id]) return;
    remember();
    const previous = saved.current[id];
    activeNow.current = id; setActiveId(id);
    setCamera(previous?.view ?? focusView(pointFor(id), size().width, size().height));
    setDraft(previous?.draft ?? ""); setSelection(previous?.selection ?? null); setAnnotations(previous?.annotations ?? []); setIncludeIds([]); setOverview(false); setNotice("");
    hover.current = null; wheelAnchor.current = null;
  }, [active.parentId, activeId, overview, pointFor, remember, showOverview, space, focus]);

  const activate = useCallback((id: string) => {
    if (switchingNow.current || id === activeId || !space.explorations[id]) return;
    remember(); markInteraction(); setChoiceParent(null); setAnnotationPair(null); pushHistory(activeId);
    activeNow.current = id; setActiveId(id);
    setDraft(saved.current[id]?.draft ?? ""); setSelection(saved.current[id]?.selection ?? null); setAnnotations(saved.current[id]?.annotations ?? []); setIncludeIds([]); setNotice("");
  }, [activeId, remember, space]);

  const zoom = useCallback((delta: number, anchor?: SpatialPoint, anchorId?: string) => {
    if (switchingNow.current) return;
    markInteraction(); setChoiceParent(null);
    const id = anchorId ?? hover.current ?? activeId;
    const point = anchor ?? pointFor(id);
    const next = zoomView(viewNow.current, point, delta);
    setCamera(next);
    const { width, height } = size();
    const scale = height / (2 * Math.tan(25 * Math.PI / 180) * (next.z - point.z));
    const fullThreshold = Math.min(0.72, Math.max(0.1, (width - 32) / 600 * 0.9));
    if (!annotationFrame && delta < 0 && scale >= fullThreshold) activate(id);
    setOverview(false);
  }, [activeId, activate, pointFor, annotationFrame]);

  const resumeTopic = useCallback((id: string) => {
    const leavingChoice = Boolean(choiceNow.current);
    const previousChoiceFocus = stage.current?.contains(document.activeElement) ? document.activeElement : null;
    focus(id, leavingChoice && id !== choiceNow.current);
    if (leavingChoice) {
      const generation = navigation.current;
      const deadline = performance.now() + 1800;
      const focusWhenReadable = () => {
        readerFocusFrame.current = null;
        if (navigation.current !== generation || activeNow.current !== id || choiceNow.current || performance.now() > deadline) return;
        const reader = readers.current.get(id);
        const node = reader?.closest<HTMLElement>("[data-node-id]");
        const focused = document.activeElement;
        if (focused && focused !== document.body && focused !== previousChoiceFocus && focused !== reader) return;
        if (reader && node?.dataset.detail === "full" && node.style.visibility === "visible" && !node.inert) {
          reader.focus({ preventScroll: true });
        } else readerFocusFrame.current = requestAnimationFrame(focusWhenReadable);
      };
      readerFocusFrame.current = requestAnimationFrame(focusWhenReadable);
    }
  }, [focus, space]);

  useEffect(() => {
    if (!choiceParentId) return;
    // Wait for the existing arrival animation; never take focus from a draft.
    const previousFocus = document.activeElement;
    if (previousFocus !== document.body && !stage.current?.contains(previousFocus)) return;
    const deadline = performance.now() + 1800;
    const generation = navigation.current;
    let frame: number;
    const focusChoice = () => {
      if (navigation.current !== generation || performance.now() > deadline) return;
      if (document.activeElement !== previousFocus && document.activeElement !== document.body) return;
      const button = Array.from(stage.current?.querySelectorAll<HTMLButtonElement>("button[data-graph-choice]") ?? []).find((candidate) => {
        const node = candidate.closest<HTMLElement>("[data-node-id]");
        return node?.style.visibility === "visible" && !node.inert;
      });
      const node = button?.closest<HTMLElement>("[data-node-id]");
      if (button && node?.style.visibility === "visible" && !node.inert) button.focus({ preventScroll: true });
      else frame = requestAnimationFrame(focusChoice);
    };
    frame = requestAnimationFrame(focusChoice);
    return () => cancelAnimationFrame(frame);
  }, [choiceParentId, choiceTopicIds]);

  const exploreChildren = useCallback((id: string) => {
    if (switchingNow.current || !space.explorations[id]) return;
    const children = Object.values(space.explorations).filter((item) => item.parentId === id);
    if (activeNow.current !== id) focus(id);
    remember(); markInteraction();
    if (!children.length) { setScrollHint("Ask a follow-up to explore further."); return; }
    if (children.length === 1) { resumeTopic(children[0].id); return; }
    setAnnotationPair(null); setChoiceParent(id); setOverview(false);
    const ids = new Set([id, ...children.map((item) => item.id)]);
    setCamera(fitOverview(nodes.filter((node) => ids.has(node.id)), size().width, size().height));
    hover.current = null; wheelAnchor.current = null;
  }, [space, focus, remember, markInteraction, resumeTopic, nodes, setChoiceParent]);

  useEffect(() => {
    const element = stage.current;
    if (!element || !started) return;
    const wheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement;
      if (switchingNow.current) return;
      // Leave horizontal tables/code and trackpad gestures with their native owner.
      if (event.shiftKey || (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY))) { markInteraction(); return; }
      const now = performance.now();
      const delta = normalizeWheel(event.deltaY, event.deltaMode);
      if (!delta) return;
      if (event.ctrlKey) {
        if (event.cancelable) event.preventDefault();
        if (!wheelAnchor.current || now - wheelAnchor.current.time > 180) {
          const id = target.closest<HTMLElement>("[data-topic]")?.dataset.topic ?? hover.current ?? activeNow.current;
          wheelAnchor.current = { point: pointFor(id), id, time: now };
        }
        wheelAnchor.current.time = now;
        zoom(delta * 2, wheelAnchor.current.point, wheelAnchor.current.id);
        return;
      }
      markInteraction();
      const topic = target.closest<HTMLElement>("[data-topic]");
      const gesture = advanceSpatialScroll(spatialScroll.current, {
        time: now, delta, owner: topic ? "topic" : "space",
        scope: `${space.id}:${choiceNow.current ? `choice:${choiceNow.current}` : overview ? "overview" : activeNow.current}`,
      });
      spatialScroll.current = gesture.state;
      if (topic) {
        // The entire card owns reading, including its header and padding.
        const node = topic.closest<HTMLElement>("[data-node-id]");
        if (node?.dataset.detail === "full" && target.closest(".topic-reading")) return;
        if (event.cancelable) event.preventDefault();
        const reader = readers.current.get(topic.dataset.topic!);
        if (reader && node?.dataset.detail === "full") {
          reader.scrollTop = Math.max(0, Math.min(reader.scrollHeight - reader.clientHeight, reader.scrollTop + delta));
          if (saved.current[topic.dataset.topic!]) saved.current[topic.dataset.topic!].scrollTop = reader.scrollTop;
          remember();
        }
        return;
      }
      if (event.cancelable) event.preventDefault();
      if (!gesture.direction) return;
      if (gesture.direction < 0) {
        if (choiceNow.current) { resumeTopic(choiceNow.current); return; }
        if (overview) return;
        const parent = space.explorations[activeNow.current]?.parentId;
        if (parent) resumeTopic(parent);
        else showOverview();
        return;
      }
      if (choiceNow.current) { setScrollHint("Choose a topic in the graph. Scroll up to return."); return; }
      const node = readers.current.get(activeNow.current)?.closest<HTMLElement>("[data-node-id]");
      if (overview || node?.dataset.detail !== "full" || node.style.visibility !== "visible") {
        focus(activeNow.current);
        return;
      }
      exploreChildren(activeNow.current);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [space, pointFor, started, zoom, overview, choiceParentId, markInteraction, remember, resumeTopic, focus, showOverview, exploreChildren]);

  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || switchingNow.current) return;
      if (event.key === "Escape") {
        if (selectionPreview) { event.preventDefault(); dismissSelectionPreview(); return; }
        if (help || menu || savedChats || connections || showAccess) { setHelp(false); setMenu(false); setSavedChats(false); setConnections(false); setShowAccess(false); }
        else if (choiceNow.current) resumeTopic(choiceNow.current);
        else if (["TEXTAREA", "INPUT"].includes(target.tagName)) { target.blur(); }
        else if (started) back();
        return;
      }
      if (["TEXTAREA", "INPUT", "SELECT"].includes(target.tagName) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (choiceNow.current && target.closest("button[data-graph-choice]") && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const buttons = Array.from(stage.current?.querySelectorAll<HTMLButtonElement>("button[data-graph-choice]") ?? []).filter((candidate) => {
          const node = candidate.closest<HTMLElement>("[data-node-id]");
          return node?.style.visibility === "visible" && !node.inert;
        });
        const index = buttons.indexOf(target.closest<HTMLButtonElement>("button[data-graph-choice]")!);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
        return;
      }
      if (target.closest(".topic-reading") && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) markInteraction();
      if (event.key === "/") { event.preventDefault(); composer.current?.focus(); }
      if (!started) return;
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(-180); }
      if (event.key === "-") { event.preventDefault(); zoom(180); }
      if (event.key === "0") { event.preventDefault(); showOverview(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [back, help, menu, savedChats, connections, showAccess, showOverview, started, zoom, selectionPreview, dismissSelectionPreview, resumeTopic, markInteraction]);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (switchingNow.current) return;
    const target = event.target as HTMLElement;
    const moveId = target.closest<HTMLElement>("[data-move-topic]")?.dataset.moveTopic;
    if (event.button !== 0) return;
    if (!moveId && target.closest("[data-topic]")) { markInteraction(); return; }
    if (!moveId && target.closest("button, textarea")) return;
    markInteraction();
    if (!pointers.current.size) setCamera({ ...renderedView.current });
    if (moveId) { event.preventDefault(); moving.current = { id: moveId, point: pointFor(moveId), pointer: { x: event.clientX, y: event.clientY } }; }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
    if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinchDistance.current = Math.hypot(a.x - b.x, a.y - b.y); }
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const focal = size().height / (2 * Math.tan(25 * Math.PI / 180));
    if (moving.current) {
      const { id, point, pointer } = moving.current;
      if (annotationPair?.sourceId === id) activate(id);
      setAnnotationPair(null);
      const scale = Math.max(0.05, focal / Math.max(100, renderedView.current.z - point.z));
      setPositions((current) => ({ ...current, [id]: { x: Math.max(-1e6, Math.min(1e6, point.x + (event.clientX - pointer.x) / scale)), y: Math.max(-1e6, Math.min(1e6, point.y - (event.clientY - pointer.y) / scale)), z: point.z } }));
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance.current > 0 && distance > 0) zoom(Math.log(pinchDistance.current / distance) * 650);
      pinchDistance.current = distance;
    } else {
      const current = viewNow.current;
      const scale = Math.max(0.1, focal / Math.max(100, renderedView.current.z - pointFor(activeId).z));
      setCamera({ ...current, x: current.x - (event.clientX - previous.x) / scale, y: current.y + (event.clientY - previous.y) / scale });
    }
  };
  const captureSelection = useCallback((explicit = false) => {
    if (selectionTimer.current) clearTimeout(selectionTimer.current);
    selectionTimer.current = null;
    if (switchingNow.current) { dismissSelectionPreview(); return; }
    if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) { dismissSelectionPreview(); return; }
    const chosen = window.getSelection();
    if (!chosen || chosen.isCollapsed || !chosen.rangeCount) {
      // Keyboard focus on the action can collapse a browser's native selection.
      // The captured source remains valid until the user chooses or dismisses it.
      if (document.activeElement !== selectionAction.current) dismissSelectionPreview();
      return;
    }
    const range = chosen.getRangeAt(0);
    const dismissed = dismissedRange.current;
    if (!explicit && dismissed && range.startContainer === dismissed.startContainer && range.startOffset === dismissed.startOffset && range.endContainer === dismissed.endContainer && range.endOffset === dismissed.endOffset) return;
    const element = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    if (element(range.startContainer)?.closest("[data-no-selection]") || element(range.endContainer)?.closest("[data-no-selection]")) { dismissSelectionPreview(); return; }
    const start = element(range.startContainer)?.closest<HTMLElement>("[data-section-id]");
    const end = element(range.endContainer)?.closest<HTMLElement>("[data-section-id]");
    const answer = start?.closest<HTMLElement>("[data-message-id]");
    if (!start || !end || !answer || !stage.current?.contains(answer) || answer !== end.closest("[data-message-id]")) { dismissSelectionPreview(); return; }
    const quote = selectedAnswerText(range);
    if (!quote) { dismissSelectionPreview(); return; }
    if (quote.length > 12000) { dismissSelectionPreview(); setNotice("Select a shorter passage, up to 12,000 characters."); return; }
    const id = answer.dataset.explorationId!;
    const message = spaceNow.current.explorations[id]?.messages.find((item) => item.id === answer.dataset.messageId);
    if (!message || message.role !== "assistant" || !normalizeText(messageText(message)).includes(quote)) { dismissSelectionPreview(); setNotice("That selection crosses content outside the answer. Select the passage again."); return; }
    const bounds = stage.current.getBoundingClientRect();
    const reader = start.closest(".topic-reading")?.getBoundingClientRect() ?? bounds;
    const viewport = window.visualViewport;
    const left = Math.max(0, viewport?.offsetLeft ?? 0, bounds.left, reader.left);
    const right = Math.min((viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth), bounds.right, reader.right);
    const top = Math.max(0, viewport?.offsetTop ?? 0, bounds.top, reader.top);
    const bottom = Math.min((viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight), bounds.bottom, reader.bottom);
    const rects = typeof range.getClientRects === "function" ? Array.from(range.getClientRects()) : [];
    const visible = rects.filter((rect) => rect.width > 0 && rect.height > 0 && rect.right > left && rect.left < right && rect.bottom > top && rect.top < bottom);
    const rect = visible[visible.length - 1] ?? (typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : start.getBoundingClientRect());
    if (rect.bottom <= top || rect.top >= bottom || rect.right <= left || rect.left >= right || right <= left || bottom <= top) { dismissSelectionPreview(); return; }
    const width = 156;
    const height = 36;
    const viewportLeft = Math.max(bounds.left, viewport?.offsetLeft ?? 0);
    const viewportRight = Math.min(bounds.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth));
    const x = Math.max(viewportLeft + 8, Math.min((rect.left + rect.right) / 2 - width / 2, viewportRight - width - 8));
    const y = Math.max(top + 8, Math.min(rect.top - height - 8 >= top ? rect.top - height - 8 : rect.bottom + 8, bottom - height - 8));
    markInteraction();
    dismissedRange.current = null;
    setSelectionPreview({ source: { explorationId: id, messageId: message.id, sectionId: start.dataset.sectionId!, ...(end !== start ? { endSectionId: end.dataset.sectionId! } : {}), quote }, x, y });
    setNotice("");
  }, [dismissSelectionPreview, markInteraction]);

  useEffect(() => {
    // Touch selection handles can settle after pointerup. Debounce their native
    // selectionchange events without moving focus or attaching a quote yet.
    const changed = () => {
      if (selectionTimer.current) clearTimeout(selectionTimer.current);
      selectionTimer.current = setTimeout(captureSelection, 120);
    };
    const outside = (event: globalThis.PointerEvent) => {
      if (!selectionAction.current?.contains(event.target as Node)) dismissSelectionPreview();
    };
    document.addEventListener("selectionchange", changed);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", dismissSelectionPreview, true);
    window.addEventListener("resize", dismissSelectionPreview);
    window.visualViewport?.addEventListener("resize", dismissSelectionPreview);
    window.visualViewport?.addEventListener("scroll", dismissSelectionPreview);
    return () => {
      if (selectionTimer.current) clearTimeout(selectionTimer.current);
      document.removeEventListener("selectionchange", changed);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", dismissSelectionPreview, true);
      window.removeEventListener("resize", dismissSelectionPreview);
      window.visualViewport?.removeEventListener("resize", dismissSelectionPreview);
      window.visualViewport?.removeEventListener("scroll", dismissSelectionPreview);
    };
  }, [captureSelection, dismissSelectionPreview]);
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const wasDragging = pointers.current.has(event.pointerId);
    pointers.current.delete(event.pointerId); pinchDistance.current = 0; moving.current = null;
    if (!pointers.current.size) setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!wasDragging) captureSelection(true);
  };

  const runRequest = async (task: Pending) => {
    if (switchingNow.current || task.request.conversation.id !== spaceNow.current.id) return;
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    setPending({ ...task, error: undefined }); setNotice("");
    unreadTopics.current = []; setUnreadId(null); setUnreadMessageId(null);
    try {
      const response = await fetch("/api/answer", { method: "POST", headers: { "Content-Type": "application/json", ...(accessCode ? { "x-demo-code": accessCode } : {}) }, body: JSON.stringify(task.request), signal: controller.signal });
      const payload = await response.json().catch(() => null);
      if (controller.signal.aborted || spaceNow.current.id !== task.request.conversation.id) return;
      if (!payload) throw new Error("The server returned an unreadable response. Your question is preserved.");
      if (!response.ok) { if (response.status === 401) setShowAccess(true); throw new Error(payload.error || "The answer could not be generated. Please retry."); }
      const result = payload as AnswerResult;
      if (result.requestId !== task.request.requestId) throw new Error("The response did not match this question. Please retry.");
      if (controller.signal.aborted || spaceNow.current.id !== task.request.conversation.id) return;
      const before = spaceNow.current;
      const applied = applyAnswer(before, task.request, result);
      snapshotNow.current();
      spaceNow.current = applied.conversation; setSpace(applied.conversation);
      setPending(null);
      const follow = activeNow.current === task.request.activeId && navigation.current === task.navigation;
      const topicIds = applied.topicIds ?? [];
      topicIds.forEach((id, index) => answerTargets.current.set(id, `topic-answer-${task.request.requestId}-${index}`));
      const newTopicIds = topicIds.filter((id) => !before.explorations[id]);
      if (!topicIds.length && !before.explorations[applied.destinationId]) setTransition({ key: task.request.requestId, fromId: task.request.activeId, toId: applied.destinationId, follow });
      if (follow) {
        setAnnotationPair(null);
        if (applied.destinationId !== task.request.activeId) pushHistory(task.request.activeId);
        activeNow.current = applied.destinationId; setActiveId(applied.destinationId);
        setDraft(saved.current[applied.destinationId]?.draft ?? ""); setSelection(null); setAnnotations(saved.current[applied.destinationId]?.annotations ?? []); setIncludeIds([]); setOverview(false);
        const destination = layoutSpace(applied.conversation, positions).find((node) => node.id === applied.destinationId)!;
        const scopedId = topicIds.length === 1 ? topicIds[0] : !topicIds.length ? applied.destinationId : null;
        const scopedTopic = scopedId ? applied.conversation.explorations[scopedId] : null;
        const currentSource = scopedTopic?.messages.find((message) => message.role === "assistant" && (message.id === `answer-${task.request.requestId}` || message.id.startsWith(`topic-answer-${task.request.requestId}-`)))?.source;
        const scopedSource = scopedTopic?.source && (!currentSource || JSON.stringify(currentSource) === JSON.stringify(scopedTopic.source)) ? scopedTopic.source : null;
        if (scopedId && scopedSource) {
          if (scopedId !== applied.destinationId) pushHistory(applied.destinationId);
          const frame = annotationView(layoutSpace(applied.conversation, positions), scopedSource.explorationId, scopedId, size().width, size().height);
          activeNow.current = scopedId; setActiveId(scopedId); setChoiceParent(null);
          setDraft(saved.current[scopedId]?.draft ?? ""); setAnnotations(saved.current[scopedId]?.annotations ?? []);
          setAnnotationPair({ sourceId: scopedSource.explorationId, replyId: scopedId });
          if (frame) setCamera(frame.view);
          revealNewAnswer(scopedId);
          setTransition({ key: task.request.requestId, fromId: scopedSource.explorationId, toId: scopedId, toIds: [scopedId], follow: true });
        } else if (topicIds.length) {
          showAnswerTopics(applied.conversation, applied.destinationId, topicIds);
          if (newTopicIds.length) setTransition({ key: task.request.requestId, fromId: task.request.activeId, toId: newTopicIds[0], toIds: newTopicIds, follow: true });
        }
        else setCamera(focusView(destination.position, size().width, size().height));
        if (!task.request.selection && !task.request.annotations?.length) requestAnimationFrame(() => {
          const reader = readers.current.get(applied.destinationId);
          const answer = reader?.querySelector<HTMLElement>(`[data-message-id="answer-${CSS.escape(task.request.requestId)}"]`);
          if (reader && answer) {
            const scale = reader.getBoundingClientRect().height / reader.offsetHeight;
            reader.scrollTop += (answer.getBoundingClientRect().top - reader.getBoundingClientRect().top) / scale - 16;
          }
        });
      } else {
        if (newTopicIds.length) setTransition({ key: task.request.requestId, fromId: task.request.activeId, toId: newTopicIds[0], toIds: newTopicIds, follow: false });
        unreadTopics.current = topicIds; setUnreadId(applied.destinationId); setUnreadMessageId(`answer-${task.request.requestId}`); setNotice(topicIds.length ? `Your answer is ready in ${topicIds.length} ${topicIds.length === 1 ? "topic" : "topics"}.` : "Your answer is ready.");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "The request failed. Your question is preserved.";
      unreadTopics.current = [];
      setPending({ ...task, error: message });
      if (activeNow.current !== task.request.activeId) { setNotice("The question in another topic needs a retry."); setUnreadId(task.request.activeId); setUnreadMessageId(null); }
    }
  };

  const showAnswerTopics = (conversation: Conversation, originId: string, topicIds: string[]) => {
    setTransition(null); setAnnotationPair(null); setChoiceParent(originId, topicIds); setOverview(false);
    const ids = new Set([originId, ...topicIds.flatMap((id) => getPath(conversation, id).map((item) => item.id)), ...(conversation.connections ?? []).filter((link) => link.type === "synthesis" && topicIds.includes(link.to)).map((link) => link.from)]);
    const laidOut = layoutSpace(conversation, positions);
    setCamera(fitOverview(laidOut.filter((node) => ids.has(node.id)), size().width, size().height));
    hover.current = null; wheelAnchor.current = null;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (switchingNow.current || (!draftNow.current.trim() && !annotationsNow.current.length) || !ready) return;
    if (pendingNow.current) { setNotice("Retry or dismiss the unfinished question before sending another."); return; }
    const text = draftNow.current.trim();
    const source = selectionNow.current;
    const batch = [...annotationsNow.current];
    if (batch.length && source) {
      if (!text) { setNotice("Write a question for the selected passage, or clear the selection."); composer.current?.focus(); return; }
      batch.push({ id: crypto.randomUUID(), source, question: text });
    }
    if (batch.length > 6 || batch.some((item) => !item.question.trim() || item.question.length > 8000) || batch.reduce((sum, item) => sum + item.question.length, 0) > 24000) {
      setNotice("Add a question to every annotation. Send up to 6 at once, with 24,000 characters in total."); return;
    }
    try { if (batch.length) validateAnnotations(batch, spaceNow.current); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Check the selected passages before sending."); return; }
    const question = batch.length && source || !text ? "Answer each annotated question separately." : text;
    if (question.length > 8000) { setNotice("Keep the question below 8,000 characters."); return; }
    if (choiceNow.current) resumeTopic(activeNow.current);
    markInteraction(); remember();
    const originId = batch.length ? activeNow.current : source?.explorationId ?? activeNow.current;
    const request: AnswerRequest = { requestId: crypto.randomUUID(), conversation: spaceNow.current, activeId: originId, question, selection: batch.length ? null : source, ...(batch.length ? { annotations: batch } : {}), mode: "auto", includeIds };
    // Submitted annotations belong to this request. New drafts remain independent.
    setDraft(""); setSelection(null); setAnnotations([]); setIncludeIds([]);
    saved.current[activeNow.current] = { ...saved.current[activeNow.current], draft: "", selection: null, annotations: [] };
    setStarted(true);
    if (!started) setCamera(focusView(pointFor(originId), size().width, size().height));
    void runRequest({ request, navigation: navigation.current });
    // Preserve the source passage while a scoped answer is being generated.
    if (!source && !batch.length) requestAnimationFrame(() => { const reader = readers.current.get(originId); if (reader) reader.scrollTop = reader.scrollHeight; });
  };
  const cancel = () => {
    abort.current?.abort();
    const task = pendingNow.current;
    if (task) setPending({ ...task, error: "Stopped. Retry when you’re ready." });
  };
  const dismissPending = () => { abort.current?.abort(); setPending(null); setNotice(""); };
  const composerKeydown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
  };

  const resetLayout = () => {
    if (switchingNow.current || !started) return;
    remember(); markInteraction(); setChoiceParent(null); setAnnotationPair(null);
    const { width, height } = size();
    for (const node of baseNodes) {
      const place = saved.current[node.id];
      if (place) saved.current[node.id] = { ...place, view: focusView(node.position, width, height) };
    }
    setPositions({}); setCamera(fitOverview(baseNodes, width, height)); setOverview(true);
    hover.current = null; wheelAnchor.current = null; setMenu(false);
  };

  const keepCurrent = async () => { if (started || draft || annotations.length) await saveSnapshot(snapshot()); };
  const openFresh = async () => {
    if (!ready || switchingNow.current || (pending && !pending.error)) return;
    switchingNow.current = true; setSwitching(true);
    try {
      await keepCurrent();
      const conversation = createConversation();
      restore({ format: "ingx", version: 1, savedAt: new Date().toISOString(), conversation, view: { activeId: conversation.rootId, view: focusView({ x: 0, y: 0, z: 0 }, size().width, size().height), overview: false, started: false, places: {}, history: [], positions: {} } });
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save this conversation before switching."); }
    finally { switchingNow.current = false; setSwitching(false); }
  };
  const openSaved = async (id: string) => {
    if (!ready || switchingNow.current || (pending && !pending.error)) return;
    switchingNow.current = true; setSwitching(true);
    try { await keepCurrent(); const value = await loadSnapshot(id); if (!value) throw new Error("That saved conversation is no longer available."); restore(value); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not open this conversation."); }
    finally { switchingNow.current = false; setSwitching(false); }
  };
  const openUnread = () => {
    if (!unreadId) return;
    const id = unreadId;
    const messageId = unreadMessageId;
    const topicIds = unreadTopics.current;
    focus(id);
    if (topicIds.length) { showAnswerTopics(spaceNow.current, id, topicIds); unreadTopics.current = []; return; }
    requestAnimationFrame(() => {
      const reader = readers.current.get(id);
      if (!reader) return;
      const answer = messageId && reader.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
      if (answer) {
        const scale = reader.getBoundingClientRect().height / reader.offsetHeight;
        reader.scrollTop += (answer.getBoundingClientRect().top - reader.getBoundingClientRect().top) / scale - 16;
      } else reader.scrollTop = reader.scrollHeight;
    });
  };
  const exportFile = () => {
    try {
      const content = serializeSnapshot(snapshot());
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `${space.title.replace(/[^a-z0-9 -]/gi, "").trim().slice(0, 60) || "conversation"}.ingx`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setMenu(false);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not export this conversation."); }
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !ready || switchingNow.current || (pending && !pending.error)) return;
    switchingNow.current = true; setSwitching(true);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Choose an .ingx file smaller than 2 MB.");
      const parsed = parseSnapshot(await file.text());
      parsed.conversation.id = `space-${crypto.randomUUID()}`;
      parsed.savedAt = new Date().toISOString();
      await keepCurrent(); await saveSnapshot(parsed); restore(parsed);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not open this file. Your current conversation is unchanged."); }
    finally { switchingNow.current = false; setSwitching(false); }
  };
  const acceptConnection = (id: string) => {
    if (switchingNow.current) return;
    setSpace((current) => ({ ...current, connections: current.connections?.map((link) => link.id === id ? { ...link, status: "accepted" } : link) }));
  };
  const dismissConnection = (id: string) => { if (switchingNow.current) return; setSpace((current) => ({ ...current, connections: current.connections?.filter((link) => link.id !== id) })); };
  const queueAnnotation = () => {
    const source = selectionNow.current;
    const question = draftNow.current.trim();
    if (!source || !question) return false;
    if (annotationsNow.current.length >= 6) { setNotice("Send these six annotations before adding another."); return false; }
    setAnnotations([...annotationsNow.current, { id: crypto.randomUUID(), source, question }]);
    setSelection(null); setDraft("");
    return true;
  };
  const chooseSection = (source: SourceReference) => {
    if (switchingNow.current) return;
    markInteraction();
    if (selectionNow.current && draftNow.current.trim() && !queueAnnotation()) return;
    if (annotationsNow.current.length >= 6) { setNotice("Send these six annotations before adding another."); return; }
    if (choiceNow.current) resumeTopic(source.explorationId);
    else if (!annotationsNow.current.length && source.explorationId !== activeId) activate(source.explorationId);
    setSelection(source); setNotice(""); composer.current?.focus();
  };
  const openSource = (source: SourceReference) => {
    if (switchingNow.current) return;
    const conversationId = space.id;
    focus(source.explorationId);
    const generation = navigation.current;
    const deadline = performance.now() + 2200;
    const reveal = () => {
      readerFocusFrame.current = null;
      if (navigation.current !== generation || performance.now() > deadline || switchingNow.current || spaceNow.current.id !== conversationId || activeNow.current !== source.explorationId) return;
      const reader = readers.current.get(source.explorationId);
      const node = reader?.closest<HTMLElement>("[data-node-id]");
      const section = reader?.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(source.sectionId)}"]`);
      if (reader && section && node?.dataset.detail === "full" && !node.inert && node.style.visibility === "visible") {
        const scale = reader.getBoundingClientRect().height / reader.offsetHeight;
        if (scale > 0) {
          reader.scrollTop += (section.getBoundingClientRect().top - reader.getBoundingClientRect().top) / scale - 12;
          section.classList.remove("source-revealed");
          void section.offsetWidth;
          section.classList.add("source-revealed");
          return;
        }
      }
      readerFocusFrame.current = requestAnimationFrame(reveal);
    };
    readerFocusFrame.current = requestAnimationFrame(reveal);
  };
  const selectedMessage = selection && space.explorations[selection.explorationId]?.messages.find((message) => message.id === selection.messageId);
  const selectionLabel = selection?.quote ?? selectedMessage?.sections.find((section) => section.id === selection?.sectionId)?.title;
  const suggestions = (space.connections ?? []).filter((link) => link.from === activeId || link.to === activeId);

  return <main className={`space ${annotations.length ? "has-annotations" : ""}`} aria-busy={switching}>
    <header className="topbar">
      <button className="wordmark" onClick={() => started ? showOverview() : composer.current?.focus()}>metafor</button>
      <div className="top-actions">
        <button onClick={() => void openFresh()} disabled={!ready || switching || Boolean(pending && !pending.error)}>New chat</button>
        <button onClick={() => { setSavedChats(!savedChats); setMenu(false); }} disabled={!ready || switching} aria-expanded={savedChats}>Saved chats</button>
        {started && <button onClick={showOverview} aria-label="Conversation map" title="Conversation map · 0">Conversation map</button>}
        <button onClick={() => { setMenu(!menu); setSavedChats(false); }} aria-label="Conversation menu" aria-expanded={menu}>⋯</button>
      </div>
    </header>
    {started && <nav className="breadcrumbs" aria-label="Conversation path"><button onClick={back} aria-label="Return to previous view" disabled={!overview && !choiceParentId && !history.current.length}>← Back</button>{path.map((item, index) => <span key={item.id}>{index > 0 && <i>/</i>}<button onClick={() => focus(item.id)} aria-current={item.id === activeId ? "page" : undefined}>{item.title}</button></span>)}</nav>}
    {help && <aside className="help-panel"><button onClick={() => setHelp(false)} aria-label="Close navigation help">×</button><p>Scroll inside a topic to read. Scroll in empty space down to explore details, or up toward the parent and overview. When several paths appear, choose a title in the graph. Reading inside a topic never changes your place in the graph.</p><p>Drag empty space to move around. Drag a topic’s ⠿ handle to place it.</p><p>Select a passage, click “Ask about this”, and write a question. Select another passage to queue the first annotation. Send them together for separate linked replies.</p><p>Use the left marks to preview and jump. ↑ / ↓ and Enter work when the rail is focused.</p><p>Back returns to your previous view. The breadcrumb names take you up the topic hierarchy. Conversation map shows the whole conversation. Hover or focus a dot to preview its title. Pinch, Ctrl + scroll, or + / − zoom freely. Esc returns. 0 opens the conversation map.</p><button onClick={resetLayout} disabled={!started}>Reset layout</button></aside>}
    {savedChats && <aside className="saved-chats-panel" aria-label="Saved chats">
      <div className="panel-heading"><span>Saved chats</span><button onClick={() => setSavedChats(false)} aria-label="Close saved chats">×</button></div>
      <p className="panel-explainer">Saved in this browser.</p>
      <div className="saved-spaces">{library.length ? library.map((item) => <button key={item.id} onClick={() => void openSaved(item.id)} disabled={switching || Boolean(pending && !pending.error)} aria-current={item.id === space.id ? "page" : undefined}>{item.title}<small>{new Date(item.savedAt).toLocaleDateString()}</small></button>) : <p>No saved chats yet.</p>}</div>
    </aside>}
    {menu && <aside className="space-menu" aria-label="Conversation actions">
      {started && <button onClick={() => { setConnections(!connections); setMenu(false); }} aria-expanded={connections}>Connections{suggestions.filter((link) => link.status === "suggested").length > 0 && <span>{suggestions.filter((link) => link.status === "suggested").length}</span>}</button>}
      <button onClick={() => { setHelp(!help); setMenu(false); }} aria-label="Navigation help">Navigation help</button>
      {started && <button onClick={resetLayout}>Reset layout</button>}
      <div className="menu-rule" />
      <button onClick={() => fileInput.current?.click()} disabled={Boolean(pending && !pending.error)}>Open .ingx</button>
      <button onClick={exportFile} disabled={!started && !draft}>Export .ingx</button>
      <div className="menu-rule" /><p className="model-status">{statusError || (modelStatus?.configured ? `${modelStatus.model} connected` : "Add MODEL_API_KEY in .env.local to connect Meta.")}</p><button onClick={() => void refreshStatus()}>Check connection</button>
      {modelStatus?.accessCodeRequired && <button onClick={() => { setShowAccess(true); setMenu(false); }}>Demo access code</button>}
    </aside>}
    {connections && <aside className="connections-panel"><div className="panel-heading"><span>Connections</span><button onClick={() => setConnections(false)} aria-label="Close connections">×</button></div><p className="panel-explainer">Arrows show where a discussion began. Related topics can be included in your next question.</p>
      {suggestions.length === 0 && <p className="panel-explainer">No suggested relationships for this topic yet.</p>}
      {suggestions.map((link) => { const otherId = link.from === activeId ? link.to : link.from; return <div className="connection-item" key={link.id}><button onClick={() => focus(otherId)}>{space.explorations[otherId]?.title} ↗</button><p>{link.reason}</p><div>{link.status === "suggested" && <button onClick={() => acceptConnection(link.id)}>Keep connection</button>}<button onClick={() => dismissConnection(link.id)}>Remove</button></div></div>; })}
      <p className="menu-caption">Include in next question · up to 8</p><div className="context-picker">{Object.values(space.explorations).filter((item) => item.id !== activeId).map((item) => <label key={item.id}><input type="checkbox" checked={includeIds.includes(item.id)} disabled={includeIds.length >= 8 && !includeIds.includes(item.id)} onChange={(event) => { markInteraction(); setIncludeIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)); }} />{item.title}</label>)}</div>
    </aside>}
    <input ref={fileInput} className="sr-only" type="file" accept=".ingx,application/json" onChange={importFile} aria-label="Import conversation file" />
    <div ref={stage} data-choice-parent={choiceParentId ?? undefined} className={`world-stage ${dragging ? "is-dragging" : ""}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onKeyUp={(event) => { if (event.shiftKey) captureSelection(true); }}>
      <SpatialWorld nodes={started ? presentedNodes : []} links={started ? links : []} activeId={overview || choiceParentId ? undefined : activeId} view={view} reducedMotion={reducedMotion} onViewChange={rememberRenderedView} transition={transition} visibleIds={choiceIds ?? annotationFrame?.visibleIds} fullDetailIds={annotationFrame?.visibleIds} compact={overview || Boolean(choiceParentId)}>
        {(node) => <TopicCard key={node.id} space={space} item={space.explorations[node.id]} active={node.id === activeId} selection={selection} annotations={annotations.length ? annotations : pending?.request.annotations} pendingQuestion={pending?.request.activeId === node.id ? pending.request.annotations?.map((item, index) => `${index + 1}. ${item.question}`).join("\n") ?? pending.request.question : undefined} pendingError={pending?.request.activeId === node.id ? pending.error : undefined} onRetry={() => { if (pending) void runRequest(pending); }} onCancel={cancel} onDismiss={dismissPending} graphChoice={Boolean(choiceParentId && choices.some((item) => item.id === node.id))} onFocus={() => choiceNow.current ? resumeTopic(node.id) : focus(node.id)} onHover={(id) => { hover.current = id; }} onSelect={chooseSection} onOpen={(id) => focus(id, true)} onExplore={() => exploreChildren(node.id)} onSource={openSource} readingRef={(element) => {
          if (element) { if (!readers.current.has(node.id)) element.scrollTop = saved.current[node.id]?.scrollTop ?? 0; readers.current.set(node.id, element); }
          else readers.current.delete(node.id);
        }} onScroll={(top) => {
          if (saved.current[node.id]) saved.current[node.id].scrollTop = top;
          else saved.current[node.id] = { view: focusView(node.position, size().width, size().height), draft: "", selection: null, scrollTop: top };
          if (scrollTimer.current) clearTimeout(scrollTimer.current);
          scrollTimer.current = setTimeout(() => setScrollRevision((value) => value + 1), 250);
        }} />}
      </SpatialWorld>
      {!started && <div className="welcome"><h1>What’s on your mind?</h1></div>}
    </div>
    {selectionPreview && <button ref={selectionAction} type="button" className="selection-action" style={{ left: selectionPreview.x, top: selectionPreview.y }} onPointerDown={(event) => event.preventDefault()} onClick={() => { chooseSection(selectionPreview.source); window.getSelection()?.removeAllRanges(); }}><span aria-hidden="true">↳</span> Ask about this</button>}
    {(scrollHint || choiceParentId) && <p className="scroll-boundary-hint" role="status">{scrollHint || `${choices.length} topics · Choose a title to explore · Scroll up to return`}</p>}
    {started && <div className="zoom-controls" aria-label="Spatial navigation"><button onClick={() => zoom(220)} aria-label="Zoom out">−</button><button onClick={() => zoom(-220)} aria-label="Zoom in">+</button><button onClick={() => focus(activeId)} aria-label="Center current topic">⌖</button></div>}
    {started && <NavigationRail items={Object.values(space.explorations)} activeId={activeId} onNavigate={focus} />}
    {started && <SpaceMap nodes={presentedNodes} links={links} activeId={activeId} view={view} labels={Object.fromEntries(Object.values(space.explorations).map((item) => [item.id, item.title]))} onNavigate={focus} onOverview={showOverview} />}
    <div className="composer-dock">
      {notice && <p className="composer-notice" role="status">{notice}{unreadId && <button onClick={openUnread}>Open answer ↗</button>}<button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></p>}
      {annotations.length > 0 && <section className="annotation-queue" aria-label="Queued annotations">
        <div className="annotation-queue-heading"><span>{annotations.length} {annotations.length === 1 ? "annotation" : "annotations"} ready</span><span>Select another passage to add</span></div>
        <div className="annotation-queue-list">{annotations.map((item, index) => <div className="annotation-draft" key={item.id}>
          <button className="annotation-number" aria-label={`Show source for annotation ${index + 1}`} onClick={() => openSource(item.source)}>{index + 1}</button>
          <div><p>{item.source.quote ?? space.explorations[item.source.explorationId]?.messages.find((message) => message.id === item.source.messageId)?.sections.find((section) => section.id === item.source.sectionId)?.title ?? "Selected section"}</p><textarea aria-label={`Question for annotation ${index + 1}`} value={item.question} rows={1} maxLength={8000} onChange={(event) => { markInteraction(); setAnnotations(annotationsNow.current.map((entry) => entry.id === item.id ? { ...entry, question: event.target.value } : entry)); }} /></div>
          <button aria-label={`Remove annotation ${index + 1}`} onClick={() => { markInteraction(); setAnnotations(annotationsNow.current.filter((entry) => entry.id !== item.id)); }}>×</button>
        </div>)}</div>
        <button className="send-annotations" type="button" disabled={Boolean(pending && !pending.error)} onClick={() => composer.current?.form?.requestSubmit()}>Send {annotations.length + (selection && draft.trim() ? 1 : 0)} annotations ↑</button>
      </section>}
      {selection && <div className="selection-chip"><span>About</span><p>{selectionLabel || "Selected section"}</p><button onClick={() => { markInteraction(); setSelection(null); }} aria-label="Clear selected passage">×</button></div>}
      {selection && draft.trim() && <button className="queue-annotation" onClick={() => { markInteraction(); if (queueAnnotation()) setNotice("Select another passage, or send your annotation now."); }}>Add another annotation +</button>}
      {pending && !pending.error && <div className="generation-status"><span role="status" aria-live="polite">Thinking…</span><button type="button" onClick={cancel} aria-label="Stop generating">Stop</button></div>}
      {started && <div className="composer-context"><span>{active.title}{includeIds.length ? ` · ${includeIds.length} included` : ""}</span></div>}
      <form className="composer" onSubmit={submit}><button className="orb-button" type="button" onClick={() => composer.current?.focus()} aria-label="Focus question input"><span className={`orb ${pending && !pending.error ? "is-thinking" : ""}`} /></button><textarea ref={composer} value={draft} onChange={(event) => { markInteraction(); setDraft(event.target.value); }} onKeyDown={composerKeydown} aria-label="Your question" placeholder={selection ? "Ask about this passage" : annotations.length ? "Optional instructions for these annotations" : "Ask anything"} rows={1} maxLength={8000} disabled={!ready || switching} />{draft && <button className="send-button" type="submit" aria-label="Send question" disabled={Boolean(pending && !pending.error)}>↑</button>}</form>
    </div>
    {showAccess && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Demo access"><form className="access-panel" onSubmit={(event) => { event.preventDefault(); setShowAccess(false); if (pending) void runRequest(pending); }}><button type="button" className="panel-close" onClick={() => setShowAccess(false)} aria-label="Close access code">×</button><label htmlFor="demo-code">Demo access code</label><input id="demo-code" type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} autoComplete="off" autoFocus /><button type="submit">Continue</button></form></div>}
    {switching && <div className="workspace-transition" role="status">Opening conversation…</div>}
    <footer className="navigation-hint"><span>{started ? "INSIDE: SCROLL TO READ · SPACE: SCROLL TO EXPLORE · PINCH TO ZOOM" : "A CONVERSATION YOU CAN EXPLORE"}</span><span className="save-status" role="status">{ready ? started || draft ? saveState : "" : "Opening…"}</span></footer>
    <span className="sr-only" role="status" aria-live="polite">{started ? `${active.title}, depth ${getDepth(space, active.id)}${overview ? ", overview" : ""}` : "Ready for your question"}</span>
  </main>;
}
