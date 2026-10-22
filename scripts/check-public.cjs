const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const skip = new Set(['.git','node_modules','.verify','.gradle','.cxx','.kotlin','.externalNativeBuild','build','coverage','dist']);
const failures = [];
let files = 0;
function visit(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    if (skip.has(entry.name) || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name), rel = path.relative(root, full).replaceAll('\\','/');
    if (entry.isDirectory()) { visit(full); continue; }
    if (entry.name === 'local.properties') continue;
    files++;
    if (/\.(keystore|jks|p12|pfx|pem|key|apk|aab|sqlite|db|mp3|flac|m4a|wav)$/i.test(rel) ||
      /(?:^|\/)(?:memory|qa|outputs|source-activation)(?:\/|$)/.test(rel) ||
      /(?:SourceActivation|SyncedSourceStore|SourceSyncSupport|default-music-source)/.test(rel)) failures.push(rel + ': excluded publication file');
    if (!/\.(?:ts|tsx|js|cjs|kt|java|xml|gradle|properties|md|json|txt|ya?ml)$/.test(rel) || rel.startsWith('scripts/')) continue;
    const body = fs.readFileSync(full,'utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|\bAKIA[0-9A-Z]{16}\b|\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}/.test(body)) failures.push(rel + ': possible credential');
    if (rel.includes('/src/') && /LiuliuSourceActivation|sourceActivation|activateSources|sourceActivated|synchronizeSourceDownloads|github_source_v1_|source-hidden-controls-trigger|source-activation-dialog/.test(body)) failures.push(rel + ': removed distribution mechanism referenced');
    if (/E:[\\/](?:liuliu-agent-music|codex)|PROJECT_MEMORY_VERSION/.test(body)) failures.push(rel + ': private build dependency');
  }
}
visit(root);
const gradle = fs.readFileSync(path.join(root,'mobile-react-native/android/app/build.gradle'),'utf8');
if (/signingConfig\s+signingConfigs\.debug/.test(gradle)) failures.push('Release must not share a distributed debug key');
if (!gradle.includes("applicationId 'com.liuliu.music.opensource'")) failures.push('Public package identity missing');
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Public source check passed (${files} files; no bundled playback source, activation bridge, signing key or private build dependency).`);
