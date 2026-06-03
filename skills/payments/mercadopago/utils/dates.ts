// dates.ts — Shared date utilities
// Pure functions, usable from any runtime (Deno, Node, Edge)

export function addMonth(date: Date): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setMonth(result.getMonth() + 1);
  if (result.getDate() !== day) result.setDate(0);
  return result;
}
