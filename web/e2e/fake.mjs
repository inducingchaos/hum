// Test helpers shared by smoke.mjs and shots.mjs: MP3 fixtures, a fake Dropbox
// (routes on a Playwright context), the preview server and the browser.
import { Mp3Encoder } from "@breezystack/lamejs";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { zipSync } from "fflate";
import { chromium } from "playwright-core";

// A made-up library layout; the app learns it from this profile.
export const PROFILE = {
  label: "Test Library",
  root: "/lib",
  tracks: "audio",
  metadata: "meta",
  dimensions: ["time", "colour", "shade"],
  order: ["dawn", "noon", "dusk", "night", "light", "mid", "dark"],
  variant: { dimension: 2, prefer: "mid", fallback: ["light", "dark"] },
};
export const TRACKS = "/lib/audio";
export const META = "/lib/meta";

export function mp3(seconds, hz) {
  const rate = 44100;
  const enc = new Mp3Encoder(1, rate, 64);
  const pcm = new Int16Array(rate * seconds);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 2000);
  const parts = [];
  for (let i = 0; i < pcm.length; i += 1152) parts.push(Buffer.from(enc.encodeBuffer(pcm.subarray(i, i + 1152))));
  parts.push(Buffer.from(enc.flush()));
  // ID3v2 header (10 bytes + 300 bytes of padding) and an ID3v1 tag, like real files.
  const id3v2 = Buffer.alloc(310);
  id3v2.write("ID3", 0);
  id3v2[3] = 3;
  id3v2[9] = 300; // syncsafe size
  const id3v1 = Buffer.alloc(128);
  id3v1.write("TAG", 0);
  return Buffer.concat([id3v2, ...parts, id3v1]);
}

// songs: [time, colour, shade, name, id, hz, imageUrl?]. `metaName` lets tests tell phase 1 (file names) from phase 2.
export function makeLibrary(songs, { seconds = 4, duration = seconds, metaName = (n) => n } = {}) {
  const audio = {};
  const stem = (s) => `${s[3].toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${s[4]}`;
  const pathOf = (s) => `${TRACKS}/${s[0]}/${s[1]}/${s[2]}/${stem(s)}.mp3`;
  for (const s of songs) audio[s[4]] = mp3(seconds, s[5] ?? 440);
  const entries = [
    ...songs.map((s) => ({ ".tag": "file", name: `${stem(s)}.mp3`, path_lower: pathOf(s), size: audio[s[4]].length })),
    ...songs.map((s) => ({ ".tag": "file", name: `${stem(s)}.json`, path_lower: `${META}/${stem(s)}.json`, size: 100 })),
  ];
  const zip = Buffer.from(zipSync(Object.fromEntries(songs.map((s) => [
    `metadata/${stem(s)}.json`,
    new TextEncoder().encode(JSON.stringify({ name: metaName(s[3]), duration, tags: ["test"], imageUrl: s[6] })),
  ]))));
  return { songs, audio, entries, zip, pathOf };
}

export async function fakeDropbox(ctx, lib, opts = { zipDelay: 0 }) {
  const calls = [];
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Range" };
  await ctx.route("https://www.dropbox.com/**", (r) => r.fulfill({ body: "<p>Dropbox (fake): code is abc</p>", contentType: "text/html" }));
  await ctx.route("https://api.dropboxapi.com/**", async (r) => {
    const ep = new URL(r.request().url()).pathname.replace(/^\/2\//, "");
    calls.push(ep);
    if (ep === "/oauth2/token") return r.fulfill({ json: { access_token: "AT", expires_in: 14400, refresh_token: "RT" }, headers: cors });
    if (ep === "users/get_current_account") return r.fulfill({ json: { name: { display_name: "Test Owner" } }, headers: cors });
    if (ep === "files/list_folder") return r.fulfill({ json: { entries: lib.entries, cursor: "c1", has_more: false }, headers: cors });
    if (ep === "files/list_folder/continue") return r.fulfill({ json: { entries: [], cursor: "c1", has_more: false }, headers: cors });
    if (ep === "files/get_temporary_link") {
      const { path } = JSON.parse(r.request().postData());
      return r.fulfill({ json: { link: `https://uc1.dl.dropboxusercontent.com/t${path}` }, headers: cors });
    }
    return r.fulfill({ status: 400, body: `unexpected ${ep}` });
  });
  await ctx.route("https://content.dropboxapi.com/**", async (r) => {
    const ep = new URL(r.request().url()).pathname.replace(/^\/2\//, "");
    calls.push(ep);
    if (ep === "files/download_zip") {
      await new Promise((res) => setTimeout(res, opts.zipDelay ?? 0));
      return r.fulfill({ body: lib.zip, contentType: "application/zip", headers: cors });
    }
    if (ep === "files/download") {
      const { path } = JSON.parse(r.request().headers()["dropbox-api-arg"]);
      const s = lib.songs.find((x) => lib.pathOf(x) === path);
      if (!s) return r.fulfill({ status: 409, body: "not_found", headers: cors });
      const body = lib.audio[s[4]];
      const m = /bytes=(\d+)-(\d*)/.exec(r.request().headers()["range"] ?? "");
      if (m) {
        const a = +m[1];
        const b = m[2] ? +m[2] : body.length - 1;
        return r.fulfill({
          status: 206,
          body: body.subarray(a, b + 1),
          contentType: "application/octet-stream",
          headers: { ...cors, "Content-Range": `bytes ${a}-${b}/${body.length}` },
        });
      }
      return r.fulfill({ body, contentType: "application/octet-stream", headers: cors });
    }
    return r.fulfill({ status: 400, body: `unexpected ${ep}` });
  });
  await ctx.route("https://*.dl.dropboxusercontent.com/**", (r) => {
    const s = lib.songs.find((x) => r.request().url().endsWith(lib.pathOf(x)));
    return r.fulfill({ body: s ? lib.audio[s[4]] : Buffer.alloc(0), contentType: "audio/mpeg" });
  });
  await ctx.route("https://img.example/**", (r) => r.fulfill({ status: 404 }));
  return calls;
}

// `vite preview` of the build unless HUM_URL points somewhere else (e.g. the live deploy).
export async function serve(port) {
  if (process.env.HUM_URL) return { base: process.env.HUM_URL.replace(/\/$/, ""), stop() {} };
  const server = spawn("pnpm", ["exec", "vite", "preview", "--port", String(port), "--strictPort"], { stdio: "ignore" });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(base);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return { base, stop: () => server.kill() };
}

export function launch() {
  const executablePath = process.env.CHROMIUM_PATH ?? ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);
  return chromium.launch({
    executablePath,
    channel: executablePath ? undefined : "chrome",
    args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"],
  });
}

// Sign in with the code flow; returns once the player is up.
export async function signIn(ctx, page, base) {
  await page.goto(base);
  await page.getByPlaceholder("Profile").fill(JSON.stringify(PROFILE));
  await page.getByText("Use profile").click();
  await page.getByText("Sign in with Dropbox").waitFor();
  const popup = ctx.waitForEvent("page");
  await page.getByText("Or sign in with a code").click();
  await (await popup).close();
  await page.getByPlaceholder("Code").fill("abc");
  await page.getByText("Connect", { exact: true }).click();
}
