"""Knitting renderer: builds fabric from stitches, not textures.

k  = knit stitch (a V of two leaf-shaped yarn legs, nesting into the row below)
p  = purl bump (a horizontal loop; garter ridges, ribbing troughs, seed stitch)
Cables place knit stitches along crossing paths over a purl ground.
yarn() draws one continuous plied strand along any path.
Stitches are <symbol>s reused with <use>, so a large swatch stays small.
"""
import math, random, zlib


def shade(hex_, k):
    h = hex_.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    f = (lambda c: c + (255 - c) * k) if k > 0 else (lambda c: c * (1 + k))
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(f(c)))) for c in (r, g, b))


def dk(col, k):
    """Darken, but less for light yarn so cream stays cream rather than grey."""
    h = col.lstrip("#")
    lum = (0.2126 * int(h[0:2], 16) + 0.7152 * int(h[2:4], 16) + 0.0722 * int(h[4:6], 16)) / 255
    return shade(col, k * (1 - 0.55 * lum))


def _leaf(x0, y0, x1, y1, w, bow):
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy) or 1
    nx, ny = -dy / L, dx / L
    mx, my = x0 + dx * .5 + nx * bow, y0 + dy * .5 + ny * bow
    a = (mx + nx * w * .62, my + ny * w * .62)
    b = (mx - nx * w * .62, my - ny * w * .62)
    return (f"M{x0:.2f} {y0:.2f}Q{a[0]:.2f} {a[1]:.2f} {x1:.2f} {y1:.2f}Q{b[0]:.2f} {b[1]:.2f} {x0:.2f} {y0:.2f}Z",
            (mx, my, nx, ny))


class Knit:
    def __init__(self, W=12.0, H=9.5, seed=3, uid="k"):
        self.W, self.H, self.uid = W, H, uid
        self.rnd = random.Random(seed)
        self.defs, self.body = [], []
        self._have = set()

    # ---- defs -------------------------------------------------------------
    def _id(self, *parts):
        return self.uid + "-" + "-".join(str(p).lstrip("#") for p in parts)

    def _grad(self, col, side):
        gid = self._id("g", side, col)
        if gid not in self._have:
            self._have.add(gid)
            x1, y1, x2, y2 = {"L": (0, 0, 1, .3), "R": (1, 0, 0, .3), "V": (0, 0, 0, 1)}[side]
            self.defs.append(
                f'<linearGradient id="{gid}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">'
                f'<stop offset="0" stop-color="{dk(col, -.2)}"/><stop offset=".42" stop-color="{shade(col, .24)}"/>'
                f'<stop offset=".62" stop-color="{col}"/><stop offset="1" stop-color="{dk(col, -.26)}"/></linearGradient>')
        return gid

    def _ksym(self, col, v):
        sid = self._id("k", col, v)
        if sid in self._have:
            return sid
        self._have.add(sid)
        rnd = random.Random(zlib.crc32(f"{col}{v}".encode()))
        W, H = self.W, self.H
        parts = []
        lean = rnd.uniform(-.05, .05) * W
        w = W * .5 * rnd.uniform(.95, 1.05)
        top = -H * 1.3
        for side, sx in (("L", -1), ("R", 1)):
            x0, x1 = sx * W * .04, sx * W * .44 + lean
            d, (mx, my, nx, ny) = _leaf(x0, 0, x1, top, w, sx * W * .05)
            parts.append(f'<path d="{d}" fill="{dk(col, -.6)}" opacity=".18" transform="translate(0 1.2)"/>')
            parts.append(f'<path d="{d}" fill="url(#{self._grad(col, side)})" stroke="{dk(col, -.26)}" stroke-width=".4"/>')
            for o in (-.17, .17):
                px, py = mx + nx * w * o, my + ny * w * o
                parts.append(f'<path d="M{x0 + (px - x0) * .25:.2f} {(py) * .25:.2f}Q{px:.2f} {py:.2f} '
                             f'{x1 + (px - x1) * .3:.2f} {top + (py - top) * .3:.2f}" fill="none" '
                             f'stroke="{dk(col, -.14)}" stroke-width=".5" opacity=".45"/>')
        self.defs.append(f'<symbol id="{sid}" overflow="visible">{"".join(parts)}</symbol>')
        return sid

    def _psym(self, col, v):
        sid = self._id("p", col, v)
        if sid in self._have:
            return sid
        self._have.add(sid)
        rnd = random.Random(zlib.crc32(f"{col}{v}p".encode()))
        W, H = self.W, self.H
        bow = H * .14 * (1 if v % 2 else -1)
        d, _ = _leaf(-W * .6, 0, W * .6, rnd.uniform(-.4, .4), H * 1.05, bow)
        self.defs.append(
            f'<symbol id="{sid}" overflow="visible"><path d="{d}" fill="{dk(col, -.6)}" opacity=".18" transform="translate(0 1.1)"/>'
            f'<path d="{d}" fill="url(#{self._grad(col, "V")})" stroke="{dk(col, -.26)}" stroke-width=".4"/></symbol>')
        return sid

    # ---- fabric -----------------------------------------------------------
    def fabric(self, grid, x=0.0, y=0.0, edge=True):
        """grid: rows TOP first; cell = colour (knit) or (colour, 'p') for purl."""
        W, H, rnd = self.W, self.H, self.rnd
        rows, cols = len(grid), len(grid[0])
        cell = lambda v: (v, "k") if isinstance(v, str) else v
        # what shows between loops: the fabric's own shadowed depth
        for r in range(rows):
            c = 0
            while c < cols:
                col, kind = cell(grid[r][c])
                e = c
                while e + 1 < cols and cell(grid[r][e + 1]) == (col, kind):
                    e += 1
                self.body.append(f'<rect x="{x + c * W - .2:.2f}" y="{y + r * H:.2f}" width="{(e - c + 1) * W + .4:.2f}" '
                                 f'height="{H * 1.32:.2f}" fill="{dk(col, -.3 if kind == "k" else -.2)}"/>')
                c = e + 1
        for r in range(rows - 1, -1, -1):
            for c in range(cols):
                col, kind = cell(grid[r][c])
                v = rnd.randrange(3)
                if kind == "k":
                    cx = x + c * W + W / 2 + rnd.uniform(-.3, .3)
                    yb = y + (r + 1) * H + H * .25 + rnd.uniform(-.25, .25)
                    self.body.append(f'<use href="#{self._ksym(col, v)}" x="{cx:.1f}" y="{yb:.1f}"/>')
                else:
                    cx = x + c * W + W / 2 + rnd.uniform(-.3, .3)
                    yc = y + r * H + H * .78 + rnd.uniform(-.25, .25)
                    self.body.append(f'<use href="#{self._psym(col, r + c)}" x="{cx:.1f}" y="{yc:.1f}"/>')
        if edge:  # bind-off chain over the top row
            for c in range(cols):
                col = cell(grid[0][c])[0]
                d, _ = _leaf(x + c * W - W * .1, y + H * .18, x + c * W + W * 1.1, y + H * .18, H * .6, 0)
                self.body.append(f'<path d="{d}" fill="url(#{self._grad(col, "V")})" stroke="{dk(col, -.36)}" stroke-width=".45"/>')
        return cols * W, rows * H + H * .35

    def cable(self, x, y, rows, col, ground, period=10):
        """Rope cable: two strands, each 2 knit stitches wide, crossing every `period` rows over
        reverse stockinette. The front strand casts a shadow on the one it crosses."""
        W, H = self.W, self.H
        gcols = 8
        self.fabric([[(ground, "p")] * gcols for _ in range(rows)], x, y, edge=False)
        cx0 = x + gcols * W / 2
        amp = W * 1.05
        items = []
        for r in range(rows):
            ph = math.pi * r / period
            for s_ in (0, 1):
                off = amp * math.cos(ph + s_ * math.pi)
                depth = math.sin(ph + s_ * math.pi)
                slope = -amp * math.sin(ph + s_ * math.pi) * math.pi / period / H
                items.append((depth, r, s_, off, slope))
        items.sort()
        for depth, r, s_, off, slope in items:
            yb = y + (rows - r) * H + H * .25
            ang = math.degrees(math.atan(slope)) * .8
            cx = cx0 + off
            if depth > 0:
                self.body.append(f'<ellipse cx="{cx + 2:.1f}" cy="{yb - H * .5:.1f}" rx="{W * 1.35:.1f}" ry="{H * .9:.1f}" '
                                 f'fill="#1d2a3a" opacity=".06"/>')
            for j in (-.5, .5):
                self.body.append(f'<use href="#{self._ksym(col, (r + int(j * 2)) % 3)}" '
                                 f'transform="translate({cx + j * W * .98:.1f} {yb:.1f}) rotate({ang:.1f})"/>')
        return gcols * W, rows * H

    def yarn(self, d, col, w=7.0, tail=False):
        """One continuous plied strand along path d."""
        self.body.append(
            f'<g fill="none" stroke-linecap="round" stroke-linejoin="round">'
            f'<path d="{d}" stroke="{dk(col, -.6)}" stroke-width="{w + 1.6:.1f}" opacity=".35" transform="translate(0 1.6)"/>'
            f'<path d="{d}" stroke="{dk(col, -.38)}" stroke-width="{w + 1:.1f}"/>'
            f'<path d="{d}" stroke="{col}" stroke-width="{w:.1f}"/>'
            f'<path d="{d}" stroke="{dk(col, -.32)}" stroke-width="{w * .95:.1f}" stroke-dasharray="{w * .38:.2f} {w * .38:.2f}" opacity=".6"/>'
            f'<path d="{d}" stroke="{dk(col, -.32)}" stroke-width="{w * .5:.1f}" stroke-dasharray="{w * .38:.2f} {w * .38:.2f}" stroke-dashoffset="{w * .19:.2f}" opacity=".45" transform="translate({w * .12:.2f} {-w * .12:.2f})"/>'
            f'<path d="{d}" stroke="{shade(col, .22)}" stroke-width="{w * .3:.1f}" stroke-dasharray="{w * .38:.2f} {w * .38:.2f}" stroke-dashoffset="{w * .38:.2f}" opacity=".5" transform="translate({-w * .12:.2f} {w * .1:.2f})"/>'
            f'<path d="{d}" stroke="{shade(col, .3)}" stroke-width="{w * .22:.1f}" opacity=".75" transform="translate({-w * .12:.2f} {-w * .16:.2f})"/>'
            f'</g>')

    def ball(self, cx, cy, r, col, seed=1):
        rnd = random.Random(seed)
        cid, gid = self._id("clip", int(cx), int(cy)), self._id("sph", int(cx), int(cy))
        self.defs.append(f'<clipPath id="{cid}"><circle cx="{cx}" cy="{cy}" r="{r}"/></clipPath>'
                         f'<radialGradient id="{gid}" cx=".38" cy=".34" r=".75"><stop offset="0" stop-color="#ffffff" stop-opacity=".18"/>'
                         f'<stop offset=".6" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity=".42"/></radialGradient>')
        self.body.append(f'<ellipse cx="{cx + r * .1:.1f}" cy="{cy + r * .95:.1f}" rx="{r * .9:.1f}" ry="{r * .16:.1f}" fill="#000" opacity=".16"/>'
                         f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{dk(col, -.4)}"/><g clip-path="url(#{cid})">')
        w = max(2.6, r * .12)
        for i in range(22):
            a = rnd.uniform(0, 180)
            ry = r * rnd.uniform(.15, .98)
            d = f"M{cx - r:.1f} {cy:.1f}A{r:.1f} {ry:.1f} 0 0 0 {cx + r:.1f} {cy:.1f}"
            self.body.append(f'<g transform="rotate({a:.1f} {cx} {cy})">')
            self.yarn(d, col, w)
            self.body.append('</g>')
        self.body.append(f'</g><circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#{gid})"/>')

    def svg(self, w, h, bg=None, scale=1.0):
        b = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" width="{w * scale:.0f}" height="{h * scale:.0f}">'
                f'<defs>{"".join(self.defs)}</defs>{b}{"".join(self.body)}</svg>\n')


def pixels(art, palette):
    """Turn a list of strings into a colour grid via a char→colour (or (colour,'p')) map."""
    return [[palette[ch] for ch in row] for row in art]
