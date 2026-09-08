import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Banner,
  Button,
  Card,
  Chip,
  Field,
  Screen,
  SectionTitle,
  Stepper,
  Subtitle,
  Title,
} from '../components/ui';
import { api } from '../api';
import type { CoverageCalcResponse, Product } from '../api/types';
import { areaFromWalls, calcCoverage } from '../services/coverage';
import { useCatalogStore } from '../store/catalogStore';
import { useCartStore } from '../store/cartStore';
import { selectIsAuthorized, useAuthStore } from '../store/authStore';
import { colors, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Calculator'>;

type Mode = 'area' | 'walls';

/**
 * Калькулятор расхода (§5.5, §6.3 ТЗ).
 *
 * Считаем локально — так экран работает без сети и без входа; когда бэкенд
 * отдаст свой ответ /api/coverage-calc, показываем его (он главный:
 * там же живёт актуальная таблица расходов).
 */
export function CalculatorScreen({ navigation, route }: Props) {
  const products = useCatalogStore(s => s.products);
  const loadProducts = useCatalogStore(s => s.loadProducts);
  const addToCart = useCartStore(s => s.add);
  const isAuthorized = useAuthStore(selectIsAuthorized);

  const [mode, setMode] = useState<Mode>('area');
  const [areaInput, setAreaInput] = useState('24');
  const [wallWidth, setWallWidth] = useState('4');
  const [wallHeight, setWallHeight] = useState('2.7');
  const [wallCount, setWallCount] = useState(4);
  const [openings, setOpenings] = useState('0');
  const [layers, setLayers] = useState(2);
  const [sku, setSku] = useState<string | null>(null);
  const [remote, setRemote] = useState<CoverageCalcResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!products.length) {
      loadProducts();
    }
  }, [products.length, loadProducts]);

  useEffect(() => {
    if (!sku && products.length) {
      setSku(products[0].sku);
    }
  }, [products, sku]);

  const product: Product | undefined = useMemo(
    () => products.find(p => p.sku === sku),
    [products, sku],
  );

  const num = (value: string) => {
    const parsed = parseFloat(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const area = useMemo(() => {
    if (mode === 'area') {
      return num(areaInput);
    }
    const walls = Array.from({ length: wallCount }, () => ({
      widthM: num(wallWidth),
      heightM: num(wallHeight),
    }));
    return areaFromWalls(walls, [
      { widthM: 1, heightM: 1.5, count: Math.round(num(openings)) },
    ]);
  }, [mode, areaInput, wallWidth, wallHeight, wallCount, openings]);

  const local = useMemo(
    () => (product ? calcCoverage(area, layers, product) : null),
    [area, layers, product],
  );

  const result = remote ?? local;

  /* Бэкенд — источник истины по расходу, но экран не должен ждать сеть. */
  useEffect(() => {
    let cancelled = false;
    if (!product || area <= 0) {
      setRemote(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await api.coverage.calc({
          areaM2: area,
          layers,
          productSku: product.sku,
        });
        if (!cancelled) {
          setRemote(response);
        }
      } catch {
        if (!cancelled) {
          setRemote(null); // молча остаёмся на локальном расчёте
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [area, layers, product]);

  const addPacks = async () => {
    if (!result || !product) {
      return;
    }
    if (!isAuthorized) {
      navigation.navigate('Login', {
        reason: 'Чтобы добавить товар в корзину, войдите в аккаунт.',
      });
      return;
    }
    setAdding(true);
    setError(null);
    let ok = true;
    for (const pack of result.packs) {
      const added = await addToCart({
        productSku: product.sku,
        packSizeL: pack.sizeL,
        quantity: pack.count,
        colorCode: route.params?.colorCode,
      });
      ok = ok && added;
    }
    setAdding(false);
    if (ok) {
      navigation.navigate('Tabs', { screen: 'Cart' });
    } else {
      setError('Не удалось добавить товар в корзину');
    }
  };

  return (
    <Screen>
      <View>
        <Title>Калькулятор краски</Title>
        <Subtitle>
          Посчитаем литры и банки по площади, числу слоёв и расходу продукта.
        </Subtitle>
      </View>

      {error ? <Banner text={error} tone="error" onClose={() => setError(null)} /> : null}

      <View style={styles.modes}>
        <Chip
          label="Площадь"
          active={mode === 'area'}
          onPress={() => setMode('area')}
        />
        <Chip
          label="Размеры стен"
          active={mode === 'walls'}
          onPress={() => setMode('walls')}
        />
      </View>

      <Card>
        {mode === 'area' ? (
          <Field
            label="Площадь, м²"
            value={areaInput}
            onChangeText={setAreaInput}
            keyboardType="decimal-pad"
          />
        ) : (
          <>
            <View style={styles.row}>
              <Field
                label="Ширина стены, м"
                value={wallWidth}
                onChangeText={setWallWidth}
                keyboardType="decimal-pad"
                containerStyle={styles.rowField}
              />
              <Field
                label="Высота, м"
                value={wallHeight}
                onChangeText={setWallHeight}
                keyboardType="decimal-pad"
                containerStyle={styles.rowField}
              />
            </View>
            <View style={styles.inlineRow}>
              <Text style={typography.caption}>Количество стен</Text>
              <Stepper value={wallCount} onChange={setWallCount} min={1} max={12} />
            </View>
            <Field
              label="Окна и двери, шт"
              hint="Вычитаем по 1,5 м² на проём"
              value={openings}
              onChangeText={setOpenings}
              keyboardType="number-pad"
            />
          </>
        )}

        <View style={styles.inlineRow}>
          <Text style={typography.caption}>Слоёв</Text>
          <Stepper value={layers} onChange={setLayers} min={1} max={5} />
        </View>
        <Text style={typography.micro}>
          Площадь под покраску: {area.toFixed(1)} м²
        </Text>
      </Card>

      <SectionTitle>Продукт</SectionTitle>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.productRow}>
        {products.map(item => (
          <Chip
            key={item.sku}
            label={item.name}
            active={item.sku === sku}
            onPress={() => setSku(item.sku)}
          />
        ))}
      </ScrollView>

      {result && product ? (
        <Card>
          <Text style={typography.h2}>{result.litersRequired.toFixed(2)} л</Text>
          <Text style={typography.caption}>
            {product.name} · расход {product.coverageM2PerLiter} м²/л · {layers}{' '}
            {layers === 1 ? 'слой' : 'слоя'}
          </Text>

          <View style={styles.packs}>
            {result.packs.map(pack => (
              <View key={pack.sizeL} style={styles.pack}>
                <Text style={typography.h3}>
                  {pack.count} × {pack.sizeL} л
                </Text>
              </View>
            ))}
          </View>

          <Text style={typography.caption}>
            К покупке {result.litersPurchased.toFixed(1)} л · {result.price} ₽
          </Text>
          <Text style={styles.tbd}>
            Расход и фасовка — предварительные, до подтверждения таблицы
            товароведом.
          </Text>

          <Button
            title="Добавить в заказ"
            onPress={addPacks}
            loading={adding}
            style={styles.cta}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  modes: { flexDirection: 'row', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  rowField: { flex: 1 },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  productRow: { gap: spacing.sm, paddingRight: spacing.lg },
  packs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  pack: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.accentSoft,
  },
  tbd: { ...typography.micro, color: colors.mid },
  cta: { marginTop: spacing.md },
});
