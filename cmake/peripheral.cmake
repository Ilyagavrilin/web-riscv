if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Use the Emscripten toolchain to build a peripheral")
endif()
enable_language(CXX)
find_package(SystemCLanguage CONFIG REQUIRED)

function(add_mmio_module name source)
  add_executable(${name} "${source}" peripherals/adapter.cpp)
  set_target_properties(${name} PROPERTIES SUFFIX .wasm)
  target_include_directories(${name} PRIVATE "${PROJECT_SOURCE_DIR}/peripherals/include")
  target_compile_features(${name} PRIVATE cxx_std_17)
  target_compile_options(${name} PRIVATE -fwasm-exceptions -fno-threadsafe-statics)
  target_link_libraries(${name} PRIVATE SystemC::systemc)
  target_link_options(${name} PRIVATE
    --no-entry -fwasm-exceptions -sSTANDALONE_WASM=1 -sFILESYSTEM=0
    "-sEXPORTED_FUNCTIONS=[\"_mmio_abi_version\",\"_mmio_size\",\"_mmio_reset\",\"_mmio_read\",\"_mmio_write\",\"_mmio_tick\",\"_mmio_inspect\"]"
  )
  install(TARGETS ${name} RUNTIME DESTINATION .)
endfunction()

set(SCR1_MMIO_SOURCE "" CACHE FILEPATH "Custom clocked SystemC device source")
if(SCR1_MMIO_SOURCE)
  add_mmio_module(custom-device "${SCR1_MMIO_SOURCE}")
else()
  add_mmio_module(pulse-counter peripherals/pulse-counter.cpp)
  add_mmio_module(timer peripherals/timer.cpp)
  add_mmio_module(mailbox peripherals/mailbox.cpp)
endif()
install(DIRECTORY peripherals/include/ DESTINATION include)
install(FILES peripherals/pulse-counter.cpp peripherals/timer.cpp peripherals/mailbox.cpp peripherals/adapter.cpp DESTINATION .)

get_filename_component(systemc_prefix "${SystemCLanguage_DIR}/../../.." ABSOLUTE)
install(FILES "${systemc_prefix}/share/doc/SystemCLanguage/LICENSE" DESTINATION . RENAME SystemC-LICENSE)
install(FILES "${systemc_prefix}/share/doc/SystemCLanguage/NOTICE" DESTINATION . RENAME SystemC-NOTICE)
