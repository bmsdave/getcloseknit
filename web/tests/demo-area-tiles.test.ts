import assert from "node:assert/strict";
import test from "node:test";

import { demoAreaTile } from "../src/lib/demo-area-tiles";

/** Protobuf fields of a message: [number, value] with varints as numbers and length-delimited fields as bytes. */
function fields(bytes: Uint8Array): [number, number | Uint8Array][] {
  const out: [number, number | Uint8Array][] = [];
  let index = 0;
  const varint = () => {
    let result = 0;
    let scale = 1;
    for (;;) {
      const byte = bytes[index++];
      result += (byte & 127) * scale;
      scale *= 128;
      if (byte < 128) return result;
    }
  };
  while (index < bytes.length) {
    const key = varint();
    if ((key & 7) === 0) out.push([key >> 3, varint()]);
    else {
      const length = varint();
      out.push([key >> 3, bytes.subarray(index, index + length)]);
      index += length;
    }
  }
  return out;
}

function packed(bytes: Uint8Array): number[] {
  const values: number[] = [];
  let index = 0;
  while (index < bytes.length) {
    let result = 0;
    let scale = 1;
    for (;;) {
      const byte = bytes[index++];
      result += (byte & 127) * scale;
      scale *= 128;
      if (byte < 128) break;
    }
    values.push(result);
  }
  return values;
}

/** The tile's one layer: its name, extent and each feature's id with its rings (tile units) and signed areas. */
function decode(tile: Uint8Array) {
  const layers = fields(tile).filter(([number]) => number === 3).map(([, layer]) => fields(layer as Uint8Array));
  assert.equal(layers.length, 1);
  const layer = layers[0];
  const name = new TextDecoder().decode(layer.find(([number]) => number === 1)![1] as Uint8Array);
  const extent = layer.find(([number]) => number === 5)![1];
  const features = layer.filter(([number]) => number === 2).map(([, body]) => {
    const parts = fields(body as Uint8Array);
    const commands = packed(parts.find(([number]) => number === 4)![1] as Uint8Array);
    const rings: [number, number][][] = [];
    let [x, y] = [0, 0];
    for (let position = 0; position < commands.length;) {
      const id = commands[position] & 7;
      const count = commands[position++] >> 3;
      if (id === 7) continue;
      if (id === 1) rings.push([]);
      for (let step = 0; step < count; step += 1) {
        const unzig = (value: number) => (value >>> 1) ^ -(value & 1);
        x += unzig(commands[position++]);
        y += unzig(commands[position++]);
        rings[rings.length - 1].push([x, y]);
      }
    }
    const area = (ring: [number, number][]) => ring.reduce((sum, [x1, y1], index) => {
      const [x2, y2] = ring[(index + 1) % ring.length];
      return sum + x1 * y2 - x2 * y1;
    }, 0);
    return {
      id: parts.find(([number]) => number === 1)![1], type: parts.find(([number]) => number === 3)![1],
      tags: parts.some(([number]) => number === 2), rings, areas: rings.map(area),
    };
  });
  return { name, extent, features };
}

test("demo data's tiles hold its fixture areas: one layer of the kind, ONS code ids, polygons, no properties", () => {
  // Zoom 10 over central London: every fixture area.
  const lsoa = decode(demoAreaTile("lsoa", 10, 511, 340));
  assert.equal(lsoa.name, "lsoa");
  assert.equal(lsoa.extent, 4096);
  assert.deepEqual(lsoa.features.map((feature) => feature.id).sort(), [1000001, 1000002, 1000003]);
  assert.ok(lsoa.features.every((feature) => feature.type === 3 && !feature.tags));
  const borough = decode(demoAreaTile("borough", 10, 511, 340));
  assert.deepEqual(borough.features.map((feature) => feature.id).sort(), [9000001, 9000002, 9000003]);
});

test("a multipart area keeps its parts, each ring wound as the MVT spec says (exterior positive)", () => {
  const southBank = decode(demoAreaTile("lsoa", 10, 511, 340)).features.find((feature) => feature.id === 1000003)!;
  assert.equal(southBank.rings.length, 2);
  assert.ok(southBank.areas.every((area) => area > 0));
});

test("a tile none of the areas reaches is empty", () => {
  assert.equal(demoAreaTile("lsoa", 10, 0, 0).length, 0);
  assert.equal(demoAreaTile("msoa", 12, 2000, 1300).length, 0);
});
