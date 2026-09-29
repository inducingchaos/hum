// Terminal default colors plus one ANSI accent (owner's answer 9a), so it follows the Ghostty theme.
import { settings } from "../config.ts";

const ACCENT: Record<string, number> = { red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36 };
const code = (n: number | string) => `\x1b[${n}m`;

export const RESET = code(0);
export const style = {
  accent: code(ACCENT[settings.accent] ?? 33),
  bold: code(1),
  dim: code(2),
  inverse: code(7),
  accentBold: code(`1;${ACCENT[settings.accent] ?? 33}`),
  none: "",
};
export type Style = keyof typeof style;
