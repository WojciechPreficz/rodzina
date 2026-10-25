import { describe, expect, it } from 'vitest';
import { createContactSchema, patchContactSchema, createContactGroupSchema } from './contacts.js';

describe('contact contracts', () => {
  it('accepts a name alone, trims fields and normalizes blank optional values', () => {
    expect(createContactSchema.parse({ name: ' Anna ' })).toEqual({ name: 'Anna' });
    expect(createContactSchema.parse({ name: 'Anna', address: ' \n ', phone: null, relationship: '' })).toEqual({
      name: 'Anna',
      address: null,
      phone: null,
      relationship: null,
    });
    expect(patchContactSchema.parse({ phone: '+44 (20) 123-456', address: ' A\nB ' })).toEqual({
      phone: '+44 (20) 123-456',
      address: 'A\nB',
    });
    expect(patchContactSchema.parse({ name: 'Nowa' })).toEqual({ name: 'Nowa' });
  });
  it.each([
    ['name', 120],
    ['address', 1000],
    ['phone', 50],
    ['relationship', 120],
  ] as const)('enforces the %s limit on creation and patch', (field, limit) => {
    expect(createContactSchema.safeParse({ name: 'Anna', [field]: 'a'.repeat(limit) }).success).toBe(true);
    expect(createContactSchema.safeParse({ name: 'Anna', [field]: 'a'.repeat(limit + 1) }).success).toBe(false);
    expect(patchContactSchema.safeParse({ [field]: 'a'.repeat(limit + 1) }).success).toBe(false);
  });
  it('rejects empty names, invalid groups, unknown fields and empty patches', () => {
    for (const data of [{ name: ' ' }, { name: null }, { groupId: null }, { groupId: 'bad' }, {}, { familyId: 'fake' }])
      expect(patchContactSchema.safeParse(data).success).toBe(false);
    expect(createContactGroupSchema.parse({ name: ' Praca ' })).toEqual({ name: 'Praca' });
    for (const data of [{ name: '' }, { name: ' ' }, { name: 'a'.repeat(61) }, { name: 'Inne', isDefault: true }])
      expect(createContactGroupSchema.safeParse(data).success).toBe(false);
    expect(createContactGroupSchema.safeParse({ name: 'a'.repeat(60) }).success).toBe(true);
  });
});
