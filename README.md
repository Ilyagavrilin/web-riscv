# SCR1 Workbench

A browser debugger for the real SCR1 RISC-V core. Step hardware clocks, inspect execution, and run the same binary across three upstream configurations. Everything runs locally in Web Workers; the site is static and works on GitHub Pages.

## Build

```sh
nix build
nix develop --command python3 -m http.server 8080 --directory result --bind 127.0.0.1
```

Open http://localhost:8080. HTTP is required for ES modules and WebAssembly. All asset paths are relative, including workers and model imports, so project Pages work without a base-path setting. No npm installation, external fonts, server API, shared-memory Wasm, or COOP/COEP headers are required.

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
- Data watchpoints stop after an accepted transaction covers the selected byte, with read/write filtering. Continue to complete any pending instruction. Faulting accesses may raise a trap instead.
- Machine CSRs include mstatus, mepc, mcause and mtval, observed directly from RTL. Trap events identify faulting PC, cause and trap value.
- Compare executes the same binary and attached device set across all three profiles and reports final-state and retirement differences.

Diagnostic mode retains 10,000 events, with the latest 200 shown in the UI; JSON includes the entire retained event log. Standard mode retains 1,000 lifecycle/stop events. Sequence numbers and a discarded-event count expose truncation. Retirement snapshots retain 1,024 instructions and sampled bus traces retain 4,096 clocks. A large ELF's code view follows the current PC with at most 160 rendered rows; unsupported compressed mnemonics remain visible as raw halfwords.

Comparison runs stop after 30,000 clocks or 4,096 retirements per profile. Final-state matches require both programs to finish; bounded or trapping runs are marked incomplete. Register comparison uses the registers shared by each pair of profiles. Device instances are reset independently for each run.

The Guide tab lists supported assembly instructions. Full assembler directives, C compilation, CSR mnemonics, and compressed mnemonics require an external toolchain and ELF loading. The core executes those encodings itself. Ctrl/⌘+Enter assembles, Alt+→ steps, and Escape pauses. Reset reloads the active ELF; editing assembly does not replace it until a successful assembly/load.

## Hot-loaded MMIO peripherals

Select **GPIO + cycle counter**, leave its base at `0x40000000`, and click **Attach example**. Then click **Load counting demo** and **Run**. The module counts simulated CPU clock edges while the program executes a bounded loop. GPIO rotates every 128 active clocks. The program stops the counter, reads it through SCR1's data bus, and stores GPIO at `0x1000` and elapsed clocks at `0x1004`. The peripheral panel shows all four registers and the first word's low eight bits.

| Offset | Register | Behavior                                             |
| ------ | -------- | ---------------------------------------------------- |
| `0x00` | GPIO     | Low eight bits, read/write                           |
| `0x04` | Period   | Rotation interval in active clocks; zero becomes one |
| `0x08` | Counter  | Active clocks, read/write, wraps at 32 bits          |
| `0x0c` | Control  | Bit 0 enables counting and rotation                  |

The example is written in C in `peripherals/pulse-counter.c`. It has no imports, allocator, browser access, or runtime dependencies. Build it separately with `nix build .#pulse-counter`; the normal site build includes it automatically. The **Load your own module** file picker attaches a custom module. Attaching or replacing a module resets that device while preserving CPU registers, RAM, and the clock count. Detaching restores bus errors for its address range. Program reset also resets the attached device; profile switching creates a fresh CPU and reattaches the same module. Comparison creates an independent copy for each profile.

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

Modules must be standalone Wasm with no imports. The loader calls `_initialize` when exported, validates the ABI and window, and resets the new instance before replacing the previous one. Failed validation leaves the previous device attached. Windows must be word-aligned, 4–65,536 bytes long, and outside RAM and the built-in UART/exit registers. Multiple non-overlapping windows can be attached. Reusing a base replaces that instance; an overlap at a different base is rejected.

`width` is 1, 2, or 4 bytes. Accesses are little-endian and naturally aligned; the bus rejects accesses crossing the window. Read/write functions run once for each accepted data-bus request, before its rising edge. `mmio_tick(1)` runs after each simulated rising edge, including the edge enabling the device. Inspection does not issue bus transactions. Modules execute in a worker; external interrupt signaling, asynchronous host I/O, and Wasm component/WASI interfaces are outside this ABI.

## Platform

| Address                 | Function                            |
| ----------------------- | ----------------------------------- |
| `0x00000000–0x0000ffff` | 64 KiB shared instruction/data RAM  |
| `0x00000200`            | Reset vector and required ELF entry |
| `0xf0000000`            | Write a UART byte                   |
| `0xf0000004`            | Write an exit code to stop          |

Memory replies after one clock; unmapped accesses return bus errors. Loading clears RAM and starts a fresh model. ELF PT_LOAD segments use virtual addresses, and BSS is zero-filled. Programs must be bare-metal executables with their own startup and stack. Select the matching `-march` and ABI (`ilp32` for I, `ilp32e` for E), and link all segments into RAM with entry at `0x200`.

External interrupts, JTAG, and the timer are held inactive. The bench stops at exceptions before executing a trap handler. A PC breakpoint checks the current PC before a clock and does not patch instructions. Continuing skips that breakpoint until PC changes; use stepping for a self-loop at one address. A step request has a 2,000-clock budget. MMIO exit can stop before the exit store retires.

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

The Pages workflow runs only through manual `workflow_dispatch`. Select GitHub Actions under Settings → Pages before running it. Local builds and commits do not publish anything.

## License

Workbench code is MIT. SCR1 remains under its upstream Solderpad Hardware Licence 2.0; the built site includes the unmodified `SCR1-LICENSE`. Toolchain runtimes retain their own licenses. Source: [syntacore/scr1](https://github.com/syntacore/scr1).
