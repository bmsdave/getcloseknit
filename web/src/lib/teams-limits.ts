/**
 * The API and MCP rate limits as About › For teams states them: the defaults of
 * api/area_api/ratelimit.py (DEFAULT_LIMITS; a deployment may tighten them
 * with CLOSE_KNIT_RATE_<CLASS>). tests/teams.test.ts reads that file and fails
 * when the two drift apart.
 */
export interface RateLimitRow {
  /** The class name in ratelimit.py. */
  id: "default" | "discovery" | "assistant_init" | "bulk" | "hizoom" | "detail" | "download" | "report" | "render";
  label: string;
  minute?: number;
  hour?: number;
  day?: number;
}

export const RATE_LIMITS: RateLimitRow[] = [
  { id: "default", label: "Most API and MCP requests", minute: 120, hour: 2000, day: 10000 },
  { id: "discovery", label: "Agents listing our MCP tools (tool list, server card)", minute: 600, hour: 6000, day: 30000 },
  { id: "assistant_init", label: "New MCP sessions opened by ChatGPT or Claude for their users", minute: 300, hour: 3000, day: 30000 },
  { id: "detail", label: "One home's details, sales history or nearby sales", minute: 30, hour: 300, day: 1000 },
  { id: "bulk", label: "Map tiles below street zoom", minute: 600, hour: 6000 },
  { id: "hizoom", label: "Homes and sales at street zoom", minute: 200, hour: 600, day: 1000 },
  { id: "download", label: "Whole-database downloads", minute: 2, hour: 4, day: 10 },
  { id: "report", label: "Reports of a wrong figure", minute: 5, day: 20 },
  { id: "render", label: "Area pages opened (each counts once, whatever it reads)", minute: 30, hour: 600, day: 3000 },
];

/** Searches, rankings and matches (EXPENSIVE in ratelimit.py) count as this many requests. */
export const EXPENSIVE_COST = 10;
