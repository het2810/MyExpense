import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useBudgetStore } from '../../store/useBudgetStore';
import { useCategoriesStore } from '../../store/useCategoriesStore';
import { useCategories } from '../../hooks/useCategories';
import { hasAnySubcategory } from '../../utils/categories';
import { getCurrentMonthRange, isPeriodEnded } from '../../utils/budgetPeriod';
import {
  getDateDisplayLabel,
  getExactDateLabel,
  parseIsoDate,
  toIsoDateString,
} from '../../utils/dateDisplay';
import ScreenHeader from '../../components/ScreenHeader';
import Card from '../../components/Card';
import TextInput from '../../components/TextInput';
import PrimaryButton from '../../components/PrimaryButton';
import ListItem from '../../components/ListItem';
import IconBadge from '../../components/IconBadge';
import SegmentedControl from '../../components/SegmentedControl';
import TextButton from '../../components/TextButton';
import FormMessage from '../../components/FormMessage';

const PERIOD_OPTIONS = [
  { label: 'Automatic', value: 'automatic' },
  { label: 'Custom', value: 'custom' },
];

/**
 * Budget Settings — docs/decisions/0010-budget-settings.md §2,
 * docs/ui/design-system.md §14.1. Two entry points, one shared component,
 * distinguished by the `isMandatory`/`onComplete` props (docs/decisions/
 * 0011-post-auth-budget-gate.md §3):
 * - Normal `ProfileStack` push (`isMandatory` omitted/false) — a plain
 *   back-navigable screen editing the current/next period.
 * - Root-level mandatory gate (`isMandatory` true, `onComplete` callback) —
 *   `ScreenHeader` renders with no onBack/onClose; a successful Save calls
 *   `onComplete()` in addition to the normal `savePeriod` write, which is
 *   the only thing that flips RootNavigator's local post-auth state to
 *   reveal MainTabs.
 *
 * Period validation (ADR 0010 §5) — resolved against this app's
 * single-`activePeriod`-slot model:
 * - No activePeriod at all -> first-ever save, no overlap check.
 * - activePeriod exists and is still current (not ended) -> in-place edit,
 *   same `id`, no overlap check. Form fields pre-fill from it.
 * - activePeriod exists but has ended -> next-period mode, a genuinely new
 *   `id`; the new period's startDate must be strictly after the old
 *   period's endDate. Form fields start blank/default rather than
 *   pre-filling from the dead period.
 * Independently of any of the above, the period being saved must itself
 * satisfy endDate >= today (isPeriodEnded reused, not re-authored).
 *
 * Category Caps (ADR 0010 §2/§3): the list is now `GET /categories` through
 * `useCategories()`, and "Add Category" is a real `POST /categories` — both
 * **top-level only**, which the API's nested read shape gives this screen for
 * free, with no filter added here (docs/decisions/0019-subcategories-one-optional-level.md
 * §10.4). A cap itself is still written into `useCategoriesStore`'s standing
 * `monthlyCap` live, as the user types, and Save still snapshots every
 * category with a non-null `monthlyCap` into the saved period's own
 * `categoryCaps` array (a copy, not a live reference — ADR 0010 §3's explicit
 * snapshot decision). A cap on a parent is evaluated **inclusive** of its
 * subcategories' spending (ADR 0019 §4(b)); nothing here may imply otherwise.
 */
function BudgetSettingsScreen({ isMandatory = false, onComplete } = {}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const styles = createStyles(theme, insets);

  const activePeriod = useBudgetStore((state) => state.activePeriod);
  const savePeriod = useBudgetStore((state) => state.savePeriod);
  const isSaving = useBudgetStore((state) => state.isSaving);
  // The caps list iterates `categories`, which is the API's top-level array —
  // so subcategories are **structurally** absent from this screen rather than
  // filtered out of it (docs/decisions/0019-subcategories-one-optional-level.md
  // §10.4). No filter was added here, and none should be: a subcategory cannot
  // carry a cap at all (the server answers 400), and a flat list would have put
  // uncappable rows in this list on day one.
  const {
    categories,
    hasLoaded,
    isLoading,
    loadError,
    isCreating,
    createCategory,
    reload,
  } = useCategories();
  // Caps are still written locally as the user types, and Save still snapshots
  // them into the period (ADR 0010 §2/§3, unchanged — `setCategoryCap` is
  // deliberately not wired to `PATCH /categories/{id}` this round; see
  // src/api/categoriesApi.js).
  const setCategoryCap = useCategoriesStore((state) => state.setCategoryCap);

  // Save mode resolved once, at mount — ADR 0010 §5. An in-place edit of a
  // still-current period pre-fills its existing values; a first-ever save
  // or a next-period setup (the old one already ended) starts blank/default.
  const [isEditingInPlace] = useState(
    () => activePeriod != null && !isPeriodEnded(activePeriod),
  );

  const [periodType, setPeriodType] = useState(() =>
    isEditingInPlace && activePeriod ? activePeriod.periodType : 'automatic',
  );
  const [customStartDate, setCustomStartDate] = useState(() =>
    isEditingInPlace && activePeriod ? activePeriod.startDate : getCurrentMonthRange().startDate,
  );
  const [customEndDate, setCustomEndDate] = useState(() =>
    isEditingInPlace && activePeriod ? activePeriod.endDate : getCurrentMonthRange().endDate,
  );
  const [isStartDatePickerVisible, setIsStartDatePickerVisible] = useState(false);
  const [isEndDatePickerVisible, setIsEndDatePickerVisible] = useState(false);

  const [amount, setAmount] = useState(() =>
    isEditingInPlace && activePeriod ? String(activePeriod.amount) : '',
  );

  // Seeded from the period being edited: its caps are the saved truth
  // (api-overview.md §5.1), while a category's own `monthlyCap` may be unset
  // after a reload. Deleted categories (`categoryId: null`) have no row here.
  const [capDrafts, setCapDrafts] = useState(() => {
    if (!isEditingInPlace || !activePeriod) {
      return {};
    }
    return Object.fromEntries(
      activePeriod.categoryCaps
        .filter((cap) => cap.categoryId != null)
        .map((cap) => [cap.categoryId, String(cap.monthlyCap)]),
    );
  });
  const [saveError, setSaveError] = useState(null);
  const [isAddCategoryFormOpen, setIsAddCategoryFormOpen] = useState(false);
  const [addCategoryName, setAddCategoryName] = useState('');
  const [addCategoryError, setAddCategoryError] = useState(null);

  const [errors, setErrors] = useState({});

  function getCapDisplayValue(category) {
    if (capDrafts[category.id] !== undefined) {
      return capDrafts[category.id];
    }
    return category.monthlyCap != null ? String(category.monthlyCap) : '';
  }

  /**
   * The cap Save sends for one category: the typed draft when there is one
   * (blank clears it), else the category's standing cap.
   *
   * @param {object} category
   * @returns {number | null}
   */
  function resolveCap(category) {
    const draft = capDrafts[category.id];
    if (draft === undefined) {
      return category.monthlyCap ?? null;
    }
    const parsed = parseFloat(draft.trim());
    return !Number.isNaN(parsed) && parsed > 0 ? parsed : null;
  }

  function handleCapChange(categoryId, value) {
    setCapDrafts((prev) => ({ ...prev, [categoryId]: value }));

    const trimmed = value.trim();
    if (!trimmed) {
      setCategoryCap(categoryId, null);
      return;
    }
    const parsed = parseFloat(trimmed);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      setCategoryCap(categoryId, parsed);
    }
  }

  function handleStartDateChange(event, date) {
    setIsStartDatePickerVisible(false);
    if (event.type === 'set' && date) {
      setCustomStartDate(toIsoDateString(date));
    }
  }

  function handleEndDateChange(event, date) {
    setIsEndDatePickerVisible(false);
    if (event.type === 'set' && date) {
      setCustomEndDate(toIsoDateString(date));
    }
  }

  // Still creates **top-level** categories only (ADR 0019 §10.4): this is the
  // caps surface, and caps are top-level only. A `POST /categories` now, with
  // the blank/duplicate-sibling checks owned by useCategories (constitution
  // §8) and the server's 409 as the real guarantee.
  async function handleAddCategory() {
    const { success, error } = await createCategory(addCategoryName);
    if (!success) {
      setAddCategoryError(error);
      return;
    }
    setAddCategoryName('');
    setAddCategoryError(null);
    setIsAddCategoryFormOpen(false);
  }

  async function handleSave() {
    const nextErrors = {};

    const parsedAmount = parseFloat(amount);
    const isAmountValid = amount !== '' && !Number.isNaN(parsedAmount) && parsedAmount > 0;
    if (!isAmountValid) {
      nextErrors.amount =
        amount === '' ? 'Enter a monthly budget.' : 'Budget must be greater than ₹0.';
    }

    const { startDate, endDate } =
      periodType === 'automatic' ? getCurrentMonthRange() : { startDate: customStartDate, endDate: customEndDate };

    // Next-period-mode overlap check (ADR 0010 §5) — only applies when the
    // period being replaced already ended. An in-place edit of a still-
    // current period, or a first-ever save, has nothing to overlap with.
    if (!isEditingInPlace && activePeriod && startDate <= activePeriod.endDate) {
      nextErrors.period = `Your new period must start after ${getExactDateLabel(activePeriod.endDate)}.`;
    }

    // Save-time end-date validation (ADR 0010 §5's final paragraph /
    // ADR 0011 §4) — reuses the identical isPeriodEnded comparison; applies
    // regardless of which case above applies.
    if (!nextErrors.period && isPeriodEnded({ endDate })) {
      nextErrors.period = "This period has already ended. Choose an end date that's today or later.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setSaveError(null);

    // Snapshot, not a live reference (ADR 0010 §3) — only categories with a
    // cap at save time are included. The server freezes `categoryName`.
    const categoryCaps = categories
      .map((category) => ({ categoryId: category.id, monthlyCap: resolveCap(category) }))
      .filter((cap) => cap.monthlyCap != null);

    // An in-place edit keeps the period's id (ADR 0010 §5); no id creates the
    // next period server-side.
    const result = await savePeriod({
      id: isEditingInPlace && activePeriod ? activePeriod.id : null,
      periodType,
      startDate,
      endDate,
      amount: parsedAmount,
      categoryCaps,
    });
    if (!result.success) {
      setSaveError(result.error);
      return;
    }

    if (isMandatory) {
      onComplete?.();
    } else {
      navigation.goBack();
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title="Budget Settings"
        onBack={isMandatory ? undefined : () => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={styles.card}>
          <Text style={styles.label}>PERIOD</Text>
          <SegmentedControl
            options={PERIOD_OPTIONS}
            value={periodType}
            onChange={setPeriodType}
            style={styles.periodControl}
          />

          {periodType === 'custom' ? (
            <>
              <View style={styles.dateContainer}>
                <Text style={styles.label}>START DATE</Text>
                <Pressable
                  style={styles.dateField}
                  onPress={() => setIsStartDatePickerVisible(true)}
                  accessibilityRole="button"
                >
                  <Text style={styles.dateIcon}>▦</Text>
                  <Text style={styles.dateText}>{getDateDisplayLabel(customStartDate)}</Text>
                </Pressable>
              </View>
              {isStartDatePickerVisible ? (
                <DateTimePicker
                  value={parseIsoDate(customStartDate)}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  onChange={handleStartDateChange}
                />
              ) : null}

              <View style={styles.dateContainer}>
                <Text style={styles.label}>END DATE</Text>
                <Pressable
                  style={styles.dateField}
                  onPress={() => setIsEndDatePickerVisible(true)}
                  accessibilityRole="button"
                >
                  <Text style={styles.dateIcon}>▦</Text>
                  <Text style={styles.dateText}>{getDateDisplayLabel(customEndDate)}</Text>
                </Pressable>
              </View>
              {isEndDatePickerVisible ? (
                <DateTimePicker
                  value={parseIsoDate(customEndDate)}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  onChange={handleEndDateChange}
                />
              ) : null}
            </>
          ) : null}

          {errors.period ? <Text style={styles.errorText}>{errors.period}</Text> : null}

          <TextInput
            label="MONTHLY BUDGET"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            keyboardType="decimal-pad"
            error={errors.amount}
            style={styles.amountField}
          />
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionHeader}>Category Caps</Text>

          {/* A parent's cap INCLUDES its subcategories' spending (ADR 0019
              §4(b)). Said once, here, and only when the account actually has
              subcategories — the requirement is that nothing implies the
              opposite, and a cap on `Food` that silently ignored
              `Food › Snacks` would be a limit that never fires. */}
          {hasAnySubcategory(categories) ? (
            <Text style={styles.sectionNote}>
              A category&apos;s cap covers its subcategories too.
            </Text>
          ) : null}

          {/* Load states, constitution §22 — an empty caps list must not be
              indistinguishable from a failed read. */}
          {!hasLoaded && isLoading ? (
            <Text style={styles.statusText}>Loading categories…</Text>
          ) : null}
          {!hasLoaded && loadError ? (
            <>
              <FormMessage message={loadError} />
              <TextButton label="Retry" onPress={reload} style={styles.retryButton} />
            </>
          ) : null}

          {categories.map((category) => (
            <ListItem
              key={category.id}
              leading={<IconBadge glyph={category.glyph} tone="neutral" size="small" />}
              title={category.name}
              trailing={
                <TextInput
                  value={getCapDisplayValue(category)}
                  onChangeText={(value) => handleCapChange(category.id, value)}
                  placeholder="No cap"
                  keyboardType="decimal-pad"
                  style={styles.capField}
                />
              }
            />
          ))}

          <ListItem
            title="Add Category"
            onPress={() => setIsAddCategoryFormOpen((prev) => !prev)}
            style={styles.addCategoryRow}
          />

          {isAddCategoryFormOpen ? (
            <View style={styles.addCategoryForm}>
              <TextInput
                label="NAME"
                value={addCategoryName}
                onChangeText={(value) => {
                  setAddCategoryName(value);
                  if (addCategoryError) {
                    setAddCategoryError(null);
                  }
                }}
                placeholder="New category name"
                error={addCategoryError}
                style={styles.addCategoryInput}
              />
              <PrimaryButton
                label="Add Category"
                glow={false}
                onPress={handleAddCategory}
                // Nothing may be created before the list is known: there are
                // no siblings to check the name against until then.
                disabled={!hasLoaded}
                loading={isCreating}
                style={styles.addCategoryButton}
              />
            </View>
          ) : null}
        </Card>

        <FormMessage message={saveError} />
        <PrimaryButton
          label="Update Budget Settings"
          onPress={handleSave}
          disabled={isSaving || !hasLoaded}
          loading={isSaving}
          style={styles.saveButton}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(theme, insets) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    container: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
      // Sized for the tab-bar case (the ProfileStack push). In the
      // root-level mandatory-gate case no tab bar is mounted, so this is
      // simply extra trailing room — unchanged from the pre-safe-area
      // behavior, and still guaranteed to clear the bottom system bar.
      paddingBottom: getTabBarTopEdge(theme, insets) + theme.space.lg,
    },
    card: {
      marginBottom: theme.space.xl,
    },
    label: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      lineHeight: theme.type.label.lineHeight,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.xs,
    },
    periodControl: {
      marginBottom: theme.space.lg,
    },
    dateContainer: {
      marginBottom: theme.space.lg,
    },
    dateField: {
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: theme.color.border.subtle,
      paddingBottom: theme.space.sm,
      minHeight: 40,
    },
    dateIcon: {
      color: theme.color.text.tertiary,
      fontSize: 16,
      marginRight: theme.space.sm,
    },
    dateText: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    errorText: {
      color: theme.color.status.negative,
      fontSize: theme.type.caption.fontSize,
      marginBottom: theme.space.md,
    },
    amountField: {
      marginBottom: 0,
    },
    sectionHeader: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      lineHeight: theme.type.h2.lineHeight,
      fontWeight: theme.type.h2.fontWeight,
      marginBottom: theme.space.sm,
    },
    sectionNote: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginBottom: theme.space.sm,
    },
    statusText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      marginBottom: theme.space.sm,
    },
    retryButton: {
      alignSelf: 'center',
    },
    capField: {
      width: 90,
      marginBottom: 0,
    },
    addCategoryRow: {
      borderTopWidth: 1,
      borderTopColor: theme.color.border.subtle,
      marginTop: theme.space.xs,
      paddingTop: theme.space.sm,
    },
    addCategoryForm: {
      marginTop: theme.space.sm,
      backgroundColor: theme.color.background.surfaceAlt,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.space.md,
      paddingTop: theme.space.md,
      paddingBottom: theme.space.sm,
    },
    addCategoryInput: {
      marginBottom: theme.space.sm,
    },
    addCategoryButton: {
      alignSelf: 'flex-start',
    },
    saveButton: {
      marginTop: theme.space.md,
      marginBottom: theme.space.lg,
    },
  });
}

export default BudgetSettingsScreen;
