// Raw stdin bytes → key names. Printable characters come through as themselves ("a", "?", " ").
export type Key =
  | "up" | "down" | "left" | "right" | "shift-left" | "shift-right"
  | "pageup" | "pagedown" | "home" | "end" | "delete"
  | "enter" | "esc" | "tab" | "shift-tab" | "backspace"
  | "ctrl-c" | "ctrl-d" | "ctrl-u" | "ctrl-w" | "ctrl-n" | "ctrl-p"
  | (string & {});

const SEQ: Record<string, Key> = {
  "[A": "up", "[B": "down", "[C": "right", "[D": "left",
  "OA": "up", "OB": "down", "OC": "right", "OD": "left",
  "[1;2C": "shift-right", "[1;2D": "shift-left", "[1;2A": "pageup", "[1;2B": "pagedown",
  "[5~": "pageup", "[6~": "pagedown",
  "[H": "home", "[F": "end", "OH": "home", "OF": "end", "[1~": "home", "[4~": "end", "[7~": "home", "[8~": "end",
  "[3~": "delete", "[Z": "shift-tab",
};

const CTRL: Record<number, Key> = {
  0x03: "ctrl-c", 0x04: "ctrl-d", 0x15: "ctrl-u", 0x17: "ctrl-w", 0x0e: "ctrl-n", 0x10: "ctrl-p",
  0x0d: "enter", 0x0a: "enter", 0x09: "tab", 0x7f: "backspace", 0x08: "backspace",
};

export function parseKeys(data: string): Key[] {
  const keys: Key[] = [];
  let i = 0;
  while (i < data.length) {
    const c = data[i]!;
    if (c === "\x1b") {
      // CSI / SS3: ESC [ params final, or ESC O final
      const m = /^\x1b(\[[0-9;]*[A-Za-z~]|O[A-Za-z])/.exec(data.slice(i));
      if (m) {
        const k = SEQ[m[1]!];
        if (k) keys.push(k);
        i += m[0].length;
        continue;
      }
      // A bare Esc. Whatever follows is its own key: fast typists send "Esc 3" in one chunk.
      keys.push("esc");
      i++;
      continue;
    }
    const code = c.charCodeAt(0);
    if (CTRL[code]) keys.push(CTRL[code]!);
    else if (code >= 0x20) {
      const cp = data.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      keys.push(ch);
      i += ch.length;
      continue;
    }
    i++;
  }
  return keys;
}
