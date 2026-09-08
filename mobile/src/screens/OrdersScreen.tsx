import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Banner,
  Card,
  EmptyState,
  Loader,
  Screen,
  Subtitle,
  Title,
} from '../components/ui';
import { api } from '../api';
import type { Order } from '../api/types';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Orders'>;

/** История заказов (§5.8 ТЗ). */
export function OrdersScreen(_props: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.order
      .list()
      .then(response => setOrders(response.items))
      .catch(e =>
        setError(e instanceof Error ? e.message : 'Не удалось загрузить заказы'),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Screen>
        <Loader text="Загружаем заказы…" />
      </Screen>
    );
  }

  return (
    <Screen>
      <View>
        <Title>Мои заказы</Title>
        <Subtitle>История заказов аккаунта archipaint.ru</Subtitle>
      </View>

      {error ? <Banner text={error} tone="error" /> : null}

      {!orders.length && !error ? (
        <EmptyState
          title="Заказов пока нет"
          description="Здесь появятся заказы, оформленные в приложении и на сайте."
        />
      ) : null}

      {orders.map(order => (
        <Card key={order.id}>
          <View style={styles.head}>
            <Text style={typography.h3}>№ {order.number}</Text>
            <Text style={typography.caption}>
              {new Date(order.createdAt).toLocaleDateString('ru-RU')}
            </Text>
          </View>
          <Text style={typography.caption}>{order.statusText}</Text>
          {order.items.map(item => (
            <Text key={item.id} style={typography.micro}>
              {item.productName} · {item.packSizeL} л × {item.quantity}
              {item.colorCode ? ` · ${item.colorCode}` : ''}
            </Text>
          ))}
          <Text style={typography.h3}>{order.total} ₽</Text>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
});
