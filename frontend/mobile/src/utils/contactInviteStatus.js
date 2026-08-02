/**
 * `inviteStatus` -> the one line the user is told after a contact is created
 * (docs/api/api-overview.md §6.2, docs/decisions/0015-sms-phone-invite.md §3).
 *
 * ---
 * **NO MESSAGE IS EVER DELIVERED, SO NO COPY HERE MAY SAY ONE WAS.**
 *
 * The backend's SMS gateway is `LoggingSmsInviteGateway`: it writes
 * `[DEV SMS STUB] Invite SMS would be sent to ****0001 ...` to the server log
 * and **reports success on purpose**, so that the per-phone cooldown it starts
 * is real and testable (`backend/README.md` §15.1(b)/§15.5). `'sent'` therefore
 * means *"the invite was recorded and the cooldown has started"* and nothing
 * more. Copy that said "we texted them" would be false today and would stay
 * false until a real gateway is wired — and a user who believed it would wait
 * for a reply that cannot come (constitution §22).
 *
 * So every line below describes **what this app knows happened**, never what a
 * recipient received. "Queued" is the strongest word available and it is
 * accurate: a row exists in `contact_invites`, and the send is the backend's to
 * make whenever it can really make one.
 *
 * ---
 * **WHY `rate_limited` IS HANDLED EVEN THOUGH §6.2 CANNOT RETURN IT.**
 *
 * §6.2 enumerates `'sent' | 'failed' | 'cooldown_active' | null`, while §6.3's
 * resend endpoint adds `'rate_limited'` and `'already_linked'`. The backend
 * reports the per-user daily cap as `cooldown_active` on §6.2 because
 * `rate_limited` is not in that enumeration — deliberately imprecise, and
 * flagged as such (`backend/README.md` §15.2, §15.6 assumption 4). Both are
 * mapped here so that a client is not the thing that breaks if that
 * imprecision is ever corrected, and because `cooldown_active`'s own copy has
 * to stay true for both conditions it currently covers.
 *
 * An unknown value yields `null` rather than a guess: saying nothing is better
 * than describing an outcome this app does not understand.
 *
 * @param {string | null | undefined} inviteStatus `ContactResponse.inviteStatus`.
 * @param {string} name The contact's name, for copy that names them.
 * @returns {string | null} One line, or null when there is nothing to say.
 */
export function getInviteStatusMessage(inviteStatus, name) {
  const who = typeof name === 'string' && name.trim() ? name.trim() : 'This contact';

  switch (inviteStatus) {
    case 'sent':
      // Recorded, cooldown started, nothing delivered. See the note above.
      return `${who} doesn't use MyExpense yet — an invite is queued for them.`;
    case 'cooldown_active':
      // Either the per-phone 24h cooldown or the per-user daily cap. The copy
      // covers both without claiming which, because the response does not say.
      return `An invite was requested for this number recently, so no new one was queued. ${who} was still added.`;
    case 'rate_limited':
      return `You've requested a lot of invites today, so no new one was queued. ${who} was still added.`;
    case 'failed':
      return `The invite for ${who} couldn't be queued. You can still split expenses with them.`;
    case 'already_linked':
      return `${who} already uses MyExpense.`;
    default:
      // `null` — no phone was submitted, or the number already belongs to an
      // account, in which case nothing was applicable and nothing is said.
      return null;
  }
}
