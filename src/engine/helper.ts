// Talks to the Swift helper over JSON lines. Respawns it if it crashes
// (at most 3 times a minute) and reports the crash so main can resume playback.
import type { Subprocess } from "bun";
import { HELPER_BIN } from "./build.ts";
import { log } from "../util.ts";

export type EngineEvent =
  | { ev: "ready"; version: number }
  | { ev: "state"; state: "playing" | "paused" | "buffering"; id: string | null }
  | { ev: "time"; id: string; pos: number; dur: number }
  | { ev: "advanced"; from: string; to: string }
  | { ev: "ended"; id: string }
  | { ev: "remote"; cmd: "toggle" | "play" | "pause" | "next" | "prev" | "seek"; pos?: number }
  | { ev: "error"; id?: string; message: string }
  | { ev: "art"; id: string; ok: boolean } // ack for the art command
  | { ev: "crashed"; gaveUp: boolean };

export interface TrackRef {
  id: string;
  src: string; // absolute file path or https URL
  title: string;
  artist: string;
  album: string;
  art?: string; // local cover image for Now Playing
}

export type EngineCommand =
  | ({ cmd: "load"; pos?: number; paused?: boolean } & TrackRef)
  | ({ cmd: "setNext"; after: string } & Partial<TrackRef>)
  | { cmd: "play" | "pause" | "toggle" | "stop" | "quit" }
  | { cmd: "seek" | "seekBy"; sec: number }
  | { cmd: "volume"; value: number }
  | { cmd: "art"; id: string; path: string };

export class Engine {
  private proc?: Subprocess<"pipe", "pipe", "ignore">;
  private crashes: number[] = [];
  private quitting = false;

  constructor(private onEvent: (e: EngineEvent) => void) {}

  start(): void {
    const proc = Bun.spawn([HELPER_BIN], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    this.proc = proc;
    this.readLoop(proc);
    proc.exited.then(() => {
      if (this.quitting || this.proc !== proc) return;
      const now = Date.now();
      this.crashes = this.crashes.filter((t) => now - t < 60_000).concat(now);
      const gaveUp = this.crashes.length > 3;
      log("engine exited", { gaveUp });
      this.onEvent({ ev: "crashed", gaveUp });
      if (!gaveUp) this.start();
    });
  }

  private async readLoop(proc: Subprocess<"pipe", "pipe", "ignore">): Promise<void> {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stdout) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const e = JSON.parse(line) as EngineEvent;
          if (e.ev !== "time") log("engine →", e);
          this.onEvent(e);
        } catch {}
      }
    }
  }

  send(c: EngineCommand): void {
    if (!this.proc) return;
    if (c.cmd !== "seekBy") log("engine ←", c.cmd, "id" in c ? c.id : "");
    try {
      this.proc.stdin.write(JSON.stringify(c) + "\n");
      this.proc.stdin.flush();
    } catch {}
  }

  quit(): void {
    this.quitting = true;
    this.send({ cmd: "quit" });
    try {
      this.proc?.stdin.end();
    } catch {}
    setTimeout(() => this.proc?.kill(), 300).unref();
  }
}
