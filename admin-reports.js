/* Báo cáo điểm và thống kê bài làm Quiz Studio. */
(() => {
    function reportSubmittedAt(row) {
        return row?.created_at || row?.submittedAt || row?.last_active || '';
    }

    function filterReportRows(rows, { grade = '', subject = '', from = '', to = '' } = {}) {
        const fromTime = from ? Date.parse(from + 'T00:00:00+07:00') : -Infinity;
        const toTime = to ? Date.parse(to + 'T00:00:00+07:00') + 86400000 : Infinity;
        return rows.filter((row) => {
            if (grade && String(row.grade) !== String(grade)) return false;
            if (subject && row.subject !== subject) return false;
            if (!from && !to) return true;
            const timestamp = Date.parse(row.submittedAt);
            return timestamp >= fromTime && timestamp < toTime;
        });
    }

    function calculateWrongQuestionStats(rows, limit = 15) {
        const questions = new Map();
        for (const row of rows) {
            if (row.detail?.revenge || /phục thù/i.test(row.subject) || !Array.isArray(row.detail?.items)) continue;
            const counted = new Set();
            for (const item of row.detail.items) {
                if (item?.id == null || (item.ok !== true && item.ok !== false)) continue;
                const id = String(item.id);
                if (counted.has(id)) continue;
                counted.add(id);
                const key = JSON.stringify([row.subjectKey || row.subject, id]);
                if (!questions.has(key)) questions.set(key, {
                    id, subject: row.subject, subjectKey: row.subjectKey, category: item.cat, wrong: 0, total: 0
                });
                const question = questions.get(key);
                question.total += 1;
                if (!item.ok) question.wrong += 1;
            }
        }
        return [...questions.values()].filter((question) => question.wrong > 0)
            .map((question) => ({ ...question, wrongRate: question.wrong * 100 / question.total }))
            .sort((a, b) => b.wrongRate - a.wrongRate || b.total - a.total)
            .slice(0, limit);
    }

    function create({ state, SYSTEM, $, esc, runAction, notify, exportJson, buildAdminSkeletonHtml, resolvePinnedStudentName, allSubjects, subjectGrade, subjectMatchKey }) {
        const reportNumber = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits).replace('.', ',') : '—';
        const reportDate = (value) => {
            const date = value ? new Date(value) : null;
            return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';
        };
        const reportRowsFromData = (data) => {
            const systemIds = new Set(Object.values(SYSTEM));
            const catalog = allSubjects();
            return (data || []).filter((row) => {
                const name = String(row.player_name || '').trim();
                return !systemIds.has(row.id) && !name.startsWith('__') && !/^banned/i.test(String(row.status || ''));
            }).map((row) => {
                const status = String(row.status || '');
                const fullSummary = String(row.score_summary || '');
                const detailIdx = fullSummary.indexOf('\n__DETAIL__:');
                const summary = detailIdx >= 0 ? fullSummary.slice(0, detailIdx) : fullSummary;
                let detail = null;
                if (detailIdx >= 0) { try { detail = JSON.parse(fullSummary.slice(detailIdx + '\n__DETAIL__:'.length)); } catch (e) {} }
                const combined = `${status} ${summary}`;
                const ratio = summary.match(/(?:đúng|hoàn thành|kết quả)\s*(\d+)\s*\/\s*(\d+)/i) || (/(?:đã nộp bài|hoàn thành)/i.test(status) ? combined.match(/(\d+)\s*\/\s*(\d+)\s*(?:câu|ý)?/i) : null);
                const scoreMatch = summary.match(/(\d+(?:[.,]\d+)?)\s*điểm/i);
                const scoreRaw = scoreMatch ? Number(scoreMatch[1].replace(',', '.')) : null;
                const correct = ratio ? Number(ratio[1]) : null;
                const total = ratio ? Number(ratio[2]) : null;
                // App lưu `điểm` theo phần trăm 0–100. Chuẩn hóa một lần về /10;
                // không suy đoán số <= 10 là đã ở thang /10 vì 10% phải là 1/10.
                const score10 = Number.isFinite(scoreRaw) ? (scoreRaw / 10) : (correct !== null && total > 0 ? (correct / total) * 10 : null);
                const completed = /đã nộp bài|hoàn thành/i.test(status) || Number.isFinite(scoreRaw);
                const subjectMatch = status.match(/^\[((?:\[[^\]]*\]|[^\]])*)\]/) || summary.match(/^\[((?:\[[^\]]*\]|[^\]])*)\]/);
                const subject = subjectMatch ? subjectMatch[1].trim() : 'Chưa xác định';
                const key = subjectMatchKey(detail?.subjectKey || subject);
                const matches = catalog.filter((entry) => [entry.key, entry.name, entry.title].some((value) => subjectMatchKey(value) === key));
                const catalogSubject = matches.length === 1 ? matches[0] : null;
                const grade = String(detail?.grade || (catalogSubject ? subjectGrade(catalogSubject) : subject.match(/(?:^|[^0-9])(5|11)(?:$|[^0-9])/)?.[1]) || '');
                const subjectKey = detail?.subjectKey || catalogSubject?.key || '';
                const displayName = resolvePinnedStudentName(row.device_info, row.player_name || 'Học sinh');
                return { ...row, detail, name: displayName, subject, subjectKey, grade, score10: Number.isFinite(score10) ? Math.max(0, Math.min(10, score10)) : null, correct, total, completed, submittedAt: reportSubmittedAt(row) };
            }).filter((row) => row.completed && Number.isFinite(row.score10) && !/phục thù/i.test(row.subject));
        };
        const setActionBusy = (id, busy, label) => {
            const button = $(id);
            if (!button) return;
            if (busy) {
                if (!button.dataset.reportLabel) button.dataset.reportLabel = button.innerHTML;
                button.disabled = true;
                button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${esc(label || 'Đang xử lý...')}`;
            } else {
                button.disabled = false;
                if (button.dataset.reportLabel) button.innerHTML = button.dataset.reportLabel;
            }
        };
        const reportAction = (id, action, label) => $(id)?.addEventListener('click', () => runAction(async () => { setActionBusy(id, true, label); try { await action(); } finally { setActionBusy(id, false); } }));
        const setReportState = (mode, message = '') => {
            ['loading', 'error', 'empty'].forEach((key) => $(`report-state-${key}`)?.classList.toggle('hidden', key !== mode));
            if (message && $('report-state-error-text')) $('report-state-error-text').textContent = message;
            $('report-summary')?.classList.toggle('hidden', mode !== 'ready');
        };
        function renderReportSummary(rows, filters) {
            const scores = rows.map((row) => row.score10).sort((a, b) => a - b);
            const sum = scores.reduce((total, score) => total + score, 0);
            const mean = scores.length ? sum / scores.length : NaN;
            const median = scores.length ? (scores.length % 2 ? scores[(scores.length - 1) / 2] : (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2) : NaN;
            const sd = scores.length ? Math.sqrt(scores.reduce((total, score) => total + ((score - mean) ** 2), 0) / scores.length) : NaN;
            const students = new Set(rows.map((row) => {
                const name = row.name.toLowerCase();
                return name && name !== 'khách truy cập' ? `name:${name}` : `ip:${row.ip_address || ''}`;
            }));
            const denominatorRows = rows.filter((row) => row.total > 0 && row.correct !== null);
            const completed = denominatorRows.filter((row) => row.detail?.items?.length ? row.detail.items.every((item) => item.ok === true || item.ok === false) : row.correct >= row.total).length;
            const omissions = denominatorRows.map((row) => row.detail?.items?.length ? row.detail.items.filter((item) => item.ok !== true && item.ok !== false).length : row.total - row.correct).filter((value) => value >= 0);
            if (!omissions.length && Object.values(filters).every((value) => !value)) {
                omissions.push(...state.reportOmissionCounts);
            }
            const dates = rows.map((row) => new Date(row.submittedAt).getTime()).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
            $('report-attempts').textContent = String(rows.length);
            $('report-students').textContent = String(students.size);
            $('report-mean').textContent = reportNumber(mean);
            $('report-median').textContent = reportNumber(median);
            $('report-sd').textContent = reportNumber(sd);
            $('report-range').textContent = scores.length ? `${reportNumber(scores[0])} - ${reportNumber(scores[scores.length - 1])}` : '—';
            $('report-completion').textContent = denominatorRows.length ? `${Math.round((completed / denominatorRows.length) * 100)}% (${completed}/${denominatorRows.length})` : 'Không có dữ liệu';
            $('report-omission').textContent = omissions.length ? `${reportNumber(omissions.reduce((a, b) => a + b, 0) / omissions.length)} câu/lượt` : 'Không có dữ liệu';
            $('report-date-range').textContent = dates.length ? `${reportDate(dates[0])} - ${reportDate(dates[dates.length - 1])}` : 'Không có dữ liệu';
            $('report-selection-rule').textContent = 'Lượt có điểm hoặc tỷ lệ đúng; không gộp lượt';
            $('report-method-note').textContent = 'Điểm được chuẩn hóa về thang /10 từ score_summary; chỉ tính bản ghi học sinh hợp lệ, loại bản ghi hệ thống và bị chặn.';
            setReportState('ready');
        }
        function populateLeaderboardSubjects() {
            const select = $('leaderboard-subject');
            if (!select) return;
            const current = select.value;
            const subjects = [...new Set((state.reportRows || []).map((row) => row.subject).filter((subject) => subject && subject !== 'Chưa xác định'))];
            select.innerHTML = '<option value="">Tất cả môn</option>' + subjects.map((subject) => `<option value="${esc(subject)}">${esc(subject)}</option>`).join('');
            if (subjects.includes(current)) select.value = current;
        }
        function renderLeaderboard() {
            const content = $('leaderboard-content');
            if (!content) return;
            const subject = $('leaderboard-subject')?.value || '';
            const filtered = (state.reportRows || []).filter((row) => !subject || row.subject === subject).sort((a, b) => b.score10 - a.score10 || new Date(a.submittedAt) - new Date(b.submittedAt));
            const pageSize = 10;
            const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
            state.reportLeaderboardPage = Math.min(pageCount, Math.max(1, state.reportLeaderboardPage || 1));
            const start = (state.reportLeaderboardPage - 1) * pageSize;
            const rows = filtered.slice(start, start + pageSize);
            $('leaderboard-summary').textContent = rows.length ? `Top ${rows.length} lượt thi, trang ${state.reportLeaderboardPage}/${pageCount}${subject ? ` môn ${subject}` : ''}; sắp xếp theo điểm /10.` : 'Chưa có kết quả phù hợp.';
            $('leaderboard-empty')?.classList.toggle('hidden', rows.length > 0);
            content.innerHTML = rows.length ? `<div class="table-wrap"><table class="data-table leaderboard-table"><thead><tr><th>Hạng</th><th>Học sinh</th><th>Môn</th><th>Điểm</th><th>Đúng / tổng</th><th>Ngày nộp</th></tr></thead><tbody>${rows.map((row, index) => `<tr><td><span class="rank-badge rank-${(start + index) + 1}">#${(start + index) + 1}</span></td><td><strong>${esc(row.name)}</strong></td><td>${esc(row.subject)}</td><td><strong class="leader-score">${reportNumber(row.score10)} /10</strong></td><td>${row.correct !== null && row.total ? `${row.correct}/${row.total} (${Math.round((row.correct / row.total) * 100)}%)` : 'Không có dữ liệu'}</td><td>${esc(reportDate(row.submittedAt))}</td></tr>`).join('')}</tbody></table></div><div class="leaderboard-pagination"><button class="button button-secondary" ${state.reportLeaderboardPage <= 1 ? 'disabled' : ''} data-report-page="prev">Trang trước</button><span>Trang ${state.reportLeaderboardPage}/${pageCount}</span><button class="button button-secondary" ${state.reportLeaderboardPage >= pageCount ? 'disabled' : ''} data-report-page="next">Trang sau</button></div>` : '';
        }
        async function fetchReportRows() {
            if (!state.client) throw new Error('Chưa kết nối Supabase.');
            const pageSize = 500;
            const data = [];
            for (let offset = 0; ; offset += pageSize) {
                const { data: page, error } = await state.client.from('quiz_logins')
                    .select('id, player_name, ip_address, device_info, status, score_summary, last_active, created_at')
                    .order('last_active', { ascending: false })
                    .range(offset, offset + pageSize - 1);
                if (error) throw error;
                data.push(...(page || []));
                if (!page || page.length < pageSize) break;
            }
            if (window.dbService && typeof window.dbService.autoSubmitStaleAttempts === 'function') { await window.dbService.autoSubmitStaleAttempts(data).catch(() => 0); }
            const systemIds = new Set(Object.values(SYSTEM));
            state.reportOmissionCounts = data
                .filter((row) => !systemIds.has(row.id) && !String(row.player_name || '').startsWith('__') && !/^banned/i.test(String(row.status || '')))
                .map((row) => (String(row.status || '') + ' ' + String(row.score_summary || '')).match(/(?:bỏ sót|chưa\s+(?:trả lời|làm)|còn)\s*(\d+)/i))
                .filter(Boolean).map((match) => Number(match[1]));
            return reportRowsFromData(data);
        }
        function readFilters() {
            return {
                grade: $('report-grade').value, subject: $('report-subject').value,
                from: $('report-from').value, to: $('report-to').value
            };
        }

        function applyReportFilters() {
            if (!state.reportSourceRows) return;
            const filters = readFilters();
            if (filters.from && filters.to && filters.from > filters.to) {
                state.reportRows = [];
                state.reportLeaderboardPage = 1;
                populateLeaderboardSubjects();
                if ($('leaderboard-content')) $('leaderboard-content').innerHTML = '';
                $('leaderboard-empty')?.classList.remove('hidden');
                if ($('quiz-wrong-stats-content')) $('quiz-wrong-stats-content').textContent = '';
                setReportState('error', 'Ngày đến phải từ ngày bắt đầu trở đi.');
                return;
            }
            state.reportRows = filterReportRows(state.reportSourceRows, filters);
            state.reportLeaderboardPage = 1;
            populateLeaderboardSubjects();
            renderLeaderboard();
            if (state.reportRows.length) {
                renderReportSummary(state.reportRows, filters);
            } else {
                setReportState('empty');
            }
            renderQuizWrongStats();
        }

        function renderQuizWrongStats() {
            const content = $('quiz-wrong-stats-content');
            const rows = calculateWrongQuestionStats(state.reportRows);
            if (!rows.length) {
                content.textContent = 'Chưa có dữ liệu câu sai.';
                return;
            }
            const questions = new Map(state.questions.map((q) => [JSON.stringify([subjectMatchKey(q.subject_key), String(q.id)]), q.question]));
            const tableRows = rows.map((row) => {
                const key = JSON.stringify([subjectMatchKey(row.subjectKey || row.subject), row.id]);
                const label = questions.get(key) || ('Câu #' + row.id + (row.category ? ' · ' + row.category : ''));
                return "<tr><td>" + esc(row.subject) + "</td><td>" + esc(label) + "</td><td>" + row.wrong + " / " + row.total + "</td><td>" + reportNumber(row.wrongRate) + "%</td></tr>";
            }).join('');
            content.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr><th>Môn</th><th>Câu hỏi</th><th>Sai / Lượt trả lời</th><th>Tỷ lệ sai</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>';
        }

        async function loadScoreReport() {
            if (state.reportLoading) return;
            state.reportLoading = true;
            setActionBusy('refresh-score-report', true, 'Đang tải');
            setReportState('loading');
            if ($('leaderboard-content') && !$('leaderboard-content').querySelector('.leaderboard-table')) {
                $('leaderboard-content').innerHTML = buildAdminSkeletonHtml('leaderboard', 4);
            }
            try {
                state.reportSourceRows = await fetchReportRows();
                const select = $('report-subject');
                const current = select.value;
                const subjects = [...new Set(state.reportSourceRows.map((row) => row.subject))].sort((a, b) => a.localeCompare(b, 'vi'));
                select.replaceChildren(new Option('Tất cả môn', ''), ...subjects.map((subject) => new Option(subject, subject)));
                select.value = subjects.includes(current) ? current : '';
                applyReportFilters();
                if ($('report-last-updated')) $('report-last-updated').textContent = `Cập nhật ${new Date().toLocaleTimeString('vi-VN')}`;
            } catch (error) {
                state.reportSourceRows = null;
                state.reportRows = null;
                $('quiz-wrong-stats-content').textContent = 'Không thể tải dữ liệu.';
                setReportState('error', error?.message || 'Không thể tải dữ liệu báo cáo.');
                $('leaderboard-content').innerHTML = '';
                $('leaderboard-summary').textContent = 'Không thể tải bảng xếp hạng.';
            } finally {
                state.reportLoading = false;
                setActionBusy('refresh-score-report', false);
            }
        }
        async function loadLeaderboard() {
            if (!state.reportRows) {
                if ($('leaderboard-content')) $('leaderboard-content').innerHTML = buildAdminSkeletonHtml('leaderboard', 4);
                await loadScoreReport();
            }
            if (!state.reportRows) return;
            setActionBusy('load-leaderboard', true, 'Đang tải');
            $('leaderboard-loading')?.classList.remove('hidden');
            $('leaderboard-error')?.classList.add('hidden');
            $('leaderboard-empty')?.classList.add('hidden');
            try { renderLeaderboard(); } catch (error) { $('leaderboard-error')?.classList.remove('hidden'); $('leaderboard-error-text').textContent = error.message || 'Không thể tải bảng xếp hạng.'; }
            finally { $('leaderboard-loading')?.classList.add('hidden'); setActionBusy('load-leaderboard', false); }
        }
        async function loadWrongQuestionStats() {
            const contentEl = $('wrong-stats-content');
            const summaryEl = $('wrong-stats-summary');
            if (!contentEl || !state.client) return;
            const subjectKey = $('wrong-stats-subject')?.value || '';
            setActionBusy('load-wrong-stats', true, 'Đang tải');
            try {
                const { data, error } = await state.client.rpc('arena_get_wrong_question_stats', {
                    p_subject_key: subjectKey || null,
                    p_limit: 15
                });
                if (error) {
                    const msg = String(error.message || '');
                    contentEl.innerHTML = /arena_get_wrong_question_stats|PGRST202|does not exist/i.test(msg)
                        ? '<p class="muted-copy">Chưa cài đặt RPC thống kê câu sai. Vui lòng chạy lại <code>supabase_arena_setup.sql</code> trong Supabase SQL Editor.</p>'
                        : `<p class="muted-copy">${esc(msg)}</p>`;
                    return;
                }
                const rows = Array.isArray(data) ? data : [];
                if (summaryEl) summaryEl.textContent = rows.length ? `Tìm thấy ${rows.length} câu hỏi có lượt trả lời sai.` : 'Chưa có dữ liệu câu sai từ Đấu trường.';
                if (!rows.length) {
                    contentEl.innerHTML = '<p class="muted-copy">Chưa có câu hỏi nào bị trả lời sai trong Đấu trường.</p>';
                    return;
                }
                contentEl.innerHTML = `
                    <div class="table-wrap">
                        <table class="data-table">
                            <thead>
                                <tr><th>#</th><th>Môn / Chuyên đề</th><th>Nội dung câu hỏi</th><th>Sai / Tổng</th><th>Tỷ lệ sai</th></tr>
                            </thead>
                            <tbody>
                                ${rows.map((r, idx) => `
                                    <tr>
                                        <td><b>#${idx + 1}</b></td>
                                        <td><b>${esc(r.subject_key)}</b><br><small class="muted-copy">${esc(r.category || '')}</small></td>
                                        <td style="max-width:420px;">${esc(String(r.question || '').slice(0, 140))}${String(r.question || '').length > 140 ? '...' : ''}</td>
                                        <td><b style="color:var(--red,#ef4444);">${Number(r.wrong_attempts || 0)}</b> / ${Number(r.total_attempts || 0)}</td>
                                        <td><span class="status-badge danger">${Number(r.wrong_rate || 0)}%</span></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            } finally {
                setActionBusy('load-wrong-stats', false);
            }
        }
        function exportScoreReport() {
            if (state.reportLoading || !state.reportRows?.length) return notify('Hãy tải báo cáo điểm có dữ liệu trước khi xuất file.', true);
            const scores = state.reportRows.map((row) => row.score10);
            const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
            const ordered = [...scores].sort((a, b) => a - b);
            const median = ordered.length % 2 ? ordered[(ordered.length - 1) / 2] : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2;
            exportJson(`quiz-studio-score-report-${new Date().toISOString().slice(0, 10)}.json`, { exportedAt: new Date().toISOString(), scale: '/10', filters: readFilters(), selectionRule: 'Lượt có điểm hoặc tỷ lệ đúng; không gộp lượt', summary: { validAttempts: scores.length, uniqueStudents: new Set(state.reportRows.map((row) => row.name.toLowerCase())).size, mean: Number(mean.toFixed(3)), median: Number(median.toFixed(3)) }, attempts: state.reportRows.map((row) => ({ student: row.name, subject: row.subject, grade: row.grade || null, score10: Number(row.score10.toFixed(3)), correct: row.correct, total: row.total, percentage: row.correct !== null && row.total ? Number(((row.correct / row.total) * 100).toFixed(2)) : null, submittedAt: row.submittedAt })) });
            notify('Đã tải báo cáo điểm JSON.');
        }

        return { setActionBusy, reportAction, loadScoreReport, loadLeaderboard, renderLeaderboard, loadWrongQuestionStats, exportScoreReport, applyReportFilters };
    }

    window.AdminReports = { create, filterReportRows, calculateWrongQuestionStats, reportSubmittedAt };
})();
