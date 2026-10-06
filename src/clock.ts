export const AS_OF = "2026-06-01T12:00:00.000Z";

export function deliveriesSince(): string {
  const date = new Date(AS_OF);
  date.setUTCDate(date.getUTCDate() - 90);
  return date.toISOString();
}
