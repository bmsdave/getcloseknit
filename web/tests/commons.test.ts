import assert from "node:assert/strict";
import test from "node:test";

import { nearbyCommonsPhotos, parseCommonsPhotos, plainText, tidyTitle } from "../src/lib/commons";

function page(index: number, overrides: { title?: string; licence?: string; artist?: string | null; mime?: string;
  thumb?: string; objectName?: string } = {}): Record<string, unknown> {
  const title = overrides.title ?? "File:Hackney Empire, Mare Street.JPG";
  return {
    pageid: 6841178 + index, ns: 6, title, index,
    imageinfo: [{
      mime: overrides.mime ?? "image/jpeg",
      thumburl: overrides.thumb ?? "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/32/Hackney_Empire.JPG/330px-Hackney_Empire.JPG?utm_source=commons.wikimedia.org",
      thumbwidth: 320, thumbheight: 240,
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Hackney_Empire,_Mare_Street.JPG",
      extmetadata: {
        LicenseShortName: { value: overrides.licence ?? "CC BY-SA 3.0" },
        LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/3.0" },
        ...(overrides.artist === null ? {} : {
          Artist: { value: overrides.artist ?? "<a href=\"//commons.wikimedia.org/wiki/User:Cjc13\" title=\"User:Cjc13\">Cjc13</a>" },
        }),
        ...(overrides.objectName ? { ObjectName: { value: overrides.objectName } } : {}),
      },
    }],
  };
}

test("parseCommonsPhotos credits the author and licence, nearest first, without tracking parameters", () => {
  const photos = parseCommonsPhotos({ query: { pages: [page(1, { title: "File:Second.jpg" }), page(-1)] } }, 4);
  assert.deepEqual(photos.map((photo) => photo.title), ["Hackney Empire, Mare Street", "Second"]);
  assert.deepEqual(photos[0], {
    id: "6841177",
    title: "Hackney Empire, Mare Street",
    author: "Cjc13",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Hackney_Empire,_Mare_Street.JPG",
    imageUrl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/32/Hackney_Empire.JPG/330px-Hackney_Empire.JPG",
    width: 320, height: 240,
    licence: "CC BY-SA 3.0",
    licenceUrl: "https://creativecommons.org/licenses/by-sa/3.0",
    geographId: null,
  });
});

test("parseCommonsPhotos keeps free licences only and needs an author unless public domain", () => {
  const photos = parseCommonsPhotos({ query: { pages: [
    page(0, { licence: "CC BY-NC 2.0" }),
    page(1, { licence: "GFDL" }),
    page(2, { artist: null }),
    page(3, { mime: "image/png" }),
    page(4, { thumb: "https://example.com/x.jpg" }),
    page(5, { licence: "Public domain", artist: null, title: "File:Old map.jpg" }),
    page(6, { licence: "CC BY 2.0", title: "File:Kept.jpg" }),
  ] } }, 4);
  assert.deepEqual(photos.map((photo) => [photo.title, photo.author]), [["Old map", null], ["Kept", "Cjc13"]]);
});

test("parseCommonsPhotos spots Geograph copies so their links are not repeated", () => {
  const [photo] = parseCommonsPhotos({ query: { pages: [
    page(0, { title: "File:Hackney Town Hall - geograph.org.uk - 4914.jpg", licence: "CC BY-SA 2.0" }),
  ] } }, 4);
  assert.equal(photo.title, "Hackney Town Hall");
  assert.equal(photo.geographId, "4914");
});

test("parseCommonsPhotos shows one photo per title", () => {
  const photos = parseCommonsPhotos({ query: { pages: [
    page(0, { title: "File:Hackney Town Hall - geograph.org.uk - 4914.jpg" }),
    page(1, { title: "File:hackney town hall.jpg" }),
    page(2, { title: "File:Mare Street.jpg" }),
  ] } }, 4);
  assert.deepEqual(photos.map((photo) => photo.title), ["Hackney Town Hall", "Mare Street"]);
});

test("plainText and tidyTitle", () => {
  assert.equal(plainText("<a href=\"x\">Vic &amp; Jo</a>\n<i>(talk)</i>"), "Vic & Jo (talk)");
  assert.equal(plainText("<span></span>"), null);
  assert.equal(tidyTitle("Flickr - Duncan~ - Hackney Town Hall"), "Hackney Town Hall");
  assert.equal(tidyTitle("File:Hackney_Empire_(3080219246).jpg"), "Hackney Empire");
});

test("nearbyCommonsPhotos rounds the point, names itself and returns [] when Commons fails", async () => {
  let asked = "";
  let agent = "";
  const ok = (async (url: string, init: RequestInit) => {
    asked = url;
    agent = (init.headers as Record<string, string>)["user-agent"];
    return new Response(JSON.stringify({ query: { pages: [page(0)] } }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal((await nearbyCommonsPhotos(51.545223, -0.055341, 4, ok)).length, 1);
  assert.match(asked, /ggscoord=51\.545%7C-0\.055&/);
  assert.match(agent, /^CloseKnit\/1\.0 \(https:\/\/getcloseknit\.com\)$/);

  const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
  assert.deepEqual(await nearbyCommonsPhotos(51.5, -0.1, 4, down), []);
  const broken = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  assert.deepEqual(await nearbyCommonsPhotos(51.5, -0.1, 4, broken), []);
});
