import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import cron from 'node-cron';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { db, getMeta, now } from './db.js';
import { endSession, loadUser, loginWithPlexToken, requireUser, startSession } from './auth.js';
import { authUrl, checkPin, createPin, discoverSearch, machineIdentifier } from './plex.js';
import { getChannels, getGenres, allItems, getItem, queryCatalog, reloadCatalog, type Query } from './catalog.js';
import { isSyncing, runSync } from './sync.js';
import { languages, localeOf, resolveLanguage, t } from './i18n.js';
import { mailEnabled } from './mail.js';
import { sendAlerts, sendTestEmail, wishMatches, type WishRow } from './notify.js';
import { tmdbEnabled } from './tmdb.js';
import { matchesWords, normalize } from './text.js';

const app = Fastify({ logger: { level: 'warn' }, trustProxy: true });
await app.register(cookie);

const list = (v: unknown) => (typeof v === 'string' && v ? v.split(',') : undefined);
const num = (v: unknown) => (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
const bool = (v: unknown) => v === '1' || v === 'true';

// ---------- Public ----------

app.get('/api/config', async () => ({
  machineIdentifier: await machineIdentifier().catch(() => null),
  plexUrl: config.plexPublicUrl,
  languages: languages().map((code) => ({ code, name: t(code, '_meta.name'), locale: localeOf(code) })),
  defaultLanguage: resolveLanguage(null),
  tmdb: tmdbEnabled(),
  mail: mailEnabled(),
  timezone: config.timezone,
}));

app.post('/api/auth/pin', async (request) => {
  const { forwardUrl } = (request.body ?? {}) as { forwardUrl?: string };
  const pin = await createPin();
  console.log(`[auth] login started (pin ${pin.id})`);
  const back = new URL(forwardUrl ?? `${config.appUrl ?? `${request.protocol}://${request.host}`}/login`);
  back.searchParams.set('pin', String(pin.id));
  return { id: pin.id, url: authUrl(pin.code, back.toString()) };
});

app.post('/api/auth/pin/:id', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  const pin = await checkPin(id);
  if (!pin.authToken) return { status: 'pending' };
  const user = await loginWithPlexToken(pin.authToken);
  if (!user) return reply.code(403).send({ status: 'denied' });
  startSession(reply, request, user.id);
  console.log(`[auth] ${user.username} signed in`);
  return { status: 'ok' };
});

app.post('/api/auth/logout', async (request, reply) => {
  endSession(request, reply);
  return { ok: true };
});

// ---------- Authenticated ----------

await app.register(async (api) => {
  api.addHook('preHandler', requireUser);

  api.get('/api/me', async (request) => {
    const u = request.user!;
    return {
      id: u.id,
      username: u.username,
      thumb: u.thumb,
      email: u.email,
      notifyEmail: u.notify_email,
      language: u.language,
      alertsEnabled: u.alerts_enabled === 1,
      digestEnabled: u.digest_enabled === 1,
    };
  });

  api.put('/api/settings', async (request) => {
    const body = request.body as { language?: string | null; notifyEmail?: string | null; alertsEnabled?: boolean; digestEnabled?: boolean };
    const u = request.user!;
    db.prepare('UPDATE users SET language = ?, notify_email = ?, alerts_enabled = ?, digest_enabled = ?, last_digest_at = COALESCE(last_digest_at, ?) WHERE id = ?').run(
      body.language !== undefined ? body.language && resolveLanguage(body.language) : u.language,
      body.notifyEmail !== undefined ? body.notifyEmail?.trim() || null : u.notify_email,
      body.alertsEnabled !== undefined ? Number(body.alertsEnabled) : u.alerts_enabled,
      body.digestEnabled !== undefined ? Number(body.digestEnabled) : u.digest_enabled,
      now(),
      u.id,
    );
    return { ok: true };
  });

  api.post('/api/settings/test-email', async (request) => {
    await sendTestEmail(loadUser(request)!);
    return { ok: true };
  });

  api.get('/api/status', async () => ({
    lastSyncAt: Number(getMeta('last_sync_at') ?? 0) || null,
    lastSyncError: getMeta('last_sync_error') || null,
    syncing: isSyncing(),
  }));

  api.post('/api/sync', async () => {
    runSync().catch(() => {});
    return { syncing: true };
  });

  api.get('/api/filters', async () => ({ genres: getGenres(), channels: getChannels() }));

  // Resizes posters through the Plex photo transcoder (originals are up to 1920px wide).
  api.get('/api/img', async (request, reply) => {
    const { u, w } = request.query as { u?: string; w?: string };
    let source: URL;
    try {
      source = new URL(u ?? '');
    } catch {
      return reply.code(400).send({ error: 'bad url' });
    }
    if (!/(^|\.)(plex\.tv|tmdb\.org)$/.test(source.hostname)) return reply.code(400).send({ error: 'host not allowed' });
    const width = Math.min(Math.max(Number(w) || 300, 50), 1000);
    const url = `${config.plexUrl}/photo/:/transcode?width=${width}&height=${Math.round(width * 1.5)}&minSize=1&upscale=0&url=${encodeURIComponent(source.toString())}`;
    const res = await fetch(url, { headers: { 'X-Plex-Token': config.plexToken }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return reply.redirect(source.toString());
    return reply
      .header('Content-Type', res.headers.get('content-type') ?? 'image/jpeg')
      .header('Cache-Control', 'private, max-age=604800')
      .send(Buffer.from(await res.arrayBuffer()));
  });

  api.get('/api/catalog', async (request) => {
    const q = request.query as Record<string, string>;
    const query: Query = {
      type: q.type === 'movie' || q.type === 'show' ? q.type : undefined,
      q: q.q || undefined,
      genres: list(q.genres),
      channels: list(q.channels),
      from: num(q.from),
      to: num(q.to),
      yearMin: num(q.yearMin),
      yearMax: num(q.yearMax),
      ratingMin: num(q.ratingMin),
      hideScheduled: bool(q.hideScheduled),
      hideLibrary: bool(q.hideLibrary),
      showIgnored: bool(q.showIgnored),
      sort: q.sort as Query['sort'],
      offset: num(q.offset),
      limit: num(q.limit),
    };
    return queryCatalog(request.user!.id, query);
  });

  // ----- Hidden titles / episodes -----

  api.get('/api/ignores', async (request) =>
    db.prepare('SELECT * FROM ignores WHERE user_id = ? ORDER BY created_at DESC').all(request.user!.id),
  );

  api.post('/api/ignores', async (request, reply) => {
    const body = request.body as { scope: 'title' | 'episode'; itemGuid: string; episodeGuid?: string };
    const item = getItem(body.itemGuid);
    if (!item || (body.scope !== 'title' && body.scope !== 'episode')) return reply.code(400).send({ error: 'bad request' });
    let label: string | null = null;
    if (body.scope === 'episode') {
      const a = item.airings.find((x) => x.episodeGuid === body.episodeGuid);
      if (!a) return reply.code(400).send({ error: 'unknown episode' });
      const se = `${a.season != null ? `S${a.season}` : ''}${a.episode != null ? `E${a.episode}` : ''}`;
      label = [se, a.episodeTitle !== item.title ? a.episodeTitle : null].filter(Boolean).join(' ') || null;
    }
    db.prepare(
      `INSERT OR IGNORE INTO ignores (user_id, scope, item_guid, episode_guid, title, episode_label, thumb, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(request.user!.id, body.scope, item.guid, body.scope === 'episode' ? body.episodeGuid! : '', item.title, label, item.thumb, now());
    return { ok: true };
  });

  api.delete('/api/ignores', async (request) => {
    const q = request.query as { id?: string; itemGuid?: string; episodeGuid?: string };
    if (q.id) db.prepare('DELETE FROM ignores WHERE id = ? AND user_id = ?').run(Number(q.id), request.user!.id);
    else if (q.episodeGuid) db.prepare('DELETE FROM ignores WHERE user_id = ? AND scope = ? AND episode_guid = ?').run(request.user!.id, 'episode', q.episodeGuid);
    else if (q.itemGuid) db.prepare('DELETE FROM ignores WHERE user_id = ? AND scope = ? AND item_guid = ?').run(request.user!.id, 'title', q.itemGuid);
    return { ok: true };
  });

  // ----- Wishlist -----

  api.get('/api/wishlist', async (request) => {
    const wishes = db.prepare('SELECT * FROM wishlist WHERE user_id = ? ORDER BY created_at DESC').all(request.user!.id) as unknown as (WishRow & Record<string, unknown>)[];
    const items = [...allItems()];
    return wishes.map((w) => {
      const matches = items.filter((i) => wishMatches(w, i));
      return { ...w, matches: matches.slice(0, 20).map((i) => ({ guid: i.guid, title: i.title, year: i.year, type: i.type })), matchCount: matches.length };
    });
  });

  api.get('/api/wishlist/suggest', async (request) => {
    const { q } = request.query as { q?: string };
    const query = normalize(q ?? '');
    if (query.length < 2) return { guide: [], plex: [] };
    const guide = [...allItems()]
      .filter((i) => matchesWords(i.titleNorm, query))
      .sort((a, b) => Number(!a.titleNorm.startsWith(query)) - Number(!b.titleNorm.startsWith(query)) || a.title.localeCompare(b.title))
      .slice(0, 8)
      .map((i) => ({ guid: i.guid, type: i.type, title: i.title, year: i.year, thumb: i.thumb }));
    const lang = resolveLanguage(request.user!.language);
    const plex = await discoverSearch(q!, lang).catch(() => []);
    const inGuide = (p: { type: string; title: string; year?: number | null }) =>
      guide.some((g) => g.type === p.type && normalize(g.title) === normalize(p.title) && (!g.year || !p.year || Math.abs(g.year - p.year) <= 1));
    return { guide, plex: plex.filter((p) => !inGuide(p)).slice(0, 8) };
  });

  api.post('/api/wishlist', async (request, reply) => {
    const body = request.body as { kind: 'title' | 'phrase'; type?: 'movie' | 'show' | null; guid?: string; title: string; year?: number; thumb?: string };
    const title = body.title?.trim();
    if (!title || (body.kind !== 'title' && body.kind !== 'phrase')) return reply.code(400).send({ error: 'bad request' });
    const userId = request.user!.id;
    const res = db
      .prepare('INSERT INTO wishlist (user_id, kind, type, guid, title, title_norm, year, thumb, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(userId, body.kind, body.type ?? null, body.kind === 'title' ? (body.guid ?? null) : null, title, normalize(title), body.year ?? null, body.thumb ?? null, now());
    // Report matches already in the guide right away instead of waiting for the nightly refresh.
    sendAlerts(userId).catch((err) => console.error('[notify]', err));
    return { id: Number(res.lastInsertRowid) };
  });

  api.delete('/api/wishlist/:id', async (request) => {
    db.prepare('DELETE FROM wishlist WHERE id = ? AND user_id = ?').run(Number((request.params as { id: string }).id), request.user!.id);
    return { ok: true };
  });
});

// ---------- Frontend ----------

const webDir = resolve(process.env.WEB_DIR ?? 'dist/web');
if (existsSync(webDir)) {
  await app.register(fastifyStatic, { root: webDir });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
  console.error(`[http] ${request.method} ${request.url}`, err);
  reply.code(err.statusCode ?? 500).send({ error: err.message });
});

// ---------- Start ----------

reloadCatalog();
cron.schedule(config.syncCron, () => runSync().catch(() => {}), { timezone: config.timezone });
if (!getMeta('last_sync_at')) runSync({ notify: false }).catch(() => {});

await app.listen({ host: '0.0.0.0', port: config.port });
console.log(`Plex TV Picker listening on :${config.port} (sync: "${config.syncCron}" ${config.timezone})`);
