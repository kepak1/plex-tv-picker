import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import cron from 'node-cron';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { db, getMeta, now } from './db.js';
import { endSession, loadUser, loginWithPlexToken, requireUser, startSession } from './auth.js';
import { authUrl, checkPin, createPin, discoverSearch, machineIdentifier } from './plex.js';
import { getChannels, getCountries, getGenres, allItems, getItem, queryCatalog, reloadCatalog, type Query } from './catalog.js';
import { isSyncing, refreshTmdb, runSync, updateRecommendations } from './sync.js';
import { languages, localeOf, resolveLanguage, t } from './i18n.js';
import { mailEnabled } from './mail.js';
import { sendAlerts, sendTestEmail, wishMatches, type WishRow } from './notify.js';
import { tmdbEnabled } from './tmdb.js';
import { recommendationsFor } from './recommend.js';
import { addIgnore, clearIgnores, listIgnores, removeIgnore } from './ignores.js';
import { cleanConditions, compileConditions, countMatches, deleteRule, listRules, saveRule } from './rules.js';
import { matchesWords, normalize } from './text.js';
import { duplicateCount, duplicateGroups, ignoreDuplicate, unignoreDuplicate } from './duplicates.js';
import { ignoreShort, shortCount, shortRecordings, THRESHOLDS, unignoreShort, validThreshold } from './short.js';
import { isScanning, rescanLibraryTools } from './tools.js';
import { seriesCount, seriesFor, setSeriesHidden } from './series.js';

const app = Fastify({ logger: { level: 'warn' }, trustProxy: true });
await app.register(cookie);

const list = (v: unknown) => (typeof v === 'string' && v ? v.split(',') : undefined);
const num = (v: unknown) => (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
const bool = (v: unknown) => v === '1' || v === 'true';

// ---------- Public ----------

app.get('/api/health', async () => ({ ok: true, version: config.version }));

app.get('/api/config', async () => ({
  version: config.version,
  machineIdentifier: await machineIdentifier().catch(() => null),
  plexUrl: config.plexPublicUrl,
  languages: languages().map((code) => ({ code, name: t(code, '_meta.name'), locale: localeOf(code) })),
  defaultLanguage: resolveLanguage(null),
  tmdb: tmdbEnabled(),
  mail: mailEnabled(),
  timezone: config.timezone,
}));

// A login PIN may only be completed by the browser that created it: the PIN id travels through
// plex.tv redirects and URLs, so it is paired with a secret kept in an httpOnly cookie.
const PIN_COOKIE = 'ptp_pin';
const PIN_TTL_MS = 30 * 60_000;
const pendingPins = new Map<number, { secret: string; expires: number }>();

/** Only redirect back to this app (same host as the request, or APP_URL). */
function safeForwardUrl(requested: string | undefined, request: FastifyRequest): URL {
  const own = `${request.protocol}://${request.host}`;
  const fallback = new URL(`${config.appUrl ?? own}/login`);
  try {
    const url = new URL(requested ?? '');
    const allowed = [own, config.appUrl].filter(Boolean).map((u) => new URL(u!).origin);
    return allowed.includes(url.origin) ? url : fallback;
  } catch {
    return fallback;
  }
}

app.post('/api/auth/pin', async (request, reply) => {
  const { forwardUrl } = (request.body ?? {}) as { forwardUrl?: string };
  const pin = await createPin();
  const secret = randomBytes(24).toString('base64url');
  const nowMs = Date.now();
  for (const [id, p] of pendingPins) if (p.expires < nowMs) pendingPins.delete(id);
  pendingPins.set(pin.id, { secret, expires: nowMs + PIN_TTL_MS });
  reply.setCookie(PIN_COOKIE, secret, {
    path: '/api/auth',
    httpOnly: true,
    sameSite: 'lax',
    secure: request.protocol === 'https',
    maxAge: PIN_TTL_MS / 1000,
  });
  console.log(`[auth] login started (pin ${pin.id})`);
  const back = safeForwardUrl(forwardUrl, request);
  back.searchParams.set('pin', String(pin.id));
  return { id: pin.id, url: authUrl(pin.code, back.toString()) };
});

app.post('/api/auth/pin/:id', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  const pending = pendingPins.get(id);
  if (!pending || pending.expires < Date.now() || request.cookies[PIN_COOKIE] !== pending.secret) {
    return reply.code(410).send({ status: 'expired' });
  }
  const pin = await checkPin(id);
  if (!pin.authToken) return { status: 'pending' };
  pendingPins.delete(id);
  reply.clearCookie(PIN_COOKIE, { path: '/api/auth' });
  const user = await loginWithPlexToken(pin.authToken);
  if (!user) return reply.code(403).send({ status: 'denied' });
  startSession(reply, request, user.id);
  console.log(`[auth] ${user.username} signed in`);
  // A new user would otherwise wait for the nightly refresh to get recommendations.
  if (!recommendationsFor(user.id) && !isSyncing()) void updateRecommendations();
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
      recsEnabled: u.recs_enabled === 1,
      shortThreshold: validThreshold(u.short_threshold),
      shortThresholds: THRESHOLDS,
    };
  });

  api.put('/api/settings', async (request) => {
    const body = request.body as {
      language?: string | null;
      notifyEmail?: string | null;
      alertsEnabled?: boolean;
      digestEnabled?: boolean;
      recsEnabled?: boolean;
      shortThreshold?: number;
    };
    const u = request.user!;
    db.prepare(
      'UPDATE users SET language = ?, notify_email = ?, alerts_enabled = ?, digest_enabled = ?, recs_enabled = ?, short_threshold = ?, last_digest_at = COALESCE(last_digest_at, ?) WHERE id = ?',
    ).run(
      body.language !== undefined ? body.language && resolveLanguage(body.language) : u.language,
      body.notifyEmail !== undefined ? body.notifyEmail?.trim() || null : u.notify_email,
      body.alertsEnabled !== undefined ? Number(body.alertsEnabled) : u.alerts_enabled,
      body.digestEnabled !== undefined ? Number(body.digestEnabled) : u.digest_enabled,
      body.recsEnabled !== undefined ? Number(body.recsEnabled) : u.recs_enabled,
      body.shortThreshold !== undefined ? validThreshold(body.shortThreshold) : u.short_threshold,
      now(),
      u.id,
    );
    return { ok: true };
  });

  api.post('/api/settings/test-email', async (request) => {
    await sendTestEmail(loadUser(request)!);
    return { ok: true };
  });

  api.get('/api/status', async (request) => {
    const recs = recommendationsFor(request.user!.id);
    return {
      lastSyncAt: Number(getMeta('last_sync_at') ?? 0) || null,
      lastSyncError: getMeta('last_sync_error') || null,
      syncing: isSyncing(),
      recommendations: recs ? { watched: recs.watched, count: recs.items.size } : null,
    };
  });

  api.post('/api/sync', async () => {
    runSync().catch(() => {});
    return { syncing: true };
  });

  api.get('/api/filters', async () => ({ genres: getGenres(), channels: getChannels(), countries: tmdbEnabled() ? getCountries() : [] }));

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
      countries: tmdbEnabled() ? list(q.countries) : undefined,
      channels: list(q.channels),
      from: num(q.from),
      to: num(q.to),
      yearMin: num(q.yearMin),
      yearMax: num(q.yearMax),
      ratingMin: num(q.ratingMin),
      hideScheduled: bool(q.hideScheduled),
      hideLibrary: bool(q.hideLibrary),
      showIgnored: bool(q.showIgnored),
      only: bool(q.recommended) ? new Set(recommendationsFor(request.user!.id)?.items.keys()) : undefined,
      sort: q.sort as Query['sort'],
      dir: q.dir === 'asc' || q.dir === 'desc' ? q.dir : undefined,
      offset: num(q.offset),
      limit: num(q.limit),
    };
    return queryCatalog(request.user!.id, query);
  });

  // ----- Hidden titles / episodes -----

  api.get('/api/ignores', async (request) => {
    const q = request.query as Record<string, string>;
    return listIgnores(request.user!.id, {
      q: q.q || undefined,
      scope: q.scope === 'title' || q.scope === 'episode' ? q.scope : undefined,
      offset: num(q.offset),
      limit: num(q.limit),
    });
  });

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
    addIgnore(request.user!.id, {
      scope: body.scope,
      itemGuid: item.guid,
      episodeGuid: body.episodeGuid,
      title: item.title,
      episodeLabel: label,
      thumb: item.thumb,
    });
    return { ok: true };
  });

  api.delete('/api/ignores', async (request) => {
    const q = request.query as { id?: string; itemGuid?: string; episodeGuid?: string };
    removeIgnore(request.user!.id, { id: num(q.id), itemGuid: q.itemGuid, episodeGuid: q.episodeGuid });
    return { ok: true };
  });

  api.post('/api/ignores/clear', async (request) => {
    const { scope } = (request.body ?? {}) as { scope?: string };
    const removed = clearIgnores(request.user!.id, scope === 'title' || scope === 'episode' ? scope : undefined);
    console.log(`[ignores] ${request.user!.username} cleared ${removed} hidden entries${scope ? ` (${scope})` : ''}`);
    return { removed };
  });

  // ----- Auto-hide rules -----

  api.get('/api/rules', async (request) => {
    const items = [...allItems()];
    return listRules(request.user!.id).map((r) => ({ ...r, matchCount: countMatches(compileConditions(r.conditions), items) }));
  });

  // Live match count while a rule is being edited.
  api.post('/api/rules/preview', async (request) => {
    const conditions = cleanConditions((request.body as { conditions?: unknown } | undefined)?.conditions);
    return { matchCount: conditions ? countMatches(compileConditions(conditions), allItems()) : 0 };
  });

  const ruleBody = (body: unknown) => {
    const b = (body ?? {}) as { name?: unknown; enabled?: unknown; conditions?: unknown };
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 100) : '';
    const conditions = cleanConditions(b.conditions);
    return name && conditions ? { name, enabled: b.enabled !== false, conditions } : null;
  };

  api.post('/api/rules', async (request, reply) => {
    const rule = ruleBody(request.body);
    if (!rule) return reply.code(400).send({ error: 'A rule needs a name and at least one condition' });
    return { id: saveRule(request.user!.id, rule) };
  });

  api.put('/api/rules/:id', async (request, reply) => {
    const rule = ruleBody(request.body);
    if (!rule) return reply.code(400).send({ error: 'A rule needs a name and at least one condition' });
    saveRule(request.user!.id, { ...rule, id: Number((request.params as { id: string }).id) });
    return { ok: true };
  });

  api.delete('/api/rules/:id', async (request) => {
    deleteRule(request.user!.id, Number((request.params as { id: string }).id));
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
    const body = request.body as {
      kind: 'title' | 'phrase';
      type?: 'movie' | 'show' | null;
      guid?: string;
      tmdbId?: number;
      title: string;
      year?: number;
      thumb?: string;
    };
    const title = body.title?.trim();
    if (!title || (body.kind !== 'title' && body.kind !== 'phrase')) return reply.code(400).send({ error: 'bad request' });
    const userId = request.user!.id;
    const res = db
      .prepare('INSERT INTO wishlist (user_id, kind, type, guid, tmdb_id, title, title_norm, year, thumb, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        userId, body.kind, body.type ?? null, body.kind === 'title' ? (body.guid ?? null) : null,
        body.kind === 'title' && Number.isInteger(body.tmdbId) ? body.tmdbId! : null,
        title, normalize(title), body.year ?? null, body.thumb ?? null, now(),
      );
    // Report matches already in the guide right away instead of waiting for the nightly refresh.
    sendAlerts(userId).catch((err) => console.error('[notify]', err));
    return { id: Number(res.lastInsertRowid) };
  });

  // ---------- Tools ----------

  const threshold = (request: FastifyRequest) => validThreshold(request.user!.short_threshold);

  api.get('/api/tools', async (request) => ({
    scanning: isScanning(),
    duplicates: { count: duplicateCount() },
    short: { count: shortCount(threshold(request)) },
    // Not part of the menu counter: missing parts aren't a problem to fix.
    series: { count: seriesCount(request.user!.id) },
  }));

  // Refreshing runs in the background; pages poll while `scanning` is true.
  api.post('/api/tools/scan', async () => {
    void rescanLibraryTools();
    return { scanning: true };
  });

  api.get('/api/tools/duplicates', async () => ({ ...duplicateGroups(), scanning: isScanning() }));

  api.put('/api/tools/duplicates/ignored/:key', async (request, reply) => {
    if (!ignoreDuplicate((request.params as { key: string }).key, request.user!.id)) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  api.delete('/api/tools/duplicates/ignored/:key', async (request) => {
    unignoreDuplicate((request.params as { key: string }).key);
    return { ok: true };
  });

  api.get('/api/tools/series', async (request) => ({ ...seriesFor(request.user!.id), scanning: isScanning() }));

  api.put('/api/tools/series/hidden/:kind/:id', async (request, reply) => {
    const { kind, id } = request.params as { kind: string; id: string };
    if ((kind !== 'series' && kind !== 'movie') || !/^\d+$/.test(id)) return reply.code(400).send({ error: 'bad request' });
    setSeriesHidden(request.user!.id, kind, Number(id), true);
    return { ok: true };
  });

  api.delete('/api/tools/series/hidden/:kind/:id', async (request, reply) => {
    const { kind, id } = request.params as { kind: string; id: string };
    if ((kind !== 'series' && kind !== 'movie') || !/^\d+$/.test(id)) return reply.code(400).send({ error: 'bad request' });
    setSeriesHidden(request.user!.id, kind, Number(id), false);
    return { ok: true };
  });

  api.get('/api/tools/short', async (request) => ({
    ...shortRecordings(threshold(request)),
    threshold: threshold(request),
    scanning: isScanning(),
  }));

  api.put('/api/tools/short/ignored/:id', async (request, reply) => {
    if (!ignoreShort(Number((request.params as { id: string }).id), request.user!.id)) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  api.delete('/api/tools/short/ignored/:id', async (request) => {
    unignoreShort(Number((request.params as { id: string }).id));
    return { ok: true };
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
// TMDB details normally come with the nightly sync; fetch missing ones now so a new key (or upgrade) works right away.
else if (tmdbEnabled()) void refreshTmdb();
else void updateRecommendations();

await app.listen({ host: '0.0.0.0', port: config.port });
console.log(`RecPick ${config.version} listening on :${config.port} (sync: "${config.syncCron}" ${config.timezone})`);
