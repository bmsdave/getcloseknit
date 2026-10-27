// The first-run screen and Settings (2026-10-18-extension-legal-strategy.md §3): each change is saved at once.
import { apiBase, ext } from "../api";
import { loadSettings, PORTAL_NAMES, PORTALS, saveSettings, settingsArea, type Area, type Settings, type UserMode } from "../settings";

const area = settingsArea(ext.storage as unknown as { sync?: Area; local: Area });
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const FLAGS = ["sendListing", "demandStats", "analytics"] as const;
const BUYER_NUMBERS = ["depositPct", "ratePct", "years"] as const;
const BUYER_FLAGS = ["firstTime", "additionalHome"] as const;

let settings: Settings;

function draw(): void {
  const body = $("portals").querySelector("tbody")!;
  body.replaceChildren(...PORTALS.map((portal) => {
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = PORTAL_NAMES[portal];
    row.append(name);
    for (const mode of ["side-panel", "inline"] as UserMode[]) {
      const cell = document.createElement("td");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `mode-${portal}`;
      input.value = mode;
      input.checked = settings.portals[portal] === mode;
      input.setAttribute("aria-label", `${PORTAL_NAMES[portal]}: ${mode === "inline" ? "on the page" : "panel beside the page"}`);
      input.addEventListener("change", () => void save({ ...settings, portals: { ...settings.portals, [portal]: mode } }));
      cell.append(input);
      row.append(cell);
    }
    return row;
  }));
  for (const key of FLAGS) $<HTMLInputElement>(key).checked = settings[key];
  $("sendListing-off").hidden = settings.sendListing;
  for (const key of BUYER_NUMBERS) $<HTMLInputElement>(key).value = String(settings.buyer[key]);
  for (const key of BUYER_FLAGS) $<HTMLInputElement>(key).checked = settings.buyer[key];
}

async function save(next: Settings): Promise<void> {
  settings = await saveSettings(area, next);
  draw();
  $("saved").textContent = "Saved";
}

for (const key of FLAGS) {
  $<HTMLInputElement>(key).addEventListener("change", (event) =>
    void save({ ...settings, [key]: (event.target as HTMLInputElement).checked }));
}
for (const key of BUYER_NUMBERS) {
  $<HTMLInputElement>(key).addEventListener("change", (event) =>
    void save({ ...settings, buyer: { ...settings.buyer, [key]: Number((event.target as HTMLInputElement).value) } }));
}
for (const key of BUYER_FLAGS) {
  $<HTMLInputElement>(key).addEventListener("change", (event) =>
    void save({ ...settings, buyer: { ...settings.buyer, [key]: (event.target as HTMLInputElement).checked } }));
}

$<HTMLAnchorElement>("privacy").href = `${apiBase}/privacy`;
$("no-side-panel").hidden = typeof (ext as { sidePanel?: unknown }).sidePanel !== "undefined";
$("done").addEventListener("click", async () => {
  const tab = await ext.tabs.getCurrent().catch(() => undefined);
  if (tab?.id !== undefined) await ext.tabs.remove(tab.id);
  else window.close();
});

void loadSettings(area).then((loaded) => {
  settings = loaded;
  // The first visit stores the defaults, so the choices shown are the ones in use.
  void saveSettings(area, loaded);
  draw();
});
