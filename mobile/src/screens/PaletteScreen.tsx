import React, { useEffect, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import {
  Banner,
  Chip,
  EmptyState,
  Field,
  Loader,
  Subtitle,
  Title,
} from '../components/ui';
import { ColorTile } from '../components/color';
import { useCatalogStore } from '../store/catalogStore';
import { PALETTE_BRANDS } from '../data/palette';
import { colors, spacing } from '../theme';
import type { RootStackParamList, TabParamList } from '../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Palette'>,
  NativeStackScreenProps<RootStackParamList>
>;

/**
 * Палитра ARCHI (§5.6 ТЗ): поиск по коду ARCHI, названию и коду чужого
 * стандарта (RAL 7016 → чем закрыть из палитры), фильтр по коллекциям
 * и брендам-эквивалентам.
 */
export function PaletteScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState<string | undefined>();
  const [brand, setBrand] = useState<string | undefined>();

  const items = useCatalogStore(s => s.colors);
  const collections = useCatalogStore(s => s.collections);
  const total = useCatalogStore(s => s.total);
  const loading = useCatalogStore(s => s.colorsLoading);
  const error = useCatalogStore(s => s.error);
  const search = useCatalogStore(s => s.searchColors);
  const hydrate = useCatalogStore(s => s.hydratePaletteCache);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      search({ q: query.trim() || undefined, collection, brand, limit: 120 });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, collection, brand, search]);

  const columns = width > 600 ? 4 : 3;
  const tileWidth =
    (width - spacing.lg * 2 - spacing.md * (columns - 1)) / columns;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Title>Палитра</Title>
        <Subtitle>
          {total ? `${total} оттенков в выборке` : 'Каталог оттенков ArchiPaint'}
        </Subtitle>
        <Field
          label="Поиск"
          value={query}
          onChangeText={setQuery}
          placeholder="AP-0224, «Кремень» или RAL 7016"
          autoCapitalize="none"
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}>
          <Chip
            label="Все"
            active={!collection && !brand}
            onPress={() => {
              setCollection(undefined);
              setBrand(undefined);
            }}
          />
          {collections.map(item => (
            <Chip
              key={item}
              label={item.replace('ArchiPaint ', '')}
              active={collection === item}
              onPress={() =>
                setCollection(collection === item ? undefined : item)
              }
            />
          ))}
          {PALETTE_BRANDS.map(item => (
            <Chip
              key={item}
              label={`есть ${item}`}
              active={brand === item}
              onPress={() => setBrand(brand === item ? undefined : item)}
            />
          ))}
        </ScrollView>
        {error ? <Banner text={error} tone="error" /> : null}
      </View>

      {loading && !items.length ? (
        <Loader text="Загружаем палитру…" />
      ) : (
        <FlatList
          data={items}
          key={columns}
          numColumns={columns}
          keyExtractor={item => item.code}
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <ColorTile
              color={item}
              width={tileWidth}
              onPress={() => navigation.navigate('ColorDetail', { color: item })}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              title="Ничего не нашли"
              description="Попробуйте код ARCHI, название оттенка или код другого стандарта — например, RAL 7016."
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: { padding: spacing.lg, gap: spacing.sm },
  filters: { gap: spacing.sm, paddingVertical: spacing.xs },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  column: { gap: spacing.md },
});
