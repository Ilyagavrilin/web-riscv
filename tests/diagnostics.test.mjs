import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../web/engine.mjs";
import { assemble, loadElf } from "../web/assembler.mjs";
import { disassemble } from "../web/disassemble.mjs";
import { createModel } from "./models.mjs";
const engine = new Engine(await createModel("imc"));
test("diagnostics record accepted bus data, retirement changes and real trap state", () => {
  engine.diagnostic = true;
  engine.logFetch = true;
  engine.load(
    assemble(
      "li t0, 0x1000\nli a0, 42\nsw a0, 0(t0)\nlw a1, 0(t0)\nli t0, 0x10000\nlw a2, 0(t0)",
    ),
  );
  engine.advance("run");
  assert.equal(engine.status, "trap");
  const events = engine.export().events;
  const store = events.find(
    (e) => e.kind === "memory" && e.operation === "write",
  );
  assert.equal(store.address, 0x1000);
  assert.equal(store.data, 42);
  assert.equal(store.width, 4);
  assert.equal(store.response, "ok");
  const load = events.find(
    (e) =>
      e.kind === "memory" && e.operation === "read" && e.address === 0x1000,
  );
  assert.equal(load.data, 42);
  assert.ok(load.cycle > store.cycle);
  assert.ok(
    events.some(
      (e) =>
        e.kind === "retire" &&
        e.changes.some((c) => c.register === 11 && c.after === 42),
    ),
  );
  assert.ok(events.some((e) => e.kind === "fetch"));
  const trap = events.at(-1);
  assert.equal(trap.kind, "trap");
  assert.equal(trap.cause, 5);
  assert.equal(trap.value, 0x10000);
  assert.equal(engine.snapshot().csr.mepc, trap.pc);
  assert.equal(engine.snapshot().csr.mcause, 5);
  assert.equal(engine.snapshot().csr.mtval, 0x10000);
  assert.ok(events.every((e, i) => !i || e.sequence > events[i - 1].sequence));
});
test("diagnostic retention and mode boundaries are explicit", () => {
  engine.diagnostic = false;
  engine.logFetch = false;
  engine.load(assemble("nop\nebreak"));
  engine.advance("run");
  assert.deepEqual(
    engine.events.map((e) => e.kind),
    ["load", "trap"],
  );
  engine.diagnostic = true;
  engine.load(assemble("loop: j loop"));
  engine.advance("run", 40000);
  assert.equal(engine.events.length, 10000);
  assert.ok(engine.droppedEvents > 0);
  assert.ok(engine.events[0].sequence > 1);
});
test("ELF code view contains real instruction addresses and basic disassembly", () => {
  const buffer = new ArrayBuffer(0x108),
    v = new DataView(buffer);
  v.setUint32(0, 0x7f454c46, false);
  v.setUint8(4, 1);
  v.setUint8(5, 1);
  v.setUint8(6, 1);
  v.setUint16(16, 2, true);
  v.setUint16(18, 243, true);
  v.setUint32(24, 0x200, true);
  v.setUint32(28, 52, true);
  v.setUint16(42, 32, true);
  v.setUint16(44, 1, true);
  v.setUint32(52, 1, true);
  v.setUint32(56, 0x100, true);
  v.setUint32(60, 0x200, true);
  v.setUint32(68, 8, true);
  v.setUint32(72, 16, true);
  v.setUint32(76, 5, true);
  v.setUint32(0x100, 0x02a00513, true);
  v.setUint16(0x104, 0x9002, true);
  v.setUint16(0x106, 1, true);
  const p = loadElf(buffer);
  assert.equal(p.listing[0].text, "addi x10, x0, 42");
  assert.equal(p.listing[1].address, 0x204);
  assert.equal(p.listing[1].text, "c.ebreak");
  assert.equal(p.segments[0].bytes[15], 0);
  assert.equal(disassemble(0xfe051ee3, 0x20c), "bne x10, x0, 0x208");
  assert.equal(disassemble(0x00008067), "jalr x0, 0(x1)");
});

test("data watchpoints stop on accepted wider accesses and can resume", () => {
  engine.diagnostic = true;
  engine.watchpoint = { address: 0x1002, access: "write" };
  engine.load(
    assemble(
      "li t0, 0x1000\nli a0, 42\nsw a0, 0(t0)\nli t0, 0xf0000004\nsw zero, 0(t0)",
    ),
  );
  engine.advance("run");
  assert.equal(engine.status, "watchpoint");
  assert.equal(engine.m._peek(0x1000), 42);
  assert.ok(
    engine.events.some((e) => e.kind === "watchpoint" && e.address === 0x1000),
  );
  engine.watchpoint = null;
  engine.advance("run");
  assert.equal(engine.status, "halted");
});
