#pragma once
#include <pthread.h>
#include <sched.h>

// Emscripten declares CPU sets but cannot provide native CPU affinity.
#undef CPU_ZERO
