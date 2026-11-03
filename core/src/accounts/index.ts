// What `mobile/` uses of the accounts: the port its keystore adapter implements, the use cases
// of the accounts tab, and the errors a screen recognizes.

export {
  AccountWithoutKey,
  BiometricRefused,
  addAccount,
  keepChosenAccount,
  keyPrefix,
  listAccounts,
  maxAccounts,
  readChosenAccount,
  removeAccount,
  type AccountEntry,
  type SecretStore,
} from './accounts';
