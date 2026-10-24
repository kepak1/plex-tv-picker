import { config } from './config.js';
import { db, now } from './db.js';
import { localeOf, resolveLanguage, t } from './i18n.js';
import { mailEnabled, sendMail } from './mail.js';
import { machineIdentifier, plexWebLink } from './plex.js';
import { matchesWords } from './text.js';
import {
  allItems,
  getRecordingState,
  userIgnores,
  visibleAirings,
  type AiringView,
  type Item,
} from './catalog.js';

export interface UserRow {
  id: number;
  username: string;
  email: string | null;
  thumb: string | null;
  language: string | null;
  notify_email: string | null;
  alerts_enabled: number;
  digest_enabled: number;
  last_digest_at: number | null;
}

export interface WishRow {
  id: number;
  user_id: number;
  kind: 'title' | 'phrase';
  type: 'movie' | 'show' | null;
  guid: string | null;
  title: string;
  title_norm: string;
  year: number | null;
}

export function wishMatches(wish: WishRow, item: Item): boolean {
  if (wish.type && wish.type !== item.type) return false;
  if (wish.kind === 'phrase') return matchesWords(item.titleNorm, wish.title_norm);
  if (wish.guid && wish.guid === item.guid) return true;
  if (wish.title_norm !== item.titleNorm) return false;
  // Guide years for shows are unreliable, so only movies are checked against the year.
  if (item.type === 'movie' && wish.year && item.year) return Math.abs(wish.year - item.year) <= 1;
  return true;
}

const recipient = (u: UserRow) => u.notify_email || u.email;

/**
 * Emails each user the wishlist titles that appeared in the guide. Every movie airing and every
 * show episode is reported once; episodes the user has, has scheduled or has hidden are skipped.
 */
export async function sendAlerts(onlyUserId?: number): Promise<void> {
  if (!mailEnabled()) return;
  const users = db
    .prepare(`SELECT * FROM users WHERE alerts_enabled = 1 ${onlyUserId ? 'AND id = ?' : ''}`)
    .all(...(onlyUserId ? [onlyUserId] : [])) as unknown as UserRow[];
  const rec = await getRecordingState(true);
  const markNotified = db.prepare('INSERT OR IGNORE INTO notified (user_id, key, created_at) VALUES (?, ?, ?)');
  const isNotified = db.prepare('SELECT 1 FROM notified WHERE user_id = ? AND key = ?');

  for (const user of users) {
    const to = recipient(user);
    if (!to) continue;
    const wishes = db.prepare('SELECT * FROM wishlist WHERE user_id = ?').all(user.id) as unknown as WishRow[];
    if (wishes.length === 0) continue;
    const ign = userIgnores(user.id);
    const found: { item: Item; airings: AiringView[]; keys: string[] }[] = [];

    for (const item of allItems()) {
      if (ign.titles.has(item.guid) || rec.subscribed.has(item.guid)) continue;
      if (!wishes.some((w) => wishMatches(w, item))) continue;
      const airings = visibleAirings(item, ign, rec, { hideScheduled: true, hideLibrary: true });
      const fresh: AiringView[] = [];
      const keys = new Set<string>();
      for (const a of airings) {
        const key = item.type === 'show' ? `ep|${a.episodeGuid}` : `mv|${item.guid}|${a.gridKey}|${a.beginsAt}`;
        if (isNotified.get(user.id, key)) continue;
        fresh.push(a);
        keys.add(key);
      }
      if (fresh.length > 0) found.push({ item, airings: fresh, keys: [...keys] });
    }
    if (found.length === 0) continue;

    const lang = resolveLanguage(user.language);
    const titles = found.map((f) => f.item.title);
    const subject = t(lang, 'email.alertSubject', {
      count: titles.length,
      titles: titles.slice(0, 3).join(', ') + (titles.length > 3 ? '…' : ''),
    });
    try {
      await sendMail(to, subject, await renderEmail(lang, t(lang, 'email.alertIntro'), found, 0));
      const ts = now();
      for (const f of found) for (const key of f.keys) markNotified.run(user.id, key, ts);
      console.log(`[notify] alert sent to user ${user.username}: ${titles.length} titles`);
    } catch (err) {
      console.error(`[notify] alert to ${user.username} failed`, err);
    }
  }
}

const DIGEST_LIMIT = 60;

/** Daily email with titles that first appeared in the guide since the user's previous digest. */
export async function sendDigests(): Promise<void> {
  if (!mailEnabled()) return;
  const users = db.prepare('SELECT * FROM users WHERE digest_enabled = 1').all() as unknown as UserRow[];
  if (users.length === 0) return;
  const rec = await getRecordingState();
  for (const user of users) {
    const to = recipient(user);
    if (!to) continue;
    const since = user.last_digest_at ?? now() - 86400;
    const ign = userIgnores(user.id);
    const found: { item: Item; airings: AiringView[] }[] = [];
    for (const item of allItems()) {
      if (item.firstSeenAt <= since || ign.titles.has(item.guid) || rec.subscribed.has(item.guid)) continue;
      const airings = visibleAirings(item, ign, rec, { hideScheduled: true, hideLibrary: true });
      if (airings.length > 0) found.push({ item, airings });
    }
    const ts = now();
    if (found.length > 0) {
      found.sort((a, b) => a.airings[0].beginsAt - b.airings[0].beginsAt);
      const lang = resolveLanguage(user.language);
      try {
        await sendMail(
          to,
          t(lang, 'email.digestSubject', { count: found.length }),
          await renderEmail(lang, t(lang, 'email.digestIntro'), found.slice(0, DIGEST_LIMIT), found.length - DIGEST_LIMIT),
        );
        console.log(`[notify] digest sent to ${user.username}: ${found.length} titles`);
      } catch (err) {
        console.error(`[notify] digest to ${user.username} failed`, err);
        continue;
      }
    }
    db.prepare('UPDATE users SET last_digest_at = ? WHERE id = ?').run(ts, user.id);
  }
}

export async function sendTestEmail(user: UserRow): Promise<void> {
  const lang = resolveLanguage(user.language);
  const to = recipient(user);
  if (!to) throw new Error('No email address');
  await sendMail(to, t(lang, 'email.testSubject'), layout(lang, `<p>${esc(t(lang, 'email.testBody'))}</p>`));
}

// ---------- HTML ----------

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(lang: string, body: string): string {
  const appLink = config.appUrl
    ? `<p style="margin:24px 0 0"><a href="${esc(config.appUrl)}" style="color:#6d5ce8">${esc(t(lang, 'email.openApp'))}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#18181b">
<div style="max-width:680px;margin:0 auto;padding:24px 16px">
<h1 style="font-size:20px;margin:0 0 16px">${esc(t(lang, 'app.name'))}</h1>
${body}${appLink}
<p style="color:#71717a;font-size:12px;margin-top:24px">${esc(t(lang, 'email.footer'))}</p>
</div></body></html>`;
}

async function renderEmail(
  lang: string,
  intro: string,
  entries: { item: Item; airings: AiringView[] }[],
  more: number,
): Promise<string> {
  const machine = await machineIdentifier();
  const locale = localeOf(lang);
  const fmt = new Intl.DateTimeFormat(locale, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: config.timezone,
  });
  const link = (key: string) => plexWebLink(machine, key);

  const rows = entries.map(({ item, airings }) => {
    const shown = airings.slice(0, 8);
    const list = shown
      .map((a) => {
        const ep = a.episodeGuid
          ? ` · ${a.season != null ? `S${a.season}` : ''}${a.episode != null ? `E${a.episode}` : ''} ${esc(a.episodeTitle !== item.title ? a.episodeTitle : '')}`
          : '';
        return `<li style="margin:2px 0"><a href="${esc(link(a.epgKey))}" style="color:#18181b">${esc(fmt.format(a.beginsAt * 1000))}</a> · ${esc(channelLabel(a.channelTitle))}${ep}</li>`;
      })
      .join('');
    const extra = airings.length > shown.length ? `<li>${esc(t(lang, 'email.andMore', { count: airings.length - shown.length }))}</li>` : '';
    const summary = (item.summary ?? '').length > 320 ? `${item.summary!.slice(0, 317)}…` : (item.summary ?? '');
    return `<tr><td style="padding:12px 12px 12px 0;vertical-align:top;width:92px">
${item.thumb ? `<img src="${esc(item.thumb)}" width="92" style="border-radius:6px;display:block" alt="">` : ''}
</td><td style="padding:12px 0;vertical-align:top">
<a href="${esc(link(shown[0].epgKey))}" style="font-size:16px;font-weight:600;color:#18181b;text-decoration:none">${esc(item.title)}</a>
<span style="color:#71717a">${item.year ? ` (${item.year})` : ''} · ${esc(t(lang, `item.${item.type}`))}${item.rating ? ` · ★ ${item.rating}` : ''}</span>
<p style="margin:6px 0;font-size:13px;color:#3f3f46">${esc(summary)}</p>
<ul style="margin:6px 0;padding-left:18px;font-size:13px">${list}${extra}</ul>
</td></tr>`;
  });
  const moreRow = more > 0 ? `<p>${esc(t(lang, 'email.andMore', { count: more }))}</p>` : '';
  return layout(
    lang,
    `<p>${esc(intro)}</p><table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;padding:0 12px">${rows.join('')}</table>${moreRow}`,
  );
}

function channelLabel(raw: string | null): string {
  const m = raw?.match(/\((.+)\)\s*$/);
  return m ? m[1] : (raw ?? '');
}
