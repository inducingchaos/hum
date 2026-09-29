// Read-only Dropbox client. The allowlist enforces the repo's read-only rule in code,
// on top of the token only having files.metadata.read + files.content.read.
import { existsSync } from "node:fs";
import { APP_KEY, paths } from "../config.ts";
import { readJson, writeJsonAtomic } from "../util.ts";

const READ_ONLY_ENDPOINTS = new Set([
  "files/list_folder",
  "files/list_folder/continue",
  "files/get_metadata",
  "files/get_temporary_link",
  "users/get_current_account",
]);

export class AuthError extends Error {}
export class NetworkError extends Error {}

export interface TokenFile {
  refresh_token: string;
  account_id?: string;
  scope?: string;
}

export function hasToken(): boolean {
  return existsSync(paths.token);
}

export function saveToken(t: TokenFile): void {
  writeJsonAtomic(paths.token, t, 0o600);
}

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new NetworkError((e as Error).message);
  }
}

export async function oauthToken(params: Record<string, string>): Promise<any> {
  const res = await request("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: APP_KEY, ...params }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (res.status === 400 || res.status === 401) throw new AuthError(body.error_description ?? body.error ?? "auth failed");
  if (!res.ok) throw new Error(`oauth ${res.status}`);
  return body;
}

let cached: { token: string; expiresAt: number } | undefined;
let inflight: Promise<string> | undefined;

export function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return Promise.resolve(cached.token);
  inflight ??= (async () => {
    try {
      const { refresh_token } = readJson<TokenFile>(paths.token);
      const t = await oauthToken({ grant_type: "refresh_token", refresh_token });
      cached = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
      return cached.token;
    } finally {
      inflight = undefined;
    }
  })();
  return inflight;
}

async function check(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  if (res.status === 401) {
    cached = undefined;
    throw new AuthError(`${what} 401`);
  }
  const text = await res.text().catch(() => "");
  throw new Error(`${what} ${res.status}: ${text.slice(0, 200)}`);
}

export async function rpc<T = any>(endpoint: string, args?: unknown, signal?: AbortSignal): Promise<T> {
  if (!READ_ONLY_ENDPOINTS.has(endpoint)) throw new Error(`blocked non-read-only endpoint: ${endpoint}`);
  const res = await request(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(args === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: args === undefined ? undefined : JSON.stringify(args),
  });
  return (await check(res, endpoint)).json() as Promise<T>;
}

// Dropbox-API-Arg must be ASCII; escape everything else as \uXXXX.
function apiArg(obj: unknown): string {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

export async function download(path: string, signal?: AbortSignal): Promise<Response> {
  const res = await request("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Dropbox-API-Arg": apiArg({ path }) },
  });
  return check(res, "download");
}

// A folder as one zip (read-only, files.content.read). Used for the metadata
// folder on a fresh sync: one request instead of thousands.
export async function downloadZip(path: string, signal?: AbortSignal): Promise<Response> {
  const res = await request("https://content.dropboxapi.com/2/files/download_zip", {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Dropbox-API-Arg": apiArg({ path }) },
  });
  return check(res, "download_zip");
}

// Temp links last 4 h; reuse them for 3.5 h.
const links = new Map<string, { url: string; expiresAt: number }>();
export async function temporaryLink(path: string): Promise<string> {
  const hit = links.get(path);
  if (hit && hit.expiresAt > Date.now()) return hit.url;
  const { link } = await rpc<{ link: string }>("files/get_temporary_link", { path });
  links.set(path, { url: link, expiresAt: Date.now() + 3.5 * 3600_000 });
  return link;
}

export interface ListEntry {
  ".tag": "file" | "folder" | "deleted";
  name: string;
  path_lower: string;
  path_display: string;
  size?: number;
  content_hash?: string;
}

export async function listAll(
  start: { path: string } | { cursor: string },
  onPage?: (count: number) => void,
): Promise<{ entries: ListEntry[]; cursor: string }> {
  const entries: ListEntry[] = [];
  let page: any =
    "cursor" in start
      ? await rpc("files/list_folder/continue", { cursor: start.cursor })
      : await rpc("files/list_folder", { path: start.path, recursive: true, limit: 2000 });
  entries.push(...page.entries);
  onPage?.(entries.length);
  while (page.has_more) {
    page = await rpc("files/list_folder/continue", { cursor: page.cursor });
    entries.push(...page.entries);
    onPage?.(entries.length);
  }
  return { entries, cursor: page.cursor };
}
