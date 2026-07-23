// Locale collation depends on the host ICU data and default locale. Plain relational comparison is
// specified by ECMAScript, so user-visible path/id/message ordering stays identical across hosts.
export function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
