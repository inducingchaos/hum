// Player view: the CLI's layout, styled like the owner's ALTERED editor (turn 14).
import { fmtTime, plural } from "@hum/core/format";
import { albumOf, type Track } from "@hum/core/model";
import { signal } from "@preact/signals";
import { cachedIds, downloading } from "../cache.ts";
import * as p from "../player.ts";

const editing = signal(false);
const draft = signal("");
const filterErr = signal("");
const scrub = signal<number | null>(null); // 0..1 while dragging

export function NowView() {
  p.queueVersion.value; // re-render on queue changes
  if (editing.value) return <FilterSheet />;
  const t = p.current.value;
  const dur = p.duration.value || t?.duration || 0;
  const frac = scrub.value ?? (dur ? p.position.value / dur : 0);
  const repeat = p.queue.repeat;
  return (
    <div class="now">
      <div class="hero">
        <div class="title">{t ? t.name : "—"}</div>
        <div class="dim">{t ? albumOf(t) : ""}</div>
      </div>

      <div class="progress">
        <div
          class="bar"
          onPointerDown={(e) => startScrub(e, dur)}
          onPointerMove={(e) => scrub.value !== null && (scrub.value = fracOf(e))}
          onPointerUp={() => endScrub(dur)}
          onPointerCancel={() => (scrub.value = null)}
        >
          <div class="fill" style={{ width: `${Math.min(100, frac * 100)}%` }} />
        </div>
        <div class="time">
          {fmtTime(scrub.value !== null ? scrub.value * dur : p.position.value)} / {fmtTime(dur)}
        </div>
      </div>

      <div class="status-row">
        <span class="state">
          {p.playing.value ? <><span class="dot">●</span> {p.buffering.value ? "Loading" : "Playing"}</> : "Paused"}
        </span>
        <button class={p.queue.shuffle ? "tog on" : "tog"} onClick={p.toggleShuffle}>Shuffle</button>
        <button class={repeat !== "off" ? "tog on" : "tog"} onClick={p.cycleRepeat}>
          {repeat === "one" ? "Repeat one" : "Repeat"}
        </button>
        <button class={p.dedupeOn.value ? "tog on" : "tog"} onClick={p.toggleDedupe}>Dedupe</button>
        <span class="count">
          {(p.queue.cursor + 1).toLocaleString()}/{p.queue.order.length.toLocaleString()}
        </span>
      </div>

      <button class="filter" onClick={openFilter}>
        <span class="dim">Filter</span>
        <span class="q">{p.filterText.value || "everything"}</span>
        <span class="dim grow" style={{ textAlign: "right" }}>{plural(p.poolSize.value, "song")}</span>
      </button>
      {p.notice.value && <div class="notice">{p.notice.value}</div>}

      <Rolling />
    </div>
  );
}

function fracOf(e: PointerEvent): number {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
}

function startScrub(e: PointerEvent, dur: number) {
  if (!dur) return;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  scrub.value = fracOf(e);
}

function endScrub(dur: number) {
  if (scrub.value === null) return;
  p.seek(scrub.value * dur);
  scrub.value = null;
}

function openFilter() {
  draft.value = p.filterText.value;
  filterErr.value = "";
  editing.value = true;
}

function apply() {
  const err = p.setFilter(draft.value);
  if (err) filterErr.value = err;
  else editing.value = false;
}

function toggleTerm(term: string) {
  const words = draft.value.split(/\s+/).filter(Boolean);
  draft.value = (words.includes(term) ? words.filter((w) => w !== term) : [...words, term]).join(" ");
  filterErr.value = "";
}

// Chips per dimension (turn 14: the second level was missing). Same dimension = either,
// different dimensions = all: dawn + azure + indigo.
function FilterSheet() {
  const words = new Set(draft.value.split(/\s+/).filter(Boolean));
  const avail = p.available(draft.value);
  const facets = p.facetValues();
  return (
    <div class="editor">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <span class="dim">Filter</span>
        <input
          value={draft.value}
          onInput={(e) => (draft.value = (e.target as HTMLInputElement).value)}
          placeholder="everything"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          enterkeyhint="go"
        />
        {words.size > 0 && (
          <button type="button" class="dim" onClick={() => (draft.value = "")}>
            Clear
          </button>
        )}
      </form>
      {p.DIMENSIONS.map((dim, i) => (
        <div class="facet">
          <div class="facet-name">{dim}</div>
          <div class="chips">
            {(facets[i] ?? []).map((v) => (
              <button class={words.has(v) ? "chip on" : avail[i]!.has(v) ? "chip" : "chip none"} onClick={() => toggleTerm(v)}>
                {v}
              </button>
            ))}
          </div>
        </div>
      ))}
      {filterErr.value && <div class="err">{filterErr.value}</div>}
      <div class="actions">
        <button onClick={() => (editing.value = false)}>Cancel</button>
        <button class="primary" onClick={apply}>Play</button>
      </div>
    </div>
  );
}

// Played / now / next as one list (the CLI's rolling list).
function Rolling() {
  const cur = p.queue.current;
  const played = p.historyIds().filter((id) => id !== cur).slice(-3);
  const next = p.queue.upcoming(24);
  const cached = cachedIds.value;
  const dl = downloading.value;
  const mark = (id: string) => (cached.has(id) ? "●" : dl?.id === id ? "◐" : "○");
  return (
    <div class="rolling">
      {played.length > 0 && <div class="sect">Played</div>}
      {played.map((id) => (
        <Row t={p.track(id)} mark="" cls="played" onTap={() => p.playId(id)} />
      ))}
      {cur && <Row t={p.track(cur)} mark={"▶\uFE0E"} cls="nowrow" />}
      {next.length > 0 && <div class="sect">Next</div>}
      {next.map((id) => (
        <Row t={p.track(id)} mark={mark(id)} markCls={cached.has(id) ? "cached" : ""} onTap={() => p.playId(id)} />
      ))}
    </div>
  );
}

function Row(o: { t: Track | undefined; mark: string; markCls?: string; cls?: string; onTap?: () => void }) {
  if (!o.t) return null;
  return (
    <button class={`lrow ${o.cls ?? ""}`} onClick={o.onTap}>
      <span class={`mk ${o.markCls ?? ""}`}>{o.mark}</span>
      <span class="nm">{o.t.name}</span>
      <span class="pth">{o.t.dims.slice(1).join(" / ")}</span>
    </button>
  );
}

export function Transport() {
  return (
    <div class="transport">
      <button onClick={p.prev} aria-label="previous">Prev</button>
      <button class="play" onClick={p.toggle} aria-label="play or pause">{p.playing.value ? "Pause" : "Play"}</button>
      <button onClick={p.next} aria-label="next">Next</button>
    </div>
  );
}
