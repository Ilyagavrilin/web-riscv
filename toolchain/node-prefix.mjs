var require, __filename, __dirname;
if (globalThis.process?.versions?.node) {
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const { dirname } = await import('node:path');
  require = createRequire(import.meta.url);
  __filename = fileURLToPath(import.meta.url);
  __dirname = dirname(__filename);
}
