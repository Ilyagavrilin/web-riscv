export function peripheralHost() {
  const host = { instance: null, messages: [] };
  const memory = () => new DataView(host.instance.exports.memory.buffer);
  const wasi = {
    environ_sizes_get(count, size) {
      const view = memory();
      view.setUint32(count, 0, true);
      view.setUint32(size, 0, true);
      return 0;
    },
    environ_get() {
      return 0;
    },
    fd_close(fd) {
      return fd <= 2 ? 0 : 8;
    },
    fd_seek() {
      return 8;
    },
    fd_read(fd, _iov, _count, read) {
      if (fd !== 0) return 8;
      memory().setUint32(read, 0, true);
      return 0;
    },
    fd_write(fd, iov, count, written) {
      if (fd !== 1 && fd !== 2) return 8;
      const view = memory();
      let total = 0,
        output = "";
      for (let i = 0; i < count; i++) {
        const pointer = view.getUint32(iov + i * 8, true),
          length = view.getUint32(iov + i * 8 + 4, true);
        total += length;
        if (output.length < 4096)
          output += new TextDecoder().decode(
            new Uint8Array(
              view.buffer,
              pointer,
              Math.min(length, 4096 - output.length),
            ),
          );
      }
      view.setUint32(written, total, true);
      if (output.trim()) {
        host.messages.push(output.trim());
        if (host.messages.length > 20) host.messages.shift();
      }
      return 0;
    },
  };
  return {
    host,
    imports: { wasi_snapshot_preview1: wasi },
    supports: (entry) =>
      entry.kind === "function" &&
      entry.module === "wasi_snapshot_preview1" &&
      Object.hasOwn(wasi, entry.name),
  };
}
