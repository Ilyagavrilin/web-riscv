import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { PeripheralBus } from "../web/peripheral.mjs";
import { Engine } from "../web/engine.mjs";
import { assemble } from "../web/assembler.mjs";
import { examples } from "../web/examples.mjs";
import { compareProfiles } from "../web/compare.mjs";
import { createModel } from "./models.mjs";
const buffer = await readFile(
  join(
    resolve(process.env.SCR1_MODEL_DIR || "build"),
    "peripherals/pulse-counter.wasm",
  ),
);
const base = 0x40000000;
const image = { buffer, base, name: "GPIO + cycle counter" };
function bus(address, data = 0, write = 0, width = 2) {
  return { request: 1, address, data, write, width };
}

test("standalone module counts clocks and supports little-endian subword IO", async () => {
  const module = await WebAssembly.compile(buffer);
  assert.equal(WebAssembly.Module.imports(module).length, 0);
  const peripheral = new PeripheralBus();
  await peripheral.attach(buffer, base, "counter");
  peripheral.dispatch(bus(base + 4, 4, 1));
  peripheral.dispatch(bus(base + 12, 1, 1));
  for (let i = 0; i < 4; i++) peripheral.tick();
  assert.equal(peripheral.dispatch(bus(base)).data, 2);
  assert.equal(peripheral.dispatch(bus(base + 8)).data, 4);
  peripheral.dispatch(bus(base, 0xa5, 1, 0));
  assert.equal(peripheral.dispatch(bus(base, 0, 0, 0)).data, 0xa5);
  assert.equal(peripheral.dispatch(bus(base + 1)).fault, 1);
  assert.equal(peripheral.dispatch(bus(base + 16)).hit, 0);
  await assert.rejects(
    () => peripheral.attach(buffer, base + 1, "bad"),
    /word-aligned/,
  );
  await assert.rejects(
    () => peripheral.attach(buffer, 0xf0000000, "bad"),
    /overlaps/,
  );
  await assert.rejects(() =>
    peripheral.attach(new Uint8Array([0, 1, 2]), base, "bad"),
  );
  assert.equal(peripheral.snapshot().name, "counter");
});
test("SCR1 uses the hot-loaded Wasm device through real MMIO bus transactions", async () => {
  const engine = new Engine(await createModel("imc"));
  engine.load(
    assemble(
      "li a0, 42\nli t0, 0x40000000\nli a1, 1\nsw a1, 12(t0)\nnop\nnop\nnop\nsw zero, 12(t0)\nlw a2, 8(t0)\nli t0, 0xf0000004\nsw zero, 0(t0)",
    ),
  );
  engine.advance("instruction");
  const cycle = engine.cycles;
  await engine.peripherals.attach(buffer, base, "counter");
  assert.equal(engine.cycles, cycle);
  assert.equal(engine.m._reg(10), 42);
  engine.advance("run");
  assert.equal(engine.status, "halted");
  const writes = engine.wave.filter(
    (row) => row.request && row.write && row.address === base + 12,
  );
  assert.equal(writes.length, 2);
  assert.equal(engine.m._reg(12), writes[1].cycle - writes[0].cycle);
  const savedRegisters = engine.snapshot().registers;
  await engine.peripherals.attach(buffer, base, "replacement");
  assert.deepEqual(engine.snapshot().registers, savedRegisters);
  assert.equal(engine.peripherals.snapshot().words[2], 0);
  engine.load(assemble("lw a0, 0(t0)"));
  assert.equal(engine.peripherals.snapshot().words[0], 1);
  engine.peripherals.detach();
  engine.load(assemble("li t0, 0x40000000\nlw a0, 0(t0)"));
  engine.advance("run");
  assert.equal(engine.status, "trap");
  assert.equal(engine.cause, 5);
});
test("selected counting demo runs on every CPU profile with its own peripheral instance", async () => {
  const results = await compareProfiles(
    createModel,
    assemble(examples.peripheral.source),
    () => {},
    undefined,
    image,
  );
  for (const result of results) assert.equal(result.status, "halted");
  assert.ok(results.slice(1).some((result) => result.firstDivergence !== null));
});
