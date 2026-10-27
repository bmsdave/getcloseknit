"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { fetchScope, LONDON_SCOPE, publishScope, type ServedScope } from "@/lib/scope";

const ScopeContext = createContext<ServedScope>(LONDON_SCOPE);

/**
 * The served scope for every page (app/layout.tsx), read once per request from GET /api/v1/scope. A server that
 * could not read it (no evidence API here, or no answer) leaves it to the browser, which asks /api/v1/scope once;
 * London's words until then. If that fails too the page says so over everything (ScopeError, DESIGN.md §6) with
 * Try again, rather than passing London's words off as the map's. The scope is published while rendering, before
 * the page below it, so words built outside React (lib/coverage-words.ts) read the same scope on the server and in
 * the browser: the site has one scope (the flag is the deployment's), so this is idempotent.
 */
export function ScopeProvider({ scope: served, children }: { scope: ServedScope | null; children: ReactNode }) {
  const [scope, setScope] = useState<ServedScope>(served ?? LONDON_SCOPE);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    fetchScope().then(setScope).catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    if (!served) load();
  }, [served, load]);
  publishScope(scope);
  return (
    <ScopeContext.Provider value={scope}>
      {failed && <ScopeError onRetry={load} />}
      {children}
    </ScopeContext.Provider>
  );
}

/** The places the site serves did not load: one line over every page, with Try again. */
function ScopeError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="scope-error" role="alert" data-testid="scope-error">
      <p>What the map covers didn&apos;t load.</p>
      <button type="button" className="status-button status-button--primary" data-testid="scope-error-retry" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function useScope(): ServedScope {
  return useContext(ScopeContext);
}
