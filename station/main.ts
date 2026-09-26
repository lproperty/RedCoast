/**
 * Entry point: `npm run station` (foreground), or installed as a macOS login service with
 * `npm run station:install`. Reads its config from
 * ~/Library/Application Support/RedCoast/station.json (or $REDCOAST_STATION_CONFIG).
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runStation, validateConfig } from './station.ts';

const path =
  process.env.REDCOAST_STATION_CONFIG ?? join(homedir(), 'Library', 'Application Support', 'RedCoast', 'station.json');

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

try {
  const cfg = validateConfig(JSON.parse(readFileSync(path, 'utf8')));
  await runStation(cfg, log);
} catch (err) {
  log(`cannot start: ${(err as Error).message} (config: ${path})`);
  process.exit(1);
}
