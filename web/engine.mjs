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
    this.diagnostic = false;
    this.watchpoint = null;
    this.logFetch = false;
    this.events = [];
    this.eventSequence = 0;
    this.droppedEvents = 0;
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
    this.events = [];
    this.eventSequence = 0;
    this.droppedEvents = 0;
    this.lastRegisters = Array.from(
      { length: 32 },
      (_, i) => this.m._reg(i) >>> 0,
    );
    this.record("load", {
      entry: program.entry,
      bytes: program.segments.reduce((n, s) => n + s.bytes.length, 0),
    });
  }
  record(kind, detail = {}) {
    this.events.push({
      sequence: ++this.eventSequence,
      cycle: this.cycles ?? 0,
      kind,
      ...detail,
    });
    const limit = this.diagnostic ? 10000 : 1000;
    const excess = this.events.length - limit;
    if (excess > 0) {
      this.events.splice(0, excess);
      this.droppedEvents += excess;
    }
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
    const accepted = Boolean(m._signal(16));
    const response = this.peripherals.dispatch({
      ...bus,
      request: bus.request && accepted,
    });
    m._mmio_response(response.hit, response.fault, response.data);
    m._tick();
    this.peripherals.tick();
    this.cycles++;
    if (this.diagnostic && accepted && bus.request) {
      const target =
        bus.address < 65536
          ? "RAM"
          : bus.address === 0xf0000000
            ? "UART"
            : bus.address === 0xf0000004
              ? "Exit"
              : ([...this.peripherals.devices.values()].find(
                  (d) => bus.address >= d.base && bus.address < d.base + d.size,
                )?.name ?? "unmapped");
      this.record(
        target === "RAM" || target === "unmapped" ? "memory" : "mmio",
        {
          pc: bus.pc,
          address: bus.address,
          target,
          operation: bus.write ? "write" : "read",
          width: 1 << bus.width,
          data: bus.write
            ? bus.data
            : m._signal(20) === 1
              ? m._signal(19) >>> 0
              : null,
          response: m._signal(20) === 1 ? "ok" : "error",
          deviceFault: this.peripherals.lastFault,
        },
      );
    }
    if (this.diagnostic && this.logFetch && accepted && bus.fetch)
      this.record("fetch", {
        address: bus.fetchAddress,
        data: m._signal(18) === 1 ? m._signal(17) >>> 0 : null,
        response: m._signal(18) === 1 ? "ok" : "error",
      });
    if (accepted && bus.request && this.watchpoint) {
      const w = this.watchpoint;
      if (
        w.address >= bus.address &&
        w.address < bus.address + (1 << bus.width) &&
        (w.access === "any" || w.access === (bus.write ? "write" : "read"))
      ) {
        this.status = "watchpoint";
        this.record("watchpoint", {
          pc: bus.pc,
          address: bus.address,
          operation: bus.write ? "write" : "read",
          width: 1 << bus.width,
        });
      }
    }
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
      if (this.diagnostic) {
        const registers = this.history.at(-1).registers;
        const changes = [];
        for (let i = 1; i < this.config.registers; i++)
          if (registers[i] !== this.lastRegisters[i])
            changes.push({
              register: i,
              before: this.lastRegisters[i],
              after: registers[i],
            });
        this.record("retire", { pc: this.lastPC, changes });
        this.lastRegisters = registers.slice();
      }
      if (this.history.length > 1024) this.history.shift();
    }
    if (m._signal(5)) {
      if (this.diagnostic) this.record("uart", { byte: m._signal(6) });
      this.console = (this.console + String.fromCharCode(m._signal(6))).slice(
        -16384,
      );
    }
    if (m._signal(7)) {
      this.status = "halted";
      this.exitCode = m._signal(8) >>> 0;
      this.record("exit", { code: this.exitCode });
    }
    if (m._signal(3)) {
      this.status = "trap";
      this.cause = m._signal(4);
      this.record("trap", {
        pc: m._signal(2) >>> 0,
        cause: this.cause,
        value: m._signal(21) >>> 0,
      });
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
        this.record("breakpoint", { pc: this.m._signal(0) >>> 0 });
        break;
      }
      this.status = "paused";
      this.tick();
      if (this.status === "watchpoint") break;
      if (mode === "cycle" || (mode === "instruction" && this.retired > before))
        break;
    }
    return this.snapshot();
  }
  snapshot() {
    return {
      watchpoint: this.watchpoint,
      diagnostic: this.diagnostic,
      events: this.events.slice(-200),
      retainedEvents: this.events.length,
      droppedEvents: this.droppedEvents,
      csr: {
        mstatus: this.m._signal(22) >>> 0,
        mepc: this.m._signal(23) >>> 0,
        mtval: this.m._signal(24) >>> 0,
        mcause: this.m._signal(25) >>> 0,
      },
      peripherals: this.peripherals.snapshots(),
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
    return {
      ...this.snapshot(),
      events: this.events,
      history: this.history,
      wave: this.wave,
      schemaVersion: 2,
      timing: "bus sampled before rising edge; events numbered at that edge",
    };
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
