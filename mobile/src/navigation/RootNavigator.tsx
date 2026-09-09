import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TabNavigator } from './TabNavigator';
import { LoginScreen } from '../screens/LoginScreen';
import { PhotoMatchScreen } from '../screens/PhotoMatchScreen';
import { ColorimeterScreen } from '../screens/ColorimeterScreen';
import { CalculatorScreen } from '../screens/CalculatorScreen';
import { ColorDetailScreen } from '../screens/ColorDetailScreen';
import { CheckoutScreen } from '../screens/CheckoutScreen';
import { OrderSuccessScreen } from '../screens/OrderSuccessScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { SavedColorsScreen } from '../screens/SavedColorsScreen';
import { selectIsAuthorized, useAuthStore } from '../store/authStore';
import { colors } from '../theme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.paper,
    card: colors.card,
    text: colors.ink,
    border: colors.line,
    primary: colors.accent,
  },
};

export function RootNavigator() {
  const isAuthorized = useAuthStore(selectIsAuthorized);
  const skipped = useAuthStore(s => s.skipped);
  const showLoginFirst = !isAuthorized && !skipped;

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        initialRouteName={showLoginFirst ? 'Login' : 'Tabs'}
        screenOptions={{
          headerBackTitle: 'Назад',
          headerTintColor: colors.ink,
          headerStyle: { backgroundColor: colors.paper },
          contentStyle: { backgroundColor: colors.paper },
        }}>
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Tabs"
          component={TabNavigator}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="PhotoMatch"
          component={PhotoMatchScreen}
          options={{ title: 'Цвет по фото' }}
        />
        <Stack.Screen
          name="Colorimeter"
          component={ColorimeterScreen}
          options={{ title: 'Колориметр' }}
        />
        <Stack.Screen
          name="Calculator"
          component={CalculatorScreen}
          options={{ title: 'Калькулятор' }}
        />
        <Stack.Screen
          name="ColorDetail"
          component={ColorDetailScreen}
          options={{ title: 'Оттенок' }}
        />
        <Stack.Screen
          name="Checkout"
          component={CheckoutScreen}
          options={{ title: 'Оформление' }}
        />
        <Stack.Screen
          name="OrderSuccess"
          component={OrderSuccessScreen}
          options={{ title: 'Заказ принят', headerBackVisible: false }}
        />
        <Stack.Screen
          name="Orders"
          component={OrdersScreen}
          options={{ title: 'Мои заказы' }}
        />
        <Stack.Screen
          name="SavedColors"
          component={SavedColorsScreen}
          options={{ title: 'Сохранённые цвета' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
