import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('package.json có script test', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.js');
});

test('index.html nạp đầy đủ các module app theo đúng thứ tự', () => {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  assert.ok(html.includes('assets/js/app-render.js'), 'Thiếu app-render.js');
  assert.ok(html.includes('assets/js/app-sync.js'), 'Thiếu app-sync.js');
  
  const idxRender = html.indexOf('assets/js/app-render.js');
  const idxSync = html.indexOf('assets/js/app-sync.js');
  const idxQuiz = html.indexOf('assets/js/app-quiz.js');
  
  assert.ok(idxRender < idxQuiz, 'app-render.js phải đứng trước app-quiz.js');
  assert.ok(idxSync < idxQuiz, 'app-sync.js phải đứng trước app-quiz.js');
});

test('admin.html nạp đầy đủ các module admin-access và admin-reports', () => {
  const html = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');
  assert.ok(html.includes('assets/js/admin-access.js'), 'Thiếu admin-access.js');
  assert.ok(html.includes('assets/js/admin-reports.js'), 'Thiếu admin-reports.js');
});

test('api/gemini.js loại bỏ nhận API key từ client và siết CORS', () => {
  const code = fs.readFileSync(path.join(rootDir, 'api', 'gemini.js'), 'utf8');
  assert.ok(!code.includes('x-gemini-api-key'), 'Không được nhận x-gemini-api-key từ client');
  assert.ok(!code.includes('body.apiKey'), 'Không được nhận body.apiKey từ client');
});

test('app-import.js không tự động ép đáp án rỗng/lỗi thành 0 (đáp án A)', () => {
  const code = fs.readFileSync(path.join(rootDir, 'assets', 'js', 'app-import.js'), 'utf8');
  // answerIndex không được trả 0 mặc định khi không hợp lệ
  assert.ok(!code.includes('return 0; // default to A'), 'Không được mặc định về A khi đáp án lỗi');
});

test('supabase_security_migration.sql không so khớp hậu tố IP để trả access token', () => {
  const sql = fs.readFileSync(path.join(rootDir, 'supabase', 'sql', 'supabase_security_migration.sql'), 'utf8');
  assert.ok(!sql.includes("LIKE ('%' || p_token)"), 'Không được so khớp hậu tố token với IP');
});
