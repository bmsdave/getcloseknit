import assert from "node:assert/strict";
import test from "node:test";

import { leavesPage } from "../src/components/use-explorer-controller";

const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
const here = { origin: "https://example.test", pathname: "/" };
const anchor = (href: string, target = "", download = false) => ({ href, target, hasAttribute: (name: string) => name === "download" && download });

test("a plain click on a link to another page of the site leaves the map", () => {
  assert.equal(leavesPage(anchor("https://example.test/guide/demo-vs-real"), click, here), true);
});

test("same page, new tabs, modified clicks, downloads and other sites keep the map", () => {
  assert.equal(leavesPage(anchor("https://example.test/?layer=crime"), click, here), false);
  assert.equal(leavesPage(anchor("https://example.test/guide", "_blank"), click, here), false);
  assert.equal(leavesPage(anchor("https://example.test/guide"), { ...click, metaKey: true }, here), false);
  assert.equal(leavesPage(anchor("https://example.test/guide"), { ...click, defaultPrevented: true }, here), false);
  assert.equal(leavesPage(anchor("https://example.test/file.csv", "", true), click, here), false);
  assert.equal(leavesPage(anchor("https://other.test/guide"), click, here), false);
});
