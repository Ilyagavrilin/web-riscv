cmake_minimum_required(VERSION 3.24)
project(scr1_workbench VERSION 0.1.0 LANGUAGES NONE)

set(SCR1_PROFILE "" CACHE STRING "SCR1 model profile")

option(SCR1_PERIPHERAL "Build the example peripheral" OFF)

option(SCR1_TOOLCHAIN "Package the GNU assembler" OFF)

if(SCR1_TOOLCHAIN)
  include(cmake/toolchain.cmake)
elseif(SCR1_PERIPHERAL)
  include(cmake/peripheral.cmake)
elseif(SCR1_PROFILE)
  include(cmake/model.cmake)
else()
  include(cmake/site.cmake)
endif()
