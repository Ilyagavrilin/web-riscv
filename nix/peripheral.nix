{
  lib,
  stdenvNoCC,
  cmake,
  ninja,
  emscripten,
  src,
}:
stdenvNoCC.mkDerivation {
  pname = "scr1-pulse-counter";
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
  ];
  strictDeps = true;
  meta = {
    description = "Hot-loadable GPIO and clock counter for SCR1 Workbench";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
  };
}
