"""Knitted layer for the map screens: overlays (route yarn, yarn-ball markers, work knot)
positioned from MapLibre projections, plus panel parts for day and night."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from knitlib import Knit, pixels

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
Y = dict(cherry="#e2453c", tangerine="#f28b30", sun="#f6c445", sky="#4aa3df", cobalt="#2f5bd3", pink="#f08bb0",
         snow="#f4f7fa", wool="#eef3f8", ink="#22252c", night="#16203a", nightwool="#2a375a")


def save(name, k, w, h):
    open(os.path.join(OUT, name), "w").write(k.svg(w, h))


def slack(points, seed=1, amp=4.0):
    """A yarn path through points: densified, softly kinked, smoothed (Catmull-Rom → cubic)."""
    rnd = random.Random(seed)
    dense = [points[0]]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        n = max(1, int(L / 26))
        nx, ny = -(y1 - y0) / (L or 1), (x1 - x0) / (L or 1)
        for i in range(1, n + 1):
            t = i / n
            j = rnd.uniform(-amp, amp) if i < n else 0
            dense.append((x0 + (x1 - x0) * t + nx * j, y0 + (y1 - y0) * t + ny * j))
    d = f"M{dense[0][0]:.1f} {dense[0][1]:.1f}"
    for i in range(len(dense) - 1):
        p0 = dense[max(0, i - 1)]; p1 = dense[i]; p2 = dense[i + 1]; p3 = dense[min(len(dense) - 1, i + 2)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}"
    return d


def looped(points, at, r, seed=1, amp=4.0):
    a = slack(points[:at + 1], seed=seed, amp=amp)
    x, y = points[at]
    loop = f" C{x + 2.2 * r:.1f} {y - .4 * r:.1f} {x + 1.2 * r:.1f} {y - 2.6 * r:.1f} {x:.1f} {y - 1.6 * r:.1f} C{x - 1.2 * r:.1f} {y - .6 * r:.1f} {x - .4 * r:.1f} {y + .6 * r:.1f} {x:.1f} {y:.1f}"
    b = slack(points[at:], seed=seed + 1, amp=amp)
    return a + loop + b[b.index(" C"):]


def knot(k, x, y, col, w):
    """The end of the thread: a small tied loop with a short tail."""
    k.yarn(f"M{x - 10:.1f} {y - 6:.1f} C{x - 2:.1f} {y - 14:.1f} {x + 10:.1f} {y - 6:.1f} {x + 4:.1f} {y + 2:.1f} "
           f"C{x - 2:.1f} {y + 8:.1f} {x - 10:.1f} {y + 2:.1f} {x - 4:.1f} {y - 4:.1f} L{x + 12:.1f} {y + 10:.1f}", col, w)


def overlay(name, W, H, route, balls, work, w=5.0, loop_at=None):
    k = Knit(uid=name[:6])
    sx, sy = balls[0][0], balls[0][1]
    pts = [(sx, sy)] + route
    d = looped(pts, loop_at, 9, seed=3, amp=8) if loop_at else slack(pts, seed=3, amp=8)
    k.yarn(d, Y["cherry"], w)
    knot(k, work[0], work[1], Y["cherry"], w * .9)
    for i, (x, y, r, col) in enumerate(balls[1:], start=1):
        k.ball(x, y, r, Y[col], seed=i + 4)
    x, y, r, col = balls[0]
    k.ball(x, y, r, Y[col], seed=2)  # the selected area's ball last, on top
    save(name, k, W, H)


PLACE = {"work": "cherry", "school": "sun", "gym": "tangerine", "family": "pink"}


def overlay(name, W, H, start, route, places, r, w, loop_at):
    """Zones stay on the map. On top: a knot where you'd live, the yarn to work, one ball per place."""
    k = Knit(uid=name[:6])
    pts = [start] + route
    k.yarn(looped(pts, loop_at, 9, seed=3, amp=8), Y["cherry"], w)
    knot(k, start[0], start[1], Y["cherry"], w * .9)
    for i, (kind, x, y) in enumerate(places):
        k.ball(x, y, r, Y[PLACE[kind]], seed=i + 4)
    save(name, k, W, H)


# web map 1040×900 (z12.8, centre -0.0705, 51.5415): MapLibre projections
overlay("web-overlay.svg", 1040, 900, (463.2, 133.6),
        [(476.4, 226.5), (471.3, 314.6), (472.3, 375), (460.2, 482.6), (444.9, 593.5), (439.9, 689.7),
         (444.9, 741.9), (426.7, 803.8), (406.4, 836.4)],
        [("school", 512.9, 83), ("school", 367.9, 189), ("gym", 489.6, 322.8), ("family", 667.1, 360.3),
         ("work", 406.4, 836.4)], r=13, w=5, loop_at=5)
# phone map 390×480 (z12.55, centre -0.0735, 51.5562); work is below the fold
overlay("phone-overlay.svg", 390, 480, (172.8, 175.5),
        [(183.9, 253.7), (179.6, 327.8), (180.5, 378.5), (170.3, 469), (165, 540)],
        [("school", 214.6, 133), ("school", 92.7, 222.2), ("gym", 195, 334.6), ("family", 344.3, 366.2)],
        r=10, w=4.4, loop_at=2)
for kind, col in PLACE.items():
    k = Knit(uid=f"pl{kind[:3]}")
    k.ball(14, 13, 11, Y[col], seed=3)
    save(f"place-{kind}.svg", k, 28, 28)


def fabric_svg(name, g, W=10, H=8, seed=3, pad=3):
    k = Knit(W=W, H=H, seed=seed, uid=name[:5])
    w, h = k.fabric(g, pad, pad)
    save(name, k, w + 2 * pad, h + 2 * pad + H * .4)


def bar(name, v, col, ground, cols=34, rows=3, seed=1):
    g = [[col if c < round(v * cols) else ground for c in range(cols)] for _ in range(rows)]
    fabric_svg(name, g, seed=seed)


for theme, ground in (("day", Y["wool"]), ("night", Y["nightwool"])):
    for v, col in ((88, "cherry"), (80, "sky"), (62, "sun"), (46, "pink")):
        bar(f"{theme}-bar{v}.svg", v / 100, Y[col], ground, seed=v)
    stripe = Y["sun"]
    base = Y["cherry"] if theme == "day" else Y["cobalt"]
    rib = [[((stripe if r in (1, 2) else base) if c % 4 < 2 else ((stripe if r in (1, 2) else base), "p"))
            for c in range(44)] for r in range(5)]
    fabric_svg(f"{theme}-cuff.svg", rib, W=10, H=8, seed=5)

# the area's own knitted house (Stoke Newington): day on snow, night with lit windows
HOUSE = ["...............",
         ".......R.......",
         "......RRR......",
         ".....RRRRR.....",
         "....RRRRRRR....",
         "...RRRRRRRRR...",
         "..RRRRRRRRRRR..",
         "...SSSSSSSSS...",
         "...SWSSSSSWS...",
         "...SSSSSSSSS...",
         "...PPPPDPPPP...",
         "...PWPPDPPWP...",
         "...PPPPDPPPP...",
         "GGGGGGGGGGGGGGG"]
for theme in ("day", "night"):
    pal = {".": Y["wool"] if theme == "day" else Y["night"], "R": Y["cherry"], "S": Y["sun"], "P": Y["sky"],
           "W": "#ffffff" if theme == "day" else Y["sun"], "D": Y["ink"] if theme == "day" else Y["sun"],
           "G": Y["cobalt"] if theme == "day" else Y["wool"]}
    fabric_svg(f"{theme}-house.svg", pixels(HOUSE, pal), W=12, H=9.5, seed=6, pad=4)

# price history as a single thread: ten years, a dip in 2020, a ball of yarn for today
prices = [.20, .26, .31, .36, .40, .47, .52, .49, .46, .52, .61, .70, .72, .74, .80, .86, .90, .93]
W, H, pad = 340, 120, 14
pts = [(pad + i * (W - 2 * pad) / (len(prices) - 1), H - pad - v * (H - 2 * pad)) for i, v in enumerate(prices)]
for theme in ("day", "night"):
    k = Knit(uid=f"pr{theme[0]}")
    k.yarn(looped(pts[:-1], 8, 7, seed=8, amp=1.5), Y["cherry"], 4.2)
    x, y = pts[-2]
    k.ball(pts[-1][0] - 2, pts[-1][1] + 2, 9, Y["cherry"], seed=9)
    save(f"{theme}-price.svg", k, W, H)
W2, H2 = 340, 66
pts2 = [(pad + i * (W2 - 2 * pad) / (len(prices) - 1), H2 - 10 - v * (H2 - 22)) for i, v in enumerate(prices)]
for theme in ("day", "night"):
    k = Knit(uid=f"ps{theme[0]}")
    k.yarn(looped(pts2[:-1], 8, 5, seed=8, amp=1.2), Y["cherry"], 3.6)
    k.ball(pts2[-1][0] - 2, pts2[-1][1] + 2, 7, Y["cherry"], seed=9)
    save(f"{theme}-price-sm.svg", k, W2, H2)
print("ok", len(os.listdir(OUT)))
