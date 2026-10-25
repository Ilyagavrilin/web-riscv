import test from "node:test";
import assert from "node:assert/strict";
import { createModel } from "./models.mjs";
import { assemble, loadElf } from "../web/assembler.mjs";
import { examples } from "../web/examples.mjs";
import { Engine, toVcd } from "../web/engine.mjs";
const engine = new Engine(await createModel("imc"));
async function run(source) {
  engine.load(await assemble(source));
  for (
    let i = 0;
    i < 20 && engine.status !== "halted" && engine.status !== "trap";
    i++
  )
    engine.advance("run");
  return engine.snapshot();
}
test("SCR1 executes Fibonacci and stores actual RTL results", async () => {
  const s = await run(examples.fibonacci.source);
  assert.equal(s.status, "halted");
  assert.equal(s.exitCode, 0);
  assert.equal(s.registers[0], 0);
  assert.ok(s.retired > 80);
  const words = Array.from(
    { length: 12 },
    (_, i) =>
      engine.m._peek(0x1000 + i * 4) | (engine.m._peek(0x1001 + i * 4) << 8),
  );
  assert.deepEqual(words, [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]);
});
test("UART is printed exactly once per bus transaction", async () => {
  const s = await run(examples.hello.source);
  assert.equal(s.status, "halted");
  assert.equal(s.console, "SCR1\n");
});
test("M extension arithmetic is executed by SCR1", async () => {
  const s = await run(examples.multiply.source);
  assert.equal(s.status, "halted");
  assert.equal(s.registers[12], 1728);
  assert.equal(s.registers[13], 12);
  assert.equal(s.registers[14], 0);
});
test("instruction stepping, PC breakpoints and reset", async () => {
  engine.load(await assemble(examples.fibonacci.source));
  engine.advance("instruction");
  assert.equal(engine.retired, 1);
  engine.breakpoints = new Set([0x210]);
  engine.advance("run");
  assert.equal(engine.status, "breakpoint");
  assert.equal(engine.m._signal(0), 0x210);
  const stoppedAt = engine.cycles;
  engine.advance("run");
  assert.ok(engine.cycles > stoppedAt);
  engine.breakpoints.clear();
  engine.advance("run");
  assert.equal(engine.status, "halted");
  engine.load(await assemble("li a0, 7\nebreak"));
  engine.breakpoints.clear();
  engine.advance("run");
  assert.equal(engine.status, "trap");
  assert.equal(engine.cause, 3);
  assert.equal(engine.m._reg(10), 7);
  engine.load(await assemble("nop"));
  assert.equal(engine.m._reg(10), 0);
  assert.equal(engine.m._peek(0x1004), 0);
});
test("byte and halfword memory, sign extension, x0 and bus faults", async () => {
  let s = await run(
    "li t0, 0x1000\nli t1, -1\nsb t1, 1(t0)\nlb a0, 1(t0)\nlbu a1, 1(t0)\nsh t1, 2(t0)\nlh a2, 2(t0)\nlhu a3, 2(t0)\naddi zero, zero, 99\nli t0, 0xf0000004\nsw zero, 0(t0)",
  );
  assert.equal(s.status, "halted");
  assert.equal(s.registers[10], 0xffffffff);
  assert.equal(s.registers[11], 255);
  assert.equal(s.registers[12], 0xffffffff);
  assert.equal(s.registers[13], 65535);
  assert.equal(s.registers[0], 0);
  s = await run("li t0, 0x10000\nlw a0, 0(t0)");
  assert.equal(s.status, "trap");
  assert.equal(s.cause, 5);
});
test("loads a real ELF image and executes compressed instructions", async () => {
  const buffer = new ArrayBuffer(0x104),
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
  v.setUint32(68, 4, true);
  v.setUint32(72, 4, true);
  v.setUint16(0x100, 0x451d, true);
  v.setUint16(0x102, 0x9002, true);
  engine.load(loadElf(buffer));
  engine.advance("run");
  assert.equal(engine.status, "trap");
  assert.equal(engine.m._reg(10), 7);
  assert.equal(engine.history[0].pc, 0x200);
});
test("trace contains cycle samples and valid VCD scope", async () => {
  const vcd = toVcd(engine.wave);
  assert.match(vcd, /\$enddefinitions \$end/);
  assert.match(vcd, /#1\n/);
  assert.ok(engine.wave.length > 0);
});

test("long runs retain bounded traces and unsigned bus addresses", async () => {
  engine.load(await assemble("loop: j loop"));
  engine.breakpoints.clear();
  for (let i = 0; i < 4; i++) engine.advance("run");
  assert.equal(engine.cycles, 8000);
  assert.equal(engine.wave.length, 4096);
  assert.equal(engine.history.length, 1024);
  await run(examples.hello.source);
  assert.ok(engine.wave.some((row) => row.address === 0xf0000000));
});
