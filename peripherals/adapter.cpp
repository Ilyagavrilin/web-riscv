#include <cstdio>
#include <scr1/target.hpp>
#include <tlm_utils/simple_initiator_socket.h>
#include <tlm_utils/simple_target_socket.h>

namespace {
class HostBus final : public sc_core::sc_module, public tlm::tlm_fw_transport_if<> {
public:
    tlm::tlm_target_socket<32, tlm::tlm_base_protocol_types, 1, sc_core::SC_ZERO_OR_MORE_BOUND>
        socket{"bus"};
    tlm::tlm_generic_payload *pending = nullptr;
    explicit HostBus(sc_core::sc_module_name name) : sc_module(name) { socket.bind(*this); }
    tlm::tlm_sync_enum nb_transport_fw(tlm::tlm_generic_payload &payload, tlm::tlm_phase &phase,
                                       sc_core::sc_time &delay) override {
        sc_assert(!pending && phase == tlm::BEGIN_REQ && delay == sc_core::SC_ZERO_TIME &&
                  payload.has_mm());
        payload.acquire();
        pending = &payload;
        return tlm::TLM_ACCEPTED;
    }
    void b_transport(tlm::tlm_generic_payload &payload, sc_core::sc_time &) override {
        payload.set_response_status(tlm::TLM_COMMAND_ERROR_RESPONSE);
    }
    unsigned transport_dbg(tlm::tlm_generic_payload &) override { return 0; }
    bool get_direct_mem_ptr(tlm::tlm_generic_payload &, tlm::tlm_dmi &) override { return false; }
    void cancel() {
        if (pending) {
            pending->release();
            pending = nullptr;
        }
    }
    void complete(unsigned status, std::uint32_t value) {
        sc_assert(pending);
        auto &payload = *pending;
        if (status == 1 && payload.is_read() && payload.get_data_ptr())
            for (unsigned i = 0; i < payload.get_data_length() && i < 4; ++i)
                payload.get_data_ptr()[i] = value >> (i * 8);
        payload.set_response_status(status == 1 ? tlm::TLM_OK_RESPONSE
                                                : tlm::TLM_ADDRESS_ERROR_RESPONSE);
        tlm::tlm_phase phase = tlm::BEGIN_RESP;
        auto delay = sc_core::SC_ZERO_TIME;
        const auto result = socket->nb_transport_bw(payload, phase, delay);
        sc_assert(result == tlm::TLM_COMPLETED);
        sc_assert(delay == sc_core::SC_ZERO_TIME);
        pending = nullptr;
        payload.release();
    }
};
HostBus &host_bus() {
    static HostBus bus{"host_bus"};
    return bus;
}
class RegisterPort final : public sc_core::sc_module {
public:
    tlm_utils::simple_initiator_socket<RegisterPort> socket{"registers"};
    explicit RegisterPort(sc_core::sc_module_name name) : sc_module(name) {}
};
RegisterPort &register_port() {
    static RegisterPort port{"cpu_register_port"};
    return port;
}
scr1::RegisterTarget &register_target() {
    static scr1::RegisterTarget target{"register_target", scr1::device()};
    return target;
}
sc_core::sc_signal<bool> &clock_signal() {
    static sc_core::sc_signal<bool> clock{"cpu_clock"};
    return clock;
}
scr1::Device &instance() {
    static bool initialized = false;
    if (!initialized) {
        sc_core::sc_set_time_resolution(1, sc_core::SC_PS);
        scr1::device().bind_clock(clock_signal());
        scr1::device().bind_bus(host_bus().socket);
        register_port().socket.bind(register_target().socket);
        initialized = true;
        sc_core::sc_start(sc_core::SC_ZERO_TIME);
    }
    return scr1::device();
}
unsigned last_error = 0;
std::uint32_t register_access(unsigned offset, unsigned value, unsigned width, bool write) {
    instance();
    unsigned char bytes[4]{};
    for (unsigned i = 0; i < 4; ++i)
        bytes[i] = value >> (i * 8);
    tlm::tlm_generic_payload payload;
    payload.set_command(write ? tlm::TLM_WRITE_COMMAND : tlm::TLM_READ_COMMAND);
    payload.set_address(offset);
    payload.set_data_ptr(bytes);
    payload.set_data_length(width);
    payload.set_streaming_width(width);
    auto delay = sc_core::SC_ZERO_TIME;
    register_port().socket->b_transport(payload, delay);
    last_error = !payload.is_response_ok();
    return bytes[0] | (std::uint32_t(bytes[1]) << 8) | (std::uint32_t(bytes[2]) << 16) |
           (std::uint32_t(bytes[3]) << 24);
}
} // namespace

int sc_main(int, char **) { return 0; }

extern "C" {
std::uint32_t mmio_abi_version() { return 1; }
std::uint32_t mmio_size() {
    try {
        return instance().register_count() * 4;
    } catch (const sc_core::sc_report &report) {
        std::fprintf(stderr, "%s\n", report.what());
        throw;
    }
}
void mmio_reset() {
    instance();
    host_bus().cancel();
    instance().reset();
    last_error = 0;
}
std::uint32_t mmio_inspect(std::uint32_t offset) { return instance().inspect(offset / 4); }
std::uint32_t mmio_read(std::uint32_t offset, std::uint32_t width) {
    return register_access(offset, 0, width, false);
}
void mmio_write(std::uint32_t offset, std::uint32_t value, std::uint32_t width) {
    register_access(offset, value, width, true);
}
std::uint32_t mmio_error() { return last_error; }
std::uint32_t mmio_irq() { return instance().irq(); }
std::uint32_t mmio_bus_request(std::uint32_t field) {
    auto *payload = host_bus().pending;
    if (!payload)
        return 0;
    const auto width = payload->get_data_length();
    const bool valid = (payload->is_read() || payload->is_write()) &&
                       payload->get_address() <= UINT32_MAX &&
                       (width == 1 || width == 2 || width == 4) && payload->get_data_ptr() &&
                       !payload->get_byte_enable_ptr() && payload->get_streaming_width() >= width;
    switch (field) {
    case 0:
        return valid ? 1 : 2;
    case 1:
        return payload->is_write();
    case 2:
        return payload->get_address();
    case 3: {
        std::uint32_t value = 0;
        if (valid)
            for (unsigned i = 0; i < width; ++i)
                value |= std::uint32_t(payload->get_data_ptr()[i]) << (i * 8);
        return value;
    }
    case 4:
        return width == 1 ? 0 : width == 2 ? 1 : 2;
    default:
        return 0;
    }
}
void mmio_bus_complete(std::uint32_t status, std::uint32_t data) {
    host_bus().complete(status, data);
}
void mmio_tick(std::uint32_t clocks) {
    instance();
    for (std::uint32_t i = 0; i < clocks; ++i) {
        clock_signal().write(false);
        sc_core::sc_start(500, sc_core::SC_PS);
        clock_signal().write(true);
        sc_core::sc_start(500, sc_core::SC_PS);
    }
}
}
