package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

import com.myexpense.backend.entity.ChangeLog;

/**
 * The activity types, icons and sentences ADR 0027 §6.4 adds, composed with
 * {@link ActivitySentences}' conventions ({@code entity_name} only for a group or
 * contact name, amounts via {@link ActivitySentences#money}). Pure functions.
 *
 * <p>{@code group_created} is ADR 0008 §2.3's own entry, reused verbatim.
 */
final class ChangeLogSentences {

    static final String TYPE_TRANSACTION_CREATED = "transaction_created";
    static final String TYPE_TRANSACTION_EDITED = "transaction_edited";
    static final String TYPE_TRANSACTION_DELETED = "transaction_deleted";
    static final String TYPE_CATEGORY_CREATED = "category_created";
    static final String TYPE_CATEGORY_EDITED = "category_edited";
    static final String TYPE_CATEGORY_DELETED = "category_deleted";
    static final String TYPE_BUDGET_SAVED = "budget_saved";
    static final String TYPE_CONTACT_CREATED = "contact_created";
    static final String TYPE_GROUP_CREATED = "group_created";
    static final String TYPE_GROUP_MEMBER_ADDED = "group_member_added";
    static final String TYPE_SETTINGS_CHANGED = "settings_changed";
    static final String TYPE_WRITE_SUPERSEDED = "write_superseded";

    /** {@code icon_name} / {@code glyph} / {@code tone} of one activity type. */
    record Icon(String iconName, String glyph, String tone) {
    }

    static final Icon TRANSACTION_CREATED = new Icon("add-circle-outline", "+", "neutral");
    static final Icon TRANSACTION_EDITED = new Icon("create-outline", "E", "neutral");
    static final Icon TRANSACTION_DELETED = new Icon("trash-outline", "D", "negative");
    static final Icon CATEGORY = new Icon("pricetag-outline", "C", "neutral");
    static final Icon BUDGET_SAVED = new Icon("wallet-outline", "B", "neutral");
    static final Icon CONTACT_CREATED = new Icon("person-add-outline", "P", "neutral");
    static final Icon GROUP_CREATED = new Icon("people-outline", "G", "success");
    static final Icon GROUP_MEMBER_ADDED = new Icon("people-outline", "G", "neutral");
    static final Icon SETTINGS_CHANGED = new Icon("settings-outline", "S", "neutral");
    static final Icon WRITE_SUPERSEDED = new Icon("git-compare-outline", "!", "warning");

    private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter DATE_TIME_FORMAT =
            DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale.ENGLISH);

    private ChangeLogSentences() {
    }

    static ActivitySentences.Sentence transactionCreated(String title, BigDecimal amount) {
        return whole("You added " + title + " (" + ActivitySentences.money(amount) + ").");
    }

    static ActivitySentences.Sentence transactionEdited(String title) {
        return whole("You edited " + title + ".");
    }

    static ActivitySentences.Sentence transactionDeleted(String title, BigDecimal amount) {
        return whole("You deleted " + title + " (" + ActivitySentences.money(amount) + ").");
    }

    /** {@code verb} is {@code created}, {@code edited} or {@code deleted}. */
    static ActivitySentences.Sentence category(String verb, String name) {
        return whole("You " + verb + " the category " + name + ".");
    }

    static ActivitySentences.Sentence budgetSaved(LocalDate startDate, LocalDate endDate) {
        return whole("You saved your budget for " + DATE_FORMAT.format(startDate) + " – "
                + DATE_FORMAT.format(endDate) + ".");
    }

    static ActivitySentences.Sentence contactCreated(String contactName) {
        return new ActivitySentences.Sentence("You added ", contactName, " to your contacts.");
    }

    /** ADR 0008 §2.3's {@code group_created} template. */
    static ActivitySentences.Sentence groupCreated(String groupName, int memberCount) {
        return new ActivitySentences.Sentence("You created the group \"", groupName,
                "\" with " + memberCount + (memberCount == 1 ? " member." : " members."));
    }

    static ActivitySentences.Sentence groupMemberAdded(String memberName, String groupName) {
        return new ActivitySentences.Sentence("You added " + memberName + " to ", groupName, ".");
    }

    static ActivitySentences.Sentence settingsChanged() {
        return whole("You changed your settings.");
    }

    /**
     * The {@code write_superseded} sentence, also used verbatim as the
     * {@code sync_conflict} notification message. The time shown is the device's
     * own ({@code X-Client-Updated-At} in its own offset), falling back to the
     * effective time when the header was absent.
     */
    static String writeSuperseded(String label, OffsetDateTime madeAt, String reason) {
        String tail = ChangeLog.REASON_DELETED.equals(reason)
                ? " wasn't applied — it had been deleted."
                : " wasn't applied — a newer change was kept.";
        return "A change you made to " + label + " on " + DATE_TIME_FORMAT.format(madeAt) + tail;
    }

    private static ActivitySentences.Sentence whole(String text) {
        return new ActivitySentences.Sentence(text, null, "");
    }
}
