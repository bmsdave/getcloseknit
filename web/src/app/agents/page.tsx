import { AgentsHub, agentsMetadata } from "./agents-hub";

// The MCP address comes from the deployment environment at request time, not from the build.
export const dynamic = "force-dynamic";

export const metadata = agentsMetadata("claude");

export default function AgentsPage() {
  return <AgentsHub slug="claude" />;
}
