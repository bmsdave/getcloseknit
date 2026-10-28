-- Live, team or tech on every analytics row (area_api.usage.traffic), so the dashboards and reports count
-- real people by default and our own and technical use only through their Traffic filter. Rows are
-- marked, never deleted; a second run changes nothing.
--
-- The cut-over below is the moment the site went public (Caddy recreated with CLOSE_KNIT_ACCESS=public).
-- Before it the web sat behind the preview login, so every web row is the team or invited testers (team),
-- and MCP / agent API use was our own checks, directory scanners and reviewers: team for the client names
-- our checks and Claude Code send, tech for everything else. After it rows keep their classification,
-- improved by the current patterns (usage.TEAM_CLIENT, usage.TECH_CLIENT; a test keeps them equal) and
-- by one rule: a browser id already seen during the preview belongs to the team or a tester.
ALTER TABLE mcp_feedback ADD COLUMN IF NOT EXISTS traffic text NOT NULL DEFAULT 'live'
    CHECK (traffic IN ('live', 'team', 'tech'));
ALTER TABLE profile_analytics_event ADD COLUMN IF NOT EXISTS traffic text NOT NULL DEFAULT 'live'
    CHECK (traffic IN ('live', 'team', 'tech'));
ALTER TABLE site_feedback ADD COLUMN IF NOT EXISTS traffic text NOT NULL DEFAULT 'live'
    CHECK (traffic IN ('live', 'team', 'tech'));

-- product_event: the preview's web rows, and browsers first seen in the preview.
UPDATE product_event SET props = props || '{"traffic": "team"}'
WHERE channel = 'web' AND coalesce(props->>'traffic', 'live') = 'live'
  AND (occurred_at < '2026-10-27T16:07:28Z'
       OR visitor_id IN (SELECT visitor_id FROM product_event
                         WHERE channel = 'web' AND visitor_id IS NOT NULL AND occurred_at < '2026-10-27T16:07:28Z'));

-- product_event: MCP and agent API calls by client name; before the launch nothing stays live.
UPDATE product_event SET props = props || jsonb_build_object('traffic',
        CASE WHEN props->>'client' ~* '^ck-|^(claude-code|board-shots|release-check|doc-check|recheck|check)$' THEN 'team'
             ELSE 'tech' END)
WHERE channel IN ('mcp', 'api')
  AND ((occurred_at < '2026-10-27T16:07:28Z' AND coalesce(props->>'traffic', 'live') = 'live')
       OR (props->>'client' ~* '^ck-|^(claude-code|board-shots|release-check|doc-check|recheck|check)$'
           AND coalesce(props->>'traffic', 'live') <> 'team')
       OR (coalesce(props->>'traffic', 'live') = 'live'
           AND props->>'client' ~* 'probe|bot|scan|crawl|spider|collector|sentinel|inspector|monitor|check|test|smoke|health|curl|wget|python|httpx|postman|insomnia|glama|smithery|lobehub|directory|registry|audit|validat|uptime'));

-- mcp_call_note and mcp_feedback: the same client rules.
UPDATE mcp_call_note SET traffic =
        CASE WHEN client ~* '^ck-|^(claude-code|board-shots|release-check|doc-check|recheck|check)$' THEN 'team' ELSE 'tech' END
WHERE (created_at < '2026-10-27T16:07:28Z' AND traffic = 'live')
   OR (client ~* '^ck-|^(claude-code|board-shots|release-check|doc-check|recheck|check)$' AND traffic <> 'team')
   OR (traffic = 'live'
       AND client ~* 'probe|bot|scan|crawl|spider|collector|sentinel|inspector|monitor|check|test|smoke|health|curl|wget|python|httpx|postman|insomnia|glama|smithery|lobehub|directory|registry|audit|validat|uptime');

UPDATE mcp_feedback SET traffic =
        CASE WHEN client ~* '^ck-|^(claude-code|board-shots|release-check|doc-check|recheck|check)$' THEN 'team' ELSE 'tech' END
WHERE (created_at < '2026-10-27T16:07:28Z' AND traffic = 'live')
   OR (client ~* '^ck-|^(claude-code|board-shots|release-check|doc-check|recheck|check)$' AND traffic <> 'team')
   OR (traffic = 'live'
       AND client ~* 'probe|bot|scan|crawl|spider|collector|sentinel|inspector|monitor|check|test|smoke|health|curl|wget|python|httpx|postman|insomnia|glama|smithery|lobehub|directory|registry|audit|validat|uptime');

-- The web's own tables: the preview's rows are the team's.
UPDATE profile_analytics_event SET traffic = 'team' WHERE created_at < '2026-10-27T16:07:28Z' AND traffic = 'live';
UPDATE site_feedback SET traffic = 'team' WHERE created_at < '2026-10-27T16:07:28Z' AND traffic = 'live';
