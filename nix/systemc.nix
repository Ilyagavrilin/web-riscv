{
  lib,
  stdenvNoCC,
  cmake,
  ninja,
  emscripten,
  src,
}:
stdenvNoCC.mkDerivation {
  pname = "systemc-wasm";
  version = "3.0.2";
  inherit src;
  nativeBuildInputs = [
    cmake
    ninja
    emscripten
  ];
  cmakeFlags = [
    "-DCMAKE_TOOLCHAIN_FILE=${emscripten}/share/emscripten/cmake/Modules/Platform/Emscripten.cmake"
    "-DCMAKE_CXX_STANDARD=17"
    "-DCMAKE_CXX_FLAGS=-fwasm-exceptions"
    "-DBUILD_SHARED_LIBS=OFF"
    "-DENABLE_PTHREADS=ON"
    "-DCMAKE_HAVE_LIBC_PTHREAD=ON"
    "-DDISABLE_ASYNC_UPDATES=ON"
    "-DDISABLE_COPYRIGHT_MESSAGE=ON"
    "-DBUILD_TESTING=OFF"
  ];
  strictDeps = true;
  meta = {
    description = "SystemC kernel for single-threaded browser method processes";
    license = lib.licenses.asl20;
    platforms = lib.platforms.unix;
  };
}
