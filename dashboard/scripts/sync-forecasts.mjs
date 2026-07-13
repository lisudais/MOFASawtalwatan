// Copies the local XGBoost outbreak-forecast output into the dashboard's public
// folder so the frontend can load it as a static asset (/data/outbreak_forecast.json).
// The model output lives outside the Vite root, so it must be synced in.
//
// Runs automatically before `dev` and `build` (see package.json prehooks), or
// manually:  node scripts/sync-forecasts.mjs
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'disease_ml', 'output', 'outbreak_forecast.json');
const destDir = join(here, '..', 'public', 'data');
const dest = join(destDir, 'outbreak_forecast.json');

if (!existsSync(src)) {
  console.warn(`[sync-forecasts] source not found: ${src} — keeping existing public/data/outbreak_forecast.json`);
  process.exit(0);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[sync-forecasts] ${src} -> ${dest}`);
