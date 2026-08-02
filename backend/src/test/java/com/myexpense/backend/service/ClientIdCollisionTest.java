package com.myexpense.backend.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;

import com.myexpense.backend.dto.request.CreateCategoryRequest;
import com.myexpense.backend.dto.request.CreateContactRequest;
import com.myexpense.backend.dto.request.CreateGroupRequest;
import com.myexpense.backend.dto.request.CreateSettlementRequest;
import com.myexpense.backend.dto.request.CreateSplitExpenseRequest;
import com.myexpense.backend.dto.request.CreateTransactionRequest;
import com.myexpense.backend.dto.request.SplitParticipantRequest;
import com.myexpense.backend.dto.request.UpdateTransactionRequest;
import com.myexpense.backend.dto.request.UpsertBudgetPeriodRequest;
import com.myexpense.backend.entity.BudgetPeriod;
import com.myexpense.backend.entity.Category;
import com.myexpense.backend.entity.ChangeLog;
import com.myexpense.backend.entity.Contact;
import com.myexpense.backend.entity.ExpenseGroup;
import com.myexpense.backend.entity.PaymentMode;
import com.myexpense.backend.entity.Settlement;
import com.myexpense.backend.entity.SplitExpense;
import com.myexpense.backend.entity.Transaction;
import com.myexpense.backend.entity.TransactionScope;
import com.myexpense.backend.entity.TransactionType;
import com.myexpense.backend.entity.User;
import com.myexpense.backend.exception.BudgetPeriodNotFoundException;
import com.myexpense.backend.exception.IdConflictException;
import com.myexpense.backend.repository.BudgetPeriodCategoryCapRepository;
import com.myexpense.backend.repository.BudgetPeriodRepository;
import com.myexpense.backend.repository.CategoryRepository;
import com.myexpense.backend.repository.ChangeLogRepository;
import com.myexpense.backend.repository.ContactRepository;
import com.myexpense.backend.repository.EntityInserter;
import com.myexpense.backend.repository.GroupMemberRepository;
import com.myexpense.backend.repository.GroupRepository;
import com.myexpense.backend.repository.SettlementRepository;
import com.myexpense.backend.repository.SplitExpenseIndividualBalanceRepository;
import com.myexpense.backend.repository.SplitExpenseRepository;
import com.myexpense.backend.repository.TransactionRepository;
import com.myexpense.backend.repository.UserRepository;
import com.myexpense.backend.sync.IdempotentWriteExecutor;
import com.myexpense.backend.sync.WriteContext;
import com.myexpense.backend.sync.WriteResult;

import tools.jackson.databind.json.JsonMapper;

/**
 * ADR 0027 §3.3's mandatory test, one per create path: a client-supplied id that
 * another user's row already holds is {@code 409 ID_CONFLICT}, and the other row
 * is left untouched — nothing is inserted, merged or saved. Also proves the
 * superseded outcome commits its log (§4.3). Mocks only; no Spring context, no
 * database.
 */
class ClientIdCollisionTest {

    private static final UUID CALLER = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID OTHER = UUID.fromString("00000000-0000-0000-0000-0000000000b2");
    private static final UUID TAKEN_ID = UUID.fromString("11111111-2222-4333-8444-555555555555");

    private PlatformTransactionManager transactionManager;
    private IdempotentWriteExecutor executor;
    private EntityInserter entityInserter;
    private ChangeLogWriter changeLogWriter;
    private UserRepository userRepository;

    @BeforeEach
    void setUp() {
        transactionManager = mock(PlatformTransactionManager.class);
        executor = new IdempotentWriteExecutor(transactionManager, mock(ChangeLogRepository.class));
        entityInserter = mock(EntityInserter.class);
        changeLogWriter = mock(ChangeLogWriter.class);
        userRepository = mock(UserRepository.class);
        when(userRepository.existsById(any())).thenReturn(true);
        when(userRepository.findById(any())).thenReturn(Optional.of(mock(User.class)));
    }

    @Test
    void transactionIdHeldByAnotherUserIsIdConflict() {
        TransactionRepository repository = mock(TransactionRepository.class);
        Transaction other = Transaction.builder().id(TAKEN_ID).userId(OTHER).title("theirs").build();
        when(repository.findById(TAKEN_ID)).thenReturn(Optional.of(other));
        TransactionService service = new TransactionService(repository, userRepository,
                mock(GroupMemberRepository.class), mock(CategorySnapshotResolver.class),
                mock(ReceiptPublicIdPolicy.class), entityInserter, executor, changeLogWriter);

        CreateTransactionRequest request = new CreateTransactionRequest(null, "Lunch", null,
                LocalDate.of(2026, 11, 11), "12:30", new BigDecimal("250.00"), "income", "personal", null,
                "cash", null, null, null, null, TAKEN_ID);
        assertThrows(IdConflictException.class, () -> service.createTransaction(CALLER, request, WriteContext.NONE));

        assertEquals("theirs", other.getTitle());
        verifyNoInteractions(entityInserter, changeLogWriter);
        verify(repository, never()).save(any());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void categoryIdHeldByAnotherUserIsIdConflict() {
        CategoryRepository repository = mock(CategoryRepository.class);
        when(repository.findById(TAKEN_ID)).thenReturn(Optional.of(
                Category.builder().id(TAKEN_ID).userId(OTHER).name("Theirs").build()));
        CategoryService service = new CategoryService(repository, userRepository,
                mock(TransactionRepository.class), mock(SplitExpenseRepository.class), entityInserter, executor,
                changeLogWriter, JsonMapper.builder().build());

        CreateCategoryRequest request = new CreateCategoryRequest("Food", "fast-food-outline", "F", null, null,
                TAKEN_ID);
        assertThrows(IdConflictException.class, () -> service.createCategory(CALLER, request, WriteContext.NONE));

        verifyNoInteractions(entityInserter, changeLogWriter);
        verify(repository, never()).save(any());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void budgetPeriodIdHeldByAnotherUserIsNotFoundNeverIdConflict() {
        BudgetPeriodRepository repository = mock(BudgetPeriodRepository.class);
        when(repository.findForUpdateById(TAKEN_ID)).thenReturn(Optional.of(
                BudgetPeriod.builder().id(TAKEN_ID).userId(OTHER).build()));
        BudgetService service = new BudgetService(repository, mock(BudgetPeriodCategoryCapRepository.class),
                mock(CategoryRepository.class), userRepository, entityInserter, executor, changeLogWriter);

        UpsertBudgetPeriodRequest request = new UpsertBudgetPeriodRequest(TAKEN_ID, "custom",
                LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 30), new BigDecimal("1000.00"), null);
        // ADR 0027 §3.4: this endpoint has always answered "not yours" with 404.
        assertThrows(BudgetPeriodNotFoundException.class,
                () -> service.upsertPeriod(CALLER, request, WriteContext.NONE));

        verifyNoInteractions(entityInserter, changeLogWriter);
        verify(repository, never()).save(any());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void contactIdHeldByAnotherUserIsIdConflict() {
        ContactRepository repository = mock(ContactRepository.class);
        when(repository.findById(TAKEN_ID)).thenReturn(Optional.of(
                Contact.builder().id(TAKEN_ID).ownerUserId(OTHER).name("Theirs").build()));
        ContactInviteService inviteService = mock(ContactInviteService.class);
        ContactService service = new ContactService(repository, userRepository, inviteService,
                entityInserter, executor, changeLogWriter);

        CreateContactRequest request = new CreateContactRequest("Raj", null, null, TAKEN_ID);
        assertThrows(IdConflictException.class, () -> service.createContact(CALLER, request, WriteContext.NONE));

        verifyNoInteractions(entityInserter, changeLogWriter, inviteService);
        verify(repository, never()).save(any());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void groupIdHeldByAnotherUserIsIdConflict() {
        GroupRepository repository = mock(GroupRepository.class);
        when(repository.findById(TAKEN_ID)).thenReturn(Optional.of(
                ExpenseGroup.builder().id(TAKEN_ID).createdByUserId(OTHER).name("Theirs").build()));
        GroupService service = new GroupService(repository, mock(GroupMemberRepository.class),
                mock(ContactRepository.class), userRepository, mock(GroupBalanceService.class),
                mock(GroupResponseAssembler.class), mock(ContactInviteService.class), entityInserter, executor,
                changeLogWriter);

        CreateGroupRequest request = new CreateGroupRequest(TAKEN_ID, "Flatmates", List.of());
        assertThrows(IdConflictException.class, () -> service.createGroup(CALLER, request, WriteContext.NONE));

        verifyNoInteractions(entityInserter, changeLogWriter);
        verify(repository, never()).save(any());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void splitExpenseIdHeldByAnotherUserIsIdConflict() {
        SplitExpenseRepository repository = mock(SplitExpenseRepository.class);
        when(repository.findById(TAKEN_ID)).thenReturn(Optional.of(
                SplitExpense.builder().id(TAKEN_ID).createdByUserId(OTHER).title("Theirs").build()));
        IndividualBalanceService balances = mock(IndividualBalanceService.class);
        SplitLedgerService groupBalances = mock(SplitLedgerService.class);
        SplitExpenseService service = new SplitExpenseService(repository,
                mock(SplitExpenseIndividualBalanceRepository.class), mock(TransactionRepository.class),
                mock(GroupRepository.class), mock(GroupMemberRepository.class), mock(ContactRepository.class),
                userRepository, mock(CategorySnapshotResolver.class), balances, groupBalances,
                mock(SplitRevisionWriter.class), mock(ActivityFanoutService.class),
                mock(SplitExpenseResponseAssembler.class), entityInserter, executor, changeLogWriter);

        CreateSplitExpenseRequest request = new CreateSplitExpenseRequest(
                "Dinner", null, LocalDate.of(2026, 11, 11), new BigDecimal("900.00"), "group",
                UUID.randomUUID(), null, null, "equally", CALLER, null, null,
                List.of(new SplitParticipantRequest(CALLER, null, new BigDecimal("900.00"))), false,
                TAKEN_ID, null);
        assertThrows(IdConflictException.class,
                () -> service.createSplitExpense(CALLER, request, WriteContext.NONE));

        verifyNoInteractions(entityInserter, changeLogWriter, balances, groupBalances);
        verify(repository, never()).save(any());
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void settlementIdHeldByAnotherUserIsIdConflictBeforeAnyLedgerWrite() {
        SettlementRepository repository = mock(SettlementRepository.class);
        when(repository.findById(TAKEN_ID)).thenReturn(Optional.of(
                Settlement.builder().id(TAKEN_ID).initiatedByUserId(OTHER).amount(new BigDecimal("10.00")).build()));
        GroupBalanceService groupBalances = mock(GroupBalanceService.class);
        IndividualBalanceService balances = mock(IndividualBalanceService.class);
        SettlementService service = new SettlementService(repository, mock(GroupRepository.class),
                mock(GroupMemberRepository.class), groupBalances, balances, mock(ActivityFanoutService.class),
                userRepository, mock(ContactRepository.class), entityInserter, executor, changeLogWriter,
                mock(SplitLedgerService.class), mock(SettlementPartiesResolver.class));

        CreateSettlementRequest request = new CreateSettlementRequest("group", UUID.randomUUID(), null, OTHER,
                null, new BigDecimal("10.00"), "marked_paid", TAKEN_ID, null, null);
        assertThrows(IdConflictException.class, () -> service.settle(CALLER, request, WriteContext.NONE));

        verifyNoInteractions(entityInserter, changeLogWriter, groupBalances, balances);
        verify(repository, never()).save(any());
        verify(repository, never()).saveAndFlush(any());
    }

    /**
     * ADR 0027 §4.3: an LWW loser returns SUPERSEDED as a value, so its
     * transaction COMMITS (with the change-log row, activity and notification
     * written through ChangeLogWriter) and is never rolled back; the 409 is only
     * produced afterwards by the controller.
     */
    @Test
    void supersededUpdateCommitsItsLogRowAndIsNotRolledBack() {
        TransactionRepository repository = mock(TransactionRepository.class);
        UUID transactionId = UUID.randomUUID();
        OffsetDateTime newer = OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(1);
        Transaction row = Transaction.builder().id(transactionId).userId(CALLER).title("Lunch")
                .amount(new BigDecimal("250.00")).type(TransactionType.EXPENSE).scope(TransactionScope.PERSONAL)
                .paymentMode(PaymentMode.CASH).version(3).lastClientWriteAt(newer).build();
        when(repository.findForUpdateByIdAndUserId(transactionId, CALLER)).thenReturn(Optional.of(row));
        TransactionService service = new TransactionService(repository, userRepository,
                mock(GroupMemberRepository.class), mock(CategorySnapshotResolver.class),
                mock(ReceiptPublicIdPolicy.class), entityInserter, executor, changeLogWriter);

        UpdateTransactionRequest request = new UpdateTransactionRequest();
        request.setAmount(new BigDecimal("300.00"));
        WriteContext olderEdit = new WriteContext(UUID.randomUUID(), newer.minusMinutes(10),
                WriteContext.ORIGIN_REPLAY, UUID.randomUUID());

        WriteResult<?> result = service.updateTransaction(CALLER, transactionId, request, olderEdit);

        assertEquals(WriteResult.Outcome.SUPERSEDED, result.outcome());
        verify(changeLogWriter).logSuperseded(any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.eq(ChangeLog.REASON_NEWER_WRITE), any(), any(), any(), any());
        verify(transactionManager).commit(any());
        verify(transactionManager, never()).rollback(any());
        assertEquals(new BigDecimal("250.00"), row.getAmount());
        assertEquals(newer, row.getLastClientWriteAt());
    }
}
