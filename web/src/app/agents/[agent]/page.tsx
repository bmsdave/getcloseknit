import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { agentPath, isAgentSlug } from "@/lib/agents";

import { AgentsHub, agentsMetadata } from "../agents-hub";

export const dynamic = "force-dynamic";

interface AgentTabProps {
  params: Promise<{ agent: string }>;
}

export async function generateMetadata({ params }: AgentTabProps): Promise<Metadata> {
  const { agent } = await params;
  return isAgentSlug(agent) ? agentsMetadata(agent) : {};
}

/** /agents/<app> for every app but Claude: /agents/claude is /agents itself. */
export default async function AgentTabPage({ params }: AgentTabProps) {
  const { agent } = await params;
  if (!isAgentSlug(agent)) notFound();
  if (agent === "claude") permanentRedirect(agentPath(agent));
  return <AgentsHub slug={agent} />;
}
