import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import { MATCH_QUALITY_TEXT, readableTextColor } from '../services/color';
import type { ArchiColor, ColorMatch } from '../api/types';

/** Плашка цвета с кодом — базовый элемент палитры. */
export function ColorSwatch({
  color,
  size = 72,
  onPress,
  style,
}: {
  color: ArchiColor;
  size?: number;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  const content = (
    <View
      style={[
        styles.swatch,
        { backgroundColor: color.hex, width: size, height: size },
        style,
      ]}>
      <Text style={[styles.swatchCode, { color: readableTextColor(color.hex) }]}>
        {color.code}
      </Text>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress}>{content}</Pressable>
  ) : (
    content
  );
}

/** Карточка оттенка в списках каталога. */
export function ColorTile({
  color,
  onPress,
  width,
}: {
  color: ArchiColor;
  onPress: () => void;
  width: number;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.tile, { width }]}>
      <View style={[styles.tileColor, { backgroundColor: color.hex }]} />
      <Text style={styles.tileName} numberOfLines={1}>
        {color.name}
      </Text>
      <Text style={styles.tileCode}>{color.code}</Text>
    </Pressable>
  );
}

/** Строка результата подбора: оттенок + насколько он близок. */
export function MatchRow({
  match,
  onPress,
  highlighted,
}: {
  match: ColorMatch;
  onPress?: () => void;
  highlighted?: boolean;
}) {
  const { color, deltaE, quality } = match;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.matchRow, highlighted && styles.matchRowHighlighted]}>
      <View style={[styles.matchColor, { backgroundColor: color.hex }]} />
      <View style={styles.matchInfo}>
        <Text style={typography.h3} numberOfLines={1}>
          {color.name}
        </Text>
        <Text style={typography.caption}>
          {color.code}
          {color.collection ? ` · ${color.collection}` : ''}
        </Text>
        <Text style={[styles.matchQuality, qualityStyle(quality)]}>
          ΔE {deltaE.toFixed(2)} · {MATCH_QUALITY_TEXT[quality]}
        </Text>
      </View>
    </Pressable>
  );
}

function qualityStyle(quality: ColorMatch['quality']) {
  switch (quality) {
    case 'exact':
    case 'close':
      return { color: colors.good };
    case 'visible':
      return { color: colors.mid };
    default:
      return { color: colors.poor };
  }
}

const styles = StyleSheet.create({
  swatch: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(32,36,31,0.12)',
    justifyContent: 'flex-end',
    padding: spacing.sm,
  },
  swatchCode: { fontSize: 11, fontWeight: '600' },
  tile: { gap: 2 },
  tileColor: {
    height: 88,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(32,36,31,0.12)',
  },
  tileName: { ...typography.caption, color: colors.ink, marginTop: spacing.xs },
  tileCode: { ...typography.micro },
  matchRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  matchRowHighlighted: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
  matchColor: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(32,36,31,0.12)',
  },
  matchInfo: { flex: 1, gap: 2 },
  matchQuality: { fontSize: 12, fontWeight: '600' },
});
