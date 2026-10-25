`include "scr1_memif.svh"

module workbench (
    input logic clk, rst_n,
    input logic host_we,
    input logic [15:0] host_addr,
    input logic [7:0] host_data,
    input logic mmio_hit, mmio_fault,
    input logic [31:0] mmio_rdata,
    input logic [4:0] reg_addr,
    output logic [31:0] reg_data,
    output logic [31:0] pc, retired_pc,
    output logic retired, trap,
    output logic [31:0] cause, trap_value,
    output logic [31:0] mstatus, mepc, mtval, mcause,
    output logic ready,
    output logic [31:0] instruction_data, data_read,
    output logic [1:0] instruction_response, data_response,
    output logic uart_valid, exit_valid,
    output logic [7:0] uart_data,
    output logic [31:0] exit_code,
    output logic imem_req, dmem_req, dmem_write,
    output logic [31:0] imem_addr, dmem_addr, dmem_data,
    output logic [1:0] dmem_width,
    output logic [7:0] host_read
);
    logic [7:0] memory [0:65535];
    logic [31:0] imem_rdata, dmem_rdata;
    type_scr1_mem_resp_e imem_resp, dmem_resp;
    type_scr1_mem_cmd_e imem_cmd, dmem_cmd;
    type_scr1_mem_width_e width;
    logic core_reset;

    assign ready = core_reset;
    assign instruction_data = imem_rdata;
    assign instruction_response = imem_resp;
    assign data_read = dmem_rdata;
    assign data_response = dmem_resp;
    assign mstatus = core.i_pipe_top.i_pipe_csr.csr_mstatus;
    assign mepc = core.i_pipe_top.i_pipe_csr.csr_mepc;
    assign mtval = core.i_pipe_top.i_pipe_csr.csr_mtval_ff;
    assign mcause = {core.i_pipe_top.i_pipe_csr.csr_mcause_i_ff, 27'b0, core.i_pipe_top.i_pipe_csr.csr_mcause_ec_ff};
    assign host_read = memory[host_addr];
    assign dmem_write = dmem_cmd == SCR1_MEM_CMD_WR;
    assign dmem_width = width;
    assign pc = core.i_pipe_top.curr_pc;
`ifdef SCR1_RVE_EXT
    assign reg_data = reg_addr == 0 || reg_addr >= 16 ? 0 : core.i_pipe_top.i_pipe_mprf.mprf_int[reg_addr[3:0]];
`else
    assign reg_data = reg_addr == 0 ? 0 : core.i_pipe_top.i_pipe_mprf.mprf_int[reg_addr];
`endif
    always_ff @(posedge clk) begin
        if (host_we) memory[host_addr] <= host_data;
        retired <= rst_n && core_reset && (core.i_pipe_top.instret && !core.i_pipe_top.exu2csr_take_exc);
        retired_pc <= pc;
        trap <= rst_n && core_reset && core.i_pipe_top.exu2csr_take_exc;
        trap_value <= core.i_pipe_top.exu2csr_trap_val;
        cause <= {28'b0, core.i_pipe_top.exu2csr_exc_code};
        uart_valid <= 0;
        exit_valid <= 0;
        imem_resp <= SCR1_MEM_RESP_NOTRDY;
        dmem_resp <= SCR1_MEM_RESP_NOTRDY;
        if (rst_n && core_reset && imem_req) begin
            imem_resp <= imem_addr <= 65532 ? SCR1_MEM_RESP_RDY_OK : SCR1_MEM_RESP_RDY_ER;
            imem_rdata <= {memory[(imem_addr[15:0] & 16'hfffc) | 3], memory[(imem_addr[15:0] & 16'hfffc) | 2],
                           memory[(imem_addr[15:0] & 16'hfffc) | 1], memory[imem_addr[15:0] & 16'hfffc]};
        end
        if (rst_n && core_reset && dmem_req) begin
            dmem_resp <= SCR1_MEM_RESP_RDY_OK;
            if (dmem_addr == 32'hf0000000 && dmem_write) begin
                uart_valid <= 1;
                uart_data <= dmem_data[7:0];
            end else if (dmem_addr == 32'hf0000004 && dmem_write) begin
                exit_valid <= 1;
                exit_code <= dmem_data;
            end else if (mmio_hit) begin
                dmem_resp <= mmio_fault ? SCR1_MEM_RESP_RDY_ER : SCR1_MEM_RESP_RDY_OK;
                dmem_rdata <= mmio_rdata;
            end else if (dmem_addr < 65536 && dmem_addr + (1 << width) <= 65536) begin
                if (dmem_write) begin
                    for (int i = 0; i < 4; i++)
                        if (i < (1 << width)) memory[dmem_addr + i] <= dmem_data[i*8 +: 8];
                end else begin
                    dmem_rdata <= 0;
                    for (int i = 0; i < 4; i++)
                        if (i < (1 << width)) dmem_rdata[i*8 +: 8] <= memory[dmem_addr + i];
                end
            end else dmem_resp <= SCR1_MEM_RESP_RDY_ER;
        end
    end

    scr1_core_top core (
        .clk(clk), .pwrup_rst_n(rst_n), .rst_n(rst_n), .cpu_rst_n(rst_n),
        .test_mode(1'b0), .test_rst_n(1'b1), .core_rst_n_o(core_reset),
        .core_rdc_qlfy_o(), .core_fuse_mhartid_i(32'b0),
        .core_irq_soft_i(1'b0), .core_irq_mtimer_i(1'b0), .core_mtimer_val_i(64'b0),
`ifdef SCR1_DBG_EN
        .sys_rst_n_o(), .sys_rdc_qlfy_o(), .tapc_fuse_idcode_i(32'hDEB11001),
        .tapc_trst_n(rst_n), .tapc_tck(1'b0), .tapc_tms(1'b0), .tapc_tdi(1'b0),
        .tapc_tdo(), .tapc_tdo_en(),
`endif
`ifdef SCR1_IPIC_EN
        .core_irq_lines_i(16'b0),
`else
        .core_irq_ext_i(1'b0),
`endif
        .imem2core_req_ack_i(imem_req && core_reset), .core2imem_req_o(imem_req),
        .core2imem_cmd_o(imem_cmd), .core2imem_addr_o(imem_addr),
        .imem2core_rdata_i(imem_rdata), .imem2core_resp_i(imem_resp),
        .dmem2core_req_ack_i(dmem_req && core_reset), .core2dmem_req_o(dmem_req),
        .core2dmem_cmd_o(dmem_cmd), .core2dmem_width_o(width),
        .core2dmem_addr_o(dmem_addr), .core2dmem_wdata_o(dmem_data),
        .dmem2core_rdata_i(dmem_rdata), .dmem2core_resp_i(dmem_resp)
    );
endmodule
