#include <scr1/initiator.hpp>

namespace {
class Dma final : public scr1::ClockedInitiator<6> {
    enum Register { Source, Destination, Length, Control, Status, Progress };
    enum Flag { Busy = 1, Done = 2, Error = 4 };
    std::uint32_t source_ = 0, destination_ = 0, count_ = 0;
    bool writing_ = false;

public:
    explicit Dma(sc_core::sc_module_name name) : ClockedInitiator(name) {
        SC_METHOD(on_clock);
        sensitive << clk.pos();
        dont_initialize();
    }
    void reset() noexcept override {
        ClockedInitiator::reset();
        source_ = destination_ = count_ = 0;
        writing_ = started_ = false;
    }
    bool irq() const noexcept override {
        return (registers_[Control] & 2) && (registers_[Status] & (Done | Error));
    }
    void write(std::uint32_t index, std::uint32_t value, std::uint32_t mask) noexcept override {
        if (index <= Length) {
            if (!(registers_[Status] & Busy))
                store(index, value, mask);
        } else if (index == Status)
            registers_[Status] &= ~(value & mask & (Done | Error));
        else if (index == Control) {
            store(Control, value, mask & 2u);
            if (!(value & mask & 1) || (registers_[Status] & Busy))
                return;
            source_ = registers_[Source];
            destination_ = registers_[Destination];
            count_ = registers_[Length];
            registers_[Progress] = 0;
            started_ = false;
            writing_ = false;
            registers_[Status] =
                !count_ || (source_ & 3) || (destination_ & 3) || count_ > 16384 ||
                        std::uint64_t(source_) + std::uint64_t(count_) * 4 > 65536 ||
                        std::uint64_t(destination_) + std::uint64_t(count_) * 4 > 65536
                    ? Error
                    : Busy;
        }
    }
    void on_clock() {
        if (!(registers_[Status] & Busy))
            return;
        if (response_ready()) {
            const auto data = response_data();
            const auto ok = response_ok();
            consume_response();
            if (!ok) {
                registers_[Status] = Error;
                return;
            }
            if (!writing_) {
                writing_ = true;
                begin_write(destination_ + registers_[Progress] * 4, data);
                return;
            }
            writing_ = false;
            if (++registers_[Progress] == count_) {
                registers_[Status] = Done;
                return;
            }
        } else if (started_)
            return;
        started_ = true;
        begin_read(source_ + registers_[Progress] * 4);
    }

private:
    bool started_ = false;
};
} // namespace

scr1::Device &scr1::device() noexcept {
    static Dma dma{"dma"};
    return dma;
}
