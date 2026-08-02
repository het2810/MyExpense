import React from 'react';
import { Switch } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Thin themed wrapper around React Native's built-in Switch — used for
 * Overspending Alerts, Daily Reminders, Notifications preferences.
 * See docs/decisions/0001-shared-component-library.md.
 *
 * thumbColor uses text.primary rather than background.surface: in dark
 * theme, background.surfaceAlt (off-track, #1D2225) and background.surface
 * (#15191B) sit only ~1.1:1 apart in luminance contrast — the thumb was
 * effectively invisible against the off-state track. text.primary is
 * near-white in dark theme (#F5F8F8) and near-black in light theme
 * (#12171A), giving a high-contrast thumb against the off-track in both
 * themes (~15:1 and ~13:1 respectively) while still standing out against
 * the on-state track (accent.primary, #22E1F0) via hue/saturation contrast.
 */
function ToggleSwitch({ value, onValueChange, disabled = false }) {
  const theme = useTheme();

  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{
        false: theme.color.background.surfaceAlt,
        true: theme.color.accent.primary,
      }}
      thumbColor={theme.color.text.primary}
      ios_backgroundColor={theme.color.background.surfaceAlt}
    />
  );
}

export default ToggleSwitch;
