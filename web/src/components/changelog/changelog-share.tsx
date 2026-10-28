"use client";

import { useEffect, useState } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";
import { mastodonHost, mastodonShareUrl, shareUrls } from "@/lib/changelog";

const SERVER_KEY = "close-knit:mastodon-server";

/**
 * Share one entry (board KHt56r65): Copy link, then X, Bluesky and Mastodon. Each opens the network's own compose
 * page only when clicked; nothing loads from them before. Mastodon asks for the reader's server (kept in this
 * browser only). No Meta products.
 */
export function ChangelogShare({ url, text }: { url: string; text: string }) {
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const [mastodonOpen, setMastodonOpen] = useState(false);
  const [server, setServer] = useState("mastodon.social");
  const [serverError, setServerError] = useState(false);
  const links = shareUrls(text, url);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SERVER_KEY);
      if (saved) setServer(saved);
    } catch {
      // Storage blocked: the default server stays.
    }
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  function shareToMastodon() {
    const host = mastodonHost(server);
    setServerError(!host);
    if (!host) return;
    try {
      window.localStorage.setItem(SERVER_KEY, host);
    } catch {
      // Not remembered; the share still opens.
    }
    window.open(mastodonShareUrl(host, text, url), "_blank", "noopener,noreferrer");
  }

  return (
    <aside className="changelog-share" aria-label="Share" data-testid="changelog-share">
      <span className="changelog-eyebrow">Share</span>
      <button type="button" className="primary-action changelog-share__copy" onClick={() => void copy()} data-testid="changelog-copy">
        <KnitIcon name="arrow-out" className="changelog-share__icon" />Copy link
      </button>
      <div className="changelog-share__row">
        <a href={links.x} target="_blank" rel="noopener noreferrer" data-testid="changelog-share-x">X</a>
        <a href={links.bluesky} target="_blank" rel="noopener noreferrer" data-testid="changelog-share-bluesky">Bluesky</a>
        <button type="button" aria-expanded={mastodonOpen} aria-controls="changelog-mastodon"
          onClick={() => setMastodonOpen((open) => !open)} data-testid="changelog-share-mastodon">Mastodon</button>
      </div>
      {mastodonOpen && (
        <form id="changelog-mastodon" className="changelog-share__mastodon" onSubmit={(event) => { event.preventDefault(); shareToMastodon(); }}>
          <label htmlFor="changelog-mastodon-server">Your server</label>
          <div>
            <input id="changelog-mastodon-server" className="knit-field" value={server} inputMode="url" autoComplete="off"
              spellCheck={false} aria-invalid={serverError} onChange={(event) => setServer(event.target.value)} />
            <button type="submit">Share</button>
          </div>
          {serverError && <p role="alert">Type a server, like mastodon.social.</p>}
        </form>
      )}
      <div className="changelog-share__status" role="status">
        {copied === "copied" && <p>Link copied.</p>}
        {copied === "failed" && <p>Copy this link: {url}</p>}
      </div>
    </aside>
  );
}
