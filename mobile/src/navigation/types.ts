import type { NavigatorScreenParams } from '@react-navigation/native';
import type { ArchiColor, Order } from '../api/types';

export type TabParamList = {
  Home: undefined;
  Palette: undefined;
  Cart: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Login: { reason?: string } | undefined;
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  PhotoMatch: undefined;
  Colorimeter: undefined;
  Calculator: { colorCode?: string } | undefined;
  ColorDetail: { color: ArchiColor };
  Checkout: undefined;
  OrderSuccess: { order: Order };
  Orders: undefined;
  SavedColors: undefined;
};
