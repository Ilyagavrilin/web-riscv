{
  lib,
  stdenvNoCC,
  cmake,
  ninja,
  nodejs,
  src,
  scr1,
  models,
  peripheral,
}:
stdenvNoCC.mkDerivation {
  pname = "scr1-workbench";
  version = "0.1.0";
  src = lib.fileset.toSource {
    root = src;
    fileset = lib.fileset.unions [
      (src + /CMakeLists.txt)
      (src + /cmake/site.cmake)
      (src + /web)
      (src + /tests)
      (src + /LICENSE)
    ];
  };
  nativeBuildInputs = [
    cmake
    ninja
  ];
  nativeCheckInputs = [ nodejs ];
  cmakeFlags = [
    "-DSCR1_MODELS=${lib.concatStringsSep ";" (lib.attrValues models)}"
    "-DSCR1_LICENSE=${scr1}/LICENSE"
    "-DSCR1_PERIPHERALS=${peripheral}"
  ];
  doCheck = true;
  strictDeps = true;
  meta = {
    description = "Cycle-stepped SCR1 RTL workbench for the browser";
    license = import ./licenses.nix { inherit lib; };
    platforms = lib.platforms.unix;
  };
}
