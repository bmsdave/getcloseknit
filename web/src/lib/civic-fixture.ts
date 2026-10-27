/**
 * Demo civic context for the three preview areas. Every name, person and
 * amount here is made up and every source id starts with "preview-", so real
 * mode rejects it (readCivic) and nobody mistakes it for a real council.
 */
import type { GeographyId } from "./contracts";
import type { CivicPerson, CivicResponse, CivicSubject } from "./civic";
import { normalisePostcode } from "./postcode-page";

const PREVIEWS = [
  { index: 1, name: "Westminster preview", postcode: "SW1A 1AA", bandD: 1100 },
  { index: 2, name: "North London preview", postcode: "WC1A 1AA", bandD: 2150 },
  { index: 3, name: "South Bank preview", postcode: "SE1 7PB", bandD: 1950 },
] as const;

const RATIOS = { A: 6, B: 7, C: 8, D: 9, E: 11, F: 13, G: 15, H: 18 } as const;
const FETCHED_ON = "2026-10-01";
const SOURCE = {
  id: "preview-civic",
  licence: "demo",
  attribution: "Demo data: made-up places, people and amounts that show how this section works.",
  caveats: ["Switch to Real for the ONS Postcode Directory, gov.uk council tax and Democracy Club."],
  releaseDate: FETCHED_ON,
};

type Preview = (typeof PREVIEWS)[number];

function code(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(6, "0")}`;
}

function person(preview: Preview, role: CivicPerson["role"], seat: number): CivicPerson {
  return {
    role,
    areaCode: role === "mp" ? code("E14", preview.index) : code("E05", preview.index),
    areaName: role === "mp" ? `${preview.name} constituency` : `${preview.name} central`,
    name: role === "mp" ? `Demo MP ${preview.index}` : `Demo councillor ${preview.index}${"abc"[seat]}`,
    party: "Demo party",
    electedOn: role === "mp" ? "2024-07-04" : "2026-05-07",
    profileUrl: null,
  };
}

function build(preview: Preview, subject: CivicSubject): CivicResponse {
  const ward = { code: code("E05", preview.index), name: `${preview.name} central` };
  const seat = { code: code("E14", preview.index), name: `${preview.name} constituency` };
  const borough = subject.kind === "borough";
  return {
    schemaVersion: "civic.v1",
    productReleaseId: "preview-release",
    subject,
    available: true,
    place: {
      country: { code: "E92000001", name: "England" },
      region: { code: "E12000007", name: "London" },
      borough: { code: code("E09", preview.index), name: `${preview.name} borough` },
      ward: borough ? null : ward,
      parish: null,
      constituency: seat,
      policeForce: { code: "E23000001", name: "Demo police force" },
      msoa: borough ? null : { code: code("E02", preview.index), name: `${preview.name} MSOA` },
      lsoa: subject.kind === "lsoa" || subject.kind === "postcode" ? { code: code("E01", preview.index), name: preview.name } : null,
    },
    wards: [{ ...ward, share: 1 }],
    constituencies: [{ ...seat, share: 1 }],
    livePostcodes: subject.kind === "postcode" ? null : 40 * preview.index,
    councilTax: {
      financialYear: "2026-27",
      boroughCode: code("E09", preview.index),
      boroughName: `${preview.name} borough`,
      bandDBorough: preview.bandD - 500,
      bandDGla: 500,
      bands: Object.entries(RATIOS).map(([band, ratio]) => ({
        band: band as keyof typeof RATIOS,
        amount: Math.round((preview.bandD * ratio / 9) * 100) / 100,
      })),
      sourceVersion: SOURCE.id,
    },
    representedWards: borough ? [] : [ward],
    representedConstituencies: [seat],
    councillors: borough ? [] : [0, 1, 2].map((seatIndex) => person(preview, "councillor", seatIndex)),
    mps: [person(preview, "mp", 0)],
    fetchedOn: { councillors: borough ? null : FETCHED_ON, mps: FETCHED_ON },
    sources: [SOURCE],
  };
}

export function fixtureAreaCivic(id: GeographyId): CivicResponse | null {
  const match = /^uk:(lsoa|msoa|lad):E0[129]0{5}([1-3])$/.exec(id);
  if (!match) return null;
  const preview = PREVIEWS[Number(match[2]) - 1];
  const kind = (match[1] === "lad" ? "borough" : match[1]) as "lsoa" | "msoa" | "borough"; // civic names a LAD subject "borough"
  return build(preview, { kind, geographyId: id, postcode: null, introduced: null, terminated: null });
}

export function fixturePostcodeCivic(value: string): CivicResponse | null {
  const postcode = normalisePostcode(value);
  const preview = PREVIEWS.find((candidate) => candidate.postcode === postcode);
  if (!preview || !postcode) return null;
  return build(preview, {
    kind: "postcode", geographyId: `uk:lsoa:${code("E01", preview.index)}` as GeographyId,
    postcode, introduced: "1980-01", terminated: null,
  });
}
