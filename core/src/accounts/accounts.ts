// The accounts the app can sign for, kept in the platform keystore through a SecretStore.

import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * The keystore as `core/` needs it: named text values, read and written asynchronously. This
 * module keeps the accounts in it; `network.ts` keeps the network chosen on the phone.
 *
 * `mobile/` passes one backed by expo-secure-store and the tests pass one backed by a `Map`.
 * The keystore cannot list the names it holds, which is why `accounts.index` exists.
 */
export interface SecretStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

/** What the screen is allowed to see of an account: never the key. */
export type AccountEntry = { label: string; address: Address };

/** The sixth account is refused rather than silently dropped. */
export const maxAccounts = 5;

const indexName = 'accounts.index';

// The account last chosen in the accounts tab. Outside `keyPrefix`: read with no biometric.
const chosenName = 'accounts.chosen';

/** Every name that holds a private key starts with this: `mobile/src/adapters.js` guards those. */
export const keyPrefix = 'account.';

function keyName(address: Address): string {
  return `${keyPrefix}${address}`;
}

/** The accounts in the index, without decrypting any key. A store with no index has none. */
export async function listAccounts(store: SecretStore): Promise<AccountEntry[]> {
  const index = await store.get(indexName);
  return index === null ? [] : (JSON.parse(index) as AccountEntry[]);
}

/**
 * Stores an account and returns what the screen may see of it.
 *
 * The address is derived from the key here, so the index and the key can never name two
 * different accounts. An address already in the index gets the new label and its key written
 * again, which is also how an account listed without a key is repaired.
 *
 * The index is written before the key: if the app dies between the two, what remains is an
 * account listed without a key, which adding it again repairs — never a key nobody can find.
 * A key write that fails without the app dying (a cancelled biometric prompt, for one) puts
 * the previous index back before the error goes up, so it leaves nothing behind.
 */
export async function addAccount(
  store: SecretStore,
  label: string,
  privateKey: Hex,
): Promise<AccountEntry> {
  const entry: AccountEntry = { label, address: privateKeyToAccount(privateKey).address };
  const accounts = await listAccounts(store);
  const previousIndex = JSON.stringify(accounts);
  const position = accounts.findIndex((account) => account.address === entry.address);

  if (position === -1) {
    if (accounts.length >= maxAccounts) {
      throw new Error(`the limit of ${maxAccounts} accounts is reached`);
    }
    accounts.push(entry);
  } else {
    accounts[position] = entry;
  }

  await store.set(indexName, JSON.stringify(accounts));
  try {
    await store.set(keyName(entry.address), privateKey);
  } catch (error) {
    await store.set(indexName, previousIndex);
    throw error;
  }
  return entry;
}

/** The index lists the account, but the store holds nothing under its key name. */
export class AccountWithoutKey extends Error {
  readonly address: Address;

  constructor(address: Address) {
    super(`account has no key: ${address}`);
    this.name = 'AccountWithoutKey';
    this.address = address;
  }
}

/**
 * The biometric asked for to read or write a private key was not confirmed: cancelled, locked out
 * after too many attempts, or timed out. The keystore's adapter throws it, so a screen knows it
 * without knowing which keystore asked.
 */
export class BiometricRefused extends Error {
  constructor() {
    super('the biometric for the key was not confirmed');
    this.name = 'BiometricRefused';
  }
}

/**
 * The private key of an account, for signing; on the phone, the read that asks for a biometric.
 *
 * Nothing under the name is `AccountWithoutKey`. On Android a key invalidated by a new
 * fingerprint also reads as nothing: expo-secure-store answers `null` for it. A prompt that is
 * not confirmed is `BiometricRefused`, from the keystore's adapter, so the screen can tell the
 * two apart.
 */
export async function readPrivateKey(store: SecretStore, address: Address): Promise<Hex> {
  const key = await store.get(keyName(address));
  if (key === null) throw new AccountWithoutKey(address);
  return key as Hex;
}

/**
 * Forgets an account. The key is removed before the index, so a removal cut in half leaves an
 * account listed without a key — never a key the user asked to delete still on the phone.
 */
export async function removeAccount(store: SecretStore, address: Address): Promise<void> {
  await store.remove(keyName(address));
  const remaining = (await listAccounts(store)).filter((account) => account.address !== address);
  await store.set(indexName, JSON.stringify(remaining));
}

/**
 * The account last chosen, so the app opens on it again; null when none was kept. The caller
 * checks it is still listed: a removed account's address may stay here.
 */
export async function readChosenAccount(store: SecretStore): Promise<Address | null> {
  return (await store.get(chosenName)) as Address | null;
}

/** Keeps `address` as the account the app opens on. */
export async function keepChosenAccount(store: SecretStore, address: Address): Promise<void> {
  await store.set(chosenName, address);
}
