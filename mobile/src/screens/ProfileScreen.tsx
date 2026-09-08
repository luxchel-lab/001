import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import {
  Button,
  Card,
  Screen,
  SectionTitle,
  Subtitle,
  Title,
} from '../components/ui';
import { ColorSwatch } from '../components/color';
import { selectIsAuthorized, useAuthStore } from '../store/authStore';
import { useColorStore } from '../store/colorStore';
import { API_BASE_URL, USE_MOCKS } from '../api';
import { getBleColorimeterService } from '../services/ble';
import { spacing, typography } from '../theme';
import type { RootStackParamList, TabParamList } from '../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Profile'>,
  NativeStackScreenProps<RootStackParamList>
>;

/** Профиль (§5.8 ТЗ): заказы, сохранённые цвета, настройки, выход. */
export function ProfileScreen({ navigation }: Props) {
  const user = useAuthStore(s => s.user);
  const isAuthorized = useAuthStore(selectIsAuthorized);
  const logout = useAuthStore(s => s.logout);
  const saved = useColorStore(s => s.saved);
  const bleIsMock = getBleColorimeterService().isMock;

  return (
    <Screen>
      <View>
        <Title>{user ? user.name : 'Профиль'}</Title>
        <Subtitle>
          {user
            ? user.phone ?? user.email ?? 'Аккаунт archipaint.ru'
            : 'Войдите, чтобы заказывать и пользоваться колориметром'}
        </Subtitle>
      </View>

      {isAuthorized ? (
        <Card>
          <Button
            title="Мои заказы"
            variant="secondary"
            onPress={() => navigation.navigate('Orders')}
          />
          <Button title="Выйти" variant="ghost" onPress={logout} />
        </Card>
      ) : (
        <Card>
          <Button
            title="Войти"
            onPress={() => navigation.navigate('Login')}
          />
        </Card>
      )}

      <SectionTitle
        action={
          saved.length ? (
            <Button
              title="Все"
              variant="ghost"
              onPress={() => navigation.navigate('SavedColors')}
            />
          ) : undefined
        }>
        Сохранённые цвета
      </SectionTitle>
      <Card>
        {saved.length ? (
          <View style={styles.swatches}>
            {saved.slice(0, 8).map(color => (
              <ColorSwatch
                key={color.code}
                color={color}
                size={64}
                onPress={() => navigation.navigate('ColorDetail', { color })}
              />
            ))}
          </View>
        ) : (
          <Text style={typography.caption}>
            Сохраняйте понравившиеся оттенки — они появятся здесь.
          </Text>
        )}
      </Card>

      <SectionTitle>Настройки</SectionTitle>
      <Card>
        <Text style={typography.caption}>
          Источник данных: {USE_MOCKS ? 'демо-режим (моки)' : API_BASE_URL}
        </Text>
        <Text style={typography.caption}>
          Колориметр: {bleIsMock ? 'заглушка прибора' : 'реальный BLE-протокол'}
        </Text>
        <Text style={typography.micro}>
          Режимы переключаются переменными окружения ARCHIPAINT_USE_MOCKS,
          ARCHIPAINT_API_BASE_URL и ARCHIPAINT_REAL_BLE при сборке.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
