"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent, PointerEvent } from "react";
import SpatialWorld from "./SpatialWorld";
import NavigationRail from "./NavigationRail";
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

type SavedPlace = { view: SpatialPoint; draft: string; selection: SourceReference | null; scrollTop: number };
type Pointer = { x: number; y: number };
type Pending = { request: AnswerRequest; error?: string; navigation: number };
const INITIAL_VIEW = { x: 0, y: 0, z: 900 };

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
  const [draft, setDraft] = useState("");
  const [selection, setSelection] = useState<SourceReference | null>(null);
  const [includeIds, setIncludeIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState(false);
  const [savedChats, setSavedChats] = useState(false);
  const [connections, setConnections] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
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
  const active = space.explorations[activeId] ?? space.explorations[space.rootId];
  const path = getPath(space, active.id);
  const links = useMemo(() => [
    ...Object.values(space.explorations).filter((item) => item.parentId).map((item) => ({ from: item.parentId!, to: item.id, type: "origin" as const })),
    ...(space.connections ?? []).filter((link) => link.status === "accepted" || connections).filter((link) => connections || link.from === activeId || link.to === activeId).map((link) => ({ from: link.from, to: link.to, type: "related" as const, status: link.status, reason: link.reason })),
  ], [space, activeId, connections]);
  const pointFor = useCallback((id: string) => nodes.find((node) => node.id === id)?.position ?? { x: 0, y: 0, z: 0 }, [nodes]);
  const size = () => ({ width: stage.current?.clientWidth ?? 1000, height: stage.current?.clientHeight ?? 700 });
  const setCamera = (next: SpatialPoint) => { viewNow.current = next; setView(next); };
  useEffect(() => { viewNow.current = view; activeNow.current = activeId; spaceNow.current = space; }, [view, activeId, space]);

  const remember = useCallback(() => {
    const readingView = overview ? saved.current[activeId]?.view ?? view : view;
    saved.current[activeId] = { view: readingView, draft, selection, scrollTop: readers.current.get(activeId)?.scrollTop ?? saved.current[activeId]?.scrollTop ?? 0 };
  }, [activeId, view, draft, selection, overview]);

  const snapshot = useCallback((): Snapshot => {
    remember();
    return { format: "ingx", version: 1, savedAt: new Date().toISOString(), conversation: space, view: { activeId: active.id, view, overview, started, places: { ...saved.current }, history: [...history.current], positions } };
  }, [remember, space, active.id, view, overview, started, positions]);
  const snapshotNow = useRef(snapshot);
  useEffect(() => { snapshotNow.current = snapshot; }, [snapshot]);

  const restore = (next: Snapshot) => {
    abort.current?.abort();
    navigation.current += 1;
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
  };

  useEffect(() => {
    let cancelled = false;
    // Keep older demo snapshots in the library, but never present one as a new
    // user's conversation. Real saved chats still resume normally.
    loadSnapshot().then((value) => { if (!cancelled && value && value.conversation.kind !== "sample") restore(value); }).catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : "Could not restore the saved conversation."); }).finally(() => { if (!cancelled) setReady(true); });
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update(); query.addEventListener("change", update);
    return () => { cancelled = true; query.removeEventListener("change", update); abort.current?.abort(); if (scrollTimer.current) clearTimeout(scrollTimer.current); };
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
  }, [ready, space, view, activeId, draft, selection, positions, overview, started, scrollRevision]);

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
    remember(); navigation.current += 1;
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
    remember(); navigation.current += 1;
    const { width, height } = size();
    setCamera(fitOverview(nodes, width, height)); setStarted(true); setOverview(true);
    hover.current = null; wheelAnchor.current = null;
  }, [nodes, overview, remember]);

  const back = useCallback(() => {
    if (switchingNow.current) return;
    navigation.current += 1;
    if (overview) { setCamera(saved.current[activeId]?.view ?? focusView(pointFor(activeId), size().width, size().height)); setOverview(false); return; }
    const id = history.current.pop() ?? active.parentId;
    if (!id || !space.explorations[id]) { showOverview(); return; }
    remember();
    const previous = saved.current[id];
    activeNow.current = id; setActiveId(id);
    setCamera(previous?.view ?? focusView(pointFor(id), size().width, size().height));
    setDraft(previous?.draft ?? ""); setSelection(previous?.selection ?? null); setIncludeIds([]); setOverview(false); setNotice("");
    hover.current = null; wheelAnchor.current = null;
  }, [active.parentId, activeId, overview, pointFor, remember, showOverview, space]);

  const activate = useCallback((id: string) => {
    if (switchingNow.current || id === activeId || !space.explorations[id]) return;
    remember(); navigation.current += 1; pushHistory(activeId);
    activeNow.current = id; setActiveId(id);
    setDraft(saved.current[id]?.draft ?? ""); setSelection(saved.current[id]?.selection ?? null); setIncludeIds([]); setNotice("");
  }, [activeId, remember, space]);

  const zoom = useCallback((delta: number, anchor?: SpatialPoint, anchorId?: string) => {
    if (switchingNow.current) return;
    navigation.current += 1;
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

  useEffect(() => {
    const element = stage.current;
    if (!element || !started) return;
    const wheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement;
      if (!event.ctrlKey && target.closest('.world-node[data-detail="full"] .topic-reading')) {
        navigation.current += 1;
        const id = target.closest<HTMLElement>("[data-topic]")?.dataset.topic;
        if (id) activate(id);
        return;
      }
      if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      if (event.cancelable) event.preventDefault();
      const now = performance.now();
      if (!wheelAnchor.current || now - wheelAnchor.current.time > 180) {
        const id = target.closest<HTMLElement>("[data-topic]")?.dataset.topic ?? hover.current ?? activeId;
        wheelAnchor.current = { point: pointFor(id), id, time: now };
      }
      wheelAnchor.current.time = now;
      zoom(normalizeWheel(event.deltaY, event.deltaMode) * (event.ctrlKey ? 2 : 1), wheelAnchor.current.point, wheelAnchor.current.id);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [activeId, activate, pointFor, started, zoom]);

  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || switchingNow.current) return;
      if (event.key === "Escape") {
        if (help || menu || savedChats || connections || showAccess) { setHelp(false); setMenu(false); setSavedChats(false); setConnections(false); setShowAccess(false); }
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
  }, [back, help, menu, savedChats, connections, showAccess, showOverview, started, zoom]);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (switchingNow.current) return;
    const target = event.target as HTMLElement;
    const moveId = target.closest<HTMLElement>("[data-move-topic]")?.dataset.moveTopic;
    if (event.button !== 0 || (!moveId && target.closest("button, textarea, .topic-reading"))) return;
    navigation.current += 1;
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
  const captureSelection = () => {
    if (switchingNow.current) return;
    const chosen = window.getSelection();
    if (!chosen || chosen.isCollapsed || !chosen.rangeCount) return;
    const range = chosen.getRangeAt(0);
    const element = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const start = element(range.startContainer)?.closest<HTMLElement>("[data-section-id]");
    const end = element(range.endContainer)?.closest<HTMLElement>("[data-section-id]");
    const answer = start?.closest<HTMLElement>("[data-message-id]");
    if (!start || !end || !answer || answer !== end.closest("[data-message-id]")) return;
    const quote = normalizeText(chosen.toString());
    if (!quote) return;
    if (quote.length > 12000) { setNotice("Select a shorter passage, up to 12,000 characters."); return; }
    const id = answer.dataset.explorationId!;
    const message = space.explorations[id]?.messages.find((item) => item.id === answer.dataset.messageId);
    if (!message || !normalizeText(messageText(message)).includes(quote)) { setNotice("That selection crosses content outside the answer. Select the passage again."); return; }
    activate(id); navigation.current += 1;
    setSelection({ explorationId: id, messageId: message.id, sectionId: start.dataset.sectionId!, ...(end !== start ? { endSectionId: end.dataset.sectionId! } : {}), quote });
    setNotice("");
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const wasDragging = pointers.current.has(event.pointerId);
    pointers.current.delete(event.pointerId); pinchDistance.current = 0; moving.current = null;
    if (!pointers.current.size) setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!wasDragging) captureSelection();
  };

  const runRequest = async (task: Pending) => {
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    setPending({ ...task, error: undefined }); setNotice("");
    try {
      const response = await fetch("/api/answer", { method: "POST", headers: { "Content-Type": "application/json", ...(accessCode ? { "x-demo-code": accessCode } : {}) }, body: JSON.stringify(task.request), signal: controller.signal });
      const payload = await response.json().catch(() => null);
      if (!payload) throw new Error("The server returned an unreadable response. Your question is preserved.");
      if (!response.ok) { if (response.status === 401) setShowAccess(true); throw new Error(payload.error || "The answer could not be generated. Please retry."); }
      const result = payload as AnswerResult;
      if (result.requestId !== task.request.requestId) throw new Error("The response did not match this question. Please retry.");
      if (controller.signal.aborted || spaceNow.current.id !== task.request.conversation.id) return;
      const before = spaceNow.current;
      const applied = applyAnswer(before, task.request, result);
      snapshotNow.current();
      if (saved.current[task.request.activeId]?.draft.trim() === task.request.question) {
        saved.current[task.request.activeId].draft = "";
        if (activeNow.current === task.request.activeId) setDraft((current) => current.trim() === task.request.question ? "" : current);
      }
      spaceNow.current = applied.conversation; setSpace(applied.conversation);
      setPending(null);
      if (activeNow.current === task.request.activeId && navigation.current === task.navigation) {
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
    if (switchingNow.current || !draft.trim() || (pending && !pending.error) || !ready) return;
    const question = draft.trim();
    if (question.length > 8000) { setNotice("Keep the question below 8,000 characters."); return; }
    remember();
    const originId = selection?.explorationId ?? activeId;
    const request: AnswerRequest = { requestId: crypto.randomUUID(), conversation: space, activeId: originId, question, selection, mode: "auto", includeIds };
    setStarted(true);
    if (!started) setCamera(focusView(pointFor(originId), size().width, size().height));
    const task = { request, navigation: navigation.current };
    void runRequest(task);
    requestAnimationFrame(() => { const reader = readers.current.get(originId); if (reader) reader.scrollTop = reader.scrollHeight; });
  };
  const cancel = () => { abort.current?.abort(); setPending(null); setNotice("Question kept in its original topic’s draft."); };
  const composerKeydown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
  };

  const resetLayout = () => {
    if (switchingNow.current || !started) return;
    remember(); navigation.current += 1;
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
  const chooseSection = (source: SourceReference) => { if (switchingNow.current) return; navigation.current += 1; if (source.explorationId !== activeId) activate(source.explorationId); setSelection(source); composer.current?.focus(); };
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
    {help && <aside className="help-panel"><button onClick={() => setHelp(false)} aria-label="Close navigation help">×</button><p>Scroll over space to zoom. Scroll inside an answer to read.</p><p>Drag empty space to move around. Drag a topic’s ⠿ handle to place it.</p><p>Select any passage, then ask about it below. Related ideas stay connected as your conversation grows.</p><p>Use the left marks to preview and jump. ↑ / ↓ and Enter work when the rail is focused.</p><p>Pinch or + / − to zoom. Esc returns. 0 shows everything.</p><button onClick={resetLayout} disabled={!started}>Reset layout</button></aside>}
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
      <p className="menu-caption">Include in next question · up to 8</p><div className="context-picker">{Object.values(space.explorations).filter((item) => item.id !== activeId).map((item) => <label key={item.id}><input type="checkbox" checked={includeIds.includes(item.id)} disabled={includeIds.length >= 8 && !includeIds.includes(item.id)} onChange={(event) => setIncludeIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />{item.title}</label>)}</div>
    </aside>}
    <input ref={fileInput} className="sr-only" type="file" accept=".ingx,application/json" onChange={importFile} aria-label="Import conversation file" />
    <div ref={stage} className={`world-stage ${dragging ? "is-dragging" : ""}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onKeyUp={(event) => { if (event.shiftKey) captureSelection(); }}>
      <SpatialWorld nodes={started ? nodes : []} links={started ? links : []} activeId={activeId} view={view} reducedMotion={reducedMotion} onViewChange={rememberRenderedView}>
        {(node) => <TopicCard key={node.id} space={space} item={space.explorations[node.id]} active={node.id === activeId} selection={selection} pendingQuestion={pending?.request.activeId === node.id ? pending.request.question : undefined} pendingError={pending?.request.activeId === node.id ? pending.error : undefined} onRetry={() => { if (pending) void runRequest(pending); }} onCancel={cancel} onFocus={() => focus(node.id)} onHover={(id) => { hover.current = id; }} onSelect={chooseSection} onOpen={focus} onSource={openSource} readingRef={(element) => {
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
    {started && <div className="zoom-controls" aria-label="Spatial navigation"><button onClick={() => zoom(220)} aria-label="Zoom out">−</button><button onClick={() => zoom(-220)} aria-label="Zoom in">+</button><button onClick={() => focus(activeId)} aria-label="Center current topic">⌖</button></div>}
    {started && <NavigationRail items={Object.values(space.explorations)} activeId={activeId} onNavigate={focus} />}
    <div className="composer-dock">
      {notice && <p className="composer-notice" role="status">{notice}{unreadId && <button onClick={openUnread}>Open answer ↗</button>}<button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></p>}
      {selection && <div className="selection-chip"><span>About</span><p>{selectionLabel || "Selected section"}</p><button onClick={() => setSelection(null)} aria-label="Clear selected passage">×</button></div>}
      {started && <div className="composer-context"><span>{active.title}{includeIds.length ? ` · ${includeIds.length} included` : ""}</span></div>}
      <form className="composer" onSubmit={submit}><button className="orb-button" type="button" onClick={() => composer.current?.focus()} aria-label="Focus question input"><span className={`orb ${pending && !pending.error ? "is-thinking" : ""}`} /></button><textarea ref={composer} value={draft} onChange={(event) => { if (pending && !pending.error) navigation.current += 1; setDraft(event.target.value); }} onKeyDown={composerKeydown} aria-label="Your question" placeholder={selection ? "Ask about this passage" : "Ask anything"} rows={1} maxLength={8000} disabled={!ready || switching} />{draft && <button className="send-button" type="submit" aria-label="Send question" disabled={Boolean(pending && !pending.error)}>↑</button>}</form>
    </div>
    {showAccess && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Demo access"><form className="access-panel" onSubmit={(event) => { event.preventDefault(); setShowAccess(false); if (pending) void runRequest(pending); }}><button type="button" className="panel-close" onClick={() => setShowAccess(false)} aria-label="Close access code">×</button><label htmlFor="demo-code">Demo access code</label><input id="demo-code" type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} autoComplete="off" autoFocus /><button type="submit">Continue</button></form></div>}
    {switching && <div className="workspace-transition" role="status">Opening conversation…</div>}
    <footer className="navigation-hint"><span>{started ? "SPACE: SCROLL TO ZOOM · DRAG TO MOVE     TEXT: SELECT TO ASK" : "A CONVERSATION YOU CAN EXPLORE"}</span><span className="save-status" role="status">{ready ? started || draft ? saveState : "" : "Opening…"}</span></footer>
    <span className="sr-only" role="status" aria-live="polite">{started ? `${active.title}, depth ${getDepth(space, active.id)}${overview ? ", overview" : ""}` : "Ready for your question"}</span>
  </main>;
}
