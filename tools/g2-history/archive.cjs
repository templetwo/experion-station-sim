// @artifact dev
// Historical capture runner: exact public cf52132 bytes, isolated from live code.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const ARCHIVE = path.join(__dirname, 'cf52132-runtime.json');
const ARCHIVE_SHA256 = '1cfa355d4cd6f23e3e7b19f5aadd5dcd2ad362d01e474517081aa5259fda1a25';
const REVISION = 'cf521323adbe8e26f2060e7201f6ce41bfb86039';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function materialize() {
  const bytes = fs.readFileSync(ARCHIVE);
  if (hash(bytes) !== ARCHIVE_SHA256) throw Error('historical_archive_hash_mismatch');
  const archive = JSON.parse(bytes);
  if (archive.schema !== 'g2-historical-runtime-v1' || archive.archive_revision !== REVISION) throw Error('historical_archive_version');
  // Decode and verify every entry before creating an executable historical tree.
  const entries = Object.entries(archive.files).map(([name, value]) => {
    if (path.isAbsolute(name) || name.split('/').some(part => part === '..' || part === '.' || !part)) throw Error('historical_archive_path');
    const content = zlib.gunzipSync(Buffer.from(value.gzip_base64, 'base64'));
    if (hash(content) !== value.sha256) throw Error('historical_source_hash_mismatch: ' + name);
    return [name, content];
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g2-cf52132-'));
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  try {
    for (const [name, content] of entries) {
      const target = path.join(root, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    // The original validator also checks its pinned full model and harness.
    require(path.join(root, 'tools/g2/capture-native.cjs')).provenance(root);
    return { root, cleanup, revision: REVISION, archive_sha256: ARCHIVE_SHA256 };
  } catch (error) { cleanup(); throw error; }
}

function main(args) {
  if (args[0] !== '--capture' || !['stage-one', 'geometry'].includes(args[1])) {
    throw Error('usage: archive.cjs --capture stage-one|geometry [original capture arguments]');
  }
  const archive = materialize();
  try {
    const tool = args[1] === 'stage-one' ? 'tools/g2/capture-native.cjs' : 'tools/g2-geometry/capture-native.cjs';
    process.stdout.write(execFileSync(process.execPath, [path.join(archive.root, tool), ...args.slice(2)], { cwd: archive.root, maxBuffer: 16 * 1024 * 1024 }));
  } finally { archive.cleanup(); }
}

module.exports = { materialize, ARCHIVE_SHA256, REVISION };
if (require.main === module) main(process.argv.slice(2));
