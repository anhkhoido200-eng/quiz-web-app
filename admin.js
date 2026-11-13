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
        aiIps: '00000000-0000-0000-0000-000000000006',
        trash: '00000000-0000-0000-0000-000000000007',
        tokens: '00000000-0000-0000-0000-000000000008'
    };
    const TYPE_LABELS = { mcq: 'Trắc nghiệm 4 lựa chọn', tf_group: 'Đúng / Sai', short_answer: 'Trả lời ngắn' };
    const state = {
        client: null, clientIp: '', questions: [], grade: 'all', subject: 'all', typeFilter: 'all',
        type: 'mcq', answer: 0, tfAnswers: [true, true, true, true], editingId: null,
        page: 1, pageSize: 12,
        importQuestions: [], importIndex: 0, importSubject: 'history', sourceText: '', importError: '',
        adminConfig: { masterIp: '', allowedIps: [] }, aiIps: [], geo: { mode: 'PUBLIC', ips: [], grade5Ips: [] },
        tokens: [], reportRows: null, reportAllRows: [], reportLoading: false, reportLeaderboardPage: 1,
        progressFilter: 'all', progressSubject: 'all', progressSearch: '', progressSort: 'recent', progressRecords: [], progressRawLogins: [], progressLoading: false, progressRefreshQueued: false,
        subjects: [], maintenance: { isActive: false, message: '' }, bound: false,
        subjectDialogOpener: null, subjectEditingKey: null,
        importIntegrity: { valid: true, errors: [] },
        selectedQuestionIds: new Set(),
        selectMode: false,
        activityLogs: (() => {
            try {
                const saved = JSON.parse(localStorage.getItem('quiz_admin_activity_logs') || '[]');
                return Array.isArray(saved) ? saved : [];
            } catch (e) { return []; }
        })(),
        trashQuestions: (() => {
            try {
                const saved = JSON.parse(localStorage.getItem('quiz_trash_questions') || '[]');
                return Array.isArray(saved) ? saved : [];
            } catch (e) { return []; }
        })()
    };
    const $ = (id) => document.getElementById(id);
    const esc = (value) => String(value ?? '').replace(/&(?!(?:amp|lt|gt|quot|#39|#x27);)|[<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
    const escBody = (value) => String(value ?? '').replace(/&(?!(?:amp|lt|gt|quot|#39|#x27);)|[<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const notationText = (value) => {
        if (typeof MathNotation !== 'undefined' && typeof MathNotation.readValue === 'function') {
            return MathNotation.readValue(value).text;
        }
        if (value && typeof value === 'object') return String(value.text ?? value.value ?? value.content ?? '');
        return String(value ?? '');
    };
    const storageText = (value) => {
        if (value && typeof value === 'object') {
            const text = String(value.text ?? value.value ?? value.content ?? '').trim();
            const math = value.math ?? value.latex ?? value.formula;
            if (math !== undefined && math !== null && String(math).trim()) {
                const source = String(math).trim();
                const mathStr = /^\$[^$]+\$$|^\$\$[\s\S]*\$\$$/.test(source) ? source : `$${source}$`;
                return text ? `${text} ${mathStr}` : mathStr;
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
    const htmlText = (value, fallback = '') => escBody(formatNotation(value, fallback)).replace(/\r?\n/g, '<br>');
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
    const copyToClipboard = async (text) => {
        const cleanText = String(text ?? '').trim();
        if (!cleanText) return false;
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(cleanText);
                return true;
            }
        } catch (e) {
            console.warn('[Quiz Studio Admin] Clipboard API failed, trying fallback...', e);
        }
        try {
            const textarea = document.createElement('textarea');
            textarea.value = cleanText;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            const success = document.execCommand('copy');
            document.body.removeChild(textarea);
            return success;
        } catch (err) {
            prompt('Sao chép nội dung bên dưới:', cleanText);
            return true;
        }
    };
    const confirmDialog = (options = {}) => {
        const opts = typeof options === 'string' ? { message: options } : (options || {});
        const msg = String(opts.message || 'Bạn có chắc chắn muốn thực hiện thao tác này?');
        const isDanger = opts.variant ? opts.variant === 'danger' : /xóa|dọn|backup/i.test(msg);
        const variant = opts.variant || (isDanger ? 'danger' : 'warning');

        let modal = document.getElementById('admin-confirm-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'admin-confirm-modal';
            modal.className = 'admin-confirm-backdrop hidden';
            modal.innerHTML = `
                <div class="admin-confirm-card" role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title">
                    <div id="admin-confirm-accent" class="admin-confirm-accent"></div>
                    <div class="admin-confirm-body">
                        <div class="admin-confirm-head">
                            <span id="admin-confirm-icon" class="admin-confirm-icon"><i class="fa-solid fa-triangle-exclamation"></i></span>
                            <div class="admin-confirm-title-wrap">
                                <p id="admin-confirm-eyebrow" class="eyebrow">CONFIRM ACTION</p>
                                <h3 id="admin-confirm-title">Xác nhận thao tác</h3>
                            </div>
                            <button type="button" id="admin-confirm-close" class="icon-button" aria-label="Đóng"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                        <div id="admin-confirm-message" class="admin-confirm-message"></div>
                         <input id="admin-confirm-input" class="hidden" type="text" style="width:100%;margin-bottom:14px;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface-2);color:var(--text);font:inherit;font-size:13px;" autocomplete="off">
                        <div class="admin-confirm-actions">
                            <button type="button" id="admin-confirm-cancel" class="button button-secondary">Hủy bỏ</button>
                            <button type="button" id="admin-confirm-ok" class="button button-primary"><i class="fa-solid fa-check"></i> <span id="admin-confirm-ok-text">Xác nhận</span></button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        const accentEl = document.getElementById('admin-confirm-accent');
        const iconWrap = document.getElementById('admin-confirm-icon');
        const eyebrowEl = document.getElementById('admin-confirm-eyebrow');
        const titleEl = document.getElementById('admin-confirm-title');
        const msgEl = document.getElementById('admin-confirm-message');
        const inputEl = document.getElementById('admin-confirm-input');
        const cancelBtn = document.getElementById('admin-confirm-cancel');
        const okBtn = document.getElementById('admin-confirm-ok');
        const okText = document.getElementById('admin-confirm-ok-text');
        const closeBtn = document.getElementById('admin-confirm-close');

        if (accentEl) accentEl.className = `admin-confirm-accent ${variant === 'danger' ? 'is-danger' : (variant === 'warning' ? 'is-warning' : '')}`;
        if (iconWrap) {
            iconWrap.className = `admin-confirm-icon ${variant === 'danger' ? 'is-danger' : (variant === 'warning' ? 'is-warning' : '')}`;
            iconWrap.innerHTML = `<i class="fa-solid ${opts.icon || (variant === 'danger' ? 'fa-trash-can' : 'fa-triangle-exclamation')}"></i>`;
        }
        if (eyebrowEl) eyebrowEl.textContent = opts.eyebrow || (variant === 'danger' ? 'DANGER ZONE' : 'CONFIRM ACTION');
        if (titleEl) titleEl.textContent = opts.title || (variant === 'danger' ? 'Xác nhận xóa dữ liệu?' : 'Xác nhận thao tác?');
        if (msgEl) msgEl.textContent = msg;
        if (inputEl) {
            inputEl.type = opts.inputType || 'text';
            if (opts.withInput) {
                inputEl.classList.remove('hidden');
                inputEl.placeholder = opts.placeholder || 'Nhập nội dung...';
                inputEl.value = opts.defaultValue || '';
            } else {
                inputEl.classList.add('hidden');
                inputEl.value = '';
            }
        }
        if (cancelBtn) cancelBtn.textContent = opts.cancelText || 'Hủy bỏ';
        if (okBtn) okBtn.className = `button ${variant === 'danger' ? 'button-danger-solid' : (variant === 'warning' ? 'button-warning-solid' : 'button-primary')}`;
        if (okText) okText.textContent = opts.confirmText || (variant === 'danger' ? 'Xác nhận xóa' : 'Đồng ý');

        modal.classList.remove('hidden');

        return new Promise((resolve) => {
            let settled = false;
            const finish = (confirmed) => {
                if (settled) return;
                settled = true;
                modal.classList.add('hidden');
                window.removeEventListener('keydown', onKey, true);
                modal.onclick = null;
                if (okBtn) okBtn.onclick = null;
                if (cancelBtn) cancelBtn.onclick = null;
                if (closeBtn) closeBtn.onclick = null;
                if (opts.withInput) {
                    resolve(confirmed ? String(inputEl?.value || '') : null);
                } else {
                    resolve(confirmed);
                }
            };
            const onKey = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
                else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
            };
            window.addEventListener('keydown', onKey, true);
            modal.onclick = (e) => { if (e.target === modal) finish(false); };
            if (okBtn) okBtn.onclick = () => finish(true);
            if (cancelBtn) cancelBtn.onclick = () => finish(false);
            if (closeBtn) closeBtn.onclick = () => finish(false);
            setTimeout(() => {
                if (opts.withInput && inputEl) { inputEl.focus(); inputEl.select(); }
                else (variant === 'danger' ? cancelBtn : okBtn)?.focus();
            }, 20);
        });
    };
    const promptDialog = (options = {}) => confirmDialog({ ...options, withInput: true, variant: options.variant || 'primary' });
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
        .map((item) => ({ ...item, key: item.key || item.subject_key, name: item.name || item.title || item.key }))
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
        if (String(q?.grade || q?.grade_level || '') === '5') return '5';
        if (String(q?.grade || q?.grade_level || '') === '11') return '11';
        const key = String(q?.subject_key || q?.subjectKey || q?.key || '').trim();
        const matchKey = subjectMatchKey(key);
        const subjects = allSubjects();
        const matchedSubject = subjects.find((s) => subjectMatchKey(s.key || s.subject_key) === matchKey);
        if (matchedSubject) return subjectGrade(matchedSubject);
        if (subjects.length > 0 && subjects.every((s) => subjectGrade(s) === '5')) return '5';
        if (subjects.length > 0 && subjects.every((s) => subjectGrade(s) === '11')) return '11';
        const lowerKey = key.toLowerCase();
        if (/(?:^|[^0-9])5(?:$|[^0-9])/.test(lowerKey) || /5$/.test(lowerKey)) return '5';
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
        el.className = `connection-status${ready ? ' is-ready' : ' is-offline'}`;
        el.innerHTML = `<i class="fa-solid ${ready ? 'fa-cloud-check' : 'fa-triangle-exclamation'}"></i> ${esc(message)}`;
    }

    function maskIpAddress(ip) {
        const clean = String(ip || '').trim();
        if (!clean || clean === 'Chưa xác định' || clean === 'Không xác định IP') return 'Không xác định IP';
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) {
            const parts = clean.split('.');
            return `${parts[0]}.${parts[1]}.***.***`;
        }
        if (clean.includes(':')) {
            const parts = clean.split(':').filter(Boolean);
            return parts.length >= 2 ? `${parts[0]}:${parts[1]}:****:****` : `${clean.slice(0, 6)}****`;
        }
        return clean.length > 6 ? `${clean.slice(0, 6)}.***.***` : clean;
    }

    async function copyAdminIp() {
        const fullIp = state.clientIp || $('current-ip')?.dataset.fullIp || '';
        if (!fullIp || fullIp === 'Không xác định IP' || fullIp === 'Chưa xác định') {
            return notify('Chưa nhận diện được địa chỉ IP để sao chép.', true);
        }
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(fullIp);
            } else {
                const temp = document.createElement('textarea');
                temp.value = fullIp;
                temp.style.position = 'fixed';
                temp.style.opacity = '0';
                document.body.appendChild(temp);
                temp.select();
                document.execCommand('copy');
                temp.remove();
            }
            const btn = $('copy-admin-ip');
            if (btn) {
                btn.classList.add('is-copied');
                btn.innerHTML = '<i class="fa-solid fa-check"></i>';
                clearTimeout(copyAdminIp.timer);
                copyAdminIp.timer = setTimeout(() => {
                    btn.classList.remove('is-copied');
                    btn.innerHTML = '<i class="fa-regular fa-copy"></i>';
                }, 1800);
            }
            notify(`Đã sao chép IP đầy đủ (${fullIp}) vào clipboard.`);
        } catch (error) {
            notify('Không thể sao chép địa chỉ IP.', true);
        }
    }

    function updateHealthStatus(type, stateMode, badgeLabel, detailText) {
        const isDb = type === 'db';
        const badge = $(isDb ? 'health-database-badge' : 'health-content-badge');
        const detail = $(isDb ? 'health-database' : 'health-content');
        if (detail && detailText) detail.textContent = detailText;
        if (!badge) return;
        badge.classList.remove('pending', 'safe', 'danger', 'is-checking');
        if (stateMode === 'checking') {
            badge.classList.add('pending', 'is-checking');
            badge.innerHTML = `<i class="fa-solid fa-arrows-rotate is-spinning"></i> <span>${esc(badgeLabel || 'Đang kiểm tra')}</span>`;
        } else if (stateMode === 'safe') {
            badge.classList.add('safe');
            badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>${esc(badgeLabel || 'Đã kết nối')}</span> <i class="fa-solid fa-arrows-rotate health-recheck-icon"></i>`;
        } else {
            badge.classList.add('danger');
            badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${esc(badgeLabel || 'Mất kết nối')}</span> <span class="health-retry-tag"><i class="fa-solid fa-arrows-rotate"></i> Thử lại</span>`;
        }
    }

    async function recheckSystemHealth() {
        updateHealthStatus('db', 'checking', 'Đang kiểm tra', 'Đang kết nối lại với Supabase...');
        updateHealthStatus('content', 'checking', 'Đang đồng bộ', 'Đang tải lại ngân hàng câu hỏi...');
        try {
            await Promise.all([loadSubjects(), loadQuestions(), loadMaintenance()]);
            notify('Đã kiểm tra kết nối và đồng bộ dữ liệu thành công.');
        } catch (error) {
            updateHealthStatus('db', 'danger', 'Mất kết nối', 'Không thể kết nối tới Supabase. Bấm để thử lại.');
            updateHealthStatus('content', 'danger', 'Lỗi tải', 'Chưa thể đồng bộ dữ liệu câu hỏi.');
            notify(`Kiểm tra kết nối thất bại: ${error.message}`, true);
        }
    }

    function addActivityLog(action, detail = '', category = 'info') {
        const cleanAction = String(action || '').trim();
        if (!cleanAction) return;
        const entry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            action: cleanAction,
            detail: String(detail || '').trim(),
            category: String(category || 'info'),
            timestamp: new Date().toISOString()
        };
        if (!Array.isArray(state.activityLogs)) state.activityLogs = [];
        state.activityLogs.unshift(entry);
        if (state.activityLogs.length > 25) state.activityLogs = state.activityLogs.slice(0, 25);
        try {
            localStorage.setItem('quiz_admin_activity_logs', JSON.stringify(state.activityLogs));
        } catch (e) {}
        renderRecentActivity();
    }
    window.addActivityLog = addActivityLog;

    function navigateToLibraryByGrade(grade) {
        const targetGrade = ['5', '11', 'all'].includes(String(grade)) ? String(grade) : 'all';
        state.grade = targetGrade;
        state.subject = 'all';
        state.page = 1;
        document.querySelectorAll('.grade-filter').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.grade === targetGrade);
        });
        fillLibrarySubjects();
        renderLibrary();
        switchView('questions');
        requestAnimationFrame(() => {
            const target = $('content-library-section') || document.querySelector('.library-panel');
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                target.classList.remove('is-focus-pulse');
                void target.offsetWidth;
                target.classList.add('is-focus-pulse');
                clearTimeout(navigateToLibraryByGrade.timer);
                navigateToLibraryByGrade.timer = setTimeout(() => target.classList.remove('is-focus-pulse'), 1400);
            }
        });
    }

    async function getClientIp() {
        if (state.clientIp && state.clientIp !== 'Chưa xác định') return state.clientIp;
        try {
            const cached = sessionStorage.getItem('quiz_stable_client_ip');
            if (cached && cached !== 'Chưa xác định') return cached;
        } catch (e) {}
        const endpoints = ['https://api4.ipify.org?format=json', 'https://api.ipify.org?format=json', 'https://ipapi.co/json/'];
        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint, { signal: AbortSignal.timeout(4000) });
                const data = await response.json();
                if (data?.ip) {
                    const clean = String(data.ip).trim();
                    try { sessionStorage.setItem('quiz_stable_client_ip', clean); } catch (e) {}
                    return clean;
                }
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
        if ($('current-ip')) {
            $('current-ip').textContent = maskIpAddress(state.clientIp);
            $('current-ip').dataset.fullIp = state.clientIp || '';
        }
        if ($('access-current-ip')) $('access-current-ip').textContent = state.clientIp || 'Không xác định IP';

        // Đọc mã IP-Token từ URL query params (?admin_token=... hoặc ?token=...)
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const paramToken = urlParams.get('admin_token') || urlParams.get('token');
            if (paramToken && paramToken.trim()) {
                const clean = paramToken.trim();
                localStorage.setItem('quiz_admin_token', clean);
                try {
                    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
                } catch (e) {}
            }
        } catch (e) {}

        // CHỈ đọc quiz_admin_token, TUYỆT ĐỐI KHÔNG đọc quiz_access_token (token học sinh)
        const currentToken = (localStorage.getItem('quiz_admin_token') || '').trim();

        const row = await systemRow(SYSTEM.admin);
        if (!row) return false;
        try {
            const config = JSON.parse(row.score_summary || '{}');
            state.adminConfig = {
                masterIp: String(config.masterIp || '').trim(),
                allowedIps: Array.isArray(config.allowedIps) ? config.allowedIps : (Array.isArray(config.ips) ? config.ips.map((ip) => ({ ip, name: 'Admin' })) : [])
            };
            const ips = state.adminConfig.allowedIps.map((item) => typeof item === 'string' ? item : item?.ip).filter(Boolean).map(String);
            const normalizeAdminCode = (value) => {
                const clean = String(value || '').trim().toLowerCase();
                if (!clean) return '';
                const parts = clean.split('-');
                // IP-Token / IP-Mã: chỉ dùng phần mã sau IP khi xác thực Admin.
                return parts.length > 1 && (/^[0-9a-f:.]+$/i.test(parts[0]) || parts[0] === 'localhost')
                    ? parts.slice(1).join('-')
                    : clean;
            };

            // 1. Khớp Master IP
            if (state.clientIp && state.clientIp === state.adminConfig.masterIp) return true;

            // 2. Khớp IP trong whitelist
            if (state.clientIp && ips.includes(state.clientIp)) return true;

            // 3. Khớp IP-Token Quản Trị Viên trong danh sách Admin (allowedIps)
            if (currentToken) {
                const tok = currentToken.toLowerCase();
                const tokCode = normalizeAdminCode(tok);
                const isTokenMatch = state.adminConfig.allowedIps.some((item) => {
                    if (typeof item === 'string') {
                        const str = item.toLowerCase();
                        return tok && (str === tok || normalizeAdminCode(str) === tokCode);
                    }
                    const itemToken = String(item.token || '').toLowerCase();
                    const itemRaw = String(item.rawCode || '').toLowerCase();
                    if (tok && tok.length >= 6) {
                        if (itemToken && itemToken === tok) return true;
                        if (itemRaw && itemRaw === tok) return true;
                        if (tokCode && normalizeAdminCode(itemToken) === tokCode) return true;
                        if (tokCode && itemRaw && normalizeAdminCode(itemRaw) === tokCode) return true;
                    }
                    return false;
                });
                if (isTokenMatch) return true;
            }

            // 4. Kiểm tra trong ACCESS_TOKENS (bản ghi số 8) CHỈ DÀNH CHO ROLE ADMIN
            try {
            const row8 = await systemRow(SYSTEM.tokens);
                if (row8 && row8.score_summary) {
                    const tokens = JSON.parse(row8.score_summary || '[]');
                    if (Array.isArray(tokens)) {
                        // CHỈ CHẤP NHẬN ROLE ADMIN, TUYỆT ĐỐI KHÔNG CHẤP NHẬN ROLE ALL HOẶC PARENT
                        const adminTokens = tokens.filter(t => t.role === 'admin');
                        if (currentToken) {
                            const tok = currentToken.toLowerCase();
                            const tokCode = normalizeAdminCode(tok);
                            const foundAdmin = adminTokens.find(t => {
                                const tToken = String(t.token || '').toLowerCase();
                                const tRaw = String(t.rawCode || '').toLowerCase();
                                if (tok && tok.length >= 6) {
                                    if (tToken && tToken === tok) return true;
                                    if (tRaw && tRaw === tok) return true;
                                    if (tokCode && normalizeAdminCode(tToken) === tokCode) return true;
                                    if (tokCode && tRaw && normalizeAdminCode(tRaw) === tokCode) return true;
                                }
                                return false;
                            });
                            if (foundAdmin) return true;
                        }
                    }
                }
            } catch (e) {}

            return false;
        } catch (error) { return false; }
    }

    function denyAccess(reason = '') {
        try {
            // Xóa mã admin không hợp lệ khỏi máy để tránh lặp lại
            localStorage.removeItem('quiz_admin_token');
        } catch (e) {}
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
        const password = await promptDialog({ title: 'Thiết lập Master Admin', eyebrow: 'BOOTSTRAP ADMIN', message: 'Nhập mật khẩu Admin để thiết lập quyền Master lần đầu cho thiết bị này:', placeholder: 'Nhập mật khẩu Admin...', inputType: 'password', confirmText: 'Xác nhận', icon: 'fa-key' });
        if (password === null) return;
        if (password !== '034569') return notify('Mật khẩu Admin không đúng.', true);
        const payload = { masterIp: state.clientIp, allowedIps: [{ ip: state.clientIp, name: 'Thiết bị Master', addedAt: new Date().toISOString(), isMaster: true }] };
        const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.admin, player_name: '__ADMIN_IPS_CONFIG__', ip_address: 'SYSTEM', device_info: 'PASSWORDLESS_AUTH', status: 'ACTIVE', score_summary: JSON.stringify(payload), last_active: new Date().toISOString() }, { onConflict: 'id' });
        if (error) throw error;
        notify('Đã thiết lập Master Admin. Đang tải lại bảng điều khiển.');
        window.setTimeout(() => window.location.reload(), 700);
    }

    async function unlockAdminWithToken() {
        const val = $('admin-token-unlock-input')?.value.trim();
        if (!val) return notify('Vui lòng nhập hoặc dán mã IP-Token Admin.', true);

        if (!state.client) state.client = window.supabase.createClient(CONFIG.url, CONFIG.key);
        state.clientIp = await getClientIp();

        let isMatch = false;
        const normalizeAdminCode = (value) => {
            const clean = String(value || '').trim().toLowerCase();
            if (!clean) return '';
            const parts = clean.split('-');
            return parts.length > 1 && (/^[0-9a-f:.]+$/i.test(parts[0]) || parts[0] === 'localhost')
                ? parts.slice(1).join('-')
                : clean;
        };
        try {
            const row = await systemRow(SYSTEM.admin);
            if (row && row.score_summary) {
                const config = JSON.parse(row.score_summary || '{}');
                const allowed = Array.isArray(config.allowedIps) ? config.allowedIps : [];
                const clean = val.toLowerCase();
                const cleanCode = normalizeAdminCode(clean);
                isMatch = allowed.some(it => {
                    if (typeof it === 'string') return it.toLowerCase() === clean || normalizeAdminCode(it) === cleanCode;
                    const itTok = String(it.token || '').toLowerCase();
                    const itRaw = String(it.rawCode || '').toLowerCase();
                    if (itTok && itTok === clean) return true;
                    if (itRaw && itRaw === clean && itRaw.length >= 6) return true;
                    if (cleanCode && normalizeAdminCode(itTok) === cleanCode) return true;
                    if (cleanCode && itRaw && normalizeAdminCode(itRaw) === cleanCode) return true;
                    return false;
                });
            }
        } catch (e) {}

        if (!isMatch) {
            try {
                const row8 = await systemRow(SYSTEM.tokens);
                if (row8 && row8.score_summary) {
                    const tokens = JSON.parse(row8.score_summary || '[]');
                    const clean = val.toLowerCase();
                    const cleanCode = normalizeAdminCode(clean);
                    isMatch = tokens.some(t => {
                        // CHỈ ROLE ADMIN ĐƯỢC MỞ KHÓA ADMIN
                        if (t.role !== 'admin') return false;
                        const tTok = String(t.token || '').toLowerCase();
                        const tRaw = String(t.rawCode || '').toLowerCase();
                        if (tTok && tTok === clean) return true;
                        if (tRaw && tRaw === clean && tRaw.length >= 6) return true;
                        if (cleanCode && normalizeAdminCode(tTok) === cleanCode) return true;
                        if (cleanCode && tRaw && normalizeAdminCode(tRaw) === cleanCode) return true;
                        return false;
                    });
                }
            } catch (e) {}
        }

        if (isMatch) {
            localStorage.setItem('quiz_admin_token', val);
            notify('✅ Mở khóa Admin thành công! Đang vào hệ thống...');
            setTimeout(() => {
                window.location.reload();
            }, 600);
        } else {
            notify('❌ Mã IP-Token Admin không hợp lệ hoặc chưa được cấp quyền!', true);
        }
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
        renderLibrarySubjectTabs();
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
        if ($('leaderboard-subject')) {
            if (state.reportRows) {
                populateLeaderboardSubjects();
            } else {
                const prevLeaderSub = $('leaderboard-subject').value || '';
                $('leaderboard-subject').innerHTML = '<option value="">Tất cả môn</option>' + allSubjects().map((item) => `<option value="${esc(item.key)}">${esc(item.name)}</option>`).join('');
                if (prevLeaderSub && allSubjects().some((item) => item.key === prevLeaderSub)) {
                    $('leaderboard-subject').value = prevLeaderSub;
                }
            }
        }
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
            grade: $('grade-select')?.value || (state.grade && state.grade !== 'all' ? state.grade : '11'),
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
            body = `<div class="preview-options-list">${q.options.map((option, index) => `<div class="preview-option ${index === state.answer ? 'is-correct' : ''}"><b>${'ABCD'[index]}</b><span>${htmlText(option, `Phương án ${'ABCD'[index]}`)}</span></div>`).join('')}</div>`;
        }
        card.classList.add('preview-updating');
        const gradeText = q.grade ? `Lớp ${q.grade}` : (state.grade !== 'all' ? `Lớp ${state.grade}` : '');
        card.innerHTML = `
            <div class="preview-meta">
                <span class="preview-badge type-badge"><i class="fa-solid fa-shapes"></i> ${esc(TYPE_LABELS[state.type] || state.type)}</span>
                <span class="preview-badge subject-badge"><i class="fa-solid fa-book-bookmark"></i> ${esc(subjectName(q.subject_key))}</span>
                ${gradeText ? `<span class="preview-badge grade-badge"><i class="fa-solid fa-graduation-cap"></i> ${esc(gradeText)}</span>` : ''}
            </div>
            <h3 class="preview-title">${htmlText(q.question, 'Nội dung câu hỏi sẽ hiển thị ở đây...')}</h3>
            ${body}
        `;
        renderMath(card);
        requestAnimationFrame(() => card.classList.remove('preview-updating'));
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
            if (!navigator.onLine) throw new Error('Thiết bị đang ngoại tuyến (Offline)');
            const { data, error } = await state.client.from('quiz_questions').select('*').order('id', { ascending: true });
            if (error) throw error;
            state.questions = (data || []).filter((r) => !r.is_deleted).map(normalizeRow);
            setConnection(true, 'Đã kết nối');
            $('last-sync') && ($('last-sync').textContent = `Đồng bộ lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`);
            renderStats(); renderLibrary(); renderRecentActivity(); renderSubjectCatalog();
            updateHealthStatus('db', 'safe', 'Đã kết nối', 'Supabase đang hoạt động ổn định');
            updateHealthStatus('content', 'safe', 'Đã đồng bộ', `${state.questions.length} câu hỏi · ${state.subjects.length} môn học`);
            await syncSubjectQuestionCounts();
        } catch (error) {
            setConnection(false, 'Mất kết nối');
            updateHealthStatus('db', 'danger', 'Mất kết nối', 'Không thể kết nối tới Supabase. Bấm để thử lại.');
            updateHealthStatus('content', 'danger', 'Lỗi tải', 'Chưa thể đồng bộ dữ liệu câu hỏi.');
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

    function replayOverviewMetrics() {
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        ['stat-total', 'stat-grade5', 'stat-grade11', 'stat-online'].forEach((id) => {
            const element = $(id);
            if (!element) return;
            const value = Number(element.dataset.metricValue || element.textContent || 0) || 0;
            cancelAnimationFrame(element.metricAnimationFrame);
            element.dataset.metricValue = '0';
            animateMetricValue(id, value);
        });
    }

    function typeChip(q) {
        const type = q.qType || 'mcq';
        return `<span class="type-chip ${type === 'tf_group' ? 'tf' : type === 'short_answer' ? 'short' : ''}">${esc(TYPE_LABELS[type] || type)}</span>`;
    }

    function getFilteredQuestions() {
        const keyword = ($('search-input')?.value || '').toLowerCase();
        return state.questions.filter((q) => {
            const typeMatch = state.typeFilter === 'all' || (state.typeFilter === 'mcq' && q.qType === 'mcq') || (state.typeFilter === 'tf_group' && q.qType === 'tf_group') || (state.typeFilter === 'short_answer' && q.qType === 'short_answer');
            const text = `${notationText(q.question)} ${notationText(q.explanation)} ${(q.options || []).map(notationText).join(' ')} ${(q.statements || []).map((s) => notationText(s.text)).join(' ')}`.toLowerCase();
            return (state.grade === 'all' || gradeOf(q) === state.grade) && (state.subject === 'all' || subjectMatchKey(q.subject_key) === subjectMatchKey(state.subject)) && typeMatch && (!keyword || text.includes(keyword));
        });
    }

    function updateBulkBar() {
        const bar = $('library-bulk-bar');
        if (!bar) return;
        const filtered = getFilteredQuestions();
        const selectedCount = state.selectedQuestionIds.size;

        $('bulk-filtered-count') && ($('bulk-filtered-count').textContent = filtered.length);
        $('bulk-selected-count') && ($('bulk-selected-count').textContent = selectedCount);
        $('bulk-delete-count') && ($('bulk-delete-count').textContent = selectedCount);

        const selectAllCb = $('bulk-select-all-checkbox');
        if (selectAllCb) {
            const allFilteredSelected = filtered.length > 0 && filtered.every((q) => state.selectedQuestionIds.has(String(q.id)));
            selectAllCb.checked = allFilteredSelected;
            selectAllCb.indeterminate = selectedCount > 0 && !allFilteredSelected;
        }

        if (selectedCount > 0 || state.selectMode) {
            bar.classList.remove('hidden');
        } else {
            bar.classList.add('hidden');
        }
    }

    function renderLibrarySubjectTabs() {
        const container = $('library-subject-tabs');
        if (!container) return;

        const catalog = mergeSubjectCatalog(state.subjects);
        const subjectsInScope = state.grade === 'all'
            ? catalog
            : catalog.filter((item) => subjectGrade(item) === String(state.grade));

        const totalInGrade = state.questions.filter((q) => state.grade === 'all' || gradeOf(q) === state.grade).length;

        const countMap = {};
        state.questions.forEach((q) => {
            if (state.grade !== 'all' && gradeOf(q) !== state.grade) return;
            const key = q.subject_key;
            countMap[key] = (countMap[key] || 0) + 1;
        });

        const allPill = `
            <button type="button" class="subject-tab-pill ${state.subject === 'all' ? 'is-active' : ''}" data-subject-tab="all" title="Xem tất cả môn">
                <span>Tất cả môn</span>
                <span class="pill-count">${totalInGrade}</span>
            </button>
        `;

        const subjectPills = subjectsInScope.map((sub) => {
            const count = countMap[sub.key] || 0;
            const isActive = subjectMatchKey(state.subject) === subjectMatchKey(sub.key);
            return `
                <button type="button" class="subject-tab-pill ${isActive ? 'is-active' : ''}" data-subject-tab="${esc(sub.key)}" title="Lọc môn ${esc(sub.name)}">
                    <span>${esc(sub.name)}</span>
                    <span class="pill-count">${count}</span>
                </button>
            `;
        }).join('');

        container.innerHTML = allPill + subjectPills;
    }

    function renderPagination(total, totalPages) {
        const container = $('library-pagination');
        if (!container) return;

        if (total === 0) {
            container.innerHTML = '';
            return;
        }

        const pageSize = state.pageSize === 'all' ? total : Number(state.pageSize || 12);
        const startIndex = (state.page - 1) * pageSize;
        const endIndex = Math.min(startIndex + pageSize, total);

        let pageButtonsHtml = '';
        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) {
                pageButtonsHtml += `<button type="button" class="page-btn ${i === state.page ? 'is-active' : ''}" data-page="${i}">${i}</button>`;
            }
        } else {
            const current = state.page;
            const pages = [];
            pages.push(1);
            if (current > 3) pages.push('...');
            const startMid = Math.max(2, current - 1);
            const endMid = Math.min(totalPages - 1, current + 1);
            for (let i = startMid; i <= endMid; i++) {
                if (!pages.includes(i)) pages.push(i);
            }
            if (current < totalPages - 2) pages.push('...');
            if (!pages.includes(totalPages)) pages.push(totalPages);

            pageButtonsHtml = pages.map((p) => {
                if (p === '...') return `<span class="page-ellipsis">…</span>`;
                return `<button type="button" class="page-btn ${p === current ? 'is-active' : ''}" data-page="${p}">${p}</button>`;
            }).join('');
        }

        container.innerHTML = `
            <div class="pagination-info">
                Hiển thị <strong>${startIndex + 1} - ${endIndex}</strong> trên tổng số <strong>${total}</strong> câu hỏi
            </div>
            <div class="pagination-controls">
                <button type="button" class="page-btn prev-btn" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''} title="Trang trước">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                ${pageButtonsHtml}
                <button type="button" class="page-btn next-btn" data-page="${state.page + 1}" ${state.page >= totalPages ? 'disabled' : ''} title="Trang sau">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
            </div>
            <div class="page-size-selector">
                <label for="page-size-select">Hiển thị:</label>
                <select id="page-size-select">
                    <option value="12" ${state.pageSize === 12 ? 'selected' : ''}>12 câu / trang</option>
                    <option value="24" ${state.pageSize === 24 ? 'selected' : ''}>24 câu / trang</option>
                    <option value="48" ${state.pageSize === 48 ? 'selected' : ''}>48 câu / trang</option>
                    <option value="all" ${state.pageSize === 'all' ? 'selected' : ''}>Tất cả (${total})</option>
                </select>
            </div>
        `;
    }

    function renderLibrary() {
        const rows = getFilteredQuestions();
        $('library-count') && ($('library-count').textContent = rows.length);
        $('result-summary') && ($('result-summary').textContent = `${rows.length} kết quả`);
        $('empty-state')?.classList.toggle('hidden', rows.length !== 0);

        renderLibrarySubjectTabs();

        const list = $('questions-list');
        if (!list) return;

        if (rows.length === 0) {
            list.innerHTML = '';
            renderPagination(0, 1);
            updateBulkBar();
            return;
        }

        const pageSize = state.pageSize === 'all' ? rows.length : Number(state.pageSize || 12);
        const totalPages = pageSize > 0 ? Math.ceil(rows.length / pageSize) : 1;
        if (state.page > totalPages) state.page = totalPages;
        if (state.page < 1) state.page = 1;

        const startIndex = (state.page - 1) * pageSize;
        const pagedRows = rows.slice(startIndex, startIndex + pageSize);

        list.innerHTML = pagedRows.map((q) => {
            const grade = gradeOf(q);
            const isSelected = state.selectedQuestionIds.has(String(q.id));
            let answerPreview = '';
            if (q.qType === 'tf_group') answerPreview = `<div class="item-statements">${q.statements.map((s) => `<div class="item-statement"><b>${esc(s.key)}.</b>${htmlText(s.text)} <strong>${s.answer ? 'Đúng' : 'Sai'}</strong></div>`).join('')}</div>`;
            else if (q.qType === 'short_answer') answerPreview = `<div class="item-option is-correct">Đáp án: ${htmlText(q.correctValue)}</div>`;
            else answerPreview = `<div class="item-options">${q.options.slice(0, 4).map((option, index) => `<span class="item-option ${index === q.correct ? 'is-correct' : ''}"><b>${'ABCD'[index]}.</b> ${htmlText(option)}</span>`).join('')}</div>`;
            return `<article class="question-item ${isSelected ? 'is-selected' : ''}" data-item-id="${esc(q.id)}">
                <div class="question-item-head">
                    <div class="question-head-left">
                        <label class="question-select-checkbox-label" title="Chọn câu hỏi này để thao tác xóa">
                            <input type="checkbox" class="question-select-checkbox" data-select-id="${esc(q.id)}" ${isSelected ? 'checked' : ''}>
                            <span class="custom-check-box"><i class="fa-solid fa-check"></i></span>
                        </label>
                        <div class="question-tags">
                            <span class="tag ${grade === '5' ? 'grade5' : 'grade11'}">Lớp ${grade}</span>
                            <span class="tag">${esc(subjectName(q.subject_key))}</span>
                            ${typeChip(q)}
                        </div>
                    </div>
                    <span class="tag">#${esc(q.id)}</span>
                </div>
                <h3>${htmlText(q.question)}</h3>
                ${answerPreview}
                <div class="question-item-footer">
                    <small>${esc(q.category || 'Ôn tập')}</small>
                    <div class="item-actions">
                        <button class="edit-button" data-edit="${esc(q.id)}"><i class="fa-solid fa-pen"></i> Sửa</button>
                        <button class="delete-button" data-delete="${esc(q.id)}"><i class="fa-solid fa-trash"></i> Xóa</button>
                    </div>
                </div>
            </article>`;
        }).join('');
        renderMath(list);
        renderPagination(rows.length, totalPages);
        updateBulkBar();
    }

    function renderRecentActivity() {
        const list = $('recent-activity');
        if (!list) return;
        const logs = Array.isArray(state.activityLogs) ? state.activityLogs : [];
        if (!logs.length) {
            list.innerHTML = `
                <div class="activity-empty-state">
                    <span class="activity-empty-icon"><i class="fa-solid fa-clock-rotate-left"></i></span>
                    <h3>Chưa có hoạt động mới</h3>
                    <p>Các thao tác cập nhật câu hỏi, đổi bảo trì hoặc phát thông báo sẽ hiển thị tại đây</p>
                </div>
            `;
            return;
        }
        const iconForLog = (item) => {
            const act = String(item.action || '').toLowerCase();
            const cat = String(item.category || '').toLowerCase();
            if (cat === 'danger' || act.includes('xóa') || act.includes('chặn')) return { icon: 'fa-trash-can', tone: 'danger' };
            if (cat === 'maintenance' || act.includes('bảo trì') || act.includes('khóa web')) return { icon: 'fa-shield-halved', tone: 'warning' };
            if (cat === 'broadcast' || act.includes('thông báo')) return { icon: 'fa-bullhorn', tone: 'green' };
            if (cat === 'import' || act.includes('nạp')) return { icon: 'fa-file-import', tone: 'cyan' };
            return { icon: 'fa-file-pen', tone: 'purple' };
        };
        const formatLogTime = (iso) => {
            if (!iso) return 'Vừa xong';
            const date = new Date(iso);
            if (Number.isNaN(date.getTime())) return 'Vừa xong';
            return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        };
        list.innerHTML = logs.slice(0, 6).map((item) => {
            const meta = iconForLog(item);
            return `
                <div class="activity-item">
                    <i class="fa-solid ${meta.icon} activity-icon-${meta.tone}"></i>
                    <span class="activity-main">
                        <b>${esc(item.action)}</b>
                        <small>${htmlText(item.detail || 'Thao tác quản trị hệ thống')}</small>
                    </span>
                    <time class="activity-time">${esc(formatLogTime(item.timestamp))}</time>
                </div>
            `;
        }).join('');
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
        const resolvedGrade = String(normalized.grade || $('grade-select')?.value || (state.grade && state.grade !== 'all' ? state.grade : '11'));
        const record = {
            ...(id ? { id: Number(id) } : {}), subject_key: subjectKey || normalized.subject_key || 'history', grade: resolvedGrade, category: normalized.category || 'Bài tập',
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
        let maxId = 0;
        if (Array.isArray(state.questions) && state.questions.length > 0) {
            for (const q of state.questions) {
                const num = Number(q.id);
                if (Number.isFinite(num) && num > 0 && num < 2000000000) {
                    if (num > maxId) maxId = num;
                }
            }
        }

        try {
            if (state.client) {
                const { data, error } = await state.client
                    .from('quiz_questions')
                    .select('id')
                    .order('id', { ascending: false })
                    .limit(1);
                if (!error && Array.isArray(data) && data.length > 0) {
                    const parsed = Number(data[0].id);
                    if (Number.isFinite(parsed) && parsed > 0 && parsed < 2000000000) {
                        if (parsed > maxId) maxId = parsed;
                    }
                }
            }
        } catch (e) {
            console.warn('[nextQuestionId] Lỗi lấy max ID từ CSDL:', e);
        }

        const safeMax = (Number.isFinite(maxId) && maxId > 0) ? maxId : 1000;
        return safeMax + 1;
    }

    async function saveQuestion(event) {
        event?.preventDefault();
        const q = readQuestion();
        const valid = q.question.length > 0 && ((q.q_type === 'mcq' && q.options.every((item) => item.trim().length > 0)) || (q.q_type === 'tf_group' && q.statements.every((item) => item.text.trim().length > 0)) || (q.q_type === 'short_answer' && q.correct_value.length > 0));
        if (!valid) return notify('Vui lòng nhập đủ nội dung theo loại câu hỏi.', true);
        try {
            const isEditing = Boolean(state.editingId);
            const recordId = state.editingId || await nextQuestionId();
            const record = toRecord(q, q.subject_key, recordId);
            const { error } = await state.client.from('quiz_questions').upsert(record, { onConflict: 'id' }).select();
            if (error) throw error;
            addActivityLog(
                isEditing ? `Cập nhật câu hỏi #${recordId}` : `Thêm câu hỏi mới #${recordId}`,
                `${subjectName(q.subject_key)} · ${TYPE_LABELS[q.q_type] || q.q_type}`,
                'question'
            );
            notify(isEditing ? 'Đã cập nhật câu hỏi.' : 'Đã thêm câu hỏi.');
            resetForm(); await loadQuestions();
        } catch (error) { notify(`Không thể lưu: ${error.message}`, true); }
    }

    function updateTrashBadge() {
        const badge = $('trash-count-badge');
        if (badge) {
            const count = Array.isArray(state.trashQuestions) ? state.trashQuestions.length : 0;
            badge.textContent = String(count);
            badge.classList.toggle('has-items', count > 0);
        }
    }

    async function loadTrash() {
        updateTrashBadge();
        try {
            const row = await systemRow(SYSTEM.trash);
            if (row && row.score_summary) {
                try {
                    const parsed = JSON.parse(row.score_summary);
                    if (Array.isArray(parsed)) {
                        state.trashQuestions = parsed;
                        localStorage.setItem('quiz_trash_questions', JSON.stringify(parsed));
                    }
                } catch (e) {
                    console.warn('[Quiz Studio Admin] Lỗi đọc thùng rác từ Cloud:', e);
                }
            }
        } catch (err) {
            console.warn('[Quiz Studio Admin] Chưa thể tải thùng rác từ Cloud:', err);
        } finally {
            updateTrashBadge();
            if (!$('trash-modal')?.classList.contains('hidden')) {
                renderTrashModal();
            }
        }
    }

    async function saveTrash() {
        updateTrashBadge();
        try {
            localStorage.setItem('quiz_trash_questions', JSON.stringify(state.trashQuestions));
        } catch (e) {}

        if (state.client) {
            try {
                await state.client.from('quiz_logins').upsert({
                    id: SYSTEM.trash,
                    player_name: '__TRASH_BIN__',
                    ip_address: 'SYSTEM',
                    device_info: 'TRASH_STORAGE',
                    status: 'ACTIVE',
                    score_summary: JSON.stringify(state.trashQuestions),
                    last_active: new Date().toISOString()
                }, { onConflict: 'id' });
            } catch (error) {
                console.warn('[Quiz Studio Admin] Lỗi đồng bộ thùng rác lên Cloud:', error);
            }
        }
    }

    async function moveQuestionsToTrash(questionsToTrash, actionTitle = 'Chuyển câu hỏi vào thùng rác', detailLog = '') {
        if (!Array.isArray(questionsToTrash) || questionsToTrash.length === 0) return;
        const total = questionsToTrash.length;
        const idsToDelete = questionsToTrash.map((q) => q.id).filter(Boolean);

        // Xóa theo batch 50 câu trên Supabase
        const chunkSize = 50;
        for (let i = 0; i < idsToDelete.length; i += chunkSize) {
            const chunk = idsToDelete.slice(i, i + chunkSize);
            const { error } = await state.client.from('quiz_questions').delete().in('id', chunk);
            if (error) throw error;
        }

        const now = new Date().toISOString();
        const trashedItems = questionsToTrash.map((q) => ({
            ...q,
            is_deleted: true,
            deleted_at: now,
            deleted_by: 'Admin'
        }));

        const idSet = new Set(questionsToTrash.map((q) => String(q.id)));
        state.trashQuestions = [
            ...trashedItems,
            ...state.trashQuestions.filter((q) => !idSet.has(String(q.id)))
        ];
        await saveTrash();

        state.questions = state.questions.filter((q) => !idSet.has(String(q.id)));
        if (state.editingId && idSet.has(String(state.editingId))) resetForm();

        // Gỡ bỏ khỏi danh sách đang chọn
        questionsToTrash.forEach((q) => state.selectedQuestionIds.delete(String(q.id)));

        addActivityLog(
            actionTitle,
            detailLog || `Đã lưu trữ an toàn ${total} câu hỏi vào Thùng rác`,
            'danger'
        );
        renderStats();
        renderLibrary();
        renderRecentActivity();
        renderSubjectCatalog();
        await syncSubjectQuestionCounts();
    }

    async function deleteQuestion(id) {
        const targetQ = state.questions.find((item) => String(item.id) === String(id));
        if (!targetQ) return;
        if (!(await confirmDialog({
            title: `Chuyển câu hỏi #${id} vào thùng rác?`,
            message: `Câu hỏi #${id} (${subjectName(targetQ.subject_key)}) sẽ được chuyển vào Thùng rác.\nBạn có thể khôi phục lại bất kỳ lúc nào nếu xóa nhầm.`,
            confirmText: 'Chuyển vào thùng rác',
            variant: 'danger',
            icon: 'fa-trash-arrow-up'
        }))) return;

        try {
            await moveQuestionsToTrash(
                [targetQ],
                `Chuyển câu hỏi #${id} vào thùng rác`,
                `Môn ${subjectName(targetQ.subject_key)} · Đã lưu trữ an toàn trong Thùng rác`
            );
            notify(`Đã chuyển câu hỏi #${id} vào thùng rác.`);
        } catch (error) {
            notify(`Không thể xóa: ${error.message}`, true);
        }
    }

    function openDeleteScopeModal() {
        const filtered = getFilteredQuestions();
        const total = state.questions.length;
        const subjectFiltered = state.subject !== 'all';
        const gradeFiltered = state.grade !== 'all';

        let filterDesc = 'Chuyển các câu hỏi đang lọc vào Thùng rác.';
        if (subjectFiltered && gradeFiltered) {
            filterDesc = `Chuyển ${filtered.length} câu hỏi thuộc môn [${subjectName(state.subject)}] (Lớp ${state.grade}) vào Thùng rác.`;
        } else if (subjectFiltered) {
            filterDesc = `Chuyển ${filtered.length} câu hỏi thuộc môn [${subjectName(state.subject)}] vào Thùng rác.`;
        } else if (gradeFiltered) {
            filterDesc = `Chuyển ${filtered.length} câu hỏi thuộc [Lớp ${state.grade}] vào Thùng rác.`;
        } else {
            filterDesc = `Chuyển ${filtered.length} câu hỏi đang hiển thị theo bộ lọc vào Thùng rác.`;
        }

        $('delete-scope-filtered-desc') && ($('delete-scope-filtered-desc').textContent = filterDesc);
        $('delete-scope-filtered-badge') && ($('delete-scope-filtered-badge').textContent = `${filtered.length} câu hỏi`);
        $('delete-scope-total-count') && ($('delete-scope-total-count').textContent = total);

        const btnFilter = $('btn-delete-current-filter');
        if (btnFilter) {
            btnFilter.disabled = filtered.length === 0;
            btnFilter.innerHTML = `<i class="fa-solid fa-trash-arrow-up"></i> Xóa bài đang lọc (${filtered.length} câu)`;
        }

        const inputConfirm = $('delete-all-confirm-input');
        if (inputConfirm) inputConfirm.value = '';

        const btnAll = $('btn-delete-all-guarded');
        if (btnAll) {
            btnAll.disabled = true;
            btnAll.classList.add('is-disabled');
        }

        openModal('delete-scope-modal');
    }

    async function deleteFilteredQuestions() {
        const filtered = getFilteredQuestions();
        if (filtered.length === 0) return notify('Không có câu hỏi nào theo bộ lọc hiện tại để xóa.', true);

        closeModal('delete-scope-modal');

        const ok = await confirmDialog({
            title: `Xác nhận xóa ${filtered.length} câu hỏi?`,
            message: `Chuyển toàn bộ ${filtered.length} câu hỏi của bài/môn đang lọc vào Thùng rác?\n\nBạn có thể khôi phục lại bất kỳ lúc nào nếu cần.`,
            confirmText: `Xóa ${filtered.length} câu này`,
            variant: 'danger',
            icon: 'fa-trash-arrow-up'
        });
        if (!ok) return;

        try {
            await moveQuestionsToTrash(
                filtered,
                `Xóa ${filtered.length} câu theo bộ lọc`,
                `Đã chuyển ${filtered.length} câu hỏi của bài/môn đang chọn vào Thùng rác`
            );
            notify(`Đã chuyển ${filtered.length} câu hỏi vào Thùng rác.`);
        } catch (error) {
            notify(`Không thể xóa: ${error.message}`, true);
        }
    }

    async function deleteSelectedQuestions() {
        const selected = state.questions.filter((q) => state.selectedQuestionIds.has(String(q.id)));
        if (selected.length === 0) return notify('Chưa chọn câu hỏi nào để xóa.', true);

        const ok = await confirmDialog({
            title: `Xác nhận xóa ${selected.length} câu hỏi đã chọn?`,
            message: `Chuyển ${selected.length} câu hỏi bạn đã đánh dấu vào Thùng rác?\n\nBạn có thể khôi phục lại bất kỳ lúc nào từ Thùng rác.`,
            confirmText: `Xóa ${selected.length} câu đã chọn`,
            variant: 'danger',
            icon: 'fa-trash-arrow-up'
        });
        if (!ok) return;

        try {
            await moveQuestionsToTrash(
                selected,
                `Xóa ${selected.length} câu hỏi đã chọn`,
                `Đã chuyển ${selected.length} câu hỏi đã chọn vào Thùng rác`
            );
            notify(`Đã chuyển ${selected.length} câu hỏi đã chọn vào Thùng rác.`);
        } catch (error) {
            notify(`Không thể xóa: ${error.message}`, true);
        }
    }

    async function deleteAllQuestionsGuarded() {
        const input = $('delete-all-confirm-input');
        if (!input || input.value.trim().toUpperCase() !== 'XOA HET') {
            return notify('Vui lòng nhập đúng chữ "XOA HET" để xác nhận.', true);
        }
        closeModal('delete-scope-modal');
        const total = state.questions.length;
        if (total === 0) return notify('Ngân hàng câu hỏi hiện đang trống.', true);

        try {
            await moveQuestionsToTrash(
                [...state.questions],
                'Chuyển toàn bộ câu hỏi vào thùng rác',
                `Đã lưu trữ an toàn ${total} câu hỏi vào Thùng rác`
            );
            notify(`Đã chuyển toàn bộ ${total} câu hỏi vào thùng rác an toàn.`);
        } catch (error) {
            notify(`Không thể xóa: ${error.message}`, true);
            await loadQuestions();
        }
    }

    async function restoreQuestion(id) {
        const item = state.trashQuestions.find((q) => String(q.id) === String(id));
        if (!item) return notify('Không tìm thấy câu hỏi trong thùng rác.', true);

        try {
            let targetId = Number(item.id);
            if (!Number.isFinite(targetId) || targetId <= 0 || targetId > 2000000000) {
                targetId = await nextQuestionId();
            } else {
                // Kiểm tra xem ID cũ có đang bị câu hỏi khác chiếm dụng không
                const existsLocally = state.questions.some((q) => Number(q.id) === targetId);
                let existsInDb = false;
                if (!existsLocally && state.client) {
                    try {
                        const { data: existing } = await state.client
                            .from('quiz_questions')
                            .select('id')
                            .eq('id', targetId)
                            .maybeSingle();
                        if (existing) existsInDb = true;
                    } catch (e) {}
                }
                if (existsLocally || existsInDb) {
                    // ID cũ đã bị chiếm dụng -> Cấp ID mới nhất
                    targetId = await nextQuestionId();
                }
            }

            targetId = Math.floor(Number(targetId));
            if (!Number.isFinite(targetId) || targetId <= 0 || targetId > 2000000000) {
                targetId = await nextQuestionId();
            }

            const rowToInsert = {
                id: targetId,
                subject_key: item.subject_key || item.subjectKey || 'history',
                category: item.category || 'Ôn tập',
                q_type: item.q_type || item.qType || 'mcq',
                question: storageText(item.question),
                options: Array.isArray(item.options) ? item.options.map(storageText) : [],
                statements: Array.isArray(item.statements) ? item.statements.map((s, index) => ({
                    key: s.key || 'abcd'[index],
                    label: s.label || s.key || 'abcd'[index],
                    text: storageText(s.text ?? s.content),
                    answer: parseBool(s.answer ?? s.correctAnswer)
                })) : [],
                correct: Number(item.correct ?? item.answer ?? 0),
                answer: Number(item.answer ?? item.correct ?? 0),
                correct_value: String(item.correct_value ?? item.correctValue ?? ''),
                explanation: storageText(item.explanation || ''),
                image_url: item.image_url || item.imageUrl || '',
                updated_at: new Date().toISOString()
            };

            const { error } = await state.client.from('quiz_questions').upsert(rowToInsert, { onConflict: 'id' });
            if (error) throw error;

            state.trashQuestions = state.trashQuestions.filter((q) => String(q.id) !== String(id));
            await saveTrash();

            addActivityLog(
                `Khôi phục câu hỏi #${rowToInsert.id}`,
                `Môn ${subjectName(item.subject_key || item.subjectKey)} đã đưa về ngân hàng`,
                'green'
            );
            notify(`Đã khôi phục thành công câu hỏi #${rowToInsert.id}!`);
            await loadQuestions();
            renderTrashModal();
            await syncSubjectQuestionCounts();
        } catch (error) {
            notify(`Không thể khôi phục: ${error.message}`, true);
        }
    }

    async function restoreAllTrash() {
        const total = state.trashQuestions.length;
        if (total === 0) return notify('Thùng rác hiện đang trống.', true);
        if (!(await confirmDialog({
            title: 'Khôi phục tất cả câu hỏi?',
            message: `Khôi phục toàn bộ ${total} câu hỏi trong thùng rác trở lại Ngân hàng câu hỏi?`,
            confirmText: 'Khôi phục tất cả',
            variant: 'primary',
            icon: 'fa-rotate-left'
        }))) return;

        try {
            // Lấy danh sách ID hiện có trong CSDL và bộ nhớ để tránh trùng lặp
            const usedIds = new Set();
            (state.questions || []).forEach((q) => {
                const num = Number(q.id);
                if (Number.isFinite(num) && num > 0 && num < 2000000000) usedIds.add(num);
            });
            if (state.client) {
                try {
                    const { data: existingRows } = await state.client.from('quiz_questions').select('id');
                    (existingRows || []).forEach((r) => {
                        const num = Number(r.id);
                        if (Number.isFinite(num) && num > 0 && num < 2000000000) usedIds.add(num);
                    });
                } catch (e) {}
            }
            let maxId = 1000;
            usedIds.forEach((id) => {
                if (id > maxId) maxId = id;
            });

            const rows = state.trashQuestions.map((item) => {
                let targetId = Number(item.id);
                if (!Number.isFinite(targetId) || targetId <= 0 || targetId > 2000000000 || usedIds.has(targetId)) {
                    maxId++;
                    targetId = maxId;
                }
                targetId = Math.floor(targetId);
                usedIds.add(targetId);

                return {
                    id: targetId,
                    subject_key: item.subject_key || item.subjectKey || 'history',
                    category: item.category || 'Ôn tập',
                    q_type: item.q_type || item.qType || 'mcq',
                    question: storageText(item.question),
                    options: Array.isArray(item.options) ? item.options.map(storageText) : [],
                    statements: Array.isArray(item.statements) ? item.statements.map((s, index) => ({
                        key: s.key || 'abcd'[index],
                        label: s.label || s.key || 'abcd'[index],
                        text: storageText(s.text ?? s.content),
                        answer: parseBool(s.answer ?? s.correctAnswer)
                    })) : [],
                    correct: Number(item.correct ?? item.answer ?? 0),
                    answer: Number(item.answer ?? item.correct ?? 0),
                    correct_value: String(item.correct_value ?? item.correctValue ?? ''),
                    explanation: storageText(item.explanation || ''),
                    image_url: item.image_url || item.imageUrl || '',
                    updated_at: new Date().toISOString()
                };
            });

            // Ghi theo từng chunk 50 câu để tránh quá tải
            const chunkSize = 50;
            for (let i = 0; i < rows.length; i += chunkSize) {
                const chunk = rows.slice(i, i + chunkSize);
                const { error } = await state.client.from('quiz_questions').upsert(chunk, { onConflict: 'id' });
                if (error) throw error;
            }

            state.trashQuestions = [];
            await saveTrash();

            addActivityLog(
                `Khôi phục toàn bộ ${total} câu hỏi`,
                'Toàn bộ câu hỏi trong Thùng rác đã được đưa trở lại ngân hàng',
                'green'
            );
            notify(`Đã khôi phục thành công toàn bộ ${total} câu hỏi!`);
            await loadQuestions();
            renderTrashModal();
            await syncSubjectQuestionCounts();
        } catch (error) {
            notify(`Không thể khôi phục: ${error.message}`, true);
        }
    }

    async function hardDeleteQuestion(id) {
        if (!(await confirmDialog({
            title: `XÓA VĨNH VIỄN câu hỏi #${id}?`,
            message: `Hành động này sẽ XÓA TRIỆT ĐỂ câu hỏi #${id} khỏi hệ thống và KHÔNG THỂ HOÀN TÁC! Bạn có chắc chắn muốn xóa?`,
            confirmText: 'Xóa vĩnh viễn',
            variant: 'danger',
            icon: 'fa-triangle-exclamation'
        }))) return;

        state.trashQuestions = state.trashQuestions.filter((q) => String(q.id) !== String(id));
        await saveTrash();
        addActivityLog(
            `Xóa vĩnh viễn câu hỏi #${id}`,
            'Đã xóa triệt để khỏi thùng rác',
            'danger'
        );
        notify(`Đã xóa vĩnh viễn câu hỏi #${id}.`);
        renderTrashModal();
    }

    async function emptyTrash() {
        const total = state.trashQuestions.length;
        if (total === 0) return notify('Thùng rác hiện đang trống.', true);
        if (!(await confirmDialog({
            title: 'DỌN SẠCH THÙNG RÁC?',
            message: `CẢNH BÁO NGUY HIỂM: Bạn sắp xóa vĩnh viễn toàn bộ ${total} câu hỏi trong Thùng rác. Thao tác này sẽ xóa triệt để dữ liệu và KHÔNG THỂ KHÔI PHỤC!`,
            confirmText: 'Xác nhận dọn sạch',
            variant: 'danger',
            icon: 'fa-broom'
        }))) return;

        state.trashQuestions = [];
        await saveTrash();
        addActivityLog(
            'Dọn sạch thùng rác',
            `Đã xóa vĩnh viễn ${total} câu hỏi khỏi lưu trữ`,
            'danger'
        );
        notify(`Đã dọn sạch thùng rác (${total} câu hỏi đã bị xóa vĩnh viễn).`);
        renderTrashModal();
    }

    function renderTrashModal() {
        const container = $('trash-list');
        const emptyEl = $('trash-empty-state');
        const countEl = $('trash-modal-count');
        const filterSelect = $('trash-subject-filter');
        const searchVal = ($('trash-search-input')?.value || '').toLowerCase().trim();
        const subjectFilterVal = $('trash-subject-filter')?.value || 'all';

        const list = Array.isArray(state.trashQuestions) ? state.trashQuestions : [];
        if (countEl) countEl.textContent = `${list.length} câu hỏi`;

        if (filterSelect) {
            const currentSelected = filterSelect.value || 'all';
            const subjectsInTrash = Array.from(new Set(list.map((q) => q.subject_key || q.subjectKey).filter(Boolean)));
            filterSelect.innerHTML = '<option value="all">Tất cả môn học</option>' + subjectsInTrash.map((key) => {
                return `<option value="${esc(key)}">${esc(subjectName(key))}</option>`;
            }).join('');
            if (subjectsInTrash.includes(currentSelected)) {
                filterSelect.value = currentSelected;
            }
        }

        const filtered = list.filter((q) => {
            const sub = q.subject_key || q.subjectKey;
            const matchSub = subjectFilterVal === 'all' || subjectMatchKey(sub) === subjectMatchKey(subjectFilterVal);
            const text = `${notationText(q.question)} ${notationText(q.explanation)} ${(q.options || []).map(notationText).join(' ')}`.toLowerCase();
            const matchSearch = !searchVal || text.includes(searchVal) || String(q.id).includes(searchVal);
            return matchSub && matchSearch;
        });

        if (!container) return;

        if (!filtered.length) {
            container.innerHTML = '';
            if (emptyEl) {
                emptyEl.classList.remove('hidden');
                const p = emptyEl.querySelector('p');
                if (p) {
                    p.textContent = list.length === 0
                        ? 'Không có câu hỏi nào bị xóa tạm trong hệ thống.'
                        : 'Không tìm thấy câu hỏi phù hợp với từ khóa lọc.';
                }
            }
            return;
        }

        if (emptyEl) emptyEl.classList.add('hidden');

        container.innerHTML = filtered.map((q) => {
            const grade = gradeOf(q);
            const deletedTime = q.deleted_at ? new Date(q.deleted_at).toLocaleString('vi-VN', {
                hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric'
            }) : 'Vừa xong';
            let preview = '';
            if (q.q_type === 'tf_group' || q.qType === 'tf_group') {
                const stmts = Array.isArray(q.statements) ? q.statements : [];
                preview = `<div class="trash-statements">${stmts.map((s) => `<div><b>${esc(s.key || '')}.</b> ${htmlText(s.text)} <small>(${s.answer ? 'Đúng' : 'Sai'})</small></div>`).join('')}</div>`;
            } else if (q.q_type === 'short_answer' || q.qType === 'short_answer') {
                preview = `<div class="trash-option">Đáp án: <strong>${htmlText(q.correct_value ?? q.correctValue ?? '')}</strong></div>`;
            } else if (Array.isArray(q.options)) {
                preview = `<div class="trash-options">${q.options.slice(0, 4).map((opt, i) => `<span class="${i === Number(q.correct ?? q.answer ?? 0) ? 'is-correct' : ''}"><b>${'ABCD'[i]}.</b> ${htmlText(opt)}</span>`).join('')}</div>`;
            }

            return `
                <div class="trash-item" data-trash-id="${esc(q.id)}">
                    <div class="trash-item-head">
                        <div class="trash-tags">
                            <span class="tag ${grade === '5' ? 'grade5' : 'grade11'}">Lớp ${grade}</span>
                            <span class="tag">${esc(subjectName(q.subject_key || q.subjectKey))}</span>
                            <span class="tag">#${esc(q.id)}</span>
                        </div>
                        <span class="trash-time"><i class="fa-regular fa-clock"></i> Xóa: ${esc(deletedTime)}</span>
                    </div>
                    <div class="trash-question-title">${htmlText(q.question)}</div>
                    ${preview}
                    <div class="trash-item-footer">
                        <button class="button button-primary compact" data-restore-id="${esc(q.id)}" type="button">
                            <i class="fa-solid fa-rotate-left"></i> Khôi phục
                        </button>
                        <button class="button button-danger compact" data-hard-delete-id="${esc(q.id)}" type="button">
                            <i class="fa-solid fa-trash-can"></i> Xóa vĩnh viễn
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        renderMath(container);
    }

    function openPrintModal() {
        const subjectSelect = $('print-subject-select');
        if (subjectSelect) {
            const catalog = mergeSubjectCatalog(state.subjects);
            subjectSelect.innerHTML = '<option value="all">Tất cả các môn học</option>' + catalog.map((item) => {
                const gradeLabel = subjectGrade(item) ? ` (Lớp ${subjectGrade(item)})` : '';
                return `<option value="${esc(item.key)}">${esc(item.name)}${gradeLabel}</option>`;
            }).join('');
            if (state.subject && state.subject !== 'all') {
                subjectSelect.value = state.subject;
            } else {
                subjectSelect.value = 'all';
            }
        }

        const gradeSelect = $('print-grade-select');
        if (gradeSelect) {
            gradeSelect.value = state.grade || 'all';
        }

        updatePrintQuestionsPreview();
        openModal('print-modal');
    }

    function updatePrintQuestionsPreview() {
        const subject = $('print-subject-select')?.value || 'all';
        const grade = $('print-grade-select')?.value || 'all';
        const available = state.questions.filter((q) => {
            const matchGrade = grade === 'all' || gradeOf(q) === grade;
            const matchSubject = subject === 'all' || subjectMatchKey(q.subject_key) === subjectMatchKey(subject);
            return matchGrade && matchSubject;
        });

        const infoEl = $('print-available-count');
        if (infoEl) {
            infoEl.textContent = `Hiện có ${available.length} câu hỏi phù hợp trong ngân hàng`;
        }
    }

    function renderMathAndWait(element) {
        return new Promise((resolve) => {
            renderMath(element);
            setTimeout(resolve, 380);
        });
    }

    async function executePrintExam() {
        const subjectKey = $('print-subject-select')?.value || 'all';
        const gradeVal = $('print-grade-select')?.value || 'all';
        const examTitle = $('print-title-input')?.value?.trim() || 'ĐỀ KIỂM TRA ĐÁNH GIÁ CHẤT LƯỢNG HỌC KỲ';
        const schoolName = $('print-school-input')?.value?.trim() || 'SỞ GIÁO DỤC VÀ ĐÀO TẠO - TRƯỜNG QUIZ STUDIO';
        const testCode = $('print-code-input')?.value?.trim() || '101';
        const duration = $('print-duration-input')?.value?.trim() || '45 phút (không kể thời gian phát đề)';
        const countLimit = parseInt($('print-count-input')?.value || '0', 10);
        const shouldShuffle = $('print-shuffle-check')?.checked || false;
        const printMode = $('print-mode-select')?.value || 'exam_and_answers';

        let pool = state.questions.filter((q) => {
            const matchGrade = gradeVal === 'all' || gradeOf(q) === gradeVal;
            const matchSubject = subjectKey === 'all' || subjectMatchKey(q.subject_key) === subjectMatchKey(subjectKey);
            return matchGrade && matchSubject;
        });

        if (!pool.length) {
            return notify('Không có câu hỏi nào thỏa mãn điều kiện lọc để xuất đề!', true);
        }

        if (shouldShuffle) {
            pool = [...pool];
            for (let i = pool.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [pool[i], pool[j]] = [pool[j], pool[i]];
            }
        }

        if (countLimit > 0 && countLimit < pool.length) {
            pool = pool.slice(0, countLimit);
        }

        const printContainer = $('print-paper');
        if (!printContainer) return;

        const subjectTitle = subjectKey === 'all' ? 'TỔNG HỢP KIẾN THỨC' : subjectName(subjectKey).toUpperCase();
        const gradeTitle = gradeVal === 'all' ? '' : ` - KHỐI ${gradeVal}`;

        let html = `
            <div class="print-page-document">
                <header class="print-exam-header">
                    <div class="print-header-col print-col-left">
                        <div class="print-school-name">${esc(schoolName.toUpperCase())}</div>
                        <div class="print-exam-badge">ĐỀ THI CHÍNH THỨC</div>
                        <div class="print-sub-note"><em>(Đề thi gồm ${pool.length} câu)</em></div>
                    </div>
                    <div class="print-header-col print-col-right">
                        <div class="print-nation-title">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
                        <div class="print-motto">Độc lập - Tự do - Hạnh phúc</div>
                        <div class="print-header-divider"></div>
                    </div>
                </header>

                <div class="print-exam-center-title">
                    <h2>${esc(examTitle.toUpperCase())}</h2>
                    <div class="print-subject-line">Môn thi: <strong>${esc(subjectTitle)}</strong>${esc(gradeTitle)}</div>
                    <div class="print-duration-line"><em>Thời gian làm bài: ${esc(duration)}</em></div>
                </div>

                <div class="print-student-info-bar">
                    <div class="print-info-left">
                        <div class="print-info-row">
                            <span class="info-label">Họ và tên thí sinh:</span>
                            <span class="info-dots">......................................................................................................</span>
                        </div>
                        <div class="print-info-row">
                            <span class="info-label">Số báo danh:</span>
                            <span class="info-dots">..................................................................</span>
                            <span class="info-label" style="margin-left: 18px;">Lớp:</span>
                            <span class="info-dots">..................................</span>
                        </div>
                    </div>
                    <div class="print-test-code-badge">
                        <span>MÃ ĐỀ THI</span>
                        <strong>${esc(testCode)}</strong>
                    </div>
                </div>

                <div class="print-questions-body">
        `;

        pool.forEach((q, idx) => {
            const qNum = idx + 1;
            let optionsHtml = '';
            const qType = q.q_type || q.qType || 'mcq';

            if (qType === 'tf_group' && Array.isArray(q.statements) && q.statements.length > 0) {
                optionsHtml = `
                    <div class="print-tf-grid">
                        ${q.statements.map((s) => `
                            <div class="print-tf-statement">
                                <span class="tf-key"><strong>${esc(s.key || '')})</strong></span>
                                <span class="tf-content">${htmlText(s.text)}</span>
                                <span class="tf-brackets">[ Đúng / Sai ]</span>
                            </div>
                        `).join('')}
                    </div>
                `;
            } else if (qType === 'short_answer') {
                optionsHtml = `
                    <div class="print-short-field">
                        <span><strong>Đáp án:</strong></span>
                        <span class="print-short-line">........................................................................................................................</span>
                    </div>
                `;
            } else {
                const opts = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
                const maxLen = opts.reduce((acc, cur) => Math.max(acc, notationText(cur).length), 0);
                let colClass = 'cols-1';
                if (maxLen <= 22) colClass = 'cols-4';
                else if (maxLen <= 50) colClass = 'cols-2';

                optionsHtml = `
                    <div class="print-options-grid ${colClass}">
                        ${opts.map((opt, oIdx) => `
                            <div class="print-opt-item">
                                <span class="opt-label"><strong>${'ABCD'[oIdx]}.</strong></span>
                                <span class="opt-text">${htmlText(opt)}</span>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            html += `
                <div class="print-question-block">
                    <div class="print-question-text">
                        <span class="q-label"><strong>Câu ${qNum}:</strong></span>
                        <span class="q-content">${htmlText(q.question)}</span>
                    </div>
                    ${optionsHtml}
                </div>
            `;
        });

        html += `
                </div>
                <div class="print-end-exam">
                    <div class="end-rule">---------- HẾT ----------</div>
                    <div class="end-note"><em>Cán bộ coi thi không giải thích gì thêm. Thí sinh không được sử dụng tài liệu.</em></div>
                </div>
            </div>
        `;

        if (printMode === 'exam_and_answers') {
            html += `
                <div class="print-answers-page">
                    <div class="print-answers-header">
                        <h2>HƯỚNG DẪN CHẤM VÀ ĐÁP ÁN CHI TIẾT</h2>
                        <p>Môn thi: <strong>${esc(subjectTitle)}</strong>${esc(gradeTitle)} — Mã đề thi: <strong>${esc(testCode)}</strong></p>
                    </div>

                    <div class="print-section-title">I. BẢNG ĐÁP ÁN NHANH</div>
            `;

            const chunkSize = 10;
            for (let i = 0; i < pool.length; i += chunkSize) {
                const chunk = pool.slice(i, i + chunkSize);
                html += `
                    <table class="print-matrix-table">
                        <thead>
                            <tr>
                                <th class="matrix-label">Câu</th>
                                ${chunk.map((_, cIdx) => `<th>${i + cIdx + 1}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td class="matrix-label"><strong>Đ/A</strong></td>
                                ${chunk.map((q) => {
                                    const qType = q.q_type || q.qType || 'mcq';
                                    if (qType === 'tf_group' && Array.isArray(q.statements)) {
                                        const tfSummary = q.statements.map((s) => `${s.key || ''}:${s.answer ? 'Đ' : 'S'}`).join(' ');
                                        return `<td class="matrix-tf">${esc(tfSummary)}</td>`;
                                    }
                                    if (qType === 'short_answer') {
                                        return `<td class="matrix-val">${esc(q.correct_value ?? q.correctValue ?? '')}</td>`;
                                    }
                                    const correctLetter = 'ABCD'[Number(q.correct ?? q.answer ?? 0)] || 'A';
                                    return `<td><strong>${correctLetter}</strong></td>`;
                                }).join('')}
                            </tr>
                        </tbody>
                    </table>
                `;
            }

            html += `
                <div class="print-section-title" style="margin-top: 22px;">II. HƯỚNG DẪN GIẢI CHI TIẾT</div>
                <div class="print-solutions-list">
            `;

            pool.forEach((q, idx) => {
                const qNum = idx + 1;
                let ansSummary = '';
                const qType = q.q_type || q.qType || 'mcq';
                if (qType === 'tf_group' && Array.isArray(q.statements)) {
                    ansSummary = q.statements.map((s) => `Ý ${s.key || ''}: ${s.answer ? 'ĐÚNG' : 'SAI'}`).join(', ');
                } else if (qType === 'short_answer') {
                    ansSummary = `Đáp án: ${q.correct_value ?? q.correctValue ?? ''}`;
                } else {
                    ansSummary = `Đáp án đúng: ${'ABCD'[Number(q.correct ?? q.answer ?? 0)]}`;
                }

                const explanationContent = q.explanation ? htmlText(q.explanation) : '<em>(Không có lời giải thích chi tiết)</em>';

                html += `
                    <div class="print-solution-item">
                        <div class="solution-header">
                            <strong>Câu ${qNum}:</strong>
                            <span class="solution-badge">${esc(ansSummary)}</span>
                        </div>
                        <div class="solution-body">
                            ${explanationContent}
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        printContainer.innerHTML = html;
        closeModal('print-modal');

        notify('Đang kết xuất đề thi và mở hộp thoại in...');
        await renderMathAndWait(printContainer);

        window.print();
        addActivityLog(
            'Xuất đề thi PDF / Bản in',
            `Môn ${esc(subjectTitle)} · ${pool.length} câu hỏi · Mã đề ${esc(testCode)}`,
            'purple'
        );
    }

    async function deleteSubjectQuestions(key) {
        const subject = state.subjects.find((item) => (item.key || item.subject_key) === key);
        const name = subject?.name || key;
        const currentCount = state.questions.filter((question) => subjectMatchKey(question.subject_key || question.subjectKey) === subjectMatchKey(key)).length;
        if (!currentCount && !(await confirmDialog({ title: 'Kiểm tra & Dọn dữ liệu Cloud?', message: `Không thấy câu hỏi đã tải cho môn ${name}. Vẫn kiểm tra và dọn dữ liệu Cloud?`, confirmText: 'Dọn dữ liệu', variant: 'warning' }))) return;
        if (currentCount && !(await confirmDialog({ title: `Xóa đề môn ${name}?`, message: `Chuyển toàn bộ ${currentCount} câu hỏi của môn ${name} vào Thùng rác? Bạn có thể khôi phục lại bất kỳ lúc nào nếu cần.`, confirmText: 'Chuyển vào thùng rác', variant: 'danger', icon: 'fa-trash-arrow-up' }))) return;
        try {
            const subjectQuestions = state.questions.filter((question) => subjectMatchKey(question.subject_key || question.subjectKey) === subjectMatchKey(key));
            if (subjectQuestions.length) {
                const now = new Date().toISOString();
                const trashedItems = subjectQuestions.map((q) => ({
                    ...q,
                    is_deleted: true,
                    deleted_at: now,
                    deleted_by: 'Admin'
                }));
                const existingTrashIds = new Set(trashedItems.map((q) => String(q.id)));
                state.trashQuestions = [...trashedItems, ...state.trashQuestions.filter((q) => !existingTrashIds.has(String(q.id)))];
                await saveTrash();
            }

            const { error } = await state.client.from('quiz_questions').delete().eq('subject_key', key);
            if (error) throw error;
            const { count, error: verifyError } = await state.client.from('quiz_questions').select('id', { count: 'exact', head: true }).eq('subject_key', key);
            if (verifyError) throw verifyError;
            if (Number(count || 0) !== 0) throw new Error(`Cloud còn ${count} câu hỏi chưa xóa được.`);
            try { localStorage.removeItem(`quiz_custom_questions_${key}`); } catch (error) { /* no-op */ }
            addActivityLog(`Chuyển đề môn ${name} vào thùng rác`, `Đã lưu trữ ${currentCount} câu hỏi môn ${name} vào Thùng rác`, 'danger');
            notify(`Đã chuyển toàn bộ câu hỏi của môn ${name} vào thùng rác.`);
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
        if (!(await confirmDialog({ title: 'Gán câu hỏi cũ vào môn học?', message: `Gán ${legacyCount} câu hỏi cũ đang ở mã history vào môn ${name}?`, confirmText: 'Gán ngay', variant: 'primary', icon: 'fa-layer-group' }))) return;
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
        if (!state.importIntegrity.valid && !(await confirmDialog({ title: 'Tiếp tục lưu câu hỏi?', message: 'Không thể xác minh hoàn toàn văn bản nguồn. Admin vẫn muốn tiếp tục lưu các câu hỏi này?', confirmText: 'Vẫn tiếp tục lưu', variant: 'warning' }))) return;
        if ($('import-replace')?.checked && !(await confirmDialog({ title: 'Ghi đè câu hỏi cũ?', message: 'Xóa toàn bộ câu hỏi cũ của môn này trước khi nạp bộ đề mới?', confirmText: 'Xóa cũ & Nạp mới', variant: 'danger' }))) return;
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
            addActivityLog('Nạp JSON câu hỏi hàng loạt', `Đã lưu ${records.length} câu vào môn ${subjectName(selectedSubject)}`, 'import');
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
        if (!(await confirmDialog({ title: 'Xóa Gemini API Key?', message: 'Xóa Gemini API Key dùng chung khỏi toàn hệ thống?', confirmText: 'Xóa API Key', variant: 'danger', icon: 'fa-key' }))) return;
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
            const testModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
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

    function getProgressFilterTitle() {
        const grade = state.progressFilter || 'all';
        const subject = state.progressSubject || 'all';
        if (subject !== 'all') {
            const selected = allSubjects().find((item) => subjectMatchKey(item.key) === subjectMatchKey(subject) || subjectMatchKey(item.name) === subjectMatchKey(subject));
            return `Tiến trình ${selected?.name || subject}`;
        }
        return grade === 'all' ? 'Tiến trình Tất cả môn' : `Tiến trình Lớp ${grade}`;
    }

    function switchView(view) {
        if (view === 'subjects') view = 'questions';
        const titles = { overview: 'Tổng quan', questions: 'Ngân hàng & môn học', students: 'Giám sát học sinh', progress: getProgressFilterTitle(), access: 'Quyền truy cập', reports: 'Báo cáo & dữ liệu' };
        document.querySelectorAll('[data-view-panel]').forEach((panel) => {
            const isActive = panel.dataset.viewPanel === view;
            panel.classList.toggle('is-visible', isActive);
            panel.classList.remove('view-enter');
            if (isActive) {
                // Force a fresh animation cycle even when the same tab is opened repeatedly.
                requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('view-enter')));
            }
        });
        document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.view === view));
        $('view-title') && ($('view-title').textContent = titles[view] || view);
        $('sidebar')?.classList.remove('is-open');

        if (view === 'overview') {
            requestAnimationFrame(() => replayOverviewMetrics());
        }

        if (view === 'progress') {
            renderGrade5ProgressMonitor();

            // Kích hoạt Realtime Supabase live feed cho Admin (cập nhật ngay khi học sinh chọn đáp án)
            if (!state.progressRealtimeChannel && state.client && typeof state.client.channel === 'function') {
                try {
                    state.progressRealtimeChannel = state.client
                        .channel('admin-progress-live-sync')
                        .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_logins' }, () => {
                            const progPanel = document.querySelector('[data-view-panel="progress"]');
                            if (progPanel && progPanel.classList.contains('is-visible')) {
                                if (state.progressDebounceTimer) clearTimeout(state.progressDebounceTimer);
                                state.progressDebounceTimer = setTimeout(() => {
                                    renderGrade5ProgressMonitor();
                                }, 180);
                            }
                        })
                        .subscribe();
                } catch (e) {
                    console.warn('[Admin Progress] Lỗi realtime channel:', e);
                }
            }

            clearInterval(state.progressMonitorTimer);
            state.progressMonitorTimer = setInterval(() => {
                const progPanel = document.querySelector('[data-view-panel="progress"]');
                if (progPanel && progPanel.classList.contains('is-visible')) {
                    renderGrade5ProgressMonitor();
                }
            }, 8000);
        } else if (view === 'reports') {
            runAction(loadScoreReport);
        } else {
            clearInterval(state.progressMonitorTimer);
        }
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
        ensureReportWorkspace();
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

    function ensureReportWorkspace() {
        const panel = document.querySelector('[data-view-panel="reports"]');
        const template = $('report-workspace-template');
        if (!panel || !template || panel.dataset.reportReady === 'true') return;
        const aiConfig = panel.querySelector('.ai-config-panel');
        panel.replaceChildren(template.content.cloneNode(true));
        if (aiConfig) panel.appendChild(aiConfig);
        panel.dataset.reportReady = 'true';
    }

    async function loadMaintenance() {
        const row = await systemRow(SYSTEM.maintenance);
        const defaultLockedMsg = 'Trang web đang tạm dừng để cập nhật. Vui lòng quay lại sau!';
        if (row) {
            state.maintenance = {
                isActive: row.status === 'ACTIVE' || row.device_info === 'ON',
                message: row.score_summary || defaultLockedMsg
            };
        }
        const active = Boolean(state.maintenance.isActive);
        const rawMsg = String(state.maintenance.message || '').trim();
        const studentPreviewMsg = (!rawMsg || rawMsg === 'Website đang mở công khai cho học sinh.' || rawMsg === 'Website đang mở.')
            ? defaultLockedMsg
            : rawMsg;

        if ($('maintenance-toggle')) $('maintenance-toggle').checked = active;
        $('maintenance-panel')?.classList.toggle('is-locked', active);
        $('sidebar-maintenance-mini')?.classList.toggle('is-active', active);
        if ($('maintenance-toggle-label')) {
            $('maintenance-toggle-label').textContent = active ? 'Đang khóa Web' : 'Khóa Web';
            $('maintenance-toggle-label').classList.toggle('is-active', active);
        }
        if ($('maintenance-badge')) {
            $('maintenance-badge').textContent = active ? 'ĐANG BẬT' : 'ĐANG TẮT';
            $('maintenance-badge').className = `status-badge ${active ? 'danger is-pulsing' : 'safe'}`;
        }
        if ($('maintenance-copy')) {
            $('maintenance-copy').textContent = active
                ? 'Hệ thống đang tạm khóa — học sinh truy cập sẽ nhận được thông báo bảo trì.'
                : 'Trang web đang mở công khai cho học sinh làm bài bình thường.';
        }
        if ($('maintenance-message-preview')) {
            $('maintenance-message-preview').textContent = studentPreviewMsg;
        }
        if ($('health-maintenance')) $('health-maintenance').textContent = active ? 'Website đang tạm khóa' : 'Website đang mở';
        if ($('health-maintenance-badge')) {
            $('health-maintenance-badge').textContent = active ? 'Đang khóa' : 'Tắt';
            $('health-maintenance-badge').className = `status-badge ${active ? 'danger' : 'safe'}`;
        }
        $('maintenance-dot')?.classList.toggle('is-active', active);
        $('maintenance-mini-label') && ($('maintenance-mini-label').textContent = active ? 'Đang bảo trì' : 'Hệ thống đang mở');
        $('maintenance-mini-message') && ($('maintenance-mini-message').textContent = active ? studentPreviewMsg : 'Sẵn sàng phục vụ học sinh');
    }

    async function toggleMaintenance(customActionNote = '') {
        const active = Boolean($('maintenance-toggle')?.checked);
        const defaultLockedMsg = 'Trang web đang tạm dừng để cập nhật. Vui lòng quay lại sau!';
        let message = String(state.maintenance.message || '').trim();
        if (!message || message === 'Website đang mở công khai cho học sinh.' || message === 'Website đang mở.') {
            message = defaultLockedMsg;
        }
        if (active && !rowHasCustomMessage(message) && !customActionNote) {
            const prompted = await promptDialog({
                title: 'Lời nhắn khi bảo trì',
                eyebrow: 'MAINTENANCE MODE',
                message: 'Nhập nội dung thông báo hiển thị cho học sinh khi hệ thống tạm khóa:',
                defaultValue: message,
                confirmText: 'Bật bảo trì',
                icon: 'fa-screwdriver-wrench'
            });
            if (prompted === null) {
                if ($('maintenance-toggle')) $('maintenance-toggle').checked = false;
                return;
            }
            message = prompted.trim() || defaultLockedMsg;
        }
        const { error } = await state.client.from('quiz_logins').upsert({
            id: SYSTEM.maintenance,
            player_name: '__SYSTEM_MAINTENANCE__',
            ip_address: 'SYSTEM',
            device_info: active ? 'ON' : 'OFF',
            status: active ? 'ACTIVE' : 'INACTIVE',
            score_summary: message,
            last_active: new Date().toISOString()
        }, { onConflict: 'id' });
        if (error) return notify(error.message, true);
        state.maintenance = { isActive: active, message };
        await loadMaintenance();
        addActivityLog(
            customActionNote || (active ? 'Bật chế độ Khóa Web (Bảo trì)' : 'Tắt chế độ bảo trì (Mở Web)'),
            `Lời nhắn: "${message}"`,
            'maintenance'
        );
        notify(customActionNote ? 'Đã cập nhật lời nhắn bảo trì.' : (active ? 'Đã bật chế độ bảo trì.' : 'Đã mở lại website.'));
    }

    function rowHasCustomMessage(msg) {
        return Boolean(msg && msg !== 'Website đang mở công khai cho học sinh.' && msg !== 'Website đang mở.');
    }

    function generateRandomToken(prefix = 'GRADE5') {
        const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
        let rand = '';
        for (let i = 0; i < 6; i++) {
            rand += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return `${prefix}_${rand}`;
    }

    function getStudentActivationLink(token) {
        const loc = window.location;
        const basePath = loc.pathname.replace(/admin\.html.*$/, '');
        const cleanBase = basePath.endsWith('/') ? basePath : basePath + '/';
        return `${loc.origin}${cleanBase}index.html?token=${encodeURIComponent(token)}`;
    }

    async function copyActivationLink(token, name = '') {
        const link = getStudentActivationLink(token);
        await copyToClipboard(link);
        notify(`Đã sao chép link kích hoạt${name ? ' cho ' + name : ''} vào bộ nhớ tạm!`);
    }

    async function loadTokens() {
        const row = await systemRow(SYSTEM.tokens);
        if (row?.status === 'ACTIVE') {
            try {
                const data = JSON.parse(row.score_summary || '[]');
                state.tokens = Array.isArray(data) ? data : data.tokens || [];
            } catch (error) {
                state.tokens = [];
            }
        } else {
            state.tokens = [];
        }
        renderTokens();
    }

    async function saveTokens() {
        const { error } = await state.client.from('quiz_logins').upsert({
            id: SYSTEM.tokens,
            player_name: '__ACCESS_TOKENS_CONFIG__',
            ip_address: 'SYSTEM',
            device_info: 'TOKEN_AUTH',
            status: 'ACTIVE',
            score_summary: JSON.stringify(state.tokens),
            last_active: new Date().toISOString()
        }, { onConflict: 'id' });
        if (error) throw error;
        renderTokens();
    }

    function renderUnifiedAccess() {
        const list = state.tokens || [];
        const class5List = list.filter(item => item.role === 'grade5' || item.role === 'all');
        const aiList = list.filter(item => item.role === 'ai' || item.role === 'all');

        $('class5-student-count') && ($('class5-student-count').textContent = class5List.length);
        $('ai-student-count') && ($('ai-student-count').textContent = aiList.length);
        $('unified-student-count') && ($('unified-student-count').textContent = list.length);
        $('token-count') && ($('token-count').textContent = list.length);

        // 1. RENDER BẢNG 1: QUYỀN LỚP 5
        const c5Tbody = $('class5-access-body');
        if (c5Tbody) {
            if (class5List.length === 0) {
                c5Tbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align:center;padding:28px 16px;color:var(--muted);">
                            <div style="font-size:24px;margin-bottom:6px;opacity:0.6;"><i class="fa-solid fa-graduation-cap"></i></div>
                            <div style="font-weight:600;font-size:13px;color:var(--text);">Chưa có học sinh nào được cấp quyền Lớp 5</div>
                            <div style="font-size:11px;margin-top:4px;">Dán IP hoặc mã máy ở form phía trên để mở khóa Lớp 5 cho học sinh.</div>
                        </td>
                    </tr>
                `;
            } else {
                c5Tbody.innerHTML = class5List.map((item) => {
                    const hasAi = item.role === 'all';
                    const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString('vi-VN') : '—';
                    const ipDisplay = item.ip 
                        ? `<code style="font-size:11px;font-weight:600;color:var(--text);background:var(--surface-3);padding:2px 6px;border-radius:4px;">${esc(item.ip)}</code>`
                        : `<span class="muted-copy" style="font-size:11px;"><i class="fa-solid fa-link"></i> Khóa theo máy</span>`;

                    const aiStatusHtml = hasAi
                        ? `<div style="display:inline-flex;align-items:center;gap:4px;">
                               <span class="status-badge" style="background:rgba(168,85,247,0.15);color:#c084fc;font-size:11px;font-weight:700;"><i class="fa-solid fa-check"></i> Đã có AI</span>
                               <button type="button" class="button button-sm button-secondary compact" data-toggle-ai="${esc(item.token)}" title="Tắt quyền AI (vẫn giữ Lớp 5)" style="font-size:10px;padding:2px 6px;color:var(--muted);"><i class="fa-solid fa-xmark"></i> Tắt AI</button>
                           </div>`
                        : `<button type="button" class="button button-sm button-secondary compact" data-toggle-ai="${esc(item.token)}" title="Cấp thêm Trợ lý AI cho học sinh này (dùng chung mã/IP)" style="font-size:11px;color:#c084fc;border-color:rgba(168,85,247,0.3);padding:3px 8px;">
                               <i class="fa-solid fa-wand-magic-sparkles"></i> + Cấp thêm AI
                           </button>`;

                    return `
                        <tr>
                            <td>
                                <div style="display:flex;align-items:center;gap:8px;">
                                    <span class="stack-item-icon" style="color:var(--emerald);background:var(--surface-3);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;">
                                        <i class="fa-solid fa-user-graduate"></i>
                                    </span>
                                    <b style="font-size:13px;color:var(--text);">${esc(item.name || 'Học sinh')}</b>
                                </div>
                            </td>
                            <td>
                                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                    <code style="font-weight:700;color:var(--primary);cursor:pointer;background:var(--surface-3);padding:3px 8px;border-radius:6px;font-size:11px;font-family:monospace;letter-spacing:0.5px;" title="Bấm để copy mã" data-copy-token-code="${esc(item.token)}">${esc(item.token)}</code>
                                    <button type="button" class="button button-sm button-secondary compact" data-copy-token-link="${esc(item.token)}" data-token-name="${esc(item.name || '')}" style="font-size:10px;padding:3px 7px;">
                                        <i class="fa-solid fa-link"></i> Link
                                    </button>
                                </div>
                            </td>
                            <td>${ipDisplay}</td>
                            <td>${aiStatusHtml}</td>
                            <td><small style="color:var(--muted);font-size:11px;">${esc(dateStr)}</small></td>
                            <td style="text-align:right;">
                                <button type="button" class="button button-sm button-danger compact" data-revoke-grade5="${esc(item.token)}" style="font-size:11px;padding:4px 10px;" title="Thu hồi quyền Lớp 5">
                                    <i class="fa-solid fa-trash-can"></i> Thu hồi
                                </button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }

        // 2. RENDER BẢNG 2: QUYỀN TRỢ LÝ AI (GEMINI)
        const aiTbody = $('ai-access-body');
        if (aiTbody) {
            if (aiList.length === 0) {
                aiTbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align:center;padding:28px 16px;color:var(--muted);">
                            <div style="font-size:24px;margin-bottom:6px;opacity:0.6;"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
                            <div style="font-weight:600;font-size:13px;color:var(--text);">Chưa có học sinh nào được cấp quyền Trợ lý AI</div>
                            <div style="font-size:11px;margin-top:4px;">Bấm nút "+ Cấp thêm AI" ở bảng Lớp 5 bên trên hoặc nhập ở form để cấp quyền AI.</div>
                        </td>
                    </tr>
                `;
            } else {
                aiTbody.innerHTML = aiList.map((item) => {
                    const hasG5 = item.role === 'all';
                    const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString('vi-VN') : '—';
                    const ipDisplay = item.ip 
                        ? `<code style="font-size:11px;font-weight:600;color:var(--text);background:var(--surface-3);padding:2px 6px;border-radius:4px;">${esc(item.ip)}</code>`
                        : `<span class="muted-copy" style="font-size:11px;"><i class="fa-solid fa-link"></i> Khóa theo máy</span>`;

                    const g5StatusHtml = hasG5
                        ? `<div style="display:inline-flex;align-items:center;gap:4px;">
                               <span class="status-badge safe" style="font-size:11px;font-weight:700;"><i class="fa-solid fa-check"></i> Đã có Lớp 5</span>
                               <button type="button" class="button button-sm button-secondary compact" data-toggle-grade5="${esc(item.token)}" title="Tắt quyền Lớp 5 (vẫn giữ AI)" style="font-size:10px;padding:2px 6px;color:var(--muted);"><i class="fa-solid fa-xmark"></i> Tắt Lớp 5</button>
                           </div>`
                        : `<button type="button" class="button button-sm button-secondary compact" data-toggle-grade5="${esc(item.token)}" title="Cấp quyền Lớp 5 cho học sinh này (dùng chung mã/IP)" style="font-size:11px;color:var(--emerald);border-color:rgba(16,185,129,0.3);padding:3px 8px;">
                               <i class="fa-solid fa-graduation-cap"></i> + Cấp Lớp 5
                           </button>`;

                    return `
                        <tr>
                            <td>
                                <div style="display:flex;align-items:center;gap:8px;">
                                    <span class="stack-item-icon" style="color:#c084fc;background:var(--surface-3);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;">
                                        <i class="fa-solid fa-robot"></i>
                                    </span>
                                    <b style="font-size:13px;color:var(--text);">${esc(item.name || 'Học sinh')}</b>
                                </div>
                            </td>
                            <td>
                                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                    <code style="font-weight:700;color:#c084fc;cursor:pointer;background:var(--surface-3);padding:3px 8px;border-radius:6px;font-size:11px;font-family:monospace;letter-spacing:0.5px;" title="Bấm để copy mã" data-copy-token-code="${esc(item.token)}">${esc(item.token)}</code>
                                    <button type="button" class="button button-sm button-secondary compact" data-copy-token-link="${esc(item.token)}" data-token-name="${esc(item.name || '')}" style="font-size:10px;padding:3px 7px;">
                                        <i class="fa-solid fa-link"></i> Link
                                    </button>
                                </div>
                            </td>
                            <td>${ipDisplay}</td>
                            <td>${g5StatusHtml}</td>
                            <td><small style="color:var(--muted);font-size:11px;">${esc(dateStr)}</small></td>
                            <td style="text-align:right;">
                                <button type="button" class="button button-sm button-danger compact" data-revoke-ai="${esc(item.token)}" style="font-size:11px;padding:4px 10px;" title="Thu hồi quyền AI">
                                    <i class="fa-solid fa-trash-can"></i> Thu hồi
                                </button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }

        // 3. RENDER BẢNG 3: QUYỀN QUAN SÁT TIẾN TRÌNH (NGƯỜI THEO DÕI)
        const parentList = list.filter(item => item.role === 'parent' || item.role === 'observer_grade5' || item.role === 'observer');
        $('parent-observer-count') && ($('parent-observer-count').textContent = parentList.length);

        const parentTbody = $('parent-access-body');
        if (parentTbody) {
            if (parentList.length === 0) {
                parentTbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align:center;padding:28px 16px;color:var(--muted);">
                            <div style="font-size:24px;margin-bottom:6px;opacity:0.6;color:var(--amber,#f59e0b);"><i class="fa-solid fa-eye"></i></div>
                            <div style="font-weight:600;font-size:13px;color:var(--text);">Chưa có Người theo dõi nào được cấp quyền theo dõi</div>
                            <div style="font-size:11px;margin-top:4px;">Chọn "Quyền Giám Sát Tiến Trình" ở form trên rồi bấm "Kích hoạt quyền cho học sinh" để lấy link theo dõi.</div>
                        </td>
                    </tr>
                `;
            } else {
                parentTbody.innerHTML = parentList.map((item) => {
                    const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleDateString('vi-VN') : '—';
                    const ipDisplay = item.ip 
                        ? `<code style="font-size:11px;font-weight:600;color:var(--text);background:var(--surface-3);padding:2px 6px;border-radius:4px;">${esc(item.ip)}</code>`
                        : `<span class="muted-copy" style="font-size:11px;"><i class="fa-solid fa-link"></i> Khóa theo token</span>`;

                    return `
                        <tr>
                            <td>
                                <div style="display:flex;align-items:center;gap:8px;">
                                    <span class="stack-item-icon" style="color:var(--amber,#f59e0b);background:rgba(245,158,11,0.15);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;">
                                        <i class="fa-solid fa-user-shield"></i>
                                    </span>
                                     <b style="font-size:13px;color:var(--text);"><span class="observer-status-dot ${observerIsOnline(item) ? 'is-online' : ''}" title="${observerIsOnline(item) ? 'Đang trực tuyến' : 'Không hoạt động'}"></span>${esc(item.name || 'Người theo dõi')}</b>
                                     <span class="status-badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;font-size:10px;padding:1px 6px;"><span class="observer-status-dot ${observerIsOnline(item) ? 'is-online' : ''}" title="${observerIsOnline(item) ? 'Đang trực tuyến' : 'Không hoạt động'}"></span>Kèm Đề + AI</span>
                                </div>
                            </td>
                            <td>
                                     <code style="font-weight:700;color:var(--amber,#f59e0b);cursor:pointer;background:var(--surface-3);padding:3px 8px;border-radius:6px;font-size:11px;font-family:monospace;letter-spacing:0.5px;" title="Bấm để copy mã" data-copy-token-code="${esc(item.token)}">${esc(item.token)}</code><button type="button" class="button button-sm button-secondary compact token-copy-icon" data-copy-token-code="${esc(item.token)}" title="Sao chép token" aria-label="Sao chép token"><i class="fa-regular fa-copy"></i></button>
                            </td>
                            <td>${ipDisplay}</td>
                            <td>
                                <button type="button" class="button button-sm button-warning compact" data-copy-parent-link="${esc(item.token)}" style="font-size:11px;padding:4px 10px;background:var(--amber,#f59e0b);color:#1e1b4b;font-weight:700;">
                                    <i class="fa-solid fa-copy"></i> Sao chép Link Theo Dõi
                                </button>
                            </td>
                            <td><small style="color:var(--muted);font-size:11px;">${esc(dateStr)}</small></td>
                            <td style="text-align:right;">
                                <button type="button" class="button button-sm button-danger compact" data-revoke-parent="${esc(item.token)}" style="font-size:11px;padding:4px 10px;" title="Thu hồi quyền quan sát">
                                    <i class="fa-solid fa-trash-can"></i> Thu hồi
                                </button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }
        renderQuickObservers();
    }

    function renderQuickObservers() {
        const container = $('quick-observer-list');
        if (!container) return;
        const parentList = (state.tokens || []).filter(item => item.role === 'parent' || item.role === 'observer_grade5' || item.role === 'observer');
        let nextHtml = '';
        if (parentList.length === 0) {
            nextHtml = '<p class="muted-copy" style="font-size:12px;margin:4px 0 0 0;"><i class="fa-solid fa-info-circle"></i> Chưa có IP hoặc IP-Token người theo dõi nào. Nhập IP ở ô trên rồi bấm "Cấp Quyền Theo Dõi".</p>';
        } else {
            nextHtml = parentList.map(item => {
                const ipDisplay = item.ip ? `<code style="font-size:10px;padding:2px 5px;background:var(--surface-3);border-radius:4px;">${esc(item.ip)}</code>` : '<span class="muted-copy" style="font-size:10px;">Khóa theo Token</span>';
                return `
                    <div class="stack-item" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;background:var(--surface-3);border-radius:10px;">
                        <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
                            <span style="color:var(--amber,#f59e0b);font-size:12px;"><i class="fa-solid fa-eye"></i></span>
                            <div style="min-width:0;flex:1;">
                                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                     <strong style="font-size:12px;color:var(--text);"><span class="observer-status-dot ${observerIsOnline(item) ? 'is-online' : ''}" title="${observerIsOnline(item) ? 'Đang trực tuyến' : 'Không hoạt động'}"></span>${esc(item.name || 'Người theo dõi')}</strong>
                                    <span style="font-size:10px;color:var(--emerald);background:rgba(16,185,129,0.15);padding:1px 5px;border-radius:4px;font-weight:600;">Xem Đề + AI</span>
                                     <code style="font-size:11px;color:var(--amber,#f59e0b);font-weight:700;cursor:pointer;" title="Bấm để copy mã" data-copy-token-code="${esc(item.token)}">${esc(item.token)}</code><button type="button" class="button button-sm button-secondary compact token-copy-icon" data-copy-token-code="${esc(item.token)}" title="Sao chép token" aria-label="Sao chép token"><i class="fa-regular fa-copy"></i></button>
                                    ${ipDisplay}
                                </div>
                            </div>
                        </div>
                        <div style="display:flex;align-items:center;gap:6px;shrink-0;">
                             <button type="button" class="button button-sm button-warning compact" data-copy-parent-link="${esc(item.token)}" style="font-size:11px;padding:3px 8px;background:var(--amber,#f59e0b);color:#1e1b4b;font-weight:700;">
                                 <i class="fa-solid fa-link"></i> Link
                             </button>
                             <button type="button" class="button button-sm button-secondary compact token-copy-icon" data-copy-token-code="${esc(item.token)}" title="Sao chép token" aria-label="Sao chép token"><i class="fa-regular fa-copy"></i></button>
                            <button type="button" class="button button-sm button-danger compact" data-revoke-parent="${esc(item.token)}" style="font-size:11px;padding:3px 8px;" title="Thu hồi">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }
        if (state.lastQuickObserversHtml !== nextHtml) {
            state.lastQuickObserversHtml = nextHtml;
            container.innerHTML = nextHtml;
        }
    }

    async function addQuickObserver() {
        const inputVal = $('quick-observer-ip')?.value.trim() || '';
        const nameVal = $('quick-observer-name')?.value.trim() || '';
        
        let detectedIp = '';
        let detectedCode = '';

        const parseCombined = (val) => {
            if (!val) return;
            const str = val.trim();
            if (str.includes('-')) {
                const parts = str.split('-');
                const possibleIp = parts[0].trim().replace(/^\[|\]$/g, '');
                if (/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[0-9a-f:]+)$/i.test(possibleIp)) {
                    detectedIp = possibleIp.toLowerCase();
                    detectedCode = parts.slice(1).join('-').trim().toUpperCase();
                    return;
                }
            }
            const clean = str.replace(/^\[|\]$/g, '').trim();
            if (/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[0-9a-f:]+)$/i.test(clean)) {
                detectedIp = clean.toLowerCase();
            } else if (clean) {
                detectedCode = clean.toUpperCase();
            }
        };

        if (inputVal) parseCombined(inputVal);
        if (!detectedCode) {
            detectedCode = generateRandomToken('OBS');
        }

        const rawCode = detectedCode;
        const ip = detectedIp || '';
        const combinedToken = (ip && rawCode) ? `${ip}-${rawCode}` : rawCode;
        const observerName = nameVal || (ip ? `Người theo dõi (${ip})` : `Người theo dõi (${rawCode})`);

        state.tokens = Array.isArray(state.tokens) ? state.tokens : [];
        const existingIdx = state.tokens.findIndex(t => t.token === combinedToken || (rawCode && t.rawCode === rawCode) || (ip && t.ip === ip && t.role === 'parent'));

        const tokenRecord = {
            token: combinedToken,
            rawCode: rawCode,
            role: 'parent',
            name: observerName,
            ip: ip || null,
            createdAt: new Date().toISOString()
        };

        if (existingIdx !== -1) {
            state.tokens[existingIdx] = { ...state.tokens[existingIdx], ...tokenRecord };
        } else {
            state.tokens.unshift(tokenRecord);
        }

        await saveTokens();

        if ($('quick-observer-ip')) $('quick-observer-ip').value = '';
        if ($('quick-observer-name')) $('quick-observer-name').value = '';

        renderUnifiedAccess();
        renderQuickObservers();

        const origin = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
            ? (window.location.origin.startsWith('http') ? window.location.origin : 'https://quiz-web-app-rosy.vercel.app')
            : window.location.origin;
        const observerLink = `${origin}/?token=${encodeURIComponent(combinedToken)}&view=progress`;
        try {
            await navigator.clipboard.writeText(observerLink);
            notify(`✅ Đã cấp quyền người giám sát (kèm xem đề + AI): "${combinedToken}"!\n📋 Đã tự động sao chép Link Theo Dõi.`);
        } catch (e) {
            prompt('Sao chép Link Theo Dõi gửi người giám sát:', observerLink);
        }
    }

    function renderTokens() {
        renderUnifiedAccess();
    }

    async function toggleStudentAi(token) {
        const item = (state.tokens || []).find(t => t.token === token);
        if (!item) return notify('Không tìm thấy học sinh này.', true);

        if (item.role === 'grade5') {
            item.role = 'all';
            if (item.ip) {
                state.aiIps = Array.isArray(state.aiIps) ? state.aiIps : [];
                if (!state.aiIps.some(x => (typeof x === 'string' ? x : x.ip) === item.ip)) {
                    state.aiIps.push({ ip: item.ip, name: item.name });
                    await saveAiIps();
                }
            }
            await saveTokens();
            renderUnifiedAccess();
            notify(`✅ Đã cấp thêm quyền Trợ lý AI cho ${item.name} (dùng chung token ${item.token})!`);
        } else if (item.role === 'all') {
            const confirmed = await confirmDialog({
                title: 'Tắt quyền Trợ lý AI?',
                message: `Bạn có chắc muốn tắt quyền Trợ lý AI của học sinh "${item.name}" không?\n(Học sinh này vẫn sẽ giữ nguyên quyền Lớp 5).`,
                confirmText: 'Tắt quyền AI',
                variant: 'danger',
                icon: 'fa-wand-magic-sparkles'
            });
            if (!confirmed) return;

            item.role = 'grade5';
            if (item.ip) {
                state.aiIps = (state.aiIps || []).filter(x => (typeof x === 'string' ? x : x.ip) !== item.ip);
                await saveAiIps();
            }
            await saveTokens();
            renderUnifiedAccess();
            notify(`Đã tắt quyền Trợ lý AI của ${item.name}, vẫn giữ quyền Lớp 5.`);
        }
    }

    async function toggleStudentGrade5(token) {
        const item = (state.tokens || []).find(t => t.token === token);
        if (!item) return notify('Không tìm thấy học sinh này.', true);

        if (item.role === 'ai') {
            item.role = 'all';
            if (item.ip) {
                state.geo.grade5Ips = Array.isArray(state.geo.grade5Ips) ? state.geo.grade5Ips : [];
                if (!state.geo.grade5Ips.includes(item.ip)) {
                    state.geo.grade5Ips.push(item.ip);
                    await saveGeo();
                }
            }
            await saveTokens();
            renderUnifiedAccess();
            notify(`✅ Đã cấp thêm quyền Lớp 5 cho ${item.name} (dùng chung token ${item.token})!`);
        } else if (item.role === 'all') {
            const confirmed = await confirmDialog({
                title: 'Tắt quyền Lớp 5?',
                message: `Bạn có chắc muốn tắt quyền Lớp 5 của học sinh "${item.name}" không?\n(Học sinh này sẽ chỉ còn quyền Trợ lý AI).`,
                confirmText: 'Tắt Lớp 5',
                variant: 'danger',
                icon: 'fa-shield-halved'
            });
            if (!confirmed) return;

            item.role = 'ai';
            if (item.ip) {
                state.geo.grade5Ips = (state.geo.grade5Ips || []).filter(ip => ip !== item.ip);
                await saveGeo();
            }
            await saveTokens();
            renderUnifiedAccess();
            notify(`Đã tắt quyền Lớp 5 của ${item.name}, vẫn giữ quyền Trợ lý AI.`);
        }
    }

    async function revokeStudentGrade5(token) {
        const item = (state.tokens || []).find(t => t.token === token);
        if (!item) return;

        if (!(await confirmDialog({
            title: 'Thu hồi quyền Lớp 5?',
            message: `Bạn có chắc muốn thu hồi quyền truy cập Lớp 5 của ${item.name || 'học sinh'}?`,
            confirmText: 'Thu hồi quyền Lớp 5',
            variant: 'danger',
            icon: 'fa-trash-can'
        }))) return;

        if (item.ip) {
            state.geo.grade5Ips = (state.geo.grade5Ips || []).filter(ip => ip !== item.ip);
            await saveGeo();
        }

        if (item.role === 'all') {
            item.role = 'ai';
            await saveTokens();
            renderUnifiedAccess();
            notify(`Đã thu hồi quyền Lớp 5 của ${item.name}, vẫn giữ quyền AI.`);
        } else {
            state.tokens = (state.tokens || []).filter(t => t.token !== token);
            await saveTokens();
            renderUnifiedAccess();
            notify(`Đã thu hồi quyền Lớp 5 của ${item.name}.`);
        }
    }

    async function revokeStudentAi(token) {
        const item = (state.tokens || []).find(t => t.token === token);
        if (!item) return;

        if (!(await confirmDialog({
            title: 'Thu hồi quyền Trợ lý AI?',
            message: `Bạn có chắc muốn thu hồi quyền sử dụng Trợ lý AI của ${item.name || 'học sinh'}?`,
            confirmText: 'Thu hồi quyền AI',
            variant: 'danger',
            icon: 'fa-trash-can'
        }))) return;

        if (item.ip) {
            state.aiIps = (state.aiIps || []).filter(x => (typeof x === 'string' ? x : x.ip) !== item.ip);
            await saveAiIps();
        }

        if (item.role === 'all') {
            item.role = 'grade5';
            await saveTokens();
            renderUnifiedAccess();
            notify(`Đã thu hồi quyền Trợ lý AI của ${item.name}, vẫn giữ quyền Lớp 5.`);
        } else {
            state.tokens = (state.tokens || []).filter(t => t.token !== token);
            await saveTokens();
            renderUnifiedAccess();
            notify(`Đã thu hồi quyền Trợ lý AI của ${item.name}.`);
        }
    }

    async function grantStudentAccess() {
        const name = $('student-access-name')?.value.trim();
        const customCode = $('student-access-code')?.value.trim() || '';
        const role = $('student-access-role')?.value || 'grade5';
        let rawIp = $('student-access-ip')?.value.trim() || '';

        // Tự động tách nếu Admin dán chuỗi kết hợp dạng "14.164.221.205-QM-KM9SZG" hoặc chỉ dán IP vào bất kỳ ô nào
        let detectedIp = '';
        let detectedCode = '';

        const parseCombined = (val) => {
            if (!val) return;
            const str = val.trim();
            if (str.includes('-')) {
                const parts = str.split('-');
                const possibleIp = parts[0].trim().replace(/^\[|\]$/g, '');
                if (/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[0-9a-f:]+)$/i.test(possibleIp)) {
                    detectedIp = possibleIp.toLowerCase();
                    detectedCode = parts.slice(1).join('-').trim().toUpperCase();
                    return;
                }
            }
            const clean = str.replace(/^\[|\]$/g, '').trim();
            if (/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[0-9a-f:]+)$/i.test(clean)) {
                detectedIp = clean.toLowerCase();
            } else if (clean) {
                detectedCode = clean.toUpperCase();
            }
        };

        parseCombined(customCode);
        if (!detectedIp && rawIp) parseCombined(rawIp);
        if (rawIp && !detectedIp) {
            const clean = rawIp.replace(/^\[|\]$/g, '').trim().toLowerCase();
            if (/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[0-9a-f:]+)$/i.test(clean)) {
                detectedIp = clean;
            }
        }

        if (!detectedIp && !detectedCode) {
            if (role === 'parent') {
                detectedCode = generateRandomToken('PARENT');
            } else if (role === 'admin') {
                detectedCode = generateRandomToken('ADMIN');
            } else {
                return notify('Vui lòng dán Mã xác thực (IP-Mã máy) hoặc Địa chỉ IP của học sinh.', true);
            }
        }

        const ip = detectedIp || '';
        const rawCode = detectedCode || generateRandomToken(role === 'all' ? 'VIP' : (role === 'ai' ? 'AI' : (role === 'parent' ? 'OBS' : (role === 'admin' ? 'ADMIN' : 'QM'))));
        const combinedToken = (ip && rawCode) ? `${ip}-${rawCode}` : rawCode;
        const studentName = name || (role === 'parent' ? 'Người theo dõi' : (role === 'admin' ? 'Quản trị viên' : (detectedCode ? `Học sinh (${detectedCode})` : (detectedIp ? `Học sinh (${detectedIp})` : 'Học sinh mới'))));

        state.tokens = Array.isArray(state.tokens) ? state.tokens : [];

        // Tìm xem token / mã kết hợp đã có trong danh sách chưa
        const existingIdx = state.tokens.findIndex(t => {
            const tCode = String(t.token || '').toUpperCase();
            const tRaw = String(t.rawCode || '').toUpperCase();
            const tIp = String(t.ip || '').toLowerCase();
            return (combinedToken && tCode === combinedToken.toUpperCase()) ||
                   (rawCode && (tRaw === rawCode || tCode === rawCode)) ||
                   (ip && tIp === ip);
        });

        const record = {
            token: combinedToken,
            rawCode: rawCode,
            role,
            name: studentName,
            ip: ip || null,
            createdAt: new Date().toISOString()
        };

        if (existingIdx !== -1) {
            state.tokens[existingIdx] = { ...state.tokens[existingIdx], ...record, updatedAt: new Date().toISOString() };
        } else {
            state.tokens.unshift(record);
        }

        await saveTokens();

        if (ip) {
            if (role === 'grade5' || role === 'all') {
                state.geo.grade5Ips = Array.isArray(state.geo.grade5Ips) ? state.geo.grade5Ips : [];
                if (!state.geo.grade5Ips.includes(ip)) {
                    state.geo.grade5Ips.push(ip);
                }
                await saveGeo();
            }
            if (role === 'ai' || role === 'all') {
                state.aiIps = Array.isArray(state.aiIps) ? state.aiIps : [];
                if (!state.aiIps.some(item => (typeof item === 'string' ? item : item.ip) === ip)) {
                    state.aiIps.push({ ip, name: studentName });
                    await saveAiIps();
                }
            }
            if (role === 'admin') {
                state.adminConfig = state.adminConfig || { masterIp: '', allowedIps: [] };
                state.adminConfig.allowedIps = Array.isArray(state.adminConfig.allowedIps) ? state.adminConfig.allowedIps : [];
                if (!state.adminConfig.allowedIps.some(it => (typeof it === 'string' ? it : (it.token || it.ip)) === combinedToken)) {
                    state.adminConfig.allowedIps.push({
                        ip: ip || null,
                        token: combinedToken,
                        rawCode: rawCode,
                        name: studentName,
                        addedAt: new Date().toISOString()
                    });
                    await saveAdminConfig();
                    renderAccess();
                }
            }
        }

        if ($('student-access-name')) $('student-access-name').value = '';
        if ($('student-access-code')) $('student-access-code').value = '';
        if ($('student-access-ip')) $('student-access-ip').value = '';

        renderUnifiedAccess();

        const roleDesc = role === 'all' ? 'Toàn bộ gói VIP (Lớp 5 + AI)' : (role === 'ai' ? 'Trợ lý AI' : (role === 'parent' ? 'Giám Sát Tiến Trình (Kèm Xem Đề + AI)' : (role === 'admin' ? 'Quản Trị Viên (Toàn quyền Admin)' : 'Lớp 5')));
        notify(`✅ Đã kích hoạt quyền ${roleDesc} cho thiết bị "${record.token}" (${studentName})!`);
    }

    async function addTokenFromForm() {
        return grantStudentAccess();
    }

    async function removeStudentAccess(token) {
        const item = (state.tokens || []).find(t => t.token === token);
        const studentName = item?.name || 'học sinh này';
        if (!(await confirmDialog({
            title: 'Thu hồi quyền truy cập?',
            message: `Bạn có chắc muốn thu hồi toàn bộ quyền của ${studentName} (mã: ${token})?\nHọc sinh sẽ không thể tiếp tục truy cập môn Lớp 5 hoặc AI.`,
            confirmText: 'Thu hồi quyền',
            variant: 'danger',
            icon: 'fa-trash-can'
        }))) return;

        if (item?.ip) {
            const cleanIp = item.ip;
            if (state.geo?.grade5Ips) {
                state.geo.grade5Ips = state.geo.grade5Ips.filter(ip => ip !== cleanIp);
                await saveGeo();
            }
            if (state.aiIps) {
                state.aiIps = state.aiIps.filter(i => (typeof i === 'string' ? i : i.ip) !== cleanIp);
                await saveAiIps();
            }
        }

        state.tokens = (state.tokens || []).filter(t => t.token !== token);
        await saveTokens();
        renderUnifiedAccess();
        notify(`Đã thu hồi quyền của ${studentName}.`);
    }

    async function removeAccessToken(token) {
        return removeStudentAccess(token);
    }

    async function loadAccess() {
        const row = await systemRow(SYSTEM.admin);
        if (row) { try { const data = JSON.parse(row.score_summary || '{}'); state.adminConfig = { masterIp: data.masterIp || '', allowedIps: data.allowedIps || [] }; } catch (error) {} }
        const aiRow = await systemRow(SYSTEM.aiIps);
        if (aiRow?.status === 'ACTIVE') { try { const data = JSON.parse(aiRow.score_summary || '[]'); state.aiIps = Array.isArray(data) ? data : data.ips || []; } catch (error) { state.aiIps = []; } } else state.aiIps = [];
        const geoRow = await systemRow(SYSTEM.geo);
        if (geoRow) { try { const data = JSON.parse(geoRow.score_summary || '{}'); state.geo = { mode: data.mode || geoRow.device_info || 'PUBLIC', ips: data.ips || [], grade5Ips: data.grade5Ips || data.grade5_ips || [] }; } catch (error) {} }
        await loadTokens();

        // Đồng bộ các IP từ GEO (Lớp 5) và AI vào danh sách Token nếu chưa xuất hiện
        state.tokens = Array.isArray(state.tokens) ? state.tokens : [];
        (state.geo.grade5Ips || []).forEach(ip => {
            const cleanIp = String(ip).trim().toLowerCase();
            if (cleanIp && !['127.0.0.1', '::1'].includes(cleanIp)) {
                const existing = state.tokens.find(t => String(t.ip || '').toLowerCase() === cleanIp || String(t.token || '').toLowerCase() === cleanIp);
                if (!existing) {
                    state.tokens.push({
                        token: cleanIp,
                        rawCode: cleanIp,
                        role: 'grade5',
                        name: `Học sinh Lớp 5 (${cleanIp})`,
                        ip: cleanIp,
                        createdAt: new Date().toISOString()
                    });
                }
            }
        });

        (state.aiIps || []).forEach(item => {
            const cleanIp = String(typeof item === 'string' ? item : item?.ip || '').trim().toLowerCase();
            const name = typeof item === 'string' ? '' : (item?.name || '');
            if (cleanIp && !['127.0.0.1', '::1'].includes(cleanIp)) {
                const existing = state.tokens.find(t => String(t.ip || '').toLowerCase() === cleanIp || String(t.token || '').toLowerCase() === cleanIp);
                if (existing) {
                    if (existing.role === 'grade5') existing.role = 'all';
                } else {
                    state.tokens.push({
                        token: cleanIp,
                        rawCode: cleanIp,
                        role: 'ai',
                        name: name || `Học sinh AI (${cleanIp})`,
                        ip: cleanIp,
                        createdAt: new Date().toISOString()
                    });
                }
            }
        });

        renderAccess();
    }

    function renderAccess() {
        const allowed = state.adminConfig.allowedIps || [];
        $('admin-ip-count') && ($('admin-ip-count').textContent = allowed.length);
        $('admin-ip-list') && ($('admin-ip-list').innerHTML = allowed.map((item) => {
            const ip = typeof item === 'string' ? item : (item.ip || '');
            const name = typeof item === 'string' ? 'Admin' : (item.name || 'Admin');
            const token = typeof item === 'object' ? (item.token || item.rawCode || ip) : ip;
            const isMaster = (typeof item === 'object' && item.isMaster) || (ip && ip === state.adminConfig.masterIp);
            const displayCode = esc(token || ip || 'ADMIN-KEY');
            const ipDisplay = ip
                ? `<code style="font-size:10px;padding:2px 5px;background:var(--surface-3);border-radius:4px;">${esc(ip)}</code>`
                : `<span class="muted-copy" style="font-size:10px;"><i class="fa-solid fa-link"></i> Khóa theo Token</span>`;

            const copyBtn = `<button type="button" class="button button-sm button-secondary compact" data-copy-admin-link="${esc(token || ip)}" title="Sao chép link đăng nhập Admin cho thiết bị này" style="font-size:10px;padding:3px 7px;"><i class="fa-solid fa-link"></i> Link</button>`;

            return `
                <div class="stack-item" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                    <span class="stack-item-icon" style="color:var(--amber,#f59e0b);background:rgba(245,158,11,0.15);width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;">
                        <i class="fa-solid fa-crown"></i>
                    </span>
                    <span class="stack-item-main" style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                            <b style="font-size:13px;color:var(--text);">${esc(name)}</b>
                            ${isMaster ? '<span class="tag" style="background:var(--amber,#f59e0b);color:#1e1b4b;font-weight:800;font-size:10px;">MASTER</span>' : ''}
                        </div>
                        <div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap;">
                            <code style="font-weight:700;color:var(--primary);font-size:11px;font-family:monospace;letter-spacing:0.5px;cursor:pointer;" title="Bấm để copy mã" data-copy-token-code="${esc(token || ip)}">${displayCode}</code>
                            ${ipDisplay}
                        </div>
                    </span>
                    <div style="display:flex;align-items:center;gap:6px;">
                        ${copyBtn}
                        ${isMaster ? '' : `<button type="button" class="button button-sm button-danger compact" data-remove-admin="${esc(token || ip)}" title="Thu hồi quyền Admin" style="font-size:11px;padding:3px 8px;"><i class="fa-solid fa-trash-can"></i></button>`}
                    </div>
                </div>
            `;
        }).join('') || '<p class="muted-copy">Chưa có thiết bị Admin phụ.</p>');
        $('ai-ip-count') && ($('ai-ip-count').textContent = state.aiIps.length);
        renderUnifiedAccess();
    }

    async function saveAdminConfig() {
        const cleanIps = (state.adminConfig.allowedIps || [])
            .map((item) => typeof item === 'string' ? item : item.ip)
            .filter(Boolean);
        const { error } = await state.client.from('quiz_logins').upsert({
            id: SYSTEM.admin,
            player_name: '__ADMIN_IPS_CONFIG__',
            ip_address: 'SYSTEM',
            device_info: 'PASSWORDLESS_AUTH',
            status: 'ACTIVE',
            score_summary: JSON.stringify({
                masterIp: state.adminConfig.masterIp,
                allowedIps: state.adminConfig.allowedIps,
                ips: cleanIps
            }),
            last_active: new Date().toISOString()
        }, { onConflict: 'id' });
        if (error) throw error;
    }
    async function handleGrantTokenToStudent(name, ip, deviceInfo = '') {
        const devMatch = (deviceInfo || '').match(/\[(QM-[A-Z0-9]+)\]/);
        const deviceCode = devMatch ? devMatch[1] : '';

        const choice = await confirmDialog({
            title: `Cấp quyền cho ${name}?`,
            message: `Học sinh: "${name}"\n${deviceCode ? `Mã thiết bị: ${deviceCode}\n` : ''}${ip ? `IP: ${ip}\n` : ''}\nChọn quyền muốn cấp cho học sinh:`,
            confirmText: 'Cấp quyền Lớp 5',
            cancelText: 'Cấp quyền AI',
            variant: 'primary',
            icon: 'fa-key'
        });

        const role = choice ? 'grade5' : 'ai';
        const rawCode = deviceCode || generateRandomToken(role === 'grade5' ? 'QM' : 'AI');
        const token = (ip && rawCode) ? `${ip}-${rawCode}` : rawCode;

        state.tokens = Array.isArray(state.tokens) ? state.tokens : [];
        const existingIdx = state.tokens.findIndex(t => {
            const tToken = String(t.token || '').toUpperCase();
            const tRaw = String(t.rawCode || '').toUpperCase();
            const tIp = String(t.ip || '').toLowerCase();
            return (token && tToken === token.toUpperCase()) ||
                   (rawCode && (tRaw === rawCode.toUpperCase() || tToken === rawCode.toUpperCase())) ||
                   (ip && tIp === ip.toLowerCase());
        });

        const record = {
            token,
            rawCode,
            role,
            name: `${name}${deviceCode ? '' : ` (${ip || 'học sinh'})`}`,
            ip: ip || '',
            createdAt: new Date().toISOString()
        };

        if (existingIdx !== -1) {
            state.tokens[existingIdx] = { ...state.tokens[existingIdx], ...record, updatedAt: new Date().toISOString() };
        } else {
            state.tokens.unshift(record);
        }
        await saveTokens();

        if (ip) {
            if (role === 'grade5') {
                if (!state.geo.grade5Ips.includes(ip)) {
                    state.geo.grade5Ips.push(ip);
                    await saveGeo();
                }
            } else if (role === 'ai') {
                if (!state.aiIps.some(item => (typeof item === 'string' ? item : item.ip) === ip)) {
                    state.aiIps.push({ ip, name });
                    await saveAiIps();
                }
            }
        }

        renderUnifiedAccess();
        notify(`✅ Đã kích hoạt quyền ${role === 'grade5' ? 'Lớp 5' : 'AI'} cho thiết bị "${token}" (${name})!`);
    }

    async function addAdminIp() {
        const inputVal = $('admin-ip-input')?.value.trim() || '';
        const nameVal = $('admin-ip-name')?.value.trim() || '';
        if (!inputVal && !nameVal) {
            return notify('Vui lòng dán IP, Mã máy hoặc nhập Tên để cấp quyền Admin.', true);
        }

        let detectedIp = '';
        let detectedCode = '';

        const parseCombined = (val) => {
            if (!val) return;
            const str = val.trim();
            if (str.includes('-')) {
                const parts = str.split('-');
                const possibleIp = parts[0].trim().replace(/^\[|\]$/g, '');
                if (/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[0-9a-f:]+)$/i.test(possibleIp)) {
                    detectedIp = possibleIp.toLowerCase();
                    detectedCode = parts.slice(1).join('-').trim().toUpperCase();
                    return;
                }
            }
            const clean = str.replace(/^\[|\]$/g, '').trim();
            if (/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[0-9a-f:]+)$/i.test(clean)) {
                detectedIp = clean.toLowerCase();
            } else if (clean) {
                detectedCode = clean.toUpperCase();
            }
        };

        if (inputVal) parseCombined(inputVal);
        if (!detectedCode && !detectedIp) {
            detectedCode = generateRandomToken('ADMIN');
        } else if (!detectedCode && detectedIp) {
            detectedCode = generateRandomToken('ADMIN');
        }

        const rawCode = detectedCode || generateRandomToken('ADMIN');
        const ip = detectedIp || '';
        const combinedToken = (ip && rawCode) ? `${ip}-${rawCode}` : rawCode;
        const adminName = nameVal || (ip ? `Admin (${ip})` : `Admin (${rawCode})`);

        state.adminConfig = state.adminConfig || { masterIp: '', allowedIps: [] };
        state.adminConfig.allowedIps = Array.isArray(state.adminConfig.allowedIps) ? state.adminConfig.allowedIps : [];

        const existingIdx = state.adminConfig.allowedIps.findIndex(item => {
            if (typeof item === 'string') return item === ip || item === combinedToken;
            return (ip && item.ip === ip) || (combinedToken && item.token === combinedToken) || (rawCode && item.rawCode === rawCode);
        });

        const newAdminItem = {
            ip: ip || null,
            token: combinedToken,
            rawCode: rawCode,
            name: adminName,
            addedAt: new Date().toISOString()
        };

        if (existingIdx !== -1) {
            state.adminConfig.allowedIps[existingIdx] = { ...state.adminConfig.allowedIps[existingIdx], ...newAdminItem };
        } else {
            state.adminConfig.allowedIps.push(newAdminItem);
        }

        await saveAdminConfig();

        // Đồng bộ thêm vào state.tokens với role: 'admin'
        state.tokens = Array.isArray(state.tokens) ? state.tokens : [];
        const existingTokenIdx = state.tokens.findIndex(t => t.token === combinedToken || (rawCode && t.rawCode === rawCode));
        const tokenRecord = {
            token: combinedToken,
            rawCode: rawCode,
            role: 'admin',
            name: adminName,
            ip: ip || null,
            createdAt: new Date().toISOString()
        };
        if (existingTokenIdx !== -1) {
            state.tokens[existingTokenIdx] = { ...state.tokens[existingTokenIdx], ...tokenRecord };
        } else {
            state.tokens.unshift(tokenRecord);
        }
        await saveTokens();

        if ($('admin-ip-input')) $('admin-ip-input').value = '';
        if ($('admin-ip-name')) $('admin-ip-name').value = '';

        renderAccess();

        const origin = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
            ? (window.location.origin.startsWith('http') ? window.location.origin : 'https://quiz-web-app-rosy.vercel.app')
            : window.location.origin;
        const adminLink = `${origin}/admin.html?token=${encodeURIComponent(combinedToken)}`;
        try {
            await navigator.clipboard.writeText(adminLink);
            notify(`✅ Đã cấp IP-Token Admin: "${combinedToken}"!\nĐã tự động sao chép Link Admin vào bộ nhớ tạm.`);
        } catch (e) {
            notify(`✅ Đã cấp IP-Token Admin: "${combinedToken}" cho ${adminName}!`);
        }
    }

    async function removeAdminIp(identifier) {
        if (!identifier) return;
        if (identifier === state.adminConfig.masterIp) {
            return notify('Không thể thu hồi Master Admin chính.', true);
        }

        const item = (state.adminConfig.allowedIps || []).find(it => {
            if (typeof it === 'string') return it === identifier;
            return it.ip === identifier || it.token === identifier || it.rawCode === identifier;
        });

        const targetName = typeof item === 'object' ? item.name || identifier : identifier;

        if (!(await confirmDialog({
            title: 'Thu hồi quyền Admin?',
            message: `Bạn có chắc muốn thu hồi quyền Admin của "${targetName}" (${identifier})?\nThiết bị này sẽ không thể truy cập trang quản trị nữa.`,
            confirmText: 'Thu hồi quyền',
            variant: 'danger',
            icon: 'fa-user-lock'
        }))) return;

        state.adminConfig.allowedIps = (state.adminConfig.allowedIps || []).filter(it => {
            if (typeof it === 'string') return it !== identifier;
            return it.ip !== identifier && it.token !== identifier && it.rawCode !== identifier;
        });
        await saveAdminConfig();

        state.tokens = (state.tokens || []).filter(t => t.token !== identifier && t.rawCode !== identifier && t.ip !== identifier);
        await saveTokens();

        renderAccess();
        notify(`Đã thu hồi quyền Admin của ${targetName}.`);
    }
    async function saveMasterIp() { if (!state.clientIp) return notify('Không xác định được IP hiện tại.', true); if (!state.adminConfig.allowedIps.some((item) => (typeof item === 'string' ? item : item.ip) === state.clientIp)) state.adminConfig.allowedIps.push({ ip: state.clientIp, name: 'Thiết bị Master', isMaster: true }); state.adminConfig.masterIp = state.clientIp; await saveAdminConfig(); renderAccess(); notify('Đã đặt IP hiện tại làm Master Admin.'); }
    async function saveAiIps() { const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.aiIps, player_name: '__AI_IPS_CONFIG__', ip_address: 'SYSTEM', device_info: 'AI_IP_WHITELIST', status: 'ACTIVE', score_summary: JSON.stringify(state.aiIps), last_active: new Date().toISOString() }, { onConflict: 'id' }); if (error) throw error; }
    async function addAiIp() {
        const ip = $('ai-ip-input')?.value.trim();
        if (!ip) return notify('Nhập IP cần cấp AI.', true);
        const name = $('ai-ip-name')?.value.trim() || 'Học sinh AI';
        if (!state.aiIps.some((item) => (typeof item === 'string' ? item : item.ip) === ip)) {
            state.aiIps.push({ ip, name });
        }
        await saveAiIps();

        const autoToken = generateRandomToken('AI');
        state.tokens.unshift({
            token: autoToken,
            role: 'ai',
            name: `${name} (${ip})`,
            ip,
            createdAt: new Date().toISOString()
        });
        await saveTokens();
        const link = getStudentActivationLink(autoToken);
        await copyToClipboard(link);

        if ($('ai-ip-input')) $('ai-ip-input').value = '';
        if ($('ai-ip-name')) $('ai-ip-name').value = '';
        renderAccess();
        notify(`Đã cấp quyền AI cho IP ${ip} & tạo mã ${autoToken} (đã copy link kích hoạt)!`);
    }
    async function removeAiIp(ip) { state.aiIps = state.aiIps.filter((item) => (typeof item === 'string' ? item : item.ip) !== ip); await saveAiIps(); renderAccess(); notify('Đã thu hồi quyền AI.'); }

    function ensureClass5AccessPanel() {
        return;
    }

    async function loadGeo() { const normalizeIp = (ip) => String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase(); const row = await systemRow(SYSTEM.geo); if (row) { try { const data = JSON.parse(row.score_summary || '{}'); state.geo = { mode: data.mode || row.device_info || 'PUBLIC', ips: (data.ips || []).map(normalizeIp).filter(Boolean), grade5Ips: (data.grade5Ips || data.grade5_ips || []).map(normalizeIp).filter(Boolean) }; console.debug('[Quiz Studio Admin] Loaded Grade 5 access config:', { stateGeo: state.geo, raw: data }); } catch (error) { console.warn('[Quiz Studio Admin] Invalid Grade 5 access config:', error.message); } } ensureClass5AccessPanel(); renderGeo(); }
    function renderGeo() { ensureClass5AccessPanel(); $('geo-mode-badge') && ($('geo-mode-badge').textContent = state.geo.mode); document.querySelectorAll('[data-geo-mode]').forEach((button) => button.classList.toggle('is-active', button.dataset.geoMode === state.geo.mode)); $('geo-ip-list') && ($('geo-ip-list').innerHTML = state.geo.ips.map((ip) => `<div class="stack-item"><span class="stack-item-icon"><i class="fa-solid fa-location-dot"></i></span><span class="stack-item-main"><b>${esc(ip)}</b><small>Được phép truy cập Địa lý</small></span><button data-remove-geo="${esc(ip)}"><i class="fa-solid fa-xmark"></i></button></div>`).join('') || '<p class="muted-copy">Danh sách IP trống.</p>'); const class5Ips = Array.isArray(state.geo.grade5Ips) ? state.geo.grade5Ips : []; $('class5-ip-count') && ($('class5-ip-count').textContent = `${class5Ips.length} IP`); $('class5-ip-list') && ($('class5-ip-list').innerHTML = class5Ips.map((ip) => `<div class="stack-item"><span class="stack-item-icon"><i class="fa-solid fa-graduation-cap"></i></span><span class="stack-item-main"><b>${esc(ip)}</b><small>Được phép xem Lớp 5</small></span><button data-remove-class5="${esc(ip)}"><i class="fa-solid fa-xmark"></i></button></div>`).join('') || '<p class="muted-copy">Chưa cấp quyền cho IP nào.</p>'); }
    async function saveGeo() { const normalizeIp = (ip) => String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase(); const payload = { mode: state.geo.mode, ips: [...new Set((state.geo.ips || []).map(normalizeIp).filter(Boolean))], grade5Ips: [...new Set((state.geo.grade5Ips || []).map(normalizeIp).filter(Boolean))] }; state.geo = { ...state.geo, ...payload }; console.debug('[Quiz Studio Admin] Saving Grade 5 access config:', payload); const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.geo, player_name: '__ALLOWED_GEO_IPS__', ip_address: 'SYSTEM', device_info: state.geo.mode, status: 'ACTIVE', score_summary: JSON.stringify(payload), last_active: new Date().toISOString() }, { onConflict: 'id' }); if (error) throw error; renderGeo(); }
    async function addClass5Ip(ip) {
        const cleanIp = String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
        if (!cleanIp) return notify('Nhập IP máy cần cấp quyền Lớp 5.', true);
        state.geo.grade5Ips = Array.isArray(state.geo.grade5Ips) ? state.geo.grade5Ips : [];
        if (!state.geo.grade5Ips.includes(cleanIp)) state.geo.grade5Ips.push(cleanIp);
        await saveGeo();

        const autoToken = generateRandomToken('GRADE5');
        state.tokens.unshift({
            token: autoToken,
            role: 'grade5',
            name: `Học sinh Lớp 5 (${cleanIp})`,
            ip: cleanIp,
            createdAt: new Date().toISOString()
        });
        await saveTokens();
        const link = getStudentActivationLink(autoToken);
        await copyToClipboard(link);

        notify(`Đã cấp quyền Lớp 5 cho IP ${cleanIp} & tạo mã ${autoToken} (đã copy link kích hoạt)!`);
    }
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
        renderStats();
        renderLibrary();
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
            const isEditingSub = Boolean(state.subjectEditingKey);
            await saveSubjects();
            closeSubjectDialog();
            addActivityLog(isEditingSub ? `Cập nhật môn ${name}` : `Tạo môn học mới: ${name}`, `Mã: ${key} · Khối Lớp ${subject.grade}`, 'subject');
            notify('Đã lưu môn học.');
        } catch (error) { notify(`Không thể lưu môn học: ${error.message}`, true); }
    }
    async function deleteSubject(key) {
        if (!(await confirmDialog({ title: `Xóa môn ${key}?`, message: `Xóa môn ${key} và toàn bộ câu hỏi thuộc môn này khỏi hệ thống?`, confirmText: 'Xóa môn học', variant: 'danger' }))) return;
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
            addActivityLog(`Xóa môn học ${key}`, 'Đã xóa môn học và toàn bộ câu hỏi liên quan', 'danger');
            notify(`Đã xóa môn ${key} và toàn bộ ngân hàng câu hỏi.`);
            await loadQuestions();
        } catch (error) {
            state.subjects = previousSubjects;
            throw new Error(`Không thể xóa môn ${key}: ${error.message}`);
        }
    }


    function renderStudentsTableSmoothly(tbody, rows, online, bannedIpSet, nowMs, safeRowTime) {
        if (!tbody) return;
        if (!rows || rows.length === 0) {
            if (!tbody.querySelector('.empty-state')) {
                tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Chưa có phiên truy cập.</td></tr>';
            }
            return;
        }

        const empty = tbody.querySelector('.empty-state');
        if (empty) empty.closest('tr')?.remove();

        const existingRows = new Map();
        tbody.querySelectorAll('tr[data-session-key]').forEach(tr => {
            existingRows.set(tr.dataset.sessionKey, tr);
        });

        const activeKeys = new Set();

        rows.forEach((row, index) => {
            const ip = String(row.ip_address || row.client_ip || '').trim();
            const name = row.player_name || 'Học sinh';
            const dev = String(row.device_info || '—');
            const key = String(row.id || `${ip}__${name}__${dev}`);
            activeKeys.add(key);

            const isOnline = online.includes(row);
            const isRowBanned = String(row.status || '').startsWith('BANNED') || bannedIpSet.has(ip);
            const status = isRowBanned ? 'banned' : isOnline ? 'online' : 'offline';
            const displayTimeMs = safeRowTime ? safeRowTime(row) : 0;
            const timeFormatted = displayTimeMs ? new Date(Math.min(displayTimeMs, nowMs)).toLocaleString('vi-VN') : '—';
            const statusText = status === 'online' ? 'Online' : status === 'banned' ? 'Bị chặn' : 'Offline';

            let tr = existingRows.get(key);
            if (!tr) {
                tr = document.createElement('tr');
                tr.dataset.sessionKey = key;
                tr.style.transition = 'background-color 0.25s ease, opacity 0.25s ease';
                tr.innerHTML = `
                    <td><b>${esc(name)}</b></td>
                    <td><code>${esc(ip || 'Chưa xác định')}</code></td>
                    <td>${esc(dev)}</td>
                    <td class="session-col-time">${esc(timeFormatted)}</td>
                    <td class="session-col-status"><span class="table-status ${status}"><i class="fa-solid fa-circle"></i> ${statusText}</span></td>
                    <td class="align-right">
                        <div class="table-actions">
                            ${status === 'banned' ? `<button class="table-action" data-unban-row="${esc(ip)}" title="Mở khóa IP"><i class="fa-solid fa-unlock"></i></button>` : `<button class="table-action danger" data-ban-row="${esc(ip)}" title="Chặn IP"><i class="fa-solid fa-ban"></i></button>`}
                            <button class="table-action" data-grant-token-name="${esc(name)}" data-grant-token-ip="${esc(ip)}" data-grant-token-device="${esc(dev)}" title="Kích hoạt quyền thiết bị này"><i class="fa-solid fa-key"></i></button>
                            <button class="table-action" data-private-notice="${esc(ip)}" data-private-name="${esc(name)}" title="Thông báo riêng"><i class="fa-solid fa-comment-dots"></i></button>
                            <button class="table-action danger" data-delete-student-name="${esc(name)}" data-delete-student-ip="${esc(ip)}" data-delete-student-device="${esc(dev)}" title="Xóa toàn bộ thông tin của học sinh này"><i class="fa-solid fa-trash-can"></i></button>
                        </div>
                    </td>
                `;
                const targetChild = tbody.children[index];
                tbody.insertBefore(tr, targetChild || null);
            } else {
                const nameEl = tr.querySelector('td:first-child b');
                if (nameEl && nameEl.textContent !== name) {
                    nameEl.textContent = name;
                }

                const devCell = tr.children[2];
                if (devCell && devCell.textContent !== dev) {
                    devCell.textContent = dev;
                }

                const timeEl = tr.querySelector('.session-col-time');
                if (timeEl && timeEl.textContent !== timeFormatted) {
                    timeEl.textContent = timeFormatted;
                }

                const statusEl = tr.querySelector('.session-col-status');
                if (statusEl) {
                    // Tuyệt đối chỉ giữ huy hiệu kết nối (Online / Offline / Bị chặn), loại bỏ vĩnh viễn tag tiến độ [toán đề ...]
                    const cleanStatusHtml = `<span class="table-status ${status}"><i class="fa-solid fa-circle"></i> ${statusText}</span>`;
                    if (statusEl.innerHTML.trim() !== cleanStatusHtml) {
                        statusEl.innerHTML = cleanStatusHtml;
                    }
                }
                tr.querySelectorAll('div, small').forEach(el => {
                    if (el.textContent.includes('Tiến độ:') || el.textContent.includes('câu (') || el.style?.color?.includes('cyan')) {
                        el.remove();
                    }
                });

                const actionsEl = tr.querySelector('.table-actions');
                if (actionsEl) {
                    const banBtn = actionsEl.querySelector('[data-ban-row], [data-unban-row]');
                    if (status === 'banned' && banBtn && banBtn.hasAttribute('data-ban-row')) {
                        banBtn.outerHTML = `<button class="table-action" data-unban-row="${esc(ip)}" title="Mở khóa IP"><i class="fa-solid fa-unlock"></i></button>`;
                    } else if (status !== 'banned' && banBtn && banBtn.hasAttribute('data-unban-row')) {
                        banBtn.outerHTML = `<button class="table-action danger" data-ban-row="${esc(ip)}" title="Chặn IP"><i class="fa-solid fa-ban"></i></button>`;
                    }
                }

                const targetChild = tbody.children[index];
                if (targetChild !== tr) {
                    tbody.insertBefore(tr, targetChild || null);
                }
            }
        });

        existingRows.forEach((tr, k) => {
            if (!activeKeys.has(k)) {
                tr.remove();
            }
        });
    }

    async function loadStudents() {
        if (state.isClearingStudents) return;
        ensureMonitorTable();
        const systemIds = Object.values(SYSTEM);
        if (!state.adminConfig?.masterIp) {
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
        }
        const adminIps = new Set([
            state.adminConfig.masterIp,
            ...(state.adminConfig.allowedIps || []).map((item) => typeof item === 'string' ? item : item?.ip)
        ].map((ip) => String(ip || '').trim()).filter(Boolean));
        const data = [];
        let error = null;
        // Giới hạn 300 phiên hoạt động mới nhất để chống tràn API Supabase định kỳ 5s
        const page = await state.client
            .from('quiz_logins')
            .select('id, player_name, ip_address, device_info, status, score_summary, last_active, created_at')
            .neq('player_name', '__TRASH_BIN__')
            .order('last_active', { ascending: false })
            .limit(300);
        if (page.error) {
            error = page.error;
        } else if (Array.isArray(page.data)) {
            data.push(...page.data);
        }
        if (error) {
            console.error('[Quiz Studio Admin] Không tải được phiên học sinh:', error);
            return notify(`Không thể tải giám sát học sinh: ${error.message}`, true);
        }
        if (state.isClearingStudents) return;
        const nowMs = Date.now() + (window.dbService?.serverClockOffsetMs || 0);
        const normalizeTimestamp = (iso) => {
            if (!iso) return 0;
            let ts = new Date(iso).getTime();
            if (Number.isNaN(ts) || ts <= 0) return 0;
            return ts;
        };
        const safeRowTime = (row) => {
            const la = normalizeTimestamp(row.last_active);
            const ca = normalizeTimestamp(row.created_at);
            return la || ca || 0;
        };
        const rawRows = (data || []).filter((row) => {
            const playerName = String(row.player_name || '').trim();
            const ip = String(row.ip_address || row.client_ip || '').trim();
            if (systemIds.includes(row.id) || playerName.startsWith('__')) return false;
            if ((!playerName || playerName.toLowerCase() === 'khách truy cập') && adminIps.has(ip)) return false;
            return true;
        }).sort((a, b) => safeRowTime(b) - safeRowTime(a));

        // Gộp hiển thị theo từng thiết bị (bảo đảm hai máy mở cùng lúc không bị gộp đè làm mất nhau)
        const seenStudents = new Map();
        for (const row of rawRows) {
            const normName = String(row.player_name || '').trim().toLowerCase();
            const normIp = String(row.ip_address || row.client_ip || '').trim();
            const normDev = String(row.device_info || '').trim().toLowerCase();
            const dedupeKey = (normName && normName !== 'khách truy cập') 
                ? `name:${normName}___dev:${normDev}` 
                : `ip:${normIp}___dev:${normDev}`;
            if (!seenStudents.has(dedupeKey)) {
                seenStudents.set(dedupeKey, row);
            }
        }
        const rows = Array.from(seenStudents.values());

        // Danh sách IP bị chặn (bao gồm cả IP chặn thủ công __BANNED_IP__ chưa từng đăng nhập)
        const bannedMap = new Map();
        (data || []).forEach((row) => {
            const ip = String(row.ip_address || row.client_ip || '').trim();
            if (!ip || ip === 'SYSTEM' || ip === 'ALL') return;
            if (String(row.status || '').startsWith('BANNED') || row.player_name === '__BANNED_IP__') {
                if (!bannedMap.has(ip)) bannedMap.set(ip, row);
            }
        });
        const banned = Array.from(bannedMap.values());
        const bannedIpSet = new Set(bannedMap.keys());

        if (!state.studentPulseMap) state.studentPulseMap = new Map();
        const online = rows.filter((row) => {
            const normIp = String(row.ip_address || row.client_ip || '').trim();
            if (String(row.status || '').startsWith('BANNED') || bannedIpSet.has(normIp)) return false;
            const normName = String(row.player_name || '').trim().toLowerCase();
            const normDev = String(row.device_info || '').trim().toLowerCase();
            const key = (normName && normName !== 'khách truy cập') 
                ? `name:${normName}___dev:${normDev}` 
                : `ip:${normIp}___dev:${normDev}`;
            const sig = `${row.last_active || ''}|${row.status || ''}|${row.score_summary || ''}|${normIp}|${normDev}`;
            const prev = state.studentPulseMap.get(key);
            const rowTime = safeRowTime(row);
            // Online nếu hoạt động trong vòng 5 phút (300,000 ms) hoặc đồng hồ máy học sinh chạy trước admin
            const isRecentByClock = rowTime > 0 && (rowTime >= nowMs - 300000) && (rowTime <= nowMs + 86400000);
            if (!prev) {
                state.studentPulseMap.set(key, {
                    sig,
                    activeUntil: isRecentByClock ? (nowMs + 300000) : 0
                });
            } else if (prev.sig !== sig) {
                // Có nhịp heartbeat / tiến độ mới thay đổi -> giữ trạng thái Online ổn định 5 phút
                prev.sig = sig;
                prev.activeUntil = nowMs + 300000;
            }
            const pulse = state.studentPulseMap.get(key);
            return isRecentByClock || (pulse && pulse.activeUntil > nowMs);
        });

        const activeSessions = new Set(online.map((row) => `${row.id || (row.ip_address + ':' + row.player_name + ':' + row.device_info)}`));
        animateMetricValue('stat-online', activeSessions.size);
        $('nav-online-count') && ($('nav-online-count').textContent = activeSessions.size);
        $('student-count') && ($('student-count').textContent = `${rows.length} phiên`);
        $('stat-visitor-note') && ($('stat-visitor-note').textContent = `${rows.length} phiên ghi nhận`);

        const nextStatsHtml = `<div class="monitor-stat"><span><b>${activeSessions.size}</b><small>Đang trực tuyến</small></span><i style="color:var(--green);background:#def9eb" class="fa-solid fa-signal"></i></div><div class="monitor-stat"><span><b>${rows.length}</b><small>Tổng phiên ghi nhận</small></span><i style="color:var(--primary);background:#eeedff" class="fa-solid fa-users"></i></div><div class="monitor-stat"><span><b>${banned.length}</b><small>IP đang bị chặn</small></span><i style="color:var(--red);background:#ffe7e8" class="fa-solid fa-ban"></i></div>`;
        if ($('monitor-stats') && state.lastMonitorStatsHtml !== nextStatsHtml) {
            state.lastMonitorStatsHtml = nextStatsHtml;
            $('monitor-stats').innerHTML = nextStatsHtml;
        }

        renderStudentsTableSmoothly($('students-body'), rows, online, bannedIpSet, nowMs, safeRowTime);

        $('banned-count') && ($('banned-count').textContent = `${banned.length} IP`);
        const nextBannedHtml = banned.map((row) => `<div class="stack-item"><span class="stack-item-icon"><i class="fa-solid fa-ban"></i></span><span class="stack-item-main"><b>${esc(row.ip_address)}</b><small>${esc(row.score_summary || row.device_info || 'Vi phạm quy chế')}</small></span><button data-unban-row="${esc(row.ip_address)}"><i class="fa-solid fa-unlock"></i></button></div>`).join('') || '<p class="muted-copy">Chưa có IP bị chặn.</p>';
        if ($('banned-list') && state.lastBannedListHtml !== nextBannedHtml) {
            state.lastBannedListHtml = nextBannedHtml;
            $('banned-list').innerHTML = nextBannedHtml;
        }
    }
    function ensureMonitorTable() {
        if ($('students-body')) return;
        const stats = $('monitor-stats');
        if (!stats) return;
        stats.insertAdjacentHTML('afterend', '<section class="panel monitor-table-panel"><div class="panel-title"><div><p class="eyebrow">PRESENCE</p><h2>Phiên truy cập và địa chỉ IP</h2></div><span class="info-badge">Heartbeat 20 giây</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Học sinh</th><th>IP</th><th>Thiết bị</th><th>Hoạt động cuối</th><th>Trạng thái</th><th></th></tr></thead><tbody id="students-body"><tr><td colspan="6" class="empty-state">Đang tải dữ liệu...</td></tr></tbody></table></div></section>');
    }

    function parseStudentProgress(row) {
        const rawStatus = String(row.status || '');
        const rawScore = String(row.score_summary || '');
        const rawPayload = [rawStatus, rawScore].join(' ');
        let subjectName = '';
        const subjMatch = rawStatus.match(/^\[(.*?)\]/) || rawScore.match(/^\[(.*?)\]/);
        if (subjMatch) subjectName = subjMatch[1].trim();

        const isGrade5 = /lớp\s*5|toán|math5|toán\s*đề/i.test(subjectName) ||
                        /lớp\s*5/i.test(rawStatus) || /lớp\s*5/i.test(rawScore) ||
                        subjectName.toLowerCase().startsWith('toán');

        let answered = 0, total = 0, percent = 0;
        const progMatch = rawStatus.match(/(\d+)\s*\/\s*(\d+)/) || rawScore.match(/(\d+)\s*\/\s*(\d+)/);
        if (progMatch) {
            answered = parseInt(progMatch[1], 10);
            total = parseInt(progMatch[2], 10);
            percent = total > 0 ? Math.round((answered / total) * 100) : 0;
        }

        let correct = 0, wrong = 0;
        const correctMatch = rawScore.match(/đúng\s*(\d+)(?:\s*\/\s*(\d+))?/i);
        if (correctMatch) {
            correct = parseInt(correctMatch[1], 10);
            if (correctMatch[2]) {
                const outOf = parseInt(correctMatch[2], 10);
                if (total === 0) total = outOf;
                if (answered === 0) answered = total;
                wrong = Math.max(0, (answered || total) - correct);
            } else if (answered >= correct) {
                wrong = answered - correct;
            }
        }

        const isCompleted = /đã nộp bài|hoàn thành/i.test(rawPayload) || /điểm/i.test(rawScore);
        const isFullyAnswered = total > 0 && answered >= total;
        const isReadyToSubmit = !isCompleted && isFullyAnswered;
        if (isCompleted && percent === 0 && total > 0) percent = 100;
        if (isFullyAnswered) percent = 100;

        let finalScore = null;
        const scoreMatch = rawScore.match(/(\d+(?:[.,]\d+)?)\s*điểm/i);
        if (scoreMatch) finalScore = Number(scoreMatch[1].replace(',', '.'));

        const isWaiting = !isCompleted && !isReadyToSubmit && (answered === 0 || /đang xem trang chủ|trang chủ|chưa chọn|chờ vào/i.test(rawStatus) || /trang chủ/i.test(subjectName));

        const timeMatch = rawPayload.match(/(?:thời gian làm bài|đã làm|làm bài)\s*[:：-]?\s*(\d{1,3})(?:\s*phút|\s*p)?\s*(?:(\d{1,2})\s*(?:giây|s))?/i)
            || rawPayload.match(/-\s*(\d{1,3}:\d{2})/);
        let durationSeconds = 0;
        let durationLabel = 'Chưa có dữ liệu';
        if (timeMatch) {
            if (String(timeMatch[1]).includes(':')) {
                const [minutes, seconds] = String(timeMatch[1]).split(':').map(Number);
                durationSeconds = (minutes * 60) + seconds;
            } else {
                durationSeconds = (Number(timeMatch[1]) * 60) + Number(timeMatch[2] || 0);
            }
            if (durationSeconds > 0) {
                const minutes = Math.floor(durationSeconds / 60);
                const seconds = durationSeconds % 60;
                durationLabel = minutes ? `${minutes}p ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
            }
        }

        // Quy đổi điểm sang Thang Điểm 10 khoa học (Tối đa 10 điểm mỗi đề)
        let score10 = 0;
        if (isCompleted) {
            if (finalScore !== null && !isNaN(finalScore)) {
                // score_summary của app lưu điểm phần trăm (0–100).
                // Quy đổi nhất quán sang thang 10, không dùng tổng câu để
                // biến 75/50 thành 10/10.
                const s = Number(finalScore) / 10;
                score10 = Math.min(10, Math.max(0, Math.round(s * 10) / 10));
            } else if (total > 0) {
                score10 = Math.min(10, Math.max(0, Math.round((correct / total) * 100) / 10));
            }
        } else if (total > 0 && answered > 0) {
            score10 = Math.min(10, Math.max(0, Math.round((correct / total) * 100) / 10));
        }

        return {
            id: row.id,
            name: row.player_name || 'Học sinh',
            ip: row.ip_address || '',
            device: row.device_info || '',
            subject: subjectName || 'Chưa chọn môn',
            grade: isGrade5 ? '5' : '11',
            isGrade5,
            answered,
            total,
            percent,
            correct,
            wrong,
            finalScore,
            score10,
            isCompleted,
            isReadyToSubmit,
            isWaiting,
            durationSeconds,
            durationLabel,
            lastActive: row.last_active,
            rawStatus,
            rawScore,
            row
        };
    }

    function formatTimeAgo(isoString, nowMs = Date.now()) {
        if (!isoString) return '—';
        const timeMs = new Date(isoString).getTime();
        if (isNaN(timeMs)) return '—';
        const diffSec = Math.max(0, Math.round((nowMs - timeMs) / 1000));
        if (diffSec < 15) return 'Vừa mới xong';
        if (diffSec < 60) return `${diffSec} giây trước`;
        const diffMin = Math.round(diffSec / 60);
        if (diffMin < 60) return `${diffMin} phút trước`;
        const diffHours = Math.round(diffMin / 60);
        if (diffHours < 24) return `${diffHours} giờ trước`;
        return new Date(timeMs).toLocaleDateString('vi-VN');
    }

    function buildProgressDeleteButton(p) {
        return `<button type="button" class="progress-card-delete" data-delete-progress-id="${esc(p.id)}" data-delete-progress-name="${esc(p.name)}" data-delete-progress-ip="${esc(p.ip)}" data-delete-progress-device="${esc(p.device)}" title="Xóa phiên này" aria-label="Xóa phiên của ${esc(p.name)}"><i class="fa-solid fa-trash-can"></i></button>`;
    }

    function setProgressEmptyState(container, visible, filterLabel = 'nào') {
        if (!container) return;
        let empty = container.querySelector('[data-progress-empty]');
        if (!empty) {
            empty = document.createElement('div');
            empty.dataset.progressEmpty = 'true';
            empty.style.cssText = 'grid-column:1 / -1;text-align:center;padding:48px 16px;background:var(--surface-2);border-radius:16px;border:1px dashed var(--border);';
            empty.innerHTML = '<div style="font-size:32px;color:var(--amber,#f59e0b);margin-bottom:8px;"><i class="fa-solid fa-graduation-cap"></i></div><h3 style="font-size:16px;font-weight:700;color:var(--text);"></h3><p style="font-size:13px;color:var(--muted);margin-top:4px;max-width:420px;margin-inline:auto;">Khi học sinh vào làm các đề thi, số câu làm được và tiến trình sẽ hiển thị trực tiếp theo thời gian thực tại đây.</p>';
            container.appendChild(empty);
        }
        const title = empty.querySelector('h3');
        if (title) title.textContent = filterLabel ? `Chưa có học sinh ${filterLabel} nào` : 'Chưa có học sinh nào';
        empty.hidden = !visible;
    }

    function formatExamStatus(subject) {
        const configured = allSubjects().find((item) => subjectMatchKey(item.key) === subjectMatchKey(subject) || subjectMatchKey(item.name) === subjectMatchKey(subject));
        const source = `${configured?.status || configured?.state || configured?.name || subject}`.toLowerCase();
        return /đóng|closed|khóa/i.test(source) ? 'Đã đóng' : 'Đang mở';
    }

    function renderProgressSubjectOptions(records = []) {
        const select = $('progress-subject-filter');
        if (!select) return;
        const subjects = new Map();
        records.forEach((record) => {
            const key = record.subject && record.subject !== 'Chưa chọn môn' ? record.subject : '';
            if (key) subjects.set(subjectMatchKey(key), key);
        });
        allSubjects().forEach((item) => {
            if (!subjects.has(subjectMatchKey(item.name))) subjects.set(subjectMatchKey(item.name), item.name);
        });
        const selected = state.progressSubject || 'all';
        select.innerHTML = `<option value="all">Tất cả môn học</option>${Array.from(subjects.values()).sort((a, b) => a.localeCompare(b, 'vi')).map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}`;
        select.value = Array.from(select.options).some((option) => subjectMatchKey(option.value) === subjectMatchKey(selected)) ? selected : 'all';
        if (select.value !== selected) state.progressSubject = 'all';
    }

    function observerIsOnline(item) {
        const now = Date.now();
        return (state.progressRawLogins || []).some((row) => {
            const sameIp = item.ip && String(row.ip_address || '').trim() === String(item.ip).trim();
            const sameName = item.name && String(row.player_name || '').trim().toLowerCase() === String(item.name).trim().toLowerCase();
            const time = new Date(row.last_active || row.created_at || 0).getTime();
            return (sameIp || sameName) && time > 0 && now - time < 300000 && !String(row.status || '').startsWith('BANNED');
        });
    }

    function renderProgressSubjectInfo(records = []) {
        const target = $('progress-subject-info');
        if (!target) return;
        const subject = state.progressSubject || 'all';
        if (subject === 'all') {
            const total = records.length;
            const completed = records.filter((item) => item.isCompleted).length;
            const completion = total ? Math.round((completed / total) * 100) : 0;
            target.innerHTML = `<div class="progress-subject-empty"><i class="fa-solid fa-layer-group"></i><div><strong>Tổng quan theo bộ lọc hiện tại</strong><span>${total ? `${total} học sinh · ${completion}% đã hoàn thành` : 'Chọn một môn học cụ thể để xem thông tin đề thi.'}</span></div></div>`;
            return;
        }
        const matched = records.filter((item) => subjectMatchKey(item.subject) === subjectMatchKey(subject));
        const first = matched[0];
        const configured = allSubjects().find((item) => subjectMatchKey(item.name || item.key) === subjectMatchKey(subject));
        const totalQuestions = Math.max(Number(configured?.count || 0), ...matched.map((item) => Number(item.total || 0)), 0);
        const average = matched.length ? matched.reduce((sum, item) => sum + Number(item.score10 || 0), 0) / matched.length : 0;
        const completion = matched.length ? Math.round((matched.filter((item) => item.isCompleted || item.percent >= 100).length / matched.length) * 100) : 0;
        const grade = configured ? subjectGrade(configured) : (first?.grade || '—');
        target.innerHTML = `<div class="progress-subject-summary"><div class="progress-subject-identity"><span class="progress-subject-icon"><i class="fa-solid fa-book-open"></i></span><div><p class="eyebrow">THÔNG TIN MÔN HỌC</p><h3>${esc(configured?.name || subject)}</h3><span>Khối ${esc(grade)} · Mã đề: ${esc(configured?.examCode || configured?.code || 'Chưa thiết lập')}</span></div></div><div class="progress-subject-facts"><span><b>Thời gian</b>${esc(configured?.duration || '45 phút')}</span><span><b>Trạng thái đề</b><em class="${formatExamStatus(subject) === 'Đang mở' ? 'is-open' : 'is-closed'}">${formatExamStatus(subject)}</em></span><span><b>Cấu trúc</b>${totalQuestions || '—'} câu · ${esc(configured?.format || 'Trắc nghiệm')}</span><span><b>Thang điểm</b>${esc(configured?.scale || '10')}</span><span><b>Điểm trung bình</b>${matched.length ? average.toFixed(1) : '—'} / 10</span><span><b>Hoàn thành chung</b>${completion}%</span></div></div>`;
    }

    function getProgressCardStatus(p) {
        if (p.isCompleted) return { type: 'completed', label: 'Hoàn thành', icon: 'fa-circle-check', tone: 'primary' };
        if (p.isReadyToSubmit) return { type: 'ready', label: 'Chờ nộp bài', icon: 'fa-paper-plane', tone: 'blue' };
        if (p.isWaiting) return { type: 'waiting', label: 'Đang chờ', icon: 'fa-hourglass-half', tone: 'muted' };
        return { type: 'doing', label: 'Đang làm bài', icon: 'fa-pen-nib', tone: 'green' };
    }

    function progressSortRecords(records) {
        const list = [...records];
        const time = (item) => new Date(item.lastActive || 0).getTime() || 0;
        if (state.progressSort === 'progress') return list.sort((a, b) => b.percent - a.percent || time(b) - time(a));
        if (state.progressSort === 'score') return list.sort((a, b) => b.score10 - a.score10 || time(b) - time(a));
        if (state.progressSort === 'score-asc') return list.sort((a, b) => a.score10 - b.score10 || time(b) - time(a));
        return list.sort((a, b) => {
            const statusWeight = (item) => item.isReadyToSubmit ? 3 : (item.isCompleted ? 2 : (item.isWaiting ? 0 : 1));
            return statusWeight(b) - statusWeight(a) || time(b) - time(a);
        });
    }

    async function renderGrade5ProgressMonitor() {
        const container = $('grade5-progress-cards');
        if (!container) return;
        if (state.progressLoading) {
            state.progressRefreshQueued = true;
            return;
        }
        state.progressLoading = true;

        let logins = [];
        let loadError = '';
        try {
            if (state.client) {
                const { data, error } = await state.client
                    .from('quiz_logins')
                    .select('*')
                    .order('last_active', { ascending: false })
                    .limit(100);
                if (error) loadError = error.message || 'Không thể tải dữ liệu tiến trình.';
                else if (data) logins = data;
            }
        } catch (e) {
            loadError = e?.message || 'Không thể tải dữ liệu tiến trình.';
            console.warn('Lỗi tải tiến trình:', e);
        }

        if (!logins || logins.length === 0) logins = state.logins || [];

        const systemIds = Object.values(SYSTEM || {});
        const studentRows = (logins || []).filter(r => {
            const name = String(r.player_name || '').trim().toLowerCase();
            const status = String(r.status || '').toLowerCase();
            return !systemIds.includes(r.id) && !name.startsWith('__') &&
                name !== 'khách truy cập' && name !== 'visitor' &&
                !status.includes('admin') && String(r.ip_address || '').trim() !== 'SYSTEM';
        });
        // Chỉ giữ phiên mới nhất của mỗi học sinh/IP/thiết bị. Realtime heartbeat
        // có thể tạo nhiều attempt, nhưng không được làm phình bộ đếm tổng học sinh.
        const latestByStudent = new Map();
        for (const row of studentRows) {
            const name = String(row.player_name || '').trim().toLowerCase();
            const ip = String(row.ip_address || '').trim().toLowerCase();
            const device = String(row.device_info || '').trim().toLowerCase();
            const key = name && name !== 'học sinh' ? `name:${name}` : (ip ? `ip:${ip}::device:${device}` : `row:${row.id}`);
            const time = new Date(row.last_active || row.created_at || 0).getTime() || 0;
            const old = latestByStudent.get(key);
            if (!old || time > old.time) latestByStudent.set(key, { row, time });
        }
        const allParsed = Array.from(latestByStudent.values()).map(item => parseStudentProgress(item.row));
        const filter = state.progressFilter || 'all';
        const gradeList = filter === 'all'
            ? allParsed
            : (filter === '5' ? allParsed.filter(p => p.isGrade5) : allParsed.filter(p => !p.isGrade5));
        state.progressRecords = allParsed;
        state.progressRawLogins = logins;
        renderProgressSubjectOptions(allParsed);
        const subjectList = state.progressSubject === 'all'
            ? gradeList
            : gradeList.filter((p) => subjectMatchKey(p.subject) === subjectMatchKey(state.progressSubject));
        const keyword = String(state.progressSearch || '').trim().toLowerCase();
        const parsedList = keyword ? subjectList.filter((p) => `${p.name} ${p.subject} ${p.ip}`.toLowerCase().includes(keyword)) : subjectList;
        renderProgressSubjectInfo(subjectList);
        if (loadError && gradeList.length === 0) {
            container.querySelectorAll('.grade5-live-card').forEach((card) => card.remove());
            setProgressEmptyState(container, true, 'nào');
            const title = container.querySelector('[data-progress-empty] h3');
            if (title) title.textContent = 'Không thể tải dữ liệu';
            const message = container.querySelector('[data-progress-empty] p');
            if (message) message.textContent = loadError;
            state.progressLoading = false;
            return;
        }

        const nowMs = Date.now();
        let doingCount = 0;
        let submittedCount = 0;
        let waitingCount = 0;

        subjectList.forEach(p => {
            if (p.isCompleted) submittedCount++;
            else if (p.isWaiting) waitingCount++;
            else doingCount++;
        });

        $('g5-stat-doing') && ($('g5-stat-doing').textContent = doingCount);
        $('g5-stat-submitted') && ($('g5-stat-submitted').textContent = submittedCount);
        $('g5-stat-waiting') && ($('g5-stat-waiting').textContent = waitingCount);
        $('g5-stat-total') && ($('g5-stat-total').textContent = subjectList.length);
        $('nav-progress-count') && ($('nav-progress-count').textContent = doingCount > 0 ? doingCount : (submittedCount || subjectList.length));

        renderQuickObservers();

        if (parsedList.length === 0) {
            const filterLabel = filter === 'all' ? '' : `Lớp ${filter}`;
            container.querySelectorAll('.grade5-live-card').forEach((card) => card.remove());
            setProgressEmptyState(container, true, filterLabel);
            state.progressLoading = false;
            if (state.progressRefreshQueued) { state.progressRefreshQueued = false; setTimeout(() => renderGrade5ProgressMonitor(), 250); }
            return;
        }

        // Ưu tiên hiển thị: Học sinh đang thi lên đầu -> Đã nộp bài -> Người đang chờ ở trang chủ
        const sortedList = progressSortRecords(parsedList);

        setProgressEmptyState(container, false);
        renderGrade5CardsSmoothly(container, sortedList, nowMs);
        state.progressLoading = false;
        if (state.progressRefreshQueued) { state.progressRefreshQueued = false; setTimeout(() => renderGrade5ProgressMonitor(), 250); }
    }

    function buildGrade5CardInnerHtml(p, cardType, percent, timeAgo) {
        const status = getProgressCardStatus(p);
        const statusColors = {
            waiting: 'background:rgba(148,163,184,0.15);color:#94a3b8;',
            completed: 'background:rgba(16,185,129,0.15);color:#34d399;',
            ready: 'background:rgba(59,130,246,0.15);color:#60a5fa;',
            doing: 'background:rgba(16,185,129,0.15);color:#34d399;'
        };
        const statusHtml = `<span class="status-badge" style="${statusColors[status.type] || statusColors.doing}font-weight:700;display:inline-flex;align-items:center;gap:5px;"><i class="fa-solid ${status.icon}"></i> ${status.label}</span>`;
        if (cardType === 'waiting') {
            return `
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="width:38px;height:38px;border-radius:10px;background:rgba(148,163,184,0.15);color:#94a3b8;display:flex;align-items:center;justify-content:center;font-size:16px;">
                            <i class="fa-solid fa-user-clock"></i>
                        </div>
                        <div>
                            <h3 style="font-size:15px;font-weight:700;margin:0;color:var(--text);">${esc(p.name)}</h3>
                            <small style="color:var(--muted);font-size:11px;"><i class="fa-solid fa-clock"></i> <span class="g5-card-time">${esc(timeAgo)}</span></small>
                        </div>
                    </div>
                    <div class="progress-card-actions">
                        ${statusHtml}
                        ${buildProgressDeleteButton(p)}
                    </div>
                </div>

                <div style="background:var(--surface-3);padding:10px 12px;border-radius:10px;border:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-size:12px;font-weight:500;color:var(--text);"><i class="fa-solid fa-compass" style="color:var(--muted);margin-right:6px;"></i> Đang ở màn hình trang chủ</span>
                    <span style="font-size:11px;color:var(--muted);font-style:italic;">Chưa chọn đề thi</span>
                </div>

                <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--muted);border-top:1px dashed var(--border);padding-top:8px;">
                    <span><i class="fa-solid fa-network-wired"></i> IP: <code>${esc(p.ip || '—')}</code></span>
                    <span class="g5-card-duration"><i class="fa-regular fa-clock"></i> Đã làm: ${esc(p.durationLabel)}</span>
                </div>
            `;
        }

        if (cardType === 'completed') {
            return `
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="width:38px;height:38px;border-radius:10px;background:rgba(99,102,241,0.15);color:var(--primary);display:flex;align-items:center;justify-content:center;font-size:16px;">
                            <i class="fa-solid fa-award"></i>
                        </div>
                        <div>
                            <h3 style="font-size:15px;font-weight:700;margin:0;color:var(--text);">${esc(p.name)}</h3>
                            <small style="color:var(--muted);font-size:11px;"><i class="fa-solid fa-clock"></i> <span class="g5-card-time">${esc(timeAgo)}</span></small>
                        </div>
                    </div>
                    <div class="progress-card-actions">
                        ${statusHtml}
                        ${buildProgressDeleteButton(p)}
                    </div>
                </div>

                <div style="background:var(--surface-3);padding:10px 12px;border-radius:10px;border:1px solid var(--border);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-size:12px;font-weight:600;color:var(--text);"><i class="fa-solid fa-book-open" style="color:var(--primary);margin-right:4px;"></i> <span class="g5-card-subject">${esc(p.subject)}</span></span>
                        <span style="font-size:12px;font-weight:700;color:var(--primary);" class="g5-card-count">Hoàn thành: ${p.answered}/${p.total || p.answered} câu</span>
                    </div>
                    <div style="height:10px;background:rgba(0,0,0,0.3);border-radius:99px;overflow:hidden;position:relative;border:1px solid rgba(255,255,255,0.06);box-shadow:inset 0 1px 3px rgba(0,0,0,0.4);">
                        <div class="g5-progress-fill" style="width:100%;height:100%;background:linear-gradient(90deg, #6366f1, #10b981);border-radius:99px;box-shadow:0 0 10px rgba(16,185,129,0.3);"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:11px;color:var(--muted);">
                        <span>Đúng: <b style="color:var(--text);">${p.correct}/${p.total || p.answered} câu</b> (${percent}%)</span>
                        <span style="font-size:13px;font-weight:800;color:var(--amber,#f59e0b);background:rgba(245,158,11,0.15);padding:2px 8px;border-radius:6px;border:1px solid rgba(245,158,11,0.3);"><i class="fa-solid fa-trophy"></i> ${p.score10.toFixed(1)} / 10 đ</span>
                    </div>
                </div>

                <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--muted);border-top:1px dashed var(--border);padding-top:8px;">
                    <span><i class="fa-solid fa-network-wired"></i> IP: <code>${esc(p.ip || '—')}</code></span>
                    <span class="g5-card-duration"><i class="fa-regular fa-clock"></i> Đã làm: ${esc(p.durationLabel)}</span>
                </div>
            `;
        }

        // CardType: doing
        return `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:38px;height:38px;border-radius:10px;background:rgba(16,185,129,0.15);color:var(--emerald);display:flex;align-items:center;justify-content:center;font-size:16px;">
                        <i class="fa-solid fa-user-pen"></i>
                    </div>
                    <div>
                        <h3 style="font-size:15px;font-weight:700;margin:0;color:var(--text);">${esc(p.name)}</h3>
                        <small style="color:var(--muted);font-size:11px;"><i class="fa-solid fa-clock"></i> <span class="g5-card-time">${esc(timeAgo)}</span></small>
                    </div>
                </div>
                <div class="progress-card-actions">
                    ${statusHtml}
                    ${buildProgressDeleteButton(p)}
                </div>
            </div>

            <div style="background:var(--surface-3);padding:10px 12px;border-radius:10px;border:1px solid var(--border);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span style="font-size:12px;font-weight:600;color:var(--text);"><i class="fa-solid fa-book-open" style="color:var(--primary);margin-right:4px;"></i> <span class="g5-card-subject">${esc(p.subject)}</span></span>
                    <span style="font-size:12px;font-weight:700;color:var(--primary);" class="g5-card-count">${p.total > 0 ? `${p.answered}/${p.total} câu` : `${p.answered} câu đã làm`}</span>
                </div>
                <div style="height:10px;background:rgba(0,0,0,0.3);border-radius:99px;overflow:hidden;position:relative;border:1px solid rgba(255,255,255,0.06);box-shadow:inset 0 1px 3px rgba(0,0,0,0.4);">
                    <div class="g5-progress-fill" style="width:${percent}%;height:100%;background:linear-gradient(90deg, #10b981 0%, #06b6d4 50%, #6366f1 100%);border-radius:99px;transition:width 0.7s cubic-bezier(0.34, 1.25, 0.64, 1);box-shadow:0 0 10px rgba(6,182,212,0.4);"></div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:11px;color:var(--muted);">
                    <span>Tiến độ: <b style="color:var(--text);" class="g5-card-percent">${percent}%</b></span>
                    <span class="g5-card-score">Đúng: <b style="color:var(--emerald);">${p.correct}</b> • <span style="color:var(--red,#ef4444);">Sai: ${p.wrong}</span> (<b>${p.score10.toFixed(1)}/10 đ</b>)</span>
                </div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--muted);border-top:1px dashed var(--border);padding-top:8px;">
                <span><i class="fa-solid fa-network-wired"></i> IP: <code>${esc(p.ip || '—')}</code></span>
                <span class="g5-card-duration"><i class="fa-regular fa-clock"></i> Đã làm: ${esc(p.durationLabel)}</span>
            </div>
        `;
    }

    function renderGrade5CardsSmoothly(container, sortedList, nowMs) {
        const existingCards = new Map();
        container.querySelectorAll('[data-student-id]').forEach(el => {
            existingCards.set(el.dataset.studentId, el);
        });

        const activeIds = new Set(sortedList.map(s => s.id));
        existingCards.forEach((cardEl, id) => {
            if (!activeIds.has(id)) {
                cardEl.remove();
                existingCards.delete(id);
            }
        });

        sortedList.forEach((p, index) => {
            const timeAgo = formatTimeAgo(p.lastActive, nowMs);
            const cardType = p.isWaiting ? 'waiting' : (p.isCompleted ? 'completed' : (p.isReadyToSubmit ? 'ready' : 'doing'));
            const percent = p.total > 0 ? Math.min(100, Math.round((p.answered / p.total) * 100)) : (p.isCompleted ? 100 : 0);

            let card = existingCards.get(p.id);

            if (!card) {
                card = document.createElement('article');
                card.className = 'panel grade5-live-card';
                card.style.margin = '0';
                card.style.padding = '16px';
                card.style.borderRadius = '14px';
                card.style.background = 'var(--surface-2)';
                card.style.border = '1px solid var(--border)';
                card.style.display = 'flex';
                card.style.flexDirection = 'column';
                card.style.gap = '12px';
                card.style.transition = 'all 0.3s ease';
                card.dataset.studentId = p.id;
                card.dataset.cardType = cardType;
                card.dataset.progressStudent = p.id;
                card.innerHTML = buildGrade5CardInnerHtml(p, cardType, percent, timeAgo);
                const targetChild = container.children[index];
                container.insertBefore(card, targetChild || null);
            } else {
                if (card.dataset.cardType !== cardType) {
                    card.dataset.cardType = cardType;
                    card.innerHTML = buildGrade5CardInnerHtml(p, cardType, percent, timeAgo);
                } else {
                    const elTime = card.querySelector('.g5-card-time');
                    if (elTime && elTime.textContent !== timeAgo) elTime.textContent = timeAgo;

                    const durationEl = card.querySelector('.g5-card-duration');
                    if (durationEl) durationEl.innerHTML = `<i class="fa-regular fa-clock"></i> Đã làm: ${esc(p.durationLabel)}`;

                    if (cardType === 'doing' || cardType === 'ready') {
                        const elCount = card.querySelector('.g5-card-count');
                        const countText = p.total > 0 ? `${p.answered}/${p.total} câu` : `${p.answered} câu đã làm`;
                        if (elCount && elCount.textContent !== countText) elCount.textContent = countText;

                        const elBar = card.querySelector('.g5-progress-fill');
                        if (elBar) {
                            const targetWidth = `${percent}%`;
                            if (elBar.style.width !== targetWidth) {
                                elBar.style.width = targetWidth;
                            }
                        }

                        const elPercent = card.querySelector('.g5-card-percent');
                        if (elPercent && elPercent.textContent !== `${percent}%`) elPercent.textContent = `${percent}%`;

                        const elScore = card.querySelector('.g5-card-score');
                        if (elScore) {
                            elScore.innerHTML = `Đúng: <b style="color:var(--emerald);">${p.correct}</b> • <span style="color:var(--red,#ef4444);">Sai: ${p.wrong}</span> (<b>${p.score10.toFixed(1)}/10 đ</b>)`;
                        }
                    }
                }
                const targetChild = container.children[index];
                if (targetChild !== card) {
                    container.insertBefore(card, targetChild || null);
                }
            }
        });
    }

    function renderStudentProgressDetail(p) {
        const modal = $('student-progress-modal');
        const body = $('student-progress-modal-body');
        if (!modal || !body || !p) return;
        const status = getProgressCardStatus(p);
        const rawQuestionCount = Number(p.total || 0);
        const subjectQuestions = state.questions.filter((question) => subjectMatchKey(subjectName(question.subject_key)) === subjectMatchKey(p.subject));
        const questionRows = subjectQuestions.slice(0, rawQuestionCount || subjectQuestions.length).map((question, index) => `<li><span>Câu ${index + 1}</span><strong>${esc(notationText(question.question).slice(0, 150))}</strong><em>Chưa có dữ liệu đáp án trong phiên theo dõi</em></li>`).join('');
        body.innerHTML = `<div class="student-detail-summary"><div><span class="student-detail-avatar"><i class="fa-solid fa-user-graduate"></i></span><div><h3>${esc(p.name)}</h3><p>${esc(p.subject)} · Lớp ${esc(p.grade)} · ${esc(status.label)}</p></div></div><span class="student-detail-score">${p.score10.toFixed(1)}<small>/10</small></span></div><div class="student-detail-metrics"><span><b>Tiến độ</b>${p.answered}/${p.total || '—'} câu (${p.percent}%)</span><span><b>Thời gian thực tế</b>${esc(p.durationLabel)}</span><span><b>Đúng / Sai</b>${p.correct} / ${p.wrong}</span><span><b>Hoạt động cuối</b>${esc(formatTimeAgo(p.lastActive))}</span></div><section class="student-detail-section"><h4><i class="fa-solid fa-list-check"></i> Danh sách từng câu hỏi</h4>${questionRows ? `<ul class="student-detail-questions">${questionRows}</ul>` : '<div class="student-detail-empty"><i class="fa-solid fa-database"></i><p>Phiên hiện tại chỉ lưu tổng hợp tiến độ trên Cloud. Chưa có dữ liệu từng câu trả lời để đối chiếu đáp án đúng, đáp án học sinh chọn hoặc lịch sử thay đổi.</p></div>'}</section><details class="student-detail-raw"><summary>Dữ liệu trạng thái gốc</summary><pre>${esc(`${p.rawStatus}\n${p.rawScore}`)}</pre></details>`;
        $('student-progress-modal-title').textContent = `Tiến trình của ${p.name}`;
        $('student-progress-modal-subtitle').textContent = `${p.subject} · Cập nhật ${formatTimeAgo(p.lastActive)}`;
        modal.classList.remove('hidden');
        document.body.classList.add('progress-modal-open');
    }

    function closeStudentProgressDetail() {
        $('student-progress-modal')?.classList.add('hidden');
        document.body.classList.remove('progress-modal-open');
    }

    async function broadcastNotice() {
        const message = $('notice-input')?.value.trim();
        if (!message) return notify('Nhập nội dung thông báo.', true);
        const result = await window.dbService.sendBroadcastNotice(message, 'ALL', '');
        if (!result?.success) return notify(`Không thể phát thông báo: ${result?.error || 'Lỗi không xác định'}`, true);
        if ($('notice-input')) $('notice-input').value = '';
        addActivityLog('Phát thông báo toàn phòng', message, 'broadcast');
        notify('Đã phát thông báo tới toàn bộ học sinh.');
    }
    async function sendPrivateNotice(ip, name = 'Học sinh') {
        const targetIp = String(ip || '').trim();
        const cleanName = String(name || 'Học sinh').trim();
        if ((!targetIp || targetIp === 'Chưa xác định' || targetIp === '—') && !cleanName) {
            return notify('Không xác định được học sinh nhận thông báo.', true);
        }
        const message = await promptDialog({
            title: `Thông báo riêng cho ${cleanName}`,
            eyebrow: 'PRIVATE NOTICE',
            message: `Tin nhắn sẽ bật nổi bật trên màn hình của ${cleanName}${targetIp ? ` (IP: ${targetIp})` : ''}.`,
            placeholder: 'Nhập nội dung nhắc nhở...',
            confirmText: 'Gửi thông báo',
            variant: 'primary',
            icon: 'fa-paper-plane'
        });
        if (message === null || !message.trim()) return;
        const cleanMsg = message.trim();
        const result = await window.dbService.sendBroadcastNotice(cleanMsg, targetIp || 'ALL', cleanName);
        if (!result?.success) return notify(`Không thể gửi thông báo riêng: ${result?.error || 'Lỗi không xác định'}`, true);
        addActivityLog(`Gửi thông báo riêng (${cleanName})`, cleanMsg, 'broadcast');
        notify(`Đã gửi thông báo riêng tới ${cleanName}.`);
    }
    async function clearStudentLogins() {
        if (!(await confirmDialog({ title: 'Xóa lịch sử học sinh?', message: 'Xóa toàn bộ lịch sử phiên đăng nhập và địa chỉ IP của học sinh? Cấu hình hệ thống sẽ được giữ lại.', confirmText: 'Xóa lịch sử', variant: 'danger' }))) return;
        state.isClearingStudents = true;
        try {
            const systemIds = Object.values(SYSTEM);
            const { data, error: selectError } = await state.client.from('quiz_logins').select('id, player_name, ip_address, status');
            if (selectError) throw new Error(`Không thể đọc lịch sử đăng nhập: ${selectError.message}`);
            const ids = (data || []).filter((row) => {
                const playerName = String(row.player_name || '').trim();
                const isBanned = String(row.status || '').startsWith('BANNED') || playerName === '__BANNED_IP__';
                return !systemIds.includes(row.id) && !isBanned && !playerName.startsWith('__');
            }).map((row) => row.id).filter(Boolean);
            if (ids.length) {
                const { error } = await state.client.from('quiz_logins').delete().in('id', ids);
                if (error) throw new Error(`Không thể xóa lịch sử học sinh: ${error.message}`);
                const { data: remaining, error: verifyError } = await state.client.from('quiz_logins').select('id').in('id', ids);
                if (verifyError) throw new Error(`Không thể xác minh dữ liệu sau khi xóa: ${verifyError.message}`);
                if ((remaining || []).length) throw new Error(`Còn ${(remaining || []).length}/${ids.length} bản ghi chưa xóa.`);
            }
            try { localStorage.removeItem('quiz_local_logins_history'); } catch (e) {}
            state.studentPulseMap?.clear();
            state.lastStudentsBodyHtml = '';
            state.lastMonitorStatsHtml = '';
            notify('Đã xóa sạch toàn bộ lịch sử phiên truy cập học sinh.');
        } finally {
            state.isClearingStudents = false;
            await loadStudents();
        }
    }
    async function deleteStudentSession(name, ip, device = '', loginId = '', alreadyConfirmed = false) {
        const cleanName = String(name || '').trim();
        const cleanIp = String(ip || '').trim();
        const cleanDev = String(device || '').trim();
        const cleanLoginId = String(loginId || '').trim();
        const systemIds = Object.values(SYSTEM);
        let lookup = state.client.from('quiz_logins').select('id, player_name, ip_address, device_info');
        if (cleanLoginId) lookup = lookup.eq('id', cleanLoginId);
        const { data, error: selectError } = await lookup;
        if (selectError) return notify(`Không thể xóa phiên: ${selectError.message}`, true);
        const candidateRows = (data || []).filter((row) => !systemIds.includes(row.id) && !String(row.player_name || '').startsWith('__'));
        const ids = cleanLoginId
            ? candidateRows.filter((row) => String(row.id) === cleanLoginId).map((row) => row.id).filter(Boolean)
            : (data || []).filter((row) => {
            if (systemIds.includes(row.id) || String(row.player_name || '').startsWith('__')) return false;
            const rowName = String(row.player_name || '').trim().toLowerCase();
            const rowIp = String(row.ip_address || '').trim();
            const rowDev = String(row.device_info || '').trim();
            if (cleanName && cleanName.toLowerCase() !== 'khách truy cập') {
                // Xóa toàn bộ dữ liệu của đúng tên, không giới hạn theo thiết bị.
                // Một học sinh có thể tạo nhiều phiên/thiết bị và tất cả phải biến mất.
                return rowName === cleanName.toLowerCase();
            }
            if (cleanIp && rowIp === cleanIp) {
                return !cleanDev || rowDev === cleanDev;
            }
            return false;
        }).map((row) => row.id).filter(Boolean);
        if (!ids.length) return notify('Không tìm thấy phiên phù hợp để xóa.', true);
        if (!alreadyConfirmed && !(await confirmDialog({ title: 'Xóa toàn bộ thông tin học sinh?', message: cleanLoginId ? `Xóa thông tin phiên đang hiển thị của ${cleanName || cleanIp} khỏi bảng theo dõi?\n\nQuyền truy cập, token và dữ liệu câu hỏi không bị ảnh hưởng.` : `Xóa toàn bộ ${ids.length} bản ghi của ${cleanName || cleanIp} khỏi bảng theo dõi?\n\nTất cả phiên mang tên này sẽ bị xóa. Quyền truy cập, token và dữ liệu câu hỏi không bị ảnh hưởng.`, confirmText: 'Xóa toàn bộ', variant: 'danger' }))) return;
        if (ids.length) {
            // Xóa theo lô nhỏ để URL query của Supabase không vượt giới hạn khi
            // một học sinh có nhiều phiên cũ trùng tên.
            const chunkSize = 50;
            for (let offset = 0; offset < ids.length; offset += chunkSize) {
                const chunk = ids.slice(offset, offset + chunkSize);
                const { error } = await state.client.from('quiz_logins').delete().in('id', chunk);
                if (error) return notify(`Không thể xóa phiên: ${error.message}`, true);
                const { data: remaining, error: verifyError } = await state.client.from('quiz_logins').select('id').in('id', chunk);
                if (verifyError) return notify(`Không thể xác minh sau khi xóa: ${verifyError.message}`, true);
                if ((remaining || []).length) return notify(`Còn ${(remaining || []).length}/${chunk.length} bản ghi chưa xóa.`, true);
            }
        }
        // Xóa bản ghi cục bộ cùng tên để dữ liệu không quay lại khi tải fallback.
        try {
            const localKey = 'quiz_local_logins_history';
            const localRows = JSON.parse(localStorage.getItem(localKey) || '[]');
            const filteredLocal = cleanName && cleanName.toLowerCase() !== 'khách truy cập'
                ? localRows.filter((row) => String(row.player_name || '').trim().toLowerCase() !== cleanName.toLowerCase())
                : localRows.filter((row) => String(row.ip_address || '').trim() !== cleanIp);
            localStorage.setItem(localKey, JSON.stringify(filteredLocal));
        } catch (e) { /* Local cache is optional. */ }
        state.lastStudentsHtml = '';
        state.lastStudentsBodyHtml = '';
        notify(`Đã xóa phiên của ${cleanName || cleanIp}.`);
        await loadStudents();
        await renderGrade5ProgressMonitor();
    }
    async function banIp(ip, reason = '') { if (!ip) return; const cleanIp = String(ip).trim(); const cleanReason = reason || 'Vi phạm quy chế ôn tập'; const now = new Date().toISOString(); const { data: updated, error: updateError } = await state.client.from('quiz_logins').update({ status: `BANNED: ${cleanReason}`, score_summary: cleanReason, last_active: now }).eq('ip_address', cleanIp).select(); if (updateError) return notify(updateError.message, true); if (!updated?.length) { const { error } = await state.client.from('quiz_logins').insert({ id: crypto.randomUUID(), player_name: '__BANNED_IP__', ip_address: cleanIp, device_info: 'Manual Ban', status: `BANNED: ${cleanReason}`, score_summary: cleanReason, last_active: now }); if (error) return notify(error.message, true); } if ($('ban-ip-input')) $('ban-ip-input').value = ''; if ($('ban-reason-input')) $('ban-reason-input').value = ''; state.lastStudentsBodyHtml = ''; state.lastBannedListHtml = ''; state.lastMonitorStatsHtml = ''; notify(`Đã chặn IP ${cleanIp}.`); await loadStudents(); }
    async function unbanIp(ip) { const cleanIp = String(ip || '').trim(); if (!cleanIp) return; const { error } = await state.client.from('quiz_logins').delete().eq('player_name', '__BANNED_IP__').eq('ip_address', cleanIp); if (error) return notify(error.message, true); await state.client.from('quiz_logins').update({ status: 'Đang ôn tập', last_active: new Date().toISOString() }).eq('ip_address', cleanIp).like('status', 'BANNED%'); state.lastStudentsBodyHtml = ''; state.lastBannedListHtml = ''; state.lastMonitorStatsHtml = ''; notify(`Đã mở khóa IP ${cleanIp}.`); await loadStudents(); }

    function exportJson(name, payload) { const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click(); URL.revokeObjectURL(link.href); }
    function exportBackup() { exportJson(`quiz-studio-backup-${new Date().toISOString().slice(0, 10)}.json`, { exportedAt: new Date().toISOString(), questions: state.questions, adminConfig: state.adminConfig, aiIps: state.aiIps, geo: state.geo, maintenance: state.maintenance }); notify('Đã tải file backup JSON.'); }
    function exportExcel() { if (!window.XLSX) return exportJson('quiz-questions.json', state.questions); const rows = state.questions.map((q) => ({ ID: q.id, Mon: subjectName(q.subject_key), Loai: TYPE_LABELS[q.qType], CauHoi: q.question, DapAn: q.qType === 'mcq' ? 'ABCD'[q.correct] : q.qType === 'short_answer' ? q.correctValue : q.statements.map((s) => `${s.key}:${s.answer ? 'Đúng' : 'Sai'}`).join(', '), GiaiThich: q.explanation })); const book = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(book, window.XLSX.utils.json_to_sheet(rows), 'Questions'); window.XLSX.writeFile(book, `quiz-questions-${new Date().toISOString().slice(0, 10)}.xlsx`); notify('Đã xuất bảng câu hỏi Excel.'); }

    const reportNumber = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits).replace('.', ',') : '—';
    const reportDate = (value) => {
        const date = value ? new Date(value) : null;
        return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('vi-VN') : '—';
    };
    const reportRowsFromData = (data) => {
        const systemIds = new Set(Object.values(SYSTEM));
        return (data || []).filter((row) => {
            const name = String(row.player_name || '').trim();
            return !systemIds.has(row.id) && !name.startsWith('__') && !/^banned/i.test(String(row.status || ''));
        }).map((row) => {
            const status = String(row.status || '');
            const summary = String(row.score_summary || '');
            const combined = `${status} ${summary}`;
            const ratio = summary.match(/(?:đúng|hoàn thành|kết quả)\s*(\d+)\s*\/\s*(\d+)/i) || (/(?:đã nộp bài|hoàn thành)/i.test(status) ? combined.match(/(\d+)\s*\/\s*(\d+)\s*(?:câu|ý)?/i) : null);
            const scoreMatch = summary.match(/(\d+(?:[.,]\d+)?)\s*điểm/i);
            const scoreRaw = scoreMatch ? Number(scoreMatch[1].replace(',', '.')) : null;
            const correct = ratio ? Number(ratio[1]) : null;
            const total = ratio ? Number(ratio[2]) : null;
            // App lưu `điểm` theo phần trăm 0–100. Chuẩn hóa một lần về /10;
            // không suy đoán số <= 10 là đã ở thang /10 vì 10% phải là 1/10.
            const score10 = Number.isFinite(scoreRaw) ? (scoreRaw / 10) : (correct !== null && total > 0 ? (correct / total) * 10 : null);
            const completed = /đã nộp bài|hoàn thành/i.test(combined) || Number.isFinite(scoreRaw) || Boolean(summary.match(/đúng\s*\d+\s*\/\s*\d+/i));
            const subjectMatch = status.match(/^\[(.*?)\]/) || summary.match(/^\[(.*?)\]/);
            const subject = subjectMatch ? subjectMatch[1].trim() : 'Chưa xác định';
            return { ...row, name: String(row.player_name || 'Học sinh').trim() || 'Học sinh', subject, score10: Number.isFinite(score10) ? Math.max(0, Math.min(10, score10)) : null, correct, total, completed, submittedAt: row.last_active || row.created_at || '' };
        }).filter((row) => row.completed && Number.isFinite(row.score10));
    };
    const setActionBusy = (id, busy, label) => {
        const button = $(id);
        if (!button) return;
        if (busy) {
            button.dataset.reportLabel = button.innerHTML;
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
    function renderReportSummary(rows) {
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
        const completed = denominatorRows.filter((row) => row.correct >= row.total).length;
        const omissions = denominatorRows.map((row) => row.total - row.correct).filter((value) => value >= 0);
        const explicitOmissions = (Array.isArray(state.reportAllRows) ? state.reportAllRows : []).map((row) => {
            const match = `${row.status || ''} ${row.score_summary || ''}`.match(/(?:bỏ sót|chưa\s+(?:trả lời|làm)|còn)\s*(\d+)/i);
            return match ? Number(match[1]) : null;
        }).filter((value) => Number.isFinite(value));
        if (!omissions.length && explicitOmissions.length) omissions.push(...explicitOmissions);
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
        content.innerHTML = rows.length ? `<div class="table-wrap"><table class="data-table leaderboard-table"><thead><tr><th>Hạng</th><th>Học sinh</th><th>Môn</th><th>Điểm</th><th>Đúng / tổng</th><th>Ngày nộp</th></tr></thead><tbody>${rows.map((row, index) => `<tr><td><span class="rank-badge rank-${(start + index) + 1}">#${(start + index) + 1}</span></td><td><strong>${esc(row.name)}</strong></td><td>${esc(row.subject)}</td><td><strong class="leader-score">${reportNumber(row.score10)} /10</strong></td><td>${row.correct !== null && row.total ? `${row.correct}/${row.total} (${Math.round((row.correct / row.total) * 100)}%)` : 'Không có dữ liệu'}</td><td>${esc(reportDate(row.submittedAt))}</td></tr>`).join('')}</tbody></table></div><div class="leaderboard-pagination"><button class="button secondary" ${state.reportLeaderboardPage <= 1 ? 'disabled' : ''} data-report-page="prev">Trang trước</button><span>Trang ${state.reportLeaderboardPage}/${pageCount}</span><button class="button secondary" ${state.reportLeaderboardPage >= pageCount ? 'disabled' : ''} data-report-page="next">Trang sau</button></div>` : '';
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
        const systemIds = new Set(Object.values(SYSTEM));
        state.reportAllRows = data.filter((row) => !systemIds.has(row.id) && !String(row.player_name || '').startsWith('__') && !/^banned/i.test(String(row.status || '')));
        return reportRowsFromData(data);
    }
    async function fetchAllLoginRows() {
        if (!state.client) throw new Error('Chưa kết nối Supabase.');
        const pageSize = 500;
        const rows = [];
        for (let offset = 0; ; offset += pageSize) {
            const { data, error } = await state.client.from('quiz_logins').select('*').order('created_at', { ascending: true }).range(offset, offset + pageSize - 1);
            if (error) throw error;
            rows.push(...(data || []));
            if (!data || data.length < pageSize) break;
        }
        return rows;
    }
    async function archiveExamData() {
        if (!(await confirmDialog({ title: 'Sao lưu & Dọn lịch sử kỳ thi?', message: 'Hệ thống sẽ tự động tải về bản Backup JSON trước khi xóa toàn bộ lịch sử làm bài của học sinh.', confirmText: 'Sao lưu & Dọn dẹp', variant: 'danger', icon: 'fa-broom' }))) return;
        const data = await fetchAllLoginRows();
        const systemIds = new Set(Object.values(SYSTEM));
        const records = data.filter((row) => !systemIds.has(row.id) && !String(row.player_name || '').startsWith('__'));
        exportJson(`exam-archive-${new Date().toISOString().slice(0, 10)}.json`, { schemaVersion: 1, archivedAt: new Date().toISOString(), recordCount: records.length, records });
        const ids = records.map((row) => row.id).filter(Boolean);
        let deleted = 0;
        for (let offset = 0; offset < ids.length; offset += 100) {
            const batch = ids.slice(offset, offset + 100);
            const { data: removed, error } = await state.client.from('quiz_logins').delete().in('id', batch).select('id');
            if (error) throw new Error(`Không thể dọn lịch sử kỳ thi: ${error.message}`);
            deleted += (removed || []).length;
        }
        if (deleted !== ids.length) throw new Error(`Chỉ xóa được ${deleted}/${ids.length} bản ghi; đã giữ lại backup để kiểm tra.`);
        state.studentPulseMap.clear(); state.lastStudentsBodyHtml = ''; notify(`Đã backup và dọn ${deleted} bản ghi lịch sử kỳ thi.`); await loadStudents();
    }
    async function loadScoreReport() {
        if (state.reportLoading) return;
        state.reportLoading = true;
        setActionBusy('refresh-score-report', true, 'Đang tải');
        setReportState('loading');
        try {
            state.reportRows = await fetchReportRows();
            populateLeaderboardSubjects();
            if (!state.reportRows.length) {
                setReportState('empty');
                $('leaderboard-content').innerHTML = '';
                $('leaderboard-summary').textContent = 'Chưa có dữ liệu hợp lệ.';
            } else {
                renderReportSummary(state.reportRows);
                renderLeaderboard();
            }
            if ($('report-last-updated')) $('report-last-updated').textContent = `Cập nhật ${new Date().toLocaleTimeString('vi-VN')}`;
        } catch (error) {
            state.reportRows = null;
            setReportState('error', error?.message || 'Không thể tải dữ liệu báo cáo.');
            $('leaderboard-content').innerHTML = '';
            $('leaderboard-summary').textContent = 'Không thể tải bảng xếp hạng.';
        } finally {
            state.reportLoading = false;
            setActionBusy('refresh-score-report', false);
        }
    }
    async function loadLeaderboard() {
        if (!state.reportRows) await loadScoreReport();
        if (!state.reportRows) return;
        setActionBusy('load-leaderboard', true, 'Đang tải');
        $('leaderboard-loading')?.classList.remove('hidden');
        $('leaderboard-error')?.classList.add('hidden');
        $('leaderboard-empty')?.classList.add('hidden');
        try { renderLeaderboard(); } catch (error) { $('leaderboard-error')?.classList.remove('hidden'); $('leaderboard-error-text').textContent = error.message || 'Không thể tải bảng xếp hạng.'; }
        finally { $('leaderboard-loading')?.classList.add('hidden'); setActionBusy('load-leaderboard', false); }
    }
    function exportScoreReport() {
        if (!state.reportRows) return notify('Hãy tải báo cáo điểm trước khi xuất file.', true);
        const scores = state.reportRows.map((row) => row.score10);
        const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
        const ordered = [...scores].sort((a, b) => a - b);
        const median = ordered.length % 2 ? ordered[(ordered.length - 1) / 2] : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2;
        exportJson(`quiz-studio-score-report-${new Date().toISOString().slice(0, 10)}.json`, { exportedAt: new Date().toISOString(), scale: '/10', selectionRule: 'Lượt có điểm hoặc tỷ lệ đúng; không gộp lượt', summary: { validAttempts: scores.length, uniqueStudents: new Set(state.reportRows.map((row) => row.name.toLowerCase())).size, mean: Number(mean.toFixed(3)), median: Number(median.toFixed(3)) }, attempts: state.reportRows.map((row) => ({ student: row.name, subject: row.subject, score10: Number(row.score10.toFixed(3)), correct: row.correct, total: row.total, percentage: row.correct !== null && row.total ? Number(((row.correct / row.total) * 100).toFixed(2)) : null, submittedAt: row.submittedAt })) });
        notify('Đã tải báo cáo điểm JSON.');
    }
    function syncThemeIcon() {
        const isDark = document.body.classList.contains('dark');
        const toggle = $('theme-toggle');
        if (toggle) {
            toggle.innerHTML = `<i class="fa-solid ${isDark ? 'fa-sun' : 'fa-moon'}"></i>`;
            toggle.title = isDark ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối';
        }
    }

    function bindEvents() {
        if (state.bound) return; state.bound = true;
        mergeContentLibraryView();
        injectEditorControls();
        moveSubjectFormToDialog();
        document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
        document.querySelectorAll('[data-go-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.goView)));
        $('mobile-menu')?.addEventListener('click', () => $('sidebar')?.classList.toggle('is-open'));
        $('theme-toggle')?.addEventListener('click', () => {
            document.body.classList.toggle('dark');
            localStorage.setItem('quiz_admin_dark', document.body.classList.contains('dark') ? 'true' : 'false');
            syncThemeIcon();
        });
        $('copy-admin-ip')?.addEventListener('click', () => runAction(copyAdminIp));
        $('health-database-badge')?.addEventListener('click', () => runAction(recheckSystemHealth));
        $('health-content-badge')?.addEventListener('click', () => runAction(recheckSystemHealth));
        $('clear-activity-log')?.addEventListener('click', () => {
            state.activityLogs = [];
            try { localStorage.removeItem('quiz_admin_activity_logs'); } catch (e) {}
            renderRecentActivity();
            notify('Đã xóa lịch sử hoạt động gần đây.');
        });
        document.querySelectorAll('[data-metric-grade]').forEach((card) => {
            card.addEventListener('click', () => navigateToLibraryByGrade(card.dataset.metricGrade));
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigateToLibraryByGrade(card.dataset.metricGrade);
                }
            });
        });
        document.querySelectorAll('[data-metric-view]').forEach((card) => {
            const goMonitor = () => {
                switchView(card.dataset.metricView);
                requestAnimationFrame(() => {
                    $('students-body')?.closest('.panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            };
            card.addEventListener('click', goMonitor);
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    goMonitor();
                }
            });
        });
        window.addEventListener('offline', () => {
            setConnection(false, 'Mất kết nối');
            updateHealthStatus('db', 'danger', 'Mất kết nối', 'Thiết bị vừa mất kết nối mạng. Bấm để thử lại.');
        });
        window.addEventListener('online', () => {
            recheckSystemHealth();
        });
        $('refresh-button')?.addEventListener('click', () => runAction(recheckSystemHealth));
        $('delete-scope-button')?.addEventListener('click', openDeleteScopeModal);
        $('btn-delete-current-filter')?.addEventListener('click', () => runAction(deleteFilteredQuestions));
        $('btn-activate-selection-mode')?.addEventListener('click', () => {
            closeModal('delete-scope-modal');
            state.selectMode = true;
            updateBulkBar();
            notify('Đã bật chế độ chọn câu. Hãy tick chọn các ô trên câu hỏi muốn xóa.');
        });
        $('delete-all-confirm-input')?.addEventListener('input', (event) => {
            const isMatch = event.target.value.trim().toUpperCase() === 'XOA HET';
            const btn = $('btn-delete-all-guarded');
            if (btn) {
                btn.disabled = !isMatch;
                btn.classList.toggle('is-disabled', !isMatch);
            }
        });
        $('btn-delete-all-guarded')?.addEventListener('click', () => runAction(deleteAllQuestionsGuarded));
        $('bulk-select-all-checkbox')?.addEventListener('change', (event) => {
            const checked = event.target.checked;
            getFilteredQuestions().forEach((q) => {
                if (checked) state.selectedQuestionIds.add(String(q.id));
                else state.selectedQuestionIds.delete(String(q.id));
            });
            renderLibrary();
        });
        $('bulk-deselect-btn')?.addEventListener('click', () => {
            state.selectedQuestionIds.clear();
            state.selectMode = false;
            renderLibrary();
        });
        $('bulk-delete-btn')?.addEventListener('click', () => runAction(deleteSelectedQuestions));
        $('grade-select')?.addEventListener('change', (event) => { fillSubjects(event.target.value); renderPreview(); });
        $('question-type-select')?.addEventListener('change', (event) => ensureTypeEditor(event.target.value));
        $('question-form')?.addEventListener('input', (event) => {
            if (event.target.id === 'question-input' || event.target.id === 'category-input' || event.target.id === 'explanation-input' || event.target.id.startsWith('option-') || event.target.id.startsWith('tf-') || event.target.id === 'correct-value-input') renderPreview();
        });
        $('question-form')?.addEventListener('submit', saveQuestion);
        $('reset-form')?.addEventListener('click', resetForm); $('cancel-edit')?.addEventListener('click', resetForm); $('new-question-button')?.addEventListener('click', () => { resetForm(); switchView('questions'); });
        document.querySelectorAll('.answer-radio').forEach((button) => button.addEventListener('click', () => setAnswer(button.dataset.answer)));
        $('question-form')?.addEventListener('click', (event) => { const choice = event.target.closest('.tf-choice'); if (choice) setTfAnswer(choice.dataset.index, choice.dataset.value); });
        $('search-input')?.addEventListener('input', () => {
            state.page = 1;
            renderLibrary();
        });
        $('question-type-filter')?.addEventListener('change', (event) => {
            state.typeFilter = event.target.value;
            state.page = 1;
            renderLibrary();
        });
        $('library-subject-filter')?.addEventListener('change', (event) => {
            state.subject = event.target.value;
            state.page = 1;
            renderLibrary();
        });
        document.querySelectorAll('.grade-filter').forEach((button) => button.addEventListener('click', () => {
            document.querySelectorAll('.grade-filter').forEach((item) => item.classList.remove('is-active'));
            button.classList.add('is-active');
            state.grade = button.dataset.grade;
            state.subject = 'all';
            state.page = 1;
            fillLibrarySubjects();
            renderLibrary();
        }));
        $('library-subject-tabs')?.addEventListener('click', (event) => {
            const tab = event.target.closest('[data-subject-tab]');
            if (!tab) return;
            const key = tab.dataset.subjectTab;
            if (state.subject === key) return;
            state.subject = key;
            state.page = 1;
            if ($('library-subject-filter')) {
                $('library-subject-filter').value = key;
            }
            renderLibrary();
        });
        $('library-pagination')?.addEventListener('click', (event) => {
            const pageBtn = event.target.closest('.page-btn:not(:disabled)');
            if (!pageBtn) return;
            const targetPage = Number(pageBtn.dataset.page);
            if (!targetPage || isNaN(targetPage) || targetPage === state.page) return;
            state.page = targetPage;
            renderLibrary();
            $('content-library-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        $('library-pagination')?.addEventListener('change', (event) => {
            if (event.target.id === 'page-size-select') {
                const val = event.target.value;
                state.pageSize = val === 'all' ? 'all' : Number(val);
                state.page = 1;
                renderLibrary();
                $('content-library-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
        window.addEventListener('scroll', () => {
            const btn = $('back-to-top-btn');
            if (!btn) return;
            if (window.scrollY > 380) {
                btn.classList.remove('hidden');
            } else {
                btn.classList.add('hidden');
            }
        }, { passive: true });
        $('back-to-top-btn')?.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        $('questions-list')?.addEventListener('click', (event) => { const edit = event.target.closest('[data-edit]'); const remove = event.target.closest('[data-delete]'); if (edit) { const q = state.questions.find((item) => String(item.id) === String(edit.dataset.edit)); if (q) { fillForm(q); window.scrollTo({ top: 0, behavior: 'smooth' }); } } if (remove) deleteQuestion(remove.dataset.delete); });
        $('questions-list')?.addEventListener('change', (event) => {
            const checkbox = event.target.closest('.question-select-checkbox');
            if (checkbox) {
                const id = String(checkbox.dataset.selectId);
                if (checkbox.checked) state.selectedQuestionIds.add(id);
                else state.selectedQuestionIds.delete(id);
                const item = checkbox.closest('.question-item');
                if (item) item.classList.toggle('is-selected', checkbox.checked);
                updateBulkBar();
            }
        });
        $('export-pdf-heading')?.addEventListener('click', openPrintModal);
        $('export-pdf-library')?.addEventListener('click', openPrintModal);
         reportAction('export-pdf-report', () => { fillLibrarySubjects(); openPrintModal(); }, 'Đang mở');
        $('open-trash-button')?.addEventListener('click', () => { renderTrashModal(); openModal('trash-modal'); });
        $('trash-search-input')?.addEventListener('input', renderTrashModal);
        $('trash-subject-filter')?.addEventListener('change', renderTrashModal);
        $('trash-restore-all-btn')?.addEventListener('click', () => runAction(restoreAllTrash));
        $('trash-empty-btn')?.addEventListener('click', () => runAction(emptyTrash));
        $('trash-list')?.addEventListener('click', (event) => {
            const restore = event.target.closest('[data-restore-id]');
            const hardDelete = event.target.closest('[data-hard-delete-id]');
            if (restore) runAction(() => restoreQuestion(restore.dataset.restoreId));
            if (hardDelete) runAction(() => hardDeleteQuestion(hardDelete.dataset.hardDeleteId));
        });
        $('print-subject-select')?.addEventListener('change', updatePrintQuestionsPreview);
        $('print-grade-select')?.addEventListener('change', updatePrintQuestionsPreview);
        $('print-random-code')?.addEventListener('click', () => {
            const codes = [101, 102, 103, 104, 201, 202, 301, 302, 401, 402];
            const code = codes[Math.floor(Math.random() * codes.length)];
            if ($('print-code-input')) $('print-code-input').value = String(code);
        });
        const AI_EXTRACTION_PROMPT = `Bạn là hệ thống trích xuất dữ liệu đề thi và giải đáp án tự động chuẩn xác tuyệt đối.
Mỗi khi người dùng gửi bất kỳ tài liệu, hình ảnh hoặc văn bản đề thi nào, bạn PHẢI tự động phân tích toàn bộ câu hỏi và trả về DUY NHẤT một mảng JSON hợp lệ theo đúng cấu trúc quy định bên dưới.

==================================================
I. QUY TẮC CỐT LÕI (STRICT RULES - BẮT BUỘC TUÂN THỦ 100%)
==================================================
1. TUYỆT ĐỐI GIỮ NGUYÊN VĂN BẢN GỐC:
   - Không sửa chữa câu chữ, không tóm tắt, không viết lại bất kỳ từ nào trong đề bài, đoạn ngữ liệu và các phương án.
   - Giữ nguyên tuyệt đối mọi con số, đơn vị, ngày tháng, năm, thế kỷ, ký hiệu toán học/hóa học như trong file gốc.
   - Với các phương án trắc nghiệm và mệnh đề Đúng/Sai: chỉ bỏ ký hiệu tiền tố đầu dòng như "A. ", "B. ", "C. ", "D. ", "a. ", "a) ", "b. ", "b) "... để lấy trọn vẹn phần nội dung nguyên văn phía sau.

2. TUYỆT ĐỐI GIỮ NGUYÊN THỨ TỰ:
   - Không được đảo hoặc xáo trộn vị trí các đáp án A, B, C, D.
   - Không được đảo thứ tự các ý a, b, c, d trong câu hỏi Đúng/Sai.

3. XỬ LÝ ĐÁP ÁN & LỜI GIẢI:
   - Nếu cuối file tài liệu có sẵn bảng đáp án hoặc hướng dẫn giải: đối chiếu chính xác đáp án đó và trích xuất/diễn giải rõ ràng vào trường "explanation".
   - Nếu tài liệu chưa có đáp án: tự động tính toán, tra cứu kiến thức chuẩn xác để tìm đáp án đúng và viết lời giải chi tiết, ngắn gọn, dễ hiểu vào trường "explanation".

4. TỰ ĐỘNG NHẬN DIỆN CHUYÊN ĐỀ ("category"):
   - Dựa vào tiêu đề phần/bài học trong file hoặc nội dung câu hỏi để điền tên chủ đề/chuyên đề ngắn gọn (Ví dụ: "Số thập phân", "Cách mạng tư sản", "Hàm số",...).

5. ĐỊNH DẠNG ĐẦU RA TUYỆT ĐỐI:
   - CHỈ xuất ra mã JSON hợp lệ (bắt đầu bằng \`[\` và kết thúc bằng \`]\`).
   - KHÔNG viết lời chào, KHÔNG giải thích bên ngoài JSON, KHÔNG dùng dấu \`\`\`json hay \`\`\` bao quanh.
   - Escape đúng các ký tự đặc biệt (như dấu ngoặc kép \\" bên trong chuỗi văn bản) để không bao giờ bị lỗi cú pháp \`JSON.parse()\`.

==================================================
II. SCHEMA JSON CHUẨN CHO 3 LOẠI CÂU HỎI
==================================================

1. DẠNG 1: TRẮC NGHIỆM 4 LỰA CHỌN ("type": "mcq")
Áp dụng cho câu hỏi chọn 1 đáp án đúng trong 4 phương án A, B, C, D:
{
  "type": "mcq",
  "category": "Tên chuyên đề hoặc bài học",
  "question": "Giữ nguyên 100% câu chữ đề bài",
  "options": [
    "Nội dung nguyên văn phương án A",
    "Nội dung nguyên văn phương án B",
    "Nội dung nguyên văn phương án C",
    "Nội dung nguyên văn phương án D"
  ],
  "correct": 0,
  "correctAnswer": 0,
  "explanation": "Giải thích chi tiết vì sao chọn đáp án này"
}
*(Lưu ý: "correct" và "correctAnswer" phải có giá trị số nguyên giống hệt nhau: 0 = A, 1 = B, 2 = C, 3 = D).*

2. DẠNG 2: TRẮC NGHIỆM ĐÚNG / SAI ("type": "tf_group")
Áp dụng cho câu hỏi có đoạn thông tin/bảng số liệu/hình ảnh dẫn kèm 4 ý nhỏ a, b, c, d xét Đúng hoặc Sai:
{
  "type": "tf_group",
  "category": "Tên chuyên đề hoặc bài học",
  "question": "Giữ nguyên 100% câu dẫn và toàn bộ đoạn tư liệu/đề bài gốc",
  "statements": [
    { "key": "a", "text": "Nội dung nguyên văn ý a", "answer": true },
    { "key": "b", "text": "Nội dung nguyên văn ý b", "answer": false },
    { "key": "c", "text": "Nội dung nguyên văn ý c", "answer": true },
    { "key": "d", "text": "Nội dung nguyên văn ý d", "answer": false }
  ],
  "subQuestions": [
    { "id": "a", "content": "Nội dung nguyên văn ý a", "correctAnswer": true },
    { "id": "b", "content": "Nội dung nguyên văn ý b", "correctAnswer": false },
    { "id": "c", "content": "Nội dung nguyên văn ý c", "correctAnswer": true },
    { "id": "d", "content": "Nội dung nguyên văn ý d", "correctAnswer": false }
  ],
  "explanation": "Giải thích cụ thể lý do Đúng/Sai cho từng ý a, b, c, d"
}
*(Lưu ý: Luôn xuất đồng thời cả hai mảng "statements" và "subQuestions" với nội dung và giá trị boolean true/false đồng bộ 100% nhau).*

3. DẠNG 3: TRẢ LỜI NGẮN ("type": "short_answer")
Áp dụng cho câu hỏi điền khuyết, tính toán ra kết quả số hoặc từ khóa ngắn:
{
  "type": "short_answer",
  "category": "Tên chuyên đề hoặc bài học",
  "question": "Giữ nguyên 100% nội dung câu hỏi gốc",
  "correctAnswer": "Giá trị số hoặc từ khóa chính xác",
  "correctValue": "Giá trị số hoặc từ khóa chính xác",
  "explanation": "Các bước tính toán hoặc căn cứ ra đáp án"
}
*(Lưu ý: "correctAnswer" và "correctValue" luôn là kiểu chuỗi string và giống hệt nhau).*

Bây giờ, hãy đọc tài liệu/nội dung được cung cấp và xuất ngay mảng JSON hoàn chỉnh.`;

        const handleCopyAiPrompt = async (btn) => {
            const success = await copyToClipboard(AI_EXTRACTION_PROMPT);
            if (success) {
                notify('Đã sao chép Prompt AI trích xuất đề thi vào bộ nhớ tạm!');
                if (btn) {
                    const prevHtml = btn.innerHTML;
                    btn.innerHTML = '<i class="fa-solid fa-check" style="color: var(--green);"></i> Đã sao chép!';
                    setTimeout(() => { btn.innerHTML = prevHtml; }, 2000);
                }
            } else {
                notify('Không thể tự động sao chép prompt, vui lòng thử lại.', true);
            }
        };

        $('copy-ai-prompt-btn')?.addEventListener('click', (e) => handleCopyAiPrompt(e.currentTarget));
        $('modal-copy-ai-prompt-btn')?.addEventListener('click', (e) => handleCopyAiPrompt(e.currentTarget));
        $('do-print-btn')?.addEventListener('click', () => runAction(executePrintExam));
         $('import-button')?.addEventListener('click', openImport); $('quick-import')?.addEventListener('click', openImport); $('import-subject-select')?.addEventListener('change', (event) => { state.importSubject = String(event.target.value || '').trim(); persistImportDraft(); console.debug('[Quiz Studio Admin] Import target subject changed:', state.importSubject); }); $('parse-import')?.addEventListener('click', () => { const source = $('import-text')?.value || ''; const list = parseJsonInput(source); if (!list.length) return notify(state.importError || 'JSON chưa hợp lệ hoặc thiếu cấu trúc MCQ/Đúng-Sai/Trả lời ngắn.', true); state.importQuestions = list; state.importError = ''; state.importIndex = 0; state.importIntegrity = validateVerbatimQuestions(list, source); persistImportDraft(); fillForm(list[0]); renderImportReview(); notify(`Đã đọc ${list.length} câu từ JSON.`); }); $('save-import')?.addEventListener('click', saveImportQuestions);
         $('import-file')?.addEventListener('change', (event) => handleImportFile(event.target.files?.[0]));
        $('import-preview')?.addEventListener('click', (event) => { const index = event.target.closest('[data-import-index]'); const prev = event.target.closest('[data-import-prev]'); const next = event.target.closest('[data-import-next]'); if (index) { state.importIndex = Number(index.dataset.importIndex); fillForm(state.importQuestions[state.importIndex]); } if (prev && state.importIndex > 0) { state.importIndex -= 1; fillForm(state.importQuestions[state.importIndex]); } if (next && state.importIndex < state.importQuestions.length - 1) { state.importIndex += 1; fillForm(state.importQuestions[state.importIndex]); } renderImportReview(); });
        document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
        $('maintenance-toggle')?.addEventListener('change', () => runAction(() => toggleMaintenance()));
        const openEditMaintenancePrompt = async () => {
            const currentMsg = (state.maintenance.message && state.maintenance.message !== 'Website đang mở công khai cho học sinh.' && state.maintenance.message !== 'Website đang mở.')
                ? state.maintenance.message
                : 'Trang web đang tạm dừng để cập nhật. Vui lòng quay lại sau!';
            const message = await promptDialog({
                title: 'Đổi lời nhắn bảo trì',
                eyebrow: 'MAINTENANCE MESSAGE',
                message: 'Nhập nội dung hiển thị cho học sinh khi hệ thống tạm khóa:',
                defaultValue: currentMsg,
                confirmText: 'Lưu lời nhắn',
                variant: 'primary',
                icon: 'fa-screwdriver-wrench'
            });
            if (message !== null && message.trim()) {
                state.maintenance.message = message.trim();
                runAction(() => toggleMaintenance('Cập nhật lời nhắn bảo trì'));
            }
        };
        $('edit-maintenance')?.addEventListener('click', openEditMaintenancePrompt);
        $('maintenance-preview-box')?.addEventListener('click', openEditMaintenancePrompt);
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
            if (notice && $('notice-input')) { $('notice-input').value = notice.dataset.notice; runAction(broadcastNotice); }
        });
        $('send-notice')?.addEventListener('click', () => runAction(broadcastNotice));
        $('notice-input')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); runAction(broadcastNotice); } });
        $('ban-ip-button')?.addEventListener('click', () => runAction(() => banIp($('ban-ip-input').value.trim(), $('ban-reason-input').value.trim())));
          $('refresh-students')?.addEventListener('click', () => runAction(() => { state.lastStudentsBodyHtml = ''; return loadStudents(); }));
        $('refresh-progress')?.addEventListener('click', () => runAction(renderGrade5ProgressMonitor));
          $('grade5-progress-cards')?.addEventListener('click', (event) => {
              const button = event.target.closest('[data-delete-progress-id]');
              if (button) {
                  event.preventDefault();
                  event.stopPropagation();
                  const studentName = button.dataset.deleteProgressName || button.dataset.deleteProgressIp || 'học sinh này';
                  const confirmed = window.confirm(`Xóa thông tin của ${studentName} khỏi bảng theo dõi?\n\nChỉ xóa phiên hiển thị trong bảng. Quyền truy cập, token và dữ liệu câu hỏi không bị ảnh hưởng.`);
                  if (confirmed) runAction(() => deleteStudentSession(button.dataset.deleteProgressName, button.dataset.deleteProgressIp, button.dataset.deleteProgressDevice, '', true));
                  return;
              }
              const card = event.target.closest('[data-student-id]');
              if (card) {
                  const record = state.progressRecords.find((item) => String(item.id) === String(card.dataset.studentId));
                  if (record) renderStudentProgressDetail(record);
              }
          });
          $('btn-add-quick-observer')?.addEventListener('click', () => runAction(addQuickObserver));
         $('quick-observer-ip')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runAction(addQuickObserver); } });
         $('quick-observer-name')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runAction(addQuickObserver); } });
          document.querySelectorAll('[data-progress-grade]').forEach(btn => {
             btn.addEventListener('click', () => {
                  state.progressFilter = btn.dataset.progressGrade;
                  state.progressSubject = 'all';
                  document.querySelectorAll('[data-progress-grade]').forEach(b => b.classList.toggle('is-active', b === btn));
                  $('view-title') && ($('view-title').textContent = getProgressFilterTitle());
                  runAction(renderGrade5ProgressMonitor);
             });
          });
          $('progress-subject-filter')?.addEventListener('change', (event) => {
              state.progressSubject = event.target.value || 'all';
              $('view-title') && ($('view-title').textContent = getProgressFilterTitle());
              runAction(renderGrade5ProgressMonitor);
          });
          $('progress-search')?.addEventListener('input', (event) => {
              state.progressSearch = event.target.value || '';
              runAction(renderGrade5ProgressMonitor);
          });
          $('progress-sort')?.addEventListener('change', (event) => {
              state.progressSort = event.target.value || 'recent';
              runAction(renderGrade5ProgressMonitor);
          });
          $('student-progress-modal-close')?.addEventListener('click', closeStudentProgressDetail);
          $('student-progress-modal')?.addEventListener('click', (event) => { if (event.target.id === 'student-progress-modal') closeStudentProgressDetail(); });
          window.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeStudentProgressDetail(); });
         $('copy-parent-link-head')?.addEventListener('click', () => {
             const parentItem = (state.tokens || []).find(t => t.role === 'parent' || t.role === 'observer_grade5' || t.role === 'observer');
             const token = parentItem ? parentItem.token : '';
             const origin = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
                 ? (window.location.origin.startsWith('http') ? window.location.origin : 'https://quiz-web-app-rosy.vercel.app')
                 : window.location.origin;
             const link = token ? `${origin}/?token=${encodeURIComponent(token)}&view=progress` : `${origin}/?view=progress`;
             try {
                 navigator.clipboard.writeText(link);
                 notify('📋 Đã sao chép Link Theo Dõi! Người giám sát chỉ cần bấm link để xem tiến trình học.');
             } catch (e) {
                 prompt('Sao chép đường dẫn gửi người theo dõi:', link);
             }
         });
         $('clear-logins')?.addEventListener('click', () => runAction(clearStudentLogins));
         $('btn-create-token')?.addEventListener('click', () => runAction(addTokenFromForm));
         $('btn-grant-student-access')?.addEventListener('click', () => runAction(grantStudentAccess));
         $('btn-fill-current-ip')?.addEventListener('click', () => {
             if ($('student-access-ip')) {
                 $('student-access-ip').value = state.clientIp || '';
                 notify('Đã lấy IP thiết bị này: ' + (state.clientIp || ''));
             }
         });
         document.addEventListener('click', (event) => {
             const copyAdminLinkBtn = event.target.closest('[data-copy-admin-link]');
             if (copyAdminLinkBtn) {
                 const token = copyAdminLinkBtn.dataset.copyAdminLink;
                 const origin = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
                     ? (window.location.origin.startsWith('http') ? window.location.origin : 'https://quiz-web-app-rosy.vercel.app')
                     : window.location.origin;
                 const link = `${origin}/admin.html?token=${encodeURIComponent(token)}`;
                 try {
                     navigator.clipboard.writeText(link).then(() => {
                         notify('👑 Đã sao chép Link Admin trực tiếp! Thiết bị mở link này sẽ vào thẳng Admin mà không cần IP cố định.');
                     });
                 } catch (e) {
                     prompt('Sao chép đường dẫn Admin:', link);
                 }
                 return;
             }
             const copyLinkBtn = event.target.closest('[data-copy-token-link]');
             if (copyLinkBtn) {
                 copyActivationLink(copyLinkBtn.dataset.copyTokenLink, copyLinkBtn.dataset.tokenName);
                 return;
             }
             const copyCodeBtn = event.target.closest('[data-copy-token-code]');
             if (copyCodeBtn) {
                 copyToClipboard(copyCodeBtn.dataset.copyTokenCode).then(() => notify('Đã copy mã token ' + copyCodeBtn.dataset.copyTokenCode));
                 return;
             }
             const toggleAiBtn = event.target.closest('[data-toggle-ai]');
             if (toggleAiBtn) {
                 runAction(() => toggleStudentAi(toggleAiBtn.dataset.toggleAi));
                 return;
             }
             const toggleG5Btn = event.target.closest('[data-toggle-grade5]');
             if (toggleG5Btn) {
                 runAction(() => toggleStudentGrade5(toggleG5Btn.dataset.toggleGrade5));
                 return;
             }
             const revokeG5Btn = event.target.closest('[data-revoke-grade5]');
             if (revokeG5Btn) {
                 runAction(() => revokeStudentGrade5(revokeG5Btn.dataset.revokeGrade5));
                 return;
             }
             const revokeAiBtn = event.target.closest('[data-revoke-ai]');
             if (revokeAiBtn) {
                 runAction(() => revokeStudentAi(revokeAiBtn.dataset.revokeAi));
                 return;
             }
             const copyParentLinkBtn = event.target.closest('[data-copy-parent-link]');
             if (copyParentLinkBtn) {
                 const token = copyParentLinkBtn.dataset.copyParentLink;
                 const origin = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
                     ? (window.location.origin.startsWith('http') ? window.location.origin : 'https://quiz-web-app-rosy.vercel.app')
                     : window.location.origin;
                 const link = `${origin}/?token=${encodeURIComponent(token)}&view=progress`;
                 try {
                     navigator.clipboard.writeText(link).then(() => {
                         notify('📋 Đã sao chép Link Quan Sát! Người giám sát chỉ cần bấm link trên điện thoại hoặc máy tính.');
                     });
                 } catch (e) {
                     prompt('Sao chép đường dẫn gửi người theo dõi:', link);
                 }
                 return;
             }
             const revokeParentBtn = event.target.closest('[data-revoke-parent]');
             if (revokeParentBtn) {
                 runAction(() => removeStudentAccess(revokeParentBtn.dataset.revokeParent));
                 return;
             }
             const removeUnifiedBtn = event.target.closest('[data-remove-unified-access]');
             if (removeUnifiedBtn) {
                 runAction(() => removeStudentAccess(removeUnifiedBtn.dataset.removeUnifiedAccess));
                 return;
             }
             const removeTokenBtn = event.target.closest('[data-remove-token]');
             if (removeTokenBtn) {
                 runAction(() => removeAccessToken(removeTokenBtn.dataset.removeToken));
                 return;
             }
             const grantTokenBtn = event.target.closest('#students-body [data-grant-token-name]');
             if (grantTokenBtn) {
                 runAction(() => handleGrantTokenToStudent(grantTokenBtn.dataset.grantTokenName, grantTokenBtn.dataset.grantTokenIp, grantTokenBtn.dataset.grantTokenDevice));
                 return;
             }
             const target = event.target.closest('#students-body [data-ban-row], #students-body [data-unban-row], #students-body [data-private-notice], #students-body [data-delete-student-name]');
             if (!target) return;
             if (target.dataset.banRow) runAction(() => banIp(target.dataset.banRow));
             else if (target.dataset.unbanRow) runAction(() => unbanIp(target.dataset.unbanRow));
             else if (target.dataset.deleteStudentName !== undefined) runAction(() => deleteStudentSession(target.dataset.deleteStudentName, target.dataset.deleteStudentIp, target.dataset.deleteStudentDevice));
             else runAction(() => sendPrivateNotice(target.dataset.privateNotice, target.dataset.privateName));
         });
         $('banned-list')?.addEventListener('click', (event) => { const button = event.target.closest('[data-unban-row]'); if (button) runAction(() => unbanIp(button.dataset.unbanRow)); });
         reportAction('export-backup', exportBackup, 'Đang tạo backup'); reportAction('export-excel', exportExcel, 'Đang xuất'); reportAction('export-score-report', exportScoreReport, 'Đang tạo báo cáo');
         $('load-leaderboard')?.addEventListener('click', () => runAction(loadLeaderboard)); $('leaderboard-subject')?.addEventListener('change', () => { state.reportLeaderboardPage = 1; runAction(loadLeaderboard); }); $('leaderboard-content')?.addEventListener('click', (event) => { const button = event.target.closest('[data-report-page]'); if (!button || button.disabled) return; state.reportLeaderboardPage += button.dataset.reportPage === 'next' ? 1 : -1; renderLeaderboard(); }); $('refresh-score-report')?.addEventListener('click', () => runAction(loadScoreReport)); $('report-retry')?.addEventListener('click', () => runAction(loadScoreReport));
         $('save-gemini-key')?.addEventListener('click', () => runAction(saveGeminiKey)); $('clear-gemini-key')?.addEventListener('click', () => runAction(clearGeminiKey)); $('test-gemini-key')?.addEventListener('click', () => runAction(testGeminiKey));
          reportAction('archive-data', archiveExamData, 'Đang dọn dữ liệu');
         $('new-subject-button')?.addEventListener('click', (event) => openSubjectDialog(null, event.currentTarget));
        $('subject-grade-picker')?.addEventListener('click', (event) => { const button = event.target.closest('[data-subject-grade]'); if (button) setSubjectGrade(button.dataset.subjectGrade); });
         $('subject-form')?.addEventListener('submit', (event) => runAction(() => saveSubject(event))); $('clear-subject-form')?.addEventListener('click', closeSubjectDialog); $('clear-subject-form') && ($('clear-subject-form').textContent = 'Hủy'); $('subject-dialog-close')?.addEventListener('click', closeSubjectDialog); $('refresh-subjects')?.addEventListener('click', () => runAction(loadSubjects)); $('subjects-list')?.addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-subject]'); const adopt = event.target.closest('[data-adopt-subject-questions]'); const clearQuestions = event.target.closest('[data-delete-subject-questions]'); const remove = event.target.closest('[data-delete-subject]'); if (edit) { const subject = state.subjects.find((item) => item.key === edit.dataset.editSubject); if (subject) openSubjectDialog(subject, edit); } if (adopt) runAction(() => adoptLegacyQuestions(adopt.dataset.adoptSubjectQuestions)); if (clearQuestions) runAction(() => deleteSubjectQuestions(clearQuestions.dataset.deleteSubjectQuestions)); if (remove) runAction(() => deleteSubject(remove.dataset.deleteSubject)); });
        $('subject-dialog')?.addEventListener('close', () => { const opener = state.subjectDialogOpener; state.subjectDialogOpener = null; resetSubjectForm(); if (opener && document.contains(opener)) opener.focus(); });
    }

    async function init() {
        if (localStorage.getItem('quiz_admin_dark') === 'false') {
            document.body.classList.remove('dark');
        } else {
            document.body.classList.add('dark');
        }
        syncThemeIcon();
        $('bootstrap-admin')?.addEventListener('click', () => runAction(bootstrapAdmin));
        $('btn-unlock-admin-token')?.addEventListener('click', () => runAction(unlockAdminWithToken));
        $('admin-token-unlock-input')?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                runAction(unlockAdminWithToken);
            }
        });
        try {
            state.client = window.supabase.createClient(CONFIG.url, CONFIG.key);
            if (!(await isCurrentIpAllowed())) {
                denyAccess('IP hiện tại chưa được cấp quyền. Nếu đây là lần đầu cài đặt, hãy dùng nút thiết lập Admin lần đầu.');
                return;
            }
            showApp(); configureAdminLabels(); bindEvents(); switchView('overview'); fillSubjects('11'); fillLibrarySubjects(); ensureTypeEditor('mcq'); renderPreview(); renderRecentActivity();
            await loadSubjects();
            await Promise.all([loadQuestions(), loadTrash(), loadStudents(), loadMaintenance(), loadAccess(), loadGeo()]);
            await syncSubjectQuestionCounts();
            setInterval(() => {
                if (document.hidden) return;
                loadStudents().catch((error) => console.warn('[Quiz Studio Admin] Refresh monitor thất bại:', error));
            }, 5000);
        } catch (error) {
            console.error('[Quiz Studio Admin] Khởi tạo thất bại:', error);
            updateHealthStatus('db', 'danger', 'Mất kết nối', 'Không thể kết nối tới Supabase. Bấm để thử lại.');
            denyAccess(error?.message || 'Không thể kết nối dữ liệu quản trị.');
        }
    }
    init();
})();
