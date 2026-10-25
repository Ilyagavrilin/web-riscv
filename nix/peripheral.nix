{
  lib,
  stdenvNoCC,
  cmake,
  ninja,
  emscripten,
  src,
  systemcWasm,
}:
stdenvNoCC.mkDerivation {
  pname = "scr1-peripherals";
  version = "0.1.0";
  src = lib.fileset.toSource {
    root = src;
    fileset = lib.fileset.unions [
      (src + /CMakeLists.txt)
      (src + /cmake/peripheral.cmake)
      (src + /peripherals)
    ];
  };
  nativeBuildInputs = [
    cmake
    ninja
    emscripten
  ];
  cmakeFlags = [
    "-DCMAKE_TOOLCHAIN_FILE=${emscripten}/share/emscripten/cmake/Modules/Platform/Emscripten.cmake"
    "-DSCR1_PERIPHERAL=ON"
    "-DSystemCLanguage_DIR=${systemcWasm}/lib/cmake/SystemCLanguage"
  ];
  strictDeps = true;
  meta = {
    description = "Clocked MMIO device SDK and examples for SCR1 Workbench";
    license = [
      lib.licenses.mit
      lib.licenses.asl20
    ];
    platforms = lib.platforms.unix;
  };
}
