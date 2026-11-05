import { useEffect, useId, useState } from "react";
import { validateHelpSource, validateMarks } from "../help-model";
import type { GuidancePayload, VisualMark } from "../shared";
import "./guidance.css";

type Size = { width: number; height: number };
type Box = Size & { left: number; top: number };
type Label = Box & { mark: VisualMark };
type GuidanceView = Size & { marks: VisualMark[]; helpRegion?: Box };
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(low, high), Math.max(low, value));
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

export function layoutGuidanceLabels(marks: VisualMark[], viewport: Size, avoid: Box[] = []): Label[] {
  const margin = Math.min(12, viewport.width / 4, viewport.height / 4);
  // All evidence is protected before placing the first label, including targets
  // with no label and arrow destinations. Never move the marks to make room.
  const targets = marks.map((mark): Box => mark.kind === "rect"
    ? { left: mark.x * viewport.width, top: mark.y * viewport.height, width: mark.width * viewport.width, height: mark.height * viewport.height }
    : { left: (mark.x + (mark.kind === "arrow" ? mark.width : 0)) * viewport.width - 12,
      top: (mark.y + (mark.kind === "arrow" ? mark.height : 0)) * viewport.height - 12, width: 24, height: 24 });
  const labels: Label[] = [];
  for (const mark of marks) {
    if (!mark.label?.trim()) continue;
    const width = Math.min(240, Math.max(100, mark.label.length * 7 + 20), viewport.width - margin * 2);
    const columns = Math.max(1, Math.floor((width - 20) / 7));
    const lines = mark.label.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(line.length / columns)), 0);
    const height = Math.min(80, lines * 16 + 14, viewport.height - margin * 2);
    const anchorX = (mark.x + (mark.kind === "arrow" ? mark.width : mark.kind === "rect" ? mark.width / 2 : 0)) * viewport.width;
    const anchorY = (mark.y + (mark.kind === "arrow" ? mark.height : 0)) * viewport.height;
    const left = clamp(mark.kind === "rect" ? anchorX - width / 2 : anchorX + 14, margin, viewport.width - width - margin);
    const above = anchorY - height - 10;
    const below = (mark.kind === "rect" ? mark.y + mark.height : anchorY / viewport.height) * viewport.height + 10;
    const preferredTop = mark.kind === "rect" || anchorY > viewport.height * .65 ? above : below;
    const top = clamp(preferredTop < margin ? below : preferredTop, margin, viewport.height - height - margin);
    const obstacles = [...targets, ...avoid, ...labels].map((box) => ({ left: box.left - 6, top: box.top - 6, width: box.width + 12, height: box.height + 12 }));
    // Obstacle edges define useful empty slots. Combining their x/y boundaries
    // also finds gaps that a one-direction push would miss on crowded screens.
    const xs = [...new Set([left, anchorX - width / 2, margin, viewport.width - width - margin,
      ...obstacles.flatMap((box) => [box.left - width, box.left, box.left + box.width - width, box.left + box.width])]
      .map((value) => clamp(value, margin, viewport.width - width - margin)))];
    const ys = [...new Set([top, anchorY - height / 2, margin, viewport.height - height - margin,
      ...obstacles.flatMap((box) => [box.top - height, box.top, box.top + box.height - height, box.top + box.height])]
      .map((value) => clamp(value, margin, viewport.height - height - margin)))];
    let best = { left, top, width, height };
    let bestOverlap = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const x of xs) for (const y of ys) {
      const candidate = { left: x, top: y, width, height };
      const covered = obstacles.reduce((area, box) => area + overlap(candidate, box), 0);
      const distance = (x + width / 2 - anchorX) ** 2 + (y + height / 2 - anchorY) ** 2;
      if (covered < bestOverlap || (covered === bestOverlap && distance < bestDistance)) {
        best = candidate; bestOverlap = covered; bestDistance = distance;
      }
    }
    labels.push({ mark, ...best });
  }
  return labels;
}

function readGuidance(value: GuidancePayload | null): GuidanceView {
  if (!value || typeof value.answer !== "string") throw new Error("Guidance is unavailable.");
  const source = validateHelpSource(value.source);
  let marks = validateMarks(value.marks);
  const validBounds = (bounds: GuidancePayload["viewportBounds"]) => bounds
    && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger)
    && Math.abs(bounds.x) <= 100000 && Math.abs(bounds.y) <= 100000 && bounds.width > 0 && bounds.height > 0
    && bounds.width <= 16384 && bounds.height <= 16384;
  if (value.viewportBounds !== undefined) {
    const bounds = value.viewportBounds;
    const frame = source.screenBounds;
    if (!frame || !validBounds(bounds)) throw new Error("The guidance window has invalid screen bounds.");
    // Keep source coordinates fixed in screen space even when macOS shifts or clips
    // the overlay window. Projection happens only after normalized source validation.
    marks = marks.map((mark) => ({ ...mark,
      x: (frame.x + mark.x * frame.width - bounds.x) / bounds.width,
      y: (frame.y + mark.y * frame.height - bounds.y) / bounds.height,
      width: mark.width * frame.width / bounds.width,
      height: mark.height * frame.height / bounds.height,
    })).filter((mark) => Math.max(mark.x, mark.x + mark.width) >= 0 && Math.min(mark.x, mark.x + mark.width) <= 1
      && Math.max(mark.y, mark.y + mark.height) >= 0 && Math.min(mark.y, mark.y + mark.height) <= 1);
  }
  let helpRegion: Box | undefined;
  if (value.helpBounds !== undefined) {
    const help = value.helpBounds;
    const bounds = value.viewportBounds ?? source.screenBounds;
    if (!validBounds(help) || !bounds || !validBounds(bounds)) throw new Error("The Help window has invalid screen bounds.");
    helpRegion = { left: (help.x - bounds.x) / bounds.width, top: (help.y - bounds.y) / bounds.height,
      width: help.width / bounds.width, height: help.height / bounds.height };
  }
  // The live overlay only needs geometry. Never put the captured image or answer in its DOM.
  return { width: source.width, height: source.height, marks, helpRegion };
}

function MarkShape({ mark, view, scale, arrowId }: { mark: VisualMark; view: Size; scale: number; arrowId: string }) {
  return mark.kind === "rect"
    ? <rect x={mark.x * view.width} y={mark.y * view.height} width={mark.width * view.width} height={mark.height * view.height} rx={4 * scale} />
    : mark.kind === "arrow"
      ? <line x1={mark.x * view.width} y1={mark.y * view.height} x2={(mark.x + mark.width) * view.width} y2={(mark.y + mark.height) * view.height} markerEnd={`url(#${arrowId})`} />
      : <circle cx={mark.x * view.width} cy={mark.y * view.height} r={7 * scale} />;
}

export default function Guidance() {
  const [view, setView] = useState<GuidanceView | null>(null);
  const [viewport, setViewport] = useState<Size>({ width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) });
  const arrowId = useId();

  useEffect(() => {
    let active = true;
    let updated = false;
    let failed = false;
    const reject = async () => {
      if (!active || failed) return;
      failed = true;
      setView(null);
      console.warn("Metafor guidance could not be displayed.");
      // A click-through overlay cannot offer recovery controls. Help owns those controls.
      try { await window.metaforDesktop.closeGuidance(); }
      catch { console.warn("Metafor guidance could not close; it will expire automatically."); }
    };
    const accept = (value: GuidancePayload | null) => {
      if (!active || failed) return;
      try { setView(readGuidance(value)); }
      catch { void reject(); }
    };
    const unsubscribe = window.metaforDesktop.onGuidanceLayoutChanged?.((value) => {
      updated = true;
      accept(value);
    });
    window.metaforDesktop.getGuidance().then((value) => {
      // A resize event may arrive before the initial read returns.
      if (!updated) accept(value);
    }).catch(() => { if (!updated) void reject(); });
    const resize = () => setViewport({ width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) });
    window.addEventListener("resize", resize);
    return () => { active = false; unsubscribe?.(); window.removeEventListener("resize", resize); };
  }, []);

  const help = view?.helpRegion;
  const labels = layoutGuidanceLabels(view?.marks ?? [], viewport, help
    ? [{ left: help.left * viewport.width, top: help.top * viewport.height, width: help.width * viewport.width, height: help.height * viewport.height }]
    : []);
  const scale = view ? view.width / viewport.width : 1;

  return <main className="metafor-guidance" aria-label="Guidance on your screen">
    {view && <>
      <svg className="guidance-marks" viewBox={`0 0 ${view.width} ${view.height}`} preserveAspectRatio="none" role="img" aria-label="Metafor guidance marks">
        <defs>
          <marker id={`${arrowId}-contrast`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth={10 * scale} markerHeight={10 * scale} markerUnits="userSpaceOnUse" orient="auto" overflow="visible"><path d="M 0 0 L 10 5 L 0 10 z" fill="#102433" stroke="#102433" strokeWidth="3" strokeLinejoin="round" /></marker>
          <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth={10 * scale} markerHeight={10 * scale} markerUnits="userSpaceOnUse" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#69dfff" /></marker>
        </defs>
        {view.marks.map((mark, index) => <g key={mark.id} className="guidance-mark" data-mark-id={mark.id}>
          <title>{mark.label || `Mark ${index + 1}`}</title>
          <g className="guidance-contrast" aria-hidden="true"><MarkShape mark={mark} view={view} scale={scale} arrowId={`${arrowId}-contrast`} /></g>
          <g className="guidance-accent"><MarkShape mark={mark} view={view} scale={scale} arrowId={arrowId} /></g>
        </g>)}
      </svg>
      <div className="guidance-labels" aria-label="Guidance labels">{labels.map(({ mark, left, top, width, height }) => <p key={mark.id} className="guidance-label" style={{ left, top, width, maxHeight: height }}>{mark.label}</p>)}</div>
    </>}
  </main>;
}
