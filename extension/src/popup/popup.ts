import { apiBase, ext } from "../api";
import { loadSettings, settingsArea, type Area } from "../settings";
import type { ExtensionState } from "../types";

const enabled = document.getElementById("enabled") as HTMLInputElement;
const profile = document.getElementById("profile") as HTMLElement;

async function call(message: unknown): Promise<ExtensionState> {
  return (await ext.runtime.sendMessage(message)) as ExtensionState;
}

function draw(state: ExtensionState): void {
  enabled.checked = state.enabled;
  const line = document.createElement("p");
  const action = document.createElement(state.hasProfile ? "button" : "a") as HTMLButtonElement | HTMLAnchorElement;
  action.className = "button";
  if (state.hasProfile) {
    const date = state.profileSavedAt ? new Date(state.profileSavedAt).toLocaleDateString("en-GB") : "";
    line.textContent = `Cards show how each area fits your Close Knit search${date ? ` (updated ${date})` : ""}. It follows changes you make there.`;
    action.textContent = "Stop using my search";
    action.addEventListener("click", async () => draw(await call({ type: "forget-profile" })));
  } else {
    line.textContent = state.optedOut
      ? "Cards show area facts only. Your Close Knit search is not used here."
      : "Set up your search on Close Knit, then press “Use it” there to see your match on listings.";
    action.textContent = state.optedOut ? "Use my Close Knit search" : "Open Close Knit";
    (action as HTMLAnchorElement).href = `${apiBase}/?utm_source=extension`;
    (action as HTMLAnchorElement).target = "_blank";
    // Opening the site after opting back in brings the offer back there.
    if (state.optedOut) action.addEventListener("click", () => void call({ type: "opt-in" }));
  }
  profile.replaceChildren(line, action);
}

enabled.addEventListener("change", async () => draw(await call({ type: "set-enabled", enabled: enabled.checked })));
void call({ type: "state" }).then(draw);

document.getElementById("settings")!.addEventListener("click", () => void ext.runtime.openOptionsPage());
void loadSettings(settingsArea(ext.storage as unknown as { sync?: Area; local: Area })).then((settings) => {
  document.getElementById("no-consent")!.hidden = settings.sendListing;
});

// Chrome's side panel opens from this click; the window is known beforehand so nothing is awaited inside it.
const sidePanel = (ext as { sidePanel?: typeof chrome.sidePanel }).sidePanel;
if (sidePanel) {
  const button = document.getElementById("panel")!;
  void ext.windows.getCurrent().then((win) => {
    if (win.id === undefined) return;
    button.hidden = false;
    button.addEventListener("click", () => {
      void sidePanel.open({ windowId: win.id! }).then(() => window.close());
    });
  });
}
