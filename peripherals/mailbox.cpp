#include <scr1/device.hpp>

namespace {
class Mailbox final : public scr1::ClockedDevice<4> {
    enum Register { Transmit, Receive, Status, Control };
    static constexpr std::uint32_t Capacity = 8;
    std::uint32_t queue_[Capacity]{};
    std::uint32_t head_ = 0, count_ = 0, pending_ = 0;
    bool pending_valid_ = false, overflow_ = false;
public:
    explicit Mailbox(sc_core::sc_module_name name) : ClockedDevice(name) {
        SC_METHOD(on_clock);
        sensitive << clk.pos();
        dont_initialize();
    }
    void reset() noexcept override {
        RegisterBank::reset();
        registers_[Control] = 1;
        head_ = count_ = pending_ = 0;
        pending_valid_ = overflow_ = false;
        for (auto& word : queue_) word = 0;
    }
    std::uint32_t inspect(std::uint32_t index) const noexcept override {
        switch (index) {
        case Transmit: return pending_valid_ ? pending_ : 0;
        case Receive: return count_ ? queue_[head_] : 0;
        case Status: return count_ | (count_ == Capacity ? 1u << 8 : 0) |
            (!count_ ? 1u << 9 : 0) | (overflow_ ? 1u << 10 : 0) |
            (pending_valid_ ? 1u << 11 : 0);
        default: return RegisterBank::inspect(index);
        }
    }
    std::uint32_t read(std::uint32_t index) noexcept override {
        const auto result = inspect(index);
        if (index == Receive && count_) { head_ = (head_ + 1) % Capacity; --count_; }
        return result;
    }
    void write(std::uint32_t index, std::uint32_t value, std::uint32_t mask) noexcept override {
        switch (index) {
        case Transmit:
            if (pending_valid_) overflow_ = true;
            else { pending_ = value & mask; pending_valid_ = true; }
            break;
        case Status: if (value & mask & (1u << 10)) overflow_ = false; break;
        case Control:
            store(index, value, mask & 1u);
            if (value & mask & 2u) { head_ = count_ = 0; pending_valid_ = overflow_ = false; }
            break;
        }
    }
    void on_clock() {
        if (!pending_valid_ || !(registers_[Control] & 1)) return;
        if (count_ == Capacity) overflow_ = true;
        else { queue_[(head_ + count_) % Capacity] = pending_; ++count_; }
        pending_valid_ = false;
    }
};
}

scr1::Device& scr1::device() noexcept {
    static Mailbox mailbox{"mailbox"};
    return mailbox;
}
