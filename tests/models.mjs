import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export async function createModel(profile) {
  const directory =
    process.env.SCR1_MODEL_DIR ||
    new URL("../build/", import.meta.url).pathname;
  const { default: createModule } = await import(
    pathToFileURL(join(resolve(directory), `scr1-${profile}.mjs`))
  );
  return createModule();
}
