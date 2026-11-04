"use client";

import { useId, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { CARD_HEIGHT, CARD_WIDTH, FIELD_OF_VIEW, connectionBounds, connectionEndpoints, detailForScale } from "@/lib/spatial";
import type { ProjectedCard } from "@/lib/spatial";
import { createBatchScene, createBranchScene, sampleBatchScene, sampleBranchScene } from "@/lib/scene";
import type { BatchScene, BranchScene } from "@/lib/scene";

export type WorldPoint = { x: number; y: number; z: number };
export type SpatialNode = { id: string; position: WorldPoint };
export type SpatialLink = {
  from: string;
  to: string;
  type?: "origin" | "related" | "synthesis";
  status?: "suggested" | "accepted";
  reason?: string;
};
export type SpatialTransition = { key: string; fromId: string; toId: string; toIds?: string[]; follow: boolean };

type SpatialWorldProps = {
  nodes: SpatialNode[];
  links: SpatialLink[];
  activeId?: string;
  visibleIds?: string[];
  view: WorldPoint;
  reducedMotion: boolean;
  transition?: SpatialTransition | null;
  onViewChange?: (view: WorldPoint) => void;
  children: (node: SpatialNode) => ReactNode;
};

type Projection = ProjectedCard & { opacity: number; visible: boolean };

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

  return Array.from({ length: 900 }, () => {
    const brightness = random();
    const prominent = brightness > 0.965;
    const medium = brightness > 0.82;
    return {
      x: (random() - 0.5) * STAR_VOLUME.x,
      y: (random() - 0.5) * STAR_VOLUME.y,
      z: -random() * STAR_VOLUME.z,
      size: prominent ? 32 + random() * 22 : medium ? 14 + random() * 12 : 4 + random() * 10,
      opacity: prominent ? 0.65 + random() * 0.25 : medium ? 0.35 + random() * 0.23 : 0.12 + random() * 0.3,
      minRadius: prominent ? 0.75 : medium ? 0.4 : 0.22,
      maxRadius: prominent ? 1.8 : medium ? 1.1 : 0.65,
      twinkle: prominent ? 0.08 : 0.035,
      phase: random() * Math.PI * 2,
      period: 4 + random() * 7,
    };
  });
}

const STARS = createStars();

/** Cache a distant, neutral galaxy once; ambient frames only composite it. */
function createGalaxy(): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 320;
  const context = canvas.getContext("2d");
  if (!context) return null;
  let seed = 94031;
  const random = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  context.save();
  context.translate(320, 160);
  context.scale(1, 0.28);
  const haze = context.createRadialGradient(0, 0, 2, 0, 0, 290);
  haze.addColorStop(0, "rgba(225, 225, 225, 0.045)");
  haze.addColorStop(0.25, "rgba(210, 210, 210, 0.025)");
  haze.addColorStop(1, "rgba(210, 210, 210, 0)");
  context.fillStyle = haze;
  context.fillRect(-300, -300, 600, 600);
  context.restore();
  for (let index = 0; index < 850; index++) {
    const bulge = index < 240;
    const radius = bulge ? Math.pow(random(), 1.5) * 0.24 : Math.sqrt(random()) * 0.93;
    const angle = bulge ? random() * Math.PI * 2 : (index % 2) * Math.PI + radius * 5 + (random() - 0.5) * 0.7;
    const x = 320 + Math.cos(angle) * radius * 285;
    const y = 160 + Math.sin(angle) * radius * 78 + (random() - 0.5) * 7;
    context.fillStyle = `rgba(225, 225, 225, ${0.035 + random() * 0.11})`;
    context.beginPath();
    context.arc(x, y, 0.25 + random() * 0.55, 0, Math.PI * 2);
    context.fill();
  }
  return canvas;
}

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
    let galaxy: HTMLCanvasElement | null = null;
    try {
      starsContext = starsRef.current?.getContext("2d") ?? null;
      if (starsContext) galaxy = createGalaxy();
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
    let knownNodeIds = new Set(latest.current.nodes.map((node) => node.id));
    let handledTransition = latest.current.transition?.key;
    let blockedView: WorldPoint | null = null;
    let branch: {
      trigger: SpatialTransition; nodeIds: string[]; scene: BranchScene | null; batch: BatchScene | null;
      elapsed: number; target: WorldPoint; viewInput: WorldPoint;
    } | null = null;
    let shootingSeed = 24083;
    const randomShooting = () => {
      shootingSeed = (shootingSeed * 48271) % 2147483647;
      return shootingSeed / 2147483647;
    };
    let nextShootingAt = 12 + randomShooting() * 12;
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
        if (galaxy) {
          const span = Math.min(410, Math.max(220, width * 0.32));
          const x = width * 0.82 - Math.sin(currentView.x / 24_000) * 14 + driftX * 0.012;
          const y = height * 0.18 + Math.sin(currentView.y / 24_000) * 9 - driftY * 0.008;
          starsContext.save();
          starsContext.translate(x, y);
          starsContext.rotate(-0.32);
          starsContext.globalAlpha = 0.8;
          starsContext.drawImage(galaxy, -span / 2, -span / 4, span, span / 2);
          starsContext.restore();
        }
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
          const twinkle = 1 + Math.sin(phase * Math.PI * 2 / star.period + star.phase) * star.twinkle;
          starsContext.fillStyle = `rgba(225, 225, 225, ${star.opacity * fade * twinkle})`;
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
          nextShootingAt = ambientSeconds + 12 + randomShooting() * 12;
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
        nextShootingAt = ambientSeconds + 12 + randomShooting() * 12;
      }
    };

    const render = (time: number) => {
      frame = null;
      if (disposed || document.visibilityState === "hidden") return;

      const { nodes, links, view, reducedMotion, activeId, visibleIds, transition } = latest.current;
      const visibleNodeIds = visibleIds ? new Set(visibleIds) : null;
      const requested = finitePoint(view, DEFAULT_VIEW);
      const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 1 / 60;
      previousTime = time;

      if (branch && (
        reducedMotion || transition?.key !== branch.trigger.key || transition.follow !== branch.trigger.follow ||
        view !== branch.viewInput || branch.nodeIds.some((id) => !nodes.some((node) => node.id === id)) ||
        requested.x !== branch.target.x || requested.y !== branch.target.y || requested.z !== branch.target.z
      )) {
        // Clearing a transition with no replacement camera target means stop,
        // not "continue easing to its old final destination".
        blockedView = !reducedMotion && view === branch.viewInput ? view : null;
        branch = null;
      }
      if (blockedView !== view || reducedMotion) blockedView = null;
      if (transition && transition.key !== handledTransition) {
        handledTransition = transition.key;
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const origins = new Map(links.filter((link) => !link.type || link.type === "origin").map((link) => [link.to, link.from]));
        const topics = [...new Set(transition.toIds ?? [transition.toId])].flatMap((id) => {
          const destination = nodeById.get(id);
          const sourceId = transition.toIds ? origins.get(id) ?? transition.fromId : transition.fromId;
          const source = nodeById.get(sourceId);
          return source && destination && !knownNodeIds.has(id)
            ? [{ id, source: source.position, destination: destination.position }] : [];
        });
        if (!reducedMotion && topics.length) {
          const startView = { x: currentView.x, y: currentView.y, z: currentView.z };
          branch = {
            trigger: { ...transition }, nodeIds: topics.map((topic) => topic.id), elapsed: 0, target: requested, viewInput: view,
            scene: transition.toIds ? null : createBranchScene(topics[0].source, topics[0].destination, startView, requested, width, height),
            batch: transition.toIds ? createBatchScene(topics, startView, requested) : null,
          };
          blockedView = null;
        }
      }
      knownNodeIds = new Set(nodes.map((node) => node.id));
      const target = blockedView ? currentView : requested;
      targetView.set(target.x, target.y, target.z);
      const reveals = new Map<string, Omit<ReturnType<typeof sampleBranchScene>, "view">>();
      let revealView: WorldPoint | null = null;
      let arrivalDone = false;
      if (branch) {
        branch.elapsed += delta * 1000;
        if (branch.batch) {
          const sample = sampleBatchScene(branch.batch, branch.elapsed);
          for (const node of sample.nodes) reveals.set(node.id, node);
          revealView = sample.view;
          arrivalDone = sample.done;
        } else if (branch.scene) {
          const sample = sampleBranchScene(branch.scene, branch.elapsed);
          reveals.set(branch.nodeIds[0], sample);
          revealView = sample.view;
          arrivalDone = sample.done;
        }
      }

      if (branch?.trigger.follow && revealView) {
        currentView.set(revealView.x, revealView.y, revealView.z);
      } else if (reducedMotion || currentView.distanceToSquared(targetView) < 0.01) {
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

        const reveal = reveals.get(node.id);
        const { x, y, z } = reveal?.position ?? node.position;
        const distance = currentView.z - z;
        const visible =
          (!visibleNodeIds || visibleNodeIds.has(node.id)) &&
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
        const scale = focalLength / distance * (reveal?.scale ?? 1);
        const opacity = Math.min(1, (MAX_PROJECTED_SCALE - scale) / (MAX_PROJECTED_SCALE - FADE_START_SCALE)) * (reveal?.opacity ?? 1);
        const halfWidth = CARD_WIDTH * scale / 2;
        const halfHeight = CARD_HEIGHT * scale / 2;
        const onScreen =
          screenX + halfWidth >= 0 && screenX - halfWidth <= width &&
          screenY + halfHeight >= 0 && screenY - halfHeight <= height;

        element.style.visibility = onScreen ? "visible" : "hidden";
        // Preserve mounted content and scroll positions while the camera passes
        // a card's plane, without creating an enormous compositor layer.
        element.style.opacity = String(opacity);
        const interactive = onScreen && (!reveal || reveal.done);
        element.inert = !interactive;
        if (interactive) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", "true");

        element.style.left = `${screenX}px`;
        element.style.top = `${screenY}px`;
        element.style.transform = `translate(-50%, -50%) scale(${scale})`;
        // A deliberately overlapping manual placement must never cover the
        // topic being read. Other cards keep their depth ordering.
        element.style.zIndex = String(node.id === activeId ? camera.far + 1 : Math.max(1, Math.round(camera.far - distance)));
        element.style.setProperty("--node-scale", String(Math.max(0.1, scale)));
        const mobileFullThreshold = Math.max(0.1, (width - 32) / CARD_WIDTH * 0.9);
        const detail = scale >= mobileFullThreshold ? "full" : detailForScale(scale);
        element.dataset.detail = detail;
        // Keep projectable endpoints so links can cross the clipped viewport
        // even when an endpoint's card is completely offscreen.
        positions.set(node.id, { ...connectionBounds({ x: screenX, y: screenY, scale }, detail), opacity, visible: true });
      }

      const ancestry = new Set<string>();
      const parents = new Map(links.filter((link) => !link.type || link.type === "origin").map((link) => [link.to, link.from]));
      const synthesized = new Set(links.filter((link) => link.type === "synthesis").map((link) => link.to));
      let ancestor = activeId;
      while (ancestor && !ancestry.has(ancestor)) {
        ancestry.add(ancestor);
        ancestor = parents.get(ancestor);
      }

      for (let index = 0; index < links.length; index += 1) {
        const link = links[index];
        const line = linkElements.current.get(linkKey(link, index));
        if (!line) continue;
        if ((!link.type || link.type === "origin") && synthesized.has(link.to)) {
          // Keep navigation ancestry, but show the actual synthesis inputs.
          line.style.visibility = "hidden";
          continue;
        }

        const from = positions.get(link.from);
        const to = positions.get(link.to);
        const endpoints = from?.visible && to?.visible ? connectionEndpoints(from, to) : null;
        const visible = Boolean(endpoints);
        line.style.visibility = visible ? "visible" : "hidden";
        if (!from || !to || !endpoints) continue;

        const related = link.type === "related";
        const direct = Boolean(activeId && (link.from === activeId || link.to === activeId));
        const onPath = (!link.type || link.type === "origin") && ancestry.has(link.from) && ancestry.has(link.to);
        const emphasized = direct || (!related && onPath);
        const opacity = related
          ? (direct ? 0.5 : 0.14) * (link.status === "suggested" ? 0.6 : 1)
          : !activeId ? 0.4 : emphasized ? 0.72 : 0.17;

        line.setAttribute("x1", String(endpoints.start.x));
        line.setAttribute("y1", String(endpoints.start.y));
        const edgeProgress = !related ? reveals.get(link.to)?.edgeProgress ?? 1 : 1;
        line.setAttribute("x2", String(endpoints.start.x + (endpoints.end.x - endpoints.start.x) * edgeProgress));
        line.setAttribute("y2", String(endpoints.start.y + (endpoints.end.y - endpoints.start.y) * edgeProgress));
        line.setAttribute("opacity", String(opacity * Math.min(from.opacity, to.opacity)));
        line.setAttribute("stroke-width", emphasized ? "1.35" : "1");
      }

      if (arrivalDone) branch = null;
      if (branch || currentView.distanceToSquared(targetView) > 0.01) {
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
