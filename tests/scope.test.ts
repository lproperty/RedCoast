import { describe, expect, it } from 'vitest';
import { sectorGeometry, sweptPast, type Corners } from '../src/render/scope.ts';

describe('sweep', () => {
  it('lights contacts as the beam turns past them, including across screen-up', () => {
    expect(sweptPast(10, 20, 1, 15, true)).toBe(true);
    expect(sweptPast(10, 20, 1, 25, true)).toBe(false);
    expect(sweptPast(350, 5, 1, 0, true)).toBe(true);
    expect(sweptPast(350, 5, 1, -5, true)).toBe(true);
  });

  it('does not keep relighting a contact on the left once the beam has passed it', () => {
    // Screen angles run -180..180; the beam runs 0..360. A contact at -170 is at 190.
    expect(sweptPast(185, 195, 1, -170, true)).toBe(true);
    expect(sweptPast(200, 210, 1, -170, true)).toBe(false);
    expect(sweptPast(300, 310, 1, -170, true)).toBe(false);
  });

  it('follows a sector sweep both ways', () => {
    expect(sweptPast(-10, 0, 1, -5, false)).toBe(true);
    expect(sweptPast(0, -10, -1, -5, false)).toBe(true);
    expect(sweptPast(0, -10, -1, 5, false)).toBe(false);
  });
});

describe('sector geometry', () => {
  const phone: Corners = { tl: [70, 36], tr: [140, 20], bl: [120, 24], br: [140, 40] };

  it('uses the full width of a phone and needs little more height than the fan', () => {
    const g = sectorGeometry(376, 150, phone);
    expect(g.half).toBe(87);
    expect(g.maxR).toBeCloseTo(160, 0);
    const h = g.height(g.maxR);
    expect(h).toBeGreaterThan(g.maxR + 40);
    expect(h).toBeLessThan(260);
  });

  it('moves the fan down so its bearing labels clear wide corner controls', () => {
    const open = sectorGeometry(376, 150);
    const crowded = sectorGeometry(376, 150, { ...phone, tr: [300, 40] });
    expect(crowded.above(160)).toBeGreaterThan(open.above(160) + 30);
    expect(open.above(160)).toBeCloseTo(160 + 27, 0);
  });

  it('keeps the apex and the fan ends above the bottom controls', () => {
    const g = sectorGeometry(376, 150, phone);
    // The zoom buttons (40 px tall) sit below the apex line.
    expect(g.below(160)).toBeGreaterThanOrEqual(40);
    // A narrow fan leaves the bottom corners free, so they don't add height.
    const narrow = sectorGeometry(376, 60, phone);
    expect(narrow.below(narrow.maxR)).toBeLessThan(15);
  });

  it('grows taller for a narrow view', () => {
    const wide = sectorGeometry(376, 150, phone);
    const narrow = sectorGeometry(376, 60, phone);
    expect(narrow.maxR).toBeGreaterThan(wide.maxR * 1.3);
  });
});
