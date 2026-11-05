// The one lock of the history reading in this JavaScript runtime: the reading above the tabs and
// a task in the background run in the same runtime, and each round goes through here, so two
// rounds never read at once.

import { readRound } from '@nullius/core/history';

// True while a round runs, whichever account it reads and whoever started it.
let reading = false;

/**
 * Runs `readRound` for `account` on `network`, or does nothing and returns null when another
 * round is running. Otherwise returns what `readRound` returns, or throws what it throws.
 */
export async function runRound(db, network, account, onSlice) {
  if (reading) return null;
  reading = true;
  try {
    return await readRound(db, network, account, onSlice);
  } finally {
    reading = false;
  }
}
