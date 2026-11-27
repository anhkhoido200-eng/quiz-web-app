/* Xác thực quản trị, quản lý IP, token và quyền truy cập. */
window.AdminAccess = window.AdminAccess || {};
window.AdminAccess.configure = function (context) {
    'use strict';
    const {
        state, $, SYSTEM, systemRow, ensureSupabaseClient, notify, promptDialog, confirmDialog,
        runAction, esc, copyToClipboard, triggerAdminCopyFeedback, buildAppUrl, allSubjects,
        subjectGrade, subjectMatchKey, extractDeviceCode, normalizeIdentityKey, loadStudents,
        renderGrade5ProgressMonitor
    } = context;

    const adminTokenTtlMs = 30 * 60 * 1000;
    const adminTokenKey = 'quiz_admin_token';
    const adminTokenExpiryKey = 'quiz_admin_token_expires_at';
    let bootstrapOnly = false;
    let adminExpiryTimer;

    function clearAdminToken() {
        try { localStorage.removeItem(adminTokenKey); } catch (error) {}
        try {
            sessionStorage.removeItem(adminTokenKey);
            sessionStorage.removeItem(adminTokenExpiryKey);
        } catch (error) {}
    }

    function storeAdminToken(token, expiresAt) {
        sessionStorage.setItem(adminTokenExpiryKey, String(expiresAt));
        sessionStorage.setItem(adminTokenKey, token);
    }

    function readAdminToken() {
        try { localStorage.removeItem(adminTokenKey); } catch (error) {}
        try {
            const expiresAt = Number(sessionStorage.getItem(adminTokenExpiryKey));
            const token = (sessionStorage.getItem(adminTokenKey) || '').trim();
            if (token && Number.isFinite(expiresAt) && expiresAt > Date.now()) return { token, expiresAt };
        } catch (error) {}
        clearAdminToken();
        return { token: '', expiresAt: 0 };
    }

    function hasAdminConfig(config) {
        return Boolean(String(config.masterIp || '').trim() || String(config.masterDeviceCode || '').trim() ||
            (Array.isArray(config.allowedIps) ? config.allowedIps.length : Array.isArray(config.ips) && config.ips.length));
    }

    async function verifyAdminCredentials({ password = null, token = null }, retry = Boolean(token)) {
        let result;
        try {
            const request = state.client.rpc('admin_verify_login', {
                p_password: password, p_admin_token: token, p_ip: state.clientIp || null
            });
            result = await (typeof request.abortSignal === 'function' ? request.abortSignal(AbortSignal.timeout(10000)) : request);
        } catch (error) {
            result = { error };
        }
        if (result.error) {
            const code = String(result.error.code || '');
            if (code === 'PGRST202' || code === '42883') {
                throw new Error('Máy chủ chưa có RPC xác thực Admin. Cần chạy supabase_security_migration.sql.');
            }
            const message = String(result.error.message || '');
            const transient = /network|fetch failed|failed to fetch|timeout|abort|connection/i.test(message) ||
                ['AbortError', 'TimeoutError'].includes(result.error.name);
            if (transient && retry) return verifyAdminCredentials({ token }, false);
            throw new Error('Tạm thời không thể xác thực với máy chủ. Vui lòng thử lại.');
        }
        return result.data;
    }

    function storeAdminSession(auth, expiresAt) {
        const token = auth.token || auth.session_token;
        if (!token) throw new Error('Máy chủ không trả về phiên Admin.');
        const serverExpiry = Date.parse(auth.expires_at || auth.expiresAt);
        const expiry = Math.min(expiresAt || Infinity, Number.isFinite(serverExpiry) ? serverExpiry : Date.now() + adminTokenTtlMs);
        if (expiry <= Date.now()) throw new Error('Phiên Admin đã hết hạn.');
        if (typeof window.dbService?.setAdminSessionToken === 'function') {
            window.dbService.setAdminSessionToken(token, new Date(expiry).toISOString());
        } else {
            sessionStorage.setItem('quiz_admin_session_expires_at', String(expiry));
            sessionStorage.setItem('quiz_admin_session_token', token);
        }
        return expiry;
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
                triggerAdminCopyFeedback(btn, 1500);
                clearTimeout(copyAdminIp.timer);
                copyAdminIp.timer = setTimeout(() => {
                    btn.classList.remove('is-copied');
                }, 1500);
            }
            notify(`Đã sao chép IP đầy đủ (${fullIp}) vào clipboard.`);
        } catch (error) {
            notify('Không thể sao chép địa chỉ IP.', true);
        }
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

    async function isCurrentIpAllowed() {
        state.clientIp = await getClientIp();
        if ($('current-ip')) {
            $('current-ip').textContent = maskIpAddress(state.clientIp);
            $('current-ip').dataset.fullIp = state.clientIp || '';
        }
        if ($('access-current-ip')) $('access-current-ip').textContent = state.clientIp || 'Không xác định IP';

        const getOrCreateAdminDeviceCode = () => {
            let code = '';
            try { code = localStorage.getItem('quiz_device_machine_code') || ''; } catch (e) {}
            if (!/^QM-[A-Z0-9]{4,}$/i.test(code)) {
                try {
                    const cookie = document.cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith('quiz_device_machine_code='));
                    const cookieCode = cookie ? decodeURIComponent(cookie.slice('quiz_device_machine_code='.length)) : '';
                    if (/^QM-[A-Z0-9]{4,}$/i.test(cookieCode)) code = cookieCode;
                } catch (e) {}
            }
            if (!/^QM-[A-Z0-9]{4,}$/i.test(code)) {
                const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
                let randomPart = '';
                for (let i = 0; i < 6; i++) randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
                code = `QM-${randomPart}`;
            }
            code = code.toUpperCase();
            try { localStorage.setItem('quiz_device_machine_code', code); } catch (e) {}
            try { document.cookie = `quiz_device_machine_code=${encodeURIComponent(code)}; path=/; max-age=31536000; SameSite=Lax`; } catch (e) {}
            return code;
        };
        state.deviceCode = getOrCreateAdminDeviceCode();
        if ($('access-current-device')) $('access-current-device').textContent = state.deviceCode;

        // Đọc mã IP-Token từ URL query params (?admin_token=... hoặc ?token=...) hoặc URL hash
        let urlAdminToken = '';
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
            const paramToken = urlParams.get('admin_token') || urlParams.get('token') || hashParams.get('admin_token') || hashParams.get('token');
            if (paramToken && paramToken.trim()) {
                urlAdminToken = paramToken.trim();
                try {
                    const cleanUrl = window.location.pathname + (hashParams.has('admin_token') || hashParams.has('token') ? '' : window.location.hash);
                    window.history.replaceState({}, document.title, cleanUrl);
                } catch (e) {}
            }
        } catch (e) {}

        const stored = readAdminToken();
        const currentToken = urlAdminToken || stored.token;
        const tokenExpiry = urlAdminToken ? Date.now() + adminTokenTtlMs : stored.expiresAt;
        const row = await systemRow(SYSTEM.admin);
        const config = JSON.parse(row?.score_summary || '{}');
        bootstrapOnly = !hasAdminConfig(config);
        if (bootstrapOnly) return false;
        state.adminConfig = {
            masterIp: String(config.masterIp || '').trim(),
            masterDeviceCode: String(config.masterDeviceCode || '').trim().toUpperCase(),
            allowedIps: Array.isArray(config.allowedIps) ? config.allowedIps : (Array.isArray(config.ips) ? config.ips.map((ip) => ({ ip, name: 'Admin' })) : [])
        };
        const sessionExpiry = Number(sessionStorage.getItem('quiz_admin_session_expires_at'));
        const sessionToken = window.dbService?.getAdminSessionToken?.() || (sessionExpiry > Date.now() ? sessionStorage.getItem('quiz_admin_session_token') : '');
        if (!sessionToken && !currentToken) return false;
        let auth = sessionToken ? await verifyAdminCredentials({ token: sessionToken }) : null;
        let usedAccessToken = false;
        if (!auth?.valid && currentToken) {
            auth = await verifyAdminCredentials({ token: currentToken });
            usedAccessToken = true;
        }
        if (!auth?.valid) return false;
        const accept = (matchedToken = false) => {
            const sessionDeadline = storeAdminSession(auth, usedAccessToken ? tokenExpiry : sessionExpiry);
            if (urlAdminToken && (usedAccessToken || matchedToken)) storeAdminToken(urlAdminToken, tokenExpiry);
            const deadline = matchedToken ? Math.min(sessionDeadline, tokenExpiry) : sessionDeadline;
            window.clearTimeout(adminExpiryTimer);
            adminExpiryTimer = window.setTimeout(() => window.location.reload(), Math.max(0, deadline - Date.now()));
            return true;
        };
        const ips = state.adminConfig.allowedIps.map((item) => typeof item === 'string' ? item : item?.ip).filter(Boolean).map(String);
        const myDeviceCode = String(state.deviceCode || '').trim().toUpperCase();
        const masterDeviceCode = state.adminConfig.masterDeviceCode;
        const normalizeAdminCode = (value) => {
            const clean = String(value || '').trim().toLowerCase();
            if (!clean) return '';
            const parts = clean.split('-');
            // IP-Token / IP-Mã: chỉ dùng phần mã sau IP khi xác thực Admin.
            return parts.length > 1 && (/^[0-9a-f:.]+$/i.test(parts[0]) || parts[0] === 'localhost')
                ? parts.slice(1).join('-')
                : clean;
        };
        const matchesAllowedDevice = (item) => {
            if (!myDeviceCode || !item) return false;
            if (typeof item === 'string') {
                const up = item.trim().toUpperCase();
                return up === myDeviceCode || up.endsWith('-' + myDeviceCode);
            }
            const itemDev = String(item.deviceCode || '').trim().toUpperCase();
            const itemRaw = String(item.rawCode || '').trim().toUpperCase();
            const itemTok = String(item.token || '').trim().toUpperCase();
            return itemDev === myDeviceCode || itemRaw === myDeviceCode || itemTok === myDeviceCode || itemTok.endsWith('-' + myDeviceCode);
        };

        // 1. Khớp Mã máy Master hoặc Mã máy trong danh sách Admin
        if (masterDeviceCode && myDeviceCode === masterDeviceCode) return accept();
        if (myDeviceCode && state.adminConfig.allowedIps.some(matchesAllowedDevice)) return accept();

        // 2. Nếu CHƯA khóa theo mã máy Master thì mới cho phép khớp theo Master IP / IP whitelist
        if (!masterDeviceCode) {
            if (state.clientIp && state.clientIp === state.adminConfig.masterIp) return accept();
            if (state.clientIp && ips.includes(state.clientIp)) return accept();
        }

        // 3. Khớp IP-Token Quản Trị Viên trong danh sách Admin (allowedIps)
        const isPlainIpAddress = (value) => {
            const clean = String(value || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
            return Boolean(clean) && !clean.includes('-') && (/^[0-9a-f:.]+$/i.test(clean) || clean === 'localhost');
        };
        if (currentToken) {
            const tok = currentToken.toLowerCase();
            const tokCode = normalizeAdminCode(tok);
            const isTokenMatch = state.adminConfig.allowedIps.some((item) => {
                if (!tok || tok.length < 6 || isPlainIpAddress(tok)) return false;
                if (typeof item === 'string') {
                    const str = item.trim().toLowerCase();
                    if (!str || str.length < 6 || isPlainIpAddress(str)) return false;
                    const strCode = normalizeAdminCode(str);
                    return str === tok || (Boolean(tokCode) && tokCode.length >= 6 && !isPlainIpAddress(strCode) && strCode === tokCode);
                }
                const itemToken = String(item.token || '').toLowerCase();
                const itemRaw = String(item.rawCode || '').toLowerCase();
                if (tok && tok.length >= 6) {
                    if (itemToken && !isPlainIpAddress(itemToken) && itemToken === tok) return true;
                    if (itemRaw && !isPlainIpAddress(itemRaw) && itemRaw === tok) return true;
                    if (tokCode && !isPlainIpAddress(tokCode) && normalizeAdminCode(itemToken) === tokCode) return true;
                    if (tokCode && !isPlainIpAddress(tokCode) && itemRaw && normalizeAdminCode(itemRaw) === tokCode) return true;
                }
                return false;
            });
            if (isTokenMatch) return accept(true);
        }

        // 4. Kiểm tra trong ACCESS_TOKENS (bản ghi số 8) CHỈ DÀNH CHO ROLE ADMIN
        if (currentToken) {
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
                        if (foundAdmin) return accept(true);
                    }
                }
            }
        }

        return false;
    }

    function clearAdminCredentials() {
        window.clearTimeout(adminExpiryTimer);
        clearAdminToken();
        window.dbService?.setAdminSessionToken?.('');
        try { localStorage.removeItem('quiz_admin_session_token'); } catch (error) {}
        try {
            sessionStorage.removeItem('quiz_admin_session_token');
            sessionStorage.removeItem('quiz_admin_session_expires_at');
        } catch (error) {}
    }

    function logout() {
        $('app-shell')?.classList.add('hidden');
        window.dbService?.logoutAdmin?.().catch(() => {});
        clearAdminCredentials();
    }

    function showAccessScreen(reason = '') {
        $('app-shell')?.classList.add('hidden');
        $('access-denied')?.classList.remove('hidden');
        $('admin-token-unlock-input')?.parentElement?.parentElement?.classList.toggle('hidden', bootstrapOnly);
        const message = document.querySelector('#access-denied .access-card p:not(.eyebrow)');
        if (message) message.textContent = reason || (bootstrapOnly
            ? 'Đăng nhập bằng mật khẩu Master để thiết lập Admin lần đầu.'
            : 'Thiết bị hoặc mã Admin hiện tại chưa được cấp quyền.');
    }

    function denyAccess() {
        clearAdminCredentials();
        showAccessScreen();
    }

    async function bootstrapAdmin() {
        ensureSupabaseClient();
        const password = await promptDialog({ title: 'Đăng nhập Master Admin', message: 'Nhập mật khẩu Master', inputType: 'password', confirmText: 'Xác nhận', icon: 'fa-key' });
        if (password === null) return;
        if (!password) return notify('Vui lòng nhập mật khẩu Master.', true);
        const auth = await verifyAdminCredentials({ password });
        if (!auth?.valid || !(auth.token || auth.session_token)) return notify('Mật khẩu Admin không đúng.', true);
        const row = await systemRow(SYSTEM.admin);
        const config = JSON.parse(row?.score_summary || '{}');
        if (!hasAdminConfig(config)) {
            if (!state.clientIp) state.clientIp = await getClientIp();
            if (!state.clientIp || !state.deviceCode) return notify('Không xác định được IP hoặc mã thiết bị.', true);
            const now = new Date().toISOString();
            const payload = { masterIp: state.clientIp, masterDeviceCode: state.deviceCode, allowedIps: [{ ip: state.clientIp, deviceCode: state.deviceCode, name: 'Thiết bị Master', addedAt: now, isMaster: true }] };
            const record = { id: SYSTEM.admin, player_name: '__ADMIN_IPS_CONFIG__', ip_address: 'SYSTEM', device_info: 'PASSWORDLESS_AUTH', status: 'ACTIVE', score_summary: JSON.stringify(payload), last_active: now };
            const table = state.client.from('quiz_logins');
            const write = row
                ? table.update(record).eq('id', SYSTEM.admin)
                : table.insert(record);
            if (row) {
                if (row.score_summary == null) write.is('score_summary', null);
                else write.eq('score_summary', row.score_summary);
            }
            const { data, error } = await write.select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('Cấu hình Admin vừa thay đổi. Hãy tải lại trang.');
        }
        storeAdminSession(auth);
        window.location.reload();
    }
    async function unlockAdminWithToken() {
        if (bootstrapOnly) return;
        const val = $('admin-token-unlock-input')?.value.trim();
        if (!val) return notify('Vui lòng nhập hoặc dán mã IP-Token Admin.', true);

        const isPlainIpAddress = (value) => {
            const clean = String(value || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
            return Boolean(clean) && !clean.includes('-') && (/^[0-9a-f:.]+$/i.test(clean) || clean === 'localhost');
        };
        if (isPlainIpAddress(val)) {
            return notify('Vui lòng nhập mã IP-Token Admin hợp lệ (không dùng địa chỉ IP thuần).', true);
        }

        ensureSupabaseClient();
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
                    if (!clean || clean.length < 6 || isPlainIpAddress(clean)) return false;
                    if (typeof it === 'string') {
                        const str = it.trim().toLowerCase();
                        if (!str || str.length < 6 || isPlainIpAddress(str)) return false;
                        const strCode = normalizeAdminCode(str);
                        return str === clean || (Boolean(cleanCode) && cleanCode.length >= 6 && !isPlainIpAddress(strCode) && strCode === cleanCode);
                    }
                    const itTok = String(it.token || '').toLowerCase();
                    const itRaw = String(it.rawCode || '').toLowerCase();
                    if (itTok && !isPlainIpAddress(itTok) && itTok === clean) return true;
                    if (itRaw && !isPlainIpAddress(itRaw) && itRaw === clean) return true;
                    if (cleanCode && !isPlainIpAddress(cleanCode) && normalizeAdminCode(itTok) === cleanCode) return true;
                    if (cleanCode && !isPlainIpAddress(cleanCode) && itRaw && normalizeAdminCode(itRaw) === cleanCode) return true;
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
                        if (t.role !== 'admin' || !clean || clean.length < 6) return false;
                        const tTok = String(t.token || '').toLowerCase();
                        const tRaw = String(t.rawCode || '').toLowerCase();
                        if (tTok && tTok === clean) return true;
                        if (tRaw && tRaw === clean) return true;
                        if (cleanCode && normalizeAdminCode(tTok) === cleanCode) return true;
                        if (cleanCode && tRaw && normalizeAdminCode(tRaw) === cleanCode) return true;
                        return false;
                    });
                }
            } catch (e) {}
        }

        if (isMatch) {
            const auth = await verifyAdminCredentials({ token: val });
            if (!auth?.valid) {
                clearAdminToken();
                return notify('Mã Admin không hợp lệ hoặc đã hết hạn.', true);
            }
            const expiresAt = Date.now() + adminTokenTtlMs;
            storeAdminToken(val, expiresAt);
            storeAdminSession(auth, expiresAt);
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

    async function copyActivationLink(token, name = '', triggerBtn = null) {
        const link = getStudentActivationLink(token);
        const copied = await copyToClipboard(link);
        if (copied && triggerBtn) triggerAdminCopyFeedback(triggerBtn, 1500);
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

    function renderStudentAccessSubjectCheckboxes() {
        const container = $('student-access-subjects-list');
        if (!container) return;
        const subjects = allSubjects();
        const prevChecked = new Set(Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map((el) => el.value));
        container.innerHTML = subjects.map((sub) => {
            const key = String(sub.key || sub.subject_key || '');
            const checked = prevChecked.has(key) ? 'checked' : '';
            return `<label style="display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border);font-size:11px;font-weight:600;cursor:pointer;">
                <input type="checkbox" value="${esc(key)}" ${checked}>
                <span>${esc(sub.name || key)}</span>
                <small style="color:var(--muted);font-weight:500;">(L${subjectGrade(sub)})</small>
            </label>`;
        }).join('');
    }

    function buildAllowedSubjectsBadge(item) {
        const list = Array.isArray(item?.allowedSubjects) ? item.allowedSubjects.filter(Boolean) : [];
        if (!list.length) {
            return `<span class="muted-copy" style="font-size:10px;">Môn: Tất cả theo quyền lớp</span>`;
        }
        const names = list.map((k) => {
            const found = allSubjects().find((s) => subjectMatchKey(s.key || s.subject_key) === subjectMatchKey(k));
            return found ? (found.name || k) : k;
        });
        return `<span style="display:inline-block;font-size:10px;font-weight:700;color:#38bdf8;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.25);padding:1px 6px;border-radius:6px;">Chỉ ${list.length} môn: ${esc(names.join(', '))}</span>`;
    }

    async function editTokenSubjects(tokenStr) {
        const idx = (state.tokens || []).findIndex((t) => String(t.token || '') === String(tokenStr || ''));
        if (idx === -1) return;
        const item = state.tokens[idx];
        const current = new Set((Array.isArray(item.allowedSubjects) ? item.allowedSubjects : []).map((k) => subjectMatchKey(k)).filter(Boolean));
        const subjects = allSubjects();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;background:rgba(2,6,23,0.75);padding:16px;';
        overlay.innerHTML = `
            <div class="panel" style="width:100%;max-width:520px;max-height:85vh;overflow-y:auto;margin:0;">
                <div class="panel-title">
                    <div>
                        <p class="eyebrow">SUBJECT ACCESS</p>
                        <h2>Phân chia môn cho ${esc(item.name || item.token)}</h2>
                        <p class="muted-copy" style="font-size:12px;">Chọn các môn học sinh này được nhìn thấy (bỏ chọn hết = hiện tất cả theo quyền lớp).</p>
                    </div>
                </div>
                <div id="modal-assign-subjects-grid" style="display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;">
                    ${subjects.map((sub) => {
                        const key = String(sub.key || sub.subject_key || '');
                        return `<label style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;background:var(--surface-3);border:1px solid var(--border);font-size:12px;font-weight:600;cursor:pointer;">
                            <input type="checkbox" value="${esc(key)}" ${current.has(subjectMatchKey(key)) ? 'checked' : ''}>
                            <span>${esc(sub.name || key)} (Lớp ${subjectGrade(sub)})</span>
                        </label>`;
                    }).join('')}
                </div>
                <div class="form-actions" style="justify-content:space-between;">
                    <button type="button" id="modal-assign-clear" class="button button-secondary compact">Bỏ chọn hết</button>
                    <div style="display:flex;gap:8px;">
                        <button type="button" id="modal-assign-cancel" class="button button-secondary compact">Hủy</button>
                        <button type="button" id="modal-assign-save" class="button button-primary compact"><i class="fa-solid fa-check"></i> Lưu phân môn</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.querySelector('#modal-assign-cancel')?.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('#modal-assign-clear')?.addEventListener('click', () => {
            overlay.querySelectorAll('#modal-assign-subjects-grid input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
        });
        overlay.querySelector('#modal-assign-save')?.addEventListener('click', async () => {
            const selected = Array.from(overlay.querySelectorAll('#modal-assign-subjects-grid input[type="checkbox"]:checked')).map((cb) => cb.value);
            state.tokens[idx] = { ...state.tokens[idx], allowedSubjects: selected, updatedAt: new Date().toISOString() };
            await saveTokens();
            renderUnifiedAccess();
            close();
            notify(selected.length ? `Đã giới hạn ${selected.length} môn cho ${item.name || item.token}.` : `Đã mở mặc định tất cả môn theo quyền lớp cho ${item.name || item.token}.`);
        });
    }

    function renderUnifiedAccess() {
        renderStudentAccessSubjectCheckboxes();
        const list = state.tokens || [];
        const class5List = list.filter(item => item.role === 'grade5' || item.role === 'all' || item.role === 'student');
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
                                <span class="status-badge info-badge"><i class="fa-solid fa-check"></i> Đã có AI</span>
                               <button type="button" class="button button-sm button-secondary compact" data-toggle-ai="${esc(item.token)}" title="Tắt quyền AI (vẫn giữ Lớp 5)" style="font-size:10px;padding:2px 6px;color:var(--muted);"><i class="fa-solid fa-xmark"></i> Tắt AI</button>
                           </div>`
                         : `<button type="button" class="button button-sm button-secondary compact" data-toggle-ai="${esc(item.token)}" title="Cấp thêm Trợ lý AI cho học sinh này (dùng chung mã/IP)" style="font-size:11px;padding:3px 8px;">
                                <i class="fa-solid fa-sliders"></i> + Cấp thêm AI
                           </button>`;

                    return `
                        <tr>
                            <td>
                                <div style="display:flex;align-items:center;gap:8px;">
                                    <span class="stack-item-icon" style="color:var(--emerald);background:var(--surface-3);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;">
                                        <i class="fa-solid fa-user-graduate"></i>
                                    </span>
                                    <div>
                                        <b style="font-size:13px;color:var(--text);">${esc(item.name || 'Học sinh')}</b>
                                        <div style="margin-top:2px;">${buildAllowedSubjectsBadge(item)}</div>
                                    </div>
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
                            <td style="text-align:right;white-space:nowrap;">
                                <button type="button" class="button button-sm button-secondary compact" data-assign-subjects="${esc(item.token)}" style="font-size:11px;padding:4px 8px;margin-right:4px;" title="Phân chia môn học được xem">
                                    <i class="fa-solid fa-layer-group"></i> Phân môn
                                </button>
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
                             <div style="font-size:24px;margin-bottom:6px;opacity:0.6;"><i class="fa-solid fa-comments"></i></div>
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
                                    <span class="stack-item-icon" style="color:var(--primary);background:var(--primary-soft);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;">
                                         <i class="fa-solid fa-comments"></i>
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
                                     <span class="status-badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;font-size:10px;padding:1px 6px;">Kèm Đề + AI</span>
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
                                     <code style="font-size:11px;color:var(--amber,#f59e0b);font-weight:700;cursor:pointer;" title="Bấm để copy mã" data-copy-token-code="${esc(item.token)}">${esc(item.token)}</code>
                                    ${ipDisplay}
                                </div>
                            </div>
                        </div>
                        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
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

        const observerLink = buildAppUrl(`?token=${encodeURIComponent(combinedToken)}&view=progress`);
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

    function isIpOnlyTokenRecord(t) {
        if (!t) return false;
        const tCode = String(t.token || '').trim().toLowerCase();
        const tRaw = String(t.rawCode || '').trim().toLowerCase();
        const tIp = String(t.ip || '').trim().toLowerCase();
        if (!tIp) return false;
        return (!tRaw || tRaw === tIp) && (!tCode || tCode === tIp);
    }

    function hasOtherTokenWithRoleOnIp(ip, excludeToken, roles, ipOnlyOnly = false) {
        const cleanIp = String(ip || '').trim().toLowerCase();
        if (!cleanIp) return false;
        return (state.tokens || []).some(t =>
            t.token !== excludeToken &&
            String(t.ip || '').trim().toLowerCase() === cleanIp &&
            roles.includes(t.role) &&
            (!ipOnlyOnly || isIpOnlyTokenRecord(t))
        );
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
                 icon: 'fa-sliders'
            });
            if (!confirmed) return;

            item.role = 'grade5';
            if (item.ip && !hasOtherTokenWithRoleOnIp(item.ip, token, ['ai', 'all'])) {
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
            if (item.ip && isIpOnlyTokenRecord(item)) {
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
            if (item.ip && isIpOnlyTokenRecord(item) && !hasOtherTokenWithRoleOnIp(item.ip, token, ['grade5', 'all'], true)) {
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

        if (item.ip && isIpOnlyTokenRecord(item) && !hasOtherTokenWithRoleOnIp(item.ip, token, ['grade5', 'all'], true)) {
            state.geo.grade5Ips = (state.geo.grade5Ips || []).filter(ip => ip !== item.ip);
            await saveGeo();
        }

        if (item.role === 'all') {
            item.role = 'ai';
            await saveTokens();
            renderUnifiedAccess();
            notify(`Đã thu hồi quyền Lớp 5 của ${item.name}, vẫn giữ quyền AI.`);
        } else {
            if (item?.role === 'admin' && Array.isArray(state.adminConfig?.allowedIps)) {
            const beforeLen = state.adminConfig.allowedIps.length;
            state.adminConfig.allowedIps = state.adminConfig.allowedIps.filter((it) => {
                if (typeof it === 'string') return it !== token && (!isIpOnlyTokenRecord(item) || it !== item.ip);
                if (it.token && it.token === token) return false;
                if (item.rawCode && it.rawCode && it.rawCode === item.rawCode) return false;
                if (isIpOnlyTokenRecord(item) && item.ip && it.ip === item.ip && !it.token) return false;
                return true;
            });
            if (state.adminConfig.allowedIps.length !== beforeLen) {
                await saveAdminConfig();
                renderAccess();
            }
        }

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

        if (item.ip && !hasOtherTokenWithRoleOnIp(item.ip, token, ['ai', 'all'])) {
            state.aiIps = (state.aiIps || []).filter(x => (typeof x === 'string' ? x : x.ip) !== item.ip);
            await saveAiIps();
        }

        if (item.role === 'all') {
            item.role = 'grade5';
            await saveTokens();
            renderUnifiedAccess();
            notify(`Đã thu hồi quyền Trợ lý AI của ${item.name}, vẫn giữ quyền Lớp 5.`);
        } else {
            if (item?.role === 'admin' && Array.isArray(state.adminConfig?.allowedIps)) {
            const beforeLen = state.adminConfig.allowedIps.length;
            state.adminConfig.allowedIps = state.adminConfig.allowedIps.filter((it) => {
                if (typeof it === 'string') return it !== token && (!isIpOnlyTokenRecord(item) || it !== item.ip);
                if (it.token && it.token === token) return false;
                if (item.rawCode && it.rawCode && it.rawCode === item.rawCode) return false;
                if (isIpOnlyTokenRecord(item) && item.ip && it.ip === item.ip && !it.token) return false;
                return true;
            });
            if (state.adminConfig.allowedIps.length !== beforeLen) {
                await saveAdminConfig();
                renderAccess();
            }
        }

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

        // Tìm xem token / mã kết hợp đã có trong danh sách chưa.
        // Nếu có mã máy riêng (detectedCode), chỉ cập nhật đúng máy đó — không ghi đè máy khác cùng IP.
        const existingIdx = state.tokens.findIndex(t => {
            const tCode = String(t.token || '').toUpperCase();
            const tRaw = String(t.rawCode || '').toUpperCase();
            const tIp = String(t.ip || '').toLowerCase();
            if (combinedToken && tCode === combinedToken.toUpperCase()) return true;
            if (detectedCode && rawCode && (tRaw === rawCode || tCode === rawCode)) return true;
            if (!detectedCode && ip && tIp === ip && isIpOnlyTokenRecord(t)) return true;
            return false;
        });

        const allowedSubjects = Array.from(document.querySelectorAll('#student-access-subjects-list input[type="checkbox"]:checked')).map((cb) => cb.value).filter(Boolean);
        const record = {
            token: combinedToken,
            rawCode: rawCode,
            role,
            name: studentName,
            ip: ip || null,
            allowedSubjects,
            createdAt: new Date().toISOString()
        };

        if (existingIdx !== -1) {
            const prevAllowed = Array.isArray(state.tokens[existingIdx].allowedSubjects) ? state.tokens[existingIdx].allowedSubjects : [];
            state.tokens[existingIdx] = {
                ...state.tokens[existingIdx],
                ...record,
                allowedSubjects: allowedSubjects.length ? allowedSubjects : prevAllowed,
                updatedAt: new Date().toISOString()
            };
        } else {
            state.tokens.unshift(record);
        }

        await saveTokens();

        if (ip) {
            if ((role === 'grade5' || role === 'all') && !detectedCode) {
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
        document.querySelectorAll('#student-access-subjects-list input[type="checkbox"]').forEach((cb) => { cb.checked = false; });

        renderUnifiedAccess();

        const roleDesc = role === 'all' ? 'Toàn bộ gói VIP (Lớp 5 + AI)' : (role === 'student' ? 'Phân môn riêng' : (role === 'ai' ? 'Trợ lý AI' : (role === 'parent' ? 'Giám Sát Tiến Trình (Kèm Xem Đề + AI)' : (role === 'admin' ? 'Quản Trị Viên (Toàn quyền Admin)' : 'Lớp 5'))));
        notify(`✅ Đã kích hoạt quyền ${roleDesc} cho thiết bị "${record.token}" (${studentName})!`);
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
            if (state.geo?.grade5Ips && isIpOnlyTokenRecord(item) && !hasOtherTokenWithRoleOnIp(cleanIp, token, ['grade5', 'all'], true)) {
                state.geo.grade5Ips = state.geo.grade5Ips.filter(ip => ip !== cleanIp);
                await saveGeo();
            }
            if (state.aiIps && !hasOtherTokenWithRoleOnIp(cleanIp, token, ['ai', 'all'])) {
                state.aiIps = state.aiIps.filter(i => (typeof i === 'string' ? i : i.ip) !== cleanIp);
                await saveAiIps();
            }
        }

        if (item?.role === 'admin' && Array.isArray(state.adminConfig?.allowedIps)) {
            const beforeLen = state.adminConfig.allowedIps.length;
            state.adminConfig.allowedIps = state.adminConfig.allowedIps.filter((it) => {
                if (typeof it === 'string') return it !== token && (!isIpOnlyTokenRecord(item) || it !== item.ip);
                if (it.token && it.token === token) return false;
                if (item.rawCode && it.rawCode && it.rawCode === item.rawCode) return false;
                if (isIpOnlyTokenRecord(item) && item.ip && it.ip === item.ip && !it.token) return false;
                return true;
            });
            if (state.adminConfig.allowedIps.length !== beforeLen) {
                await saveAdminConfig();
                renderAccess();
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

    async function loadAdminConfig(resetWhenEmpty = false) {
        const row = await systemRow(SYSTEM.admin);
        if (!row || (!row.score_summary && !resetWhenEmpty)) return;
        try {
            const data = JSON.parse(row.score_summary || '{}');
            state.adminConfig = {
                masterIp: String(data.masterIp || '').trim(),
                masterDeviceCode: String(data.masterDeviceCode || '').trim().toUpperCase(),
                allowedIps: Array.isArray(data.allowedIps) ? data.allowedIps : []
            };
        } catch (error) { /* Giữ cấu hình đã tải. */ }
    }

    async function loadAccess() {
        await loadAdminConfig(true);
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
                const existing = state.tokens.find(t => isIpOnlyTokenRecord(t) && (String(t.ip || '').toLowerCase() === cleanIp || String(t.token || '').toLowerCase() === cleanIp));
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
                    const hasOtherAi = state.tokens.some(t => String(t.ip || '').toLowerCase() === cleanIp && (t.role === 'ai' || t.role === 'all'));
                    if (existing.role === 'grade5' && (isIpOnlyTokenRecord(existing) || !hasOtherAi)) {
                        existing.role = 'all';
                    }
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

    const normalizeRoster = (value) => {
        const source = value && typeof value === 'object' ? value : {};
        const normalizeRenameRequests = (candidate) => {
            if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
            return Object.entries(candidate).reduce((result, [code, request]) => {
                const upperCode = String(code || '').trim().toUpperCase();
                if (!/^QM-[A-Z0-9]{4,}$/i.test(upperCode) || !request || typeof request !== 'object') return result;
                result[upperCode] = {
                    requestedAt: String(request.requestedAt || ''),
                    oldName: String(request.oldName || '').trim(),
                    reason: String(request.reason || '').trim()
                };
                return result;
            }, {});
        };
        if (typeof window.normalizeRosterConfig === 'function') {
            const normalized = window.normalizeRosterConfig(value) || {};
            return {
                ...normalized,
                renameRequests: normalizeRenameRequests(normalized.renameRequests || source.renameRequests)
            };
        }
        const grade = (key) => {
            const item = source[key] || {};
            const students = Array.isArray(item.students) ? item.students : Array.isArray(item.names) ? item.names : [];
            const seen = new Set();
            const cleanStudents = students.map((name) => String(name || '').replace(/\s+/g, ' ').trim()).filter((name) => {
                const k = name.toLowerCase();
                if (!k || seen.has(k)) return false;
                seen.add(k);
                return true;
            });
            const allowRaw = item.allowGuestsInPractice ?? item.allowGuests ?? item.allow_guests;
            return {
                enabled: Boolean(item.enabled),
                allowGuestsInPractice: allowRaw === undefined ? true : Boolean(allowRaw),
                students: cleanStudents
            };
        };
        return { grade5: grade('grade5'), grade11: grade('grade11'), devicePins: source.devicePins && typeof source.devicePins === 'object' ? source.devicePins : {}, renameRequests: normalizeRenameRequests(source.renameRequests) };
    };
    function renderRosterConfig() {
        const config = state.rosterConfig || normalizeRoster({});
        [['5', config.grade5], ['11', config.grade11]].forEach(([grade, item]) => {
            const text = $(`roster-grade${grade}-textarea`);
            if (text && document.activeElement !== text) text.value = (item.students || []).join('\n');
            $(`roster-grade${grade}-enabled`) && ($(`roster-grade${grade}-enabled`).checked = Boolean(item.enabled));
            $(`roster-grade${grade}-allow-guests`) && ($(`roster-grade${grade}-allow-guests`).checked = Boolean(item.allowGuestsInPractice !== false));
            const count = text && document.activeElement === text ? String(text.value || '').split(/\r?\n/).map((name) => name.trim()).filter(Boolean).length : (item.students || []).length;
            $(`roster-grade${grade}-count`) && ($(`roster-grade${grade}-count`).textContent = `${count} học sinh`);
        });
        const pins = state.devicePins || {};
        $('device-pins-count') && ($('device-pins-count').textContent = `${Object.keys(pins).length} mã máy`);
        $('device-pins-list') && ($('device-pins-list').innerHTML = Object.entries(pins).sort().map(([code, name]) => `<div class="device-pin-item"><code>[${esc(code)}]</code><b>${esc(name)}</b><button type="button" class="table-action danger" data-unpin-device-code="${esc(code)}" title="Bỏ ghim"><i class="fa-solid fa-xmark"></i></button></div>`).join('') || '<p class="muted-copy">Chưa có mã máy được ghim.</p>');
    }
    async function loadRosterConfig() {
        let payload = null;
        try { payload = await window.dbService?.fetchRosterConfig?.(); } catch (error) { console.warn('[Quiz Studio Admin] Không tải được roster qua dbService:', error); }
        if (!payload) {
            try { payload = JSON.parse(localStorage.getItem('quiz_roster_config') || 'null'); } catch (error) { payload = null; }
        }
        if (!payload) {
            const row = await systemRow(SYSTEM.roster);
            if (row?.score_summary) { try { payload = JSON.parse(row.score_summary); } catch (error) {} }
        }
        const normalized = normalizeRoster(payload || {});
        state.rosterConfig = { grade5: normalized.grade5, grade11: normalized.grade11 };
        state.devicePins = normalized.devicePins || {};
        state.renameRequests = normalized.renameRequests || {};
        renderRosterConfig();
    }
    async function persistRosterPayload(payload, toastMessage = '') {
        const source = payload && typeof payload === 'object' ? payload : {};
        const normalized = normalizeRoster({ ...source, renameRequests: source.renameRequests ?? state.renameRequests ?? {} });
        state.rosterConfig = { grade5: normalized.grade5, grade11: normalized.grade11 };
        state.devicePins = normalized.devicePins || {};
        state.renameRequests = normalized.renameRequests || {};
        let savedViaService = false;
        if (typeof window.dbService?.saveRosterConfig === 'function') {
            await window.dbService.saveRosterConfig(normalized);
            savedViaService = true;
        }
        if (!savedViaService && state.client) {
            const { error } = await state.client.from('quiz_logins').upsert({ id: SYSTEM.roster, player_name: '__SYSTEM_ROSTER__', ip_address: 'SYSTEM', device_info: 'ROSTER_CONFIG', status: 'ACTIVE', score_summary: JSON.stringify(normalized), last_active: new Date().toISOString() }, { onConflict: 'id' });
            if (error) throw error;
        }
        try { localStorage.setItem('quiz_roster_config', JSON.stringify(normalized)); } catch (error) {}
        renderRosterConfig();
        if (toastMessage) notify(toastMessage);
    }
    async function saveRosterFromAccessView() {
        const clean = (grade) => String($(`roster-grade${grade}-textarea`)?.value || '').split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
        const payload = normalizeRoster({
            grade5: { enabled: Boolean($('roster-grade5-enabled')?.checked), allowGuestsInPractice: $('roster-grade5-allow-guests') ? Boolean($('roster-grade5-allow-guests').checked) : true, students: clean('5') },
            grade11: { enabled: Boolean($('roster-grade11-enabled')?.checked), allowGuestsInPractice: $('roster-grade11-allow-guests') ? Boolean($('roster-grade11-allow-guests').checked) : true, students: clean('11') },
            devicePins: state.devicePins || {},
            renameRequests: state.renameRequests || {}
        });
        await persistRosterPayload(payload, 'Đã lưu danh sách lớp và cấu hình người ngoài lớp.');
    }
    async function syncPinnedNamesToLogins(targetPins = state.devicePins) {
        if (!state.client) return 0;
        const pinEntries = Object.entries(targetPins || {})
            .map(([code, name]) => [String(code || '').trim().toUpperCase(), String(name || '').replace(/\s+/g, ' ').trim()])
            .filter(([code, name]) => /^QM-[A-Z0-9]{4,}$/i.test(code) && name && !name.startsWith('__'));
        if (!pinEntries.length) return 0;
        const pinsMap = new Map(pinEntries);
        const systemIds = new Set(Object.values(SYSTEM || {}));
        const updatesByName = new Map();
        const pageSize = 500;
        for (let offset = 0; ; offset += pageSize) {
            const { data, error } = await state.client
                .from('quiz_logins')
                .select('id, player_name, device_info, status, ip_address')
                .ilike('device_info', '%[QM-%')
                .range(offset, offset + pageSize - 1);
            if (error) throw error;
            const rows = Array.isArray(data) ? data : [];
            for (const row of rows) {
                if (!row || !row.id || systemIds.has(row.id)) continue;
                const currentName = String(row.player_name || '').trim();
                const ip = String(row.ip_address || '').trim();
                const status = String(row.status || '').trim();
                if (currentName.startsWith('__') || ip === 'SYSTEM' || /^BANNED/i.test(status)) continue;
                const devCode = extractDeviceCode(row.device_info);
                const pinnedName = devCode ? pinsMap.get(devCode) : '';
                if (!pinnedName || currentName === pinnedName) continue;
                if (!updatesByName.has(pinnedName)) updatesByName.set(pinnedName, []);
                updatesByName.get(pinnedName).push(row.id);
            }
            if (rows.length < pageSize) break;
        }
        let updatedCount = 0;
        for (const [targetName, ids] of updatesByName.entries()) {
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                const { error } = await state.client
                    .from('quiz_logins')
                    .update({ player_name: targetName })
                    .in('id', chunk);
                if (error) throw error;
                updatedCount += chunk.length;
            }
        }
        if (updatedCount > 0) {
            try { localStorage.removeItem('quiz_local_logins_history'); } catch (e) {}
        }
        return updatedCount;
    }
    async function saveDevicePin(code, name) {
        const cleanCode = extractDeviceCode(`[${String(code || '').trim()}]`) || String(code || '').trim().toUpperCase().replace(/^\[|\]$/g, '');
        const cleanName = String(name || '').replace(/\s+/g, ' ').trim();
        if (!/^QM-[A-Z0-9]{4,}$/i.test(cleanCode) || !cleanName || cleanName.startsWith('__')) {
            return notify('Nhập đúng mã máy QM-XXXXXX và họ tên thật.', true);
        }
        const upperCode = cleanCode.toUpperCase();
        const nextPins = { ...(state.devicePins || {}), [upperCode]: cleanName };
        const payload = normalizeRoster({
            grade5: state.rosterConfig?.grade5 || { enabled: false, allowGuestsInPractice: true, students: [] },
            grade11: state.rosterConfig?.grade11 || { enabled: false, allowGuestsInPractice: true, students: [] },
            devicePins: nextPins,
            renameRequests: state.renameRequests || {}
        });
        await persistRosterPayload(payload, '');
        let updatedCount = 0;
        try {
            updatedCount = await syncPinnedNamesToLogins({ [upperCode]: cleanName });
        } catch (err) {
            console.warn('[Quiz Studio Admin] Không thể đồng bộ đổi tên các bản ghi cũ:', err);
        }
        if (Array.isArray(state.reportRows)) {
            state.reportRows = state.reportRows.map((item) => extractDeviceCode(item?.device_info) === upperCode ? { ...item, name: cleanName } : item);
            renderLeaderboard();
        }
        await loadStudents();
        await renderGrade5ProgressMonitor();
        notify(`Đã ghim tên "${cleanName}" cho [${upperCode}]${updatedCount > 0 ? ` và đổi tên ${updatedCount} bản ghi cũ.` : '.'}`);
    }
    async function mergeDevicesToName(codes, name) {
        const cleanCodes = [...new Set((Array.isArray(codes) ? codes : []).map((code) => extractDeviceCode(`[${String(code || '').trim()}]`) || String(code || '').trim().toUpperCase()).filter((code) => /^QM-[A-Z0-9]{4,}$/i.test(code)))].map((code) => code.toUpperCase());
        const cleanName = String(name || '').replace(/\s+/g, ' ').trim();
        if (!cleanCodes.length || !cleanName || cleanName.startsWith('__')) return notify('Chưa đủ mã máy hoặc tên hợp lệ để gộp.', true);
        const nextPins = { ...(state.devicePins || {}) };
        cleanCodes.forEach((code) => { nextPins[code] = cleanName; });
        const payload = normalizeRoster({ grade5: state.rosterConfig?.grade5 || { enabled: false, allowGuestsInPractice: true, students: [] }, grade11: state.rosterConfig?.grade11 || { enabled: false, allowGuestsInPractice: true, students: [] }, devicePins: nextPins, renameRequests: state.renameRequests || {} });
        await persistRosterPayload(payload, '');
        let updatedCount = 0;
        try { updatedCount = await syncPinnedNamesToLogins(Object.fromEntries(cleanCodes.map((code) => [code, cleanName]))); } catch (err) { console.warn('[Quiz Studio Admin] Không thể đồng bộ đổi tên các bản ghi cũ:', err); }
        if (Array.isArray(state.reportRows)) {
            const codeSet = new Set(cleanCodes);
            state.reportRows = state.reportRows.map((item) => codeSet.has(extractDeviceCode(item?.device_info)) ? { ...item, name: cleanName } : item);
            renderLeaderboard();
        }
        await loadStudents();
        await renderGrade5ProgressMonitor();
        notify(`Đã gộp và ghim tên "${cleanName}" cho ${cleanCodes.length} mã máy${updatedCount ? `, đổi tên ${updatedCount} bản ghi cũ` : ''}.`);
    }
    async function unpinDevicePin(code) {
        const upperCode = String(code || '').trim().toUpperCase().replace(/^\[|\]$/g, '');
        const nextPins = { ...(state.devicePins || {}) };
        delete nextPins[upperCode];
        const payload = normalizeRoster({
            grade5: state.rosterConfig?.grade5 || { enabled: false, allowGuestsInPractice: true, students: [] },
            grade11: state.rosterConfig?.grade11 || { enabled: false, allowGuestsInPractice: true, students: [] },
            devicePins: nextPins,
            renameRequests: state.renameRequests || {}
        });
        await persistRosterPayload(payload, `Đã bỏ ghim mã máy [${upperCode}].`);
        await loadStudents();
        await renderGrade5ProgressMonitor();
    }

    async function toggleRequireRename(code, currentName = '') {
        const upperCode = String(code || '').trim().toUpperCase().replace(/^\[|\]$/g, '');
        if (!/^QM-[A-Z0-9]{4,}$/i.test(upperCode)) return notify('Mã máy không hợp lệ.', true);
        const nextReqs = { ...(state.renameRequests || {}) };
        if (nextReqs[upperCode]) {
            const confirmed = await confirmDialog({ title: 'Hủy yêu cầu đổi tên?', message: 'Mã máy [' + upperCode + '] đang được yêu cầu nhập lại tên thật. Bạn có muốn hủy yêu cầu này?', confirmText: 'Hủy yêu cầu', icon: 'fa-user-check' });
            if (!confirmed) return;
            delete nextReqs[upperCode];
            await persistRosterPayload({ grade5: state.rosterConfig?.grade5, grade11: state.rosterConfig?.grade11, devicePins: state.devicePins || {}, renameRequests: nextReqs });
            await loadStudents();
            await renderGrade5ProgressMonitor();
            notify('Đã hủy yêu cầu đổi tên cho [' + upperCode + '].');
            return;
        }
        const reason = await promptDialog({ title: 'Bắt nhập lại tên thật [' + upperCode + ']', message: 'Lần tới máy [' + upperCode + '] mở web sẽ bị khóa màn hình bắt nhập lại đúng Họ và Tên thật (và tự đổi tên các lượt làm bài cũ):', defaultValue: 'Tên hiện tại chưa đúng Họ và Tên thật. Vui lòng nhập hoặc chọn đúng Họ và Tên thật của bạn để tiếp tục làm bài!', confirmText: 'Gửi yêu cầu đổi tên', icon: 'fa-user-pen' });
        if (reason === null) return;
        nextReqs[upperCode] = { requestedAt: new Date().toISOString(), oldName: String(currentName || '').trim(), reason: String(reason || '').trim() };
        await persistRosterPayload({ grade5: state.rosterConfig?.grade5, grade11: state.rosterConfig?.grade11, devicePins: state.devicePins || {}, renameRequests: nextReqs });
        await loadStudents();
        await renderGrade5ProgressMonitor();
        notify('Đã bật khóa bắt nhập lại tên thật cho [' + upperCode + '].');
    }

    function renderAccess() {
        const allowed = state.adminConfig.allowedIps || [];
        const myDeviceCode = String(state.deviceCode || localStorage.getItem('quiz_device_machine_code') || '').trim().toUpperCase();
        const masterDev = String(state.adminConfig.masterDeviceCode || '').trim().toUpperCase();
        if ($('access-current-device')) $('access-current-device').textContent = myDeviceCode || 'Chưa có';
        const lockStatusEl = $('access-device-lock-status');
        if (lockStatusEl) {
            if (masterDev) {
                const isThisMachine = myDeviceCode && masterDev === myDeviceCode;
                lockStatusEl.textContent = isThisMachine
                    ? `Đã khóa quyền Admin vào đúng mã máy này (${masterDev}). Điện thoại hoặc máy khác cùng WiFi sẽ hiển thị như học sinh bình thường.`
                    : `Quyền Master Admin đang khóa theo mã máy ${masterDev}. Bấm nút bên phải để chuyển sang máy hiện tại (${myDeviceCode}).`;
            } else {
                lockStatusEl.textContent = 'Đang nhận diện theo IP mạng (điện thoại chung WiFi sẽ lên Admin). Bấm "Khóa Master vào máy này" để chỉ máy này mới có quyền Admin.';
            }
        }
        const masterToggle = $('master-device-lock-toggle');
        const masterLabel = $('master-lock-toggle-label');
        const isLockedHere = Boolean(masterDev && myDeviceCode && masterDev === myDeviceCode);
        if (masterToggle) masterToggle.checked = isLockedHere;
        if (masterLabel) {
            masterLabel.textContent = isLockedHere ? 'Đang khóa vào máy này' : 'Khóa vào máy này';
            masterLabel.classList.toggle('is-active', isLockedHere);
        }
        $('admin-ip-count') && ($('admin-ip-count').textContent = allowed.length);
        $('admin-ip-list') && ($('admin-ip-list').innerHTML = allowed.map((item, idx) => {
            const ip = typeof item === 'string' ? item : (item.ip || '');
            const deviceCode = typeof item === 'object' ? String(item.deviceCode || item.rawCode || '').trim().toUpperCase() : '';
            const name = typeof item === 'string' ? 'Admin' : (item.name || 'Admin');
            const token = typeof item === 'object' ? (item.token || item.rawCode || deviceCode || ip) : ip;
            const isMaster = masterDev
                ? (Boolean(deviceCode && deviceCode === masterDev) || (typeof item === 'object' && Boolean(item.isMaster) && (!deviceCode || deviceCode === masterDev)))
                : ((typeof item === 'object' && Boolean(item.isMaster)) || (!deviceCode && Boolean(ip && ip === state.adminConfig.masterIp)));
            const displayCode = esc(token || ip || 'ADMIN-KEY');
            const deviceBadge = deviceCode
                ? `<code style="font-size:10px;padding:2px 6px;background:var(--primary-soft);color:var(--primary);border-radius:4px;font-weight:700;">Mã máy: ${esc(deviceCode)}</code>`
                : '';
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
                            ${deviceBadge}
                            ${ipDisplay}
                        </div>
                    </span>
                    <div style="display:flex;align-items:center;gap:6px;">
                        ${copyBtn}
                        ${isMaster ? '' : `<button type="button" class="button button-sm button-danger compact" data-remove-admin="${esc(token || deviceCode || ip)}" data-remove-admin-index="${idx}" title="Thu hồi quyền Admin" style="font-size:11px;padding:4px 9px;"><i class="fa-solid fa-user-slash"></i> Thu hồi</button>`}
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
                masterDeviceCode: state.adminConfig.masterDeviceCode || '',
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

        const choice = await promptDialog({
            title: `Cấp quyền cho ${name}?`,
            message: `Nhập 5 để cấp quyền Lớp 5, AI để cấp quyền AI. ESC/Hủy để thoát.\n${deviceCode ? `Mã thiết bị: ${deviceCode}\n` : ''}${ip ? `IP: ${ip}` : ''}`,
            placeholder: '5 hoặc AI',
            defaultValue: '5',
            confirmText: 'Tiếp tục',
            cancelText: 'Hủy',
            variant: 'primary',
            icon: 'fa-key'
        });
        if (choice === null) return;
        const role = /^ai$/i.test(String(choice).trim()) ? 'ai' : /^5$|grade5/i.test(String(choice).trim()) ? 'grade5' : null;
        if (!role) return notify('Lựa chọn không hợp lệ.', true);
        const rawCode = deviceCode || generateRandomToken(role === 'grade5' ? 'QM' : 'AI');
        const token = (ip && rawCode) ? `${ip}-${rawCode}` : rawCode;

        state.tokens = Array.isArray(state.tokens) ? state.tokens : [];
        const existingIdx = state.tokens.findIndex(t => {
            const tToken = String(t.token || '').toUpperCase();
            const tRaw = String(t.rawCode || '').toUpperCase();
            const tIp = String(t.ip || '').toLowerCase();
            return (token && tToken === token.toUpperCase()) ||
                   (rawCode && (tRaw === rawCode.toUpperCase() || tToken === rawCode.toUpperCase())) ||
                   (ip && tIp === ip.toLowerCase() && (!deviceCode || String(t.name || '').toLowerCase().includes(String(name || '').toLowerCase())));
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
            if (role === 'grade5' && !deviceCode) {
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

        const detectedDeviceCode = /^QM-[A-Z0-9]+$/i.test(rawCode) ? rawCode.toUpperCase() : '';
        const existingIdx = state.adminConfig.allowedIps.findIndex(item => {
            if (typeof item === 'string') {
                return (combinedToken && item === combinedToken) || (!rawCode && ip && item === ip);
            }
            const itemDev = String(item.deviceCode || item.rawCode || '').trim().toUpperCase();
            if (detectedDeviceCode && itemDev) return itemDev === detectedDeviceCode;
            if (combinedToken && item.token && item.token === combinedToken) return true;
            if (rawCode && item.rawCode && String(item.rawCode).toUpperCase() === rawCode.toUpperCase()) return true;
            return !rawCode && !itemDev && ip && item.ip === ip;
        });

        const newAdminItem = {
            ip: ip || null,
            deviceCode: detectedDeviceCode || undefined,
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

        const adminLink = buildAppUrl(`admin.html?token=${encodeURIComponent(combinedToken)}`);
        try {
            await navigator.clipboard.writeText(adminLink);
            notify(`✅ Đã cấp IP-Token Admin: "${combinedToken}"!\nĐã tự động sao chép Link Admin vào bộ nhớ tạm.`);
        } catch (e) {
            notify(`✅ Đã cấp IP-Token Admin: "${combinedToken}" cho ${adminName}!`);
        }
    }

    async function removeAdminIp(identifier, itemIndex = -1) {
        const list = Array.isArray(state.adminConfig.allowedIps) ? state.adminConfig.allowedIps : [];
        const masterDev = String(state.adminConfig.masterDeviceCode || '').trim().toUpperCase();
        const isEntryMaster = (entry) => {
            if (!entry) return false;
            if (typeof entry === 'string') return !masterDev && entry === state.adminConfig.masterIp;
            const entryDev = String(entry.deviceCode || entry.rawCode || '').trim().toUpperCase();
            return masterDev
                ? (Boolean(entryDev && entryDev === masterDev) || (Boolean(entry.isMaster) && (!entryDev || entryDev === masterDev)))
                : (Boolean(entry.isMaster) || (!entryDev && Boolean(entry.ip && entry.ip === state.adminConfig.masterIp)));
        };

        const matchesIdentifier = (entry) => {
            if (!entry || !identifier) return false;
            if (typeof entry === 'string') return entry === identifier;
            const deviceCode = String(entry.deviceCode || '').trim().toUpperCase();
            return (entry.token || entry.rawCode || deviceCode || entry.ip) === identifier;
        };
        const targetIdx = itemIndex === -1 ? list.findIndex(matchesIdentifier) : itemIndex;
        if (!Number.isInteger(targetIdx) || !matchesIdentifier(list[targetIdx])) return;

        const item = list[targetIdx];
        if (isEntryMaster(item)) {
            return notify('Không thể thu hồi Master Admin chính.', true);
        }

        const itemToken = typeof item === 'object' ? (item.token || '') : '';
        const itemRaw = typeof item === 'object' ? (item.rawCode || '') : '';
        const itemDev = typeof item === 'object' ? (item.deviceCode || '') : '';
        const itemIp = typeof item === 'object' ? (item.ip || '') : String(item || '');
        const targetLabel = identifier || itemToken || itemDev || itemIp;
        const targetName = typeof item === 'object' ? (item.name || targetLabel) : targetLabel;

        if (!(await confirmDialog({
            title: 'Thu hồi quyền Admin?',
            message: `Bạn có chắc muốn thu hồi quyền Admin của "${targetName}" (${targetLabel})?\nThiết bị này sẽ không thể truy cập trang quản trị nữa.`,
            confirmText: 'Thu hồi quyền',
            variant: 'danger',
            icon: 'fa-user-lock'
        }))) return;

        const currentList = state.adminConfig.allowedIps;
        if (currentList?.[targetIdx] !== item || !matchesIdentifier(currentList[targetIdx]) || isEntryMaster(item)) return;
        state.adminConfig.allowedIps = currentList.filter((_, idx) => idx !== targetIdx);
        await saveAdminConfig();

        state.tokens = (state.tokens || []).filter((t) => {
            if (t.role !== 'admin') return true;
            if (itemToken && t.token === itemToken) return false;
            if (itemRaw && t.rawCode === itemRaw) return false;
            if (itemDev && (t.deviceCode === itemDev || t.rawCode === itemDev)) return false;
            if (!itemToken && !itemRaw && !itemDev && itemIp && t.ip === itemIp) return false;
            return true;
        });
        await saveTokens();

        renderAccess();
        notify(`Đã thu hồi quyền Admin của ${targetName}.`);
    }
    async function toggleMasterIpLock(forceLocked = null) {
        if (!state.clientIp) return notify('Không xác định được IP hiện tại.', true);
        const myDeviceCode = String(state.deviceCode || localStorage.getItem('quiz_device_machine_code') || '').trim().toUpperCase();
        if (!myDeviceCode) return notify('Không xác định được mã máy hiện tại.', true);

        const currentMasterDev = String(state.adminConfig.masterDeviceCode || '').trim().toUpperCase();
        const shouldLock = forceLocked !== null ? Boolean(forceLocked) : !(currentMasterDev && currentMasterDev === myDeviceCode);
        if (!shouldLock) {
            state.adminConfig.masterDeviceCode = '';
            state.adminConfig.masterIp = state.clientIp;
            await saveAdminConfig();
            renderAccess();
            notify('Đã mở khóa theo IP mạng (các máy cùng WiFi sẽ nhận diện Admin theo IP).');
            return;
        }

        const newMasterToken = `${state.clientIp}-${myDeviceCode}`;
        const allowedIps = state.adminConfig.allowedIps;
        const entryDevice = (item) => String(typeof item === 'string' ? item : item?.deviceCode || item?.rawCode || '').trim().toUpperCase();
        let existingIdx = currentMasterDev ? allowedIps.findIndex((item) => entryDevice(item) === currentMasterDev) : -1;
        if (existingIdx < 0) existingIdx = allowedIps.findIndex((item) => item?.isMaster);
        if (existingIdx < 0) existingIdx = allowedIps.findIndex((item) => entryDevice(item) === myDeviceCode);
        if (existingIdx < 0) {
            existingIdx = allowedIps.findIndex((item) => typeof item === 'string'
                ? item === state.clientIp
                : item?.ip === state.clientIp && !item.deviceCode && !item.rawCode && !item.token);
        }
        const oldToken = (existingIdx >= 0 && typeof state.adminConfig.allowedIps[existingIdx] === 'object')
            ? String(state.adminConfig.allowedIps[existingIdx].token || '').trim()
            : '';

        if (existingIdx >= 0) {
            const existing = state.adminConfig.allowedIps[existingIdx];
            state.adminConfig.allowedIps[existingIdx] = typeof existing === 'object'
                ? { ...existing, ip: state.clientIp, deviceCode: myDeviceCode, token: newMasterToken, rawCode: myDeviceCode, isMaster: true, name: existing.name || 'Thiết bị Master' }
                : { ip: state.clientIp, deviceCode: myDeviceCode, token: newMasterToken, rawCode: myDeviceCode, name: 'Thiết bị Master', isMaster: true };
        } else {
            state.adminConfig.allowedIps.push({ ip: state.clientIp, deviceCode: myDeviceCode, token: newMasterToken, rawCode: myDeviceCode, name: 'Thiết bị Master', isMaster: true, addedAt: new Date().toISOString() });
        }

        // Gỡ token Admin cũ (nếu trước đây lỡ gắn mã máy khác như điện thoại) khỏi danh sách ACCESS_TOKENS
        if (oldToken && oldToken.toUpperCase() !== newMasterToken.toUpperCase() && Array.isArray(state.tokens)) {
            const beforeLen = state.tokens.length;
            state.tokens = state.tokens.filter((t) => !(t.role === 'admin' && String(t.token || '').toUpperCase() === oldToken.toUpperCase()));
            if (state.tokens.length !== beforeLen) {
                try { await saveTokens(); } catch (e) {}
            }
        }

        state.adminConfig.masterIp = state.clientIp;
        state.adminConfig.masterDeviceCode = myDeviceCode;
        await saveAdminConfig();
        renderAccess();
        notify(`Đã khóa quyền Master Admin vào mã máy ${myDeviceCode}. Điện thoại cùng WiFi sẽ hiển thị như học sinh bình thường.`);
    }
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
    async function removeAiIp(ip) {
        state.aiIps = state.aiIps.filter((item) => (typeof item === 'string' ? item : item.ip) !== ip);
        const matchingTokens = (state.tokens || []).filter((item) => String(item.ip || '') === String(ip));
        let tokensChanged = false;
        state.tokens = (state.tokens || []).filter((item) => {
            if (String(item.ip || '') !== String(ip)) return true;
            if (item.role === 'ai') { tokensChanged = true; return false; }
            if (item.role === 'all') { item.role = 'grade5'; tokensChanged = true; }
            return true;
        });
        await saveAiIps();
        if (tokensChanged || matchingTokens.length) await saveTokens();
        renderAccess();
        notify('Đã thu hồi quyền AI.');
    }

    async function loadGeo() { const normalizeIp = (ip) => String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase(); const row = await systemRow(SYSTEM.geo); if (row) { try { const data = JSON.parse(row.score_summary || '{}'); state.geo = { mode: data.mode || row.device_info || 'PUBLIC', ips: (data.ips || []).map(normalizeIp).filter(Boolean), grade5Ips: (data.grade5Ips || data.grade5_ips || []).map(normalizeIp).filter(Boolean) }; console.debug('[Quiz Studio Admin] Loaded Grade 5 access config:', { stateGeo: state.geo, raw: data }); } catch (error) { console.warn('[Quiz Studio Admin] Invalid Grade 5 access config:', error.message); } } renderGeo(); }
    function renderGeo() { $('geo-mode-badge') && ($('geo-mode-badge').textContent = state.geo.mode); document.querySelectorAll('[data-geo-mode]').forEach((button) => button.classList.toggle('is-active', button.dataset.geoMode === state.geo.mode)); $('geo-ip-list') && ($('geo-ip-list').innerHTML = state.geo.ips.map((ip) => `<div class="stack-item"><span class="stack-item-icon"><i class="fa-solid fa-location-dot"></i></span><span class="stack-item-main"><b>${esc(ip)}</b><small>Được phép truy cập Địa lý</small></span><button data-remove-geo="${esc(ip)}"><i class="fa-solid fa-xmark"></i></button></div>`).join('') || '<p class="muted-copy">Danh sách IP trống.</p>'); const class5Ips = Array.isArray(state.geo.grade5Ips) ? state.geo.grade5Ips : []; $('class5-ip-count') && ($('class5-ip-count').textContent = `${class5Ips.length} IP`); $('class5-ip-list') && ($('class5-ip-list').innerHTML = class5Ips.map((ip) => `<div class="stack-item"><span class="stack-item-icon"><i class="fa-solid fa-graduation-cap"></i></span><span class="stack-item-main"><b>${esc(ip)}</b><small>Được phép xem Lớp 5</small></span><button data-remove-class5="${esc(ip)}"><i class="fa-solid fa-xmark"></i></button></div>`).join('') || '<p class="muted-copy">Chưa cấp quyền cho IP nào.</p>'); }
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
    async function removeClass5Ip(ip) {
        state.geo.grade5Ips = (state.geo.grade5Ips || []).filter((item) => item !== ip);
        let tokensChanged = false;
        state.tokens = (state.tokens || []).filter((item) => {
            if (String(item.ip || '') !== String(ip)) return true;
            if (item.role === 'grade5') { tokensChanged = true; return false; }
            if (item.role === 'all') { item.role = 'ai'; tokensChanged = true; }
            return true;
        });
        await saveGeo();
        if (tokensChanged) await saveTokens();
        renderAccess();
        notify(`Đã thu hồi quyền Lớp 5 của IP ${ip}.`);
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

    async function banIp(ip, reason = '') { const cleanIp = String(ip || '').trim(); const blocked = new Set(['', 'chưa xác định', '—', 'system', 'all']); const adminIps = new Set([state.clientIp, state.adminConfig?.masterIp, ...(state.adminConfig?.allowedIps || []).map((x) => typeof x === 'string' ? x : x?.ip)].map((x) => String(x || '').trim().toLowerCase())); if (blocked.has(cleanIp.toLowerCase()) || adminIps.has(cleanIp.toLowerCase())) return notify('IP không hợp lệ hoặc là IP quản trị.', true); const cleanReason = reason || 'Vi phạm quy chế ôn tập'; const now = new Date().toISOString(); const { error } = await state.client.from('quiz_logins').upsert({ id: crypto.randomUUID(), player_name: '__BANNED_IP__', ip_address: cleanIp, device_info: 'Manual Ban', status: `BANNED: ${cleanReason}`, score_summary: cleanReason, last_active: now }); if (error) return notify(error.message, true); if ($('ban-ip-input')) $('ban-ip-input').value = ''; if ($('ban-reason-input')) $('ban-reason-input').value = ''; state.lastStudentsBodyHtml = ''; state.lastBannedListHtml = ''; state.lastMonitorStatsHtml = ''; notify(`Đã chặn IP ${cleanIp}.`); await loadStudents(); }
    async function unbanIp(ip) { const cleanIp = String(ip || '').trim(); if (!cleanIp || ['system', 'all', 'chưa xác định', '—'].includes(cleanIp.toLowerCase())) return; const { error } = await state.client.from('quiz_logins').delete().eq('player_name', '__BANNED_IP__').eq('ip_address', cleanIp); if (error) return notify(error.message, true); state.lastStudentsBodyHtml = ''; state.lastBannedListHtml = ''; state.lastMonitorStatsHtml = ''; notify(`Đã mở khóa IP ${cleanIp}.`); await loadStudents(); }

    function bindLoginEvents() {
        $('bootstrap-admin')?.addEventListener('click', () => runAction(bootstrapAdmin));
        $('btn-unlock-admin-token')?.addEventListener('click', () => runAction(unlockAdminWithToken));
        $('admin-token-unlock-input')?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                runAction(unlockAdminWithToken);
            }
        });
    }

    function bindAccessEvents() {
        $('add-admin-ip')?.addEventListener('click', () => addAdminIp().catch((error) => notify(error.message, true)));
        $('master-device-lock-toggle')?.addEventListener('change', (event) => {
            toggleMasterIpLock(Boolean(event.target.checked)).catch((error) => {
                renderAccess();
                notify(error.message, true);
            });
        });
        $('save-master-ip')?.addEventListener('click', () => toggleMasterIpLock().catch((error) => notify(error.message, true)));
        $('admin-ip-list')?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-remove-admin]');
            if (!button) return;
            const index = Number(button.dataset.removeAdminIndex);
            removeAdminIp(button.dataset.removeAdmin, Number.isInteger(index) ? index : -1)
                .catch((error) => notify(error.message, true));
        });
        $('save-roster-config')?.addEventListener('click', () => runAction(saveRosterFromAccessView));
        ['5', '11'].forEach((grade) => $('roster-grade' + grade + '-textarea')?.addEventListener('input', renderRosterConfig));
        $('btn-save-device-pin')?.addEventListener('click', () => runAction(() => saveDevicePin($('device-pin-code-input')?.value, $('device-pin-name-input')?.value)));

        $('btn-add-quick-observer')?.addEventListener('click', () => runAction(addQuickObserver));
        ['quick-observer-ip', 'quick-observer-name'].forEach((id) => {
            $(id)?.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    runAction(addQuickObserver);
                }
            });
        });
        $('copy-parent-link-head')?.addEventListener('click', async (event) => {
            const btn = event.currentTarget || $('copy-parent-link-head');
            const parentItem = (state.tokens || []).find(t => t.role === 'parent' || t.role === 'observer_grade5' || t.role === 'observer');
            const token = parentItem ? parentItem.token : '';
            const link = buildAppUrl(token ? `?token=${encodeURIComponent(token)}&view=progress` : '?view=progress');
            const copied = await copyToClipboard(link);
            if (copied) {
                triggerAdminCopyFeedback(btn, 1500);
                notify('📋 Đã sao chép Link Theo Dõi! Người giám sát chỉ cần bấm link để xem tiến trình học.');
            }
        });

        $('btn-grant-student-access')?.addEventListener('click', () => runAction(grantStudentAccess));
        $('btn-clear-access-subjects')?.addEventListener('click', () => {
            document.querySelectorAll('#student-access-subjects-list input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
        });
        $('btn-fill-current-ip')?.addEventListener('click', () => {
            if ($('student-access-ip')) {
                $('student-access-ip').value = state.clientIp || '';
                notify('Đã lấy IP thiết bị này: ' + (state.clientIp || ''));
            }
        });
    }

    function handleAccessClick(event) {
         const renameBtn = event.target.closest('[data-require-rename-code]');
         if (renameBtn) {
             event.preventDefault(); event.stopPropagation();
             runAction(() => toggleRequireRename(renameBtn.dataset.requireRenameCode, renameBtn.dataset.requireRenameName || ''));
             return true;
         }
          const pinBtn = event.target.closest('[data-pin-device-code][data-pin-device-name]');
         if (pinBtn) {
             event.preventDefault(); event.stopPropagation();
             runAction(async () => {
                 const code = pinBtn.dataset.pinDeviceCode;
                 const suggested = state.devicePins?.[code] || pinBtn.dataset.pinDeviceName || '';
                  const peers = state.progressRecords.flatMap((record) => record._deviceCode === code ? (record._sameIpPeers || []) : []).filter((peer, index, list) => peer.name && list.findIndex((item) => normalizeIdentityKey(item.name) === normalizeIdentityKey(peer.name)) === index);
                  const pinnedNames = Object.values(state.devicePins || {}).filter((item) => item && item !== suggested).map((item) => ({ label: item, value: item, badge: 'Đã ghim' }));
                  const suggestions = [...peers.map((peer) => ({ label: peer.name, value: peer.name, badge: 'Cùng IP' })), ...pinnedNames].filter((item, index, list) => list.findIndex((x) => normalizeIdentityKey(x.value) === normalizeIdentityKey(item.value)) === index).slice(0, 8);
                  const name = await promptDialog({ title: `Ghim tên ${code}`, message: 'Nhập họ và tên chuẩn của học sinh:', defaultValue: suggested, suggestions, placeholder: 'Họ và tên thật của học sinh', confirmText: 'Lưu tên ghim', icon: 'fa-thumbtack' });
                  if (name !== null) await saveDevicePin(code, name);
              });
              return true;
          }
          const mergeBtn = event.target.closest('[data-merge-device-code]');
          if (mergeBtn) {
              event.preventDefault(); event.stopPropagation();
              runAction(async () => {
                  const source = state.progressRecords.find((record) => (mergeBtn.dataset.mergeStudentKey && record.studentKey === mergeBtn.dataset.mergeStudentKey) || record._deviceCode === mergeBtn.dataset.mergeDeviceCode);
                  if (!source) return notify('Không tìm thấy học sinh nguồn để gộp.', true);
                  const peers = source._sameIpPeers || [];
                  const suggestions = peers.map((peer) => ({ label: peer.name, value: peer.name, badge: peer.pinned ? 'Cùng IP · Đã ghim' : 'Cùng IP' }));
                  const defaultValue = peers.find((peer) => peer.pinned)?.name || source.name || '';
                  const targetName = await promptDialog({ title: 'Gộp học sinh cùng IP', message: 'Chọn tên chuẩn để gộp các mã máy cùng IP:', defaultValue, suggestions, placeholder: 'Tên học sinh', confirmText: 'Gộp và ghim tên', icon: 'fa-code-merge' });
                  if (targetName === null) return;
                  const targetKey = normalizeIdentityKey(targetName);
                  const selected = peers.filter((peer) => normalizeIdentityKey(peer.name) === targetKey);
                  const selectedPeers = selected.length ? selected : peers;
                  const codesToMerge = [source._deviceCode, ...selectedPeers.flatMap((peer) => peer.deviceCodes || (peer.deviceCode ? [peer.deviceCode] : []))];
                  await mergeDevicesToName(codesToMerge, targetName);
              });
              return true;
          }
         const unpinBtn = event.target.closest('[data-unpin-device-code]');
         if (unpinBtn) { runAction(() => unpinDevicePin(unpinBtn.dataset.unpinDeviceCode)); return true; }
        const copyAdminLinkBtn = event.target.closest('[data-copy-admin-link]');
        if (copyAdminLinkBtn) {
            const token = copyAdminLinkBtn.dataset.copyAdminLink;
            const link = buildAppUrl(`admin.html?token=${encodeURIComponent(token)}`);
            copyToClipboard(link).then((copied) => {
                if (copied) {
                    triggerAdminCopyFeedback(copyAdminLinkBtn, 1500);
                    notify('👑 Đã sao chép Link Admin trực tiếp! Thiết bị mở link này sẽ vào thẳng Admin mà không cần IP cố định.');
                }
            });
            return true;
        }
        const copyLinkBtn = event.target.closest('[data-copy-token-link]');
        if (copyLinkBtn) {
            copyActivationLink(copyLinkBtn.dataset.copyTokenLink, copyLinkBtn.dataset.tokenName, copyLinkBtn);
            return true;
        }
        const copyCodeBtn = event.target.closest('[data-copy-token-code]');
        if (copyCodeBtn) {
            copyToClipboard(copyCodeBtn.dataset.copyTokenCode).then((copied) => {
                if (copied) {
                    triggerAdminCopyFeedback(copyCodeBtn, 1500);
                    notify('Đã copy mã token ' + copyCodeBtn.dataset.copyTokenCode);
                }
            });
            return true;
        }
        const toggleAiBtn = event.target.closest('[data-toggle-ai]');
        if (toggleAiBtn) {
            runAction(() => toggleStudentAi(toggleAiBtn.dataset.toggleAi));
            return true;
        }
        const toggleG5Btn = event.target.closest('[data-toggle-grade5]');
        if (toggleG5Btn) {
            runAction(() => toggleStudentGrade5(toggleG5Btn.dataset.toggleGrade5));
            return true;
        }
        const assignBtn = event.target.closest('[data-assign-subjects]');
        if (assignBtn) {
            runAction(() => editTokenSubjects(assignBtn.dataset.assignSubjects));
            return true;
        }
        const revokeG5Btn = event.target.closest('[data-revoke-grade5]');
        if (revokeG5Btn) {
            runAction(() => revokeStudentGrade5(revokeG5Btn.dataset.revokeGrade5));
            return true;
        }
        const revokeAiBtn = event.target.closest('[data-revoke-ai]');
        if (revokeAiBtn) {
            runAction(() => revokeStudentAi(revokeAiBtn.dataset.revokeAi));
            return true;
        }
        const copyParentLinkBtn = event.target.closest('[data-copy-parent-link]');
        if (copyParentLinkBtn) {
            const token = copyParentLinkBtn.dataset.copyParentLink;
            const origin = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
                ? (window.location.origin.startsWith('http') ? window.location.origin : 'https://quiz-web-app-rosy.vercel.app')
                : window.location.origin;
            const link = `${origin}/?token=${encodeURIComponent(token)}&view=progress`;
            copyToClipboard(link).then((copied) => {
                if (copied) {
                    triggerAdminCopyFeedback(copyParentLinkBtn, 1500);
                    notify('📋 Đã sao chép Link Quan Sát! Người giám sát chỉ cần bấm link trên điện thoại hoặc máy tính.');
                }
            });
            return true;
        }
        const revokeParentBtn = event.target.closest('[data-revoke-parent]');
        if (revokeParentBtn) {
            runAction(() => removeStudentAccess(revokeParentBtn.dataset.revokeParent));
            return true;
        }
        const removeUnifiedBtn = event.target.closest('[data-remove-unified-access]');
        if (removeUnifiedBtn) {
            runAction(() => removeStudentAccess(removeUnifiedBtn.dataset.removeUnifiedAccess));
            return true;
        }
        const removeTokenBtn = event.target.closest('[data-remove-token]');
        if (removeTokenBtn) {
            runAction(() => removeAccessToken(removeTokenBtn.dataset.removeToken));
            return true;
        }
        const grantTokenBtn = event.target.closest('#students-body [data-grant-token-name]');
        if (grantTokenBtn) {
            runAction(() => handleGrantTokenToStudent(grantTokenBtn.dataset.grantTokenName, grantTokenBtn.dataset.grantTokenIp, grantTokenBtn.dataset.grantTokenDevice));
            return true;
        }
        return false;
    }

    return Object.assign(window.AdminAccess, {
        renderAccess, saveAdminConfig, addAdminIp, grantAdminIp: addAdminIp, removeAdminIp,
        saveMasterIp: toggleMasterIpLock, toggleMasterIpLock, handleGrantTokenToStudent, saveAiIps,
        addAiIp, removeAiIp, bindAccessEvents, handleAccessClick, bindLoginEvents, loadAdminConfig,
        persistRosterPayload, renderQuickObservers, loadRosterConfig,
        saveDevicePin, unpinDevicePin, banIp, unbanIp, mergeDevicesToName, copyAdminIp,
        isCurrentIpAllowed, denyAccess, showAccessScreen, logout, showApp, loadGeo, loadAccess, syncPinnedNamesToLogins,
        bootstrapAdmin, unlockAdminWithToken, observerIsOnline, maskIpAddress, getClientIp
    });
};
