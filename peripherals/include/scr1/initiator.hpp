#pragma once
#include <array>
#include <scr1/device.hpp>
#include <tlm_utils/simple_initiator_socket.h>

namespace scr1 {

template <std::size_t Words>
class ClockedInitiator : public ClockedDevice<Words>, private tlm::tlm_mm_interface {
public:
    explicit ClockedInitiator(sc_core::sc_module_name name)
        : ClockedDevice<Words>(name), payload_(this) {
        socket_.register_nb_transport_bw(this, &ClockedInitiator::respond);
    }
    void bind_bus(BusTarget &target) final { socket_.bind(target); }
    void reset() noexcept override {
        RegisterBank<Words>::reset();
        pending_ = ready_ = false;
    }

protected:
    bool response_ready() const noexcept { return ready_; }
    bool response_ok() const noexcept { return payload_.is_response_ok(); }
    std::uint32_t response_data() const noexcept {
        return bytes_[0] | (std::uint32_t(bytes_[1]) << 8) | (std::uint32_t(bytes_[2]) << 16) |
               (std::uint32_t(bytes_[3]) << 24);
    }
    void consume_response() noexcept { ready_ = false; }
    void begin_read(std::uint32_t address) { begin(tlm::TLM_READ_COMMAND, address, 0); }
    void begin_write(std::uint32_t address, std::uint32_t value) {
        begin(tlm::TLM_WRITE_COMMAND, address, value);
    }

private:
    tlm_utils::simple_initiator_socket<ClockedInitiator> socket_{"bus"};
    std::array<unsigned char, 4> bytes_{};
    tlm::tlm_generic_payload payload_;
    bool pending_ = false, ready_ = false;
    void free(tlm::tlm_generic_payload *) override {}
    void begin(tlm::tlm_command command, std::uint32_t address, std::uint32_t value) {
        sc_assert(!pending_ && !ready_);
        for (unsigned i = 0; i < 4; ++i)
            bytes_[i] = value >> (i * 8);
        payload_.set_command(command);
        payload_.set_address(address);
        payload_.set_data_ptr(bytes_.data());
        payload_.set_data_length(4);
        payload_.set_streaming_width(4);
        payload_.set_byte_enable_ptr(nullptr);
        payload_.set_dmi_allowed(false);
        payload_.set_response_status(tlm::TLM_INCOMPLETE_RESPONSE);
        pending_ = true;
        tlm::tlm_phase phase = tlm::BEGIN_REQ;
        auto delay = sc_core::SC_ZERO_TIME;
        const auto result = socket_->nb_transport_fw(payload_, phase, delay);
        sc_assert(result == tlm::TLM_ACCEPTED && delay == sc_core::SC_ZERO_TIME);
    }
    tlm::tlm_sync_enum respond(tlm::tlm_generic_payload &payload, tlm::tlm_phase &phase,
                               sc_core::sc_time &delay) {
        sc_assert(&payload == &payload_ && phase == tlm::BEGIN_RESP &&
                  delay == sc_core::SC_ZERO_TIME);
        pending_ = false;
        ready_ = true;
        return tlm::TLM_COMPLETED;
    }
};

} // namespace scr1
