import { ext } from "../api";
import { CARD_CSS, SUMMARY_CSS, fontFaceCss } from "../render/styles";
import { placeAfter } from "./anchors";

const hosts = new Set<HTMLElement>();
/** Inline hosts and how to find the element each goes after. */
const inline = new Map<HTMLElement, () => Element | null>();

// Portals built on React (Zoopla) drop nodes they did not render when they hydrate or re-render
// the document, so our hosts are put back: floating ones on the document, inline ones after their anchor.
setInterval(() => {
  for (const host of hosts) if (!host.isConnected) document.documentElement.append(host);
  for (const [host, find] of inline) {
    if (host.isConnected) continue;
    const anchor = find();
    if (anchor) placeAfter(anchor, host);
  }
}, 1000);

/** A shadow root on the page for our UI, so the portal's styles and ours never mix. */
export function mountHost(id: string): ShadowRoot {
  const existing = document.getElementById(id);
  if (existing?.shadowRoot) return existing.shadowRoot;
  const { host, root } = createHost(id, CARD_CSS);
  document.documentElement.append(host);
  hosts.add(host);
  return root;
}

/**
 * A shadow root in the page's own flow, right after the element ``find`` returns (the portal's price), kept
 * there when the page re-renders. Null when there is no such element: the caller keeps the side card only.
 */
export function mountInline(id: string, find: () => Element | null): ShadowRoot | null {
  const anchor = find();
  const existing = document.getElementById(id);
  if (!anchor) {
    unmountInline(id);
    return null;
  }
  if (existing?.shadowRoot) {
    placeAfter(anchor, existing);
    inline.set(existing, find);
    return existing.shadowRoot;
  }
  const { host, root } = createHost(id, SUMMARY_CSS);
  placeAfter(anchor, host);
  inline.set(host, find);
  return root;
}

export function unmountInline(id: string): void {
  const host = document.getElementById(id);
  if (!host) return;
  inline.delete(host);
  host.remove();
}

function createHost(id: string, css: string): { host: HTMLElement; root: ShadowRoot } {
  if (!document.getElementById("close-knit-font")) {
    // @font-face only works from the document, not inside a shadow root.
    const font = document.createElement("style");
    font.id = "close-knit-font";
    font.textContent = fontFaceCss(ext.runtime.getURL("fonts/BricolageGrotesque-latin.woff2"));
    document.head.append(font);
  }
  const host = document.createElement("div");
  host.id = id;
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  root.append(style);
  return { host, root };
}

export function send<T>(message: unknown): Promise<T | null> {
  return (ext.runtime.sendMessage(message) as Promise<T | null>).catch(() => null);
}
