/**
 * Калькулятор расхода краски (§5.5, §6.3 ТЗ).
 *
 * Формула: литры = площадь_м² × слои / расход_м²_на_литр,
 * дальше — набор фасовки с округлением вверх.
 *
 * Расчёт живёт и на клиенте, и на бэкенде: §4 ТЗ допускает оба варианта.
 * Клиентский вариант нужен, чтобы калькулятор работал без авторизации
 * и без сети; если бэкенд отдаёт свой ответ — показываем его.
 */
import type { CoverageCalcResponse, Product } from '../api/types';

export interface WallInput {
  widthM: number;
  heightM: number;
}

export interface OpeningInput {
  widthM: number;
  heightM: number;
  count: number;
}

/** Площадь стен минус проёмы. Отрицательный результат исключён. */
export function areaFromWalls(
  walls: WallInput[],
  openings: OpeningInput[] = [],
): number {
  const wallArea = walls.reduce(
    (sum, w) => sum + Math.max(0, w.widthM) * Math.max(0, w.heightM),
    0,
  );
  const openingArea = openings.reduce(
    (sum, o) =>
      sum +
      Math.max(0, o.widthM) * Math.max(0, o.heightM) * Math.max(0, o.count),
    0,
  );
  return Math.max(0, wallArea - openingArea);
}

/**
 * Подбирает фасовку жадно, от большой банки к маленькой, а затем проверяет,
 * не выгоднее ли по объёму взять на одну маленькую банку больше вместо
 * недобора. Возвращает набор, покрывающий потребность с минимальным излишком.
 */
export function packsFor(
  litersRequired: number,
  packSizesL: number[],
): { sizeL: number; count: number }[] {
  const sizes = [...new Set(packSizesL)].sort((a, b) => b - a);
  if (!sizes.length || litersRequired <= 0) {
    return [];
  }

  const smallest = sizes[sizes.length - 1];
  const result: { sizeL: number; count: number }[] = [];
  let rest = litersRequired;

  sizes.forEach((size, index) => {
    const isLast = index === sizes.length - 1;
    const count = isLast
      ? Math.ceil(rest / size - 1e-9)
      : Math.floor(rest / size + 1e-9);
    if (count > 0) {
      result.push({ sizeL: size, count });
      rest -= count * size;
    }
  });

  if (rest > 1e-9) {
    const last = result.find(p => p.sizeL === smallest);
    const extra = Math.ceil(rest / smallest - 1e-9);
    if (last) {
      last.count += extra;
    } else {
      result.push({ sizeL: smallest, count: extra });
    }
  }

  return result;
}

export function calcCoverage(
  areaM2: number,
  layers: number,
  product: Product,
): CoverageCalcResponse {
  const safeArea = Math.max(0, areaM2);
  const safeLayers = Math.max(1, Math.round(layers));
  const litersRequired =
    Math.round(((safeArea * safeLayers) / product.coverageM2PerLiter) * 100) /
    100;

  const packs = packsFor(litersRequired, product.packSizesL);
  const litersPurchased =
    Math.round(packs.reduce((sum, p) => sum + p.sizeL * p.count, 0) * 100) /
    100;

  return {
    litersRequired,
    packs,
    litersPurchased,
    price: Math.round(litersPurchased * product.priceBase),
    product,
  };
}
