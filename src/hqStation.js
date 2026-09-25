// Smooth Training HQ — the station view (S238).
//
// Kevin, after the cutaway building: "I really want to take almost all the
// inspiration from what we saw from that guy on GitHub ... I liked seeing all
// the numbers on the sides, all the departments, and also seeing the people
// moving." So this is a top-down map of the building — nine rooms off two
// hallways, a palm courtyard in the middle, the Smooth Training van parked out
// front — drawn at 320 × 240 and scaled up with square pixels, with the crew
// walking it.
//
// ⚠️ MODELLED ON STARNET'S LAYOUT, NOT ITS ART. StarNet's code is MIT, but its
// name, sprites and station artwork belong to its author and are explicitly NOT
// licensed with the code. Every pixel here is drawn from rectangles in this
// file, in Smooth Training's cyan on black.
//
// ⚠️ ONLY REAL SEATS MOVE. A worker in training walks the building; an open
// seat is a dim outline at an empty desk. No extra people are drawn to make the
// halls look busy — the station shows the crew Kevin actually has, and the
// halls fill up as he hires.
//
// Everything that decides WHERE — the map, the doors, the routes, the walkers —
// is pure and runs in node for the suite. Only the draw functions touch a
// canvas, and the suite runs them against a recording context that refuses a
// non-finite number (an SVG or canvas draws NaN as nothing, silently).
//
// THE SECOND LOOK (same day). Kevin wanted it "almost identical" to StarNet's
// art — detailed, clear, "almost 3D". StarNet's art is theirs and unlicensed,
// but its own repo shows HOW it was made: an image model, prompted with a
// structure guide, then keyed and cut into sprites. So the building here was
// made the same way from THIS file's layout: drawStatic() rendered the empty
// map, an image model repainted it (src/hq-art/station-*), and the desks and
// the crew are separate sprites drawn over it, sorted front to back. The
// rectangles below still decide where everything is — the painting was made to
// fit them, not the other way round — so the routes, the doors and the suite
// are unchanged, and drawStatic() stays as the fallback if the art won't load.

export const MAP_W = 320;
export const MAP_H = 240;

const CYAN = "#08DCE0";
const AMBER = "#FBBF24";
const GREEN = "#2FE0A8";

// The two hallways run across; two more run down between the room columns.
export const H1_Y = 80;
export const H2_Y = 152;
export const V_XS = [112, 216];
export const HALLS = [
  { x: 8, y: 72, w: 304, h: 16 },
  { x: 8, y: 144, w: 304, h: 16 },
  { x: 104, y: 8, w: 16, h: 200 },
  { x: 208, y: 8, w: 16, h: 200 },
];

// Every room: its rectangle, the door it opens onto a hallway through, and the
// hallway that door meets. The courtyard is a room with no seats.
export const ROOM_RECTS = {
  owner:     { x: 8,   y: 8,   w: 96, h: 64, door: { x: 56,  side: "bottom", hall: H1_Y } },
  chief:     { x: 120, y: 8,   w: 88, h: 64, door: { x: 164, side: "bottom", hall: H1_Y } },
  finance:   { x: 224, y: 8,   w: 88, h: 64, door: { x: 264, side: "bottom", hall: H1_Y } },
  coaching:  { x: 8,   y: 88,  w: 96, h: 56, door: { x: 56,  side: "top",    hall: H1_Y } },
  atrium:    { x: 120, y: 88,  w: 88, h: 56, door: { x: 164, side: "top",    hall: H1_Y } },
  ops:       { x: 224, y: 88,  w: 88, h: 56, door: { x: 264, side: "top",    hall: H1_Y } },
  marketing: { x: 8,   y: 160, w: 96, h: 48, door: { x: 56,  side: "top",    hall: H2_Y } },
  research:  { x: 120, y: 160, w: 88, h: 48, door: { x: 164, side: "top",    hall: H2_Y } },
  front:     { x: 224, y: 160, w: 88, h: 48, door: { x: 264, side: "top",    hall: H2_Y } },
};

// Short names for the map; the full ones live in hqOrg.js.
export const MAP_LABELS = {
  owner: "Your Office", chief: "Chief of Staff", finance: "Finance",
  coaching: "Coaching", atrium: "Courtyard", ops: "Ops & Tech",
  marketing: "Marketing", research: "Research", front: "Front Office",
};

// Where each seat's person sits (their feet), in the order hqOrg.js lists that
// room's seats. Rooms entered from the south (the top row) face their desks
// north, so the camera sees the crew's backs and the glowing screens; rooms
// entered from the north face south, so a walker coming home reaches the chair
// without walking through the desk. The Front Office's four seats stand behind
// one reception counter. The owner faces the door, like any boss: a matte-black
// figure seen from behind at a black chair simply disappeared.
export const SEAT_SPOTS = {
  owner: [[56, 40]],
  chief: [[164, 38]],
  finance: [[246, 38], [268, 38], [290, 38]],
  coaching: [[54, 126], [72, 126], [90, 126]],
  ops: [[252, 126], [274, 126]],
  marketing: [[32, 190], [52, 190], [72, 190]],
  research: [[144, 190], [164, 190], [184, 190]],
  front: [[240, 188], [258, 188], [276, 188], [294, 188]],
};

// Which way someone at a desk faces, per room.
export const SEAT_FACING = {
  owner: "down", chief: "up", finance: "up",
  coaching: "down", ops: "down", marketing: "down", research: "down", front: "down",
};

// Open floor to wander to in each room: clear of the desks and of the
// furniture painted along the walls. A visitor stops somewhere in here.
export const WANDER = {
  owner: { x: 46, y: 52, w: 26, h: 6 },
  chief: { x: 136, y: 46, w: 56, h: 18 },
  finance: { x: 236, y: 46, w: 52, h: 16 },
  coaching: { x: 44, y: 100, w: 52, h: 10 },
  atrium: { x: 140, y: 100, w: 48, h: 30 },
  ops: { x: 236, y: 100, w: 52, h: 10 },
  marketing: { x: 20, y: 170, w: 60, h: 6 },
  research: { x: 132, y: 170, w: 56, h: 6 },
  front: { x: 232, y: 172, w: 72, h: 2 },
};

// Floor inside the walls: 3px walls at the sides, a 7px wall face at the top.
export function interior(roomId) {
  const r = ROOM_RECTS[roomId];
  return { x: r.x + 3, y: r.y + 7, w: r.w - 6, h: r.h - 10 };
}

const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// Floor someone can stand on: a room's interior, a hallway, or a doorway.
export function walkable(x, y) {
  if (HALLS.some((h) => inRect(x, y, h))) return true;
  for (const id of Object.keys(ROOM_RECTS)) {
    if (inRect(x, y, interior(id))) return true;
    const r = ROOM_RECTS[id];
    const d = r.door;
    if (Math.abs(x - d.x) <= 6) {
      if (d.side === "bottom" && y >= r.y + r.h - 4 && y <= r.y + r.h) return true;
      if (d.side === "top" && y >= r.y && y <= r.y + 8) return true;
    }
  }
  return false;
}

// Which room a map point falls in (for a tap), or null for a hallway / outside.
export function roomAt(x, y) {
  for (const id of Object.keys(ROOM_RECTS)) if (inRect(x, y, ROOM_RECTS[id])) return id;
  return null;
}

export function doorPoints(roomId) {
  const r = ROOM_RECTS[roomId];
  const d = r.door;
  const inside = d.side === "bottom" ? [d.x, r.y + r.h - 10] : [d.x, r.y + 12];
  return { inside, hall: [d.x, d.hall] };
}

// Hallway lanes: people keep a little to one side of the centre line or the
// other, so two walks down the same hallway rarely trace the same line.
export const LANES = [-4, -2, 0, 2, 4];

// Door to door along the hallways, never through a wall: out of the room,
// along its hallway to a cross-hallway, down or up it, and along the other
// hallway to the destination's door. Every leg is straight and axis-aligned,
// so it can be checked point by point.
//
// Kevin asked for routes that are "always different". With an `rng`, every
// trip picks its own lane in each hallway and now and then takes the LONGER
// cross-hallway, so the same two rooms are joined by many different walks.
// Without one it is the shortest route down the centre line.
export function route(from, to, rng = null) {
  const a = doorPoints(from);
  if (from === to) return [a.inside];
  const b = doorPoints(to);
  const lane = () => (rng ? LANES[Math.floor(rng() * LANES.length)] : 0);
  const ay = a.hall[1] + lane();
  const pts = [a.inside, [a.hall[0], ay]];
  if (a.hall[1] !== b.hall[1]) {
    const cost = (vx) => Math.abs(a.hall[0] - vx) + Math.abs(b.hall[0] - vx);
    const [near, far] = [...V_XS].sort((p, q) => cost(p) - cost(q));
    const vx = (rng && rng() < 0.3 ? far : near) + lane();
    const by = b.hall[1] + lane();
    pts.push([vx, ay], [vx, by], [b.hall[0], by]);
  } else {
    pts.push([b.hall[0], ay]);
  }
  pts.push(b.inside);
  return pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
}

// A small seeded generator. The station seeds it from the moment the HQ opens,
// so every visit is a different day; the suite passes a fixed seed so it can
// replay one.
export function makeRng(seed) {
  // Mix the seed first: without it, neighbouring seeds start almost the same
  // sequence (a plain LCG's first draw is nearly linear in its seed), so two
  // openings a moment apart would begin the same walk.
  let s = seed >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
  s = ((s ^ (s >>> 16)) >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function seedFor(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// A spot to stand in a room: somewhere on its open floor.
export function spotIn(roomId, rng) {
  const z = WANDER[roomId];
  if (!z) {
    const f = interior(roomId);
    return [Math.round(f.x + 6 + rng() * (f.w - 12)), Math.round(f.y + 8 + rng() * (f.h - 14))];
  }
  return [Math.round(z.x + rng() * z.w), Math.round(z.y + rng() * z.h)];
}

// Everyone hired walks the building: a trainee, a worker between shifts, and
// a worker on shift (who mostly stays at the desk). An open seat never walks.
const HIRED = new Set(["training", "working", "on-shift"]);

// Where the owner stands a visitor: in front of his desk, facing him.
export const OWNER_DROP = [56, 49];

// Where someone goes between stints at the desk: the courtyard most often,
// otherwise any department's open floor — never another department's desk,
// and NEVER the owner's office. A walk to the owner means there is something
// for him (a delivery), so it is never made for nothing.
function tourStop(w) {
  if (w.rng() < 0.35) return "atrium";
  const others = Object.keys(ROOM_RECTS).filter((id) => id !== w.home && id !== "owner" && id !== "atrium");
  return others[Math.floor(w.rng() * others.length)];
}

export function makeWalkers(seats, now = 0, seed = 0) {
  const byRoom = {};
  const out = [];
  for (const s of seats) {
    const i = (byRoom[s.room] = (byRoom[s.room] || 0) + 1) - 1;
    if (!HIRED.has(s.status)) continue;
    const spot = (SEAT_SPOTS[s.room] || [])[i];
    if (!spot) continue;
    const rng = makeRng((seedFor(s.id) ^ Math.imul(seed >>> 0, 2654435761)) >>> 0);
    out.push({
      id: s.id, home: s.room, room: s.room, seat: spot,
      x: spot[0], y: spot[1], mode: "sit", until: now + 1500 + rng() * 5000,
      path: [], seg: 0, dest: s.room, walked: 0, speed: 20,
      dir: SEAT_FACING[s.room] || "down",
      onShift: s.status === "on-shift",
      queue: [], carrying: [], purpose: null, events: [], rng,
    });
  }
  return out;
}

// Which desk items still need carrying to the owner: open, not yet delivered
// on this device, and filed within the last week (older ones just count as
// delivered — a week-old report doesn't need a walk).
export const DELIVERY_WINDOW_MS = 7 * 86400000;
export function deliveriesDue(open = [], delivered = new Set(), now = Date.now()) {
  return open
    .filter((i) => i && i.id && i.worker && !delivered.has(i.id) && (i.createdAt || 0) >= now - DELIVERY_WINDOW_MS)
    .map((i) => ({ id: i.id, worker: i.worker }));
}

// Hand a walker something to take to the owner: desk item ids they filed. They
// set off at the next moment they are free — straight away from their desk,
// or as soon as the walk they are on ends.
export function queueDelivery(w, ids) {
  for (const id of ids) if (!w.queue.includes(id) && !w.carrying.includes(id)) w.queue.push(id);
  return w;
}

function startWalk(w, dest, target, purpose) {
  w.path = [...route(w.room, dest, w.rng), target];
  w.seg = 0;
  w.dest = dest;
  w.mode = "walk";
  w.purpose = purpose;
}

// Which way a sprite faces while moving by (dx, dy): the larger axis wins.
export function facingFor(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

// One tick of a walker's day. Mutates and returns it; `dt` in seconds, `now`
// in milliseconds. Anything the page needs to know about — a delivery handed
// over — is pushed onto `w.events` for the page to take.
export function stepWalker(w, dt, now) {
  if (w.mode === "walk") {
    let left = w.speed * dt;
    while (left > 0 && w.seg < w.path.length) {
      const [tx, ty] = w.path[w.seg];
      const dx = tx - w.x, dy = ty - w.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.001) w.dir = facingFor(dx, dy);
      if (dist <= left) {
        w.x = tx; w.y = ty; w.walked += dist; left -= dist; w.seg++;
      } else {
        w.x += (dx / dist) * left; w.y += (dy / dist) * left; w.walked += left; left = 0;
      }
    }
    if (w.seg >= w.path.length) {
      w.room = w.dest;
      if (w.purpose === "deliver") {
        // At the owner's desk: face him and hand it over.
        w.mode = "handoff";
        w.dir = "up";
        w.until = now + 2200;
      } else if (w.dest === w.home) {
        w.mode = "sit";
        w.dir = SEAT_FACING[w.home] || "down";
        w.until = now + (w.onShift ? 30000 : 5000 + w.rng() * 5000);
      } else {
        w.mode = "pause";
        w.until = now + 2500 + w.rng() * 3500;
      }
      w.purpose = null;
    }
    return w;
  }
  if (w.mode === "handoff") {
    if (now < w.until) return w;
    w.events.push({ type: "delivered", ids: w.carrying });
    w.carrying = [];
    startWalk(w, w.home, w.seat, "return");
    return w;
  }
  // Something for the owner goes first: from the desk at once, or as soon as
  // a pause ends.
  if (w.queue.length && (w.mode === "sit" || now >= w.until)) {
    w.carrying = w.queue.splice(0);
    startWalk(w, "owner", OWNER_DROP, "deliver");
    return w;
  }
  if (now < w.until) return w;
  const atHome = w.room === w.home;
  if (w.onShift) {
    // On shift, the desk is where the work is.
    if (atHome) { w.until = now + 30000; return w; }
    startWalk(w, w.home, w.seat, "return");
    return w;
  }
  if (atHome) {
    const stop = tourStop(w);
    startWalk(w, stop, spotIn(stop, w.rng), "tour");
  } else {
    startWalk(w, w.home, w.seat, "return");
  }
  return w;
}

// ── The painted station: desks and crew drawn over the backdrop ─────────────

// The sprite sheets in src/hq-art/, measured in their own pixels. Both people
// sheets are four rows (the direction they face) by four walk frames.
export const SPRITES = {
  person: { frameW: 54, frameH: 100, footY: 98, rows: ["down", "left", "right", "up"], cols: 4 },
  props: {
    desk: [4, 4, 240, 212],
    desk_off: [248, 4, 240, 203],
    exec: [492, 4, 280, 212],
    counter: [776, 4, 520, 194],
    desk_front: [1300, 4, 240, 163],
    exec_front: [1544, 4, 280, 150],
  },
};

// A standing crew member, head to toe, in map units. Everything below is sized
// against this, so the building and its people stay in proportion.
export const PERSON_H = 14;
const PROP_W = { desk: 17, desk_off: 17, exec: 21, desk_front: 17, exec_front: 22, counter: 66 };
const PROP_SQUASH = { counter: 0.72 };
// How far someone walks between walk-cycle frames.
const STEP = 2.4;

// Where a prop sits for the person whose feet are at (cx, feetY), and the depth
// it is sorted at. A north-facing desk is behind its chair, so it sorts at its
// own front edge and the person in the chair draws after it; a south-facing
// desk and the reception counter are in FRONT of the person, so they sort at
// their bottom edge and draw after them, hiding their legs.
export function propBox(kind, cx, feetY) {
  const [, , sw, sh] = SPRITES.props[kind];
  const w = PROP_W[kind];
  const h = (sh / sw) * w * (PROP_SQUASH[kind] || 1);
  if (kind === "counter") {
    const top = feetY - 4;
    return { x: cx - w / 2, y: top, w, h, sortY: top + h };
  }
  if (kind === "desk_front" || kind === "exec_front") {
    const top = feetY - 9;
    return { x: cx - w / 2, y: top, w, h, sortY: top + h };
  }
  const top = feetY + 2 - h;
  return { x: cx - w / 2, y: top, w, h, sortY: top + h * 0.45 };
}

function deskKind(room, seat) {
  if (room === "owner") return SEAT_FACING.owner === "down" ? "exec_front" : "exec";
  if (SEAT_FACING[room] === "down") return "desk_front";
  return seat.status === "open" ? "desk_off" : "desk";
}

// Someone at their desk. Facing north they sit lower than they stand and only
// their top half shows over the chair; facing south the desk in front of them
// does the hiding. `working` is someone on a live shift.
function seatedPerson(id, room, [x, y], sprite, working = false) {
  const dir = SEAT_FACING[room] || "down";
  if (dir === "up") {
    const box = propBox(room === "owner" ? "exec" : "desk", x, y);
    return { type: "person", sprite, id, x, y: y + 3, dir, frame: 0, seated: true, working,
      clipY: box.y + box.h * 0.62, sortY: box.sortY + 0.01 };
  }
  return { type: "person", sprite, id, x, y, dir, frame: 0, seated: true, working, sortY: y - 0.01 };
}

// Everything drawn over the backdrop this frame, back to front: a desk for every
// seat (dark when nobody fills it), one counter across the Front Office, the
// owner at their desk, and the crew wherever their day has taken them.
export function sceneItems(seats, walkers = []) {
  const items = [];
  const byRoom = {};
  for (const s of seats) (byRoom[s.room] = byRoom[s.room] || []).push(s);
  const walkingIds = new Set(walkers.map((w) => w.id));
  for (const [room, list] of Object.entries(byRoom)) {
    const spots = SEAT_SPOTS[room] || [];
    if (room === "front" && spots.length) {
      const xs = spots.slice(0, list.length).map((p) => p[0]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      items.push({ type: "prop", kind: "counter", room, ...propBox("counter", cx, spots[0][1]) });
    }
    list.forEach((seat, i) => {
      const spot = spots[i];
      if (!spot) return;
      if (room !== "front") {
        const kind = deskKind(room, seat);
        items.push({ type: "prop", kind, room, seatId: seat.id, ...propBox(kind, spot[0], spot[1]) });
      }
      if (walkingIds.has(seat.id)) return;
      if (seat.status === "you") items.push(seatedPerson(seat.id, room, spot, "owner"));
      else if (seat.status === "on-shift" || seat.status === "working") {
        items.push(seatedPerson(seat.id, room, spot, "crew", seat.status === "on-shift"));
      }
    });
  }
  for (const w of walkers) {
    if (w.mode === "sit") { items.push(seatedPerson(w.id, w.home, w.seat, "crew", !!w.onShift)); continue; }
    items.push({ type: "person", sprite: "crew", id: w.id, x: w.x, y: w.y, dir: w.dir || "down",
      frame: w.mode === "walk" ? Math.floor(w.walked / STEP) % 4 : 0, seated: false,
      carrying: (w.carrying || []).length > 0, sortY: w.y });
  }
  return items.sort((a, b) => a.sortY - b.sortY);
}

// Where a person's name tag goes: just above their head.
export function tagPoint(item) {
  const top = item.y - PERSON_H + (item.seated && item.dir === "up" ? 0 : 0);
  return [item.x, top - 1.5];
}

// A sheet of paper, the size of a hand, for someone carrying work to the owner
// and for what is waiting on the owner's desk.
function drawPaper(ctx, x, y) {
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.fillRect(x + 0.3, y + 0.3, 2.6, 3.2);
  ctx.fillStyle = "#F2FBFB";
  ctx.fillRect(x, y, 2.6, 3.2);
  ctx.fillStyle = "rgba(8,220,224,.9)";
  ctx.fillRect(x + 0.45, y + 0.7, 1.7, 0.35);
  ctx.fillRect(x + 0.45, y + 1.5, 1.7, 0.35);
  ctx.fillRect(x + 0.45, y + 2.3, 1.1, 0.35);
}

// Draw the items over the backdrop. `ctx` is already scaled so one unit is one
// map unit; `images` holds the loaded sheets ({ props, crew, owner }) and any
// that haven't loaded yet are skipped rather than drawn as holes. `deskCount`
// is how many items wait on the owner's desk: up to three sheets sit on it.
export function drawScene(ctx, items, images, { t = 0, selected = null, deskCount = 0 } = {}) {
  const P = SPRITES.person;
  const k = PERSON_H / P.footY;
  for (const it of items) {
    if (it.type === "prop") {
      const img = images && images.props;
      if (!img) continue;
      const [sx, sy, sw, sh] = SPRITES.props[it.kind];
      ctx.drawImage(img, sx, sy, sw, sh, it.x, it.y, it.w, it.h);
      if ((it.kind === "exec_front" || it.kind === "exec") && deskCount > 0) {
        for (let i = 0; i < Math.min(3, deskCount); i++) drawPaper(ctx, it.x + it.w * 0.14 + i * 0.5, it.y + it.h * 0.3 - i * 0.6);
      }
      continue;
    }
    const img = images && images[it.sprite];
    if (!img) continue;
    const row = Math.max(0, P.rows.indexOf(it.dir));
    const col = ((it.frame % P.cols) + P.cols) % P.cols;
    const dw = P.frameW * k, dh = P.frameH * k;
    const dx = it.x - dw / 2, dy = it.y - P.footY * k;
    if (!it.seated) {
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.beginPath();
      ctx.ellipse(it.x, it.y - 0.3, 3, 1.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (it.working) {
      // On a live shift: a soft glow that breathes, so work in progress shows.
      const a = 0.22 + 0.18 * Math.sin(t / 420);
      ctx.fillStyle = `rgba(8,220,224,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(it.x, dy + dh * 0.28, 4.6, 4.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const clip = it.clipY != null;
    if (clip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(dx - 1, dy - 1, dw + 2, Math.max(0, it.clipY - dy + 1));
      ctx.clip();
    }
    ctx.drawImage(img, col * P.frameW, row * P.frameH, P.frameW, P.frameH, dx, dy, dw, dh);
    if (clip) ctx.restore();
    if (it.carrying) {
      const side = it.dir === "left" ? -1 : 1;
      drawPaper(ctx, it.x + side * 1.6 - 1.3, it.y - PERSON_H * 0.46);
    }
  }
  if (selected && ROOM_RECTS[selected]) {
    const r = ROOM_RECTS[selected];
    const a = 0.55 + 0.3 * Math.sin(t / 380);
    const th = 0.8;
    ctx.fillStyle = `rgba(8,220,224,${a.toFixed(3)})`;
    ctx.fillRect(r.x, r.y, r.w, th); ctx.fillRect(r.x, r.y + r.h - th, r.w, th);
    ctx.fillRect(r.x, r.y, th, r.h); ctx.fillRect(r.x + r.w - th, r.y, th, r.h);
  }
}

// ── Looks ───────────────────────────────────────────────────────────────────

const SKINS = ["#F1C27D", "#C68642", "#8D5524", "#E0AC69", "#A56B46"];
const HAIRS = ["#1B120C", "#0B0B0B", "#5A3A22", "#2D2D2D", "#3B2616"];

export function lookFor(seat) {
  const h = seedFor(seat.id);
  return {
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >>> 4) % HAIRS.length],
    shirt: seat.role === "head" ? "#0AB7BB" : "#11181B",
    logo: seat.role !== "head",
  };
}

// ── Drawing ─────────────────────────────────────────────────────────────────

const FLOORS = {
  owner: ["#0F1C24", "#122129"], chief: ["#111822", "#141C27"], finance: ["#0D1C18", "#10201C"],
  coaching: ["#101214", "#131619"], atrium: ["#0F1D1E", "#132526"], ops: ["#10151F", "#131925"],
  marketing: ["#181220", "#1C1525"], research: ["#15170F", "#191B12"], front: ["#0C1A1D", "#0F1F22"],
};

function rect(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

// A chair, a desk and a monitor. At the Front Office the long reception
// counter is the desk, so only the chair and the monitor are drawn.
function drawDesk(ctx, x, y, occupied, { counter = false } = {}) {
  rect(ctx, x - 5, y - 6, 10, 5, "#18252A");            // chair back
  rect(ctx, x - 5, y - 6, 10, 1, "#2A3D42");
  if (!counter) {
    rect(ctx, x - 7, y + 1, 14, 5, "#3A4E54");          // desk top
    rect(ctx, x - 7, y + 1, 14, 1, "#4E666C");
    rect(ctx, x - 7, y + 6, 14, 1, "#1B262C");          // desk edge
  }
  rect(ctx, x - 3, y + 1, 6, 2, "#0B1114");             // monitor
  rect(ctx, x - 2, y + 1, 4, 1, occupied ? "#0A8E91" : "#15252A");
}

// A person seen from above and in front. (x, y) is where they sit or stand.
export function drawPerson(ctx, x, y, look, { frame = 0, seated = false, ghost = false } = {}) {
  const px = Math.round(x) - 3;
  const py = Math.round(y) - 9;
  if (ghost) {
    ctx.fillStyle = "rgba(170,210,210,.16)";
    ctx.fillRect(px + 1, py, 4, 4);
    ctx.fillRect(px, py + 4, 6, 3);
    return;
  }
  if (!seated) rect(ctx, px, py + 9, 6, 1, "rgba(0,0,0,.45)");
  rect(ctx, px + 1, py, 4, 1, look.hair);
  rect(ctx, px, py + 1, 6, 1, look.hair);
  rect(ctx, px + 1, py + 2, 4, 2, look.skin);
  rect(ctx, px, py + 4, 6, 3, look.shirt);
  if (look.logo) rect(ctx, px + 3, py + 5, 1, 1, CYAN);
  rect(ctx, px, py + 6, 1, 1, look.skin);
  rect(ctx, px + 5, py + 6, 1, 1, look.skin);
  if (seated) return;
  const leg = "#1B2226";
  if (frame === 0) { rect(ctx, px + 1, py + 7, 1, 2, leg); rect(ctx, px + 4, py + 7, 1, 1, leg); }
  else { rect(ctx, px + 1, py + 7, 1, 1, leg); rect(ctx, px + 4, py + 7, 1, 2, leg); }
}

function palmTop(ctx, cx, cy) {
  rect(ctx, cx - 1, cy - 1, 3, 3, "#6B4F2E");
  const g = "#1F8A5B", d = "#166B46";
  rect(ctx, cx - 6, cy - 1, 5, 2, g); rect(ctx, cx + 2, cy - 1, 5, 2, g);
  rect(ctx, cx - 1, cy - 6, 2, 5, g); rect(ctx, cx - 1, cy + 2, 2, 5, d);
  rect(ctx, cx - 5, cy - 5, 2, 2, d); rect(ctx, cx + 3, cy - 5, 2, 2, d);
  rect(ctx, cx - 5, cy + 3, 2, 2, d); rect(ctx, cx + 3, cy + 3, 2, 2, g);
}

const GLYPH = {
  S: ["###", "#..", "###", "..#", "###"],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
};
function glyphs(ctx, text, x, y, scale, fill) {
  [...text].forEach((ch, i) => {
    (GLYPH[ch] || []).forEach((row, ry) => [...row].forEach((c, rx) => {
      if (c === "#") rect(ctx, x + (i * 4 + rx) * scale, y + ry * scale, scale, scale, fill);
    }));
  });
}

function furnish(ctx, id) {
  const r = ROOM_RECTS[id];
  const f = interior(id);
  switch (id) {
    case "owner":
      rect(ctx, r.x + 10, r.y + 1, 20, 4, "#0A2433"); rect(ctx, r.x + 11, r.y + 2, 18, 2, "#0F3A52");   // window
      rect(ctx, r.x + 70, r.y + 1, 14, 5, "#35271C"); glyphs(ctx, "ST", r.x + 72, r.y + 2, 1, CYAN);
      palmTop(ctx, f.x + f.w - 8, f.y + f.h - 8);
      rect(ctx, f.x + 4, f.y + f.h - 12, 18, 8, "#1F3136");                                             // sofa
      break;
    case "chief":
      rect(ctx, r.x + 6, r.y + 1, 36, 5, "#071116");                                                     // status board
      break;
    case "finance":
      rect(ctx, f.x + 2, f.y + f.h - 16, 8, 14, "#56666B"); rect(ctx, f.x + 3, f.y + f.h - 12, 6, 1, "#384549");
      rect(ctx, f.x + f.w - 12, f.y + f.h - 12, 10, 10, "#232C30"); rect(ctx, f.x + f.w - 8, f.y + f.h - 8, 2, 2, CYAN);
      rect(ctx, r.x + 34, r.y + 1, 20, 5, "#DDE7E7");
      break;
    case "coaching": {
      // squat rack, barbell, dumbbells and a mat — the training floor
      rect(ctx, f.x + 4, f.y + 6, 2, 22, "#56666B"); rect(ctx, f.x + 22, f.y + 6, 2, 22, "#56666B");
      rect(ctx, f.x + 1, f.y + 14, 28, 1, "#7B8D92"); rect(ctx, f.x, f.y + 12, 2, 5, "#1D2629"); rect(ctx, f.x + 28, f.y + 12, 2, 5, "#1D2629");
      rect(ctx, f.x + 4, f.y + f.h - 8, 24, 5, "#0E3033");
      for (let i = 0; i < 4; i++) rect(ctx, f.x + 32 + i * 5, f.y + f.h - 6, 3, 2, "#1D2629");
      break;
    }
    case "atrium": {
      // the courtyard: lighter tiles, a palm in each corner, the logo set in the floor
      rect(ctx, f.x + f.w / 2 - 14, f.y + f.h / 2 - 8, 28, 16, "#0A1F21");
      glyphs(ctx, "ST", f.x + f.w / 2 - 7, f.y + f.h / 2 - 5, 2, "rgba(8,220,224,.55)");
      palmTop(ctx, f.x + 9, f.y + 9); palmTop(ctx, f.x + f.w - 9, f.y + 9);
      palmTop(ctx, f.x + 9, f.y + f.h - 9); palmTop(ctx, f.x + f.w - 9, f.y + f.h - 9);
      rect(ctx, f.x + f.w / 2 - 10, f.y + f.h - 6, 20, 3, "#35271C");
      break;
    }
    case "ops":
      for (let i = 0; i < 3; i++) rect(ctx, f.x + f.w - 10, f.y + 3 + i * 14, 8, 12, "#0B1216");
      rect(ctx, r.x + 34, r.y + 1, 30, 5, "#061014");
      break;
    case "marketing":
      rect(ctx, r.x + 60, r.y + 1, 22, 5, "#140F18"); rect(ctx, r.x + 64, r.y + 2, 14, 2, "#E879F9");
      rect(ctx, f.x + f.w - 8, f.y + 4, 3, 3, "#1D2629"); rect(ctx, f.x + f.w - 7, f.y + 7, 1, 10, "#384549");
      break;
    case "research":
      rect(ctx, r.x + 6, r.y + 1, 30, 5, "#E8EFEF");
      rect(ctx, r.x + 8, r.y + 2, 3, 2, AMBER); rect(ctx, r.x + 13, r.y + 2, 3, 2, CYAN); rect(ctx, r.x + 18, r.y + 2, 3, 2, "#FB7185");
      rect(ctx, f.x + f.w - 8, f.y + 2, 6, 24, "#35271C");
      break;
    case "front":
      rect(ctx, f.x + 4, f.y + 18, f.w - 8, 5, "#3A4E54");
      rect(ctx, f.x + 4, f.y + 18, f.w - 8, 1, "#4E666C");
      rect(ctx, f.x + 4, f.y + 23, f.w - 8, 1, CYAN);
      rect(ctx, f.x + f.w - 14, f.y + f.h - 3, 12, 3, "#0E3033");                                        // welcome mat
      break;
    default:
      break;
  }
}

// The whole building, everything that doesn't move. Drawn once into an
// offscreen canvas; the animation paints people and lights over it each frame.
// `roomStates[id]` is "on" | "training" | "open" and colours the door light;
// `seats` are hqOrg.js SEATS.
export function drawStatic(ctx, { seats, roomStates = {} }) {
  rect(ctx, 0, 0, MAP_W, MAP_H, "#020405");
  // the street out front
  rect(ctx, 0, 212, MAP_W, 8, "#101719");
  rect(ctx, 0, 220, MAP_W, 1, "#1E2A2D");
  rect(ctx, 0, 221, MAP_W, 19, "#07090A");
  for (let x = 6; x < MAP_W; x += 16) rect(ctx, x, 230, 8, 1, "rgba(251,191,36,.55)");
  palmTop(ctx, 18, 216); palmTop(ctx, 206, 216);
  // the van, parked by the front door
  rect(ctx, 246, 222, 34, 13, "#0D1214"); rect(ctx, 246, 222, 34, 1, "#1A2326");
  rect(ctx, 272, 224, 6, 9, "#1E3A40"); rect(ctx, 246, 228, 26, 1, CYAN);
  rect(ctx, 250, 221, 5, 1, "#050505"); rect(ctx, 268, 221, 5, 1, "#050505");
  rect(ctx, 250, 235, 5, 1, "#050505"); rect(ctx, 268, 235, 5, 1, "#050505");
  // the building slab and its hallways
  rect(ctx, 2, 2, 316, 210, "#1B2A2E");
  for (const h of HALLS) rect(ctx, h.x, h.y, h.w, h.h, "#0B1416");
  for (let x = 12; x < 308; x += 10) { rect(ctx, x, H1_Y, 4, 1, "#0B4F51"); rect(ctx, x, H2_Y, 4, 1, "#0B4F51"); }
  for (let y = 12; y < 206; y += 10) for (const vx of V_XS) rect(ctx, vx, y, 1, 4, "#0B4F51");
  // front entrance to the street
  rect(ctx, 288, 208, 16, 4, "#0B1416");
  rect(ctx, 288, 208, 1, 4, CYAN); rect(ctx, 303, 208, 1, 4, CYAN);

  const byRoom = {};
  for (const s of seats) (byRoom[s.room] = byRoom[s.room] || []).push(s);

  for (const id of Object.keys(ROOM_RECTS)) {
    const r = ROOM_RECTS[id];
    const [a, b] = FLOORS[id];
    rect(ctx, r.x, r.y, r.w, r.h, a);
    for (let ty = r.y; ty < r.y + r.h; ty += 8) {
      for (let tx = r.x + (((ty - r.y) / 8) % 2) * 8; tx < r.x + r.w; tx += 16) {
        rect(ctx, tx, ty, Math.min(8, r.x + r.w - tx), Math.min(8, r.y + r.h - ty), b);
      }
    }
    // walls: a face along the top with the neon strip, thin walls elsewhere
    rect(ctx, r.x, r.y, r.w, 7, "#152326");
    rect(ctx, r.x, r.y, r.w, 1, "#2E4241");
    rect(ctx, r.x, r.y + 6, r.w, 1, "rgba(8,220,224,.75)");
    rect(ctx, r.x + 3, r.y + 7, r.w - 6, 1, "rgba(8,220,224,.14)");
    rect(ctx, r.x, r.y, 3, r.h, "#22363A");
    rect(ctx, r.x + r.w - 3, r.y, 3, r.h, "#22363A");
    rect(ctx, r.x, r.y + r.h - 3, r.w, 3, "#22363A");
    // the doorway: a gap in the wall, framed, with the department's light
    const d = r.door;
    const light = roomStates[id] === "on" ? GREEN : roomStates[id] === "training" ? AMBER : "#2E4241";
    if (d.side === "bottom") {
      rect(ctx, d.x - 6, r.y + r.h - 3, 12, 3, a);
      rect(ctx, d.x - 7, r.y + r.h - 3, 1, 3, "#0B5153"); rect(ctx, d.x + 6, r.y + r.h - 3, 1, 3, "#0B5153");
      rect(ctx, d.x + 8, r.y + r.h - 2, 2, 2, light);
    } else {
      rect(ctx, d.x - 6, r.y, 12, 7, a);
      rect(ctx, d.x - 7, r.y, 1, 7, "#0B5153"); rect(ctx, d.x + 6, r.y, 1, 7, "#0B5153");
      rect(ctx, d.x + 8, r.y + 1, 2, 2, light);
    }
    furnish(ctx, id);
    // desks, and a dim outline at every seat nobody fills yet
    (byRoom[id] || []).forEach((s, i) => {
      const spot = (SEAT_SPOTS[id] || [])[i];
      if (!spot) return;
      drawDesk(ctx, spot[0], spot[1], s.status === "you" || s.status === "on-shift" || s.status === "working",
        { counter: id === "front" });
      if (s.status === "open") drawPerson(ctx, spot[0], spot[1] + 1, null, { ghost: true });
    });
  }
}

// What moves: the crew, the server lights, the selected room's outline.
export function drawDynamic(ctx, t, { walkers = [], seats = [], selected = null, board = [] } = {}) {
  // server lights blink out of step with each other
  const ops = interior("ops");
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      const on = Math.floor(t / 450 + i * 3 + j * 7) % 3 !== 0;
      rect(ctx, ops.x + ops.w - 8, ops.y + 5 + i * 14 + j * 3, 1, 1, on ? (j % 2 ? GREEN : CYAN) : "#0B1216");
    }
  }
  // the Chief of Staff's board lights one bar per department
  const cr = ROOM_RECTS.chief;
  board.forEach((state, i) => {
    const color = state === "on" ? GREEN : state === "training" ? AMBER : "#18282C";
    rect(ctx, cr.x + 8 + i * 5, cr.y + 2, 3, state === "open" ? 1 : 3, color);
  });
  // the owner, at their desk
  const owner = seats.find((s) => s.status === "you");
  if (owner) {
    const [ox, oy] = SEAT_SPOTS.owner[0];
    drawPerson(ctx, ox, oy, lookFor(owner), { seated: true });
  }
  // walkers, back to front
  const byId = Object.fromEntries(seats.map((s) => [s.id, s]));
  [...walkers].sort((p, q) => p.y - q.y).forEach((w) => {
    const seat = byId[w.id] || { id: w.id, role: "worker" };
    const seated = w.mode === "sit";
    drawPerson(ctx, w.x, w.y, lookFor(seat), { seated, frame: Math.floor(w.walked / 3) % 2 });
  });
  // the selected room, outlined
  if (selected && ROOM_RECTS[selected]) {
    const r = ROOM_RECTS[selected];
    const a = 0.55 + 0.3 * Math.sin(t / 380);
    ctx.fillStyle = `rgba(8,220,224,${a.toFixed(3)})`;
    ctx.fillRect(r.x, r.y, r.w, 1); ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1);
    ctx.fillRect(r.x, r.y, 1, r.h); ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
  }
}
