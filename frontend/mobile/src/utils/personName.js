/**
 * Short display names for the shared-ledger copy —
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md §9.1.
 *
 * Pure JS, no React Native import, so a future web client can share it (§14).
 */

/**
 * - two or more words -> first word + space + initial of the last word + '.'
 *   (`Ritu Gupta` -> `Ritu G.`);
 * - one word -> unchanged (`Raj` -> `Raj`).
 *
 * Empty or missing input gives `'Someone'`, the fallback the split rows
 * already use for a nameless payer (`utils/splitParticipants.js`).
 *
 * @param {string | null | undefined} fullName
 * @returns {string}
 */
export function shortName(fullName) {
  const words = typeof fullName === 'string' ? fullName.trim().split(/\s+/).filter(Boolean) : [];
  if (words.length === 0) {
    return 'Someone';
  }
  if (words.length === 1) {
    return words[0];
  }
  const lastWord = words[words.length - 1];
  return `${words[0]} ${lastWord.charAt(0).toUpperCase()}.`;
}
