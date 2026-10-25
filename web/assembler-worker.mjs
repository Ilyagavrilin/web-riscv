import { assemble } from "./assembler.mjs";
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      self.postMessage({
        token: data.token,
        program: await assemble(data.source, data.profile),
      });
    } catch (error) {
      self.postMessage({ token: data.token, error: error.message });
    }
  });
};
