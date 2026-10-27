import type { GeographyId, PreferenceProfile } from "./contracts";
import { londonWord } from "./coverage-words";
import { encodeSharedProfile } from "./profile-state";

export type Assistant = "claude" | "chatgpt";

const OPEN: Record<Assistant, (prompt: string) => string> = {
  claude: (prompt) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
  chatgpt: (prompt) => `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`,
};

/** A new conversation in the assistant with `prompt` filled in (the watch sheet's "Open in Claude"). */
export function assistantUrl(assistant: Assistant, prompt: string): string {
  return OPEN[assistant](prompt);
}

/** The search as a link the assistant can open with the Close Knit tools (open_shared_search). */
export function searchLink(origin: string, profile: PreferenceProfile, selected: GeographyId | null): string {
  const query = `layer=personal-match${selected ? `&selected=${encodeURIComponent(selected)}` : ""}`;
  return `${origin.replace(/\/+$/, "")}/?${query}${encodeSharedProfile(profile)}`;
}

export function discussPrompt(link: string): string {
  return `Here's my ${londonWord()}home search in Close Knit: ${link}\n\n`
    + "Open it with the Close Knit tools (open_shared_search) and help me choose: what do my top areas "
    + "gain and give up, which compromise is worth it, and what should I look at next?";
}

/** Where to open the conversation; the prompt (with the link) is the only thing sent. */
export function discussUrl(assistant: Assistant, origin: string, profile: PreferenceProfile, selected: GeographyId | null): string {
  return OPEN[assistant](discussPrompt(searchLink(origin, profile, selected)));
}
