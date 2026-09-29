// Dev tool. Read-only: recursively lists a Dropbox folder and prints a summary.
// Usage: pnpm explore [path]   (default: the library root)
import { profile } from "../config.ts";
import { listAll } from "../dropbox/client.ts";

const root = process.argv[2] ?? profile().root;
const { entries } = await listAll({ path: root }, (n) => process.stderr.write(`\r${n} entries`));
process.stderr.write("\n");

const files = entries.filter((e) => e[".tag"] === "file");
const folders = entries.filter((e) => e[".tag"] === "folder");
const byExt: Record<string, { count: number; bytes: number }> = {};
for (const f of files) {
  const ext = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "(none)";
  byExt[ext] ??= { count: 0, bytes: 0 };
  byExt[ext].count++;
  byExt[ext].bytes += f.size ?? 0;
}
const gb = (b: number) => (b / 1e9).toFixed(2) + " GB";
const depth = (p: string) => p.slice(root.length).split("/").filter(Boolean).length;

console.log(`root: ${root}`);
console.log(`folders: ${folders.length}, files: ${files.length}, total: ${gb(files.reduce((s, f) => s + (f.size ?? 0), 0))}`);
console.log("by extension:");
for (const [ext, v] of Object.entries(byExt).sort((a, b) => b[1].bytes - a[1].bytes))
  console.log(`  .${ext}: ${v.count} files, ${gb(v.bytes)}`);
console.log(`max depth: ${Math.max(0, ...entries.map((e) => depth(e.path_display)))}`);
console.log("top-level:");
for (const e of entries.filter((e) => depth(e.path_display) === 1)) console.log(`  ${e[".tag"] === "folder" ? "/" : " "}${e.name}`);
