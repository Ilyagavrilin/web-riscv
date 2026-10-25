#include <scr1/device.hpp>

namespace {
class PulseCounter final : public scr1::ClockedDevice<4> {
    enum Register { Gpio, Period, Elapsed, Control };
public:
    explicit PulseCounter(sc_core::sc_module_name name) : ClockedDevice(name) {
        SC_METHOD(on_clock);
        sensitive << clk.pos();
        dont_initialize();
    }
    void reset() noexcept override {
        RegisterBank::reset();
        registers_[Gpio] = 1;
        registers_[Period] = 2000;
    }
    void write(std::uint32_t index, std::uint32_t value, std::uint32_t mask) noexcept override {
        switch (index) {
        case Gpio: store(index, value, mask & 255u); break;
        case Period: store(index, value, mask); if (!registers_[Period]) registers_[Period] = 1; break;
        case Elapsed: store(index, value, mask); break;
        case Control: store(index, value, mask & 1u); break;
        }
    }
    void on_clock() {
        if (!(registers_[Control] & 1)) return;
        auto& gpio = registers_[Gpio];
        if (++registers_[Elapsed] % registers_[Period] == 0) gpio = ((gpio << 1) | (gpio >> 7)) & 255u;
    }
};
}

scr1::Device& scr1::device() noexcept {
    static PulseCounter counter{"gpio_counter"};
    return counter;
}
