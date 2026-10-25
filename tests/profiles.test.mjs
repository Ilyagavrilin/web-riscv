import { createModel } from "./models.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import profiles from "../web/profiles.json" with { type: "json" };
import { Engine } from "../web/engine.mjs";
import { assemble } from "../web/assembler.mjs";
import { examples } from "../web/examples.mjs";

for (const [id, profile] of Object.entries(profiles)) {
  const engine = new Engine(await createModel(id), id);
  function run(source) {
    engine.load(assemble(source));
    engine.advance("run", 10000);
    return engine.snapshot();
  }
  test(`${profile.isa}: shared workload and UART run on real RTL`, () => {
    let s = run(examples.fibonacci.source);
    assert.equal(s.status, "halted");
    assert.equal(engine.m._peek(0x102c), 89);
    s = run(examples.hello.source);
    assert.equal(s.status, "halted");
    assert.equal(s.console, "SCR1\n");
  });
  test(`${profile.isa}: compressed instructions and M availability`, () => {
    let s = run(".word 0x9002451d");
    assert.equal(s.registers[10], 7);
    assert.equal(s.status, "trap");
    assert.equal(s.cause, 3);
    s = run(
      "li a0, 7\nli a1, 9\nmul a2, a0, a1\nli t0, 0xf0000004\nsw zero, 0(t0)",
    );
    if (profile.multiply) {
      assert.equal(s.status, "halted");
      assert.equal(s.registers[12], 63);
    } else {
      assert.equal(s.status, "trap");
      assert.equal(s.cause, 2);
    }
  });
  if (profile.registers === 16)
    test("RV32EC rejects instructions addressing x16", () => {
      const s = run("addi x16, zero, 1");
      assert.equal(s.status, "trap");
      assert.equal(s.cause, 2);
    });
}
