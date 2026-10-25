import test from "node:test";
import assert from "node:assert/strict";
import { assemble, loadElf } from "../web/assembler.mjs";
import { examples } from "../web/examples.mjs";
test("GNU assembler encodes arithmetic and links backward branches", async () => {
  const p = await assemble(
    "li t0, 0xf0000000\nloop: addi a0, zero, -1\nbnez a0, loop",
  );
  assert.deepEqual(
    p.listing.map((x) => x.word),
    [0xf00002b7, 0xfff00513, 0xfe051ee3],
  );
  assert.equal(p.entry, 0x200);
  assert.equal(p.toolchain, "GNU binutils 2.46.0");
});
test("GNU diagnostics reject invalid operands and truncation", async () => {
  for (const text of [
    "addi x1, x2, 2048",
    "slli x1, x2, 32",
    "add x32, x0, x0",
    "add x1, x2",
    "x: nop\nx: nop",
  ])
    await assert.rejects(() => assemble(text));
});
test("all demonstrations assemble with the upstream toolchain", async () => {
  for (const p of Object.values(examples)) {
    const result = await assemble(p.source);
    assert.ok(result.listing.length > 0);
    assert.ok(result.segments[0].bytes.length > 0);
  }
});
test("ELF rejects truncated and incompatible inputs", () => {
  for (const length of [0, 4, 52, 100])
    assert.throws(() => loadElf(new ArrayBuffer(length)));
});
test("GNU assembler enforces ISA and supports directives, macros, data and compressed code", async () => {
  await assert.rejects(() =>
    assemble("mul a0, a1, a2", { registers: 32, multiply: false }),
  );
  await assert.rejects(() =>
    assemble("addi a6, zero, 1", { registers: 16, multiply: false }),
  );
  const p = await assemble(
    ".macro set reg,value\nli \\reg,\\value\n.endm\nset a0,42\n.option rvc\nc.nop\n.data\nvalue: .word 0x12345678\n.bss\n.space 16",
  );
  assert.ok(p.listing.some((l) => l.word === 0x02a00513));
  assert.ok(p.listing.some((l) => l.size === 2));
  assert.ok(p.segments[0].memorySize > p.segments[0].fileSize);
});

test("GNU diagnostics refer to the editor's original line numbers", async () => {
  await assert.rejects(() => assemble("nop\nadd x32, x0, x0"), /editor\.s:2:/);
});
