import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Banner,
  Button,
  Card,
  Chip,
  Field,
  Screen,
  SectionTitle,
  Subtitle,
  Title,
} from '../components/ui';
import { api } from '../api';
import type { DeliveryType, PaymentType, PickupPoint } from '../api/types';
import { useCartStore } from '../store/cartStore';
import { useAuthStore } from '../store/authStore';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Checkout'>;

/**
 * Оформление заказа (§5.7 ТЗ): адрес → оплата → подтверждение.
 * Бизнес-логика заказа не дублируется — вызываем тот же API, что и сайт.
 */
export function CheckoutScreen({ navigation }: Props) {
  const cart = useCartStore(s => s.cart);
  const setLastOrder = useCartStore(s => s.setLastOrder);
  const refresh = useCartStore(s => s.refresh);
  const user = useAuthStore(s => s.user);

  const [deliveryType, setDeliveryType] = useState<DeliveryType>('courier');
  const [paymentType, setPaymentType] = useState<PaymentType>('online');
  const [points, setPoints] = useState<PickupPoint[]>([]);
  const [pickupPointId, setPickupPointId] = useState<string | null>(null);
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [city, setCity] = useState('');
  const [street, setStreet] = useState('');
  const [house, setHouse] = useState('');
  const [apartment, setApartment] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.order
      .pickupPoints()
      .then(setPoints)
      .catch(() => setPoints([]));
  }, []);

  const canSubmit =
    name.trim().length > 1 &&
    phone.trim().length > 5 &&
    (deliveryType === 'pickup'
      ? Boolean(pickupPointId)
      : city.trim() && street.trim() && house.trim());

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const order = await api.order.create({
        deliveryType,
        paymentType,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        comment: comment.trim() || undefined,
        pickupPointId: deliveryType === 'pickup' ? pickupPointId ?? undefined : undefined,
        address:
          deliveryType === 'courier'
            ? {
                city: city.trim(),
                street: street.trim(),
                house: house.trim(),
                apartment: apartment.trim() || undefined,
              }
            : undefined,
      });
      setLastOrder(order);
      await refresh();
      navigation.replace('OrderSuccess', { order });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось оформить заказ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <View>
        <Title>Оформление</Title>
        <Subtitle>{cart.items.length} позиций на {cart.total} ₽</Subtitle>
      </View>

      {error ? <Banner text={error} tone="error" onClose={() => setError(null)} /> : null}

      <SectionTitle>Получатель</SectionTitle>
      <Card>
        <Field label="Имя" value={name} onChangeText={setName} />
        <Field
          label="Телефон"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
      </Card>

      <SectionTitle>Доставка</SectionTitle>
      <View style={styles.chips}>
        <Chip
          label="Курьером"
          active={deliveryType === 'courier'}
          onPress={() => setDeliveryType('courier')}
        />
        <Chip
          label="Самовывоз"
          active={deliveryType === 'pickup'}
          onPress={() => setDeliveryType('pickup')}
        />
      </View>

      <Card>
        {deliveryType === 'courier' ? (
          <>
            <Field label="Город" value={city} onChangeText={setCity} />
            <Field label="Улица" value={street} onChangeText={setStreet} />
            <View style={styles.row}>
              <Field
                label="Дом"
                value={house}
                onChangeText={setHouse}
                containerStyle={styles.rowItem}
              />
              <Field
                label="Квартира"
                value={apartment}
                onChangeText={setApartment}
                containerStyle={styles.rowItem}
              />
            </View>
          </>
        ) : (
          points.map(point => (
            <Chip
              key={point.id}
              label={`${point.title} — ${point.address}`}
              active={pickupPointId === point.id}
              onPress={() => setPickupPointId(point.id)}
            />
          ))
        )}
        <Field
          label="Комментарий"
          value={comment}
          onChangeText={setComment}
          multiline
        />
      </Card>

      <SectionTitle>Оплата</SectionTitle>
      <View style={styles.chips}>
        <Chip
          label="Онлайн"
          active={paymentType === 'online'}
          onPress={() => setPaymentType('online')}
        />
        <Chip
          label="При получении"
          active={paymentType === 'cash'}
          onPress={() => setPaymentType('cash')}
        />
      </View>

      <Button
        title={`Оформить на ${cart.total} ₽`}
        onPress={submit}
        loading={loading}
        disabled={!canSubmit || !cart.items.length}
      />
      <Text style={typography.micro}>
        Состав доставки и оплаты подтверждается бэкендом Bitrix — приложение
        вызывает тот же API, что и сайт.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  rowItem: { flex: 1 },
});
