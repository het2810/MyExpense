import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { useAuthStore } from '../../store/useAuthStore';
import Card from '../../components/Card';
import TextInput from '../../components/TextInput';
import PrimaryButton from '../../components/PrimaryButton';
import TextButton from '../../components/TextButton';
import FormMessage from '../../components/FormMessage';

const SESSION_EXPIRED_NOTICE = 'Your session has expired. Please sign in again.';

/**
 * Sign In — docs/ui/design-system.md Section 4.1.
 *
 * Wired to POST /api/v1/auth/login as of docs/decisions/
 * 0016-frontend-api-integration.md §9. The layout is unchanged; what changed
 * is where the data comes from and what happens while it is in flight.
 *
 * This screen deliberately imports no `src/api/` module (ADR 0016 §1) — all
 * orchestration, validation and error mapping live in useAuthStore. It does
 * not navigate on success either: `isAuthenticated` flipping drives
 * RootNavigator, exactly as before (ADR 0011 §3).
 */
function SignInScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const submitSignIn = useAuthStore((state) => state.submitSignIn);
  const { isSubmitting, formError, fieldErrors } = useAuthStore((state) => state.signIn);
  const sessionEndedReason = useAuthStore((state) => state.sessionEndedReason);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const styles = createStyles(theme, insets);

  // Informational, not an error: set when sign-up registered the account but
  // the follow-up login failed (ADR 0016 §9.2). Carried as a route param
  // rather than store state so useAuthStore's shape stays exactly as §7
  // specifies.
  const accountCreatedNotice = route.params?.notice || null;

  function handleSignIn() {
    // Not awaited: the store owns the in-flight state this screen renders,
    // and there is nothing for the screen to do afterwards.
    submitSignIn(email.trim(), password);
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandBlock}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>M</Text>
          </View>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>
            Sign in to continue managing your money.
          </Text>
        </View>

        <Card style={styles.card}>
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
            style={styles.lastField}
          />
          <TextButton
            label="Forgot password?"
            align="right"
            onPress={() => navigation.navigate('ForgotPassword')}
          />
        </Card>

        {/* One form-level slot, in priority order: a live submit failure
            first, then a forced-logout notice, then the account-created
            hand-off from Sign Up. Only one is ever meaningful at a time. */}
        {formError ? (
          <FormMessage message={formError} />
        ) : sessionEndedReason ? (
          <FormMessage message={SESSION_EXPIRED_NOTICE} />
        ) : (
          <FormMessage message={accountCreatedNotice} tone="neutral" />
        )}

        <PrimaryButton
          label="Sign In"
          onPress={handleSignIn}
          loading={isSubmitting}
          disabled={isSubmitting}
          style={styles.submitButton}
        />

        <View style={styles.crossLinkRow}>
          <Text style={styles.crossLinkText}>Don&apos;t have an account? </Text>
          <TextButton
            label="Sign Up"
            inline
            onPress={() => navigation.navigate('SignUp')}
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
      justifyContent: 'center',
      paddingHorizontal: theme.space.xl,
      // Sign In is the only signed-out screen that renders no ScreenHeader
      // (design-system.md Section 4.1), so it has nothing above it holding
      // the status bar off — it takes both insets itself. The content is
      // vertically centered, so these only bite once the form grows taller
      // than the viewport (small screens, or with the keyboard up) and it
      // starts to scroll; without them the brand mark can slide under the
      // status bar and the "Sign Up" link under the navigation bar.
      paddingTop: theme.space.xxxl + insets.top,
      paddingBottom: theme.space.xxxl + insets.bottom,
    },
    brandBlock: {
      alignItems: 'center',
      marginBottom: theme.space.xxxl,
    },
    logoCircle: {
      width: 56,
      height: 56,
      borderRadius: theme.radius.circle,
      backgroundColor: theme.color.accent.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.space.lg,
    },
    logoText: {
      color: theme.color.accent.onPrimary,
      fontSize: 24,
      fontWeight: '700',
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
      textAlign: 'center',
    },
    card: {
      marginBottom: theme.space.xxl,
    },
    lastField: {
      marginBottom: theme.space.sm,
    },
    submitButton: {
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

export default SignInScreen;
