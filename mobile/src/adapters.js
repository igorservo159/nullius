// The adapters behind the core's two driven ports, made in one place: the phone's SQLite file
// (expo-sqlite) behind `Database`, and its keystore (expo-secure-store) behind `SecretStore`. No
// other file of the app imports either library: screens get both from `useAdapters()`.

import { createContext, useContext } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { BiometricRefused, keyPrefix } from '@nullius/core/accounts';
import { migrate } from '@nullius/core/database';

// A name under `keyPrefix` holds a private key, written and read only after a strong biometric
// check (fingerprint or face). Every other name — the index of labels and addresses, for one —
// is read without asking for anything.
function optionsFor(name) {
  if (!name.startsWith(keyPrefix)) return {};
  return { requireAuthentication: true, authenticationPrompt: 'Confirm to use the key' };
}

// expo-secure-store's code for a biometric prompt that did not end in a match: cancelled,
// locked out after too many attempts, or timed out. The same on reading and on writing a key.
const NO_BIOMETRIC_MATCH = 'ERR_AUTHENTICATION';

// The keystore's own error for that prompt becomes `BiometricRefused`, so no screen needs to know
// expo-secure-store's codes; any other error goes up as it came.
function asBiometricRefused(error) {
  throw error?.code === NO_BIOMETRIC_MATCH ? new BiometricRefused() : error;
}

const secretStore = {
  get: (name) => SecureStore.getItemAsync(name, optionsFor(name)).catch(asBiometricRefused),
  set: (name, value) =>
    SecureStore.setItemAsync(name, value, optionsFor(name)).catch(asBiometricRefused),
  // Deleting removes the encrypted value without decrypting it, so it never asks.
  remove: (name) => SecureStore.deleteItemAsync(name),
};

/**
 * Opens `nullius.db` with its schema migrated, and returns it with the keystore. `canStoreKeys`
 * is false when the phone has no strong biometric enrolled: writing a key would then fail after
 * the index already lists the account. A migration that fails closes the file before the error
 * goes up, so the next attempt does not leave this connection open beside its own.
 */
export async function openAdapters() {
  const db = await SQLite.openDatabaseAsync('nullius.db');
  try {
    await migrate(db);
  } catch (error) {
    await db.closeAsync().catch(() => {});
    throw error;
  }
  return { db, secretStore, canStoreKeys: () => SecureStore.canUseBiometricAuthentication() };
}

const AdaptersContext = createContext(null);

/** What `App.js` puts around the tabs once `openAdapters` returned. */
export const AdaptersProvider = AdaptersContext.Provider;

/** `{ db, secretStore, canStoreKeys }`, for any screen or hook under `AdaptersProvider`. */
export function useAdapters() {
  return useContext(AdaptersContext);
}
