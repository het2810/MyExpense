import React, { useEffect, useMemo } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

// Exact spec — docs/decisions/0009-split-detail-and-settle-up.md's
// 2026-08-14 amendment, Part C; docs/ui/design-system.md §13.8.
const PARTICLE_COUNT = 16;
const PARTICLE_DURATION = 900; // ms, each particle's own animation
const STAGGER_DELAY = 15; // ms between each particle's start
// Total effect duration: 16 particles staggered 15ms apart (240ms spread)
// + the last particle's own 900ms run ≈ 1.15s.

const MIN_SIZE = 8;
const SIZE_RANGE = 4; // 8-12px
const TRANSLATE_X_RANGE = 280; // -140 to +140
const TRANSLATE_Y_MIN = 120;
const TRANSLATE_Y_RANGE = 140; // +120 to +260
const ROTATE_MIN = 180;
const ROTATE_RANGE = 360; // 180-540deg

/**
 * One-shot celebratory particle burst — plays once after Settle Up's
 * "Confirm Settlement" fires, then calls `onComplete`. Built entirely with
 * React Native core `Animated` — no new dependency (a confetti library was
 * evaluated and explicitly rejected against the Section 21 checklist; full
 * reasoning: docs/decisions/0009-split-detail-and-settle-up.md's 2026-08-14
 * amendment, Part C).
 *
 * Self-contained: renders its own absolutely-positioned, touch-transparent
 * overlay and owns its entire animation lifecycle. The caller
 * (SettleUpScreen) only needs to mount it once, after confirming, and
 * supply `onComplete` — this component has no opinion on what happens
 * after the burst finishes (SettleUpScreen passes `navigation.goBack`),
 * which keeps it reusable rather than settlement-specific, and keeps it
 * out of the screen's own layout logic per this round's task instructions.
 *
 * 16 small square/circle Views, sized 8-12px (randomized once per particle
 * at mount via useMemo, not re-rolled on every render), colors cycled
 * round-robin across accent.primary / status.positive / status.warning
 * only — status.negative is deliberately excluded (wrong emotional
 * register for a celebratory moment, even though it is technically "an
 * existing token"). Particles burst outward and downward from a single,
 * horizontally-centered, fixed point ~30% down the screen (not measured via
 * onLayout — constitution §3.2, unnecessary complexity for a one-shot
 * decorative effect) via translateX/translateY/rotate/opacity
 * interpolations — transform/opacity only, so useNativeDriver: true
 * throughout.
 */
function ConfettiBurst({ onComplete }) {
  const theme = useTheme();
  const styles = createStyles();

  const colors = useMemo(
    () => [theme.color.accent.primary, theme.color.status.positive, theme.color.status.warning],
    [theme],
  );

  // Seeded once at mount — each particle's shape/size/end-position/rotation
  // is randomized a single time, not re-rolled on every render.
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, index) => ({
        key: `particle-${index}`,
        progress: new Animated.Value(0),
        isSquare: index % 2 === 0,
        size: MIN_SIZE + Math.random() * SIZE_RANGE,
        color: colors[index % colors.length],
        endTranslateX: -TRANSLATE_X_RANGE / 2 + Math.random() * TRANSLATE_X_RANGE,
        endTranslateY: TRANSLATE_Y_MIN + Math.random() * TRANSLATE_Y_RANGE,
        endRotate: ROTATE_MIN + Math.random() * ROTATE_RANGE,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const animations = particles.map((particle) =>
      Animated.timing(particle.progress, {
        toValue: 1,
        duration: PARTICLE_DURATION,
        useNativeDriver: true,
      }),
    );

    Animated.stagger(STAGGER_DELAY, animations).start(() => {
      if (onComplete) {
        onComplete();
      }
    });
    // Runs exactly once, on mount — SettleUpScreen conditionally mounts a
    // fresh instance of this component when the burst is needed; it is
    // never re-triggered by a prop change on an already-mounted instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.overlay} pointerEvents="none">
      {particles.map((particle) => {
        const translateX = particle.progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, particle.endTranslateX],
        });
        const translateY = particle.progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, particle.endTranslateY],
        });
        const rotate = particle.progress.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${particle.endRotate}deg`],
        });
        // Opacity holds at full strength through the first half, then fades
        // out over the back half — "opacity (1 -> 0 over the animation's
        // back half)" per the exact spec.
        const opacity = particle.progress.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [1, 1, 0],
        });

        return (
          <Animated.View
            key={particle.key}
            style={[
              styles.particle,
              {
                width: particle.size,
                height: particle.size,
                borderRadius: particle.isSquare ? 2 : particle.size / 2,
                backgroundColor: particle.color,
                opacity,
                transform: [{ translateX }, { translateY }, { rotate }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
    },
    // Single, fixed, horizontally-centered origin point ~30% down the
    // screen's content area — `left`/`right` are intentionally left unset
    // so each absolutely-positioned particle is centered by the parent's
    // `alignItems: 'center'`, then animates outward from that shared point.
    particle: {
      position: 'absolute',
      top: '30%',
    },
  });
}

export default ConfettiBurst;
