import { peripheralHost } from "./wasi.mjs";
export class PeripheralBus {
  devices = new Map();
  get device() {
    return this.devices.values().next().value;
  }
  async attach(buffer, base, name) {
    if (
      !Number.isInteger(base) ||
      base < 65536 ||
      base > 0xfffffff0 ||
      base % 4
    )
      throw Error("Peripheral base must be word-aligned and outside RAM");
    if (buffer.byteLength > 4 * 1024 * 1024)
      throw Error("Peripheral exceeds 4 MiB");
    const module = await WebAssembly.compile(buffer);
    const runtime = peripheralHost();
    for (const entry of WebAssembly.Module.imports(module))
      if (!runtime.supports(entry))
        throw Error(
          `Unsupported peripheral import: ${entry.module}.${entry.name}`,
        );
    const instance = await WebAssembly.instantiate(module, runtime.imports),
      exports = instance.exports;
    runtime.host.instance = instance;
    if (
      typeof SharedArrayBuffer !== "undefined" &&
      exports.memory?.buffer instanceof SharedArrayBuffer
    )
      throw Error(
        "Peripheral shared memory is not supported on this static site",
      );
    for (const key of [
      "mmio_abi_version",
      "mmio_size",
      "mmio_reset",
      "mmio_read",
      "mmio_write",
    ]) {
      if (typeof exports[key] !== "function")
        throw Error(`Missing peripheral export: ${key}`);
    }
    for (const key of ["mmio_tick", "mmio_inspect", "_initialize"]) {
      if (key in exports && typeof exports[key] !== "function")
        throw Error(`Invalid optional peripheral export: ${key}`);
    }
    instance.exports._initialize?.();
    if (exports.mmio_abi_version() !== 1)
      throw Error("Unsupported MMIO ABI version");
    const size = exports.mmio_size() >>> 0;
    if (size < 4 || size > 65536 || size % 4 || base + size > 0x100000000)
      throw Error(
        "Peripheral size must be 4…65536 bytes, word-aligned, without address wrap",
      );
    if (base < 0xf0000008 && base + size > 0xf0000000)
      throw Error("Peripheral overlaps the built-in UART/exit registers");
    for (const d of this.devices.values()) {
      if (d.base !== base && base < d.base + d.size && base + size > d.base)
        throw Error(`MMIO window overlaps ${d.name}`);
    }
    exports.mmio_reset();
    this.devices.set(base, {
      exports,
      base,
      size,
      name,
      messages: runtime.host.messages,
    });
  }
  detach(base) {
    if (base === undefined) this.devices.clear();
    else this.devices.delete(base);
  }
  reset() {
    for (const d of this.devices.values()) d.exports.mmio_reset();
  }
  dispatch(bus) {
    this.lastFault = undefined;
    const d = [...this.devices.values()].find(
      (d) => bus.address >= d.base && bus.address < d.base + d.size,
    );
    if (
      !d ||
      !bus.request ||
      bus.address < d.base ||
      bus.address >= d.base + d.size
    )
      return { hit: 0, fault: 0, data: 0 };
    const width = 1 << bus.width,
      offset = bus.address - d.base;
    if (width > 4 || offset + width > d.size || offset % width)
      return { hit: 1, fault: 1, data: 0 };
    try {
      if (bus.write) {
        d.exports.mmio_write(offset, bus.data, width);
        return { hit: 1, fault: 0, data: 0 };
      }
      return {
        hit: 1,
        fault: 0,
        data: d.exports.mmio_read(offset, width) >>> 0,
      };
    } catch {
      this.lastFault = `Module trapped: ${d.name}`;
      this.detach(d.base);
      return { hit: 1, fault: 1, data: 0 };
    }
  }
  tick() {
    for (const d of this.devices.values()) {
      try {
        d.exports.mmio_tick?.(1);
      } catch {
        this.detach(d.base);
        throw Error(`Peripheral tick trapped: ${d.name}; module detached`);
      }
    }
  }
  snapshots() {
    return [...this.devices.values()].map((d) => ({
      messages: d.messages,
      name: d.name,
      base: d.base,
      size: d.size,
      words:
        typeof d.exports.mmio_inspect === "function"
          ? Array.from(
              { length: Math.min(16, d.size / 4) },
              (_, i) => d.exports.mmio_inspect(i * 4) >>> 0,
            )
          : [],
    }));
  }
  snapshot() {
    return this.snapshots()[0] ?? null;
  }
}
