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
//
// Run: node scripts/test-hq-station.mjs
import { SEATS, ROOMS } from "../src/hqOrg.js";
import {
  MAP_W, MAP_H, HALLS, H1_Y, H2_Y, V_XS, ROOM_RECTS, MAP_LABELS, SEAT_SPOTS,
  interior, walkable, roomAt, doorPoints, route, makeRng, spotIn,
  makeWalkers, stepWalker, drawStatic, drawDynamic,
  SEAT_FACING, WANDER, SPRITES, PERSON_H, propBox, sceneItems, drawScene, facingFor,
  LANES, OWNER_DROP, queueDelivery, deliveriesDue, DELIVERY_WINDOW_MS,
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
    const log = ws.map(() => ({ left: 0, back: 0, rooms: new Set(), offFloor: 0, nan: 0, trail: [] }));
    const dt = 0.05;
    for (let step = 0; step * dt < seconds; step++) {
      const now = step * dt * 1000;
      ws.forEach((w, i) => {
        const before = w.room;
        stepWalker(w, dt, now);
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
    const t = [];
    for (let step = 0; step < 4000; step++) {
      ws.forEach((w) => stepWalker(w, 0.05, step * 50));
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
  const fewest = Math.min(...[...shapes.values()].map((v) => v.size));
  ok(fewest >= 5, `every pair of rooms is joined by many different walks (fewest: ${fewest})`);
  ok(farTaken > crossings * 0.15 && farTaken < crossings * 0.5, `the longer cross-hallway is taken now and then, not always (${farTaken} of ${crossings})`);
  ok(LANES.every((l) => Math.abs(l) <= 4), "no lane strays more than four units off a hallway's centre line");
  const plain = route("finance", "marketing");
  ok(JSON.stringify(plain) === JSON.stringify(route("finance", "marketing", null)), "without a generator the route is the plain shortest one");
}

// ── 3c. Deliveries: work walks to the owner's desk ─────────────────────────
console.log("deliveries");
{
  const ws = makeWalkers(SEATS, 0, 7);
  const bk = ws.find((w) => w.id === "bookkeeper");
  queueDelivery(bk, ["item-1", "item-2"]);
  queueDelivery(bk, ["item-2"]);
  ok(bk.queue.length === 2, "the same item is never queued twice");
  const seen = { handoff: false, carried: false, delivered: null, back: false, wall: false };
  for (let step = 0; step < 3000 && !seen.back; step++) {
    const now = step * 50;
    stepWalker(bk, 0.05, now);
    if (!walkable(bk.x, bk.y)) seen.wall = true;
    if (bk.carrying.length) seen.carried = true;
    if (bk.mode === "handoff") {
      seen.handoff = true;
      ok(Math.abs(bk.x - OWNER_DROP[0]) < 0.01 && Math.abs(bk.y - OWNER_DROP[1]) < 0.01 && bk.dir === "up",
        "the hand-over happens at the owner's desk, facing him");
      const item = sceneItems(SEATS, [bk]).find((i) => i.id === "bookkeeper");
      ok(item.carrying === true, "…still holding the papers until they're handed over");
    }
    for (const e of bk.events.splice(0)) if (e.type === "delivered") seen.delivered = e.ids;
    if (seen.delivered && bk.mode === "sit" && bk.room === bk.home) seen.back = true;
  }
  ok(seen.carried && seen.handoff, "a queued delivery is carried to the owner");
  ok(JSON.stringify(seen.delivered) === JSON.stringify(["item-1", "item-2"]), `the page is told exactly which items were handed over (${JSON.stringify(seen.delivered)})`);
  ok(seen.back, "…and the worker goes back to their desk afterwards");
  ok(!seen.wall, "a delivery never walks through a wall");
  ok(walkable(...OWNER_DROP) && roomAt(...OWNER_DROP) === "owner", "the drop-off spot is on the owner's office floor");
  const desk = propBox("exec_front", ...SEAT_SPOTS.owner[0]);
  ok(OWNER_DROP[1] > desk.y + desk.h, "…in front of his desk, not inside it");

  // Someone on a live shift stays at the desk — until there is something to deliver.
  const live = makeWalkers(SEATS.map((s) => (s.id === "bookkeeper" ? { ...s, status: "on-shift" } : s)), 0, 3);
  const onShift = live.find((w) => w.id === "bookkeeper");
  let left = false;
  for (let step = 0; step < 6000; step++) { stepWalker(onShift, 0.05, step * 50); if (onShift.room !== "finance") left = true; }
  ok(!left, "a worker on shift stays at the desk for the whole shift");
  const item = sceneItems(SEATS, [onShift]).find((i) => i.id === "bookkeeper");
  ok(item.working === true && item.seated === true, "…drawn seated and working");
  queueDelivery(onShift, ["x"]);
  stepWalker(onShift, 0.05, 6000 * 50);
  ok(onShift.mode === "walk" && onShift.dest === "owner", "…and gets up at once to bring you what they finished");
  const open = makeWalkers(SEATS.map((s) => ({ ...s, status: s.status === "you" ? "you" : "open" })), 0, 3);
  ok(open.length === 0, "nobody walks for an open seat, deliveries or not");

  // Which items get walked over.
  const NOW = Date.UTC(2026, 8, 25, 15, 0, 0);
  const items = [
    { id: "a", worker: "bookkeeper", createdAt: NOW - 3600000 },
    { id: "b", worker: "front-desk", createdAt: NOW - DELIVERY_WINDOW_MS - 1 },
    { id: "c", worker: "bookkeeper", createdAt: NOW - 60000 },
    { id: "d", worker: "", createdAt: NOW },
  ];
  const due = deliveriesDue(items, new Set(["c"]), NOW);
  ok(JSON.stringify(due) === JSON.stringify([{ id: "a", worker: "bookkeeper" }]),
    `only new, undelivered items with a worker are carried (${JSON.stringify(due)})`);
  ok(deliveriesDue(items, new Set(["a", "c"]), NOW).length === 0, "an item delivered on this device is never carried twice");
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
  for (let s = 0; s < 400; s++) walkers.forEach((w) => stepWalker(w, 0.05, s * 50));
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
  const seen = new Set();
  for (let step = 0; step < 6000; step++) {
    walkers.forEach((w) => stepWalker(w, 0.05, step * 50));
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
  const returned = new Set();
  for (let step = 0; step < 8000 && returned.size < back.length; step++) {
    back.forEach((w) => {
      const was = w.mode;
      stepWalker(w, 0.05, step * 50);
      if (was === "walk" && w.mode === "sit") {
        ok(w.dir === SEAT_FACING[w.home], `${w.id} sits back down facing ${SEAT_FACING[w.home]} (got ${w.dir})`);
        returned.add(w.id);
      }
    });
  }
  ok(returned.size === back.length, "every walker comes home at least once in the test day");

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
  for (let i = 0; i < 300; i++) midday.forEach((w) => stepWalker(w, 0.05, i * 50));
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

console.log(`\n${checks - fails}/${checks} HQ station checks passed`);
if (fails) process.exit(1);
