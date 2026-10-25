const x = (n) => `x${n}`;
const signed = (n, bits) => (n << (32 - bits)) >> (32 - bits);
const address = (n) => `0x${(n >>> 0).toString(16)}`;
export function disassemble(word, pc = 0) {
  if ((word & 3) !== 3) {
    const h = word & 65535,
      rd = (h >>> 7) & 31,
      imm = signed(((h >>> 2) & 31) | ((h >>> 7) & 32), 6);
    if (h === 0x9002) return "c.ebreak";
    if (h === 1) return "c.nop";
    if ((h & 0xe003) === 0x4001) return `c.li ${x(rd)}, ${imm}`;
    if ((h & 0xe003) === 1) return `c.addi ${x(rd)}, ${imm}`;
    return `.hword 0x${h.toString(16).padStart(4, "0")}`;
  }
  const opcode = word & 127,
    rd = (word >>> 7) & 31,
    f3 = (word >>> 12) & 7,
    rs1 = (word >>> 15) & 31,
    rs2 = (word >>> 20) & 31,
    f7 = word >>> 25,
    imm = word >> 20;
  if (opcode === 0x33) {
    const op =
      f7 === 1
        ? ["mul", "mulh", "mulhsu", "mulhu", "div", "divu", "rem", "remu"][f3]
        : f7 === 0
          ? ["add", "sll", "slt", "sltu", "xor", "srl", "or", "and"][f3]
          : f7 === 32
            ? { 0: "sub", 5: "sra" }[f3]
            : null;
    if (op) return `${op} ${x(rd)}, ${x(rs1)}, ${x(rs2)}`;
  }
  if (opcode === 0x13) {
    const op = {
      0: "addi",
      2: "slti",
      3: "sltiu",
      4: "xori",
      6: "ori",
      7: "andi",
    }[f3];
    if (op) return `${op} ${x(rd)}, ${x(rs1)}, ${imm}`;
    if (f3 === 1 && f7 === 0) return `slli ${x(rd)}, ${x(rs1)}, ${rs2}`;
    if (f3 === 5 && (f7 === 0 || f7 === 32))
      return `${f7 ? "srai" : "srli"} ${x(rd)}, ${x(rs1)}, ${rs2}`;
  }
  if (opcode === 3) {
    const op = { 0: "lb", 1: "lh", 2: "lw", 4: "lbu", 5: "lhu" }[f3];
    if (op) return `${op} ${x(rd)}, ${imm}(${x(rs1)})`;
  }
  if (opcode === 0x23) {
    const op = { 0: "sb", 1: "sh", 2: "sw" }[f3];
    if (op)
      return `${op} ${x(rs2)}, ${signed(((word >>> 25) << 5) | ((word >>> 7) & 31), 12)}(${x(rs1)})`;
  }
  if (opcode === 0x63) {
    const op = { 0: "beq", 1: "bne", 4: "blt", 5: "bge", 6: "bltu", 7: "bgeu" }[
      f3
    ];
    const off = signed(
      ((word >>> 31) << 12) |
        (((word >>> 7) & 1) << 11) |
        (((word >>> 25) & 63) << 5) |
        (((word >>> 8) & 15) << 1),
      13,
    );
    if (op) return `${op} ${x(rs1)}, ${x(rs2)}, ${address(pc + off)}`;
  }
  if (opcode === 0x6f) {
    const off = signed(
      ((word >>> 31) << 20) |
        (((word >>> 12) & 255) << 12) |
        (((word >>> 20) & 1) << 11) |
        (((word >>> 21) & 1023) << 1),
      21,
    );
    return `jal ${x(rd)}, ${address(pc + off)}`;
  }
  if (opcode === 0x67 && f3 === 0) return `jalr ${x(rd)}, ${imm}(${x(rs1)})`;
  if (opcode === 0x37 || opcode === 0x17)
    return `${opcode === 0x37 ? "lui" : "auipc"} ${x(rd)}, ${address(word >>> 12)}`;
  if (opcode === 0x73) {
    if (word === 0x73) return "ecall";
    if (word === 0x100073) return "ebreak";
    if (word === 0x10500073) return "wfi";
    if (word === 0x30200073) return "mret";
    const op = {
      1: "csrrw",
      2: "csrrs",
      3: "csrrc",
      5: "csrrwi",
      6: "csrrsi",
      7: "csrrci",
    }[f3];
    if (op)
      return `${op} ${x(rd)}, ${address(word >>> 20)}, ${f3 >= 5 ? rs1 : x(rs1)}`;
  }
  return `.word 0x${(word >>> 0).toString(16).padStart(8, "0")}`;
}
