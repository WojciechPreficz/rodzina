import type { Contact } from '@rodzina/shared';

export function normalizeContactText(value: string) {
  return value.toLocaleLowerCase('pl-PL').normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');
}

export function matchesContact(contact: Contact, search: string) {
  const text = normalizeContactText(search.trim());
  if (!text) return true;
  const digits = text.replace(/\D/g, '');
  return (
    [contact.name, contact.relationship, contact.address, contact.phone].some(
      (value) => value && normalizeContactText(value).includes(text),
    ) ||
    (!!digits && /^[+\d\s().-]+$/.test(text) && !!contact.phone?.replace(/\D/g, '').includes(digits))
  );
}

export const sortContacts = (contacts: Contact[]) =>
  [...contacts].sort((a, b) => a.name.localeCompare(b.name, 'pl-PL'));
export const contactInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toLocaleUpperCase('pl-PL');
export const contactPhoneHref = (phone: string) => `tel:${phone.replace(/[^+\d*#]/g, '')}`;
