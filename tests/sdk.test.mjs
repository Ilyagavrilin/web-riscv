import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PeripheralBus } from "../web/peripheral.mjs";
import { Engine } from "../web/engine.mjs";
import { assemble } from "../web/assembler.mjs";
import { examples } from "../web/examples.mjs";
import { createModel } from "./models.mjs";
const base = 0x40000100;
const image = async (name) =>
  readFile(
    join(
      resolve(process.env.SCR1_MODEL_DIR || "build"),
      "peripherals",
      name + ".wasm",
    ),
  );
const access = (bus, offset, value, write = 0, width = 2) =>
  bus.dispatch({
    request: 1,
    address: base + offset,
    data: value,
    write,
    width,
  });

test("SystemC timer follows exact clock edges, one-shot, periodic and W1C semantics", async () => {
  const data = await image("timer");
  assert.ok(
    WebAssembly.Module.imports(await WebAssembly.compile(data)).every(
      (i) => i.module === "wasi_snapshot_preview1",
    ),
  );
  const bus = new PeripheralBus();
  await bus.attach(data, base, "timer");
  access(bus, 4, 3, 1);
  access(bus, 0, 1, 1);
  bus.tick();
  bus.tick();
  assert.equal(access(bus, 8).data, 2);
  assert.equal(access(bus, 12).data, 0);
  bus.tick();
  assert.equal(access(bus, 8).data, 3);
  assert.equal(access(bus, 12).data, 1);
  assert.equal(access(bus, 0).data, 0);
  bus.tick();
  assert.equal(access(bus, 8).data, 3);
  access(bus, 12, 1, 1, 0);
  assert.equal(access(bus, 12).data, 0);
  access(bus, 8, 0, 1);
  access(bus, 0, 3, 1);
  bus.tick();
  bus.tick();
  bus.tick();
  assert.equal(access(bus, 8).data, 0);
  assert.equal(access(bus, 0).data, 3);
  assert.equal(access(bus, 12).data, 1);
});
test("SystemC mailbox transfers on edges, inspection does not pop, and overflow is sticky", async () => {
  const data = await image("mailbox");
  assert.ok(
    WebAssembly.Module.imports(await WebAssembly.compile(data)).every(
      (i) => i.module === "wasi_snapshot_preview1",
    ),
  );
  const bus = new PeripheralBus();
  await bus.attach(data, base, "mailbox");
  access(bus, 0, 17, 1);
  assert.equal(access(bus, 8).data & 15, 0);
  assert.ok(access(bus, 8).data & (1 << 11));
  bus.tick();
  assert.equal(bus.snapshot().words[1], 17);
  assert.equal(bus.snapshot().words[1], 17);
  assert.equal(access(bus, 8).data & 15, 1);
  assert.equal(access(bus, 4).data, 17);
  assert.equal(access(bus, 8).data & 15, 0);
  for (let i = 0; i < 9; i++) {
    access(bus, 0, i, 1);
    bus.tick();
  }
  assert.equal(access(bus, 8).data & 15, 8);
  assert.ok(access(bus, 8).data & (1 << 10));
  access(bus, 8, 1 << 10, 1);
  assert.equal(access(bus, 8).data & (1 << 10), 0);
  access(bus, 12, 3, 1);
  assert.equal(access(bus, 8).data & 15, 0);
});
test("timer and mailbox demo programs execute through SCR1 data buses", async () => {
  for (const id of ["imc", "ic", "ec"]) {
    const engine = new Engine(await createModel(id), id);
    await engine.peripherals.attach(await image("timer"), 0x40000100, "timer");
    await engine.peripherals.attach(
      await image("mailbox"),
      0x40000200,
      "mailbox",
    );
    engine.load(await assemble(examples.timer.source));
    engine.advance("run", 10000);
    assert.equal(engine.status, "halted");
    assert.equal(engine.m._peek(0x1000), 64);
    assert.equal(engine.m._peek(0x1004), 1);
    engine.load(await assemble(examples.mailbox.source));
    engine.advance("run", 10000);
    assert.equal(engine.status, "halted");
    assert.deepEqual(
      [0, 4, 8].map((i) => engine.m._peek(0x1000 + i)),
      [17, 34, 51],
    );
  }
});
