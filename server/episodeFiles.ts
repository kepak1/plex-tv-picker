import { normalize } from './text.js';

// What a recording's file name says about its episode. Plex DVR names files
// "Show (year) - S01E02 - Title.ext" or, without numbers, "Show (year) - 2025-02-14 14 00 00 - Title.ext".
// The title there comes from the TV guide and often differs from the episode Plex filed it under,
// which is how different episodes, or the parts of one, end up as "versions" of a single episode.

const TITLE_AFTER = [/\bS\d{1,4}E\d{1,4}\b\s*-\s*(.+)$/i, /\b\d{4}-\d{2}-\d{2} \d{2} \d{2} \d{2}\s*-\s*(.+)$/];
const SHOW_BEFORE = /^(.*?)\s*(?:\(\d{4}\))?\s*-\s*(?:S\d{1,4}E\d{1,4}\b|\d{4}-\d{2}-\d{2} \d{2} \d{2} \d{2})/i;
const GENERIC = /^(?:episode|odcinek|folge|episodio)\s*[\d\s.-]*$/i;

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
// "cz.2", "cz. 2", "część 2", "Part II", optionally in brackets.
const PART = /[([]?\s*\b(?:cz(?:ęść|esc)?\.?|part)\s*(\d{1,2}|iv|v|i{1,3})\b\s*[)\]]?/i;

const baseName = (file: string) =>
  file
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, '')
    .replace(/\s*\(copy \d+\)$/i, '');

/** The episode title in a DVR file name, unless it only repeats the show's name or "Episode 12". */
export function fileTitleOf(file: string | null, showTitle: string | null): string | null {
  if (!file) return null;
  const base = baseName(file);
  const title = TITLE_AFTER.map((re) => base.match(re)?.[1]?.trim()).find(Boolean);
  if (!title || GENERIC.test(title)) return null;
  const n = normalize(title);
  const fileShow = base.match(SHOW_BEFORE)?.[1];
  if ((showTitle && n === normalize(showTitle)) || (fileShow && n === normalize(fileShow))) return null;
  return title;
}

/** Part number from "cz. 2", "część 2" or "Part II" in a title. */
export function partOf(title: string | null): number | null {
  const m = title?.match(PART);
  if (!m) return null;
  const v = m[1].toLowerCase();
  return ROMAN[v] ?? Number(v);
}

/** The title without its part marker: "Zmartwychwstanie cz.1" -> "Zmartwychwstanie". */
export function stripPart(title: string): string {
  return title
    .replace(PART, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s,.:;-]+$/, '')
    .trim();
}

/** The same story, ignoring part markers and punctuation. */
export const storyKey = (title: string) => normalize(stripPart(title));
