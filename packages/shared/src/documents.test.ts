import { describe, expect, it } from 'vitest';
import { DOCUMENT_TYPES, getDefaultDocumentReminders, getDocumentStatus } from './documents.js';
import { createDocumentSchema, patchDocumentSchema } from './schemas/documents.js';
import { documentUrl } from './urls.js';
import { scheduledReminderSchema } from './schemas/schedule.js';

describe('document status', () => {
  const thresholds = {
    id_card: 90,
    passport: 120,
    car_insurance: 30,
    car_inspection: 30,
    car_guarantee_inspection: 30,
    other: 30,
  };
  it.each(DOCUMENT_TYPES)('%s changes status at its first reminder and after the expiry day', (type) => {
    const expiry = '2028-04-30';
    const before = (days: number) =>
      new Date(Date.parse(`${expiry}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
    expect(getDocumentStatus(type, expiry, before(thresholds[type] + 1))).toBe('valid');
    expect(getDocumentStatus(type, expiry, before(thresholds[type]))).toBe('expiring');
    expect(getDocumentStatus(type, expiry, before(thresholds[type] - 1))).toBe('expiring');
    expect(getDocumentStatus(type, expiry, expiry)).toBe('expiring');
    expect(getDocumentStatus(type, expiry, '2028-05-01')).toBe('expired');
  });
  it('uses calendar days across leap days and DST changes', () => {
    expect(getDocumentStatus('other', '2028-03-30', '2028-02-29')).toBe('expiring');
    expect(getDocumentStatus('other', '2028-03-31', '2028-02-29')).toBe('valid');
    expect(getDocumentStatus('other', '2026-04-28', '2026-03-29')).toBe('expiring');
  });
  it('defines day offsets addressed to adults for every type', () => {
    const offsets = [[90, 30], [120, 30], [30, 7], [30, 7], [30, 7], [30]];
    DOCUMENT_TYPES.forEach((type, index) =>
      expect(getDefaultDocumentReminders(type)).toEqual(
        offsets[index]!.map((offsetValue) => ({ type: 'offset', offsetValue, offsetUnit: 'day', audience: 'adults' })),
      ),
    );
  });
});

describe('document inputs', () => {
  const document = { type: 'other', label: ' Polisa ', expiresOn: '2028-02-29' };
  it('trims labels and supports partial updates and explicit clearing', () => {
    expect(createDocumentSchema.parse(document).label).toBe('Polisa');
    expect(patchDocumentSchema.parse({ notes: null, holderUserId: null, vehicleLabel: null })).toEqual({
      notes: null,
      holderUserId: null,
      vehicleLabel: null,
    });
  });
  it.each([
    { expiresOn: '2027-02-29' },
    { expiresOn: '2028-04-31' },
    { expiresOn: '22.10.2026' },
    { type: 'scan' },
    { label: ' ' },
    { label: 'x'.repeat(201) },
    { holderUserId: 'bad' },
    { vehicleLabel: '' },
    { notes: 'x'.repeat(10001) },
    { number: '123' },
    { familyId: 'ignored' },
    { createdBy: 'ignored' },
  ])('rejects invalid or unsupported fields: %j', (fields) => {
    expect(createDocumentSchema.safeParse({ ...document, ...fields }).success).toBe(false);
    expect(patchDocumentSchema.safeParse(fields).success).toBe(false);
  });
  it('rejects empty patches', () => expect(patchDocumentSchema.safeParse({}).success).toBe(false));
  it('accepts explicit empty reminders and defaults their audience to adults', () => {
    expect(createDocumentSchema.parse({ ...document, reminders: [] }).reminders).toEqual([]);
    expect(
      patchDocumentSchema.parse({ reminders: [{ type: 'offset', offsetValue: 7, offsetUnit: 'day' }] }).reminders?.[0]
        ?.audience,
    ).toBe('adults');
  });
  it('builds and validates document schedule URLs without accepting another source or external links', () => {
    const id = '10000000-0000-4000-8000-000000000001';
    const entry = {
      key: 'document',
      reminderId: id,
      sourceType: 'document',
      sourceId: id,
      occurrenceDate: '2026-11-15',
      fireAt: 1,
      title: 'Dokument',
      body: 'Ważne do 15.11.2026',
      url: documentUrl(id),
    };
    expect(entry.url).toBe(`/dokumenty/${id}`);
    expect(documentUrl('a/b')).toBe('/dokumenty/a%2Fb');
    expect(scheduledReminderSchema.safeParse(entry).success).toBe(true);
    for (const url of [
      'https://example.com',
      '//example.com',
      `/zadania/${id}?zadanie=${id}`,
      '/dokumenty/',
      `/dokumenty/${id}?url=https://example.com`,
    ])
      expect(scheduledReminderSchema.safeParse({ ...entry, url }).success).toBe(false);
  });
});
