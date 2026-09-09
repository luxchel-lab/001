import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EmptyState, Screen, Subtitle, Title } from '../components/ui';
import { ColorTile } from '../components/color';
import { useColorStore } from '../store/colorStore';
import { spacing } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SavedColors'>;

/** Сохранённые цвета пользователя (§5.8 ТЗ). */
export function SavedColorsScreen({ navigation }: Props) {
  const saved = useColorStore(s => s.saved);
  const { width } = useWindowDimensions();
  const columns = width > 600 ? 4 : 3;
  const tileWidth =
    (width - spacing.lg * 2 - spacing.md * (columns - 1)) / columns;

  return (
    <Screen>
      <View>
        <Title>Сохранённые цвета</Title>
        <Subtitle>{saved.length} оттенков</Subtitle>
      </View>

      {saved.length ? (
        <View style={styles.grid}>
          {saved.map(color => (
            <ColorTile
              key={color.code}
              color={color}
              width={tileWidth}
              onPress={() => navigation.navigate('ColorDetail', { color })}
            />
          ))}
        </View>
      ) : (
        <EmptyState
          title="Пока пусто"
          description="Откройте оттенок в палитре и нажмите «Сохранить цвет»."
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});
