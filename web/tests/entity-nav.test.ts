import assert from "node:assert/strict";
import test from "node:test";

import type { HierarchyArea } from "../src/lib/area-pages";
import { areaCrumbs, crumbName, upLinks } from "../src/lib/entity-nav";

const area = (geographyId: string, name: string, carrier: HierarchyArea["carrier"], parentId: string | null, friendlyName?: string): HierarchyArea =>
  ({ geographyId, name, carrier, parentId, friendlyName, schools: null }) as HierarchyArea;

const borough = area("uk:lad:E09000001", "Westminster preview borough", "lad", null, "Westminster");
const msoa = area("uk:msoa:E02000001", "Westminster preview MSOA", "msoa", borough.geographyId, "St James's");
const lsoa = area("uk:lsoa:E01000001", "Westminster preview", "lsoa", msoa.geographyId);

test("crumbs use friendly names and skip an MSOA named like its neighbourhood", () => {
  assert.equal(crumbName(borough), "Westminster");
  assert.equal(crumbName(lsoa), "Westminster preview");
  assert.deepEqual(areaCrumbs([borough, msoa, lsoa], "St James's"), [
    { label: "London", href: "/area/london" },
    { label: "Westminster", href: "/area/lad/E09000001" },
    { label: "St James's", href: "/area/lsoa/E01000001" },
  ]);
  // A different neighbourhood name keeps the MSOA step.
  assert.deepEqual(areaCrumbs([borough, msoa, lsoa]).map((crumb) => crumb.label), ["London", "Westminster", "St James's", "Westminster preview"]);
});

test("without the hierarchy the crumbs are London, then this page", () => {
  assert.deepEqual(areaCrumbs([], "St James's"), [{ label: "London", href: "/area/london" }, { label: "St James's", href: null }]);
  assert.deepEqual(areaCrumbs([]), [{ label: "London", href: "/area/london" }]);
});

test("Up lists the places above, nearest first, London last", () => {
  const crumbs = [...areaCrumbs([borough, msoa, lsoa], "St James's"), { label: "SW1A 1AA", href: null }];
  assert.deepEqual(upLinks(crumbs).map((link) => link.label), ["St James's", "Westminster", "London"]);
});

