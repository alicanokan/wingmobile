"""Cut a single feather out of a photo -> upright RGBA PNG on black, plus thumbnail.
usage: python3 -I cutout.py spec.json OUTDIR DATASET_ROOT [only_id]

DATASET_ROOT holds  feathersv1/<image>.jpg  and  kaggle/Feather_Dataset/<image>.jpeg
(download them yourself; see README.md). Writes OUTDIR/full/<id>.png and
OUTDIR/thumbs/<id>.png. Needs Pillow, numpy, scipy and opencv-python."""
import sys, json, os, math
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

TARGET_H, THUMB_H = 900, 150

def otsu(v):
    hist, edges = np.histogram(v, bins=256)
    p = hist / hist.sum(); w = np.cumsum(p); mu = np.cumsum(p * edges[:-1])
    mt = mu[-1]; sb = (mt * w - mu) ** 2 / (w * (1 - w) + 1e-12)
    return edges[np.nanargmax(sb)]

def atlas_box(a, pick, margin=0.012):
    """Feather Atlas scans show a row of feathers on a plain (black or blue) ground
    with a thin grid and labels. Find the feathers as tall blobs (the grid and text
    vanish under an opening) and return the box of the pick-th one from the left."""
    H, W, _ = a.shape
    border = np.concatenate([a[:3].reshape(-1, 3), a[-3:].reshape(-1, 3), a[:, :3].reshape(-1, 3), a[:, -3:].reshape(-1, 3)])
    bgc = np.median(border, 0)
    dist = np.sqrt(((a - bgc) ** 2).sum(-1))
    fg = ndi.binary_opening(dist > 25, structure=np.ones((5, 5)))
    # erase the chart grid (thin full-length lines) outside the feathers, so GrabCut
    # never sees it touching a vane: a grid row/column is mostly "not background"
    # even after removing the feather blobs from the count.
    near = ndi.binary_dilation(fg, iterations=2)
    lineish = (dist > 12) & ~near
    rows = lineish.mean(1) > 0.25
    cols = lineish.mean(0) > 0.25
    rows = ndi.binary_dilation(rows, iterations=1); cols = ndi.binary_dilation(cols, iterations=1)
    grid = (rows[:, None] | cols[None, :]) & ~ndi.binary_dilation(fg, iterations=1)
    a[grid] = bgc
    lab, n = ndi.label(fg)
    blobs = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        h = sl[0].stop - sl[0].start
        if h > H * 0.25: blobs.append(((sl[1].start + sl[1].stop) / 2, sl))
    blobs.sort(key=lambda b: b[0])
    if pick >= len(blobs): raise SystemExit(f"only {len(blobs)} feathers found, pick={pick}")
    sl = blobs[pick][1]
    return [max(0, sl[1].start / W - margin), max(0, sl[0].start / H - margin),
            min(1, sl[1].stop / W + margin), min(1, sl[0].stop / H + margin * 2)]

def process(item, outdir):
    im = Image.open(os.path.join(ROOT, item['src'])).convert('RGB')
    s = 1600 / max(im.size)
    if s < 1: im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    H, W, _ = a.shape
    if 'pick' in item and 'box' not in item:
        item['box'] = atlas_box(a, item['pick'])
    if item.get('sheet'):  # big sheet with uneven light: local background estimate
        small = im.resize((max(1, W // 16), max(1, H // 16)), Image.BILINEAR)
        sm = np.asarray(small).astype(np.float32)
        bgs = np.stack([ndi.median_filter(sm[..., c], size=9) for c in range(3)], -1)
        bg = np.asarray(Image.fromarray(bgs.clip(0, 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)).astype(np.float32)
    else:
        border = np.concatenate([a[:4].reshape(-1, 3), a[-4:].reshape(-1, 3), a[:, :4].reshape(-1, 3), a[:, -4:].reshape(-1, 3)])
        bg = np.median(border, 0)[None, None, :]
    diff = a - bg
    # colour distance, plus extra weight for "darker than paper" (shadows are weak, feathers strong)
    dist = np.sqrt((diff ** 2).sum(-1))
    dist = ndi.gaussian_filter(dist, 1.0)
    T = item.get('t') or max(18.0, otsu(dist.ravel()) * 0.6)
    low = dist < T
    lab, n = ndi.label(low)
    edge_labels = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bgmask = np.isin(lab, edge_labels[edge_labels > 0])
    fg = ~bgmask
    fg = ndi.binary_opening(fg, iterations=1)
    if 'box' in item:
        x0, y0, x1, y1 = item['box']
        inb = np.zeros((H, W), bool); inb[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)] = True
        fg &= inb
    lab, n = ndi.label(fg)
    if n == 0: raise SystemExit(f"{item['id']}: no foreground")
    sx, sy = item.get('seed', [0.5, 0.5])
    px, py = int(sx * (W - 1)), int(sy * (H - 1))
    if lab[py, px] > 0:
        keep = lab[py, px]
    else:  # nearest labelled pixel to the seed
        d, (iy, ix) = ndi.distance_transform_edt(lab == 0, return_indices=True)
        keep = lab[iy[py, px], ix[py, px]]
    mask = ndi.binary_fill_holes(lab == keep)
    if not item.get('nogc'):
        import cv2
        cv2.setRNGSeed(0)  # GrabCut's k-means init is random; keep runs reproducible
        gc = np.full((H, W), cv2.GC_PR_BGD, np.uint8)
        gc[mask] = cv2.GC_PR_FGD
        core = ndi.binary_erosion(mask, iterations=4)
        gc[core] = cv2.GC_FGD
        gc[bgmask & ~ndi.binary_dilation(mask, iterations=6)] = cv2.GC_BGD
        if 'box' in item:
            x0, y0, x1, y1 = item['box']
            outside = np.ones((H, W), bool)
            outside[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)] = False
            gc[outside] = cv2.GC_BGD
        bgdm = np.zeros((1, 65), np.float64); fgdm = np.zeros((1, 65), np.float64)
        bgr = np.ascontiguousarray(a[..., ::-1].astype(np.uint8))
        if item.get('rect', True):
            x0, y0, x1, y1 = item.get('box', [0.03, 0.01, 0.97, 0.99])
            rect = (int(x0 * W), int(y0 * H), int((x1 - x0) * W), int((y1 - y0) * H))
            gc = np.zeros((H, W), np.uint8)
            cv2.grabCut(bgr, gc, rect, bgdm, fgdm, 6, cv2.GC_INIT_WITH_RECT)
        else:
            cv2.grabCut(bgr, gc, None, bgdm, fgdm, 5, cv2.GC_INIT_WITH_MASK)
        m2 = (gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD)
        m2 = ndi.binary_opening(m2, iterations=1)
        l2, n2 = ndi.label(m2)
        if n2:
            sizes = ndi.sum(m2, l2, range(1, n2 + 1))
            mask = ndi.binary_fill_holes(l2 == (1 + int(np.argmax(sizes))))
    # soft edge: ramp alpha over the threshold band, solid inside the eroded mask
    ramp = np.clip((dist - T * 0.5) / (T * 0.7), 0, 1)
    inner = ndi.binary_erosion(mask, iterations=2)
    outer = ndi.binary_dilation(mask, iterations=1)
    alpha = np.where(inner, 1.0, np.where(outer, np.maximum(ramp, 0.35) * mask, 0.0))
    alpha = ndi.gaussian_filter(alpha, 0.8) * outer
    # upright: principal axis vertical, narrow (quill) end at the bottom
    ys, xs = np.nonzero(mask)
    cx, cy = xs.mean(), ys.mean()
    cov = np.cov(np.stack([xs - cx, ys - cy]))
    ev, evec = np.linalg.eigh(cov)
    vx, vy = evec[:, 1]
    ang = math.degrees(math.atan2(vx, vy))  # angle of major axis from vertical
    while ang > 90: ang -= 180
    while ang < -90: ang += 180
    rgba = np.dstack([a * alpha[..., None], alpha * 255]).clip(0, 255).astype(np.uint8)
    out = Image.fromarray(rgba, 'RGBA')
    if abs(ang) > 2 and not item.get('norotate'):
        out = out.rotate(-ang, resample=Image.BICUBIC, expand=True)
    bb = out.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    out = out.crop(bb)
    al = np.asarray(out.getchannel('A')) > 24
    h = al.shape[0]; k = max(1, h // 7)
    top_w, bot_w = al[:k].sum(1).mean(), al[-k:].sum(1).mean()
    flip = item.get('flip')
    if flip is None: flip = top_w < bot_w * 0.8  # quill on top -> turn it over
    if flip: out = out.rotate(180)
    m = round(out.height * 0.02)
    canvas = Image.new('RGBA', (out.width + 2 * m, out.height + 2 * m), (0, 0, 0, 0))
    canvas.paste(out, (m, m))
    out = canvas
    scale = TARGET_H / out.height
    out = out.resize((max(1, round(out.width * scale)), TARGET_H), Image.LANCZOS)
    # RGB must be black wherever alpha is 0 (engine reads near-black as background)
    arr = np.asarray(out).copy(); arr[arr[..., 3] == 0, :3] = 0
    out = Image.fromarray(arr, 'RGBA')
    out.save(os.path.join(outdir, 'full', item['id'] + '.png'), optimize=True)
    th = out.resize((max(1, round(out.width * THUMB_H / out.height)), THUMB_H), Image.LANCZOS)
    th.save(os.path.join(outdir, 'thumbs', item['id'] + '.png'), optimize=True)
    print(f"{item['id']}: {out.size} upscale={scale:.2f} rot={ang:.1f} flip={flip} T={T:.0f}")

spec = json.load(open(sys.argv[1]))
ROOT = sys.argv[3]
only = sys.argv[4] if len(sys.argv) > 4 else None
for it in spec:
    if only and it['id'] != only: continue
    process(it, sys.argv[2])
