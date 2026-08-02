import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { useAuthStore } from '../../store/useAuthStore';
import Card from '../../components/Card';
import TextInput from '../../components/TextInput';
import PrimaryButton from '../../components/PrimaryButton';
import TextButton from '../../components/TextButton';
import ScreenHeader from '../../components/ScreenHeader';
import FormMessage from '../../components/FormMessage';

// Fallback only. The server owns this wording for anti-enumeration reasons
// (docs/api/authentication-api.md §5), so its MessageResponse.message is
// preferred whenever it is present — ADR 0016 §9.3.
const DEFAULT_CONFIRMATION =
  'If an account exists for this email, a password reset link has been sent.';

/**
 * Forgot Password — docs/ui/design-system.md Section 4.3.
 *
 * Wired to POST /api/v1/auth/forgot-password as of docs/decisions/
 * 0016-frontend-api-integration.md §9.3. This screen only ever REQUESTS a
 * reset: completing one needs a token that arrives by email, and email
 * delivery is still a `[DEV EMAIL STUB]` log line on the backend, so
 * reset-password is deliberately deferred (ADR 0016 §13 — flagged there as a
 * pre-release blocker, not a nice-to-have).
 *
 * The confirmation is shown ONLY on success. It previously flipped
 * unconditionally; telling a user "a reset link has been sent" when the
 * request never left the device would leave them waiting for an email that
 * was never requested.
 *
 * This screen gained a store on purpose (ADR 0016 §1): a rule of "screens
 * never import src/api/ except Forgot Password" is a rule nobody enforces.
 */
function ForgotPasswordScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const submitPasswordResetRequest = useAuthStore((state) => state.submitPasswordResetRequest);
  const { isSubmitting, formError, fieldErrors, confirmationMessage } = useAuthStore(
    (state) => state.forgotPassword,
  );
  const [email, setEmail] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const styles = createStyles(theme, insets);

  async function handleSubmit() {
    const result = await submitPasswordResetRequest(email.trim());
    if (result.success) {
      setIsSubmitted(true);
    }
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Reset Password" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {isSubmitted ? (
          <Card>
            <Text style={styles.confirmationText}>
              {confirmationMessage || DEFAULT_CONFIRMATION}
            </Text>
            <TextButton
              label="Back to Sign In"
              onPress={() => navigation.navigate('SignIn')}
              style={styles.backLink}
            />
          </Card>
        ) : (
          <>
            <Text style={styles.instructions}>
              Enter the email associated with your account and we&apos;ll send you a reset link.
            </Text>
            <Card>
              <TextInput
                label="EMAIL"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                editable={!isSubmitting}
                error={fieldErrors.email}
                style={styles.lastField}
              />
            </Card>
            {/* Failures render here with the form still visible and
                retryable — never as a false confirmation (ADR 0016 §9.3). */}
            <FormMessage message={formError} style={styles.formMessage} />
            <PrimaryButton
              label="Send Reset Link"
              onPress={handleSubmit}
              loading={isSubmitting}
              disabled={isSubmitting}
              style={styles.submitButton}
            />
          </>
        )}
      </ScrollView>
    </View>
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
      // ScreenHeader above already owns the top inset; only the trailing
      // edge is this container's problem. 0 where there is no bottom bar.
      paddingBottom: theme.space.xxxl + insets.bottom,
    },
    instructions: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginBottom: theme.space.xl,
    },
    lastField: {
      marginBottom: theme.space.sm,
    },
    formMessage: {
      marginTop: theme.space.xl,
      marginBottom: 0,
    },
    submitButton: {
      marginTop: theme.space.xl,
    },
    confirmationText: {
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginBottom: theme.space.lg,
    },
    backLink: {
      alignSelf: 'flex-start',
    },
  });
}

export default ForgotPasswordScreen;
