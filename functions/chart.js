// Glidna — chart images for the connector (S183).
//
// When someone asks their own Claude/ChatGPT "how's my weight going?", a wall
// of numbers is the worst answer we can give: the whole point of a trend is
// that you SEE it. This renders the answer as a PNG the assistant can show
// inline.
//
// ── WHY THIS IS HAND-ROLLED ────────────────────────────────────────────────
// The obvious move is @resvg/resvg-js — we already use it for the OG cards in
// api/. But that is a NATIVE binary, and functions/ ships ONE bundle shared by
// every Cloud Function in the project. Adding it would grow the deployment and
// slow cold starts for aiChat, the webhook, the schedules — everything — to
// give one connector tool a nicer chart. So this draws into a pixel buffer and
// encodes the PNG with Node's built-in zlib: no dependency, nothing else pays.
//
// The font is a 5x7 bitmap covering the characters charts actually need
// (digits, uppercase, a few symbols). Text is scaled by whole pixels, so it
// stays crisp rather than blurry at any size.

const zlib = require("zlib");

// ── palette: the Glidna look, so a chart in someone's Claude reads as ours ──
const C = {
  bg: [13, 20, 22, 255],
  grid: [34, 48, 52, 255],
  axis: [58, 82, 80, 255],
  ink: [234, 252, 252, 255],
  muted: [126, 154, 154, 255],
  line: [8, 220, 224, 255],      // brand cyan
  goal: [251, 191, 36, 255],     // amber
  band: [8, 220, 224, 38],       // goal range, translucent
  over: [248, 113, 113, 255],
  under: [47, 224, 168, 255],
};

// ── 5x7 font, one byte per column, bit N = row N ────────────────────────────
const FONT = {
  "0": [0x3e, 0x51, 0x49, 0x45, 0x3e], "1": [0x00, 0x42, 0x7f, 0x40, 0x00],
  "2": [0x42, 0x61, 0x51, 0x49, 0x46], "3": [0x21, 0x41, 0x45, 0x4b, 0x31],
  "4": [0x18, 0x14, 0x12, 0x7f, 0x10], "5": [0x27, 0x45, 0x45, 0x45, 0x39],
  "6": [0x3c, 0x4a, 0x49, 0x49, 0x30], "7": [0x01, 0x71, 0x09, 0x05, 0x03],
  "8": [0x36, 0x49, 0x49, 0x49, 0x36], "9": [0x06, 0x49, 0x49, 0x29, 0x1e],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e], B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22], D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41], F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x49, 0x7a], H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  I: [0x00, 0x41, 0x7f, 0x41, 0x00], J: [0x20, 0x40, 0x41, 0x3f, 0x01],
  K: [0x7f, 0x08, 0x14, 0x22, 0x41], L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x0c, 0x02, 0x7f], N: [0x7f, 0x04, 0x08, 0x10, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e], P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  Q: [0x3e, 0x41, 0x51, 0x21, 0x5e], R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x46, 0x49, 0x49, 0x49, 0x31], T: [0x01, 0x01, 0x7f, 0x01, 0x01],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f], V: [0x1f, 0x20, 0x40, 0x20, 0x1f],
  W: [0x3f, 0x40, 0x38, 0x40, 0x3f], X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07], Z: [0x61, 0x51, 0x49, 0x45, 0x43],
  " ": [0, 0, 0, 0, 0], ".": [0x00, 0x00, 0x60, 0x00, 0x00],
  "-": [0x08, 0x08, 0x08, 0x08, 0x08], "/": [0x20, 0x10, 0x08, 0x04, 0x02],
  ":": [0x00, 0x36, 0x36, 0x00, 0x00], "%": [0x23, 0x13, 0x08, 0x64, 0x62],
  "+": [0x08, 0x08, 0x3e, 0x08, 0x08], ",": [0x00, 0x50, 0x30, 0x00, 0x00],
  "(": [0x00, 0x1c, 0x22, 0x41, 0x00], ")": [0x00, 0x41, 0x22, 0x1c, 0x00],
};

class Canvas {
  constructor(w, h, bg) {
    this.w = w; this.h = h;
    this.buf = Buffer.alloc(w * h * 4);
    if (bg) this.fill(0, 0, w, h, bg);
  }
  // Alpha-composites, so translucent fills (the goal band) work over the grid.
  px(x, y, c) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const a = (c[3] === undefined ? 255 : c[3]) / 255;
    if (a >= 1) {
      this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2]; this.buf[i + 3] = 255;
      return;
    }
    this.buf[i] = Math.round(c[0] * a + this.buf[i] * (1 - a));
    this.buf[i + 1] = Math.round(c[1] * a + this.buf[i + 1] * (1 - a));
    this.buf[i + 2] = Math.round(c[2] * a + this.buf[i + 2] * (1 - a));
    this.buf[i + 3] = 255;
  }
  fill(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, c);
  }
  line(x0, y0, x1, y1, c, weight = 1) {
    // Bresenham, thickened by stamping a small square at each step. Plenty for
    // a chart at this size, and far less code than proper antialiasing.
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    const o = Math.floor(weight / 2);
    for (;;) {
      for (let a = 0; a < weight; a++) for (let b = 0; b < weight; b++) this.px(x0 + a - o, y0 + b - o, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }
  dashedH(y, x0, x1, c, on = 6, off = 5) {
    for (let x = x0; x < x1; x += on + off) this.fill(x, y, Math.min(on, x1 - x), 1, c);
  }
  dot(cx, cy, r, c) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) this.px(cx + x, cy + y, c);
    }
  }
  text(str, x, y, c, scale = 2) {
    let cx = x;
    for (const ch of String(str).toUpperCase()) {
      const g = FONT[ch];
      if (!g) { cx += 6 * scale; continue; }
      for (let col = 0; col < 5; col++) {
        for (let row = 0; row < 7; row++) {
          if (g[col] & (1 << row)) {
            this.fill(cx + col * scale, y + row * scale, scale, scale, c);
          }
        }
      }
      cx += 6 * scale;
    }
    return cx - x;
  }
  textWidth(str, scale = 2) { return String(str).length * 6 * scale; }
  textRight(str, xRight, y, c, scale = 2) {
    this.text(str, xRight - this.textWidth(str, scale), y, c, scale);
  }

  toPNG() { return encodePNG(this.w, this.h, this.buf); }
}

// ── minimal PNG encoder ─────────────────────────────────────────────────────
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  // Each scanline is prefixed with filter byte 0 (None). Filtering would
  // compress better; at these sizes the file is already small.
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── shared chart furniture ──────────────────────────────────────────────────
const W = 760, H = 380;
// l is wide enough for a 4-digit calorie label plus its gap — at 62 the top
// y-label was sliced in half by the left edge.
const PAD = { l: 84, r: 22, t: 72, b: 40 };
// Axis ticks want whole numbers; a plotted VALUE wants its decimal, because
// 186.4 vs 186 is exactly the kind of movement someone is looking for.
const fmtNum = (n) => (Math.abs(n) >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
const fmtVal = (n) => String(Math.round(n * 10) / 10);

// Axis bounds a human would have picked. Scaling straight off the data gave
// labels like "3323.5" and "830.9", which look like a bug even when the chart
// is right. Snap the step to 1/2/2.5/5 x 10^k and hang the bounds off that.
function niceBounds(lo, hi, steps = 4) {
  if (!(hi > lo)) { hi = lo + 1; }
  const raw = (hi - lo) / steps;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const nlo = Math.floor(lo / step) * step;
  return { lo: nlo, hi: nlo + step * steps, step };
}
// "Aug 7" style, from a YYYY-MM-DD key. Parsed as parts rather than Date so a
// timezone can never shift the label off by a day (the S45 lesson).
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function shortDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return "";
  return `${MONTHS[Number(m[2]) - 1] || ""} ${Number(m[3])}`;
}

function frame(cv, title, subtitle) {
  cv.text(title, PAD.l, 14, C.ink, 3);
  if (subtitle) cv.text(subtitle, PAD.l, 44, C.muted, 2);
  // Mark sits top-right, level with the title — this image travels into
  // someone else's AI, so it should say whose it is. It was bottom-right and
  // collided with the last date label.
  cv.textRight("GLIDNA", W - PAD.r, 16, C.line, 2);
}

function plotBox() {
  return { x: PAD.l, y: PAD.t, w: W - PAD.l - PAD.r, h: H - PAD.t - PAD.b };
}

// y-gridlines + labels for a value range
function yAxis(cv, box, lo, hi, unit) {
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const v = lo + ((hi - lo) * i) / steps;
    const y = Math.round(box.y + box.h - (box.h * i) / steps);
    cv.fill(box.x, y, box.w, 1, C.grid);
    cv.textRight(fmtNum(v) + (unit || ""), box.x - 8, y - 7, C.muted, 2);
  }
  cv.fill(box.x, box.y, 1, box.h, C.axis);
  cv.fill(box.x, box.y + box.h, box.w, 1, C.axis);
}

/**
 * Weight over time, with the goal line and (optionally) the goal range band.
 * points: [{ date: "YYYY-MM-DD", weight: Number }] — chronological.
 */
function weightChart(points, opts = {}) {
  const cv = new Canvas(W, H, C.bg);
  const pts = (points || []).filter((p) => p && Number(p.weight) > 0);
  frame(cv, opts.title || "WEIGHT", opts.subtitle || "");
  const box = plotBox();

  if (pts.length < 2) {
    cv.fill(box.x, box.y, box.w, box.h, C.grid);
    cv.text("NOT ENOUGH WEIGH-INS YET", box.x + 20, box.y + box.h / 2 - 8, C.muted, 2);
    return cv.toPNG();
  }

  const vals = pts.map((p) => Number(p.weight));
  const marks = [opts.goal, opts.rangeLow, opts.rangeHigh].filter((v) => Number(v) > 0).map(Number);
  let lo = Math.min(...vals, ...marks), hi = Math.max(...vals, ...marks);
  // A flat line through the exact middle is more honest than a spiky one
  // filling the panel, so pad rather than auto-zooming a 1lb wobble.
  // Kept small: niceBounds rounds outward on top of this, and a generous pad
  // compounded into an 80lb window for 12lb of data.
  const padV = Math.max((hi - lo) * 0.08, 1.5);
  ({ lo, hi } = niceBounds(lo - padV, hi + padV));
  const X = (i) => box.x + (box.w * i) / (pts.length - 1);
  const Y = (v) => box.y + box.h - (box.h * (v - lo)) / (hi - lo);

  yAxis(cv, box, lo, hi, "");

  if (Number(opts.rangeLow) > 0 && Number(opts.rangeHigh) > 0) {
    const yTop = Y(Math.max(opts.rangeLow, opts.rangeHigh));
    const yBot = Y(Math.min(opts.rangeLow, opts.rangeHigh));
    cv.fill(box.x + 1, Math.round(yTop), box.w - 1, Math.max(1, Math.round(yBot - yTop)), C.band);
  }
  if (Number(opts.goal) > 0) {
    const gy = Math.round(Y(opts.goal));
    cv.dashedH(gy, box.x, box.x + box.w, C.goal);
    cv.text("GOAL " + fmtVal(opts.goal), box.x + 6, gy - 18, C.goal, 2);
  }

  for (let i = 1; i < pts.length; i++) {
    cv.line(X(i - 1), Y(vals[i - 1]), X(i), Y(vals[i]), C.line, 3);
  }
  for (let i = 0; i < pts.length; i++) cv.dot(Math.round(X(i)), Math.round(Y(vals[i])), 4, C.line);

  // Only the endpoints get value labels — labelling every point turns a long
  // series into unreadable soup.
  cv.text(fmtVal(vals[0]), X(0) + 8, Y(vals[0]) - 22, C.ink, 2);
  cv.textRight(fmtVal(vals[vals.length - 1]), X(pts.length - 1) - 6, Y(vals[vals.length - 1]) - 22, C.ink, 2);
  cv.text(shortDate(pts[0].date), box.x, box.y + box.h + 10, C.muted, 2);
  cv.textRight(shortDate(pts[pts.length - 1].date), box.x + box.w, box.y + box.h + 10, C.muted, 2);
  return cv.toPNG();
}

/**
 * Calories per day against target.
 * days: [{ date: "YYYY-MM-DD", calories: Number }] — chronological, may include
 * unlogged days (calories 0/undefined), which are drawn as gaps, not zeroes.
 */
function caloriesChart(days, opts = {}) {
  const cv = new Canvas(W, H, C.bg);
  const list = days || [];
  frame(cv, opts.title || "CALORIES", opts.subtitle || "");
  const box = plotBox();
  const logged = list.filter((d) => Number(d.calories) > 0);

  if (!logged.length) {
    cv.fill(box.x, box.y, box.w, box.h, C.grid);
    cv.text("NOTHING LOGGED IN THIS RANGE", box.x + 20, box.y + box.h / 2 - 8, C.muted, 2);
    return cv.toPNG();
  }

  const target = Number(opts.target) > 0 ? Number(opts.target) : 0;
  const { hi } = niceBounds(0, Math.max(...logged.map((d) => Number(d.calories)), target) * 1.12);
  yAxis(cv, box, 0, hi, "");

  const n = list.length;
  const slot = box.w / n;
  const bw = Math.max(3, Math.floor(slot * 0.62));
  for (let i = 0; i < n; i++) {
    const v = Number(list[i].calories) || 0;
    if (v <= 0) continue;   // unlogged: a gap, never a zero bar
    const x = Math.round(box.x + slot * i + (slot - bw) / 2);
    const h = Math.round((box.h * v) / hi);
    // Colour carries the judgement: over target is the thing worth seeing.
    const col = target && v > target * 1.05 ? C.over : target ? C.under : C.line;
    cv.fill(x, box.y + box.h - h, bw, h, col);
  }
  if (target) {
    const ty = Math.round(box.y + box.h - (box.h * target) / hi);
    cv.dashedH(ty, box.x, box.x + box.w, C.goal);
    cv.text("TARGET " + Math.round(target), box.x + 6, ty - 18, C.goal, 2);
  }
  cv.text(shortDate(list[0].date), box.x, box.y + box.h + 10, C.muted, 2);
  cv.textRight(shortDate(list[n - 1].date), box.x + box.w, box.y + box.h + 10, C.muted, 2);
  return cv.toPNG();
}

module.exports = { weightChart, caloriesChart, Canvas, encodePNG };
