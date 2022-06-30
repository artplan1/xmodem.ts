// vite.config.ts
import path from "path";
import { defineConfig } from "vite";
import { builtinModules } from "module";

module.exports = defineConfig({
  build: {
    target: `node16`,
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "xmodem.ts",
      formats: ['cjs', 'es'],
      fileName: (format) => `xmodem.${format}.js`,
    },
    rollupOptions: {
      external: [
        "crc",
        ...builtinModules.flatMap((p) => [p, `node:${p}`]),
      ],
    },
  },
});
