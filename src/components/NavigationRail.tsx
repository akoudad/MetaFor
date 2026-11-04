"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Exploration } from "@/lib/model";

type NavigationRailProps = {
  items: Exploration[];
  activeId: string;
  onNavigate: (id: string) => void;
};

export default function NavigationRail({ items, activeId, onNavigate }: NavigationRailProps) {
  const list = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [preview, setPreview] = useState<{ id: string; y: number } | null>(null);
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const previewItem = items.find((item) => item.id === preview?.id);

  const reveal = (id: string) => {
    const container = list.current;
    const button = buttons.current.get(id);
    if (!container || !button) return;
    // Scroll only this rail, never the page or the topic's reading area.
    const top = button.offsetTop;
    container.scrollTop = Math.max(top + button.offsetHeight - container.clientHeight, Math.min(container.scrollTop, top));
  };

  useEffect(() => { reveal(activeId); }, [activeId]);

  const showPreview = (id: string) => {
    const button = buttons.current.get(id);
    const container = list.current;
    if (!button || !container) return;
    const top = container.getBoundingClientRect().top;
    const y = button.offsetTop - container.scrollTop + button.offsetHeight / 2;
    setPreview({ id, y: Math.max(190 - top, Math.min(window.innerHeight - 232 - top, y)) });
  };

  const navigateKeys = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowDown") next = Math.min(items.length - 1, index + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Escape" && preview) {
      event.stopPropagation();
      setPreview(null);
      return;
    } else return;
    event.preventDefault();
    reveal(items[next].id);
    buttons.current.get(items[next].id)?.focus({ preventScroll: true });
    showPreview(items[next].id);
  };

  const updateAfterScroll = () => {
    const container = list.current;
    const button = preview && buttons.current.get(preview.id);
    if (container && button && document.activeElement === button &&
        button.offsetTop >= container.scrollTop &&
        button.offsetTop + button.offsetHeight <= container.scrollTop + container.clientHeight) {
      showPreview(preview!.id);
    } else setPreview(null);
  };

  return <nav className="navigation-rail" aria-label="Conversation navigation" onPointerLeave={() => {
    const button = preview && buttons.current.get(preview.id);
    if (!button || !button.matches(":focus-visible")) setPreview(null);
  }}>
    <div className="rail-ticks" ref={list} onScroll={updateAfterScroll}>
      {items.map((item, index) => <button
        key={item.id}
        ref={(element) => { if (element) buttons.current.set(item.id, element); else buttons.current.delete(item.id); }}
        className={`rail-stop ${Math.abs(index - activeIndex) === 1 ? "is-neighbor" : ""}`}
        aria-label={`Go to ${item.title}`}
        aria-current={item.id === activeId ? "location" : undefined}
        aria-describedby={preview?.id === item.id ? "rail-preview" : undefined}
        tabIndex={item.id === activeId ? 0 : -1}
        onPointerEnter={() => showPreview(item.id)}
        onFocus={() => showPreview(item.id)}
        onBlur={() => setPreview(null)}
        onKeyDown={(event) => navigateKeys(event, index)}
        onClick={() => onNavigate(item.id)}
      ><span aria-hidden="true" /></button>)}
    </div>
    {preview && previewItem && <div className="rail-preview" id="rail-preview" role="tooltip" style={{ top: preview.y }}>
      <p className="rail-preview-position">{items.indexOf(previewItem) + 1} / {items.length}</p>
      <p className="rail-preview-title">{previewItem.title}</p>
      <p className="rail-preview-summary">{previewItem.summary}</p>
    </div>}
  </nav>;
}
