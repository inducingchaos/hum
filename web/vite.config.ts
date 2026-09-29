import preact from "@preact/preset-vite";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";

// Short commit hash (Vercel sets VERCEL_GIT_COMMIT_SHA; locally ask git).
function build(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? (() => {
    try {
      return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "dev";
    }
  })();
  return `${sha.slice(0, 7)} ${new Date().toISOString().slice(0, 16).replace("T", " ")}Z`;
}

export default defineConfig({
  plugins: [preact()],
  define: { __BUILD__: JSON.stringify(build()) },
  build: { target: "safari17", sourcemap: false },
  server: { port: 5173 },
});
