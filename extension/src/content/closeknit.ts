// On the Close Knit site: offer to use this browser's saved search on the portals. Nothing moves
// until the reader presses "Use it"; the search then lives in the extension's own storage.
import { ext } from "../api";
import { mountHost, send } from "./host";

const PROFILE_STORAGE_KEY = "close-knit.preference-profile.v1"; // web/src/lib/profile-state.ts
const HOST_ID = "close-knit-extension-offer";
const CHECK_MS = 2000;

let offered: string | null = null;

function savedProfile(): { raw: string; profile: unknown } | null {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    return raw ? { raw, profile: JSON.parse(raw) as unknown } : null;
  } catch {
    return null;
  }
}

async function check(): Promise<void> {
  const saved = savedProfile();
  if (!saved || saved.raw === offered) return;
  offered = saved.raw;
  const answer = await send<"offer" | "same" | "synced" | "dismissed">({ type: "offer-profile", profile: saved.profile });
  if (answer === "offer") showOffer(saved.profile);
}

function showOffer(profile: unknown): void {
  const root = mountHost(HOST_ID);
  const h = (tag: string, className?: string, text?: string) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const shell = h("div", "ck bar");
  shell.setAttribute("data-testid", "close-knit-offer");
  const card = h("section", "card");
  const brand = h("div", "brand");
  const img = document.createElement("img");
  img.src = ext.runtime.getURL("icons/icon.svg");
  img.alt = "";
  brand.append(img, h("span", "wordmark", "close knit extension"));
  const text = h("p", "muted", "Use this search on Rightmove, Zoopla, OnTheMarket, SpareRoom and OpenRent? Listings will show how each area fits it.");
  text.style.margin = "0";
  const actions = h("div", "actions");
  const use = h("button", "button primary", "Use it") as HTMLButtonElement;
  const later = h("button", "button", "Not now") as HTMLButtonElement;
  use.type = "button";
  later.type = "button";
  use.addEventListener("click", async () => {
    await send({ type: "set-profile", profile });
    actions.replaceChildren(h("span", "muted", "Done. Your next listing shows your match."));
    setTimeout(() => shell.remove(), 4000);
  });
  later.addEventListener("click", async () => {
    await send({ type: "dismiss-profile", profile });
    shell.remove();
  });
  actions.append(use, later);
  card.append(brand, text, actions);
  shell.append(card);
  root.replaceChildren(root.querySelector("style")!, shell);
}

// v4 Task 9: tells the site the extension is here, so its portal links carry the My match search id
// (web/src/lib/portal-zones.ts extensionInstalled; the id arrives on the portal as #closeknit=<id>).
document.documentElement.setAttribute("data-close-knit-extension", "1");

void check();
setInterval(() => void check(), CHECK_MS);
