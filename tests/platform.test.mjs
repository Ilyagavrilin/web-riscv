import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Engine } from "../web/engine.mjs";
import { assemble } from "../web/assembler.mjs";
import { PeripheralBus } from "../web/peripheral.mjs";
import { examples } from "../web/examples.mjs";
import profiles from "../web/profiles.json" with { type: "json" };
import { createModel } from "./models.mjs";
const image = (name) =>
  readFile(
    join(
      resolve(process.env.SCR1_MODEL_DIR || "build"),
      "peripherals",
      `${name}.wasm`,
    ),
  );
const access = (bus, offset, data = 0, write = 0) =>
  bus.dispatch({
    request: 1,
    address: 0x40000300 + offset,
    data,
    write,
    width: 2,
  });
const word = (engine, address) =>
  Array.from({ length: 4 }, (_, i) => engine.m._peek(address + i)).reduce(
    (n, byte, i) => (n | (byte << (i * 8))) >>> 0,
    0,
  );

test("memory wait states preserve architectural state and accept MMIO side effects once on every core", async () => {
  for (const id of Object.keys(profiles)) {
    const engine = new Engine(await createModel(id), id);
    engine.diagnostic = true;
    await engine.peripherals.attach(
      await image("mailbox"),
      0x40000200,
      "mailbox",
    );
    const program = await assemble(examples.mailbox.source, profiles[id]);
    engine.load(program);
    engine.advance("run", 20000);
    const baseline = engine.cycles;
    assert.equal(engine.status, "halted");
    engine.configure({ instructionLatency: 7, dataLatency: 11 });
    engine.load(program);
    engine.advance("run", 20000);
    assert.equal(engine.status, "halted", id);
    assert.ok(engine.cycles > baseline);
    assert.deepEqual(
      [0, 4, 8].map((i) => word(engine, 0x1000 + i)),
      [17, 34, 51],
    );
    assert.equal(
      engine.events.filter(
        (e) =>
          e.kind === "mmio" &&
          e.operation === "read" &&
          e.address === 0x40000204,
      ).length,
      3,
    );
    engine.configure({ instructionLatency: 32, dataLatency: 32 });
    engine.load(await assemble(examples.hello.source, profiles[id]));
    engine.advance("run", 20000);
    assert.equal(engine.console, "SCR1\n");
    assert.equal(engine.status, "halted");
    assert.throws(() => engine.configure({ dataLatency: 0 }), /latency/);
  }
});

test("timer IRQ enters real SCR1 interrupt handlers and mret resumes on all profiles", async () => {
  for (const id of Object.keys(profiles)) {
    const engine = new Engine(await createModel(id), id);
    await engine.peripherals.attach(
      await image("timer"),
      0x40000100,
      "timer",
      0,
    );
    engine.configure({
      instructionLatency: 3,
      dataLatency: 5,
      stopOnInterrupt: true,
    });
    engine.load(await assemble(examples.interrupt.source, profiles[id]));
    engine.advance("run", 20000);
    assert.equal(
      engine.status,
      "interrupt",
      `${id}: ${JSON.stringify(engine.events.slice(-3))}`,
    );
    assert.equal(engine.snapshot().csr.mcause, 0x8000000b);
    assert.equal(engine.interruptCount, 1);
    assert.equal(engine.snapshot().csr.mstatus & 8, 0);
    assert.equal(engine.snapshot().csr.mstatus & 128, 128);
    const interrupted = engine.snapshot().csr.mepc;
    assert.ok(interrupted >= 0x200 && interrupted < 0x400);
    engine.configure({ stopOnInterrupt: false });
    engine.advance("run", 20000);
    assert.equal(engine.status, "halted", id);
    assert.equal(word(engine, 0x1000), 1);
    assert.equal(engine.interruptCount, 1);
    assert.equal(engine.peripherals.irqMask(), 0);
    assert.equal(engine.snapshot().csr.mstatus & 8, 8);
    assert.ok(!engine.events.some((e) => e.kind === "trap"));
  }
});

test("external and software interrupt inputs respect CSR masks and routing", async () => {
  const engine = new Engine(await createModel("ec"), "ec");
  engine.configure({ externalMask: 1 << 9, softwareIrq: true });
  engine.load(
    await assemble(
      "li t0, 0x1000\nli a0, 9\nsw a0, 0(t0)\nloop: j loop",
      profiles.ec,
    ),
  );
  engine.advance("run", 400);
  assert.equal(engine.interruptCount, 0);
  assert.equal(word(engine, 0x1000), 9);
  engine.configure({
    externalMask: 0,
    softwareIrq: true,
    stopOnInterrupt: true,
  });
  engine.load(
    await assemble(
      "li t0, 0x300\ncsrw mtvec, t0\ncsrsi mie, 8\ncsrsi mstatus, 8\nloop: j loop",
      profiles.ec,
    ),
  );
  engine.advance("run", 1000);
  assert.equal(engine.status, "interrupt");
  assert.equal(engine.snapshot().csr.mcause, 0x80000003);
  const bus = new PeripheralBus();
  await bus.attach(await image("timer"), 0x40000300, "timer", 9);
  access(bus, 4, 1, 1);
  access(bus, 0, 5, 1);
  bus.tick();
  assert.equal(bus.irqMask(), 1 << 9);
  access(bus, 12, 1, 1);
  assert.equal(bus.irqMask(), 0);
  await assert.rejects(
    bus.attach(await image("timer"), 0x40000300, "timer", 16),
    /IRQ/,
  );
});

test("clocked TLM DMA copies RAM through arbitration and records every accepted beat", async () => {
  for (const id of Object.keys(profiles)) {
    const engine = new Engine(await createModel(id), id);
    engine.diagnostic = true;
    engine.configure({ instructionLatency: 3, dataLatency: 9 });
    await engine.peripherals.attach(await image("dma"), 0x40000300, "dma");
    engine.load(await assemble(examples.dma.source, profiles[id]));
    engine.advance("run", 20000);
    assert.equal(engine.status, "halted", id);
    assert.equal(engine.exitCode, 0);
    assert.deepEqual(
      [0, 4, 8, 12].map((i) => word(engine, 0x1100 + i)),
      [17, 34, 51, 68],
    );
    assert.equal(word(engine, 0x1010), 4);
    assert.equal(engine.dmaTransfers, 8);
    const events = engine.events.filter((e) => e.kind === "dma");
    assert.deepEqual(
      events.map((e) => e.operation),
      ["read", "write", "read", "write", "read", "write", "read", "write"],
    );
    assert.ok(events.every((e) => e.response === "ok" && e.waitCycles >= 9));
    assert.ok(engine.wave.every((e) => !(e.dmaAccepted && e.dataAccepted)));
    assert.equal(engine.peripherals.snapshot().words[4], 2);
  }
});

test("TLM response backpressure, error, reset and restart have explicit clock boundaries", async () => {
  const bus = new PeripheralBus();
  await bus.attach(await image("dma"), 0x40000300, "dma", 4);
  access(bus, 0, 0x1000, 1);
  access(bus, 4, 0x1100, 1);
  access(bus, 8, 1, 1);
  access(bus, 12, 3, 1);
  assert.equal(bus.busRequest(), null);
  bus.tick();
  const pending = bus.busRequest();
  assert.equal(pending.address, 0x1000);
  for (let i = 0; i < 10; i++) bus.tick();
  assert.equal(bus.busRequest(), pending);
  assert.equal(bus.snapshot().words[5], 0);
  bus.completeBus(1, 0x12345678);
  assert.equal(bus.busRequest(), null);
  bus.tick();
  assert.equal(bus.busRequest().address, 0x1100);
  assert.equal(bus.busRequest().data, 0x12345678);
  assert.equal(bus.busRequest().write, 1);
  bus.completeBus(2, 0);
  bus.tick();
  assert.equal(bus.snapshot().words[4], 4);
  assert.equal(bus.irqMask(), 16);
  access(bus, 16, 4, 1);
  assert.equal(bus.irqMask(), 0);
  access(bus, 12, 1, 1);
  bus.tick();
  assert.ok(bus.busRequest());
  bus.reset();
  assert.equal(bus.busRequest(), null);
  assert.deepEqual(bus.snapshot().words, [0, 0, 0, 0, 0, 0]);
  access(bus, 8, 1, 1);
  access(bus, 12, 1, 1);
  bus.tick();
  assert.ok(bus.busRequest());
  bus.detach();
  assert.equal(bus.busRequest(), null);
});

test("two SystemC initiators arbitrate fairly and hot detach cancels an unaccepted beat", async () => {
  const engine = new Engine(await createModel("imc"));
  engine.diagnostic = true;
  engine.configure({ dataLatency: 8 });
  const data = await image("dma");
  await engine.peripherals.attach(data, 0x40000300, "first");
  await engine.peripherals.attach(data, 0x40000400, "second");
  const program = await assemble("loop: j loop");
  program.segments.push({
    address: 0x1000,
    bytes: Uint8Array.from([17, 0, 0, 0, 34, 0, 0, 0]),
  });
  engine.load(program);
  for (const [base, destination] of [
    [0x40000300, 0x1100],
    [0x40000400, 0x1200],
  ])
    for (const [offset, value] of [
      [0, 0x1000],
      [4, destination],
      [8, 2],
      [12, 1],
    ])
      engine.peripherals.dispatch({
        request: 1,
        address: base + offset,
        data: value,
        write: 1,
        width: 2,
      });
  engine.advance("run", 200);
  assert.deepEqual(
    [0, 4].map((i) => word(engine, 0x1100 + i)),
    [17, 34],
  );
  assert.deepEqual(
    [0, 4].map((i) => word(engine, 0x1200 + i)),
    [17, 34],
  );
  assert.deepEqual(
    engine.events.filter((e) => e.kind === "dma").map((e) => e.target),
    [
      "first",
      "second",
      "first",
      "second",
      "first",
      "second",
      "first",
      "second",
    ],
  );
  engine.load(program);
  for (const [offset, value] of [
    [0, 0x1000],
    [4, 0x1100],
    [8, 2],
    [12, 1],
  ])
    access(engine.peripherals, offset, value, 1);
  for (let i = 0; i < 8; i++) engine.advance("cycle");
  assert.ok(engine.peripherals.busRequest());
  assert.equal(engine.dmaTransfers, 0);
  engine.peripherals.detach(0x40000300);
  engine.advance("run", 100);
  assert.equal(engine.dmaTransfers, 0);
  assert.equal(word(engine, 0x1100), 0);
});

test("RTL DMA port rejects MMIO and misalignment and preserves byte lanes", async () => {
  const engine = new Engine(await createModel("ec"), "ec");
  engine.configure({ dataLatency: 4 });
  engine.load(await assemble("loop: j loop", profiles.ec));
  const requests = [
    [0x1001, 0xaa, 0],
    [0x1002, 0xbbcc, 1],
    [0x1000, 0xdeadbeef, 2],
    [0x1001, 0xffffffff, 2],
    [0x10000, 123, 2],
    [0xf0000000, 65, 0],
    [0xffffffff, 1, 0],
  ];
  const responses = [];
  const device = {
    base: 0x40000300,
    size: 4,
    name: "bus probe",
    irqLine: -1,
    messages: [],
    exports: {
      mmio_bus_request(field) {
        const r = requests[0];
        return r ? [1, 1, r[0], r[1], r[2]][field] : 0;
      },
      mmio_bus_complete(status) {
        responses.push(status);
        requests.shift();
      },
    },
  };
  engine.peripherals.devices.set(device.base, device);
  engine.advance("run", 100);
  assert.deepEqual(responses, [1, 1, 1, 2, 2, 2, 2]);
  assert.equal(word(engine, 0x1000), 0xdeadbeef);
  assert.equal(engine.console, "");
  assert.equal(engine.status, "paused");
});

test("an empty engine can be configured and inspected before an image is loaded", async () => {
  const engine = new Engine(await createModel("imc"));
  engine.configure({ dataLatency: 7 });
  const state = engine.snapshot();
  assert.equal(state.status, "paused");
  assert.equal(state.cycles, 0);
  assert.equal(state.platform.dataLatency, 7);
  assert.deepEqual(state.memory, Array(128).fill(0));
});
