import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius, shadow, spacing, typography } from '../theme';

/* ------------------------------------------------------------- контейнеры */

export function Screen({
  children,
  scroll = true,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
}) {
  if (!scroll) {
    return <View style={[styles.screen, contentStyle]}>{children}</View>;
  }
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.scrollContent, contentStyle]}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
}) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          shadow.card,
          pressed && styles.cardPressed,
          style,
        ]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, shadow.card, style]}>{children}</View>;
}

/* ------------------------------------------------------------------ текст */

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={typography.h1}>{children}</Text>;
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  return <Text style={[typography.caption, styles.subtitle]}>{children}</Text>;
}

export function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={typography.h2}>{children}</Text>
      {action}
    </View>
  );
}

/* ----------------------------------------------------------------- кнопки */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variantStyles[variant].container,
        pressed && !isDisabled && styles.buttonPressed,
        isDisabled && styles.buttonDisabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variantStyles[variant].text.color} />
      ) : (
        <Text style={[styles.buttonText, variantStyles[variant].text]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ поля */

export function Field({
  label,
  hint,
  containerStyle,
  style,
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  containerStyle?: ViewStyle;
}) {
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.inkFaint}
        style={[styles.input, style]}
        {...props}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        style={styles.stepperButton}>
        <Text style={styles.stepperSign}>−</Text>
      </Pressable>
      <Text style={styles.stepperValue}>{value}</Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        style={styles.stepperButton}>
        <Text style={styles.stepperSign}>+</Text>
      </Pressable>
    </View>
  );
}

/* -------------------------------------------------------------- состояния */

export function Banner({
  text,
  tone = 'info',
  onClose,
}: {
  text: string;
  tone?: 'info' | 'error' | 'success';
  onClose?: () => void;
}) {
  const toneStyle =
    tone === 'error'
      ? styles.bannerError
      : tone === 'success'
      ? styles.bannerSuccess
      : styles.bannerInfo;
  return (
    <View style={[styles.banner, toneStyle]}>
      <Text style={styles.bannerText}>{text}</Text>
      {onClose ? (
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.bannerClose}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Text style={typography.h3}>{title}</Text>
      {description ? (
        <Text style={[typography.caption, styles.emptyText]}>{description}</Text>
      ) : null}
      {action}
    </View>
  );
}

export function Loader({ text }: { text?: string }) {
  return (
    <View style={styles.loader}>
      <ActivityIndicator color={colors.accent} />
      {text ? <Text style={styles.loaderText}>{text}</Text> : null}
    </View>
  );
}

/* ----------------------------------------------------------------- стили */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardPressed: { opacity: 0.85 },
  subtitle: { marginTop: spacing.xs },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  button: {
    minHeight: 50,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonPressed: { opacity: 0.88 },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  field: { gap: spacing.xs },
  fieldLabel: { ...typography.caption, color: colors.inkMuted },
  fieldHint: { ...typography.micro },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    minHeight: 46,
    fontSize: 15,
    color: colors.ink,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { fontSize: 13, color: colors.inkMuted },
  chipTextActive: { color: colors.accent, fontWeight: '600' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  stepperButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  stepperSign: { fontSize: 18, color: colors.accent },
  stepperValue: { minWidth: 32, textAlign: 'center', fontSize: 15, color: colors.ink },
  banner: {
    borderRadius: radius.sm,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  bannerInfo: { backgroundColor: colors.accentSoft },
  bannerError: { backgroundColor: colors.terraSoft },
  bannerSuccess: { backgroundColor: '#E9F2EA' },
  bannerText: { flex: 1, fontSize: 13, color: colors.ink },
  bannerClose: { fontSize: 20, color: colors.inkMuted, paddingHorizontal: 4 },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  emptyText: { textAlign: 'center' },
  loader: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  loaderText: { ...typography.caption },
});

const variantStyles: Record<
  ButtonVariant,
  { container: ViewStyle; text: { color: string } }
> = {
  primary: {
    container: { backgroundColor: colors.accent },
    text: { color: colors.white },
  },
  secondary: {
    container: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.line,
    },
    text: { color: colors.ink },
  },
  ghost: {
    container: { backgroundColor: 'transparent' },
    text: { color: colors.accent },
  },
  danger: {
    container: { backgroundColor: colors.terra },
    text: { color: colors.white },
  },
};
