// Smooth Training HQ — the pixel art (S238).
//
// Everything here is drawn from scratch as rectangles on a small grid, so the
// look is ours: a cutaway of a Miami gym building at night, each room one
// department, every worker in a black Smooth Training staff tee with the cyan
// logo. (The reel that inspired this uses StarNet's art, whose name, sprites
// and artwork belong to its author and are NOT licensed with its code — so
// nothing here is traced from it.)
//
// A drawing is a list of [x, y, w, h, fill, className?] rectangles on a room
// canvas of W × H units. The HQ screen renders them into one crisp-edged SVG
// per room and scales it to the width it has, so a unit is ~3px on a phone and
// ~4px on a laptop. Pure functions only: no DOM, so the suite can run them and
// check every rectangle stays inside its canvas.

export const W = 120;
export const H = 64;
export const FLOOR_Y = 52;          // where the wall meets the floor
const DESK_Y = 43;                  // desk top
const SIT_Y = 31;                   // top of a seated worker's hair

export const P = {
  ink: "#05080A",
  baseboard: "#0B1316",
  seam: "rgba(234,252,252,.035)",
  floorA: "#1A2528", floorB: "#162023",
  rubber: "#111416", rubberLine: "#1A1F22",
  deskTop: "#34454A", deskEdge: "#415558", deskFront: "#1E2B2F", deskShade: "#26363B",
  chair: "#0A1013", chairEdge: "#233034",
  lid: "#2B3A3F", lidEdge: "#3C4E53",
  cyan: "#08DCE0", cyanDim: "#067F82", cyanDeep: "#03494B",
  amber: "#FBBF24", amberDim: "#8A6A17",
  green: "#2FE0A8", red: "#F87171", magenta: "#E879F9",
  tee: "#11181B", teeShade: "#0A0F11",
  polo: "#0AB7BB", poloShade: "#07888B",
  paper: "#DDE7E7", paperShade: "#AFC0C0",
  metal: "#56666B", metalDark: "#384549", metalLight: "#7B8D92",
  wood: "#4A3626", woodDark: "#35271C", woodLight: "#5E4631",
  pot: "#3A2E25", potRim: "#4A3A2E", leaf: "#1F8A5B", leafDark: "#166B46", trunk: "#6B4F2E",
  night: "#0A1826", nightLow: "#0F2536", tower: "#060D12",
  glass: "rgba(8,220,224,.12)",
  dim: "rgba(3,6,8,.58)",
};

export const WALLS = {
  owner: "#10202B", chief: "#141C26", finance: "#0F211D", ops: "#131A26",
  marketing: "#1E1624", research: "#1B1D17", front: "#0E1E22", coaching: "#1A1714",
};

const SKINS = ["#F1C27D", "#C68642", "#8D5524", "#E0AC69", "#A56B46"];
const HAIRS = ["#1B120C", "#0B0B0B", "#5A3A22", "#2D2D2D", "#3B2616"];

const R = (x, y, w, h, fill, cls) => (cls ? [x, y, w, h, fill, cls] : [x, y, w, h, fill]);

// Stable look per seat, so a worker keeps their face across renders.
export function lookFor(seatId) {
  let h = 0;
  for (const ch of String(seatId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { skin: SKINS[h % SKINS.length], hair: HAIRS[(h >>> 3) % HAIRS.length] };
}

// ── Building blocks ─────────────────────────────────────────────────────────

function wall(roomId) {
  const out = [R(0, 0, W, FLOOR_Y, WALLS[roomId] || WALLS.front)];
  for (let x = 15; x < W; x += 30) out.push(R(x, 0, 1, FLOOR_Y - 2, P.seam));
  out.push(R(0, FLOOR_Y - 2, W, 2, P.baseboard));
  return out;
}

function ceilingLight(lit) {
  return [R(8, 1, W - 16, 1, lit ? P.cyanDim : "#1A2629", lit ? "hq-ceiling" : undefined)];
}

function tileFloor() {
  const out = [R(0, FLOOR_Y, W, H - FLOOR_Y, P.floorA)];
  for (let row = 0; row * 4 < H - FLOOR_Y; row++) {
    const y = FLOOR_Y + row * 4;
    for (let x = (row % 2) * 8; x < W; x += 16) out.push(R(x, y, Math.min(8, W - x), Math.min(4, H - y), P.floorB));
  }
  return out;
}

function rubberFloor() {
  const out = [R(0, FLOOR_Y, W, H - FLOOR_Y, P.rubber)];
  for (let x = 10; x < W; x += 20) out.push(R(x, FLOOR_Y, 1, H - FLOOR_Y, P.rubberLine));
  out.push(R(0, FLOOR_Y + 6, W, 1, P.rubberLine));
  return out;
}

// A seated worker, facing us: 10 wide × 12 tall from the top of the hair.
export function person(x, y, look) {
  const { skin, hair, shirt = P.tee, collar = null, logo = true, glasses = false, headset = false } = look;
  const out = [
    R(x + 2, y, 6, 1, hair), R(x + 1, y + 1, 8, 2, hair),
    R(x + 2, y + 2, 6, 5, skin),
    R(x + 1, y + 3, 1, 2, hair), R(x + 8, y + 3, 1, 2, hair),
    R(x + 3, y + 4, 1, 1, P.ink), R(x + 6, y + 4, 1, 1, P.ink),
    R(x + 4, y + 7, 2, 1, skin),
    R(x + 1, y + 8, 8, 4, shirt), R(x, y + 9, 1, 3, shirt), R(x + 9, y + 9, 1, 3, shirt),
  ];
  if (collar) out.push(R(x + 3, y + 8, 4, 1, collar));
  if (logo) out.push(R(x + 6, y + 9, 1, 1, P.cyan));
  if (glasses) out.push(R(x + 2, y + 4, 6, 1, "#0B0F11"), R(x + 3, y + 4, 1, 1, "#9CE8EA"), R(x + 6, y + 4, 1, 1, "#9CE8EA"));
  if (headset) out.push(R(x + 1, y, 8, 1, "#1D2629"), R(x, y + 1, 1, 4, "#1D2629"), R(x + 1, y + 5, 2, 1, "#1D2629"), R(x + 3, y + 6, 1, 1, P.cyan));
  return out;
}

function chairBack(cx) {
  return [
    R(cx - 6, 28, 12, 15, P.chair),
    R(cx - 6, 28, 12, 1, P.chairEdge), R(cx - 6, 28, 1, 15, P.chairEdge),
    R(cx + 5, 29, 1, 14, "#070B0D"),
  ];
}

function deskFront(cx, w) {
  const x = cx - Math.floor(w / 2);
  return [
    R(x, DESK_Y, w, 2, P.deskTop), R(x, DESK_Y + 2, w, 1, P.deskEdge),
    R(x + 1, DESK_Y + 3, w - 2, FLOOR_Y - DESK_Y - 3, P.deskFront),
    R(x + 1, DESK_Y + 3, 1, FLOOR_Y - DESK_Y - 3, P.deskShade),
  ];
}

function laptop(cx, open) {
  if (!open) return [R(cx - 4, DESK_Y - 1, 8, 1, P.lidEdge)];
  return [
    R(cx - 4, DESK_Y - 6, 8, 6, P.lid), R(cx - 4, DESK_Y - 6, 8, 1, P.lidEdge),
    R(cx - 1, DESK_Y - 4, 2, 2, P.cyan, "hq-logo"),
  ];
}

function inboxTray(cx) {
  return [
    R(cx + 5, DESK_Y - 3, 7, 3, P.metalDark), R(cx + 5, DESK_Y - 3, 7, 1, P.metal),
    R(cx + 6, DESK_Y - 4, 5, 1, P.paper), R(cx + 6, DESK_Y - 5, 5, 1, P.paperShade),
  ];
}

// One seat: chair, the worker (when there is one), desk and laptop. `counter`
// skips the desk because the Front Office works behind one long counter.
function seat(cx, s, { counter = false } = {}) {
  const out = [...chairBack(cx)];
  const occupied = s.status === "training" || s.status === "working" || s.status === "on-shift";
  if (occupied) {
    const look = lookFor(s.id);
    out.push(...person(cx - 5, SIT_Y, {
      ...look,
      shirt: s.role === "head" ? P.polo : P.tee,
      collar: s.role === "head" ? P.poloShade : null,
      logo: s.role !== "head",
      glasses: s.id === "bookkeeper",
      headset: s.id === "front-desk",
    }));
  }
  if (!counter) out.push(...deskFront(cx, s.role === "owner" ? 26 : s.role === "head" ? 20 : 18));
  out.push(...laptop(cx, occupied));
  if (s.status === "you") out.push(...inboxTray(cx));
  return out;
}

// ── Furniture ───────────────────────────────────────────────────────────────

function plant(x) {
  const b = FLOOR_Y;
  return [
    R(x, b - 6, 8, 1, P.potRim), R(x + 1, b - 5, 6, 5, P.pot),
    R(x + 3, b - 12, 2, 6, P.trunk),
    R(x + 2, b - 18, 4, 2, P.leaf), R(x, b - 16, 4, 2, P.leaf), R(x + 4, b - 16, 4, 2, P.leaf),
    R(x - 1, b - 14, 3, 2, P.leafDark), R(x + 6, b - 14, 3, 2, P.leafDark),
  ];
}

// A window onto Miami at night: towers with lit windows, one with a cyan crown.
function skylineWindow(x, y, w, h) {
  const out = [R(x - 1, y - 1, w + 2, h + 2, "#2A3A3D"), R(x, y, w, h, P.night), R(x, y + h - 7, w, 7, P.nightLow)];
  out.push(R(x + 3, y + 2, 1, 1, "#CFEFEF", "hq-twinkle"), R(x + 12, y + 4, 1, 1, "#CFEFEF"), R(x + w - 5, y + 2, 1, 1, "#CFEFEF", "hq-twinkle"));
  const towers = [[1, 9, 4], [6, 13, 3], [10, 16, 5], [16, 10, 4], [21, 12, 5]];
  for (const [dx, th, tw] of towers) {
    if (dx + tw > w - 1) continue;
    const tx = x + dx, ty = y + h - th;
    out.push(R(tx, ty, tw, th, P.tower));
    for (let wy = ty + 2; wy < y + h - 1; wy += 3) {
      if ((wy + dx) % 2 === 0) out.push(R(tx + 1, wy, 1, 1, P.amberDim));
      if (tw > 3 && (wy + dx) % 3 === 0) out.push(R(tx + tw - 2, wy, 1, 1, P.cyanDim));
    }
    if (th === 16) out.push(R(tx, ty - 1, tw, 1, P.cyan, "hq-crown"));
  }
  out.push(R(x + Math.floor(w / 2), y, 1, h, "#2A3A3D"));
  return out;
}

// Pixel letters for the framed logo, 3 × 5 each.
const GLYPH = {
  S: ["###", "#..", "###", "..#", "###"],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
};
function word(text, x, y, fill) {
  const out = [];
  [...text].forEach((ch, i) => {
    const g = GLYPH[ch];
    if (!g) return;
    g.forEach((row, ry) => [...row].forEach((c, rx) => { if (c === "#") out.push(R(x + i * 4 + rx, y + ry, 1, 1, fill)); }));
  });
  return out;
}

function framedLogo(x, y) {
  return [R(x, y, 15, 12, P.woodDark), R(x + 1, y + 1, 13, 10, P.ink), ...word("ST", x + 4, y + 4, P.cyan)];
}

function controlBoard(x, y, w, h, lights) {
  const out = [R(x - 1, y - 1, w + 2, h + 2, P.metalDark), R(x, y, w, h, "#071116")];
  lights.forEach((state, i) => {
    const by = y + 2 + i * 3;
    if (by + 2 > y + h) return;
    const len = state === "open" ? 6 : Math.floor(w * 0.6);
    out.push(R(x + 2, by, 2, 2, state === "open" ? "#233034" : state === "training" ? P.amber : P.cyan));
    out.push(R(x + 6, by, len, 2, state === "open" ? "#16242A" : state === "training" ? P.amberDim : P.cyanDim));
  });
  return out;
}

function wallChart(x, y) {
  const out = [R(x, y, 26, 15, P.metalDark), R(x + 1, y + 1, 24, 13, P.paper)];
  const pts = [[2, 10], [6, 9], [10, 10], [14, 7], [18, 6], [22, 3]];
  pts.forEach(([px, py], i) => {
    out.push(R(x + 1 + px, y + 1 + py, 2, 1, "#16946C"));
    if (i && pts[i - 1][1] !== py) {
      const top = Math.min(py, pts[i - 1][1]);
      out.push(R(x + 1 + px, y + 1 + top, 1, Math.abs(py - pts[i - 1][1]) + 1, "#16946C"));
    }
  });
  return out;
}

function filingCabinet(x) {
  const out = [R(x, FLOOR_Y - 20, 10, 20, P.metal), R(x, FLOOR_Y - 20, 10, 1, P.metalLight)];
  for (let i = 0; i < 3; i++) out.push(R(x + 1, FLOOR_Y - 18 + i * 6, 8, 1, P.metalDark), R(x + 4, FLOOR_Y - 16 + i * 6, 2, 1, P.metalLight));
  return out;
}

function safeBox(x) {
  return [
    R(x, FLOOR_Y - 13, 12, 13, "#232C30"), R(x, FLOOR_Y - 13, 12, 1, P.metal),
    R(x + 2, FLOOR_Y - 11, 8, 9, "#1A2226"), R(x + 5, FLOOR_Y - 8, 2, 2, P.cyan), R(x + 9, FLOOR_Y - 7, 1, 3, P.metalLight),
  ];
}

function serverRack(x) {
  const out = [R(x, 16, 13, FLOOR_Y - 16, "#0B1216"), R(x, 16, 13, 1, P.metal), R(x, 16, 1, FLOOR_Y - 16, P.metalDark)];
  for (let i = 0; i < 8; i++) {
    const y = 19 + i * 4;
    out.push(R(x + 2, y, 9, 3, "#16242A"));
    out.push(R(x + 3, y + 1, 1, 1, i % 3 === 0 ? P.green : P.cyan, `hq-blink hq-blink-${i % 4}`));
    out.push(R(x + 5, y + 1, 5, 1, "#0B1216"));
  }
  return out;
}

function statusMonitor(x, y) {
  const out = [R(x - 1, y - 1, 50, 18, P.metalDark), R(x, y, 48, 16, "#061014")];
  for (let i = 0; i < 3; i++) {
    const ry = y + 3 + i * 4;
    out.push(R(x + 3, ry, 1, 2, P.green), R(x + 4, ry + 1, 1, 1, P.green), R(x + 5, ry - 1, 1, 2, P.green));
    out.push(R(x + 9, ry, 18 + i * 6, 1, "#1E3A40"));
  }
  return out;
}

function neonDumbbell(x, y) {
  const out = [R(x, y, 26, 16, "#140F18"), R(x, y, 26, 1, "#2A2230")];
  const c = P.magenta;
  out.push(R(x + 4, y + 5, 2, 6, c, "hq-neon"), R(x + 6, y + 4, 2, 8, c, "hq-neon"), R(x + 8, y + 7, 10, 2, c, "hq-neon"),
    R(x + 18, y + 4, 2, 8, c, "hq-neon"), R(x + 20, y + 5, 2, 6, c, "hq-neon"));
  return out;
}

function cameraRig(x) {
  return [
    R(x + 4, FLOOR_Y - 14, 1, 14, P.metalDark), R(x, FLOOR_Y - 1, 9, 1, P.metalDark),
    R(x + 1, FLOOR_Y - 20, 8, 6, "#0B0F11"), R(x + 1, FLOOR_Y - 20, 8, 1, P.metal),
    R(x - 1, FLOOR_Y - 18, 3, 3, "#1D2629"), R(x + 7, FLOOR_Y - 19, 1, 1, P.red, "hq-blink hq-blink-1"),
  ];
}

function whiteboard(x, y) {
  const out = [R(x, y, 36, 18, P.metalLight), R(x + 1, y + 1, 34, 16, "#E8EFEF")];
  const notes = [[3, 3, P.amber], [9, 3, "#FB7185"], [15, 4, P.cyan], [4, 10, P.cyan], [11, 10, P.amber]];
  for (const [nx, ny, c] of notes) out.push(R(x + nx, y + ny, 4, 4, c));
  out.push(R(x + 22, y + 4, 10, 1, "#7E9A9A"), R(x + 22, y + 7, 8, 1, "#7E9A9A"), R(x + 22, y + 10, 10, 1, "#7E9A9A"), R(x + 22, y + 13, 6, 1, "#7E9A9A"));
  return out;
}

function bookshelf(x) {
  const out = [R(x, 18, 13, FLOOR_Y - 18, P.woodDark)];
  const spines = ["#0AB7BB", "#FBBF24", "#E8EFEF", "#FB7185", "#7B8D92"];
  for (let s = 0; s < 4; s++) {
    const sy = 20 + s * 8;
    out.push(R(x + 1, sy + 6, 11, 1, P.woodLight));
    for (let b = 0; b < 5; b++) out.push(R(x + 1 + b * 2, sy + (b % 2), 2, 6 - (b % 2), spines[(b + s) % spines.length]));
  }
  return out;
}

function glassDoor(x) {
  return [
    R(x, 16, 16, FLOOR_Y - 16, P.metalDark), R(x + 1, 17, 14, FLOOR_Y - 17, P.glass),
    R(x + 8, 17, 1, FLOOR_Y - 17, P.metalDark), R(x + 6, 33, 1, 5, P.metalLight), R(x + 10, 33, 1, 5, P.metalLight),
    R(x + 3, 20, 10, 4, "#062A2C"), R(x + 4, 21, 8, 2, P.cyan, "hq-neon"),
  ];
}

function waitingChair(x) {
  return [R(x, FLOOR_Y - 10, 2, 10, P.metalDark), R(x, FLOOR_Y - 5, 9, 2, "#1F3136"), R(x + 7, FLOOR_Y - 3, 1, 3, P.metalDark), R(x + 1, FLOOR_Y - 3, 1, 3, P.metalDark)];
}

function receptionCounter(x0, x1) {
  const w = x1 - x0;
  return [
    R(x0, DESK_Y, w, 2, P.deskTop), R(x0, DESK_Y + 2, w, 1, P.deskEdge),
    R(x0, DESK_Y + 3, w, FLOOR_Y - DESK_Y - 3, P.deskFront),
    R(x0, DESK_Y + 5, w, 1, P.cyan, "hq-stripe"),
  ];
}

function squatRack(x) {
  return [
    R(x, 16, 2, FLOOR_Y - 16, P.metal), R(x + 16, 16, 2, FLOOR_Y - 16, P.metal), R(x, 16, 18, 2, P.metal),
    R(x - 3, 26, 24, 1, P.metalLight), R(x - 4, 23, 2, 7, "#1D2629"), R(x + 20, 23, 2, 7, "#1D2629"),
    R(x - 2, FLOOR_Y - 1, 22, 1, P.metalDark),
  ];
}

function dumbbellRack(x) {
  const out = [R(x, FLOOR_Y - 8, 18, 2, P.metal), R(x + 1, FLOOR_Y - 6, 1, 6, P.metalDark), R(x + 16, FLOOR_Y - 6, 1, 6, P.metalDark)];
  for (let i = 0; i < 3; i++) out.push(R(x + 1 + i * 6, FLOOR_Y - 11, 2, 3, "#1D2629"), R(x + 3 + i * 6, FLOOR_Y - 10, 1, 1, P.metalLight), R(x + 4 + i * 6, FLOOR_Y - 11, 2, 3, "#1D2629"));
  return out;
}

function bench(x) {
  return [R(x, FLOOR_Y - 7, 14, 2, "#1F2A2E"), R(x, FLOOR_Y - 8, 14, 1, P.cyanDeep), R(x + 2, FLOOR_Y - 5, 1, 5, P.metalDark), R(x + 11, FLOOR_Y - 5, 1, 5, P.metalDark)];
}

// ── Rooms ───────────────────────────────────────────────────────────────────

// Where each room's seats sit, left to right, in the order SEATS lists them.
const SEAT_X = {
  owner: [62],
  chief: [82],
  finance: [32, 59, 86],
  ops: [34, 61, 88],
  marketing: [25, 55, 85],
  research: [53, 74, 94],
  front: [44, 65, 86, 107],
  coaching: [71, 90, 109],
};

export function seatCenters(roomId, count) {
  const xs = SEAT_X[roomId] || [];
  return xs.slice(0, count);
}

// `boardLights` feeds the Chief of Staff's wall board: one bar per department,
// lit by that department's state, so the board says what the building says.
export function roomScene(roomId, seats, { lit = true, boardLights = [] } = {}) {
  const xs = seatCenters(roomId, seats.length);
  const out = [...wall(roomId), ...ceilingLight(lit)];
  const floor = roomId === "coaching" ? rubberFloor() : tileFloor();

  switch (roomId) {
    case "owner":
      out.push(...skylineWindow(6, 16, 30, 18), ...framedLogo(88, 16), ...plant(108));
      break;
    case "chief":
      out.push(...controlBoard(6, 15, 42, 20, boardLights), ...plant(106));
      break;
    case "finance":
      out.push(...wallChart(46, 15), ...filingCabinet(4), ...safeBox(105));
      break;
    case "ops":
      out.push(...serverRack(4), ...statusMonitor(64, 14));
      break;
    case "marketing":
      out.push(...neonDumbbell(88, 15), ...cameraRig(104));
      break;
    case "research":
      out.push(...whiteboard(4, 16), ...bookshelf(106));
      break;
    case "front":
      out.push(...glassDoor(3), ...waitingChair(21));
      break;
    case "coaching":
      out.push(...squatRack(5), ...dumbbellRack(26), ...bench(45));
      break;
    default:
      break;
  }
  out.push(...floor);

  if (roomId === "front") {
    seats.forEach((s, i) => out.push(...seat(xs[i], s, { counter: true })));
    out.push(...receptionCounter(34, 118));
  } else {
    seats.forEach((s, i) => out.push(...seat(xs[i], s)));
  }

  if (!lit) out.push(R(0, 0, W, H, P.dim));
  return out;
}

// ── Outside ─────────────────────────────────────────────────────────────────

// A palm tree, 24 × 44.
export const PALM_W = 24, PALM_H = 44;
export function palmTree() {
  const out = [];
  const trunk = [[11, 43], [11, 40], [11, 37], [12, 34], [12, 31], [12, 28], [13, 25], [13, 22], [13, 19], [13, 16]];
  trunk.forEach(([x, y], i) => out.push(R(x, y - 3, 3, 3, i % 2 ? "#5E4631" : "#6B4F2E")));
  const fronds = [
    [2, 12, 10, 2, P.leafDark], [0, 14, 4, 2, P.leafDark], [4, 9, 9, 2, P.leaf],
    [13, 8, 9, 2, P.leaf], [15, 11, 8, 2, P.leafDark], [20, 13, 4, 2, P.leafDark],
    [9, 6, 6, 2, P.leaf], [11, 4, 3, 2, P.leaf], [6, 11, 3, 3, P.leaf], [16, 10, 3, 3, P.leaf],
  ];
  for (const [x, y, w, h, c] of fronds) out.push(R(x, y, w, h, c));
  out.push(R(12, 12, 2, 2, "#3B2616"), R(14, 13, 2, 2, "#3B2616"));
  return out;
}

// The Smooth Training van — it's a mobile training business, so the HQ has one
// parked out front. 44 × 20.
export const VAN_W = 44, VAN_H = 20;
export function van() {
  return [
    R(2, 4, 38, 12, "#0D1214"), R(3, 3, 30, 1, "#1A2326"), R(33, 6, 7, 10, "#0D1214"), R(33, 5, 5, 1, "#1A2326"),
    R(34, 7, 5, 4, "#1E3A40"), R(20, 6, 11, 4, "#1E3A40"), R(5, 6, 13, 4, "#1E3A40"),
    R(2, 11, 38, 1, P.cyan, "hq-stripe"),
    R(24, 12, 3, 3, P.cyan), R(25, 13, 1, 1, "#0D1214"),
    R(40, 12, 2, 3, "#1A2326"), R(41, 13, 1, 1, P.amber),
    R(6, 15, 7, 5, P.ink), R(8, 16, 3, 3, P.metal), R(29, 15, 7, 5, P.ink), R(31, 16, 3, 3, P.metal),
    R(0, 12, 2, 3, "#1A2326"), R(0, 13, 1, 1, P.red),
  ];
}
