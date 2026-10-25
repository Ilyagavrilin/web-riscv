#include <scr1/device.hpp>

namespace {
sc_core::sc_signal<bool>& clock_signal() {
    static sc_core::sc_signal<bool> clock{"cpu_clock"};
    return clock;
}
scr1::Device& instance() {
    static bool initialized = false;
    if (!initialized) {
        sc_core::sc_set_time_resolution(1, sc_core::SC_PS);
        scr1::device().bind_clock(clock_signal());
        initialized = true;
        sc_core::sc_start(sc_core::SC_ZERO_TIME);
    }
    return scr1::device();
}
}

int sc_main(int, char**) { return 0; }

extern "C" {
std::uint32_t mmio_abi_version() { return 1; }
std::uint32_t mmio_size() { return instance().register_count() * 4; }
void mmio_reset() { instance().reset(); }
std::uint32_t mmio_inspect(std::uint32_t offset) {
    return instance().inspect(offset / 4);
}
std::uint32_t mmio_read(std::uint32_t offset, std::uint32_t width) {
    const auto mask = width == 4 ? UINT32_MAX : (1u << (width * 8)) - 1;
    return (instance().read(offset / 4) >> ((offset & 3u) * 8)) & mask;
}
void mmio_write(std::uint32_t offset, std::uint32_t value, std::uint32_t width) {
    const auto shift = (offset & 3u) * 8;
    const auto mask = (width == 4 ? UINT32_MAX : (1u << (width * 8)) - 1) << shift;
    instance().write(offset / 4, value << shift, mask);
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
