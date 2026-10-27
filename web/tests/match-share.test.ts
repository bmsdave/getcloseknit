import assert from "node:assert/strict";
import test from "node:test";

import { shareLink } from "../src/components/match/share-link";

const URL = "https://getcloseknit.com/?layer=personal-match#profile=v1.abc";

function withNavigator(value: unknown, run: () => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value, configurable: true });
  return run().finally(() => { if (original) Object.defineProperty(globalThis, "navigator", original); });
}

test("share uses the share sheet first, then the clipboard, and hands back the link when both fail", async () => {
  const shared: string[] = [];
  await withNavigator({ share: async (data: { url: string }) => { shared.push(data.url); } }, async () => {
    assert.deepEqual(await shareLink(URL, "t"), { kind: "shared" });
  });
  assert.deepEqual(shared, [URL]);

  const copied: string[] = [];
  await withNavigator({ clipboard: { writeText: async (text: string) => { copied.push(text); } } }, async () => {
    assert.deepEqual(await shareLink(URL, "t"), { kind: "copied" });
  });
  assert.deepEqual(copied, [URL]);

  // A share sheet that is not allowed here falls back to the clipboard; a cancelled one stops.
  await withNavigator({ share: async () => { throw new DOMException("no", "NotAllowedError"); },
    clipboard: { writeText: async () => undefined } }, async () => {
    assert.deepEqual(await shareLink(URL, "t"), { kind: "copied" });
  });
  await withNavigator({ share: async () => { throw new DOMException("no", "AbortError"); } }, async () => {
    assert.deepEqual(await shareLink(URL, "t"), { kind: "cancelled" });
  });
  await withNavigator({ clipboard: { writeText: async () => { throw new Error("denied"); } } }, async () => {
    assert.deepEqual(await shareLink(URL, "t"), { kind: "failed", url: URL });
  });
  await withNavigator({}, async () => {
    assert.deepEqual(await shareLink(URL, "t"), { kind: "failed", url: URL });
  });
});
