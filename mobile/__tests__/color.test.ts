import {
  deltaE2000,
  hexToLab,
  hexToRgb,
  matchQuality,
  readableTextColor,
  rgbToHex,
  rgbToLab,
} from '../src/services/color';

describe('цветовая математика', () => {
  it('разбирает и собирает HEX', () => {
    expect(hexToRgb('#2C3136')).toEqual([44, 49, 54]);
    expect(hexToRgb('fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('нет')).toBeNull();
    expect(rgbToHex([44, 49, 54])).toBe('#2C3136');
  });

  it('переводит sRGB в Lab так же, как код сайта', () => {
    // Эталон сверен с assets/js/podbor.color.js для #2C3136.
    const [l, a, b] = rgbToLab([44, 49, 54]);
    expect(l).toBeCloseTo(20.037, 2);
    expect(a).toBeCloseTo(-0.862, 2);
    expect(b).toBeCloseTo(-3.908, 2);
  });

  it('даёт нулевой ΔE для одинаковых цветов', () => {
    const lab = hexToLab('#8C4A3E')!;
    expect(deltaE2000(lab, lab)).toBeCloseTo(0, 6);
  });

  it('согласуется с эталонным значением CIEDE2000', () => {
    expect(deltaE2000([50, 0, 0], [55, 2, 2])).toBeCloseTo(5.9356, 3);
  });

  it('переводит ΔE в понятную оценку', () => {
    expect(matchQuality(0.4)).toBe('exact');
    expect(matchQuality(2)).toBe('close');
    expect(matchQuality(4)).toBe('visible');
    expect(matchQuality(9)).toBe('far');
  });

  it('выбирает читаемый цвет текста поверх плашки', () => {
    expect(readableTextColor('#FFFFFF')).toBe('#20241F');
    expect(readableTextColor('#20241F')).toBe('#FFFFFF');
  });
});
