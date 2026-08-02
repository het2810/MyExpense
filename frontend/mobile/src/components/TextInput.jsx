import React, { useState } from 'react';
import { View, Text, TextInput as RNTextInput, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Labeled underline-style form field with a type.label caption above.
 * Supports a show/hide toggle for secureTextEntry (password) fields and an
 * inline error message below the field.
 * See docs/decisions/0001-shared-component-library.md.
 */
function TextInput({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  error,
  helperText,
  keyboardType,
  autoCapitalize = 'none',
  style,
  ...rest
}) {
  const theme = useTheme();
  const [isValueVisible, setIsValueVisible] = useState(false);
  const styles = createStyles(theme, !!error);

  return (
    <View style={[styles.container, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.fieldRow}>
        <RNTextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.color.text.tertiary}
          secureTextEntry={secureTextEntry && !isValueVisible}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          {...rest}
        />
        {secureTextEntry ? (
          <Pressable onPress={() => setIsValueVisible((prev) => !prev)} hitSlop={8}>
            <Text style={styles.toggle}>{isValueVisible ? 'HIDE' : 'SHOW'}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : helperText ? (
        <Text style={styles.helper}>{helperText}</Text>
      ) : null}
    </View>
  );
}

function createStyles(theme, hasError) {
  return StyleSheet.create({
    container: {
      marginBottom: theme.space.lg,
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
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: hasError ? theme.color.status.negative : theme.color.border.subtle,
      paddingBottom: theme.space.sm,
    },
    input: {
      flex: 1,
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      lineHeight: theme.type.bodyLg.lineHeight,
      paddingVertical: 0,
    },
    toggle: {
      color: theme.color.accent.text,
      fontSize: theme.type.caption.fontSize,
      fontWeight: '700',
      letterSpacing: 0.6,
      marginLeft: theme.space.sm,
    },
    error: {
      color: theme.color.status.negative,
      fontSize: theme.type.caption.fontSize,
      marginTop: theme.space.xs,
    },
    helper: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      marginTop: theme.space.xs,
    },
  });
}

export default TextInput;
