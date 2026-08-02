package com.myexpense.backend.exception;

import org.springframework.http.HttpStatus;

/**
 * 400 on {@code POST /api/v1/categories} when the request's
 * {@code parentCategoryId} resolves to one of the caller's own categories that
 * is <strong>itself a subcategory</strong> (api-overview.md §3.2, ADR 0019
 * §2/§7 — new 2026-10-22).
 *
 * <p>Exactly one level of nesting is supported: a row with a parent can never
 * itself be a parent. Arbitrary depth was considered and deliberately not
 * built (constitution §27) — it needs recursive reads, a cycle guard, a
 * path/closure structure and a decision about how much of a deep path a
 * transaction snapshot freezes, none of which the product asked for.
 *
 * <p><strong>Why a 400 and not a 404.</strong> The referenced row exists and
 * belongs to the caller, so this is <em>ineligibility</em>, not absence — a
 * 404 would be a lie, and the user needs told a different thing (constitution
 * §22: each code maps to a distinct thing worth saying).
 *
 * <p><strong>This is the service-layer half of a mandatory invariant.</strong>
 * ADR 0019 §2 requires depth-1 enforcement here regardless of what the
 * database does; the two declarative invariants (same owner, not its own
 * parent) are the database's, this one is this service's.
 *
 * <p><strong>The database does also enforce it:</strong> {@code V6} adds
 * {@code trg_categories_enforce_depth_one}, a {@code BEFORE INSERT OR UPDATE}
 * trigger and this schema's first (Database Architect, 2026-10-22). It is
 * defence-in-depth against a service bug and against direct SQL, not against
 * a legal request — {@code CategoryService} always checks first, so the
 * trigger never fires on a request that reaches it through the API. If it ever
 * does fire, it surfaces as a logged 500 rather than this clean 400, which is
 * correct: reaching it would mean this check was skipped, i.e. a bug. Note
 * that a plpgsql {@code RAISE} carries <strong>no constraint name</strong>, so
 * {@code CategoryService#isUniqueNameViolation} must be — and is — null-safe
 * on that path.
 */
public class SubcategoryDepthExceededException extends ApiException {

    public SubcategoryDepthExceededException() {
        super(
                HttpStatus.BAD_REQUEST,
                "SUBCATEGORY_DEPTH_EXCEEDED",
                "A subcategory cannot have subcategories of its own.");
    }
}
