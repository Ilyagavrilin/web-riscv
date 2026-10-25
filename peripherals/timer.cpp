#include <scr1/device.hpp>

namespace {
class Timer final : public scr1::ClockedDevice<4> {
    enum Register { Control, Period, Elapsed, Status };
public:
    explicit Timer(sc_core::sc_module_name name) : ClockedDevice(name) {
        SC_METHOD(on_clock);
        sensitive << clk.pos();
        dont_initialize();
    }
    void reset() noexcept override {
        RegisterBank::reset();
        registers_[Period] = 1000;
    }
    void write(std::uint32_t index, std::uint32_t value, std::uint32_t mask) noexcept override {
        switch (index) {
        case Control: store(index, value, mask & 7u); break;
        case Period: store(index, value, mask); if (!registers_[Period]) registers_[Period] = 1; break;
        case Elapsed: store(index, value, mask); break;
        case Status: registers_[Status] &= ~(value & mask & 1u); break;
        }
    }
    bool irq() const noexcept override { return (registers_[Status] & 1) && (registers_[Control] & 4); }
    void on_clock() {
        if (!(registers_[Control] & 1)) return;
        if (++registers_[Elapsed] >= registers_[Period]) {
            registers_[Status] |= 1;
            if (registers_[Control] & 2) registers_[Elapsed] = 0;
            else registers_[Control] &= ~1u;
        }
    }
};
}

scr1::Device& scr1::device() noexcept {
    static Timer timer{"timer"};
    return timer;
}
