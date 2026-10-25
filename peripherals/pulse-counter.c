#include <stdint.h>

static uint32_t gpio;
static uint32_t period;
static uint32_t counter;
static uint32_t control;

uint32_t mmio_abi_version(void) { return 1; }
uint32_t mmio_size(void) { return 16; }

void mmio_reset(void) {
    gpio = 1;
    period = 2000;
    counter = 0;
    control = 0;
}

uint32_t mmio_inspect(uint32_t offset) {
    switch (offset) {
    case 0: return gpio;
    case 4: return period;
    case 8: return counter;
    case 12: return control;
    default: return 0;
    }
}

uint32_t mmio_read(uint32_t offset, uint32_t width) {
    const uint32_t mask = width == 4 ? UINT32_MAX : (1u << (width * 8)) - 1;
    return (mmio_inspect(offset & ~3u) >> ((offset & 3u) * 8)) & mask;
}

void mmio_write(uint32_t offset, uint32_t value, uint32_t width) {
    const uint32_t shift = (offset & 3u) * 8;
    const uint32_t mask = (width == 4 ? UINT32_MAX : (1u << (width * 8)) - 1) << shift;
    const uint32_t merged = (mmio_inspect(offset & ~3u) & ~mask) | ((value << shift) & mask);
    switch (offset & ~3u) {
    case 0: gpio = merged & 255; break;
    case 4: period = merged ? merged : 1; break;
    case 8: counter = merged; break;
    case 12: control = merged & 1; break;
    }
}

void mmio_tick(uint32_t clocks) {
    if (!(control & 1)) return;
    for (uint32_t i = 0; i < clocks; ++i) {
        counter++;
        if (counter % period == 0) gpio = ((gpio << 1) | (gpio >> 7)) & 255;
    }
}
