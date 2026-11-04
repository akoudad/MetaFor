"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent, PointerEvent } from "react";
import SpatialWorld from "./SpatialWorld";
import NavigationRail from "./NavigationRail";
import SpaceMap from "./SpaceMap";
import TopicCard from "./TopicCard";
import { getDepth, getPath } from "@/lib/model";
import type { SourceReference } from "@/lib/model";
import { createConversation, applyAnswer } from "@/lib/session";
import { loadSnapshot, saveSnapshot, backupSnapshot, listSnapshots, serializeSnapshot, parseSnapshot } from "@/lib/storage";
import type { Snapshot } from "@/lib/storage";
import type { AnswerRequest, AnswerResult, ModelStatus } from "@/lib/contracts";
import { normalizeText, messageText } from "@/lib/markdown";
import { CARD_HEIGHT, CARD_WIDTH, FIELD_OF_VIEW, applyPositionOverrides, fitOverview, focusView, layoutSpace, normalizeWheel, zoomView } from "@/lib/spatial";
import type { SpatialPoint } from "@/lib/spatial";
import { consumeScrollGesture, stepSemanticScroll } from "@/lib/semantic-scroll";
import type { ScrollGesture } from "@/lib/semantic-scroll";

type SavedPlace = { view: SpatialPoint; draft: string; selection: SourceReference | null; scrollTop: number };
type Pointer = { x: number; y: number };
type Pending = { request: AnswerRequest; error?: string; navigation: number };
type TopicTransition = { key: string; fromId: string; toId: string; follow: boolean };
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
  const [overview, setOverview] = useState(false);
  const [choiceParentId, setChoiceParentState] = useState<string | null>(null);
  const choiceNow = useRef<string | null>(null);
  const setChoiceParent = useCallback((id: string | null) => { choiceNow.current = id; setChoiceParentState(id); }, []);
  const [scrollHint, setScrollHint] = useState("");
  const scrollGesture = useRef<ScrollGesture | null>(null);
  const [draft, setDraftState] = useState("");
  const draftNow = useRef("");
  const setDraft = useCallback((value: string) => { draftNow.current = value; setDraftState(value); }, []);
  const [selection, setSelectionState] = useState<SourceReference | null>(null);
  const selectionNow = useRef<SourceReference | null>(null);
  const setSelection = useCallback((value: SourceReference | null) => { selectionNow.current = value; setSelectionState(value); }, []);
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
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [showAccess, setShowAccess] = useState(false);
  const [saveState, setSaveState] = useState("Saved locally");
  const [library, setLibrary] = useState<{ id: string; title: string; savedAt: string }[]>([]);
  const [scrollRevision, setScrollRevision] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const choicePanel = useRef<HTMLElement>(null);
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
  const cancelReaderFocus = useCallback(() => {
    if (readerFocusFrame.current !== null) cancelAnimationFrame(readerFocusFrame.current);
    readerFocusFrame.current = null;
  }, []);
  const active = space.explorations[activeId] ?? space.explorations[space.rootId];
  const path = getPath(space, active.id);
  const links = useMemo(() => [
    ...Object.values(space.explorations).filter((item) => item.parentId).map((item) => ({ from: item.parentId!, to: item.id, type: "origin" as const })),
    ...(space.connections ?? []).filter((link) => link.status === "accepted" || connections).filter((link) => connections || link.from === activeId || link.to === activeId).map((link) => ({ from: link.from, to: link.to, type: "related" as const, status: link.status, reason: link.reason })),
  ], [space, activeId, connections]);
  const choiceIds = useMemo(() => choiceParentId ? [choiceParentId, ...Object.values(space.explorations).filter((item) => item.parentId === choiceParentId).map((item) => item.id)] : undefined, [choiceParentId, space]);
  const pointFor = useCallback((id: string) => nodes.find((node) => node.id === id)?.position ?? { x: 0, y: 0, z: 0 }, [nodes]);
  const size = () => ({ width: stage.current?.clientWidth ?? 1000, height: stage.current?.clientHeight ?? 700 });
  const setCamera = (next: SpatialPoint) => { viewNow.current = next; setView(next); };
  useEffect(() => { viewNow.current = view; activeNow.current = activeId; spaceNow.current = space; }, [view, activeId, space]);

  const markInteraction = useCallback(() => {
    dismissSelectionPreview(); cancelReaderFocus(); setScrollHint("");
    navigation.current += 1;
    if (transitionNow.current) {
      // A text edit or selection has no new camera target of its own. Stop an
      // arrival journey at the rendered camera instead of continuing it behind typing.
      setCamera({ ...renderedView.current }); setTransition(null);
    }
  }, [dismissSelectionPreview, cancelReaderFocus, setTransition]);

  const remember = useCallback(() => {
    const id = activeNow.current;
    const readingView = overview || choiceNow.current ? saved.current[id]?.view ?? viewNow.current : viewNow.current;
    saved.current[id] = { view: readingView, draft: draftNow.current, selection: selectionNow.current, scrollTop: readers.current.get(id)?.scrollTop ?? saved.current[id]?.scrollTop ?? 0 };
  }, [overview]);

  const snapshot = useCallback((): Snapshot => {
    remember();
    const request = pendingNow.current?.request;
    const recovery = request ? { requestId: request.requestId, activeId: request.activeId, question: request.question, selection: request.selection, includeIds: request.includeIds } : undefined;
    return { format: "ingx", version: 1, savedAt: new Date().toISOString(), conversation: spaceNow.current, view: { activeId: activeNow.current, view: choiceNow.current ? saved.current[activeNow.current]?.view ?? viewNow.current : viewNow.current, overview: choiceNow.current ? false : overview, started: started || Boolean(request), places: { ...saved.current }, history: [...history.current], positions, ...(recovery ? { pending: recovery } : {}) } };
  }, [remember, space, active.id, view, overview, started, positions]);
  const snapshotNow = useRef(snapshot);
  useLayoutEffect(() => { snapshotNow.current = snapshot; }, [snapshot]);

  const restore = (next: Snapshot) => {
    abort.current?.abort();
    markInteraction();
    setChoiceParent(null); scrollGesture.current = null;
    setPending(null); setUnreadId(null); setUnreadMessageId(null);
    saved.current = next.view.places;
    history.current = next.view.history;
    let camera = next.view.view;
    if (next.view.started && !next.view.overview && !Object.hasOwn(next.view.positions ?? {}, next.view.activeId)) {
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
    setDraft(next.view.places[next.view.activeId]?.draft ?? "");
    setSelection(next.view.places[next.view.activeId]?.selection ?? null);
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
    if (!ready || (!started && !draft)) return;
    setSaveState("Saving…");
    const timer = setTimeout(() => {
      saveSnapshot(snapshotNow.current()).then(() => setSaveState("Saved locally")).catch((error) => {
        setSaveState("Save failed"); setNotice(error instanceof Error ? error.message : "Could not save. Export an .ingx copy to keep your work.");
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [ready, space, view, activeId, draft, selection, positions, overview, started, scrollRevision, pending]);

  useEffect(() => {
    const save = () => {
      if (!ready || (!started && !draft)) return;
      try { backupSnapshot(snapshotNow.current()); }
      catch { setSaveState("Save failed"); setNotice("Could not save the latest changes. Export an .ingx copy before leaving."); }
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") save(); };
    window.addEventListener("pagehide", save); document.addEventListener("visibilitychange", onVisibility);
    return () => { window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", onVisibility); };
  }, [ready, started, draft]);

  useEffect(() => {
    if (!savedChats) return;
    let cancelled = false;
    listSnapshots().then((items) => { if (!cancelled) setLibrary(items); }).catch(() => { if (!cancelled) setNotice("Could not read saved chats. Your current chat is still open."); });
    return () => { cancelled = true; };
  }, [savedChats, saveState]);

  const focus = useCallback((id: string) => {
    if (switchingNow.current || !space.explorations[id]) return;
    remember(); markInteraction(); setChoiceParent(null);
    if (id !== activeId) pushHistory(activeId);
    const previous = saved.current[id];
    const { width, height } = size();
    setCamera(focusView(pointFor(id), width, height));
    activeNow.current = id; setActiveId(id);
    setDraft(previous?.draft ?? ""); setSelection(previous?.selection ?? null);
    setIncludeIds([]); setStarted(true); setOverview(false); setNotice(""); setUnreadId(null);
    hover.current = id; wheelAnchor.current = null;
  }, [activeId, pointFor, remember, space]);

  const showOverview = useCallback(() => {
    if (switchingNow.current || overview) return;
    remember(); markInteraction(); setChoiceParent(null);
    const { width, height } = size();
    setCamera(fitOverview(nodes, width, height)); setStarted(true); setOverview(true);
    hover.current = null; wheelAnchor.current = null;
  }, [nodes, overview, remember]);

  const back = useCallback(() => {
    if (switchingNow.current) return;
    markInteraction();
    if (choiceNow.current) { const id = choiceNow.current; focus(id); setCamera(saved.current[id]?.view ?? focusView(pointFor(id), size().width, size().height)); return; }
    if (overview) { setCamera(saved.current[activeId]?.view ?? focusView(pointFor(activeId), size().width, size().height)); setOverview(false); return; }
    const id = history.current.pop() ?? active.parentId;
    if (!id || !space.explorations[id]) { showOverview(); return; }
    remember();
    const previous = saved.current[id];
    activeNow.current = id; setActiveId(id);
    setCamera(previous?.view ?? focusView(pointFor(id), size().width, size().height));
    setDraft(previous?.draft ?? ""); setSelection(previous?.selection ?? null); setIncludeIds([]); setOverview(false); setNotice("");
    hover.current = null; wheelAnchor.current = null;
  }, [active.parentId, activeId, overview, pointFor, remember, showOverview, space, focus]);

  const activate = useCallback((id: string) => {
    if (switchingNow.current || id === activeId || !space.explorations[id]) return;
    remember(); markInteraction(); setChoiceParent(null); pushHistory(activeId);
    activeNow.current = id; setActiveId(id);
    setDraft(saved.current[id]?.draft ?? ""); setSelection(saved.current[id]?.selection ?? null); setIncludeIds([]); setNotice("");
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
    if (delta < 0 && scale >= fullThreshold) activate(id);
    setOverview(false);
  }, [activeId, activate, pointFor]);

  const resumeTopic = useCallback((id: string) => {
    const leavingChoice = Boolean(choiceNow.current);
    const previousChoiceFocus = choicePanel.current?.contains(document.activeElement) ? document.activeElement : null;
    const camera = saved.current[id]?.view;
    focus(id);
    if (camera) setCamera(camera);
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
  }, [focus]);

  useEffect(() => {
    if (choiceParentId) choicePanel.current?.querySelector<HTMLButtonElement>(".topic-choice-list button")?.focus({ preventScroll: true });
  }, [choiceParentId]);

  const exploreChildren = useCallback((id: string) => {
    if (switchingNow.current || !space.explorations[id]) return;
    const children = Object.values(space.explorations).filter((item) => item.parentId === id);
    if (activeNow.current !== id) focus(id);
    remember(); markInteraction();
    if (!children.length) { setScrollHint("Ask a follow-up to explore further."); return; }
    if (children.length === 1) { resumeTopic(children[0].id); return; }
    setChoiceParent(id); setOverview(false);
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
      const scope = () => `${space.id}:${choiceNow.current ? `choice:${choiceNow.current}` : overview ? "overview" : `topic:${activeNow.current}`}`;
      if (event.ctrlKey) {
        if (event.cancelable) event.preventDefault();
        scrollGesture.current = consumeScrollGesture(scope(), delta, now);
        if (!wheelAnchor.current || now - wheelAnchor.current.time > 180) {
          const id = target.closest<HTMLElement>("[data-topic]")?.dataset.topic ?? hover.current ?? activeNow.current;
          wheelAnchor.current = { point: pointFor(id), id, time: now };
        }
        wheelAnchor.current.time = now;
        zoom(delta * 2, wheelAnchor.current.point, wheelAnchor.current.id);
        return;
      }
      const nativeReader = target.closest<HTMLDivElement>('.world-node[data-detail="full"] .topic-reading');
      const nativeId = nativeReader?.closest<HTMLElement>("[data-topic]")?.dataset.topic;
      if (!choiceNow.current && !overview && nativeId && nativeId !== activeNow.current) activate(nativeId);
      const id = activeNow.current;
      const choiceList = choiceNow.current ? target.closest<HTMLDivElement>(".topic-choice-list") : null;
      const reader = choiceList ?? readers.current.get(id);
      const node = reader?.closest<HTMLElement>("[data-node-id]");
      const full = !overview && !choiceNow.current && node?.dataset.detail === "full" && node.style.visibility !== "hidden";
      const max = Math.max(0, (reader?.scrollHeight ?? 0) - (reader?.clientHeight ?? 0));
      const top = Math.max(0, Math.min(max, reader?.scrollTop ?? 0));
      const remaining = full || choiceList ? delta > 0 ? max - top : top : 0;
      const result = stepSemanticScroll(scrollGesture.current, { scope: scope(), delta, now, remaining });
      scrollGesture.current = result.state;
      markInteraction();
      if (result.action === "read" && reader) {
        if (choiceList || reader === nativeReader) return;
        if (event.cancelable) event.preventDefault();
        reader.scrollTop = Math.max(0, Math.min(max, top + delta));
        remember();
        if (scrollTimer.current) clearTimeout(scrollTimer.current);
        scrollTimer.current = setTimeout(() => setScrollRevision((value) => value + 1), 250);
        return;
      }
      if (event.cancelable) event.preventDefault();
      if (result.action === "wait") {
        if (full && remaining <= 1) {
          const leaf = delta > 0 && !Object.values(space.explorations).some((item) => item.parentId === id);
          setScrollHint(leaf ? "Ask a follow-up to explore further." : delta > 0 ? "Pause, then scroll down to explore." : "Pause, then scroll up to return.");
        }
        return;
      }
      if (choiceNow.current) {
        if (delta < 0) resumeTopic(choiceNow.current);
        return;
      }
      if (overview) { if (delta > 0) resumeTopic(id); return; }
      if (!full && delta > 0) { focus(id); return; }
      if (delta > 0) exploreChildren(id);
      else {
        const parentId = space.explorations[id]?.parentId;
        if (parentId) resumeTopic(parentId);
        else showOverview();
      }
    };
    const chooser = choicePanel.current;
    element.addEventListener("wheel", wheel, { passive: false });
    chooser?.addEventListener("wheel", wheel, { passive: false });
    return () => { element.removeEventListener("wheel", wheel); chooser?.removeEventListener("wheel", wheel); };
  }, [space, activate, pointFor, started, zoom, overview, choiceParentId, markInteraction, remember, resumeTopic, focus, showOverview, exploreChildren]);

  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || switchingNow.current) return;
      if (event.key === "Escape") {
        if (selectionPreview) { event.preventDefault(); dismissSelectionPreview(); return; }
        if (help || menu || savedChats || connections || showAccess) { setHelp(false); setMenu(false); setSavedChats(false); setConnections(false); setShowAccess(false); }
        else if (choiceNow.current) resumeTopic(choiceNow.current);
        else if (started) back();
        return;
      }
      if (["TEXTAREA", "INPUT", "SELECT"].includes(target.tagName) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") { event.preventDefault(); composer.current?.focus(); }
      if (!started) return;
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(-180); }
      if (event.key === "-") { event.preventDefault(); zoom(180); }
      if (event.key === "0") { event.preventDefault(); showOverview(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [back, help, menu, savedChats, connections, showAccess, showOverview, started, zoom, selectionPreview, dismissSelectionPreview, resumeTopic]);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (switchingNow.current) return;
    const target = event.target as HTMLElement;
    const moveId = target.closest<HTMLElement>("[data-move-topic]")?.dataset.moveTopic;
    if (event.button !== 0 || (!moveId && target.closest("button, textarea, .topic-reading"))) return;
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
      if (!before.explorations[applied.destinationId]) setTransition({ key: task.request.requestId, fromId: task.request.activeId, toId: applied.destinationId, follow });
      if (follow) {
        if (applied.destinationId !== task.request.activeId) pushHistory(task.request.activeId);
        activeNow.current = applied.destinationId; setActiveId(applied.destinationId);
        setDraft(saved.current[applied.destinationId]?.draft ?? ""); setSelection(null); setIncludeIds([]); setOverview(false);
        const destination = layoutSpace(applied.conversation, positions).find((node) => node.id === applied.destinationId)!;
        setCamera(focusView(destination.position, size().width, size().height));
        requestAnimationFrame(() => {
          const reader = readers.current.get(applied.destinationId);
          const answer = reader?.querySelector<HTMLElement>(`[data-message-id="answer-${CSS.escape(task.request.requestId)}"]`);
          if (reader && answer) {
            const scale = reader.getBoundingClientRect().height / reader.offsetHeight;
            reader.scrollTop += (answer.getBoundingClientRect().top - reader.getBoundingClientRect().top) / scale - 16;
          }
        });
      } else { setUnreadId(applied.destinationId); setUnreadMessageId(`answer-${task.request.requestId}`); setNotice("Your answer is ready."); }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "The request failed. Your question is preserved.";
      setPending({ ...task, error: message });
      if (activeNow.current !== task.request.activeId) { setNotice("The question in another topic needs a retry."); setUnreadId(task.request.activeId); setUnreadMessageId(null); }
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (switchingNow.current || !draftNow.current.trim() || !ready) return;
    if (pendingNow.current) { setNotice("Retry or dismiss the unfinished question before sending another."); return; }
    const question = draftNow.current.trim();
    if (question.length > 8000) { setNotice("Keep the question below 8,000 characters."); return; }
    if (choiceNow.current) resumeTopic(activeNow.current);
    markInteraction(); remember();
    const source = selectionNow.current;
    const originId = source?.explorationId ?? activeNow.current;
    const request: AnswerRequest = { requestId: crypto.randomUUID(), conversation: spaceNow.current, activeId: originId, question, selection: source, mode: "auto", includeIds };
    // The submitted question lives in its pending card. A fresh composer draft
    // is independent, even when it happens to contain exactly the same words.
    setDraft(""); setSelection(null); setIncludeIds([]);
    saved.current[originId] = { ...saved.current[originId], draft: "", selection: null };
    setStarted(true);
    if (!started) setCamera(focusView(pointFor(originId), size().width, size().height));
    const task = { request, navigation: navigation.current };
    void runRequest(task);
    requestAnimationFrame(() => { const reader = readers.current.get(originId); if (reader) reader.scrollTop = reader.scrollHeight; });
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
    remember(); markInteraction(); setChoiceParent(null);
    const { width, height } = size();
    for (const node of baseNodes) {
      const place = saved.current[node.id];
      if (place) saved.current[node.id] = { ...place, view: focusView(node.position, width, height) };
    }
    setPositions({}); setCamera(fitOverview(baseNodes, width, height)); setOverview(true);
    hover.current = null; wheelAnchor.current = null; setMenu(false);
  };

  const keepCurrent = async () => { if (started || draft) await saveSnapshot(snapshot()); };
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
    focus(id);
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
  const chooseSection = (source: SourceReference) => { if (switchingNow.current) return; markInteraction(); if (choiceNow.current) resumeTopic(source.explorationId); else if (source.explorationId !== activeId) activate(source.explorationId); setSelection(source); composer.current?.focus(); };
  const openSource = (source: SourceReference) => {
    if (switchingNow.current) return;
    const conversationId = space.id;
    focus(source.explorationId);
    requestAnimationFrame(() => {
      if (switchingNow.current || spaceNow.current.id !== conversationId || activeNow.current !== source.explorationId) return;
      const reader = readers.current.get(source.explorationId);
      const section = reader?.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(source.sectionId)}"]`);
      if (reader && section) {
        const scale = reader.getBoundingClientRect().height / reader.offsetHeight;
        reader.scrollTop += (section.getBoundingClientRect().top - reader.getBoundingClientRect().top) / scale - 12;
      }
      setSelection(source);
    });
  };
  const selectedMessage = selection && space.explorations[selection.explorationId]?.messages.find((message) => message.id === selection.messageId);
  const selectionLabel = selection?.quote ?? selectedMessage?.sections.find((section) => section.id === selection?.sectionId)?.title;
  const suggestions = (space.connections ?? []).filter((link) => link.from === activeId || link.to === activeId);

  return <main className="space" aria-busy={switching}>
    <header className="topbar">
      <button className="wordmark" onClick={() => started ? showOverview() : composer.current?.focus()}>metaphore</button>
      <div className="top-actions">
        <button onClick={() => void openFresh()} disabled={!ready || switching || Boolean(pending && !pending.error)}>New chat</button>
        <button onClick={() => { setSavedChats(!savedChats); setMenu(false); }} disabled={!ready || switching} aria-expanded={savedChats}>Saved chats</button>
        {started && <button onClick={showOverview} aria-label="Overview" title="Overview · 0">⤢</button>}
        <button onClick={() => { setMenu(!menu); setSavedChats(false); }} aria-label="Conversation menu" aria-expanded={menu}>⋯</button>
      </div>
    </header>
    {started && <nav className="breadcrumbs" aria-label="Conversation path"><button onClick={back} aria-label="Return to previous view">←</button>{path.map((item, index) => <span key={item.id}>{index > 0 && <i>/</i>}<button onClick={() => focus(item.id)} aria-current={item.id === activeId ? "page" : undefined}>{item.title}</button></span>)}</nav>}
    {help && <aside className="help-panel"><button onClick={() => setHelp(false)} aria-label="Close navigation help">×</button><p>Scroll to read the current answer, even over empty space. At its end, pause and scroll again to explore connected topics.</p><p>Drag empty space to move around. Drag a topic’s ⠿ handle to place it.</p><p>Select a passage, click “Ask about this”, then write your question below. Related ideas stay connected as your conversation grows.</p><p>Use the left marks to preview and jump. ↑ / ↓ and Enter work when the rail is focused.</p><p>Scroll up from the beginning to return. Pinch, Ctrl + scroll, or + / − zoom freely. Esc returns. 0 shows everything.</p><button onClick={resetLayout} disabled={!started}>Reset layout</button></aside>}
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
    <div ref={stage} className={`world-stage ${dragging ? "is-dragging" : ""}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onKeyUp={(event) => { if (event.shiftKey) captureSelection(true); }}>
      <SpatialWorld nodes={started ? nodes : []} links={started ? links : []} activeId={activeId} view={view} reducedMotion={reducedMotion} onViewChange={rememberRenderedView} transition={transition} visibleIds={choiceIds}>
        {(node) => <TopicCard key={node.id} space={space} item={space.explorations[node.id]} active={node.id === activeId} selection={selection} pendingQuestion={pending?.request.activeId === node.id ? pending.request.question : undefined} pendingError={pending?.request.activeId === node.id ? pending.error : undefined} onRetry={() => { if (pending) void runRequest(pending); }} onCancel={cancel} onDismiss={dismissPending} onFocus={() => focus(node.id)} onHover={(id) => { hover.current = id; }} onSelect={chooseSection} onOpen={focus} onExplore={() => { scrollGesture.current = consumeScrollGesture(`${space.id}:topic:${node.id}`, 1, performance.now()); exploreChildren(node.id); }} onSource={openSource} readingRef={(element) => {
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
    {choiceParentId && <aside ref={choicePanel} className="topic-choice" aria-label="Choose a topic">
      <div className="topic-choice-heading"><h2>Choose a topic</h2><button className="topic-choice-return" onClick={() => resumeTopic(choiceParentId)}>Return to {space.explorations[choiceParentId].title}</button></div>
      <p>Explore {space.explorations[choiceParentId].title}</p>
      <div className="topic-choice-list">{Object.values(space.explorations).filter((item) => item.parentId === choiceParentId).map((item) => <button key={item.id} onClick={() => resumeTopic(item.id)}>Explore {item.title}</button>)}</div>
    </aside>}
    {scrollHint && <p className="scroll-boundary-hint" role="status">{scrollHint}</p>}
    {started && <div className="zoom-controls" aria-label="Spatial navigation"><button onClick={() => zoom(220)} aria-label="Zoom out">−</button><button onClick={() => zoom(-220)} aria-label="Zoom in">+</button><button onClick={() => focus(activeId)} aria-label="Center current topic">⌖</button></div>}
    {started && <NavigationRail items={Object.values(space.explorations)} activeId={activeId} onNavigate={focus} />}
    {started && <SpaceMap nodes={nodes} links={links} activeId={activeId} view={view} labels={Object.fromEntries(Object.values(space.explorations).map((item) => [item.id, item.title]))} onNavigate={focus} onOverview={showOverview} />}
    <div className="composer-dock">
      {notice && <p className="composer-notice" role="status">{notice}{unreadId && <button onClick={openUnread}>Open answer ↗</button>}<button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></p>}
      {selection && <div className="selection-chip"><span>About</span><p>{selectionLabel || "Selected section"}</p><button onClick={() => { markInteraction(); setSelection(null); }} aria-label="Clear selected passage">×</button></div>}
      {started && <div className="composer-context"><span>{active.title}{includeIds.length ? ` · ${includeIds.length} included` : ""}</span></div>}
      <form className="composer" onSubmit={submit}><button className="orb-button" type="button" onClick={() => composer.current?.focus()} aria-label="Focus question input"><span className={`orb ${pending && !pending.error ? "is-thinking" : ""}`} /></button><textarea ref={composer} value={draft} onChange={(event) => { markInteraction(); setDraft(event.target.value); }} onKeyDown={composerKeydown} aria-label="Your question" placeholder={selection ? "Ask about this passage" : "Ask anything"} rows={1} maxLength={8000} disabled={!ready || switching} />{draft && <button className="send-button" type="submit" aria-label="Send question" disabled={Boolean(pending && !pending.error)}>↑</button>}</form>
    </div>
    {showAccess && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Demo access"><form className="access-panel" onSubmit={(event) => { event.preventDefault(); setShowAccess(false); if (pending) void runRequest(pending); }}><button type="button" className="panel-close" onClick={() => setShowAccess(false)} aria-label="Close access code">×</button><label htmlFor="demo-code">Demo access code</label><input id="demo-code" type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} autoComplete="off" autoFocus /><button type="submit">Continue</button></form></div>}
    {switching && <div className="workspace-transition" role="status">Opening conversation…</div>}
    <footer className="navigation-hint"><span>{started ? "SCROLL TO READ · PAUSE AT THE EDGE TO EXPLORE · PINCH TO ZOOM" : "A CONVERSATION YOU CAN EXPLORE"}</span><span className="save-status" role="status">{ready ? started || draft ? saveState : "" : "Opening…"}</span></footer>
    <span className="sr-only" role="status" aria-live="polite">{started ? `${active.title}, depth ${getDepth(space, active.id)}${overview ? ", overview" : ""}` : "Ready for your question"}</span>
  </main>;
}
