import { nearestColors, searchPalette } from '../src/services/paletteSearch';
import { hexToLab } from '../src/services/color';
import { ARCHI_PALETTE } from '../src/data/palette';

describe('поиск по палитре', () => {
  it('находит сам оттенок как ближайший к себе', () => {
    const target = ARCHI_PALETTE.find(c => c.code === 'AP-0224')!;
    const [best] = nearestColors(hexToLab(target.hex)!, 3);
    expect(best.color.code).toBe('AP-0224');
    expect(best.deltaE).toBeLessThan(0.5);
    expect(best.quality).toBe('exact');
  });

  it('возвращает результаты по возрастанию ΔE', () => {
    const deltas = nearestColors(hexToLab('#8C4A3E')!, 5).map(m => m.deltaE);
    expect([...deltas].sort((a, b) => a - b)).toEqual(deltas);
  });

  it('ищет по коду и по названию оттенка', () => {
    expect(searchPalette({ q: 'AP-0224' }).items[0].code).toBe('AP-0224');
    expect(searchPalette({ q: 'кремень' }).items[0].name).toBe('Кремень');
  });

  it('по коду чужого стандарта подбирает, чем его закрыть', () => {
    const result = searchPalette({ q: 'RAL 7016' });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].code).toMatch(/^AP-/);
  });

  it('фильтрует по коллекции', () => {
    const result = searchPalette({ collection: 'ArchiPaint Nord', limit: 500 });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every(c => c.collection === 'ArchiPaint Nord')).toBe(
      true,
    );
  });

  it('на бессмысленный запрос возвращает пусто, а не весь каталог', () => {
    expect(searchPalette({ q: 'ццццц' }).items).toHaveLength(0);
  });
});
