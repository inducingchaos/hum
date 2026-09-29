// The library profile on this device (docs/profile.md). Pasted once on the
// sign-in screen and kept in IndexedDB; nothing library-specific is in the code.
import { parseProfile, type Profile } from "@hum/core/profile";
import { signal } from "@preact/signals";
import { kv } from "./db.ts";

export const profileSig = signal<Profile | undefined>(undefined);

export function profile(): Profile {
  if (!profileSig.value) throw new Error("no library profile");
  return profileSig.value;
}

export async function loadProfile(): Promise<Profile | undefined> {
  const raw = await kv.get<unknown>("profile");
  if (!raw) return undefined;
  try {
    profileSig.value = parseProfile(raw);
  } catch {
    return undefined;
  }
  return profileSig.value;
}

// Throws a readable error for bad JSON or a bad profile.
export async function saveProfile(text: string): Promise<Profile> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("profile: not valid JSON");
  }
  const p = parseProfile(json);
  await kv.set("profile", p);
  profileSig.value = p;
  return p;
}
