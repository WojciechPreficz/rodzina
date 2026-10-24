import type { DocumentStatus, DocumentType } from '@rodzina/shared';

export const documentTypeLabels: Record<DocumentType, string> = {
  id_card: 'Dowód osobisty',
  passport: 'Paszport',
  car_insurance: 'OC/AC pojazdu',
  car_inspection: 'Przegląd techniczny',
  car_guarantee_inspection: 'Przegląd gwarancyjny samochodu',
  home_insurance: 'Ubezpieczenie mieszkania',
  rental_agreement: 'Umowa najmu mieszkania',
  other: 'Inny',
};
export const documentStatuses: Record<DocumentStatus, { label: string; color: string }> = {
  valid: { label: 'Ważny', color: 'green' },
  expiring: { label: 'Wygasa', color: 'orange' },
  expired: { label: 'Wygasł', color: 'red' },
};
export const hasHolder = (type: DocumentType) => type === 'id_card' || type === 'passport';
export const hasVehicle = (type: DocumentType) =>
  ['car_insurance', 'car_inspection', 'car_guarantee_inspection'].includes(type);
export const hasHome = (type: DocumentType) => type === 'home_insurance' || type === 'rental_agreement';

export function documentExpiry(expiresOn: string, today: string): string {
  const end = new Date(`${expiresOn}T00:00:00Z`);
  const start = new Date(`${today}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000);
  const date = expiresOn.split('-').reverse().join('.');
  let relative: string;
  if (days < 0) relative = `wygasł ${-days} ${days === -1 ? 'dzień' : 'dni'} temu`;
  else if (days === 0) relative = 'wygasa dzisiaj';
  else if (days === 1) relative = 'wygasa jutro';
  else {
    let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
    if (end.getUTCDate() < start.getUTCDate()) months--;
    const years = Math.floor(months / 12);
    const remainder = months % 12;
    const yearText =
      years === 1
        ? '1 rok'
        : `${years} ${years % 10 >= 2 && years % 10 <= 4 && (years % 100 < 12 || years % 100 > 14) ? 'lata' : 'lat'}`;
    relative =
      years > 0
        ? `za ${yearText}${remainder ? ` i ${remainder} mies.` : ''}`
        : months > 0
          ? `za ${months} mies.`
          : `za ${days} dni`;
  }
  return `ważny do ${date} (${relative})`;
}
