import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Screen,
  Stepper,
  Subtitle,
  Title,
} from '../components/ui';
import { useCartStore } from '../store/cartStore';
import { selectIsAuthorized, useAuthStore } from '../store/authStore';
import { spacing, typography } from '../theme';
import type { RootStackParamList, TabParamList } from '../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Cart'>,
  NativeStackScreenProps<RootStackParamList>
>;

/** Корзина (§5.7 ТЗ) — состав и суммы приходят с бэкенда Bitrix. */
export function CartScreen({ navigation }: Props) {
  const cart = useCartStore(s => s.cart);
  const loading = useCartStore(s => s.loading);
  const error = useCartStore(s => s.error);
  const clearError = useCartStore(s => s.clearError);
  const refresh = useCartStore(s => s.refresh);
  const setQuantity = useCartStore(s => s.setQuantity);
  const remove = useCartStore(s => s.remove);
  const isAuthorized = useAuthStore(selectIsAuthorized);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Screen>
      <View>
        <Title>Корзина</Title>
        <Subtitle>Оформление и доставка — как на сайте archipaint.ru</Subtitle>
      </View>

      {error ? <Banner text={error} tone="error" onClose={clearError} /> : null}

      {!cart.items.length ? (
        <EmptyState
          title="Корзина пуста"
          description="Подберите цвет или рассчитайте расход — товар добавится отсюда."
          action={
            <Button
              title="К палитре"
              variant="secondary"
              onPress={() => navigation.navigate('Tabs', { screen: 'Palette' })}
            />
          }
        />
      ) : (
        <>
          {cart.items.map(item => (
            <Card key={item.id}>
              <View style={styles.row}>
                {item.colorHex ? (
                  <View
                    style={[styles.swatch, { backgroundColor: item.colorHex }]}
                  />
                ) : null}
                <View style={styles.info}>
                  <Text style={typography.h3}>{item.productName}</Text>
                  <Text style={typography.caption}>
                    {item.packSizeL} л
                    {item.colorCode ? ` · колеровка ${item.colorCode}` : ''}
                  </Text>
                  <Text style={typography.caption}>
                    {item.pricePerItem} ₽ за банку
                  </Text>
                </View>
              </View>
              <View style={styles.controls}>
                <Stepper
                  value={item.quantity}
                  onChange={next => setQuantity(item.id, next)}
                  min={1}
                />
                <Text style={typography.h3}>
                  {item.pricePerItem * item.quantity} ₽
                </Text>
              </View>
              <Button
                title="Удалить"
                variant="ghost"
                onPress={() => remove(item.id)}
              />
            </Card>
          ))}

          <Card>
            <View style={styles.totalRow}>
              <Text style={typography.h2}>Итого</Text>
              <Text style={typography.h2}>{cart.total} ₽</Text>
            </View>
            <Button
              title="Оформить заказ"
              loading={loading}
              onPress={() =>
                isAuthorized
                  ? navigation.navigate('Checkout')
                  : navigation.navigate('Login', {
                      reason: 'Для оформления заказа нужен вход в аккаунт.',
                    })
              }
            />
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  swatch: {
    width: 48,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(32,36,31,0.12)',
  },
  info: { flex: 1, gap: 2 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
});
