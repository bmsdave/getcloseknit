/**
 * /llms.txt (llmstxt.org): an H1, a blockquote summary, then H2 sections of Markdown link lists
 * ("- [Name](url): notes") to the key pages, every URL absolute on the public origin. Pure, so
 * tests/llms-txt.test.ts can check it; app/llms.txt/route.ts supplies the origin and guide titles.
 */
import { AGENT_TABS } from "./agents";
import { areaPath, LONDON, RANKINGS } from "./area-pages";
import { TOOLS } from "./tools";

export interface LlmsTxtInput {
  /** The public origin, no trailing slash (lib/seo.ts › publicOrigin). */
  origin: string;
  /** Every /guide article in order: its path and title. */
  guides: readonly { path: string; title: string }[];
  /** Whether the evidence API is configured (real mode): adds the conduct and agent-tool sections. */
  hasApi: boolean;
}

export function llmsTxt({ origin, guides, hasApi }: LlmsTxtInput): string {
  const link = (name: string, path: string, notes?: string) => `- [${name}](${origin}${path})${notes ? `: ${notes}` : ""}`;
  const lines = [
    "# Close Knit",
    "",
    "> Evidence-backed facts about neighbourhoods: London in depth, England where we have the data. What homes sold for,",
    "> sale prices per square metre, recorded crime, deprivation, income and schools. Ranks compare an area",
    "> with its region. Every number names its source release; demo data is labelled 'not for decisions'.",
    "> No figure states what one home is worth. Where we have no data, the page says so.",
    "",
    "Pages are permanent and linkable. Area pages live at /area/{lsoa|msoa|borough}/{code}, postcodes at",
    "/postcode/{POSTCODE} (every address with its recorded sales) and homes at /property/{uprn}; the map takes ?selected={area id}&layer={metric}.",
    "",
    "## Map and areas",
    link("Map", "/", "the interactive map of areas, with search and Find my area"),
    link("Example map view", "/?selected=uk:lsoa:E01000001&layer=crime", "one area selected, crime layer on"),
    link("England", "/area/england", "every region and local authority the data covers"),
    link("London", areaPath(LONDON), "the city-wide figures and every borough"),
    link("Example borough page", "/area/lad/E09000001", "the City of London: prices, crime, schools, each line cited"),
    link("Example evidence pack", "/area/lad/E09000001/pack",
      "printable: market depth, crime, noise, schools (?address=uk:addr:… adds building and street aggregates)"),
    "",
    "## Guide",
    link("Guide", "/guide", "what each figure means, how it is derived, its sources and licences"),
    ...guides.map((guide) => link(guide.title, guide.path)),
    link("Glossary", "/guide/glossary"),
    "",
    "## Rankings",
    link("Rankings", "/rankings", "London areas ranked by one figure"),
    ...RANKINGS.filter((ranking) => ranking.kind === "metric").map((ranking) => link(ranking.title, `/rankings/${ranking.slug}`)),
    "",
    "## Schools",
    link("Schools", "/schools", "search a London state school, filter by phase, Ofsted and results, top lists and every borough's schools (?borough=hackney)"),
    link("Schools 101", "/guide/schools-101", "how English state schools work: school years, types, Ofsted grades and report cards, results, admissions, key dates"),
    ...RANKINGS.filter((ranking) => ranking.kind === "school" || ranking.kind === "count").map((ranking) => link(ranking.title, `/rankings/${ranking.slug}`)),
    "",
    "## Tools",
    link("Tools", "/tools"),
    ...TOOLS.map((tool) => link(tool.title, `/tools/${tool.slug}`)),
    "",
    "## For agents",
    link("AI agents", "/agents", `set-up steps (the MCP connector ${origin}/mcp) for ${AGENT_TABS.filter((tab) => tab.slug !== "any").map((tab) => tab.label).join(", ")} and any MCP or OpenAPI client`),
    link("MCP server card", "/.well-known/mcp/server.json"),
    link("OpenAPI", "/openapi.json", "the REST mirror of the agent tools, each answer an evidence envelope"),
    link("Metrics", "/api/v1/metrics", "JSON: every figure with its source and latest period"),
    "",
    "## About and policies",
    link("About and sources", "/about", "who runs the site, every data source and its latest period"),
    link("Privacy", "/privacy", "what is published about homes, lawful basis, how to correct or hide a home"),
    link("Terms", "/terms", "not advice, acceptable use and rate limits, reusing the data (licences)"),
    link("CloseKnitBot", "/bot", "the crawler's user agent and how to opt out"),
  ];
  if (hasApi) {
    lines.push(
      "",
      "## Conduct",
      "",
      "Per-home figures are public records; a confirmed objection hides a home everywhere, so a 404 for a known",
      "address is expected. Requests are rate limited per client (429 + Retry-After). Do not compile per-home",
      "data into address lists; cite the release id and caveats you receive. For a home, describe its area's",
      "prices (get_home_prices: areaPrices.range, and the coarse band its last sale fell in), never the home itself.",
      "",
      "## Optional",
      link("JSON evidence for one area", "/api/v1/areas/uk:lsoa:E01000001?metric=crime",
        "also /api/v1/search?q=, /api/v1/addresses/{id}/history, /api/v1/areas/{id}/similar?cheaper="),
      link("Home search with Claude", "/agents",
        "the find-a-home prompt and the tools search_places, find_areas, find_similar_areas, get_area_overview, " +
        "get_listing_search_links, assess_listing and build_watch_spec"),
    );
  }
  return lines.join("\n") + "\n";
}
