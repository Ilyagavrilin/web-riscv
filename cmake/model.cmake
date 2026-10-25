if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Use the Emscripten toolchain to build a model")
endif()

enable_language(CXX)
set(VERILATOR_CFLAGS "")
set(VERILATOR_MT_CFLAGS "")
find_package(verilator REQUIRED)

file(READ "${PROJECT_SOURCE_DIR}/web/profiles.json" profiles)
string(JSON profile_define GET "${profiles}" "${SCR1_PROFILE}" define)
file(STRINGS "${SCR1_SOURCE}/src/core.files" core_sources)
list(TRANSFORM core_sources PREPEND "${SCR1_SOURCE}/src/")

add_executable(scr1 sim/bridge.cpp)
set_target_properties(scr1 PROPERTIES OUTPUT_NAME "scr1-${SCR1_PROFILE}" SUFFIX ".mjs")
target_compile_features(scr1 PRIVATE cxx_std_17)
target_compile_options(scr1 PRIVATE -include "${PROJECT_SOURCE_DIR}/sim/wasm-platform.h")
target_link_options(scr1 PRIVATE
  --no-entry
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sENVIRONMENT=web,worker,node
  -sALLOW_MEMORY_GROWTH=1
  -sFILESYSTEM=0
  "-sEXPORTED_FUNCTIONS=[\"_reset\",\"_poke\",\"_peek\",\"_tick\",\"_signal\",\"_reg\",\"_mmio_response\"]"
)
verilate(scr1
  PREFIX Vworkbench
  TOP_MODULE workbench
  THREADS 1
  SOURCES rtl/workbench.sv ${core_sources}
  INCLUDE_DIRS "${SCR1_SOURCE}/src/includes"
  VERILATOR_ARGS -Wno-fatal "-D${profile_define}"
)
install(TARGETS scr1 RUNTIME DESTINATION .)
install(FILES "${PROJECT_BINARY_DIR}/scr1-${SCR1_PROFILE}.wasm" DESTINATION .)
