// Builds public/tfl-network.json: London's rail network (Tube, Elizabeth line, DLR, Overground, Tram)
// as line geometry in each line's own colour plus its stations (with every line that calls there), from TfL open data.
// Run: node scripts/tfl-network.mjs   (Powered by TfL Open Data; contains OS data © Crown copyright.)
import { writeFile } from "node:fs/promises";

/**
 * TfL's line colours: the screen (RGB) values of TfL's Colour standard, Issue 11 (August 2026),
 * https://content.tfl.gov.uk/tfl-colour-standard.pdf (sections 3, 5 and 6).
 */
export const LINES = {
  bakerloo: ["Bakerloo", "#B26300"], central: ["Central", "#DC241F"], circle: ["Circle", "#FFC80A"],
  district: ["District", "#007D32"], "hammersmith-city": ["Hammersmith & City", "#F589A6"], jubilee: ["Jubilee", "#838D93"],
  metropolitan: ["Metropolitan", "#9B0058"], northern: ["Northern", "#000000"], piccadilly: ["Piccadilly", "#0019A8"],
  victoria: ["Victoria", "#039BE5"], "waterloo-city": ["Waterloo & City", "#76D0BD"], elizabeth: ["Elizabeth", "#60399E"],
  dlr: ["DLR", "#00AFAD"], tram: ["Tram", "#5FB526"], liberty: ["Liberty", "#5D6061"], lioness: ["Lioness", "#FAA61A"],
  mildmay: ["Mildmay", "#0077AD"], suffragette: ["Suffragette", "#5BBD72"], weaver: ["Weaver", "#823A62"], windrush: ["Windrush", "#ED1B00"],
};
/** Tube first, so a station's main colour is its Tube line. */
export const MODE_ORDER = ["bakerloo", "central", "circle", "district", "hammersmith-city", "jubilee", "metropolitan", "northern", "piccadilly", "victoria", "waterloo-city", "elizabeth", "dlr", "liberty", "lioness", "mildmay", "suffragette", "weaver", "windrush", "tram"];

const round = (n) => Math.round(n * 1e5) / 1e5;

/**
 * TfL draws a line as straight hops between stations. A continuous thread bends
 * instead, so each part is drawn as a centripetal Catmull-Rom curve through its
 * points: it passes exactly through every station (the balls stay on the line)
 * and never overshoots into a loop. `before` and `after` are the track beyond either end (the run
 * carries on through a junction), so the bend continues across it instead of starting afresh.
 */
export function smoothLine(points, steps = 8, before = points[0], after = points[points.length - 1]) {
  if (points.length < 3 && before === points[0] && after === points[points.length - 1]) return points;
  const out = [points[0]];
  const knot = (a, b) => Math.max(1e-9, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : before, p1 = points[i], p2 = points[i + 1], p3 = i + 2 < points.length ? points[i + 2] : after;
    const t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    for (let s = 1; s <= steps; s++) {
      const t = t1 + (t2 - t1) * (s / steps);
      const lerp = (a, b, ta, tb) => ta === tb ? a : [(tb - t) / (tb - ta) * a[0] + (t - ta) / (tb - ta) * b[0], (tb - t) / (tb - ta) * a[1] + (t - ta) / (tb - ta) * b[1]];
      const a1 = lerp(p0, p1, 0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, 0, t2), b2 = lerp(a2, a3, t1, t3);
      const c = lerp(b1, b2, t1, t2);
      out.push(s === steps ? p2 : [round(c[0]), round(c[1])]);
    }
  }
  return out;
}

/** Points of different lines closer than this are one place on shared track (TfL gives each line its own stop). */
export const SNAP_METRES = 60;

const key = (p) => `${p[0]},${p[1]}`;
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110574);

/**
 * Where lines share track, TfL gives each its own copy, sometimes a few metres apart (Bakerloo and Lioness:
 * Queen's Park to Harrow & Wealdstone). Each line's points are snapped onto the first line's (Tube first) when
 * within SNAP_METRES, never merging two points of the same line. Returns point key → snapped point.
 */
export function snapPoints(lineParts) {
  const cluster = new Map(), cell = 0.0006, grid = new Map();
  for (const [line, parts] of lineParts) for (const part of parts) for (const p of part) {
    const k = key(p);
    if (cluster.has(k)) { cluster.get(k).lines.add(line); continue; }
    const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
    let target = null, nearest = SNAP_METRES;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const q of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
        const c = cluster.get(key(q)), d = metres(p, q);
        if (d <= nearest && !c.lines.has(line)) { target = c; nearest = d; }
      }
    }
    const c = target ?? { at: p, lines: new Set() };
    c.lines.add(line);
    cluster.set(k, c);
    grid.set(`${gx},${gy}`, [...(grid.get(`${gx},${gy}`) ?? []), p]);
  }
  return new Map([...cluster].map(([k, c]) => [k, c.at]));
}

/**
 * TfL lists every route both ways and every branch from its terminus, and lines that share track each
 * list it too. Drawn faint, overlapping copies would add up to a solid line, and the last line drawn
 * would hide the others. So every hop between stations is kept once, with every line that runs along it,
 * and the hops are joined into stretches with the same lines: between junctions, and wherever a line
 * joins or leaves. Neighbouring stretches run the same way where they can, so a line keeps its side of
 * the bundle. Returns [{ lines (in MODE_ORDER), points, before, after }]; `before`/`after` are the track
 * beyond each end, for smoothing across it.
 */
export function sharedStretches(lineParts) {
  const snapped = snapPoints(lineParts), point = new Map(), edges = new Map(), at = new Map();
  for (const [line, parts] of lineParts) for (const part of parts) {
    const ps = part.map((p) => snapped.get(key(p)) ?? p);
    for (let i = 0; i < ps.length - 1; i++) {
      const ka = key(ps[i]), kb = key(ps[i + 1]);
      if (ka === kb) continue;
      point.set(ka, ps[i]); point.set(kb, ps[i + 1]);
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!edges.has(id)) {
        edges.set(id, { ends: [ka, kb], lines: new Set() });
        for (const k of [ka, kb]) at.set(k, [...(at.get(k) ?? []), id]);
      }
      edges.get(id).lines.add(line);
    }
  }
  const order = lineParts.map(([line]) => line);
  const signature = (id) => [...edges.get(id).lines].sort((x, y) => order.indexOf(x) - order.indexOf(y)).join(",");
  // A stretch carries on through a point only where exactly two hops with the same lines meet.
  const through = (k) => at.get(k).length === 2 && signature(at.get(k)[0]) === signature(at.get(k)[1]);
  const used = new Set(), stretches = [];
  const walk = (start, edge) => {
    const keys = [start], lines = signature(edge);
    let k = start;
    while (edge !== undefined && !used.has(edge)) {
      used.add(edge);
      const [a, b] = edges.get(edge).ends;
      k = a === k ? b : a;
      keys.push(k);
      edge = through(k) ? at.get(k).find((e) => !used.has(e)) : undefined;
    }
    stretches.push({ lines: lines.split(","), keys });
  };
  for (const [k, list] of at) if (!through(k)) for (const e of list) if (!used.has(e)) walk(k, e);
  for (const [id, edge] of edges) if (!used.has(id)) walk(edge.ends[0], id);
  orient(stretches);
  // The track beyond an end: the far point of the hop there that carries on straightest.
  const beyond = (s, end) => {
    const k = end ? s.keys.at(-1) : s.keys[0], inner = end ? s.keys.at(-2) : s.keys[1], p = point.get(k), q = point.get(inner);
    let best = p, straightest = 0.5;
    for (const id of at.get(k)) {
      const far = edges.get(id).ends.find((e) => e !== k);
      if (far === inner) continue;
      const f = point.get(far), u = [p[0] - q[0], p[1] - q[1]], v = [f[0] - p[0], f[1] - p[1]];
      const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
      if (cos > straightest) { straightest = cos; best = f; }
    }
    return best;
  };
  return stretches.map((s) => ({ lines: s.lines, keys: s.keys, points: s.keys.map((k) => point.get(k)), before: beyond(s, false), after: beyond(s, true) }));
}

/** Turns stretches so that, where they meet and share a line, one ends where the next begins. */
function orient(stretches) {
  const ends = new Map(), done = new Set();
  stretches.forEach((s, i) => { for (const k of [s.keys[0], s.keys.at(-1)]) ends.set(k, [...(ends.get(k) ?? []), i]); });
  const byWidth = stretches.map((_, i) => i).sort((a, b) => stretches[b].lines.length - stretches[a].lines.length);
  for (const first of byWidth) {
    if (done.has(first)) continue;
    done.add(first);
    const queue = [first];
    while (queue.length) {
      const s = stretches[queue.shift()];
      for (const [k, leaving] of [[s.keys.at(-1), true], [s.keys[0], false]]) {
        for (const j of ends.get(k)) {
          const t = stretches[j];
          if (done.has(j) || !t.lines.some((line) => s.lines.includes(line))) continue;
          // Leaving through k, the next stretch should start at k; arriving at k, the one before should end there.
          if ((leaving && t.keys[0] !== k) || (!leaving && t.keys.at(-1) !== k)) t.keys.reverse();
          done.add(j);
          queue.push(j);
        }
      }
    }
  }
}

/**
 * The drawn network: one feature per line and place in its bundle. On a stretch shared by n lines each
 * takes a lane, `offset` (in line widths) from the middle, -(n-1)/2 … (n-1)/2, in MODE_ORDER, to the right
 * of the stretch's direction, as on TfL's own map. Each hop is drawn once per line, never stacked.
 * Consecutive stretches in the same lane are joined, so the yarn runs on through them.
 */
export function lineFeatures(stretches) {
  const pieces = new Map();
  for (const s of stretches) {
    const curve = smoothLine(s.points, 8, s.before, s.after);
    s.lines.forEach((line, i) => {
      const offset = i - (s.lines.length - 1) / 2;
      const list = pieces.get(line) ?? [];
      list.push({ offset, coords: curve, start: s.keys[0], end: s.keys.at(-1) });
      pieces.set(line, list);
    });
  }
  const features = [];
  for (const line of MODE_ORDER) {
    const list = pieces.get(line) ?? [];
    const touching = new Map();
    for (const p of list) for (const k of [p.start, p.end]) touching.set(k, (touching.get(k) ?? 0) + 1);
    // Join a piece onto one that ends where it starts (a centred piece may also be turned round).
    for (let joined = true; joined;) {
      joined = false;
      for (const a of list) {
        if (a.gone || touching.get(a.end) !== 2) continue;
        const b = list.find((b) => b !== a && !b.gone && b.offset === a.offset && (b.start === a.end || (a.offset === 0 && b.end === a.end)));
        if (!b || b.start === b.end) continue;
        if (b.start !== a.end) { b.coords = [...b.coords].reverse(); [b.start, b.end] = [b.end, b.start]; }
        a.coords = [...a.coords, ...b.coords.slice(1)];
        a.end = b.end;
        b.gone = joined = true;
      }
    }
    const offsets = [...new Set(list.map((p) => p.offset))].sort((x, y) => x - y);
    for (const offset of offsets) {
      const coords = list.filter((p) => !p.gone && p.offset === offset).map((p) => p.coords);
      features.push({ type: "Feature", properties: { kind: "line", line, name: LINES[line][0], colour: LINES[line][1], offset }, geometry: { type: "MultiLineString", coordinates: coords } });
    }
  }
  return features;
}

/** A TfL route's track as parts of rounded points, each part once (TfL repeats them). */
export function routeParts(route) {
  const seen = new Set(), parts = [];
  for (const text of route.lineStrings ?? []) {
    for (const part of JSON.parse(text)) {
      const coords = part.map(([lon, lat]) => [round(lon), round(lat)]).filter((p, i, all) => i === 0 || key(p) !== key(all[i - 1]));
      const id = JSON.stringify(coords);
      if (coords.length > 1 && !seen.has(id)) { seen.add(id); parts.push(coords); }
    }
  }
  return parts;
}

/**
 * Adds a line's stations to `stations` (TfL id → station): each station keeps every line that calls
 * there, in MODE_ORDER (the build walks lines in that order), so its marker gets a ring segment per line.
 * `stopPoints` (the route's stopPointSequences) give each line's own platforms at the station, which
 * placeStations uses to put the marker where the lines meet.
 */
export function addRouteStations(stations, routeStations, line, stopPoints = []) {
  for (const station of routeStations ?? []) {
    const known = stations.get(station.id) ?? { name: station.name.replace(/ (Underground|DLR|Rail|Tram|Overground) Station$/i, "").replace(/ Station$/i, ""), lon: round(station.lon), lat: round(station.lat), lines: [] };
    if (!known.lines.includes(line)) known.lines.push(line);
    for (const stop of stopPoints) {
      if (stop.stationId !== station.id && stop.topMostParentId !== station.id) continue;
      (known.stops ??= new Map()).set(stop.id, [stop.lon, stop.lat]);
    }
    stations.set(station.id, known);
  }
  return stations;
}

/**
 * TfL places an interchange at its hub, which can be well off the lines: King's Cross St Pancras sits on
 * the main-line station, some 110 m north of the Tube platforms every line passes through, and Custom House
 * a kilometre north of its platforms. A station is put where its lines pass: the middle of each line's
 * point nearest the station's own stops (within 250 m), else the middle of the stops. `linePoints` maps a
 * line to the points its track is drawn through.
 */
export function placeStations(stations, linePoints = new Map()) {
  for (const station of stations.values()) {
    const stops = [...(station.stops?.values() ?? [])];
    const mean = (ps) => [ps.reduce((sum, p) => sum + p[0], 0) / ps.length, ps.reduce((sum, p) => sum + p[1], 0) / ps.length];
    const at = stops.length ? mean(stops) : [station.lon, station.lat];
    const onLines = [];
    for (const line of station.lines) {
      let best = null, nearest = 250;
      for (const p of linePoints.get(line) ?? []) { const d = metres(at, p); if (d < nearest) { nearest = d; best = p; } }
      if (best) onLines.push(best);
    }
    [station.lon, station.lat] = (onLines.length ? mean(onLines) : at).map(round);
    delete station.stops;
  }
  return stations;
}

/** A station as a map feature: its lines ("central,northern") name its marker; `line` is the main one. */
export function stationFeature(id, station) {
  const tube = station.lines.filter((line) => MODE_ORDER.indexOf(line) < MODE_ORDER.indexOf("elizabeth"));
  return { type: "Feature", properties: {
    kind: "station", id, name: station.name, lines: station.lines.join(","), line: station.lines[0], colour: LINES[station.lines[0]][1],
    // Unused since stations became ring markers (the yarn-ball winding); kept so the shipped data matches.
    variant: [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 3,
    interchange: station.lines.length > 1, tube: tube.length > 0, rank: station.lines.length > 2 ? 1 : station.lines.length > 1 ? 2 : tube.length ? 3 : 4,
  }, geometry: { type: "Point", coordinates: [station.lon, station.lat] } };
}

async function json(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url);
    if (response.ok) return response.json();
    await new Promise((done) => setTimeout(done, 1500 * (attempt + 1)));
  }
  throw new Error(`TfL API failed: ${url}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) await build();

async function build() {
const stations = new Map(), lineParts = [];
for (const id of MODE_ORDER) {
  const route = await json(`https://api.tfl.gov.uk/Line/${id}/Route/Sequence/all`);
  const parts = routeParts(route);
  lineParts.push([id, parts]);
  addRouteStations(stations, route.stations, id, (route.stopPointSequences ?? []).flatMap((sequence) => sequence.stopPoint ?? []));
  process.stdout.write(`${id}: ${parts.length} routes\n`);
}
const stretches = sharedStretches(lineParts);
const features = lineFeatures(stretches);
placeStations(stations, new Map(stretches.flatMap((s) => s.lines.map((line) => [line, s.points])).reduce((map, [line, points]) => map.set(line, [...(map.get(line) ?? []), ...points]), new Map())));
for (const [id, station] of stations) features.push(stationFeature(id, station));
await writeFile(new URL("../public/tfl-network.json", import.meta.url), JSON.stringify({ type: "FeatureCollection", features }));
process.stdout.write(`${stretches.length} stretches, ${stretches.filter((s) => s.lines.length > 1).length} shared; ${stations.size} stations\n`);
}
