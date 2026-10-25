import profiles from "./profiles.json" with { type: "json" };
import { Engine } from "./engine.mjs";

export async function compareProfiles(
  createModel,
  program,
  onProgress = () => {},
  limits = { cycles: 30000, instructions: 4096 },
  peripheral = null,
  platform = {},
) {
  const runs = [];
  for (const [id, profile] of Object.entries(profiles)) {
    onProgress(id);
    const engine = new Engine(await createModel(id), id);
    engine.configure({ ...platform, stopOnInterrupt: false });
    for (const image of Array.isArray(peripheral)
      ? peripheral
      : peripheral
        ? [peripheral]
        : [])
      await engine.peripherals.attach(
        image.buffer,
        image.base,
        image.name,
        image.irqLine,
      );
    engine.load(program);
    const trace = [];
    while (
      engine.cycles < limits.cycles &&
      trace.length < limits.instructions &&
      !["halted", "trap"].includes(engine.status)
    ) {
      const retired = engine.retired;
      engine.advance(
        "instruction",
        Math.min(2000, limits.cycles - engine.cycles),
      );
      if (engine.retired > retired) trace.push(engine.history.at(-1));
    }
    const state = engine.snapshot();
    if (!["halted", "trap"].includes(state.status)) state.status = "limit";
    const ram = Uint8Array.from({ length: 65536 }, (_, i) => engine.m._peek(i));
    runs.push({ id, profile, state, trace, ram });
  }
  const baseline = runs[0];
  return runs.map((run) => {
    const count = Math.min(run.profile.registers, baseline.profile.registers);
    const traceMatches = (a, b) =>
      a.pc === b.pc &&
      a.registers.slice(0, count).every((n, i) => n === b.registers[i]);
    let firstDivergence = null;
    for (
      let i = 0;
      i < Math.min(run.trace.length, baseline.trace.length);
      i++
    ) {
      if (!traceMatches(run.trace[i], baseline.trace[i])) {
        firstDivergence = i + 1;
        break;
      }
    }
    if (firstDivergence === null && run.trace.length !== baseline.trace.length)
      firstDivergence = Math.min(run.trace.length, baseline.trace.length) + 1;
    const complete =
      run.state.status === "halted" && baseline.state.status === "halted";
    const stateMatches = complete
      ? run.state.exitCode === baseline.state.exitCode &&
        run.state.console === baseline.state.console &&
        run.state.registers
          .slice(0, count)
          .every((n, i) => n === baseline.state.registers[i]) &&
        run.ram.every((n, i) => n === baseline.ram[i])
      : null;
    return {
      profile: run.id,
      isa: run.profile.isa,
      cycles: run.state.cycles,
      retired: run.state.retired,
      status: run.state.status,
      cause: run.state.cause,
      exitCode: run.state.exitCode,
      stateMatches,
      firstDivergence,
      comparedRegisters: count,
    };
  });
}
