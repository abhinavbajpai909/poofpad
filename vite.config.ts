import { defineConfig } from "vite";

const workerOrigin = "http://127.0.0.1:8787";

export default defineConfig({
  root: "src/client",
  publicDir: "../../public",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  server: {
    // Keys starting with "^" are RegExps; plain keys are prefix matches and would also catch
    // source modules such as /api.ts.
    proxy: {
      "^/api/": { target: workerOrigin },
      "^/ws/": { target: workerOrigin, ws: true },
    },
  },
});
