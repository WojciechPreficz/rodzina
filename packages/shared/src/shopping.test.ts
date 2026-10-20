import { describe, expect, it } from 'vitest';
import { parseShoppingInput } from './shopping.js';

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
