import { useLayoutEffect, useRef, useState } from "react";
import type { SourceReference } from "@/lib/model";

type AnnotationComposerProps = {
  source: SourceReference;
  label: string;
  value: string;
  anchor: Range | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  onAddAnother: () => void;
  count: number;
  busy: boolean;
  error?: string;
};
type Placement = { left: number; top: number; width: number; maxHeight: number };

function sourceSection(source: SourceReference) {
  return document.querySelector<HTMLElement>(`[data-topic="${CSS.escape(source.explorationId)}"] [data-message-id="${CSS.escape(source.messageId)}"] [data-section-id="${CSS.escape(source.sectionId)}"]`);
}

export default function AnnotationComposer(props: AnnotationComposerProps) {
  const { source, anchor } = props;
  const panel = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const sourceKey = `${source.explorationId}:${source.messageId}:${source.sectionId}:${source.endSectionId ?? ""}:${source.quote ?? ""}`;

  useLayoutEffect(() => {
    if (placement) input.current?.focus({ preventScroll: true });
  }, [sourceKey, Boolean(placement)]);

  useLayoutEffect(() => {
    let frame = 0;
    let previous = "";
    const measure = () => {
      const section = sourceSection(source);
      const reader = section?.closest<HTMLElement>(".topic-reading");
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + 8;
      const top = (viewport?.offsetTop ?? 0) + 8;
      const right = left + (viewport?.width ?? window.innerWidth) - 16;
      const bottom = top + (viewport?.height ?? window.innerHeight) - 16;
      const width = Math.max(0, Math.min(320, right - left));
      const maxHeight = Math.max(0, bottom - top);
      const height = Math.min(maxHeight, panel.current?.getBoundingClientRect().height || 224);
      const readerBounds = reader?.getBoundingClientRect();
      const sectionBounds = section?.getBoundingClientRect();
      let rect = sectionBounds;
      if (anchor?.startContainer.isConnected && anchor.endContainer.isConnected && typeof anchor.getClientRects === "function") {
        const visible = Array.from(anchor.getClientRects()).filter((entry) => entry.width > 0 && entry.height > 0 && entry.right > Math.max(left, readerBounds?.left ?? left) && entry.left < Math.min(right, readerBounds?.right ?? right) && entry.bottom > Math.max(top, readerBounds?.top ?? top) && entry.top < Math.min(bottom, readerBounds?.bottom ?? bottom));
        rect = visible.at(-1) ?? rect;
      }
      // Whole-section actions anchor near the heading, even for a long section.
      const anchorTop = rect?.top ?? top;
      const anchorBottom = rect && rect !== sectionBounds ? rect.bottom : anchorTop + 28;
      const card = section?.closest<HTMLElement>("[data-topic]")?.getBoundingClientRect();
      let x = rect?.left ?? left;
      let y = anchorBottom + 10;
      if (card && card.right + 12 + width <= right) { x = card.right + 12; y = anchorTop - 10; }
      else if (card && card.left - 12 - width >= left) { x = card.left - 12 - width; y = anchorTop - 10; }
      else if (y + height > bottom && anchorTop - height - 10 >= top) y = anchorTop - height - 10;
      const next = {
        left: Math.round(Math.max(left, Math.min(x, right - width))),
        top: Math.round(Math.max(top, Math.min(y, bottom - height))),
        width: Math.round(width),
        maxHeight: Math.round(maxHeight),
      };
      const key = JSON.stringify(next);
      if (previous !== key) { previous = key; setPlacement(next); }
      frame = requestAnimationFrame(measure);
    };
    measure();
    // The camera animates with transforms; resize/scroll events alone miss it.
    return () => cancelAnimationFrame(frame);
  }, [sourceKey, anchor]);

  const close = () => {
    const reader = sourceSection(source)?.closest<HTMLElement>(".topic-reading");
    props.onClose();
    reader?.focus({ preventScroll: true });
  };
  const hasQuestion = Boolean(props.value.trim());

  return <form ref={panel} className="annotation-popover" role="dialog" aria-label="Annotation" data-no-selection style={placement ?? { visibility: "hidden" }} onSubmit={(event) => {
    event.preventDefault();
    if (hasQuestion && !props.busy) props.onSubmit();
  }} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <div className="annotation-popover-heading"><span>Annotation</span><button type="button" aria-label="Close annotation" onClick={close}>×</button></div>
    <p className="annotation-popover-source" title={props.label}>{props.label || "Selected section"}</p>
    <textarea ref={input} aria-label="Annotation question" value={props.value} onChange={(event) => props.onChange(event.target.value)} onKeyDown={(event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
    }} rows={3} maxLength={8000} placeholder="Ask about this passage…" />
    {props.error && <p className="annotation-popover-error" role="alert">{props.error}</p>}
    <div className="annotation-popover-actions">
      {hasQuestion && <button type="button" onClick={props.onAddAnother}>Add another annotation +</button>}
      <button type="submit" aria-label={props.count > 1 ? "Send annotations" : "Send annotation"} disabled={!hasQuestion || props.busy}>{props.busy ? "Thinking…" : props.count > 1 ? `Send ${props.count} annotations` : "Send annotation"}<span aria-hidden="true"> ↑</span></button>
    </div>
  </form>;
}
