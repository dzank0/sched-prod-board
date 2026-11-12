// Builds dist/ for deploy: app/ + config.js from env + build sha + proof videos.
// Usage: SESSION=... node scripts/build.mjs [--dev] [--proof <dir>]
// Without --dev the git tree must be clean, so the sha names exactly the deployed code.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dev = args.includes('--dev');
const proofDir = args.includes('--proof') ? args[args.indexOf('--proof') + 1] : null;
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

const dirty = git('status', '--porcelain');
if (dirty && !dev) {
  console.error('build_refused: git tree not clean; commit first so the sha names the deployed code\n' + dirty);
  process.exit(1);
}
const sha = dev ? 'dev' : git('rev-parse', 'HEAD');
const api = process.env.API ?? 'https://hq.mega.dev/challenges/show-me-when/api';
const session = process.env.SESSION;
if (!session) { console.error('build_refused: SESSION not set'); process.exit(1); }

rmSync('dist', { recursive: true, force: true });
cpSync('app', 'dist', { recursive: true });
writeFileSync('dist/config.js', `export const API = ${JSON.stringify(api)};\nexport const SESSION = ${JSON.stringify(session)};\n`);
for (const f of readdirSync('dist').filter((f) => /\.(html|js)$/.test(f))) {
  const p = join('dist', f);
  writeFileSync(p, readFileSync(p, 'utf8').replaceAll('__BUILD_SHA__', sha));
}
if (proofDir && existsSync(proofDir)) {
  mkdirSync('dist/proof', { recursive: true });
  for (const f of readdirSync(proofDir).filter((f) => f.endsWith('.mp4'))) cpSync(join(proofDir, f), join('dist/proof', f));
}
console.log(`built dist/ sha=${sha}${proofDir ? ' proof=' + (existsSync('dist/proof') ? readdirSync('dist/proof').join(',') : 'none') : ''}`);
