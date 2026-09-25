# Split a 4x4 walk-cycle sheet into frames, align them on a shared baseline and
# pack them into one atlas: rows = down, left, right, up; cols = frames 0-3.
# Each frame's figure is the heaviest run of opaque rows/columns in its cell, so
# a sliver of a neighbour's head poking over the cell line is ignored.
import sys, json
import numpy as np
from PIL import Image
from key import key_magenta

def heaviest_run(profile, min_val):
    runs, start = [], None
    for i, v in enumerate(profile):
        if v > min_val and start is None: start = i
        if (v <= min_val or i == len(profile) - 1) and start is not None:
            end = i if v <= min_val else i + 1
            runs.append((profile[start:end].sum(), start, end)); start = None
    return max(runs)[1:] if runs else None

def figure_box(cell):
    a = np.asarray(cell)[..., 3].astype(np.float32) / 255.0
    rows = heaviest_run(a.sum(axis=1), 0.5)
    if not rows: return None
    y0, y1 = rows
    cols = heaviest_run(a[y0:y1].sum(axis=0), 0.5)
    if not cols: return None
    x0, x1 = cols
    return x0, y0, x1, y1

if __name__ == "__main__":
    src, out, target_h = sys.argv[1], sys.argv[2], int(sys.argv[3])
    im = key_magenta(Image.open(src))
    W, H = im.size
    cw, ch = W // 4, H // 4
    frames = []
    for r in range(4):
        for c in range(4):
            cell = im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            frames.append((r, c, cell, figure_box(cell)))
    boxes = [f[3] for f in frames if f[3]]
    # One height per direction: the model draws the back view a little taller
    # than the side view, and a character that shrinks when it turns reads as a
    # glitch. Each row is scaled so its median figure is target_h tall.
    row_scale = {}
    for r in range(4):
        hs = sorted(f[3][3] - f[3][1] for f in frames if f[0] == r and f[3])
        row_scale[r] = target_h / hs[len(hs) // 2]
    scale = min(row_scale.values())
    fw = int(np.ceil(max((f[3][2] - f[3][0]) * row_scale[f[0]] for f in frames if f[3]))) + 4
    fh = target_h + 4
    atlas = Image.new("RGBA", (fw * 4, fh * 4), (0, 0, 0, 0))
    for (r, c, cell, bb) in frames:
        if not bb: continue
        fig = cell.crop(bb)
        k = row_scale[r]
        nw, nh = max(1, round(fig.width * k)), max(1, min(target_h + 2, round(fig.height * k)))
        fig = fig.resize((nw, nh), Image.LANCZOS)
        atlas.alpha_composite(fig, (c * fw + (fw - nw) // 2, r * fh + (fh - 2 - nh)))
    atlas.save(out)
    meta = {"frameW": fw, "frameH": fh, "rows": ["down", "left", "right", "up"], "cols": 4, "footY": fh - 2}
    json.dump(meta, open(out.replace(".png", ".json"), "w"))
    print(json.dumps({"atlas": atlas.size, **meta, "scale": round(scale, 3),
                      "heights": [b[3] - b[1] for b in boxes]}))
