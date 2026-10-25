import profiles from "./profiles.json" with { type: "json" };
import { assemble, loadElf, aliases } from "./assembler.mjs";
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
  peripheralImage,
  pendingPeripheral;
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
$("example-description").textContent = examples.fibonacci.description;
function message(text, error = false) {
  $("message").textContent = text;
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
  $("run").textContent = running ? "Ⅱ Pause" : "▶ Run";
  for (const id of ["peripheral-attach", "peripheral-file", "peripheral-demo"])
    $(id).disabled = !ready || busy;
  $("peripheral-detach").disabled = !ready || !peripheralImage || busy;
  $("compare").disabled = !ready || !loaded || dirty || busy;
}
function pause() {
  running = false;
  generation++;
  buttons();
}
function load(program) {
  pause();
  invalidateComparison();
  listing = program.listing;
  breakpoints.clear();
  previous = [];
  busy = true;
  loaded = true;
  dirty = false;
  state = undefined;
  worker.postMessage({ type: "load", program });
  buttons();
  renderListing();
}
function compile() {
  currentElf = undefined;
  try {
    const program = assemble($("editor").value, profiles[$("profile").value]);
    load(program);
    try {
      localStorage.setItem("scr1-source", $("editor").value);
    } catch {}
    message(
      `Loaded ${program.segments[0].bytes.length} bytes at 0x200. Ready to explore.`,
    );
  } catch (error) {
    dirty = true;
    $("status").textContent = "Assembly error";
    message(error.message, true);
    buttons();
  }
}
function renderListing() {
  $("listing").replaceChildren();
  if (!listing.length) {
    $("listing").textContent =
      "ELF loaded. Use the PC, memory and trace to inspect execution.";
    return;
  }
  for (const line of listing) {
    const row = document.createElement("button");
    row.className = "code-row";
    row.dataset.address = line.address;
    row.classList.toggle("active", line.address === state?.pc);
    row.classList.toggle("break", breakpoints.has(line.address));
    row.setAttribute("aria-pressed", String(breakpoints.has(line.address)));
    row.title = `Line ${line.line} · toggle PC breakpoint`;
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
  renderPeripheral(s.peripheral);
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
      peripheralImage = pendingPeripheral;
      pendingPeripheral = undefined;
    }
    if (!data.state.peripheral && !pendingPeripheral)
      peripheralImage = undefined;
    busy = Boolean(pendingPeripheral);
    if (["halted", "trap", "breakpoint"].includes(data.state.status)) pause();
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
  $("example-description").textContent =
    examples[$("example").value].description;
  compile();
};
$("editor").oninput = () => {
  pause();
  invalidateComparison();
  dirty = true;
  message("Source changed. Assemble & load to apply it.");
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
$("elf").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 4 * 1024 * 1024) throw Error("ELF exceeds 4 MiB");
    const program = loadElf(await file.arrayBuffer());
    load(program);
    message(`Loaded ${file.name}. ELF reset uses the same image.`);
    currentElf = program;
    $("example-description").textContent =
      `ELF image: ${file.name}. The editor is separate; assemble it to switch back to source.`;
  } catch (error) {
    message(error.message, true);
  }
  e.target.value = "";
};
$("reset").onclick = () => {
  if (currentElf && !dirty) load(currentElf);
  else compile();
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
    program =
      currentElf || assemble($("editor").value, profiles[$("profile").value]);
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
  comparisonWorker.postMessage({ program, peripheral: peripheralImage });
};
function renderPeripheral(device) {
  $("peripheral-state").replaceChildren();
  if (!device) {
    $("peripheral-status").textContent =
      "No module attached. The example counts simulated clocks and rotates an 8-bit GPIO pattern.";
    return;
  }
  $("peripheral-status").textContent =
    `${device.name} · 0x${hex(device.base)} · ${device.size} bytes`;
  if (!device.words.length) {
    $("peripheral-state").textContent =
      "This module does not export an inspection view.";
    return;
  }
  const bits = document.createElement("div");
  bits.className = "gpio-bits";
  for (let bit = 7; bit >= 0; bit--) {
    const led = document.createElement("span");
    led.className = "gpio-bit" + ((device.words[0] >> bit) & 1 ? " on" : "");
    led.textContent = String(bit);
    led.title = `Word 0, bit ${bit}`;
    bits.append(led);
  }
  const label = document.createElement("small");
  label.textContent = "WORD 0 · LOW 8 BITS";
  bits.append(label);
  $("peripheral-state").append(bits);
  for (const [index, word] of device.words.entries()) {
    const item = document.createElement("span");
    item.className = "peripheral-word";
    item.textContent = `+0x${(index * 4).toString(16).padStart(2, "0")}  ${hex(word)}  /  ${word}`;
    $("peripheral-state").append(item);
  }
}
async function attachPeripheral(buffer, name) {
  const base = Number($("peripheral-base").value);
  if (!Number.isInteger(base)) {
    message("Enter a valid MMIO base address.", true);
    return;
  }
  pause();
  invalidateComparison();
  busy = true;
  pendingPeripheral = { buffer, base, name };
  worker.postMessage({ type: "attach", ...pendingPeripheral });
  buttons();
}
$("peripheral-attach").onclick = async () => {
  try {
    const response = await fetch(
      new URL("./peripherals/pulse-counter.wasm", import.meta.url),
    );
    if (!response.ok) throw Error("Could not load the example peripheral");
    await attachPeripheral(
      await response.arrayBuffer(),
      "GPIO + cycle counter",
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
    await attachPeripheral(await file.arrayBuffer(), file.name);
  } catch (error) {
    message(error.message, true);
  }
  event.target.value = "";
};
$("peripheral-detach").onclick = () => {
  pause();
  invalidateComparison();
  busy = true;
  peripheralImage = undefined;
  worker.postMessage({ type: "detach" });
  buttons();
};
$("peripheral-demo").onclick = () => {
  $("example").value = "peripheral";
  $("editor").value = examples.peripheral.source;
  $("example-description").textContent = examples.peripheral.description;
  compile();
};
function startWorker() {
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
    peripheral: peripheralImage,
  });
  buttons();
}
$("profile").onchange = startWorker;
startWorker();
