package com.myexpense.backend.sync;

import java.util.Set;

/**
 * The {@code change_log.entity_type} vocabulary (ADR 0027 §6.2). V18 carries no
 * CHECK for it (extensible); this set is what {@code GET /change-log} accepts.
 */
public final class ChangeLogEntityTypes {

    public static final String TRANSACTION = "transaction";
    public static final String CATEGORY = "category";
    public static final String BUDGET_PERIOD = "budget_period";
    public static final String USER_SETTINGS = "user_settings";
    public static final String CONTACT = "contact";
    public static final String GROUP = "group";
    public static final String SPLIT_EXPENSE = "split_expense";
    public static final String SETTLEMENT = "settlement";

    public static final Set<String> ALL = Set.of(
            TRANSACTION, CATEGORY, BUDGET_PERIOD, USER_SETTINGS, CONTACT, GROUP, SPLIT_EXPENSE, SETTLEMENT);

    private ChangeLogEntityTypes() {
    }
}
