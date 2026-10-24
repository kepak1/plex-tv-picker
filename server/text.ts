// Normalises titles for matching: lowercase, no diacritics, no punctuation, single spaces.
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when `needle` (normalised) occurs in `haystack` (normalised) starting at a word boundary. */
export function matchesWords(haystack: string, needle: string): boolean {
  return ` ${haystack}`.includes(` ${needle}`);
}
