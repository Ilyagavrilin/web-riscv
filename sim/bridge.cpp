#include "Vworkbench.h"
#include "verilated.h"
#include <memory>

namespace {
std::unique_ptr<VerilatedContext> context;
std::unique_ptr<Vworkbench> core;
void cycle() {
    core->clk = 0;
    core->eval();
    context->timeInc(1);
    core->clk = 1;
    core->eval();
    context->timeInc(1);
}
}

extern "C" {
void reset() {
    core.reset();
    context = std::make_unique<VerilatedContext>();
    context->threads(1);
    core = std::make_unique<Vworkbench>(context.get());
    core->rst_n = 0;
    for (int i = 0; i < 8; ++i) cycle();
}
void poke(unsigned address, unsigned value) {
    core->host_we = 1;
    core->host_addr = address;
    core->host_data = value;
    cycle();
    core->host_we = 0;
}
unsigned peek(unsigned address) {
    core->host_addr = address;
    core->eval();
    return core->host_read;
}
void mmio_response(unsigned hit, unsigned fault, unsigned data) {
    core->mmio_hit = hit;
    core->mmio_fault = fault;
    core->mmio_rdata = data;
}
void tick() { core->rst_n = 1; cycle(); }
unsigned reg(unsigned index) {
    core->reg_addr = index;
    core->eval();
    return core->reg_data;
}
unsigned signal(unsigned index) {
    switch (index) {
    case 0: return core->pc;
    case 1: return core->retired;
    case 2: return core->retired_pc;
    case 3: return core->trap;
    case 4: return core->cause;
    case 5: return core->uart_valid;
    case 6: return core->uart_data;
    case 7: return core->exit_valid;
    case 8: return core->exit_code;
    case 9: return core->imem_req;
    case 10: return core->imem_addr;
    case 11: return core->dmem_req;
    case 12: return core->dmem_write;
    case 13: return core->dmem_addr;
    case 14: return core->dmem_data;
    case 15: return core->dmem_width;
    case 16: return core->ready;
    case 17: return core->instruction_data;
    case 18: return core->instruction_response;
    case 19: return core->data_read;
    case 20: return core->data_response;
    case 21: return core->trap_value;
    case 22: return core->mstatus;
    case 23: return core->mepc;
    case 24: return core->mtval;
    case 25: return core->mcause;
    default: return 0;
    }
}
}
