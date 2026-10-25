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
      engine.configure(data.platform ?? {});
      engine.diagnostic = Boolean(data.diagnostic);
      engine.logFetch = Boolean(data.fetch);
      for (const image of data.peripherals ??
        (data.peripheral ? [data.peripheral] : []))
        await engine.peripherals.attach(
          image.buffer,
          image.base,
          image.name,
          image.irqLine,
        );
      self.postMessage({ type: "ready" });
      return;
    }
    if (!engine) throw Error("RTL engine is still loading");
    if (data.type === "attach") {
      await engine.peripherals.attach(
        data.buffer,
        data.base,
        data.name,
        data.irqLine,
      );
      engine.record("device-attach", { base: data.base, name: data.name });
    }
    if (data.type === "detach") {
      engine.peripherals.detach(data.base);
      engine.record("device-detach", { base: data.base });
    }
    if (data.type === "platform") engine.configure(data.platform);
    if (data.type === "diagnostic") {
      engine.diagnostic = data.enabled;
      engine.logFetch = data.fetch;
      engine.lastRegisters = Array.from(
        { length: 32 },
        (_, i) => engine.m._reg(i) >>> 0,
      );
      engine.record("diagnostic", { enabled: data.enabled, fetch: data.fetch });
    }
    if (data.type === "clear-log") {
      engine.events = [];
      engine.droppedEvents = 0;
    }
    if (data.type === "load") engine.load(data.program);
    if (data.breakpoints) engine.breakpoints = new Set(data.breakpoints);
    if (data.memoryAddress !== undefined)
      engine.memoryAddress = data.memoryAddress;
    if (data.type === "watchpoint") {
      if (
        data.address !== null &&
        (!Number.isInteger(data.address) ||
          data.address < 0 ||
          data.address > 0xffffffff ||
          !["read", "write", "any"].includes(data.access))
      )
        throw Error("Invalid data watchpoint");
      engine.watchpoint =
        data.address === null
          ? null
          : { address: data.address, access: data.access };
      engine.record("watchpoint-config", { ...engine.watchpoint });
    }
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
