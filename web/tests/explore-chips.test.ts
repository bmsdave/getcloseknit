import assert from "node:assert/strict";
import test from "node:test";

import { CUSTOM_PRESETS } from "../src/lib/custom-presets";
import { EXPLORE_CHIPS, exploreChipPresets, layerAfterExplore, toggleExplore } from "../src/lib/explore-chips";

test("each Explore chip paints its own ready-made comparison", () => {
  const chips = exploreChipPresets();
  assert.equal(chips.length, 6);
  assert.deepEqual(chips.map((chip) => [chip.label, chip.preset.criterion.id]), [
    ["Specialty coffee", "good-coffee"],
    ["Coffee vs kebab", "good-coffee-kebab"],
    ["Gyms", "gyms"],
    ["Nightlife", "nightlife"],
    ["Culture", "culture"],
    ["Families", "family"],
  ]);
  for (const chip of chips) {
    assert.ok(chip.icon.length > 0, `${chip.label} has an icon`);
    assert.ok(chip.label.length <= 16, `${chip.label} is a short label`);
    assert.equal(chip.preset, CUSTOM_PRESETS.find((preset) => preset.criterion.id === chip.presetId));
  }
  assert.equal(new Set(EXPLORE_CHIPS.map((chip) => chip.presetId)).size, EXPLORE_CHIPS.length);
});

test("a chip naming a missing preset fails loudly", () => {
  assert.throws(() => exploreChipPresets([{ presetId: "no-such", icon: "?", label: "Nothing" }]), /no preset "no-such"/);
});

test("a tap turns a chip on, a second tap turns it off and another chip switches", () => {
  const [coffee, , gyms] = exploreChipPresets().map((chip) => chip.preset.criterion);
  assert.equal(toggleExplore(null, coffee), coffee);
  assert.equal(toggleExplore(coffee, coffee), null);
  assert.equal(toggleExplore(coffee, gyms), gyms);
});

test("turning a comparison off returns to the layer before it, else the default map", () => {
  assert.equal(layerAfterExplore("crime"), "crime");
  assert.equal(layerAfterExplore("personal-match"), "personal-match");
  assert.equal(layerAfterExplore(null), "price-per-square-metre");
});
