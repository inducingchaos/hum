// Compiles native/humplayer.swift into .cache/bin/humplayer when the source changes.
// Owner's rule: if swiftc is missing or Xcode wants a license/update, stop and say
// exactly what's needed. Never install or work around it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE, paths } from "../config.ts";

export const HELPER_BIN = join(paths.bin, "humplayer");
const STAMP = join(paths.bin, "humplayer.sha");

const FLAGS = [
  "-O",
  "-swift-version", "5",
  "-module-cache-path", join(CACHE, "swift-module-cache"),
  "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", paths.helperPlist,
];

export class BuildError extends Error {}

function sourceHash(): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(readFileSync(paths.helperSource));
  h.update(readFileSync(paths.helperPlist));
  h.update(FLAGS.join(" "));
  return h.digest("hex");
}

export function helperIsStale(): boolean {
  if (!existsSync(HELPER_BIN) || !existsSync(STAMP)) return true;
  return readFileSync(STAMP, "utf8").trim() !== sourceHash();
}

export async function buildHelper(): Promise<void> {
  mkdirSync(paths.bin, { recursive: true });
  mkdirSync(paths.tmp, { recursive: true });
  let proc;
  try {
    proc = Bun.spawn(["swiftc", ...FLAGS, paths.helperSource, "-o", HELPER_BIN], {
      cwd: CACHE,
      env: { ...process.env, TMPDIR: paths.tmp + "/" },
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    throw new BuildError("swiftc not found. The audio engine needs Xcode's Swift toolchain. Nothing was installed; ask the owner.");
  }
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) {
    const hint = /license|xcodebuild|xcrun|agree/i.test(err)
      ? "Xcode needs attention (license or setup). Nothing was changed; ask the owner."
      : "The audio engine failed to compile.";
    throw new BuildError(`${hint}\n\n${err.trim()}`);
  }
  writeFileSync(STAMP, sourceHash());
}
