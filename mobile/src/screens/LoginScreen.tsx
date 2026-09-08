import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Banner, Button, Field, Screen, Subtitle, Title } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import { USE_MOCKS } from '../api';
import { MOCK_OTP } from '../api/mockApi';
import { colors, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

/**
 * Вход по телефону или email — аккаунт общий с сайтом archipaint.ru (§5.1 ТЗ).
 * Вход можно пропустить: палитра и калькулятор работают без него,
 * заказ и колориметр — нет.
 *
 * TBD (§9): реальный сценарий входа на сайте (пароль или одноразовый код)
 * подтверждает владелец бэкенда. Сейчас реализован код из СМС/письма.
 */
export function LoginScreen({ navigation, route }: Props) {
  const [login, setLogin] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  // Селекторы по одному полю: zustand v5 сравнивает результат по ссылке,
  // объект-селектор пересоздавался бы на каждый рендер.
  const loading = useAuthStore(s => s.loading);
  const error = useAuthStore(s => s.error);
  const clearError = useAuthStore(s => s.clearError);
  const requestOtp = useAuthStore(s => s.requestOtp);
  const signIn = useAuthStore(s => s.login);
  const skipAuth = useAuthStore(s => s.skipAuth);

  const onRequestOtp = async () => {
    if (await requestOtp(login.trim())) {
      setOtpSent(true);
    }
  };

  const onSubmit = async () => {
    if (await signIn(login.trim(), otp.trim())) {
      navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
    }
  };

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>ARCHI</Text>
        </View>
        <Title>Арчи</Title>
        <Subtitle>
          Подбор цвета, колориметр и заказ красок ArchiPaint. Аккаунт общий
          с сайтом archipaint.ru.
        </Subtitle>
      </View>

      {route.params?.reason ? (
        <Banner text={route.params.reason} tone="info" />
      ) : null}
      {error ? <Banner text={error} tone="error" onClose={clearError} /> : null}

      <Field
        label="Телефон или email"
        value={login}
        onChangeText={setLogin}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="+7 900 000-00-00"
        editable={!loading}
      />

      {otpSent ? (
        <Field
          label="Код из сообщения"
          value={otp}
          onChangeText={setOtp}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="0000"
          hint={USE_MOCKS ? `Демо-режим: код ${MOCK_OTP}` : undefined}
          editable={!loading}
        />
      ) : null}

      {otpSent ? (
        <Button title="Войти" onPress={onSubmit} loading={loading} />
      ) : (
        <Button
          title="Получить код"
          onPress={onRequestOtp}
          loading={loading}
          disabled={login.trim().length < 3}
        />
      )}

      <Button
        title="Пропустить вход"
        variant="ghost"
        onPress={() => {
          skipAuth();
          navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
        }}
      />
      <Text style={styles.note}>
        Без входа доступны палитра и калькулятор. Для заказа и работы
        с колориметром понадобится аккаунт.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.xxl, gap: spacing.lg },
  header: { gap: spacing.xs, marginBottom: spacing.sm },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoText: { color: colors.white, fontWeight: '700', fontSize: 13 },
  note: { ...typography.micro, textAlign: 'center' },
});
