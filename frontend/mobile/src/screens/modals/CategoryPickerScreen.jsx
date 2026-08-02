import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import SearchBar from '../../components/SearchBar';
import TextInput from '../../components/TextInput';
import PrimaryButton from '../../components/PrimaryButton';
import TextButton from '../../components/TextButton';
import FormMessage from '../../components/FormMessage';
import IconBadge from '../../components/IconBadge';
import ListItem from '../../components/ListItem';
import ExpandChevron from '../../components/ExpandChevron';
import { useCategories } from '../../hooks/useCategories';
import {
  findCategoryByNamePath,
  formatCategoryPath,
  isFinalCategorySelection,
  toCategorySelection,
} from '../../utils/categories';

// ListItem upper-cases badge text itself (its `badgeText` style), so this is
// the sentence-case source value, not the rendered one.
const SELECTED_BADGE = 'Selected';

/**
 * Category Picker — root-level modal, pushed on top of either the Add
 * Expense modal or (as of docs/decisions/0005-split-add-expense-flow.md §3)
 * the Split Add Expense modal (docs/architecture/frontend-navigation.md
 * Section 2.4). Selecting any category returns to whichever screen opened this
 * one via navigation.popTo(returnTo, { selectedCategory }), parameterized by a
 * `returnTo` route param (defaulting to 'AddExpense').
 *
 * **Server-backed as of Domain 3's wiring step** (docs/api/api-overview.md §3,
 * docs/roadmap/backend-build-order.md workflow step 3): the list comes from
 * `GET /categories` and "Add Custom"/"Add Subcategory" POST to it, both
 * through `useCategories()` — screens never import `src/api/*` (ADR 0016 §1).
 *
 * ---
 * **TWO LEVELS** (docs/decisions/0019-subcategories-one-optional-level.md
 * §10.2). The `subcategoriesEnabled` setting decides which of two layouts
 * renders, and the server is not consulted about it either way — it always
 * returns the full tree (§6.1):
 *
 * - **Off: exactly as before.** One grid of top-level tiles, one "Add Custom"
 *   form. Subcategory rows are present in the store and simply not offered —
 *   not deleted, not hidden from the API, nothing destroyed (§6.2).
 * - **On: a list of parent rows.** Tapping a row **selects that parent** (one
 *   tap, the same cost as a tile — ADR 0019's one hard constraint is that
 *   selecting a top-level category must not get more expensive for a parent
 *   with no children), while a separate trailing affordance expands it to show
 *   its subcategories and an inline "Add subcategory" form. Two intents, two
 *   affordances, neither taxing the other. A parent stays a legal selection
 *   even when it has children — a user with `Food › Snacks` may still want
 *   plain `Food`.
 *
 * Search matches against the **full path label**, so "food" finds `Food` and
 * `Food > Lunch`, and "lunch" finds the child. Every subcategory result shows
 * its parent, which is a correctness requirement rather than polish (§3): leaf
 * names are only unique within a parent, so two bare `Lunch` rows would be
 * indistinguishable.
 *
 * ---
 * **TWO OPTIONAL ROUTE PARAMS, BOTH ADDED 2026-10-24** for the Project Owner's
 * subcategory addendum. Same lightweight, backward-compatible pattern as
 * `returnTo` itself and Add Expense's `editingTransactionId`: omit them and
 * this screen behaves exactly as it did before.
 *
 * **Both callers now pass both (2026-10-29).** `SplitAddExpenseScreen` was
 * deliberately left passing neither, and that is precisely what the Project
 * Owner reported as "the subcategory option works differently in the split
 * transaction — there only the main category is chosen": with no
 * `requireSubcategory` a parent row's body selects the parent and pops straight
 * back, so its subcategories were never revealed, and with no
 * `currentSelection` nothing was badged or expanded on re-open. It now passes
 * `currentSelection` and an explicit `requireSubcategory: false` — a
 * subcategory is **offered** there, not demanded (see that screen's
 * `SPLIT_REQUIRES_SUBCATEGORY`).
 *
 * - **`requireSubcategory`** — the caller declaring "I need a category that
 *   cannot be narrowed further." Combined with the preference here
 *   (`requireLeaf = subcategoriesEnabled && requireSubcategory`), so a caller
 *   never has to read the setting to pass the param and the toggle-off layout
 *   is unreachable from it. While it is in force, a **top-level category that
 *   has children stops being selectable** — its row expands instead of
 *   selecting, and it is filtered out of search results. A top-level category
 *   with **no** children stays selectable in one tap, which is both the
 *   addendum's explicit "so the user isn't blocked" escape and ADR 0019
 *   §10.2's hard constraint on tap cost, preserved.
 *
 *   **This is the one place this round contradicts ADR 0019 §10.2's "a parent
 *   is always a legal selection, even when it has children."** The Project
 *   Owner's addendum overrides it for the Add Transaction flow, and it is
 *   flagged for the System Architect rather than quietly diverged from: the ADR
 *   needs an amendment. Note what is *not* contradicted — the flag is still a
 *   pure UI affordance that gates nothing server-side (§6.1), and `POST
 *   /categories` is untouched.
 *
 * - **`currentSelection`** — `{ name, parentCategoryName }` of what the calling
 *   form already holds. It does two things: the owning parent opens expanded,
 *   and the matching row is badged `SELECTED`. That is the addendum's "when
 *   editing an existing transaction, open the selector with the saved category
 *   and subcategory already selected." A **name pair rather than an id**
 *   because Add Expense's edit-mode prefill is reconstructed from a
 *   transaction's frozen snapshot and has no id at all — resolved through the
 *   existing `findCategoryByNamePath`, for its documented reason (a bare leaf
 *   name can match two different rows).
 *
 * "Add Subcategory" reuses the same TextInput + PrimaryButton pattern as "Add
 * Custom" and the same icon/glyph convention (`settings-outline`, first letter
 * upper-cased — `buildCategoryCreateFields`), so **no new icon is introduced**
 * and docs/ui/design-system.md §6 needs no change.
 *
 * ---
 * **The static "Recent Categories" section is gone, and that is a consequence
 * of the wiring rather than a design change.** It filtered the list by
 * `categoryMocks.js`'s `recentCategoryIds` — hardcoded `cat-food`-style mock
 * ids. Server rows carry UUIDs, so that filter can never match again and the
 * section would have rendered empty forever. Removed rather than left as dead
 * markup; the calling forms' own dropdowns offer the shortlist instead —
 * genuinely-most-recent categories first, then the rest of the account's
 * top-level ones (`useCategoryQuickPicks`). This screen is the full list and
 * always renders every category under an "All Categories" header the moment
 * the tree is known; search is an affordance above it, never the initial state.
 * Flagged for the System Architect: if the picker should regain its own Recent
 * section, `useRecentCategories` is now a real data source for one.
 *
 * NOTE on icons: tiles and rows render via IconBadge's `glyph` (single-
 * character Text) prop, not real Ionicons — react-native-vector-icons
 * (docs/decisions/0002-icon-library-selection.md) is approved but still not
 * installed/linked anywhere in this app. Every category carries its approved
 * `iconName` from the server, so no data reshaping is needed once that swap
 * happens.
 */
function CategoryPickerScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const styles = createStyles(theme, insets);

  // Defaults to 'AddExpense' so the original (pre-ADR-0005) caller's
  // behavior is completely unchanged when it doesn't pass returnTo.
  const returnTo = route.params?.returnTo ?? 'AddExpense';
  // Both default to "off", which is what keeps every existing caller's
  // behaviour byte-for-byte — see the two param notes above.
  const requireSubcategory = route.params?.requireSubcategory === true;
  const currentSelection = route.params?.currentSelection ?? null;

  const {
    categories,
    subcategoriesEnabled,
    selectableCategories,
    hasLoaded,
    isLoading,
    loadError,
    isCreating,
    createCategory,
    createSubcategory,
    reload,
  } = useCategories();

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedParentId, setExpandedParentId] = useState(null);
  const [customCategoryName, setCustomCategoryName] = useState('');
  const [customCategoryError, setCustomCategoryError] = useState(null);
  const [subcategoryName, setSubcategoryName] = useState('');
  const [subcategoryError, setSubcategoryError] = useState(null);
  // Which of the two create forms the single in-flight POST belongs to, so
  // only that form's button spins. The store deliberately allows one create at
  // a time (see useCategoriesStore); this is only how that shows up on screen.
  const [pendingForm, setPendingForm] = useState(null);

  const isSearching = searchQuery.trim().length > 0;

  // The caller's intent AND the user's preference. With the preference off
  // this is false however the caller asked, so the toggle-off layout can never
  // be reached in a state that forbids selecting one of its own tiles.
  const requireLeaf = subcategoriesEnabled && requireSubcategory;

  // Matched on the path label rather than the leaf name, so a parent's name
  // finds its children too. `selectableCategories` already respects the
  // toggle, so with it off this searches top-level rows only and no filter is
  // written here (ADR 0019 §6.1).
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return [];
    }
    return selectableCategories.filter((entry) => {
      // Nothing unselectable is ever offered (§6.1's own principle, applied to
      // the new rule): searching "food" while a leaf is required returns
      // `Food > Lunch` and `Food > Snacks` but not `Food` itself, since tapping
      // `Food` could not have produced a saveable selection. A childless
      // top-level category is still returned — it IS final.
      if (requireLeaf && !isFinalCategorySelection(entry)) {
        return false;
      }
      return formatCategoryPath(entry.parentCategoryName, entry.name)
        .toLowerCase()
        .includes(query);
    });
  }, [selectableCategories, searchQuery, requireLeaf]);

  /**
   * The id of the row the calling form already holds, or null. Resolved by name
   * pair because an edit-mode prefill has no id (see the `currentSelection`
   * note above).
   */
  const selectedCategoryId = useMemo(() => {
    if (!currentSelection?.name) {
      return null;
    }
    const match = findCategoryByNamePath(
      categories,
      currentSelection.parentCategoryName,
      currentSelection.name,
    );
    return match?.id ?? null;
  }, [categories, currentSelection]);

  // Opens the right parent once, as soon as the tree is known — the tree is
  // not loaded at mount, so this cannot be a lazy initial state. Ref-guarded
  // rather than keyed on the selection, so the user's own first collapse is
  // never undone by a re-render.
  const hasAppliedInitialExpansion = useRef(false);
  useEffect(() => {
    if (hasAppliedInitialExpansion.current || !hasLoaded) {
      return;
    }
    hasAppliedInitialExpansion.current = true;
    setExpandedParentId(getInitialExpandedParentId(categories, currentSelection));
  }, [hasLoaded, categories, currentSelection]);

  function handleSelectCategory(selection) {
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
    // route) and applies the given params to it, reusing that screen's
    // already-mounted instance instead of creating a new one.
    //
    // `selection` always carries `parentCategoryName` (null at the top level)
    // so the receiving screen can render the full path and snapshot it onto
    // the transaction without looking anything up.
    //
    // **`{ merge: true }` is required, not decoration (fix, 2026-10-29).**
    //
    // Verified against the installed router rather than assumed
    // (node_modules/@react-navigation/routers/lib/module/StackRouter.js, the
    // `POP_TO` case): with the flag, the destination keeps its own params and
    // the action's are layered on top — `{ ...routeParamList[name],
    // ...route.params, ...action.payload.params }`. **Without it, the branch
    // taken is `createParamsFromAction`, which REPLACES them**, so every param
    // the destination already held is lost. The same file also shows the object
    // form is the current one: a boolean third argument logs a deprecation
    // warning.
    //
    // Add Expense holds exactly one such param and it decides which request
    // Save makes: `editingTransactionId` (set by TransactionDetailScreen's
    // Edit). Choosing a category while editing therefore wiped it, and the form
    // silently fell back to create mode — header and button copy reverted,
    // edit-mode grandfathering switched off, and Save POSTed a brand-new
    // transaction instead of PATCHing the one being edited, leaving the edited
    // row untouched. Nothing about the merge changes which route is returned to
    // or whether it remounts: `POP_TO` resolves the target and reuses
    // `state.routes[index]` identically either way.
    //
    // `SplitAddExpense`'s own params (`initialSplitMode`, `splitConfig`,
    // `selectedGroup`) are all consumed at mount or cleared by their effects,
    // so that caller was never visibly broken by the replacement — but it is
    // the same trap, and it is now closed for both.
    navigation.popTo(returnTo, { selectedCategory: selection }, { merge: true });
  }

  function handleToggleExpanded(parentId) {
    setExpandedParentId((previous) => (previous === parentId ? null : parentId));
    // One draft at a time, since one parent is expanded at a time — reset it
    // so a name typed under `Food` can't reappear under `Transport`.
    setSubcategoryName('');
    setSubcategoryError(null);
  }

  async function handleAddCustomCategory() {
    setPendingForm('custom');
    const { success, error } = await createCategory(customCategoryName);
    setPendingForm(null);
    if (success) {
      setCustomCategoryName('');
      setCustomCategoryError(null);
      return;
    }
    // `error` is null when the store refused the write because the session
    // ended mid-request — there is nothing useful to say on a screen that is
    // being torn down (see errorMessages.isSessionTerminalError).
    setCustomCategoryError(error);
  }

  async function handleAddSubcategory(parentId) {
    setPendingForm('subcategory');
    const { success, error } = await createSubcategory(parentId, subcategoryName);
    setPendingForm(null);
    if (success) {
      setSubcategoryName('');
      setSubcategoryError(null);
      return;
    }
    setSubcategoryError(error);
  }

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search categories"
          style={styles.searchBar}
        />

        {/* Load states, constitution §22: a failure says so and offers a
            retry rather than rendering an empty grid that reads as "you have
            no categories". */}
        {!hasLoaded && isLoading ? (
          <Text style={styles.statusText}>Loading categories…</Text>
        ) : null}
        {!hasLoaded && loadError ? (
          <View>
            <FormMessage message={loadError} />
            <TextButton label="Retry" onPress={reload} style={styles.retryButton} />
          </View>
        ) : null}

        {hasLoaded ? (
          <>
            <Text style={styles.sectionHeader}>{isSearching ? 'Results' : 'All Categories'}</Text>

            {/* Says why a category that has subcategories can no longer be
                tapped, at the moment it stops being tappable — rather than
                leaving the user to discover it by tapping (constitution §22).
                Only rendered while the rule is actually in force. */}
            {requireLeaf ? (
              <Text style={styles.ruleNote}>
                Pick a subcategory. A category with no subcategories can be picked on its own.
              </Text>
            ) : null}

            {isSearching ? (
              <SearchResults
                results={searchResults}
                query={searchQuery.trim()}
                useTiles={!subcategoriesEnabled}
                selectedCategoryId={selectedCategoryId}
                onSelect={handleSelectCategory}
              />
            ) : categories.length === 0 ? (
              <Text style={styles.emptyText}>
                No categories yet. Add your first one below.
              </Text>
            ) : subcategoriesEnabled ? (
              <View style={styles.rowGroup}>
                {categories.map((category) => (
                  <ParentCategoryRow
                    key={category.id}
                    category={category}
                    isExpanded={expandedParentId === category.id}
                    // A parent that can still be narrowed is not a legal
                    // choice while a leaf is required; a childless one always
                    // is. One call, so the rule has one home.
                    canSelect={!requireLeaf || isFinalCategorySelection(category)}
                    selectedCategoryId={selectedCategoryId}
                    isBusy={isCreating}
                    isSubmitting={isCreating && pendingForm === 'subcategory'}
                    subcategoryName={subcategoryName}
                    subcategoryError={subcategoryError}
                    onToggleExpanded={() => handleToggleExpanded(category.id)}
                    onSelect={() => handleSelectCategory(toCategorySelection(category, null))}
                    onSelectSubcategory={(subcategory) =>
                      handleSelectCategory(toCategorySelection(subcategory, category.name))
                    }
                    onChangeSubcategoryName={(value) => {
                      setSubcategoryName(value);
                      if (subcategoryError) {
                        setSubcategoryError(null);
                      }
                    }}
                    onSubmitSubcategory={() => handleAddSubcategory(category.id)}
                  />
                ))}
              </View>
            ) : (
              <CategoryTileGrid
                categories={categories}
                selectedCategoryId={selectedCategoryId}
                onSelect={(category) => handleSelectCategory(toCategorySelection(category, null))}
              />
            )}
          </>
        ) : null}

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
          // Nothing may be created before the list is known: the duplicate-name
          // check has no siblings to compare against until then.
          disabled={!hasLoaded || isCreating}
          loading={isCreating && pendingForm === 'custom'}
          style={styles.addButton}
        />
      </ScrollView>
    </View>
  );
}

/**
 * Which parent's subcategories should already be open when this screen appears,
 * or `null` for none. Pure, so the effect above stays three lines.
 *
 * Two cases, both from the Project Owner's addendum:
 *
 * - **The form already holds a subcategory** (editing a transaction tagged to
 *   one): open its parent, so the saved child is visible and badged rather than
 *   hidden one tap away.
 * - **The form holds a main category that has subcategories** (the user just
 *   tapped a quick-pick category that has children): open it, which is
 *   literally "the app then immediately shows that category's subcategories to
 *   choose from."
 *
 * Everything else opens collapsed, exactly as the picker always has — a
 * category with no children has nothing to reveal.
 *
 * **The second case no longer depends on a leaf being required (2026-10-29).**
 * It used to return `null` unless `requireLeaf` was in force, which made the
 * same picker behave differently for the Split flow, where a subcategory is
 * offered rather than demanded: a chosen parent opened collapsed, so its
 * subcategories stayed hidden behind the trailing chevron and the user
 * concluded only main categories could be chosen there. Revealing them is a
 * presentation decision and is safe either way — a parent stays selectable
 * whenever the caller allows it (`canSelect`), so this expands an offer without
 * narrowing a choice.
 *
 * @param {object[]} categories The live top-level array.
 * @param {{ name: string, parentCategoryName: string | null } | null} currentSelection
 * @returns {string | null}
 */
function getInitialExpandedParentId(categories, currentSelection) {
  if (!currentSelection?.name) {
    return null;
  }
  if (currentSelection.parentCategoryName) {
    const parent = categories.find(
      (category) => category.name === currentSelection.parentCategoryName,
    );
    return parent?.id ?? null;
  }
  const liveCategory = findCategoryByNamePath(categories, null, currentSelection.name);
  if (!liveCategory || isFinalCategorySelection(liveCategory)) {
    return null;
  }
  return liveCategory.id;
}

/**
 * Search results. Rows (with the full path) when subcategories are on, tiles
 * when they are off — which keeps the toggle-off picker pixel-identical to
 * what shipped, while guaranteeing a subcategory result never appears without
 * its parent (ADR 0019 §3).
 *
 * The caller has already dropped anything unselectable from `results`, so
 * every row here is tappable; this component needs no knowledge of the rule.
 */
function SearchResults({ results, query, useTiles, selectedCategoryId, onSelect }) {
  const theme = useTheme();
  const styles = createResultsStyles(theme);

  if (results.length === 0) {
    return <Text style={styles.emptyText}>No categories match &quot;{query}&quot;.</Text>;
  }

  if (useTiles) {
    return (
      <CategoryTileGrid
        categories={results}
        selectedCategoryId={selectedCategoryId}
        onSelect={onSelect}
      />
    );
  }

  return (
    <View style={styles.rowGroup}>
      {results.map((entry) => (
        <ListItem
          key={entry.id}
          leading={<IconBadge glyph={entry.glyph} tone="accent" size="small" />}
          title={formatCategoryPath(entry.parentCategoryName, entry.name)}
          badges={entry.id === selectedCategoryId ? [SELECTED_BADGE] : undefined}
          onPress={() => onSelect(entry)}
        />
      ))}
    </View>
  );
}

/**
 * One top-level category when subcategories are on: the row body selects it,
 * the trailing chevron expands its children and the inline add form. The two
 * are separate press targets on purpose — tapping a parent must never cost an
 * extra tap just because the feature is enabled.
 *
 * The chevron itself moved to `components/ExpandChevron.jsx` on 2026-10-23,
 * when ManageCategoriesScreen became the second surface to disclose
 * subcategories (constitution §25). Behavior here is unchanged — it is still
 * its own press target, with the same label and glyph.
 *
 * **`canSelect: false` (2026-10-24) turns the row body into a second expand
 * target** instead of a selection, which is how a parent that still needs
 * narrowing behaves while a leaf is required. Nothing is greyed out and nothing
 * silently does nothing: the tap does the one useful thing left, which is to
 * reveal the subcategories the user has to choose from — the same whole-row
 * toggle ManageCategoriesScreen's accordion already uses. The chevron keeps its
 * own labelled, expand-stateful target either way. The caller decides; this
 * component never reads the preference.
 */
function ParentCategoryRow({
  category,
  isExpanded,
  canSelect,
  selectedCategoryId,
  isBusy,
  isSubmitting,
  subcategoryName,
  subcategoryError,
  onToggleExpanded,
  onSelect,
  onSelectSubcategory,
  onChangeSubcategoryName,
  onSubmitSubcategory,
}) {
  const theme = useTheme();
  const styles = createParentRowStyles(theme);
  const subcategories = category.subcategories ?? [];
  const subcategoryCountLabel =
    subcategories.length === 1 ? '1 subcategory' : `${subcategories.length} subcategories`;

  return (
    <View>
      <ListItem
        leading={<IconBadge glyph={category.glyph} tone="accent" size="small" />}
        title={category.name}
        subtitle={subcategories.length > 0 ? subcategoryCountLabel : undefined}
        badges={category.id === selectedCategoryId ? [SELECTED_BADGE] : undefined}
        onPress={canSelect ? onSelect : onToggleExpanded}
        trailing={
          <ExpandChevron
            isExpanded={isExpanded}
            onPress={onToggleExpanded}
            accessibilityLabel={
              isExpanded
                ? `Hide subcategories of ${category.name}`
                : `Show subcategories of ${category.name}`
            }
          />
        }
      />

      {isExpanded ? (
        <View style={styles.expandedBlock}>
          {subcategories.map((subcategory) => (
            <ListItem
              key={subcategory.id}
              leading={<IconBadge glyph={subcategory.glyph} tone="accent" size="small" />}
              // The parent is the row above, so the child shows its own name
              // here; every surface *outside* this nesting renders the full
              // path instead (the picker's search results, Add Expense's
              // trigger and recent list, Dashboard, Transaction Detail).
              title={subcategory.name}
              badges={subcategory.id === selectedCategoryId ? [SELECTED_BADGE] : undefined}
              onPress={() => onSelectSubcategory(subcategory)}
            />
          ))}

          <TextInput
            value={subcategoryName}
            onChangeText={onChangeSubcategoryName}
            placeholder={`New subcategory in ${category.name}`}
            error={subcategoryError}
            style={styles.subcategoryInput}
          />
          <PrimaryButton
            label="Add Subcategory"
            glow={false}
            onPress={onSubmitSubcategory}
            // One create at a time across both forms (useCategoriesStore's
            // single `isCreating` slot), so the other form's in-flight write
            // disables this button without spinning it.
            disabled={isBusy}
            loading={isSubmitting}
            style={styles.subcategoryButton}
          />
        </View>
      ) : null}
    </View>
  );
}

function CategoryTileGrid({ categories, selectedCategoryId, onSelect }) {
  const theme = useTheme();
  const styles = createGridStyles(theme);
  return (
    <View style={styles.grid}>
      {categories.map((category) => (
        <CategoryTile
          key={category.id}
          category={category}
          isSelected={category.id === selectedCategoryId}
          onPress={() => onSelect(category)}
        />
      ))}
    </View>
  );
}

/**
 * `isSelected` (2026-10-24) draws the tile's existing border in the accent
 * colour instead of the subtle one — the tile equivalent of the row layouts'
 * `SELECTED` badge, so "open the selector with the saved category already
 * selected" also holds in the toggle-off grid. Border colour only: no new
 * token, no size or layout change, so an unselected grid renders exactly as it
 * did.
 */
function CategoryTile({ category, isSelected, onPress }) {
  const theme = useTheme();
  const styles = createTileStyles(theme);
  return (
    <Pressable
      style={[styles.tile, isSelected && styles.tileSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
    >
      <IconBadge glyph={category.glyph} tone="accent" size="medium" />
      <Text style={styles.tileLabel} numberOfLines={2}>
        {/* A tile only ever shows a top-level name when subcategories are
            off; in search results with them on, results render as rows
            instead, so the path is never truncated into a tile. */}
        {category.name}
      </Text>
    </Pressable>
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
      // This is the one route in the app that keeps the native header
      // (RootNavigator.jsx, `headerShown: true`), so the TOP inset is
      // already handled for it and must not be added again here — only the
      // bottom needs work, so the "Add Category" button clears the bottom
      // system bar. 0 where there is no bar.
      paddingTop: theme.space.xxl,
      paddingBottom: theme.space.xxl + insets.bottom,
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
    // Sits between the section header and the list, so it reads as a caption
    // on the list rather than a warning about the screen. Same treatment as
    // ManageCategoriesScreen's `sectionNote`.
    ruleNote: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginBottom: theme.space.md,
    },
    customSectionHeader: {
      marginTop: theme.space.md,
    },
    rowGroup: {
      marginBottom: theme.space.xl,
    },
    statusText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      marginBottom: theme.space.xl,
    },
    retryButton: {
      alignSelf: 'center',
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

function createResultsStyles(theme) {
  return StyleSheet.create({
    rowGroup: {
      marginBottom: theme.space.xl,
    },
    emptyText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      marginBottom: theme.space.xl,
    },
  });
}

function createGridStyles(theme) {
  return StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginBottom: theme.space.xl,
    },
  });
}

function createParentRowStyles(theme) {
  return StyleSheet.create({
    expandedBlock: {
      marginLeft: theme.space.xl,
      marginBottom: theme.space.sm,
      backgroundColor: theme.color.background.surfaceAlt,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.space.md,
      paddingTop: theme.space.sm,
      paddingBottom: theme.space.md,
    },
    subcategoryInput: {
      marginTop: theme.space.sm,
    },
    subcategoryButton: {
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
    tileSelected: {
      borderColor: theme.color.accent.primary,
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
