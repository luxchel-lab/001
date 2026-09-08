import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import type { Asset } from 'react-native-image-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Banner,
  Button,
  Card,
  Field,
  Loader,
  Screen,
  SectionTitle,
  Subtitle,
  Title,
} from '../components/ui';
import { MatchRow } from '../components/color';
import { api, USE_MOCKS } from '../api';
import type { PhotoColorMatchResponse } from '../api/types';
import { useAuthStore, selectIsAuthorized } from '../store/authStore';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PhotoMatch'>;

/**
 * Подбор цвета по фото интерьера (§5.3 ТЗ).
 *
 * Фото уходит на бэкенд, тот дергает Decor8 AI и возвращает визуализацию
 * плюс ближайшие оттенки ARCHI. Ключи Decor8 в приложении не хранятся —
 * см. §4 ТЗ.
 */
export function PhotoMatchScreen({ navigation }: Props) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<PhotoColorMatchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAuthorized = useAuthStore(selectIsAuthorized);

  const pick = async (source: 'camera' | 'library') => {
    setError(null);
    const options = { mediaType: 'photo' as const, quality: 0.8 as const };
    const response =
      source === 'camera'
        ? await launchCamera(options)
        : await launchImageLibrary(options);

    if (response.didCancel) {
      return;
    }
    if (response.errorMessage) {
      setError(response.errorMessage);
      return;
    }
    const picked = response.assets?.[0];
    if (picked?.uri) {
      setAsset(picked);
      setResult(null);
    }
  };

  const submit = async () => {
    if (!asset?.uri) {
      return;
    }
    if (!isAuthorized) {
      navigation.navigate('Login', {
        reason: 'Подбор по фото доступен после входа в аккаунт.',
      });
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setResult(
        await api.colorMatch.byPhoto({
          photo: {
            uri: asset.uri,
            name: asset.fileName ?? 'interior.jpg',
            type: asset.type ?? 'image/jpeg',
          },
          prompt: prompt.trim() || undefined,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось подобрать цвет');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <View>
        <Title>Цвет по фото</Title>
        <Subtitle>
          Снимите комнату или выберите фото — покажем стену в новом цвете
          и подберём оттенок ARCHI.
        </Subtitle>
      </View>

      {error ? <Banner text={error} tone="error" onClose={() => setError(null)} /> : null}

      <Card>
        {asset?.uri ? (
          <Image source={{ uri: asset.uri }} style={styles.preview} />
        ) : (
          <View style={styles.placeholder}>
            <Text style={typography.caption}>Фото ещё не выбрано</Text>
          </View>
        )}
        <View style={styles.row}>
          <Button
            title="Камера"
            variant="secondary"
            style={styles.rowItem}
            onPress={() => pick('camera')}
          />
          <Button
            title="Галерея"
            variant="secondary"
            style={styles.rowItem}
            onPress={() => pick('library')}
          />
        </View>
      </Card>

      <Field
        label="Описание стиля (необязательно)"
        value={prompt}
        onChangeText={setPrompt}
        placeholder="Тёплый скандинавский интерьер, много света"
        multiline
      />

      <Button
        title="Подобрать цвет"
        onPress={submit}
        disabled={!asset?.uri}
        loading={loading}
      />

      {loading ? <Loader text="Обрабатываем фото…" /> : null}

      {result ? (
        <>
          <SectionTitle>Визуализация</SectionTitle>
          <Card>
            <Image source={{ uri: result.renderUrl }} style={styles.preview} />
            {USE_MOCKS ? (
              <Text style={typography.micro}>
                Демо-режим: показано исходное фото. Реальную перекраску
                возвращает бэкенд через Decor8 AI.
              </Text>
            ) : null}
          </Card>

          <SectionTitle>Подходящие оттенки</SectionTitle>
          <Card>
            {result.matches.map((match, index) => (
              <MatchRow
                key={match.color.code}
                match={match}
                highlighted={index === 0}
                onPress={() =>
                  navigation.navigate('ColorDetail', { color: match.color })
                }
              />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', height: 220, borderRadius: 10, resizeMode: 'cover' },
  placeholder: {
    height: 220,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F1EC',
  },
  row: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  rowItem: { flex: 1 },
});
