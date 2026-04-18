import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve(__dirname, "electron/main/index.ts"),
      },
    },
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@core-types": resolve(__dirname, "../../packages/core-types/src"),
      },
    },
  },
  preload: {
    build: {
      lib: {
        entry: resolve(__dirname, "electron/preload/index.ts"),
      },
    },
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@core-types": resolve(__dirname, "../../packages/core-types/src"),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "renderer"),
    build: {
      rollupOptions: {
        input: resolve(__dirname, "renderer/index.html"),
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "renderer/src"),
        "@core-types": resolve(__dirname, "../../packages/core-types/src"),
      },
    },
  },
});
