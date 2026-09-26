import { describe, expect, it } from 'vitest';
import { ceilingFt, parseMetar, weatherWord } from '../src/data/metar.ts';

describe('parseMetar', () => {
  it("reads Changi's hazy evening", () => {
    const m = parseMetar('METAR WSSS 261500Z 11004KT 4000 HZ FEW018 FEW020CB BKN280 29/26 Q1012 NOSIG');
    expect(m.visKm).toBe(4);
    expect(m.weather).toEqual(['HZ']);
    expect(m.clouds).toEqual([
      { cover: 'FEW', baseFt: 1800 },
      { cover: 'FEW', baseFt: 2000 },
      { cover: 'BKN', baseFt: 28000 },
    ]);
    expect(weatherWord(m.weather)).toBe('haze');
    expect(ceilingFt(m)).toBe(28000);
  });

  it('knows "10 km or more" and CAVOK', () => {
    expect(parseMetar('METAR WSSS 260600Z 16008KT 9999 FEW020 32/24 Q1010 NOSIG').visKm).toBe(10);
    const cavok = parseMetar('METAR WSSS 260700Z 18010KT CAVOK 31/23 Q1009');
    expect(cavok).toMatchObject({ visKm: 10, weather: [], clouds: [] });
  });

  it('reads showers and a low broken deck, and ignores the forecast part', () => {
    const m = parseMetar('SPECI WSSS 260812Z 24012G25KT 200V280 3000 +TSRA VCSH BKN012CB OVC080 25/24 Q1008 TEMPO 1500 TSRA');
    expect(m.visKm).toBe(3);
    expect(m.weather).toEqual(['+TSRA', 'VCSH']);
    expect(weatherWord(m.weather)).toBe('thunderstorms');
    expect(ceilingFt(m)).toBe(1200);
  });

  it('reads fog with an obscured sky, and US-style visibility', () => {
    const fog = parseMetar('METAR WSSS 252300Z 00000KT 0800 FG VV002 24/24 Q1011');
    expect(fog.visKm).toBeCloseTo(0.8);
    expect(ceilingFt(fog)).toBe(200);
    expect(parseMetar('METAR KSFO 261556Z 28012KT 1/2SM BR OVC004 12/11 A2992').visKm).toBeCloseTo(0.8, 1);
    expect(parseMetar('METAR KSFO 261556Z 28012KT P6SM FEW200 18/08 A2992').visKm).toBe(10);
  });

  it('ignores weather that is only nearby', () => {
    expect(weatherWord(['VCSH'])).toBeUndefined();
    expect(weatherWord(['-RA', 'BR'])).toBe('rain');
  });
});
