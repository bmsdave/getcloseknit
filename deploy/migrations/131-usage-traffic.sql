-- Whose use a usage row is (area_api.usage.traffic): live, team (Close Knit's own checks and visits) or
-- tech (scanners, probes and scripts). product_event keeps it in props.traffic (missing = live);
-- mcp_call_note gets a column. The dashboards' Traffic box filters on it, live only by default.
ALTER TABLE mcp_call_note ADD COLUMN IF NOT EXISTS traffic text NOT NULL DEFAULT 'live'
    CHECK (traffic IN ('live', 'team', 'tech'));

-- Rows from before the marking, told by the MCP client name as usage.traffic does (TEAM_CLIENT,
-- TECH_CLIENT; a test keeps the patterns equal). claude-code before 2026-10-28 was the team's own
-- development sessions; since then the team header (X-Close-Knit-Team: 1) marks those.
UPDATE product_event SET props = props || jsonb_build_object('traffic', CASE
        WHEN props->>'client' ~* '^ck-' OR props->>'client' = 'board-shots'
          OR (props->>'client' = 'claude-code' AND occurred_at < '2026-10-28') THEN 'team'
        ELSE 'tech' END)
WHERE channel IN ('mcp', 'api') AND props ? 'client' AND NOT props ? 'traffic'
  AND (props->>'client' ~* '^ck-' OR props->>'client' = 'board-shots'
       OR (props->>'client' = 'claude-code' AND occurred_at < '2026-10-28')
       OR props->>'client' ~* 'probe|bot|scan|crawl|spider|collector|sentinel|inspector|monitor|check|test|smoke|health|curl|wget|python|httpx|postman|insomnia');

UPDATE mcp_call_note SET traffic = CASE WHEN client ~* '^ck-' THEN 'team' ELSE 'tech' END
WHERE traffic = 'live'
  AND (client ~* '^ck-'
       OR client ~* 'probe|bot|scan|crawl|spider|collector|sentinel|inspector|monitor|check|test|smoke|health|curl|wget|python|httpx|postman|insomnia');
