// Audio engines (plan-web §7). The player owns the queue; an engine only plays
// "this track now" and "that one after it", and reports back.
import type { Track } from "@hum/core/model";

export interface EngineEvents {
  // Playback moved into the next track on its own (the one given to setNext).
  boundary(id: string): void;
  // The last track finished and nothing was queued after it.
  ended(): void;
  // Time moved (seconds into the current track).
  time(pos: number): void;
  // The current track can't be played.
  failed(msg: string): void;
  // How the current track is being fed: from the phone or streamed.
  source(kind: "cache" | "stream"): void;
}

export interface Engine {
  readonly name: "stream" | "element";
  // Play `t` from `at` seconds (autoplay) or cue it paused there.
  load(t: Track, at: number, autoplay: boolean): Promise<void>;
  // What follows the current track (the same track for repeat-one), or nothing.
  setNext(t: Track | undefined): void;
  play(): void;
  pause(): void;
  readonly paused: boolean;
  // Seconds into the current track.
  seek(sec: number): void;
  position(): number;
}
