{
  lib,
  stdenvNoCC,
  cmake,
  ninja,
  verilator,
  emscripten,
  src,
  scr1,
  profile,
}:
stdenvNoCC.mkDerivation {
  pname = "scr1-${profile}";
  version = "0.1.0";
  src = lib.fileset.toSource {
    root = src;
    fileset = lib.fileset.unions [
      (src + /CMakeLists.txt)
      (src + /cmake/model.cmake)
      (src + /rtl)
      (src + /sim)
      (src + /web/profiles.json)
    ];
  };
  nativeBuildInputs = [
    cmake
    ninja
    verilator
    emscripten
  ];
  cmakeFlags = [
    "-DCMAKE_TOOLCHAIN_FILE=${emscripten}/share/emscripten/cmake/Modules/Platform/Emscripten.cmake"
    "-Dverilator_DIR=${verilator}/share/verilator"
    "-DSCR1_SOURCE=${scr1}"
    "-DSCR1_PROFILE=${profile}"
  ];
  strictDeps = true;
  meta = {
    description = "SCR1 ${profile} RTL model compiled to WebAssembly";
    license = import ./licenses.nix { inherit lib; };
    platforms = lib.platforms.unix;
  };
}
