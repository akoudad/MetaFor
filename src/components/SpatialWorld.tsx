"use client";

import { useId, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { CARD_HEIGHT, CARD_WIDTH, FIELD_OF_VIEW, connectionEndpoints, detailForScale } from "@/lib/spatial";

export type WorldPoint = { x: number; y: number; z: number };
export type SpatialNode = { id: string; position: WorldPoint };
export type SpatialLink = {
  from: string;
  to: string;
  type?: "origin" | "related";
  status?: "suggested" | "accepted";
  reason?: string;
};

type SpatialWorldProps = {
  nodes: SpatialNode[];
  links: SpatialLink[];
  activeId?: string;
  view: WorldPoint;
  reducedMotion: boolean;
  onViewChange?: (view: WorldPoint) => void;
  children: (node: SpatialNode) => ReactNode;
};

type Projection = { x: number; y: number; scale: number; opacity: number; visible: boolean };

const DEFAULT_VIEW: WorldPoint = { x: 0, y: 0, z: 900 };
const FADE_START_SCALE = 1.7;
const MAX_PROJECTED_SCALE = 2.5;
const STAR_VOLUME = { x: 60_000, y: 48_000, z: 30_000 };
const AMBIENT_FRAME_MS = 1000 / 30;

function createStars() {
  let seed = 7727;
  const random = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };

  return Array.from({ length: 520 }, () => {
    const prominent = random() < 0.08;
    return {
      x: (random() - 0.5) * STAR_VOLUME.x,
      y: (random() - 0.5) * STAR_VOLUME.y,
      z: -random() * STAR_VOLUME.z,
      size: prominent ? 38 + random() * 24 : 12 + random() * 14,
      opacity: prominent ? 0.58 + random() * 0.24 : 0.24 + random() * 0.24,
      minRadius: prominent ? 0.9 : 0.45,
      maxRadius: prominent ? 2 : 1.15,
    };
  });
}

const STARS = createStars();

function wrap(value: number, span: number) {
  return ((value % span) + span) % span;
}

function finitePoint(point: WorldPoint, fallback: WorldPoint): WorldPoint {
  return {
    x: Number.isFinite(point.x) ? point.x : fallback.x,
    y: Number.isFinite(point.y) ? point.y : fallback.y,
    z: Number.isFinite(point.z) ? point.z : fallback.z,
  };
}

function linkKey(link: { from: string; to: string }, index: number) {
  return `${link.from}:${link.to}:${index}`;
}

export default function SpatialWorld(props: SpatialWorldProps) {
  const arrowId = `origin-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const starsRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeElements = useRef(new Map<string, HTMLDivElement>());
  const linkElements = useRef(new Map<string, SVGLineElement>());
  const latest = useRef(props);
  const wakeRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    latest.current = props;
    wakeRef.current?.();
  }, [props]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Valid saved coordinates can be much farther apart than a small sample.
    const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 1, 30_000_000);
    let starsContext: CanvasRenderingContext2D | null = null;
    try {
      starsContext = starsRef.current?.getContext("2d") ?? null;
    } catch (error) {
      console.warn("Starfield unavailable; keeping the conversation view.", error);
    }
    const currentView = new Vector3();
    const initialView = finitePoint(latest.current.view, DEFAULT_VIEW);
    currentView.set(initialView.x, initialView.y, initialView.z);
    const targetView = new Vector3();
    const projected = new Vector3();
    const positions = new Map<string, Projection>();
    let width = 0;
    let height = 0;
    let focalLength = 0;
    let frame: number | null = null;
    let ambientFrame: number | null = null;
    let previousTime = 0;
    let previousAmbientTime = 0;
    let ambientSeconds = 0;
    let shootingSeed = 24083;
    const randomShooting = () => {
      shootingSeed = (shootingSeed * 48271) % 2147483647;
      return shootingSeed / 2147483647;
    };
    let nextShootingAt = 20 + randomShooting() * 20;
    let shooting: { started: number; x: number; y: number; dx: number; dy: number } | null = null;
    let disposed = false;

    const drawBackground = () => {
      if (starsContext && width > 0 && height > 0) {
        starsContext.clearRect(0, 0, width, height);
        // Only star coordinates drift. The camera, text, and link projection
        // remain unchanged when the user is reading at a settled view.
        const phase = latest.current.reducedMotion ? 0 : ambientSeconds;
        const driftX = Math.sin(phase / 75) * 120;
        const driftY = Math.sin(phase / 105) * 100;
        // Repeating world-space copies wrap beyond the viewport. Near/far fades
        // keep depth travel continuous without allowing near-plane point blobs.
        const tangent = Math.tan(FIELD_OF_VIEW * Math.PI / 360);
        const far = Math.min(
          STAR_VOLUME.z,
          (STAR_VOLUME.x / 2 - 2000) / (tangent * camera.aspect),
          (STAR_VOLUME.y / 2 - 2000) / tangent,
        );

        for (const star of STARS) {
          const distance = wrap(currentView.z - star.z, STAR_VOLUME.z);
          if (distance <= 900 || distance >= far) continue;

          const x = wrap(star.x + driftX - currentView.x + STAR_VOLUME.x / 2, STAR_VOLUME.x) - STAR_VOLUME.x / 2;
          const y = wrap(star.y + driftY - currentView.y + STAR_VOLUME.y / 2, STAR_VOLUME.y) - STAR_VOLUME.y / 2;
          projected.set(currentView.x + x, currentView.y + y, currentView.z - distance).project(camera);
          const screenX = (projected.x + 1) * width / 2;
          const screenY = (1 - projected.y) * height / 2;
          if (screenX < -1 || screenX > width + 1 || screenY < -1 || screenY > height + 1) continue;

          const fade = Math.min(1, (distance - 900) / 2500, (far - distance) / 4000);
          const radius = Math.min(star.maxRadius, Math.max(star.minRadius, star.size * focalLength / distance));
          starsContext.fillStyle = `rgba(220, 220, 220, ${star.opacity * fade})`;
          starsContext.beginPath();
          starsContext.arc(screenX, screenY, radius, 0, Math.PI * 2);
          starsContext.fill();
        }

        if (shooting && !latest.current.reducedMotion) {
          const progress = Math.min(1, (ambientSeconds - shooting.started) / 1.05);
          const fade = Math.sin(progress * Math.PI);
          const headX = shooting.x * width + shooting.dx * progress * 80;
          const headY = shooting.y * height + shooting.dy * progress * 80;
          const tailX = headX - shooting.dx * fade * 58;
          const tailY = headY - shooting.dy * fade * 58;
          const trail = starsContext.createLinearGradient(tailX, tailY, headX, headY);
          trail.addColorStop(0, "rgba(220, 220, 220, 0)");
          trail.addColorStop(1, `rgba(220, 220, 220, ${fade * 0.38})`);
          starsContext.strokeStyle = trail;
          starsContext.lineWidth = 1;
          starsContext.beginPath();
          starsContext.moveTo(tailX, tailY);
          starsContext.lineTo(headX, headY);
          starsContext.stroke();
        }
      }
    };

    const ambientEnabled = () => !disposed && Boolean(starsContext) &&
      !latest.current.reducedMotion && document.visibilityState !== "hidden" && width > 0 && height > 0;

    const animateBackground = (time: number) => {
      ambientFrame = null;
      if (!ambientEnabled()) return;
      if (!previousAmbientTime) previousAmbientTime = time;
      const elapsed = time - previousAmbientTime;
      if (elapsed >= AMBIENT_FRAME_MS) {
        // Resetting this clock on visibility changes prevents catch-up motion.
        ambientSeconds += Math.min(elapsed / 1000, 0.1);
        previousAmbientTime = time;
        if (shooting && ambientSeconds - shooting.started >= 1.05) shooting = null;
        if (!shooting && ambientSeconds >= nextShootingAt) {
          const left = randomShooting() < 0.5;
          const top = randomShooting() < 0.5;
          shooting = {
            started: ambientSeconds,
            x: left ? 0.08 + randomShooting() * 0.12 : 0.8 + randomShooting() * 0.12,
            y: top ? 0.08 + randomShooting() * 0.08 : 0.84 + randomShooting() * 0.08,
            dx: left ? 0.94 : -0.94,
            dy: top ? -0.34 : 0.34,
          };
          nextShootingAt = ambientSeconds + 20 + randomShooting() * 20;
        }
        // Navigation already redraws the canvas with the moving camera.
        // Idle frames only touch the canvas, never HTML nodes or SVG links.
        if (frame === null) drawBackground();
      }
      ambientFrame = requestAnimationFrame(animateBackground);
    };

    const syncAmbient = () => {
      if (ambientEnabled()) {
        if (ambientFrame === null) {
          previousAmbientTime = 0;
          ambientFrame = requestAnimationFrame(animateBackground);
        }
      } else {
        if (ambientFrame !== null) cancelAnimationFrame(ambientFrame);
        ambientFrame = null;
        previousAmbientTime = 0;
        shooting = null;
        if (latest.current.reducedMotion) ambientSeconds = 0;
        nextShootingAt = ambientSeconds + 20 + randomShooting() * 20;
      }
    };

    const render = (time: number) => {
      frame = null;
      if (disposed || document.visibilityState === "hidden") return;

      const { nodes, links, view, reducedMotion, activeId } = latest.current;
      const target = finitePoint(view, DEFAULT_VIEW);
      targetView.set(target.x, target.y, target.z);
      const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 1 / 60;
      previousTime = time;

      if (reducedMotion || currentView.distanceToSquared(targetView) < 0.01) {
        currentView.copy(targetView);
      } else {
        currentView.lerp(targetView, 1 - Math.exp(-9 * delta));
      }

      camera.position.copy(currentView);
      // A shared, unrotated camera looks down -Z. Positive world Y points up.
      camera.updateMatrixWorld();
      latest.current.onViewChange?.({ x: currentView.x, y: currentView.y, z: currentView.z });
      positions.clear();
      const minimumDistance = Math.max(camera.near, focalLength / MAX_PROJECTED_SCALE);
      drawBackground();

      for (const node of nodes) {
        const element = nodeElements.current.get(node.id);
        if (!element) continue;

        const { x, y, z } = node.position;
        const distance = currentView.z - z;
        const visible =
          width > 0 && height > 0 &&
          Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) &&
          distance > minimumDistance && distance < camera.far;

        if (!visible) {
          element.style.visibility = "hidden";
          element.style.opacity = "0";
          element.inert = true;
          element.setAttribute("aria-hidden", "true");
          positions.set(node.id, { x: 0, y: 0, scale: 0, opacity: 0, visible: false });
          continue;
        }

        projected.set(x, y, z).project(camera);
        const screenX = (projected.x + 1) * width / 2;
        const screenY = (1 - projected.y) * height / 2;
        const scale = focalLength / distance;
        const opacity = Math.min(1, (MAX_PROJECTED_SCALE - scale) / (MAX_PROJECTED_SCALE - FADE_START_SCALE));
        const halfWidth = CARD_WIDTH * scale / 2;
        const halfHeight = CARD_HEIGHT * scale / 2;
        const onScreen =
          screenX + halfWidth >= 0 && screenX - halfWidth <= width &&
          screenY + halfHeight >= 0 && screenY - halfHeight <= height;

        element.style.visibility = onScreen ? "visible" : "hidden";
        // Preserve mounted content and scroll positions while the camera passes
        // a card's plane, without creating an enormous compositor layer.
        element.style.opacity = String(opacity);
        element.inert = !onScreen;
        if (onScreen) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", "true");

        element.style.left = `${screenX}px`;
        element.style.top = `${screenY}px`;
        element.style.transform = `translate(-50%, -50%) scale(${scale})`;
        // A deliberately overlapping manual placement must never cover the
        // topic being read. Other cards keep their depth ordering.
        element.style.zIndex = String(node.id === activeId ? camera.far + 1 : Math.max(1, Math.round(camera.far - distance)));
        element.style.setProperty("--node-scale", String(Math.max(0.1, scale)));
        const mobileFullThreshold = Math.max(0.1, (width - 32) / CARD_WIDTH * 0.9);
        element.dataset.detail = scale >= mobileFullThreshold ? "full" : detailForScale(scale);
        // Keep projectable endpoints so links can cross the clipped viewport
        // even when an endpoint's card is completely offscreen.
        positions.set(node.id, { x: screenX, y: screenY, scale, opacity, visible: true });
      }

      const ancestry = new Set<string>();
      const parents = new Map(links.filter((link) => link.type !== "related").map((link) => [link.to, link.from]));
      let ancestor = activeId;
      while (ancestor && !ancestry.has(ancestor)) {
        ancestry.add(ancestor);
        ancestor = parents.get(ancestor);
      }

      for (let index = 0; index < links.length; index += 1) {
        const link = links[index];
        const line = linkElements.current.get(linkKey(link, index));
        if (!line) continue;

        const from = positions.get(link.from);
        const to = positions.get(link.to);
        const endpoints = from?.visible && to?.visible ? connectionEndpoints(from, to) : null;
        const visible = Boolean(endpoints);
        line.style.visibility = visible ? "visible" : "hidden";
        if (!from || !to || !endpoints) continue;

        const related = link.type === "related";
        const direct = Boolean(activeId && (link.from === activeId || link.to === activeId));
        const onPath = ancestry.has(link.from) && ancestry.has(link.to);
        const emphasized = direct || (!related && onPath);
        const opacity = related
          ? (direct ? 0.5 : 0.14) * (link.status === "suggested" ? 0.6 : 1)
          : !activeId ? 0.4 : emphasized ? 0.72 : 0.17;

        line.setAttribute("x1", String(endpoints.start.x));
        line.setAttribute("y1", String(endpoints.start.y));
        line.setAttribute("x2", String(endpoints.end.x));
        line.setAttribute("y2", String(endpoints.end.y));
        line.setAttribute("opacity", String(opacity * Math.min(from.opacity, to.opacity)));
        line.setAttribute("stroke-width", emphasized ? "1.35" : "1");
      }

      if (currentView.distanceToSquared(targetView) > 0.01) {
        frame = requestAnimationFrame(render);
      }
    };

    const wake = () => {
      if (disposed) return;
      syncAmbient();
      if (document.visibilityState === "hidden" || frame !== null) return;
      previousTime = 0;
      frame = requestAnimationFrame(render);
    };

    const visibilityChanged = () => {
      previousTime = 0;
      previousAmbientTime = 0;
      if (document.visibilityState === "hidden") {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        syncAmbient();
      } else wake();
    };

    const resize = () => {
      width = container.clientWidth;
      height = container.clientHeight;
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      focalLength = (height / 2) / Math.tan(FIELD_OF_VIEW * Math.PI / 360);
      const starsCanvas = starsRef.current;
      if (starsCanvas && starsContext) {
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        starsCanvas.width = Math.max(1, Math.round(width * pixelRatio));
        starsCanvas.height = Math.max(1, Math.round(height * pixelRatio));
        starsContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      }
      svgRef.current?.setAttribute("viewBox", `0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}`);
      wake();
    };

    wakeRef.current = wake;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(container);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibilityChanged);
    resize();

    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibilityChanged);
      if (frame !== null) cancelAnimationFrame(frame);
      if (ambientFrame !== null) cancelAnimationFrame(ambientFrame);
      wakeRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="spatial-world"
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      <canvas
        ref={starsRef}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />
      <svg
        ref={svgRef}
        aria-hidden="true"
        width="100%"
        height="100%"
        style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
      >
        <defs>
          <marker id={arrowId} viewBox="0 0 8 8" refX={8} refY={4} markerWidth={8} markerHeight={8} orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0 0 L8 4 L0 8 Z" fill="#b8b8b8" />
          </marker>
        </defs>
        {props.links.map((link, index) => {
          const key = linkKey(link, index);
          return (
            <line
              key={key}
              ref={(element) => {
                if (element) linkElements.current.set(key, element);
                else linkElements.current.delete(key);
              }}
              stroke={link.type === "related" ? "#929292" : "#b8b8b8"}
              opacity={0.17}
              strokeWidth={1}
              strokeDasharray={link.type === "related" ? "5 6" : undefined}
              markerEnd={link.type === "related" ? undefined : `url(#${arrowId})`}
              vectorEffect="non-scaling-stroke"
              style={{ visibility: "hidden" }}
            >
              {link.reason && <title>{link.reason}</title>}
            </line>
          );
        })}
      </svg>
      {props.nodes.map((node) => (
        <div
          key={node.id}
          ref={(element) => {
            if (element) nodeElements.current.set(node.id, element);
            else nodeElements.current.delete(node.id);
          }}
          className="world-node"
          data-node-id={node.id}
          data-detail="full"
          style={{
            position: "absolute",
            width: CARD_WIDTH,
            left: 0,
            top: 0,
            transformOrigin: "center center",
            visibility: "hidden",
            pointerEvents: "none",
            willChange: "transform",
          }}
        >
          {props.children(node)}
        </div>
      ))}
    </div>
  );
}
