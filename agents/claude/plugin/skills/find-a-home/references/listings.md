# Finding real listings

Close Knit never fetches, stores or ranks listings. You find them on the user's behalf on the
public portal pages, and use Close Knit to judge them.

## Steps

1. `get_listing_search_links(area_ids=[favourites], market, max_price, min_bedrooms)` → one search
   per postcode district with Rightmove, Zoopla, OnTheMarket (and OpenRent for rentals) links,
   already filtered.
2. If you can fetch public web pages: open each
   search page once and read the listings on it. One page per search; no crawling through
   pagination unless the user asks; no logging in; respect a site that blocks you and tell the user.
   If you cannot browse, give the user the links as a short list and ask them to paste the
   listings they like.
3. A postcode district (e.g. W13) is wider than the shortlisted neighbourhood. Keep listings whose
   postcode or map position is in or next to the favourite areas; note the others as "nearby".
4. For each promising listing with a full postcode: `assess_listing(postcode, asking_price,
   bedrooms, floor_area_sqm if stated, tenure, listing_url)`. Present a compact table: price,
   beds, postcode, verdict (below / in line / above local prices), one line of why, and the link.
5. Pass on the `questions` from `assess_listing` for the user's favourite — those are what to ask
   the estate agent (lease length, service charge, EWS1, EPC).

## Also check estate agents directly

Local agents often list homes before (or instead of) the portals. If the user wants more reach,
search the web for "estate agents <postcode district>" or "letting agents <neighbourhood>", and
look at the agents' own "for sale"/"to let" pages the same way: one page each, cite the URL.

## What to say about prices

- "Below local prices" can mean a bargain or a problem (short lease, ground floor on a main road,
  needs work). Say both.
- Asking prices are not achieved prices; the evidence is recorded sales.
- Rentals: no rental evidence is loaded, so compare listings against each other instead.
