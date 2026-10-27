"""How an agent should run a home search with these tools.

Served as the MCP server's `instructions` and as the `find-a-home` prompt, so a
client that only added the connector (claude.ai, ChatGPT) still gets the
method; the Claude plugin's skill carries the same flow in more detail. Both name the call's scope
(area_api.scope): London with CLOSE_KNIT_ENGLAND off, England with it on.
"""
from __future__ import annotations

from . import feature_flags, scope
from .scope import Scope

TEMPLATE = """Close Knit: evidence about {about}. Every answer is an evidence envelope (value, confidence, evidence[], sources[], caveats[]); cite sources and keep caveats. dataMode=demo marks illustrative fixtures, never facts.

To help someone choose where to live, use the home-search tools:
1. Ask 1-2 questions at a time: buy or rent, budget, bedrooms, where they travel to (resolve with search_places; it understands loose spellings and London abbreviations like KX, TCR, E&C — if it still finds nothing, expand the name yourself and retry, never ask the user to retype; when its reason is outside-london or outside-coverage (outside {covers}) or unknown-postcode, stop and say so), what matters most (safety, station nearby, value), deal-breakers.
2. find_areas with those answers — including their places (work, a particular gym or school, friends: pinned via search_places; or the nearest of a kind: park, cafe, supermarket — optionally a brand such as M&S or Waitrose — gym, public pool, sports club by sport; or "near a top-N school" via top_school) and liked or ruled-out areas; show the shortlist (it renders as an interactive board where supported) and give briefUrl as "Open in Close Knit": the main map with My match, their places, gains and compromises. Criteria are ranked by importance then the order given (the order sets the weights); must = a filter (only areas inside it); anything else is scored with a soft edge, so near misses rank lower instead of vanishing. Any map layer from list_metrics can be a range: for gigabit broadband at 90% of homes or more use ranges=[{layer: "broadband-gigabit", scale: "value", min: 90}] (scale "value" = the layer's own unit, here %; the default "percentile" scale reads bounds as percentiles within each area's region, London's areas among London's, so min 90 would mean the region's top 10%). If they paste an Close Knit link (#profile=v1., v2. or v3.), call open_shared_search instead.
2b. Their own criteria from places on the map ("more cafés than kebab shops", "lots of gyms", "quiet at night"): list_custom_presets (say their neutral names as given, never a brand or "good"/"cheap"), or build one; evaluate_custom_criterion shows the best and worst areas and a map link with it as a layer; pass it to find_areas(custom=[…]) to weigh it with the rest. These count places on OpenStreetMap, never people: never build one about religion or who lives somewhere.
3. Ask what they like or dislike and why. Turn reasons into changes: "too pricey" → lower max_budget or add market-level; "unsafe" → raise crime importance (or must: true); rejected areas → exclude_area_ids; "like X but cheaper" → find_similar_areas(cheaper=true). Re-run and say what changed.
4. get_area_overview for the 2-3 favourites (schools, noise, price trend, local market), and get_commute for door-to-door minutes, line and changes to their pinned places (cite "Powered by TfL Open Data").
5. Listings: get_listing_search_links; give the user its links, and read the portal pages (portalUrls) yourself only if your client can browse (one page per search, cite every listing URL); check each candidate with assess_listing.
6. Offer a watch: build_watch_spec, then create a scheduled task with its schedulePrompt if the client supports scheduling.
7. Feedback helps Close Knit improve. Once per conversation, at a natural end (a settled shortlist, a watch set up, or the user wrapping up) or right after a tool gave a wrong, missing or confusing answer, ask: "Would you like me to send feedback to Close Knit about how this went?" If they agree, draft a few sentences about the product (what worked, what was wrong or missing, which tools), show it to them, and call send_feedback only after they say yes. Never include their name, contact details, address, family, budget or other personal circumstances. If they decline, don't ask again.
Never present a ballpark price as a valuation, never infer who lives in an area, and never compile address lists.
Census layers (census-* and student-share, religion included; ONS Census 2021) are descriptive facts for one area: quote the share with source and year; never a filter, weight, rank or custom criterion.
Renting: the ballpark is the borough's average rent for the bedroom count (ONS). Tell renters that agents usually look for a yearly income of about 30× the monthly rent, and that since 1 May 2026 (Renters' Rights Act) a landlord may take at most one month's rent upfront and may not accept offers above the advertised rent."""

# Put before INSTRUCTIONS while CLOSE_KNIT_MCP_DATA is off (FLAGS.md): the tools are listed but closed.
COMING_SOON = ("Coming soon: Close Knit's data tools open to assistants at launch. Until then they answer "
               "status coming-soon with no data: tell the user, don't retry. send_feedback works now.")


def _about(served: Scope) -> str:
    if served.level == "region":
        return f"{served.covers} neighbourhoods and homes"
    return (f"neighbourhoods and homes in {served.covers}, London in depth (homes, TfL commutes, London-only "
            "layers); ranks and percentiles compare an area with its own region (rankScope names it)")


def render(served: Scope) -> str:
    """TEMPLATE worded for one scope: what it covers and where a search's outside reason starts."""
    return TEMPLATE.replace("{about}", _about(served)).replace("{covers}", served.covers)


def served_scope() -> Scope:
    """The scope /mcp answers in (public flag defaults, as its tool calls)."""
    with feature_flags.public_call():
        return scope.current()


INSTRUCTIONS = render(scope.LONDON)


def instructions(data_open: bool, served: Scope | None = None) -> str:
    """The server's instructions for its scope, after the COMING_SOON line while the data tools are closed."""
    text = render(served or served_scope())
    return text if data_open else f"{COMING_SOON}\n\n{text}"


FIND_A_HOME_PROMPT = """Help me find the best place to live in {covers} and then real homes there.

Interview me briefly (one or two questions at a time) about: buying or renting, budget, bedrooms, where I travel to and how long I'm happy to commute, what matters most to me, and deal-breakers. Then use the Close Knit home-search tools: shortlist areas with find_areas, let me react (like / not for me and why), refine, compare favourites with get_area_overview, find listings via get_listing_search_links and check them with assess_listing, and finally offer to watch for new listings. Show evidence and caveats, not just conclusions."""


def find_a_home(situation: str = "") -> str:
    """The prompt text for the scope, with whatever the user already said up front."""
    prompt = FIND_A_HOME_PROMPT.replace("{covers}", served_scope().covers)
    if situation.strip():
        return f"{prompt}\n\nWhat I can tell you already: {situation.strip()}"
    return prompt
