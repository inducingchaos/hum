// Browser smoke test for hum with a fake Dropbox (plan-web §16). Serves the
// production build and drives it in Chromium: code sign-in, the two-phase
// first sync (plays before metadata arrives), both audio engines rolling from
// one track into the next on their own, prefetch, filter, resume after reload.
// Tracks are real MP3s (made with lamejs) wrapped in ID3v2/ID3v1 tags.
// Audio is muted. iOS-only behaviour (lock screen) is the owner's to check.
//
//   pnpm --filter web e2e        (builds first; HUM_URL=https://… tests a deploy)
// Browser: CHROMIUM_PATH, else the cloud container's Chromium, else installed Chrome.
import { fakeDropbox, launch, makeLibrary, serve, signIn } from "./fake.mjs";

const SECONDS = 4;
const lib = makeLibrary(
  [
    ["dawn", "grey", "dark", "Alpha Wave", "a1", 330],
    ["dawn", "jade", "light", "Bravo Keys", "b2", 440],
    ["noon", "ochre", "mid", "Charlie Rain", "c3", 550],
    ["night", "ochre", "light", "Delta Night", "d4", 660],
  ],
  { seconds: SECONDS, metaName: (n) => `${n} (Mix)` }, // names differ from file names, to see phase 2 land
);

const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? `  (${extra})` : ""}`);
};

const server = await serve(4179);
const browser = await launch();

// Press play/pause until the UI says what we want (no blind toggling).
async function setPlaying(page, on) {
  const isOn = async () => (await page.locator(".state").innerText()).includes("Playing");
  if ((await isOn()) !== on) await page.getByLabel("play or pause").click();
  await page.waitForFunction((want) => document.querySelector(".state")?.textContent?.includes("Playing") === want, on, { timeout: 5000 });
}

const title = (page) => page.locator(".title").innerText();
const logText = async (page) => {
  await page.getByText("Sys", { exact: true }).click();
  const t = await page.locator(".log").innerText();
  await page.getByText("Now", { exact: true }).click();
  return t;
};

// Play, then wait for the next track to start on its own. Returns the log.
async function rollsOver(page, label) {
  const first = await title(page);
  await page.getByLabel("play or pause").click();
  await page.locator(".state", { hasText: "Playing" }).waitFor({ timeout: 5000 });
  await page.waitForFunction((t) => document.querySelector(".title")?.textContent !== t, first, { timeout: (SECONDS + 6) * 1000 });
  const second = await title(page);
  check(`${label}: rolls into the next track`, second !== first, `${first} → ${second}`);
  await page.waitForTimeout(1200);
  const pos = await page.locator(".time").innerText();
  check(`${label}: clock restarts for the new track`, /^0:0[0-3] \/ 0:04/.test(pos), pos);
  await page.getByLabel("play or pause").click(); // pause
  return logText(page);
}

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const calls = await fakeDropbox(ctx, lib, { zipDelay: 2500 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(ctx, page, server.base);
  check("code sign-in", true);

  // Phase 1: the player is up from the listing alone, before the zip arrives.
  await page.locator(".title").waitFor({ timeout: 5000 });
  const early = await title(page);
  const header = await page.locator(".header").innerText();
  check("plays before metadata (listing only)", !/Mix/.test(early) && /metadata/i.test(header), `${early} · ${header.replace(/\n/g, " ")}`);
  // Phase 2: names from metadata.
  await page.waitForFunction(() => /Mix/.test(document.querySelector(".title")?.textContent ?? ""), null, { timeout: 8000 });
  check("metadata fills in", /Mix/.test(await title(page)) && !/metadata/i.test(await page.locator(".header").innerText()));
  await page.screenshot({ path: "e2e/now.png" });

  // Stream engine (Chromium has MediaSource with audio/mpeg, so auto picks it).
  const streamLog = await rollsOver(page, "stream engine");
  check("stream engine: in use", /stream support: MediaSource, audio\/mpeg yes/.test(streamLog));
  check("stream engine: gapless advance", /advance → .* \(stream, no gap\)/.test(streamLog));
  check("prefetch cached tracks", /cached /.test(streamLog));

  // Stress: queue changes while the next track is already appended, two
  // automatic changes in a row, NEXT mid-track. The NOW row must match the title.
  await page.getByLabel("play or pause").click();
  await page.waitForTimeout(1500);
  await page.getByText("Shuffle", { exact: true }).click();
  await page.getByText("Shuffle", { exact: true }).click();
  const seen = new Set([await title(page)]);
  const t0 = Date.now();
  while (seen.size < 3 && Date.now() - t0 < 14_000) {
    await page.waitForTimeout(250);
    seen.add(await title(page));
  }
  check("stream engine: two automatic changes after a queue change", seen.size >= 3, [...seen].join(" → "));
  const nowRow = await page.locator(".nowrow .nm").innerText();
  check("stream engine: NOW row matches title", nowRow === (await title(page)), `${nowRow} / ${await title(page)}`);
  const beforeNext = await title(page);
  await page.getByLabel("next").click();
  await page.waitForFunction((t) => document.querySelector(".title")?.textContent !== t, beforeNext, { timeout: 3000 });
  await page.waitForTimeout(1200);
  const tNext = await page.locator(".time").innerText();
  check("stream engine: NEXT mid-track plays the next one", /^0:0[0-2]/.test(tNext) && (await page.locator(".state", { hasText: "Playing" }).count()) > 0, tNext);

  // Lock-screen pause (turn 14): while hidden, pause mutes and keeps playing;
  // play jumps back to where it was paused and unmutes.
  const setHidden = (hidden) =>
    page.evaluate((h) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await setHidden(true);
  await page.getByLabel("play or pause").click(); // pause while "locked"
  await page.waitForTimeout(300);
  const pausedAt = await page.locator(".time").innerText();
  const soft = await page.evaluate(() => {
    const a = document.querySelector("audio");
    return { muted: a.muted, paused: a.paused };
  });
  check("locked pause: muted, element keeps playing", soft.muted && !soft.paused, JSON.stringify(soft));
  await page.waitForTimeout(1500);
  check("locked pause: clock stays put", (await page.locator(".time").innerText()) === pausedAt, pausedAt);
  await page.getByLabel("play or pause").click(); // play while "locked"
  await page.waitForFunction(() => !document.querySelector("audio").muted, null, { timeout: 3000 });
  await page.waitForTimeout(300);
  const resumed = await page.locator(".time").innerText();
  check("locked play: back at the paused point, unmuted", resumed.slice(0, 4) === pausedAt.slice(0, 4) || resumed.slice(0, 4) > pausedAt.slice(0, 4), `${pausedAt} → ${resumed}`);
  await page.getByLabel("play or pause").click(); // soft pause again
  await setHidden(false); // unlocking turns it into a real pause
  await page.waitForTimeout(500);
  const hard = await page.evaluate(() => {
    const a = document.querySelector("audio");
    return { muted: a.muted, paused: a.paused };
  });
  check("unlock: a muted pause becomes a real pause", !hard.muted && hard.paused, JSON.stringify(hard));

  // Seek inside the track.
  await page.locator(".bar").click({ position: { x: 150, y: 14 } });
  await page.waitForTimeout(400);
  const seekPos = await page.locator(".time").innerText();
  check("seek by tapping the bar", /^0:0[1-3] \//.test(seekPos), seekPos);

  // Filter
  await page.locator(".filter").click();
  await page.locator(".editor input").fill("night");
  await page.locator(".editor .primary").click();
  await page.waitForFunction(() => document.querySelector(".title")?.textContent?.startsWith("Delta Night"), null, { timeout: 5000 });
  check("filter night → Delta Night", true);
  await page.locator(".filter").click();
  await page.locator(".editor input").fill("dawn grey jade");
  const chipsOn = await page.locator(".chip.on").allInnerTexts();
  await page.locator(".editor .primary").click();
  await page.waitForTimeout(300);
  check("filter: two colours = either (dawn grey jade)", /2 songs/.test(await page.locator(".filter").innerText()) && chipsOn.length === 3, chipsOn.join(","));
  await page.locator(".filter").click();
  await page.locator(".editor input").fill("night");
  await page.locator(".editor .primary").click();
  await setPlaying(page, true); // a filter starts playing by itself
  await page.waitForTimeout(1500);
  await setPlaying(page, false); // pause mid-track
  await page.waitForTimeout(300);
  const before = await page.locator(".time").innerText();

  // Resume after reload: same track, same second.
  await page.reload();
  await page.locator(".title").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);
  const after = await page.locator(".time").innerText();
  check("resume: same track", (await title(page)).startsWith("Delta Night"));
  check("resume: same position", before.slice(0, 4) === after.slice(0, 4), `${before} → ${after}`);
  check("filter persisted", /night/.test(await page.locator(".filter").innerText()));
  await page.getByLabel("play or pause").click();
  await page.waitForTimeout(700);
  const playedFrom = await page.locator(".time").innerText();
  check("resume: plays from there, not 0:00", playedFrom.slice(0, 4) >= before.slice(0, 4) && !playedFrom.startsWith("0:00"), `${before} → ${playedFrom}`);
  await page.getByLabel("play or pause").click();

  // Element engine
  await page.locator(".filter").click();
  await page.locator(".editor input").fill("all");
  await page.locator(".editor .primary").click();
  await page.getByLabel("play or pause").click();
  await page.getByText("Sys", { exact: true }).click();
  await page.getByText("Element", { exact: true }).click();
  await page.locator(".title").waitFor({ timeout: 10_000 });
  const elLog = await rollsOver(page, "element engine");
  check("element engine: fast path", /engine setting: element/.test(elLog) && /fast path/.test(elLog));
  await page.screenshot({ path: "e2e/sys.png" });

  check("no page errors", errors.length === 0, errors.join(" | "));
  check("used range reads", calls.filter((c) => c === "files/download").length > 0);
} finally {
  await browser.close();
  server.stop();
}

const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
