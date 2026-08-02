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

/**
 * Sign In — docs/ui/design-system.md Section 4.1.
 * No API call yet: `signIn` only validates locally and flips
 * useAuthStore.isAuthenticated (docs/architecture/frontend-navigation.md
 * Section 2.2).
 */
function SignInScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const signIn = useAuthStore((state) => state.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const styles = createStyles(theme);

  function handleSignIn() {
    const result = signIn(email.trim(), password);
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
            error={errors.email}
          />
          <TextInput
            label="PASSWORD"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            error={errors.password}
            style={styles.lastField}
          />
          <TextButton
            label="Forgot password?"
            align="right"
            onPress={() => navigation.navigate('ForgotPassword')}
          />
        </Card>

        <PrimaryButton
          label="Sign In"
          onPress={handleSignIn}
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

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    container: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.space.xl,
      paddingVertical: theme.space.xxxl,
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
