#pragma once
#include <scr1/device.hpp>
#include <tlm_utils/simple_target_socket.h>

namespace scr1 {

class RegisterTarget final : public sc_core::sc_module {
public:
    tlm_utils::simple_target_socket<RegisterTarget> socket{"registers"};
    RegisterTarget(sc_core::sc_module_name name, Device &device)
        : sc_module(name), device_(device) {
        socket.register_b_transport(this, &RegisterTarget::b_transport);
    }
    void b_transport(tlm::tlm_generic_payload &payload, sc_core::sc_time &delay) {
        auto &device = device_;
        const auto address = payload.get_address();
        const auto width = payload.get_data_length();
        if (delay != sc_core::SC_ZERO_TIME || !payload.get_data_ptr()) {
            payload.set_response_status(tlm::TLM_GENERIC_ERROR_RESPONSE);
            return;
        }
        if (payload.get_byte_enable_ptr() || payload.get_streaming_width() < width) {
            payload.set_response_status(tlm::TLM_BYTE_ENABLE_ERROR_RESPONSE);
            return;
        }
        if ((width != 1 && width != 2 && width != 4) || address % width ||
            address > device.register_count() * 4 ||
            width > device.register_count() * 4 - address) {
            payload.set_response_status(tlm::TLM_ADDRESS_ERROR_RESPONSE);
            return;
        }
        const auto shift = (address & 3u) * 8;
        const auto mask = width == 4 ? UINT32_MAX : (1u << (width * 8)) - 1;
        if (payload.is_read()) {
            const auto value = device.read(address / 4) >> shift;
            for (unsigned i = 0; i < width; ++i)
                payload.get_data_ptr()[i] = value >> (i * 8);
        } else if (payload.is_write()) {
            std::uint32_t value = 0;
            for (unsigned i = 0; i < width; ++i)
                value |= std::uint32_t(payload.get_data_ptr()[i]) << (i * 8);
            device.write(address / 4, value << shift, mask << shift);
        } else {
            payload.set_response_status(tlm::TLM_COMMAND_ERROR_RESPONSE);
            return;
        }
        payload.set_response_status(tlm::TLM_OK_RESPONSE);
    }

private:
    Device &device_;
};

} // namespace scr1
