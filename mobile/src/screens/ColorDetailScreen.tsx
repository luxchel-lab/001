import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Banner,
  Button,
  Card,
  Chip,
  Screen,
  SectionTitle,
  Stepper,
  Subtitle,
  Title,
} from '../components/ui';
import { useColorStore } from '../store/colorStore';
import { useCartStore } from '../store/cartStore';
import { useCatalogStore } from '../store/catalogStore';
import { selectIsAuthorized, useAuthStore } from '../store/authStore';
import { rgbToLab } from '../services/color';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ColorDetail'>;

/** Карточка оттенка: координаты, бренд-эквиваленты и заказ в этом цвете. */
export function ColorDetailScreen({ navigation, route }: Props) {
  const { color } = route.params;
  const lab = color.lab ?? rgbToLab(color.rgb);

  const products = useCatalogStore(s => s.products);
  const loadProducts = useCatalogStore(s => s.loadProducts);
  const addToCart = useCartStore(s => s.add);
  const isAuthorized = useAuthStore(selectIsAuthorized);
  const saved = useColorStore(s => s.saved);
  const toggleSaved = useColorStore(s => s.toggleSaved);

  const [sku, setSku] = useState<string | null>(null);
  const [packSizeL, setPackSizeL] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tintable = products.filter(p => p.tintable);
  const product = tintable.find(p => p.sku === sku);
  const isSaved = saved.some(c => c.code === color.code);

  useEffect(() => {
    if (!products.length) {
      loadProducts();
    }
  }, [products.length, loadProducts]);

  useEffect(() => {
    if (!sku && tintable.length) {
      setSku(tintable[0].sku);
    }
  }, [tintable, sku]);

  useEffect(() => {
    if (product && (packSizeL === null || !product.packSizesL.includes(packSizeL))) {
      setPackSizeL(product.packSizesL[0]);
    }
  }, [product, packSizeL]);

  const add = async () => {
    if (!product || packSizeL === null) {
      return;
    }
    if (!isAuthorized) {
      navigation.navigate('Login', {
        reason: 'Чтобы заказать колеровку, войдите в аккаунт.',
      });
      return;
    }
    setAdding(true);
    setError(null);
    const ok = await addToCart({
      productSku: product.sku,
      packSizeL,
      quantity,
      colorCode: color.code,
    });
    setAdding(false);
    if (ok) {
      navigation.navigate('Tabs', { screen: 'Cart' });
    } else {
      setError('Не удалось добавить товар в корзину');
    }
  };

  return (
    <Screen>
      <View style={[styles.hero, { backgroundColor: color.hex }]} />
      <View>
        <Title>{color.name}</Title>
        <Subtitle>
          {color.code}
          {color.collection ? ` · ${color.collection}` : ''}
        </Subtitle>
      </View>

      {error ? <Banner text={error} tone="error" onClose={() => setError(null)} /> : null}

      <Card>
        <Text style={typography.h3}>Координаты</Text>
        <Text style={typography.caption}>HEX {color.hex}</Text>
        <Text style={typography.caption}>RGB {color.rgb.join(', ')}</Text>
        <Text style={typography.caption}>
          Lab {lab.map(v => v.toFixed(1)).join(', ')}
        </Text>
      </Card>

      {color.brandMatches?.length ? (
        <Card>
          <Text style={typography.h3}>Ближайшие эквиваленты</Text>
          {color.brandMatches.map(match => (
            <View key={`${match.brand}-${match.code}`} style={styles.brandRow}>
              <View
                style={[styles.brandSwatch, { backgroundColor: match.hex ?? '#EEE' }]}
              />
              <View style={styles.brandInfo}>
                <Text style={typography.body}>
                  {match.code}
                  {match.name ? ` · ${match.name}` : ''}
                </Text>
                <Text style={typography.micro}>
                  {match.brand}
                  {match.deltaE !== undefined ? ` · ΔE ${match.deltaE.toFixed(2)}` : ''}
                </Text>
              </View>
            </View>
          ))}
          <Text style={typography.micro}>
            Экранные значения приблизительны — сверяйте по вееру.
          </Text>
        </Card>
      ) : null}

      <SectionTitle>Заказать в этом цвете</SectionTitle>
      <Card>
        <View style={styles.chips}>
          {tintable.map(item => (
            <Chip
              key={item.sku}
              label={item.name}
              active={item.sku === sku}
              onPress={() => setSku(item.sku)}
            />
          ))}
        </View>
        {product ? (
          <View style={styles.chips}>
            {product.packSizesL.map(size => (
              <Chip
                key={size}
                label={`${size} л`}
                active={size === packSizeL}
                onPress={() => setPackSizeL(size)}
              />
            ))}
          </View>
        ) : null}
        <View style={styles.qtyRow}>
          <Text style={typography.caption}>Количество</Text>
          <Stepper value={quantity} onChange={setQuantity} />
        </View>
        <Button title="Добавить в корзину" onPress={add} loading={adding} />
        <Button
          title="Рассчитать расход"
          variant="secondary"
          onPress={() => navigation.navigate('Calculator', { colorCode: color.code })}
        />
        <Button
          title={isSaved ? 'Убрать из сохранённых' : 'Сохранить цвет'}
          variant="ghost"
          onPress={() => toggleSaved(color)}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 160,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(32,36,31,0.12)',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  brandSwatch: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(32,36,31,0.12)',
  },
  brandInfo: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: spacing.sm,
  },
});
