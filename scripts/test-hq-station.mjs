// Smooth Training HQ — the station map (S238, src/hqStation.js).
//
// Kevin wanted the StarNet look: rooms, hallways, numbers down the sides, and
// "seeing the people moving". The promises the moving part has to keep, all RUN
// here rather than read:
//
//   • NOBODY WALKS THROUGH A WALL. Every route between every pair of rooms is
//     sampled every half pixel and must stay on floor someone can stand on —
//     a room's interior, a hallway or a doorway.
//   • EVERY SEAT HAS A DESK INSIDE ITS ROOM, and the map knows every seat the
//     org chart has — a seat with no spot would be a worker with nowhere to sit.
//   • ONLY REAL SEATS MOVE. Walkers are made for workers in training and nobody
//     else; an open seat never gets a person, and the tour never sends a
//     trainee to another department's desk.
//   • A DAY ALWAYS ENDS BACK AT THE DESK, the same way every time (seeded), and
//     never with a NaN — a canvas draws NaN as nothing, silently.
//   • NOTHING IS DRAWN OFF THE MAP, run against a recording context.
//   • NOBODY STANDS ON ANYONE (Kevin: "we don't have workers overlapping and
//     also standing in the same exact location"): a whole crew runs for
//     twenty minutes and no two people ever stop within reach of each other,
//     walkers keep right, and someone behind hangs back.
//   • WORK REACHES THE OWNER ONE PERSON AT A TIME, oldest first, with a gap
//     between hand-overs — "not all squished up on top of each other".
//   • A ROOM'S NAME AND A PERSON NEVER COVER EACH OTHER: at phone sizes, the
//     top and bottom rows' names are never touched at all, and every name
//     steps aside before anyone reaches it.
//
// Run: node scripts/test-hq-station.mjs
import { readFileSync } from "fs";
import { SEATS, ROOMS } from "../src/hqOrg.js";
import { stripComments } from "./lib/strip-comments.mjs";
import {
  MAP_W, MAP_H, HALLS, H1_Y, H2_Y, V_XS, ROOM_RECTS, MAP_LABELS, SEAT_SPOTS,
  interior, walkable, roomAt, doorPoints, route, makeRng, spotIn,
  makeWalkers, stepCrew, makeStation, dispatch, drawStatic, drawDynamic,
  SEAT_FACING, WANDER, SPRITES, PERSON_H, propBox, sceneItems, drawScene, facingFor,
  LANES, OWNER_DROP, queueDelivery, deliveriesDue, DELIVERY_WINDOW_MS,
  seatStand, PERSONAL_SPACE, crowded, claimedSpots, DOORWAYS, FIRST_RUN_MS, RUN_GAP_MS, HANDOFF_MS,
  HANG_BACK, behind, PERSON_W, personBox, tagBox, boxesMeet, labelSlots, placeLabel, crowdBoxes,
  tagsUnderLabels, ahead, LABEL_SETTLE_MS, LABEL_LOOKAHEAD_S,
  DESK_TIME_MS, FIRST_STROLL_MS, STROLL_LIMIT, strolling,
} from "../src/hqStation.js";

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log("  ✗ " + msg); } };
const eq2 = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)})`);

// ── 1. The map knows the org chart ──────────────────────────────────────────
console.log("seats and rooms");
{
  const roomIds = ROOMS.map((r) => r.id);
  ok(roomIds.every((id) => ROOM_RECTS[id]), "every department in the org chart has a room on the map");
  ok(Object.keys(ROOM_RECTS).every((id) => MAP_LABELS[id]), "every room on the map has a label");
  for (const id of roomIds) {
    const seats = SEATS.filter((s) => s.room === id);
    const spots = SEAT_SPOTS[id] || [];
    ok(spots.length === seats.length, `${id}: one desk per seat (${spots.length} desks, ${seats.length} seats)`);
    const f = interior(id);
    ok(spots.every(([x, y]) => x - 7 >= f.x && x + 7 <= f.x + f.w && y - 7 >= f.y && y + 7 <= f.y + f.h),
      `${id}: every desk and chair sits inside the room's walls`);
    ok(spots.every(([x, y]) => walkable(x, y)), `${id}: every seat is on floor someone can reach`);
  }
  ok(!("atrium" in SEAT_SPOTS), "the courtyard has no desks");
}

// ── 2. Doors and routes ─────────────────────────────────────────────────────
console.log("routes");
{
  const ids = Object.keys(ROOM_RECTS);
  for (const id of ids) {
    const d = doorPoints(id);
    ok(walkable(...d.inside) && walkable(...d.hall), `${id}: its door opens from floor onto floor`);
    ok(d.hall[1] === H1_Y || d.hall[1] === H2_Y, `${id}: its door meets a hallway's centre line`);
  }
  let pairs = 0, bad = [];
  for (const a of ids) {
    for (const b of ids) {
      const pts = route(a, b);
      pairs++;
      const start = doorPoints(a).inside, end = doorPoints(b).inside;
      if (pts[0][0] !== start[0] || pts[0][1] !== start[1]) bad.push(`${a}→${b} does not start at its door`);
      const last = pts[pts.length - 1];
      if (last[0] !== end[0] || last[1] !== end[1]) bad.push(`${a}→${b} does not end at the destination's door`);
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        if (x0 !== x1 && y0 !== y1) bad.push(`${a}→${b} leg ${i} is diagonal`);
        const len = Math.hypot(x1 - x0, y1 - y0);
        for (let t = 0; t <= len; t += 0.5) {
          const x = x0 + ((x1 - x0) * t) / (len || 1), y = y0 + ((y1 - y0) * t) / (len || 1);
          if (!walkable(x, y)) { bad.push(`${a}→${b} crosses a wall at (${x.toFixed(1)}, ${y.toFixed(1)})`); break; }
        }
      }
    }
  }
  ok(bad.length === 0, `all ${pairs} routes stay on the floor, straight and door to door${bad.length ? `: ${bad.slice(0, 3).join("; ")}` : ""}`);
  ok(HALLS.every((h) => walkable(h.x + h.w / 2, h.y + h.h / 2)), "every hallway is walkable");
  ok(V_XS.every((x) => walkable(x, H1_Y) && walkable(x, H2_Y)), "the cross-hallways meet both hallways");
  for (const id of ids) {
    const r = ROOM_RECTS[id];
    ok(roomAt(r.x + r.w / 2, r.y + r.h / 2) === id, `a tap in the middle of ${id} selects ${id}`);
  }
  ok(roomAt(V_XS[0], H1_Y) === null && roomAt(160, 230) === null, "a tap on a hallway or the street selects nothing");
  const rng = makeRng(7);
  const spots = ids.flatMap((id) => [...Array(20)].map(() => [id, spotIn(id, rng)]));
  ok(spots.every(([id, [x, y]]) => roomAt(x, y) === id && walkable(x, y)), "every random stop lands on the floor of its own room");
}

// ── 3. Walkers ──────────────────────────────────────────────────────────────
console.log("walkers");
{
  const walkers = makeWalkers(SEATS, 0);
  const trainees = SEATS.filter((s) => s.status === "training").map((s) => s.id).sort();
  ok(walkers.map((w) => w.id).sort().join() === trainees.join(), "exactly the workers in training walk — nobody else");
  ok(!walkers.some((w) => SEATS.find((s) => s.id === w.id).status === "open"), "an open seat never gets a walker");
  const openOnly = makeWalkers(SEATS.map((s) => ({ ...s, status: "open" })), 0);
  ok(openOnly.length === 0, "a building with no one hired has no one walking");

  const simulate = (seconds) => {
    const ws = makeWalkers(SEATS, 0);
    const station = makeStation(0);
    const log = ws.map(() => ({ left: 0, back: 0, rooms: new Set(), offFloor: 0, nan: 0, trail: [] }));
    const dt = 0.05;
    for (let step = 0; step * dt < seconds; step++) {
      const now = step * dt * 1000;
      const was = ws.map((w) => w.room);
      stepCrew(ws, dt, now, station);
      ws.forEach((w, i) => {
        const before = was[i];
        const L = log[i];
        if (!Number.isFinite(w.x) || !Number.isFinite(w.y)) L.nan++;
        if (!walkable(w.x, w.y)) L.offFloor++;
        if (before === w.home && w.room !== w.home) L.left++;
        if (before !== w.home && w.room === w.home) L.back++;
        L.rooms.add(w.room);
        if (step % 40 === 0) L.trail.push(`${w.x.toFixed(2)},${w.y.toFixed(2)}`);
      });
    }
    return { ws, log };
  };
  const { ws, log } = simulate(20 * 60);
  ws.forEach((w, i) => {
    const L = log[i];
    ok(L.nan === 0, `${w.id}: never at a position that isn't a number`);
    ok(L.offFloor === 0, `${w.id}: never off the floor (${L.offFloor} steps were)`);
    ok(L.left >= 3 && L.back >= 3, `${w.id}: over 20 minutes leaves the desk and comes back, again and again (${L.left} out, ${L.back} back)`);
    ok(!L.rooms.has("owner"), `${w.id}: never walks into your office on a tour — that walk is kept for deliveries (${[...L.rooms].join(", ")})`);
    ok(L.rooms.size >= 5, `${w.id}: over 20 minutes visits many parts of the building (${L.rooms.size}: ${[...L.rooms].join(", ")})`);
  });
  const again = simulate(20 * 60);
  ok(again.log.every((L, i) => L.trail.join("|") === log[i].trail.join("|")), "the same seed walks the same day every time");

  // Kevin: routes "always different". Every opening seeds a new day.
  const trailFor = (seed) => {
    const ws = makeWalkers(SEATS, 0, seed);
    const station = makeStation(0, seed);
    const t = [];
    for (let step = 0; step < 4000; step++) {
      stepCrew(ws, 0.05, step * 50, station);
      if (step % 40 === 0) t.push(ws.map((w) => `${w.x.toFixed(1)},${w.y.toFixed(1)}`).join(";"));
    }
    return t.join("|");
  };
  const days = new Set([1, 2, 3, 4, 5, 6].map(trailFor));
  ok(days.size === 6, `six openings are six different days (${days.size} distinct)`);
  ok(trailFor(0) === trailFor(0), "…while a fixed seed still replays exactly");
}

// ── 3b. Many routes between the same rooms ─────────────────────────────────
console.log("route variety");
{
  const ids = Object.keys(ROOM_RECTS);
  const bad = [];
  const shapes = new Map();
  let farTaken = 0, crossings = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const rng = makeRng(seed);
    for (const a of ids) for (const b of ids) {
      if (a === b) continue;
      const pts = route(a, b, rng);
      const key = `${a}>${b}`;
      if (!shapes.has(key)) shapes.set(key, new Set());
      shapes.get(key).add(JSON.stringify(pts));
      if (doorPoints(a).hall[1] !== doorPoints(b).hall[1]) {
        crossings++;
        const vx = pts.find((p, i) => i > 1 && pts[i - 1][1] === p[1] && Math.abs(p[0] - doorPoints(a).hall[0]) > 0 && V_XS.some((x) => Math.abs(p[0] - x) <= 4));
        const cost = (x) => Math.abs(doorPoints(a).hall[0] - x) + Math.abs(doorPoints(b).hall[0] - x);
        const near = [...V_XS].sort((p, q) => cost(p) - cost(q))[0];
        if (vx && Math.abs(vx[0] - near) > 4) farTaken++;
      }
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        if (x0 !== x1 && y0 !== y1) { bad.push(`${key} leg ${i} is diagonal`); break; }
        const len = Math.hypot(x1 - x0, y1 - y0);
        for (let t = 0; t <= len; t += 0.5) {
          const x = x0 + ((x1 - x0) * t) / (len || 1), y = y0 + ((y1 - y0) * t) / (len || 1);
          if (!walkable(x, y)) { bad.push(`${key} crosses a wall at (${x.toFixed(1)}, ${y.toFixed(1)}) seed ${seed}`); break; }
        }
      }
    }
  }
  ok(bad.length === 0, `300 random days of routes between every pair stay on the floor${bad.length ? `: ${bad.slice(0, 3).join("; ")}` : ""}`);
  // Two doors facing each other across a hallway are joined by one walk:
  // straight across. Every other pair has many.
  const facing = (key) => { const [a, b] = key.split(">"); return doorPoints(a).hall[0] === doorPoints(b).hall[0] && doorPoints(a).hall[1] === doorPoints(b).hall[1]; };
  const fewest = Math.min(...[...shapes.entries()].filter(([k]) => !facing(k)).map(([, v]) => v.size));
  ok(fewest >= 5, `every pair of rooms is joined by many different walks (fewest: ${fewest})`);
  const across = [...shapes.entries()].filter(([k]) => facing(k));
  ok(across.length === 6 && across.every(([k, v]) => v.size === 1 && JSON.parse([...v][0]).every((pt) => pt[0] === doorPoints(k.split(">")[0]).hall[0])),
    `…and doors facing each other across a hallway are joined straight across (${across.length} pairs)`);
  ok(farTaken > crossings * 0.15 && farTaken < crossings * 0.5, `the longer cross-hallway is taken now and then, not always (${farTaken} of ${crossings})`);
  ok(LANES.every((l) => l > 0 && l <= 4), "no lane strays more than four units off a hallway's centre line");
  // Keep right: every leg along a hallway is on the walker's own right-hand
  // side of the centre line, so people heading opposite ways never share a
  // line — they pass at least two lanes apart.
  const wrongSide = [];
  let legs = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const rng = makeRng(seed);
    for (const a of ids) for (const b of ids) {
      if (a === b) continue;
      const pts = route(a, b, rng);
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const hall = [H1_Y, H2_Y].find((h) => Math.abs(y0 - h) <= 4 && y0 === y1);
        if (hall !== undefined && x0 !== x1) {
          legs++;
          const off = y0 - hall;
          if (off !== 0 && Math.sign(off) !== (x1 > x0 ? 1 : -1)) wrongSide.push(`${a}>${b} seed ${seed} leg ${i}`);
          if (off === 0 && doorPoints(a).hall[0] !== doorPoints(b).hall[0]) wrongSide.push(`${a}>${b} seed ${seed} walks the centre line`);
        }
        const v = V_XS.find((vx) => Math.abs(x0 - vx) <= 4 && x0 === x1);
        if (v !== undefined && y0 !== y1 && Math.abs(y0 - y1) > 20) {
          legs++;
          const off = x0 - v;
          if (Math.sign(off) !== (y1 > y0 ? -1 : 1)) wrongSide.push(`${a}>${b} seed ${seed} cross-hallway leg ${i}`);
        }
      }
    }
  }
  ok(legs > 5000 && wrongSide.length === 0, `everyone keeps to their own right in every hallway (${legs} legs${wrongSide.length ? `; wrong: ${wrongSide.slice(0, 3).join(", ")}` : ""})`);
  const eastbound = route("marketing", "front", makeRng(3));
  const westbound = route("front", "marketing", makeRng(3));
  const lineOf = (pts) => pts.find((p, i) => i > 0 && pts[i - 1][1] === p[1] && p[0] !== pts[i - 1][0])[1];
  ok(lineOf(eastbound) - H2_Y >= 2 && H2_Y - lineOf(westbound) >= 2,
    `two people walking the same hallway toward each other pass on opposite sides (${lineOf(eastbound)} vs ${lineOf(westbound)})`);
  const plain = route("finance", "marketing");
  ok(JSON.stringify(plain) === JSON.stringify(route("finance", "marketing", null)), "without a generator the route is the plain shortest one");
}

// ── 3c. Deliveries: work walks to the owner's desk, one person at a time ───
console.log("deliveries");
{
  const ws = makeWalkers(SEATS, 0, 7);
  const station = makeStation(0, 7);
  const bk = ws.find((w) => w.id === "bookkeeper");
  const fd = ws.find((w) => w.id === "front-desk");
  queueDelivery(bk, ["item-1", "item-2"], station);
  queueDelivery(bk, ["item-2"], station);
  ok(bk.queue.length === 2, "the same item is never queued twice");
  queueDelivery(fd, ["item-3"], station);
  ok(bk.queuedAt < fd.queuedAt, "…and whoever had work first is first in line");
  const line = makeStation(0, 1);
  const [x1, x2] = makeWalkers(SEATS, 0, 1);
  queueDelivery(x1, ["a"], line);
  queueDelivery(x2, ["b"], line);
  queueDelivery(x1, ["c"], line);
  ok(x1.queuedAt < x2.queuedAt, "…and keeps that place when more work comes in behind it");

  const handed = [], departures = [];
  let maxInOffice = 0, wall = false, wandered = false, back = 0;
  for (let step = 0; step < 12000 && back < 2; step++) {
    const now = step * 50;
    const modes = ws.map((w) => w.mode);
    stepCrew(ws, 0.05, now, station);
    ws.forEach((w, i) => {
      if (!walkable(w.x, w.y)) wall = true;
      if (modes[i] !== "walk" && w.mode === "walk" && w.dest === "owner") departures.push({ id: w.id, at: now });
      if (modes[i] !== "handoff" && w.mode === "handoff") {
        ok(Math.abs(w.x - OWNER_DROP[0]) < 0.01 && Math.abs(w.y - OWNER_DROP[1]) < 0.01 && w.dir === "up",
          `${w.id} hands the work over at the owner's desk, facing him`);
        const item = sceneItems(SEATS, ws).find((it) => it.id === w.id);
        ok(item.carrying === true, `…still holding the papers until they're handed over (${w.id})`);
      }
      // Holding work for the owner: straight home to wait for the turn, never a stop somewhere else.
      if (w.queue.length && w.mode === "walk" && w.dest !== w.home) wandered = true;
      for (const e of w.events.splice(0)) if (e.type === "delivered") handed.push({ id: w.id, ids: e.ids, at: now });
      if (handed.some((h) => h.id === w.id) && modes[i] === "walk" && w.mode === "sit" && w.room === w.home) back++;
    });
    maxInOffice = Math.max(maxInOffice, ws.filter((w) => roomAt(w.x, w.y) === "owner").length);
  }
  ok(JSON.stringify(handed.map((h) => h.ids)) === JSON.stringify([["item-1", "item-2"], ["item-3"]]),
    `oldest work first, and the page is told exactly which items were handed over (${JSON.stringify(handed.map((h) => h.ids))})`);
  ok(maxInOffice === 1, `never more than one person in the owner's office at a time (${maxInOffice})`);
  ok(departures.length === 2 && departures[0].at >= FIRST_RUN_MS[0] && departures[0].at <= FIRST_RUN_MS[1],
    `the first delivery sets off a few seconds after the HQ opens (${departures[0] && departures[0].at} ms)`);
  ok(departures.length === 2 && departures[1].at - handed[0].at >= RUN_GAP_MS[0],
    `the next leaves only after the last was handed over, and a while after (${departures[1] && departures[1].at - handed[0].at} ms)`);
  ok(handed.length === 2 && handed[1].at - handed[0].at >= RUN_GAP_MS[0] + HANDOFF_MS,
    `…so hand-overs come at different times, not all at once (${handed[1] && handed[1].at - handed[0].at} ms apart)`);
  ok(!wandered, "someone holding work for the owner never wanders off with it");
  ok(back === 2, "…and each goes back to their own desk afterwards");
  ok(!wall, "a delivery never walks through a wall");
  ok(walkable(...OWNER_DROP) && roomAt(...OWNER_DROP) === "owner", "the drop-off spot is on the owner's office floor");
  const desk = propBox("exec_front", ...SEAT_SPOTS.owner[0]);
  ok(OWNER_DROP[1] > desk.y + desk.h, "…in front of his desk, not inside it");

  // The turn itself.
  const st = makeStation(1000, 5);
  ok(st.nextRunAt >= 1000 + FIRST_RUN_MS[0] && st.nextRunAt <= 1000 + FIRST_RUN_MS[1], "the first turn comes a few seconds after the HQ opens");
  const pair = makeWalkers(SEATS, 0, 5);
  const [p, q] = pair;
  queueDelivery(p, ["p1"], st);
  queueDelivery(q, ["q1"], st);
  ok(dispatch(pair, st.nextRunAt - 1, st) === null && p.mode === "sit", "nobody sets off before the turn comes");
  ok(dispatch(pair, st.nextRunAt, st) === p && p.mode === "walk" && p.dest === "owner" && JSON.stringify(p.carrying) === '["p1"]',
    "…then the first in line does, carrying their work");
  ok(dispatch(pair, st.nextRunAt + 60000, st) === null && q.mode === "sit", "nobody else sets off while someone is on a run");
  ok(dispatch(pair, st.nextRunAt + 90001, st) === q, "a turn nobody finished is given up after a while, so deliveries can't stop for good");
  const away = makeWalkers(SEATS, 0, 6);
  const st2 = makeStation(0, 6);
  away.forEach((w) => { queueDelivery(w, [`${w.id}-x`], st2); w.mode = "pause"; });
  ok(dispatch(away, 1e9, st2) === null, "only someone back at their desk is sent — never straight from a stop somewhere else");

  // Someone on a live shift stays at the desk — until it's their turn to bring something over.
  const live = makeWalkers(SEATS.map((s) => (s.id === "bookkeeper" ? { ...s, status: "on-shift" } : s)), 0, 3);
  const liveStation = makeStation(0, 3);
  const onShift = live.find((w) => w.id === "bookkeeper");
  let left = false;
  for (let step = 0; step < 6000; step++) { stepCrew(live, 0.05, step * 50, liveStation); if (onShift.room !== "finance") left = true; }
  ok(!left, "a worker on shift stays at the desk for the whole shift");
  const item = sceneItems(SEATS, [onShift]).find((i) => i.id === "bookkeeper");
  ok(item.working === true && item.seated === true, "…drawn seated and working");
  queueDelivery(onShift, ["x"], liveStation);
  stepCrew(live, 0.05, 6000 * 50, liveStation);
  ok(onShift.mode === "walk" && onShift.dest === "owner", "…and gets up to bring you what they finished when it's their turn");
  const open = makeWalkers(SEATS.map((s) => ({ ...s, status: s.status === "you" ? "you" : "open" })), 0, 3);
  ok(open.length === 0, "nobody walks for an open seat, deliveries or not");

  // Which items get walked over, and in what order.
  const NOW = Date.UTC(2026, 8, 25, 15, 0, 0);
  const items = [
    { id: "a", worker: "bookkeeper", createdAt: NOW - 3600000 },
    { id: "b", worker: "front-desk", createdAt: NOW - DELIVERY_WINDOW_MS - 1 },
    { id: "c", worker: "bookkeeper", createdAt: NOW - 60000 },
    { id: "d", worker: "", createdAt: NOW },
    { id: "e", worker: "front-desk", createdAt: NOW - 7200000 },
  ];
  const due = deliveriesDue(items, new Set(["c"]), NOW);
  ok(JSON.stringify(due) === JSON.stringify([{ id: "e", worker: "front-desk" }, { id: "a", worker: "bookkeeper" }]),
    `only new, undelivered items with a worker are carried, oldest first (${JSON.stringify(due)})`);
  ok(deliveriesDue(items, new Set(["a", "c", "e"]), NOW).length === 0, "an item delivered on this device is never carried twice");
}

// ── 3d. Personal space ─────────────────────────────────────────────────────
console.log("personal space");
{
  ok(crowded([150, 124], [[150, 120]]) && !crowded([162, 120], [[150, 120]]) && !crowded([150, 128], [[150, 120]]),
    `arm's reach is wider than it is deep (${PERSONAL_SPACE.join(" × ")})`);
  const [a, b] = makeWalkers(SEATS, 0, 4);
  b.mode = "walk"; b.path = [[150, 120]]; b.seg = 0;
  const claimed = claimedSpots([a, b], a);
  ok(claimed.some(([x, y]) => x === 150 && y === 120), "the end of someone's walk is already theirs");
  const chair = seatStand(b.home, b.seat);
  ok(claimed.some(([x, y]) => x === chair[0] && y === chair[1]), "…and so is their chair while they're out");
  ok(!claimedSpots([a, b], a).some(([x, y]) => x === a.x && y === a.y), "…but never your own spot");
  // Every seat on the org chart filled at once — far busier than today — for
  // two hours: people mostly sit now, so it takes that long to see hundreds of stops.
  const all = SEATS.map((s) => (s.status === "open" ? { ...s, status: "training" } : s));
  const ws = makeWalkers(all, 0, 21);
  const station = makeStation(0, 21);
  let clash = 0, doorway = 0, stops = 0;
  const seen = [];
  for (let step = 0; step < 144000; step++) {
    const now = step * 50;
    if (step % 600 === 300) queueDelivery(ws[Math.floor(step / 600) % ws.length], [`d${step}`], station);
    const modes = ws.map((w) => w.mode);
    stepCrew(ws, 0.05, now, station);
    ws.forEach((w, i) => { w.events.length = 0; if (modes[i] === "walk" && w.mode === "pause") stops++; });
    const still = ws.filter((w) => w.mode !== "walk");
    for (let i = 0; i < still.length; i++) {
      for (let j = i + 1; j < still.length; j++) {
        if (crowded([still[i].x, still[i].y], [[still[j].x, still[j].y]])) { clash++; if (seen.length < 3) seen.push(`${still[i].id} + ${still[j].id} at ${now} ms`); }
      }
      if (still[i].mode === "pause" && crowded([still[i].x, still[i].y], DOORWAYS)) doorway++;
    }
  }
  ok(stops > 300, `the full crew makes plenty of stops (${stops})`);
  ok(clash === 0, `with every seat filled, no two people ever stand within arm's reach of each other in two hours${seen.length ? ` (${seen.join("; ")})` : ""}`);
  ok(doorway === 0, "…and nobody stops in a doorway");
}

// ── 3d½. Mostly at their desks ─────────────────────────────────────────────
// Kevin: "most of the time they're going to be at their desks but
// occasionally we have them walk around, especially if they're sending me
// something" — and the building must never look like a crowd as the crew grows.
console.log("mostly at their desks");
{
  const run = (seats, seed, minutes, work = false) => {
    const ws = makeWalkers(seats, 0, seed);
    const station = makeStation(0, seed);
    let seated = 0, samples = 0, mostStrolling = 0, mostUp = 0, delivered = 0;
    const leftDesk = new Set();
    for (let step = 0; step < minutes * 1200; step++) {
      const now = step * 50;
      if (work && step % 1200 === 600) queueDelivery(ws[(step / 1200) % ws.length | 0], [`w${step}`], station);
      stepCrew(ws, 0.05, now, station);
      for (const w of ws) {
        delivered += w.events.filter((e) => e.type === "delivered").length;
        w.events.length = 0;
        if (w.errand === "stroll") leftDesk.add(w.id);
      }
      const up = ws.filter((w) => w.mode !== "sit").length;
      seated += ws.length - up; samples += ws.length;
      mostStrolling = Math.max(mostStrolling, strolling(ws));
      mostUp = Math.max(mostUp, up);
    }
    return { share: seated / samples, mostStrolling, mostUp, leftDesk, count: ws.length, delivered };
  };
  const TODAY_IDS = ["bookkeeper", "front-desk", "progress-analyst"];
  const crewOf = (ids) => SEATS.map((x) => (x.status === "you" ? x : { ...x, status: ids.includes(x.id) ? "training" : "open" }));
  const today = run(crewOf(TODAY_IDS), 3, 20);
  ok(today.share >= 0.65, `today's crew spends most of its time at its desks (${Math.round(today.share * 100)}% seated)`);
  ok(today.leftDesk.size === today.count, `…but everyone still gets up for a stroll now and then (${today.leftDesk.size} of ${today.count} in twenty minutes)`);
  const full = run(crewOf(SEATS.map((x) => x.id)), 3, 20, true);
  ok(full.share >= 0.85, `with every seat filled, the building is mostly people at desks (${Math.round(full.share * 100)}% seated)`);
  ok(full.mostStrolling <= STROLL_LIMIT, `…never more than ${STROLL_LIMIT} out strolling at once (most: ${full.mostStrolling})`);
  ok(full.mostUp <= STROLL_LIMIT + 2, `…and never more than a handful on their feet, deliveries included (most: ${full.mostUp})`);
  ok(full.delivered >= 15, `…while work still reaches the owner's desk (${full.delivered} hand-overs in twenty minutes)`);
  ok(DESK_TIME_MS[0] >= 30000 && FIRST_STROLL_MS[1] <= 60000,
    "a stroll comes after a good while at the desk, and the first one soon enough that the map isn't frozen when you open it");
  // A stroll limit must never hold up work for the owner.
  const ws = makeWalkers(crewOf(SEATS.map((x) => x.id)), 0, 8);
  ws.slice(0, STROLL_LIMIT).forEach((w) => { w.errand = "stroll"; w.mode = "pause"; w.until = 1e12; });
  const courier = ws[STROLL_LIMIT];
  const station = makeStation(0, 8);
  queueDelivery(courier, ["urgent"], station);
  station.nextRunAt = 0;
  ok(strolling(ws) === STROLL_LIMIT && dispatch(ws, 1, station) === courier && courier.errand === "deliver",
    "with the stroll limit reached, work for the owner still goes straight away");
  const idle = ws[STROLL_LIMIT + 1];
  idle.until = 0;
  stepCrew([idle, ...ws.slice(0, STROLL_LIMIT)], 0.05, 10, null);
  ok(idle.mode === "sit", "…while someone who only wants a stroll waits their turn at the desk");
}

// ── 3e. Hanging back ───────────────────────────────────────────────────────
console.log("hanging back");
{
  const ws = makeWalkers(SEATS, 0, 9);
  const [a, b] = ws;
  // Put both on the very same walk at the very same moment.
  const path = route("research", "finance", makeRng(2));
  for (const w of [a, b]) {
    w.room = "research"; w.dest = "finance"; w.mode = "walk"; w.purpose = "tour";
    w.path = path.map((pt) => [...pt]); w.seg = 0; [w.x, w.y] = path[0];
  }
  let closest = Infinity, arrived = 0;
  for (let step = 0; step < 2000 && arrived < 2; step++) {
    stepCrew(ws, 0.05, step * 50, null);
    arrived = [a, b].filter((w) => w.mode !== "walk").length;
    if (step > 20 && a.mode === "walk" && b.mode === "walk") closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
  }
  // Straight on they keep HANG_BACK apart; rounding a corner the one behind
  // closes in a little before turning too, never nearer than about a body's width.
  ok(closest >= 5, `two people setting off on the same walk together end up one behind the other, not on top of each other (closest ${closest.toFixed(1)})`);
  ok(arrived === 2, "…and both still get there");
  const east = { id: "e", mode: "walk", x: 150, y: 155, path: [[200, 155]], seg: 0 };
  const west = { id: "w", mode: "walk", x: 156, y: 149, path: [[100, 149]], seg: 0 };
  ok(!behind(east, [east, west]) && !behind(west, [east, west]), "people passing the other way don't stop for each other");
  const lead = { id: "l", mode: "walk", x: 150 + HANG_BACK - 2, y: 155, path: [[200, 155]], seg: 0 };
  ok(behind(east, [east, lead]) && !behind(lead, [east, lead]), "…but someone right behind another going the same way waits");
  const far = { ...lead, x: 150 + HANG_BACK + 2 };
  ok(!behind(east, [east, far]), "…only when they are really close");
  const standing = { id: "s", mode: "pause", x: 154, y: 155, path: [], seg: 0 };
  ok(!behind(east, [east, standing]), "…and nobody waits on someone standing still");
}

// ── 4. Drawing stays on the map ─────────────────────────────────────────────
console.log("drawing");
{
  class RecordingContext {
    constructor() { this.rects = []; this.style = null; }
    set fillStyle(v) { this.style = v; }
    get fillStyle() { return this.style; }
    fillRect(x, y, w, h) { this.rects.push([x, y, w, h, this.style]); }
  }
  const inside = ([x, y, w, h]) => [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0
    && x >= 0 && y >= 0 && x + w <= MAP_W && y + h <= MAP_H;
  const still = new RecordingContext();
  drawStatic(still, { seats: SEATS, roomStates: { owner: "on", finance: "training", front: "training" } });
  ok(still.rects.length > 400, `the building draws (${still.rects.length} rectangles)`);
  const offMap = still.rects.filter((r) => !inside(r));
  ok(offMap.length === 0, `every still rectangle is a real number on the map${offMap.length ? ` (first bad: ${JSON.stringify(offMap[0])})` : ""}`);
  ok(still.rects.every((r) => typeof r[4] === "string" && r[4].length > 0), "every rectangle has a colour");
  const ghosts = still.rects.filter((r) => r[4] === "rgba(170,210,210,.16)").length;
  ok(ghosts === SEATS.filter((s) => s.status === "open").length * 2, `one dim outline for each open seat (${ghosts / 2} drawn)`);

  const walkers = makeWalkers(SEATS, 0);
  const drawStation = makeStation(0);
  for (let s = 0; s < 400; s++) stepCrew(walkers, 0.05, s * 50, drawStation);
  const moving = new RecordingContext();
  drawDynamic(moving, 12345, { walkers, seats: SEATS, selected: "finance", board: ["training", "open", "open", "open", "training", "open"] });
  const offMapMoving = moving.rects.filter((r) => !inside(r));
  ok(moving.rects.length > 20 && offMapMoving.length === 0, `every moving rectangle is a real number on the map${offMapMoving.length ? ` (first bad: ${JSON.stringify(offMapMoving[0])})` : ""}`);
  const outline = moving.rects.filter((r) => /^rgba\(8,220,224,/.test(r[4]) && (r[2] === ROOM_RECTS.finance.w || r[3] === ROOM_RECTS.finance.h));
  ok(outline.length === 4, "the selected room gets a four-sided outline");
  const noSelection = new RecordingContext();
  drawDynamic(noSelection, 0, { walkers, seats: SEATS, selected: null, board: [] });
  ok(!noSelection.rects.some((r) => r[2] === ROOM_RECTS.finance.w && r[3] === 1 && /^rgba\(8,220,224,/.test(r[4])), "no outline when nothing is selected");
}

// ── 5. The painted station: desks and crew over the backdrop ───────────────
console.log("painted station");
{
  const inBox = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  // Every seat's person faces AWAY from the door they came in by, so a walker
  // coming home reaches the chair from the open side and never walks through
  // the desk to get there.
  for (const [room, spots] of Object.entries(SEAT_SPOTS)) {
    // The owner never walks the building, so nobody comes home to that chair;
    // the owner's desk faces the door, the way a boss's does.
    if (room === "owner") continue;
    const door = doorPoints(room).inside;
    const facing = SEAT_FACING[room];
    ok(facing === "up" || facing === "down", `${room}: its desks face a direction`);
    const fromBelow = spots.every(([, y]) => door[1] > y);
    const fromAbove = spots.every(([, y]) => door[1] < y);
    ok(facing === "up" ? fromBelow : fromAbove,
      `${room}: the door is on the ${facing === "up" ? "near" : "far"} side of every seat, so nobody walks through a desk to sit down`);
  }

  // Desks: one per seat, inside the room, and none on top of another.
  const everyone = SEATS.map((s) => (s.status === "open" ? { ...s, status: "on-shift" } : s));
  const items = sceneItems(everyone, []);
  const props = items.filter((i) => i.type === "prop");
  for (const room of Object.keys(SEAT_SPOTS)) {
    const mine = props.filter((p) => p.room === room);
    const seats = SEATS.filter((s) => s.room === room).length;
    ok(room === "front" ? mine.length === 1 && mine[0].kind === "counter" : mine.length === seats,
      `${room}: ${room === "front" ? "one reception counter" : "one desk per seat"} (${mine.length})`);
    const f = interior(room);
    ok(mine.every((p) => p.x >= f.x && p.x + p.w <= f.x + f.w && p.y >= f.y && p.y + p.h <= f.y + f.h),
      `${room}: every desk is inside the room's walls`);
    const overlap = mine.some((p, i) => mine.some((q, j) => j > i
      && p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h));
    ok(!overlap, `${room}: no two desks overlap`);
    const zone = WANDER[room];
    ok(zone && inBox(zone.x, zone.y, interior(room)) && inBox(zone.x + zone.w, zone.y + zone.h, interior(room))
      && walkable(zone.x, zone.y) && walkable(zone.x + zone.w, zone.y + zone.h), `${room}: its open floor is inside the room`);
    if (room !== "front") {
      ok(!mine.some((p) => zone.x < p.x + p.w && p.x < zone.x + zone.w && zone.y < p.y + p.h && p.y < zone.y + zone.h),
        `${room}: a visitor never stops on a desk`);
    }
  }
  ok(props.find((p) => p.room === "owner").kind === "exec_front", "the owner's desk faces the door, so the owner is seen from the front");
  const onlyReal = sceneItems(SEATS, []).filter((i) => i.type === "prop");
  ok(onlyReal.filter((p) => p.room === "chief")[0].kind === "desk_off", "an open seat facing north gets a desk with its screens off");
  ok(Object.values(SPRITES.props).every(([x, y, w, h]) => [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0),
    "every prop has a place on the sprite sheet");

  // Front to back: the list is sorted, a seated person draws AFTER a desk they
  // sit in front of and BEFORE a desk or counter that hides their legs.
  ok(items.every((it, i) => i === 0 || items[i - 1].sortY <= it.sortY), "everything is drawn back to front");
  for (const room of Object.keys(SEAT_SPOTS)) {
    const people = items.filter((i) => i.type === "person" && SEATS.find((s) => s.id === i.id && s.room === room));
    const mine = props.filter((p) => p.room === room);
    for (const person of people) {
      const desk = room === "front" ? mine[0] : mine.find((p) => p.seatId === person.id);
      if (!desk) continue;
      const personFirst = items.indexOf(person) < items.indexOf(desk);
      ok(SEAT_FACING[room] === "up" ? !personFirst : personFirst,
        `${room}: ${person.id} is drawn ${SEAT_FACING[room] === "up" ? "over the chair in front of" : "behind"} their desk`);
    }
  }
  const owner = items.find((i) => i.id === "owner");
  ok(owner && owner.sprite === "owner" && owner.dir === "down", "the owner sits at their desk, facing the room");

  // Walkers: facing follows movement, frames stay on the sheet.
  eq2(facingFor(3, 1), "right", "moving right faces right");
  eq2(facingFor(-3, 1), "left", "moving left faces left");
  eq2(facingFor(0, 2), "down", "moving down the map faces the camera");
  eq2(facingFor(1, -2), "up", "moving up the map shows their back");
  const walkers = makeWalkers(SEATS, 0);
  const facingStation = makeStation(0);
  const seen = new Set();
  for (let step = 0; step < 6000; step++) {
    stepCrew(walkers, 0.05, step * 50, facingStation);
    for (const it of sceneItems(SEATS, walkers)) {
      if (it.type !== "person") continue;
      if (!it.seated) seen.add(it.dir);
      if (!(SPRITES.person.rows.includes(it.dir) && it.frame >= 0 && it.frame < SPRITES.person.cols)) { ok(false, `bad frame ${JSON.stringify(it)}`); step = 1e9; break; }
    }
  }
  ok(["up", "down", "left", "right"].every((d) => seen.has(d)), `over a long day the crew is seen walking all four ways (${[...seen].join(", ")})`);
  const home = makeWalkers(SEATS, 0);
  ok(home.every((w) => w.dir === SEAT_FACING[w.home]), "a walker at their desk faces the way that desk faces");
  // …and still does after a walk: they arrive walking toward the chair and
  // have to turn to face their desk.
  const back = makeWalkers(SEATS, 0);
  const backStation = makeStation(0);
  const returned = new Set();
  for (let step = 0; step < 8000 && returned.size < back.length; step++) {
    const was = back.map((w) => w.mode);
    stepCrew(back, 0.05, step * 50, backStation);
    back.forEach((w, i) => {
      if (was[i] === "walk" && w.mode === "sit") {
        ok(w.dir === SEAT_FACING[w.home], `${w.id} sits back down facing ${SEAT_FACING[w.home]} (got ${w.dir})`);
        // Sitting down moves nobody: they walk to the chair itself, which is
        // exactly where the seated figure is drawn.
        const seated = sceneItems(SEATS, [w]).find((it) => it.id === w.id);
        ok(Math.abs(seated.x - w.x) < 0.01 && Math.abs(seated.y - w.y) < 0.01,
          `${w.id} sits down where they stopped walking (${w.x.toFixed(1)},${w.y.toFixed(1)} → ${seated.x},${seated.y})`);
        returned.add(w.id);
      }
    });
  }
  ok(returned.size === back.length, "every walker comes home at least once in the test day");
  ok(makeWalkers(SEATS, 0).every((w) => {
    const item = sceneItems(SEATS, [w]).find((it) => it.id === w.id);
    return Math.abs(item.x - w.x) < 0.01 && Math.abs(item.y - w.y) < 0.01;
  }), "…and a walker starts the day in their chair, where they're drawn");

  // One person per seat, even if a seat is both walking and on shift.
  const busy = SEATS.map((s) => (s.id === "bookkeeper" ? { ...s, status: "on-shift" } : s));
  const bk = makeWalkers(SEATS, 0).filter((w) => w.id === "bookkeeper");
  ok(sceneItems(busy, bk).filter((i) => i.type === "person" && i.id === "bookkeeper").length === 1,
    "a worker who is out walking isn't also drawn sitting at their desk");

  // A walker passing just in front of a north-facing desk is drawn over it,
  // not tucked behind it.
  const deskBox = props.find((p) => p.room === "finance");
  const passer = { type: "person", sprite: "crew", id: "passer", x: deskBox.x + deskBox.w / 2,
    y: deskBox.y + deskBox.h + 2, dir: "left", frame: 0, seated: false, sortY: deskBox.y + deskBox.h + 2 };
  const withPasser = [...props.filter((p) => p.room === "finance"), passer].sort((p, q) => p.sortY - q.sortY);
  ok(withPasser.indexOf(passer) > withPasser.indexOf(deskBox), "someone walking in front of a desk is drawn in front of it");
  const behind = { ...passer, y: deskBox.y + 1, sortY: deskBox.y + 1 };
  const withBehind = [...props.filter((p) => p.room === "finance"), behind].sort((p, q) => p.sortY - q.sortY);
  ok(withBehind.indexOf(behind) < withBehind.indexOf(deskBox), "…and someone behind it is drawn behind it");

  // Drawing, against a recording context.
  class Rec {
    constructor() { this.calls = []; this.depth = 0; this.style = null; }
    set fillStyle(v) { this.style = v; }
    get fillStyle() { return this.style; }
    drawImage(img, ...a) { this.calls.push(["drawImage", img, ...a]); }
    fillRect(...a) { this.calls.push(["fillRect", ...a, this.style]); }
    beginPath() {} fill() { this.calls.push(["fill"]); }
    ellipse(...a) { this.calls.push(["ellipse", ...a]); }
    rect(...a) { this.calls.push(["rect", ...a]); }
    clip() { this.calls.push(["clip"]); }
    save() { this.depth++; } restore() { this.depth--; }
  }
  const imgs = { props: { id: "props" }, crew: { id: "crew" }, owner: { id: "owner" } };
  const rec = new Rec();
  const midday = makeWalkers(SEATS, 0);
  const middayStation = makeStation(0);
  for (let i = 0; i < 300; i++) stepCrew(midday, 0.05, i * 50, middayStation);
  const scene = sceneItems(everyone, midday);
  drawScene(rec, scene, imgs, { t: 1234, selected: "finance" });
  const draws = rec.calls.filter((c) => c[0] === "drawImage");
  ok(draws.length >= props.length + 3, `the desks and the people are drawn (${draws.length} images)`);
  ok(draws.every((c) => c.slice(2).every(Number.isFinite)), "every drawImage argument is a real number");
  ok(draws.every(([, , sx, sy, sw, sh, dx, dy, dw, dh]) => dw > 0 && dh > 0 && dx >= -4 && dy >= -4
    && dx + dw <= MAP_W + 4 && dy + dh <= MAP_H + 4), "everything drawn lands on the map");
  const sheetW = { props: Math.max(...Object.values(SPRITES.props).map(([x, , w]) => x + w)),
    crew: SPRITES.person.frameW * SPRITES.person.cols, owner: SPRITES.person.frameW * SPRITES.person.cols };
  ok(draws.every(([, img, sx, , sw]) => sx >= 0 && sx + sw <= sheetW[img.id]), "every source rectangle is on its sheet");
  ok(rec.depth === 0, "every clip is restored");
  const seatedNorth = scene.filter((i) => i.type === "person" && i.seated && i.dir === "up").length;
  ok(seatedNorth >= 3 && rec.calls.filter((c) => c[0] === "clip").length === seatedNorth,
    `each person seated at a north-facing desk is clipped at the chair, and nobody else (${seatedNorth})`);
  const outline = rec.calls.filter((c) => c[0] === "fillRect");
  ok(outline.length === 4, "the selected room gets a four-sided outline");
  // Papers: in a courier's hands, and stacked on the owner's desk (at most three).
  const papersAt = (rec) => rec.calls.filter((c) => c[0] === "fillRect" && c[5] === "#F2FBFB").length;
  const withDesk = new Rec();
  drawScene(withDesk, sceneItems(SEATS, []), imgs, { deskCount: 7 });
  ok(papersAt(withDesk) === 3, `a busy desk shows three sheets, not seven (${papersAt(withDesk)})`);
  const clear = new Rec();
  drawScene(clear, sceneItems(SEATS, []), imgs, { deskCount: 0 });
  ok(papersAt(clear) === 0, "an empty desk shows none");
  const courier = { type: "person", sprite: "crew", id: "c", x: 150, y: 80, dir: "left", frame: 1, seated: false, carrying: true, sortY: 80 };
  const carried = new Rec();
  drawScene(carried, [courier], imgs, {});
  ok(papersAt(carried) === 1, "someone carrying work to the owner is drawn holding it");
  const glow = new Rec();
  drawScene(glow, [{ ...courier, carrying: false, seated: true, working: true }], imgs, { t: 500 });
  ok(glow.calls.filter((c) => c[0] === "ellipse").length === 1, "someone on a live shift glows at the desk");

  const empty = new Rec();
  drawScene(empty, sceneItems(SEATS, []), {}, {});
  ok(empty.calls.filter((c) => c[0] === "drawImage").length === 0, "sheets that haven't loaded are skipped, not drawn as holes");
  ok(PERSON_H > 0 && SPRITES.person.footY <= SPRITES.person.frameH, "people are sized from their feet");
}

// ── 6. Room names and people never cover each other ─────────────────────────
console.log("room names");
{
  // Sizes as measured on a phone (375 px wide), in map units: a name 7.2 tall
  // and up to 68.5 wide, a name tag 9.4 tall. On a desktop both are smaller
  // next to the map, so the phone is the hard case.
  const H = 7.2;
  const W = { owner: 57.9, chief: 68.5, finance: 40.4, coaching: 46.4, atrium: 46.7, ops: 53.5, marketing: 50.8, research: 46.4, front: 61.5 };
  const TAG_H = 9.4;
  const tagW = (short) => 9.7 + 4.46 * short.length;
  const ids = Object.keys(ROOM_RECTS);
  const TOP = ids.filter((id) => ROOM_RECTS[id].door.side === "bottom");
  const BOTTOM = ids.filter((id) => ROOM_RECTS[id].y + ROOM_RECTS[id].h > H2_Y);
  const MIDDLE = ids.filter((id) => !TOP.includes(id) && !BOTTOM.includes(id));
  ok(TOP.length === 3 && MIDDLE.length === 3 && BOTTOM.length === 3, "three rows of three rooms");
  for (const id of ids) {
    const sl = labelSlots(id, W[id], H);
    const r = ROOM_RECTS[id];
    ok(sl.length === 4 && sl.every((x) => x.x >= r.x && x.x + x.w <= r.x + r.w && x.y >= 0 && x.y + x.h <= MAP_H),
      `${id}: four places for its name, all along its own walls and on the map`);
    const expect = BOTTOM.includes(id) ? "front" : "back";
    ok(sl[0].wall === expect && new Set(sl.map((x) => `${x.wall}${x.x}`)).size === 4, `${id}: its name usually hangs on its ${expect} wall`);
  }

  // Visitors in the middle row stand a body's height clear of the back wall,
  // where those rooms' names usually hang — nowhere on the open floor puts
  // anyone in front of it.
  for (const id of MIDDLE) {
    const z = WANDER[id];
    const back = labelSlots(id, W[id], H).filter((x) => x.wall === "back");
    let hit = 0;
    for (let x = z.x; x <= z.x + z.w; x += 1) for (let y = z.y; y <= z.y + z.h; y += 0.5) if (back.some((b) => boxesMeet(b, personBox(x, y), 0.8))) hit++;
    ok(hit === 0, `${id}: a visitor never stands in front of its name on the back wall`);
  }

  // placeLabel, by hand.
  const slots = labelSlots("atrium", W.atrium, H);
  const on = (x) => ({ x: x.x + 2, y: x.y + 1, w: 2, h: 2 });
  const st = {};
  ok(placeLabel(slots, [], st, 0) === 0 && !st.hidden, "with nobody about, a name hangs in its usual place");
  ok(placeLabel(slots, [on(slots[0])], st, 100) === 1 && !st.hidden, "someone about to reach it: it moves to the next clear place");
  ok(placeLabel(slots, [], st, 200) === 1, "…and stays there once they've gone, rather than hopping straight back");
  ok(placeLabel(slots, [], st, 200 + LABEL_SETTLE_MS) === 0, "…until its usual place has been clear a good while");
  ok(placeLabel(slots, [on(slots[0]), on(slots[1])], st, 50000) === 2, "with two places taken it finds a third");
  ok(placeLabel(slots, slots.map(on), st, 50100) === 2 && st.hidden === true, "with every place taken at once it steps out of sight, where it is");
  ok(placeLabel(slots, [on(slots[0]), on(slots[1])], st, 50200) === 2 && st.hidden === false, "…and comes back as soon as a place clears");
  ok(placeLabel(slots, [{ x: slots[2].x + slots[2].w + 1.5, y: slots[2].y, w: 2, h: 2 }], st, 50300) === 2, "someone a step away isn't in the way");

  // Looking ahead: a walker heading for a name moves it before they arrive.
  const [walker] = makeWalkers(SEATS, 0, 1);
  Object.assign(walker, { mode: "walk", x: 150, y: 140, seg: 0, path: [[150, 80]], speed: 20 });
  const future = crowdBoxes([], [walker], { now: 0 });
  ok(future.some((b) => b.y + b.h < 130) && !future.some((b) => b.y + b.h < 140 - 20 * LABEL_LOOKAHEAD_S - 1),
    "a walker's next steps count as taken, as far ahead as the names look and no further");
  const pausing = { ...walker, mode: "pause", room: "atrium", x: 164, y: 112, until: 500, path: [], seg: 0, queue: [], onShift: false };
  ok(crowdBoxes([], [pausing], { now: 0 }).some((b) => b.y < ROOM_RECTS.atrium.y + 4),
    "someone about to leave a room counts as already on their way out through its door");
  ok(crowdBoxes([], [{ ...pausing, until: 60000 }], { now: 0 }).length === 0, "…but not while they're staying put");
  const sitting = { ...pausing, mode: "sit", until: 100 };
  ok(crowdBoxes([], [sitting], { now: 0 }).length > 0, "…someone getting up from their desk counts too");
  ok(crowdBoxes([], [{ ...sitting, onShift: true }], { now: 0 }).length === 0, "…but not someone on shift, who isn't going anywhere");
  ok(crowdBoxes([], [{ ...sitting, queue: ["x"] }], { now: 0 }).length === 0, "…nor someone waiting at their desk for their turn to deliver");

  // A name tag under a room's name fades.
  const label = { x: 100, y: 100, w: 40, h: 7 };
  const tagSize = (id) => (id === "none" ? null : [30, TAG_H]);
  const under = tagsUnderLabels([
    { id: "under", x: 120, feet: 100 + PERSON_H + 1 + TAG_H + 3 },
    { id: "clear", x: 220, feet: 130 },
    { id: "none", x: 120, feet: 120 },
  ], tagSize, [label]);
  ok(under.has("under") && !under.has("clear") && !under.has("none"), "a name tag passing under a room's name fades; one elsewhere doesn't");
  ok(tagBox(120, 130, 30, TAG_H).y + TAG_H === 130 - PERSON_H - 1 && personBox(120, 130).w === PERSON_W,
    "a tag sits one unit above the head it names");

  // Twenty minutes of today's crew, and of a full one, at phone sizes, run the
  // way the page runs it: everyone's body now and a moment ahead decides where
  // each name hangs.
  const simulate = (seats, seed) => {
    const crew = makeWalkers(seats, 0, seed);
    const station = makeStation(0, seed);
    const tags = Object.fromEntries(seats.map((x) => [x.id, [tagW(x.short), TAG_H]]));
    const state = Object.fromEntries(ids.map((id) => [id, {}]));
    const out = Object.fromEntries(ids.map((id) => [id, { covered: 0, moves: 0, hidden: 0, tagged: 0, checks: 0 }]));
    let q = 0;
    for (let step = 0; step < 24000; step++) {
      const now = step * 50;
      if (step % 1200 === 600) for (let k = 0; k < 2; k++) queueDelivery(crew[(Math.floor(step / 1200) + k) % crew.length], [`r${q++}`], station);
      stepCrew(crew, 0.05, now, station);
      for (const w of crew) w.events.length = 0;
      if (step % 2) continue;
      const items = sceneItems(seats, crew);
      const blocked = crowdBoxes(items, crew, { now });
      const people = items.filter((it) => it.type === "person");
      for (const id of ids) {
        const sl = labelSlots(id, W[id], H);
        const before = state[id].slot ?? 0;
        const i = placeLabel(sl, blocked, state[id], now);
        const o = out[id];
        o.checks++;
        if (i !== before) o.moves++;
        if (state[id].hidden) { o.hidden++; continue; }
        if (people.some((it) => boxesMeet(sl[i], personBox(it.x, it.y)))) o.covered++;
        if (people.some((it) => tags[it.id] && boxesMeet(sl[i], tagBox(it.x, it.y, ...tags[it.id])))) o.tagged++;
      }
    }
    return out;
  };
  // Today's crew is the three first hires, pinned here so that hiring someone
  // new doesn't quietly change what this measures.
  const TODAY = ["bookkeeper", "front-desk", "progress-analyst"];
  const crewOf = (ids) => SEATS.map((x) => (x.status === "you" ? x : { ...x, status: ids.includes(x.id) ? "training" : "open" }));
  const today = simulate(crewOf(TODAY), 11);
  const full = simulate(crewOf(SEATS.map((x) => x.id)), 11);
  for (const [name, run] of [["today's crew", today], ["every seat filled", full]]) {
    const covered = ids.filter((id) => run[id].covered).map((id) => `${id} ${run[id].covered}`);
    ok(covered.length === 0, `${name}: no room's name ever covers a worker, or is covered by one${covered.length ? ` (${covered.join(", ")})` : ""}`);
    const moved = [...TOP, ...BOTTOM].filter((id) => run[id].moves || run[id].hidden || run[id].tagged);
    ok(moved.length === 0, `${name}: the top and bottom rows' names never move, never hide and never meet even a name tag${moved.length ? ` (${moved.join(", ")})` : ""}`);
  }
  const perMin = (id) => today[id].moves / 20;
  // The middle row sits between two hallways, so its names do step aside:
  // measured, about once or twice a minute with three people walking.
  ok(MIDDLE.every((id) => perMin(id) <= 2), `today's crew: the middle row's names step aside at most a couple of times a minute (${MIDDLE.map((id) => `${id} ${perMin(id).toFixed(1)}`).join(", ")})`);
  ok(MIDDLE.every((id) => today[id].hidden / today[id].checks < 0.01),
    `…and are almost never out of sight (${MIDDLE.map((id) => `${id} ${(100 * today[id].hidden / today[id].checks).toFixed(2)}%`).join(", ")})`);
}

// ── 7. The page runs it the same way ────────────────────────────────────────
console.log("the page");
{
  const page = stripComments(readFileSync(new URL("../src/HQStation.jsx", import.meta.url), "utf8"));
  ok(/stepCrew\(walkersRef\.current, dt, now, stationRef\.current\)/.test(page), "the map moves the whole crew together, with the delivery turns");
  ok(!/stepWalker\(/.test(page), "…never one walker on their own, who couldn't see anyone else");
  ok(/walkersRef\.current = makeWalkers\([^)]*\);\s*stationRef\.current = makeStation\(/.test(page),
    "a new crew gets new turns, so a run nobody can finish never blocks the line");
  ok(/queueDelivery\(w, \[d\.id\], stationRef\.current\)/.test(page), "work is put in line in the order it arrives");
  ok(/const bodies = crowdBoxes\(items, moving \? walkersRef\.current : \[\], \{ now \}\);/.test(page),
    "room names look where people are going, and who is about to leave");
  ok(/const want = placeLabel\(slots, bodies, s, now\);/.test(page) && /const show = s\.hidden \? "0" : "1";/.test(page),
    "…each name takes the place placeLabel chooses, and steps out of sight when it says so");
  ok(/if \(!s\.hidden\) hung\.push\(slots\[s\.shown\]\);/.test(page) && /tagsUnderLabels\(people,/.test(page)
    && /el\.style\.opacity = under\.has\(pid\) \? "0" : "";/.test(page), "…and a name tag under a name that is showing fades");
  ok(/labelSlots\(id, sz\[0\], sz\[1\]\)/.test(page) && /el\.offsetWidth \/ k, el\.offsetHeight \/ k/.test(page),
    "names are placed at their size as measured on screen, in map units");
  ok(/fonts\.addEventListener\("loadingdone", again\)/.test(page), "…measured again once the pixel font arrives");
  ok(/const \[x, y\] = w\.mode === "sit" \? w\.seat : \[w\.x, w\.y\];/.test(page), "a seated walker's tag sits over their chair");
  ok(/\} else \{\s*put\(el, slots\[s\.shown\]\); s\.swapAt = 0; el\.style\.opacity = show;\s*\}/.test(page),
    "a name that stays put is re-placed at its current size, so a resize never leaves it off its wall");
}

console.log(`\n${checks - fails}/${checks} HQ station checks passed`);
if (fails) process.exit(1);
