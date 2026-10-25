if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Use the Emscripten toolchain to build a peripheral")
endif()
enable_language(C)
add_executable(pulse_counter peripherals/pulse-counter.c)
set_target_properties(pulse_counter PROPERTIES OUTPUT_NAME pulse-counter SUFFIX .wasm)
target_compile_features(pulse_counter PRIVATE c_std_11)
target_link_options(pulse_counter PRIVATE
  --no-entry
  -sSTANDALONE_WASM=1
  -sFILESYSTEM=0
  "-sEXPORTED_FUNCTIONS=[\"_mmio_abi_version\",\"_mmio_size\",\"_mmio_reset\",\"_mmio_read\",\"_mmio_write\",\"_mmio_tick\",\"_mmio_inspect\"]"
)
install(TARGETS pulse_counter RUNTIME DESTINATION .)

install(FILES peripherals/pulse-counter.c DESTINATION .)
