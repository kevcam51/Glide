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
} from "../src/hqStation.js";

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log("  ✗ " + msg); } };

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
    const allowed = new Set([w.home, "atrium", "coaching", "owner"]);
    ok([...L.rooms].every((r) => allowed.has(r)), `${w.id}: only tours the courtyard, the training floor and your office (${[...L.rooms].join(", ")})`);
  });
  const again = simulate(20 * 60);
  ok(again.log.every((L, i) => L.trail.join("|") === log[i].trail.join("|")), "the same seed walks the same day every time");
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

console.log(`\n${checks - fails}/${checks} HQ station checks passed`);
if (fails) process.exit(1);
