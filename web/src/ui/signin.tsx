// Signed-out screen. Two ways in (see dropbox.ts): redirect, or paste a code.
import { signal } from "@preact/signals";
import { account, bootError, Header, openLibrary } from "../app.tsx";
import { kv } from "../db.ts";
import { authorizeUrl, finishSignIn } from "../dropbox.ts";
import { profileSig, saveProfile } from "../profile.ts";

const codeMode = signal(false);
const code = signal("");
const busy = signal(false);
const profileText = signal("");

// Step 1 (once per device): the library profile, pasted as JSON (docs/profile.md).
async function useProfile() {
  bootError.value = "";
  try {
    await saveProfile(profileText.value);
    profileText.value = "";
    // Already signed in (e.g. the profile was cleared): go straight to the library.
    if (await kv.get("auth")) await openLibrary();
  } catch (e) {
    bootError.value = (e as Error).message;
  }
}

async function redirect() {
  location.href = await authorizeUrl(true);
}

async function withCode() {
  codeMode.value = true;
  open(await authorizeUrl(false), "_blank");
}

async function connect() {
  busy.value = true;
  bootError.value = "";
  try {
    const auth = await finishSignIn(code.value);
    account.value = auth.account;
    code.value = "";
    codeMode.value = false;
    await openLibrary();
  } catch (e) {
    bootError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

export function SignIn() {
  return (
    <div class="screen">
      <Header />
      <div class="signin">
        <p>Your music library, from your Dropbox.</p>
        <p class="dim">Read-only. The sign-in stays on this phone.</p>
        {bootError.value && <p class="err">{bootError.value}</p>}
        {!profileSig.value && (
          <div class="code">
            <p class="dim">First, paste your library profile (JSON).</p>
            <textarea
              class="profile"
              value={profileText.value}
              onInput={(e) => (profileText.value = (e.target as HTMLTextAreaElement).value)}
              placeholder="Profile"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              rows={6}
            />
            <button class="big" disabled={!profileText.value.trim()} onClick={useProfile}>
              Use profile
            </button>
          </div>
        )}
        {profileSig.value && (
          <>
            <button class="big" onClick={redirect}>
              Sign in with Dropbox
            </button>
            <button class="link" onClick={withCode}>
              Or sign in with a code
            </button>
          </>
        )}
        {profileSig.value && codeMode.value && (
          <div class="code">
            <p class="dim">Allow access, copy the code Dropbox shows, paste it here.</p>
            <input
              value={code.value}
              onInput={(e) => (code.value = (e.target as HTMLInputElement).value)}
              placeholder="Code"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
            />
            <button class="big" disabled={busy.value || !code.value.trim()} onClick={connect}>
              {busy.value ? "Connecting" : "Connect"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
