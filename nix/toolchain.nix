{
  lib,
  stdenvNoCC,
  cmake,
  ninja,
  src,
  binutils-wasm,
}:
stdenvNoCC.mkDerivation {
  pname = "riscv-binutils-wasm";
  version = "2.46.0";
  src = lib.fileset.toSource {
    root = src;
    fileset = lib.fileset.unions [
      (src + /CMakeLists.txt)
      (src + /cmake/toolchain.cmake)
      (src + /toolchain)
    ];
  };
  nativeBuildInputs = [
    cmake
    ninja
  ];
  cmakeFlags = [
    "-DSCR1_TOOLCHAIN=ON"
    "-DSCR1_BINUTILS=${binutils-wasm}/js"
  ];
  strictDeps = true;
  meta = {
    description = "Pinned prebuilt GNU RISC-V assembler and linker for the browser";
    license = lib.licenses.gpl3Plus;
    platforms = lib.platforms.unix;
  };
}
