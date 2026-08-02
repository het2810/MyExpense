package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.util.List;
import java.util.Locale;

/**
 * Composes the frozen sentences the Domain 7 fan-out writes — the
 * {@code activities} three-part sentence (ADR 0008 §1.2) and the
 * {@code notifications} full-sentence {@code message} (ADR 0012 §3).
 *
 * <p>A separate class from {@link ActivityFanoutService} so the <em>copy</em> and
 * the <em>write</em> are reviewable independently: every template below is quoted
 * from an approved ADR, and the three that are not are flagged by name.
 *
 * <h2>The templates, and which ones are derived</h2>
 *
 * <p><strong>{@code split_saved}, all four quoted verbatim from ADR 0008
 * §2.2:</strong>
 *
 * <table border="1">
 *   <caption>ADR 0008 §2.2's table</caption>
 *   <tr><th>Mode</th><th>Who paid</th><th>prefix</th><th>entityName</th><th>suffix</th></tr>
 *   <tr><td>Individual</td><td>You</td><td>{@code You paid ₹{amount} to }</td>
 *       <td>{@code {otherName}}</td><td>{@code  for "{title}".}</td></tr>
 *   <tr><td>Individual</td><td>They</td><td>{@code } (empty)</td>
 *       <td>{@code {otherName}}</td><td>{@code  paid ₹{amount} to you for "{title}".}</td></tr>
 *   <tr><td>Group</td><td>You</td><td>{@code You paid ₹{amount} in }</td>
 *       <td>{@code {groupName}}</td><td>{@code  for "{title}".}</td></tr>
 *   <tr><td>Group</td><td>Someone else</td><td>{@code {payerName} paid ₹{amount} in }</td>
 *       <td>{@code {groupName}}</td><td>{@code  for "{title}".}</td></tr>
 * </table>
 *
 * <p><strong>The discriminator is "did the RECIPIENT pay", not "did the actor
 * pay".</strong> ADR 0008's templates are viewer-relative — they were written for
 * a single-user mock store where viewer and actor were always the same person, and
 * on a fan-out they come apart. Reading them as recipient-relative is what makes
 * the four templates still correct for every row: the member who actually paid
 * reads "You paid", everyone else reads "{payer} paid", and the row's
 * {@code entity_name} is always <em>the other party relative to that
 * recipient</em>. Flagged as this implementation's reading of an ADR that could
 * not have anticipated the question.
 *
 * <p><strong>Superseded 2026-11-12 by ADR 0028 §9.3</strong>: settlement sentences
 * now name payer and payee ({@link #groupSettlement}, {@link #pairSettlement});
 * split sentences gain an exact effect clause ({@link #groupEffect},
 * {@link #pairEffect}); {@code split_edited}/{@code split_deleted} use
 * {@link #splitChanged}. The settlement paragraph below is kept as history.
 *
 * <p><strong>{@code settlement}, quoted from ADR 0009 §6.3 for the actor and
 * DERIVED for everyone else:</strong> that ADR gives only
 * {@code 'You settled up in '}/{@code 'You settled up with '} + {@code name} +
 * {@code ' — ₹{amount}.'}, because Settle Up was a single-user action against a
 * mock store. The counterpart's row needs the same sentence from the other side,
 * and the derivation keeps every word that exists:
 * {@code '{actorName} settled up in '} for a group, and the empty-prefix shape
 * ADR 0008's "they paid" template already established —
 * {@code '' + {actorName} + ' settled up with you — ₹{amount}.'} — for a pair.
 * <strong>The pairwise form is not actually new copy</strong>: it is
 * byte-for-byte the notification ADR 0012 §3's own seed data already contains
 * ("Aditi Sharma settled up with you — ₹450."), which is the best available
 * evidence of the intended phrasing. Flagged for the System Architect all the
 * same.
 *
 * <p><strong>{@code notifications}, quoted from ADR 0012 §3's seed
 * data</strong> — which that ADR calls hand-authored mock content rather than a
 * template, so these are taken as the intended phrasing rather than as a
 * specification:
 * <ul>
 *   <li>group split → {@code '{actorName} added "{title}" (₹{amount}) to {groupName}.'}</li>
 *   <li>individual split → {@code '{actorName} added "{title}" (₹{amount}) with you.'}</li>
 *   <li>individual settlement → {@code '{actorName} settled up with you — ₹{amount}.'}</li>
 *   <li>group settlement → {@code '{actorName} settled up in {groupName} — ₹{amount}.'}
 *       <strong>(derived</strong>, by the same substitution as the activity
 *       sentence above)</li>
 * </ul>
 *
 * <p>Note that a notification's subject is <strong>the actor</strong> ("added"),
 * while an activity's is <strong>the payer</strong> ("paid"). That is not an
 * inconsistency: a notification announces <em>that someone did something</em>, and
 * an activity records <em>what happened to the money</em>. It also means
 * notifications need only one message per event, because they never go to the
 * actor.
 *
 * <h2>⚠ The currency symbol is hardcoded, and that is a known limitation</h2>
 *
 * <p>Every template bakes {@code ₹} into a frozen sentence. {@code V13}'s own
 * header accepts the staleness half of this ("the symbol is already baked into
 * the frozen sentence at write time and will not re-render if the user later
 * switches it ... a known consequence of a frozen sentence, recorded rather than
 * treated as a defect"), but not the <em>choice</em> of symbol: currency is a
 * per-user display preference (§2.1's {@code defaultCurrencyCode}), and on a
 * fan-out one row is written for a member who may have selected a different one.
 *
 * <p><strong>What was NOT done, deliberately:</strong> no ISO-4217-to-symbol table
 * was invented (the backend has none and inventing one is exactly what
 * constitution §30 forbids), and no per-recipient formatting was introduced (it
 * would make one event's sentences differ by reader for a display preference,
 * which defeats the point of a frozen sentence). The symbol is a single named
 * constant so the eventual fix has one site. <strong>Flagged for the System
 * Architect in backend/README.md §16.6.</strong>
 *
 * <p>Both non-ASCII literals are written as {@code \\u} escapes rather than as
 * characters, so the source file is pure ASCII and cannot be corrupted by a
 * platform-default source encoding on any machine that builds it. {@code '⇄'}
 * ({@code \\u21C4}) is one character and fits {@code glyph varchar(4)}, which
 * PostgreSQL counts in characters rather than bytes.
 */
final class ActivitySentences {

    /** {@code '₹'} — see the ⚠ note in the class Javadoc. One site, deliberately. */
    private static final String CURRENCY_SYMBOL = "₹";

    /**
     * {@code 'swap-horizontal-outline'} / {@code '⇄'} / {@code 'accent'} — reused
     * <em>verbatim</em> for both event types, which is what ADR 0008 §2.2 and
     * ADR 0009 §6.3 both specify ("the icon table already names this exact icon
     * for settlement-style actions generically ... {@code tone: 'accent'} matches
     * {@code split_saved}'s tone for the same icon+color pairing — both are
     * money-movement events, deliberately distinct from {@code group_created}'s
     * green {@code success} tone"). No new glyph is introduced.
     */
    static final String MONEY_MOVEMENT_ICON = "swap-horizontal-outline";

    static final String MONEY_MOVEMENT_GLYPH = "⇄";

    static final String MONEY_MOVEMENT_TONE = "accent";

    /**
     * Indian digit grouping, matching the shipped frontend's
     * {@code Number(amount).toLocaleString('en-IN')} exactly — so a sentence the
     * server freezes reads the same as one the app composed before this endpoint
     * existed.
     */
    private static final Locale AMOUNT_LOCALE = Locale.forLanguageTag("en-IN");

    private ActivitySentences() {
    }

    /**
     * The three parts of one {@code activities} row's sentence
     * (ADR 0008 §1.2). Plain concatenation always reconstructs the full sentence,
     * which is why no flat {@code description} column exists.
     *
     * <p>{@code suffix} is legitimately {@code ""} and {@code prefix} may be too —
     * {@code V13} declines a not-blank CHECK on both for exactly that reason.
     */
    record Sentence(String prefix, String entityName, String suffix) {
    }

    // =====================================================================
    // split_saved
    // =====================================================================

    /**
     * ADR 0008 §2.2 rows 1 and 3 — the recipient <em>is</em> the payer.
     *
     * @param groupMode    {@code true} for a group split, {@code false} for a pair
     * @param entityName   the group's name, or the other party's name
     */
    static Sentence splitSavedForPayer(
            boolean groupMode, String entityName, BigDecimal amount, String title) {
        String prefix = "You paid " + money(amount) + (groupMode ? " in " : " to ");
        return new Sentence(prefix, entityName, " for \"" + title + "\".");
    }

    /**
     * ADR 0008 §2.2 rows 2 and 4 — the recipient did not pay.
     *
     * <p>The two rows are genuinely different shapes rather than one with a
     * substitution, which is why this is not a single template: the group form
     * highlights the <em>group</em> and names the payer in the prefix, while the
     * individual form highlights the <em>payer</em> and carries an empty prefix.
     */
    static Sentence splitSavedForOther(
            boolean groupMode, String groupName, String payerName, BigDecimal amount, String title) {
        String suffixTail = " for \"" + title + "\".";
        if (groupMode) {
            return new Sentence(payerName + " paid " + money(amount) + " in ", groupName, suffixTail);
        }
        return new Sentence("", payerName, " paid " + money(amount) + " to you" + suffixTail);
    }

    // ---------------------------------------------------------------------
    // split_saved with 2+ payers (ADR 0025 §6, 2026-11-06). Single-payer
    // splits never reach these: their sentences stay byte-identical to the
    // two methods above.
    // ---------------------------------------------------------------------

    /**
     * ADR 0025 §6.1, <strong>the payer-list joiner</strong>, shared in meaning with
     * the client's {@code joinPayerLabels} so one split reads the same in the feed
     * and on screen:
     * <ul>
     *   <li>1 label: {@code A}</li>
     *   <li>2 labels: {@code A and B}</li>
     *   <li>3 labels: {@code A, B and C}</li>
     *   <li>4 or more: {@code A, B and N others}, where N = count − 2</li>
     * </ul>
     * The caller supplies the labels already ordered (the recipient as
     * {@code You} first if they paid, then the response order of ADR 0025 §5.2).
     */
    static String joinPayerLabels(List<String> labels) {
        int count = labels.size();
        if (count == 0) {
            return "";
        }
        if (count == 1) {
            return labels.get(0);
        }
        if (count == 2) {
            return labels.get(0) + " and " + labels.get(1);
        }
        if (count == 3) {
            return labels.get(0) + ", " + labels.get(1) + " and " + labels.get(2);
        }
        return labels.get(0) + ", " + labels.get(1) + " and " + (count - 2) + " others";
    }

    /**
     * ADR 0025 §6.2, group mode, every recipient (payer or not):
     * {@code {P} paid ₹{A} in } + {@code {groupName}} + {@code  for "{title}".}
     *
     * @param joinedPayers {@link #joinPayerLabels} output for this recipient, which
     *                     starts with {@code You} when the recipient paid
     */
    static Sentence splitSavedMultiPayerInGroup(
            String joinedPayers, String groupName, BigDecimal amount, String title) {
        return new Sentence(joinedPayers + " paid " + money(amount) + " in ", groupName,
                " for \"" + title + "\".");
    }

    /**
     * ADR 0025 §6.2, individual mode, a recipient who paid (with two payers both
     * parties paid, so every registered recipient is one):
     * {@code You and } + {@code {otherPartyName}} + {@code  paid ₹{A} for "{title}".}
     */
    static Sentence splitSavedMultiPayerForPair(String otherPartyName, BigDecimal amount, String title) {
        return new Sentence("You and ", otherPartyName,
                " paid " + money(amount) + " for \"" + title + "\".");
    }

    // ---------------------------------------------------------------------
    // split_saved with 2+ counterparts (ADR 0026 §6.3, 2026-11-11). Only an
    // individual split with two or more counterparts reaches these; a
    // one-counterpart split keeps every sentence above byte-identical. The
    // subject is the CREATOR, not the payer (ADR 0026 §6.2).
    // ---------------------------------------------------------------------

    /**
     * ADR 0026 §6.3, the creator's row:
     * {@code You split ₹{A} for "{title}" with } + {@code {Q}} + {@code .}
     *
     * @param joinedCounterparts {@link #joinPayerLabels} over every counterpart's
     *                           name, in request order
     */
    static Sentence splitSavedMultiContactForCreator(
            String joinedCounterparts, BigDecimal amount, String title) {
        return new Sentence("You split " + money(amount) + " for \"" + title + "\" with ",
                joinedCounterparts, ".");
    }

    /**
     * ADR 0026 §6.3, a registered counterpart's row:
     * {@code {creatorName} split ₹{A} for "{title}" with } + {@code {Q}} + {@code .}
     *
     * @param joinedCounterparts {@link #joinPayerLabels} over {@code you}, then
     *                           every other counterpart's name in request order
     */
    static Sentence splitSavedMultiContactForCounterpart(
            String creatorName, String joinedCounterparts, BigDecimal amount, String title) {
        return new Sentence(creatorName + " split " + money(amount) + " for \"" + title + "\" with ",
                joinedCounterparts, ".");
    }

    /**
     * ADR 0026 §6.3's notification:
     * {@code {creatorName} added "{title}" (₹{A}) with {Q}.} With {@code Q} =
     * {@code you} this is exactly the individual branch of
     * {@link #splitSavedNotification}; that method is still the one the
     * one-counterpart path calls, so its output cannot drift.
     */
    static String splitSavedMultiContactNotification(
            String creatorName, String joinedCounterparts, BigDecimal amount, String title) {
        return creatorName + " added \"" + title + "\" (" + money(amount) + ") with "
                + joinedCounterparts + ".";
    }

    /** ADR 0012 §3's seed phrasing for a split the recipient did not record. */
    static String splitSavedNotification(
            boolean groupMode, String groupName, String actorName, BigDecimal amount, String title) {
        String head = actorName + " added \"" + title + "\" (" + money(amount) + ")";
        return groupMode ? head + " to " + groupName + "." : head + " with you.";
    }

    // =====================================================================
    // Effect clauses (ADR 0028 §9.4) — appended to a split sentence's suffix
    // =====================================================================

    /**
     * Group recipient, {@code n = net(recipient)}: {@code " You lent ₹n."} /
     * {@code " You borrowed ₹|n|."}; removal form {@code " You're no longer owed
     * ₹n for this."} / {@code " You no longer owe ₹|n| for this."}; nothing for 0.
     */
    static String groupEffect(BigDecimal net, boolean removed) {
        if (net.signum() == 0) {
            return "";
        }
        String amount = money(net.abs());
        if (net.signum() > 0) {
            return removed ? " You're no longer owed " + amount + " for this." : " You lent " + amount + ".";
        }
        return removed ? " You no longer owe " + amount + " for this." : " You borrowed " + amount + ".";
    }

    /**
     * Individual recipient, {@code e} = the pair effect from the recipient's side
     * (positive = {@code otherName} owes the recipient):
     * {@code " {other} owes you ₹e for this."} / {@code " You owe {other} ₹|e| for this."};
     * removal form {@code " {other} no longer owes you ₹e for this."} /
     * {@code " You no longer owe {other} ₹|e| for this."}; nothing for 0.
     */
    static String pairEffect(String otherName, BigDecimal effect, boolean removed) {
        if (effect.signum() == 0) {
            return "";
        }
        String amount = money(effect.abs());
        if (effect.signum() > 0) {
            return " " + otherName + (removed ? " no longer owes you " : " owes you ") + amount + " for this.";
        }
        return (removed ? " You no longer owe " : " You owe ") + otherName + " " + amount + " for this.";
    }

    // =====================================================================
    // split_edited / split_deleted (ADR 0028 §9.4)
    // =====================================================================

    /**
     * The split_edited / split_deleted sentence for one recipient, before the
     * effect clause. {@code verb} is {@code edited} or {@code deleted}.
     *
     * @param actorName       {@code null} when the recipient is the actor
     * @param groupName       group mode only
     * @param counterpartList individual mode, actor's row only: ADR 0026 §6.3's Q
     */
    static Sentence splitChanged(String verb, boolean groupMode, String actorName, String title,
            String groupName, String counterpartList, String effectClause) {
        String subject = actorName == null ? "You" : actorName;
        String quoted = "\"" + title + "\"";
        if (groupMode) {
            String joiner = "deleted".equals(verb) ? " from " : " in ";
            return new Sentence(subject + " " + verb + " " + quoted + joiner, groupName, "." + effectClause);
        }
        if (actorName == null) {
            return new Sentence("You " + verb + " " + quoted + " with ", counterpartList, "." + effectClause);
        }
        return new Sentence(actorName + " " + verb + " " + quoted + "." + effectClause, null, "");
    }

    /** ADR 0028 §5.4: appended to the creator's notification when the actor changed their transaction. */
    static String personalTransactionClause(boolean removed) {
        return removed ? " It was also removed from your expenses." : " It was also updated in your expenses.";
    }

    /** Flattens a three-part sentence into a notification message. */
    static String flatten(Sentence sentence) {
        return sentence.prefix() + (sentence.entityName() == null ? "" : sentence.entityName()) + sentence.suffix();
    }

    // =====================================================================
    // settlement (ADR 0028 §9.3 — replaces ADR 0009 §6.3's sentences)
    // =====================================================================

    /**
     * Group settlement, one recipient. {@code payerName}/{@code payeeName} are
     * {@code null} when that party is the recipient.
     * {@code You paid {payee} ₹A in } + group + {@code .} ·
     * {@code {payer} paid you ₹A in } + group + {@code .} ·
     * {@code {payer} paid {payee} ₹A in } + group + {@code .}
     */
    static Sentence groupSettlement(String payerName, String payeeName, BigDecimal amount, String groupName) {
        String head;
        if (payerName == null) {
            head = "You paid " + payeeName + " " + money(amount);
        } else if (payeeName == null) {
            head = payerName + " paid you " + money(amount);
        } else {
            head = payerName + " paid " + payeeName + " " + money(amount);
        }
        return new Sentence(head + " in ", groupName, ".");
    }

    /**
     * Individual settlement, recipient is the payer ({@code You paid } + payee +
     * {@code  ₹A.{R}}) or the payee (payer + {@code  paid you ₹A.{R}}).
     *
     * @param otherName the other party, highlighted
     * @param remaining the pair balance AFTER the write, from this recipient's side
     */
    static Sentence pairSettlement(boolean recipientPaid, String otherName, BigDecimal amount, BigDecimal remaining) {
        String tail = "." + remainingClause(otherName, remaining);
        return recipientPaid
                ? new Sentence("You paid ", otherName, " " + money(amount) + tail)
                : new Sentence("", otherName, " paid you " + money(amount) + tail);
    }

    /** {@code R}: {@code " You now owe {other} ₹X."} · {@code " {other} now owes you ₹X."} · {@code " You're all settled up."} */
    static String remainingClause(String otherName, BigDecimal remaining) {
        if (remaining == null || remaining.signum() == 0) {
            return " You're all settled up.";
        }
        return remaining.signum() < 0
                ? " You now owe " + otherName + " " + money(remaining.abs()) + "."
                : " " + otherName + " now owes you " + money(remaining) + ".";
    }

    // =====================================================================
    // Formatting
    // =====================================================================

    /**
     * {@code ₹2,500} / {@code ₹1,200.50} — the symbol plus Indian grouping, with
     * decimals shown only when there are any.
     *
     * <p>Mirrors the frontend's {@code formatRupees} ({@code toLocaleString('en-IN')})
     * rather than inventing a format: a minimum of zero fraction digits is what
     * makes {@code 2500.00} render as {@code 2,500} exactly as ADR 0008 §2.2's own
     * worked example does, while a genuine partial settlement of {@code 1200.50}
     * still reads correctly.
     *
     * <p>A fresh {@link NumberFormat} per call because {@link NumberFormat} is not
     * thread-safe — a shared static instance is the classic silent corruption
     * under concurrency, and this is a write path two requests can enter at once.
     * It is a few microseconds on a path that is already doing three INSERTs.
     */
    static String money(BigDecimal amount) {
        NumberFormat format = NumberFormat.getNumberInstance(AMOUNT_LOCALE);
        // Whole rupees print without decimals ("₹900"); anything with paise
        // prints both digits ("₹1,443.40", never "₹1,443.4").
        boolean whole = amount.stripTrailingZeros().scale() <= 0;
        format.setMinimumFractionDigits(whole ? 0 : 2);
        format.setMaximumFractionDigits(2);
        format.setGroupingUsed(true);
        return CURRENCY_SYMBOL + format.format(amount);
    }
}
