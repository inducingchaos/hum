// Read-only Dropbox client for the browser (plan-web §6, §14). Same rules as the
// CLI's src/dropbox/client.ts: an endpoint allowlist on top of a token that only
// has files.metadata.read + files.content.read. The refresh token lives in
// IndexedDB on this device and is never logged.
import { APP_KEY } from "@hum/core/profile";
import { kv } from "./db.ts";

const RPC_ENDPOINTS = new Set([
  "files/list_folder",
  "files/list_folder/continue",
  "files/get_temporary_link",
  "users/get_current_account",
]);
const CONTENT_ENDPOINTS = new Set(["files/download", "files/download_zip"]);

export class AuthError extends Error {}
export class NetworkError extends Error {}

export interface Auth {
  refresh_token: string;
  account?: string;
}

// ── PKCE ─────────────────────────────────────────────────────────────────────

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function makeVerifier(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(48)));
}

export async function challengeOf(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export const redirectUri = () => `${location.origin}/auth`;

interface Pending {
  verifier: string;
  state: string;
  redirect: boolean; // false = the owner pastes the code (no redirect_uri)
}

// Two ways in. Redirect: Dropbox sends the browser back to /auth?code=…
// Code: Dropbox shows a code to paste, which works even if iOS finishes the
// login in a separate browser view whose storage the installed app can't see.
export async function authorizeUrl(redirect: boolean): Promise<string> {
  const p: Pending = { verifier: makeVerifier(), state: makeVerifier().slice(0, 16), redirect };
  await kv.set("pkce", p);
  const u = new URL("https://www.dropbox.com/oauth2/authorize");
  const params: Record<string, string> = {
    client_id: APP_KEY,
    response_type: "code",
    code_challenge: await challengeOf(p.verifier),
    code_challenge_method: "S256",
    token_access_type: "offline",
  };
  if (redirect) Object.assign(params, { redirect_uri: redirectUri(), state: p.state });
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

export async function finishSignIn(code: string, state?: string): Promise<Auth> {
  const p = await kv.get<Pending>("pkce");
  if (!p) throw new AuthError("sign-in expired: start again");
  if (p.redirect && state !== p.state) throw new AuthError("sign-in state mismatch: start again");
  const t = await oauthToken({
    grant_type: "authorization_code",
    code: code.trim(),
    code_verifier: p.verifier,
    ...(p.redirect ? { redirect_uri: redirectUri() } : {}),
  });
  const auth: Auth = { refresh_token: t.refresh_token };
  await kv.set("auth", auth);
  await kv.del("pkce");
  cached = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
  try {
    const me = await rpc<{ name: { display_name: string } }>("users/get_current_account");
    auth.account = me.name.display_name;
    await kv.set("auth", auth);
  } catch {
    /* the name is cosmetic */
  }
  return auth;
}

export async function signOut(): Promise<void> {
  cached = undefined;
  links.clear();
  await kv.del("auth");
}

// ── Tokens ───────────────────────────────────────────────────────────────────

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new NetworkError((e as Error).message);
  }
}

async function oauthToken(params: Record<string, string>): Promise<any> {
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
      const auth = await kv.get<Auth>("auth");
      if (!auth) throw new AuthError("signed out");
      const t = await oauthToken({ grant_type: "refresh_token", refresh_token: auth.refresh_token });
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

// ── Endpoints ────────────────────────────────────────────────────────────────

export async function rpc<T = any>(endpoint: string, args?: unknown, signal?: AbortSignal): Promise<T> {
  if (!RPC_ENDPOINTS.has(endpoint)) throw new Error(`blocked non-read-only endpoint: ${endpoint}`);
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
export function apiArg(obj: unknown): string {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

async function content(endpoint: string, path: string, signal?: AbortSignal, range?: string): Promise<Response> {
  if (!CONTENT_ENDPOINTS.has(endpoint)) throw new Error(`blocked non-read-only endpoint: ${endpoint}`);
  const res = await request(`https://content.dropboxapi.com/2/${endpoint}`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Dropbox-API-Arg": apiArg({ path }),
      ...(range ? { Range: range } : {}),
    },
  });
  return check(res, endpoint);
}

// `range` like "bytes=1000-". Dropbox answers 206; callers also handle a plain 200.
export const download = (path: string, signal?: AbortSignal, range?: string) => content("files/download", path, signal, range);
export const downloadZip = (path: string, signal?: AbortSignal) => content("files/download_zip", path, signal);

// Temp links last 4 h; reuse them for 3.5 h.
const links = new Map<string, { url: string; expiresAt: number }>();
export async function temporaryLink(path: string, fresh = false): Promise<string> {
  const hit = links.get(path);
  if (!fresh && hit && hit.expiresAt > Date.now()) return hit.url;
  const { link } = await rpc<{ link: string }>("files/get_temporary_link", { path });
  links.set(path, { url: link, expiresAt: Date.now() + 3.5 * 3600_000 });
  return link;
}

export interface ListEntry {
  ".tag": "file" | "folder" | "deleted";
  name: string;
  path_lower: string;
  size?: number;
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
