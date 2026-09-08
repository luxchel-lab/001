import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Screen,
  SectionTitle,
  Subtitle,
  Title,
} from '../components/ui';
import { MatchRow } from '../components/color';
import { api } from '../api';
import type { ColorMatch } from '../api/types';
import {
  getBleColorimeterService,
  type BleStatus,
  type ColorimeterDevice,
  type ColorimeterReading,
} from '../services/ble';
import { useColorStore } from '../store/colorStore';
import { selectIsAuthorized, useAuthStore } from '../store/authStore';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Colorimeter'>;

const STATUS_TEXT: Record<BleStatus['state'], string> = {
  idle: 'Не подключён',
  scanning: 'Ищем устройства…',
  connecting: 'Подключаемся…',
  connected: 'Подключён',
  disconnected: 'Отключён',
  error: 'Ошибка соединения',
};

/**
 * Экран колориметра (§5.4 ТЗ).
 *
 * Приложение работает с интерфейсом BleColorimeterService, а не с конкретным
 * прибором: пока нет документации на модель, подключается заглушка
 * с тестовыми измерениями (§6.2, §8.4 ТЗ).
 */
export function ColorimeterScreen({ navigation }: Props) {
  const service = useMemo(() => getBleColorimeterService(), []);
  const [status, setStatus] = useState<BleStatus>(service.getStatus());
  const [devices, setDevices] = useState<ColorimeterDevice[]>([]);
  const [matches, setMatches] = useState<ColorMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAuthorized = useAuthStore(selectIsAuthorized);
  const measurements = useColorStore(s => s.measurements);
  const addMeasurement = useColorStore(s => s.addMeasurement);
  const clearMeasurements = useColorStore(s => s.clearMeasurements);

  const handleReading = useCallback(
    async (reading: ColorimeterReading) => {
      try {
        const response = await api.palette.nearest({
          lab: reading.lab,
          rgb: reading.rgb,
          hex: reading.hex || undefined,
          limit: 5,
        });
        setMatches(response.matches);
        const best = response.matches[0];
        addMeasurement({
          reading,
          match: best
            ? {
                code: best.color.code,
                name: best.color.name,
                hex: best.color.hex,
                deltaE: best.deltaE,
              }
            : undefined,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось сопоставить цвет');
      }
    },
    [addMeasurement],
  );

  useEffect(() => {
    const offStatus = service.onStatus(setStatus);
    const offReading = service.onReading(reading => {
      handleReading(reading);
    });
    return () => {
      offStatus();
      offReading();
      service.stopScan();
    };
  }, [service, handleReading]);

  useEffect(() => {
    if (!isAuthorized) {
      navigation.replace('Login', {
        reason: 'Работа с колориметром доступна после входа в аккаунт.',
      });
    }
  }, [isAuthorized, navigation]);

  const startScan = async () => {
    setError(null);
    setDevices([]);
    const granted = await service.ensurePermissions();
    if (!granted) {
      setError('Нет разрешения на Bluetooth — выдайте его в настройках.');
      return;
    }
    await service.scan(device =>
      setDevices(prev =>
        prev.some(d => d.id === device.id) ? prev : [...prev, device],
      ),
    );
  };

  const connect = async (deviceId: string) => {
    setError(null);
    try {
      await service.connect(deviceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось подключиться');
    }
  };

  const measure = async () => {
    setBusy(true);
    setError(null);
    try {
      await service.requestMeasurement();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Замер не выполнен');
    } finally {
      setBusy(false);
    }
  };

  const connected = status.state === 'connected';

  return (
    <Screen>
      <View>
        <Title>Колориметр</Title>
        <Subtitle>
          Измерьте цвет прибором — найдём ближайший оттенок ARCHI.
        </Subtitle>
      </View>

      {service.isMock ? (
        <Banner
          tone="info"
          text="Демо-режим прибора: измерения тестовые. Реальный протокол подключим, когда придёт документация на модель."
        />
      ) : null}
      {error ? <Banner text={error} tone="error" onClose={() => setError(null)} /> : null}

      <Card>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.dot,
              { backgroundColor: connected ? colors.good : colors.inkFaint },
            ]}
          />
          <Text style={typography.h3}>{STATUS_TEXT[status.state]}</Text>
        </View>
        {status.device ? (
          <Text style={typography.caption}>{status.device.name}</Text>
        ) : null}
        {status.error ? (
          <Text style={styles.errorText}>{status.error}</Text>
        ) : null}

        {connected ? (
          <View style={styles.actions}>
            <Button title="Сделать замер" onPress={measure} loading={busy} />
            <Button
              title="Отключить"
              variant="secondary"
              onPress={() => service.disconnect()}
            />
          </View>
        ) : (
          <Button
            title={status.state === 'scanning' ? 'Идёт поиск…' : 'Найти прибор'}
            onPress={startScan}
            loading={status.state === 'scanning'}
            style={styles.actionTop}
          />
        )}
      </Card>

      {!connected && devices.length ? (
        <>
          <SectionTitle>Найденные устройства</SectionTitle>
          <Card>
            {devices.map(device => (
              <View key={device.id} style={styles.deviceRow}>
                <View style={styles.deviceInfo}>
                  <Text style={typography.h3}>{device.name}</Text>
                  <Text style={typography.micro}>
                    {device.id}
                    {device.rssi ? ` · ${device.rssi} dBm` : ''}
                  </Text>
                </View>
                <Button
                  title="Подключить"
                  variant="secondary"
                  onPress={() => connect(device.id)}
                />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {matches.length ? (
        <>
          <SectionTitle>Ближайшие оттенки</SectionTitle>
          <Card>
            {matches.map((match, index) => (
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

      <SectionTitle
        action={
          measurements.length ? (
            <Button
              title="Очистить"
              variant="ghost"
              onPress={clearMeasurements}
            />
          ) : undefined
        }>
        История замеров
      </SectionTitle>
      {measurements.length ? (
        <Card>
          {measurements.map(entry => (
            <View key={entry.reading.at} style={styles.historyRow}>
              <View
                style={[
                  styles.historySwatch,
                  { backgroundColor: entry.reading.hex || '#CCC' },
                ]}
              />
              <View style={styles.deviceInfo}>
                <Text style={typography.body}>
                  {entry.match
                    ? `${entry.match.name} · ${entry.match.code}`
                    : entry.reading.hex}
                </Text>
                <Text style={typography.micro}>
                  {new Date(entry.reading.at).toLocaleTimeString('ru-RU')}
                  {entry.match ? ` · ΔE ${entry.match.deltaE.toFixed(2)}` : ''}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      ) : (
        <EmptyState
          title="Замеров пока нет"
          description="Подключите прибор и нажмите «Сделать замер». История хранится до выхода из приложения."
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  actions: { gap: spacing.sm, marginTop: spacing.md },
  actionTop: { marginTop: spacing.md },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  deviceInfo: { flex: 1, gap: 2 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  historySwatch: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(32,36,31,0.12)',
  },
  errorText: { ...typography.caption, color: colors.poor },
});
