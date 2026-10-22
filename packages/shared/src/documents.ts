export const DOCUMENT_TYPES = [
  'id_card',
  'passport',
  'car_insurance',
  'car_inspection',
  'car_guarantee_inspection',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type DocumentStatus = 'valid' | 'expiring' | 'expired';

export const DOCUMENT_DEFAULT_REMINDERS = {
  id_card: [90, 30],
  passport: [120, 30],
  car_insurance: [30, 7],
  car_inspection: [30, 7],
  car_guarantee_inspection: [30, 7],
  other: [30],
} as const satisfies Record<DocumentType, readonly number[]>;

export function getDefaultDocumentReminders(type: DocumentType) {
  return DOCUMENT_DEFAULT_REMINDERS[type].map((offsetValue) => ({
    type: 'offset' as const,
    offsetValue,
    offsetUnit: 'day' as const,
    audience: 'adults' as const,
  }));
}

/** Calendar dates in the family's timezone; the document remains valid on expiresOn. */
export function getDocumentStatus(type: DocumentType, expiresOn: string, today: string): DocumentStatus {
  const remainingDays = (Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
  if (remainingDays < 0) return 'expired';
  return remainingDays <= Math.max(...DOCUMENT_DEFAULT_REMINDERS[type]) ? 'expiring' : 'valid';
}
