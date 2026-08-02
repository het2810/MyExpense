import React from 'react';
import { Image } from 'react-native';

const LOGO = require('../assets/logo.png');

/**
 * The MyExpense brand mark (piggy-bank elephant), without the wordmark —
 * screens that show it already render the app name or a heading as text.
 * Shared by the Splash and Sign In screens so the mark stays identical.
 *
 * @param {{ size?: number, style?: import('react-native').StyleProp<import('react-native').ImageStyle> }} props
 */
function BrandLogo({ size = 88, style }) {
  return (
    <Image
      source={LOGO}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="MyExpense logo"
    />
  );
}

export default BrandLogo;
