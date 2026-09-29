// Usage: pnpm auth start | finish <code> | check
import { createHash, randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { APP_KEY, paths } from "../config.ts";
import { oauthToken, rpc, saveToken } from "../dropbox/client.ts";
import { readJson, writeJsonAtomic } from "../util.ts";

const [cmd, code] = process.argv.slice(2);

if (cmd === "start") {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  writeJsonAtomic(paths.pkce, { verifier }, 0o600);
  const url = new URL("https://www.dropbox.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: APP_KEY,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
  }).toString();
  console.log(`open this, click Allow, then run: pnpm auth finish <code>\n\n${url}`);
} else if (cmd === "finish" && code) {
  const { verifier } = readJson<{ verifier: string }>(paths.pkce);
  const t = await oauthToken({ grant_type: "authorization_code", code: code.trim(), code_verifier: verifier });
  saveToken({ refresh_token: t.refresh_token, account_id: t.account_id, scope: t.scope });
  rmSync(paths.pkce, { force: true });
  console.log(`saved refresh token. scopes: ${t.scope}`);
} else if (cmd === "check") {
  const me = await rpc("users/get_current_account");
  console.log(`connected as ${me.name.display_name}`);
} else {
  console.error("usage: pnpm auth start | finish <code> | check");
  process.exit(1);
}
