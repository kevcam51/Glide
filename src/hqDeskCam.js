// Smooth Training HQ — the desk camera (S238b).
//
// Kevin: "when selecting to talk to them in app, can we have the visual of
// them at the desk, almost like a front camera view of them writing on the
// desk?" This draws that view: one of the crew (a white android, like the
// people on the map) behind its desk, facing you. While it is writing a reply
// its pen moves across the page and lines appear; otherwise it sits, blinks
// and sways a little.
//
// Pure, like hqPixels.js: plain rectangles, [x, y, w, h, fill], so the suite
// can check every frame stays on the canvas. Original art — nothing traced.

export const CAM_W = 160;
export const CAM_H = 96;

const C = {
  wall: "#0A1215", wallDark: "#070D10", panel: "#0E191D", neon: "#08DCE0", neonDim: "rgba(8,220,224,.35)",
  body: "#E6EEEE", bodyShade: "#B9C6C7", bodyDark: "#8C9C9D", visor: "#0B1A1E", eye: "#08DCE0",
  deskTop: "#1C2B2F", deskEdge: "#2E4241", deskFront: "#0F1A1D", paper: "#F2F5F2", ink: "#27414A",
  pen: "#FBBF24", mug: "#2FE0A8", screenBack: "#132226", leaf: "#1F8F5A", leafDark: "#166B43", pot: "#3A2A22",
};

const R = (x, y, w, h, fill) => [x, y, w, h, fill];

// How far the pen is across the page, and how many lines are written, at t ms.
export function writingState(t) {
  const stroke = 900;                        // one line across the page
  const phase = (t % stroke) / stroke;
  const lines = Math.floor(t / stroke) % 6;  // the page fills, then starts again
  return { phase, lines };
}

// Blink for 140 ms every 3.6 s; the sway is a slow, one-pixel breath.
export function blinking(t) { return t % 3600 < 140; }
export function sway(t) { return Math.round(Math.sin(t / 1400)); }

export function deskCamScene({ t = 0, writing = false, still = false } = {}) {
  const time = still ? 0 : t;
  const out = [];
  // The room behind: wall, a neon strip like every room on the map, a board.
  out.push(R(0, 0, CAM_W, CAM_H, C.wall));
  out.push(R(0, 0, CAM_W, 6, C.wallDark), R(0, 6, CAM_W, 1, C.neon), R(0, 7, CAM_W, 1, C.neonDim));
  out.push(R(10, 14, 34, 20, C.panel), R(11, 15, 32, 18, C.wallDark));
  for (let i = 0; i < 5; i++) {
    const h = 3 + ((i * 7 + Math.floor(time / 700)) % 9);
    out.push(R(14 + i * 6, 31 - h, 3, h, i % 2 ? C.neonDim : C.neon));
  }
  // A plant in the corner.
  out.push(R(132, 40, 14, 12, C.pot), R(131, 39, 16, 2, "#4A382E"));
  out.push(R(134, 26, 4, 14, C.leafDark), R(139, 22, 4, 18, C.leaf), R(129, 30, 5, 8, C.leaf), R(143, 29, 5, 9, C.leafDark));

  // The agent, seated. Everything above the desk sways with its breathing.
  const dy = still ? 0 : sway(time);
  const hx = 66, hy = 20 + dy;               // head
  out.push(R(hx + 12, hy - 5, 2, 5, C.bodyDark), R(hx + 11, hy - 7, 4, 2, C.neon)); // antenna
  out.push(R(hx, hy, 28, 22, C.body), R(hx + 1, hy + 21, 26, 2, C.bodyShade));
  out.push(R(hx + 3, hy + 7, 22, 7, C.visor));
  const closed = !still && blinking(time);
  const eyeH = closed ? 1 : 3;
  const eyeY = hy + 9 + (closed ? 1 : 0);
  out.push(R(hx + 7, eyeY, 4, eyeH, C.eye), R(hx + 17, eyeY, 4, eyeH, C.eye));
  out.push(R(hx + 10, hy + 23, 8, 3, C.bodyShade));            // neck
  const tx = 56, ty = hy + 26;                                 // torso
  out.push(R(tx, ty, 48, 30, C.body), R(tx, ty, 48, 3, C.bodyShade));
  out.push(R(tx + 21, ty + 8, 6, 3, writing ? C.neon : C.neonDim));  // chest light: bright while working

  // The desk, in front of everything behind it.
  const deskY = 66;
  out.push(R(0, deskY, CAM_W, 4, C.deskTop), R(0, deskY + 4, CAM_W, 1, C.deskEdge));
  out.push(R(0, deskY + 5, CAM_W, CAM_H - deskY - 5, C.deskFront));
  out.push(R(58, 78, 44, 11, "#162428"), R(59, 79, 42, 9, "#0B1417")); // the name plate (its words are drawn by the page)
  // The back of its screen, the page it writes on, and a mug.
  out.push(R(18, 48, 30, 18, C.screenBack), R(31, 55, 4, 4, C.neonDim), R(30, 66, 6, 1, C.deskEdge));
  out.push(R(70, 62, 26, 7, C.paper));
  const { phase, lines } = writing && !still ? writingState(time) : { phase: 0, lines: 2 };
  for (let i = 0; i < lines && i < 3; i++) out.push(R(72, 63 + i * 2, 20, 1, C.ink));
  const partial = Math.round(20 * phase);
  if (writing && !still && lines < 3 && partial > 0) out.push(R(72, 63 + lines * 2, partial, 1, C.ink));
  out.push(R(120, 58, 8, 8, C.mug), R(128, 60, 2, 4, C.mug));

  // Arms: the left rests on the desk; the right holds the pen, which moves
  // across the page while it writes.
  out.push(R(tx - 6, ty + 6, 8, 12, C.bodyShade), R(tx - 4, deskY - 4, 12, 4, C.body));
  const penX = writing && !still ? 72 + Math.round(18 * phase) : 90;
  const penY = writing && !still ? 60 + (Math.floor(time / 90) % 2) : 60;
  out.push(R(tx + 46, ty + 6, 8, 12, C.bodyShade));
  out.push(R(Math.min(penX + 2, tx + 50), penY, Math.max(4, tx + 54 - (penX + 2)), 4, C.body));
  out.push(R(penX, penY - 3, 2, 6, C.pen));
  return out;
}
