// hum: screens and boot (plan-web §10). Dark, monospace, no animations.
import { signal } from "@preact/signals";
import { initCache } from "./cache.ts";
import { kv } from "./db.ts";
import { AuthError, finishSignIn, type Auth } from "./dropbox.ts";
import { deltaSync, fillMetadata, listTracks, loadLibrary, needsMetadata } from "./library.ts";
import { loadLog, log } from "./log.ts";
import { start, updateLibrary } from "./player.ts";
import { loadProfile, profileSig } from "./profile.ts";
import { NowView, Transport } from "./ui/now.tsx";
import { QueueView } from "./ui/queue.tsx";
import { SignIn } from "./ui/signin.tsx";
import { SysView } from "./ui/sys.tsx";

type Phase = "boot" | "signedOut" | "syncing" | "ready";
type Tab = "now" | "queue" | "sys";

const phase = signal<Phase>("boot");
const syncMsg = signal("");
const tab = signal<Tab>("now");
export const account = signal<string | undefined>(undefined);
export const syncStatus = signal(""); // background work, shown in the header
export const bootError = signal("");

export async function boot(): Promise<void> {
  await loadLog();
  log(`boot · ${matchMedia("(display-mode: standalone)").matches ? "installed app" : "browser tab"} · ${navigator.userAgent.match(/OS [\d_]+/)?.[0] ?? ""}`);
  try {
    const url = new URL(location.href);
    if (url.pathname === "/auth") {
      history.replaceState(null, "", "/");
      const code = url.searchParams.get("code");
      if (code) await finishSignIn(code, url.searchParams.get("state") ?? undefined);
      else if (url.searchParams.get("error")) bootError.value = url.searchParams.get("error_description") ?? "sign-in cancelled";
    }
  } catch (e) {
    bootError.value = (e as Error).message;
  }
  const auth = await kv.get<Auth>("auth");
  const prof = await loadProfile();
  if (!auth || !prof) {
    phase.value = "signedOut";
    return;
  }
  account.value = auth.account;
  await openLibrary();
}

export async function openLibrary(): Promise<void> {
  try {
    await initCache();
    let lib = await loadLibrary();
    const stored = !!lib;
    if (!lib) {
      phase.value = "syncing";
      lib = await withElapsed((m) => (syncMsg.value = m), (report) => listTracks(report));
    }
    await start(lib);
    phase.value = "ready";
    if (needsMetadata(lib)) {
      const full = await withElapsed((m) => (syncStatus.value = m), (report) => fillMetadata(lib!, report));
      syncStatus.value = "";
      updateLibrary(full, true);
    } else if (stored) {
      deltaSync(lib).then((next) => next && updateLibrary(next), (e) => log(`delta sync failed: ${(e as Error).message}`));
    }
  } catch (e) {
    syncStatus.value = "";
    if (e instanceof AuthError) {
      bootError.value = "Dropbox sign-in expired. Sign in again.";
      phase.value = "signedOut";
    } else {
      const msg = `SYNC FAILED: ${(e as Error).message}`;
      if (phase.value === "ready") syncStatus.value = msg;
      else syncMsg.value = msg;
      log(msg);
    }
  }
}

// Runs a slow step, showing its latest message plus a seconds counter, so a
// long wait never looks frozen.
async function withElapsed<T>(show: (m: string) => void, fn: (report: (m: string) => void) => Promise<T>): Promise<T> {
  const t0 = Date.now();
  let msg = "";
  const render = () => show(`${msg} · ${Math.floor((Date.now() - t0) / 1000)} s`);
  const timer = setInterval(render, 1000);
  try {
    return await fn((m) => {
      msg = m;
      render();
    });
  } finally {
    clearInterval(timer);
  }
}

export const signedOut = () => {
  phase.value = "signedOut";
  tab.value = "now";
};

export function App() {
  if (phase.value === "boot") return <div class="screen" />;
  if (phase.value === "signedOut") return <SignIn />;
  if (phase.value === "syncing")
    return (
      <div class="screen">
        <Header />
        <div class="center dim">{syncMsg.value || "SYNCING"}</div>
      </div>
    );
  return (
    <div class="screen">
      <Header />
      <main class="main">{tab.value === "now" ? <NowView /> : tab.value === "queue" ? <QueueView /> : <SysView />}</main>
      <Transport />
      <nav class="tabs">
        {(["now", "queue", "sys"] as const).map((t) => (
          <button class={tab.value === t ? "on" : ""} onClick={() => (tab.value = t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
    </div>
  );
}

export function Header() {
  return (
    <header class="header">
      <span class="brand">hum</span>
      {profileSig.value && profileSig.value.label !== "hum" && <span class="dim">{profileSig.value.label}</span>}
      {syncStatus.value && <span class="status">{syncStatus.value}</span>}
    </header>
  );
}
