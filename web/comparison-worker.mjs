import { compareProfiles } from "./compare.mjs";
self.onmessage = async ({ data }) => {
  try {
    const results = await compareProfiles(
      async (profile) => {
        const { default: createModule } = await import(`./scr1-${profile}.mjs`);
        return createModule();
      },
      data.program,
      (profile) => self.postMessage({ type: "progress", profile }),
      undefined,
      data.peripheral,
      data.platform,
    );
    self.postMessage({ type: "results", results });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
};
