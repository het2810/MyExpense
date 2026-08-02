package com.myexpense.backend.service;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.myexpense.backend.dto.request.SplitParticipantRequest;
import com.myexpense.backend.dto.request.SplitPayerRequest;
import com.myexpense.backend.dto.request.UpdateSplitExpenseRequest;
import com.myexpense.backend.entity.SplitExpense;
import com.myexpense.backend.entity.SplitExpenseParticipant;
import com.myexpense.backend.entity.SplitExpensePayer;
import com.myexpense.backend.service.SplitExpenseService.Identity;
import com.myexpense.backend.service.SplitExpenseService.PayerEntry;

/**
 * ADR 0028 §6.6's logged fields for {@code entity_type = 'split_expense'} on
 * update, delete and superseded: {@code title}, {@code amount},
 * {@code splitDate}, {@code splitMethod}, {@code categoryId},
 * {@code categoryName}, {@code payers}, {@code participants} (arrays as whole
 * values). Pure functions; {@code ChangeSets} computes the diff.
 *
 * <p>Array entries are {@code {userId, contactId, amount}} and are
 * <strong>sorted by identity</strong> (users first, then contacts, by lowercase
 * uuid text — PostgreSQL's unsigned order), so the stored revision and a new one
 * compare equal when only the request order differs. Never logged to an
 * application log (security-architecture.md §8).
 */
final class SplitChangeLogFields {

    private SplitChangeLogFields() {
    }

    /** The split's current values, with one revision's rows (the caller passes the current revision's). */
    static Map<String, Object> of(SplitExpense split, List<SplitExpensePayer> payers,
            List<SplitExpenseParticipant> participants) {
        List<Entry> payerEntries = new ArrayList<>(payers.size());
        for (SplitExpensePayer payer : payers) {
            payerEntries.add(new Entry(payer.getPayerUserId(), payer.getPayerContactId(), payer.getAmountPaid()));
        }
        List<Entry> participantEntries = new ArrayList<>(participants.size());
        for (SplitExpenseParticipant participant : participants) {
            participantEntries.add(new Entry(
                    participant.getParticipantUserId(), participant.getParticipantContactId(), participant.getAmount()));
        }
        return fields(split, payerEntries, participantEntries);
    }

    /** The split's values after an edit, from the normalised new revision. */
    static Map<String, Object> of(SplitExpense split, List<PayerEntry> payers,
            List<Identity> participants, List<BigDecimal> shares) {
        List<Entry> payerEntries = new ArrayList<>(payers.size());
        for (PayerEntry payer : payers) {
            payerEntries.add(new Entry(payer.identity().userId(), payer.identity().contactId(), payer.amount()));
        }
        List<Entry> participantEntries = new ArrayList<>(participants.size());
        for (int i = 0; i < participants.size(); i++) {
            participantEntries.add(new Entry(participants.get(i).userId(), participants.get(i).contactId(),
                    shares.get(i)));
        }
        return fields(split, payerEntries, participantEntries);
    }

    /** ADR 0027 §6.3 superseded: every field the request tried to set, as sent. */
    static Map<String, Object> attempted(UpdateSplitExpenseRequest request) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("title", request.title() == null ? null : request.title().trim());
        fields.put("amount", request.amount());
        fields.put("splitDate", request.splitDate());
        fields.put("splitMethod", request.splitMethod());
        if (request.categoryId() != null) {
            fields.put("categoryId", request.categoryId());
        }
        List<Entry> payers = new ArrayList<>();
        if (request.payers() != null) {
            for (SplitPayerRequest payer : request.payers()) {
                payers.add(new Entry(payer.payerUserId(), payer.payerContactId(), payer.amount()));
            }
        } else {
            payers.add(new Entry(request.paidByUserId(), request.paidByContactId(), request.amount()));
        }
        fields.put("payers", toValues(payers));
        List<Entry> participants = new ArrayList<>();
        if (request.participants() != null) {
            for (SplitParticipantRequest participant : request.participants()) {
                participants.add(new Entry(
                        participant.participantUserId(), participant.participantContactId(), participant.amount()));
            }
        }
        fields.put("participants", toValues(participants));
        return fields;
    }

    private static Map<String, Object> fields(SplitExpense split, List<Entry> payers, List<Entry> participants) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("title", split.getTitle());
        fields.put("amount", split.getAmount());
        fields.put("splitDate", split.getSplitDate());
        fields.put("splitMethod", split.getSplitMethod());
        fields.put("categoryId", split.getCategoryId());
        fields.put("categoryName", split.getCategoryName());
        fields.put("payers", toValues(payers));
        fields.put("participants", toValues(participants));
        return fields;
    }

    private record Entry(UUID userId, UUID contactId, BigDecimal amount) {

        String sortKey() {
            return userId != null ? "u:" + userId : "c:" + contactId;
        }
    }

    private static List<Map<String, Object>> toValues(List<Entry> entries) {
        List<Entry> sorted = new ArrayList<>(entries);
        sorted.sort(Comparator.comparing(Entry::sortKey));
        List<Map<String, Object>> values = new ArrayList<>(sorted.size());
        for (Entry entry : sorted) {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("userId", entry.userId());
            value.put("contactId", entry.contactId());
            value.put("amount", entry.amount());
            values.add(value);
        }
        return values;
    }
}
