import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ScopeProvider, useScope } from "../src/components/scope-context";
import { coversEngland as wordsCoverEngland, rankPlace } from "../src/lib/coverage-words";
import { coversEngland, fetchScope, isScope, loadedScope, LONDON_SCOPE, publishScope, type ServedScope } from "../src/lib/scope";

const ENGLAND: ServedScope = {
  schemaVersion: "scope.v1", id: "uk:nation:E92000001", level: "nation", name: "England",
  served: [{ id: "uk:region:E12000002", code: "E12000002", name: "North West" }],
  bbox: [-6.45, 49.86, 1.77, 55.82], outsideReason: "outside-coverage",
};

function Name() {
  return createElement("span", null, useScope().name);
}

test("the served scope is London's or England's, by its level", () => {
  assert.ok(isScope(LONDON_SCOPE) && isScope(ENGLAND));
  assert.ok(!isScope({ coverage: "england" }));
  assert.equal(coversEngland(LONDON_SCOPE), false);
  assert.equal(coversEngland(ENGLAND), true);
});

test("the layout's scope reaches the page and the words built outside React", () => {
  try {
    assert.equal(renderToStaticMarkup(createElement(ScopeProvider, { scope: ENGLAND, children: createElement(Name) })),
      "<span>England</span>");
    assert.equal(loadedScope(), ENGLAND);
    assert.equal(wordsCoverEngland(), true);
    assert.equal(rankPlace(), "its region");
    // A server that could not tell: London's words until the browser asks.
    assert.equal(renderToStaticMarkup(createElement(ScopeProvider, { scope: null, children: createElement(Name) })),
      "<span>London</span>");
    assert.equal(rankPlace(), "London");
  } finally {
    publishScope(LONDON_SCOPE);
  }
});

test("the browser asks the site's /api/v1/scope and refuses anything else", async () => {
  const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  assert.deepEqual(await fetchScope(answer(200, ENGLAND)), ENGLAND);
  await assert.rejects(fetchScope(answer(503, null)), /scope unavailable \(HTTP 503\)/);
  await assert.rejects(fetchScope(answer(200, { coverage: "england" })), /scope unavailable/);
});
