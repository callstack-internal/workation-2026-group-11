// CallCost settings — currently just the Google API key.
//
// The key is persisted in chrome.storage.local (so it survives Chrome
// restarts) and mirrored into an in-memory variable. Future data-fetching
// code can read it synchronously via getGoogleApiKey() once loadSettings()
// has resolved on startup.

import { storageGet, storageSet } from "./storage";

const API_KEY_STORAGE_KEY = "callcost:googleApiKey";

// In-memory copy of the persisted Google API key.
let googleApiKey = "";

/** The current Google API key (empty string when unset). */
export function getGoogleApiKey(): string {
  return googleApiKey;
}

/** Whether a non-empty API key is currently configured. */
export function hasGoogleApiKey(): boolean {
  return googleApiKey.trim().length > 0;
}

/** Hydrate the in-memory settings from storage. Call once on startup. */
export async function loadSettings(): Promise<void> {
  googleApiKey = await storageGet<string>(API_KEY_STORAGE_KEY, "");
}

/** Persist the Google API key and update the in-memory copy. */
export async function setGoogleApiKey(value: string): Promise<void> {
  googleApiKey = value.trim();
  await storageSet(API_KEY_STORAGE_KEY, googleApiKey);
}
