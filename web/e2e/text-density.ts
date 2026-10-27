import type { Page } from "./fixtures";

// Copy rule for the area panel: no visible paragraph over 25 words. Folded
// <details> content and paragraphs marked [data-allow-prose] (the empty-area
// state, errors) are exempt. Returns each offending paragraph's opening words.
export async function longParagraphs(page: Page, maxWords = 25): Promise<string[]> {
  return page.evaluate((limit) => {
    const long: string[] = [];
    for (const paragraph of document.querySelectorAll<HTMLElement>(".evidence-panel p")) {
      if (paragraph.closest("details, [data-allow-prose]")) continue;
      if (paragraph.getClientRects().length === 0) continue;
      const words = (paragraph.innerText ?? "").trim().split(/\s+/).filter(Boolean);
      if (words.length > limit) long.push(`${words.length} words: ${words.slice(0, 8).join(" ")}…`);
    }
    return long;
  }, maxWords);
}
