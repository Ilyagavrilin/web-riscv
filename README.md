# SCR1 Workbench

A browser debugger for the real SCR1 RISC-V core. Step hardware clocks, inspect execution, and run the same binary across three upstream configurations. Everything runs locally in Web Workers; the site is static and works on GitHub Pages.

## Build

```sh
nix build
nix develop --command python3 -m http.server 8080 --directory result --bind 127.0.0.1
```

Open http://localhost:8080. HTTP is required for ES modules and WebAssembly. All asset paths are relative, including workers and model imports, so project Pages work without a base-path setting. No npm installation, external fonts, server API, shared-memory Wasm, or COOP/COEP headers are required. GNU binutils binaries are hash-pinned through the flake input and reused rather than rebuilt; WebAssembly compilation is cached within the assembler worker.

`flake.lock` pins both nixpkgs and unmodified SCR1. Each model is an independent Nix derivation, using CMake, Ninja, Verilator's `verilate()` integration, and the Emscripten toolchain. The site uses CMake/CTest for assembly, validation, and installation. Nix declares dependencies and options without custom shell phases.

```sh
nix build .#scr1-imc
nix build .#scr1-ic
nix build .#scr1-ec
nix flake check
nix fmt
```

The first build downloads the toolchain. Later changes to the interface reuse the cached models. Verilator compiles the complete core configuration and optimizes signals that cannot affect observable behavior; browsers load the resulting model rather than compiling RTL themselves.

## Profiles

| Profile | ISA     | Registers | Upstream configuration |
| ------- | ------- | --------- | ---------------------- |
| MAX     | RV32IMC | 32        | `SCR1_CFG_RV32IMC_MAX` |
| BASE    | RV32IC  | 32        | `SCR1_CFG_RV32IC_BASE` |
| MIN     | RV32EC  | 16        | `SCR1_CFG_RV32EC_MIN`  |

The selector loads a separate Wasm model. The assembler checks register availability and the M extension. Raw instructions and ELF files execute directly on the selected hardware and can raise an illegal-instruction trap.

These are upstream recommended configurations, so pipeline bypasses, reset options, and debugging facilities differ as well as ISA. Cycle counts describe these configurations with the same memory latency; they do not isolate the cost of an ISA extension or predict physical clock frequency, area, or power. MIN's register file has no hardware reset; this two-state simulation starts a fresh model with zero-initialized storage.

## Workspace

The interface uses larger controls and monospace data views, with separate **Debugger**, **Devices**, **Diagnostics**, **Compare**, **Guide**, and **About** tabs. Project information stays in About; developer documentation, the complete MMIO ABI, build instructions, and downloadable example source are in Guide.

- Debugger accepts ELF files by file picker or drag-and-drop, displays segment metadata and basic disassembly, and supports arbitrary PC breakpoints. Assembly remains available as a separate editor.
- Imported ELF and Wasm files are saved in IndexedDB libraries in the current browser origin. Reload them without selecting files again, or remove the saved copy. File loading still works when browser storage is unavailable. No files leave the browser.
- Devices supports multiple independent MMIO windows and individual detach/replacement, plus live register inspection and an address map.
- Diagnostics captures accepted read/write transactions, widths, values, responses, current PC, register changes at retirement, UART, traps and device lifecycle events. Fetch logging is optional. Event filtering, JSON export and sampled bus VCD are available.
- CPU data watchpoints stop after an accepted transaction covers the selected byte, with read/write filtering. Continue to complete any pending instruction. Faulting accesses may raise a trap instead.
- Machine CSRs include mstatus, mepc, mcause and mtval, observed directly from RTL. Trap events identify faulting PC, cause and trap value.
- Compare executes the same binary and attached device set across all three profiles and reports final-state and retirement differences.

Diagnostic mode retains 10,000 events, with the latest 200 shown in the UI; JSON includes the entire retained event log. Standard mode retains 1,000 lifecycle/stop events. Sequence numbers and a discarded-event count expose truncation. Retirement snapshots retain 1,024 instructions and sampled bus traces retain 4,096 clocks. A large ELF's code view follows the current PC with at most 160 rendered rows; unsupported compressed mnemonics remain visible as raw halfwords.

Comparison runs stop after 30,000 clocks or 4,096 retirements per profile. Final-state matches require both programs to finish; bounded or trapping runs are marked incomplete. Register comparison uses the registers shared by each pair of profiles. Device instances are reset independently for each run.

The Guide tab lists supported assembly instructions. Assembly uses a pinned prebuilt GNU as/ld 2.46.0 toolchain in a separate worker, with standard directives, macros, expressions, relocations, CSR mnemonics and ISA checks. C compilation still uses an external compiler. The editor defaults to `.option norvc`; use `.option rvc` to emit compressed instructions. Ctrl/⌘+Enter assembles, Alt+→ steps, and Escape pauses. Reset reloads the active ELF; editing assembly does not replace it until a successful assembly/load.

## Hot-loaded MMIO peripherals

Select **GPIO + cycle counter**, leave its base at `0x40000000`, and click **Attach example**. Then click **Load counting demo** and **Run**. The module counts simulated CPU clock edges while the program executes a bounded loop. GPIO rotates every 128 active clocks. The program stops the counter, reads it through SCR1's data bus, and stores GPIO at `0x1000` and elapsed clocks at `0x1004`. The peripheral panel shows all four registers and the first word's low eight bits.

| Offset | Register | Behavior                                             |
| ------ | -------- | ---------------------------------------------------- |
| `0x00` | GPIO     | Low eight bits, read/write                           |
| `0x04` | Period   | Rotation interval in active clocks; zero becomes one |
| `0x08` | Counter  | Active clocks, read/write, wraps at 32 bits          |
| `0x0c` | Control  | Bit 0 enables counting and rotation                  |

The GPIO, timer, mailbox and DMA examples are actual SystemC `SC_METHOD` modules, linked against the official Accellera 3.0.2 kernel. Their sources are in `peripherals/*.cpp`. Build it separately with `nix build .#pulse-counter`; the normal site build includes it automatically. The **Load your own module** file picker attaches a custom module. Attaching or replacing a module resets that device while preserving CPU registers, RAM, and the clock count. Detaching restores bus errors for its address range. Program reset also resets the attached device; profile switching creates a fresh CPU and reattaches the same module. Comparison creates an independent copy for each profile.

### SystemC authoring API

Derive from `scr1::ClockedDevice<N>` and register an `SC_METHOD` sensitive to `clk.pos()`. `N` is the number of 32-bit registers. The SDK provides masked register writes and side-effect-free inspection; the adapter owns clock binding, the SystemC kernel and the browser ABI.

```cpp
#include <scr1/device.hpp>
class Counter final : public scr1::ClockedDevice<1> {
public:
    explicit Counter(sc_core::sc_module_name name) : ClockedDevice(name) {
        SC_METHOD(count);
        sensitive << clk.pos();
        dont_initialize();
    }
    void count() { ++registers_[0]; }
};
scr1::Device& scr1::device() noexcept {
    static Counter counter{"counter"};
    return counter;
}
```

`read(index)` may have side effects; `inspect(index) const` must not. `write(index, value, mask)` receives lane-aligned word data and a bitmask; call `store()` for a normal masked write. Examples demonstrate sticky status, write-one-to-clear flags, read-to-pop FIFOs and staged transfers.

```sh
nix develop
emcmake cmake -S . -B build/my-device -G Ninja \
  -DSCR1_PERIPHERAL=ON \
  -DSystemCLanguage_DIR="$SCR1_SYSTEMC/lib/cmake/SystemCLanguage" \
  -DSCR1_MMIO_SOURCE="$PWD/my-device.cpp"
cmake --build build/my-device
```

Load `build/my-device/custom-device.wasm` in Devices. Authors write only SystemC/C++; Wasm is the browser target. One CPU tick advances a 500 ps low phase and a 500 ps high phase through `sc_start`, including delta-cycle settlement. Bus operations happen first, so a write enabling a timer counts on that edge. Reset restores device state; kernel time remains monotonic within that instance. Every attached instance owns an isolated kernel. This method-process build supports `SC_METHOD`; coroutine `SC_THREAD`/`SC_CTHREAD` models are not supported. It does not require shared browser memory.

Additional examples:

| Module    | Default base | Behavior                                                                                       |
| --------- | ------------ | ---------------------------------------------------------------------------------------------- |
| `timer`   | `0x40000100` | One-shot or periodic match after a programmed number of clock edges; sticky W1C flag           |
| `mailbox` | `0x40000200` | Stage TX, transfer on a clock edge into an eight-word RX FIFO, read-to-pop RX, sticky overflow |

The timer and mailbox have selectable demo programs that store results at `0x1000`. The timer demo stores elapsed `64` and match `1`; the mailbox demo stores `17`, `34`, `51`. Full register maps, compile steps, source downloads and the SDK reference are in the site's Guide tab.

The version 1 ABI uses these Wasm exports, with unsigned 32-bit parameters and results:

```c
uint32_t mmio_abi_version(void);                     // Returns 1
uint32_t mmio_size(void);                            // MMIO window in bytes
void mmio_reset(void);
uint32_t mmio_read(uint32_t offset, uint32_t width);
void mmio_write(uint32_t offset, uint32_t value, uint32_t width);
void mmio_tick(uint32_t clocks);                     // Optional
uint32_t mmio_inspect(uint32_t aligned_offset);      // Optional, side-effect free
```

SystemC modules use a narrow host for standard I/O and an empty environment; filesystem, network, wall-clock and thread imports are not provided. The loader calls `_initialize` when exported, validates the ABI and window, and resets the new instance before replacing the previous one. Failed validation leaves the previous device attached. Windows must be word-aligned, 4–65,536 bytes long, and outside RAM and the built-in UART/exit registers. Multiple non-overlapping windows can be attached. Reusing a base replaces that instance; an overlap at a different base is rejected.

`width` is 1, 2, or 4 bytes. Accesses are little-endian and naturally aligned; the bus rejects accesses crossing the window. Read/write functions run once for each accepted data-bus request, before its rising edge. `mmio_tick(1)` runs after each simulated rising edge, including the edge enabling the device. Inspection does not issue bus transactions. Modules execute in a worker. Optional ABI v1 extensions expose interrupt levels, register errors and nonblocking bus requests; existing modules remain compatible. Asynchronous host I/O and Wasm component interfaces are outside this ABI.

## Interrupts and TLM bus adapters

Devices → Clock and interrupts configures memory latency, a 16-bit external mask, software IRQ, and an optional stop after interrupt entry. At attach time choose a device IRQ line from 0–15, or −1 to disconnect it. Manual and device levels are ORed. MAX and BASE use SCR1’s IPIC; MIN routes the OR of all external lines to its single external input. Firmware must configure `mtvec`, `mie`, and `mstatus.MIE`.

For an active-high level IPIC source, write its index to `0xBF6`, then `2` to `0xBF7`. Enable `mie.MEIE` (bit 11) and global interrupts. Claim using a write to `0xBF5`; acknowledge the peripheral and write `0xBF4` before `mret`. MIN omits the IPIC operations. The **Timer interrupt + mret** example performs this sequence for IRQ 0; the assembler defines `SCR1_HAS_IPIC` for the selected profile. Timer control bit 2 enables its IRQ, which remains high until the match status is cleared.

SCR1 trap vectors are 64-byte aligned. BASE fixes the low 16 address bits and MIN fixes the complete vector base at `0x1c0`. The assembler linker script reserves up to 64 bytes for `.vectors` there, before the reset entry at `0x200`; the example installs a jump to its handler. Custom ELFs must provide an appropriate vector themselves.

Override `bool irq() const noexcept` to expose a device level. The engine samples levels before each CPU edge, then delivers accepted DMA responses and advances the device kernel. A new device interrupt becomes visible to the CPU on the following edge. Shared interrupt lines require firmware to inspect all sources.

### DMA example

Attach **TLM DMA engine** at `0x40000300` and load its demo. It copies four words from `0x1000` to `0x1100` without CPU copy loads/stores and records the completed word count at `0x1010`. Diagnostic mode logs every accepted DMA beat, response and waiting time.

| Offset | Register    | Behavior                                                |
| ------ | ----------- | ------------------------------------------------------- |
| `0x00` | Source      | Word-aligned RAM address                                |
| `0x04` | Destination | Word-aligned RAM address                                |
| `0x08` | Length      | 1–16,384 words; both ranges must fit RAM                |
| `0x0C` | Control     | Bit 0 starts; bit 1 enables IRQ                         |
| `0x10` | Status      | Busy bit 0, done bit 1, error bit 2; done/error are W1C |
| `0x14` | Progress    | Completed destination words                             |

Source, destination and length are latched on start and cannot change while busy. Further start commands are ignored while busy; IRQ enable remains writable. Invalid configuration sets error without a transfer. Completion or error asserts IRQ when enabled. Copy proceeds forward, so overlapping ranges have forward-copy semantics. Reset cancels pending work and clears state.

### Writing a bus master

Derive from `scr1::ClockedInitiator<N>` in `scr1/initiator.hpp`. Use `begin_read(address)` or `begin_write(address, value)` in an `SC_METHOD`. At a later edge, check `response_ready()`, read `response_ok()` and `response_data()`, and call `consume_response()` before issuing another request. The DMA source is a complete example of this state machine.

The helper owns an actual TLM-2.0 nonblocking initiator socket with one outstanding 32-bit generic payload. The host target returns TLM_ACCEPTED for BEGIN_REQ, holds a payload reference until arbitration, and sends BEGIN_RESP, implicitly ending the request phase. The initiator returns TLM_COMPLETED to end the response. Reset releases the pending reference before resetting device state. This path uses method processes without coroutine conversion threads.

CPU data transactions have priority at their accepting edges. DMA devices arbitrate round-robin between completed beats, and hold their request until accepted. Continuous CPU traffic can starve DMA. Instruction fetch has an independent read port and reads pre-edge RAM contents if a DMA write shares its edge. DMA supports naturally aligned 1/2/4-byte RAM transfers with the data latency setting; MMIO and out-of-range addresses return bus errors. Detach/replacement cancels the removed instance’s pending request.

`scr1::RegisterTarget` in `scr1/target.hpp` adapts TLM `b_transport` to masked device registers; CPU MMIO traverses this socket. Supported payloads are little-endian, non-streaming 1/2/4-byte transfers with zero annotated delay. DMI, byte-enable arrays, bursts, blocking waits and multiple outstanding requests are outside this subset.

Optional ABI v1 exports:

```c
uint32_t mmio_irq(void);
uint32_t mmio_error(void);
uint32_t mmio_bus_request(uint32_t field);
void mmio_bus_complete(uint32_t status, uint32_t data);
```

Request fields: 0 validity (0 none, 1 supported, 2 malformed), 1 write flag, 2 address, 3 data, 4 log2 byte width. Both bus exports must be present together. Keep the request stable until completion; status 1 is success, 2 error. Read data is valid on success. Malformed payloads complete with error. `mmio_error` exposes failure of the last CPU register access. `mmio_irq` has no side effects. The SystemC adapter supplies every export automatically.

## Platform

| Address                 | Function                            |
| ----------------------- | ----------------------------------- |
| `0x00000000–0x0000ffff` | 64 KiB shared instruction/data RAM  |
| `0x00000200`            | Reset vector and required ELF entry |
| `0xf0000000`            | Write a UART byte                   |
| `0xf0000004`            | Write an exit code to stop          |

Instruction and data/DMA acceptance latency is programmable from 1 to 32 clocks in Devices. The default accepts requests on their first edge; responses are registered on that edge. Wait states postpone acceptance, and MMIO side effects occur exactly once. Device clocks continue during stalls. Unmapped accesses return bus errors. Loading clears RAM and starts a fresh model. ELF PT_LOAD segments use virtual addresses, and BSS is zero-filled. Programs must be bare-metal executables with their own startup and stack. Select the matching `-march` and ABI (`ilp32` for I, `ilp32e` for E), and link all segments into RAM with entry at `0x200`.

External and software interrupts are configurable; JTAG and the core machine-timer input remain inactive. Interrupts enter the firmware handler and support `mret`; Break on interrupt stops after entry. The bench stops at exceptions before executing an exception handler. A PC breakpoint checks the current PC before a clock and does not patch instructions. Continuing skips that breakpoint until PC changes; use stepping for a self-loop at one address. A step request has a 2,000-clock budget. MMIO exit can stop before the exit store retires.

VCD records PC and memory interfaces before rising edges, with one timestamp unit per clock. It is a sampled bus trace, not a complete internal RTL waveform. CPI includes initial clocks leaving reset. UART output retains its last 16 KiB.

## Validate and develop

```sh
nix develop .#browser --command python3 tests/browser.py
```

Run after `nix build`. The browser check exercises a project subpath, model loading, stepping, breakpoints, execution, UART, exports, reset, profile switching, comparison, hot-loaded MMIO, the counting demo, and mobile layout. Screenshots are written to `build/preview-desktop.png` and `build/preview-mobile.png`.

`nix build` runs the Node integration suite through CTest, including execution of all three Wasm models, accepted-bus diagnostics, real trap CSRs, data watchpoints, and multiple MMIO windows. For local interface work, copy the six model artifacts from `result/` into `web/` and serve `web/`; generated model files are ignored by Git. Test models from an existing build with:

```sh
nix develop --command env SCR1_MODEL_DIR="$PWD/result" node --test tests/*.test.mjs
```

The RTL integration lives in `rtl/workbench.sv`, the Wasm ABI in `sim/bridge.cpp`, and the simulation controller in `web/engine.mjs`. `web/profiles.json` supplies configuration to Nix, CMake, and the browser. Updating SCR1 requires checking observed internal signal paths and rerunning the suite.

## GitHub Pages

The Pages workflow runs only through manual `workflow_dispatch`. By default it validates the flake and builds an artifact without deploying. Future publication requires selecting GitHub Actions under Settings → Pages and checking the workflow’s `deploy` input. Pushes do not trigger it. Local builds and commits do not publish anything.

Serve the `result/` directory on any static HTTP host. CPU simulation, assembly, linking and SystemC execution run entirely in the browser; there is no backend. A private repository needs a GitHub plan that supports Pages for private repositories; repository visibility alone does not make the deployed site private.

## License

Workbench code is MIT. SCR1 remains under its upstream Solderpad Hardware Licence 2.0; the built site includes the unmodified `SCR1-LICENSE`. SystemC is Apache-2.0; its license and notice are included under `peripherals/`. GNU binutils is GPLv3+; the site includes its license and corresponding source locations under `toolchain/`. Toolchain runtimes retain their own licenses. Source: [syntacore/scr1](https://github.com/syntacore/scr1).
