"use client";

import { memo, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { SpatialNode, SpatialPoint } from "@/lib/spatial";
import { MAP_HEIGHT, MAP_WIDTH, mapDestination, projectSpaceMap } from "@/lib/minimap";
import type { SpatialLink } from "./SpatialWorld";

type SpaceMapProps = {
  nodes: SpatialNode[];
  links: SpatialLink[];
  activeId: string;
  view: SpatialPoint;
  labels?: Record<string, string>;
  onNavigate: (id: string) => void;
  onOverview: () => void;
};

function SpaceMap({ nodes, links, activeId, view, labels, onNavigate, onOverview }: SpaceMapProps) {
  const projection = useMemo(() => projectSpaceMap(nodes), [nodes]);
  const byId = useMemo(() => new Map(projection.nodes.map((node) => [node.id, node])), [projection]);
  const synthesisIds = useMemo(() => new Set(links.filter((link) => link.type === "synthesis").map((link) => link.to)), [links]);
  const destination = mapDestination(view, projection);
  const elements = useRef(new Map<string, SVGGElement>());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const tooltipId = useId();
  const previewId = hoveredId ?? focusedId;
  const preview = previewId && previewId !== dismissedId ? byId.get(previewId) : undefined;
  const tabStop = focusedId && byId.has(focusedId) ? focusedId : byId.has(activeId) ? activeId : projection.nodes[0]?.id;
  const drawn = [...projection.nodes].sort((a, b) => a.id === activeId ? 1 : b.id === activeId ? -1 : a.depth - b.depth);

  const keydown = (event: KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === "Escape" && preview) { event.preventDefault(); event.stopPropagation(); setDismissedId(preview.id); return; }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onNavigate(id); return; }
    const index = projection.nodes.findIndex((node) => node.id === id);
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % projection.nodes.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + projection.nodes.length - 1) % projection.nodes.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = projection.nodes.length - 1;
    else return;
    event.preventDefault();
    elements.current.get(projection.nodes[next].id)?.focus();
  };

  return <aside className="space-map" aria-label="Conversation map">
    <div className="space-map-heading"><span>Conversation map</span><button className="space-map-overview" type="button" onClick={onOverview} aria-label="Show Conversation map" title="Show Conversation map">↗</button></div>
    <div style={{ position: "relative" }}>
    <svg className="space-map-viewport" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} width={MAP_WIDTH} height={MAP_HEIGHT} role="group" aria-label="Conversation map topics" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedId(null); }}>
      <defs><marker id="map-synthesis-arrow" viewBox="0 0 6 6" refX="9" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L6 3L0 6Z" fill="#999" /></marker></defs>
      {links.map((link, index) => {
        if (link.type === "origin" && synthesisIds.has(link.to)) return null;
        const from = byId.get(link.from);
        const to = byId.get(link.to);
        return from && to && from.id !== to.id ? <line key={`${link.from}:${link.to}:${index}`} className={`space-map-edge ${link.type === "related" ? "is-related" : ""}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} strokeDasharray={link.type === "related" ? "2 3" : undefined} markerEnd={link.type === "synthesis" ? "url(#map-synthesis-arrow)" : undefined} aria-hidden="true" /> : null;
      })}
      {destination && <g className={`space-map-camera ${destination.outside ? "is-outside" : ""}`} transform={`translate(${destination.x} ${destination.y}) rotate(${destination.angle})`} aria-hidden="true" pointerEvents="none">
        <title>{destination.outside ? "Camera destination is beyond this map; the marker points toward it." : "Camera destination"}</title>
        <path d={destination.outside ? "M4 0L-3 -3L-3 3Z" : "M0 -4L4 0L0 4L-4 0Z"} />
      </g>}
      {drawn.map((node) => <g key={node.id} ref={(element) => { if (element) elements.current.set(node.id, element); else elements.current.delete(node.id); }} className={`space-map-node ${node.id === activeId ? "is-active" : ""}`} data-map-node={node.id} transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={node.id === tabStop ? 0 : -1} aria-label={`Focus topic: ${labels?.[node.id] || node.id}`} aria-current={node.id === activeId ? "location" : undefined} aria-describedby={preview?.id === node.id ? tooltipId : undefined} onPointerEnter={() => { setHoveredId(node.id); setDismissedId(null); }} onPointerLeave={() => setHoveredId(null)} onFocus={() => { setFocusedId(node.id); setHoveredId(null); setDismissedId(null); }} onClick={() => onNavigate(node.id)} onKeyDown={(event) => keydown(event, node.id)}>
        <circle className="space-map-hit" r={8} style={{ fill: "transparent", stroke: "none" }} />
        <circle className="space-map-dot" r={node.id === activeId ? 3.4 : 2.2} />
      </g>)}
      {!projection.nodes.length && <text className="space-map-empty" x={MAP_WIDTH / 2} y={MAP_HEIGHT / 2} textAnchor="middle">No topics yet</text>}
    </svg>
    {preview && <div id={tooltipId} role="tooltip" style={{ position: "absolute", left: 4, right: 4, ...(preview.y > MAP_HEIGHT / 2 ? { top: 4 } : { bottom: 4 }), maxHeight: "calc(100% - 8px)", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #383838", borderRadius: 4, background: "#080808f5", color: "#e5e5e5", fontSize: 11, lineHeight: 1.4, overflowWrap: "anywhere", overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 4, pointerEvents: "none" }}>{labels?.[preview.id] || preview.id}</div>}
    </div>
    <span className="space-map-legend" title="The camera’s destination while moving between topics.">◇ Destination</span>
  </aside>;
}

export default memo(SpaceMap);
