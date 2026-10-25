export const examples = {
  fibonacci: {
    name: "Fibonacci",
    description:
      "Watch a loop build the Fibonacci sequence. Results are written to RAM at 0x1000.",
    source: `# Fibonacci · first 12 values
li t0, 12
li t1, 0
li t2, 1
li a0, 0x1000
loop:
  sw t1, 0(a0)
  add a1, t1, t2
  mv t1, t2
  mv t2, a1
  addi a0, a0, 4
  addi t0, t0, -1
  bnez t0, loop
# Signal successful completion
li t0, 0xf0000004
sw zero, 0(t0)`,
  },
  hello: {
    name: "UART hello",
    description:
      "A tiny memory-mapped console. Each byte stored at 0xf0000000 appears in the terminal.",
    source: `# Print SCR1 followed by a newline
li t0, 0xf0000000
li a0, 83
sb a0, 0(t0)
li a0, 67
sb a0, 0(t0)
li a0, 82
sb a0, 0(t0)
li a0, 49
sb a0, 0(t0)
li a0, 10
sb a0, 0(t0)
sw zero, 4(t0)`,
  },
  multiply: {
    name: "Multiply & divide",
    description:
      "Compare arithmetic results and cycle costs on the real RV32IMC core.",
    source: `# Integer arithmetic in hardware
li a0, 144
li a1, 12
mul a2, a0, a1
div a3, a0, a1
rem a4, a0, a1
li t0, 0x1000
sw a2, 0(t0)
sw a3, 4(t0)
sw a4, 8(t0)
li t0, 0xf0000004
sw zero, 0(t0)`,
  },
};

examples.peripheral = {
  name: "MMIO cycle counter",
  description:
    "Attach the GPIO/counter module at 0x40000000. Count real simulated clocks, rotate GPIO, and copy the results to RAM.",
  source: `# GPIO + cycle counter · requires the Wasm peripheral
li t0, 0x40000000
li a0, 1
sw a0, 0(t0)
li a0, 128
sw a0, 4(t0)
sw zero, 8(t0)
li a0, 1
sw a0, 12(t0)
# The peripheral counts clock edges while this loop runs
li t1, 1000
count:
  addi t1, t1, -1
  bnez t1, count
sw zero, 12(t0)
# Capture GPIO and elapsed clocks in RAM
li t2, 0x1000
lw a0, 0(t0)
lw a1, 8(t0)
sw a0, 0(t2)
sw a1, 4(t2)
li t0, 0xf0000004
sw zero, 0(t0)`,
};
