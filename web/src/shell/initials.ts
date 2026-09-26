/** The handler's initials, for the settings-row avatar chip. Shared by the
 *  shell and by the account screen, which draws the same chip larger. */
export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}
