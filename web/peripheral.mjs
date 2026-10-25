export class PeripheralBus {
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
    if (WebAssembly.Module.imports(module).length)
      throw Error("Peripheral must be standalone: imports are not supported");
    const instance = await WebAssembly.instantiate(module, {}),
      exports = instance.exports;
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
    exports.mmio_reset();
    this.device = { exports, base, size, name };
  }
  detach() {
    this.device = undefined;
  }
  reset() {
    this.device?.exports.mmio_reset();
  }
  dispatch(bus) {
    const d = this.device;
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
      this.detach();
      return { hit: 1, fault: 1, data: 0 };
    }
  }
  tick() {
    try {
      this.device?.exports.mmio_tick?.(1);
    } catch {
      this.detach();
      throw Error("Peripheral tick trapped; module detached");
    }
  }
  snapshot() {
    const d = this.device;
    if (!d) return null;
    return {
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
    };
  }
}
