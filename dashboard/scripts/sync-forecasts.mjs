// Copies the local Chronos-2 forecast output into the dashboard's public folder
// so the frontend can load it as a static asset (/data/forecasts.json). The
// forecasting output lives outside the Vite root, so it must be synced in.
//
// Runs automatically before `dev` and `build` (see package.json prehooks), or
// manually:  node scripts/sync-forecasts.mjs
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'forecasting', 'output', 'forecasts.json');
const destDir = join(here, '..', 'public', 'data');
const dest = join(destDir, 'forecasts.json');

if (!existsSync(src)) {
  console.warn(`[sync-forecasts] source not found: ${src} — keeping existing public/data/forecasts.json`);
  process.exit(0);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[sync-forecasts] ${src} -> ${dest}`);
