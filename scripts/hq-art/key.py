# Chroma-key helpers: flat magenta background -> real alpha, with despill so the
# anti-aliased edge doesn't keep a pink fringe.
import numpy as np
from PIL import Image

def key_magenta(im, lo=60.0, hi=150.0):
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # How magenta a pixel is: strong red and blue, weak green.
    mag = np.minimum(r, b) - g
    # Distance from pure magenta in RGB.
    dist = np.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2)
    alpha = np.clip((dist - lo) / (hi - lo), 0, 1)
    # Pixels that aren't magenta-ish at all stay fully opaque.
    alpha = np.where(mag < 40, 1.0, alpha)
    # Despill: remove the magenta that bled into semi-transparent edge pixels.
    m = np.array([255.0, 0.0, 255.0])
    aa = alpha[..., None]
    rgb = np.where(aa > 0.02, (a - (1 - aa) * m) / np.maximum(aa, 0.02), 0)
    rgb = np.clip(rgb, 0, 255)
    # Any leftover pink cast on edge pixels: pull red/blue down toward green.
    spill = np.clip(np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1] - 30, 0, None)
    edge = (alpha < 0.98)[..., None]
    rgb = np.where(edge, rgb - spill[..., None] * np.array([1, 0, 1]), rgb)
    out = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")

def bbox_alpha(im, thresh=24):
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > thresh)
    if len(xs) == 0:
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
