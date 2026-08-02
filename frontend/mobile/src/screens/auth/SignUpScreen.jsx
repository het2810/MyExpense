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
import { useTheme } from '../../theme/useTheme';
import { useAuthStore } from '../../store/useAuthStore';
import Card from '../../components/Card';
import TextInput from '../../components/TextInput';
import PrimaryButton from '../../components/PrimaryButton';
import TextButton from '../../components/TextButton';
import ScreenHeader from '../../components/ScreenHeader';

/**
 * Sign Up — docs/ui/design-system.md Section 4.2.
 * `confirmPassword` is a client-side-only convenience field (match-check
 * against `password`) — per the design doc's explicit flag, it is never
 * passed to useAuthStore.signUp / any future Register API call.
 */
function SignUpScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const signUp = useAuthStore((state) => state.signUp);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState({});
  const styles = createStyles(theme);

  function handleSignUp() {
    if (password !== confirmPassword) {
      setErrors((prev) => ({ ...prev, confirmPassword: 'Passwords do not match.' }));
      return;
    }

    const result = signUp({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), password });
    if (!result.success) {
      setErrors(result.errors);
    } else {
      setErrors({});
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
              error={errors.firstName}
              style={styles.nameField}
            />
            <TextInput
              label="LAST NAME"
              value={lastName}
              onChangeText={setLastName}
              placeholder="Doe"
              error={errors.lastName}
              style={styles.nameField}
            />
          </View>
          <TextInput
            label="EMAIL"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            error={errors.email}
          />
          <TextInput
            label="PASSWORD"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            error={errors.password}
            helperText={
              errors.password
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
            error={errors.confirmPassword}
            style={styles.lastField}
          />
        </Card>

        <PrimaryButton
          label="Create Account"
          onPress={handleSignUp}
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

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    container: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingBottom: theme.space.xxxl,
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
