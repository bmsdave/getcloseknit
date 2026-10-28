-- claude-code after the public launch is people using the Close Knit plugin: live unless the call carried
-- the team header (X-Close-Knit-Team: 1). Migration 136 marked those calls team by client name; this puts
-- back the ones that were live before it ran. The window ends when 136 was applied on production: until then
-- the code marked claude-code team only for the header, and every post-launch claude-code row was still live
-- (checked against the pre-136 backup), so none of these carried it. Rows written after 136 cannot be told
-- apart and are kept as they are. Before the launch claude-code stays team (the preview's own sessions).
-- A second run changes nothing.
UPDATE product_event SET props = props - 'traffic'
WHERE channel IN ('mcp', 'api') AND props->>'client' = 'claude-code' AND props->>'traffic' = 'team'
  AND occurred_at >= '2026-10-27T16:07:28Z' AND occurred_at < '2026-10-28T09:49:00Z';

UPDATE mcp_call_note SET traffic = 'live'
WHERE client = 'claude-code' AND traffic = 'team'
  AND created_at >= '2026-10-27T16:07:28Z' AND created_at < '2026-10-28T09:49:00Z';

UPDATE mcp_feedback SET traffic = 'live'
WHERE client = 'claude-code' AND traffic = 'team'
  AND created_at >= '2026-10-27T16:07:28Z' AND created_at < '2026-10-28T09:49:00Z';
