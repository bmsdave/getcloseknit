import type { GeographyId } from "./contracts";
import type { AreaPeopleResponse, PeopleCategory, PeopleTopic, PeopleTopicId } from "./people-profile";

/**
 * Demo People and homes for the three preview areas. London shares are the
 * real 2021 Census shares (per thousand) so the marker reads sensibly; the
 * area counts are made up. South Bank has no religion figures, to show how
 * a gap reads ("unknown", never 0).
 */
const CATEGORIES: Record<PeopleTopicId, Array<[string, string, number]>> = {
  ethnicity: [
    ["white-british", "White British", 368], ["white-irish", "Irish", 18], ["gypsy-traveller", "Gypsy or Irish Traveller", 1],
    ["roma", "Roma", 4], ["other-white", "Other White", 147], ["indian", "Indian", 75], ["pakistani", "Pakistani", 33],
    ["bangladeshi", "Bangladeshi", 37], ["chinese", "Chinese", 17], ["other-asian", "Other Asian", 46],
    ["african", "Black African", 79], ["caribbean", "Black Caribbean", 39], ["other-black", "Other Black", 17],
    ["mixed-white-asian", "Mixed White and Asian", 14], ["mixed-white-black-african", "Mixed White and Black African", 9],
    ["mixed-white-black-caribbean", "Mixed White and Black Caribbean", 15], ["other-mixed", "Other mixed background", 19],
    ["arab", "Arab", 16], ["any-other", "Any other group", 47],
  ],
  religion: [
    ["no-religion", "No religion", 271], ["christian", "Christian", 407], ["muslim", "Muslim", 150], ["hindu", "Hindu", 51],
    ["jewish", "Jewish", 17], ["sikh", "Sikh", 16], ["buddhist", "Buddhist", 9], ["other", "Another religion", 10],
    ["not-answered", "Chose not to answer", 70],
  ],
  qualification: [
    ["degree", "Degree or higher", 467], ["a-levels", "A levels or similar", 132], ["gcses", "Five or more GCSEs or similar", 100],
    ["some-gcses", "Some GCSEs or similar", 77], ["apprenticeship", "Apprenticeship", 32],
    ["other", "Other, including from abroad", 31], ["none", "No qualifications", 162],
  ],
  occupation: [
    ["managers", "Managers and directors", 145], ["professional", "Professionals", 258],
    ["associate-professional", "Technical and associate professionals", 153], ["administrative", "Office and admin", 85],
    ["skilled-trades", "Skilled trades", 75], ["caring-leisure", "Caring, leisure and other services", 77],
    ["sales", "Sales and customer service", 63], ["operatives", "Machine operators and drivers", 50],
    ["elementary", "Elementary jobs", 92],
  ],
  "economic-activity": [
    ["employee", "Employee", 472], ["self-employed", "Self-employed", 122], ["unemployed", "Looking for work", 41],
    ["student", "Full-time student", 99], ["retired", "Retired", 129], ["home-family", "Looking after home or family", 60],
    ["sick-disabled", "Long-term sick or disabled", 36], ["other-inactive", "Other, not working", 41],
  ],
  tenure: [
    ["owned-outright", "Owned outright", 207], ["mortgage", "Owned with a mortgage", 245], ["shared-ownership", "Shared ownership", 15],
    ["council", "Social rent from the council", 121], ["other-social", "Social rent from a housing association", 110],
    ["private-rent", "Private rent", 300], ["rent-free", "Lives rent free", 2],
  ],
  accommodation: [
    ["detached", "Detached house", 61], ["semi-detached", "Semi-detached house", 186], ["terraced", "Terraced house", 213],
    ["purpose-built-flat", "Flat in a purpose-built block", 403], ["converted-flat", "Flat in a converted house", 111],
    ["other-converted", "Flat in another converted building", 12], ["commercial", "Home in a commercial building", 14],
    ["temporary", "Caravan or temporary home", 1],
  ],
  age: [
    ["0-14", "0 to 14", 181], ["15-24", "15 to 24", 123], ["25-44", "25 to 44", 341], ["45-64", "45 to 64", 237],
    ["65-plus", "65 and over", 118],
  ],
  "household-type": [
    ["one-person", "One person", 293], ["couple-no-children", "Couple, no children", 185],
    ["couple-children", "Couple with children", 245], ["lone-parent", "Lone parent", 133],
    ["other", "Other, including shared", 144],
  ],
  // London's real 2021 shares (TS004, per thousand).
  "country-of-birth": [
    ["uk", "United Kingdom", 594], ["eu14", "EU members before 2004 (France, Germany, Italy, …)", 66], ["eu8", "Joined the EU in 2004 (Poland, Lithuania, …)", 29],
    ["eu2", "Romania and Bulgaria", 28], ["other-eu", "Croatia, Cyprus and Malta", 5], ["other-europe", "Europe outside the EU", 28],
    ["africa", "Africa", 71], ["middle-east-asia", "Middle East and Asia", 130], ["americas-caribbean", "The Americas and the Caribbean", 42],
    ["oceania-other", "Oceania, Antarctica and other", 7], ["british-overseas", "British Overseas Territories", 1],
  ],
};

/** Share of residents each topic counts (households for homes). */
const UNIVERSE: Record<PeopleTopicId, number> = {
  ethnicity: 1, religion: 1, qualification: 0.82, occupation: 0.55, "economic-activity": 0.82, tenure: 0.44, accommodation: 0.44,
  age: 1, "household-type": 0.44, "country-of-birth": 1,
};

const AREAS: Record<string, { name: string; residents: number; areaKm2: number; missing: PeopleTopicId[] }> = {
  "1": { name: "Westminster preview", residents: 1_620, areaKm2: 0.21, missing: [] },
  "2": { name: "North London preview", residents: 1_480, areaKm2: 0.36, missing: [] },
  "3": { name: "South Bank preview", residents: 1_710, areaKm2: 0.18, missing: ["religion"] },
};
const SCALE = { lsoa: 1, msoa: 5, lad: 130 } as const;
const LONDON_DENSITY = 5_776;

function counts(entries: Array<[string, string, number]>, total: number, seed: number): number[] {
  const weights = entries.map(([, , permille], index) => permille * (1 + 0.6 * Math.sin((seed + 1) * (index + 1) * 1.7)));
  const sum = weights.reduce((a, b) => a + b, 0);
  const rounded = weights.map((weight) => Math.floor((weight / sum) * total));
  const largest = rounded.indexOf(Math.max(...rounded));
  rounded[largest] += total - rounded.reduce((a, b) => a + b, 0);
  return rounded;
}

function topic(id: PeopleTopicId, residents: number, seed: number, missing: boolean): PeopleTopic {
  const entries = CATEGORIES[id];
  const londonTotal = entries.reduce((sum, [, , permille]) => sum + permille, 0);
  const total = Math.round(residents * UNIVERSE[id]);
  const values = missing ? null : counts(entries, total, seed);
  const categories: PeopleCategory[] = entries.map(([key, label, permille], index) => ({
    id: key,
    label,
    count: values ? values[index] : null,
    share: values ? Math.round((values[index] / total) * 10_000) / 10_000 : null,
    regionShare: Math.round((permille / londonTotal) * 10_000) / 10_000,
  }));
  return { id, total: values ? total : null, categories };
}

export function fixtureAreaPeople(id: GeographyId): AreaPeopleResponse | null {
  const match = /^uk:(lsoa|msoa|lad):E0[129]00000([123])$/.exec(id);
  if (!match) return null;
  const kind = match[1] as keyof typeof SCALE;
  const area = AREAS[match[2]];
  const residents = area.residents * SCALE[kind];
  const areaKm2 = Math.round(area.areaKm2 * SCALE[kind] * 1.4 * 1000) / 1000;
  const seed = Number(match[2]) + (kind === "lsoa" ? 0 : kind === "msoa" ? 3 : 6);
  return {
    schemaVersion: "area-people.v1",
    geographyId: id,
    name: area.name,
    kind,
    population: {
      residents,
      year: 2024,
      areaKm2,
      densityPerKm2: Math.round(residents / areaKm2),
      regionDensityPerKm2: LONDON_DENSITY,
      sourceVersion: "preview-population-2024",
    },
    censusYear: 2021,
    topics: (Object.keys(CATEGORIES) as PeopleTopicId[])
      .map((topicId) => topic(topicId, residents, seed, area.missing.includes(topicId))),
    sources: [
      { id: "preview-census-2021", attribution: "Demo figures shaped like ONS Census 2021 tables; not real counts.", caveats: [] },
      { id: "preview-population-2024", attribution: "Demo residents and density; not ONS estimates.", caveats: [] },
    ],
  };
}
