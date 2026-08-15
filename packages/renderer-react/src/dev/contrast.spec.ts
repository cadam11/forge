import { describe, expect, it } from 'vitest';

import { composite, contrastRatio, parseCssColor, relativeLuminance, verdictFor } from './contrast';

const ratio = (fg: string, bg: string): number =>
  contrastRatio(parseCssColor(fg), parseCssColor(bg));

describe('parseCssColor', () => {
  it('reads the forms theme.css authors', () => {
    expect(parseCssColor('#171817')).toEqual({ r: 23, g: 24, b: 23, a: 1 });
    expect(parseCssColor('  #FFF ')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor('rgb(242 239 231 / 0.12)')).toEqual({ r: 242, g: 239, b: 231, a: 0.12 });
    expect(parseCssColor('rgba(23, 24, 23, 0.5)')).toEqual({ r: 23, g: 24, b: 23, a: 0.5 });
  });

  it('throws rather than guessing at an unsupported value', () => {
    expect(() => parseCssColor('oklch(0.5 0.1 30)')).toThrow(/unsupported colour value/);
    expect(() => parseCssColor('rgb(1 2)')).toThrow(/3 colour channels/);
  });
});

describe('relativeLuminance and composite', () => {
  it('anchors at black and white', () => {
    expect(relativeLuminance(parseCssColor('#000'))).toBe(0);
    expect(relativeLuminance(parseCssColor('#fff'))).toBeCloseTo(1, 10);
    expect(ratio('#fff', '#000')).toBeCloseTo(21, 10);
  });

  it('refuses to measure a translucent colour without a backdrop', () => {
    expect(() => relativeLuminance(parseCssColor('rgb(0 0 0 / 0.5)'))).toThrow(/opaque/);
    expect(() => composite(parseCssColor('#fff'), parseCssColor('rgb(0 0 0 / 0.5)'))).toThrow(
      /backdrop must be opaque/
    );
  });

  it('flattens a translucent foreground onto its backdrop', () => {
    // The ink theme's --color-rule: ivory at 12% over the ink canvas.
    const flattened = composite(parseCssColor('rgb(242 239 231 / 0.12)'), parseCssColor('#171817'));
    expect(flattened.a).toBe(1);
    expect(flattened.r).toBeCloseTo(23 + (242 - 23) * 0.12, 6);
  });
});

/**
 * PROPOSAL §2.3's table, recomputed. Every derived colour exists because the raw brand
 * hex next to it failed, so these assertions are the regression guard on the values in
 * theme.css — change a hex and the pair that justified it fails here.
 */
describe('PROPOSAL §2.3 contrast pairs', () => {
  const IVORY = '#f2efe7';
  const INK = '#171817';
  const OXIDE = '#d6492f';
  const OXIDE_DEEP = '#b83c22';
  const OXIDE_LIFT = '#e8654a';
  const CHARTREUSE = '#c8f04a';
  const AMBER = '#e6a23c';
  const AMBER_DEEP = '#8a5a10';
  // Not PROPOSAL §2.2's #4e7a12, which measures 4.44:1 on ivory. See theme.css.
  const VERIFY_DEEP = '#4d7811';
  const VERIFY_DEEP_PROPOSED = '#4e7a12';

  it.each([
    ['ivory on ink', IVORY, INK, 15.5],
    ['oxide on ink', OXIDE, INK, 4.11],
    ['oxide-lift on ink', OXIDE_LIFT, INK, 5.42],
    ['oxide on ivory', OXIDE, IVORY, 3.77],
    ['oxide-deep on ivory', OXIDE_DEEP, IVORY, 4.93],
    ['white on oxide fill', '#ffffff', OXIDE, 4.33],
    ['white on oxide-deep fill', '#ffffff', OXIDE_DEEP, 5.66],
    ['chartreuse on ink', CHARTREUSE, INK, 13.58],
    ['chartreuse on ivory', CHARTREUSE, IVORY, 1.14],
    ['amber on ivory', AMBER, IVORY, 1.9],
    ['amber-deep on ivory', AMBER_DEEP, IVORY, 5.15],
    ['verify-deep on ivory', VERIFY_DEEP, IVORY, 4.56],
  ])('%s measures %#', (_label, fg, bg, expected) => {
    expect(ratio(fg, bg)).toBeCloseTo(expected, 2);
  });

  it('the derived colours clear the threshold the raw hex missed', () => {
    // Body text on its own canvas needs 4.5:1.
    expect(ratio(OXIDE, INK)).toBeLessThan(4.5);
    expect(ratio(OXIDE_LIFT, INK)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(OXIDE, IVORY)).toBeLessThan(4.5);
    expect(ratio(OXIDE_DEEP, IVORY)).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#ffffff', OXIDE)).toBeLessThan(4.5);
    expect(ratio('#ffffff', OXIDE_DEEP)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(AMBER, IVORY)).toBeLessThan(3);
    expect(ratio(AMBER_DEEP, IVORY)).toBeGreaterThanOrEqual(4.5);
    // verify-deep is the light-mode --color-success and chartreuse is why it exists.
    expect(ratio(CHARTREUSE, IVORY)).toBeLessThan(3);
    expect(ratio(VERIFY_DEEP, IVORY)).toBeGreaterThanOrEqual(4.5);
  });

  it('holds verify-deep above AA body, which the proposal value did not manage', () => {
    // The whole category is "derived, contrast-driven", so the one thing this colour may
    // never do is sit below 4.5:1 on the canvas it was derived for. PROPOSAL §2.2's
    // #4e7a12 does exactly that (4.44:1) and §2.3 never tabulated the pair, so the value
    // was corrected to #4d7811. This test is the guard: it fails if anyone reverts the
    // hex, and it will not accept a value that merely clears AA-large.
    expect(ratio(VERIFY_DEEP_PROPOSED, IVORY)).toBeLessThan(4.5);
    expect(ratio(VERIFY_DEEP, IVORY)).toBeGreaterThanOrEqual(4.5);
    expect(verdictFor(ratio(VERIFY_DEEP, IVORY))).toBe('aa-body');
  });

  it('never permits chartreuse as a light-mode foreground', () => {
    expect(ratio(CHARTREUSE, IVORY)).toBeLessThan(3);
    // Inverted, it is the strongest pair in the palette — hence fill-only.
    expect(ratio(INK, CHARTREUSE)).toBeGreaterThan(13);
  });
});

describe('verdictFor', () => {
  it('splits on the WCAG AA thresholds', () => {
    expect(verdictFor(4.5)).toBe('aa-body');
    expect(verdictFor(4.49)).toBe('aa-large');
    expect(verdictFor(3)).toBe('aa-large');
    expect(verdictFor(2.99)).toBe('fail');
  });
});
