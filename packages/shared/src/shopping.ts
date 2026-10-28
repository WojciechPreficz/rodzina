export function normalizeShoppingName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('pl-PL');
}

export function mergeQuantities(...quantities: (string | null | undefined)[]): string | null {
  const parts = quantities.map((quantity) => quantity?.trim()).filter(Boolean);
  return parts.length ? parts.join(' + ') : null;
}

export function parseShoppingInput(input: string): { name: string; quantity: string | null } {
  const text = input.trim().replace(/\s+/gu, ' ');
  const match = /^(.*) (\d.*)$/u.exec(text);
  if (!match) return { name: text, quantity: null };
  return { name: match[1]!, quantity: match[2]! };
}
