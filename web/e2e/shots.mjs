// Screenshots of every screen with a realistic library, for design review.
//   pnpm --filter web shots      (writes e2e/shots/*.png; HUM_URL=… for a deploy)
import { mkdirSync } from "node:fs";
import { fakeDropbox, launch, makeLibrary, serve, signIn } from "./fake.mjs";

// Invented names in a made-up layout (see PROFILE in fake.mjs).
const names = {
  "dawn/azure": ["Harbour Lights", "Paper Kites", "Quiet Engine", "Long Division", "Salt and Glass", "Northbound"],
  "dawn/crimson": ["Copper Field", "Slow Parade", "Lantern Room"],
  "dawn/jade": ["Morning Ledger", "Tin Roof", "Small Hours"],
  "dawn/indigo": ["Open Water", "Wide Margin", "Low Tide Study"],
  "dawn/grey": ["Signal Path", "Glass Tower", "Cold Start"],
  "noon/ochre": ["River Stones", "Warm Static", "Garden Wall"],
  "noon/grey": ["Soft Circuit", "Satellite Hum"],
  "dusk/azure": ["Still Point", "Deep Current"],
  "night/ochre": ["Oak Shelter", "Late Ember", "Far Shore", "First Snow"],
  "night/azure": ["Cloud Harbour"],
};
const shades = ["light", "mid", "dark"];
const songs = [];
let n = 0;
for (const [folder, list] of Object.entries(names)) {
  const [time, colour] = folder.split("/");
  for (const name of list) songs.push([time, colour, shades[n % 3], name, `id${n++}`, 220 + n * 10]);
}
const lib = makeLibrary(songs, { seconds: 2, duration: 1800 });

mkdirSync("e2e/shots", { recursive: true });
const server = await serve(4180);
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 });
  await fakeDropbox(ctx, lib);
  const page = await ctx.newPage();
  await page.goto(server.base);
  await page.getByPlaceholder("Profile").waitFor();
  await page.screenshot({ path: "e2e/shots/1-signin.png" });
  await signIn(ctx, page, server.base);
  await page.locator(".title").waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "e2e/shots/2-now.png" });
  await page.locator(".filter").click();
  await page.locator(".editor input").fill("dawn azure indigo");
  await page.screenshot({ path: "e2e/shots/3-filter.png" });
  await page.locator(".editor .primary").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "e2e/shots/4-now-playing.png" });
  await page.getByText("Queue", { exact: true }).click();
  await page.screenshot({ path: "e2e/shots/5-queue.png" });
  await page.getByText("Sys", { exact: true }).click();
  await page.screenshot({ path: "e2e/shots/6-sys.png" });
} finally {
  await browser.close();
  server.stop();
}
console.log("wrote e2e/shots/");
