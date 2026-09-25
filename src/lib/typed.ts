/**
 * A number as a person types it, in the digits their keyboard makes.
 *
 * An Arabic keyboard types Arabic-Indic digits (٠–٩), a Persian one the
 * extended forms (۰–۹), and both the Arabic decimal and thousands separators
 * (٫ ٬). Every parser of a typed amount, rate or hour count reads the text
 * through this first, so "٣٫٥" is the same 3.5 as "3.5" or "3,5" — the page
 * shows digits in the page's language, and a field must take them back.
 * Anything else passes through untouched, for the parser to judge.
 */
export function latinDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹٫٬]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code === 0x066b) return ".";
    if (code === 0x066c) return "";
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}
