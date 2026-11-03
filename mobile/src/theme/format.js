// How values are written on screen, the same way on every tab, and read back from a field.

import { formatEther, parseEther } from 'viem';

/// An amount in wei with a comma between each group of three digits, `12,500,000,000,000,000`.
export function groupDigits(wei) {
  return String(wei).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/// An amount in wei as ETH, `0.0125`, with every decimal it has: rounding would hide wei that are
/// there.
export function formatEth(wei) {
  return formatEther(wei);
}

// An amount in ETH with a decimal point, or a comma, and at most 18 decimals, which is every
// amount `parseEther` reads without rounding. The comma stays: the decimal keypad of a phone set
// to a language that writes `0,5` has no point key. `BigInt('')` would be 0n and `BigInt('0x10')`
// 16n, so the text is checked before it becomes a number, not after.
const ethText = /^\d+([.,]\d{1,18})?$/;

/// The wei of an amount typed in ETH, `0.0125`; null for anything `ethText` refuses.
export function weiOf(text) {
  return ethText.test(text) ? parseEther(text.replace(',', '.')) : null;
}

/// An address as the design writes it: `0x` and four characters from each end, `0x7a3F…91c2`.
export function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/// When something happened, as the lists write it: `today, 11:48 AM`, `yesterday, 7:12 PM`, or the
/// day as `formatDay` writes it, `Oct 15, 1:19 AM`.
export function formatWhen(ms) {
  const day = formatDay(ms);
  const time = formatTime(ms);
  if (day === 'Today') return `today, ${time}`;
  if (day === 'Yesterday') return `yesterday, ${time}`;
  return `${day}, ${time}`;
}

/// The hour and minute of a moment, `2:02 PM`.
export function formatTime(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// The day of a moment as the lists group by it: `Today`, `Yesterday`, `Oct 12`, and the year after
/// the day when it is not this year's, `Oct 12, 2025`.
export function formatDay(ms) {
  const date = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const day = `${months[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === today.getFullYear() ? day : `${day}, ${date.getFullYear()}`;
}

/// How long ago a moment was, as a list says it: `5 min ago`, `2 h ago`, `3 days ago`, and
/// `just now` under a minute.
export function formatAgo(ms) {
  const minutes = Math.floor((Date.now() - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}
