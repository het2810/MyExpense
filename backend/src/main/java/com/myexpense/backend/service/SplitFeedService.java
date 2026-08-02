package com.myexpense.backend.service;

import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.myexpense.backend.dto.request.SplitFeedQuery;
import com.myexpense.backend.dto.response.PageResponse;
import com.myexpense.backend.dto.response.SplitExpenseResponse;
import com.myexpense.backend.dto.response.SplitFeedItemResponse;
import com.myexpense.backend.dto.response.SplitFeedSettlementResponse;
import com.myexpense.backend.entity.Settlement;
import com.myexpense.backend.entity.SplitExpense;
import com.myexpense.backend.exception.GroupNotFoundException;
import com.myexpense.backend.exception.SplitRuleViolationException;
import com.myexpense.backend.exception.UnauthorizedException;
import com.myexpense.backend.repository.GroupMemberRepository;
import com.myexpense.backend.repository.SettlementRepository;
import com.myexpense.backend.repository.SplitExpenseRepository;
import com.myexpense.backend.repository.SplitFeedQueryRepository;
import com.myexpense.backend.repository.SplitFeedQueryRepository.FeedRow;
import com.myexpense.backend.repository.UserRepository;

/**
 * ADR 0028 §7 — the server-merged feeds: {@code GET /groups/{id}/feed} and
 * {@code GET /splits/individuals/{id}/feed}.
 *
 * <p>Gates: a group member, else {@code 404 GROUP_NOT_FOUND}; a party to the
 * pair (ADR 0023 §1.4), else {@code 404 INDIVIDUAL_BALANCE_NOT_FOUND}.
 *
 * <p>Query budget per page, independent of page length: the UNION page, the
 * count, one split-expense read plus the {@link SplitExpenseResponseAssembler}'s
 * fixed batch, one settlement read plus {@link SettlementPartiesResolver}'s batch.
 * Deleted splits are included as tombstones (§7.3); every participant/payer read
 * inside the assembler is current-revision.
 */
@Service
public class SplitFeedService {

    private final SplitFeedQueryRepository feedRepository;
    private final SplitExpenseRepository splitExpenseRepository;
    private final SettlementRepository settlementRepository;
    private final GroupMemberRepository memberRepository;
    private final UserRepository userRepository;
    private final IndividualBalanceService individualBalanceService;
    private final SplitExpenseResponseAssembler splitAssembler;
    private final SettlementPartiesResolver partiesResolver;

    public SplitFeedService(
            SplitFeedQueryRepository feedRepository,
            SplitExpenseRepository splitExpenseRepository,
            SettlementRepository settlementRepository,
            GroupMemberRepository memberRepository,
            UserRepository userRepository,
            IndividualBalanceService individualBalanceService,
            SplitExpenseResponseAssembler splitAssembler,
            SettlementPartiesResolver partiesResolver) {
        this.feedRepository = feedRepository;
        this.splitExpenseRepository = splitExpenseRepository;
        this.settlementRepository = settlementRepository;
        this.memberRepository = memberRepository;
        this.userRepository = userRepository;
        this.individualBalanceService = individualBalanceService;
        this.splitAssembler = splitAssembler;
        this.partiesResolver = partiesResolver;
    }

    @Transactional(readOnly = true)
    public PageResponse<SplitFeedItemResponse> groupFeed(UUID userId, UUID groupId, SplitFeedQuery query) {
        requireUser(userId);
        String timeZone = requireTimeZone(query.getTimeZone());
        if (!memberRepository.existsByGroupIdAndUserId(groupId, userId)) {
            throw new GroupNotFoundException();
        }
        List<FeedRow> rows = feedRepository.findGroupPageIncludingDeleted(
                groupId, timeZone, query.getSize(), offset(query));
        return page(rows, feedRepository.countGroupIncludingDeleted(groupId), query);
    }

    @Transactional(readOnly = true)
    public PageResponse<SplitFeedItemResponse> pairFeed(UUID userId, UUID individualBalanceId, SplitFeedQuery query) {
        requireUser(userId);
        String timeZone = requireTimeZone(query.getTimeZone());
        individualBalanceService.requireParty(userId, individualBalanceId);
        List<FeedRow> rows = feedRepository.findPairPageIncludingDeleted(
                individualBalanceId, timeZone, query.getSize(), offset(query));
        return page(rows, feedRepository.countPairIncludingDeleted(individualBalanceId), query);
    }

    /**
     * ADR 0028 §7.1: an IANA zone id, validated before it reaches SQL. Only the
     * region ids are accepted ({@link ZoneId#getAvailableZoneIds()}), not raw
     * offsets such as {@code +05:30}: PostgreSQL reads a POSIX-style offset with
     * the opposite sign, so allowing it would silently shift dates.
     */
    static String requireTimeZone(String timeZone) {
        String value = timeZone == null || timeZone.isBlank() ? "UTC" : timeZone;
        if (!ZoneId.getAvailableZoneIds().contains(value)) {
            throw SplitRuleViolationException.invalidTimeZone();
        }
        return value;
    }

    private static int offset(SplitFeedQuery query) {
        long offset = (long) query.getPage() * query.getSize();
        if (offset > Integer.MAX_VALUE) {
            throw SplitRuleViolationException.pageOutOfRange();
        }
        return (int) offset;
    }

    private PageResponse<SplitFeedItemResponse> page(List<FeedRow> rows, long total, SplitFeedQuery query) {
        List<UUID> splitIds = new ArrayList<>();
        List<UUID> settlementIds = new ArrayList<>();
        for (FeedRow row : rows) {
            if (SplitFeedItemResponse.TYPE_SPLIT_EXPENSE.equals(row.itemType())) {
                splitIds.add(row.id());
            } else {
                settlementIds.add(row.id());
            }
        }

        Map<UUID, SplitExpenseResponse> splitsById = new HashMap<>();
        if (!splitIds.isEmpty()) {
            List<SplitExpense> splits = splitExpenseRepository.findAllById(splitIds);
            for (SplitExpenseResponse response : splitAssembler.assemble(splits)) {
                splitsById.put(response.id(), response);
            }
        }
        Map<UUID, SplitFeedSettlementResponse> settlementsById = new HashMap<>();
        if (!settlementIds.isEmpty()) {
            List<Settlement> settlements = settlementRepository.findAllById(settlementIds);
            Map<UUID, SettlementPartiesResolver.Parties> parties = partiesResolver.resolve(settlements);
            for (Settlement settlement : settlements) {
                SettlementPartiesResolver.Parties party =
                        parties.getOrDefault(settlement.getId(), SettlementPartiesResolver.Parties.LEGACY);
                settlementsById.put(settlement.getId(), new SplitFeedSettlementResponse(
                        settlement.getId(), settlement.getGroupId(), settlement.getIndividualBalanceId(),
                        settlement.getInitiatedByUserId(), party.payer(), party.payee(),
                        settlement.getAmount(), settlement.getMethod(), settlement.getSettledAt()));
            }
        }

        List<SplitFeedItemResponse> items = new ArrayList<>(rows.size());
        for (FeedRow row : rows) {
            boolean isSplit = SplitFeedItemResponse.TYPE_SPLIT_EXPENSE.equals(row.itemType());
            items.add(new SplitFeedItemResponse(row.itemType(), row.id(), row.occurredOn(), row.occurredAt(),
                    isSplit ? splitsById.get(row.id()) : null,
                    isSplit ? null : settlementsById.get(row.id())));
        }
        int totalPages = (int) ((total + query.getSize() - 1) / query.getSize());
        return new PageResponse<>(List.copyOf(items), query.getPage(), query.getSize(), total, totalPages);
    }

    private void requireUser(UUID userId) {
        if (userId == null || !userRepository.existsById(userId)) {
            throw new UnauthorizedException();
        }
    }
}
