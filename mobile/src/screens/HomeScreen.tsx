import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { Card, Screen, SectionTitle, Subtitle, Title } from '../components/ui';
import { useCatalogStore } from '../store/catalogStore';
import { useAuthStore } from '../store/authStore';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList, TabParamList } from '../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

/** Главный экран: три сценария и витрина линеек (§5.2 ТЗ). */
export function HomeScreen({ navigation }: Props) {
  const products = useCatalogStore(s => s.products);
  const loadProducts = useCatalogStore(s => s.loadProducts);
  const user = useAuthStore(s => s.user);

  useEffect(() => {
    if (!products.length) {
      loadProducts();
    }
  }, [products.length, loadProducts]);

  const scenarios = [
    {
      key: 'photo',
      title: 'Подобрать цвет по фото',
      text: 'Снимите интерьер — покажем, как он будет выглядеть, и найдём оттенок ARCHI.',
      accent: colors.terra,
      onPress: () => navigation.navigate('PhotoMatch'),
    },
    {
      key: 'ble',
      title: 'Подключить колориметр',
      text: 'Измерьте цвет прибором — подберём ближайший оттенок из палитры.',
      accent: colors.accent,
      onPress: () => navigation.navigate('Colorimeter'),
    },
    {
      key: 'calc',
      title: 'Калькулятор краски',
      text: 'Посчитаем литры и банки по площади стен и числу слоёв.',
      accent: colors.mid,
      onPress: () => navigation.navigate('Calculator'),
    },
  ];

  const lines: { line: 'Premium' | 'Profi'; title: string }[] = [
    { line: 'Premium', title: 'Premium' },
    { line: 'Profi', title: 'Профи' },
  ];

  return (
    <Screen>
      <View>
        <Title>{user ? `Здравствуйте, ${user.name}` : 'Арчи'}</Title>
        <Subtitle>Краски, колеровка и заказ ArchiPaint</Subtitle>
      </View>

      <View style={styles.scenarios}>
        {scenarios.map(item => (
          <Card key={item.key} onPress={item.onPress} style={styles.scenario}>
            <View style={[styles.bar, { backgroundColor: item.accent }]} />
            <View style={styles.scenarioBody}>
              <Text style={typography.h3}>{item.title}</Text>
              <Text style={typography.caption}>{item.text}</Text>
            </View>
          </Card>
        ))}
      </View>

      {lines.map(group => {
        const items = products.filter(p => p.line === group.line);
        if (!items.length) {
          return null;
        }
        return (
          <View key={group.line} style={styles.lineBlock}>
            <SectionTitle>{group.title}</SectionTitle>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.lineRow}>
              {items.map(product => (
                <Card
                  key={product.sku}
                  style={styles.productCard}
                  onPress={() =>
                    navigation.navigate('Calculator', { colorCode: undefined })
                  }>
                  <Text style={typography.h3}>{product.name}</Text>
                  <Text style={typography.caption} numberOfLines={2}>
                    {product.description}
                  </Text>
                  <Text style={styles.productMeta}>
                    Расход {product.coverageM2PerLiter} м²/л · от{' '}
                    {product.priceBase} ₽/л
                  </Text>
                </Card>
              ))}
            </ScrollView>
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scenarios: { gap: spacing.md },
  scenario: { flexDirection: 'row', gap: spacing.md, alignItems: 'stretch' },
  bar: { width: 6, borderRadius: radius.pill },
  scenarioBody: { flex: 1, gap: spacing.xs },
  lineBlock: { gap: spacing.md },
  lineRow: { gap: spacing.md, paddingRight: spacing.lg },
  productCard: { width: 240 },
  productMeta: { ...typography.micro, marginTop: spacing.xs },
});
