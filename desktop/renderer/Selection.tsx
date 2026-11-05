import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { CapturePayload, CropRect } from "../shared";
import "./help.css";

type Point = { x: number; y: number };
const clamp = (value: number) => Math.min(1, Math.max(0, value));

export default function Selection() {
  const [capture, setCapture] = useState<CapturePayload | null>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const surface = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    window.metaforDesktop.getCapture().then((value) => { if (mounted) setCapture(value); }).catch(() => { if (mounted) setError("The screen selection could not be loaded. Press Escape and try again."); });
    const dispose = window.metaforDesktop.onCapture((value) => { setCapture(value); setStart(null); setEnd(null); setBusy(false); setError(""); });
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") void window.metaforDesktop.cancelCapture().catch(() => setError("Could not close the selection. Try Escape again."));
    };
    window.addEventListener("keydown", key);
    return () => { mounted = false; dispose(); window.removeEventListener("keydown", key); };
  }, []);

  const point = (event: PointerEvent): Point => {
    const rect = surface.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  };
  const selection: CropRect | null = start && end ? { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) } : null;
  const finish = async (event: PointerEvent<HTMLDivElement>) => {
    if (!start || busy || !capture) return;
    const position = point(event);
    const rect = surface.current!.getBoundingClientRect();
    const width = Math.abs(position.x - start.x);
    const height = Math.abs(position.y - start.y);
    const clicked = width * rect.width < 8 && height * rect.height < 8;
    const targetWidth = clicked ? Math.min(1, 280 / rect.width) : Math.max(0.01, width);
    const targetHeight = clicked ? Math.min(1, 180 / rect.height) : Math.max(0.01, height);
    const crop = {
      x: clicked ? Math.max(0, Math.min(1 - targetWidth, start.x - targetWidth / 2)) : Math.min(start.x, position.x),
      y: clicked ? Math.max(0, Math.min(1 - targetHeight, start.y - targetHeight / 2)) : Math.min(start.y, position.y),
      width: targetWidth,
      height: targetHeight,
    };
    crop.width = Math.min(crop.width, 1 - crop.x);
    crop.height = Math.min(crop.height, 1 - crop.y);
    setBusy(true);
    try { await window.metaforDesktop.selectCapture(crop); } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not select this region. Try again.");
      setBusy(false); setStart(null); setEnd(null);
    }
  };

  return <main className="capture-select" aria-label="Select screen content">
    {capture && <img className="capture-screen" src={capture.image} alt="Your frozen screen, visible only on this Mac until you send a question" draggable={false} />}
    <div ref={surface} className="capture-surface" onPointerDown={(event) => {
      if (busy || !capture || event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const position = point(event); setStart(position); setEnd(position); setError("");
    }} onPointerMove={(event) => { if (start && !busy) setEnd(point(event)); }} onPointerUp={(event) => void finish(event)} onPointerCancel={() => { setStart(null); setEnd(null); }}>
      {selection && <div className="capture-region" style={{ left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.width * 100}%`, height: `${selection.height * 100}%` }} />}
    </div>
    <div className="capture-instructions">
      <span className="help-orb" aria-hidden="true" />
      <div><strong>{busy ? "Preparing your selection…" : "Point, or drag around what you want to ask about"}</strong><p>{error || "Nothing is sent yet. Review your selection, then send your question."}</p></div>
      <button type="button" onClick={() => void window.metaforDesktop.cancelCapture().catch(() => setError("Could not close. Press Escape to retry."))}>Cancel <kbd>esc</kbd></button>
    </div>
  </main>;
}
