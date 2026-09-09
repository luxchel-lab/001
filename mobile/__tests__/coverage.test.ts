import { areaFromWalls, calcCoverage, packsFor } from '../src/services/coverage';
import { PRODUCTS, findProduct } from '../src/data/products';

const premiumMatt = findProduct('AP-PREM-MATT')!;

describe('калькулятор расхода (§6.3 ТЗ)', () => {
  it('считает литры по формуле площадь × слои / расход', () => {
    expect(calcCoverage(24, 2, premiumMatt).litersRequired).toBeCloseTo(4, 2);
  });

  it('округляет вверх по фасовке и не оставляет недобора', () => {
    const result = calcCoverage(24, 2, premiumMatt);
    expect(result.litersPurchased).toBeGreaterThanOrEqual(result.litersRequired);
    expect(result.packs).toEqual([
      { sizeL: 2.7, count: 1 },
      { sizeL: 0.9, count: 2 },
    ]);
  });

  it('никогда не отдаёт меньше нужного объёма ни для одного продукта', () => {
    PRODUCTS.forEach(product => {
      [1, 7.5, 18, 60, 137.3].forEach(area => {
        const result = calcCoverage(area, 2, product);
        expect(result.litersPurchased).toBeGreaterThanOrEqual(
          result.litersRequired - 1e-9,
        );
      });
    });
  });

  it('на нулевой площади не предлагает банок', () => {
    const result = calcCoverage(0, 2, premiumMatt);
    expect(result.litersRequired).toBe(0);
    expect(result.packs).toEqual([]);
    expect(result.price).toBe(0);
  });

  it('вычитает проёмы из площади стен', () => {
    const area = areaFromWalls(
      [
        { widthM: 4, heightM: 2.7 },
        { widthM: 3, heightM: 2.7 },
      ],
      [{ widthM: 1, heightM: 1.5, count: 2 }],
    );
    expect(area).toBeCloseTo(4 * 2.7 + 3 * 2.7 - 3, 5);
  });

  it('не уходит в отрицательную площадь при огромных проёмах', () => {
    expect(
      areaFromWalls(
        [{ widthM: 2, heightM: 2 }],
        [{ widthM: 5, heightM: 5, count: 1 }],
      ),
    ).toBe(0);
  });

  it('подбирает фасовку крупными банками', () => {
    expect(packsFor(10, [0.9, 2.7, 9])).toEqual([
      { sizeL: 9, count: 1 },
      { sizeL: 0.9, count: 2 },
    ]);
  });
});
