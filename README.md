# Nullius

A peer-to-peer crypto payment app for Android. One person charges, another pays, and the payment
is confirmed to the receiver in seconds, with no intermediary holding the funds, approving the
payment or able to reverse it. The app runs entirely on the phone and pays on
[Linea](https://linea.build), a rollup that settles on Ethereum.

Nullius is also meant to be taken apart and rebuilt: the payment logic lives in a TypeScript core
with no screen, the network and the contract it pays through are data rather than assumptions, and
anyone can build and sign their own APK with other networks, another contract or any change they
want.

> **Status: early.** Nullius works end to end on Linea mainnet, but neither the app nor the
> contract has been audited. Use small amounts and keep a copy of every key you import.

## Contents

1. [The idea](#the-idea)
2. [Features](#features)
3. [Advantages](#advantages)
4. [Limitations](#limitations)
5. [Deployments](#deployments)
6. [Install the app](#install-the-app)
7. [Use the app](#use-the-app)
8. [Make it yours](#make-it-yours)
9. [Develop](#develop)
10. [Repository layout](#repository-layout)
11. [License](#license)

## The idea

Paying someone in crypto usually goes through an exchange or a payment processor: it holds the
money for a while, can freeze it, and decides when the receiver sees it. Paying directly from one
wallet to another removes that party, but leaves two questions open for the receiver: *which*
transfer pays *which* sale, and *has it really happened?*

Nullius answers both without anyone in the middle:

- **A charge names its payment.** The receiver creates a charge for an amount; the charge carries
  an *order id*, `keccak256(abi.encode(payee, amount, salt))`, where the salt is 32 random bytes.
  The order id says who receives, how much, and which charge this is.
- **A contract checks the payment, and keeps nothing.** The payer sends the value through the
  `Payments` contract, which recomputes the order id from what it received, refuses any payment
  that does not match it or that was already paid, forwards the whole value to the receiver in
  the same transaction, and emits a `Payment` event. The contract has no owner, no balance and no
  other function that moves value.
- **Linea makes it fast and Ethereum makes it final.** Linea includes a transaction in a block
  within seconds, so the receiver sees the charge paid almost at once; Linea then proves its
  blocks on Ethereum, so the payment ends up as hard to reverse as Ethereum itself.

The name comes from *terra nullius*, the term international law uses for land that belongs to no
one and that no sovereign rules. That is the ground Nullius wants payments to stand on: the
contract has no owner and no upgrade path, the app has no server and no operator, and the rules a
payment follows are code that anyone can read and nobody can change for a single user. No party
sits between the payer and the receiver, because there is no party to sit there.

## Features

| Area | What the app does |
|---|---|
| Accounts | Imports up to 5 accounts from their private keys, keeps each key in the Android Keystore behind a fingerprint, chooses the account in use, copies its address, removes it. |
| Receive | Creates a charge, shows it as a QR code and as a 256-character text, lists the account's charges, and tells the user when one is paid. |
| Pay | Reads a charge from a QR code, pasted text or typed fields; refuses one made for another network or whose order id does not match; pays it and follows the payment until it is final. |
| Payment status | Signed, rejected by the node, pending, lost, queued, replaced, executed or reverted, and whether its block is finalized on Ethereum; when the contract refuses, the app says which check did. |
| History | Rebuilds paid charges and payments made outside the app, or lost with its data, from the contract's logs. |
| Balances | Shows each account's ETH balance on Ethereum and on Linea. |
| Bridge | Deposits ETH from Ethereum to Linea and withdraws it back through Linea's canonical bridge, and claims a withdrawal on Ethereum with a proof the app builds itself. |
| Network | Pays on Linea by default; can switch to the Linea Sepolia test network or to other nodes, checking every field (chain, contract code, deploy block) before keeping it. |

## Advantages

- **No intermediary.** The value goes from the payer's account to the receiver's in one
  transaction. Nobody holds it, approves it or can send it back.
- **No server.** Accounts, charges and payments live on the phone, in the Keystore and a SQLite
  database. There is no account to create and nothing to shut down.
- **Fast confirmation.** The receiver sees the payment once Linea includes it, in seconds, and the
  app later shows when Ethereum has finalized it.
- **Cheap.** A payment is a single contract call on Linea, a rollup whose gas costs a small part
  of Ethereum's.
- **A charge cannot be paid twice or paid wrong.** The contract refuses a repeated order id and
  any amount or receiver the order id did not commit to.
- **Recoverable records.** Every payment leaves a `Payment` event on chain, so the app can rebuild
  its history from the chain alone.

## Limitations

> [!NOTE]
> These are the limits of **version 1.0**, the first one that works end to end, not limits of the
> design. Each has a known way forward.

| Today, in 1.0 | Way forward |
|---|---|
| **Android only.** Nothing was built or tested on iOS. | The iOS port, next in line. |
| **ETH only.** No stablecoin charges: an issuer such as Circle can freeze an account or pause its token, which brings an intermediary back. | USDC charges paid with `permit` (EIP-2612) straight to the receiver, with the issuer's powers stated plainly to both sides. |
| **Import only.** Accounts come from keys made elsewhere, and uninstalling the app deletes them with the local records. | Accounts created on the phone, with a guided copy of the key kept outside it. |
| **A fingerprint is required.** Keys are stored only behind strong biometrics, and enrolling a new fingerprint makes them unreadable. | Authentication that also accepts the device PIN and survives a new enrollment. |
| **Notices only while the app is open.** A paid charge or a claimable withdrawal is announced inside the app. | Android notifications for both. |
| **Public nodes see your activity**: your IP address and your accounts. | Already in reach: point the app at a node you trust, in *Network*. |
| **A withdrawal takes hours.** Moving ETH back to Ethereum waits for Linea to finalize there. | Set by Linea's proofs, not by the app: it shortens as Linea's finalization does. |
| **Not audited.** | An independent review of the contract and the app. |

## Deployments

| Network | Chain id | `Payments` address | Deploy block |
|---|---|---|---|
| Linea | 59144 | [`0xd04011796E34457a4Df4952879464673824DC1CF`](https://lineascan.build/address/0xd04011796E34457a4Df4952879464673824DC1CF#code) | 32490807 |
| Linea Sepolia | 59141 | [`0xD2807905E71f4AA10e322aD90726040457ebE825`](https://sepolia.lineascan.build/address/0xD2807905E71f4AA10e322aD90726040457ebE825) | 32601971 |

The app knows both addresses; nothing needs configuring.

## Install the app

### Download

Each [release](https://github.com/igorservo159/nullius/releases/latest) carries a signed APK.
Download it on the phone and open it; Android asks you to allow installs from that source.

Every release is signed with the same key, so a new release installs over the previous one and
keeps your accounts and records. You can check that an APK carries that key with `apksigner`
(from the Android SDK's build tools):

```sh
apksigner verify --print-certs nullius-*.apk
# Signer #1 certificate SHA-256 digest:
# 95371d102ce23910edcae0498ff5fb3c89e942ab64c11d01069021db401953bd
```

### Build your own

Building the APK yourself is the way to run a version you changed (see
[Make it yours](#make-it-yours)) or to run exactly the code you read. Once the tools are
installed, it takes a few commands and about two minutes of build.

**You need:** a current Node.js LTS, JDK 17, and the Android SDK (the one
[Android Studio](https://developer.android.com/studio) installs, with `ANDROID_HOME` set).

```sh
git clone https://github.com/igorservo159/nullius.git
cd nullius
npm ci                                     # installs the core and the app (npm workspaces)

cd mobile
npx expo prebuild --platform android       # generates mobile/android from app.json
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The APK is at `mobile/android/app/build/outputs/apk/release/app-release.apk`. The
`reactNativeArchitectures` flag builds only for 64-bit ARM, which every recent phone uses, and
makes the build faster and the APK smaller (about 40 MB); leave it out to build for every
architecture.

To install it, either copy the file to the phone and open it (Android asks you to allow installs
from that source), or connect the phone with USB debugging on and run:

```sh
adb install app/build/outputs/apk/release/app-release.apk
```

This APK is signed with the debug key of the React Native template, which is public: fine for a
phone where only you install apps, never for distributing the APK (see
[Sign a release](#sign-a-release)). Android installs an APK over another only when both carry the
same key, so moving between a downloaded release and your own build means uninstalling first,
which deletes the app's keys and records.

## Use the app

1. **Import an account.** In *Accounts*, paste a private key and confirm with your fingerprint.
   Keep a copy of the key outside the phone.
2. **Fund it on Linea.** Send ETH to the account's address on Linea, or send it on Ethereum and use
   *Bridge* to deposit it.
3. **Receive.** In *Receive*, type an amount and show the QR code to the payer. The charge turns
   paid as soon as the payment is in a Linea block.
4. **Pay.** In *Pay*, scan the receiver's QR code (or paste its text), check the amount and the
   receiver, and confirm with your fingerprint.
5. **Withdraw.** In *Bridge*, withdraw ETH to Ethereum; when it can be claimed, the app tells you, and a
   tap and a fingerprint claim it on Ethereum.

To try the app without real money, open *Network*, choose *Use the test network* and fund the
account with Linea Sepolia ETH from a faucet.

## Make it yours

The core makes no choice the code cannot show, and each one sits in a single place:

| To change | Where | What follows from it |
|---|---|---|
| The networks | `core/src/network/network.ts`: `knownChains`, `chainById`, `l1ChainOf`, `defaultNetwork` | `chainById` refuses any chain it does not list, so a new network is accepted only once it is named there, with the L1 it settles on. |
| Where `Payments` lives | `core/src/contracts/payments.ts`: `paymentsDeployments` | One entry per chain id, with the address and the block that published it; the app reads history from that block on. |
| The contract itself | `contracts/src/Payments.sol`, then `paymentsAbi` and `paymentsCodeHash` in `core/src/contracts/payments.ts` | Before trusting an address, the app hashes the code deployed there and compares it with `paymentsCodeHash`: a changed contract is refused until its hash is written here. A new order id formula also changes the test vector pinned on both sides. |
| The bridge | `core/src/contracts/lineaMessageService.ts`: `messageServicesOf` | The bridge speaks Linea's canonical message service; another rollup needs its own messaging and proof. |
| Name, app id and icon | `mobile/app.json`, `mobile/assets/` | A different `android.package` makes a separate app, installable next to Nullius. |
| Screens | `mobile/src/<feature>/` | Screens call the core's use cases and never touch storage directly. |

The core's tests run against an in-memory database and a local `anvil` with the real contract, so
a change can be checked before it reaches a phone (see [Develop](#develop)).

## Develop

| Tool | Used for |
|---|---|
| Node.js (current LTS), npm | the core, the app and their tests |
| JDK 17, Android SDK | building the Android app |
| [Foundry](https://book.getfoundry.sh) (`forge`, `anvil`) | the contract, its tests, and the core's integration tests |

**Run the app in development** (Metro serves the JavaScript, so edits reload on the phone):

```sh
cd mobile
npx expo run:android
```

**Test the core:**

```sh
cd core
npm test                                   # unit tests
npm run typecheck
(cd ../contracts && forge build)           # the integration tests deploy the real contract
npm run test:integration                   # starts anvil, deploys Payments, runs the flows
```

Without `anvil` or the output of `forge build`, the integration tests are skipped with a warning;
with `CI` set, a missing tool fails them instead.

**Test and deploy the contract:**

```sh
cd contracts
git submodule update --init                # forge-std
forge test
```

`script/Deploy.s.sol` deploys `Payments` with the key in the `ACC1_KEY` environment variable,
which never goes into the repository:

```sh
forge script script/Deploy.s.sol --rpc-url linea_sepolia --broadcast
```

A new deployment needs its address and block added to `paymentsDeployments` in
`core/src/contracts/payments.ts`.

### Sign a release

An APK you hand to other people must carry a key that only you hold. Create one once, outside the
repository, and keep a copy of it and of its password: losing either means no later version can
install over the ones already on people's phones.

```sh
keytool -genkeypair -storetype PKCS12 -keystore ~/.android-keys/nullius-release.jks \
  -alias nullius -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Nullius"
```

Then sign each build with it. `apksigner` replaces the debug signature the build carries:

```sh
apksigner sign --ks ~/.android-keys/nullius-release.jks --out nullius-1.0.0.apk \
  mobile/android/app/build/outputs/apk/release/app-release.apk
apksigner verify --print-certs nullius-1.0.0.apk
```

Raise `android.versionCode` in `mobile/app.json` for every release: Android refuses to replace an
app with one whose code is not higher.

## Repository layout

```
contracts/   Foundry project: the Payments contract, its tests and its deploy script
core/        @nullius/core: everything the app does, in TypeScript, with no screen
mobile/      the Expo / React Native app: screens and the phone's storage
```

`core` is split by feature (`accounts`, `network`, `charges`, `payments`, `history`, `bridge`,
`balances`, plus the shared `contracts`, `database` and `transactions`), each exporting only
through its `index.ts`. It never touches the phone directly: it asks for a `Database` and a
`SecretStore`, and `mobile/src/adapters.js` provides them with expo-sqlite and expo-secure-store.
The same core runs in the tests against an in-memory database and anvil.

## License

[MIT](LICENSE). The Geist fonts in `mobile/assets/fonts` are under the
[SIL Open Font License](mobile/assets/fonts/OFL.txt).
