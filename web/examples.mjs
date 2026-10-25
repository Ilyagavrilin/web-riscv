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

examples.timer = {
  name: "Clocked timer",
  description:
    "Attach the timer at 0x40000100. Poll its compare flag, then store elapsed clocks and status at 0x1000.",
  source: `# One-shot timer: match after 64 active rising edges
li t0, 0x40000100
li a0, 64
sw a0, 4(t0)
sw zero, 8(t0)
li a0, 1
sw a0, 12(t0)
sw a0, 0(t0)
wait:
  lw a1, 12(t0)
  andi a1, a1, 1
  beqz a1, wait
li t1, 0x1000
lw a0, 8(t0)
sw a0, 0(t1)
sw a1, 4(t1)
# Clear sticky flag by writing one
sw a1, 12(t0)
li t0, 0xf0000004
sw zero, 0(t0)`,
};
examples.mailbox = {
  name: "Clocked mailbox FIFO",
  description:
    "Attach the mailbox at 0x40000200. Send three words, let the clock transfer them, and receive them into RAM at 0x1000.",
  source: `# Queue three words; each transfer follows a CPU clock edge
li t0, 0x40000200
li a0, 17
sw a0, 0(t0)
li a0, 34
sw a0, 0(t0)
li a0, 51
sw a0, 0(t0)
li t1, 0x1000
li t2, 3
receive:
  lw a1, 8(t0)
  andi a1, a1, 15
  beqz a1, receive
  lw a0, 4(t0)
  sw a0, 0(t1)
  addi t1, t1, 4
  addi t2, t2, -1
  bnez t2, receive
li t0, 0xf0000004
sw zero, 0(t0)`,
};

examples.dma = {
  name: "TLM DMA copy",
  description:
    "Attach DMA at 0x40000300. Copy four RAM words without CPU loads and stores, then check the completion count.",
  source: `li t0, 0x1000
li a0, 17
sw a0, 0(t0)
li a0, 34
sw a0, 4(t0)
li a0, 51
sw a0, 8(t0)
li a0, 68
sw a0, 12(t0)
li t0, 0x40000300
li a0, 0x1000
sw a0, 0(t0)
li a0, 0x1100
sw a0, 4(t0)
li a0, 4
sw a0, 8(t0)
li a0, 1
sw a0, 12(t0)
wait_dma:
  lw a1, 16(t0)
  andi a2, a1, 1
  bnez a2, wait_dma
lw a0, 20(t0)
li t1, 0x1010
sw a0, 0(t1)
andi a1, a1, 4
li t0, 0xf0000004
sw a1, 0(t0)`,
};
examples.interrupt = {
  name: "Timer interrupt + mret",
  description:
    "Attach timer at 0x40000100 routed to IRQ 0. Enter an interrupt handler, acknowledge the timer, and return to the main program. Works on all three profiles.",
  source: `.section .vectors,"ax"
j handler
.text
li t0, 0x1c0
csrw mtvec, t0
.if SCR1_HAS_IPIC
  csrw 0xbf6, zero
  li t0, 2
  csrw 0xbf7, t0
.endif
li t0, 0x800
csrs mie, t0
csrsi mstatus, 8
li t0, 0x40000100
li a0, 80
sw a0, 4(t0)
li a0, 5
li a2, 0
sw a0, 0(t0)
wait_irq:
  beqz a2, wait_irq
li t0, 0x1000
sw a2, 0(t0)
li t0, 0xf0000004
sw zero, 0(t0)
.balign 64
handler:
.if SCR1_HAS_IPIC
  csrw 0xbf5, zero
.endif
li a3, 0x40000100
li a4, 1
sw a4, 12(a3)
.if SCR1_HAS_IPIC
  csrw 0xbf4, zero
.endif
addi a2, a2, 1
mret`,
};
