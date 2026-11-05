/* Quiz Studio admin workspace. Uses the same quiz_questions schema as index.html. */
(() => {
    const CONFIG = {
        url: localStorage.getItem('quiz_supabase_url') || 'https://qotfikuiwmruicsvsbgq.supabase.co',
        key: localStorage.getItem('quiz_supabase_key') || 'sb_publishable_KtAmEX6Jj97BNElniBrX6w_wVyCeQYs'
    };
    const ADMIN_CONFIG_ID = '00000000-0000-0000-0000-000000000001';
    const SUBJECTS = {
        5: [
            { key: 'math5', name: 'Toán 5' }, { key: 'vietnamese5', name: 'Tiếng Việt 5' },
            { key: 'science5', name: 'Khoa học 5' }, { key: 'history5', name: 'Lịch sử 5' },
            { key: 'geography5', name: 'Địa lý 5' }, { key: 'english5', name: 'Tiếng Anh 5' }
        ],
        11: [
            { key: 'history', name: 'Lịch Sử 11' }, { key: 'physics', name: 'Vật Lí 11' },
            { key: 'geography', name: 'Địa Lí 11' }, { key: 'math11', name: 'Toán 11' },
            { key: 'chemistry11', name: 'Hóa Học 11' }, { key: 'biology11', name: 'Sinh Học 11' },
            { key: 'english11', name: 'Tiếng Anh 11' }
        ]
    };
    const state = { client: null, questions: [], grade: 'all', subject: 'all', answer: 0, editingId: null };
    const $ = (id) => document.getElementById(id);
    const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
    const gradeOf = (q) => /(?:5|grade5|math5|vietnamese5|science5|history5|geography5|english5)(?:$|_)/i.test(String(q.subject_key || q.subjectKey)) ? '5' : '11';
    const subjectName = (key) => Object.values(SUBJECTS).flat().find((item) => item.key === key)?.name || key;
    const notify = (message, error = false) => { const toast = $('toast'); toast.textContent = message; toast.className = `toast show${error ? ' error' : ''}`; clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.className = 'toast', 3000); };

    async function getClientIp() {
        const providers = ['https://api.ipify.org?format=json', 'https://ipapi.co/json/'];
        for (const endpoint of providers) {
            try {
                const response = await fetch(endpoint, { signal: AbortSignal.timeout(3500) });
                const data = await response.json();
                if (data && data.ip) return String(data.ip).trim();
            } catch (error) { /* Try the fallback provider. */ }
        }
        return '';
    }

    async function isCurrentIpAllowed(client) {
        const ip = await getClientIp();
        if (!ip) return false;
        const { data, error } = await client.from('quiz_logins').select('score_summary').eq('id', ADMIN_CONFIG_ID).limit(1);
        if (error || !data || !data[0]) return false;
        try {
            const config = JSON.parse(data[0].score_summary || '{}');
            if (Array.isArray(config)) {
                return config.some((item) => (typeof item === 'string' ? item : item?.ip) === ip);
            }
            const masterIp = String(config.masterIp || '').trim();
            const allowed = Array.isArray(config.allowedIps) ? config.allowedIps : (Array.isArray(config.ips) ? config.ips : []);
            const ips = allowed.map((item) => typeof item === 'string' ? item : item.ip).filter(Boolean).map((item) => String(item).trim());
            return ip === masterIp || ips.includes(ip);
        } catch (error) {
            return false;
        }
    }

    function denyAccess() {
        document.querySelector('.app-shell')?.classList.add('hidden');
        $('access-denied')?.classList.remove('hidden');
        setConnection(false, 'Không được cấp quyền');
    }

    function setConnection(ready, message) { const el = $('connection-status'); el.className = `connection-status${ready ? ' is-ready' : ''}`; el.innerHTML = `<i class="fa-solid ${ready ? 'fa-cloud-check' : 'fa-triangle-exclamation'}"></i> ${message}`; }
    function fillSubjects(grade, selected) {
        const options = SUBJECTS[grade] || [];
        $('subject-select').innerHTML = options.map((item) => `<option value="${item.key}">${item.name}</option>`).join('');
        if (selected && options.some((item) => item.key === selected)) $('subject-select').value = selected;
    }
    function fillLibrarySubjects() {
        const visible = state.grade === 'all' ? Object.values(SUBJECTS).flat() : SUBJECTS[state.grade];
        $('library-subject-filter').innerHTML = '<option value="all">Tất cả môn học</option>' + visible.map((item) => `<option value="${item.key}">${item.name}</option>`).join('');
        if (!visible.some((item) => item.key === state.subject)) state.subject = 'all';
        $('library-subject-filter').value = state.subject;
    }
    function readQuestion() {
        return { subject_key: $('subject-select').value, category: $('category-input').value.trim() || 'Ôn tập', q_type: 'mcq', question: $('question-input').value.trim(), options: [0, 1, 2, 3].map((i) => $(`option-${i}`).value.trim()), correct: state.answer, answer: state.answer, explanation: $('explanation-input').value.trim(), updated_at: new Date().toISOString() };
    }
    function renderPreview() {
        const q = readQuestion();
        const letters = ['A', 'B', 'C', 'D'];
        $('preview-card').innerHTML = `<div class="preview-meta"><span>CÂU HỎI MỚI</span><span>${esc(subjectName(q.subject_key))}</span></div><h3>${esc(q.question || 'Nội dung câu hỏi sẽ hiển thị ở đây')}</h3><div>${q.options.map((opt, i) => `<div class="preview-option ${i === state.answer ? 'is-correct' : ''}"><b>${letters[i]}</b><span>${esc(opt || `Phương án ${letters[i]}`)}</span></div>`).join('')}</div>`;
    }
    function setAnswer(index) { state.answer = Number(index); document.querySelectorAll('.answer-radio').forEach((button) => { const active = Number(button.dataset.answer) === state.answer; button.classList.toggle('is-selected', active); button.innerHTML = `<i class="fa-${active ? 'solid fa-circle-dot' : 'regular fa-circle'}"></i>`; }); renderPreview(); }
    function normalize(row) { return { ...row, subjectKey: row.subject_key, options: Array.isArray(row.options) ? row.options : [], correct: Number(row.correct ?? row.answer ?? 0), explanation: row.explanation || '' }; }
    async function loadQuestions() {
        try { const { data, error } = await state.client.from('quiz_questions').select('*').order('id', { ascending: true }); if (error) throw error; state.questions = (data || []).map(normalize); setConnection(true, 'Đã đồng bộ'); renderStats(); renderLibrary(); } catch (error) { setConnection(false, 'Không thể kết nối'); notify(`Lỗi tải dữ liệu: ${error.message}`, true); }
    }
    function renderStats() { $('stat-total').textContent = state.questions.length; $('stat-grade5').textContent = state.questions.filter((q) => gradeOf(q) === '5').length; $('stat-grade11').textContent = state.questions.filter((q) => gradeOf(q) === '11').length; }
    function renderLibrary() {
        const keyword = $('search-input').value.trim().toLowerCase();
        const rows = state.questions.filter((q) => (state.grade === 'all' || gradeOf(q) === state.grade) && (state.subject === 'all' || q.subject_key === state.subject) && (!keyword || `${q.question} ${q.explanation}`.toLowerCase().includes(keyword)));
        $('library-count').textContent = rows.length; $('result-summary').textContent = `${rows.length} kết quả`;
        $('empty-state').classList.toggle('hidden', rows.length !== 0); $('questions-list').innerHTML = rows.map((q) => { const grade = gradeOf(q); const correct = Number(q.correct ?? q.answer ?? 0); return `<article class="question-item"><div class="question-item-head"><div class="question-tags"><span class="tag ${grade === '5' ? 'grade5' : 'grade11'}">Lớp ${grade}</span><span class="tag">${esc(subjectName(q.subject_key))}</span></div><span class="tag">#${q.id}</span></div><h3>${esc(q.question)}</h3><div class="item-options">${(q.options || []).slice(0, 4).map((opt, i) => `<span class="item-option ${i === correct ? 'is-correct' : ''}"><b>${'ABCD'[i]}.</b> ${esc(opt)}</span>`).join('')}</div><div class="question-item-footer"><small>${esc(q.category || 'Ôn tập')}</small><div class="item-actions"><button class="edit-button" data-edit="${q.id}"><i class="fa-solid fa-pen"></i> Sửa</button><button class="delete-button" data-delete="${q.id}"><i class="fa-solid fa-trash"></i> Xóa</button></div></div></article>`; }).join('');
    }
    function resetForm() { state.editingId = null; $('question-form').reset(); $('form-title').textContent = 'Thêm câu hỏi mới'; $('submit-label').textContent = 'Lưu câu hỏi'; $('question-id').value = ''; $('cancel-edit').classList.add('hidden'); $('grade-select').value = '11'; fillSubjects('11'); setAnswer(0); renderPreview(); }
    function editQuestion(id) { const q = state.questions.find((item) => String(item.id) === String(id)); if (!q) return; state.editingId = q.id; const grade = gradeOf(q); $('question-id').value = q.id; $('form-title').textContent = `Sửa câu hỏi #${q.id}`; $('submit-label').textContent = 'Cập nhật câu hỏi'; $('cancel-edit').classList.remove('hidden'); $('grade-select').value = grade; fillSubjects(grade, q.subject_key); $('category-input').value = q.category || ''; $('question-input').value = q.question || ''; $('explanation-input').value = q.explanation || ''; [0, 1, 2, 3].forEach((i) => { $(`option-${i}`).value = q.options?.[i] || ''; }); setAnswer(Number(q.correct ?? q.answer ?? 0)); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    async function saveQuestion(event) { event.preventDefault(); const q = readQuestion(); if (!q.question || q.options.some((item) => !item)) return notify('Vui lòng nhập đủ nội dung và 4 đáp án.', true); try { const payload = state.editingId ? { ...q, id: state.editingId } : q; const { error } = await state.client.from('quiz_questions').upsert(payload).select(); if (error) throw error; notify(state.editingId ? 'Đã cập nhật câu hỏi.' : 'Đã thêm câu hỏi.'); resetForm(); await loadQuestions(); } catch (error) { notify(`Không thể lưu: ${error.message}`, true); } }
    async function deleteQuestion(id) { if (!window.confirm(`Xóa câu hỏi #${id}? Hành động này không thể hoàn tác.`)) return; try { const { error } = await state.client.from('quiz_questions').delete().eq('id', id); if (error) throw error; notify('Đã xóa câu hỏi.'); if (state.editingId === id) resetForm(); await loadQuestions(); } catch (error) { notify(`Không thể xóa: ${error.message}`, true); } }
    function bindEvents() { $('grade-select').addEventListener('change', (event) => { fillSubjects(event.target.value); renderPreview(); }); $('question-form').addEventListener('input', renderPreview); $('question-form').addEventListener('submit', saveQuestion); $('reset-form').addEventListener('click', resetForm); $('cancel-edit').addEventListener('click', resetForm); $('refresh-button').addEventListener('click', loadQuestions); $('search-input').addEventListener('input', renderLibrary); $('library-subject-filter').addEventListener('change', (event) => { state.subject = event.target.value; renderLibrary(); }); document.querySelectorAll('.answer-radio').forEach((button) => button.addEventListener('click', () => setAnswer(button.dataset.answer))); document.querySelectorAll('.grade-filter').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.grade-filter').forEach((item) => item.classList.remove('is-active')); button.classList.add('is-active'); state.grade = button.dataset.grade; state.subject = 'all'; fillLibrarySubjects(); renderLibrary(); })); $('questions-list').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit]'); const remove = event.target.closest('[data-delete]'); if (edit) editQuestion(edit.dataset.edit); if (remove) deleteQuestion(remove.dataset.delete); }); $('theme-toggle').addEventListener('click', () => { document.body.classList.toggle('dark'); localStorage.setItem('quiz_admin_dark', document.body.classList.contains('dark') ? 'true' : 'false'); }); }
    async function init() {
        if (localStorage.getItem('quiz_admin_dark') === 'true') document.body.classList.add('dark');
        try {
            state.client = window.supabase.createClient(CONFIG.url, CONFIG.key);
            if (!(await isCurrentIpAllowed(state.client))) { denyAccess(); return; }
            bindEvents(); fillSubjects('11'); fillLibrarySubjects(); renderPreview(); await loadQuestions();
        } catch (error) {
            denyAccess();
        }
    }
    init();
})();
