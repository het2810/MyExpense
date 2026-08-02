import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { useAuthStore } from '../../store/useAuthStore';
import { useBudgetStore } from '../../store/useBudgetStore';
import Card from '../../components/Card';
import TextInput from '../../components/TextInput';
import PrimaryButton from '../../components/PrimaryButton';
import TextButton from '../../components/TextButton';
import ScreenHeader from '../../components/ScreenHeader';
import FormMessage from '../../components/FormMessage';

/**
 * Sign Up — docs/ui/design-system.md Section 4.2.
 *
 * Wired as of docs/decisions/0016-frontend-api-integration.md §9.2. Sign-up
 * is TWO sequential calls presented as one user-visible operation —
 * POST /register (which returns a UserResponse and no tokens) followed by
 * POST /login — so ADR 0011 §6's approved "sign-up always proceeds into the
 * mandatory budget gate" behavior is preserved. That orchestration lives in
 * useAuthStore, not here (constitution §8).
 *
 * `confirmPassword` remains a client-side-only convenience field (match-check
 * against `password`) — per the design doc's explicit flag, it is never sent
 * to the Register API.
 *
 * No navigation call happens on success — RootNavigator's own one-shot
 * effect, triggered by isAuthenticated flipping true, computes and applies
 * the post-auth destination.
 */
function SignUpScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const submitSignUp = useAuthStore((state) => state.submitSignUp);
  const { isSubmitting, formError, fieldErrors } = useAuthStore((state) => state.signUp);
  const clearPeriod = useBudgetStore((state) => state.clearPeriod);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState(null);
  const styles = createStyles(theme, insets);

  async function handleSignUp() {
    if (password !== confirmPassword) {
      setConfirmPasswordError('Passwords do not match.');
      return;
    }
    setConfirmPasswordError(null);

    // ORDERING HAZARD — docs/decisions/0016-frontend-api-integration.md §9.2,
    // narrowing ADR 0011 §6's "either order" note. submitSignUp is now async
    // and flips isAuthenticated when login resolves, so a clearPeriod() call
    // placed AFTER the await could run after RootNavigator's post-auth effect
    // had already read a stale activePeriod. It must run before the await.
    //
    // The reset itself is unchanged (ADR 0011 §6): useBudgetStore is a
    // single, global, in-memory store with no per-account isolation yet, and
    // discarding a stale period here is what makes Sign Up's "always
    // mandatory Budget Settings" guarantee unconditional rather than
    // accidentally-usually-true. The accepted wrinkle is that a failed
    // sign-up now also clears it; nothing persists that period, and the
    // workaround disappears when Domain 5 brings real budget data.
    clearPeriod();

    const result = await submitSignUp({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      password,
    });

    // Register succeeded but the follow-up login did not (e.g. login's own
    // per-account rate limit). The account EXISTS, so retrying this form
    // would return 409 EMAIL_ALREADY_EXISTS — send the user to Sign In with
    // an honest message instead (ADR 0016 §9.2).
    if (!result.success && result.accountCreated) {
      navigation.navigate('SignIn', { notice: result.formError });
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandBlock}>
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>
            Start tracking your expenses smarter.
          </Text>
        </View>

        <Card>
          <View style={styles.nameRow}>
            <TextInput
              label="FIRST NAME"
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Jane"
              editable={!isSubmitting}
              error={fieldErrors.firstName}
              style={styles.nameField}
            />
            <TextInput
              label="LAST NAME"
              value={lastName}
              onChangeText={setLastName}
              placeholder="Doe"
              editable={!isSubmitting}
              error={fieldErrors.lastName}
              style={styles.nameField}
            />
          </View>
          <TextInput
            label="EMAIL"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            editable={!isSubmitting}
            error={fieldErrors.email}
          />
          <TextInput
            label="PASSWORD"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            editable={!isSubmitting}
            error={fieldErrors.password}
            helperText={
              fieldErrors.password
                ? undefined
                : 'Min 8 characters, with uppercase, lowercase, and a number'
            }
          />
          <TextInput
            label="CONFIRM PASSWORD"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="••••••••"
            secureTextEntry
            editable={!isSubmitting}
            error={confirmPasswordError}
            style={styles.lastField}
          />
        </Card>

        <FormMessage message={formError} style={styles.formMessage} />

        <PrimaryButton
          label="Create Account"
          onPress={handleSignUp}
          loading={isSubmitting}
          disabled={isSubmitting}
          style={styles.submitButton}
        />

        <View style={styles.crossLinkRow}>
          <Text style={styles.crossLinkText}>Already have an account? </Text>
          <TextButton
            label="Sign In"
            inline
            onPress={() => navigation.navigate('SignIn')}
          />
        </View>
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
      // ScreenHeader above already owns the top inset; only the trailing
      // edge is this container's problem, so the "Sign In" cross-link at the
      // end of the form clears the bottom system bar. 0 where there is none.
      paddingBottom: theme.space.xxxl + insets.bottom,
    },
    brandBlock: {
      marginBottom: theme.space.xxl,
    },
    title: {
      color: theme.color.text.primary,
      fontSize: theme.type.h1.fontSize,
      lineHeight: theme.type.h1.lineHeight,
      fontWeight: theme.type.h1.fontWeight,
      marginBottom: theme.space.xs,
    },
    subtitle: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    nameRow: {
      flexDirection: 'row',
      gap: theme.space.md,
    },
    nameField: {
      flex: 1,
    },
    lastField: {
      marginBottom: theme.space.sm,
    },
    formMessage: {
      marginTop: theme.space.lg,
    },
    submitButton: {
      marginTop: theme.space.md,
      marginBottom: theme.space.xxl,
    },
    crossLinkRow: {
      flexDirection: 'row',
      justifyContent: 'center',
    },
    crossLinkText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
    },
  });
}

export default SignUpScreen;
