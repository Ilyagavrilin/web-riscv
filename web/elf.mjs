import { disassemble } from "./disassemble.mjs";
export function loadElf(buffer) {
  const v = new DataView(buffer),
    bytes = new Uint8Array(buffer);
  if (
    v.byteLength < 52 ||
    v.getUint32(0, false) !== 0x7f454c46 ||
    v.getUint8(4) !== 1 ||
    v.getUint8(5) !== 1 ||
    v.getUint8(6) !== 1 ||
    v.getUint16(18, true) !== 243 ||
    v.getUint16(16, true) !== 2
  )
    throw Error("Expected little-endian ELF32 RISC-V executable");
  const entry = v.getUint32(24, true),
    start = v.getUint32(28, true),
    size = v.getUint16(42, true),
    count = v.getUint16(44, true);
  if (entry !== 0x200) throw Error("Link ELF entry at SCR1 reset vector 0x200");
  if (
    size < 32 ||
    count === 0 ||
    count > 128 ||
    start + size * count > bytes.length
  )
    throw Error("Invalid ELF program headers");
  const segments = [];
  for (let i = 0; i < count; i++) {
    const h = start + i * size;
    if (v.getUint32(h, true) !== 1) continue;
    const offset = v.getUint32(h + 4, true),
      address = v.getUint32(h + 8, true),
      length = v.getUint32(h + 16, true),
      memory = v.getUint32(h + 20, true);
    if (
      length > memory ||
      offset + length > bytes.length ||
      address + memory > 65536
    )
      throw Error("ELF segment exceeds file or RAM");
    const data = new Uint8Array(memory);
    data.set(bytes.subarray(offset, offset + length));
    segments.push({
      address,
      bytes: data,
      fileSize: length,
      memorySize: memory,
      flags: v.getUint32(h + 24, true),
    });
  }
  if (
    !segments.some(
      (s) => entry >= s.address && entry < s.address + s.bytes.length,
    )
  )
    throw Error("ELF entry is outside loaded segments");
  const listing = [];
  const executable = segments.filter((s) => s.flags & 1);
  for (const segment of executable.length
    ? executable
    : segments.filter(
        (s) => entry >= s.address && entry < s.address + s.fileSize,
      )) {
    const code = new DataView(segment.bytes.buffer);
    for (let offset = 0; offset + 2 <= segment.fileSize;) {
      const half = code.getUint16(offset, true);
      const length = (half & 3) === 3 && offset + 4 <= segment.fileSize ? 4 : 2;
      const word = length === 4 ? code.getUint32(offset, true) : half;
      listing.push({
        address: segment.address + offset,
        word,
        size: length,
        text: disassemble(word, segment.address + offset),
      });
      offset += length;
    }
  }
  return {
    entry,
    segments,
    listing,
    format: "ELF32",
    abi: v.getUint32(36, true) & 8 ? "ilp32e" : "ilp32",
  };
}
