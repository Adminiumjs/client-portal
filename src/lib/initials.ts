/** Up to two capital letters from a name, as the design's avatars show them ("Amara Osei" → "AO"). */
export function initials(name: string | null | undefined): string {
  const words = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w));
  const first = words[0]?.match(/\p{L}/u)?.[0] ?? "";
  const second = words[1]?.match(/\p{L}/u)?.[0] ?? "";
  return `${first}${second}`.toUpperCase();
}
