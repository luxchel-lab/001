/**
 * Продуктовые линейки ArchiPaint (§5.2 ТЗ).
 *
 * Сама таблица лежит в products.json — её же читает мок-сервер, чтобы
 * приложение и стенд считали расход по одним и тем же числам.
 *
 * ВНИМАНИЕ — TBD (§9 ТЗ): расход (м²/л), цены и фасовка ЧЕРНОВЫЕ, взяты как
 * правдоподобные значения для разработки калькулятора. Перед релизом
 * заменить таблицей от товароведа; боевые данные должны приезжать
 * с бэкенда (GET /api/catalog/products), а этот файл остаётся офлайн-фолбэком.
 */
import type { Product } from '../api/types';
import productsJson from './products.json';

export const PRODUCTS = productsJson as Product[];

export function findProduct(sku: string): Product | undefined {
  return PRODUCTS.find(p => p.sku === sku);
}
