// Smooth Training HQ — the station map, animated (S238).
//
// The pure half lives in hqStation.js: the map, the routes, the scene and every
// draw call. This file owns the page: the painted building (src/hq-art/) is an
// image element, and a transparent canvas over it draws the desks and the crew
// each frame, front to back, at the screen's own resolution so they stay sharp.
//
// Name tags and room labels are HTML, not canvas text, so they stay crisp; a
// walker's tag follows them by having its position written every frame (a
// handful of elements — cheap). With reduced motion on, nobody walks and the
// canvas paints once, then again only when something changes.
//
// ⚠️ ROOM NAMES AND PEOPLE NEVER COVER EACH OTHER (Kevin: the names "can't be
// blocked by anyone who's walking and also the titles don't block the worker
// that's walking"). A name moves to a clear place on its room's walls before
// anyone reaches it, and a name TAG passing under a room's name fades for that
// moment. Both use sizes measured on screen, because on a phone a name is most
// of a room wide and no single spot on a wall is clear of everyone.
//
// ⚠️ THE MAP SHOWS WHAT THE CREW REALLY DOES. Kevin asked whether StarNet's
// station was "just a visual" — it isn't; it mirrors its agents' live state,
// and so does this one. A worker clocked in (hqtools.js hq_clock_in) sits at
// its desk working; a worker that files something walks it to the owner's
// desk (`deliveries`), and the page is told once it has been handed over.
// Between those, the crew wanders the building, a different day every visit.
//
// ⚠️ THE PIXEL MAP IS THE FALLBACK, NOT A LEFTOVER. If any of the art fails to
// load — a dead hashed name after a deploy, a flaky connection — the map
// redraws itself from rectangles (drawStatic/drawDynamic) instead of showing a
// black box. The owner always sees his building.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAP_W, MAP_H, ROOM_RECTS, MAP_LABELS, SEAT_SPOTS, SEAT_FACING, PERSON_H,
  makeWalkers, makeStation, stepCrew, queueDelivery, drawStatic, drawDynamic, roomAt, sceneItems, drawScene,
  labelSlots, placeLabel, crowdBoxes, tagsUnderLabels, personAt, tagLifts,
} from "./hqStation.js";
import stationSm from "./hq-art/station-v1-1280.webp";
import stationLg from "./hq-art/station-v1-2048.webp";
import crewUrl from "./hq-art/crew-v1.webp";
import ownerUrl from "./hq-art/owner-v1.webp";
import propsUrl from "./hq-art/props-v1.webp";

// The backing store never needs more pixels than the backdrop has.
const MAX_BACKING = 2048;
const HIRED = new Set(["training", "working", "on-shift"]);
const ROOM_IDS = Object.keys(ROOM_RECTS);
// How long a room's name takes to fade out before it moves (it fades back in
// at its new place), and how often the names check who is coming.
const LABEL_FADE_MS = 160;
const LABEL_CHECK_MS = 100;

// A first guess at a room name's size in map units, used only until the real
// one is measured, so the name starts where it will usually be.
const guessLabel = (id) => [MAP_LABELS[id].length * 5.1 + 7, 7.2];

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

export default function HQStation({
  seats, roomStates, board, selected, onSelect, reduceMotion,
  deliveries = [], onDelivered = null, deskCount = 0, onAgent = null,
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const tagRefs = useRef({});
  const labelRefs = useRef({});
  // Each room name's place on its walls, kept between frames.
  const labelState = useRef({});
  // Room names and name tags as drawn, in map units (measured on screen).
  const sizesRef = useRef(null);
  // Whose turn it is to walk work over to the owner (hqStation.js makeStation).
  const stationRef = useRef(null);
  const selectedRef = useRef(selected);
  const deskCountRef = useRef(deskCount);
  const seatsRef = useRef(seats);
  const walkersRef = useRef([]);
  const handedRef = useRef(new Set());
  const onDeliveredRef = useRef(onDelivered);
  const repaintRef = useRef(null);
  // One seed per opening: every visit to the HQ is a different day.
  const seedRef = useRef((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  const sheets = useSheets();
  const [bgFailed, setBgFailed] = useState(false);
  const [size, setSize] = useState(0);
  const painted = !sheets.failed && !bgFailed;

  useEffect(() => { onDeliveredRef.current = onDelivered; }, [onDelivered]);
  useEffect(() => {
    selectedRef.current = selected;
    deskCountRef.current = deskCount;
    if (repaintRef.current) repaintRef.current();
  }, [selected, deskCount]);

  // Who walks. The crew is rebuilt only when that set changes, never on a poll
  // that changed nothing — a rebuild sends everyone back to their desks.
  const walkerSig = seats.filter((s) => HIRED.has(s.status)).map((s) => s.id).join(",");
  useEffect(() => {
    const now = performance.now();
    walkersRef.current = makeWalkers(seatsRef.current, now, seedRef.current);
    stationRef.current = makeStation(now, seedRef.current);
    if (repaintRef.current) repaintRef.current();
  }, [walkerSig]);

  // Who is on shift right now: updated in place, so nobody jumps.
  useEffect(() => {
    seatsRef.current = seats;
    const byId = Object.fromEntries(seats.map((s) => [s.id, s]));
    for (const w of walkersRef.current) w.onShift = (byId[w.id] || {}).status === "on-shift";
    if (repaintRef.current) repaintRef.current();
  }, [seats]);

  // Hand each new desk item to the worker who filed it. With nobody on the
  // map to carry it (a worker not drawn, or reduced motion), it counts as
  // delivered at once — an item must never wait on an animation.
  useEffect(() => {
    const walkers = walkersRef.current;
    const now = [];
    for (const d of deliveries) {
      if (handedRef.current.has(d.id)) continue;
      const w = !reduceMotion && walkers.find((x) => x.id === d.worker);
      if (w) queueDelivery(w, [d.id], stationRef.current);
      else now.push(d.id);
    }
    if (now.length) {
      now.forEach((id) => handedRef.current.add(id));
      if (onDeliveredRef.current) onDeliveredRef.current(now);
    }
  }, [deliveries, walkerSig, reduceMotion]);

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

  // Measure the room names and name tags as drawn, in map units, so the names
  // can keep clear of people. Again whenever the map changes size, the crew
  // changes, or the pixel font finishes loading (it is wider than the stand-in).
  const measureText = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const k = wrap.getBoundingClientRect().width / MAP_W;
    if (!(k > 0)) return;
    const sizeOf = (el) => (el && el.offsetWidth ? [el.offsetWidth / k, el.offsetHeight / k] : null);
    const labels = {}, tags = {};
    for (const id of ROOM_IDS) { const s = sizeOf(labelRefs.current[id]); if (s) labels[id] = s; }
    for (const [id, el] of Object.entries(tagRefs.current)) { const s = sizeOf(el); if (s) tags[id] = s; }
    sizesRef.current = { labels, tags };
  }, []);
  useEffect(() => { measureText(); if (repaintRef.current) repaintRef.current(); }, [measureText, size, walkerSig, painted]);
  useEffect(() => {
    const fonts = typeof document !== "undefined" ? document.fonts : null;
    if (!fonts) return undefined;
    let alive = true;
    const again = () => { if (alive) { measureText(); if (repaintRef.current) repaintRef.current(); } };
    if (fonts.ready) fonts.ready.then(again, () => {});
    if (fonts.addEventListener) fonts.addEventListener("loadingdone", again);
    return () => { alive = false; if (fonts.removeEventListener) fonts.removeEventListener("loadingdone", again); };
  }, [measureText]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas && canvas.getContext("2d");
    if (!ctx) return undefined;
    const start = performance.now();
    let last = start;
    let raf = 0;
    let paint;

    const step = (now) => {
      const t = now - start;
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      if (!reduceMotion) {
        stepCrew(walkersRef.current, dt, now, stationRef.current);
        for (const w of walkersRef.current) {
          for (const e of w.events.splice(0)) {
            if (e.type !== "delivered" || !e.ids.length) continue;
            e.ids.forEach((id) => handedRef.current.add(id));
            if (onDeliveredRef.current) onDeliveredRef.current(e.ids);
          }
        }
      }
      return t;
    };
    // Each tag over its person, lifted clear of any it would cover
    // (hqStation.js tagLifts). Returns the lifts, so a lifted tag that ends up
    // under a room's name steps back for that moment like any other: room
    // names never move for tags (measured: letting them made Finance's hop
    // ~2.7 times a minute with two people at their desks).
    const placeTags = (items) => {
      const sizes = sizesRef.current && sizesRef.current.tags;
      const lift = sizes ? tagLifts(items, (id) => sizes[id] || null) : {};
      for (const w of walkersRef.current) {
        const el = tagRefs.current[w.id];
        if (!el) continue;
        // Seated, the tag goes over the chair; the feet of someone sitting at a
        // north-facing desk stand a step in front of it.
        const [x, y] = w.mode === "sit" ? w.seat : [w.x, w.y];
        const [tx, ty] = painted ? tagSpot(x, y, w.mode === "sit", w.home) : [x, y - 12];
        el.style.left = `${(tx / MAP_W) * 100}%`;
        el.style.top = `${((ty - (lift[w.id] || 0)) / MAP_H) * 100}%`;
      }
      return lift;
    };
    // Room names keep clear of people (hqStation.js labelSlots / placeLabel):
    // each moves to a clear place on its walls before anyone reaches it,
    // fading out and back in so it never slides across someone. A name tag
    // passing under a room's name fades for that moment instead.
    let lastLabels = -Infinity;
    const put = (el, slot) => {
      el.style.left = `${(slot.x / MAP_W) * 100}%`;
      el.style.top = `${(slot.y / MAP_H) * 100}%`;
    };
    const placeLabels = (now, items, lift = {}) => {
      const sizes = sizesRef.current;
      if (!sizes) return;
      const moving = !reduceMotion;
      if (moving && now - lastLabels < LABEL_CHECK_MS) return;
      lastLabels = now;
      const bodies = crowdBoxes(items, moving ? walkersRef.current : [], { now });
      const hung = [];
      for (const id of ROOM_IDS) {
        const el = labelRefs.current[id];
        const sz = sizes.labels[id];
        if (!el || !sz) continue;
        const slots = labelSlots(id, sz[0], sz[1]);
        const s = labelState.current[id] || (labelState.current[id] = { slot: 0, shown: -1, swapAt: 0, next: 0 });
        const want = placeLabel(slots, bodies, s, now);
        // With nowhere clear for a moment, the name is out of sight.
        const show = s.hidden ? "0" : "1";
        if (s.shown < 0 || !moving) {
          put(el, slots[want]); s.shown = want; s.swapAt = 0; el.style.opacity = show;
        } else if (want !== s.shown) {
          s.next = want;
          if (!s.swapAt) { el.style.opacity = "0"; s.swapAt = now + LABEL_FADE_MS; }
          else if (now >= s.swapAt) { put(el, slots[s.next]); s.shown = s.next; s.swapAt = 0; el.style.opacity = show; }
        } else {
          // Staying (or it changed its mind while fading): shown unless
          // hidden, and re-placed — a resize or the pixel font arriving
          // changes the name's size, and with it where that place is.
          put(el, slots[s.shown]); s.swapAt = 0; el.style.opacity = show;
        }
        if (!s.hidden) hung.push(slots[s.shown]);
      }
      const people = items.filter((it) => it.type === "person").map((it) => ({ id: it.id, x: it.x, feet: it.y - (lift[it.id] || 0) }));
      const under = tagsUnderLabels(people, (pid) => sizes.tags[pid] || null, hung);
      for (const [pid, el] of Object.entries(tagRefs.current)) {
        if (el) el.style.opacity = under.has(pid) ? "0" : "";
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
        const t = step(now);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, bw, bh);
        ctx.setTransform(k, 0, 0, k, 0, 0);
        const items = sceneItems(seatsRef.current, walkersRef.current);
        drawScene(ctx, items, sheets.images,
          { t: reduceMotion ? 0 : t, selected: selectedRef.current, deskCount: deskCountRef.current });
        const lift = placeTags(items);
        placeLabels(now, items, lift);
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
      drawStatic(lctx, { seats: seatsRef.current, roomStates });
      paint = (now) => {
        const t = step(now);
        ctx.clearRect(0, 0, MAP_W, MAP_H);
        ctx.drawImage(layer, 0, 0);
        drawDynamic(ctx, reduceMotion ? 0 : t, { walkers: walkersRef.current, seats: seatsRef.current, selected: selectedRef.current, board });
        placeTags(sceneItems(seatsRef.current, walkersRef.current));
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
  }, [roomStates, board, reduceMotion, painted, sheets.images, size]);

  const pointAt = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * MAP_W, ((e.clientY - r.top) / r.height) * MAP_H];
  };
  // A tap on a person opens their profile; anywhere else in a room picks
  // the room. The owner sits at his desk and never walks, so he's added here.
  const whoAt = (px, py) => {
    if (!onAgent) return null;
    const [ox, oy] = SEAT_SPOTS.owner[0];
    const ownerSeat = seatsRef.current.find((s) => s.status === "you");
    const extra = ownerSeat ? [{ id: ownerSeat.id, x: ox, y: oy }] : [];
    return personAt(px, py, walkersRef.current, { extra, tags: sizesRef.current && sizesRef.current.tags });
  };
  const onClick = (e) => {
    const [px, py] = pointAt(e);
    const who = whoAt(px, py);
    if (who) { onAgent(who); return; }
    const id = roomAt(px, py);
    if (id && id !== "atrium") onSelect(id);
  };
  const onMove = (e) => {
    const [px, py] = pointAt(e);
    const id = roomAt(px, py);
    e.currentTarget.style.cursor = whoAt(px, py) || (id && id !== "atrium") ? "pointer" : "default";
  };

  // Everyone who can walk starts at their own desk.
  const byRoom = {};
  const walkerStart = {};
  for (const s of seats) {
    const i = (byRoom[s.room] = (byRoom[s.room] || 0) + 1) - 1;
    if (HIRED.has(s.status)) {
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
        role="img" aria-label="A map of the building: rooms for each department, the crew walking the halls. Choose a department from the list, or search for an agent, to see who works there." />
      {/* On the painted map each room's name hangs on a wall and moves to a
          clear place before anyone reaches it (placeLabels, above); it starts
          at its usual place. The pixel map keeps them in the corner. */}
      {ROOM_IDS.map((id) => {
        const r = ROOM_RECTS[id];
        const state = roomStates && roomStates[id];
        const home = labelSlots(id, ...guessLabel(id))[0];
        return (
          <span key={id} aria-hidden="true" className={`hq-map-label${selected === id ? " is-selected" : ""}`}
            ref={(el) => { labelRefs.current[id] = el; }}
            style={painted
              ? { left: `${(home.x / MAP_W) * 100}%`, top: `${(home.y / MAP_H) * 100}%` }
              : { left: `${((r.x + 5) / MAP_W) * 100}%`, top: `${((r.y + 9) / MAP_H) * 100}%` }}>
            {state && <i className={`hq-map-dot hq-map-dot-${state}`} />}
            {MAP_LABELS[id]}
          </span>
        );
      })}
      {owner && (
        <span aria-hidden="true" className="hq-map-tag hq-map-tag-you"
          ref={(el) => { tagRefs.current[owner.id] = el; }}
          style={{ left: `${(ownerTag[0] / MAP_W) * 100}%`, top: `${(ownerTag[1] / MAP_H) * 100}%` }}>
          You
        </span>
      )}
      {seats.filter((s) => walkerStart[s.id]).map((s) => (
        <span key={s.id} aria-hidden="true" className={`hq-map-tag hq-map-tag-${s.status}`}
          ref={(el) => { tagRefs.current[s.id] = el; }}
          style={{ left: `${(walkerStart[s.id][0] / MAP_W) * 100}%`, top: `${(walkerStart[s.id][1] / MAP_H) * 100}%` }}>
          {s.short}
        </span>
      ))}
    </div>
  );
}
