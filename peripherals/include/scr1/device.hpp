#pragma once
#include <cstddef>
#include <cstdint>
#include <systemc>

namespace scr1 {

class Device {
public:
    virtual std::uint32_t register_count() const noexcept { return 0; }
    virtual void reset() noexcept {}
    virtual std::uint32_t inspect(std::uint32_t) const noexcept { return 0; }
    virtual std::uint32_t read(std::uint32_t index) noexcept { return inspect(index); }
    virtual void write(std::uint32_t, std::uint32_t, std::uint32_t) noexcept {}
    virtual void bind_clock(sc_core::sc_signal<bool>&) {}
protected:
    ~Device() = default;
};

template<std::size_t Words>
class RegisterBank : public Device {
    static_assert(Words > 0 && Words <= 16384);
public:
    std::uint32_t register_count() const noexcept final { return Words; }
    void reset() noexcept override {
        for (auto& word : registers_) word = 0;
    }
    std::uint32_t inspect(std::uint32_t index) const noexcept override {
        return index < Words ? registers_[index] : 0;
    }
    void write(std::uint32_t index, std::uint32_t value, std::uint32_t mask) noexcept override {
        store(index, value, mask);
    }
protected:
    std::uint32_t registers_[Words]{};
    void store(std::uint32_t index, std::uint32_t value, std::uint32_t mask) noexcept {
        if (index < Words) registers_[index] = (registers_[index] & ~mask) | (value & mask);
    }
};

template<std::size_t Words>
class ClockedDevice : public sc_core::sc_module, public RegisterBank<Words> {
public:
    sc_core::sc_in<bool> clk{"clk"};
    explicit ClockedDevice(sc_core::sc_module_name name) : sc_core::sc_module(name) {}
    void bind_clock(sc_core::sc_signal<bool>& clock) final { clk(clock); }
};

Device& device() noexcept;

}
