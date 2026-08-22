export function normalizeProductName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}
