/**
 * **Income is not a category** (docs/decisions/0018-income-is-not-a-category.md
 * §1). `type: 'expense' | 'income'` is the discriminator and the only one;
 * there is no income row in `categories`, nothing resolves "the income
 * category" by id or by name anywhere, and nothing should start.
 *
 * This file exists because deleting the old `INCOME_CATEGORY_ID = 'cat-income'`
 * lookup from AddExpenseScreen left a real hole on the **write** path: an
 * income transaction has to render the moment it is created — immediately
 * today, since Domain 4 (Transactions) is unbuilt and the store is still
 * local, and permanently thereafter, because income can be entered offline
 * (constitution §14) and `ListItem`/`IconBadge` need a real name and glyph to
 * render at all (ADR 0003's Debit/Credit Amendment, Part B).
 *
 * ---
 * **THESE VALUES MIRROR SERVER CONSTANTS. THE SERVER OWNS THEM.**
 *
 * They are a copy of the backend's own income snapshot constants (ADR 0018
 * §3.1, a sibling artifact to `DefaultCategoryCatalog`), kept here in exactly
 * one place so that when Domain 4 is wired they are **replaced by the
 * server's copy of the record, not duplicated inline at a second call site**
 * (ADR 0018 §7 / its open question 4).
 *
 * Three rules that come with them:
 *
 * 1. **Never sent to the server.** `POST`/`PATCH /transactions` do not accept
 *    `categoryName`/`categoryIconName`/`categoryGlyph`/`categoryTone` and must
 *    not gain them (ADR 0018 §3.1,
 *    docs/architecture/security-architecture.md §3). This is a rendering
 *    placeholder, not an input.
 * 2. **Never read to decide behaviour.** No branch, no filter and no lookup
 *    keys off these strings. `type === 'income'` answers every such question.
 * 3. **Overwritten by the server's values** when a response or the next sync
 *    arrives — the same relationship every other frozen snapshot column
 *    already has with its client-side copy.
 *
 * The four values are ADR 0003 Part B's originals, unchanged; `tone` follows
 * `type` rather than any category (ADR 0018 §3.3), and `parentCategoryName` is
 * `null` because income references no category, so it has no parent — the same
 * `null` a top-level expense carries, and deliberately **not** an income
 * special case (docs/decisions/0019-subcategories-one-optional-level.md §5).
 *
 * Keys are the local transaction record's, not the DTO's
 * (`category`/`iconName`/`glyph`/`tone` ↔
 * `categoryName`/`categoryIconName`/`categoryGlyph`/`categoryTone`), so this
 * object can be spread straight into a record being saved.
 */
export const INCOME_CATEGORY_SNAPSHOT = {
  category: 'Income',
  iconName: 'cash-outline',
  glyph: 'I',
  tone: 'success',
  parentCategoryName: null,
};
