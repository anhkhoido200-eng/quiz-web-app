/* Quiz Studio Control Center. Question editor, strict AI import and system controls. */
(() => {
    const CONFIG = {
        url: localStorage.getItem('quiz_supabase_url') || 'https://qotfikuiwmruicsvsbgq.supabase.co',
        key: localStorage.getItem('quiz_supabase_key') || 'sb_publishable_KtAmEX6Jj97BNElniBrX6w_wVyCeQYs'
    };
    const SYSTEM = {
        admin: '00000000-0000-0000-0000-000000000001',
        geo: '00000000-0000-0000-0000-000000000002',
        maintenance: '00000000-0000-0000-0000-000000000003',
        subjects: '00000000-0000-0000-0000-000000000004',
        gemini: '00000000-0000-0000-0000-000000000005',
        aiIps: '00000000-0000-0000-0000-000000000006'
    };
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
    const TYPE_LABELS = { mcq: 'Trắc nghiệm 4 lựa chọn', tf_group: 'Đúng / Sai', short_answer: 'Trả lời ngắn' };
    const AI_TYPE_LABELS = { multiple_choice: 'Trắc nghiệm 4 lựa chọn', true_false: 'Đúng / Sai', short_answer: 'Trả lời ngắn' };
    const state = {
        client: null, clientIp: '', questions: [], grade: 'all', subject: 'all', typeFilter: 'all',
        type: 'mcq', answer: 0, tfAnswers: [true, true, true, true], editingId: null,
        importQuestions: [], importIndex: 0, importSubject: 'history', sourceText: '',
        adminConfig: { masterIp: '', allowedIps: [] }, aiIps: [], geo: { mode: 'PUBLIC', ips: [], grade5Ips: [] },
        subjects: [], maintenance: { isActive: false, message: '' }, bound: false,
        importIntegrity: { valid: true, errors: [] }
    };
    const $ = (id) => document.getElementById(id);
    const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
    const htmlText = (value, fallback = '') => esc(value || fallback).replace(/\r?\n/g, '<br>');
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const parseBool = (value) => value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
    const cleanGeminiKey = (value) => String(value || '').trim().replace(/^Bearer\s+/i, '').replace(/^['"]|['"]$/g, '').trim();
    const isValidGeminiKey = (value) => {
        const key = cleanGeminiKey(value);
        return Boolean(key && (/^(AIza[\w-]{20,}|AQ\.[\w.-]{20,})$/i.test(key) || key.length >= 20));
    };
    const subjectName = (key) => {
        const builtIn = Object.values(SUBJECTS).flat().find((item) => item.key === key);
        const dynamic = state.subjects.find((item) => item.key === key || item.subject_key === key);
        return builtIn?.name || dynamic?.name || dynamic?.title || key || 'Chưa chọn môn';
    };
    const allSubjects = () => state.subjects
        .map((item) => ({ key: item.key || item.subject_key, name: item.name || item.title || item.key }))
        .filter((item) => item.key);
    const gradeOf = (q) => {
        const key = String(q.subject_key || q.subjectKey || q.key || '').toLowerCase();
        if (Object.values(SUBJECTS[5]).some((item) => item.key.toLowerCase() === key) || /5$/.test(key)) return '5';
        return '11';
    };
    const notify = (message, error = false) => {
        const toast = $('toast');
        if (!toast) return;
        toast.textContent = message;
        toast.className = `toast show${error ? ' error' : ''}`;
        clearTimeout(notify.timer);
        notify.timer = setTimeout(() => { toast.className = 'toast'; }, 3400);
    };

    function setConnection(ready, message) {
        const el = $('connection-status');
        if (!el) return;
        el.className = `connection-status${ready ? ' is-ready' : ''}`;
        el.innerHTML = `<i class="fa-solid ${ready ? 'fa-cloud-check' : 'fa-triangle-exclamation'}"></i> ${esc(message)}`;
    }

    async function getClientIp() {
        const endpoints = ['https://api.ipify.org?format=json', 'https://ipapi.co/json/'];
        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint, { signal: AbortSignal.timeout(4000) });
                const data = await response.json();
                if (data?.ip) return String(data.ip).trim();
            } catch (error) { /* Use the fallback provider. */ }
        }
        return '';
    }

    async function systemRow(id) {
        const { data, error } = await state.client.from('quiz_logins').select('*').eq('id', id).limit(1);
        if (error || !data?.[0]) return null;
        return data[0];
    }

    async function isCurrentIpAllowed() {
        state.clientIp = await getClientIp();
        if ($('current-ip')) $('current-ip').textContent = state.clientIp || 'Không xác định IP';
        if ($('access-current-ip')) $('access-current-ip').textContent = state.clientIp || 'Không xác định IP';
        const row = await systemRow(SYSTEM.admin);
        if (!row) return false;
        try {
            const config = JSON.parse(row.score_summary || '{}');
            state.adminConfig = {
                masterIp: String(config.masterIp || '').trim(),
                allowedIps: Array.isArray(config.allowedIps) ? config.allowedIps : (Array.isArray(config.ips) ? config.ips.map((ip) => ({ ip, name: 'Admin' })) : [])
            };
            const ips = state.adminConfig.allowedIps.map((item) => typeof item === 'string' ? item : item?.ip).filter(Boolean).map(String);
            return Boolean(state.clientIp && (state.clientIp === state.adminConfig.masterIp || ips.includes(state.clientIp)));
        } catch (error) { return false; }
    }

    function denyAccess() {
        $('app-shell')?.classList.add('hidden');
        $('access-denied')?.classList.remove('hidden');
    }

    function showApp() {
        $('access-denied')?.classList.add('hidden');
        $('app-shell')?.classList.remove('hidden');
    }

    function injectEditorControls() {
        const form = $('question-form');
        if (!form || $('question-type-select')) return;
        const questionLabel = $('question-input')?.closest('label');
        const explanationLabel = $('explanation-input')?.closest('label');
        if (!questionLabel || !explanationLabel) return;
        const typeLabel = document.createElement('label');
        typeLabel.innerHTML = 'Loại câu hỏi<select id="question-type-select" required><option value="mcq">Trắc nghiệm 4 lựa chọn</option><option value="tf_group">Trắc nghiệm Đúng / Sai</option><option value="short_answer">Trả lời ngắn</option></select>';
        questionLabel.before(typeLabel);
        const typeEditor = document.createElement('div');
        typeEditor.id = 'dynamic-type-editor';
        typeEditor.innerHTML = '<div id="tf-editor" class="hidden"></div><div id="short-editor" class="hidden"></div>';
        explanationLabel.before(typeEditor);
        const importModal = $('import-modal');
        if (importModal && !$('ai-analyze-import')) {
            const actions = importModal.querySelector('.modal-actions');
            const aiButton = document.createElement('button');
            aiButton.id = 'ai-analyze-import';
            aiButton.className = 'button button-purple';
            aiButton.type = 'button';
            aiButton.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Gemini phân tích & giải';
            actions?.insertBefore(aiButton, $('save-import'));
        }
        const file = $('import-file');
        if (file) file.accept = '.docx,.pdf,.json,.csv,.xlsx,.xls,.txt';
        injectGeminiControls();
        injectAdminStyles();
    }

    function injectGeminiControls() {
        if ($('test-gemini-key')) return;
        const saveButton = $('save-gemini-key');
        if (!saveButton) return;
        const testButton = document.createElement('button');
        testButton.id = 'test-gemini-key';
        testButton.type = 'button';
        testButton.className = 'button button-info';
        testButton.innerHTML = '<i class="fa-solid fa-plug"></i> Kiểm tra key';
        saveButton.parentElement?.insertBefore(testButton, saveButton.nextSibling);
        const status = document.createElement('span');
        status.id = 'gemini-key-status';
        status.className = 'info-badge';
        status.textContent = 'Chưa kiểm tra';
        saveButton.parentElement?.appendChild(status);
    }

    function injectAdminStyles() {
        if ($('question-type-runtime-style')) return;
        const style = document.createElement('style');
        style.id = 'question-type-runtime-style';
        style.textContent = `
            #dynamic-type-editor{margin-bottom:14px}.type-note,.field-note{font-size:10px;color:var(--muted);line-height:1.5;margin:5px 0 12px}.field-note i{color:var(--primary);margin-right:4px}.tf-editor-grid{display:grid;gap:8px}.tf-answer-field{display:grid;grid-template-columns:20px minmax(0,1fr) auto auto;gap:6px;align-items:center;margin:0}.tf-answer-field>b{color:var(--primary);font-size:12px}.tf-answer-field input{margin:0}.tf-choice{border:1px solid var(--line);background:var(--surface-2);color:var(--muted);border-radius:8px;padding:7px 8px;font-size:10px;font-weight:700}.tf-choice.is-selected[data-value="true"]{color:#078256;background:#def9eb;border-color:#86efac}.tf-choice.is-selected[data-value="false"]{color:#d73840;background:#ffe7e8;border-color:#fca5a5}.type-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 7px;border-radius:7px;font-size:9px;font-weight:800;background:#eeedff;color:var(--primary)}.type-chip.tf{background:#fff0e5;color:#bd6310}.type-chip.short{background:#def9eb;color:#078256}.tf-preview-list{display:grid;gap:8px}.tf-preview-row{display:grid;grid-template-columns:25px minmax(0,1fr) auto;gap:8px;align-items:start;padding:9px;border:1px solid #e1e5f0;background:#fff;border-radius:10px;font-size:11px}.tf-preview-row>b{color:var(--primary)}.tf-preview-answer{font-size:9px;font-weight:800;padding:4px 6px;border-radius:6px;background:#def9eb;color:#078256}.tf-preview-answer.false{background:#ffe7e8;color:#d73840}.short-preview-input{width:100%;border:1px dashed #bdb7ff;background:#fff;border-radius:10px;padding:12px;color:#8994a8;font-size:11px}.ai-review{margin-top:14px;border-top:1px solid var(--line);padding-top:14px}.ai-review-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.ai-review-list{display:flex;gap:5px;overflow:auto;padding:10px 0}.ai-review-index{border:1px solid var(--line);background:var(--surface-2);border-radius:7px;padding:6px 8px;font-size:10px;font-weight:800;color:var(--muted)}.ai-review-index.is-active{background:var(--primary);color:#fff;border-color:var(--primary)}.ai-review-question{border:1px solid var(--line);border-radius:12px;background:var(--surface-2);padding:12px;font-size:11px;line-height:1.55}.strict-warning{display:flex;gap:7px;padding:9px;border:1px solid #f8db8b;background:#fff9e8;color:#9a6400;border-radius:9px;font-size:10px;line-height:1.45;margin-top:10px}.question-item .item-statements{display:grid;gap:4px;margin-top:5px}.question-item .item-statement{font-size:10px;color:var(--muted);padding:5px 7px;background:var(--surface-2);border-radius:6px}.question-item .item-statement b{color:var(--primary);margin-right:4px}.type-filter-note{font-size:10px;color:var(--muted)}
        `;
        document.head.appendChild(style);
    }

    function fillSubjects(grade, selected) {
        const options = allSubjects().filter((item) => gradeOf(item) === String(grade));
        const select = $('subject-select');
        if (!select) return;
        select.innerHTML = options.map((item) => `<option value="${esc(item.key)}">${esc(item.name)}</option>`).join('');
        if (selected && options.some((item) => item.key === selected)) select.value = selected;
    }

    function fillLibrarySubjects() {
        const list = state.grade === 'all' ? allSubjects() : allSubjects().filter((item) => gradeOf(item) === String(state.grade));
        if (!list.some((item) => item.key === state.subject)) state.subject = 'all';
        if ($('library-subject-filter')) {
            $('library-subject-filter').innerHTML = '<option value="all">Tất cả môn học</option>' + list.map((item) => `<option value="${esc(item.key)}">${esc(item.name)}</option>`).join('');
            $('library-subject-filter').value = state.subject;
        }
        if ($('import-subject-select')) {
            $('import-subject-select').innerHTML = allSubjects().map((item) => `<option value="${esc(item.key)}">${esc(item.name)}</option>`).join('');
            $('import-subject-select').value = state.importSubject;
        }
        if ($('leaderboard-subject')) $('leaderboard-subject').innerHTML = '<option value="">Tất cả môn</option>' + allSubjects().map((item) => `<option value="${esc(item.key)}">${esc(item.name)}</option>`).join('');
    }

    function ensureTypeEditor(type = state.type) {
        state.type = type || 'mcq';
        const select = $('question-type-select');
        if (select) select.value = state.type;
        const mcqParts = document.querySelectorAll('#question-form > .options-heading, #question-form > .answers-grid');
        mcqParts.forEach((element) => element.classList.toggle('hidden', state.type !== 'mcq'));
        [0, 1, 2, 3].forEach((index) => {
            const input = $(`option-${index}`);
            if (input) input.required = state.type === 'mcq';
        });
        const tf = $('tf-editor');
        const short = $('short-editor');
        if (tf) tf.classList.toggle('hidden', state.type !== 'tf_group');
        if (short) short.classList.toggle('hidden', state.type !== 'short_answer');
        document.querySelectorAll('#tf-editor input[id^="tf-"]').forEach((input) => { input.required = state.type === 'tf_group'; });
        if ($('correct-value-input')) $('correct-value-input').required = state.type === 'short_answer';
        if (state.type === 'tf_group' && tf) {
            tf.innerHTML = `<div class="options-heading"><label>4 ý Đúng / Sai</label><span>Giữ nguyên thứ tự a, b, c, d</span></div><p class="type-note">Mỗi ý có một đáp án Đúng hoặc Sai. Nội dung không được tự động viết lại.</p><div class="tf-editor-grid">${[0, 1, 2, 3].map((index) => `<div class="tf-answer-field"><b>${'abcd'[index]}</b><input id="tf-${index}" placeholder="Nội dung ý ${'abcd'[index]}"><button type="button" class="tf-choice ${state.tfAnswers[index] ? 'is-selected' : ''}" data-index="${index}" data-value="true">Đúng</button><button type="button" class="tf-choice ${!state.tfAnswers[index] ? 'is-selected' : ''}" data-index="${index}" data-value="false">Sai</button></div>`).join('')}</div>`;
            [0, 1, 2, 3].forEach((index) => { $(`tf-${index}`).required = true; });
        }
        if (state.type === 'short_answer' && short) {
            short.innerHTML = '<label>Đáp án chính xác<input id="correct-value-input" placeholder="Ví dụ: 16.9 hoặc từ khóa chính xác"></label><p class="field-note"><i class="fa-solid fa-circle-info"></i> Đáp án được lưu nguyên văn để hỗ trợ số, đơn vị và từ khóa.</p>';
            $('correct-value-input').required = true;
        }
        renderPreview();
    }

    function readQuestion() {
        const q = {
            subject_key: $('subject-select')?.value || state.importSubject,
            category: $('category-input')?.value || 'Ôn tập',
            q_type: state.type,
            question: $('question-input')?.value || '',
            options: [], statements: [], correct: 0, answer: 0,
            correct_value: $('correct-value-input')?.value || '', explanation: $('explanation-input')?.value || '',
            qType: state.type, correctValue: $('correct-value-input')?.value || ''
        };
        if (state.type === 'mcq') {
            q.options = [0, 1, 2, 3].map((index) => $(`option-${index}`)?.value || '');
            q.correct = state.answer; q.answer = state.answer;
        } else if (state.type === 'tf_group') {
            q.statements = [0, 1, 2, 3].map((index) => ({ key: 'abcd'[index], label: 'abcd'[index], text: $(`tf-${index}`)?.value || '', answer: Boolean(state.tfAnswers[index]) }));
        }
        return q;
    }

    function renderPreview() {
        const card = $('preview-card');
        if (!card) return;
        const q = readQuestion();
        let body = '';
        if (state.type === 'tf_group') {
            body = `<div class="tf-preview-list">${q.statements.map((statement, index) => `<div class="tf-preview-row"><b>${statement.key}</b><span>${htmlText(statement.text, `Nội dung ý ${statement.key}`)}</span><span class="tf-preview-answer ${statement.answer ? '' : 'false'}">${statement.answer ? 'ĐÚNG' : 'SAI'}</span></div>`).join('')}</div>`;
        } else if (state.type === 'short_answer') {
            body = '<div class="short-preview-input">Nhập câu trả lời ngắn tại đây...</div>';
        } else {
            body = `<div>${q.options.map((option, index) => `<div class="preview-option ${index === state.answer ? 'is-correct' : ''}"><b>${'ABCD'[index]}</b><span>${htmlText(option, `Phương án ${'ABCD'[index]}`)}</span></div>`).join('')}</div>`;
        }
        card.innerHTML = `<div class="preview-meta"><span>${esc(TYPE_LABELS[state.type].toUpperCase())}</span><span>${esc(subjectName(q.subject_key))}</span></div><h3>${htmlText(q.question, 'Nội dung câu hỏi sẽ hiển thị ở đây')}</h3>${body}`;
    }

    function setAnswer(index) {
        state.answer = Number(index);
        document.querySelectorAll('.answer-radio').forEach((button) => {
            const active = Number(button.dataset.answer) === state.answer;
            button.classList.toggle('is-selected', active);
            button.innerHTML = `<i class="fa-${active ? 'solid fa-circle-dot' : 'regular fa-circle'}"></i>`;
        });
        renderPreview();
    }

    function setTfAnswer(index, value) {
        state.tfAnswers[Number(index)] = value === 'true';
        document.querySelectorAll(`.tf-choice[data-index="${index}"]`).forEach((button) => button.classList.toggle('is-selected', button.dataset.value === value));
        renderPreview();
    }

    function normalizeRow(row) {
        const qType = row.q_type || row.qType || 'mcq';
        const statements = Array.isArray(row.statements) ? row.statements.map((item, index) => ({ key: item.key || item.id || 'abcd'[index], label: item.label || item.key || 'abcd'[index], text: item.text ?? item.content ?? '', answer: parseBool(item.answer ?? item.correctAnswer) })) : [];
        return { ...row, subjectKey: row.subject_key, qType, q_type: qType, options: Array.isArray(row.options) ? row.options : [], statements, correct: Number(row.correct ?? row.answer ?? 0), answer: Number(row.answer ?? row.correct ?? 0), correctValue: row.correct_value ?? row.correctValue ?? '', explanation: row.explanation || '' };
    }

    async function loadQuestions() {
        try {
            const { data, error } = await state.client.from('quiz_questions').select('*').order('id', { ascending: true });
            if (error) throw error;
            state.questions = (data || []).map(normalizeRow);
            setConnection(true, 'Đã đồng bộ');
            $('last-sync') && ($('last-sync').textContent = `Đồng bộ lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`);
            renderStats(); renderLibrary(); renderRecentActivity();
            $('health-database') && ($('health-database').textContent = 'Supabase đang hoạt động');
            $('health-database-badge') && ($('health-database-badge').textContent = 'Ổn định');
            $('health-database-badge')?.classList.replace('pending', 'safe');
            $('health-content') && ($('health-content').textContent = `${state.questions.length} câu hỏi đã tải`);
            $('health-content-badge') && ($('health-content-badge').textContent = 'Đã tải');
            $('health-content-badge')?.classList.replace('pending', 'safe');
        } catch (error) {
            setConnection(false, 'Không thể kết nối');
            notify(`Lỗi tải câu hỏi: ${error.message}`, true);
        }
    }

    function animateMetricValue(id, target) {
        const element = $(id);
        if (!element) return;

        const value = Math.max(0, Number(target) || 0);
        const previous = Number(element.dataset.metricValue || 0);
        element.dataset.metricValue = String(value);

        if (previous === value || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            element.textContent = String(value);
            return;
        }

        cancelAnimationFrame(element.metricAnimationFrame);
        const startedAt = performance.now();
        const duration = 650;
        const tick = (now) => {
            const progress = Math.min((now - startedAt) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            element.textContent = String(Math.round(previous + (value - previous) * eased));
            if (progress < 1) element.metricAnimationFrame = requestAnimationFrame(tick);
        };
        element.metricAnimationFrame = requestAnimationFrame(tick);
    }

    function renderStats() {
        const grade5 = state.questions.filter((q) => gradeOf(q) === '5').length;
        const grade11 = state.questions.length - grade5;
        animateMetricValue('stat-total', state.questions.length);
        animateMetricValue('stat-grade5', grade5);
        animateMetricValue('stat-grade11', grade11);
        $('nav-question-count') && ($('nav-question-count').textContent = state.questions.length);
    }

    function typeChip(q) {
        const type = q.qType || 'mcq';
        return `<span class="type-chip ${type === 'tf_group' ? 'tf' : type === 'short_answer' ? 'short' : ''}">${esc(TYPE_LABELS[type] || type)}</span>`;
    }

    function renderLibrary() {
        const keyword = ($('search-input')?.value || '').toLowerCase();
        const rows = state.questions.filter((q) => {
            const typeMatch = state.typeFilter === 'all' || (state.typeFilter === 'mcq' && q.qType === 'mcq') || (state.typeFilter === 'tf_group' && q.qType === 'tf_group') || (state.typeFilter === 'short_answer' && q.qType === 'short_answer');
            const text = `${q.question} ${q.explanation} ${(q.options || []).join(' ')} ${(q.statements || []).map((s) => s.text).join(' ')}`.toLowerCase();
            return (state.grade === 'all' || gradeOf(q) === state.grade) && (state.subject === 'all' || q.subject_key === state.subject) && typeMatch && (!keyword || text.includes(keyword));
        });
        $('library-count') && ($('library-count').textContent = rows.length);
        $('result-summary') && ($('result-summary').textContent = `${rows.length} kết quả`);
        $('empty-state')?.classList.toggle('hidden', rows.length !== 0);
        const list = $('questions-list');
        if (!list) return;
        list.innerHTML = rows.map((q) => {
            const grade = gradeOf(q);
            let answerPreview = '';
            if (q.qType === 'tf_group') answerPreview = `<div class="item-statements">${q.statements.map((s) => `<div class="item-statement"><b>${esc(s.key)}.</b>${esc(s.text)} <strong>${s.answer ? 'Đúng' : 'Sai'}</strong></div>`).join('')}</div>`;
            else if (q.qType === 'short_answer') answerPreview = `<div class="item-option is-correct">Đáp án: ${esc(q.correctValue)}</div>`;
            else answerPreview = `<div class="item-options">${q.options.slice(0, 4).map((option, index) => `<span class="item-option ${index === q.correct ? 'is-correct' : ''}"><b>${'ABCD'[index]}.</b> ${esc(option)}</span>`).join('')}</div>`;
            return `<article class="question-item"><div class="question-item-head"><div class="question-tags"><span class="tag ${grade === '5' ? 'grade5' : 'grade11'}">Lớp ${grade}</span><span class="tag">${esc(subjectName(q.subject_key))}</span>${typeChip(q)}</div><span class="tag">#${esc(q.id)}</span></div><h3>${htmlText(q.question)}</h3>${answerPreview}<div class="question-item-footer"><small>${esc(q.category || 'Ôn tập')}</small><div class="item-actions"><button class="edit-button" data-edit="${esc(q.id)}"><i class="fa-solid fa-pen"></i> Sửa</button><button class="delete-button" data-delete="${esc(q.id)}"><i class="fa-solid fa-trash"></i> Xóa</button></div></div></article>`;
        }).join('');
    }

    function renderRecentActivity() {
        const list = $('recent-activity');
        if (!list) return;
        const rows = state.questions.slice(-5).reverse();
        list.innerHTML = rows.length ? rows.map((q) => `<div class="activity-item"><i class="fa-solid ${q.qType === 'tf_group' ? 'fa-list-check' : q.qType === 'short_answer' ? 'fa-keyboard' : 'fa-list-radio'}"></i><span><b>${esc(TYPE_LABELS[q.qType] || 'Câu hỏi')} · ${esc(subjectName(q.subject_key))}</b><small>${htmlText(q.question).slice(0, 90)}${String(q.question).length > 90 ? '...' : ''}</small></span></div>`).join('') : '<div class="empty-state"><p>Chưa có hoạt động.</p></div>';
    }

    function resetForm() {
        state.editingId = null; state.type = 'mcq'; state.answer = 0; state.tfAnswers = [true, true, true, true];
        $('question-form')?.reset();
        $('form-title') && ($('form-title').textContent = 'Thêm câu hỏi mới');
        $('submit-label') && ($('submit-label').textContent = 'Lưu câu hỏi');
        $('question-id') && ($('question-id').value = '');
        $('cancel-edit')?.classList.add('hidden');
        if ($('grade-select')) $('grade-select').value = '11';
        fillSubjects('11'); ensureTypeEditor('mcq'); setAnswer(0); renderPreview();
    }

    function fillForm(q) {
        const normalized = normalizeAiQuestion(q);
        const grade = gradeOf(normalized);
        state.editingId = normalized.id || null;
        state.type = normalized.qType;
        $('question-id') && ($('question-id').value = normalized.id || '');
        $('form-title') && ($('form-title').textContent = normalized.id ? `Sửa câu hỏi #${normalized.id}` : 'Duyệt câu hỏi từ AI');
        $('submit-label') && ($('submit-label').textContent = normalized.id ? 'Cập nhật câu hỏi' : 'Lưu câu hỏi');
        $('cancel-edit')?.classList.toggle('hidden', !normalized.id);
        if ($('grade-select')) $('grade-select').value = grade;
        fillSubjects(grade, normalized.subject_key || state.importSubject);
        if ($('category-input')) $('category-input').value = normalized.category || '';
        if ($('question-input')) $('question-input').value = normalized.question || '';
        if ($('explanation-input')) $('explanation-input').value = normalized.explanation || '';
        [0, 1, 2, 3].forEach((index) => { if ($(`option-${index}`)) $(`option-${index}`).value = normalized.options?.[index] || ''; });
        state.answer = Number(normalized.correctAnswer ?? normalized.correct ?? 0);
        state.tfAnswers = (normalized.statements || []).map((item) => parseBool(item.answer ?? item.correctAnswer));
        while (state.tfAnswers.length < 4) state.tfAnswers.push(true);
        ensureTypeEditor(normalized.qType); setAnswer(state.answer);
        if (normalized.qType === 'tf_group') normalized.statements.forEach((item, index) => { if ($(`tf-${index}`)) $(`tf-${index}`).value = item.text || ''; });
        if (normalized.qType === 'short_answer' && $('correct-value-input')) $('correct-value-input').value = normalized.correctValue || '';
        renderPreview();
    }

    function normalizeAiQuestion(raw) {
        const type = raw?.type === 'multiple_choice' ? 'mcq' : raw?.type === 'true_false' ? 'tf_group' : (raw?.type || raw?.q_type || raw?.qType || 'mcq');
        if (type === 'tf_group') {
            return { ...raw, qType: 'tf_group', q_type: 'tf_group', question: raw?.question ?? '', statements: Array.isArray(raw?.subQuestions) ? raw.subQuestions.map((item, index) => ({ key: item.id || 'abcd'[index], label: item.id || 'abcd'[index], text: item.content ?? '', answer: parseBool(item.correctAnswer) })) : (raw?.statements || []), options: [], explanation: raw?.explanation ?? '' };
        }
        if (type === 'short_answer') return { ...raw, qType: 'short_answer', q_type: 'short_answer', question: raw?.question ?? '', options: [], statements: [], correctValue: raw?.correctAnswer ?? raw?.correct_value ?? raw?.correctValue ?? '', explanation: raw?.explanation ?? '' };
        return { ...raw, qType: 'mcq', q_type: 'mcq', question: raw?.question ?? '', options: Array.isArray(raw?.options) ? raw.options : [], statements: [], correct: Number(raw?.correctAnswer ?? raw?.correct ?? raw?.answer ?? 0), correctAnswer: Number(raw?.correctAnswer ?? raw?.correct ?? raw?.answer ?? 0), explanation: raw?.explanation ?? '' };
    }

    function toRecord(q, subjectKey, id) {
        const normalized = normalizeAiQuestion(q);
        const record = {
            ...(id ? { id: Number(id) } : {}), subject_key: subjectKey || normalized.subject_key || 'history', category: normalized.category || 'Bài tập',
            q_type: normalized.qType, question: normalized.question, options: normalized.qType === 'mcq' ? normalized.options : [],
            statements: normalized.qType === 'tf_group' ? normalized.statements.map((item, index) => ({ key: item.key || 'abcd'[index], label: item.label || item.key || 'abcd'[index], text: item.text ?? item.content ?? '', answer: parseBool(item.answer ?? item.correctAnswer) })) : [],
            correct: normalized.qType === 'mcq' ? Number(normalized.correctAnswer ?? normalized.correct ?? 0) : 0,
            answer: normalized.qType === 'mcq' ? Number(normalized.correctAnswer ?? normalized.correct ?? 0) : 0,
            correct_value: normalized.qType === 'short_answer' ? String(normalized.correctValue ?? normalized.correctAnswer ?? '') : '',
            explanation: normalized.explanation ?? '', image_url: normalized.image_url || normalized.imageUrl || '', updated_at: new Date().toISOString()
        };
        return record;
    }

    async function nextQuestionId() {
        const { data } = await state.client.from('quiz_questions').select('id').order('id', { ascending: false }).limit(1);
        return Number(data?.[0]?.id || 0) + 1;
    }

    async function saveQuestion(event) {
        event?.preventDefault();
        const q = readQuestion();
        const valid = q.question.length > 0 && ((q.q_type === 'mcq' && q.options.every((item) => item.trim().length > 0)) || (q.q_type === 'tf_group' && q.statements.every((item) => item.text.trim().length > 0)) || (q.q_type === 'short_answer' && q.correct_value.length > 0));
        if (!valid) return notify('Vui lòng nhập đủ nội dung theo loại câu hỏi.', true);
        try {
            const id = state.editingId || await nextQuestionId();
            const { error } = await state.client.from('quiz_questions').upsert(toRecord(q, q.subject_key, id)).select();
            if (error) throw error;
            notify(state.editingId ? 'Đã cập nhật câu hỏi.' : 'Đã thêm câu hỏi.');
            resetForm(); await loadQuestions();
        } catch (error) { notify(`Không thể lưu: ${error.message}`, true); }
    }

    async function deleteQuestion(id) {
        if (!window.confirm(`Xóa câu hỏi #${id}? Hành động này không thể hoàn tác.`)) return;
        const { error } = await state.client.from('quiz_questions').delete().eq('id', id);
        if (error) return notify(`Không thể xóa: ${error.message}`, true);
        notify('Đã xóa câu hỏi.'); if (String(state.editingId) === String(id)) resetForm(); await loadQuestions();
    }

    async function extractFile(file) {
        const name = file.name.toLowerCase();
        if (name.endsWith('.docx')) {
            if (!window.mammoth) throw new Error('Chưa tải được bộ đọc Word.');
            const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
            return result.value;
        }
        if (name.endsWith('.pdf')) {
            if (!window.pdfjsLib) throw new Error('Chưa tải được bộ đọc PDF.');
            const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
            const pages = [];
            if (window.pdfjsLib.GlobalWorkerOptions) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
                const page = await pdf.getPage(pageNumber);
                const content = await page.getTextContent();
                pages.push(content.items.map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`).join('').trim());
            }
            return pages.join('\n');
        }
        if (/\.(xlsx|xls)$/.test(name)) {
            if (!window.XLSX) throw new Error('Chưa tải được bộ đọc Excel.');
            const book = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
            return book.SheetNames.map((sheet) => window.XLSX.utils.sheet_to_csv(book.Sheets[sheet])).join('\n');
        }
        return file.text();
    }

    function openModal(id) { $(id)?.classList.remove('hidden'); }
    function closeModal(id) { $(id)?.classList.add('hidden'); }

    function openImport() {
        state.importQuestions = []; state.importIndex = 0; state.sourceText = '';
        if ($('import-text')) $('import-text').value = '';
        if ($('import-preview')) $('import-preview').innerHTML = '<p class="muted-copy">Chọn DOCX/PDF hoặc dán đề, sau đó bấm “Gemini phân tích & giải”.</p>';
        fillLibrarySubjects(); switchView('questions'); openModal('import-modal');
    }

    function parseJsonInput(text) {
        try {
            const parsed = JSON.parse(text);
            const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.questions) ? parsed.questions : [parsed]);
            const normalized = list.map(normalizeAiQuestion);
            state.importIntegrity = validateVerbatimQuestions(normalized, text);
            return normalized;
        } catch (error) { return []; }
    }

    function renderImportReview() {
        const root = $('import-preview');
        if (!root) return;
        if (!state.importQuestions.length) { root.innerHTML = '<p class="muted-copy">Chưa có kết quả phân tích.</p>'; return; }
        const q = normalizeAiQuestion(state.importQuestions[state.importIndex]);
        const type = AI_TYPE_LABELS[q.type] || TYPE_LABELS[q.qType] || TYPE_LABELS.mcq;
        const detail = q.qType === 'tf_group' ? q.statements.map((item) => `<div class="tf-preview-row"><b>${esc(item.key)}</b><span>${htmlText(item.text)}</span><span class="tf-preview-answer ${item.answer ? '' : 'false'}">${item.answer ? 'ĐÚNG' : 'SAI'}</span></div>`).join('') : q.qType === 'short_answer' ? `<div class="item-option is-correct">Đáp án: ${esc(q.correctValue)}</div>` : q.options.map((item, index) => `<div class="preview-option ${index === q.correct ? 'is-correct' : ''}"><b>${'ABCD'[index]}</b><span>${htmlText(item)}</span></div>`).join('');
        const integrity = state.importIntegrity.valid ? '<div class="strict-warning"><i class="fa-solid fa-lock"></i><span>Strict mode: văn bản và thứ tự được hiển thị đúng theo phản hồi JSON của Gemini. Hãy duyệt từng câu trước khi lưu.</span></div>' : `<div class="strict-warning" style="border-color:#fca5a5;background:#fff0f0;color:#b91c1c"><i class="fa-solid fa-triangle-exclamation"></i><span>Không thể xác minh nguyên văn một số trường: ${esc(state.importIntegrity.errors.join(' | '))}. Hệ thống sẽ không cho lưu cho tới khi phân tích lại với văn bản nguồn.</span></div>`;
        root.innerHTML = `<div class="ai-review"><div class="ai-review-toolbar"><b>Đã phân tích ${state.importIndex + 1}/${state.importQuestions.length} câu · ${esc(type)}</b><div><button type="button" class="button button-secondary compact" data-import-prev ${state.importIndex === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button> <button type="button" class="button button-secondary compact" data-import-next ${state.importIndex === state.importQuestions.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div></div><div class="ai-review-list">${state.importQuestions.map((item, index) => `<button type="button" class="ai-review-index ${index === state.importIndex ? 'is-active' : ''}" data-import-index="${index}">Câu ${index + 1}</button>`).join('')}</div><div class="ai-review-question"><b>${htmlText(q.question)}</b><div style="margin-top:9px">${detail}</div><p class="muted-copy">${htmlText(q.explanation)}</p></div>${integrity}</div>`;
    }

    function validateVerbatimQuestions(questions, source) {
        if (!source) return { valid: true, errors: [] };
        const errors = [];
        const check = (value, label) => {
            if (value && !source.includes(value)) errors.push(label);
        };
        questions.forEach((raw, index) => {
            const q = normalizeAiQuestion(raw);
            check(q.question, `Câu ${index + 1}: câu hỏi`);
            if (q.qType === 'mcq') q.options.forEach((value, optionIndex) => check(value, `Câu ${index + 1}: phương án ${'ABCD'[optionIndex]}`));
            if (q.qType === 'tf_group') q.statements.forEach((value, statementIndex) => check(value.text ?? value.content, `Câu ${index + 1}: ý ${'abcd'[statementIndex]}`));
        });
        return { valid: errors.length === 0, errors };
    }

    async function analyzeWithGemini() {
        const source = $('import-text')?.value || state.sourceText;
        if (!source) return notify('Chưa có văn bản đề để phân tích.', true);
        const apiKey = await fetchGeminiKey();
        if (!apiKey) return notify('Chưa cấu hình Gemini API Key trong mục Báo cáo & dữ liệu.', true);
        const button = $('ai-analyze-import');
        if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gemini đang phân tích...'; }
        const schemaInstruction = `[
  { "type": "multiple_choice", "question": "Giữ nguyên 100% câu chữ đề bài", "options": ["Nội dung A", "Nội dung B", "Nội dung C", "Nội dung D"], "correctAnswer": 0, "explanation": "Giải thích chi tiết" },
  { "type": "true_false", "question": "Đoạn thông tin / ngữ liệu dẫn của đề bài", "subQuestions": [ { "id": "a", "content": "Nội dung ý a", "correctAnswer": true }, { "id": "b", "content": "Nội dung ý b", "correctAnswer": false }, { "id": "c", "content": "Nội dung ý c", "correctAnswer": true }, { "id": "d", "content": "Nội dung ý d", "correctAnswer": false } ], "explanation": "Giải thích chi tiết cho từng ý" },
  { "type": "short_answer", "question": "Nội dung câu hỏi tính toán hoặc điền từ", "correctAnswer": "Giá trị số hoặc từ khóa chính xác", "explanation": "Cách tính hoặc lý do" }
]`;
        const prompt = `Bạn là bộ phân tích đề thi. Trả về DUY NHẤT một mảng JSON hợp lệ, không markdown, không lời dẫn.\n\nSCHEMA BẮT BUỘC (mỗi phần tử chỉ dùng đúng một type):\n${schemaInstruction}\n\nSTRICT PRESERVATION RULES:\n1. Sao chép nguyên văn tuyệt đối câu hỏi, phương án và từng ý từ SOURCE. Không sửa chính tả, không chuẩn hóa dấu câu, không tóm tắt, không dịch, không viết lại, không bỏ ký hiệu, số, đơn vị, xuống dòng có ý nghĩa.\n2. Giữ nguyên thứ tự câu hỏi và giữ nguyên thứ tự A/B/C/D hoặc a/b/c/d. Không xáo trộn.\n3. Chỉ được tự suy luận correctAnswer và explanation để giải đáp; tuyệt đối không suy luận rồi sửa phần văn bản.\n4. Với multiple_choice, correctAnswer là số nguyên 0-3. Với true_false, luôn trả đủ bốn subQuestions theo đúng thứ tự a,b,c,d và correctAnswer là boolean. Với short_answer, correctAnswer là chuỗi đáp án chính xác.\n5. Nếu không chắc chắn, vẫn giữ nguyên văn bản và chọn đáp án tốt nhất theo kiến thức; không thêm câu chữ vào question/options/content.\n\nSOURCE (copy nguyên văn, không chỉnh sửa):\n<<<SOURCE_START>>>\n${source}\n<<<SOURCE_END>>>`;
        const models = ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.0-flash'];
        try {
            let response; let lastError = '';
            for (const model of models) {
                response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }) });
                if (response.ok) break;
                const errorData = await response.json().catch(() => ({}));
                lastError = errorData?.error?.message || `HTTP ${response.status}`;
                if (response.status === 400 || response.status === 401 || response.status === 403) break;
                await sleep(500);
            }
            if (!response?.ok) throw new Error(lastError || 'Gemini không phản hồi.');
            const data = await response.json();
            const raw = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
            const clean = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(clean);
            state.importQuestions = (Array.isArray(parsed) ? parsed : parsed.questions || []).map(normalizeAiQuestion);
            state.importIndex = 0;
            state.importIntegrity = validateVerbatimQuestions(state.importQuestions, source);
            if (state.importQuestions.length) fillForm(state.importQuestions[0]);
            renderImportReview();
            notify(`Gemini đã phân tích ${state.importQuestions.length} câu. Hãy duyệt trước khi lưu.`);
        } catch (error) {
            const detail = /api key|api_key|invalid argument|permission denied/i.test(error.message)
                ? 'Gemini API Key không hợp lệ hoặc đã hết hạn. Vào Báo cáo & dữ liệu, xóa key cũ, nhập key mới rồi bấm Kiểm tra key.'
                : error.message;
            notify(`AI phân tích thất bại: ${detail}`, true);
        }
        finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Gemini phân tích & giải';
            }
        }
    }

    async function saveImportQuestions() {
        if (!state.importQuestions.length) return notify('Chưa có câu hỏi AI để lưu.', true);
        if (!state.importIntegrity.valid) return notify('Không lưu vì AI đã làm thay đổi văn bản nguồn. Hãy phân tích lại hoặc kiểm tra từng câu.', true);
        if ($('import-replace')?.checked && !window.confirm('Xóa toàn bộ câu hỏi cũ của môn này trước khi nạp?')) return;
        try {
            if ($('import-replace')?.checked) {
                const { error } = await state.client.from('quiz_questions').delete().eq('subject_key', state.importSubject);
                if (error) throw error;
            }
            let id = await nextQuestionId();
            const records = state.importQuestions.map((item) => toRecord(item, state.importSubject, id++));
            for (let index = 0; index < records.length; index += 50) {
                const { error } = await state.client.from('quiz_questions').upsert(records.slice(index, index + 50));
                if (error) throw error;
            }
            notify(`Đã lưu ${records.length} câu hỏi, giữ nguyên thứ tự.`);
            closeModal('import-modal'); await loadQuestions();
        } catch (error) { notify(`Không thể lưu danh sách: ${error.message}`, true); }
    }

    async function handleImportFile(file) {
        if (!file) return;
        const input = $('import-file');
        const button = $('ai-analyze-import');
        if (input) input.disabled = true;
        if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-file-arrow-up fa-beat"></i> Đang đọc file...'; }
        try {
            state.sourceText = await extractFile(file);
            if (!state.sourceText.trim()) throw new Error('File không có lớp văn bản để đọc. Nếu là PDF scan ảnh, hãy OCR trước.');
            $('import-text').value = state.sourceText;
            notify(`Đã đọc ${file.name}. Gemini đang tự phân tích câu hỏi và đáp án...`);
            await analyzeWithGemini();
        } catch (error) {
            notify(`Không thể đọc hoặc phân tích file: ${error.message}`, true);
        } finally {
            if (input) input.disabled = false;
        }
    }

    async function fetchGeminiKey() {
        let key = localStorage.getItem('gemini_api_key') || '';
        const row = await systemRow(SYSTEM.gemini);
        if (row?.score_summary) { key = row.score_summary; localStorage.setItem('gemini_api_key', cleanGeminiKey(key)); }
        return cleanGeminiKey(key);
    }

    async function saveGeminiKey() {
        const key = cleanGeminiKey($('gemini-key-input')?.value);
        if (!key) return notify('Hãy nhập Gemini API Key.', true);
        if (!isValidGeminiKey(key)) return notify('API Key không đúng định dạng Google Gemini. Key thường bắt đầu bằng AIza hoặc AQ.', true);
        const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.gemini, player_name: '__GEMINI_CONFIG__', ip_address: 'SYSTEM', device_info: 'GEMINI_AI', status: 'ACTIVE', score_summary: key, last_active: new Date().toISOString() }, { onConflict: 'id' });
        if (error) return notify(`Không thể lưu API Key: ${error.message}`, true);
        localStorage.setItem('gemini_api_key', key); $('gemini-key-input').value = ''; notify('Đã lưu Gemini API Key lên Cloud.');
    }

    async function clearGeminiKey() {
        if (!window.confirm('Xóa Gemini API Key dùng chung?')) return;
        const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.gemini, player_name: '__GEMINI_CONFIG__', ip_address: 'SYSTEM', device_info: 'GEMINI_AI', status: 'INACTIVE', score_summary: '', last_active: new Date().toISOString() }, { onConflict: 'id' });
        if (error) return notify(error.message, true);
        localStorage.removeItem('gemini_api_key'); notify('Đã xóa Gemini API Key.');
    }

    async function testGeminiKey() {
        const key = await fetchGeminiKey();
        if (!key) return notify('Chưa có Gemini API Key để kiểm tra.', true);
        if (!isValidGeminiKey(key)) return notify('API Key không đúng định dạng. Key thường bắt đầu bằng AIza hoặc AQ...', true);
        const button = $('test-gemini-key');
        if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang kiểm tra'; }
        try {
            const testModels = ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview', 'gemini-2.5-flash'];
            let ok = false;
            let lastError = '';
            for (const model of testModels) {
                try {
                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply only with OK.' }] }], generationConfig: { temperature: 0, maxOutputTokens: 4 } })
                    });
                    if (response.ok) {
                        ok = true;
                        break;
                    }
                    const data = await response.json().catch(() => ({}));
                    lastError = data?.error?.message || `HTTP ${response.status}`;
                    if (response.status === 400 || response.status === 401 || response.status === 403) break;
                } catch (err) {
                    lastError = err.message;
                }
            }
            if (!ok) throw new Error(lastError || 'Không thể kết nối đến Gemini');
            notify('Gemini API Key hợp lệ và đang hoạt động.');
            if ($('gemini-key-status')) $('gemini-key-status').textContent = 'Key hợp lệ';
        } catch (error) {
            if ($('gemini-key-status')) $('gemini-key-status').textContent = 'Key không hợp lệ';
            notify(`Gemini API Key không hợp lệ: ${error.message}`, true);
        } finally {
            if (button) { button.disabled = false; button.innerHTML = '<i class="fa-solid fa-plug"></i> Kiểm tra key'; }
        }
    }

    function switchView(view) {
        const titles = { overview: 'Tổng quan', questions: 'Ngân hàng câu hỏi', students: 'Giám sát học sinh', access: 'Quyền truy cập', subjects: 'Môn học & quyền riêng tư', reports: 'Báo cáo & dữ liệu' };
        document.querySelectorAll('[data-view-panel]').forEach((panel) => {
            const isActive = panel.dataset.viewPanel === view;
            panel.classList.toggle('is-visible', isActive);
            panel.classList.remove('view-enter');
            if (isActive) requestAnimationFrame(() => panel.classList.add('view-enter'));
        });
        document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.view === view));
        $('view-title') && ($('view-title').textContent = titles[view] || view);
        $('sidebar')?.classList.remove('is-open');
    }

    async function loadMaintenance() {
        const row = await systemRow(SYSTEM.maintenance);
        if (row) state.maintenance = { isActive: row.status === 'ACTIVE' || row.device_info === 'ON', message: row.score_summary || 'Website đang mở công khai cho học sinh.' };
        const active = state.maintenance.isActive;
        if ($('maintenance-toggle')) $('maintenance-toggle').checked = active;
        if ($('maintenance-badge')) { $('maintenance-badge').textContent = active ? 'ĐANG BẬT' : 'ĐANG TẮT'; $('maintenance-badge').className = `status-badge ${active ? 'danger' : 'safe'}`; }
        if ($('maintenance-copy')) $('maintenance-copy').textContent = state.maintenance.message;
        if ($('health-maintenance')) $('health-maintenance').textContent = active ? 'Website đang tạm khóa' : 'Website đang mở';
        if ($('health-maintenance-badge')) { $('health-maintenance-badge').textContent = active ? 'Bật' : 'Tắt'; $('health-maintenance-badge').className = `status-badge ${active ? 'danger' : 'safe'}`; }
        $('maintenance-dot')?.classList.toggle('is-active', active); $('maintenance-mini-label') && ($('maintenance-mini-label').textContent = active ? 'Đang bảo trì' : 'Hệ thống đang mở'); $('maintenance-mini-message') && ($('maintenance-mini-message').textContent = active ? state.maintenance.message : 'Sẵn sàng phục vụ học sinh');
    }

    async function toggleMaintenance() {
        const active = Boolean($('maintenance-toggle')?.checked); let message = state.maintenance.message;
        if (active && !message) message = window.prompt('Lời nhắn khi bảo trì:', 'Trang web đang tạm dừng để cập nhật. Vui lòng quay lại sau!') || 'Trang web đang tạm dừng để cập nhật. Vui lòng quay lại sau!';
        const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.maintenance, player_name: '__SYSTEM_MAINTENANCE__', ip_address: 'SYSTEM', device_info: active ? 'ON' : 'OFF', status: active ? 'ACTIVE' : 'INACTIVE', score_summary: message || 'Website đang mở.', last_active: new Date().toISOString() }, { onConflict: 'id' });
        if (error) return notify(error.message, true);
        state.maintenance = { isActive: active, message }; await loadMaintenance(); notify(active ? 'Đã bật chế độ bảo trì.' : 'Đã mở lại website.');
    }

    async function loadAccess() {
        const row = await systemRow(SYSTEM.admin);
        if (row) { try { const data = JSON.parse(row.score_summary || '{}'); state.adminConfig = { masterIp: data.masterIp || '', allowedIps: data.allowedIps || [] }; } catch (error) {} }
        const aiRow = await systemRow(SYSTEM.aiIps);
        if (aiRow) { try { const data = JSON.parse(aiRow.score_summary || '[]'); state.aiIps = Array.isArray(data) ? data : data.ips || []; } catch (error) {} }
        renderAccess();
    }

    function renderAccess() {
        const allowed = state.adminConfig.allowedIps || [];
        $('admin-ip-count') && ($('admin-ip-count').textContent = allowed.length);
        $('admin-ip-list') && ($('admin-ip-list').innerHTML = allowed.map((item) => { const ip = typeof item === 'string' ? item : item.ip; const name = typeof item === 'string' ? 'Admin' : item.name || 'Admin'; return `<div class="stack-item"><span class="stack-item-icon"><i class="fa-solid fa-user-shield"></i></span><span class="stack-item-main"><b>${esc(ip)}</b><small>${esc(name)}</small></span>${ip === state.adminConfig.masterIp ? '<span class="tag">MASTER</span>' : `<button data-remove-admin="${esc(ip)}"><i class="fa-solid fa-xmark"></i></button>`}</div>`; }).join('') || '<p class="muted-copy">Chưa có IP phụ.</p>');
        $('ai-ip-count') && ($('ai-ip-count').textContent = state.aiIps.length);
        $('ai-ip-list') && ($('ai-ip-list').innerHTML = state.aiIps.map((item) => { const ip = typeof item === 'string' ? item : item.ip; const name = typeof item === 'string' ? 'AI learner' : item.name || 'AI learner'; return `<div class="stack-item"><span class="stack-item-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></span><span class="stack-item-main"><b>${esc(ip)}</b><small>${esc(name)}</small></span><button data-remove-ai="${esc(ip)}"><i class="fa-solid fa-xmark"></i></button></div>`; }).join('') || '<p class="muted-copy">Chưa cấp quyền AI.</p>');
    }

    async function saveAdminConfig() { const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.admin, player_name: '__ADMIN_IPS_CONFIG__', ip_address: 'SYSTEM', device_info: 'PASSWORDLESS_AUTH', status: 'ACTIVE', score_summary: JSON.stringify({ masterIp: state.adminConfig.masterIp, allowedIps: state.adminConfig.allowedIps, ips: state.adminConfig.allowedIps.map((item) => typeof item === 'string' ? item : item.ip) }), last_active: new Date().toISOString() }, { onConflict: 'id' }); if (error) throw error; }
    async function addAdminIp() { const ip = $('admin-ip-input')?.value.trim(); if (!ip) return notify('Nhập IP cần cấp quyền.', true); const found = state.adminConfig.allowedIps.find((item) => (typeof item === 'string' ? item : item.ip) === ip); if (!found) state.adminConfig.allowedIps.push({ ip, name: $('admin-ip-name')?.value.trim() || 'Admin', addedAt: new Date().toISOString() }); await saveAdminConfig(); $('admin-ip-input').value = ''; $('admin-ip-name').value = ''; renderAccess(); notify('Đã cấp quyền Admin cho IP.'); }
    async function removeAdminIp(ip) { if (ip === state.adminConfig.masterIp) return notify('Không thể xóa Master Admin.', true); state.adminConfig.allowedIps = state.adminConfig.allowedIps.filter((item) => (typeof item === 'string' ? item : item.ip) !== ip); await saveAdminConfig(); renderAccess(); notify('Đã thu hồi quyền Admin.'); }
    async function saveMasterIp() { if (!state.clientIp) return notify('Không xác định được IP hiện tại.', true); if (!state.adminConfig.allowedIps.some((item) => (typeof item === 'string' ? item : item.ip) === state.clientIp)) state.adminConfig.allowedIps.push({ ip: state.clientIp, name: 'Thiết bị Master', isMaster: true }); state.adminConfig.masterIp = state.clientIp; await saveAdminConfig(); renderAccess(); notify('Đã đặt IP hiện tại làm Master Admin.'); }
    async function saveAiIps() { const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.aiIps, player_name: '__AI_IPS_CONFIG__', ip_address: 'SYSTEM', device_info: 'AI_IP_WHITELIST', status: 'ACTIVE', score_summary: JSON.stringify(state.aiIps), last_active: new Date().toISOString() }, { onConflict: 'id' }); if (error) throw error; }
    async function addAiIp() { const ip = $('ai-ip-input')?.value.trim(); if (!ip) return notify('Nhập IP cần cấp AI.', true); if (!state.aiIps.some((item) => (typeof item === 'string' ? item : item.ip) === ip)) state.aiIps.push({ ip, name: $('ai-ip-name')?.value.trim() || 'AI learner' }); await saveAiIps(); $('ai-ip-input').value = ''; $('ai-ip-name').value = ''; renderAccess(); notify('Đã cấp quyền Trợ lý AI.'); }
    async function removeAiIp(ip) { state.aiIps = state.aiIps.filter((item) => (typeof item === 'string' ? item : item.ip) !== ip); await saveAiIps(); renderAccess(); notify('Đã thu hồi quyền AI.'); }

    function ensureClass5AccessPanel() {
        const grid = document.querySelector('[data-view-panel="subjects"] .geo-grid');
        if (!grid || document.getElementById('class5-ip-list')) return;
        grid.insertAdjacentHTML('beforeend', '<section class="panel class5-access-panel"><div class="panel-title"><div><p class="eyebrow">CLASS 5 ACCESS</p><h2>Quyền riêng Lớp 5</h2><p class="muted-copy">Chỉ các IP bên dưới mới thấy môn Lớp 5. IP khác mặc định chỉ thấy Lớp 11.</p></div><span id="class5-ip-count" class="status-badge safe">0 IP</span></div><div class="inline-form"><input id="class5-ip-input" placeholder="IP máy của em bạn"><button id="add-class5-ip" class="button button-primary"><i class="fa-solid fa-user-plus"></i> Cấp quyền</button></div><button id="add-current-class5-ip" class="text-button"><i class="fa-solid fa-location-crosshairs"></i> Cấp quyền cho IP máy này</button><div id="class5-ip-list" class="stack-list"></div></section>');
    }

    async function loadGeo() { const row = await systemRow(SYSTEM.geo); if (row) { try { const data = JSON.parse(row.score_summary || '{}'); state.geo = { mode: data.mode || row.device_info || 'PUBLIC', ips: data.ips || [], grade5Ips: data.grade5Ips || [] }; } catch (error) {} } ensureClass5AccessPanel(); renderGeo(); }
    function renderGeo() { ensureClass5AccessPanel(); $('geo-mode-badge') && ($('geo-mode-badge').textContent = state.geo.mode); document.querySelectorAll('[data-geo-mode]').forEach((button) => button.classList.toggle('is-active', button.dataset.geoMode === state.geo.mode)); $('geo-ip-list') && ($('geo-ip-list').innerHTML = state.geo.ips.map((ip) => `<div class="stack-item"><span class="stack-item-icon"><i class="fa-solid fa-location-dot"></i></span><span class="stack-item-main"><b>${esc(ip)}</b><small>Được phép truy cập Địa lý</small></span><button data-remove-geo="${esc(ip)}"><i class="fa-solid fa-xmark"></i></button></div>`).join('') || '<p class="muted-copy">Danh sách IP trống.</p>'); const class5Ips = Array.isArray(state.geo.grade5Ips) ? state.geo.grade5Ips : []; $('class5-ip-count') && ($('class5-ip-count').textContent = `${class5Ips.length} IP`); $('class5-ip-list') && ($('class5-ip-list').innerHTML = class5Ips.map((ip) => `<div class="stack-item"><span class="stack-item-icon"><i class="fa-solid fa-graduation-cap"></i></span><span class="stack-item-main"><b>${esc(ip)}</b><small>Được phép xem Lớp 5</small></span><button data-remove-class5="${esc(ip)}"><i class="fa-solid fa-xmark"></i></button></div>`).join('') || '<p class="muted-copy">Chưa cấp quyền cho IP nào.</p>'); }
    async function saveGeo() { const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.geo, player_name: '__ALLOWED_GEO_IPS__', ip_address: 'SYSTEM', device_info: state.geo.mode, status: 'ACTIVE', score_summary: JSON.stringify(state.geo), last_active: new Date().toISOString() }, { onConflict: 'id' }); if (error) throw error; renderGeo(); }
    async function addClass5Ip(ip) { const cleanIp = String(ip || '').trim(); if (!cleanIp) return notify('Nhập IP máy của em bạn.', true); state.geo.grade5Ips = Array.isArray(state.geo.grade5Ips) ? state.geo.grade5Ips : []; if (!state.geo.grade5Ips.includes(cleanIp)) state.geo.grade5Ips.push(cleanIp); await saveGeo(); notify(`Đã cấp quyền Lớp 5 cho IP ${cleanIp}.`); }
    async function removeClass5Ip(ip) { state.geo.grade5Ips = (state.geo.grade5Ips || []).filter((item) => item !== ip); await saveGeo(); notify(`Đã thu hồi quyền Lớp 5 của IP ${ip}.`); }

    async function loadSubjects() {
        const row = await systemRow(SYSTEM.subjects);
        if (row?.score_summary) { try { const data = JSON.parse(row.score_summary); state.subjects = Array.isArray(data) ? data : []; } catch (error) { state.subjects = []; } }
        state.subjects = state.subjects
            .map((item) => ({ ...item, key: item.key || item.subject_key, name: item.name || item.title || item.key }))
            .filter((item) => item.key && item.name);
        fillSubjects($('grade-select')?.value || '11');
        fillLibrarySubjects();
        $('subject-count') && ($('subject-count').textContent = state.subjects.length);
        $('subjects-list') && ($('subjects-list').innerHTML = state.subjects.map((subject) => `<article class="subject-card"><div class="subject-card-head"><span class="subject-card-icon"><i class="fa-solid ${esc(subject.icon || 'fa-book')}"></i></span><span class="tag">${esc(subject.visibility || 'PUBLIC')}</span></div><h3>${esc(subject.name || subject.title || subject.key)}</h3><p>${esc(subject.key)} · ${esc(subject.semester || 'Không chia kỳ')}</p><div class="subject-card-foot"><small>${esc(subject.gradient || 'indigo')}</small><div class="subject-card-actions"><button data-edit-subject="${esc(subject.key)}"><i class="fa-solid fa-pen"></i></button><button data-delete-subject="${esc(subject.key)}"><i class="fa-solid fa-trash"></i></button></div></div></article>`).join('') || '<div class="empty-state">Chưa có môn động. Môn tích hợp vẫn hoạt động bình thường.</div>');
        upgradePrivacyPanel();
    }

    function upgradePrivacyPanel() {
        const grid = document.querySelector('[data-view-panel="subjects"] .geo-grid');
        if (!grid || grid.dataset.upgraded === 'true') { ensureClass5AccessPanel(); renderSubjectPrivacy(); return; }
        const editor = grid.querySelector('.subject-editor-panel');
        grid.innerHTML = '<section class="panel subject-privacy-panel"><div class="panel-title"><div><p class="eyebrow">SUBJECT PRIVACY</p><h2>Quyền riêng tư tất cả môn học</h2><p class="muted-copy">Bật Riêng tư để ẩn môn khỏi trang học sinh. Mỗi môn có thể cài đặt độc lập.</p></div><span id="privacy-private-count" class="status-badge safe">0 RIÊNG TƯ</span></div><div id="subject-privacy-list" class="subject-privacy-list"></div><div class="privacy-note"><i class="fa-solid fa-circle-info"></i><span>Thay đổi được lưu lên Cloud và áp dụng ngay sau khi học sinh tải lại trang.</span></div></section>';
        if (editor) grid.appendChild(editor);
        grid.dataset.upgraded = 'true';
        ensureClass5AccessPanel();
        renderSubjectPrivacy();
    }

    function renderSubjectPrivacy() {
        const list = $('subject-privacy-list');
        if (!list) return;
        const subjects = state.subjects || [];
        const privateCount = subjects.filter((subject) => subject.visibility === 'PRIVATE').length;
        $('privacy-private-count') && ($('privacy-private-count').textContent = `${privateCount} RIÊNG TƯ`);
        $('privacy-private-count') && ($('privacy-private-count').className = `status-badge ${privateCount ? 'danger' : 'safe'}`);
        list.innerHTML = subjects.map((subject) => {
            const isPrivate = subject.visibility === 'PRIVATE';
            const grade = /5$/.test(subject.key || '') ? 'Lớp 5' : 'Lớp 11';
            return `<div class="privacy-subject-row"><span class="subject-card-icon"><i class="fa-solid ${esc(subject.icon || 'fa-book')}"></i></span><span class="privacy-subject-main"><b>${esc(subject.name || subject.title || subject.key)}</b><small>${esc(grade)} · ${esc(subject.key)}</small></span><span class="status-badge ${isPrivate ? 'danger' : 'safe'}">${isPrivate ? 'RIÊNG TƯ' : 'CÔNG KHAI'}</span><label class="privacy-switch" title="${isPrivate ? 'Bật để mở môn' : 'Tắt để ẩn môn'}"><input type="checkbox" data-toggle-subject="${esc(subject.key)}" ${isPrivate ? '' : 'checked'}><span></span></label></div>`;
        }).join('') || '<div class="empty-state">Chưa có môn học để cấu hình.</div>';
    }

    async function toggleSubjectPrivacy(key, isPublic) {
        const subject = state.subjects.find((item) => (item.key || item.subject_key) === key);
        if (!subject) return;
        const previous = subject.visibility;
        subject.visibility = isPublic ? 'PUBLIC' : 'PRIVATE';
        try {
            await saveSubjects();
            notify(`${subject.name || key} đã chuyển sang ${subject.visibility === 'PRIVATE' ? 'Riêng tư' : 'Công khai'}.`);
        } catch (error) {
            subject.visibility = previous;
            renderSubjectPrivacy();
            notify(`Không thể lưu quyền môn học: ${error.message}`, true);
        }
    }

    async function saveSubjects() {
        state.subjects = (state.subjects || []).filter((item) => item && item.key && item.name);
        const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.subjects, player_name: '__DYNAMIC_SUBJECTS__', ip_address: 'SYSTEM', device_info: 'DYNAMIC_HUB', status: 'ACTIVE', score_summary: JSON.stringify(state.subjects), last_active: new Date().toISOString() }, { onConflict: 'id' });
        if (error) throw error;
        fillLibrarySubjects(); await loadSubjects();
    }

    function resetSubjectForm() { ['subject-name-input', 'subject-key-input', 'subject-semester-input'].forEach((id) => { if ($(id)) $(id).value = ''; }); if ($('subject-icon-input')) $('subject-icon-input').value = 'fa-book'; if ($('subject-editor-title')) $('subject-editor-title').textContent = 'Tạo môn học'; }
    async function saveSubject(event) { event.preventDefault(); const key = $('subject-key-input')?.value.trim(); const name = $('subject-name-input')?.value.trim(); if (!key || !name) return notify('Nhập tên và mã môn học.', true); const subject = { key, name, semester: $('subject-semester-input')?.value.trim() || '', icon: $('subject-icon-input')?.value.trim() || 'fa-book', gradient: $('subject-gradient-input')?.value || 'indigo', visibility: $('subject-visibility-input')?.value || 'PUBLIC' }; const index = state.subjects.findIndex((item) => item.key === key); if (index >= 0) state.subjects[index] = { ...state.subjects[index], ...subject }; else state.subjects.push(subject); await saveSubjects(); resetSubjectForm(); notify('Đã lưu môn học.'); }
    async function deleteSubject(key) { if (!window.confirm(`Xóa môn ${key} và toàn bộ câu hỏi thuộc môn này?`)) return; state.subjects = state.subjects.filter((item) => item.key !== key); await state.client.from('quiz_questions').delete().eq('subject_key', key); await saveSubjects(); notify('Đã xóa môn học.'); }

    async function loadStudents() {
        const systemIds = Object.values(SYSTEM);
        const { data, error } = await state.client.from('quiz_logins').select('*').order('last_active', { ascending: false }).limit(200);
        if (error) return notify(error.message, true);
        const rows = (data || []).filter((row) => !systemIds.includes(row.id));
        const online = rows.filter((row) => row.last_active && Date.now() - new Date(row.last_active).getTime() < 120000);
        animateMetricValue('stat-online', online.length); $('nav-online-count') && ($('nav-online-count').textContent = online.length); $('student-count') && ($('student-count').textContent = `${rows.length} phiên`); $('stat-visitor-note') && ($('stat-visitor-note').textContent = `${rows.length} lượt truy cập`);
        $('monitor-stats') && ($('monitor-stats').innerHTML = `<div class="monitor-stat"><span><b>${online.length}</b><small>Đang trực tuyến</small></span><i style="color:var(--green);background:#def9eb" class="fa-solid fa-signal"></i></div><div class="monitor-stat"><span><b>${rows.length}</b><small>Tổng phiên ghi nhận</small></span><i style="color:var(--primary);background:#eeedff" class="fa-solid fa-users"></i></div><div class="monitor-stat"><span><b>${rows.filter((row) => row.status === 'BANNED').length}</b><small>IP đang bị chặn</small></span><i style="color:var(--red);background:#ffe7e8" class="fa-solid fa-ban"></i></div>`);
        $('students-body') && ($('students-body').innerHTML = rows.map((row) => { const isOnline = online.includes(row); const status = row.status === 'BANNED' || String(row.status || '').startsWith('BANNED') ? 'banned' : isOnline ? 'online' : 'offline'; return `<tr><td><b>${esc(row.player_name || 'Học sinh')}</b></td><td><code>${esc(row.ip_address || '—')}</code></td><td>${esc(row.device_info || '—')}</td><td>${row.last_active ? new Date(row.last_active).toLocaleString('vi-VN') : '—'}</td><td><span class="table-status ${status}"><i class="fa-solid fa-circle"></i> ${status === 'online' ? 'Online' : status === 'banned' ? 'Bị chặn' : 'Offline'}</span></td><td class="align-right">${status === 'banned' ? `<button class="table-action" data-unban-row="${esc(row.ip_address || '')}"><i class="fa-solid fa-unlock"></i></button>` : `<button class="table-action danger" data-ban-row="${esc(row.ip_address || '')}"><i class="fa-solid fa-ban"></i></button>`}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty-state">Chưa có phiên truy cập.</td></tr>');
        const banned = rows.filter((row) => String(row.status || '').startsWith('BANNED'));
        $('banned-count') && ($('banned-count').textContent = `${banned.length} IP`);
        $('banned-list') && ($('banned-list').innerHTML = banned.map((row) => `<div class="stack-item"><span class="stack-item-icon"><i class="fa-solid fa-ban"></i></span><span class="stack-item-main"><b>${esc(row.ip_address)}</b><small>${esc(row.score_summary || row.device_info || 'Vi phạm quy chế')}</small></span><button data-unban-row="${esc(row.ip_address)}"><i class="fa-solid fa-unlock"></i></button></div>`).join('') || '<p class="muted-copy">Chưa có IP bị chặn.</p>');
    }

    async function broadcastNotice() { const message = $('notice-input')?.value.trim(); if (!message) return notify('Nhập nội dung thông báo.', true); const { error } = await state.client.from('quiz_logins').insert({ id: crypto.randomUUID(), player_name: '__SYSTEM_NOTICE__', ip_address: 'ALL', device_info: '5s', status: 'ACTIVE', score_summary: message, last_active: new Date().toISOString() }); if (error) return notify(error.message, true); $('notice-input').value = ''; notify('Đã phát thông báo tới học sinh.'); }
    async function banIp(ip, reason = '') { if (!ip) return; const now = new Date().toISOString(); const { data: updated, error: updateError } = await state.client.from('quiz_logins').update({ status: `BANNED: ${reason || 'Vi phạm quy chế ôn tập'}`, score_summary: reason || 'Vi phạm quy chế ôn tập', last_active: now }).eq('ip_address', ip).select(); if (updateError) return notify(updateError.message, true); if (!updated?.length) { const { error } = await state.client.from('quiz_logins').insert({ id: crypto.randomUUID(), player_name: '__BANNED_IP__', ip_address: ip, device_info: 'Manual Ban', status: `BANNED: ${reason || 'Vi phạm quy chế ôn tập'}`, score_summary: reason, last_active: now }); if (error) return notify(error.message, true); } notify(`Đã chặn IP ${ip}.`); loadStudents(); }
    async function unbanIp(ip) { const { error } = await state.client.from('quiz_logins').delete().eq('player_name', '__BANNED_IP__').eq('ip_address', ip); if (error) return notify(error.message, true); await state.client.from('quiz_logins').update({ status: 'Đang ôn tập', last_active: new Date().toISOString() }).eq('ip_address', ip).like('status', 'BANNED%'); notify(`Đã mở khóa IP ${ip}.`); loadStudents(); }

    function exportJson(name, payload) { const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); URL.revokeObjectURL(link.href); }
    function exportBackup() { exportJson(`quiz-studio-backup-${new Date().toISOString().slice(0, 10)}.json`, { exportedAt: new Date().toISOString(), questions: state.questions, adminConfig: state.adminConfig, aiIps: state.aiIps, geo: state.geo, maintenance: state.maintenance }); notify('Đã tải file backup JSON.'); }
    function exportExcel() { if (!window.XLSX) return exportJson('quiz-questions.json', state.questions); const rows = state.questions.map((q) => ({ ID: q.id, Mon: subjectName(q.subject_key), Loai: TYPE_LABELS[q.qType], CauHoi: q.question, DapAn: q.qType === 'mcq' ? 'ABCD'[q.correct] : q.qType === 'short_answer' ? q.correctValue : q.statements.map((s) => `${s.key}:${s.answer ? 'Đúng' : 'Sai'}`).join(', '), GiaiThich: q.explanation })); const book = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(book, window.XLSX.utils.json_to_sheet(rows), 'Questions'); window.XLSX.writeFile(book, `quiz-questions-${new Date().toISOString().slice(0, 10)}.xlsx`); notify('Đã xuất bảng câu hỏi Excel.'); }
    async function loadLeaderboard() { const subject = $('leaderboard-subject')?.value; let query = state.client.from('quiz_logins').select('*').order('last_active', { ascending: false }).limit(100); if (subject) query = query.ilike('score_summary', `%${subject}%`); const { data, error } = await query; if (error) return notify(error.message, true); const rows = (data || []).filter((row) => !Object.values(SYSTEM).includes(row.id)).slice(0, 10); $('leaderboard-content').innerHTML = `<div class="leaderboard-list">${rows.map((row, index) => `<div class="leader-row"><strong>#${index + 1}</strong><span>${esc(row.player_name || 'Học sinh')}</span><b>${esc(row.score_summary || '—')}</b><small>${row.last_active ? new Date(row.last_active).toLocaleDateString('vi-VN') : ''}</small></div>`).join('') || '<div class="empty-state">Chưa có kết quả.</div>'}</div>`; }

    function bindEvents() {
        if (state.bound) return; state.bound = true;
        injectEditorControls();
        document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
        document.querySelectorAll('[data-go-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.goView)));
        $('mobile-menu')?.addEventListener('click', () => $('sidebar')?.classList.toggle('is-open'));
        $('theme-toggle')?.addEventListener('click', () => { document.body.classList.toggle('dark'); localStorage.setItem('quiz_admin_dark', document.body.classList.contains('dark') ? 'true' : 'false'); });
        $('refresh-button')?.addEventListener('click', () => Promise.all([loadQuestions(), loadStudents(), loadMaintenance(), loadAccess(), loadGeo()]));
        $('grade-select')?.addEventListener('change', (event) => { fillSubjects(event.target.value); renderPreview(); });
        $('question-type-select')?.addEventListener('change', (event) => ensureTypeEditor(event.target.value));
        $('question-form')?.addEventListener('input', (event) => {
            if (event.target.id === 'question-input' || event.target.id === 'category-input' || event.target.id === 'explanation-input' || event.target.id.startsWith('option-') || event.target.id.startsWith('tf-') || event.target.id === 'correct-value-input') renderPreview();
        });
        $('question-form')?.addEventListener('submit', saveQuestion);
        $('reset-form')?.addEventListener('click', resetForm); $('cancel-edit')?.addEventListener('click', resetForm); $('new-question-button')?.addEventListener('click', () => { resetForm(); switchView('questions'); });
        document.querySelectorAll('.answer-radio').forEach((button) => button.addEventListener('click', () => setAnswer(button.dataset.answer)));
        $('question-form')?.addEventListener('click', (event) => { const choice = event.target.closest('.tf-choice'); if (choice) setTfAnswer(choice.dataset.index, choice.dataset.value); });
        $('search-input')?.addEventListener('input', renderLibrary); $('question-type-filter')?.addEventListener('change', (event) => { state.typeFilter = event.target.value; renderLibrary(); });
        $('library-subject-filter')?.addEventListener('change', (event) => { state.subject = event.target.value; renderLibrary(); });
        document.querySelectorAll('.grade-filter').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.grade-filter').forEach((item) => item.classList.remove('is-active')); button.classList.add('is-active'); state.grade = button.dataset.grade; state.subject = 'all'; fillLibrarySubjects(); renderLibrary(); }));
        $('questions-list')?.addEventListener('click', (event) => { const edit = event.target.closest('[data-edit]'); const remove = event.target.closest('[data-delete]'); if (edit) { const q = state.questions.find((item) => String(item.id) === String(edit.dataset.edit)); if (q) { fillForm(q); window.scrollTo({ top: 0, behavior: 'smooth' }); } } if (remove) deleteQuestion(remove.dataset.delete); });
        $('import-button')?.addEventListener('click', openImport); $('quick-import')?.addEventListener('click', openImport); $('parse-import')?.addEventListener('click', () => { const source = $('import-text')?.value || ''; const list = parseJsonInput(source); if (!list.length) return notify('Văn bản đã được giữ nguyên. Hãy dùng Gemini để phân tích câu hỏi.', true); state.importQuestions = list; state.importIndex = 0; state.importIntegrity = validateVerbatimQuestions(list, source); fillForm(list[0]); renderImportReview(); }); $('ai-analyze-import')?.addEventListener('click', analyzeWithGemini); $('save-import')?.addEventListener('click', saveImportQuestions);
        $('import-subject-select')?.addEventListener('change', (event) => { state.importSubject = event.target.value; }); $('import-file')?.addEventListener('change', (event) => handleImportFile(event.target.files?.[0]));
        $('import-preview')?.addEventListener('click', (event) => { const index = event.target.closest('[data-import-index]'); const prev = event.target.closest('[data-import-prev]'); const next = event.target.closest('[data-import-next]'); if (index) { state.importIndex = Number(index.dataset.importIndex); fillForm(state.importQuestions[state.importIndex]); } if (prev && state.importIndex > 0) { state.importIndex -= 1; fillForm(state.importQuestions[state.importIndex]); } if (next && state.importIndex < state.importQuestions.length - 1) { state.importIndex += 1; fillForm(state.importQuestions[state.importIndex]); } renderImportReview(); });
        document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
        $('maintenance-toggle')?.addEventListener('change', toggleMaintenance); $('edit-maintenance')?.addEventListener('click', () => { const message = window.prompt('Lời nhắn bảo trì:', state.maintenance.message); if (message !== null) { state.maintenance.message = message; toggleMaintenance(); } });
        $('add-admin-ip')?.addEventListener('click', () => addAdminIp().catch((error) => notify(error.message, true))); $('save-master-ip')?.addEventListener('click', () => saveMasterIp().catch((error) => notify(error.message, true))); $('add-ai-ip')?.addEventListener('click', () => addAiIp().catch((error) => notify(error.message, true)));
        $('admin-ip-list')?.addEventListener('click', (event) => { const button = event.target.closest('[data-remove-admin]'); if (button) removeAdminIp(button.dataset.removeAdmin).catch((error) => notify(error.message, true)); }); $('ai-ip-list')?.addEventListener('click', (event) => { const button = event.target.closest('[data-remove-ai]'); if (button) removeAiIp(button.dataset.removeAi).catch((error) => notify(error.message, true)); }); document.addEventListener('change', (event) => { const toggle = event.target.closest('[data-toggle-subject]'); if (toggle) toggleSubjectPrivacy(toggle.dataset.toggleSubject, toggle.checked).catch((error) => notify(error.message, true)); });
        document.querySelectorAll('[data-geo-mode]').forEach((button) => button.addEventListener('click', () => { state.geo.mode = button.dataset.geoMode; saveGeo().catch((error) => notify(error.message, true)); })); $('add-geo-ip')?.addEventListener('click', () => { const ip = $('geo-ip-input').value.trim(); if (ip && !state.geo.ips.includes(ip)) state.geo.ips.push(ip); $('geo-ip-input').value = ''; saveGeo().catch((error) => notify(error.message, true)); }); $('geo-ip-list')?.addEventListener('click', (event) => { const button = event.target.closest('[data-remove-geo]'); if (button) { state.geo.ips = state.geo.ips.filter((ip) => ip !== button.dataset.removeGeo); saveGeo().catch((error) => notify(error.message, true)); } }); document.addEventListener('click', (event) => { const add = event.target.closest('#add-class5-ip'); const addCurrent = event.target.closest('#add-current-class5-ip'); const remove = event.target.closest('[data-remove-class5]'); if (add) { const input = $('class5-ip-input'); addClass5Ip(input?.value).then(() => { if (input) input.value = ''; }).catch((error) => notify(error.message, true)); } if (addCurrent) addClass5Ip(state.clientIp).catch((error) => notify(error.message, true)); if (remove) removeClass5Ip(remove.dataset.removeClass5).catch((error) => notify(error.message, true)); });
        $('send-notice')?.addEventListener('click', broadcastNotice); document.querySelectorAll('[data-notice]').forEach((button) => button.addEventListener('click', () => { $('notice-input').value = button.dataset.notice; })); $('ban-ip-button')?.addEventListener('click', () => banIp($('ban-ip-input').value.trim(), $('ban-reason-input').value.trim())); $('refresh-students')?.addEventListener('click', loadStudents); $('clear-logins')?.addEventListener('click', async () => { if (!window.confirm('Xóa toàn bộ lịch sử học sinh? Cấu hình hệ thống sẽ được giữ lại.')) return; const { error } = await state.client.from('quiz_logins').delete().not('player_name', 'like', '__%'); if (error) return notify(error.message, true); notify('Đã xóa lịch sử học sinh.'); loadStudents(); }); $('students-body')?.addEventListener('click', (event) => { const ban = event.target.closest('[data-ban-row]'); const unban = event.target.closest('[data-unban-row]'); if (ban) banIp(ban.dataset.banRow); if (unban) unbanIp(unban.dataset.unbanRow); }); $('banned-list')?.addEventListener('click', (event) => { const button = event.target.closest('[data-unban-row]'); if (button) unbanIp(button.dataset.unbanRow); });
        $('export-backup')?.addEventListener('click', exportBackup); $('export-excel')?.addEventListener('click', exportExcel); $('load-leaderboard')?.addEventListener('click', loadLeaderboard); $('save-gemini-key')?.addEventListener('click', saveGeminiKey); $('clear-gemini-key')?.addEventListener('click', clearGeminiKey); $('test-gemini-key')?.addEventListener('click', testGeminiKey);
        $('archive-data')?.addEventListener('click', async () => { if (!window.confirm('Backup và xóa lịch sử làm bài của học sinh?')) return; const { data, error } = await state.client.from('quiz_logins').select('*').not('player_name', 'like', '__%'); if (error) return notify(error.message, true); exportJson(`exam-archive-${new Date().toISOString().slice(0, 10)}.json`, { archivedAt: new Date().toISOString(), records: data || [] }); const result = await state.client.from('quiz_logins').delete().not('player_name', 'like', '__%'); if (result.error) return notify(result.error.message, true); notify('Đã backup và dọn lịch sử kỳ thi.'); loadStudents(); });
        $('new-subject-button')?.addEventListener('click', () => {
            switchView('subjects');
            resetSubjectForm();
            const editor = document.querySelector('.subject-editor-panel');
            editor?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            window.setTimeout(() => $('subject-name-input')?.focus(), 350);
        });
        $('go-subject-editor')?.addEventListener('click', () => {
            closeModal('subject-modal');
            switchView('subjects');
            resetSubjectForm();
            const editor = document.querySelector('.subject-editor-panel');
            editor?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            window.setTimeout(() => $('subject-name-input')?.focus(), 350);
        });
        $('subject-form')?.addEventListener('submit', saveSubject); $('clear-subject-form')?.addEventListener('click', resetSubjectForm); $('refresh-subjects')?.addEventListener('click', loadSubjects); $('subjects-list')?.addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-subject]'); const remove = event.target.closest('[data-delete-subject]'); if (edit) { const subject = state.subjects.find((item) => item.key === edit.dataset.editSubject); if (subject) { $('subject-name-input').value = subject.name || subject.title || ''; $('subject-key-input').value = subject.key || ''; $('subject-semester-input').value = subject.semester || ''; $('subject-icon-input').value = subject.icon || 'fa-book'; $('subject-gradient-input').value = subject.gradient || 'indigo'; $('subject-visibility-input').value = subject.visibility || 'PUBLIC'; $('subject-editor-title').textContent = `Sửa môn ${subject.name || subject.key}`; } } if (remove) deleteSubject(remove.dataset.deleteSubject).catch((error) => notify(error.message, true)); }); $('subjects-list')?.addEventListener('click', (event) => { const toggle = event.target.closest('[data-toggle-subject]'); if (toggle) toggleSubjectPrivacy(toggle.dataset.toggleSubject); });
    }

    async function init() {
        if (localStorage.getItem('quiz_admin_dark') === 'true') document.body.classList.add('dark');
        try {
            state.client = window.supabase.createClient(CONFIG.url, CONFIG.key);
            if (!(await isCurrentIpAllowed())) { denyAccess(); return; }
            showApp(); bindEvents(); fillSubjects('11'); fillLibrarySubjects(); ensureTypeEditor('mcq'); renderPreview();
            await Promise.all([loadQuestions(), loadStudents(), loadMaintenance(), loadAccess(), loadGeo(), loadSubjects()]);
        } catch (error) { denyAccess(); }
    }
    init();
})();
