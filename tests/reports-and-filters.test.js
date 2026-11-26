const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

const window = {};
runInNewContext(readFileSync(join(__dirname, '../assets/js/admin-reports.js'), 'utf8'), { window });
const { filterReportRows, calculateWrongQuestionStats, reportSubmittedAt } = window.AdminReports;

test('lọc đồng thời theo lớp, môn và ngày nộp theo giờ Việt Nam', () => {
    const row = { grade: '5', subject: 'Toán', submittedAt: '2026-11-24T17:00:00Z' };
    const rows = [row, { ...row, submittedAt: '2026-11-25T16:59:59.999Z' },
        { ...row, submittedAt: '2026-11-25T17:00:00Z' }, { ...row, submittedAt: '2026-11-24T16:59:59Z' },
        { ...row, grade: '11' }, { ...row, subject: 'Tiếng Việt' }, { ...row, submittedAt: '' }];
    const filters = { grade: '5', subject: 'Toán', from: '2026-11-25', to: '2026-11-25' };
    assert.deepEqual(Array.from(filterReportRows(rows, filters)), rows.slice(0, 2));
    assert.equal(filterReportRows(rows, { from: '2026-11-26' }).length, 1);
    assert.equal(filterReportRows(rows, { to: '2026-11-24' }).length, 1);
    assert.equal(filterReportRows(rows, { ...filters, from: '2026-11-26' }).length, 0);
    assert.equal(filterReportRows(rows).length, rows.length);
});

test('ưu tiên created_at khi xác định ngày nộp, không bị last_active làm lệch', () => {
    const row = { created_at: '2026-11-25T16:59:59.999Z', last_active: '2026-11-26T17:00:00Z' };
    assert.equal(reportSubmittedAt(row), row.created_at);
    assert.equal(filterReportRows([{ ...row, grade: '5', subject: 'Toán', submittedAt: reportSubmittedAt(row) }], { from: '2026-11-25', to: '2026-11-25' }).length, 1);
});

test('khoảng ngày from > to không trả về dữ liệu', () => {
    const rows = [{ grade: '5', subject: 'Toán', submittedAt: '2026-11-25T00:00:00Z' }];
    assert.equal(filterReportRows(rows, { from: '2026-11-26', to: '2026-11-25' }).length, 0);
});

test('Top câu sai đếm lượt đúng và sai theo ID và môn, bỏ qua bài ôn và câu bỏ trống', () => {
    const attempt = (subject, items, revenge = false) => ({ subject, detail: { items, revenge } });
    const rows = [
        attempt('Toán', [{ id: 1, ok: false }, { id: 1, ok: false }, { id: 2, ok: true }]),
        attempt('Toán', [{ id: '1', ok: true }]),
        attempt('Toán', [{ id: 1, ok: null }]),
        attempt('Toán', [{ id: 1, ok: false }], true),
        attempt('[Phục thù] Toán', [{ id: 1, ok: false }]),
        attempt('Lý', [{ id: 1, ok: false }]),
        { subject: 'Toán', detail: null }
    ];
    const stats = calculateWrongQuestionStats(rows);
    assert.deepEqual(Array.from(stats, ({ subject, wrong, total, wrongRate }) => [subject, wrong, total, wrongRate]),
        [['Lý', 1, 1, 100], ['Toán', 1, 2, 50]]);
    assert.equal(calculateWrongQuestionStats(rows, 1).length, 1);
});
