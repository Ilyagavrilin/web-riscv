import { PeripheralBus } from "./peripheral.mjs";
import profiles from "./profiles.json" with { type: "json" };
export class Engine {
  constructor(module, profile = "imc") {
    if (!Object.hasOwn(profiles, profile)) throw Error("Unknown SCR1 profile");
    this.profile = profile;
    this.config = profiles[profile];
    this.m = module;
    this.peripherals = new PeripheralBus();
    this.breakpoints = new Set();
    this.memoryAddress = 0x1000;
  }
  load(program) {
    this.peripherals.reset();
    this.m._reset();
    for (let i = 0; i < 65536; i++) this.m._poke(i, 0);
    for (const s of program.segments)
      for (let i = 0; i < s.bytes.length; i++)
        this.m._poke(s.address + i, s.bytes[i]);
    this.exitCode = undefined;
    this.cause = undefined;
    this.resumePC = null;
    this.cycles = 0;
    this.retired = 0;
    this.console = "";
    this.history = [];
    this.wave = [];
    this.status = "paused";
    this.lastPC = null;
  }
  tick() {
    if (this.status === "halted" || this.status === "trap") return;
    const m = this.m;
    const bus = {
      cycle: this.cycles + 1,
      pc: m._signal(0) >>> 0,
      fetch: m._signal(9),
      fetchAddress: m._signal(10) >>> 0,
      request: m._signal(11),
      write: m._signal(12),
      address: m._signal(13) >>> 0,
      data: m._signal(14) >>> 0,
      width: m._signal(15),
    };
    const response = this.peripherals.dispatch(bus);
    m._mmio_response(response.hit, response.fault, response.data);
    m._tick();
    this.peripherals.tick();
    this.cycles++;
    this.wave.push(bus);
    if (this.wave.length > 4096) this.wave.shift();
    if (m._signal(1)) {
      this.retired++;
      this.lastPC = m._signal(2);
      this.history.push({
        cycle: this.cycles,
        pc: this.lastPC,
        registers: Array.from({ length: 32 }, (_, i) => m._reg(i) >>> 0),
      });
      if (this.history.length > 1024) this.history.shift();
    }
    if (m._signal(5))
      this.console = (this.console + String.fromCharCode(m._signal(6))).slice(
        -16384,
      );
    if (m._signal(7)) {
      this.status = "halted";
      this.exitCode = m._signal(8) >>> 0;
    }
    if (m._signal(3)) {
      this.status = "trap";
      this.cause = m._signal(4);
    }
  }
  advance(mode, budget = 2000) {
    const before = this.retired;
    if (this.status === "breakpoint") this.resumePC = this.m._signal(0);
    for (let i = 0; i < budget; i++) {
      if (this.status === "halted" || this.status === "trap") break;
      if (this.resumePC !== null && this.m._signal(0) !== this.resumePC)
        this.resumePC = null;
      if (
        mode === "run" &&
        this.resumePC !== this.m._signal(0) &&
        this.breakpoints.has(this.m._signal(0)) &&
        this.cycles > 0
      ) {
        this.status = "breakpoint";
        break;
      }
      this.status = "paused";
      this.tick();
      if (mode === "cycle" || (mode === "instruction" && this.retired > before))
        break;
    }
    return this.snapshot();
  }
  snapshot() {
    return {
      peripheral: this.peripherals.snapshot(),
      profile: this.profile,
      isa: this.config.isa,
      registerCount: this.config.registers,
      cycles: this.cycles,
      retired: this.retired,
      pc: this.m._signal(0) >>> 0,
      lastPC: this.lastPC,
      status: this.status,
      cause: this.cause,
      exitCode: this.exitCode,
      console: this.console,
      registers: Array.from({ length: 32 }, (_, i) => this.m._reg(i) >>> 0),
      history: this.history.slice(-80),
      wave: this.wave.slice(-48),
      memory: Array.from({ length: 128 }, (_, i) =>
        this.m._peek(this.memoryAddress + i),
      ),
      memoryAddress: this.memoryAddress,
    };
  }
  export() {
    return { ...this.snapshot(), history: this.history, wave: this.wave };
  }
}
export function toVcd(wave) {
  const fields = [
    ["pc", 32, "!"],
    ["fetch", 1, '"'],
    ["fetchAddress", 32, "#"],
    ["request", 1, "$"],
    ["write", 1, "%"],
    ["address", 32, "&"],
    ["data", 32, "'"],
    ["width", 2, "("],
  ];
  const header = [
    "$timescale 1ns $end",
    "$scope module scr1_bus $end",
    ...fields.map(([name, bits, id]) => `$var wire ${bits} ${id} ${name} $end`),
    "$upscope $end",
    "$enddefinitions $end",
  ];
  return (
    [
      ...header,
      ...wave.flatMap((row) => [
        `#${row.cycle}`,
        ...fields.map(
          ([name, , id]) => `b${(row[name] >>> 0).toString(2)} ${id}`,
        ),
      ]),
    ].join("\n") + "\n"
  );
}
