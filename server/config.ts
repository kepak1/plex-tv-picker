import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}


// package.json is the single source of the version (the Docker image ships it next to dist/).
const pkg = JSON.parse(readFileSync(resolve(process.env.APP_ROOT ?? '.', 'package.json'), 'utf8')) as { version: string };

export const config = {
  version: pkg.version,
  port: Number(env('PORT', '8080')),
  dataDir: env('DATA_DIR', './data'),
  // Internal URL the backend uses to talk to Plex (can be http://plex:32400 inside Docker).
  plexUrl: env('PLEX_URL').replace(/\/$/, ''),
  // URL opened in the browser when clicking an airing; defaults to PLEX_URL.
  plexPublicUrl: (optional('PLEX_PUBLIC_URL') ?? env('PLEX_URL')).replace(/\/$/, ''),
  plexToken: env('PLEX_TOKEN'),
  plexInsecureTls: optional('PLEX_INSECURE_TLS') === 'true',
  // Public URL of this app, used for links in emails and the Plex login redirect.
  appUrl: optional('APP_URL')?.replace(/\/$/, ''),
  syncCron: env('SYNC_CRON', '0 3 * * *'),
  timezone: env('TZ', 'UTC'),
  defaultLanguage: env('DEFAULT_LANGUAGE', 'en'),
  tmdbApiKey: optional('TMDB_API_KEY'),
  smtp: {
    host: optional('SMTP_HOST'),
    port: Number(env('SMTP_PORT', '587')),
    secure: optional('SMTP_SECURE') === 'true',
    user: optional('SMTP_USER'),
    pass: optional('SMTP_PASS'),
    from: optional('SMTP_FROM') ?? optional('SMTP_USER'),
  },
};

if (config.plexInsecureTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
