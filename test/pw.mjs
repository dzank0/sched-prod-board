// Playwright for the tests: the installed package if present, else a copy in the npx cache (no install).
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

async function load() {
  try { return await import('playwright'); } catch {}
  const npx = join(homedir(), '.npm', '_npx');
  const dirs = existsSync(npx) ? readdirSync(npx).map((d) => join(npx, d, 'node_modules')).filter((d) => existsSync(join(d, 'playwright', 'package.json'))) : [];
  dirs.sort((a, b) => JSON.parse(readFileSync(join(b, 'playwright/package.json'))).version.localeCompare(JSON.parse(readFileSync(join(a, 'playwright/package.json'))).version, undefined, { numeric: true }));
  if (!dirs.length) throw new Error('playwright_missing');
  return createRequire(join(dirs[0], 'x.js'))('playwright');
}
export const { chromium } = await load();
export const launch = () => chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
