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
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useBudgetStore } from '../../store/useBudgetStore';
import { useCategoriesStore } from '../../store/useCategoriesStore';
import { isDuplicateCategoryName, buildCategoryFromName } from '../../utils/categories';
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
 *   `onComplete()` in addition to the normal `setPeriod` write, which is
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
 * Category Caps (ADR 0010 §2/§3): reads/writes useCategoriesStore's
 * standing `monthlyCap` per category live, as the user types — Save then
 * snapshots every category with a non-null monthlyCap into the saved
 * period's own `categoryCaps` array (a copy, not a live reference — ADR
 * 0010 §3's explicit snapshot decision).
 */
function BudgetSettingsScreen({ isMandatory = false, onComplete } = {}) {
  const theme = useTheme();
  const navigation = useNavigation();
  const styles = createStyles(theme);

  const activePeriod = useBudgetStore((state) => state.activePeriod);
  const setPeriod = useBudgetStore((state) => state.setPeriod);
  const categories = useCategoriesStore((state) => state.categories);
  const addCategory = useCategoriesStore((state) => state.addCategory);
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

  const [capDrafts, setCapDrafts] = useState({});
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

  function handleAddCategory() {
    const name = addCategoryName.trim();
    if (!name) {
      setAddCategoryError('Enter a category name.');
      return;
    }
    if (isDuplicateCategoryName(categories, name)) {
      setAddCategoryError('That category already exists.');
      return;
    }

    addCategory(buildCategoryFromName(name));
    setAddCategoryName('');
    setAddCategoryError(null);
    setIsAddCategoryFormOpen(false);
  }

  function handleSave() {
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

    // Snapshot, not a live reference (ADR 0010 §3) — only categories with a
    // non-null standing cap at save time are included.
    const categoryCaps = categories
      .filter((category) => category.monthlyCap != null)
      .map((category) => ({
        categoryId: category.id,
        categoryName: category.name,
        monthlyCap: category.monthlyCap,
      }));

    const periodId = isEditingInPlace && activePeriod ? activePeriod.id : `budget-period-${Date.now()}`;

    setPeriod({
      id: periodId,
      periodType,
      startDate,
      endDate,
      amount: parsedAmount,
      categoryCaps,
    });

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
                style={styles.addCategoryButton}
              />
            </View>
          ) : null}
        </Card>

        <PrimaryButton
          label="Update Budget Settings"
          onPress={handleSave}
          style={styles.saveButton}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    container: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
      paddingBottom: getTabBarTopEdge(theme) + theme.space.lg,
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
