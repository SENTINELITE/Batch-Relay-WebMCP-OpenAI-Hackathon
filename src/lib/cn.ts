export type ClassValue = string | false | null | undefined;

/** Joins class names and drops falsy entries. No merge semantics: later
 *  utilities are not deduped, so pass conflicting classes deliberately. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
