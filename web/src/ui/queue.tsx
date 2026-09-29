// Full upcoming queue. Tap a row to jump there.
import { cachedIds, downloading } from "../cache.ts";
import * as p from "../player.ts";

const MAX_ROWS = 300;

export function QueueView() {
  p.queueVersion.value;
  const cached = cachedIds.value;
  const dl = downloading.value;
  const start = p.queue.cursor;
  const ids = p.queue.order.slice(start, start + MAX_ROWS);
  return (
    <div class="list">
      <div class="sect">
        {p.queue.order.length.toLocaleString()} in queue · {p.queue.shuffle ? "shuffled" : "in order"}
      </div>
      {ids.map((id, i) => {
        const t = p.track(id);
        if (!t) return null;
        const mk = i === 0 ? "▶\uFE0E" : cached.has(id) ? "●" : dl?.id === id ? "◐" : "○";
        const mkCls = i > 0 && cached.has(id) ? "mk cached" : "mk";
        return (
          <button class={i === 0 ? "lrow nowrow" : "lrow"} onClick={() => i && p.jumpTo(start + i)}>
            <span class={mkCls}>{mk}</span>
            <span class="nm">{t.name}</span>
            <span class="pth">{t.dims.slice(1).join(" / ")}</span>
          </button>
        );
      })}
    </div>
  );
}
