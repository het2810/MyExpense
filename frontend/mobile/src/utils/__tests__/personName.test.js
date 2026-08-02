/**
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md
 * §9.1 (shortName).
 */
import { shortName } from '../personName';

describe('shortName', () => {
  it('shortens two or more words to first + last initial', () => {
    expect(shortName('Ritu Gupta')).toBe('Ritu G.');
    expect(shortName('Dhruv Kumar Chawla')).toBe('Dhruv C.');
    expect(shortName('  raj   mehta ')).toBe('raj M.');
  });

  it('keeps one word unchanged and falls back for empty input', () => {
    expect(shortName('Raj')).toBe('Raj');
    expect(shortName('')).toBe('Someone');
    expect(shortName(null)).toBe('Someone');
  });
});

