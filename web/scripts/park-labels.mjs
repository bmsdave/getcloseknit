// Builds public/park-labels.json: a name point for each of London's big parks, heaths and commons,
// so they can be named from mid zooms (the basemap's own park names only arrive with its zoom-14 tiles).
// Each point is the park's own centre in OpenStreetMap, found by name with Nominatim (one request a
// second, per its usage policy). Run: node scripts/park-labels.mjs   (© OpenStreetMap contributors, ODbL.)
import { writeFile } from "node:fs/promises";

/** The parks to name: [name on the map, search text]. Order is priority when labels collide. */
export const PARKS = [
  ["Hyde Park", "Hyde Park, Westminster"], ["Regent's Park", "The Regent's Park, London"], ["Hampstead Heath", "Hampstead Heath, Camden"],
  ["Richmond Park", "Richmond Park, London"], ["Victoria Park", "Victoria Park, Tower Hamlets"], ["Greenwich Park", "Greenwich Park, London"],
  ["Kensington Gardens", "Kensington Gardens, London"], ["Battersea Park", "Battersea Park, Wandsworth"], ["Clapham Common", "Clapham Common, London"],
  ["Wimbledon Common", "Wimbledon Common, London"], ["Bushy Park", "Bushy Park, Richmond upon Thames"], ["Kew Gardens", "Kew Gardens"],
  ["Queen Elizabeth Olympic Park", "Queen Elizabeth Olympic Park, London"], ["Hackney Marshes", "Hackney Marshes, London"],
  ["Wanstead Flats", "Wanstead Flats, London"], ["Finsbury Park", "Finsbury Park, Haringey"], ["Alexandra Park", "Alexandra Park, Haringey"],
  ["Primrose Hill", "Primrose Hill, Camden"], ["Holland Park", "Holland Park, Kensington"], ["Green Park", "The Green Park, Westminster"],
  ["St James's Park", "St. James's Park, Westminster"], ["Burgess Park", "Burgess Park, Southwark"], ["Brockwell Park", "Brockwell Park, Lambeth"],
  ["Crystal Palace Park", "Crystal Palace Park, Bromley"], ["Dulwich Park", "Dulwich Park, Southwark"], ["Peckham Rye", "Peckham Rye Park, Southwark"],
  ["Tooting Common", "Tooting Bec Common, London"], ["Wandsworth Common", "Wandsworth Common, London"], ["Clissold Park", "Clissold Park, Hackney"],
  ["Southwark Park", "Southwark Park, Southwark"], ["Gunnersbury Park", "Gunnersbury Park, Hounslow"],
  ["Wormwood Scrubs", "Wormwood Scrubs, Hammersmith"], ["Highbury Fields", "Highbury Fields, Islington"], ["Mile End Park", "Mile End Park, Tower Hamlets"],
  ["Osterley Park", "Osterley Park, Hounslow"], ["Highgate Wood", "Highgate Wood, Haringey"], ["Streatham Common", "Streatham Common, Lambeth"],
];
/** Greater London, so a search never lands on a namesake elsewhere. */
const VIEWBOX = "-0.52,51.70,0.34,51.28";
const KINDS = new Set(["park", "common", "nature_reserve", "garden", "heath", "wood", "grass", "recreation_ground", "village_green"]);

/** Square kilometres of a Nominatim bounding box [south, north, west, east]. */
export function bboxKm2([south, north, west, east]) {
  const lat = ((+south + +north) / 2) * Math.PI / 180;
  return Math.abs(+north - +south) * 110.57 * Math.abs(+east - +west) * 111.32 * Math.cos(lat);
}

/** The six landmark parks are named from the opening zoom 11, others over 1 km² from 12, the rest from 13. */
export function labelMinZoom(rank, km2) {
  return rank <= 6 ? 11 : km2 > 1 ? 12 : 13;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) await build();

async function build() {
  const features = [];
  for (const [rank, [name, query]] of PARKS.entries()) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers: { "User-Agent": "close-knit park-labels build script" } });
    const hits = response.ok ? await response.json() : [];
    const hit = hits.find((h) => KINDS.has(h.type) && h.osm_type !== "node") ?? hits.find((h) => KINDS.has(h.type));
    if (!hit) { process.stdout.write(`not found: ${name}\n`); continue; }
    const km2 = Math.round(bboxKm2(hit.boundingbox) * 100) / 100;
    features.push({
      type: "Feature",
      properties: { name, rank: rank + 1, km2, minzoom: labelMinZoom(rank + 1, km2) },
      geometry: { type: "Point", coordinates: [Math.round(+hit.lon * 1e5) / 1e5, Math.round(+hit.lat * 1e5) / 1e5] },
    });
    process.stdout.write(`${name}: ${hit.type} ${km2} km²\n`);
    await new Promise((done) => setTimeout(done, 1100));
  }
  await writeFile(new URL("../public/park-labels.json", import.meta.url), JSON.stringify({ type: "FeatureCollection", features }));
}
