import profiles from "./profiles.json" with { type: "json" };
import { Engine, toVcd } from "./engine.mjs";
let engine;
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(() => handle(data));
};
async function handle(data) {
  try {
    if (data.type === "init") {
      if (!Object.hasOwn(profiles, data.profile))
        throw Error("Unknown SCR1 profile");
      const { default: createModule } = await import(
        `./scr1-${data.profile}.mjs`
      );
      engine = new Engine(await createModule(), data.profile);
      if (data.peripheral)
        await engine.peripherals.attach(
          data.peripheral.buffer,
          data.peripheral.base,
          data.peripheral.name,
        );
      self.postMessage({ type: "ready" });
      return;
    }
    if (!engine) throw Error("RTL engine is still loading");
    if (data.type === "attach")
      await engine.peripherals.attach(data.buffer, data.base, data.name);
    if (data.type === "detach") engine.peripherals.detach();
    if (data.type === "load") engine.load(data.program);
    if (data.breakpoints) engine.breakpoints = new Set(data.breakpoints);
    if (data.memoryAddress !== undefined)
      engine.memoryAddress = data.memoryAddress;
    if (data.type === "advance") engine.advance(data.mode);
    if (data.type === "export") {
      self.postMessage({
        type: "export",
        format: data.format,
        value:
          data.format === "vcd"
            ? toVcd(engine.wave)
            : JSON.stringify(engine.export(), null, 2),
      });
      return;
    }
    self.postMessage({
      type: "state",
      request: data.type,
      state: engine.snapshot(),
    });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
}
