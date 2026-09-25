// Smooth Training HQ — the station map, animated (S238).
//
// The pure half lives in hqStation.js: the map, the routes, the scene and every
// draw call. This file owns the page: the painted building (src/hq-art/) sits
// in an <img>, and a transparent canvas over it draws the desks and the crew
// each frame, front to back, at the screen's own resolution so they stay sharp.
//
// Name tags and room labels are HTML, not canvas text, so they stay crisp; a
// walker's tag follows them by having its position written every frame (two or
// three elements — cheap). With reduced motion on, nobody walks and the canvas
// paints once, then again only when the selection changes.
//
// ⚠️ THE PIXEL MAP IS THE FALLBACK, NOT A LEFTOVER. If any of the art fails to
// load — a dead hashed name after a deploy, a flaky connection — the map
// redraws itself from rectangles (drawStatic/drawDynamic) instead of showing a
// black box. The owner always sees his building.

import { useEffect, useRef, useState } from "react";
import {
  MAP_W, MAP_H, ROOM_RECTS, MAP_LABELS, SEAT_SPOTS, SEAT_FACING, PERSON_H,
  makeWalkers, stepWalker, drawStatic, drawDynamic, roomAt, sceneItems, drawScene,
} from "./hqStation.js";
import stationSm from "./hq-art/station-v1-1280.webp";
import stationLg from "./hq-art/station-v1-2048.webp";
import crewUrl from "./hq-art/crew-v1.webp";
import ownerUrl from "./hq-art/owner-v1.webp";
import propsUrl from "./hq-art/props-v1.webp";

// The backing store never needs more pixels than the backdrop has.
const MAX_BACKING = 2048;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`couldn't load ${src}`));
    im.src = src;
  });
}

// The sprite sheets, loaded once per mount. `failed` flips the map to pixels.
function useSheets() {
  const [state, setState] = useState({ images: null, failed: false });
  useEffect(() => {
    let alive = true;
    Promise.all([loadImage(propsUrl), loadImage(crewUrl), loadImage(ownerUrl)])
      .then(([props, crew, owner]) => { if (alive) setState({ images: { props, crew, owner }, failed: false }); })
      .catch(() => { if (alive) setState({ images: null, failed: true }); });
    return () => { alive = false; };
  }, []);
  return state;
}

// Where a name tag sits for someone standing or seated at (x, y).
function tagSpot(x, y, seated, room) {
  const feet = seated && SEAT_FACING[room] === "up" ? y + 3 : y;
  return [x, feet - PERSON_H - 1];
}

export default function HQStation({ seats, roomStates, board, selected, onSelect, reduceMotion }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const tagRefs = useRef({});
  const selectedRef = useRef(selected);
  const repaintRef = useRef(null);
  const sheets = useSheets();
  const [bgFailed, setBgFailed] = useState(false);
  const [size, setSize] = useState(0);
  const painted = !sheets.failed && !bgFailed;

  useEffect(() => {
    selectedRef.current = selected;
    if (repaintRef.current) repaintRef.current();
  }, [selected]);

  // Track the map's on-screen width, so the canvas can match the screen's pixels.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setSize(Math.round(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas && canvas.getContext("2d");
    if (!ctx) return undefined;
    const walkers = makeWalkers(seats, 0);
    const start = performance.now();
    let last = start;
    let raf = 0;
    let paint;

    const placeTags = () => {
      for (const w of walkers) {
        const el = tagRefs.current[w.id];
        if (!el) continue;
        const [tx, ty] = painted ? tagSpot(w.x, w.y, w.mode === "sit", w.home) : [w.x, w.y - 12];
        el.style.left = `${(tx / MAP_W) * 100}%`;
        el.style.top = `${(ty / MAP_H) * 100}%`;
      }
    };

    if (painted) {
      if (!sheets.images || !size) return undefined;
      const dpr = Math.min(3, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
      const bw = Math.max(MAP_W, Math.min(MAX_BACKING, Math.round(size * dpr)));
      const bh = Math.round((bw * MAP_H) / MAP_W);
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      const k = bw / MAP_W;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      paint = (now) => {
        const t = now - start;
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
        last = now;
        if (!reduceMotion) walkers.forEach((w) => stepWalker(w, dt, t));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, bw, bh);
        ctx.setTransform(k, 0, 0, k, 0, 0);
        drawScene(ctx, sceneItems(seats, walkers), sheets.images, { t: reduceMotion ? 0 : t, selected: selectedRef.current });
        placeTags();
      };
    } else {
      if (canvas.width !== MAP_W) canvas.width = MAP_W;
      if (canvas.height !== MAP_H) canvas.height = MAP_H;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const layer = document.createElement("canvas");
      layer.width = MAP_W;
      layer.height = MAP_H;
      const lctx = layer.getContext("2d");
      if (!lctx) return undefined;
      drawStatic(lctx, { seats, roomStates });
      paint = (now) => {
        const t = now - start;
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
        last = now;
        if (!reduceMotion) walkers.forEach((w) => stepWalker(w, dt, t));
        ctx.clearRect(0, 0, MAP_W, MAP_H);
        ctx.drawImage(layer, 0, 0);
        drawDynamic(ctx, reduceMotion ? 0 : t, { walkers, seats, selected: selectedRef.current, board });
        placeTags();
      };
    }

    if (reduceMotion) {
      repaintRef.current = () => paint(performance.now());
      paint(start);
    } else {
      repaintRef.current = null;
      const loop = (now) => { paint(now); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }
    return () => { cancelAnimationFrame(raf); repaintRef.current = null; };
  }, [seats, roomStates, board, reduceMotion, painted, sheets.images, size]);

  const pointAt = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * MAP_W, ((e.clientY - r.top) / r.height) * MAP_H];
  };
  const onClick = (e) => {
    const id = roomAt(...pointAt(e));
    if (id && id !== "atrium") onSelect(id);
  };
  const onMove = (e) => {
    const id = roomAt(...pointAt(e));
    e.currentTarget.style.cursor = id && id !== "atrium" ? "pointer" : "default";
  };

  // Everyone who can walk starts at their own desk.
  const byRoom = {};
  const walkerStart = {};
  for (const s of seats) {
    const i = (byRoom[s.room] = (byRoom[s.room] || 0) + 1) - 1;
    if (s.status === "training") {
      const spot = (SEAT_SPOTS[s.room] || [])[i];
      if (spot) walkerStart[s.id] = painted ? tagSpot(spot[0], spot[1], true, s.room) : [spot[0], spot[1] - 12];
    }
  }
  const owner = seats.find((s) => s.status === "you");
  const ownerSpot = SEAT_SPOTS.owner[0];
  const ownerTag = painted ? tagSpot(ownerSpot[0], ownerSpot[1], true, "owner") : [ownerSpot[0], ownerSpot[1] - 12];

  return (
    <div ref={wrapRef} className={`hq-map${painted ? " is-painted" : ""}`}>
      {painted && (
        <img className="hq-map-art" src={stationSm} srcSet={`${stationSm} 1280w, ${stationLg} 2048w`}
          sizes="(min-width: 1100px) 680px, (min-width: 760px) 92vw, 100vw"
          alt="" draggable={false} onError={() => setBgFailed(true)} />
      )}
      <canvas ref={canvasRef} width={MAP_W} height={MAP_H} onClick={onClick} onMouseMove={onMove}
        role="img" aria-label="A map of the building: rooms for each department, the crew walking the halls. Choose a department from the list to see who works there." />
      {/* On the painted map each room's name sits on its front wall, like a
          nameplate, so it never lands under a worker's name tag. */}
      {Object.keys(ROOM_RECTS).map((id) => {
        const r = ROOM_RECTS[id];
        const state = roomStates && roomStates[id];
        return (
          <span key={id} aria-hidden="true" className={`hq-map-label${selected === id ? " is-selected" : ""}`}
            style={painted
              ? { left: `${((r.x + 4) / MAP_W) * 100}%`, top: `${((r.y + r.h - 1.2) / MAP_H) * 100}%`, transform: "translateY(-100%)" }
              : { left: `${((r.x + 5) / MAP_W) * 100}%`, top: `${((r.y + 9) / MAP_H) * 100}%` }}>
            {state && <i className={`hq-map-dot hq-map-dot-${state}`} />}
            {MAP_LABELS[id]}
          </span>
        );
      })}
      {owner && (
        <span aria-hidden="true" className="hq-map-tag hq-map-tag-you"
          style={{ left: `${(ownerTag[0] / MAP_W) * 100}%`, top: `${(ownerTag[1] / MAP_H) * 100}%` }}>
          You
        </span>
      )}
      {seats.filter((s) => walkerStart[s.id]).map((s) => (
        <span key={s.id} aria-hidden="true" className="hq-map-tag hq-map-tag-training"
          ref={(el) => { tagRefs.current[s.id] = el; }}
          style={{ left: `${(walkerStart[s.id][0] / MAP_W) * 100}%`, top: `${(walkerStart[s.id][1] / MAP_H) * 100}%` }}>
          {s.short}
        </span>
      ))}
    </div>
  );
}
