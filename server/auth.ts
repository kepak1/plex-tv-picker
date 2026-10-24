import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db, now } from './db.js';
import { hasServerAccess, plexUser } from './plex.js';
import type { UserRow } from './notify.js';

const COOKIE = 'ptp_session';
const SESSION_TTL = 180 * 86400;

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserRow;
  }
}

export async function loginWithPlexToken(token: string): Promise<UserRow | null> {
  const [account, access] = await Promise.all([plexUser(token), hasServerAccess(token)]);
  if (!access) return null;
  db.prepare(
    `INSERT INTO users (id, username, email, thumb, created_at, last_digest_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, email = excluded.email, thumb = excluded.thumb`,
  ).run(account.id, account.username || account.title || String(account.id), account.email ?? null, account.thumb ?? null, now(), now());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(account.id) as unknown as UserRow;
}

export function startSession(reply: FastifyReply, request: FastifyRequest, userId: number): void {
  const id = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(id, userId, now() + SESSION_TTL);
  reply.setCookie(COOKIE, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: request.protocol === 'https',
    maxAge: SESSION_TTL,
  });
}

export function endSession(request: FastifyRequest, reply: FastifyReply): void {
  const id = request.cookies[COOKIE];
  if (id) db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  reply.clearCookie(COOKIE, { path: '/' });
}

export function loadUser(request: FastifyRequest): UserRow | undefined {
  const id = request.cookies[COOKIE];
  if (!id) return undefined;
  return db
    .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?')
    .get(id, now()) as unknown as UserRow | undefined;
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = loadUser(request);
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  request.user = user;
}
