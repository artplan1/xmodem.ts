// vite.config.ts
import path from "path";
import { defineConfig } from "vite";

module.exports = defineConfig({
  build: {
    target: `node16`,
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "xmodem.ts",
      fileName: (format) => `xmodem.${format}.js`,
    },
    rollupOptions: {
      external: [
        "buffer",
        "crc",
      ],
    },
  },
});
