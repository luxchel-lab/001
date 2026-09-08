import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Card, Screen, Subtitle, Title } from '../components/ui';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'OrderSuccess'>;

/** Подтверждение заказа (§5.7 ТЗ). */
export function OrderSuccessScreen({ navigation, route }: Props) {
  const { order } = route.params;

  return (
    <Screen>
      <View>
        <Title>Заказ {order.number} принят</Title>
        <Subtitle>{order.statusText}</Subtitle>
      </View>

      <Card>
        {order.items.map(item => (
          <View key={item.id} style={styles.row}>
            {item.colorHex ? (
              <View style={[styles.swatch, { backgroundColor: item.colorHex }]} />
            ) : null}
            <View style={styles.info}>
              <Text style={typography.body}>{item.productName}</Text>
              <Text style={typography.micro}>
                {item.packSizeL} л × {item.quantity}
                {item.colorCode ? ` · ${item.colorCode}` : ''}
              </Text>
            </View>
            <Text style={typography.body}>
              {item.pricePerItem * item.quantity} ₽
            </Text>
          </View>
        ))}
        <View style={styles.total}>
          <Text style={typography.h3}>Итого</Text>
          <Text style={typography.h3}>{order.total} ₽</Text>
        </View>
      </Card>

      {order.paymentUrl ? (
        <Button
          title="Перейти к оплате"
          onPress={() => Linking.openURL(order.paymentUrl as string)}
        />
      ) : null}

      <Button
        title="Мои заказы"
        variant="secondary"
        onPress={() => navigation.replace('Orders')}
      />
      <Button
        title="На главную"
        variant="ghost"
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(32,36,31,0.12)',
  },
  info: { flex: 1 },
  total: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
});
