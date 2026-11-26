const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('các file JavaScript chính có cú pháp hợp lệ', () => {
  for (const file of ['app.js', 'admin.js', 'admin-access.js', 'admin-reports.js', 'app-render.js', 'app-sync.js', 'arena.js', 'supabase.js', 'math-format.js']) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', path.join(root, 'assets', 'js', file)], { stdio: 'pipe' }), file);
  }
});

test('mọi script nội bộ trong index.html và admin.html tồn tại', () => {
  for (const htmlFile of ['index.html', 'admin.html']) {
    const html = fs.readFileSync(path.join(root, htmlFile), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)];
    assert.ok(scripts.length > 0, `${htmlFile} phải có script`);
    for (const [, src] of scripts) {
      if (/^https?:\/\//i.test(src)) continue;
      const localSrc = src.split(/[?#]/, 1)[0];
      assert.ok(localSrc && fs.existsSync(path.resolve(root, localSrc)), `${htmlFile}: thiếu ${src}`);
    }
  }
});
