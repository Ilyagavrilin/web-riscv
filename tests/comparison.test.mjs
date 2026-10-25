import test from "node:test";
import assert from "node:assert/strict";
import { compareProfiles } from "../web/compare.mjs";
import { createModel } from "./models.mjs";
import { assemble } from "../web/assembler.mjs";
import { examples } from "../web/examples.mjs";

test("identical portable binary produces matching results across all SCR1 profiles", async () => {
  const results = await compareProfiles(
    createModel,
    await assemble(examples.fibonacci.source),
  );
  for (const r of results) {
    assert.equal(r.status, "halted");
    assert.equal(r.stateMatches, true);
    assert.equal(r.firstDivergence, null);
  }
  assert.ok(new Set(results.map((r) => r.cycles)).size > 1);
});
test("comparison reports missing M extension and bounded execution", async () => {
  let results = await compareProfiles(
    createModel,
    await assemble(examples.multiply.source),
  );
  assert.equal(results[0].status, "halted");
  for (const r of results.slice(1)) {
    assert.equal(r.status, "trap");
    assert.equal(r.cause, 2);
    assert.equal(r.stateMatches, null);
    assert.ok(r.firstDivergence > 0);
  }
  results = await compareProfiles(
    createModel,
    await assemble("loop: j loop"),
    () => {},
    { cycles: 100, instructions: 20 },
  );
  for (const r of results) {
    assert.equal(r.status, "limit");
    assert.equal(r.stateMatches, null);
    assert.ok(r.cycles <= 100);
  }
});
