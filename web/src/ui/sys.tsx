// System: account, cache, build, and the spike's event log (plan-web §17 W0).
import { fmtBytes } from "@hum/core/format";
import { signal } from "@preact/signals";
import { account, signedOut } from "../app.tsx";
import { CAP_BYTES, cacheBytes, cachedIds, clearCache, downloading } from "../cache.ts";
import { kv } from "../db.ts";
import { signOut } from "../dropbox.ts";
import { clearLog, fmtClock, logLines } from "../log.ts";
import * as p from "../player.ts";
import { profileSig } from "../profile.ts";

const copied = signal(false);

async function copyLog() {
  const text = logLines.value.map((l) => `${fmtClock(l.t)}${l.hidden ? " [bg]" : ""} ${l.msg}`).join("\n");
  try {
    await navigator.clipboard.writeText(`hum ${__BUILD__}\n${text}`);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {}
}

async function doSignOut() {
  if (!confirm("Sign out? This removes the library, its profile and cached tracks from this phone.")) return;
  p.pause();
  await clearCache();
  await signOut();
  await kv.clear();
  profileSig.value = undefined;
  signedOut();
}

export function SysView() {
  const dl = downloading.value;
  return (
    <div class="list sys">
      <div class="kvrow"><span>Account</span><span>{account.value ?? "signed in"}</span></div>
      <div class="kvrow">
        <span>Cache</span>
        <span>{cachedIds.value.size} tracks · {fmtBytes(cacheBytes.value)} / {fmtBytes(CAP_BYTES)}</span>
      </div>
      <div class="kvrow"><span>Downloading</span><span>{dl ? `${p.track(dl.id)?.name ?? dl.id} ${dl.pct}%` : "—"}</span></div>
      <div class="kvrow"><span>Source</span><span>{p.sourceKind.value ?? "—"}</span></div>
      <div class="kvrow"><span>Build</span><span>{__BUILD__}</span></div>
      <div class="kvrow"><span>Engine</span><span>{p.engineName.value}</span></div>
      <div class="btnrow">
        {(["auto", "stream", "element"] as const).map((c) => (
          <button class={p.engineChoice.value === c ? "on" : ""} onClick={() => p.engineChoice.value !== c && p.setEngineChoice(c)}>
            {c[0]!.toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>
      <div class="btnrow">
        <button onClick={copyLog}>{copied.value ? "Copied" : "Copy log"}</button>
        <button onClick={clearLog}>Clear log</button>
      </div>
      <div class="btnrow">
        <button onClick={() => confirm("Delete all cached tracks?") && clearCache()}>Clear cache</button>
        <button onClick={doSignOut}>Sign out</button>
      </div>
      <div class="loghead">Log · newest first · [bg] = locked or in the background</div>
      <div class="log">
        {logLines.value.slice().reverse().map((l) => (
          <div class={l.hidden ? "bg" : ""}>
            <span class="dim">{fmtClock(l.t)}</span>{l.hidden ? " [bg]" : ""} {l.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
