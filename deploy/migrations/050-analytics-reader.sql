-- A read-only role for the internal analytics UI (Grafana, docker-compose.prod.yml profile
-- "analytics", reached only through an SSH tunnel; docs/product-analytics.md). It reads the
-- usage tables and nothing else: no homes, objections, invites or releases. NOLOGIN here;
-- deploy/tools/grafana-role.sh gives it a login with the password from deploy/.env.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'close_knit_analytics') THEN
        CREATE ROLE close_knit_analytics NOLOGIN;
    END IF;
END
$$;

ALTER ROLE close_knit_analytics SET default_transaction_read_only = on;
ALTER ROLE close_knit_analytics SET statement_timeout = '30s';
GRANT USAGE ON SCHEMA public TO close_knit_analytics;
GRANT SELECT ON product_event, profile_analytics_event, mcp_feedback TO close_knit_analytics;
