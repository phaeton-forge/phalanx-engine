export function contactKey(a: number, b: number): string {
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  return `${String(lo)}:${String(hi)}`;
}

export function rememberContact(keys: string[], a: number, b: number): boolean {
  const key = contactKey(a, b);
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] === key) return false;
  }
  keys.push(key);
  return true;
}

export function contactsInclude(
  keys: readonly string[],
  a: number,
  b: number
): boolean {
  const key = contactKey(a, b);
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] === key) return true;
  }
  return false;
}
