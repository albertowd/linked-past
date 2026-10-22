// Builds the host's proof-of-ownership table from your own ROM dumps (bundled with the app).
// The table holds only SHA-256 digests of random ROM slices, never ROM bytes.
//   node scripts/make-rom-challenges.mjs dump/*.sfc
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PER_ROM = 512;
const out = path.resolve('src/shared/data/rom-challenges.json');
const table = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};

for (const file of process.argv.slice(2)) {
  let rom = fs.readFileSync(file);
  if (rom.length === 0x100200) rom = rom.subarray(0x200);
  const sha1 = crypto.createHash('sha1').update(rom).digest('hex');
  const entries = [];
  for (let i = 0; i < PER_ROM; i++) {
    const length = 256 + crypto.randomInt(3840);
    const offset = crypto.randomInt(rom.length - length);
    const sha256 = crypto
      .createHash('sha256')
      .update(rom.subarray(offset, offset + length))
      .digest('hex');
    entries.push([offset, length, sha256]);
  }
  table[sha1] = entries;
  console.log(`${path.basename(file)} -> ${sha1} (${PER_ROM} challenges)`);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(table));
