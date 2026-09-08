import React from 'react';
import { StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/HomeScreen';
import { PaletteScreen } from '../screens/PaletteScreen';
import { CartScreen } from '../screens/CartScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { selectCartCount, useCartStore } from '../store/cartStore';
import { colors, radius, spacing } from '../theme';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

/**
 * Иконка вкладки: цветовая плашка — узнаваемо для приложения о красках.
 * Рендереры создаются один раз, вне рендера навигатора.
 */
function makeTabIcon(tint: string) {
  const iconStyle = { backgroundColor: tint };
  return function TabIcon({ focused }: { focused: boolean }) {
    return (
      <View
        style={[styles.icon, iconStyle, focused ? styles.iconOn : styles.iconOff]}
      />
    );
  };
}

const TAB_ICONS = {
  home: makeTabIcon(colors.accent),
  palette: makeTabIcon(colors.terra),
  cart: makeTabIcon(colors.mid),
  profile: makeTabIcon(colors.ink),
};

export function TabNavigator() {
  const cartCount = useCartStore(selectCartCount);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarStyle: styles.bar,
      }}>
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'Главная',
          tabBarIcon: TAB_ICONS.home,
        }}
      />
      <Tab.Screen
        name="Palette"
        component={PaletteScreen}
        options={{
          title: 'Палитра',
          tabBarIcon: TAB_ICONS.palette,
        }}
      />
      <Tab.Screen
        name="Cart"
        component={CartScreen}
        options={{
          title: 'Корзина',
          tabBarBadge: cartCount || undefined,
          tabBarIcon: TAB_ICONS.cart,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: 'Профиль',
          tabBarIcon: TAB_ICONS.profile,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.card,
    borderTopColor: colors.line,
    height: 62,
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm,
  },
  icon: { width: 18, height: 18, borderRadius: radius.sm - 4 },
  iconOn: { opacity: 1 },
  iconOff: { opacity: 0.35 },
});
