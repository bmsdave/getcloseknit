import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { contactEmail, contactMailto, DEFAULT_CONTACT_EMAIL, NEWS_SUBJECT, RESEARCH_SUBJECT } from "../src/lib/contact";

test("the contact address falls back to hello@getcloseknit.com", () => {
  assert.equal(DEFAULT_CONTACT_EMAIL, "hello@getcloseknit.com");
  assert.equal(contactEmail({}), "hello@getcloseknit.com");
  assert.equal(contactEmail({ CLOSE_KNIT_CONTACT_EMAIL: "  " }), "hello@getcloseknit.com");
  assert.equal(contactEmail({ CLOSE_KNIT_CONTACT_EMAIL: "privacy@example.org" }), "privacy@example.org");
});

test("mailto links carry an encoded subject and nothing else", () => {
  assert.equal(contactMailto("Tell me what's new on Close Knit", {}),
    "mailto:hello@getcloseknit.com?subject=Tell%20me%20what's%20new%20on%20Close%20Knit");
  assert.equal(contactMailto(NEWS_SUBJECT, {}), contactMailto("Tell me what's new on Close Knit", {}));
  assert.equal(contactMailto(RESEARCH_SUBJECT, {}),
    "mailto:hello@getcloseknit.com?subject=Take%20part%20in%20a%2030-minute%20research%20session");
});

test("the footer and About build their sign-up links from contact.ts (/claude is /agents now)", () => {
  for (const file of ["components/site-footer.tsx", "app/about/page.tsx"]) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.match(source, /contactMailto\(NEWS_SUBJECT\)/, `${file}: launch list`);
    assert.match(source, /contactMailto\(RESEARCH_SUBJECT\)/, `${file}: research session`);
    assert.ok(!/<form|<input/.test(source), `${file}: no form`);
  }
});

test("privacy, terms and About read the address from contact.ts", () => {
  for (const page of ["privacy", "terms", "about"]) {
    const source = readFileSync(new URL(`../src/app/${page}/page.tsx`, import.meta.url), "utf8");
    assert.match(source, /contactEmail\(\)|contactMailto\(/, `${page} uses contact.ts`);
    assert.ok(!source.includes("close-knit.local"), `${page} has no placeholder address`);
  }
});
