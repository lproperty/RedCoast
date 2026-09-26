#!/usr/bin/env node
/**
 * Installs the RedCoast home station as a macOS login service (LaunchAgent).
 *
 *   npm run station:install -- --setup --lat 1.3 --lon 103.9   first time: creates the config and a
 *                                                              token, and gives the token to the relay
 *   npm run station:install                                    rebuild and restart (after git pull)
 *   npm run station:install -- --uninstall                     stop and remove the service
 *   npm run station:install -- --status                        is it running? recent log lines
 *
 * Everything lives outside the repo: the bundled station and its config in
 * ~/Library/Application Support/RedCoast, the log in ~/Library/Logs/redcoast-station.log.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = join(homedir(), 'Library', 'Application Support', 'RedCoast');
const CONFIG = join(APP_DIR, 'station.json');
const BUNDLE = join(APP_DIR, 'station.mjs');
const LABEL = 'io.github.lproperty.redcoast.station';
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOG = join(homedir(), 'Library', 'Logs', 'redcoast-station.log');
const DEFAULT_RELAY = 'https://redcoast-relay.lproperty.workers.dev';
const DOMAIN = `gui/${userInfo().uid}`;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function launchctl(...a) {
  return spawnSync('launchctl', a, { encoding: 'utf8' });
}

if (process.platform !== 'darwin') {
  console.error('The installer sets up a macOS LaunchAgent. On Linux, run `npm run station` under systemd instead.');
  process.exit(1);
}

if (flag('status')) {
  const r = launchctl('print', `${DOMAIN}/${LABEL}`);
  const state = r.status === 0 ? (r.stdout.match(/state = (\w+)/)?.[1] ?? 'loaded') : 'not installed';
  console.log(`service: ${state}`);
  if (existsSync(LOG)) console.log(readFileSync(LOG, 'utf8').trim().split('\n').slice(-12).join('\n'));
  process.exit(0);
}

if (flag('uninstall')) {
  launchctl('bootout', `${DOMAIN}/${LABEL}`);
  rmSync(PLIST, { force: true });
  console.log(`Stopped and removed the service. Config kept at ${CONFIG}.`);
  process.exit(0);
}

mkdirSync(APP_DIR, { recursive: true });

// 1. Config and shared token (first time only).
if (flag('setup')) {
  if (existsSync(CONFIG) && !flag('force')) {
    console.log(`Config already exists at ${CONFIG} (use --force to replace it).`);
  } else {
    const lat = Number(opt('lat'));
    const lon = Number(opt('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      console.error('--setup needs --lat and --lon (rounded to 0.1° is plenty, e.g. --lat 1.3 --lon 103.9)');
      process.exit(1);
    }
    const config = {
      relayUrl: opt('relay') ?? DEFAULT_RELAY,
      token: randomBytes(32).toString('hex'),
      lat: Math.round(lat * 10) / 10,
      lon: Math.round(lon * 10) / 10,
      radiusNm: 50,
    };
    writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    chmodSync(CONFIG, 0o600);
    console.log(`Wrote ${CONFIG}`);
    // The relay needs the same token. Piped on stdin, so it never appears on screen or in shell history.
    const put = spawnSync('npx', ['wrangler', 'secret', 'put', 'STATION_TOKEN'], {
      cwd: join(ROOT, 'relay'),
      input: config.token,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    if (put.status !== 0) {
      console.error('Could not set STATION_TOKEN on the relay (run `npx wrangler login` in relay/ first).');
      process.exit(1);
    }
  }
}
if (!existsSync(CONFIG)) {
  console.error(`No config at ${CONFIG}. Run with --setup --lat <lat> --lon <lon> first.`);
  process.exit(1);
}

// 2. Bundle the station into a single file outside the repo (no Documents-folder permission prompts).
const { build } = await import('vite');
await build({
  configFile: false,
  root: ROOT,
  publicDir: false,
  logLevel: 'warn',
  build: {
    ssr: join(ROOT, 'station', 'main.ts'),
    outDir: APP_DIR,
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'station.mjs', format: 'es' } },
  },
  ssr: { noExternal: true, target: 'node' },
});
console.log(`Bundled ${BUNDLE}`);

// 3. LaunchAgent: start at login, restart if it ever exits.
const node = existsSync('/opt/homebrew/bin/node') ? '/opt/homebrew/bin/node' : process.execPath;
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
mkdirSync(dirname(PLIST), { recursive: true });
mkdirSync(dirname(LOG), { recursive: true });
writeFileSync(
  PLIST,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(node)}</string><string>${xml(BUNDLE)}</string></array>
  <key>WorkingDirectory</key><string>${xml(APP_DIR)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG)}</string>
</dict>
</plist>
`,
);
launchctl('bootout', `${DOMAIN}/${LABEL}`);
// bootout returns before the old station has exited, and bootstrap fails (EIO) until it has.
let boot = launchctl('bootstrap', DOMAIN, PLIST);
for (let i = 0; boot.status !== 0 && i < 20; i++) {
  await new Promise((r) => setTimeout(r, 500));
  boot = launchctl('bootstrap', DOMAIN, PLIST);
}
if (boot.status !== 0) {
  console.error(`launchctl bootstrap failed: ${boot.stderr || boot.stdout}`);
  process.exit(1);
}
execFileSync('launchctl', ['kickstart', '-k', `${DOMAIN}/${LABEL}`]);
console.log(`Station running (service ${LABEL}). Log: ${LOG}`);
