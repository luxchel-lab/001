/**
 * Арчи — мобильное приложение ArchiPaint.
 * Точка входа: гидратация сессии и локальных данных, затем навигация.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useAuthStore } from './src/store/authStore';
import { useColorStore } from './src/store/colorStore';
import { colors } from './src/theme';

function App() {
  const hydrateAuth = useAuthStore(s => s.hydrate);
  const hydrateColors = useColorStore(s => s.hydrate);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([hydrateAuth(), hydrateColors()]).finally(() => setReady(true));
  }, [hydrateAuth, hydrateColors]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      {ready ? (
        <RootNavigator />
      ) : (
        <View style={styles.splash}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
});

export default App;
