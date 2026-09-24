// Smooth Training HQ — the station map, animated (S238).
//
// The pure half lives in hqStation.js: the map, the routes and every draw
// call. This file owns the canvas: it paints the still building once into an
// offscreen layer, then every frame lays the people, the blinking lights and
// the selected room's outline over it — 320 × 240 pixels, scaled up by CSS
// with square pixels (`image-rendering: pixelated`), so it stays crisp at any
// width without redrawing at the screen's resolution.
//
// Name tags are HTML, not canvas text, so they stay sharp; the walkers' tags
// follow them by having their position written every frame (two or three
// elements — cheap). With reduced motion on, nothing walks and the map paints
// once, then again only when the selection changes.

import { useEffect, useRef } from "react";
import {
  MAP_W, MAP_H, ROOM_RECTS, MAP_LABELS, SEAT_SPOTS,
  makeWalkers, stepWalker, drawStatic, drawDynamic, roomAt,
} from "./hqStation.js";

export default function HQStation({ seats, roomStates, board, selected, onSelect, reduceMotion }) {
  const canvasRef = useRef(null);
  const tagRefs = useRef({});
  const selectedRef = useRef(selected);
  const repaintRef = useRef(null);

  useEffect(() => {
    selectedRef.current = selected;
    if (repaintRef.current) repaintRef.current();
  }, [selected]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas && canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.imageSmoothingEnabled = false;
    const layer = document.createElement("canvas");
    layer.width = MAP_W;
    layer.height = MAP_H;
    const lctx = layer.getContext("2d");
    if (!lctx) return undefined;
    drawStatic(lctx, { seats, roomStates });

    const walkers = makeWalkers(seats, 0);
    const start = performance.now();
    let last = start;
    let raf = 0;
    const paint = (now) => {
      const t = now - start;
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      if (!reduceMotion) walkers.forEach((w) => stepWalker(w, dt, t));
      ctx.clearRect(0, 0, MAP_W, MAP_H);
      ctx.drawImage(layer, 0, 0);
      drawDynamic(ctx, reduceMotion ? 0 : t, { walkers, seats, selected: selectedRef.current, board });
      for (const w of walkers) {
        const el = tagRefs.current[w.id];
        if (el) {
          el.style.left = `${(w.x / MAP_W) * 100}%`;
          el.style.top = `${((w.y - 12) / MAP_H) * 100}%`;
        }
      }
    };
    if (reduceMotion) {
      repaintRef.current = () => paint(performance.now());
      paint(start);
    } else {
      repaintRef.current = null;
      const loop = (now) => { paint(now); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    }
    return () => { cancelAnimationFrame(raf); repaintRef.current = null; };
  }, [seats, roomStates, board, reduceMotion]);

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
    if (s.status === "training") walkerStart[s.id] = (SEAT_SPOTS[s.room] || [])[i];
  }
  const owner = seats.find((s) => s.status === "you");

  return (
    <div className="hq-map">
      <canvas ref={canvasRef} width={MAP_W} height={MAP_H} onClick={onClick} onMouseMove={onMove}
        role="img" aria-label="A map of the building: rooms for each department, the crew walking the halls. Choose a department from the list to see who works there." />
      {Object.keys(ROOM_RECTS).map((id) => {
        const r = ROOM_RECTS[id];
        return (
          <span key={id} aria-hidden="true" className={`hq-map-label${selected === id ? " is-selected" : ""}`}
            style={{ left: `${((r.x + 5) / MAP_W) * 100}%`, top: `${((r.y + 9) / MAP_H) * 100}%` }}>
            {MAP_LABELS[id]}
          </span>
        );
      })}
      {owner && (
        <span aria-hidden="true" className="hq-map-tag hq-map-tag-you"
          style={{ left: `${(SEAT_SPOTS.owner[0][0] / MAP_W) * 100}%`, top: `${((SEAT_SPOTS.owner[0][1] - 12) / MAP_H) * 100}%` }}>
          You
        </span>
      )}
      {seats.filter((s) => walkerStart[s.id]).map((s) => (
        <span key={s.id} aria-hidden="true" className="hq-map-tag hq-map-tag-training"
          ref={(el) => { tagRefs.current[s.id] = el; }}
          style={{ left: `${(walkerStart[s.id][0] / MAP_W) * 100}%`, top: `${((walkerStart[s.id][1] - 12) / MAP_H) * 100}%` }}>
          {s.short}
        </span>
      ))}
    </div>
  );
}
