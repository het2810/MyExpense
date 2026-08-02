import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import Card from '../../components/Card';
import TextInput from '../../components/TextInput';
import PrimaryButton from '../../components/PrimaryButton';
import TextButton from '../../components/TextButton';
import ScreenHeader from '../../components/ScreenHeader';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Forgot Password — docs/ui/design-system.md Section 4.3.
 *
 * Not part of this phase's explicit "6 screens" build list, but included
 * (small, fully specified) so Sign In's "Forgot password?" link has
 * somewhere real to go instead of a dead end. Maps 1:1 to the already
 * documented POST /api/v1/auth/forgot-password contract, but — like Sign
 * In/Sign Up — no network call is wired yet; submitting just reveals the
 * same anti-enumeration confirmation copy locally.
 */
function ForgotPasswordScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const styles = createStyles(theme);

  function handleSubmit() {
    if (!email || !EMAIL_REGEX.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setIsSubmitted(true);
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Reset Password" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {isSubmitted ? (
          <Card>
            <Text style={styles.confirmationText}>
              If an account exists for this email, a password reset link has been sent.
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
                error={error}
                style={styles.lastField}
              />
            </Card>
            <PrimaryButton
              label="Send Reset Link"
              onPress={handleSubmit}
              style={styles.submitButton}
            />
          </>
        )}
      </ScrollView>
    </View>
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
      paddingBottom: theme.space.xxxl,
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
