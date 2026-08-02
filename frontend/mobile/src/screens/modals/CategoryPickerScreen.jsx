import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import SearchBar from '../../components/SearchBar';
import TextInput from '../../components/TextInput';
import PrimaryButton from '../../components/PrimaryButton';
import IconBadge from '../../components/IconBadge';
import { useCategoriesStore } from '../../store/useCategoriesStore';
import { recentCategoryIds } from '../../mocks/categoryMocks';
import { isDuplicateCategoryName, buildCategoryFromName } from '../../utils/categories';

/**
 * Category Picker — root-level modal, pushed on top of either the Add
 * Expense modal or (as of docs/decisions/0005-split-add-expense-flow.md §3)
 * the Split Add Expense modal (docs/architecture/frontend-navigation.md
 * Section 2.4). Selecting any category (recent, all, or a newly added
 * custom one) returns to whichever screen opened this one via
 * navigation.popTo(returnTo, { selectedCategory }) — the same "return a
 * value from a nested screen" pattern, now parameterized by a `returnTo`
 * route param (defaulting to 'AddExpense', preserving the original
 * caller's behavior unchanged) so this one shared screen correctly returns
 * to whichever of its two possible callers actually opened it, instead of
 * always assuming Add Expense. Category data source (docs/decisions/
 * 0010-budget-settings.md §1): this screen reads/writes the shared
 * useCategoriesStore, not a static mock array — there is no category API.
 *
 * NOTE on icons: category tiles below render via the existing IconBadge
 * component's `glyph` (single-character Text) prop, not real Ionicons.
 * docs/decisions/0002-icon-library-selection.md (react-native-vector-icons,
 * Ionicons) is an approved ADR, but as of this screen's implementation the
 * dependency has not actually been installed/linked and IconBadge/
 * ScreenHeader/SearchBar/MainTabs/TextInput still render Unicode/Text
 * placeholders throughout the rest of the app — installing and natively
 * linking a font module isn't achievable without shell/build tool access in
 * this session, and shipping an `import ... from 'react-native-vector-icons/Ionicons'`
 * without the package actually present would break the Metro bundle for
 * every screen using IconBadge. Each mock category still carries the
 * correct approved `iconName` (design-system.md Section 6) so no data
 * reshaping is needed once that swap is actually completed. Flagged as
 * outstanding follow-up in this round's report.
 *
 * "Add Custom" categories now persist for the rest of the session via
 * useCategoriesStore().addCategory — no longer session-only local state —
 * and appear in Budget Settings' own Category Caps list too, closing a
 * previously-flagged gap (ADR 0010 §1).
 */
function CategoryPickerScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const styles = createStyles(theme);

  // Defaults to 'AddExpense' so the original (pre-ADR-0005) caller's
  // behavior is completely unchanged when it doesn't pass returnTo.
  const returnTo = route.params?.returnTo ?? 'AddExpense';

  const allCategories = useCategoriesStore((state) => state.categories);
  const addCategory = useCategoriesStore((state) => state.addCategory);

  const [searchQuery, setSearchQuery] = useState('');
  const [customCategoryName, setCustomCategoryName] = useState('');
  const [customCategoryError, setCustomCategoryError] = useState(null);

  const recentCategories = useMemo(
    () => allCategories.filter((category) => recentCategoryIds.includes(category.id)),
    [allCategories],
  );

  const isSearching = searchQuery.trim().length > 0;

  const filteredCategories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return allCategories;
    }
    return allCategories.filter((category) => category.name.toLowerCase().includes(query));
  }, [allCategories, searchQuery]);

  function handleSelectCategory(category) {
    // React Navigation v7 changed navigate()'s default behavior: calling
    // navigate(returnTo, {...}) here would PUSH a brand-new route instance
    // on top of this one (v7 allows multiple instances of the same screen
    // by default), rather than returning to the existing instance
    // underneath — that fresh instance mounts with blank local form state
    // (amount, name, date, etc. all reset), which is exactly the state-loss
    // bug this was flagged to fix (see docs/decisions/
    // 0003-payment-mode-and-date-tracking.md's 2026-08-10 Amendment, Part
    // D). `popTo` is v7's replacement for the old "navigate to an existing
    // screen goes back to it" behavior: it pops the stack back to the
    // nearest existing `returnTo` route (removing this CategoryPicker
    // route) and merges the given params into it, reusing that screen's
    // already-mounted instance instead of creating a new one. `returnTo` is
    // 'AddExpense' by default, or 'SplitAddExpense' when this screen was
    // opened from within the Split Add Expense flow (ADR 0005 §3) — see
    // this screen's top-of-file note.
    navigation.popTo(returnTo, { selectedCategory: category });
  }

  function handleAddCustomCategory() {
    const name = customCategoryName.trim();
    if (!name) {
      setCustomCategoryError('Enter a category name.');
      return;
    }
    if (isDuplicateCategoryName(allCategories, name)) {
      setCustomCategoryError('That category already exists.');
      return;
    }

    addCategory(buildCategoryFromName(name));
    setCustomCategoryName('');
    setCustomCategoryError(null);
  }

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search categories"
          style={styles.searchBar}
        />

        {!isSearching && recentCategories.length > 0 ? (
          <>
            <Text style={styles.sectionHeader}>Recent Categories</Text>
            <View style={styles.grid}>
              {recentCategories.map((category) => (
                <CategoryTile
                  key={category.id}
                  category={category}
                  theme={theme}
                  onPress={() => handleSelectCategory(category)}
                />
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.sectionHeader}>{isSearching ? 'Results' : 'All Categories'}</Text>
        {filteredCategories.length > 0 ? (
          <View style={styles.grid}>
            {filteredCategories.map((category) => (
              <CategoryTile
                key={category.id}
                category={category}
                theme={theme}
                onPress={() => handleSelectCategory(category)}
              />
            ))}
          </View>
        ) : (
          <Text style={styles.emptyText}>
            No categories match &quot;{searchQuery.trim()}&quot;.
          </Text>
        )}

        <Text style={[styles.sectionHeader, styles.customSectionHeader]}>Add Custom</Text>
        <TextInput
          value={customCategoryName}
          onChangeText={(value) => {
            setCustomCategoryName(value);
            if (customCategoryError) {
              setCustomCategoryError(null);
            }
          }}
          placeholder="New category name"
          error={customCategoryError}
          style={styles.customInput}
        />
        <PrimaryButton
          label="Add Category"
          glow={false}
          onPress={handleAddCustomCategory}
          style={styles.addButton}
        />
      </ScrollView>
    </View>
  );
}

function CategoryTile({ category, theme, onPress }) {
  const styles = createTileStyles(theme);
  return (
    <Pressable style={styles.tile} onPress={onPress} accessibilityRole="button">
      <IconBadge glyph={category.glyph} tone="accent" size="medium" />
      <Text style={styles.tileLabel} numberOfLines={2}>
        {category.name}
      </Text>
    </Pressable>
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
      paddingVertical: theme.space.xxl,
    },
    searchBar: {
      marginBottom: theme.space.xl,
    },
    sectionHeader: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      lineHeight: theme.type.h2.lineHeight,
      fontWeight: theme.type.h2.fontWeight,
      marginBottom: theme.space.md,
    },
    customSectionHeader: {
      marginTop: theme.space.md,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginBottom: theme.space.xl,
    },
    emptyText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      marginBottom: theme.space.xl,
    },
    customInput: {
      marginTop: theme.space.sm,
    },
    addButton: {
      alignSelf: 'flex-start',
    },
  });
}

function createTileStyles(theme) {
  return StyleSheet.create({
    tile: {
      width: '31%',
      marginBottom: theme.space.lg,
      alignItems: 'center',
      backgroundColor: theme.color.background.surface,
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radius.md,
      paddingVertical: theme.space.md,
      paddingHorizontal: theme.space.xs,
    },
    tileLabel: {
      color: theme.color.text.primary,
      fontSize: theme.type.caption.fontSize,
      textAlign: 'center',
      marginTop: theme.space.sm,
    },
  });
}

export default CategoryPickerScreen;
