import { loadElf } from "./elf.mjs";
export { loadElf } from "./elf.mjs";
export const aliases = [
  "zero",
  "ra",
  "sp",
  "gp",
  "tp",
  "t0",
  "t1",
  "t2",
  "s0",
  "s1",
  "a0",
  "a1",
  "a2",
  "a3",
  "a4",
  "a5",
  "a6",
  "a7",
  "s2",
  "s3",
  "s4",
  "s5",
  "s6",
  "s7",
  "s8",
  "s9",
  "s10",
  "s11",
  "t3",
  "t4",
  "t5",
  "t6",
];

let tools;
async function toolchain() {
  if (!tools)
    tools = (async () => {
      let base = new URL("./toolchain/", import.meta.url);
      const node = Boolean(globalThis.process?.versions?.node);
      if (node) {
        const { resolve } = await import("node:path");
        const { pathToFileURL } = await import("node:url");
        base = pathToFileURL(
          resolve(process.env.SCR1_MODEL_DIR || "build", "toolchain") + "/",
        );
      }
      async function load(name, wasm) {
        const { default: factory } = await import(new URL(name + ".mjs", base));
        const url = new URL(wasm, base);
        const binary = node
          ? await (await import("node:fs/promises")).readFile(url)
          : await (await fetch(url)).arrayBuffer();
        return { factory, module: await WebAssembly.compile(binary) };
      }
      const [as, ld] = await Promise.all([
        load("as", "as-new.wasm"),
        load("ld", "ld-new.wasm"),
      ]);
      return { as, ld };
    })().catch((error) => {
      tools = undefined;
      throw error;
    });
  return tools;
}
async function createTool(tool, errors) {
  return tool.factory({
    noInitialRun: true,
    noExitRuntime: true,
    print: () => {},
    printErr: (line) => errors.push(line),
    instantiateWasm(imports, receive) {
      const instance = new WebAssembly.Instance(tool.module, imports);
      receive(instance, tool.module);
      return instance.exports;
    },
  });
}
function invoke(tool, args) {
  const process = globalThis.process;
  const previous = process?.exitCode;
  try {
    return tool.callMain(args);
  } finally {
    if (process?.versions?.node) process.exitCode = previous;
  }
}
const linkerScript = `ENTRY(_scr1_entry)
MEMORY { RAM (rwx) : ORIGIN = 0, LENGTH = 0x10000 }
PHDRS { image PT_LOAD FLAGS(7); }
SECTIONS {
 .vectors 0x1c0 : { KEEP(*(.vectors)) } > RAM :image
 ASSERT(SIZEOF(.vectors) <= 0x40, "Interrupt vectors overlap reset entry")
 .text 0x200 : { *(.text .text.*) } > RAM :image
 .rodata : { *(.rodata .rodata.*) } > RAM :image
 .data : { *(.data .data.* .sdata .sdata.*) } > RAM :image
 .bss (NOLOAD) : { *(.bss .bss.* .sbss .sbss.*) *(COMMON) } > RAM :image
 /DISCARD/ : { *(.riscv.attributes .comment .note*) }
}`;
export async function assemble(
  source,
  profile = { isa: "RV32IMC", registers: 32, multiply: true },
) {
  if (!source.trim()) throw Error("Program is empty");
  const isa = (
    profile.isa ??
    (profile.registers === 16
      ? "RV32EC"
      : profile.multiply
        ? "RV32IMC"
        : "RV32IC")
  ).toLowerCase();
  const abi = profile.registers === 16 ? "ilp32e" : "ilp32";
  const tools = await toolchain(),
    errors = [];
  const assembler = await createTool(tools.as, errors);
  assembler.FS.writeFile(
    "/program.s",
    `.option norelax\n.option norvc\n.text\n.globl _scr1_entry\n_scr1_entry:\n# 1 "editor.s"\n${source}\n`,
  );
  const status = invoke(assembler, [
    "--fatal-warnings",
    `--defsym=SCR1_HAS_IPIC=${profile.registers === 16 ? 0 : 1}`,
    `-march=${isa}_zicsr_zifencei`,
    `-mabi=${abi}`,
    "-mno-relax",
    "-o",
    "/program.o",
    "/program.s",
  ]);
  if (status)
    throw Error(
      errors.join("\n") || `GNU assembler exited with code ${status}`,
    );
  const linker = await createTool(tools.ld, errors);
  linker.FS.writeFile("/program.o", assembler.FS.readFile("/program.o"));
  linker.FS.writeFile("/link.ld", linkerScript);
  const linked = invoke(linker, [
    "-m",
    "elf32lriscv",
    "--no-relax",
    "-T",
    "/link.ld",
    "-o",
    "/program.elf",
    "/program.o",
  ]);
  if (linked)
    throw Error(errors.join("\n") || `GNU linker exited with code ${linked}`);
  const bytes = linker.FS.readFile("/program.elf").slice();
  const result = loadElf(bytes.buffer);
  result.format = "GNU assembly";
  result.toolchain = "GNU binutils 2.46.0";
  return result;
}
