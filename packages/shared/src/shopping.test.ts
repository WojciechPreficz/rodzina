import { describe, expect, it } from 'vitest';
import { mergeQuantities, normalizeShoppingName, parseShoppingInput } from './shopping.js';

describe('mergeQuantities', () => {
  it.each([
    [['500 g', '1 kg'], '500 g + 1 kg'],
    [[' 500 g ', null, '', undefined, ' 1 kg '], '500 g + 1 kg'],
    [[null, undefined, '  '], null],
    [[], null],
    [['2 szt', '2 szt'], '2 szt + 2 szt'],
    [['do smaku', '1 łyżka'], 'do smaku + 1 łyżka'],
  ] as const)('joins %j without converting units', (quantities, expected) => {
    expect(mergeQuantities(...quantities)).toBe(expected);
  });
});

describe('normalizeShoppingName', () => {
  it('normalizes case, Unicode compatibility and whitespace, preserving Polish letters', () => {
    expect(normalizeShoppingName('  MĄKA\u00a0  Pszenna  ')).toBe('mąka pszenna');
    expect(normalizeShoppingName('ＭＬＥＫＯ')).toBe('mleko');
    expect(normalizeShoppingName('Sól')).not.toBe(normalizeShoppingName('Sol'));
  });
});

describe('parseShoppingInput', () => {
  it.each([
    ['mleko 2l', 'mleko', '2l'],
    ['jajka 10 szt', 'jajka', '10 szt'],
    ['  mąka pszenna   1,5 kg  ', 'mąka pszenna', '1,5 kg'],
    ['woda 0.5 l', 'woda', '0.5 l'],
    ['witamina B12', 'witamina B12', null],
    ['7up', '7up', null],
    ['chleb razowy', 'chleb razowy', null],
    ['', '', null],
  ])('parses %s', (input, name, quantity) => {
    expect(parseShoppingInput(input)).toEqual({ name, quantity });
  });
});
