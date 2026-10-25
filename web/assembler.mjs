import { disassemble } from "./disassemble.mjs";
export const aliases = [
  "zero",
  "ra",
  "sp",
  "gp",
  "tp",
  "t0",
  "t1",
  "t2",
  "s0",
  "s1",
  "a0",
  "a1",
  "a2",
  "a3",
  "a4",
  "a5",
  "a6",
  "a7",
  "s2",
  "s3",
  "s4",
  "s5",
  "s6",
  "s7",
  "s8",
  "s9",
  "s10",
  "s11",
  "t3",
  "t4",
  "t5",
  "t6",
];
const parseRegister = (s) => {
  const n = /^x([0-9]+)$/.exec(s)?.[1] ?? (s === "fp" ? 8 : aliases.indexOf(s));
  if (n === undefined || +n < 0 || +n > 31)
    throw Error(`Unknown register: ${s}`);
  return +n;
};
const number = (s) => {
  if (!/^-?(?:0x[\da-f]+|\d+)$/i.test(s ?? ""))
    throw Error(`Expected integer: ${s}`);
  const n = s.startsWith("-") ? -Number(s.slice(1)) : Number(s);
  if (!Number.isSafeInteger(n)) throw Error("Integer out of range");
  return n;
};
const signed = (n, bits) => {
  if (n < -(2 ** (bits - 1)) || n >= 2 ** (bits - 1))
    throw Error(`Immediate exceeds signed ${bits} bits`);
  return n & (2 ** bits - 1);
};
const rOps = {
  add: [0, 0],
  sub: [0, 32],
  sll: [1, 0],
  slt: [2, 0],
  sltu: [3, 0],
  xor: [4, 0],
  srl: [5, 0],
  sra: [5, 32],
  or: [6, 0],
  and: [7, 0],
  mul: [0, 1],
  mulh: [1, 1],
  mulhsu: [2, 1],
  mulhu: [3, 1],
  div: [4, 1],
  divu: [5, 1],
  rem: [6, 1],
  remu: [7, 1],
};
const iOps = { addi: 0, slti: 2, sltiu: 3, xori: 4, ori: 6, andi: 7 };
export function assemble(source, profile = { registers: 32, multiply: true }) {
  const register = (name) => {
    const index = parseRegister(name);
    if (index >= profile.registers)
      throw Error(`Register ${name} is unavailable in the selected ISA`);
    return index;
  };
  const labels = new Map(),
    records = [];
  let pc = 0x200;
  for (const [index, raw] of source.split("\n").entries()) {
    let text = raw.replace(/[#;].*$/, "").trim();
    while (/^[\w.]+:/.test(text)) {
      const label = text.slice(0, text.indexOf(":"));
      if (labels.has(label))
        throw Error(`Line ${index + 1}: duplicate label ${label}`);
      labels.set(label, pc);
      text = text.slice(text.indexOf(":") + 1).trim();
    }
    if (!text || /^\.(?:text|globl|global)\b/.test(text)) continue;
    const tokens = text
      .replaceAll(",", " ")
      .replaceAll("(", " ")
      .replaceAll(")", " ")
      .trim()
      .split(/\s+/);
    const [op, ...args] = tokens;
    const size =
      op === "la" ||
      (op === "li" && (number(args[1]) < -2048 || number(args[1]) > 2047))
        ? 8
        : 4;
    records.push({ pc, op, args, line: index + 1, text, size });
    pc += size;
  }
  if (pc > 65536) throw Error("Program exceeds 64 KiB RAM");
  const bytes = new Uint8Array(pc - 0x200),
    listing = [];
  const view = new DataView(bytes.buffer);
  for (const rec of records) {
    try {
      let { op, args: a, pc: p } = rec;
      let words;
      if (Object.hasOwn(rOps, op) && rOps[op][1] === 1 && !profile.multiply)
        throw Error(`${op} requires the M extension`);
      const imm = (s) => (labels.has(s) ? labels.get(s) : number(s));
      const count = (n) => {
        if (a.length !== n) throw Error(`${op} expects ${n} operands`);
      };
      const I = (opcode, f, rd, rs, value) =>
        (signed(value, 12) << 20) | (rs << 15) | (f << 12) | (rd << 7) | opcode;
      const R = (f, h) => {
        count(3);
        return (
          (h << 25) |
          (register(a[2]) << 20) |
          (register(a[1]) << 15) |
          (f << 12) |
          (register(a[0]) << 7) |
          0x33
        );
      };
      if (op === "nop") {
        count(0);
        words = [0x13];
      } else if (op === "ret") {
        count(0);
        words = [0x8067];
      } else if (op === "j") {
        count(1);
        op = "jal";
        a = ["zero", a[0]];
      } else if (op === "mv") {
        count(2);
        op = "addi";
        a = [...a, "0"];
      } else if (op === "beqz" || op === "bnez") {
        count(2);
        op = op === "beqz" ? "beq" : "bne";
        a = [a[0], "zero", a[1]];
      }
      if (!words) {
        if (op === "li" || op === "la") {
          count(2);
          const value = imm(a[1]);
          if (value < -2147483648 || value > 4294967295)
            throw Error("Value exceeds 32 bits");
          const lo = (value << 20) >> 20,
            hi = (value - lo) >>> 12;
          words =
            rec.size === 4
              ? [I(0x13, 0, register(a[0]), 0, value)]
              : [
                  (hi << 12) | (register(a[0]) << 7) | 0x37,
                  I(0x13, 0, register(a[0]), register(a[0]), lo),
                ];
        } else if (Object.hasOwn(rOps, op)) words = [R(...rOps[op])];
        else if (Object.hasOwn(iOps, op)) {
          count(3);
          words = [
            I(0x13, iOps[op], register(a[0]), register(a[1]), imm(a[2])),
          ];
        } else if (["slli", "srli", "srai"].includes(op)) {
          count(3);
          const shift = imm(a[2]);
          if (shift < 0 || shift > 31) throw Error("Shift must be 0…31");
          words = [
            I(
              0x13,
              op === "slli" ? 1 : 5,
              register(a[0]),
              register(a[1]),
              shift + (op === "srai" ? 1024 : 0),
            ),
          ];
        } else if (["lui", "auipc"].includes(op)) {
          count(2);
          const value = imm(a[1]);
          if (value < 0 || value > 0xfffff)
            throw Error("Upper immediate must be 0…0xfffff");
          words = [
            (value << 12) |
              (register(a[0]) << 7) |
              (op === "lui" ? 0x37 : 0x17),
          ];
        } else if (["lb", "lh", "lw", "lbu", "lhu"].includes(op)) {
          count(3);
          words = [
            I(
              3,
              { lb: 0, lh: 1, lw: 2, lbu: 4, lhu: 5 }[op],
              register(a[0]),
              register(a[2]),
              imm(a[1]),
            ),
          ];
        } else if (["sb", "sh", "sw"].includes(op)) {
          count(3);
          const v = signed(imm(a[1]), 12);
          words = [
            ((v >>> 5) << 25) |
              (register(a[0]) << 20) |
              (register(a[2]) << 15) |
              ({ sb: 0, sh: 1, sw: 2 }[op] << 12) |
              ((v & 31) << 7) |
              0x23,
          ];
        } else if (["beq", "bne", "blt", "bge", "bltu", "bgeu"].includes(op)) {
          count(3);
          const offset = imm(a[2]) - p,
            v = signed(offset, 13);
          if (offset % 2) throw Error("Unaligned branch");
          words = [
            ((v >>> 12) << 31) |
              (((v >>> 5) & 63) << 25) |
              (register(a[1]) << 20) |
              (register(a[0]) << 15) |
              ({ beq: 0, bne: 1, blt: 4, bge: 5, bltu: 6, bgeu: 7 }[op] << 12) |
              (((v >>> 1) & 15) << 8) |
              (((v >>> 11) & 1) << 7) |
              0x63,
          ];
        } else if (op === "jal") {
          if (a.length === 1) a = ["ra", a[0]];
          count(2);
          const offset = imm(a[1]) - p,
            v = signed(offset, 21);
          if (offset % 2) throw Error("Unaligned jump");
          words = [
            ((v >>> 20) << 31) |
              (((v >>> 1) & 1023) << 21) |
              (((v >>> 11) & 1) << 20) |
              (((v >>> 12) & 255) << 12) |
              (register(a[0]) << 7) |
              0x6f,
          ];
        } else if (op === "jalr") {
          count(3);
          words = [I(0x67, 0, register(a[0]), register(a[2]), imm(a[1]))];
        } else if (["ecall", "ebreak", "wfi"].includes(op)) {
          count(0);
          words = [{ ecall: 0x73, ebreak: 0x100073, wfi: 0x10500073 }[op]];
        } else if (op === ".word") {
          count(1);
          const v = imm(a[0]);
          if (v < -2147483648 || v > 4294967295)
            throw Error("Word exceeds 32 bits");
          words = [v];
        } else throw Error(`Unsupported instruction: ${op}`);
      }
      words.forEach((word, i) => {
        view.setUint32(rec.pc - 0x200 + i * 4, word >>> 0, true);
        listing.push({
          address: rec.pc + i * 4,
          word: word >>> 0,
          line: rec.line,
          text: rec.text,
        });
      });
    } catch (error) {
      throw Error(`Line ${rec.line}: ${error.message}`);
    }
  }
  if (!bytes.length) throw Error("Program is empty");
  return { segments: [{ address: 0x200, bytes }], entry: 0x200, listing };
}

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
