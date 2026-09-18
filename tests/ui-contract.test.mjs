import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('manifest points to files that exist', async () => {
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    assert.equal(manifest.js, 'index.js');
    assert.equal(manifest.css, 'style.css');
    await readFile(path.join(root, manifest.js));
    await readFile(path.join(root, manifest.css));
});

test('literal UI ids referenced by index.js exist in settings template', async () => {
    const [source, html] = await Promise.all([
        readFile(path.join(root, 'index.js'), 'utf8'),
        readFile(path.join(root, 'settings.html'), 'utf8'),
    ]);
    const referencedIds = [...source.matchAll(/byId\('([^']+)'\)/gu)].map(match => match[1]);
    const missing = [...new Set(referencedIds)].filter(id => !html.includes(`id="${id}"`));
    assert.deepEqual(missing, []);
});
