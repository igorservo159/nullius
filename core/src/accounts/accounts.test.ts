import { expect, test } from 'vitest';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  AccountWithoutKey,
  addAccount,
  BiometricRefused,
  keepChosenAccount,
  listAccounts,
  maxAccounts,
  readChosenAccount,
  readPrivateKey,
  removeAccount,
  type SecretStore,
} from './accounts';

// A SecretStore over a Map that also records every write in the order it happened.
function memoryStore() {
  const values = new Map<string, string>();
  const writes: string[] = [];
  const store: SecretStore = {
    async get(name) {
      return values.get(name) ?? null;
    },
    async set(name, value) {
      writes.push(`set ${name}`);
      values.set(name, value);
    },
    async remove(name) {
      writes.push(`remove ${name}`);
      values.delete(name);
    },
  };
  return { store, values, writes };
}

// The first default account of anvil: a key whose address is published, so the derivation is
// checked against a value computed outside this code.
const anvilKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const anvilAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// The private key whose value is the integer n, valid for any n from 1 upward.
function keyNumber(n: number): Hex {
  return `0x${n.toString(16).padStart(64, '0')}`;
}

test('addAccount derives the address from the key and keeps the key apart', async () => {
  const { store, values } = memoryStore();
  const entry = await addAccount(store, 'Conta 1', anvilKey);

  expect(entry).toEqual({ label: 'Conta 1', address: anvilAddress });
  expect(await listAccounts(store)).toEqual([entry]);
  expect(values.get(`account.${anvilAddress}`)).toBe(anvilKey);
  expect(values.get('accounts.index')).not.toContain(anvilKey.slice(2));
});

test('adding an address already listed updates its label', async () => {
  const { store } = memoryStore();
  await addAccount(store, 'Conta 1', anvilKey);
  await addAccount(store, 'Principal', anvilKey);

  expect(await listAccounts(store)).toEqual([{ label: 'Principal', address: anvilAddress }]);
});

test('the sixth account is refused and nothing of it is written', async () => {
  const { store, values } = memoryStore();
  for (let n = 1; n <= maxAccounts; n++) await addAccount(store, `Conta ${n}`, keyNumber(n));

  await expect(addAccount(store, 'Conta 6', keyNumber(6))).rejects.toThrow('limit');
  expect(await listAccounts(store)).toHaveLength(maxAccounts);
  expect(values.size).toBe(1 + maxAccounts);
});

test('an invalid key is refused before anything is written', async () => {
  const { store, writes } = memoryStore();

  await expect(addAccount(store, 'Conta 1', '0x1234')).rejects.toThrow('invalid private key');
  expect(writes).toEqual([]);
});

test('removeAccount deletes the key and drops the entry', async () => {
  const { store, values } = memoryStore();
  await addAccount(store, 'Conta 1', anvilKey);
  await removeAccount(store, anvilAddress);

  expect(await listAccounts(store)).toEqual([]);
  expect(values.has(`account.${anvilAddress}`)).toBe(false);
});

test('readPrivateKey returns the key that addAccount stored', async () => {
  const { store } = memoryStore();
  await addAccount(store, 'Conta 1', anvilKey);

  expect(await readPrivateKey(store, anvilAddress)).toBe(anvilKey);
});

// The store holds nothing under the name: the account is listed without a key.
test('readPrivateKey refuses an account with no key', async () => {
  const { store } = memoryStore();

  await expect(readPrivateKey(store, anvilAddress)).rejects.toBeInstanceOf(AccountWithoutKey);
});

// A key write whose biometric is not confirmed must not leave the account listed.
test('a failed key write puts the previous index back and rethrows', async () => {
  const { store, writes } = memoryStore();
  await addAccount(store, 'Conta 1', keyNumber(1));
  const failingStore: SecretStore = {
    ...store,
    async set(name, value) {
      if (name.startsWith('account.')) throw new BiometricRefused();
      return store.set(name, value);
    },
  };

  await expect(addAccount(failingStore, 'Conta 2', anvilKey)).rejects.toBeInstanceOf(
    BiometricRefused,
  );
  expect(await listAccounts(store)).toEqual([
    { label: 'Conta 1', address: privateKeyToAccount(keyNumber(1)).address },
  ]);
  expect(writes.slice(-2)).toEqual(['set accounts.index', 'set accounts.index']);
});

// The order is what decides the state left by an interruption: an account listed without a key,
// never a key that no index names.
test('add writes the index before the key, remove deletes the key before the index', async () => {
  const { store, writes } = memoryStore();
  await addAccount(store, 'Conta 1', anvilKey);
  await removeAccount(store, anvilAddress);

  expect(writes).toEqual([
    'set accounts.index',
    `set account.${anvilAddress}`,
    `remove account.${anvilAddress}`,
    'set accounts.index',
  ]);
});

// Outside `account.`, so the keystore asks for no biometric to read it when the app opens.
test('the chosen account is kept apart from the keys, and read back', async () => {
  const { store, writes } = memoryStore();
  expect(await readChosenAccount(store)).toBeNull();
  await keepChosenAccount(store, anvilAddress);
  expect(await readChosenAccount(store)).toBe(anvilAddress);
  expect(writes).toEqual(['set accounts.chosen']);
});
