"""Knitted assets for the ten Close Knit directions → <out>/dNN-*.svg"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from knitlib import Knit, pixels, shade

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)


def save(name, k, w, h, bg=None):
    open(os.path.join(OUT, name), "w").write(k.svg(w, h, bg))


def grid(rows, cols, fill):
    return [[fill] * cols for _ in range(rows)]


def stamp(g, art, top, left, pal):
    for r, row in enumerate(art):
        for c, ch in enumerate(row):
            if ch != " " and 0 <= top + r < len(g) and 0 <= left + c < len(g[0]):
                g[top + r][left + c] = pal[ch]


def palette(name, cols, seed=1):
    k = Knit(W=10, H=8, seed=seed, uid=name[:3] + "p")
    for i, c in enumerate(cols):
        k.fabric(grid(6, 7, c), 6 + i * 84, 6)
    save(name, k, 6 + len(cols) * 84, 66)


def fabric_svg(name, g, W=12, H=9.5, seed=3, bg=None, pad=6):
    k = Knit(W=W, H=H, seed=seed, uid=name[:3])
    w, h = k.fabric(g, pad, pad)
    save(name, k, w + 2 * pad, h + 2 * pad + H * .4, bg)


HOUSE = ["...........",
         ".....R.....",
         "....RRR....",
         "...RRRRR...",
         "..RRRRRRR..",
         ".RRRRRRRRR.",
         "..MMMMMMM..",
         "..MMMIMMM..",
         "..TTTITTT..",
         "..TTTITTT..",
         "..........."]

# ---------- 01 Intarsia Town ----------
P1 = dict(snow="#eef3f8", pine="#22252c", brick="#e2453c", mustard="#f6c445", teal="#4aa3df", white="#ffffff", cobalt="#2f5bd3", pink="#f08bb0")
fabric_svg("d01-mark.svg", pixels(HOUSE, {".": P1["snow"], "R": P1["brick"], "M": P1["mustard"], "T": P1["teal"], "I": P1["pine"]}))
g = grid(22, 84, P1["snow"])
rnd = random.Random(4)
for _ in range(26):
    g[rnd.randrange(0, 9)][rnd.randrange(84)] = P1["white"]
def town_house(g, left, w, wall, roof, body, win):
    base = 19
    peak = w // 2
    for i in range(peak + 1):
        for c in range(left + peak - i, left + peak + i + 1):
            if c < left + w:
                g[base - wall - peak + i][c] = roof
    for r in range(base - wall, base):
        for c in range(left, left + w):
            g[r][c] = body
    for r in range(base - wall + 2, base - 1, 3):
        for c in range(left + 2, left + w - 2, 3):
            g[r][c] = win
    g[base - 1][left + peak] = P1["pine"]; g[base - 2][left + peak] = P1["pine"]
for left, w, wall, roof, body in ((3, 11, 6, P1["brick"], P1["mustard"]), (16, 13, 8, P1["teal"], P1["snow"]),
                                  (31, 9, 5, P1["pink"], P1["cobalt"]), (42, 15, 7, P1["brick"], P1["teal"]),
                                  (59, 11, 9, P1["cobalt"], P1["pink"]), (72, 11, 6, P1["mustard"], P1["brick"])):
    town_house(g, left, w, wall, roof, body, P1["white"] if body != P1["snow"] else P1["pine"])
for r in (19, 20, 21):
    for c in range(84):
        g[r][c] = P1["pine"] if r > 19 else P1["white"]
fabric_svg("d01-street.svg", g, W=11, H=8.7, seed=9)
bars = grid(15, 30, P1["snow"])
for i, (v, col) in enumerate([(.88, P1["teal"]), (.8, P1["teal"]), (.62, P1["mustard"]), (.46, P1["brick"])]):
    for r in range(1 + i * 4 - 1 + 1, 1 + i * 4 + 2):
        for c in range(1, 1 + round(v * 28)):
            bars[r][c] = col
fabric_svg("d01-bars.svg", bars, seed=2)
palette("d01-palette.svg", [P1["snow"], P1["pine"], P1["brick"], P1["mustard"], P1["teal"]])

def knit_bar(name, v, col, ground, cols=34, rows=3, seed=1):
    g = grid(rows, cols, ground)
    for r in range(rows):
        for c in range(round(v * cols)):
            g[r][c] = col
    fabric_svg(name, g, W=10, H=8, seed=seed, pad=3)
for v, col in ((88, P1["teal"]), (80, P1["teal"]), (62, P1["mustard"]), (46, P1["brick"])):
    knit_bar(f"d01-bar{v}.svg", v / 100, col, P1["snow"], seed=v)

# ---------- 02 One Thread ----------
P2 = dict(oat="#f7f8fa", ink="#22252c", red="#e2453c", stone="#7a7f8c")
k = Knit(uid="d02m")
k.yarn("M22 104 V58 L60 22 L98 58 V104 H40 C30 104 26 92 34 86 C44 78 54 92 46 100 C40 106 70 112 120 108", P2["red"], 8)
save("d02-mark.svg", k, 132, 124)
k = Knit(uid="d02r")
streets = "".join(f'<path d="{d}" fill="none" stroke="#d8dbe2" stroke-width="{w}" stroke-linecap="round"/>' for d, w in (
    ("M0 90 C120 80 240 110 390 96", 10), ("M0 230 C140 220 220 260 390 240", 8), ("M80 0 C90 120 70 260 100 420", 9),
    ("M300 0 C280 140 320 280 290 420", 8), ("M0 330 L390 300", 6), ("M190 0 L210 420", 5)))
k.body.append(f'<rect width="390" height="420" fill="#eef1f5"/><path d="M0 372 C120 340 250 400 390 356 L390 420 L0 420Z" fill="#d4e6f5"/>{streets}')
k.yarn("M70 316 C110 300 120 250 150 236 S230 230 240 190 S260 120 300 104 C320 96 330 88 336 76", P2["red"], 7)
k.yarn("M58 322 C46 314 52 300 64 304 C76 308 70 326 58 322 Z", P2["red"], 7)
k.ball(342, 66, 20, P2["red"], seed=3)
save("d02-route.svg", k, 390, 420)
k = Knit(uid="d02d")
k.yarn("M6 14 C60 4 90 24 150 14 S260 4 314 14", P2["red"], 5)
save("d02-divider.svg", k, 320, 28)
k = Knit(uid="d02p")
k.yarn("M8 22 C80 22 140 18 200 22", P2["red"], 6)
k.ball(222, 22, 15, P2["red"], seed=5)
k.body.append(f'<path d="M240 22 H330" stroke="#d8dbe2" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round"/>')
save("d02-progress.svg", k, 340, 46)
palette("d02-palette.svg", [P2["oat"], P2["ink"], P2["red"], P2["stone"], "#d8dbe2"])

# ---------- 03 Fair Isle Yoke ----------
P3 = dict(navy="#f4f7fa", cream="#4aa3df", red="#e2453c", gold="#f6c445", sky="#2f5bd3")
def peerie(cols, a, b, pat):
    return [[(a if pat[r][c % len(pat[r])] == "x" else b) for c in range(cols)] for r in range(len(pat))]
house_motif = ["......R......",
               ".....RRR.....",
               "....RRRRR....",
               "...RRRRRRR...",
               "..RRRRRRRRR..",
               "...CCCCCCC...",
               "...CNCCCNC...",
               "...CCCNCCC...",
               "...CCCNCCC..."]
def band(cols):
    g = []
    g += peerie(cols, P3["gold"], P3["navy"], ["x.x.", ".x.x"])
    g += [[P3["navy"]] * cols]
    g += peerie(cols, P3["cream"], P3["navy"], ["..x...", ".xxx..", "xx.xx.", ".xxx..", "..x..."])
    g += [[P3["navy"]] * cols]
    hm = [[P3["navy"]] * cols for _ in house_motif]
    for start in range(0, cols, 13):
        for r, row in enumerate(house_motif):
            for c, ch in enumerate(row):
                if start + c < cols:
                    hm[r][start + c] = {"R": P3["red"], "C": P3["cream"], "N": P3["navy"], ".": P3["navy"]}[ch]
    g += hm
    g += [[P3["navy"]] * cols]
    g += peerie(cols, P3["gold"], P3["navy"], ["x.x.", ".x.x"])
    return g
fabric_svg("d03-band.svg", band(104), W=11, H=8.7, seed=6)
mark = [[P3["navy"]] * 15 for _ in range(15)]
stamp(mark, house_motif, 3, 1, {"R": P3["red"], "C": P3["cream"], "N": P3["navy"], ".": P3["navy"]})
for c in range(15):
    mark[0][c] = P3["gold"] if c % 2 == 0 else P3["navy"]
    mark[14][c] = P3["gold"] if c % 2 == 1 else P3["navy"]
    mark[1][c] = P3["navy"]
fabric_svg("d03-mark.svg", mark, seed=8)
ch = grid(13, 28, P3["cream"])
for i, (v, col) in enumerate([(.88, P3["navy"]), (.80, P3["navy"]), (.62, P3["gold"]), (.46, P3["red"])]):
    for c in range(1, 1 + round(v * 26)):
        ch[1 + i * 3][c] = col
        ch[2 + i * 3][c] = col
fabric_svg("d03-chart.svg", ch, W=11, H=8.7, seed=12)
for v, col in ((88, P3["sky"]), (80, P3["sky"]), (62, P3["gold"]), (46, P3["red"])):
    knit_bar(f"d03-bar{v}.svg", v / 100, col, P3["navy"], seed=v + 3)
palette("d03-palette.svg", [P3["navy"], P3["cream"], P3["red"], P3["gold"], P3["sky"]])

# ---------- 04 Temperature Blanket ----------
RAMP = ["#2f5bd3", "#4aa3df", "#bfe0f2", "#f6c445", "#f28b30", "#e2453c"]
fabric_svg("d04-mark.svg", [[RAMP[min(5, r // 2)]] * 12 for r in range(12)], seed=4)
prices = [0.20, .22, .25, .27, .30, .31, .33, .34, .36, .35, .36, .38, .40, .43, .46, .48, .50, .53, .52, .49,
          .47, .46, .48, .52, .57, .61, .66, .70, .72, .71, .70, .72, .75, .78, .80, .82, .85, .88, .90, .93]
rows = []
rnd = random.Random(11)
for v in prices:
    i = min(5, int(v * 6))
    row = [RAMP[i]] * 46
    frac = v * 6 - i
    if i < 5:  # hand-knit: a few stitches of the next colour where the value sits between bands
        for c in rnd.sample(range(46), int(frac * 6)):
            row[c] = RAMP[i + 1]
    rows.append(row)
fabric_svg("d04-blanket.svg", rows[::-1], W=11, H=8.4, seed=5)
palette("d04-palette.svg", RAMP[:1] + RAMP[2:])

# ---------- 05 Aran ----------
P5 = dict(cream="#f4f6f8", ground="#cfd9e4", char="#22252c", moss="#e2453c")
k = Knit(W=13, H=10, uid="d05m")
k.cable(4, 4, 13, "#ffffff", P5["ground"], period=8)
save("d05-mark.svg", k, 8 * 13 + 8, 13 * 10 + 12)
k = Knit(W=12, H=9.5, uid="d05p", seed=2)
x = 4
seedst = lambda cols: [[("#f4f6f8" if (r + c) % 2 else ("#f4f6f8", "p")) for c in range(cols)] for r in range(86)]
w, _ = k.fabric(seedst(4), x, 4, edge=False); x += w
rib = lambda: [[("#f4f6f8" if c % 3 != 2 else ("#e2e8ef", "p")) for c in range(3)] for r in range(86)]
for i in range(3):
    w, _ = k.cable(x, 4, 86, "#ffffff", "#cdd7e2", period=9 + i); x += w
    if i < 2:
        w, _ = k.fabric(rib(), x, 4, edge=False); x += w
w, _ = k.fabric(seedst(4), x, 4, edge=False); x += w
save("d05-panel.svg", k, x + 4, 86 * 9.5 + 10)
palette("d05-palette.svg", [P5["cream"], P5["ground"], P5["char"], P5["moss"], "#9aa6b4"])

# ---------- 06 Ribbed Cuff ----------
P6 = dict(cream="#ffffff", tomato="#e2453c", butter="#f6c445", sky="#4aa3df", ink="#22252c")
rib = lambda rows, cols, col, stripe=None: [[((stripe if stripe and r in (1, 2) else col) if c % 4 < 2 else
                                             ((stripe if stripe and r in (1, 2) else col), "p")) for c in range(cols)] for r in range(rows)]
fabric_svg("d06-mark.svg", rib(9, 10, P6["tomato"], P6["butter"]), W=12, H=9.5, seed=3)
fabric_svg("d06-cuff.svg", rib(6, 36, P6["tomato"], P6["butter"]), W=11, H=8.6, seed=5)
fabric_svg("d06-tab.svg", rib(3, 8, P6["sky"]), W=9, H=7, seed=2)
palette("d06-palette.svg", [P6["cream"], P6["tomato"], P6["butter"], P6["sky"], P6["ink"]])

# ---------- 07 Yarn Ball Map ----------
P7 = dict(cream="#f7f8fa", pine="#22252c", coral="#e2453c", mustard="#f6c445", teal="#2f5bd3", plum="#f08bb0")
k = Knit(uid="d07m")
k.yarn("M70 92 C96 104 104 120 92 128 C80 136 74 120 86 116 C104 110 120 126 140 124", P7["coral"], 6)
k.ball(52, 58, 44, P7["coral"], seed=2)
save("d07-mark.svg", k, 150, 140)
k = Knit(uid="d07map")
k.body.append('<rect width="390" height="430" fill="#eef2f6"/>' + "".join(
    f'<path d="{d}" fill="none" stroke="#ffffff" stroke-width="{w}" stroke-linecap="round"/>' for d, w in (
        ("M0 110 C140 96 260 130 390 112", 12), ("M0 250 C120 240 260 280 390 256", 10), ("M110 0 C120 140 96 300 126 430", 11),
        ("M290 0 C270 150 310 300 280 430", 10), ("M0 360 L390 330", 7))) +
    '<path d="M0 396 C120 370 250 420 390 384 L390 430 L0 430Z" fill="#d4e6f5"/>')
k.yarn("M92 330 C130 320 140 270 170 250 S250 220 262 170 S280 110 300 96", P7["coral"], 5)
for (cx, cy, r, col, sd) in ((300, 92, 22, P7["coral"], 1), (170, 250, 17, P7["teal"], 2), (80, 150, 13, P7["mustard"], 3),
                             (330, 300, 12, P7["plum"], 4), (210, 360, 10, P7["teal"], 5), (92, 330, 9, P7["pine"], 6)):
    k.ball(cx, cy, r, col, seed=sd)
save("d07-map.svg", k, 390, 430)
for i, col in enumerate((P7["coral"], P7["teal"], P7["mustard"])):
    k = Knit(uid=f"d07b{i}")
    k.ball(26, 24, 20, col, seed=i + 7)
    save(f"d07-ball{i}.svg", k, 52, 52)
palette("d07-palette.svg", [P7["cream"], P7["pine"], P7["coral"], P7["mustard"], P7["teal"]])

# ---------- 08 Patchwork ----------
P8 = dict(oat="#f4f7fa", moss="#f08bb0", rust="#f28b30", denim="#2f5bd3", heather="#4aa3df", ink="#22252c")
STITCH = {
    "stock": lambda r, c, col: col,
    "seed": lambda r, c, col: col if (r + c) % 2 else (col, "p"),
    "rib": lambda r, c, col: col if c % 4 < 2 else (col, "p"),
    "garter": lambda r, c, col: col if r % 2 else (col, "p"),
}
def patch(k, x, y, cols, rows, kind, col):
    k.fabric([[STITCH[kind](r, c, col) for c in range(cols)] for r in range(rows)], x, y, edge=False)
def seam(k, x0, y0, x1, y1, col):
    L = math.hypot(x1 - x0, y1 - y0); n = max(2, int(L / 9))
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    pts = " ".join(f"L{x0 + ux * L * i / n + (-uy) * (4 if i % 2 else -4):.1f} {y0 + uy * L * i / n + ux * (4 if i % 2 else -4):.1f}" for i in range(n + 1))
    k.yarn("M" + pts[1:], col, 2.6)
k = Knit(W=10, H=8, uid="d08m")
for (i, j, kind, col) in ((0, 0, "stock", P8["moss"]), (1, 0, "seed", P8["rust"]), (0, 1, "rib", P8["denim"]), (1, 1, "garter", P8["oat"])):
    patch(k, 6 + i * 62, 6 + j * 50, 6, 6, kind, col)
seam(k, 67, 4, 67, 104, P8["ink"]); seam(k, 4, 55, 130, 55, P8["ink"])
save("d08-mark.svg", k, 136, 112)
k = Knit(W=10, H=8, uid="d08map", seed=4)
layout = [  # x,y,cols,rows (stitch units), stitch = evidence quality, colour = match
    (0, 0, 22, 18, "garter", P8["oat"]), (22, 0, 30, 14, "stock", P8["denim"]), (52, 0, 26, 20, "seed", P8["heather"]),
    (0, 18, 16, 24, "stock", P8["heather"]), (16, 14, 20, 20, "stock", P8["denim"]), (36, 14, 16, 22, "seed", P8["moss"]),
    (52, 20, 26, 16, "stock", P8["rust"]), (16, 34, 20, 18, "seed", P8["heather"]), (36, 36, 22, 16, "stock", P8["moss"]),
    (58, 36, 20, 16, "stock", P8["heather"]), (0, 42, 16, 10, "garter", P8["oat"])]
for (x, y, c, r, kind, col) in layout:
    patch(k, 4 + x * 10, 4 + y * 8, c, r, kind, col)
for (x, y, c, r, kind, col) in layout:
    X, Y = 4 + x * 10, 4 + y * 8
    seam(k, X + c * 10, Y + 2, X + c * 10, Y + r * 8, "#ffffff")
    seam(k, X + 2, Y + r * 8, X + c * 10, Y + r * 8, "#ffffff")
k.ball(4 + 26 * 10, 4 + 25 * 8, 14, P8["ink"], seed=9)
save("d08-map.svg", k, 4 + 78 * 10 + 6, 4 + 52 * 8 + 10)
for kind in ("stock", "seed", "garter"):
    fabric_svg(f"d08-st-{kind}.svg", [[STITCH[kind](r, c, P8["denim"]) for c in range(5)] for r in range(4)], W=14, H=11, seed=2, pad=3)
palette("d08-palette.svg", [P8["oat"], P8["moss"], P8["rust"], P8["denim"], P8["heather"]])

# ---------- 09 Pattern Chart (flat notation + the fabric it makes) ----------
P9 = dict(paper="#ffffff", grid="#cfd9e4", ink="#22252c", red="#e2453c", blue="#2f5bd3", cream="#f4f7fa")
def chart_svg(name, art, pal, cell=16, numbers=True):
    rows, cols = len(art), len(art[0])
    pad = 26 if numbers else 4
    W, Hh = cols * cell + pad + 4, rows * cell + pad + 4
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {Hh}" width="{W}" height="{Hh}"><rect width="{W}" height="{Hh}" fill="{P9["paper"]}"/>']
    for r, row in enumerate(art):
        for c, ch in enumerate(row):
            x, y = 4 + c * cell, 4 + r * cell
            fill = pal.get(ch)
            if fill:
                out.append(f'<rect x="{x}" y="{y}" width="{cell}" height="{cell}" fill="{fill}"/>')
            if ch == "-":
                out.append(f'<circle cx="{x + cell / 2}" cy="{y + cell / 2}" r="{cell * .13}" fill="{P9["ink"]}"/>')
    for r in range(rows + 1):
        sw = 1.6 if r % 5 == 0 or r == rows else .7
        out.append(f'<path d="M4 {4 + r * cell} H{4 + cols * cell}" stroke="{P9["ink"] if sw > 1 else P9["grid"]}" stroke-width="{sw}"/>')
    for c in range(cols + 1):
        sw = 1.6 if (cols - c) % 5 == 0 or c == 0 else .7
        out.append(f'<path d="M{4 + c * cell} 4 V{4 + rows * cell}" stroke="{P9["ink"] if sw > 1 else P9["grid"]}" stroke-width="{sw}"/>')
    if numbers:
        for r in range(rows):
            n = rows - r
            if n % 2 == 1 or n == rows:
                out.append(f'<text x="{8 + cols * cell}" y="{4 + r * cell + cell * .72}" font-family="JetBrains Mono, monospace" font-size="9" fill="{P9["ink"]}">{n}</text>')
        for c in range(cols):
            n = cols - c
            if n % 5 == 0 or n == 1:
                out.append(f'<text x="{4 + c * cell + cell / 2}" y="{rows * cell + 18}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9" fill="{P9["ink"]}">{n}</text>')
    out.append("</svg>\n")
    open(os.path.join(OUT, name), "w").write("".join(out))
chart_svg("d09-mark.svg", [row.replace("M", "B").replace("T", "B").replace("I", "-") for row in HOUSE],
          {"R": P9["red"], "B": P9["blue"]}, cell=12, numbers=False)
bars9 = []
for i, v in enumerate((.88, .80, .62, .46)):
    n = round(v * 24)
    bars9.append("." * 26)
    bars9.append("." + ("R" if v < .5 else "B") * n + "." * (25 - n))
    bars9.append("." + ("R" if v < .5 else "B") * n + "." * (25 - n))
bars9.append("." * 26)
chart_svg("d09-chart.svg", bars9, {"R": P9["red"], "B": P9["blue"]}, cell=14)
fabric_svg("d09-swatch.svg", pixels(bars9, {".": P9["cream"], "R": P9["red"], "B": P9["blue"]}), W=9, H=7.2, seed=3)
palette("d09-palette.svg", [P9["paper"], P9["ink"], P9["red"], P9["blue"], P9["grid"]])

# ---------- 10 Selbu Night ----------
P10 = dict(night="#16203a", wool="#f4f7fa", lamp="#f6c445", berry="#e2453c", frost="#4aa3df")
STAR = [".......X.......",
        "......XXX......",
        ".X....XXX....X.",
        ".XX...XXX...XX.",
        ".XXX..XXX..XXX.",
        "..XXX.XXX.XXX..",
        "...XXX.X.XXX...",
        "XXXXXX...XXXXXX",
        "...XXX.X.XXX...",
        "..XXX.XXX.XXX..",
        ".XXX..XXX..XXX.",
        ".XX...XXX...XX.",
        ".X....XXX....X.",
        "......XXX......",
        ".......X......."]
m = grid(17, 17, P10["night"])
stamp(m, STAR, 1, 1, {"X": P10["wool"], ".": P10["night"]})
fabric_svg("d10-mark.svg", m, seed=6)
b = grid(19, 72, P10["night"])
for i, left in enumerate(range(1, 72, 18)):
    stamp(b, STAR, 2, left, {"X": P10["wool"] if i % 2 == 0 else P10["frost"], ".": P10["night"]})
for c in range(72):
    b[0][c] = P10["berry"] if c % 2 else P10["night"]
    b[18][c] = P10["berry"] if c % 2 == 0 else P10["night"]
fabric_svg("d10-band.svg", b, W=10, H=8, seed=7)
hs = grid(16, 40, P10["night"])
for left, w, wall, hc in ((2, 9, 6, "#e2453c"), (13, 11, 8, "#4aa3df"), (26, 7, 5, "#f08bb0"), (35, 5, 7, "#2f5bd3")):
    peak = w // 2
    for i in range(peak + 1):
        for c in range(left + peak - i, left + peak + i + 1):
            hs[14 - wall - peak + i][c] = hc
    for r in range(14 - wall, 14):
        for c in range(left, left + w):
            hs[r][c] = hc
    for r in range(14 - wall + 2, 13, 3):
        for c in range(left + 2, left + w - 1, 3):
            hs[r][c] = P10["lamp"]
for c in range(40):
    hs[14][c] = P10["wool"]; hs[15][c] = P10["wool"]
for (r, c) in ((1, 4), (3, 20), (2, 33), (5, 9), (1, 27)):
    hs[r][c] = P10["wool"]
fabric_svg("d10-houses.svg", hs, W=10, H=8, seed=8)
palette("d10-palette.svg", [P10["night"], P10["wool"], P10["lamp"], P10["berry"], P10["frost"]])
print("ok", len(os.listdir(OUT)))
