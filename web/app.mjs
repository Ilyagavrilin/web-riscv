import deviceTypes from "./devices.json" with { type: "json" };
import { assets } from "./library.mjs";
import profiles from "./profiles.json" with { type: "json" };
import { loadElf, aliases } from "./assembler.mjs";
import { examples } from "./examples.mjs";
const $ = (id) => document.getElementById(id),
  hex = (n) => (n >>> 0).toString(16).padStart(8, "0");
let worker, comparisonWorker;
let ready = false,
  running = false,
  busy = false,
  loaded = false,
  dirty = false,
  listing = [],
  breakpoints = new Set(),
  state,
  previous = [],
  decimal = false,
  generation = 0,
  currentElf,
  activeProgram,
  peripheralImages = [],
  pendingPeripheral;
$("peripheral-example").replaceChildren();
for (const [id, device] of Object.entries(deviceTypes)) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = device.name;
  option.title = device.description;
  $("peripheral-example").append(option);
}
function describeDevice() {
  const device = deviceTypes[$("peripheral-example").value];
  $("peripheral-base").value = device.base;
}
$("peripheral-example").onchange = describeDevice;
describeDevice();
for (const [id, profile] of Object.entries(profiles)) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = `${profile.isa} / ${profile.name}`;
  $("profile").append(option);
}
for (const [key, example] of Object.entries(examples)) {
  const option = document.createElement("option");
  option.value = key;
  option.textContent = example.name;
  $("example").append(option);
}
try {
  $("editor").value =
    localStorage.getItem("scr1-source") || examples.fibonacci.source;
} catch {
  $("editor").value = examples.fibonacci.source;
}
function message(text, error = false) {
  $("message").textContent = text;
  $("message").hidden = !text;
  $("message").classList.toggle("error", error);
}
function buttons() {
  for (const id of ["cycle", "step", "run", "reset", "json", "vcd"])
    $(id).disabled =
      !ready ||
      !loaded ||
      busy ||
      dirty ||
      (id !== "reset" &&
        ["halted", "trap"].includes(state?.status) &&
        !["json", "vcd"].includes(id));
  $("run").disabled =
    !ready || !loaded || dirty || ["halted", "trap"].includes(state?.status);
  $("assemble").disabled = !ready || busy;
  $("example").disabled = busy;
  $("elf").disabled = !ready || busy;
  $("reset").disabled = !ready || !loaded || busy;
  $("run").textContent = running ? "Pause" : "Run";
  for (const id of ["peripheral-attach", "peripheral-file", "peripheral-demo"])
    $(id).disabled = !ready || busy;
  $("peripheral-detach").disabled = !ready || !peripheralImages.length || busy;
  $("compare").disabled = !ready || !loaded || dirty || busy;
  for (const id of [
    "platform-apply",
    "diagnostic-mode",
    "diagnostic-fetch",
    "clear-log",
    "load-saved-elf",
    "load-saved-device",
  ])
    $(id).disabled = !ready || busy;
}
function pause() {
  running = false;
  generation++;
  buttons();
}
function load(program) {
  pause();
  invalidateComparison();
  activeProgram = program;
  renderProgram(program);
  listing = program.listing;
  breakpoints.clear();
  previous = [];
  busy = true;
  loaded = true;
  dirty = false;
  state = undefined;
  message("");
  worker.postMessage({ type: "load", program });
  buttons();
  renderListing();
}
let compilationToken = 0;
const assemblerWorker = new Worker(
  new URL("./assembler-worker.mjs", import.meta.url),
  { type: "module" },
);
function compile() {
  pause();
  busy = true;
  buttons();
  $("status").textContent = "Assembling…";
  message("GNU assembler and linker are building the program…");
  assemblerWorker.postMessage({
    token: ++compilationToken,
    source: $("editor").value,
    profile: profiles[$("profile").value],
  });
}
assemblerWorker.onmessage = ({ data }) => {
  if (data.token !== compilationToken) return;
  busy = false;
  if (data.error) {
    dirty = !currentElf;
    $("status").textContent = "Assembly error";
    message(data.error, true);
    buttons();
    return;
  }
  currentElf = undefined;
  const program = data.program;
  program.name = `GNU assembly · ${examples[$("example").value]?.name ?? "custom"}`;
  load(program);
  try {
    localStorage.setItem("scr1-source", $("editor").value);
  } catch {}
  message("");
};
assemblerWorker.onerror = () => {
  busy = false;
  message(
    "Assembler worker failed to load. Serve the complete Nix build.",
    true,
  );
  buttons();
};
function renderListing() {
  $("breakpoints").replaceChildren();
  for (const address of [...breakpoints].sort((a, b) => a - b)) {
    const button = document.createElement("button");
    button.textContent = `0x${hex(address)} ×`;
    button.onclick = () => {
      breakpoints.delete(address);
      renderListing();
    };
    $("breakpoints").append(button);
  }
  $("listing").replaceChildren();
  if (!listing.length) {
    $("listing").textContent =
      "ELF loaded. Use the PC, memory and trace to inspect execution.";
    return;
  }
  const index = listing.findIndex((l) => l.address === state?.pc);
  const start = Math.max(0, index - 40);
  $("listing-range").textContent =
    `Instructions ${start + 1}–${Math.min(start + 160, listing.length)} of ${listing.length}`;
  for (const line of listing.slice(start, start + 160)) {
    const row = document.createElement("button");
    row.className = "code-row";
    row.dataset.address = line.address;
    row.classList.toggle("active", line.address === state?.pc);
    row.classList.toggle("break", breakpoints.has(line.address));
    row.setAttribute("aria-pressed", String(breakpoints.has(line.address)));
    row.title = `${line.line ? `Line ${line.line}` : "ELF instruction"} · toggle PC breakpoint`;
    for (const text of [
      breakpoints.has(line.address) ? "●" : "·",
      hex(line.address),
      hex(line.word),
      line.text,
    ]) {
      const span = document.createElement("span");
      span.textContent = text;
      row.append(span);
    }
    row.onclick = () => {
      pause();
      breakpoints.has(line.address)
        ? breakpoints.delete(line.address)
        : breakpoints.add(line.address);
      renderListing();
    };
    $("listing").append(row);
  }
}
function render(s) {
  state = s;
  $("cycles").textContent = s.cycles.toLocaleString();
  $("retired").textContent = s.retired.toLocaleString();
  $("cpi").textContent = s.retired ? (s.cycles / s.retired).toFixed(2) : "—";
  $("pc").textContent = "0x" + hex(s.pc);
  const label = running
    ? "Running"
    : {
        paused: "Ready",
        breakpoint: "Breakpoint",
        watchpoint: "Data watchpoint",
        interrupt: "Interrupt entry",
        halted: `Finished · exit ${s.exitCode}`,
        trap: `Trap · cause ${s.cause}`,
      }[s.status] || s.status;
  $("status").textContent = label;
  $("status-dot").style.background =
    s.status === "trap" ? "#b35645" : running ? "#71a851" : "#50816a";
  $("registers").replaceChildren();
  const order = Array.from({ length: 16 }, (_, i) => [i, i + 16]).flat();
  for (const i of order) {
    const row = document.createElement("div");
    row.className = "register";
    row.classList.toggle(
      "changed",
      i < s.registerCount &&
        previous.length > 0 &&
        previous[i] !== s.registers[i],
    );
    const label = document.createElement("span");
    label.textContent = `x${i.toString().padEnd(2)}`;
    const alias = document.createElement("b");
    alias.textContent = aliases[i];
    label.append(alias);
    const value = document.createElement("output");
    value.textContent =
      i >= s.registerCount
        ? "—"
        : decimal
          ? String(s.registers[i] | 0)
          : hex(s.registers[i]);
    row.classList.toggle("unavailable", i >= s.registerCount);
    row.append(label, value);
    $("registers").append(row);
  }
  previous = s.registers.slice();
  $("memory").replaceChildren();
  for (let i = 0; i < s.memory.length; i += 16) {
    const row = document.createElement("div"),
      addr = document.createElement("span");
    addr.className = "addr";
    addr.textContent = hex(s.memoryAddress + i) + "  ";
    row.append(
      addr,
      document.createTextNode(
        s.memory
          .slice(i, i + 16)
          .map((n) => n.toString(16).padStart(2, "0"))
          .join(" "),
      ),
    );
    const ascii = document.createElement("span");
    ascii.className = "ascii";
    ascii.textContent = s.memory
      .slice(i, i + 16)
      .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
      .join("");
    row.append(ascii);
    $("memory").append(row);
  }
  $("console").textContent = s.console || "Waiting for UART output…";
  $("trace").replaceChildren();
  if (!s.history.length)
    $("trace").textContent = "No instructions retired yet. Try Step →.";
  for (const item of [...s.history].reverse()) {
    const row = document.createElement("div");
    row.className = "trace-row";
    const b = document.createElement("b");
    b.textContent = "0x" + hex(item.pc);
    const line = listing.find((l) => l.address === item.pc);
    row.append(
      document.createTextNode(String(item.cycle).padStart(7) + " clk"),
      b,
      document.createTextNode(line?.text || "retired"),
    );
    $("trace").append(row);
  }
  $("wave").replaceChildren();
  for (const [name, key] of [
    ["imem.req", "fetch"],
    ["dmem.req", "request"],
    ["dmem.write", "write"],
  ]) {
    const row = document.createElement("div");
    row.className = "signal-row";
    row.append(document.createTextNode(name));
    const track = document.createElement("div");
    track.className = "signal-track";
    for (const sample of s.wave) {
      const bit = document.createElement("span");
      bit.className =
        "sample" +
        ((key === "write" ? sample.request && sample.write : sample[key])
          ? " high"
          : "");
      bit.title = `Clock ${sample.cycle} · ${name}=${sample[key]}`;
      track.append(bit);
    }
    row.append(track);
    $("wave").append(row);
  }
  $("platform-state").textContent =
    `Fetch ${s.platform.instructionLatency} / data ${s.platform.dataLatency} clocks · IRQ 0x${s.interrupts.mask.toString(16).padStart(4, "0")} · ${s.interrupts.count} entries · ${s.dmaTransfers} DMA transfers`;
  renderPeripheral(s.peripherals ?? (s.peripheral ? [s.peripheral] : []));
  renderDiagnostics();
  $("csrs").replaceChildren();
  for (const [name, value] of Object.entries(s.csr)) {
    const cell = document.createElement("span");
    cell.textContent = `${name}  ${hex(value)}`;
    $("csrs").append(cell);
  }
  renderListing();
  buttons();
}
function advance(mode) {
  if (busy || !loaded || dirty) return;
  busy = true;
  worker.postMessage({ type: "advance", mode, breakpoints: [...breakpoints] });
  buttons();
}
function handleWorkerMessage({ data }) {
  if (data.type === "ready") {
    ready = true;
    busy = false;
    if (currentElf) load(currentElf);
    else compile();
    buttons();
    return;
  }
  if (data.type === "error") {
    pendingPeripheral = undefined;
    busy = false;
    pause();
    message(data.message, true);
    $("status").textContent = "Engine error";
    return;
  }
  if (data.type === "state") {
    if (pendingPeripheral && data.request === "attach") {
      const image = {
        buffer: pendingPeripheral.buffer,
        base: pendingPeripheral.base,
        name: pendingPeripheral.name,
        irqLine: pendingPeripheral.irqLine,
      };
      peripheralImages = peripheralImages.filter((d) => d.base !== image.base);
      peripheralImages.push(image);
      if (pendingPeripheral.save)
        saveAsset({
          id: `wasm:${image.name}`,
          type: "wasm",
          name: image.name,
          buffer: image.buffer,
        });
      pendingPeripheral = undefined;
    }
    const activeBases = new Set(
      (data.state.peripherals ?? []).map((d) => d.base),
    );
    peripheralImages = peripheralImages.filter((d) => activeBases.has(d.base));
    busy = Boolean(pendingPeripheral);
    if (
      ["halted", "trap", "breakpoint", "watchpoint", "interrupt"].includes(
        data.state.status,
      )
    )
      pause();
    render(data.state);
    if (running) {
      const token = generation;
      setTimeout(() => {
        if (running && token === generation) advance("run");
      }, 16);
    }
  }
  if (data.type === "export") {
    const url = URL.createObjectURL(
      new Blob([data.value], {
        type: data.format === "json" ? "application/json" : "text/plain",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `scr1-trace.${data.format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
function handleWorkerError() {
  busy = false;
  pause();
  message(
    "Could not load the RTL engine. Serve the complete Nix build over HTTP; check the browser console for details.",
    true,
  );
  $("status").textContent = "Load failed";
}
$("cycle").onclick = () => {
  pause();
  advance("cycle");
};
$("step").onclick = () => {
  pause();
  advance("instruction");
};
$("run").onclick = () => {
  if (running) {
    pause();
    return;
  }
  running = true;
  generation++;
  advance("run");
  buttons();
};
$("example").onchange = () => {
  pause();
  $("editor").value = examples[$("example").value].source;
  compile();
};
$("editor").oninput = () => {
  pause();
  invalidateComparison();
  dirty = !currentElf;
  message(
    currentElf
      ? "Assembly edited. Assemble to replace the active ELF."
      : "Source changed. Assemble & load to apply it.",
  );
  buttons();
};
$("editor").onkeydown = (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    $("editor").setRangeText(
      "  ",
      $("editor").selectionStart,
      $("editor").selectionEnd,
      "end",
    );
    $("editor").dispatchEvent(new Event("input"));
  }
};
async function openElf(file) {
  try {
    if (file.size > 4 * 1024 * 1024) throw Error("ELF exceeds 4 MiB");
    const buffer = await file.arrayBuffer();
    const program = loadElf(buffer);
    compilationToken++;
    program.name = file.name;
    currentElf = program;
    load(program);
    $("assembly-editor").open = false;
    message("");
    await saveAsset({
      id: `elf:${file.name}`,
      type: "elf",
      name: file.name,
      buffer,
    });
  } catch (error) {
    message(error.message, true);
  }
}
$("elf").onchange = async (event) => {
  const file = event.target.files[0];
  if (file) await openElf(file);
  event.target.value = "";
};
for (const kind of ["dragenter", "dragover"])
  $("elf-drop").addEventListener(kind, (event) => {
    event.preventDefault();
    $("elf-drop").classList.add("dragging");
  });
$("elf-drop").addEventListener("dragleave", () =>
  $("elf-drop").classList.remove("dragging"),
);
$("elf-drop").addEventListener("drop", (event) => {
  event.preventDefault();
  $("elf-drop").classList.remove("dragging");
  if (ready && !busy && event.dataTransfer.files[0])
    openElf(event.dataTransfer.files[0]);
});
$("reset").onclick = () => {
  if (currentElf) load(currentElf);
  else if (activeProgram) load(activeProgram);
};
$("assemble").onclick = compile;
$("radix").onclick = () => {
  decimal = !decimal;
  if (state) render(state);
};
$("memory-address").onchange = () => {
  if (!ready || !loaded || busy) return;
  const n = Number($("memory-address").value);
  if (!Number.isInteger(n) || n < 0 || n > 65536 - 128) {
    message("Memory address must be 0…0xff80.", true);
    return;
  }
  pause();
  worker.postMessage({ type: "inspect", memoryAddress: n });
};
for (const format of ["json", "vcd"])
  $(format).onclick = () => worker.postMessage({ type: "export", format });
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    if (ready && !busy) {
      currentElf = undefined;
      compile();
    }
  }
  if (e.altKey && e.key === "ArrowRight") {
    e.preventDefault();
    pause();
    advance("instruction");
  }
  if (e.key === "Escape") pause();
});
function invalidateComparison() {
  comparisonWorker?.terminate();
  comparisonWorker = undefined;
  $("compare").textContent = "Compare profiles →";
  $("comparison").textContent =
    "Run the same binary across all three SCR1 profiles. Limits: 30,000 clocks or 4,096 retired instructions per profile.";
}
$("compare").onclick = () => {
  if (comparisonWorker) {
    invalidateComparison();
    return;
  }
  pause();
  let program;
  try {
    program = activeProgram;
  } catch (error) {
    message(error.message, true);
    return;
  }
  $("compare").textContent = "Cancel comparison";
  comparisonWorker = new Worker(
    new URL("./comparison-worker.mjs", import.meta.url),
    { type: "module" },
  );
  comparisonWorker.onmessage = ({ data }) => {
    if (data.type === "progress")
      $("comparison").textContent = `Running ${profiles[data.profile].isa}…`;
    if (data.type === "error") {
      invalidateComparison();
      message(data.message, true);
    }
    if (data.type === "results") {
      comparisonWorker.terminate();
      comparisonWorker = undefined;
      $("compare").textContent = "Compare profiles →";
      const table = document.createElement("table");
      const head = document.createElement("tr");
      for (const title of [
        "Core",
        "Result",
        "Clocks",
        "Retired",
        "CPI",
        "Final state vs MAX",
        "First retirement difference",
      ]) {
        const th = document.createElement("th");
        th.textContent = title;
        head.append(th);
      }
      const thead = document.createElement("thead");
      thead.append(head);
      table.append(thead);
      const body = document.createElement("tbody");
      for (const result of data.results) {
        const row = document.createElement("tr");
        const status =
          result.status === "trap"
            ? `Trap ${result.cause}`
            : result.status === "halted"
              ? `Exit ${result.exitCode}`
              : "Limit reached";
        const cells = [
          `${result.isa} / ${profiles[result.profile].name}`,
          status,
          result.cycles,
          result.retired,
          result.retired ? (result.cycles / result.retired).toFixed(2) : "—",
          result.stateMatches === null
            ? "Incomplete"
            : result.stateMatches
              ? `Match (${result.comparedRegisters} regs)`
              : "Different",
          result.firstDivergence === null
            ? "None"
            : `Instruction ${result.firstDivergence}`,
        ];
        for (const value of cells) {
          const td = document.createElement("td");
          td.textContent = value;
          row.append(td);
        }
        body.append(row);
      }
      table.append(body);
      $("comparison").replaceChildren(table);
    }
  };
  comparisonWorker.onerror = () => {
    invalidateComparison();
    message("Comparison worker failed to load.", true);
  };
  comparisonWorker.postMessage({
    program,
    peripheral: peripheralImages,
    platform: state.platform,
  });
};
function renderPeripheral(devices) {
  $("peripheral-state").replaceChildren();
  $("peripheral-status").textContent = devices.length
    ? `${devices.length} device(s) attached · ${devices.reduce((n, d) => n + d.size, 0)} bytes mapped`
    : "No module attached.";
  for (const device of devices) {
    const card = document.createElement("article");
    card.className = "device-card";
    const heading = document.createElement("div");
    heading.className = "device-heading";
    const title = document.createElement("strong");
    title.textContent = device.name;
    const address = document.createElement("span");
    address.textContent = `0x${hex(device.base)} · ${device.size} bytes · IRQ ${device.irqLine < 0 ? "disconnected" : device.irqLine}${device.irq ? " HIGH" : ""}${device.busPending ? " · bus pending" : ""}`;
    const detach = document.createElement("button");
    detach.textContent = "Detach";
    detach.disabled = busy;
    detach.onclick = () => detachPeripheral(device.base);
    heading.append(title, address, detach);
    card.append(heading);
    if (device.words.length) {
      const bits = document.createElement("div");
      bits.className = "gpio-bits";
      for (let bit = 7; bit >= 0; bit--) {
        const led = document.createElement("span");
        led.className =
          "gpio-bit" + ((device.words[0] >> bit) & 1 ? " on" : "");
        led.textContent = bit;
        bits.append(led);
      }
      const label = document.createElement("small");
      label.textContent = "WORD 0 · LOW 8 BITS";
      bits.append(label);
      card.append(bits);
      for (const [index, word] of device.words.entries()) {
        const item = document.createElement("span");
        item.className = "peripheral-word";
        item.textContent = `+0x${(index * 4).toString(16).padStart(2, "0")}  ${hex(word)} / ${word}`;
        card.append(item);
      }
    } else {
      card.append(
        "No inspection export. Use the diagnostic bus log to observe accesses.",
      );
    }
    $("peripheral-state").append(card);
  }
  const rows = [
    ["0x00000000–0x0000FFFF", "RAM", "64 KiB"],
    ["0xF0000000", "UART", "Write byte"],
    ["0xF0000004", "Exit", "Write code"],
    ...devices.map((d) => [
      `0x${hex(d.base)}–0x${hex(d.base + d.size - 1)}`,
      d.name,
      `${d.size} bytes`,
    ]),
  ];
  $("address-map").replaceChildren(
    makeTable(["Address", "Target", "Size / operation"], rows),
  );
}
function detachPeripheral(base) {
  pause();
  invalidateComparison();
  busy = true;
  worker.postMessage({ type: "detach", base });
  buttons();
}
async function attachPeripheral(buffer, name, save = false) {
  const base = Number($("peripheral-base").value);
  if (!Number.isInteger(base)) {
    message("Enter a valid MMIO base address.", true);
    return;
  }
  pause();
  invalidateComparison();
  busy = true;
  pendingPeripheral = {
    buffer,
    base,
    name,
    save,
    irqLine: Number($("peripheral-irq").value),
  };
  worker.postMessage({ type: "attach", ...pendingPeripheral });
  buttons();
}
$("peripheral-attach").onclick = async () => {
  try {
    const response = await fetch(
      new URL(
        `./peripherals/${$("peripheral-example").value}.wasm`,
        import.meta.url,
      ),
    );
    if (!response.ok) throw Error("Could not load the example peripheral");
    await attachPeripheral(
      await response.arrayBuffer(),
      deviceTypes[$("peripheral-example").value].name,
    );
  } catch (error) {
    message(error.message, true);
  }
};
$("peripheral-file").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 4 * 1024 * 1024) throw Error("Peripheral exceeds 4 MiB");
    await attachPeripheral(await file.arrayBuffer(), file.name, true);
  } catch (error) {
    message(error.message, true);
  }
  event.target.value = "";
};
$("peripheral-detach").onclick = () => detachPeripheral();
$("peripheral-demo").onclick = () => {
  const demo = deviceTypes[$("peripheral-example").value].demo;
  $("example").value = demo;
  $("editor").value = examples[demo].source;
  compile();
};
function startWorker() {
  compilationToken++;
  pause();
  invalidateComparison();
  worker?.terminate();
  pendingPeripheral = undefined;
  ready = false;
  busy = true;
  loaded = false;
  state = undefined;
  const profile = profiles[$("profile").value];
  $("core-info").textContent =
    `${profile.isa} / ${profile.registers} regs / 64 KiB`;
  $("chip-isa").textContent = `${profile.isa} · RTL → WASM`;
  $("profile-description").textContent = profile.description;
  $("status").textContent = "Loading RTL…";
  worker = new Worker(new URL("./worker.mjs", import.meta.url), {
    type: "module",
  });
  worker.onmessage = handleWorkerMessage;
  worker.onerror = handleWorkerError;
  worker.postMessage({
    type: "init",
    profile: $("profile").value,
    peripherals: peripheralImages,
    diagnostic: $("diagnostic-mode").checked,
    fetch: $("diagnostic-fetch").checked,
    platform: {
      instructionLatency: Number($("instruction-latency").value),
      dataLatency: Number($("data-latency").value),
      externalMask: Number($("external-mask").value),
      softwareIrq: $("software-irq").checked,
      stopOnInterrupt: $("stop-on-interrupt").checked,
    },
  });
  buttons();
}
function makeTable(headers, rows) {
  const table = document.createElement("table"),
    thead = document.createElement("thead"),
    tr = document.createElement("tr");
  for (const text of headers) {
    const th = document.createElement("th");
    th.textContent = text;
    tr.append(th);
  }
  thead.append(tr);
  table.append(thead);
  const body = document.createElement("tbody");
  for (const cells of rows) {
    const row = document.createElement("tr");
    for (const text of cells) {
      const td = document.createElement("td");
      td.textContent = text;
      row.append(td);
    }
    body.append(row);
  }
  table.append(body);
  return table;
}
function renderProgram(program) {
  $("program-name").textContent = program.name ?? "Assembly editor";
  $("program-info").textContent =
    `${program.format ?? "Assembly"} · entry 0x${hex(program.entry)} · ${program.segments.reduce((n, s) => n + s.bytes.length, 0)} bytes loaded${program.abi ? ` · ${program.abi}` : ""}`;
  $("elf-segments").replaceChildren();
  if (program.format === "ELF32")
    $("elf-segments").append(
      makeTable(
        ["Segment address", "File bytes", "RAM bytes", "Flags"],
        program.segments.map((s) => [
          `0x${hex(s.address)}`,
          s.fileSize,
          s.memorySize,
          `${s.flags & 4 ? "R" : "-"}${s.flags & 2 ? "W" : "-"}${s.flags & 1 ? "X" : "-"}`,
        ]),
      ),
    );
}
$("watchpoint-form").onsubmit = (event) => {
  event.preventDefault();
  const address = Number($("watchpoint-address").value);
  if (!Number.isInteger(address) || address < 0 || address > 0xffffffff) {
    message("Enter a data watchpoint address from 0 to 0xffffffff.", true);
    return;
  }
  pause();
  worker.postMessage({
    type: "watchpoint",
    address,
    access: $("watchpoint-access").value,
  });
};
$("watchpoint-clear").onclick = () => {
  pause();
  worker.postMessage({ type: "watchpoint", address: null });
};
const trapNames = {
  0: "Instruction address misaligned",
  1: "Instruction access fault",
  2: "Illegal instruction",
  3: "Breakpoint instruction",
  4: "Load address misaligned",
  5: "Load access fault",
  6: "Store address misaligned",
  7: "Store access fault",
  11: "Environment call from M-mode",
};
function renderDiagnostics() {
  if (!state) return;
  $("watchpoint-status").textContent = state.watchpoint
    ? `${state.watchpoint.access} at 0x${hex(state.watchpoint.address)} · stops after the accepting clock edge`
    : "No data watchpoint";
  const kind = $("log-kind").value,
    filter = $("log-filter").value.toLowerCase();
  $("diagnostic-log").replaceChildren();
  for (const event of [...state.events].reverse()) {
    if (
      kind &&
      !(kind === "device"
        ? event.kind.startsWith("device-")
        : event.kind === kind)
    )
      continue;
    if (
      filter &&
      !`${JSON.stringify(event)} ${hex(event.address ?? 0)} ${hex(event.pc ?? 0)}`
        .toLowerCase()
        .includes(filter)
    )
      continue;
    const details = ["memory", "mmio", "fetch", "dma"].includes(event.kind)
      ? `${event.operation ?? "fetch"}${event.width ? event.width * 8 : ""} ${event.data === null ? "—" : `0x${hex(event.data)}`} · ${event.response} · ${event.target ?? "instruction bus"}${event.pc !== undefined ? ` · PC 0x${hex(event.pc)}` : ""}`
      : event.kind === "retire"
        ? event.changes
            .map((c) => `x${c.register}: ${hex(c.before)} → ${hex(c.after)}`)
            .join("; ") || "No register write"
        : event.kind === "trap"
          ? `${trapNames[event.cause] ?? "Exception"}; cause ${event.cause}; value 0x${hex(event.value)}`
          : JSON.stringify(
              Object.fromEntries(
                Object.entries(event).filter(
                  ([k]) =>
                    !["sequence", "cycle", "kind", "pc", "address"].includes(k),
                ),
              ),
            );
    const row = document.createElement("tr");
    if (event.kind === "trap" || event.response === "error")
      row.className = "fault";
    for (const text of [
      `#${event.sequence} / ${event.cycle}`,
      event.kind,
      event.address !== undefined
        ? `0x${hex(event.address)}`
        : event.pc !== undefined
          ? `0x${hex(event.pc)}`
          : "—",
      details,
    ]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    $("diagnostic-log").append(row);
  }
  $("log-summary").textContent =
    `${state.diagnostic ? "Diagnostic capture enabled" : "Standard event capture"} · ${state.events.length} recent events received / ${state.retainedEvents} retained · ${state.droppedEvents} events discarded by retention limit`;
  const trap = [...state.events].reverse().find((e) => e.kind === "trap");
  $("trap-detail").hidden = !trap;
  if (trap)
    $("trap-detail").textContent =
      `${trapNames[trap.cause] ?? "Exception"} · faulting PC 0x${hex(trap.pc)} · cause ${trap.cause} · trap value 0x${hex(trap.value)}`;
}
for (const id of ["diagnostic-mode", "diagnostic-fetch"])
  $(id).onchange = () => {
    pause();
    worker.postMessage({
      type: "diagnostic",
      enabled: $("diagnostic-mode").checked,
      fetch: $("diagnostic-fetch").checked,
    });
  };
$("clear-log").onclick = () => {
  pause();
  worker.postMessage({ type: "clear-log" });
};
$("log-kind").onchange = renderDiagnostics;
$("log-filter").oninput = renderDiagnostics;
$("breakpoint-form").onsubmit = (event) => {
  event.preventDefault();
  const address = Number($("breakpoint-address").value);
  if (
    !Number.isInteger(address) ||
    address < 0 ||
    address >= 65536 ||
    address % 2
  ) {
    message("Use a halfword-aligned breakpoint address in RAM.", true);
    return;
  }
  pause();
  breakpoints.add(address);
  renderListing();
};
function showTab(name) {
  if (
    ![
      "debugger",
      "devices",
      "diagnostics",
      "compare",
      "guide",
      "about",
    ].includes(name)
  )
    name = "debugger";
  for (const tab of document.querySelectorAll("[data-tab]")) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", selected);
    tab.tabIndex = selected ? 0 : -1;
    $("view-" + tab.dataset.tab).hidden = !selected;
  }
  history.replaceState(null, "", `#${name}`);
}
for (const tab of document.querySelectorAll("[data-tab]")) {
  tab.onclick = () => showTab(tab.dataset.tab);
  tab.onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll("[data-tab]")],
      index = tabs.indexOf(tab),
      next =
        tabs[
          (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
            tabs.length
        ];
    showTab(next.dataset.tab);
    next.focus();
  };
}
$("device-guide").onclick = () => {
  showTab("guide");
  $("mmio-guide").scrollIntoView({ block: "start" });
};
$("module-source").parentElement.ontoggle = async (event) => {
  if (!event.target.open || $("module-source").dataset.loaded) return;
  try {
    const response = await fetch("./peripherals/pulse-counter.cpp");
    if (!response.ok) throw Error("Source unavailable");
    $("module-source").textContent = await response.text();
    $("module-source").dataset.loaded = "true";
  } catch (error) {
    $("module-source").textContent = error.message;
  }
};
let savedAssets = [];
async function refreshLibrary() {
  try {
    savedAssets = await assets("list");
    for (const [id, type] of [
      ["saved-elf", "elf"],
      ["saved-device", "wasm"],
    ]) {
      const select = $(id),
        previous = select.value;
      select.replaceChildren();
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent =
        type === "elf" ? "Choose a saved executable" : "Choose a saved module";
      select.append(empty);
      for (const asset of savedAssets.filter((a) => a.type === type)) {
        const option = document.createElement("option");
        option.value = asset.id;
        option.textContent = asset.name;
        select.append(option);
      }
      select.value = previous;
    }
  } catch {
    message(
      "Browser storage is unavailable. File loading still works; the local library cannot be saved.",
      true,
    );
  }
}
async function saveAsset(asset) {
  try {
    await assets("put", asset);
    await refreshLibrary();
  } catch {
    message(
      "File loaded for this session; browser storage could not save it.",
      true,
    );
  }
}
$("load-saved-elf").onclick = () => {
  const asset = savedAssets.find((a) => a.id === $("saved-elf").value);
  if (asset) openElf(new File([asset.buffer], asset.name));
};
$("load-saved-device").onclick = () => {
  const asset = savedAssets.find((a) => a.id === $("saved-device").value);
  if (asset) attachPeripheral(asset.buffer, asset.name);
};
for (const [button, select] of [
  ["delete-saved-elf", "saved-elf"],
  ["delete-saved-device", "saved-device"],
])
  $(button).onclick = async () => {
    const id = $(select).value;
    if (id) {
      await assets("delete", id);
      await refreshLibrary();
    }
  };
showTab(location.hash.slice(1));
refreshLibrary();
$("profile").onchange = startWorker;
startWorker();

$("platform-form").onsubmit = (event) => {
  event.preventDefault();
  if (busy || !ready) return;
  pause();
  invalidateComparison();
  busy = true;
  worker.postMessage({
    type: "platform",
    platform: {
      instructionLatency: Number($("instruction-latency").value),
      dataLatency: Number($("data-latency").value),
      externalMask: Number($("external-mask").value),
      softwareIrq: $("software-irq").checked,
      stopOnInterrupt: $("stop-on-interrupt").checked,
    },
  });
  buttons();
};
