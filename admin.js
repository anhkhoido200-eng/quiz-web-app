/* Quiz Studio Control Center. Question editor, strict import and system controls. */
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
    const TYPE_LABELS = { mcq: 'Trắc nghiệm 4 lựa chọn', tf_group: 'Đúng / Sai', short_answer: 'Trả lời ngắn' };
    const state = {
        client: null, clientIp: '', questions: [], grade: 'all', subject: 'all', typeFilter: 'all',
        type: 'mcq', answer: 0, tfAnswers: [true, true, true, true], editingId: null,
        importQuestions: [], importIndex: 0, importSubject: 'history', sourceText: '', importError: '',
        adminConfig: { masterIp: '', allowedIps: [] }, aiIps: [], geo: { mode: 'PUBLIC', ips: [], grade5Ips: [] },
        subjects: [], maintenance: { isActive: false, message: '' }, bound: false,
        subjectDialogOpener: null, subjectEditingKey: null,
        importIntegrity: { valid: true, errors: [] }
    };
    const $ = (id) => document.getElementById(id);
    const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
    const notationText = (value) => {
        if (typeof MathNotation !== 'undefined' && typeof MathNotation.readValue === 'function') {
            return MathNotation.readValue(value).text;
        }
        if (value && typeof value === 'object') return String(value.text ?? value.value ?? value.content ?? '');
        return String(value ?? '');
    };
    const storageText = (value) => {
        if (value && typeof value === 'object') {
            const math = value.math ?? value.latex ?? value.formula;
            if (math !== undefined && math !== null && String(math).trim()) {
                const source = String(math).trim();
                return /^\$[^$]+\$$|^\$\$[\s\S]*\$\$$/.test(source) ? source : `$${source}$`;
            }
            return String(value.text ?? value.value ?? value.content ?? '');
        }
        return String(value ?? '');
    };
    const formatNotation = (value, fallback = '') => {
        const source = value || fallback;
        return typeof MathNotation !== 'undefined' && typeof MathNotation.format === 'function'
            ? MathNotation.format(source)
            : String(source ?? '');
    };
    const htmlText = (value, fallback = '') => esc(formatNotation(value, fallback)).replace(/\r?\n/g, '<br>');
    const renderMath = (root) => {
        if (!root) return;
        if (typeof renderMathInElement !== 'function') {
            if (!root.dataset.mathRenderRetry) root.dataset.mathRenderRetry = '0';
            const retry = Number(root.dataset.mathRenderRetry);
            if (retry < 20) {
                root.dataset.mathRenderRetry = String(retry + 1);
                window.setTimeout(() => renderMath(root), 50);
            }
            return;
        }
        try {
            renderMathInElement(root, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false }
                ],
                throwOnError: false
            });
        } catch (error) {
            console.warn('[Quiz Studio Admin] Math rendering failed:', error);
        }
    };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const fetchWithTimeout = async (url, options = {}, timeoutMs = 60000) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    };
    const isGeminiQuotaError = (status, message = '') => status === 429 || /resource_exhausted|quota exceeded|rate limit|free[_ -]?tier|billing|limit:\s*0/i.test(String(message));
    const geminiQuotaMessage = 'Gemini đã hết quota của project/API key hiện tại. Hãy đổi sang API key/project khác, bật billing hoặc chờ quota Google cấp lại; không thể tạo câu hỏi mới lúc này.';
    const parseBool = (value) => {
        if (value === true || value === 1) return true;
        if (value === false || value === 0 || value === null || value === undefined) return false;
        const normalized = String(value).trim().toLowerCase();
        return ['true', 'đúng', 'dung', 'yes', 'y', 't', '1'].includes(normalized);
    };
    const cleanGeminiKey = (value) => String(value || '').trim().replace(/^Bearer\s+/i, '').replace(/^['"]|['"]$/g, '').trim();
    const isValidGeminiKey = (value) => {
        const key = cleanGeminiKey(value);
        return Boolean(key && (/^(AIza[\w-]{20,}|AQ\.[\w.-]{20,})$/i.test(key) || key.length >= 20));
    };
    const subjectName = (key) => {
        const dynamic = state.subjects.find((item) => item.key === key || item.subject_key === key);
        return dynamic?.name || dynamic?.title || key || 'Chưa chọn môn';
    };
    // Mã môn có thể được tạo từ JSON cũ với dấu cách/gạch nối/Unicode khác
    // nhau. Dùng một khóa so sánh ổn định để số câu trên thẻ môn luôn khớp
    // với ngân hàng, nhưng vẫn giữ nguyên subject_key thật khi ghi Cloud.
    const subjectMatchKey = (value) => String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    const allSubjects = () => mergeSubjectCatalog(state.subjects)
        .map((item) => ({ key: item.key || item.subject_key, name: item.name || item.title || item.key }))
        .filter((item) => item.key);
    const builtinSubjects = () => [];
    const mergeSubjectCatalog = (configured) => {
        const merged = [];
        (Array.isArray(configured) ? configured : []).forEach((item) => {
            const key = item?.key || item?.subject_key;
            if (key && !merged.some((subject) => subject.key === key)) {
                merged.push({ ...item, key, name: item.name || item.title || key });
            }
        });
        return merged.filter((item) => item.key && (item.name || item.title));
    };
    const subjectGrade = (subject) => {
        const explicit = String(subject?.grade || subject?.class || subject?.grade_level || '').match(/5|11/);
        if (explicit) return explicit[0];
        const source = `${subject?.key || ''} ${subject?.name || subject?.title || ''}`;
        return /(?:^|[^0-9])5(?:$|[^0-9])/.test(source) || /5$/.test(subject?.key || '') ? '5' : '11';
    };
    const gradeOf = (q) => {
        const key = String(q.subject_key || q.subjectKey || q.key || '').toLowerCase();
        if (/5$/.test(key) || q.grade === '5' || q.grade_level === '5') return '5';
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
    const runAction = (action) => Promise.resolve().then(action).catch((error) => {
        console.error('[Quiz Studio Admin]', error);
        notify(error?.message || 'Thao tác không thành công.', true);
    });

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
        if (error) {
            console.error(`[Quiz Studio Admin] Không đọc được bản ghi hệ thống ${id}:`, error);
            throw error;
        }
        if (!data?.[0]) return null;
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

    function denyAccess(reason = '') {
        $('app-shell')?.classList.add('hidden');
        $('access-denied')?.classList.remove('hidden');
        const message = document.querySelector('#access-denied .access-card p:not(.eyebrow)');
        if (message && reason) message.textContent = `Không thể mở khu vực quản trị: ${reason}`;
    }

    async function bootstrapAdmin() {
        if (!state.client) state.client = window.supabase.createClient(CONFIG.url, CONFIG.key);
        if (!state.clientIp) state.clientIp = await getClientIp();
        if (!state.clientIp || state.clientIp === 'Chưa xác định') return notify('Không xác định được IP máy hiện tại.', true);
        const row = await systemRow(SYSTEM.admin);
        if (!row) return notify('Chưa tìm thấy bản ghi cấu hình Admin trên Supabase.', true);
        let config;
        try { config = JSON.parse(row.score_summary || '{}'); } catch (error) { config = {}; }
        const allowed = Array.isArray(config.allowedIps) ? config.allowedIps : [];
        const masterIp = String(config.masterIp || '').trim();
        if (masterIp || allowed.length) return notify('Hệ thống đã có whitelist Admin. Hãy dùng tài khoản/IP được cấp.', true);
        const password = window.prompt('Nhập mật khẩu Admin để thiết lập lần đầu:');
        if (password !== '034569') return notify('Mật khẩu Admin không đúng.', true);
        const payload = { masterIp: state.clientIp, allowedIps: [{ ip: state.clientIp, name: 'Thiết bị Master', addedAt: new Date().toISOString(), isMaster: true }] };
        const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.admin, player_name: '__ADMIN_IPS_CONFIG__', ip_address: 'SYSTEM', device_info: 'PASSWORDLESS_AUTH', status: 'ACTIVE', score_summary: JSON.stringify(payload), last_active: new Date().toISOString() }, { onConflict: 'id' });
        if (error) throw error;
        notify('Đã thiết lập Master Admin. Đang tải lại bảng điều khiển.');
        window.setTimeout(() => window.location.reload(), 700);
    }

    function showApp() {
        $('access-denied')?.classList.add('hidden');
        $('app-shell')?.classList.remove('hidden');
    }

    function injectEditorControls() {
        const form = $('question-form');
        if (!form) return;
        if (!$('question-type-select')) {
            const questionLabel = $('question-input')?.closest('label');
            const explanationLabel = $('explanation-input')?.closest('label');
            if (questionLabel && explanationLabel) {
                const typeLabel = document.createElement('label');
                typeLabel.innerHTML = 'Loại câu hỏi<select id="question-type-select" required><option value="mcq">Trắc nghiệm 4 lựa chọn</option><option value="tf_group">Trắc nghiệm Đúng / Sai</option><option value="short_answer">Trả lời ngắn</option></select>';
                questionLabel.before(typeLabel);
                const typeEditor = document.createElement('div');
                typeEditor.id = 'dynamic-type-editor';
                typeEditor.innerHTML = '<div id="tf-editor" class="hidden"></div><div id="short-editor" class="hidden"></div>';
                explanationLabel.before(typeEditor);
            }
        }
        const importModal = $('import-modal');
        $('ai-analyze-import')?.remove();
        const importTitle = importModal?.querySelector('.modal-header p:not(.eyebrow)');
        if (importTitle) importTitle.textContent = 'Dán JSON câu hỏi đã có sẵn hoặc chọn file JSON/TXT.';
        const importDropzone = importModal?.querySelector('.dropzone span');
        if (importDropzone) importDropzone.textContent = 'Kéo thả hoặc chọn file JSON hoặc TXT';
        if ($('import-text')) $('import-text').placeholder = 'Dán JSON câu hỏi tại đây...';
        const file = $('import-file');
        if (file) file.accept = '.json,.txt';
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
        const options = allSubjects().filter((item) => subjectGrade(item) === String(grade));
        const select = $('subject-select');
        if (!select) return;
        select.innerHTML = options.map((item) => `<option value="${esc(item.key)}">${esc(item.name)}</option>`).join('');
        if (selected && options.some((item) => item.key === selected)) select.value = selected;
    }

    function fillLibrarySubjects() {
        const catalog = mergeSubjectCatalog(state.subjects);
        const list = state.grade === 'all' ? catalog : catalog.filter((item) => subjectGrade(item) === String(state.grade));
        if (!list.some((item) => item.key === state.subject)) state.subject = 'all';
        if ($('library-subject-filter')) {
            $('library-subject-filter').innerHTML = '<option value="all">Tất cả môn học</option>' + list.map((item) => `<option value="${esc(item.key)}">${esc(item.name)}</option>`).join('');
            $('library-subject-filter').value = state.subject;
        }
        if ($('import-subject-select')) {
            $('import-subject-select').innerHTML = allSubjects().map((item) => `<option value="${esc(item.key)}">${esc(item.name)}</option>`).join('');
            // Luôn giữ state theo đúng môn đang hiển thị. Nếu state cũ là
            // "history" nhưng Admin chọn môn khác, trước đây dữ liệu vẫn bị
            // ghi nhầm vào history khiến app học sinh không tìm thấy.
            const selectedSubject = allSubjects().some((item) => item.key === state.importSubject)
                ? state.importSubject
                : (allSubjects()[0]?.key || '');
            $('import-subject-select').value = selectedSubject;
            state.importSubject = selectedSubject;
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
        renderMath(card);
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
        const statements = Array.isArray(row.statements) ? row.statements.map((item, index) => ({ key: item.key || item.id || 'abcd'[index], label: item.label || item.key || 'abcd'[index], text: item.math || item.latex || item.formula ? { text: item.text ?? item.content ?? '', math: item.math ?? item.latex ?? item.formula } : item.text ?? item.content ?? '', answer: parseBool(item.answer ?? item.correctAnswer) })) : [];
        return { ...row, subjectKey: row.subject_key, qType, q_type: qType, options: Array.isArray(row.options) ? row.options : [], statements, correct: Number(row.correct ?? row.answer ?? 0), answer: Number(row.answer ?? row.correct ?? 0), correctValue: row.correct_value ?? row.correctValue ?? '', explanation: row.explanation || '' };
    }

    async function loadQuestions() {
        try {
            const { data, error } = await state.client.from('quiz_questions').select('*').order('id', { ascending: true });
            if (error) throw error;
            state.questions = (data || []).map(normalizeRow);
            setConnection(true, 'Đã đồng bộ');
            $('last-sync') && ($('last-sync').textContent = `Đồng bộ lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`);
            renderStats(); renderLibrary(); renderRecentActivity(); renderSubjectCatalog();
            $('health-database') && ($('health-database').textContent = 'Supabase đang hoạt động');
            $('health-database-badge') && ($('health-database-badge').textContent = 'Ổn định');
            $('health-database-badge')?.classList.replace('pending', 'safe');
            $('health-content') && ($('health-content').textContent = `${state.questions.length} câu hỏi đã tải`);
            $('health-content-badge') && ($('health-content-badge').textContent = 'Đã tải');
            $('health-content-badge')?.classList.replace('pending', 'safe');
            await syncSubjectQuestionCounts();
        } catch (error) {
            setConnection(false, 'Không thể kết nối');
            notify(`Lỗi tải câu hỏi: ${error.message}`, true);
        }
    }

    async function syncSubjectQuestionCounts() {
        const questionCounts = (state.questions || []).reduce((counts, question) => {
            const key = subjectMatchKey(question.subject_key || question.subjectKey);
            if (key) counts[key] = (counts[key] || 0) + 1;
            return counts;
        }, {});
        const changed = state.subjects.some((subject) => Number(subject.count || 0) !== (questionCounts[subjectMatchKey(subject.key || subject.subject_key)] || 0));
        if (!changed) return;
        state.subjects = state.subjects.map((subject) => ({
            ...subject,
            count: questionCounts[subjectMatchKey(subject.key || subject.subject_key)] || 0
        }));
        console.debug('[Quiz Studio Admin] Syncing subject question counts:', state.subjects.map((subject) => ({ key: subject.key, count: subject.count })));
        const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.subjects, player_name: '__DYNAMIC_SUBJECTS__', ip_address: 'SYSTEM', device_info: 'DYNAMIC_HUB', status: 'ACTIVE', score_summary: JSON.stringify(state.subjects), last_active: new Date().toISOString() }, { onConflict: 'id' });
        if (error) console.warn('[Quiz Studio Admin] Không thể lưu số câu theo môn:', error.message);
        renderSubjectCatalog();
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
            if (q.qType === 'tf_group') answerPreview = `<div class="item-statements">${q.statements.map((s) => `<div class="item-statement"><b>${esc(s.key)}.</b>${htmlText(s.text)} <strong>${s.answer ? 'Đúng' : 'Sai'}</strong></div>`).join('')}</div>`;
            else if (q.qType === 'short_answer') answerPreview = `<div class="item-option is-correct">Đáp án: ${htmlText(q.correctValue)}</div>`;
            else answerPreview = `<div class="item-options">${q.options.slice(0, 4).map((option, index) => `<span class="item-option ${index === q.correct ? 'is-correct' : ''}"><b>${'ABCD'[index]}.</b> ${htmlText(option)}</span>`).join('')}</div>`;
            return `<article class="question-item"><div class="question-item-head"><div class="question-tags"><span class="tag ${grade === '5' ? 'grade5' : 'grade11'}">Lớp ${grade}</span><span class="tag">${esc(subjectName(q.subject_key))}</span>${typeChip(q)}</div><span class="tag">#${esc(q.id)}</span></div><h3>${htmlText(q.question)}</h3>${answerPreview}<div class="question-item-footer"><small>${esc(q.category || 'Ôn tập')}</small><div class="item-actions"><button class="edit-button" data-edit="${esc(q.id)}"><i class="fa-solid fa-pen"></i> Sửa</button><button class="delete-button" data-delete="${esc(q.id)}"><i class="fa-solid fa-trash"></i> Xóa</button></div></div></article>`;
        }).join('');
        renderMath(list);
    }

    function renderRecentActivity() {
        const list = $('recent-activity');
        if (!list) return;
        const rows = state.questions.slice(-5).reverse();
        list.innerHTML = rows.length ? rows.map((q) => `<div class="activity-item"><i class="fa-solid ${q.qType === 'tf_group' ? 'fa-list-check' : q.qType === 'short_answer' ? 'fa-keyboard' : 'fa-list-radio'}"></i><span><b>${esc(TYPE_LABELS[q.qType] || 'Câu hỏi')} · ${esc(subjectName(q.subject_key))}</b><small>${htmlText(q.question).slice(0, 90)}${String(q.question).length > 90 ? '...' : ''}</small></span></div>`).join('') : '<div class="empty-state"><p>Chưa có hoạt động.</p></div>';
        renderMath(list);
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
        $('form-title') && ($('form-title').textContent = normalized.id ? `Sửa câu hỏi #${normalized.id}` : 'Duyệt câu hỏi từ JSON');
        $('submit-label') && ($('submit-label').textContent = normalized.id ? 'Cập nhật câu hỏi' : 'Lưu câu hỏi');
        $('cancel-edit')?.classList.toggle('hidden', !normalized.id);
        if ($('grade-select')) $('grade-select').value = grade;
        fillSubjects(grade, normalized.subject_key || state.importSubject);
        if ($('category-input')) $('category-input').value = normalized.category || '';
        if ($('question-input')) $('question-input').value = storageText(normalized.question);
        if ($('explanation-input')) $('explanation-input').value = storageText(normalized.explanation);
        [0, 1, 2, 3].forEach((index) => { if ($(`option-${index}`)) $(`option-${index}`).value = storageText(normalized.options?.[index]); });
        state.answer = Number(normalized.correctAnswer ?? normalized.correct ?? 0);
        state.tfAnswers = (normalized.statements || []).map((item) => parseBool(item.answer ?? item.correctAnswer));
        while (state.tfAnswers.length < 4) state.tfAnswers.push(true);
        ensureTypeEditor(normalized.qType); setAnswer(state.answer);
        if (normalized.qType === 'tf_group') normalized.statements.forEach((item, index) => { if ($(`tf-${index}`)) $(`tf-${index}`).value = storageText(item.text); });
        if (normalized.qType === 'short_answer' && $('correct-value-input')) $('correct-value-input').value = normalized.correctValue || '';
        renderPreview();
    }

    function normalizeAiQuestion(raw) {
        const rawType = String(raw?.type ?? raw?.q_type ?? raw?.qType ?? '').trim().toLowerCase().replace(/[-\s]/g, '_');
        const inferredShortAnswer = !rawType && (raw?.answer !== undefined || raw?.correctAnswer !== undefined || raw?.correct_value !== undefined || raw?.correctValue !== undefined || raw?.acceptedAnswer !== undefined || raw?.acceptedValues !== undefined) && !Array.isArray(raw?.options) && !Array.isArray(raw?.subQuestions) && !Array.isArray(raw?.statements);
        const type = rawType === 'multiple_choice' || rawType === 'multiplechoice' || rawType === 'mcq' ? 'mcq' : rawType === 'true_false' || rawType === 'truefalse' || rawType === 'tf_group' || rawType === 'tf' ? 'tf_group' : rawType === 'short_answer' || rawType === 'short' || rawType === 'fill_blank' || rawType === 'fill_in_the_blank' || rawType === 'shortanswer' || rawType === 'tra_loi_ngan' || rawType === 'trả_lời_ngắn' || rawType === 'text_answer' || rawType === 'free_text' || inferredShortAnswer ? 'short_answer' : 'mcq';
        if (type === 'tf_group') {
            const rawStatements = Array.isArray(raw?.subQuestions) ? raw.subQuestions : (Array.isArray(raw?.statements) ? raw.statements : []);
            return { ...raw, qType: 'tf_group', q_type: 'tf_group', question: raw?.question ?? '', statements: rawStatements.slice(0, 4).map((item, index) => ({ key: 'abcd'[index], label: 'abcd'[index], text: item.math || item.latex || item.formula ? { text: item.content ?? item.text ?? '', math: item.math ?? item.latex ?? item.formula } : item.content ?? item.text ?? '', answer: parseBool(item.correctAnswer ?? item.answer) })), options: [], explanation: raw?.explanation ?? '' };
        }
        if (type === 'short_answer') {
            const rawAcceptedValues = raw?.acceptedValues ?? raw?.accepted_values;
            const acceptedValues = Array.isArray(rawAcceptedValues) ? rawAcceptedValues : rawAcceptedValues !== undefined && rawAcceptedValues !== null ? [rawAcceptedValues] : [];
            const rawAnswer = raw?.correctAnswer ?? raw?.correct_answer ?? raw?.correct_value ?? raw?.correctValue ?? raw?.acceptedAnswer ?? raw?.accepted_answer ?? raw?.answer ?? raw?.correct ?? raw?.value ?? acceptedValues[0] ?? '';
            const answerValue = rawAnswer && typeof rawAnswer === 'object' && !Array.isArray(rawAnswer) ? (rawAnswer.value ?? rawAnswer.answer ?? rawAnswer.text ?? '') : Array.isArray(rawAnswer) ? rawAnswer[0] ?? '' : rawAnswer;
            return { ...raw, qType: 'short_answer', q_type: 'short_answer', question: raw?.question ?? raw?.prompt ?? raw?.text ?? '', options: [], statements: [], correctValue: String(answerValue ?? ''), acceptedValues: acceptedValues.map((value) => String(value)), explanation: raw?.explanation ?? '' };
        }
        return { ...raw, qType: 'mcq', q_type: 'mcq', question: raw?.question ?? '', options: Array.isArray(raw?.options) ? raw.options : [], statements: [], correct: Number(raw?.correctAnswer ?? raw?.correct ?? raw?.answer ?? 0), correctAnswer: Number(raw?.correctAnswer ?? raw?.correct ?? raw?.answer ?? 0), explanation: raw?.explanation ?? '' };
    }

    function toRecord(q, subjectKey, id) {
        const normalized = normalizeAiQuestion(q);
        const record = {
            ...(id ? { id: Number(id) } : {}), subject_key: subjectKey || normalized.subject_key || 'history', category: normalized.category || 'Bài tập',
            q_type: normalized.qType, question: storageText(normalized.question), options: normalized.qType === 'mcq' ? normalized.options.map(storageText) : [],
            statements: normalized.qType === 'tf_group' ? normalized.statements.map((item, index) => ({ key: item.key || 'abcd'[index], label: item.label || item.key || 'abcd'[index], text: storageText(item.text ?? item.content), answer: parseBool(item.answer ?? item.correctAnswer) })) : [],
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
            const recordId = state.editingId || await nextQuestionId();
            const record = toRecord(q, q.subject_key, recordId);
            const { error } = await state.client.from('quiz_questions').upsert(record, { onConflict: 'id' }).select();
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

    async function deleteAllQuestions() {
        const total = state.questions.length;
        if (!window.confirm(`Xóa toàn bộ ${total} câu hỏi trong ngân hàng? Hành động này không thể hoàn tác.`)) return;
        try {
            const { error } = await state.client.from('quiz_questions').delete().not('id', 'is', null);
            if (error) throw error;
            const { count, error: verifyError } = await state.client.from('quiz_questions').select('id', { count: 'exact', head: true });
            if (verifyError) throw verifyError;
            if (Number(count || 0) !== 0) throw new Error(`Cloud còn ${count} câu chưa xóa.`);
            state.questions = [];
            notify(`Đã xóa toàn bộ ${total} câu hỏi.`);
            renderStats(); renderLibrary(); renderRecentActivity(); renderSubjectCatalog();
            await syncSubjectQuestionCounts();
        } catch (error) {
            notify(`Không thể xóa toàn bộ ngân hàng: ${error.message}`, true);
            await loadQuestions();
        }
    }

    async function deleteSubjectQuestions(key) {
        const subject = state.subjects.find((item) => (item.key || item.subject_key) === key);
        const name = subject?.name || key;
        const currentCount = state.questions.filter((question) => subjectMatchKey(question.subject_key || question.subjectKey) === subjectMatchKey(key)).length;
        if (!currentCount && !window.confirm(`Không thấy câu hỏi đã tải cho môn ${name}. Vẫn kiểm tra và dọn dữ liệu Cloud?`)) return;
        if (currentCount && !window.confirm(`Xóa toàn bộ ${currentCount} câu hỏi của môn ${name}? Hành động này không thể hoàn tác.`)) return;
        try {
            const { error } = await state.client.from('quiz_questions').delete().eq('subject_key', key);
            if (error) throw error;
            const { count, error: verifyError } = await state.client.from('quiz_questions').select('id', { count: 'exact', head: true }).eq('subject_key', key);
            if (verifyError) throw verifyError;
            if (Number(count || 0) !== 0) throw new Error(`Cloud còn ${count} câu hỏi chưa xóa được.`);
            try { localStorage.removeItem(`quiz_custom_questions_${key}`); } catch (error) { /* no-op */ }
            notify(`Đã xóa toàn bộ câu hỏi của môn ${name}.`);
            await loadQuestions();
        } catch (error) {
            notify(`Không thể xóa câu hỏi môn ${name}: ${error.message}`, true);
        }
    }

    async function adoptLegacyQuestions(key) {
        const subject = state.subjects.find((item) => (item.key || item.subject_key) === key);
        const name = subject?.name || key;
        const legacyCount = state.questions.filter((question) => subjectMatchKey(question.subject_key || question.subjectKey) === 'history').length;
        if (!legacyCount) return notify('Không còn câu hỏi cũ chưa gán môn.', true);
        if (!window.confirm(`Gán ${legacyCount} câu hỏi cũ đang ở mã history vào môn ${name}?`)) return;
        try {
            const { error } = await state.client.from('quiz_questions').update({ subject_key: key }).eq('subject_key', 'history');
            if (error) throw error;
            const { count, error: verifyError } = await state.client.from('quiz_questions').select('id', { count: 'exact', head: true }).eq('subject_key', key);
            if (verifyError) throw verifyError;
            if (Number(count || 0) < legacyCount) throw new Error(`Cloud chỉ xác minh ${count}/${legacyCount} câu đã gán.`);
            notify(`Đã đồng bộ ${legacyCount} câu hỏi vào môn ${name}.`);
            await loadQuestions();
        } catch (error) {
            notify(`Không thể đồng bộ câu hỏi vào môn ${name}: ${error.message}`, true);
        }
    }

    async function extractFile(file) {
        const name = file.name.toLowerCase();
        return file.text();
    }

    function openModal(id) { $(id)?.classList.remove('hidden'); }
    function closeModal(id) { $(id)?.classList.add('hidden'); }

    function openImport() {
        state.importQuestions = []; state.importIndex = 0; state.sourceText = ''; state.importError = '';
        if ($('import-text')) $('import-text').value = '';
        if ($('import-preview')) $('import-preview').innerHTML = '<p class="muted-copy">Dán JSON câu hỏi rồi bấm “Đọc JSON” để xem trước và lưu.</p>';
        fillLibrarySubjects(); switchView('questions'); openModal('import-modal');
    }

    function parseJsonInput(text) {
        state.importError = '';
        try {
            const parsed = JSON.parse(text);
            const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.questions) ? parsed.questions : [parsed]);
            const normalized = list.map(normalizeAiQuestion);
            const structureErrors = validateAiQuestionSet(normalized);
            if (structureErrors.length) {
                state.importError = structureErrors.slice(0, 3).join('; ');
                console.warn('[Quiz Studio Admin] JSON import rejected:', {
                    errors: structureErrors,
                    rawTypes: list.map((item) => item?.type ?? item?.q_type ?? item?.qType ?? null),
                    normalizedTypes: normalized.map((item) => item.qType),
                    keys: list.map((item) => Object.keys(item || {})),
                    shortAnswerValues: normalized.map((item) => item.qType === 'short_answer' ? item.correctValue : undefined)
                });
                return [];
            }
            state.importIntegrity = validateVerbatimQuestions(normalized, text);
            return normalized;
        } catch (error) {
            state.importError = `JSON lỗi cú pháp: ${error.message}`;
            console.warn('[Quiz Studio Admin] JSON import parse error:', error.message);
            return [];
        }
    }

    function extractJsonPayload(raw) {
        const text = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        const candidates = [text];
        const arrayStart = text.indexOf('[');
        const arrayEnd = text.lastIndexOf(']');
        if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(text.slice(arrayStart, arrayEnd + 1));
        const objectStart = text.indexOf('{');
        const objectEnd = text.lastIndexOf('}');
        if (objectStart >= 0 && objectEnd > objectStart) candidates.push(text.slice(objectStart, objectEnd + 1));
        for (const candidate of candidates) {
            try {
                const parsed = JSON.parse(candidate);
                const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.questions) ? parsed.questions : (Array.isArray(parsed.data) ? parsed.data : [parsed]));
                if (list.length) return list;
            } catch (error) { /* Try the next JSON boundary. */ }
        }
        throw new Error('Dữ liệu không phải JSON hợp lệ hoặc không có câu hỏi.');
    }

    function persistImportDraft() {
        try {
            sessionStorage.setItem('quiz_import_draft', JSON.stringify({ questions: state.importQuestions, sourceText: state.sourceText, subject: state.importSubject, integrity: state.importIntegrity }));
        } catch (error) { console.warn('Không thể lưu bản nháp nhập câu hỏi:', error); }
    }

    function restoreImportDraft() {
        try {
            const draft = JSON.parse(sessionStorage.getItem('quiz_import_draft') || 'null');
            if (!draft || !Array.isArray(draft.questions) || !draft.questions.length) return false;
            state.importQuestions = draft.questions.map(normalizeAiQuestion);
            state.sourceText = draft.sourceText || '';
            state.importSubject = draft.subject || state.importSubject;
            state.importIntegrity = draft.integrity || validateVerbatimQuestions(state.importQuestions, state.sourceText);
            state.importIndex = 0;
            fillForm(state.importQuestions[0]);
            renderImportReview();
            return true;
        } catch (error) { return false; }
    }

    function renderImportReview() {
        const root = $('import-preview');
        if (!root) return;
        if (!state.importQuestions.length) { root.innerHTML = '<p class="muted-copy">Chưa có câu hỏi đã đọc.</p>'; return; }
        const q = normalizeAiQuestion(state.importQuestions[state.importIndex]);
        const type = TYPE_LABELS[q.qType] || TYPE_LABELS.mcq;
        const detail = q.qType === 'tf_group' ? q.statements.map((item) => `<div class="tf-preview-row"><b>${esc(item.key)}</b><span>${htmlText(item.text)}</span><span class="tf-preview-answer ${item.answer ? '' : 'false'}">${item.answer ? 'ĐÚNG' : 'SAI'}</span></div>`).join('') : q.qType === 'short_answer' ? `<div class="item-option is-correct">Đáp án: ${esc(q.correctValue)}</div>` : q.options.map((item, index) => `<div class="preview-option ${index === q.correct ? 'is-correct' : ''}"><b>${'ABCD'[index]}</b><span>${htmlText(item)}</span></div>`).join('');
        const integrity = state.importIntegrity.valid ? '<div class="strict-warning"><i class="fa-solid fa-lock"></i><span>Giữ nguyên nội dung và thứ tự theo JSON đã đọc. Hãy duyệt từng câu trước khi lưu.</span></div>' : `<div class="strict-warning" style="border-color:#fca5a5;background:#fff0f0;color:#b91c1c"><i class="fa-solid fa-triangle-exclamation"></i><span>Không khớp nguyên văn một số trường sau khi chuẩn hóa khoảng trắng: ${esc(state.importIntegrity.errors.join(' | '))}. Khi bấm lưu, Admin sẽ được hỏi xác nhận tiếp tục.</span></div>`;
        root.innerHTML = `<div class="ai-review"><div class="ai-review-toolbar"><b>Câu ${state.importIndex + 1}/${state.importQuestions.length} · ${esc(type)}</b><div><button type="button" class="button button-secondary compact" data-import-prev ${state.importIndex === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button> <button type="button" class="button button-secondary compact" data-import-next ${state.importIndex === state.importQuestions.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div></div><div class="ai-review-list">${state.importQuestions.map((item, index) => `<button type="button" class="ai-review-index ${index === state.importIndex ? 'is-active' : ''}" data-import-index="${index}">Câu ${index + 1}</button>`).join('')}</div><div class="ai-review-question"><b>${htmlText(q.question)}</b><div style="margin-top:9px">${detail}</div><p class="muted-copy">${htmlText(q.explanation)}</p></div>${integrity}</div>`;
        renderMath(root);
    }

    function validateVerbatimQuestions(questions, source) {
        if (!source) return { valid: true, errors: [] };
        const errors = [];
        const normalizeVerbatim = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
        const normalizedSource = normalizeVerbatim(source);
        const check = (value, label) => {
            const normalizedValue = normalizeVerbatim(value);
            if (normalizedValue && !normalizedSource.toLowerCase().includes(normalizedValue.toLowerCase())) errors.push(label);
        };
        questions.forEach((raw, index) => {
            const q = normalizeAiQuestion(raw);
            check(notationText(q.question), `Câu ${index + 1}: câu hỏi`);
            if (q.qType === 'mcq') q.options.forEach((value, optionIndex) => check(notationText(value), `Câu ${index + 1}: phương án ${'ABCD'[optionIndex]}`));
            if (q.qType === 'tf_group') q.statements.forEach((value, statementIndex) => check(notationText(value.text ?? value.content), `Câu ${index + 1}: ý ${'abcd'[statementIndex]}`));
        });
        return { valid: errors.length === 0, errors };
    }

    function validateAiQuestionSet(questions) {
        const errors = [];
        questions.forEach((question, index) => {
            const q = normalizeAiQuestion(question);
            if (!notationText(q.question).trim()) errors.push(`Câu ${index + 1} thiếu nội dung`);
            if (q.qType === 'mcq') {
                if (q.options.length !== 4 || q.options.some((option) => !notationText(option).trim())) errors.push(`Câu ${index + 1} MCQ phải đủ A/B/C/D`);
                if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) errors.push(`Câu ${index + 1} MCQ thiếu đáp án đúng`);
            } else if (q.qType === 'tf_group') {
                if (q.statements.length !== 4 || q.statements.some((statement) => !notationText(statement.text).trim())) errors.push(`Câu ${index + 1} Đúng/Sai phải đủ a/b/c/d`);
                if (q.statements.some((statement) => typeof statement.answer !== 'boolean')) errors.push(`Câu ${index + 1} Đúng/Sai thiếu đáp án`);
            } else if (q.qType === 'short_answer' && !String(q.correctValue || '').trim()) {
                errors.push(`Câu ${index + 1} trả lời ngắn thiếu đáp án`);
            }
        });
        return errors;
    }

    /* Gemini is intentionally not used for question import. */
    async function analyzeWithGemini() {
        return notify('Gemini phân tích đề đã được tắt. Hãy dán JSON rồi bấm Đọc JSON.', true);
        /* if (false) {
        const source = $('import-text')?.value || state.sourceText;
        if (!source) return notify('Chưa có văn bản đề để phân tích.', true);
        if (state.geminiQuotaBlocked) return notify(geminiQuotaMessage, true);
        const apiKey = await fetchGeminiKey();
        if (!apiKey) return notify('Chưa cấu hình Gemini API Key trong mục Báo cáo & dữ liệu.', true);
        const button = $('ai-analyze-import');
        if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gemini đang phân tích...'; }
        const schemaInstruction = `[
  { "type": "multiple_choice", "question": "Giữ nguyên 100% câu chữ đề bài", "options": ["Nội dung A", "Nội dung B", "Nội dung C", "Nội dung D"], "correctAnswer": 0, "explanation": "Giải thích ngắn gọn 1-2 câu" },
  { "type": "true_false", "question": "Đoạn thông tin / ngữ liệu dẫn của đề bài", "subQuestions": [ { "id": "a", "content": "Nội dung ý a", "correctAnswer": true }, { "id": "b", "content": "Nội dung ý b", "correctAnswer": false }, { "id": "c", "content": "Nội dung ý c", "correctAnswer": true }, { "id": "d", "content": "Nội dung ý d", "correctAnswer": false } ], "explanation": "Giải thích ngắn gọn 1-2 câu" },
  { "type": "short_answer", "question": "Nội dung câu hỏi tính toán hoặc điền từ", "correctAnswer": "Giá trị số hoặc từ khóa chính xác", "explanation": "Giải thích ngắn gọn 1-2 câu" }
]`;
        const prompt = `Bạn là bộ phân tích đề thi. Trả về DUY NHẤT một mảng JSON hợp lệ, không markdown, không lời dẫn.\n\nSCHEMA BẮT BUỘC (mỗi phần tử chỉ dùng đúng một type):\n${schemaInstruction}\n\nSTRICT PRESERVATION RULES:\n1. Sao chép nguyên văn tuyệt đối câu hỏi, phương án và từng ý từ SOURCE. Không sửa chính tả, không chuẩn hóa dấu câu, không tóm tắt, không dịch, không viết lại, không bỏ ký hiệu, số, đơn vị, xuống dòng có ý nghĩa.\n2. Giữ nguyên thứ tự câu hỏi và giữ nguyên thứ tự A/B/C/D hoặc a/b/c/d. Không xáo trộn.\n3. Chỉ được tự suy luận correctAnswer và explanation để giải đáp; tuyệt đối không suy luận rồi sửa phần văn bản.\n4. Với multiple_choice, correctAnswer là số nguyên 0-3. Với true_false, luôn trả đủ bốn subQuestions theo đúng thứ tự a,b,c,d và correctAnswer là boolean. Với short_answer, correctAnswer là chuỗi đáp án chính xác.\n5. Nếu không chắc chắn, vẫn giữ nguyên văn bản và chọn đáp án tốt nhất theo kiến thức; không thêm câu chữ vào question/options/content.\n\nSOURCE (copy nguyên văn, không chỉnh sửa):\n<<<SOURCE_START>>>\n${source}\n<<<SOURCE_END>>>`;
        const models = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-3.1-pro-preview'];
        const enforcedPrompt = `${prompt}\n\nBẮT BUỘC: Phân loại đúng từng câu theo đề gốc. Câu có A/B/C/D phải là multiple_choice, giữ nguyên đúng vị trí A/B/C/D và tự chọn correctAnswer 0-3. Câu có a/b/c/d phải là true_false với đủ bốn ý và tự chọn boolean đúng/sai. Câu yêu cầu tính hoặc điền đáp án phải là short_answer với correctAnswer chính xác. Không được biến tất cả thành MCQ. Explanation chỉ tối đa 1-2 câu.`;
        try {
            let response; let lastError = '';
            const maxOutputTokens = Math.min(24576, Math.max(4096, Math.ceil(source.length / 2.2)));
            for (const model of models) {
                try {
                    response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: enforcedPrompt }] }], generationConfig: { temperature: 0, maxOutputTokens, responseMimeType: 'application/json' } }) }, 60000);
                    if (response.ok) break;
                    const errorData = await response.json().catch(() => ({}));
                    lastError = errorData?.error?.message || `HTTP ${response.status}`;
                    if (isGeminiQuotaError(response.status, lastError)) {
                        state.geminiQuotaBlocked = true;
                        throw new Error(geminiQuotaMessage);
                    }
                    if (response.status === 400 || response.status === 401 || response.status === 403) break;
                } catch (error) {
                    if (error.message === geminiQuotaMessage) throw error;
                    lastError = error.name === 'AbortError' ? `${model} phản hồi quá 60 giây.` : error.message;
                }
            }
            if (!response?.ok) throw new Error(lastError || 'Gemini không phản hồi.');
            const data = await response.json();
            const raw = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
            const parsedList = extractJsonPayload(raw);
            state.importQuestions = parsedList.map(normalizeAiQuestion);
            const structureErrors = validateAiQuestionSet(state.importQuestions);
            if (structureErrors.length) throw new Error(`AI trả về đề chưa đủ cấu trúc: ${structureErrors.slice(0, 3).join('; ')}`);
            state.importIndex = 0;
            state.importIntegrity = validateVerbatimQuestions(state.importQuestions, source);
            state.importError = '';
            persistImportDraft();
            if (state.importQuestions.length) fillForm(state.importQuestions[0]);
            renderImportReview();
            notify(`Gemini đã phân tích ${state.importQuestions.length} câu. Hãy duyệt trước khi lưu.`);
        } catch (error) {
            const detail = isGeminiQuotaError(0, error.message) ? geminiQuotaMessage : /api key|api_key|invalid argument|permission denied/i.test(error.message)
                ? 'Gemini API Key không hợp lệ hoặc đã hết hạn. Vào Báo cáo & dữ liệu, xóa key cũ, nhập key mới rồi bấm Kiểm tra key.'
                : error.message;
            state.importError = detail;
            notify(`AI phân tích thất bại: ${detail}`, true);
        }
        finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Gemini phân tích & giải';
            }
        }
        } */
    }

    async function saveImportQuestions() {
        if (!state.importQuestions.length) {
            if (restoreImportDraft()) return notify('Đã khôi phục bản nháp câu hỏi. Bấm Lưu vào ngân hàng để tiếp tục.');
            return notify(state.importError || 'Chưa có câu hỏi để lưu. Hãy dán JSON hợp lệ rồi bấm Đọc JSON.', true);
        }
        if (!state.importIntegrity.valid && !window.confirm('Không thể xác minh hoàn toàn văn bản nguồn. Admin vẫn muốn tiếp tục lưu các câu hỏi này?')) return;
        if ($('import-replace')?.checked && !window.confirm('Xóa toàn bộ câu hỏi cũ của môn này trước khi nạp?')) return;
        try {
            const selectedSubject = String($('import-subject-select')?.value || state.importSubject || '').trim();
            if (!selectedSubject) throw new Error('Chưa chọn môn đích cho bộ câu hỏi.');
            // Quan trọng: dùng đúng giá trị mới nhất từ dropdown, không dùng
            // state cũ còn sót lại từ lần import trước.
            state.importSubject = selectedSubject;
            if ($('import-replace')?.checked) {
                const { error } = await state.client.from('quiz_questions').delete().eq('subject_key', selectedSubject);
                if (error) throw error;
            }
            const firstId = await nextQuestionId();
            const records = state.importQuestions.map((item, index) => toRecord(item, selectedSubject, firstId + index));
            for (let index = 0; index < records.length; index += 50) {
                const { error } = await state.client.from('quiz_questions').insert(records.slice(index, index + 50));
                if (error) throw error;
            }
            // Đọc lại ngay sau khi ghi để không báo thành công giả khi RLS,
            // subject_key hoặc payload có vấn đề.
            const { data: verified, error: verifyError } = await state.client
                .from('quiz_questions')
                .select('id, subject_key')
                .eq('subject_key', selectedSubject)
                .order('id', { ascending: true });
            if (verifyError) throw verifyError;
            const verifiedCount = Array.isArray(verified) ? verified.length : 0;
            if (verifiedCount < records.length) {
                throw new Error(`Cloud chỉ xác minh ${verifiedCount}/${records.length} câu ở môn ${selectedSubject}.`);
            }
            console.debug('[Quiz Studio Admin] Import verified on Cloud:', { subjectKey: selectedSubject, imported: records.length, cloudCount: verifiedCount });
            notify(`Đã lưu và xác minh ${records.length} câu vào môn ${selectedSubject}.`);
             sessionStorage.removeItem('quiz_import_draft');
             closeModal('import-modal'); await loadQuestions();
        } catch (error) { notify(`Không thể lưu danh sách: ${error.message}`, true); }
    }

    async function handleImportFile(file) {
        if (!file) return;
        try {
            const source = await file.text();
            $('import-text').value = source;
            const list = parseJsonInput(source);
            if (!list.length) throw new Error('File không chứa JSON câu hỏi hợp lệ.');
            state.sourceText = source;
            state.importQuestions = list;
            state.importError = '';
            state.importIndex = 0;
            state.importIntegrity = validateVerbatimQuestions(list, source);
            persistImportDraft();
            fillForm(list[0]);
            renderImportReview();
            notify(`Đã đọc ${list.length} câu từ ${file.name}.`);
        } catch (error) {
            notify(`Không thể đọc file: ${error.message}`, true);
        }
    }

    async function fetchGeminiKey() {
        let key = '';
        const row = await systemRow(SYSTEM.gemini);
        if (row?.status === 'ACTIVE' && row?.score_summary) key = row.score_summary;
        return cleanGeminiKey(key);
    }

    async function saveGeminiKey() {
        const key = cleanGeminiKey($('gemini-key-input')?.value);
        if (!key) return notify('Hãy nhập Gemini API Key.', true);
        if (!isValidGeminiKey(key)) return notify('API Key không đúng định dạng Google Gemini. Key thường bắt đầu bằng AIza hoặc AQ.', true);
        const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.gemini, player_name: '__GEMINI_CONFIG__', ip_address: 'SYSTEM', device_info: 'GEMINI_AI', status: 'ACTIVE', score_summary: key, last_active: new Date().toISOString() }, { onConflict: 'id' });
        if (error) return notify(`Không thể lưu API Key: ${error.message}`, true);
        $('gemini-key-input').value = ''; notify('Đã lưu Gemini API Key lên Cloud. Hãy tải lại trang học sinh để nhận key mới.');
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
            const testModels = ['gemini-3.8-flash', 'gemini-3.1-pro-preview'];
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
                    if (isGeminiQuotaError(response.status, lastError)) throw new Error(geminiQuotaMessage);
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
            notify(isGeminiQuotaError(0, error.message) ? geminiQuotaMessage : `Gemini API Key không hợp lệ: ${error.message}`, true);
        } finally {
            if (button) { button.disabled = false; button.innerHTML = '<i class="fa-solid fa-plug"></i> Kiểm tra key'; }
        }
    }

    function switchView(view) {
        if (view === 'subjects') view = 'questions';
        const titles = { overview: 'Tổng quan', questions: 'Ngân hàng & môn học', students: 'Giám sát học sinh', access: 'Quyền truy cập', reports: 'Báo cáo & dữ liệu' };
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

    function mergeContentLibraryView() {
        const library = document.querySelector('[data-view-panel="questions"]');
        const subjects = document.querySelector('[data-view-panel="subjects"]');
        if (!library || !subjects || subjects.dataset.merged === 'true') return;

        const heading = subjects.querySelector('.page-heading');
        if (heading) {
            heading.querySelector('h1')?.replaceChildren(document.createTextNode('Môn học & quyền riêng tư'));
            const copy = heading.querySelector('p:not(.eyebrow)');
            if (copy) copy.textContent = 'Tạo môn học, gán quyền riêng tư và nạp câu hỏi vào đúng môn trong cùng một khu vực.';
            heading.classList.add('content-library-subheading');
        }

        const divider = document.createElement('div');
        divider.className = 'content-library-divider';
        divider.innerHTML = '<span class="eyebrow">SUBJECT CATALOG</span><strong>Môn học &amp; quyền riêng tư</strong><small>Các câu hỏi mới sẽ được đồng bộ theo môn đích đã chọn.</small>';
        library.appendChild(divider);
        while (subjects.firstElementChild) library.appendChild(subjects.firstElementChild);
        subjects.dataset.merged = 'true';
        subjects.remove();
    }

    function configureAdminLabels() {
        const reportsDescription = document.querySelector('[data-view-panel="reports"] .page-heading p:not(.eyebrow)');
        if (reportsDescription) reportsDescription.textContent = 'Xuất kết quả, cấu hình giải thích bài tập, sao lưu dữ liệu và chuẩn bị cho kỳ thi mới.';
        const aiHeading = document.querySelector('.ai-config-panel h2');
        const aiDescription = document.querySelector('.ai-config-panel .muted-copy');
        if (aiHeading) aiHeading.textContent = 'Cấu hình giải thích bài tập';
        if (aiDescription) aiDescription.textContent = 'Nhập Gemini API key để dùng nút “Hỏi AI giải thích chi tiết” trên bài tập. API key được lưu trên Cloud.';
        const quickImport = $('quick-import');
        if (quickImport) {
            const title = quickImport.querySelector('b');
            const description = quickImport.querySelector('small');
            if (title) title.textContent = 'Nạp JSON câu hỏi';
            if (description) description.textContent = 'JSON hoặc TXT';
        }
        const importButton = $('import-button');
        if (importButton) importButton.innerHTML = '<i class="fa-solid fa-file-import"></i> Nạp JSON';
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
        if (aiRow?.status === 'ACTIVE') { try { const data = JSON.parse(aiRow.score_summary || '[]'); state.aiIps = Array.isArray(data) ? data : data.ips || []; } catch (error) { state.aiIps = []; } } else state.aiIps = [];
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
        const grid = document.querySelector('[data-view-panel="questions"] .geo-grid') || document.querySelector('[data-view-panel="subjects"] .geo-grid');
        if (!grid || document.getElementById('class5-ip-list')) return;
        grid.insertAdjacentHTML('beforeend', '<section class="panel class5-access-panel"><div class="panel-title"><div><p class="eyebrow">CLASS 5 ACCESS</p><h2>Quyền riêng Lớp 5</h2><p class="muted-copy">Chỉ các IP bên dưới mới thấy môn Lớp 5. IP khác mặc định chỉ thấy Lớp 11.</p></div><span id="class5-ip-count" class="status-badge safe">0 IP</span></div><div class="inline-form"><input id="class5-ip-input" name="class5-access-ip" autocomplete="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" placeholder="Nhập địa chỉ IP..."><button id="add-class5-ip" class="button button-primary"><i class="fa-solid fa-user-plus"></i> Cấp quyền</button></div><button id="add-current-class5-ip" class="text-button"><i class="fa-solid fa-location-crosshairs"></i> Cấp quyền cho IP máy này</button><div id="class5-ip-list" class="stack-list"></div></section>');
        const input = $('class5-ip-input');
        if (input) {
            input.readOnly = true;
            input.value = '';
            input.addEventListener('focus', () => {
                input.readOnly = false;
                input.value = '';
            });
            requestAnimationFrame(() => { if (document.activeElement !== input) input.value = ''; });
            setTimeout(() => { if (document.activeElement !== input) input.value = ''; }, 250);
        }
    }

    async function loadGeo() { const normalizeIp = (ip) => String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase(); const row = await systemRow(SYSTEM.geo); if (row) { try { const data = JSON.parse(row.score_summary || '{}'); state.geo = { mode: data.mode || row.device_info || 'PUBLIC', ips: (data.ips || []).map(normalizeIp).filter(Boolean), grade5Ips: (data.grade5Ips || data.grade5_ips || []).map(normalizeIp).filter(Boolean) }; console.debug('[Quiz Studio Admin] Loaded Grade 5 access config:', { stateGeo: state.geo, raw: data }); } catch (error) { console.warn('[Quiz Studio Admin] Invalid Grade 5 access config:', error.message); } } ensureClass5AccessPanel(); renderGeo(); }
    function renderGeo() { ensureClass5AccessPanel(); $('geo-mode-badge') && ($('geo-mode-badge').textContent = state.geo.mode); document.querySelectorAll('[data-geo-mode]').forEach((button) => button.classList.toggle('is-active', button.dataset.geoMode === state.geo.mode)); $('geo-ip-list') && ($('geo-ip-list').innerHTML = state.geo.ips.map((ip) => `<div class="stack-item"><span class="stack-item-icon"><i class="fa-solid fa-location-dot"></i></span><span class="stack-item-main"><b>${esc(ip)}</b><small>Được phép truy cập Địa lý</small></span><button data-remove-geo="${esc(ip)}"><i class="fa-solid fa-xmark"></i></button></div>`).join('') || '<p class="muted-copy">Danh sách IP trống.</p>'); const class5Ips = Array.isArray(state.geo.grade5Ips) ? state.geo.grade5Ips : []; $('class5-ip-count') && ($('class5-ip-count').textContent = `${class5Ips.length} IP`); $('class5-ip-list') && ($('class5-ip-list').innerHTML = class5Ips.map((ip) => `<div class="stack-item"><span class="stack-item-icon"><i class="fa-solid fa-graduation-cap"></i></span><span class="stack-item-main"><b>${esc(ip)}</b><small>Được phép xem Lớp 5</small></span><button data-remove-class5="${esc(ip)}"><i class="fa-solid fa-xmark"></i></button></div>`).join('') || '<p class="muted-copy">Chưa cấp quyền cho IP nào.</p>'); }
    async function saveGeo() { const normalizeIp = (ip) => String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase(); const payload = { mode: state.geo.mode, ips: [...new Set((state.geo.ips || []).map(normalizeIp).filter(Boolean))], grade5Ips: [...new Set((state.geo.grade5Ips || []).map(normalizeIp).filter(Boolean))] }; state.geo = { ...state.geo, ...payload }; console.debug('[Quiz Studio Admin] Saving Grade 5 access config:', payload); const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.geo, player_name: '__ALLOWED_GEO_IPS__', ip_address: 'SYSTEM', device_info: state.geo.mode, status: 'ACTIVE', score_summary: JSON.stringify(payload), last_active: new Date().toISOString() }, { onConflict: 'id' }); if (error) throw error; renderGeo(); }
    async function addClass5Ip(ip) { const cleanIp = String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase(); if (!cleanIp) return notify('Nhập IP máy của em bạn.', true); state.geo.grade5Ips = Array.isArray(state.geo.grade5Ips) ? state.geo.grade5Ips : []; if (!state.geo.grade5Ips.includes(cleanIp)) state.geo.grade5Ips.push(cleanIp); await saveGeo(); notify(`Đã cấp quyền Lớp 5 cho IP ${cleanIp}.`); }
    async function removeClass5Ip(ip) { state.geo.grade5Ips = (state.geo.grade5Ips || []).filter((item) => item !== ip); await saveGeo(); notify(`Đã thu hồi quyền Lớp 5 của IP ${ip}.`); }

    function renderSubjectCatalog() {
        const subjects = mergeSubjectCatalog(state.subjects);
        const questionCounts = (state.questions || []).reduce((counts, question) => {
            const key = subjectMatchKey(question.subject_key || question.subjectKey);
            if (key) counts[key] = (counts[key] || 0) + 1;
            return counts;
        }, {});
        const legacyCount = questionCounts.history || 0;
        console.debug('[Quiz Studio Admin] Subject count diagnostics:', subjects.map((subject) => ({
            key: subject.key,
            storedCount: Number(subject.count || 0),
            loadedQuestionCount: questionCounts[subjectMatchKey(subject.key)] || 0
        })));
        $('subject-count') && ($('subject-count').textContent = subjects.length);
        $('subjects-list') && ($('subjects-list').innerHTML = subjects.map((subject) => { const key = subject.key || subject.subject_key; const count = questionCounts[subjectMatchKey(key)] || 0; const canAdoptLegacy = subjectMatchKey(key) !== 'history' && legacyCount > 0; return `<article class="subject-card"><div class="subject-card-head"><span class="subject-card-icon"><i class="fa-solid ${esc(subject.icon || 'fa-book')}"></i></span><span class="tag">Lớp ${subjectGrade(subject)}</span></div><h3>${esc(subject.name || subject.title || subject.key)}</h3><p>${esc(subject.key)} · ${esc(subject.semester || 'Không chia kỳ')} · <b>${count} câu</b></p>${canAdoptLegacy ? `<small class="subject-orphan-note">${legacyCount} câu cũ chưa gán môn</small>` : ''}<div class="subject-card-foot"><small>${esc(subject.visibility === 'PRIVATE' ? 'Riêng tư' : 'Công khai')}</small><div class="subject-card-actions"><button data-edit-subject="${esc(subject.key)}" aria-label="Sửa môn ${esc(subject.name || subject.key)}" title="Sửa môn"><i class="fa-solid fa-pen"></i></button>${canAdoptLegacy ? `<button class="adopt-button" data-adopt-subject-questions="${esc(subject.key)}" aria-label="Gán câu hỏi cũ vào môn ${esc(subject.name || subject.key)}" title="Gán câu hỏi cũ vào môn"><i class="fa-solid fa-link"></i></button>` : ''}<button data-delete-subject-questions="${esc(subject.key)}" aria-label="Xóa toàn bộ câu hỏi môn ${esc(subject.name || subject.key)}" title="Xóa toàn bộ câu hỏi"><i class="fa-solid fa-eraser"></i></button><button data-delete-subject="${esc(subject.key)}" aria-label="Xóa môn ${esc(subject.name || subject.key)}" title="Xóa môn và câu hỏi"><i class="fa-solid fa-trash"></i></button></div></div></article>`; }).join('') || '<div class="empty-state">Chưa có môn học.</div>');
        renderSubjectPrivacy();
    }

    async function loadSubjects() {
        const row = await systemRow(SYSTEM.subjects);
        if (row?.score_summary) { try { const data = JSON.parse(row.score_summary); state.subjects = Array.isArray(data) ? data : []; } catch (error) { state.subjects = []; } }
        state.subjects = mergeSubjectCatalog(state.subjects);
        await syncSubjectQuestionCounts();
        fillSubjects($('grade-select')?.value || '11');
        fillLibrarySubjects();
        renderSubjectCatalog();
        upgradePrivacyPanel();
    }

    function upgradePrivacyPanel() {
        const grid = document.querySelector('[data-view-panel="questions"] .geo-grid') || document.querySelector('[data-view-panel="subjects"] .geo-grid');
        if (!grid || grid.dataset.upgraded === 'true') { ensureClass5AccessPanel(); renderSubjectPrivacy(); return; }
        grid.dataset.upgraded = 'true';
        ensureClass5AccessPanel();
        renderSubjectPrivacy();
    }

    function renderSubjectPrivacy() {
        const list = $('subject-privacy-list');
        if (!list) return;
        const subjects = mergeSubjectCatalog(state.subjects);
        const privateCount = subjects.filter((subject) => subject.visibility === 'PRIVATE').length;
        $('privacy-private-count') && ($('privacy-private-count').textContent = `${privateCount} RIÊNG TƯ`);
        $('privacy-private-count') && ($('privacy-private-count').className = `status-badge ${privateCount ? 'danger' : 'safe'}`);
        list.innerHTML = subjects.map((subject) => {
            const isPrivate = subject.visibility === 'PRIVATE';
            return `<div class="privacy-subject-row"><span class="subject-card-icon"><i class="fa-solid ${esc(subject.icon || 'fa-book')}"></i></span><span class="privacy-subject-main"><b>${esc(subject.name || subject.title || subject.key)}</b><small>Lớp ${subjectGrade(subject)} · ${esc(subject.key)}</small></span><span class="status-badge ${isPrivate ? 'danger' : 'safe'}">${isPrivate ? 'RIÊNG TƯ' : 'CÔNG KHAI'}</span><label class="privacy-switch" title="${isPrivate ? 'Bật để mở môn' : 'Tắt để ẩn môn'}"><input type="checkbox" data-toggle-subject="${esc(subject.key)}" ${isPrivate ? '' : 'checked'}><span></span></label></div>`;
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
        const questionCounts = (state.questions || []).reduce((counts, question) => {
            const key = subjectMatchKey(question.subject_key || question.subjectKey);
            if (key) counts[key] = (counts[key] || 0) + 1;
            return counts;
        }, {});
        state.subjects = state.subjects.map((subject) => ({
            ...subject,
            count: questionCounts[subjectMatchKey(subject.key || subject.subject_key)] || 0
        }));
        const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.subjects, player_name: '__DYNAMIC_SUBJECTS__', ip_address: 'SYSTEM', device_info: 'DYNAMIC_HUB', status: 'ACTIVE', score_summary: JSON.stringify(state.subjects), last_active: new Date().toISOString() }, { onConflict: 'id' });
        if (error) throw error;
        const verified = await systemRow(SYSTEM.subjects);
        if (!verified?.score_summary || JSON.stringify(JSON.parse(verified.score_summary)) !== JSON.stringify(state.subjects)) throw new Error('Cloud chưa xác minh đúng danh sách môn học.');
        fillLibrarySubjects(); await loadSubjects();
    }

    function setSubjectGrade(grade) { const value = String(grade) === '5' ? '5' : '11'; if ($('subject-grade-input')) $('subject-grade-input').value = value; document.querySelectorAll('[data-subject-grade]').forEach((button) => button.classList.toggle('is-selected', button.dataset.subjectGrade === value)); }
    function moveSubjectFormToDialog() {
        const form = $('subject-form');
        const dialogContent = $('subject-dialog-content');
        const editor = document.querySelector('.subject-editor-panel');
        if (!form || !dialogContent || !editor || editor.dataset.moved === 'true') return;
        editor.dataset.moved = 'true';
        form.classList.add('subject-dialog-form');
        dialogContent.appendChild(form);
        editor.remove();
    }
    function resetSubjectForm() {
        ['subject-name-input', 'subject-key-input', 'subject-semester-input'].forEach((id) => { if ($(id)) $(id).value = ''; });
        if ($('subject-icon-input')) $('subject-icon-input').value = 'fa-book';
        if ($('subject-gradient-input')) $('subject-gradient-input').value = 'indigo';
        if ($('subject-visibility-input')) $('subject-visibility-input').value = 'PUBLIC';
        setSubjectGrade('11');
        state.subjectEditingKey = null;
        if ($('subject-editor-title')) $('subject-editor-title').textContent = 'Tạo môn học';
    }
    function closeSubjectDialog() {
        const dialog = $('subject-dialog');
        if (dialog?.open) dialog.close();
        resetSubjectForm();
    }
    function openSubjectDialog(subject = null, opener = null) {
        moveSubjectFormToDialog();
        switchView('questions');
        state.subjectDialogOpener = opener || document.activeElement;
        resetSubjectForm();
        if (subject) {
            state.subjectEditingKey = subject.key || subject.subject_key;
            $('subject-name-input').value = subject.name || subject.title || '';
            $('subject-key-input').value = state.subjectEditingKey || '';
            $('subject-semester-input').value = subject.semester || '';
            $('subject-icon-input').value = subject.icon || 'fa-book';
            $('subject-gradient-input').value = subject.gradient || 'indigo';
            $('subject-visibility-input').value = subject.visibility || 'PUBLIC';
            setSubjectGrade(subjectGrade(subject));
            $('subject-editor-title').textContent = `Sửa môn ${subject.name || state.subjectEditingKey}`;
        }
        const dialog = $('subject-dialog');
        if (!dialog) return;
        if (!dialog.open) dialog.showModal();
        window.requestAnimationFrame(() => $('subject-name-input')?.focus());
    }
    async function saveSubject(event) {
        event.preventDefault();
        const key = $('subject-key-input')?.value.trim();
        const name = $('subject-name-input')?.value.trim();
        if (!key || !name) return notify('Nhập tên và mã môn học.', true);
        const subject = { key, name, grade: $('subject-grade-input')?.value === '5' ? '5' : '11', semester: $('subject-semester-input')?.value.trim() || '', icon: $('subject-icon-input')?.value.trim() || 'fa-book', gradient: $('subject-gradient-input')?.value || 'indigo', visibility: $('subject-visibility-input')?.value || 'PUBLIC' };
        const index = state.subjects.findIndex((item) => item.key === (state.subjectEditingKey || key));
        const duplicate = state.subjects.some((item, itemIndex) => item.key === key && itemIndex !== index);
        if (duplicate) return notify('Mã định danh này đã tồn tại.', true);
        if (index >= 0) state.subjects[index] = { ...state.subjects[index], ...subject };
        else state.subjects.push(subject);
        try {
            await saveSubjects();
            closeSubjectDialog();
            notify('Đã lưu môn học.');
        } catch (error) { notify(`Không thể lưu môn học: ${error.message}`, true); }
    }
    async function deleteSubject(key) {
        if (!window.confirm(`Xóa môn ${key} và toàn bộ câu hỏi thuộc môn này?`)) return;
        const previousSubjects = state.subjects.slice();
        try {
            // Xóa ngân hàng trước; nếu Cloud không xác minh được count=0 thì
            // giữ nguyên môn để tránh tạo dữ liệu mồ côi.
            const { error: deleteError } = await state.client.from('quiz_questions').delete().eq('subject_key', key);
            if (deleteError) throw deleteError;
            const { count, error: verifyError } = await state.client.from('quiz_questions').select('id', { count: 'exact', head: true }).eq('subject_key', key);
            if (verifyError) throw verifyError;
            if (Number(count || 0) !== 0) throw new Error(`Còn ${count} câu hỏi chưa xóa được.`);
            state.subjects = previousSubjects.filter((item) => item.key !== key);
            await saveSubjects();
            try { localStorage.removeItem(`quiz_custom_questions_${key}`); } catch (error) { /* no-op */ }
            notify(`Đã xóa môn ${key} và toàn bộ ngân hàng câu hỏi.`);
            await loadQuestions();
        } catch (error) {
            state.subjects = previousSubjects;
            throw new Error(`Không thể xóa môn ${key}: ${error.message}`);
        }
    }


    async function loadStudents() {
        ensureMonitorTable();
        const systemIds = Object.values(SYSTEM);
        const adminRow = await systemRow(SYSTEM.admin);
        if (adminRow?.score_summary) {
            try {
                const config = JSON.parse(adminRow.score_summary);
                state.adminConfig = {
                    masterIp: String(config.masterIp || '').trim(),
                    allowedIps: Array.isArray(config.allowedIps) ? config.allowedIps : []
                };
            } catch (error) { /* Keep the config already loaded. */ }
        }
        const adminIps = new Set([
            state.adminConfig.masterIp,
            ...(state.adminConfig.allowedIps || []).map((item) => typeof item === 'string' ? item : item?.ip)
        ].map((ip) => String(ip || '').trim()).filter(Boolean));
        const { data, error } = await state.client.from('quiz_logins').select('id, player_name, ip_address, device_info, status, score_summary, last_active, created_at').order('last_active', { ascending: false }).limit(200);
        if (error) {
            console.error('[Quiz Studio Admin] Không tải được phiên học sinh:', error);
            return notify(`Không thể tải giám sát học sinh: ${error.message}`, true);
        }
        console.debug('[Quiz Studio Admin] Student monitor refresh:', { fetched: data?.length || 0, refreshedAt: new Date().toISOString() });
        const rows = (data || []).filter((row) => {
            const playerName = String(row.player_name || '').trim();
            const ip = String(row.ip_address || row.client_ip || '').trim();
            return !systemIds.includes(row.id) && !playerName.startsWith('__') && !adminIps.has(ip);
        });
        const nowMs = Date.now();
        const online = rows.filter((row) => !String(row.status || '').startsWith('BANNED') && row.last_active && nowMs - new Date(row.last_active).getTime() < 180000);
        const activeSessions = new Set(online.map((row) => `legacy:${row.ip_address || row.client_ip || ''}:${row.player_name || ''}`));
        animateMetricValue('stat-online', activeSessions.size); $('nav-online-count') && ($('nav-online-count').textContent = activeSessions.size); $('student-count') && ($('student-count').textContent = `${rows.length} phiên`); $('stat-visitor-note') && ($('stat-visitor-note').textContent = `${rows.length} phiên ghi nhận`);
        $('monitor-stats') && ($('monitor-stats').innerHTML = `<div class="monitor-stat"><span><b>${activeSessions.size}</b><small>Đang trực tuyến</small></span><i style="color:var(--green);background:#def9eb" class="fa-solid fa-signal"></i></div><div class="monitor-stat"><span><b>${rows.length}</b><small>Tổng phiên ghi nhận</small></span><i style="color:var(--primary);background:#eeedff" class="fa-solid fa-users"></i></div><div class="monitor-stat"><span><b>${rows.filter((row) => String(row.status || '').startsWith('BANNED')).length}</b><small>IP đang bị chặn</small></span><i style="color:var(--red);background:#ffe7e8" class="fa-solid fa-ban"></i></div>`);
        $('students-body') && ($('students-body').innerHTML = rows.map((row) => { const isOnline = online.includes(row); const status = String(row.status || '').startsWith('BANNED') ? 'banned' : isOnline ? 'online' : 'offline'; const ip = row.ip_address || row.client_ip || ''; const name = row.player_name || 'Học sinh'; return `<tr><td><b>${esc(name)}</b></td><td><code>${esc(ip || 'Chưa xác định')}</code></td><td>${esc(row.device_info || '—')}</td><td>${row.last_active ? new Date(row.last_active).toLocaleString('vi-VN') : '—'}</td><td><span class="table-status ${status}"><i class="fa-solid fa-circle"></i> ${status === 'online' ? 'Online' : status === 'banned' ? 'Bị chặn' : 'Offline'}</span></td><td class="align-right"><div class="table-actions">${status === 'banned' ? `<button class="table-action" data-unban-row="${esc(ip)}"><i class="fa-solid fa-unlock"></i></button>` : `<button class="table-action danger" data-ban-row="${esc(ip)}"><i class="fa-solid fa-ban"></i></button>`}<button class="table-action" data-private-notice="${esc(ip)}" data-private-name="${esc(name)}" title="Thông báo riêng"><i class="fa-solid fa-comment-dots"></i></button></div></td></tr>`; }).join('') || '<tr><td colspan="6" class="empty-state">Chưa có phiên truy cập.</td></tr>');
        const banned = rows.filter((row) => String(row.status || '').startsWith('BANNED'));
        $('banned-count') && ($('banned-count').textContent = `${banned.length} IP`);
        $('banned-list') && ($('banned-list').innerHTML = banned.map((row) => `<div class="stack-item"><span class="stack-item-icon"><i class="fa-solid fa-ban"></i></span><span class="stack-item-main"><b>${esc(row.ip_address)}</b><small>${esc(row.score_summary || row.device_info || 'Vi phạm quy chế')}</small></span><button data-unban-row="${esc(row.ip_address)}"><i class="fa-solid fa-unlock"></i></button></div>`).join('') || '<p class="muted-copy">Chưa có IP bị chặn.</p>');
    }
    function ensureMonitorTable() {
        if ($('students-body')) return;
        const stats = $('monitor-stats');
        if (!stats) return;
        stats.insertAdjacentHTML('afterend', '<section class="panel monitor-table-panel"><div class="panel-title"><div><p class="eyebrow">PRESENCE</p><h2>Phiên truy cập và địa chỉ IP</h2></div><span class="info-badge">Heartbeat 30 giây</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Học sinh</th><th>IP</th><th>Thiết bị</th><th>Hoạt động cuối</th><th>Trạng thái</th><th></th></tr></thead><tbody id="students-body"><tr><td colspan="6" class="empty-state">Đang tải dữ liệu...</td></tr></tbody></table></div></section>');
    }

    async function broadcastNotice() { const message = $('notice-input')?.value.trim(); if (!message) return notify('Nhập nội dung thông báo.', true); const { error } = await state.client.from('quiz_logins').insert({ id: crypto.randomUUID(), player_name: '__SYSTEM_NOTICE__', ip_address: 'ALL', device_info: '5s', status: 'ACTIVE', score_summary: message, last_active: new Date().toISOString() }); if (error) return notify(error.message, true); $('notice-input').value = ''; notify('Đã phát thông báo tới học sinh.'); }
    async function sendPrivateNotice(ip, name = 'Học sinh') {
        const targetIp = String(ip || '').trim();
        if (!targetIp || targetIp === 'Chưa xác định' || targetIp === '—') return notify('Không xác định được IP học sinh.', true);
        const message = window.prompt(`Nhập thông báo riêng cho ${name} (${targetIp}):`, '');
        if (message === null || !message.trim()) return;
        const { error } = await state.client.from('quiz_logins').insert({ id: crypto.randomUUID(), player_name: '__SYSTEM_NOTICE__', ip_address: targetIp, device_info: '5s', status: 'ACTIVE', score_summary: message.trim(), last_active: new Date().toISOString() });
        if (error) return notify(`Không thể gửi thông báo riêng: ${error.message}`, true);
        notify(`Đã gửi thông báo riêng tới IP ${targetIp}.`);
    }
    async function clearStudentLogins() {
        if (!window.confirm('Xóa toàn bộ lịch sử học sinh? Cấu hình hệ thống sẽ được giữ lại.')) return;
        const systemIds = Object.values(SYSTEM);
        const adminIps = new Set([
            state.adminConfig.masterIp,
            ...(state.adminConfig.allowedIps || []).map((item) => typeof item === 'string' ? item : item?.ip)
        ].map((ip) => String(ip || '').trim()).filter(Boolean));
        const { data, error: selectError } = await state.client.from('quiz_logins').select('id, player_name, ip_address');
        if (selectError) throw new Error(`Không thể đọc lịch sử đăng nhập: ${selectError.message}`);
        const ids = (data || []).filter((row) => {
            const playerName = String(row.player_name || '').trim();
            return !systemIds.includes(row.id) && !playerName.startsWith('__') && !adminIps.has(String(row.ip_address || '').trim());
        }).map((row) => row.id).filter(Boolean);
        if (ids.length) {
            const { error } = await state.client.from('quiz_logins').delete().in('id', ids);
            if (error) throw new Error(`Không thể xóa lịch sử học sinh: ${error.message}`);
        }
        notify('Đã xóa lịch sử học sinh. Cấu hình hệ thống được giữ nguyên.');
        await loadStudents();
    }
    async function banIp(ip, reason = '') { if (!ip) return; const now = new Date().toISOString(); const { data: updated, error: updateError } = await state.client.from('quiz_logins').update({ status: `BANNED: ${reason || 'Vi phạm quy chế ôn tập'}`, score_summary: reason || 'Vi phạm quy chế ôn tập', last_active: now }).eq('ip_address', ip).select(); if (updateError) return notify(updateError.message, true); if (!updated?.length) { const { error } = await state.client.from('quiz_logins').insert({ id: crypto.randomUUID(), player_name: '__BANNED_IP__', ip_address: ip, device_info: 'Manual Ban', status: `BANNED: ${reason || 'Vi phạm quy chế ôn tập'}`, score_summary: reason, last_active: now }); if (error) return notify(error.message, true); } notify(`Đã chặn IP ${ip}.`); loadStudents(); }
    async function unbanIp(ip) { const { error } = await state.client.from('quiz_logins').delete().eq('player_name', '__BANNED_IP__').eq('ip_address', ip); if (error) return notify(error.message, true); await state.client.from('quiz_logins').update({ status: 'Đang ôn tập', last_active: new Date().toISOString() }).eq('ip_address', ip).like('status', 'BANNED%'); notify(`Đã mở khóa IP ${ip}.`); loadStudents(); }

    function exportJson(name, payload) { const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); URL.revokeObjectURL(link.href); }
    function exportBackup() { exportJson(`quiz-studio-backup-${new Date().toISOString().slice(0, 10)}.json`, { exportedAt: new Date().toISOString(), questions: state.questions, adminConfig: state.adminConfig, aiIps: state.aiIps, geo: state.geo, maintenance: state.maintenance }); notify('Đã tải file backup JSON.'); }
    function exportExcel() { if (!window.XLSX) return exportJson('quiz-questions.json', state.questions); const rows = state.questions.map((q) => ({ ID: q.id, Mon: subjectName(q.subject_key), Loai: TYPE_LABELS[q.qType], CauHoi: q.question, DapAn: q.qType === 'mcq' ? 'ABCD'[q.correct] : q.qType === 'short_answer' ? q.correctValue : q.statements.map((s) => `${s.key}:${s.answer ? 'Đúng' : 'Sai'}`).join(', '), GiaiThich: q.explanation })); const book = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(book, window.XLSX.utils.json_to_sheet(rows), 'Questions'); window.XLSX.writeFile(book, `quiz-questions-${new Date().toISOString().slice(0, 10)}.xlsx`); notify('Đã xuất bảng câu hỏi Excel.'); }
    async function loadLeaderboard() { const subject = $('leaderboard-subject')?.value; let query = state.client.from('quiz_logins').select('*').order('last_active', { ascending: false }).limit(100); if (subject) query = query.ilike('score_summary', `%${subject}%`); const { data, error } = await query; if (error) return notify(error.message, true); const rows = (data || []).filter((row) => !Object.values(SYSTEM).includes(row.id)).slice(0, 10); $('leaderboard-content').innerHTML = `<div class="leaderboard-list">${rows.map((row, index) => `<div class="leader-row"><strong>#${index + 1}</strong><span>${esc(row.player_name || 'Học sinh')}</span><b>${esc(row.score_summary || '—')}</b><small>${row.last_active ? new Date(row.last_active).toLocaleDateString('vi-VN') : ''}</small></div>`).join('') || '<div class="empty-state">Chưa có kết quả.</div>'}</div>`; }

    function bindEvents() {
        if (state.bound) return; state.bound = true;
        mergeContentLibraryView();
        injectEditorControls();
        moveSubjectFormToDialog();
        document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
        document.querySelectorAll('[data-go-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.goView)));
        $('mobile-menu')?.addEventListener('click', () => $('sidebar')?.classList.toggle('is-open'));
        $('theme-toggle')?.addEventListener('click', () => { document.body.classList.toggle('dark'); localStorage.setItem('quiz_admin_dark', document.body.classList.contains('dark') ? 'true' : 'false'); });
         $('refresh-button')?.addEventListener('click', () => Promise.all([loadQuestions(), loadStudents(), loadMaintenance(), loadAccess(), loadGeo()])); $('delete-all-questions')?.addEventListener('click', () => runAction(deleteAllQuestions));
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
         $('import-button')?.addEventListener('click', openImport); $('quick-import')?.addEventListener('click', openImport); $('import-subject-select')?.addEventListener('change', (event) => { state.importSubject = String(event.target.value || '').trim(); persistImportDraft(); console.debug('[Quiz Studio Admin] Import target subject changed:', state.importSubject); }); $('parse-import')?.addEventListener('click', () => { const source = $('import-text')?.value || ''; const list = parseJsonInput(source); if (!list.length) return notify(state.importError || 'JSON chưa hợp lệ hoặc thiếu cấu trúc MCQ/Đúng-Sai/Trả lời ngắn.', true); state.importQuestions = list; state.importError = ''; state.importIndex = 0; state.importIntegrity = validateVerbatimQuestions(list, source); persistImportDraft(); fillForm(list[0]); renderImportReview(); notify(`Đã đọc ${list.length} câu từ JSON.`); }); $('save-import')?.addEventListener('click', saveImportQuestions);
         $('import-file')?.addEventListener('change', (event) => handleImportFile(event.target.files?.[0]));
        $('import-preview')?.addEventListener('click', (event) => { const index = event.target.closest('[data-import-index]'); const prev = event.target.closest('[data-import-prev]'); const next = event.target.closest('[data-import-next]'); if (index) { state.importIndex = Number(index.dataset.importIndex); fillForm(state.importQuestions[state.importIndex]); } if (prev && state.importIndex > 0) { state.importIndex -= 1; fillForm(state.importQuestions[state.importIndex]); } if (next && state.importIndex < state.importQuestions.length - 1) { state.importIndex += 1; fillForm(state.importQuestions[state.importIndex]); } renderImportReview(); });
        document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
        $('maintenance-toggle')?.addEventListener('change', () => runAction(toggleMaintenance)); $('edit-maintenance')?.addEventListener('click', () => { const message = window.prompt('Lời nhắn bảo trì:', state.maintenance.message); if (message !== null) { state.maintenance.message = message; runAction(toggleMaintenance); } });
        $('add-admin-ip')?.addEventListener('click', () => addAdminIp().catch((error) => notify(error.message, true))); $('save-master-ip')?.addEventListener('click', () => saveMasterIp().catch((error) => notify(error.message, true))); $('add-ai-ip')?.addEventListener('click', () => addAiIp().catch((error) => notify(error.message, true)));
        $('admin-ip-list')?.addEventListener('click', (event) => { const button = event.target.closest('[data-remove-admin]'); if (button) removeAdminIp(button.dataset.removeAdmin).catch((error) => notify(error.message, true)); }); $('ai-ip-list')?.addEventListener('click', (event) => { const button = event.target.closest('[data-remove-ai]'); if (button) removeAiIp(button.dataset.removeAi).catch((error) => notify(error.message, true)); }); document.addEventListener('change', (event) => { const toggle = event.target.closest('[data-toggle-subject]'); if (toggle) toggleSubjectPrivacy(toggle.dataset.toggleSubject, toggle.checked).catch((error) => notify(error.message, true)); });
        document.addEventListener('click', (event) => {
            const geoMode = event.target.closest('[data-geo-mode]');
            const addGeo = event.target.closest('#add-geo-ip');
            const removeGeo = event.target.closest('[data-remove-geo]');
            const addClass5 = event.target.closest('#add-class5-ip');
            const addCurrentClass5 = event.target.closest('#add-current-class5-ip');
            const removeClass5 = event.target.closest('[data-remove-class5]');
            const notice = event.target.closest('[data-notice]');
            if (geoMode) { state.geo.mode = geoMode.dataset.geoMode; runAction(saveGeo); }
            if (addGeo) { const input = $('geo-ip-input'); const ip = input?.value.trim(); if (ip && !state.geo.ips.includes(ip)) state.geo.ips.push(ip); if (input) input.value = ''; runAction(saveGeo); }
            if (removeGeo) { state.geo.ips = state.geo.ips.filter((ip) => ip !== removeGeo.dataset.removeGeo); runAction(saveGeo); }
            if (addClass5) { const input = $('class5-ip-input'); runAction(() => addClass5Ip(input?.value).then(() => { if (input) input.value = ''; })); }
            if (addCurrentClass5) runAction(() => addClass5Ip(state.clientIp));
            if (removeClass5) runAction(() => removeClass5Ip(removeClass5.dataset.removeClass5));
            if (notice && $('notice-input')) $('notice-input').value = notice.dataset.notice;
        });
        $('send-notice')?.addEventListener('click', () => runAction(broadcastNotice));
        $('ban-ip-button')?.addEventListener('click', () => runAction(() => banIp($('ban-ip-input').value.trim(), $('ban-reason-input').value.trim())));
         $('refresh-students')?.addEventListener('click', () => runAction(loadStudents));
         $('clear-logins')?.addEventListener('click', () => runAction(clearStudentLogins));
         document.addEventListener('click', (event) => { const target = event.target.closest('#students-body [data-ban-row], #students-body [data-unban-row], #students-body [data-private-notice]'); if (!target) return; if (target.dataset.banRow) runAction(() => banIp(target.dataset.banRow)); else if (target.dataset.unbanRow) runAction(() => unbanIp(target.dataset.unbanRow)); else runAction(() => sendPrivateNotice(target.dataset.privateNotice, target.dataset.privateName)); });
         $('banned-list')?.addEventListener('click', (event) => { const button = event.target.closest('[data-unban-row]'); if (button) runAction(() => unbanIp(button.dataset.unbanRow)); });
        $('export-backup')?.addEventListener('click', () => runAction(exportBackup)); $('export-excel')?.addEventListener('click', () => runAction(exportExcel)); $('load-leaderboard')?.addEventListener('click', () => runAction(loadLeaderboard)); $('save-gemini-key')?.addEventListener('click', () => runAction(saveGeminiKey)); $('clear-gemini-key')?.addEventListener('click', () => runAction(clearGeminiKey)); $('test-gemini-key')?.addEventListener('click', () => runAction(testGeminiKey));
        $('archive-data')?.addEventListener('click', () => runAction(async () => { if (!window.confirm('Backup và xóa lịch sử làm bài của học sinh?')) return; const { data, error } = await state.client.from('quiz_logins').select('*'); if (error) throw error; const systemIds = Object.values(SYSTEM); const adminIps = new Set([state.adminConfig.masterIp, ...(state.adminConfig.allowedIps || []).map((item) => typeof item === 'string' ? item : item?.ip)].map((ip) => String(ip || '').trim()).filter(Boolean)); const records = (data || []).filter((row) => !systemIds.includes(row.id) && !String(row.player_name || '').startsWith('__') && !adminIps.has(String(row.ip_address || '').trim())); exportJson(`exam-archive-${new Date().toISOString().slice(0, 10)}.json`, { archivedAt: new Date().toISOString(), records }); const ids = records.map((row) => row.id).filter(Boolean); if (ids.length) { const result = await state.client.from('quiz_logins').delete().in('id', ids); if (result.error) throw new Error(`Không thể dọn lịch sử kỳ thi: ${result.error.message}`); } notify('Đã backup và dọn lịch sử kỳ thi.'); await loadStudents(); }));
         $('new-subject-button')?.addEventListener('click', (event) => openSubjectDialog(null, event.currentTarget));
        $('subject-grade-picker')?.addEventListener('click', (event) => { const button = event.target.closest('[data-subject-grade]'); if (button) setSubjectGrade(button.dataset.subjectGrade); });
         $('subject-form')?.addEventListener('submit', (event) => runAction(() => saveSubject(event))); $('clear-subject-form')?.addEventListener('click', closeSubjectDialog); $('clear-subject-form') && ($('clear-subject-form').textContent = 'Hủy'); $('subject-dialog-close')?.addEventListener('click', closeSubjectDialog); $('refresh-subjects')?.addEventListener('click', () => runAction(loadSubjects)); $('subjects-list')?.addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-subject]'); const adopt = event.target.closest('[data-adopt-subject-questions]'); const clearQuestions = event.target.closest('[data-delete-subject-questions]'); const remove = event.target.closest('[data-delete-subject]'); if (edit) { const subject = state.subjects.find((item) => item.key === edit.dataset.editSubject); if (subject) openSubjectDialog(subject, edit); } if (adopt) runAction(() => adoptLegacyQuestions(adopt.dataset.adoptSubjectQuestions)); if (clearQuestions) runAction(() => deleteSubjectQuestions(clearQuestions.dataset.deleteSubjectQuestions)); if (remove) runAction(() => deleteSubject(remove.dataset.deleteSubject)); });
        $('subject-dialog')?.addEventListener('close', () => { const opener = state.subjectDialogOpener; state.subjectDialogOpener = null; resetSubjectForm(); if (opener && document.contains(opener)) opener.focus(); });
    }

    async function init() {
        if (localStorage.getItem('quiz_admin_dark') === 'true') document.body.classList.add('dark');
        $('bootstrap-admin')?.addEventListener('click', () => runAction(bootstrapAdmin));
        try {
            state.client = window.supabase.createClient(CONFIG.url, CONFIG.key);
            if (!(await isCurrentIpAllowed())) {
                denyAccess('IP hiện tại chưa được cấp quyền. Nếu đây là lần đầu cài đặt, hãy dùng nút thiết lập Admin lần đầu.');
                return;
            }
            showApp(); configureAdminLabels(); bindEvents(); fillSubjects('11'); fillLibrarySubjects(); ensureTypeEditor('mcq'); renderPreview();
            await Promise.all([loadQuestions(), loadStudents(), loadMaintenance(), loadAccess(), loadGeo(), loadSubjects()]);
            await syncSubjectQuestionCounts();
        setInterval(() => loadStudents().catch((error) => console.warn('[Quiz Studio Admin] Refresh monitor thất bại:', error)), 5000);
        } catch (error) {
            console.error('[Quiz Studio Admin] Khởi tạo thất bại:', error);
            denyAccess(error?.message || 'Không thể kết nối dữ liệu quản trị.');
        }
    }
    init();
})();
