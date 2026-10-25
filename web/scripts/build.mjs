import fs from 'node:fs';
import path from 'node:path';

// Build the static site using matching WASM + no-modules JS from the upstream
// browser demo. Never substitute the native npm or Python distribution.
const root = path.resolve(import.meta.dirname, '..');
const pub = path.join(root, 'public');
const vendor = path.join(root, 'vendor');
const dest = path.join(root, 'dist');
const js = path.join(vendor, 'demoparser2.js');
const wasm = path.join(vendor, 'demoparser2_bg.wasm');

for (const required of [path.join(root, 'index.html'), pub, js, wasm]) {
  if (!fs.existsSync(required)) {
    throw new Error(`Missing required web asset: ${required}. The workflow must fetch upstream WASM before building.`);
  }
}
const code = fs.readFileSync(js, 'utf8');
const expected = ['parseEvent','parseTicks','parseGrenades','parseHeader'];
for (const method of expected) {
  if (!code.includes(`__exports.${method} = function`)) {
    throw new Error(`Unsupported WASM binding: ${method} is missing. Do not deploy this candidate.`);
  }
}
if (!code.includes('wasm_bindgen')) {
  throw new Error('WASM bindings are not compatible with the no-modules Web Worker.');
}
const fd = fs.openSync(wasm, 'r');
let magic;
try {
  magic = Buffer.alloc(8);
  if (fs.readSync(fd, magic, 0, 8, 0) !== 8) throw new Error('WASM file is too short.');
} finally { fs.closeSync(fd); }
if (magic.subarray(0, 4).toString('hex') !== '0061736d' || magic.readUInt32LE(4) !== 1) {
  throw new Error('Invalid or unsupported WASM binary; do not deploy.');
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(pub, dest, { recursive: true });
fs.copyFileSync(path.join(root, 'index.html'), path.join(dest, 'index.html'));
const out = path.join(dest, 'vendor');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(js, path.join(out, 'demoparser2.js'));
fs.copyFileSync(wasm, path.join(out, 'demoparser2_bg.wasm'));
for (const extra of ['LICENSE-demoparser.txt', 'UPSTREAM_COMMIT.txt']) {
  if (fs.existsSync(path.join(vendor, extra))) fs.copyFileSync(path.join(vendor, extra), path.join(out, extra));
}
console.log(`Built web candidate: ${dest}`);
console.log(`WASM size: ${fs.statSync(wasm).size} bytes`);
console.log(`Upstream commit: ${fs.existsSync(path.join(vendor, 'UPSTREAM_COMMIT.txt')) ? fs.readFileSync(path.join(vendor, 'UPSTREAM_COMMIT.txt'), 'utf8').trim() : '(not recorded)'}`);
