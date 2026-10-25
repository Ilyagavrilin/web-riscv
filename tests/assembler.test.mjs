import test from "node:test";
import assert from "node:assert/strict";
import { assemble, loadElf } from "../web/assembler.mjs";
import { examples } from "../web/examples.mjs";
test("encodes arithmetic, backward branches and wide immediates", () => {
  const p = assemble(
    "li t0, 0xf0000000\nloop: addi a0, zero, -1\nbnez a0, loop",
  );
  assert.deepEqual(
    p.listing.map((x) => x.word),
    [0xf00002b7, 0x00028293, 0xfff00513, 0xfe051ee3],
  );
});
test("rejects invalid operands rather than silently truncating", () => {
  for (const text of [
    "addi x1, x2, 2048",
    "slli x1, x2, 32",
    "add x32, x0, x0",
    "add x1, x2",
    "li a0, 0x100000000",
    "x: nop\nx: nop",
    "beq x0, x0, 513",
  ])
    assert.throws(() => assemble(text));
});
test("examples assemble and map every emitted word", () => {
  for (const p of Object.values(examples)) {
    const result = assemble(p.source);
    assert.equal(result.segments[0].bytes.length, result.listing.length * 4);
  }
});
test("ELF rejects truncated and incompatible inputs", () => {
  for (const length of [0, 4, 52, 100])
    assert.throws(() => loadElf(new ArrayBuffer(length)));
});

test("assembler enforces the selected ISA and register set", () => {
  assert.throws(
    () => assemble("mul a0, a1, a2", { registers: 32, multiply: false }),
    /M extension/,
  );
  assert.throws(
    () => assemble("addi a6, zero, 1", { registers: 16, multiply: false }),
    /unavailable/,
  );
  assert.doesNotThrow(() =>
    assemble("addi a5, zero, 1", { registers: 16, multiply: false }),
  );
});
