export function parseShoppingInput(input: string): { name: string; quantity: string | null } {
  const text = input.trim().replace(/\s+/gu, ' ');
  const match = /^(.*) (\d.*)$/u.exec(text);
  if (!match) return { name: text, quantity: null };
  return { name: match[1]!, quantity: match[2]! };
}
