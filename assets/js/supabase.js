/**
 * supabase.js - QuizMaster Pro v4.0
 * Quản lý kết nối Supabase Cloud & LocalStorage Fallback toàn diện:
 * 1. Ghi nhận địa chỉ IP, thiết bị & tự động nhận diện tên học sinh
 * 2. Giám sát thiết bị thời gian thực & Cập nhật thanh tiến độ trực quan
 * 3. Quản lý câu hỏi trực tuyến đa môn học (Thêm/Sửa/Xóa/Import hàng loạt)
 * 4. Chặn IP tức thì & Gửi thông báo khẩn cấp thời gian thực
 * 5. Phân quyền môn Địa Lí 11 (Public/Private theo IP)
 * 6. Chế độ Bảo trì Hệ thống (System Maintenance Mode)
 * 7. Tự động nhận diện IP Admin & Whitelist không cần mật khẩu
 * 8. Quản lý Đa môn học động & Phân kỳ thi linh hoạt
 * 9. Bảng xếp hạng vinh danh (Leaderboard) & Dữ liệu xuất Excel
 * 10. Đóng gói lưu trữ (Archive) & Làm sạch dữ liệu sau kỳ thi
 */

const STORAGE_KEYS = {
    SUPABASE_URL: 'quiz_supabase_url',
    SUPABASE_KEY: 'quiz_supabase_key',
    LOCAL_LOGINS: 'quiz_local_logins_history',
    CUSTOM_QUESTIONS: 'quiz_custom_questions',
    MAX_QUESTION_ID: 'quiz_max_question_id',
    BANNED_IPS: 'quiz_banned_ips',
    MAINTENANCE: 'quiz_maintenance_mode',
    MAINTENANCE_MSG: 'quiz_maintenance_msg',
    ADMIN_IPS_CONFIG: 'quiz_admin_ips_config',
    GEO_CONFIG_CACHE: 'quiz_geo_config_cache',
    DYNAMIC_SUBJECTS: 'quiz_dynamic_subjects',
    ROSTER_CONFIG: 'quiz_roster_config'
};

// Cấu hình mặc định của dự án Supabase Cloud
const DEFAULT_SUPABASE_CONFIG = {
    url: "https://qotfikuiwmruicsvsbgq.supabase.co",
    anonKey: "sb_publishable_KtAmEX6Jj97BNElniBrX6w_wVyCeQYs"
};

// Các ID bản ghi hệ thống cố định trong bảng quiz_logins (RFC4122 UUID)
const SYSTEM_RECORDS = {
    ADMIN_IPS: '00000000-0000-0000-0000-000000000001',
    GEO_CONFIG: '00000000-0000-0000-0000-000000000002',
    MAINTENANCE: '00000000-0000-0000-0000-000000000003',
    DYNAMIC_SUBJECTS: '00000000-0000-0000-0000-000000000004',
    GEMINI_CONFIG: '00000000-0000-0000-0000-000000000005',
    AI_IPS: '00000000-0000-0000-0000-000000000006',
    TRASH: '00000000-0000-0000-0000-000000000007',
    ACCESS_TOKENS: '00000000-0000-0000-0000-000000000008',
    SYSTEM_FOLDERS: '00000000-0000-0000-0000-000000000009',
    ROSTER_CONFIG: '00000000-0000-0000-0000-000000000010'
};

const SYSTEM_UUIDS = SYSTEM_RECORDS;

const SYSTEM_RECORD_IDS = new Set(Object.values(SYSTEM_RECORDS));
const SYSTEM_RECORD_NAMES = new Set([
    '__ADMIN_IPS_CONFIG__',
    '__ALLOWED_GEO_IPS__',
    '__SYSTEM_MAINTENANCE__',
    '__DYNAMIC_SUBJECTS__',
    '__GEMINI_CONFIG__',
    '__AI_IPS_CONFIG__',
    '__TRASH_BIN__',
    '__TRASH_QUESTIONS__',
    '__ACCESS_TOKENS_CONFIG__',
    '__SYSTEM_FOLDERS__',
    '__SYSTEM_NOTICE__',
    '__BANNED_IP__',
    '__SYSTEM_ROSTER__'
]);

const SYSTEM_PLAYER_NAMES = SYSTEM_RECORD_NAMES;
SYSTEM_PLAYER_NAMES.ROSTER_CONFIG = '__SYSTEM_ROSTER__';

const SCHEMA_CAPABILITY_STORAGE_KEY = 'quiz_supabase_missing_columns_v1';
const SCHEMA_CAPABILITY_TTL_MS = 30 * 60 * 1000;
const OPTIONAL_LOGIN_COLUMNS = ['session_id', 'created_at'];
const OPTIONAL_QUESTION_COLUMNS = ['grade', 'accepted_values', 'is_deleted', 'deleted_at', 'created_at', 'updated_at', 'image_url'];

function formatSupabaseUrl(rawUrl) {
    if (!rawUrl) return "";
    return rawUrl.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
}

function getSharedSupabaseClient(rawUrl, rawKey) {
    const cleanUrl = formatSupabaseUrl(rawUrl);
    const cleanKey = String(rawKey || '').trim();
    if (!cleanUrl || !cleanKey) return null;

    const root = typeof window !== 'undefined' ? window : globalThis;
    if (!root.__quizSupabaseClients || typeof root.__quizSupabaseClients !== 'object') {
        root.__quizSupabaseClients = {};
    }
    const cacheKey = `${cleanUrl}::${cleanKey}`;
    if (root.__quizSupabaseClients[cacheKey]) {
        return root.__quizSupabaseClients[cacheKey];
    }
    if (!root.supabase || typeof root.supabase.createClient !== 'function') {
        return null;
    }
    const client = root.supabase.createClient(cleanUrl, cleanKey);
    root.__quizSupabaseClients[cacheKey] = client;
    return client;
}

function extractDeviceCode(deviceInfo) {
    const text = String(deviceInfo || '');
    const match = text.match(/\[(QM-[A-Z0-9]{4,})\]/i) || text.match(/\b(QM-[A-Z0-9]{4,})\b/i);
    return match ? String(match[1]).toUpperCase() : '';
}

function getStudentGroupKey(row) {
    const code = extractDeviceCode(row?.device_info || row?.deviceInfo);
    if (code) return `dev:${code.toLowerCase()}`;
    const ip = String(row?.ip_address || row?.client_ip || '').trim().toLowerCase();
    if (ip && !['chưa xác định', '—', 'system'].includes(ip)) return `ip:${ip}`;
    return `name:${String(row?.player_name || '').trim().toLowerCase()}___dev:${String(row?.device_info || '').trim().toLowerCase()}`;
}

function normalizeRosterConfig(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const normalizeGrade = (grade) => {
        const g = grade && typeof grade === 'object' ? grade : {};
        const seen = new Set();
        const students = (Array.isArray(g.students) ? g.students : []).map((value) => String(value || '').replace(/\s+/g, ' ').trim()).filter((value) => {
            const key = value.toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        return { enabled: Boolean(g.enabled), allowGuestsInPractice: g.allowGuestsInPractice !== false, students };
    };
    const devicePins = {};
    const pins = source.devicePins && typeof source.devicePins === 'object' ? source.devicePins : {};
    Object.entries(pins).forEach(([key, value]) => {
        const name = String(value || '').replace(/\s+/g, ' ').trim();
        if (!name) return;
        const normalizedKey = extractDeviceCode(key);
        if (normalizedKey) devicePins[normalizedKey] = name;
    });
    const renameRequests = {};
    const requests = source.renameRequests && typeof source.renameRequests === 'object' ? source.renameRequests : {};
    Object.entries(requests).forEach(([key, value]) => {
        const normalizedKey = extractDeviceCode(key) || String(key || '').trim().toUpperCase();
        if (!normalizedKey || !value || typeof value !== 'object') return;
        renameRequests[normalizedKey] = {
            requestedAt: String(value.requestedAt || ''),
            oldName: String(value.oldName || '').trim(),
            reason: String(value.reason || '').trim()
        };
    });
    return { grade5: normalizeGrade(source.grade5), grade11: normalizeGrade(source.grade11), devicePins, renameRequests };
}

function getSubjectScheduleState(subject, nowMs) {
    const now = nowMs === undefined
        ? Date.now() + Number(typeof window !== 'undefined' ? window.dbService?.serverClockOffsetMs || 0 : 0)
        : Number(nowMs);
    const parse = (value) => {
        if (!value) return null;
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    };
    const openMs = parse(subject?.openAt);
    const closeMs = parse(subject?.closeAt);
    if (openMs && now < openMs) return { status: 'upcoming', openMs, closeMs: closeMs || null, remainingOpenMs: openMs - now, remainingCloseMs: closeMs ? Math.max(0, closeMs - now) : 0 };
    if (closeMs && now > closeMs) return { status: 'closed', openMs: openMs || null, closeMs, remainingOpenMs: 0, remainingCloseMs: 0 };
    return { status: 'open', openMs: openMs || null, closeMs: closeMs || null, remainingOpenMs: 0, remainingCloseMs: closeMs ? Math.max(0, closeMs - now) : 0 };
}

function isFlashcardEnabledForSubject(subject, nowMs) {
    if (getSubjectScheduleState(subject, nowMs).status === 'upcoming') return false;
    const mode = String(subject?.flashcardMode || 'auto').toLowerCase();
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    return String(subject?.mode || '').toLowerCase() !== 'exam';
}

if (typeof window !== 'undefined') {
    window.getSharedSupabaseClient = getSharedSupabaseClient;
    window.QUIZ_SYSTEM_RECORDS = SYSTEM_RECORDS;
    window.SYSTEM_ROSTER_ID = SYSTEM_RECORDS.ROSTER_CONFIG;
    window.extractDeviceCode = extractDeviceCode;
    window.getStudentGroupKey = getStudentGroupKey;
    window.normalizeRosterConfig = normalizeRosterConfig;
    window.getSubjectScheduleState = getSubjectScheduleState;
    window.isFlashcardEnabledForSubject = isFlashcardEnabledForSubject;
}

class DatabaseService {
    constructor() {
        this.client = null;
        this.isSupabaseActive = false;
        this.serverClockOffsetMs = 0;
        this._missingColumnsCache = new Map();
        this._skipSessionIdColumn = false;
        this.init();
    }

    init() {
        let storedUrl = localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || DEFAULT_SUPABASE_CONFIG.url;
        const storedKey = localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || DEFAULT_SUPABASE_CONFIG.anonKey;

        storedUrl = formatSupabaseUrl(storedUrl);
        this.url = storedUrl;
        this.anonKey = storedKey;
        this._loadMissingColumnsCache();
        this._skipSessionIdColumn = this._isColumnMissing('quiz_logins', 'session_id');

        if (storedUrl && storedKey && typeof window !== 'undefined' && window.supabase) {
            try {
                this.client = getSharedSupabaseClient(storedUrl, storedKey);
                this.isSupabaseActive = Boolean(this.client);
                if (this.isSupabaseActive) {
                    this.syncServerClock();
                    console.log("%c[DatabaseService] QuizMaster Pro v4.0 - Đã kích hoạt Supabase Cloud!", "color: #10b981; font-weight: bold;");
                }
            } catch (err) {
                console.warn("[DatabaseService] Lỗi kết nối Supabase, fallback về Local:", err);
                this.client = null;
                this.isSupabaseActive = false;
            }
        } else {
            this.client = null;
            this.isSupabaseActive = false;
        }
    }

    _schemaScopeKey() {
        return formatSupabaseUrl(this.url) || '__default__';
    }

    _loadMissingColumnsCache() {
        this._missingColumnsCache = new Map();
        if (typeof sessionStorage === 'undefined') return;
        try {
            const raw = sessionStorage.getItem(SCHEMA_CAPABILITY_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            const scoped = parsed && typeof parsed === 'object' ? parsed[this._schemaScopeKey()] : null;
            if (!scoped || typeof scoped !== 'object') return;
            const now = Date.now();
            let pruned = false;
            for (const [colKey, expiresAt] of Object.entries(scoped)) {
                if (Number(expiresAt) > now) {
                    this._missingColumnsCache.set(colKey, Number(expiresAt));
                } else {
                    pruned = true;
                }
            }
            if (pruned) this._persistMissingColumnsCache();
        } catch (e) {}
    }

    _persistMissingColumnsCache() {
        if (typeof sessionStorage === 'undefined') return;
        try {
            const raw = sessionStorage.getItem(SCHEMA_CAPABILITY_STORAGE_KEY);
            const allScopes = raw ? JSON.parse(raw) : {};
            const nextStore = (allScopes && typeof allScopes === 'object' && !Array.isArray(allScopes)) ? allScopes : {};
            const now = Date.now();
            const scopedObj = {};
            for (const [colKey, expiresAt] of this._missingColumnsCache.entries()) {
                if (Number(expiresAt) > now) {
                    scopedObj[colKey] = Number(expiresAt);
                } else {
                    this._missingColumnsCache.delete(colKey);
                }
            }
            const scopeKey = this._schemaScopeKey();
            if (Object.keys(scopedObj).length > 0) {
                nextStore[scopeKey] = scopedObj;
            } else {
                delete nextStore[scopeKey];
            }
            if (Object.keys(nextStore).length > 0) {
                sessionStorage.setItem(SCHEMA_CAPABILITY_STORAGE_KEY, JSON.stringify(nextStore));
            } else {
                sessionStorage.removeItem(SCHEMA_CAPABILITY_STORAGE_KEY);
            }
        } catch (e) {}
    }

    _clearMissingColumnsCache() {
        this._missingColumnsCache.clear();
        this._skipSessionIdColumn = false;
        if (typeof sessionStorage === 'undefined') return;
        try {
            const raw = sessionStorage.getItem(SCHEMA_CAPABILITY_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                delete parsed[this._schemaScopeKey()];
                if (Object.keys(parsed).length > 0) {
                    sessionStorage.setItem(SCHEMA_CAPABILITY_STORAGE_KEY, JSON.stringify(parsed));
                } else {
                    sessionStorage.removeItem(SCHEMA_CAPABILITY_STORAGE_KEY);
                }
            }
        } catch (e) {}
    }

    _isColumnMissing(tableName, columnName) {
        const key = `${tableName}.${columnName}`;
        if (tableName === 'quiz_logins' && columnName === 'session_id' && this._skipSessionIdColumn) {
            return true;
        }
        const expiresAt = this._missingColumnsCache.get(key);
        if (!expiresAt) return false;
        if (expiresAt <= Date.now()) {
            this._missingColumnsCache.delete(key);
            this._persistMissingColumnsCache();
            return false;
        }
        return true;
    }

    _markColumnMissing(tableName, columnName, ttlMs = SCHEMA_CAPABILITY_TTL_MS) {
        if (!tableName || !columnName) return;
        const key = `${tableName}.${columnName}`;
        this._missingColumnsCache.set(key, Date.now() + ttlMs);
        if (tableName === 'quiz_logins' && columnName === 'session_id') {
            this._skipSessionIdColumn = true;
        }
        this._persistMissingColumnsCache();
    }

    _isMissingColumnError(error) {
        if (!error) return false;
        const code = String(error.code || '').trim();
        if (code === '42703' || code === 'PGRST204') return true;
        const text = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
        return /column .* does not exist|could not find the '[^']+' column/i.test(text);
    }

    _extractMissingColumn(error, candidateColumns = []) {
        const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
        const patterns = [
            /Could not find the '([^']+)' column/i,
            /column\s+"([^"]+)"\s+of\s+relation/i,
            /column\s+(?:[a-z0-9_]+\.)?([a-z0-9_]+)\s+does\s+not\s+exist/i,
            /column\s+'([^']+)'/i
        ];
        for (const re of patterns) {
            const m = text.match(re);
            if (m && m[1]) return m[1].trim();
        }
        for (const col of candidateColumns) {
            if (new RegExp(`\\b${col}\\b`, 'i').test(text)) return col;
        }
        return '';
    }

    _stripColumnsFromPayload(payloadOrRows, colsToStrip = []) {
        const stripSet = new Set(colsToStrip || []);
        const cloneRow = (row) => {
            if (!row || typeof row !== 'object') return row;
            if (stripSet.size === 0) return { ...row };
            const copy = {};
            for (const [k, v] of Object.entries(row)) {
                if (!stripSet.has(k)) copy[k] = v;
            }
            return copy;
        };
        return Array.isArray(payloadOrRows) ? payloadOrRows.map(cloneRow) : cloneRow(payloadOrRows);
    }

    async _executeWriteWithSchemaFallback(tableName, optionalColumns, writeFn, payloadOrRows) {
        const knownMissing = optionalColumns.filter((col) => this._isColumnMissing(tableName, col));
        let current = this._stripColumnsFromPayload(payloadOrRows, knownMissing);
        const hasCol = (col) => Array.isArray(current)
            ? current.some((row) => row && Object.prototype.hasOwnProperty.call(row, col))
            : Boolean(current && Object.prototype.hasOwnProperty.call(current, col));

        let res = await writeFn(current);
        for (let attempt = 0; attempt < optionalColumns.length + 1; attempt++) {
            if (!res?.error || !this._isMissingColumnError(res.error)) {
                return res;
            }
            const missingCol = this._extractMissingColumn(res.error, optionalColumns);
            if (missingCol && hasCol(missingCol)) {
                this._markColumnMissing(tableName, missingCol);
                current = this._stripColumnsFromPayload(current, [missingCol]);
                console.warn(`[DatabaseService] Bảng ${tableName} chưa có cột '${missingCol}'; đã lưu cache bỏ qua cho schema cũ.`);
                res = await writeFn(current);
                continue;
            }
            const remainingOptional = optionalColumns.filter((col) => hasCol(col) && new RegExp(`\\b${col}\\b`, 'i').test(`${res.error?.message || ''} ${res.error?.details || ''} ${res.error?.hint || ''}`));
            if (remainingOptional.length === 0) {
                return res;
            }
            for (const col of remainingOptional) {
                this._markColumnMissing(tableName, col);
            }
            current = this._stripColumnsFromPayload(current, remainingOptional);
            console.warn(`[DatabaseService] Bảng ${tableName} thiếu cột tùy chọn; chuyển sang payload schema cũ:`, remainingOptional);
            res = await writeFn(current);
        }
        return res;
    }

    isSystemLoginRecord(row) {
        if (!row || typeof row !== 'object') return false;
        const id = String(row.id || '').trim();
        if (id && SYSTEM_RECORD_IDS.has(id)) return true;
        const name = String(row.player_name || '').trim();
        if (name && (name.startsWith('__') || SYSTEM_PLAYER_NAMES.has(name.toUpperCase()))) return true;
        if (String(row.ip_address || '').trim().toUpperCase() === 'SYSTEM') return true;
        return false;
    }

    isSystemRecord(row) {
        return this.isSystemLoginRecord(row);
    }

    async fetchLogins(limit = 300, options = {}) {
        return this.getLoginHistory(limit, options);
    }

    isVisitorLoginRecord(row) {
        if (!row || typeof row !== 'object') return false;
        const name = String(row.player_name || '').trim();
        return !name || /^(khách truy cập|visitor)$/i.test(name);
    }

    async syncServerClock() {
        if (!this.url || !this.anonKey) return;
        let timeoutId;
        try {
            const t0 = Date.now();
            let signal;
            if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
                signal = AbortSignal.timeout(4000);
            } else if (typeof AbortController !== 'undefined') {
                const controller = new AbortController();
                timeoutId = setTimeout(() => controller.abort(), 4000);
                signal = controller.signal;
            }
            const res = await fetch(`${this.url}/rest/v1/quiz_questions?select=id&limit=1`, {
                method: 'HEAD',
                headers: { apikey: this.anonKey },
                signal
            });
            const dateHeader = res.headers?.get('date');
            if (dateHeader) {
                const serverMs = new Date(dateHeader).getTime();
                const t1 = Date.now();
                const midClientMs = Math.round((t0 + t1) / 2);
                if (!Number.isNaN(serverMs) && Math.abs(serverMs - midClientMs) > 60000) {
                    this.serverClockOffsetMs = serverMs - midClientMs;
                    console.debug('[DatabaseService] Đã hiệu chuẩn lệch đồng hồ thiết bị:', { offsetMinutes: Math.round(this.serverClockOffsetMs / 60000) });
                } else {
                    this.serverClockOffsetMs = 0;
                }
            }
        } catch (e) {
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }

    getNowIso() {
        return new Date(Date.now() + (this.serverClockOffsetMs || 0)).toISOString();
    }

    _isMissingRpcError(error) {
        if (!error) return false;
        const code = String(error.code || '').trim();
        if (code === 'PGRST202' || code === '42883') return true;
        const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
        return /Could not find the function|function .* does not exist/i.test(msg);
    }

    getAdminSessionToken() {
        const now = Date.now();
        try {
            const legacy = localStorage.getItem('quiz_admin_session_token');
            if (legacy) {
                const cleanLegacy = String(legacy).trim();
                localStorage.removeItem('quiz_admin_session_token');
                if (cleanLegacy && !sessionStorage.getItem('quiz_admin_session_token')) {
                    this.setAdminSessionToken(cleanLegacy);
                }
            }
        } catch (e) {}

        let token = '';
        let expMs = 0;
        try {
            token = sessionStorage.getItem('quiz_admin_session_token') || '';
            expMs = Number(sessionStorage.getItem('quiz_admin_session_expires_at') || 0);
        } catch (e) {
            token = this._adminSessionTokenMemory || '';
            expMs = Number(this._adminSessionExpiresAt || 0);
        }
        if (!token) return '';
        if (expMs > 0 && now >= expMs) {
            this.setAdminSessionToken('');
            return '';
        }
        return token;
    }

    setAdminSessionToken(token, expiresAt = null) {
        const clean = String(token || '').trim();
        const defaultTtlMs = 12 * 60 * 60 * 1000;
        const parsedExp = expiresAt ? Date.parse(expiresAt) : NaN;
        const expMs = Number.isFinite(parsedExp) && parsedExp > Date.now() ? parsedExp : (Date.now() + defaultTtlMs);
        this._adminSessionTokenMemory = clean;
        this._adminSessionExpiresAt = clean ? expMs : 0;
        try { localStorage.removeItem('quiz_admin_session_token'); } catch (e) {}
        try {
            if (clean) {
                sessionStorage.setItem('quiz_admin_session_token', clean);
                sessionStorage.setItem('quiz_admin_session_expires_at', String(expMs));
            } else {
                sessionStorage.removeItem('quiz_admin_session_token');
                sessionStorage.removeItem('quiz_admin_session_expires_at');
            }
        } catch (e) {}
    }

    async verifyAdminLogin(credentialsOrPassword, clientIp = '') {
        const opts = (credentialsOrPassword && typeof credentialsOrPassword === 'object')
            ? credentialsOrPassword
            : { password: credentialsOrPassword, ip: clientIp };
        const p_password = opts.password ? String(opts.password) : null;
        const p_admin_token = opts.token || opts.adminToken || this.getAdminSessionToken() || null;
        const p_ip = String(opts.ip || clientIp || '').trim();

        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client.rpc('admin_verify_login', {
                    p_password,
                    p_admin_token,
                    p_ip
                });
                if (!error && data) {
                    if (data.valid && data.token) {
                        this.setAdminSessionToken(data.token, data.expires_at || null);
                    } else if (!data.valid) {
                        this.setAdminSessionToken('');
                    }
                    return {
                        valid: Boolean(data.valid),
                        token: data.token || '',
                        expiresAt: data.expires_at || null,
                        label: data.label || 'Admin',
                        error: data.error || ''
                    };
                }
                if (error && !this._isMissingRpcError(error)) {
                    return { valid: false, error: error.message || 'Xác thực quản trị thất bại.' };
                }
            } catch (err) {
                return { valid: false, error: err?.message || 'Lỗi kết nối xác thực quản trị.' };
            }
        }

        // Fallback cho môi trường chưa chạy supabase_security_migration.sql (chỉ kiểm tra IP / token)
        if (p_ip) {
            const isIpAdmin = await this.checkIsAdminIp(p_ip);
            if (isIpAdmin) return { valid: true, token: p_admin_token || '', label: 'IP Admin' };
        }
        if (p_admin_token) {
            const matched = await this.verifyAccessToken(p_admin_token, p_ip);
            if (matched && matched.role === 'admin') {
                return { valid: true, token: p_admin_token, label: 'Token Admin' };
            }
        }
        return { valid: false, error: 'Chưa chạy supabase_security_migration.sql hoặc thông tin đăng nhập không hợp lệ.' };
    }

    async logoutAdmin() {
        const token = this.getAdminSessionToken();
        this.setAdminSessionToken('');
        if (this.isSupabaseActive && this.client && token) {
            try {
                await this.client.rpc('admin_logout', { p_admin_token: token });
            } catch (e) {}
        }
    }

    async callGeminiProxy(payload, options = {}) {
        const endpoint = options.endpoint
            || (typeof window !== 'undefined' && window.__QUIZ_CONFIG__?.geminiProxyUrl)
            || '/api/gemini';
        const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            throw new Error(data?.error || `Gemini proxy error (${resp.status})`);
        }
        return data;
    }

    saveConfig(url, anonKey) {
        if (!url || !anonKey) {
            throw new Error("Vui lòng nhập đầy đủ Project URL và Anon Public Key.");
        }
        this._clearMissingColumnsCache();
        localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, formatSupabaseUrl(url));
        localStorage.setItem(STORAGE_KEYS.SUPABASE_KEY, anonKey.trim());
        this.init();
    }

    clearConfig() {
        this._clearMissingColumnsCache();
        localStorage.removeItem(STORAGE_KEYS.SUPABASE_URL);
        localStorage.removeItem(STORAGE_KEYS.SUPABASE_KEY);
        this.init();
    }

    getConfig() {
        return {
            url: localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || DEFAULT_SUPABASE_CONFIG.url,
            anonKey: localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || DEFAULT_SUPABASE_CONFIG.anonKey,
            isActive: this.isSupabaseActive
        };
    }

    async fetchRosterConfig() {
        let raw = null;
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client.rpc('public_get_roster_config');
                if (!error && data !== null && data !== undefined) raw = typeof data === 'string' ? JSON.parse(data) : data;
            } catch (e) {}
            if (!raw) {
                try {
                    const { data, error } = await this.client.from('quiz_logins').select('score_summary').eq('id', SYSTEM_RECORDS.ROSTER_CONFIG).maybeSingle();
                    if (!error && data?.score_summary) raw = JSON.parse(data.score_summary);
                } catch (e) {}
            }
        }
        if (!raw) {
            try {
                const cached = localStorage.getItem(STORAGE_KEYS.ROSTER_CONFIG);
                if (cached) raw = JSON.parse(cached);
            } catch (e) {}
        }
        const normalized = normalizeRosterConfig(raw);
        try { localStorage.setItem(STORAGE_KEYS.ROSTER_CONFIG, JSON.stringify(normalized)); } catch (e) {}
        return normalized;
    }

    async saveRosterConfig(config) {
        const normalized = normalizeRosterConfig(config);
        const payload = {
            id: SYSTEM_RECORDS.ROSTER_CONFIG,
            player_name: '__SYSTEM_ROSTER__',
            ip_address: 'SYSTEM',
            device_info: 'ROSTER_CONFIG',
            status: 'ACTIVE',
            score_summary: JSON.stringify(normalized),
            last_active: this.getNowIso()
        };
        if (this.isSupabaseActive && this.client) {
            const { error } = await this.client.from('quiz_logins').upsert([payload], { onConflict: 'id' });
            if (error) throw new Error(`Không thể lưu cấu hình roster lên Supabase: ${error.message || error.details || 'Lỗi không xác định'}`);
        }
        try { localStorage.setItem(STORAGE_KEYS.ROSTER_CONFIG, JSON.stringify(normalized)); } catch (e) {}
        return normalized;
    }

    async renameDeviceHistory(deviceCode, newName) {
        const upperCode = extractDeviceCode('[' + String(deviceCode || '').trim() + ']') || String(deviceCode || '').trim().toUpperCase().replace(/^\[|\]$/g, '');
        const cleanName = String(newName || '').trim().replace(/\s+/g, ' ');
        if (!/^QM-[A-Z0-9]{4,}$/i.test(upperCode) || !validateStudentName(cleanName).valid || cleanName.startsWith('__')) {
            return { ok: false, updatedCount: 0, error: 'Tên hoặc mã máy không hợp lệ' };
        }
        let updatedCount = 0;
        if (this.isSupabaseActive && this.client) {
            const ids = [];
            const pageSize = 500;
            for (let from = 0; ; from += pageSize) {
                const { data, error } = await this.client.from('quiz_logins')
                    .select('id, player_name, status, ip_address')
                    .ilike('device_info', '%[' + upperCode + ']%')
                    .range(from, from + pageSize - 1);
                if (error) throw error;
                const rows = Array.isArray(data) ? data : [];
                rows.forEach((row) => {
                    if (SYSTEM_RECORD_IDS.has(row.id) || String(row.player_name || '').startsWith('__') || String(row.ip_address || '').trim() === 'SYSTEM' || /^BANNED/i.test(String(row.status || ''))) return;
                    if (String(row.player_name || '') !== cleanName) ids.push(row.id);
                });
                if (rows.length < pageSize) break;
            }
            for (let i = 0; i < ids.length; i += 50) {
                const chunk = ids.slice(i, i + 50);
                if (!chunk.length) continue;
                const { error } = await this.client.from('quiz_logins').update({ player_name: cleanName, last_active: this.getNowIso() }).in('id', chunk);
                if (error) throw error;
                updatedCount += chunk.length;
            }
        }
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_LOGINS);
            const localLogs = raw ? JSON.parse(raw) : [];
            let changed = false;
            if (Array.isArray(localLogs)) {
                localLogs.forEach((row) => {
                    if (extractDeviceCode(row?.device_info || row?.deviceInfo) !== upperCode) return;
                    if (SYSTEM_RECORD_IDS.has(row.id) || String(row.player_name || '').startsWith('__') || String(row.ip_address || '').trim() === 'SYSTEM' || /^BANNED/i.test(String(row.status || ''))) return;
                    if (String(row.player_name || '') !== cleanName) { row.player_name = cleanName; row.last_active = this.getNowIso(); changed = true; }
                });
                if (changed) localStorage.setItem(STORAGE_KEYS.LOCAL_LOGINS, JSON.stringify(localLogs));
            }
        } catch (e) {}
        return { ok: true, updatedCount };
    }

    /**
     * Tạo mã UUID v4 chuẩn RFC4122 (tránh lỗi null value in column "id" trên PostgreSQL)
     */
    generateUUID() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            try {
                return crypto.randomUUID();
            } catch (e) {}
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // =========================================================================
    // PHẦN 1: GHI NHẬN ĐĂNG NHẬP, GIÁM SÁT THỜI GIAN THỰC & TIẾN ĐỘ HỌC SINH
    // =========================================================================

    /**
     * Ghi nhận lượt đăng nhập (IP, Tên, Thiết bị, Trạng thái)
     * Hỗ trợ cả 2 dạng gọi: recordLogin(object) hoặc recordLogin(name, ip, device, subject)
     * Có thể truyền { newAttempt: true } ở tham số cuối để luôn tạo lượt mới.
     */
    async recordLogin(data, ipAddress, deviceInfo, subjectTitle, scoreSummaryParam = "", existingLoginId = null, options = {}) {
        let recordOptions = options && typeof options === 'object' ? options : {};
        if (existingLoginId && typeof existingLoginId === 'object') {
            recordOptions = existingLoginId;
            existingLoginId = null;
        }
        let cleanName = "";
        let cleanIp = "Chưa xác định";
        let cleanDevice = "Trình duyệt Web";
        let status = "Đang làm bài";
        let scoreSummary = "";
        let targetLoginId = existingLoginId || null;
        let explicitAttemptId = '';
        let clientSessionId = '';
        let isVisitorSession = false;
        let hasExplicitNewAttemptFalse = false;

        if (typeof data === 'object' && data !== null) {
            cleanName = (data.playerName || data.name || "").trim();
            cleanIp = (data.ipAddress || data.clientIp || ipAddress || "").trim();
            cleanDevice = (data.deviceInfo || deviceInfo || "Trình duyệt Web").trim();
            status = data.status || (/trang chủ|đang chờ/i.test(String(data.status || data.subjectTitle || '')) ? 'Đang xem trang chủ' : "Đang làm bài");
            scoreSummary = data.scoreSummary || (data.subjectTitle ? `Môn: ${data.subjectTitle}` : "");
            targetLoginId = data.loginId || data.id || existingLoginId || null;
            explicitAttemptId = String(data?.attemptId || recordOptions.attemptId || '').trim();
            clientSessionId = String(data?.sessionId || recordOptions.sessionId || '').trim();
        } else {
            cleanName = String(data || "").trim();
            cleanIp = String(ipAddress || "").trim();
            cleanDevice = String(deviceInfo || "Trình duyệt Web").trim();
            status = "Đang làm bài";
            scoreSummary = subjectTitle ? `[${subjectTitle}] Bắt đầu làm bài` : "";
            if (typeof scoreSummaryParam === 'string' && scoreSummaryParam.trim()) {
                scoreSummary = scoreSummaryParam.trim();
            }
            if (existingLoginId) {
                targetLoginId = existingLoginId;
            }
            explicitAttemptId = String(recordOptions.attemptId || '').trim();
            clientSessionId = String(recordOptions.sessionId || '').trim();
        }

        isVisitorSession = Boolean(data?.isVisitor || recordOptions.isVisitor || /^visitor_/i.test(clientSessionId) || /trang chủ|đang chờ/i.test(String(data?.status || data?.subjectTitle || status || '')));
        hasExplicitNewAttemptFalse = (recordOptions.newAttempt === false || data?.newAttempt === false);
        const forceNewAttempt = !isVisitorSession && !hasExplicitNewAttemptFalse && Boolean(recordOptions.newAttempt === true || data?.newAttempt === true || explicitAttemptId);

        if (forceNewAttempt) targetLoginId = null;

        if (!cleanName) cleanName = "Khách truy cập";
        if (!cleanIp || cleanIp === "Đang nhận diện..." || cleanIp === "—") cleanIp = "Chưa xác định";
        if (!cleanDevice || cleanDevice === "—" || cleanDevice === "Chưa rõ") cleanDevice = "Trình duyệt Web";

        let sessionId = '';
        try {
            sessionId = sessionStorage.getItem('quiz_presence_session') || '';
            if (!sessionId) {
                sessionId = this.generateUUID();
                sessionStorage.setItem('quiz_presence_session', sessionId);
            }
        } catch (e) {
            sessionId = `fallback_${cleanIp}_${cleanName}`.replace(/[^a-z0-9_.-]/gi, '_');
        }

        const nowIso = this.getNowIso();

        const record = {
            player_name: cleanName,
            ip_address: cleanIp,
            device_info: cleanDevice,
            status: status,
            score_summary: scoreSummary,
            session_id: explicitAttemptId || clientSessionId || sessionId,
            last_active: nowIso,
            created_at: nowIso
        };
        const isVisitorAttempt = isVisitorSession || String(record.session_id || '').startsWith('visitor_');
        const isExamAttemptRow = (r) => /^\[/.test(String(r?.status || ''))
            || /điểm|__DETAIL__|tiến độ|chờ nộp bài|đã nộp bài/i.test(`${r?.status || ''} ${r?.score_summary || ''}`);
        const isIncomingExam = isExamAttemptRow(record);

        // 1. Lưu LocalStorage tức thì
        try {
            const isGenericVisitor = /^(khách truy cập|visitor)$/i.test(cleanName);
            if (!isGenericVisitor) localStorage.setItem('quiz_saved_player_name', cleanName);
            localStorage.setItem('quiz_saved_ip', cleanIp);
            if (cleanIp !== "Chưa xác định") {
                if (!isGenericVisitor) localStorage.setItem(`quiz_ip_map_${cleanIp}`, cleanName);
            }

            let localLogs = this._getLocalLogins();
            record.id = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            const normName = cleanName.toLowerCase();
            const incomingDeviceCode = extractDeviceCode(cleanDevice);
            const existingLocal = forceNewAttempt ? null : localLogs.find((item) => {
                if ((isVisitorAttempt || !isIncomingExam) && isExamAttemptRow(item)) return false;
                if (isVisitorAttempt) return item.session_id === record.session_id;
                const itemName = String(item.player_name || '').trim().toLowerCase();
                if (incomingDeviceCode && extractDeviceCode(item.device_info) === incomingDeviceCode
                    && (!normName || normName === 'khách truy cập' || !itemName || itemName === normName || /^(khách truy cập|visitor)$/i.test(itemName))) return true;
                if (normName && normName !== 'khách truy cập' && itemName === normName) return true;
                return item.session_id === sessionId || (cleanIp !== 'Chưa xác định' && item.ip_address === cleanIp && itemName === normName);
            });
            if (existingLocal) {
                const preservedSummary = scoreSummary || existingLocal.score_summary || '';
                const preservedStatus = String(existingLocal.status || '').startsWith('BANNED') ? existingLocal.status : status;
                Object.assign(existingLocal, record, { id: existingLocal.id, status: preservedStatus, score_summary: preservedSummary, created_at: existingLocal.created_at || nowIso });
                record.id = existingLocal.id;
            } else {
                localLogs.unshift(record);
            }
            localStorage.setItem(STORAGE_KEYS.LOCAL_LOGINS, JSON.stringify(localLogs.slice(0, 100)));
        } catch (e) {}

        // 2. Lưu Supabase Cloud cho Admin giám sát (Cập nhật đúng bản ghi của thiết bị này, không ghi đè máy khác)
        if (this.isSupabaseActive && this.client) {
            try {
                let existingRows = [];
                const normDev = String(cleanDevice || '').trim().toLowerCase();
                const deviceCode = extractDeviceCode(cleanDevice);

                // 1. Nếu client đã lưu sẵn loginId của chính máy mình -> truy vấn trực tiếp theo ID
                if (!forceNewAttempt && targetLoginId && !String(targetLoginId).startsWith('local_')) {
                    const { data: byId } = await this.client
                        .from('quiz_logins')
                         .select('id, player_name, ip_address, device_info, status, score_summary, last_active')
                        .eq('id', targetLoginId)
                        .limit(1);
                    if (Array.isArray(byId) && byId.length > 0) {
                        existingRows = byId.filter((r) =>
                            !this.isSystemLoginRecord(r)
                            && (!(isVisitorAttempt || !isIncomingExam) || !isExamAttemptRow(r))
                        );
                    }
                }

                // 2. Tìm lại bản ghi hiện diện/chờ cùng tên hoặc cùng IP chưa đăng nhập (chỉ tái sử dụng dòng non-exam).
                if (!forceNewAttempt && existingRows.length === 0) {
                    if (deviceCode) {
                        const { data: byDevice } = await this.client
                            .from('quiz_logins')
                            .select('id, player_name, ip_address, device_info, status, score_summary, last_active')
                            .ilike('device_info', `%${deviceCode}%`)
                            .order('last_active', { ascending: false })
                            .limit(30);
                        if (Array.isArray(byDevice)) {
                            const incomingName = String(cleanName || '').trim().toLowerCase();
                            existingRows = byDevice.filter((r) => {
                                const rowName = String(r.player_name || '').trim().toLowerCase();
                                return !this.isSystemLoginRecord(r)
                                    && !isExamAttemptRow(r)
                                    && (isVisitorAttempt || !isIncomingExam)
                                    && (!incomingName || incomingName === 'khách truy cập' || !rowName || rowName === incomingName || /^(khách truy cập|visitor)$/i.test(rowName));
                            });
                        }
                    }
                }
                if (!forceNewAttempt && existingRows.length === 0) {
                    if (cleanName && cleanName.toLowerCase() !== 'khách truy cập') {
                        const { data: byName } = await this.client
                            .from('quiz_logins')
                             .select('id, player_name, ip_address, device_info, status, score_summary, last_active')
                             .ilike('player_name', String(cleanName).replace(/[\\%_]/g, '\\$&'))
                            .order('last_active', { ascending: false })
                            .limit(30);
                        if (Array.isArray(byName)) {
                            existingRows = byName.filter((r) =>
                                !this.isSystemLoginRecord(r)
                                && (!(isVisitorAttempt || !isIncomingExam) || !isExamAttemptRow(r))
                            );
                        }
                    } else if (!isIncomingExam && cleanIp && cleanIp !== 'Chưa xác định' && cleanIp !== '—') {
                        const { data: byIp } = await this.client
                            .from('quiz_logins')
                             .select('id, player_name, ip_address, device_info, status, score_summary, last_active')
                            .eq('ip_address', cleanIp)
                             .order('last_active', { ascending: false })
                             .limit(20);
                        if (Array.isArray(byIp)) {
                            existingRows = byIp.filter((r) =>
                                !this.isSystemLoginRecord(r)
                                && !isExamAttemptRow(r)
                                && (String(r.device_info || '').trim().toLowerCase() === normDev || /^(khách truy cập|visitor)$/i.test(String(r.player_name || '')))
                            );
                        }
                    }
                }

                if (!forceNewAttempt && existingRows.length === 0 && isIncomingExam && explicitAttemptId && !this._isColumnMissing('quiz_logins', 'session_id')) {
                    const { data: byAttempt } = await this.client.from('quiz_logins')
                        .select('id, player_name, ip_address, device_info, status, score_summary, last_active')
                        .eq('session_id', explicitAttemptId).limit(10);
                    if (Array.isArray(byAttempt)) existingRows = byAttempt.filter((r) => !this.isSystemLoginRecord(r));
                }
                if (!forceNewAttempt && existingRows.length === 0 && !isIncomingExam && cleanIp !== 'Chưa xác định' && cleanIp !== '—') {
                    const { data: byPresenceIp } = await this.client.from('quiz_logins')
                        .select('id, player_name, ip_address, device_info, status, score_summary, last_active')
                        .eq('ip_address', cleanIp).order('last_active', { ascending: false }).limit(50);
                    if (Array.isArray(byPresenceIp)) {
                        const candidates = byPresenceIp.filter((r) => !this.isSystemLoginRecord(r) && !isExamAttemptRow(r));
                        existingRows = candidates.filter((r) => String(r.device_info || '').trim().toLowerCase() === normDev || /^(khách truy cập|visitor)$/i.test(String(r.player_name || '')));
                        if (!existingRows.length) existingRows = candidates.slice(0, 1);
                    }
                }

                // Lọc đúng thiết bị này (cleanDevice) để cập nhật, bảo toàn thiết bị khác khi mở cùng lúc
                const deviceMatchedRows = (!forceNewAttempt && targetLoginId && existingRows.length > 0 && existingRows[0].id === targetLoginId)
                    ? existingRows
                    : existingRows.filter((r) => {
                        const rDev = String(r.device_info || '').trim().toLowerCase();
                        return rDev === normDev || (deviceCode && extractDeviceCode(r.device_info) === deviceCode);
                    });
                const sameDeviceRows = (isVisitorAttempt || !isIncomingExam)
                    ? deviceMatchedRows.filter((r) => !isExamAttemptRow(r))
                    : deviceMatchedRows;

                if (!forceNewAttempt && sameDeviceRows.length > 0) {
                    const targetRow = sameDeviceRows[0];
                    const existingBanned = sameDeviceRows.find((r) => String(r.status || '').startsWith('BANNED'));
                    const existingScored = sameDeviceRows.find((r) => /điểm/i.test(String(r.score_summary || '')));
                    const nextStatus = existingBanned ? existingBanned.status : status;
                    const nextSummary = (scoreSummary && /điểm/i.test(scoreSummary))
                        ? scoreSummary
                        : (existingScored?.score_summary || scoreSummary || targetRow.score_summary || '');
                    const updatePayload = {
                        player_name: cleanName,
                        ip_address: cleanIp,
                        device_info: cleanDevice,
                        status: nextStatus,
                        score_summary: nextSummary,
                        last_active: nowIso
                    };
                    if (!this._isColumnMissing('quiz_logins', 'session_id') && record.session_id) {
                        updatePayload.session_id = record.session_id;
                    }
                    const { error: updateError } = await this._executeWriteWithSchemaFallback(
                        'quiz_logins',
                        OPTIONAL_LOGIN_COLUMNS,
                        (candidate) => this.client.from('quiz_logins').update(candidate).eq('id', targetRow.id),
                        updatePayload
                    );

                    // Chỉ xóa các dòng hiện diện trùng lặp (không phải bài thi) của thiết bị này
                    if (!updateError && sameDeviceRows.length > 1) {
                        const duplicateIds = sameDeviceRows
                            .slice(1)
                            .filter((r) => !isExamAttemptRow(r))
                            .map((r) => r.id)
                            .filter(Boolean);
                        if (duplicateIds.length) {
                            this.client.from('quiz_logins').delete().in('id', duplicateIds.slice(0, 50)).then(() => {}, () => {});
                        }
                    }

                    if (!updateError) {
                        const resObj = { id: targetRow.id, sessionId: record.session_id, attemptId: record.session_id, success: true };
                        resObj.toString = () => targetRow.id;
                        return resObj;
                    }
                    if (updateError && /policy|permission|not allowed/i.test(updateError.message || '')) {
                        throw updateError;
                    }
                }

                // Nếu thiết bị này chưa có dòng nào trong Supabase, tạo bản ghi mới riêng cho thiết bị
                const cloudId = this.generateUUID();
                const payload = {
                    id: cloudId,
                    player_name: cleanName,
                    ip_address: cleanIp,
                    device_info: cleanDevice,
                    status,
                    score_summary: scoreSummary,
                    last_active: nowIso,
                    created_at: nowIso
                };
                if (!this._isColumnMissing('quiz_logins', 'session_id') && record.session_id) {
                    payload.session_id = record.session_id;
                }
                let { data: inserted, error } = await this._executeWriteWithSchemaFallback(
                    'quiz_logins',
                    OPTIONAL_LOGIN_COLUMNS,
                    (candidate) => this.client.from('quiz_logins').insert([candidate]).select('id'),
                    payload
                );

                if (error) {
                    const { data: rpcId, error: rpcErr } = await this.client.rpc('student_record_login', {
                        p_id: cloudId,
                        p_player_name: cleanName,
                        p_ip_address: cleanIp,
                        p_device_info: cleanDevice,
                        p_status: status,
                        p_score_summary: scoreSummary,
                        p_session_id: record.session_id || null
                    });
                    if (!rpcErr && rpcId) {
                        inserted = [{ id: rpcId }];
                        error = null;
                    }
                }

                if (error && /policy|permission|not allowed/i.test(error.message || '')) {
                    console.warn('[DatabaseService] Supabase từ chối ghi phiên, không dùng fallback giả online.');
                }

                if (!error && inserted && inserted[0]) {
                    const finalId = inserted[0].id;
                    try {
                        const localMirror = this._getLocalLogins();
                        const localRow = localMirror.find((item) => item.id === record.id);
                        if (localRow) {
                            localRow.id = finalId;
                            localStorage.setItem(STORAGE_KEYS.LOCAL_LOGINS, JSON.stringify(localMirror));
                        }
                    } catch (e) {}
                    const resObj = { id: finalId, sessionId: record.session_id, attemptId: record.session_id, success: true };
                    resObj.toString = () => finalId;
                    return resObj;
                }
            } catch (err) {
                console.warn("[DatabaseService] Lỗi ghi nhận đăng nhập lên Supabase:", err);
            }
        }

        const localId = record.id;
        const resObj = { id: localId, success: true };
        resObj.toString = () => localId;
        return resObj;
    }

    async heartbeat(loginId) {
        const nowIso = this.getNowIso();
        if (this.isSupabaseActive && this.client && loginId && !String(loginId).startsWith('local_')) {
            try {
                const { error } = await this.client.rpc('student_heartbeat', { p_login_id: loginId, p_last_active: nowIso });
                if (error) throw error;
                console.debug('[DatabaseService] Heartbeat updated:', { loginId, last_active: nowIso });
            } catch (error) {
                console.warn('[DatabaseService] Không cập nhật được heartbeat:', error);
            }
        }
        try {
            const list = this._getLocalLogins();
            const clientSessionId = sessionStorage.getItem('quiz_client_session_id');
            const presenceSessionId = sessionStorage.getItem('quiz_presence_session');
            const item = list.find((entry) => entry.id === loginId || entry.session_id === clientSessionId || entry.session_id === presenceSessionId);
            if (item) {
                item.last_active = nowIso;
                localStorage.setItem(STORAGE_KEYS.LOCAL_LOGINS, JSON.stringify(list));
            }
        } catch (e) {}
    }

    /**
     * Nhận diện tên học sinh theo địa chỉ IP (Đã fix lỗi bị dính nhãn __SYSTEM_NOTICE__)
     */
    async getLoginByIp(ipAddress) {
        const cleanIp = (ipAddress || "").trim();
        if (!cleanIp || cleanIp === "Chưa xác định" || cleanIp === "IP Cục Bộ") return null;

        // 1. Kiểm tra LocalStorage map
        const localName = localStorage.getItem(`quiz_ip_map_${cleanIp}`);
        if (localName && !localName.startsWith('__') && !/^(khách truy cập|visitor)$/i.test(localName.trim())) return { playerName: localName };

        // 2. Tra cứu trên Supabase Cloud (Loại trừ bản ghi hệ thống có tiền tố __)
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client.rpc('public_get_login_by_ip', { p_ip: cleanIp });
                if (!error && data?.playerName && !String(data.playerName).startsWith('__') && !/^(khách truy cập|visitor)$/i.test(String(data.playerName).trim())) {
                    return {
                        playerName: data.playerName,
                        deviceInfo: data.deviceInfo,
                        lastActive: data.lastActive
                    };
                }
            } catch (err) {
                console.warn("[DatabaseService] Tra cứu IP từ Supabase lỗi:", err);
            }
        }
        return null;
    }

    /**
     * Cập nhật trạng thái làm bài của thí sinh
     */
    async updateLoginStatus(loginId, status, scoreSummary = "") {
        const nowIso = this.getNowIso();
        const offline = typeof navigator !== 'undefined' && !navigator.onLine;
        if (offline || String(loginId || '').startsWith('local_')) {
            this.enqueueOfflineSync('updateStatus', { loginId, status, scoreSummary, last_active: nowIso });
        }

        // Cập nhật Cloud Supabase (kèm hàng đợi khi offline)
        if (this.isSupabaseActive && this.client && loginId && !String(loginId).startsWith('local_')) {
            if (offline) {
                this.enqueueOfflineSync('updateStatus', { loginId, status, scoreSummary, last_active: nowIso });
            } else {
                try {
                    const { error } = await this.client.rpc('student_update_progress', {
                        p_login_id: loginId,
                        p_status: status,
                        p_score_summary: scoreSummary,
                        p_last_active: nowIso
                    });
                    if (error) throw error;
                } catch (e) {
                    this.enqueueOfflineSync('updateStatus', { loginId, status, scoreSummary, last_active: nowIso });
                }
            }
        }

        // Cập nhật Local
        try {
            let list = this._getLocalLogins();
            if (list.length > 0) {
            const item = list.find(l => l.id === loginId);
            if (!item) return;
                if (!String(item.status || '').startsWith('BANNED')) {
                    item.status = status;
                }
                item.score_summary = scoreSummary;
                item.last_active = nowIso;
                localStorage.setItem(STORAGE_KEYS.LOCAL_LOGINS, JSON.stringify(list));
            }
        } catch (e) {}
    }

    /**
     * Thêm hành động vào hàng đợi ngoại tuyến (Offline Sync Queue)
     */
    enqueueOfflineSync(actionType, payload) {
        try {
            const raw = localStorage.getItem('quiz_offline_sync_queue');
            let queue = raw ? JSON.parse(raw) : [];
            queue.push({
                type: actionType,
                payload: payload,
                queuedAt: this.getNowIso()
            });
            if (queue.length > 60) queue = queue.slice(-60);
            localStorage.setItem('quiz_offline_sync_queue', JSON.stringify(queue));
        } catch (e) {
            console.warn("[OfflineSync] Lỗi lưu queue:", e);
        }
    }

    /**
     * Tự động gửi bù dữ liệu tồn đọng khi có mạng trở lại (Auto Network Sync)
     */
    async syncPendingOfflineData() {
        if (!navigator.onLine || !this.isSupabaseActive || !this.client || this._isSyncingOfflineQueue) return 0;
        this._isSyncingOfflineQueue = true;
        try {
            const raw = localStorage.getItem('quiz_offline_sync_queue');
            if (!raw) return 0;
            const queue = JSON.parse(raw);
            if (!Array.isArray(queue) || queue.length === 0) return 0;

            let syncedCount = 0;
            const remaining = [];
            const resolvedLocalIds = new Map();
            for (const item of queue) {
                let synced = false;
                try {
                    if ((item.type === 'updateProgress' || item.type === 'updateStatus') && item.payload) {
                        const rawLoginId = item.payload.loginId;
                        const loginId = resolvedLocalIds.get(rawLoginId) || rawLoginId;
                        const statusVal = item.type === 'updateProgress' ? item.payload.statusText : item.payload.status;
                        const scoreVal = item.type === 'updateProgress' ? item.payload.scoreText : item.payload.scoreSummary;
                        const lastActive = item.payload.last_active || this.getNowIso();

                        if (loginId && !String(loginId).startsWith('local_')) {
                            const { error } = await this.client.rpc('student_update_progress', {
                                p_login_id: loginId,
                                p_status: statusVal,
                                p_score_summary: scoreVal,
                                p_last_active: lastActive
                            });
                            if (error) throw error;
                            syncedCount++;
                            synced = true;
                        } else if (loginId && String(loginId).startsWith('local_')) {
                            // Resolve offline-only local login once and reuse cloudId for subsequent queued updates
                            const localLogins = this._getLocalLogins();
                            const localRow = localLogins.find((r) => r.id === loginId);
                            if (localRow && localRow.player_name) {
                                const cloudId = this.generateUUID();
                                const payload = {
                                    id: cloudId,
                                    player_name: localRow.player_name,
                                    ip_address: localRow.ip_address || 'Chưa xác định',
                                    device_info: localRow.device_info || 'Trình duyệt',
                                    status: statusVal || localRow.status || 'Đang ôn tập',
                                    score_summary: scoreVal || localRow.score_summary || '',
                                    last_active: lastActive,
                                    created_at: localRow.created_at || lastActive
                                };
                                if (!this._isColumnMissing('quiz_logins', 'session_id') && localRow.session_id) {
                                    payload.session_id = localRow.session_id;
                                }
                                 const { data: rpcId, error } = await this.client.rpc('student_record_login', {
                                     p_id: cloudId,
                                     p_player_name: payload.player_name,
                                     p_ip_address: payload.ip_address,
                                     p_device_info: payload.device_info,
                                     p_status: payload.status,
                                     p_score_summary: payload.score_summary,
                                     p_session_id: payload.session_id || null
                                 });
                                 if (error) throw error;
                                resolvedLocalIds.set(loginId, cloudId);
                                localRow.id = cloudId;
                                try {
                                    localStorage.setItem(STORAGE_KEYS.LOCAL_LOGINS, JSON.stringify(localLogins));
                                } catch (le) {}
                                syncedCount++;
                            }
                            synced = true;
                        } else {
                            synced = true;
                        }
                    }
                } catch (err) {
                    console.warn("[OfflineSync] Lỗi sync item:", err);
                }
                if (!synced) {
                    if (item?.payload?.loginId && resolvedLocalIds.has(item.payload.loginId)) {
                        item.payload.loginId = resolvedLocalIds.get(item.payload.loginId);
                    }
                    remaining.push(item);
                }
            }

            const latestRaw = localStorage.getItem('quiz_offline_sync_queue');
            const latestQueue = latestRaw ? JSON.parse(latestRaw) : [];
            const newItems = Array.isArray(latestQueue) ? latestQueue.slice(queue.length) : [];
            const finalQueue = [...remaining, ...newItems];
            if (finalQueue.length) localStorage.setItem('quiz_offline_sync_queue', JSON.stringify(finalQueue.slice(-60)));
            else localStorage.removeItem('quiz_offline_sync_queue');
            return syncedCount;
        } catch (e) {
            console.warn("[OfflineSync] Lỗi syncPendingOfflineData:", e);
            return 0;
        } finally {
            this._isSyncingOfflineQueue = false;
        }
    }

    /**
     * Cập nhật tiến độ chi tiết của thí sinh
     */
    async updateStudentProgress(loginId, answeredCount, totalCount, correctCount, subjectName, durationSeconds = 0, detailPayload = null) {
        if (!loginId) return;
        const nowIso = this.getNowIso();
        const percent = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;
        const subj = subjectName || 'Lịch Sử 11';
        const duration = Number(durationSeconds) > 0 ? ` - Đã làm: ${Math.floor(Number(durationSeconds) / 60)}p ${String(Math.floor(Number(durationSeconds) % 60)).padStart(2, '0')}s` : '';
        const statusText = `[${subj}] ${answeredCount >= totalCount && totalCount > 0 ? `Chờ nộp bài: ${answeredCount}/${totalCount} câu (100%)` : `Tiến độ: ${answeredCount}/${totalCount} câu (${percent}%)`}`;
        let scoreText = `[${subj}] Đúng ${correctCount}/${answeredCount} câu đã làm${duration}`;
        if (detailPayload && typeof detailPayload === 'object') {
            try {
                scoreText += `\n__DETAIL__:${JSON.stringify(detailPayload)}`;
            } catch (e) {}
        }

        try {
            let list = this._getLocalLogins();
            const idx = list.findIndex(l => l.id === loginId);
            if (idx !== -1) {
                if (!String(list[idx].status || '').startsWith('BANNED')) {
                    list[idx].status = statusText;
                }
                if (!/điểm/i.test(String(list[idx].score_summary || ''))) {
                    list[idx].score_summary = scoreText;
                }
                list[idx].last_active = nowIso;
                localStorage.setItem(STORAGE_KEYS.LOCAL_LOGINS, JSON.stringify(list));
            }
        } catch (e) {}

        const offline = typeof navigator !== 'undefined' && !navigator.onLine;
        if (offline || String(loginId).startsWith('local_')) {
            this.enqueueOfflineSync('updateProgress', { loginId, statusText, scoreText, last_active: nowIso });
        } else if (this.isSupabaseActive && this.client) {
            try {
                // Chỉ cần một UPDATE cho mỗi snapshot. SELECT trước UPDATE
                // khiến mỗi lần chọn đáp án phải chờ thêm một round-trip mạng.
                const { error } = await this.client
                    .from('quiz_logins')
                    .update({
                        status: statusText,
                        score_summary: scoreText,
                        last_active: nowIso
                    })
                    .eq('id', loginId)
                    .not('status', 'like', 'BANNED%')
                    .not('status', 'ilike', '%đã nộp bài%')
                    .not('status', 'ilike', '%hoàn thành%')
                    .or('score_summary.is.null,score_summary.not.ilike.%điểm)%');
                if (error) throw error;
            } catch (e) {
                this.enqueueOfflineSync('updateProgress', { loginId, statusText, scoreText, last_active: nowIso });
            }
        }
    }

    /**
     * Lấy danh sách máy & lượt làm bài cho Admin / Giám sát (Mặc định giữ toàn bộ lượt để xem lịch sử từng đề)
     */
    async getLoginHistory(limit = 300, options = {}) {
        let rawLimit = limit;
        let opts = (options && typeof options === 'object') ? options : {};
        if (limit && typeof limit === 'object') {
            opts = limit;
            rawLimit = opts.limit !== undefined ? opts.limit : 300;
        }
        const isUncapped = rawLimit === 0 || rawLimit === null || rawLimit === Infinity || (typeof rawLimit === 'number' && rawLimit < 0);
        const maxRows = isUncapped ? Infinity : Math.max(1, Math.floor(Number(rawLimit) || 300));
        const dedupeByStudent = Boolean(opts.dedupeByStudent);
        const excludeVisitors = Boolean(opts.excludeVisitors);
        const excludeSystem = opts.excludeSystem !== undefined ? Boolean(opts.excludeSystem) : true;
        const excludeAdmin = Boolean(opts.excludeAdmin);
        const ascending = Boolean(opts.ascending);
        const defaultSelectCols = this._isColumnMissing('quiz_logins', 'session_id')
            ? 'id, player_name, ip_address, device_info, status, score_summary, last_active, created_at'
            : 'id, player_name, ip_address, device_info, status, score_summary, session_id, last_active, created_at';
        let selectCols = String(opts.select || defaultSelectCols);
        const shouldPaginate = Boolean(opts.paginate || excludeVisitors || isUncapped || maxRows > 1000);
        const pageSize = Math.min(1000, Math.max(1, Math.floor(Number(opts.pageSize) || 1000)));

        let adminIps = new Set();
        try {
            const adminConfig = await this.fetchAdminIpsConfig();
            adminIps = new Set([
                adminConfig?.masterIp,
                ...(Array.isArray(adminConfig?.ips) ? adminConfig.ips : []),
                ...(Array.isArray(adminConfig?.allowedIps) ? adminConfig.allowedIps.map(item => typeof item === 'string' ? item : item?.ip) : [])
            ].map(ip => String(ip || '').trim()).filter(Boolean));
        } catch (error) {
            console.warn('[DatabaseService] Không tải được danh sách IP quản trị để lọc giám sát:', error);
        }
        const isStudentLogin = (item) => {
            if (excludeSystem && this.isSystemLoginRecord(item)) return false;
            if (excludeVisitors && this.isVisitorLoginRecord(item)) return false;
            const ip = String(item?.ip_address || item?.client_ip || '').trim();
            if (excludeAdmin && ip && adminIps.has(ip)) return false;
            if (this.isVisitorLoginRecord(item) && adminIps.has(ip)) return false;
            return true;
        };
        const seenIds = new Set();
        const seenKeys = new Set();
        const appendNormalizedRows = (list, targetOut) => {
            for (const item of list) {
                if (Number.isFinite(maxRows) && targetOut.length >= maxRows) break;
                if (!isStudentLogin(item)) continue;
                const row = {
                    ...item,
                    ip_address: item.ip_address || item.client_ip || 'Chưa xác định',
                    client_ip: item.ip_address || item.client_ip || 'Chưa xác định',
                    player_name: (item.player_name && item.player_name.trim()) ? item.player_name.trim() : 'Khách truy cập',
                    device_info: (item.device_info && item.device_info !== 'Chưa rõ') ? item.device_info : 'Trình duyệt Web',
                    session_id: item.session_id || '',
                    attempt_id: item.attempt_id || item.session_id || ''
                };
                if (row.id !== undefined && row.id !== null) {
                    const idKey = String(row.id);
                    if (seenIds.has(idKey)) continue;
                    seenIds.add(idKey);
                }
                if (dedupeByStudent) {
                    const key = getStudentGroupKey(row);
                    if (seenKeys.has(key)) continue;
                    seenKeys.add(key);
                }
                targetOut.push(row);
            }
            return targetOut;
        };
        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken && (opts.excludeVisitors || opts.adminRpc !== false)) {
                    const rpcLimit = Number.isFinite(maxRows) ? maxRows : 1000;
                    const { data: rpcRows, error: rpcErr } = await this.client.rpc('admin_get_login_history', { p_admin_token: adminToken, p_limit: rpcLimit, p_offset: 0, p_exclude_visitors: excludeVisitors });
                    if (!rpcErr && Array.isArray(rpcRows)) return appendNormalizedRows(rpcRows, []);
                    if (rpcErr && !this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                if (!shouldPaginate) {
                    let { data, error } = await this.client
                        .from('quiz_logins')
                        .select(selectCols)
                        .order('last_active', { ascending })
                        .limit(maxRows);

                    if (error && this._isMissingColumnError(error) && /\bsession_id\b/i.test(selectCols)) {
                        this._markColumnMissing('quiz_logins', 'session_id');
                        selectCols = selectCols.split(',').map((c) => c.trim()).filter((c) => c && c.toLowerCase() !== 'session_id').join(', ');
                        ({ data, error } = await this.client
                            .from('quiz_logins')
                            .select(selectCols)
                            .order('last_active', { ascending })
                            .limit(maxRows));
                    }

                    if (!error && Array.isArray(data)) {
                        console.debug('[DatabaseService] Student monitor records loaded:', { count: data.length, dedupeByStudent });
                        return appendNormalizedRows(data, []);
                    } else if (error) {
                        console.warn('[DatabaseService] Student monitor query failed:', { message: error.message, code: error.code });
                    }
                } else {
                    const collected = [];
                    let offset = 0;
                    let queryFailed = false;
                    for (let page = 0; page < 200; page++) {
                        if (Number.isFinite(maxRows) && collected.length >= maxRows) break;
                        const batchSize = (!dedupeByStudent && !excludeAdmin && !excludeVisitors && !excludeSystem && Number.isFinite(maxRows))
                            ? Math.min(pageSize, Math.max(1, maxRows - collected.length))
                            : pageSize;

                        const buildPagedQuery = (cols) => {
                            let q = this.client
                                .from('quiz_logins')
                                .select(cols);
                            if (excludeVisitors) {
                                q = q
                                    .neq('player_name', '')
                                    .neq('player_name', 'Khách truy cập')
                                    .neq('player_name', 'visitor')
                                    .not('player_name', 'like', '\\_\\_%');
                            } else if (excludeSystem) {
                                q = q.not('player_name', 'like', '\\_\\_%');
                            }
                            return q
                                .order('last_active', { ascending })
                                .order('id', { ascending: true })
                                .range(offset, offset + batchSize - 1);
                        };

                        let { data, error } = await buildPagedQuery(selectCols);
                        if (error && this._isMissingColumnError(error) && /\bsession_id\b/i.test(selectCols)) {
                            this._markColumnMissing('quiz_logins', 'session_id');
                            selectCols = selectCols.split(',').map((c) => c.trim()).filter((c) => c && c.toLowerCase() !== 'session_id').join(', ');
                            ({ data, error } = await buildPagedQuery(selectCols));
                        }
                        if (error) {
                            queryFailed = true;
                            console.warn('[DatabaseService] Paginated student monitor query failed:', {
                                offset,
                                message: error.message,
                                code: error.code
                            });
                            break;
                        }
                        if (!Array.isArray(data) || data.length === 0) break;

                        appendNormalizedRows(data, collected);
                        offset += data.length;
                        if (data.length < batchSize) break;
                    }
                    if (!queryFailed || collected.length > 0) {
                        console.debug('[DatabaseService] Paginated student monitor records loaded:', {
                            count: collected.length,
                            dedupeByStudent,
                            excludeVisitors,
                            maxRows: Number.isFinite(maxRows) ? maxRows : 'all'
                        });
                        return Number.isFinite(maxRows) ? collected.slice(0, maxRows) : collected;
                    }
                }
            } catch (err) {
                console.warn("[DatabaseService] Lỗi khi tải quiz_logins từ Supabase:", err);
            }
        }
        const localSorted = [...this._getLocalLogins()].sort((a, b) => {
            const ta = new Date(a?.last_active || a?.created_at || 0).getTime() || 0;
            const tb = new Date(b?.last_active || b?.created_at || 0).getTime() || 0;
            return ascending ? (ta - tb) : (tb - ta);
        });
        const localNormalized = appendNormalizedRows(localSorted, []);
        return Number.isFinite(maxRows) ? localNormalized.slice(0, maxRows) : localNormalized;
    }

    /**
     * Lấy lịch sử đăng nhập/làm bài của học sinh đã nhập tên (bỏ qua Khách truy cập và bản ghi __*, phân trang qua mốc 1000 dòng)
     */
    async getNamedLoginHistory(maxRows = 1500, options = {}) {
        let targetMax = maxRows;
        let opts = (options && typeof options === 'object') ? options : {};
        if (maxRows && typeof maxRows === 'object') {
            opts = maxRows;
            targetMax = opts.maxRows !== undefined ? opts.maxRows : (opts.limit !== undefined ? opts.limit : 1500);
        }
        return await this.getLoginHistory(targetMax, {
            ...opts,
            excludeVisitors: true,
            excludeSystem: opts.excludeSystem !== undefined ? opts.excludeSystem : true,
            paginate: true
        });
    }

    /**
     * Alias cho fetchActiveLogins (giữ 1 dòng đại diện mới nhất cho mỗi học sinh/thiết bị trong bảng Admin)
     */
    async fetchActiveLogins(limit = 300, options = {}) {
        const opts = (options && typeof options === 'object') ? options : {};
        return await this.getLoginHistory(limit, { ...opts, dedupeByStudent: true });
    }

    /**
     * Xóa 1 bản ghi đăng nhập
     */
    async deleteLoginRecord(loginId) {
        if (this.isSupabaseActive && this.client && loginId && !String(loginId).startsWith('local_')) {
            const adminToken = this.getAdminSessionToken();
            let handledByRpc = false;
            if (adminToken) {
                const { error: rpcErr } = await this.client.rpc('admin_delete_login_record', {
                    p_admin_token: adminToken,
                    p_login_id: loginId
                });
                if (!rpcErr) handledByRpc = true;
                else if (!this._isMissingRpcError(rpcErr)) throw new Error(`Không thể xóa lịch sử đăng nhập: ${rpcErr.message}`);
            }
            if (!handledByRpc) {
                const { error } = await this.client.from('quiz_logins').delete().eq('id', loginId);
                if (error) throw new Error(`Không thể xóa lịch sử đăng nhập: ${error.message}`);
            }
        }
        let list = this._getLocalLogins();
        list = list.filter(item => item.id !== loginId);
        localStorage.setItem(STORAGE_KEYS.LOCAL_LOGINS, JSON.stringify(list));
    }

    /**
     * Xóa sạch toàn bộ lịch sử đăng nhập học sinh (bảo toàn cấu hình hệ thống)
     */
    async clearAllLogins() {
        if (this.isSupabaseActive && this.client) {
            const adminToken = this.getAdminSessionToken();
            if (adminToken) {
                try {
                    const { data: rpcResult, error: rpcErr } = await this.client.rpc('admin_clear_all_logins', { p_admin_token: adminToken, p_admin_ips: [] });
                    if (!rpcErr) {
                        localStorage.removeItem(STORAGE_KEYS.LOCAL_LOGINS);
                        return rpcResult;
                    }
                    if (!this._isMissingRpcError(rpcErr)) throw new Error(`Không thể xóa lịch sử đăng nhập: ${rpcErr.message}`);
                } catch (e) { if (!this._isMissingRpcError(e)) throw e; }
            }
            let handledByRpc = false;
            if (adminToken) {
                const { error: rpcErr } = await this.client.rpc('admin_clear_all_logins', {
                    p_admin_token: adminToken,
                    p_admin_ips: []
                });
                if (!rpcErr) handledByRpc = true;
                else if (!this._isMissingRpcError(rpcErr)) throw new Error(`Không thể xóa lịch sử đăng nhập: ${rpcErr.message}`);
            }
            if (!handledByRpc) {
            const pageSize = 500;
            const rows = [];
            for (let offset = 0; ; offset += pageSize) {
                const { data, error: selectError } = await this.client
                    .from('quiz_logins')
                    .select('id, player_name, ip_address')
                    .order('created_at', { ascending: true })
                    .range(offset, offset + pageSize - 1);
                if (selectError) throw new Error(`Không thể đọc lịch sử đăng nhập trước khi xóa: ${selectError.message}`);
                if (!Array.isArray(data) || data.length === 0) break;
                rows.push(...data);
                if (data.length < pageSize) break;
            }

            const ids = rows
                .filter(item => !this.isSystemLoginRecord(item))
                .map(item => item.id)
                .filter(id => id && !String(id).startsWith('local_'));
            const chunkSize = 50;
            for (let offset = 0; offset < ids.length; offset += chunkSize) {
                const chunk = ids.slice(offset, offset + chunkSize);
                const { error: deleteError } = await this.client.from('quiz_logins').delete().in('id', chunk);
                if (deleteError) throw new Error(`Không thể xóa lịch sử đăng nhập: ${deleteError.message}`);
                const { data: remaining, error: verifyError } = await this.client.from('quiz_logins').select('id').in('id', chunk);
                if (verifyError) throw new Error(`Không thể xác minh dữ liệu sau khi xóa: ${verifyError.message}`);
                if ((remaining || []).length) throw new Error(`Còn ${(remaining || []).length}/${chunk.length} bản ghi chưa xóa.`);
            }
            }
        }
        localStorage.removeItem(STORAGE_KEYS.LOCAL_LOGINS);
    }

    _getLocalLogins() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_LOGINS);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    // =========================================================================
    // PHẦN 2: QUẢN LÝ NGÂN HÀNG CÂU HỎI TRỰC TUYẾN ĐA MÔN HỌC (QUIZ_QUESTIONS)
    // =========================================================================

    _updateMaxQuestionIdCache(candidateId) {
        const num = Number(candidateId);
        if (!Number.isInteger(num) || num <= 0) return;
        try {
            const current = Number(localStorage.getItem(STORAGE_KEYS.MAX_QUESTION_ID) || 0);
            if (!Number.isFinite(current) || num > current) {
                localStorage.setItem(STORAGE_KEYS.MAX_QUESTION_ID, String(num));
            }
        } catch (e) {}
    }

    _getLocalMaxQuestionId() {
        let maxLocalId = 0;
        try {
            const storedMax = Number(localStorage.getItem(STORAGE_KEYS.MAX_QUESTION_ID) || 0);
            if (Number.isInteger(storedMax) && storedMax > maxLocalId) {
                maxLocalId = storedMax;
            }
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key) continue;
                if (key.startsWith(`${STORAGE_KEYS.CUSTOM_QUESTIONS}_`) || key === 'quiz_admin_trash') {
                    const raw = localStorage.getItem(key);
                    if (!raw) continue;
                    const parsed = JSON.parse(raw);
                    const list = Array.isArray(parsed) ? parsed : [];
                    for (const item of list) {
                        const idNum = Number(item?.id ?? item?.question_id);
                        if (Number.isInteger(idNum) && idNum > maxLocalId) {
                            maxLocalId = idNum;
                        }
                    }
                }
            }
        } catch (e) {}
        return maxLocalId;
    }

    /**
     * Tải câu hỏi trực tuyến theo môn học
     */
    async fetchQuestionsOnline(subjectKey = 'history') {
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client.rpc('public_get_quiz_questions', { p_subject_key: subjectKey || null });
                if (error) throw error;
                const allRows = (Array.isArray(data) ? data : []).map((row) => typeof row === 'string' ? JSON.parse(row) : row);

                console.debug('[DatabaseService] Questions query succeeded:', { subjectKey, count: allRows.length });
                for (const row of allRows) {
                    if (row && row.id !== undefined) this._updateMaxQuestionIdCache(row.id);
                }
                 const mapped = allRows.filter(row => row && row.is_deleted !== true).map(row => ({
                    id: row.id,
                    subjectKey: row.subject_key || 'history',
                    category: row.category || 'Bài học',
                    qType: row.q_type || 'mcq',
                    question: row.question,
                    options: row.options || [],
                    statements: row.statements || [],
                    correct: row.correct !== undefined ? row.correct : (row.answer || 0),
                    answer: row.answer !== undefined ? row.answer : (row.correct || 0),
                    correctValue: row.correct_value || '',
                    acceptedValues: row.accepted_values || row.acceptedValues || [],
                    explanation: row.explanation || '',
                     imageUrl: row.image_url || '',
                     image_url: row.image_url || '',
                     grade: row.grade || '11'
                }));
                if (subjectKey) {
                    try {
                        localStorage.setItem(`${STORAGE_KEYS.CUSTOM_QUESTIONS}_${subjectKey}`, JSON.stringify(mapped));
                    } catch (e) {}
                }
                return mapped;
            } catch (err) {
                console.warn("[DatabaseService] Lỗi fetch questions từ Supabase, chuyển sang cache:", err);
            }
        }

        // Cache cục bộ
        const cached = localStorage.getItem(`${STORAGE_KEYS.CUSTOM_QUESTIONS}_${subjectKey}`);
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                return Array.isArray(parsed)
                    ? parsed.filter((question) => question?.is_deleted !== true).map((q) => ({
                        ...q,
                        acceptedValues: q.accepted_values || q.acceptedValues || []
                    }))
                    : [];
            } catch (e) {
                console.warn("[DatabaseService] Lỗi parse cache questions:", e);
            }
        }
        return [];
    }

    async getNextQuestionId() {
        let maxId = this._getLocalMaxQuestionId();
        if (this.isSupabaseActive && this.client) {
            try {
                const { data: rpcNext, error: rpcErr } = await this.client.rpc('admin_get_next_question_id');
                if (!rpcErr && Number.isInteger(Number(rpcNext)) && Number(rpcNext) > 0) {
                    const nextId = Math.max(maxId + 1, Number(rpcNext));
                    this._updateMaxQuestionIdCache(nextId);
                    return nextId;
                }
            } catch (e) {}
            try {
                // Truy vấn tất cả ID (bao gồm cả các câu hỏi đã xóa mềm is_deleted = true)
                let { data, error } = await this.client
                    .from('quiz_questions')
                    .select('id, is_deleted')
                    .or('is_deleted.eq.false,is_deleted.eq.true,is_deleted.is.null')
                    .order('id', { ascending: false })
                    .limit(1);
                if (error && (error.code === '42703' || error.code === 'PGRST204' || /is_deleted|column .* does not exist/i.test(error.message || ''))) {
                    ({ data, error } = await this.client
                        .from('quiz_questions')
                        .select('id')
                        .order('id', { ascending: false })
                        .limit(1));
                }
                if (!error && data && data.length > 0 && Number.isInteger(Number(data[0].id))) {
                    maxId = Math.max(maxId, Number(data[0].id));
                }
            } catch (e) {
                maxId = Math.max(maxId, 1000);
            }
        }
        const nextId = maxId + 1;
        this._updateMaxQuestionIdCache(nextId);
        return nextId;
    }

    /**
     * Lưu/Cập nhật 1 câu hỏi lên Supabase
     */
    async saveQuestion(qObj, subjectKey = 'history') {
        if (!qObj || !qObj.question) {
            return { success: false, error: "Nội dung câu hỏi không được để trống." };
        }

        let correctInt = 0;
        const rawCorrect = qObj.correct !== undefined ? qObj.correct : (qObj.answer !== undefined ? qObj.answer : qObj.correctAnswer);
        if (typeof rawCorrect === 'number') {
            correctInt = Math.max(0, Math.min(3, Math.floor(rawCorrect)));
        } else if (typeof rawCorrect === 'string') {
            const ch = rawCorrect.trim().toUpperCase();
            if (ch === 'B' || ch === '1') correctInt = 1;
            else if (ch === 'C' || ch === '2') correctInt = 2;
            else if (ch === 'D' || ch === '3') correctInt = 3;
            else correctInt = 0;
        }

        let rawOptions = qObj.options;
        if (rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)) {
            rawOptions = [rawOptions.A || '', rawOptions.B || '', rawOptions.C || '', rawOptions.D || ''];
        }
        const cleanOptions = Array.isArray(rawOptions) ? rawOptions.map(opt => {
            if (opt && typeof opt === 'object') {
                return { ...opt };
            }
            return String(opt || '').replace(/^[A-D][\s.):-]\s*/i, '').trim();
        }) : [];

        const targetSubject = qObj.subjectKey || qObj.subject_key || subjectKey || 'history';
        const qType = qObj.qType || qObj.q_type || 'mcq';
        const rawCorrectVal = qObj.correctValue !== undefined ? qObj.correctValue : qObj.correct_value;
        const correctValueStr = (rawCorrectVal !== undefined && rawCorrectVal !== null)
            ? String(rawCorrectVal)
            : (qType === 'short_answer' ? String(qObj.correctAnswer || '') : '');

        const record = {
            subject_key: targetSubject,
            category: qObj.category || 'Bài học',
            q_type: qType,
            question: qObj.question,
            options: cleanOptions,
            statements: qObj.statements || [],
            correct: correctInt,
            answer: correctInt,
            correct_value: correctValueStr,
            accepted_values: qObj.acceptedValues || qObj.accepted_values || null,
            explanation: qObj.explanation || '',
            image_url: qObj.image_url || qObj.imageUrl || '',
            grade: qObj.grade || '11',
            is_deleted: false,
            deleted_at: null,
            updated_at: this.getNowIso()
        };

        const hasCandidateId = qObj.id !== undefined && qObj.id !== null && qObj.id !== '' && Number.isInteger(Number(qObj.id)) && Number(qObj.id) > 0;
        const isCreatingNew = !hasCandidateId || qObj.isNew === true || qObj._isNew === true;
        let isExistingSameSubjectRow = false;

        if (hasCandidateId) {
            const candidateId = Number(qObj.id);
            let idCollision = false;

            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (!key || !key.startsWith(`${STORAGE_KEYS.CUSTOM_QUESTIONS}_`)) continue;
                    const cachedSubj = key.slice(`${STORAGE_KEYS.CUSTOM_QUESTIONS}_`.length);
                    const raw = localStorage.getItem(key);
                    const list = raw ? JSON.parse(raw) : [];
                    if (!Array.isArray(list)) continue;
                    const matched = list.find(item => Number(item?.id) === candidateId);
                    if (matched && (cachedSubj !== targetSubject || matched.is_deleted === true || isCreatingNew)) {
                        idCollision = true;
                        break;
                    }
                }
            } catch (e) {}

            if (this.isSupabaseActive && this.client && !idCollision) {
                try {
                    let { data: existingIdRow, error: checkErr } = await this.client
                        .from('quiz_questions')
                        .select('id, subject_key, is_deleted')
                        .eq('id', candidateId)
                        .limit(1);
                    if (checkErr && (checkErr.code === '42703' || checkErr.code === 'PGRST204' || /is_deleted|column .* does not exist/i.test(checkErr.message || ''))) {
                        ({ data: existingIdRow } = await this.client
                            .from('quiz_questions')
                            .select('id, subject_key')
                            .eq('id', candidateId)
                            .limit(1));
                    }
                    if (Array.isArray(existingIdRow) && existingIdRow.length > 0) {
                        const existing = existingIdRow[0];
                        if (existing.subject_key !== targetSubject || existing.is_deleted === true || isCreatingNew) {
                            idCollision = true;
                        } else {
                            isExistingSameSubjectRow = true;
                        }
                    }
                } catch (e) {}
            }

            if (idCollision) {
                this._updateMaxQuestionIdCache(candidateId);
                record.id = await this.getNextQuestionId();
                qObj.id = record.id;
            } else {
                record.id = candidateId;
                this._updateMaxQuestionIdCache(candidateId);
            }
        } else {
            record.id = await this.getNextQuestionId();
        }

        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { data: rpcItem, error: rpcErr } = await this.client.rpc('admin_upsert_question', {
                        p_admin_token: adminToken, p_record: record
                    });
                    if (!rpcErr) {
                        const item = rpcItem || record;
                        if (item?.id !== undefined) this._updateMaxQuestionIdCache(item.id);
                        this._upsertQuestionInLocalCache(targetSubject, item);
                        return { success: true, item };
                    }
                    if (!this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                const writeWithSchemaFallback = async (basePayload, useUpsert) => {
                    return await this._executeWriteWithSchemaFallback(
                        'quiz_questions',
                        OPTIONAL_QUESTION_COLUMNS,
                        (candidate) => useUpsert
                            ? this.client.from('quiz_questions').upsert([candidate], { onConflict: 'id' }).select()
                            : this.client.from('quiz_questions').insert([candidate]).select(),
                        basePayload
                    );
                };

                let { data, error } = await writeWithSchemaFallback(record, isExistingSameSubjectRow);

                // Nếu chèn mới gặp xung đột khóa chính (ví dụ ID trùng với dòng đã soft-delete bị ẩn bởi RLS),
                // cấp ID mới và thử chèn lại thay vì ghi đè dòng cũ qua upsert.
                let retryCount = 0;
                while (error && (error.code === '23505' || /duplicate key|unique constraint/i.test(error.message || '')) && retryCount < 5) {
                    retryCount++;
                    this._updateMaxQuestionIdCache(record.id);
                    record.id = await this.getNextQuestionId();
                    qObj.id = record.id;
                    ({ data, error } = await writeWithSchemaFallback(record, false));
                }

                if (!error) {
                    const item = data?.[0] || record;
                    if (item?.id !== undefined) this._updateMaxQuestionIdCache(item.id);
                    if (qObj.id === undefined || qObj.id === null || qObj.id === '') qObj.id = item.id;
                    this._upsertQuestionInLocalCache(targetSubject, item);
                    return { success: true, item };
                }
                if (error) throw error;
            } catch (err) {
                console.error("[DatabaseService] Lỗi khi lưu câu hỏi lên Supabase:", err);
                return { success: false, error: err.message };
            }
        }

        this._upsertQuestionInLocalCache(targetSubject, record);
        return { success: true, localOnly: true, item: record };
    }

    _upsertQuestionInLocalCache(subjectKey, row) {
        if (!subjectKey || !row || row.id === undefined) return;
        try {
            const cacheKey = `${STORAGE_KEYS.CUSTOM_QUESTIONS}_${subjectKey}`;
            const raw = localStorage.getItem(cacheKey);
            const list = raw ? JSON.parse(raw) : [];
            const arr = Array.isArray(list) ? list : [];
            const normalized = {
                id: row.id,
                subjectKey: row.subject_key || row.subjectKey || subjectKey,
                category: row.category || 'Bài học',
                qType: row.q_type || row.qType || 'mcq',
                question: row.question,
                options: row.options || [],
                statements: row.statements || [],
                correct: row.correct !== undefined ? row.correct : (row.answer || 0),
                answer: row.answer !== undefined ? row.answer : (row.correct || 0),
                correctValue: row.correct_value ?? row.correctValue ?? '',
                acceptedValues: row.accepted_values || row.acceptedValues || [],
                explanation: row.explanation || '',
                imageUrl: row.image_url ?? row.imageUrl ?? '',
                grade: row.grade || row.grade_level || '11'
            };
            const idx = arr.findIndex(item => Number(item?.id) === Number(normalized.id));
            if (idx !== -1) arr[idx] = normalized;
            else arr.push(normalized);
            localStorage.setItem(cacheKey, JSON.stringify(arr));
        } catch (e) {}
    }

    /**
     * Nạp hàng loạt (Bulk Import) câu hỏi từ bộ bóc tách văn bản/Excel
     * Hỗ trợ cả 2 dạng gọi: saveQuestionsBulk(questionsList, subjectKey, replaceAll)
     * hoặc saveQuestionsBulk(subjectKey, questionsList, replaceAll)
     */
    async saveQuestionsBulk(arg1, arg2, replaceAll = false) {
        let questionsList = arg1;
        let subjectKey = arg2;
        if (typeof arg1 === 'string' && Array.isArray(arg2)) {
            subjectKey = arg1;
            questionsList = arg2;
        }

        if (!Array.isArray(questionsList) || questionsList.length === 0) {
            return { success: false, count: 0, error: "Danh sách câu hỏi rỗng." };
        }

        const cleanSubject = subjectKey || 'history';

        // Nếu replaceAll = true, xóa sạch câu hỏi cũ của môn này trước khi insert
        if (replaceAll) {
            const deleted = await this.clearQuestionsBySubject(cleanSubject);
            if (!deleted?.success) return { success: false, count: 0, error: deleted?.error || 'Không thể xóa dữ liệu cũ trước khi nạp.' };
        }

        let generatedId = await this.getNextQuestionId();
        const otherSubjectIds = new Set();
        const usedIdsInBatch = new Set();
        if (this.isSupabaseActive && this.client && !replaceAll) {
            const candidateIds = [...new Set(
                questionsList
                    .map(q => (q?.id !== undefined && q?.id !== null && q?.id !== '' && Number.isInteger(Number(q.id)) && Number(q.id) > 0) ? Number(q.id) : null)
                    .filter(id => id !== null)
            )];
            try {
                for (let offset = 0; offset < candidateIds.length; offset += 200) {
                    const { data: existingRows } = await this.client
                        .from('quiz_questions')
                        .select('id, subject_key')
                        .in('id', candidateIds.slice(offset, offset + 200))
                        .neq('subject_key', cleanSubject);
                    (existingRows || []).forEach(row => {
                        if (row && row.id !== undefined) {
                            otherSubjectIds.add(Number(row.id));
                        }
                    });
                }
            } catch (e) { }
        }

        const records = questionsList.map((q) => {
            let correctInt = 0;
            const rawCorrect = q.correct !== undefined ? q.correct : (q.answer !== undefined ? q.answer : q.correctAnswer);
            if (typeof rawCorrect === 'number') {
                correctInt = Math.max(0, Math.min(3, Math.floor(rawCorrect)));
            } else if (typeof rawCorrect === 'string') {
                const ch = rawCorrect.trim().toUpperCase();
                if (ch === 'B' || ch === '1') correctInt = 1;
                else if (ch === 'C' || ch === '2') correctInt = 2;
                else if (ch === 'D' || ch === '3') correctInt = 3;
                else correctInt = 0;
            }

            let rawOptions = q.options;
            if (rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)) {
                rawOptions = [rawOptions.A || '', rawOptions.B || '', rawOptions.C || '', rawOptions.D || ''];
            }
            const cleanOptions = Array.isArray(rawOptions) ? rawOptions.map(opt => {
                if (opt && typeof opt === 'object') {
                    return { ...opt };
                }
                return String(opt || '').replace(/^[A-D][\s.):-]\s*/i, '').trim();
            }) : [];

            const rawIdNum = (q.id !== undefined && q.id !== null && q.id !== '' && Number.isInteger(Number(q.id)) && Number(q.id) > 0)
                ? Number(q.id)
                : null;
            const canReuseId = !replaceAll
                && rawIdNum !== null
                && !otherSubjectIds.has(rawIdNum)
                && !usedIdsInBatch.has(rawIdNum);
            while (otherSubjectIds.has(generatedId) || usedIdsInBatch.has(generatedId)) {
                generatedId++;
            }
            const id = canReuseId ? rawIdNum : generatedId++;
            usedIdsInBatch.add(id);
            this._updateMaxQuestionIdCache(id);
            q.id = id;
            return {
                id,
                subject_key: cleanSubject,
                category: q.category || 'Bài tập',
                q_type: q.qType || q.q_type || q.type || 'mcq',
                question: q.question,
                options: cleanOptions,
                statements: q.statements || [],
                correct: correctInt,
                answer: correctInt,
                correct_value: q.correctValue !== undefined ? String(q.correctValue) : '',
                accepted_values: q.acceptedValues || q.accepted_values || null,
                explanation: q.explanation || '',
                 image_url: q.image_url || q.imageUrl || '',
                 grade: q.grade || '11',
                is_deleted: false,
                deleted_at: null,
                updated_at: new Date().toISOString()
            };
        });

        // Cập nhật lại bộ nhớ local của trình duyệt
        try {
            const cacheKey = `${STORAGE_KEYS.CUSTOM_QUESTIONS}_${cleanSubject}`;
            if (replaceAll) {
                localStorage.setItem(cacheKey, JSON.stringify(questionsList));
            } else {
                const rawExisting = localStorage.getItem(cacheKey);
                const existingList = rawExisting ? JSON.parse(rawExisting) : [];
                const merged = Array.isArray(existingList) ? [...existingList] : [];
                for (const item of questionsList) {
                    const idx = merged.findIndex(m => Number(m?.id) === Number(item?.id));
                    if (idx !== -1) merged[idx] = item;
                    else merged.push(item);
                }
                localStorage.setItem(cacheKey, JSON.stringify(merged));
            }
        } catch (e) { }

        if (this.isSupabaseActive && this.client) {
            try {
                // Chia nhỏ chunk 50 câu để tránh quá tải payload
                const chunkSize = 50;
                let insertedCount = 0;
                for (let i = 0; i < records.length; i += chunkSize) {
                    const chunk = records.slice(i, i + chunkSize);
                    const { data, error } = await this._executeWriteWithSchemaFallback(
                        'quiz_questions',
                        OPTIONAL_QUESTION_COLUMNS,
                        (candidateChunk) => this.client
                            .from('quiz_questions')
                            .upsert(candidateChunk, { onConflict: 'id' })
                            .select('id'),
                        chunk
                    );
                    if (error) throw error;
                    (data || []).forEach((row, rowIndex) => {
                        if (questionsList[i + rowIndex] && row?.id !== undefined) questionsList[i + rowIndex].id = row.id;
                    });
                    insertedCount += (data ? data.length : chunk.length);
                }
                return { success: true, count: insertedCount };
            } catch (e) {
                console.error("[DatabaseService] Lỗi bulk insert câu hỏi:", e);
                return { success: false, count: 0, error: e.message };
            }
        }

        return { success: true, count: questionsList.length, localOnly: true };
    }

    /**
     * Tương thích ngược: Đồng bộ ngân hàng câu hỏi ban đầu lên Supabase Cloud
     */
    async seedInitialQuestions(questionsList, subjectKey = 'history') {
        return await this.saveQuestionsBulk(questionsList, subjectKey, true);
    }

    /**
     * Alias đồng nhất với tên gọi trong app.js
     */
    async fetchQuestionsBySubject(subjectKey = 'history') {
        return await this.fetchQuestionsOnline(subjectKey);
    }

    /**
     * Xóa 1 câu hỏi theo ID (ưu tiên soft-delete, fallback hard-delete cho schema cũ)
     */
    async deleteQuestion(qId) {
        this._updateMaxQuestionIdCache(qId);
        let removedLocal = false;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith(`${STORAGE_KEYS.CUSTOM_QUESTIONS}_`)) continue;
                const raw = localStorage.getItem(key);
                if (!raw) continue;
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) continue;
                const filtered = parsed.filter(item => String(item?.id) !== String(qId));
                if (filtered.length !== parsed.length) {
                    localStorage.setItem(key, JSON.stringify(filtered));
                    removedLocal = true;
                }
            }
        } catch (e) {}

        if (this.isSupabaseActive && this.client && qId) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { error: rpcErr } = await this.client.rpc('admin_delete_question', {
                        p_admin_token: adminToken,
                        p_question_id: Number(qId),
                        p_hard: false
                    });
                    if (!rpcErr) return true;
                    if (!this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                const nowIso = this.getNowIso();
                let { error } = await this.client
                    .from('quiz_questions')
                    .update({ is_deleted: true, deleted_at: nowIso })
                    .eq('id', qId);
                if (error && (error.code === '42703' || error.code === 'PGRST204' || /is_deleted|deleted_at|column .* does not exist/i.test(error.message || ''))) {
                    ({ error } = await this.client.from('quiz_questions').delete().eq('id', qId));
                }
                if (error) throw error;
                return true;
            } catch (e) {
                console.error("[DatabaseService] Lỗi khi xóa câu hỏi:", e);
                throw e;
            }
        }
        return removedLocal;
    }

    /**
     * Xóa toàn bộ câu hỏi của một môn học (ưu tiên soft-delete, fallback hard-delete cho schema cũ)
     */
    async clearQuestionsBySubject(subjectKey) {
        const cleanSubject = String(subjectKey || '').trim();
        if (!cleanSubject) return { success: false, count: 0, error: 'Thiếu mã môn học.' };
        this._updateMaxQuestionIdCache(this._getLocalMaxQuestionId());
        if (!this.isSupabaseActive || !this.client) {
            return { success: false, count: 0, error: 'Supabase Cloud chưa sẵn sàng.' };
        }

        try {
            const nowIso = this.getNowIso();
            const adminToken = this.getAdminSessionToken();
            if (adminToken) {
                const { data: rpcCount, error: rpcErr } = await this.client.rpc('admin_clear_questions_by_subject', {
                    p_admin_token: adminToken, p_subject_key: cleanSubject
                });
                if (!rpcErr) {
                    try { localStorage.removeItem(`${STORAGE_KEYS.CUSTOM_QUESTIONS}_${cleanSubject}`); } catch (e) {}
                    return { success: true, count: Number(rpcCount || 0) };
                }
                if (!this._isMissingRpcError(rpcErr)) throw rpcErr;
            }
            let usedSoftDelete = true;
            let { error: deleteError } = await this.client
                .from('quiz_questions')
                .update({ is_deleted: true, deleted_at: nowIso })
                .eq('subject_key', cleanSubject)
                .or('is_deleted.is.false,is_deleted.is.null');

            if (deleteError && (deleteError.code === '42703' || deleteError.code === 'PGRST204' || /is_deleted|deleted_at|column .* does not exist/i.test(deleteError.message || ''))) {
                usedSoftDelete = false;
                ({ error: deleteError } = await this.client
                    .from('quiz_questions')
                    .delete()
                    .eq('subject_key', cleanSubject));
            }
            if (deleteError) throw deleteError;

            // Không coi request xóa thành công nếu RLS chặn silently hoặc
            // còn câu hỏi mồ côi. Chỉ trả success sau khi đọc xác minh count=0.
            let verifyQuery = this.client
                .from('quiz_questions')
                .select('id', { count: 'exact', head: true })
                .eq('subject_key', cleanSubject);
            if (usedSoftDelete) {
                verifyQuery = verifyQuery.eq('is_deleted', false);
            }
            const { count, error: verifyError } = await verifyQuery;
            if (verifyError) throw verifyError;
            if (Number(count || 0) !== 0) {
                throw new Error(`Còn ${count} câu hỏi thuộc môn ${cleanSubject} trên Cloud.`);
            }

            try { localStorage.removeItem(`${STORAGE_KEYS.CUSTOM_QUESTIONS}_${cleanSubject}`); } catch (e) {}
            console.debug('[DatabaseService] Subject questions deleted and verified:', { subjectKey: cleanSubject, count: 0 });
            return { success: true, count: 0 };
        } catch (error) {
            console.error('[DatabaseService] Không thể xóa toàn bộ câu hỏi của môn:', { subjectKey: cleanSubject, error });
            return { success: false, count: null, error: error.message || 'Không thể xóa ngân hàng câu hỏi.' };
        }
    }

    // =========================================================================
    // PHẦN 3: CHẶN IP TỨC THÌ (BANNED IP ENFORCEMENT)
    // =========================================================================

    /**
     * Chặn IP (Đã fix lỗi chặn IP mới chưa từng đăng nhập)
     */
    async banIp(ipAddress, reason = "Vi phạm quy chế ôn tập") {
        const cleanIp = (ipAddress || "").trim();
        if (!cleanIp || /^(Chưa xác định|IP Cục Bộ|SYSTEM|ALL)$/i.test(cleanIp)) {
            return { success: false, error: "Địa chỉ IP không hợp lệ." };
        }

        const nowIso = new Date().toISOString();
        const banStatus = `BANNED: ${reason}`;

        // 1. Lưu LocalStorage
        let bannedMap = {};
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.BANNED_IPS);
            if (raw) bannedMap = JSON.parse(raw);
            bannedMap[cleanIp] = { bannedAt: nowIso, reason: reason };
            localStorage.setItem(STORAGE_KEYS.BANNED_IPS, JSON.stringify(bannedMap));
        } catch (e) {}

        // 2. Đồng bộ Supabase Cloud
        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { error: rpcErr } = await this.client.rpc('admin_ban_ip', {
                        p_admin_token: adminToken,
                        p_ip: cleanIp,
                        p_reason: reason
                    });
                    if (!rpcErr) return { success: true, ip: cleanIp, reason: reason };
                    if (!this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                const { data: updated, error: updateErr } = await this.client.from('quiz_logins')
                    .select('id, player_name').eq('ip_address', cleanIp).eq('player_name', '__BANNED_IP__').limit(1);
                if (updateErr) throw updateErr;
                const hasManualBanRow = Array.isArray(updated) && updated.length > 0;
                // Nếu chưa có bản ghi __BANNED_IP__ cho IP này, INSERT riêng để lưu lý do mà không ghi đè score_summary của học sinh
                if (!hasManualBanRow) {
                    const banPayload = {
                        id: this.generateUUID(),
                        player_name: '__BANNED_IP__',
                        ip_address: cleanIp,
                        device_info: 'Manual Ban',
                        status: banStatus,
                        score_summary: reason,
                        last_active: nowIso,
                        created_at: nowIso
                    };
                    const { error: insertErr } = await this._executeWriteWithSchemaFallback(
                        'quiz_logins',
                        OPTIONAL_LOGIN_COLUMNS,
                        (candidate) => this.client.from('quiz_logins').insert([candidate]),
                        banPayload
                    );
                    if (insertErr) throw insertErr;
                } else {
                    const { error: banRowErr } = await this.client
                        .from('quiz_logins')
                        .update({ status: banStatus, score_summary: reason, last_active: nowIso })
                        .eq('ip_address', cleanIp)
                        .eq('player_name', '__BANNED_IP__');
                    if (banRowErr) throw banRowErr;
                }
            } catch (err) {
                console.error("[DatabaseService] Lỗi khi chặn IP trên Supabase:", err);
                return { success: false, ip: cleanIp, error: err.message || 'Không thể đồng bộ chặn IP lên Cloud.' };
            }
        }

        return { success: true, ip: cleanIp, reason: reason };
    }

    /**
     * Mở khóa IP bị chặn
     */
    async unbanIp(ipAddress) {
        const cleanIp = (ipAddress || "").trim();
        if (!cleanIp) return { success: false };
        const nowIso = this.getNowIso();

        // 1. Xóa trong LocalStorage
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.BANNED_IPS);
            if (raw) {
                let bannedMap = JSON.parse(raw);
                delete bannedMap[cleanIp];
                localStorage.setItem(STORAGE_KEYS.BANNED_IPS, JSON.stringify(bannedMap));
            }
        } catch (e) {}

        // 2. Cập nhật trên Supabase Cloud
        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { error: rpcErr } = await this.client.rpc('admin_unban_ip', {
                        p_admin_token: adminToken,
                        p_ip: cleanIp
                    });
                    if (!rpcErr) return { success: true, ip: cleanIp };
                    if (!this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                // Phục hồi trạng thái bình thường
                const { error: updateErr } = await this.client
                    .from('quiz_logins')
                    .update({ status: "Đang ôn tập", last_active: nowIso })
                    .eq('ip_address', cleanIp)
                    .like('status', 'BANNED%')
                    .not('player_name', 'eq', '__BANNED_IP__')
                    .not('score_summary', 'ilike', '%điểm%')
                    .not('score_summary', 'ilike', '%__DETAIL__%')
                    .not('status', 'ilike', '%đã nộp bài%')
                    .not('status', 'ilike', '%hoàn thành%');
                if (updateErr) throw updateErr;

                // Xóa bản ghi chặn thủ công nếu có
                const { error: deleteErr } = await this.client
                    .from('quiz_logins')
                    .delete()
                    .eq('ip_address', cleanIp)
                    .eq('player_name', '__BANNED_IP__');
                if (deleteErr) throw deleteErr;
            } catch (err) {
                console.error("[DatabaseService] Lỗi khi mở khóa IP trên Supabase:", err);
                return { success: false, ip: cleanIp, error: err.message || 'Không thể mở khóa IP trên Cloud.' };
            }
        }

        return { success: true, ip: cleanIp };
    }

    /**
     * Kiểm tra nhanh xem IP này có đang bị chặn không
     */
    async checkIsIpBanned(ipAddress) {
        const cleanIp = (ipAddress || "").trim();
        if (!cleanIp || cleanIp === "Chưa xác định" || cleanIp === "IP Cục Bộ") {
            return { isBanned: false };
        }

        if (this.isSupabaseActive && this.client) {
            try {
                const { data: rpcRes, error: rpcErr } = await this.client.rpc('public_check_ip_banned', { p_ip: cleanIp });
                if (!rpcErr && rpcRes && typeof rpcRes.isBanned === 'boolean') {
                    return rpcRes;
                }
            } catch (e) {}
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('player_name, status, score_summary')
                    .eq('ip_address', cleanIp)
                    .like('status', 'BANNED%')
                    .limit(5);

                if (!error && data && data.length > 0) {
                    const manualRow = data.find(r => r.player_name === '__BANNED_IP__');
                    const targetRow = manualRow || data[0];
                    const statusReason = String(targetRow.status || '').replace(/^BANNED:\s*/, '').trim();
                    const reason = (manualRow && manualRow.score_summary)
                        ? manualRow.score_summary
                        : (statusReason || "Vi phạm quy chế");
                    return { isBanned: true, reason: reason };
                }
            } catch (err) {}
        }

        // Kiểm tra LocalStorage fallback
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.BANNED_IPS);
            if (raw) {
                const bannedMap = JSON.parse(raw);
                if (bannedMap[cleanIp]) {
                    return { isBanned: true, reason: bannedMap[cleanIp].reason || "Vi phạm quy chế" };
                }
            }
        } catch (e) {}

        return { isBanned: false };
    }

    getBannedIps() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.BANNED_IPS);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    /**
     * Tải toàn bộ danh sách IP đang bị chặn từ Supabase Cloud và LocalStorage
     */
    async fetchBannedIpsList() {
        const bannedList = [];
        const seenIps = new Set();

        // 1. Tải từ Supabase Cloud
        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { data: rpcBanned, error: rpcErr } = await this.client.rpc('admin_manage_config', { p_admin_token: adminToken, p_action: 'list_banned_ips', p_record_id: null, p_payload: null });
                    if (!rpcErr && Array.isArray(rpcBanned)) {
                        rpcBanned.forEach(item => {
                            const ip = String(item.ip_address || '').trim();
                            if (ip && !seenIps.has(ip)) {
                                seenIps.add(ip);
                                bannedList.push({ ip, playerName: item.player_name === '__BANNED_IP__' ? 'Chặn thủ công' : item.player_name, reason: item.score_summary || String(item.status || '').replace(/^BANNED:\s*/i, '') || 'Vi phạm quy chế', bannedAt: item.last_active || item.created_at || new Date().toISOString(), deviceInfo: item.device_info || 'Không rõ' });
                            }
                        });
                        return bannedList;
                    }
                    if (rpcErr && !this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('id, player_name, ip_address, device_info, status, score_summary, last_active, created_at')
                    .like('status', 'BANNED%')
                    .order('last_active', { ascending: false });

                if (!error && Array.isArray(data)) {
                    data.forEach(item => {
                        const ip = (item.ip_address || '').trim();
                        if (ip && !seenIps.has(ip)) {
                            seenIps.add(ip);
                            const statusReason = item.status ? item.status.replace(/^BANNED:\s*/, "").trim() : "";
                            const reason = item.player_name === '__BANNED_IP__'
                                ? (item.score_summary || statusReason || "Vi phạm quy chế")
                                : (statusReason || "Vi phạm quy chế");
                            bannedList.push({
                                ip: ip,
                                playerName: item.player_name === '__BANNED_IP__' ? 'Chặn thủ công' : item.player_name,
                                reason: reason || "Vi phạm quy chế",
                                bannedAt: item.last_active || item.created_at || new Date().toISOString(),
                                deviceInfo: item.device_info || 'Không rõ'
                            });
                        }
                    });
                }
            } catch (err) {
                console.warn("[DatabaseService] Lỗi khi tải danh sách IP bị chặn từ Supabase:", err);
            }
        }

        // 2. Hợp nhất với LocalStorage fallback
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.BANNED_IPS);
            if (raw) {
                const map = JSON.parse(raw);
                for (const [ip, info] of Object.entries(map)) {
                    const cleanIp = (ip || '').trim();
                    if (cleanIp && !seenIps.has(cleanIp)) {
                        seenIps.add(cleanIp);
                        bannedList.push({
                            ip: cleanIp,
                            playerName: 'Chặn cục bộ',
                            reason: (info && info.reason) || "Vi phạm quy chế",
                            bannedAt: (info && info.bannedAt) || new Date().toISOString(),
                            deviceInfo: 'Thiết bị lưu trữ'
                        });
                    }
                }
            }
        } catch (e) {}

        return bannedList;
    }

    // =========================================================================
    // PHẦN 4: PHÁT THÔNG BÁO THỜI GIAN THỰC CHO THÍ SINH (5 GIÂY)
    // =========================================================================

    /**
     * Giám thị phát thông báo cho toàn phòng hoặc riêng 1 IP / học sinh
     */
    async sendBroadcastNotice(message, targetIp = 'ALL', targetName = '') {
        const cleanMsg = (message || "").trim();
        if (!cleanMsg) return { success: false, error: 'Nội dung thông báo không được để trống.' };
        const cleanTargetIp = String(targetIp || 'ALL').trim() || 'ALL';
        const cleanTargetName = String(targetName || '').trim();

        const nowIso = this.getNowIso();
        const noticeId = this.generateUUID();

        // Không truyền created_at từ client để PostgreSQL tự gán now() chuẩn server,
        // tránh lỗi lệch múi giờ / đồng hồ trên máy học sinh hoặc Admin.
        const record = {
            id: noticeId,
            player_name: '__SYSTEM_NOTICE__',
            ip_address: cleanTargetIp,
            device_info: cleanTargetName || '5s',
            status: 'ACTIVE',
            score_summary: cleanMsg,
            last_active: nowIso
        };

        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { error: rpcErr } = await this.client.rpc('admin_manage_config', {
                        p_admin_token: adminToken,
                        p_action: 'broadcast_notice',
                        p_record_id: null,
                        p_payload: { id: noticeId, message: cleanMsg, targetIp: cleanTargetIp, targetName: cleanTargetName }
                    });
                    if (!rpcErr) {
                        try {
                            localStorage.setItem('quiz_latest_system_notice', JSON.stringify({
                                id: noticeId, message: cleanMsg, targetIp: cleanTargetIp,
                                targetName: cleanTargetName, timestamp: Date.now()
                            }));
                        } catch (e) {}
                        return { success: true, id: noticeId, message: cleanMsg, targetIp: cleanTargetIp, targetName: cleanTargetName };
                    }
                    if (!this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                // Chỉ dọn thông báo cũ của cùng đối tượng nhận (cùng targetIp/targetName hoặc cùng nhóm broadcast),
                // bảo toàn các thông báo riêng chưa đọc của những học sinh khác.
                let deleteQuery = this.client
                    .from('quiz_logins')
                    .delete()
                    .eq('player_name', '__SYSTEM_NOTICE__')
                    .eq('ip_address', cleanTargetIp);
                if (cleanTargetName) {
                    deleteQuery = deleteQuery.ilike('device_info', String(cleanTargetName).replace(/[\\%_]/g, '\\$&'));
                } else {
                    deleteQuery = deleteQuery.eq('device_info', '5s');
                }
                const { error: deleteError } = await deleteQuery;
                if (deleteError) throw deleteError;
                const { error } = await this.client
                    .from('quiz_logins')
                    .insert([record]);
                if (error) throw error;
            } catch (err) {
                console.error("[DatabaseService] Lỗi phát thông báo:", err);
                return { success: false, error: err.message };
            }
        }

        try {
            localStorage.setItem('quiz_latest_system_notice', JSON.stringify({
                id: noticeId, message: cleanMsg, targetIp: cleanTargetIp,
                targetName: cleanTargetName, timestamp: Date.now()
            }));
        } catch (e) { console.warn('[DatabaseService] Không lưu được cache thông báo:', e); }

        return { success: true, id: noticeId, message: cleanMsg, targetIp: cleanTargetIp, targetName: cleanTargetName };
    }

    /**
     * Máy học sinh lắng nghe thông báo mới nhất (Khớp theo ALL, theo IP hoặc theo tên học sinh;
     * không phụ thuộc đồng hồ máy học sinh bị lệch giờ)
     */
    async fetchLatestNotice(clientIp, playerName = '') {
        const cleanIp = String(clientIp || '').trim();
        const validIp = (cleanIp && !cleanIp.startsWith('Đang') && cleanIp !== 'Chưa xác định' && cleanIp !== '—') ? cleanIp : '';
        const normPlayer = String(playerName || '').trim().toLowerCase();

        const matchesTarget = (itemIp, itemDeviceInfo) => {
            const targetIp = String(itemIp || '').trim();
            const targetName = String(itemDeviceInfo || '').trim().toLowerCase();
            const hasSpecificName = Boolean(targetName && targetName !== '5s' && targetName !== 'all');
            if (targetIp === 'ALL' && !hasSpecificName) return true;
            if (targetIp !== 'ALL' && hasSpecificName) return Boolean(validIp && targetIp === validIp && normPlayer && normPlayer !== 'khách truy cập' && targetName === normPlayer);
            if (targetIp !== 'ALL' && !hasSpecificName) return Boolean(validIp && targetIp === validIp);
            return Boolean(normPlayer && normPlayer !== 'khách truy cập' && targetName === normPlayer);
        };

        if (this.isSupabaseActive && this.client) {
            try {
                const { data: rpcNotice, error: rpcNoticeErr } = await this.client.rpc('public_get_latest_notice', {
                    p_ip: validIp,
                    p_player_name: normPlayer
                });
                if (!rpcNoticeErr && rpcNotice && rpcNotice.message) {
                    const serverTime = new Date(rpcNotice.createdAt || Date.now()).getTime() || Date.now();
                    return {
                        id: rpcNotice.id,
                        message: String(rpcNotice.message || '').trim(),
                        targetIp: rpcNotice.targetIp,
                        targetName: rpcNotice.targetName,
                        createdAt: rpcNotice.createdAt,
                        timestamp: serverTime
                    };
                }
                if (!rpcNoticeErr && rpcNotice === null) {
                    return null;
                }
            } catch (e) {}
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('id, player_name, ip_address, device_info, status, score_summary, last_active, created_at')
                    .eq('player_name', '__SYSTEM_NOTICE__')
                    .order('created_at', { ascending: false })
                    .limit(25);

                if (!error && Array.isArray(data) && data.length > 0) {
                    const match = data.find(item => {
                        const msg = typeof item.score_summary === 'string' ? item.score_summary.trim() : '';
                        if (msg.length < 1) return false;
                        return matchesTarget(item.ip_address, item.device_info);
                    });
                    if (match) {
                        const serverTime = new Date(match.created_at || match.last_active).getTime() || Date.now();
                        return {
                            id: match.id,
                            message: String(match.score_summary || '').trim(),
                            targetIp: match.ip_address,
                            targetName: match.device_info,
                            createdAt: match.created_at || match.last_active,
                            timestamp: serverTime
                        };
                    }
                }
            } catch (e) {}
        }

        try {
            const raw = localStorage.getItem('quiz_latest_system_notice');
            if (raw) {
                const n = JSON.parse(raw);
                const msg = typeof n?.message === 'string' ? n.message.trim() : '';
                if (msg.length >= 1 && matchesTarget(n.targetIp, n.targetName)) {
                    return n;
                }
            }
        } catch (e) {}

        return null;
    }

    /**
     * Alias phát thông báo tương thích với app.js
     */
    async broadcastNotice(message, targetIp = 'ALL', targetName = '') {
        return await this.sendBroadcastNotice(message, targetIp, targetName);
    }

    /**
     * Lấy thông báo mới nhất cho học sinh (tương thích app.js)
     */
    async getSystemNotice(clientIp, playerName = '') {
        const notice = await this.fetchLatestNotice(clientIp, playerName);
        if (!notice) return null;
        return {
            id: notice.id,
            content: notice.message,
            message: notice.message,
            active: true,
            targetIp: notice.targetIp,
            targetName: notice.targetName,
            createdAt: notice.createdAt,
            timestamp: notice.timestamp
        };
    }

    // =========================================================================
    // PHẦN 5: PHÂN QUYỀN & CHẾ ĐỘ MÔN ĐỊA LÍ 11
    // =========================================================================

    async fetchGeoConfig() {
        let mode = 'PUBLIC';
        let ips = [];
        let grade5Ips = [];

        if (this.isSupabaseActive && this.client) {
            try {
                const { data: rpcGeo, error: rpcGeoErr } = await this.client.rpc('public_get_geo_config');
                if (!rpcGeoErr && rpcGeo && typeof rpcGeo === 'object') {
                    const gMode = rpcGeo.mode === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';
                    const gIps = Array.isArray(rpcGeo.ips) ? rpcGeo.ips : [];
                    const g5 = (Array.isArray(rpcGeo.grade5Ips) ? rpcGeo.grade5Ips : []).map(ip => String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase()).filter(Boolean);
                    try {
                        localStorage.setItem(STORAGE_KEYS.GEO_CONFIG_CACHE, JSON.stringify({ mode: gMode, ips: gIps, grade5Ips: g5 }));
                        localStorage.setItem('quiz_geo_mode', gMode);
                        localStorage.setItem('quiz_allowed_geo_ips', JSON.stringify(gIps));
                        localStorage.setItem('quiz_allowed_grade5_ips', JSON.stringify(g5));
                    } catch (e) {}
                    return { mode: gMode, ips: gIps, grade5Ips: g5 };
                }
            } catch (e) {}
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('device_info, score_summary')
                    .eq('id', SYSTEM_RECORDS.GEO_CONFIG)
                    .limit(1);

                if (!error && data && data.length > 0) {
                    const row = data[0];
                    if (row.device_info === 'PUBLIC' || row.device_info === 'PRIVATE') {
                        mode = row.device_info;
                    }
                    if (row.score_summary) {
                        try {
                            const parsed = JSON.parse(row.score_summary);
                            if (Array.isArray(parsed)) {
                                ips = parsed;
                            } else if (parsed && typeof parsed === 'object') {
                                if (parsed.mode) mode = parsed.mode;
                                if (Array.isArray(parsed.ips)) ips = parsed.ips;
                                if (Array.isArray(parsed.grade5Ips)) grade5Ips = parsed.grade5Ips;
                                else if (Array.isArray(parsed.grade5_ips)) grade5Ips = parsed.grade5_ips;
                                else if (Array.isArray(parsed.class5Ips)) grade5Ips = parsed.class5Ips;
                            }
                        } catch (e) {}
                    }
                    grade5Ips = grade5Ips.map(ip => String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase()).filter(Boolean);
                    try {
                        localStorage.setItem(STORAGE_KEYS.GEO_CONFIG_CACHE, JSON.stringify({ mode, ips, grade5Ips }));
                        localStorage.setItem('quiz_geo_mode', mode);
                        localStorage.setItem('quiz_allowed_geo_ips', JSON.stringify(ips));
                        localStorage.setItem('quiz_allowed_grade5_ips', JSON.stringify(grade5Ips));
                    } catch (e) {}
                    console.debug('[DatabaseService] Loaded Grade 5 access config from Supabase:', { mode, ips, grade5Ips });
                    return { mode, ips, grade5Ips };
                }
            } catch (e) {
                console.warn("[DatabaseService] Lỗi lấy cấu hình phân quyền môn Địa:", e);
            }
        }

        try {
            let loadedFromCache = false;
            const cachedRaw = localStorage.getItem(STORAGE_KEYS.GEO_CONFIG_CACHE);
            if (cachedRaw) {
                const cached = JSON.parse(cachedRaw);
                if (cached && typeof cached === 'object') {
                    if (cached.mode === 'PUBLIC' || cached.mode === 'PRIVATE') mode = cached.mode;
                    if (Array.isArray(cached.ips)) ips = cached.ips;
                    if (Array.isArray(cached.grade5Ips)) grade5Ips = cached.grade5Ips;
                    loadedFromCache = true;
                }
            }
            if (!loadedFromCache) {
                const savedMode = localStorage.getItem('quiz_geo_mode');
                if (savedMode === 'PUBLIC' || savedMode === 'PRIVATE') mode = savedMode;
                const raw = localStorage.getItem('quiz_allowed_geo_ips');
                ips = raw ? JSON.parse(raw) : [];
                const grade5Raw = localStorage.getItem('quiz_allowed_grade5_ips');
                grade5Ips = grade5Raw ? JSON.parse(grade5Raw) : [];
            }
        } catch (e) {}

        grade5Ips = (Array.isArray(grade5Ips) ? grade5Ips : []).map(ip => String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase()).filter(Boolean);
        ips = Array.isArray(ips) ? ips : [];
        console.debug('[DatabaseService] Loaded Grade 5 access config from localStorage:', { mode, ips, grade5Ips });
        return { mode, ips, grade5Ips };
    }

    async saveGeoConfig(mode = 'PUBLIC', ipList = [], grade5IpList) {
        const cleanMode = (mode === 'PRIVATE') ? 'PRIVATE' : 'PUBLIC';
        const cleanList = Array.isArray(ipList) ? [...new Set(ipList.map(ip => String(typeof ip === 'object' ? ip?.ip : ip).trim()).filter(Boolean))] : [];
        let storedGrade5Ips = grade5IpList;
        if (!Array.isArray(storedGrade5Ips)) {
            try { storedGrade5Ips = JSON.parse(localStorage.getItem('quiz_allowed_grade5_ips') || '[]'); } catch (e) { storedGrade5Ips = []; }
        }
        const cleanGrade5Ips = Array.isArray(storedGrade5Ips) ? [...new Set(storedGrade5Ips.map(ip => String(typeof ip === 'object' ? ip?.ip : ip).trim()).filter(Boolean))] : [];

        try {
            localStorage.setItem(STORAGE_KEYS.GEO_CONFIG_CACHE, JSON.stringify({ mode: cleanMode, ips: cleanList, grade5Ips: cleanGrade5Ips }));
            localStorage.setItem('quiz_geo_mode', cleanMode);
            localStorage.setItem('quiz_allowed_geo_ips', JSON.stringify(cleanList));
            localStorage.setItem('quiz_allowed_grade5_ips', JSON.stringify(cleanGrade5Ips));
        } catch (e) {}

        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { error: rpcErr } = await this.client.rpc('admin_manage_config', {
                        p_admin_token: adminToken, p_action: 'set', p_record_id: SYSTEM_RECORDS.GEO_CONFIG,
                        p_payload: { player_name: '__ALLOWED_GEO_IPS__', device_info: cleanMode, status: 'ACTIVE', score_summary: JSON.stringify({ mode: cleanMode, ips: cleanList, grade5Ips: cleanGrade5Ips }) }
                    });
                    if (!rpcErr) return { mode: cleanMode, ips: cleanList, grade5Ips: cleanGrade5Ips };
                    if (!this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                const { error } = await this.client
                    .from('quiz_logins')
                    .upsert([{
                        id: SYSTEM_RECORDS.GEO_CONFIG,
                        player_name: '__ALLOWED_GEO_IPS__',
                        ip_address: 'SYSTEM',
                        device_info: cleanMode,
                        status: 'ACTIVE',
                        score_summary: JSON.stringify({ mode: cleanMode, ips: cleanList, grade5Ips: cleanGrade5Ips }),
                        last_active: this.getNowIso()
                    }], { onConflict: 'id' });
                if (error) throw error;
            } catch (e) {
                console.error("[DatabaseService] Lỗi lưu cấu hình môn Địa:", e);
                throw e;
            }
        }

        return { mode: cleanMode, ips: cleanList, grade5Ips: cleanGrade5Ips };
    }

    async setGeoMode(mode) {
        const config = await this.fetchGeoConfig();
        return await this.saveGeoConfig(mode, config.ips, config.grade5Ips);
    }

    async fetchAllowedGeoIps() {
        const config = await this.fetchGeoConfig();
        return config.ips;
    }

    async saveAllowedGeoIps(ipList) {
        const config = await this.fetchGeoConfig();
        const res = await this.saveGeoConfig(config.mode, ipList, config.grade5Ips);
        return res.ips;
    }

    async addGeoAllowedIp(ipAddress) {
        const cleanIp = (ipAddress || "").trim();
        if (!cleanIp) return false;
        const config = await this.fetchGeoConfig();
        if (!config.ips.includes(cleanIp)) {
            config.ips.push(cleanIp);
            await this.saveGeoConfig(config.mode, config.ips, config.grade5Ips);
        }
        return config.ips;
    }

    async removeGeoAllowedIp(ipAddress) {
        const cleanIp = (ipAddress || "").trim();
        if (!cleanIp) return false;
        const config = await this.fetchGeoConfig();
        config.ips = config.ips.filter(ip => ip !== cleanIp);
        await this.saveGeoConfig(config.mode, config.ips, config.grade5Ips);
        return config.ips;
    }

    // =========================================================================
    // PHẦN 6: CHẾ ĐỘ BẢO TRÌ HỆ THỐNG / KHÓA TRANG WEB (SYSTEM MAINTENANCE)
    // =========================================================================

    async setMaintenanceStatus(isActive, message = "Trang web đang tạm dừng để cập nhật đề cương và dữ liệu mới. Vui lòng quay lại sau!") {
        const cleanActive = !!isActive;
        const cleanMsg = (message || "").trim() || "Trang web đang tạm dừng để cập nhật đề cương và dữ liệu mới. Vui lòng quay lại sau!";
        const nowIso = new Date().toISOString();

        try {
            localStorage.setItem(STORAGE_KEYS.MAINTENANCE, cleanActive ? 'true' : 'false');
            localStorage.setItem(STORAGE_KEYS.MAINTENANCE_MSG, cleanMsg);
        } catch (e) {}

        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { error: rpcErr } = await this.client.rpc('admin_manage_config', {
                        p_admin_token: adminToken, p_action: 'set', p_record_id: SYSTEM_RECORDS.MAINTENANCE,
                        p_payload: { player_name: '__SYSTEM_MAINTENANCE__', device_info: cleanActive ? 'ON' : 'OFF', status: cleanActive ? 'ACTIVE' : 'INACTIVE', score_summary: cleanMsg }
                    });
                    if (!rpcErr) return { isActive: cleanActive, message: cleanMsg };
                    if (!this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                const { error } = await this.client
                    .from('quiz_logins')
                    .upsert([{
                        id: SYSTEM_RECORDS.MAINTENANCE,
                        player_name: '__SYSTEM_MAINTENANCE__',
                        ip_address: 'SYSTEM',
                        device_info: cleanActive ? 'ON' : 'OFF',
                        status: cleanActive ? 'ACTIVE' : 'INACTIVE',
                        score_summary: cleanMsg,
                        last_active: nowIso
                    }], { onConflict: 'id' });
                if (error) throw error;
            } catch (e) {
                console.error("[DatabaseService] Lỗi cập nhật trạng thái bảo trì:", e);
                throw e;
            }
        }

        return { isActive: cleanActive, message: cleanMsg };
    }

    async checkMaintenanceStatus() {
        let isActive = false;
        let message = "Trang web đang tạm dừng để cập nhật đề cương và dữ liệu mới. Vui lòng quay lại sau!";

        if (this.isSupabaseActive && this.client) {
            try {
                const { data: rpcMaint, error: rpcMaintErr } = await this.client.rpc('public_get_maintenance_status');
                if (!rpcMaintErr && rpcMaint && typeof rpcMaint.isActive === 'boolean') {
                    isActive = rpcMaint.isActive;
                    if (rpcMaint.message) message = rpcMaint.message;
                    try {
                        localStorage.setItem(STORAGE_KEYS.MAINTENANCE, isActive ? 'true' : 'false');
                        localStorage.setItem(STORAGE_KEYS.MAINTENANCE_MSG, message);
                    } catch (e) {}
                    return { isActive, message };
                }
            } catch (e) {}
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('device_info, status, score_summary, last_active')
                    .eq('id', SYSTEM_RECORDS.MAINTENANCE)
                    .limit(1);

                if (!error && data && data.length > 0) {
                    const row = data[0];
                    isActive = (row.status === 'ACTIVE' || row.device_info === 'ON');
                    if (row.score_summary) message = row.score_summary;

                    try {
                        localStorage.setItem(STORAGE_KEYS.MAINTENANCE, isActive ? 'true' : 'false');
                        localStorage.setItem(STORAGE_KEYS.MAINTENANCE_MSG, message);
                    } catch (e) {}

                    return { isActive, message };
                }
            } catch (e) {
                console.warn("[DatabaseService] Lỗi check bảo trì:", e);
            }
        }

        try {
            isActive = localStorage.getItem(STORAGE_KEYS.MAINTENANCE) === 'true';
            const savedMsg = localStorage.getItem(STORAGE_KEYS.MAINTENANCE_MSG);
            if (savedMsg) message = savedMsg;
        } catch (e) {}

        return { isActive, message };
    }

    // =========================================================================
    // PHẦN 7: TỰ ĐỘNG NHẬN DIỆN IP ADMIN & WHITELIST (PASSWORDLESS ADMIN)
    // =========================================================================

    /**
     * Tải danh sách IP được ủy quyền Admin từ Supabase Cloud
     */
    async fetchAdminIpsConfig() {
        let masterIp = "";
        let masterDeviceCode = "";
        let allowedIps = []; // mảng các đối tượng: [{ ip: "1.2.3.4", deviceCode: "QM-XXXXXX", name: "Máy bàn", isMaster: true }]

        const parseAdminPayload = (rawSummary) => {
            if (!rawSummary) return;
            try {
                const parsed = JSON.parse(rawSummary);
                if (Array.isArray(parsed)) {
                    allowedIps = parsed;
                } else if (parsed && typeof parsed === 'object') {
                    masterIp = String(parsed.masterIp || "").trim();
                    masterDeviceCode = String(parsed.masterDeviceCode || "").trim().toUpperCase();
                    allowedIps = Array.isArray(parsed.allowedIps) ? parsed.allowedIps : (Array.isArray(parsed.ips) ? parsed.ips.map(ip => ({ ip, name: 'Admin', isMaster: ip === masterIp })) : []);
                }
            } catch (e) {}
        };

        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { data: rpcConfig, error: rpcErr } = await this.client.rpc('admin_manage_config', { p_admin_token: adminToken, p_action: 'get', p_record_id: SYSTEM_RECORDS.ADMIN_IPS, p_payload: null });
                    if (!rpcErr && rpcConfig) {
                        parseAdminPayload(rpcConfig.score_summary);
                        const ips = allowedIps.map(x => typeof x === 'string' ? x : x.ip).filter(Boolean);
                        const result = { masterIp, masterDeviceCode, allowedIps, ips };
                        try { localStorage.setItem(STORAGE_KEYS.ADMIN_IPS_CONFIG, JSON.stringify(result)); } catch (e) {}
                        return result;
                    }
                    if (rpcErr && !this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('device_info, score_summary')
                    .eq('id', SYSTEM_RECORDS.ADMIN_IPS)
                    .limit(1);

                if (!error && data && data.length > 0) {
                    parseAdminPayload(data[0].score_summary);
                    // Đồng nhất cấu trúc
                    const ips = allowedIps.map(x => typeof x === 'string' ? x : x.ip).filter(Boolean);
                    const result = { masterIp, masterDeviceCode, allowedIps, ips };
                    try {
                        localStorage.setItem(STORAGE_KEYS.ADMIN_IPS_CONFIG, JSON.stringify(result));
                    } catch (e) {}
                    return result;
                }
            } catch (e) {
                console.warn("[DatabaseService] Lỗi tải cấu hình Admin IPs:", e);
            }
        }

        try {
            const raw = localStorage.getItem(STORAGE_KEYS.ADMIN_IPS_CONFIG);
            if (raw) {
                const cached = JSON.parse(raw);
                if (cached) {
                    const ips = Array.isArray(cached.ips) ? cached.ips : (Array.isArray(cached.allowedIps) ? cached.allowedIps.map(x => typeof x === 'string' ? x : x.ip).filter(Boolean) : []);
                    return {
                        masterIp: cached.masterIp || "",
                        masterDeviceCode: String(cached.masterDeviceCode || "").trim().toUpperCase(),
                        allowedIps: cached.allowedIps || [],
                        ips
                    };
                }
            }
        } catch (e) {}

        const ips = allowedIps.map(x => typeof x === 'string' ? x : x.ip).filter(Boolean);
        return { masterIp, masterDeviceCode, allowedIps, ips };
    }

    /**
     * Lưu cấu hình Whitelist IP / Mã máy Admin lên Supabase Cloud & LocalStorage
     */
    async saveAdminIpsConfig(config) {
        const masterIp = (config && config.masterIp) ? String(config.masterIp).trim() : "";
        const masterDeviceCode = (config && config.masterDeviceCode) ? String(config.masterDeviceCode).trim().toUpperCase() : "";
        let allowedIps = [];
        if (config && Array.isArray(config.allowedIps)) {
            allowedIps = config.allowedIps;
        } else if (config && Array.isArray(config.ips)) {
            allowedIps = config.ips.map(ip => typeof ip === 'string' ? { ip, name: 'Admin', isMaster: ip === masterIp } : ip);
        }
        const ips = allowedIps.map(x => typeof x === 'string' ? x : x.ip).filter(Boolean);
        const payloadStr = JSON.stringify({ masterIp, masterDeviceCode, allowedIps, ips });
        const nowIso = new Date().toISOString();

        try {
            localStorage.setItem(STORAGE_KEYS.ADMIN_IPS_CONFIG, payloadStr);
        } catch (e) {}

        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { error: rpcErr } = await this.client.rpc('admin_manage_config', { p_admin_token: adminToken, p_action: 'set', p_record_id: SYSTEM_RECORDS.ADMIN_IPS, p_payload: { player_name: '__ADMIN_IPS_CONFIG__', device_info: 'PASSWORDLESS_AUTH', status: 'ACTIVE', score_summary: payloadStr } });
                    if (!rpcErr) return { masterIp, allowedIps, ips };
                    if (!this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                const { error } = await this.client
                    .from('quiz_logins')
                    .upsert([{
                        id: SYSTEM_RECORDS.ADMIN_IPS,
                        player_name: '__ADMIN_IPS_CONFIG__',
                        ip_address: 'SYSTEM',
                        device_info: 'PASSWORDLESS_AUTH',
                        status: 'ACTIVE',
                        score_summary: payloadStr,
                        last_active: nowIso
                    }], { onConflict: 'id' });
                if (error) throw error;
            } catch (e) {
                console.error("[DatabaseService] Lỗi lưu Admin IPs lên Supabase:", e);
                throw e;
            }
        }

        return { masterIp, allowedIps, ips };
    }

    /**
     * Thêm một IP vào danh sách Admin
     */
    async addAdminIp(ip, name = "Admin", isMaster = false) {
        const cleanIp = (ip || "").trim();
        if (!cleanIp || cleanIp === "Chưa xác định") return false;

        const config = await this.fetchAdminIpsConfig();
        const existingIdx = config.allowedIps.findIndex(item => (typeof item === 'string' ? item : item.ip) === cleanIp);

        if (existingIdx !== -1) {
            if (typeof config.allowedIps[existingIdx] === 'object') {
                config.allowedIps[existingIdx].name = name || config.allowedIps[existingIdx].name;
                if (isMaster) config.allowedIps[existingIdx].isMaster = true;
            }
        } else {
            config.allowedIps.push({
                ip: cleanIp,
                name: name || "Quản trị viên",
                isMaster: !!isMaster,
                addedAt: new Date().toISOString()
            });
        }

        if (isMaster || !config.masterIp) {
            config.masterIp = cleanIp;
        }

        await this.saveAdminIpsConfig(config);
        return config;
    }

    /**
     * Thu hồi quyền Admin của một IP (Bảo vệ Master IP không bị xóa)
     */
    async removeAdminIp(ip) {
        const cleanIp = (ip || "").trim();
        if (!cleanIp) return false;

        const config = await this.fetchAdminIpsConfig();
        // Không cho phép xóa Master Admin
        if (config.masterIp && config.masterIp === cleanIp) {
            throw new Error("Không thể thu hồi quyền của Master Admin chính!");
        }

        config.allowedIps = config.allowedIps.filter(item => (typeof item === 'string' ? item : item.ip) !== cleanIp);
        await this.saveAdminIpsConfig(config);
        return config;
    }

    /**
     * Kiểm tra nhanh xem IP này có quyền Admin không
     */
    async checkIsAdminIp(ip, deviceCode = "") {
        const cleanIp = (ip || "").trim();
        const cleanDevice = String(deviceCode || "").trim().toUpperCase();
        const config = await this.fetchAdminIpsConfig();
        const masterDevice = String(config.masterDeviceCode || "").trim().toUpperCase();
        const allowed = Array.isArray(config.allowedIps) ? config.allowedIps : [];

        const matchesDeviceEntry = (item) => {
            if (!cleanDevice || !item) return false;
            if (typeof item === 'string') return item.trim().toUpperCase() === cleanDevice || item.trim().toUpperCase().endsWith('-' + cleanDevice);
            const itemDev = String(item.deviceCode || "").trim().toUpperCase();
            const itemRaw = String(item.rawCode || "").trim().toUpperCase();
            const itemTok = String(item.token || "").trim().toUpperCase();
            return itemDev === cleanDevice || itemRaw === cleanDevice || itemTok === cleanDevice || itemTok.endsWith('-' + cleanDevice);
        };

        // Nếu đã khóa quyền Admin theo mã máy Master -> chỉ đúng mã máy đã cấp mới được lên Admin (không cấp chỉ vì trùng WiFi/IP)
        if (masterDevice) {
            if (!cleanDevice) return false;
            if (cleanDevice === masterDevice) return true;
            return allowed.some(matchesDeviceEntry);
        }

        if (cleanDevice && allowed.some(matchesDeviceEntry)) return true;
        if (!cleanIp || cleanIp === "Chưa xác định" || cleanIp === "IP Cục Bộ") return false;
        if (config.masterIp && config.masterIp === cleanIp) return true;
        if (Array.isArray(config.ips) && config.ips.includes(cleanIp)) return true;
        return allowed.some(item => (typeof item === 'string' ? item : item.ip) === cleanIp);
    }

    // =========================================================================
    // PHẦN 8: QUẢN LÝ ĐA MÔN HỌC ĐỘNG (DYNAMIC SUBJECTS HUB)
    // =========================================================================

    /**
     * Tải danh sách môn học động do Admin tự tạo
     */
    async fetchDynamicSubjects() {
        let subjects = [];

        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { data: rpcConfig, error: rpcErr } = await this.client.rpc('admin_manage_config', { p_admin_token: adminToken, p_action: 'get', p_record_id: SYSTEM_RECORDS.DYNAMIC_SUBJECTS, p_payload: null });
                    if (!rpcErr && rpcConfig) {
                        try { subjects = JSON.parse(rpcConfig.score_summary || '[]'); } catch (e) { subjects = []; }
                        if (Array.isArray(subjects)) return subjects;
                    }
                    if (rpcErr && !this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                const { data: rpcSubs, error: rpcSubsErr } = await this.client.rpc('public_get_dynamic_subjects');
                if (!rpcSubsErr && Array.isArray(rpcSubs)) {
                    try {
                        localStorage.setItem(STORAGE_KEYS.DYNAMIC_SUBJECTS, JSON.stringify(rpcSubs));
                    } catch (e) {}
                    return rpcSubs;
                }
            } catch (e) {}
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('score_summary')
                    .eq('id', SYSTEM_RECORDS.DYNAMIC_SUBJECTS)
                    .limit(1);

                if (!error && data && data.length > 0) {
                    if (data[0].score_summary) {
                        try {
                            const parsed = JSON.parse(data[0].score_summary);
                            if (Array.isArray(parsed)) subjects = parsed;
                        } catch (e) {}
                    }
                    try {
                        localStorage.setItem(STORAGE_KEYS.DYNAMIC_SUBJECTS, JSON.stringify(subjects));
                    } catch (e) {}
                    return subjects;
                }
                // Nếu Cloud không lỗi và chưa có bản ghi thì trả rỗng; nếu có lỗi mạng/Supabase thì fallback sang localStorage bên dưới.
                if (!error && (!data || data.length === 0)) return [];
            } catch (e) {}
        }

        try {
            const raw = localStorage.getItem(STORAGE_KEYS.DYNAMIC_SUBJECTS);
            if (raw) subjects = JSON.parse(raw);
        } catch (e) {}

        return subjects;
    }

    /**
     * Lưu danh sách môn học động lên Supabase Cloud
     */
    async saveDynamicSubjects(subjectsList) {
        const cleanList = Array.isArray(subjectsList) ? subjectsList : [];
        const payloadStr = JSON.stringify(cleanList);
        const nowIso = new Date().toISOString();

        try {
            localStorage.setItem(STORAGE_KEYS.DYNAMIC_SUBJECTS, payloadStr);
        } catch (e) {}

        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { error: rpcErr } = await this.client.rpc('admin_manage_config', { p_admin_token: adminToken, p_action: 'set', p_record_id: SYSTEM_RECORDS.DYNAMIC_SUBJECTS, p_payload: { player_name: '__DYNAMIC_SUBJECTS__', device_info: 'DYNAMIC_HUB', status: 'ACTIVE', score_summary: payloadStr } });
                    if (!rpcErr) return cleanList;
                    if (!this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                const { error } = await this.client
                    .from('quiz_logins')
                    .upsert([{
                        id: SYSTEM_RECORDS.DYNAMIC_SUBJECTS,
                        player_name: '__DYNAMIC_SUBJECTS__',
                        ip_address: 'SYSTEM',
                        device_info: 'DYNAMIC_HUB',
                        status: 'ACTIVE',
                        score_summary: payloadStr,
                        last_active: nowIso
                    }], { onConflict: 'id' });
                if (error) throw error;
                const { data: verified, error: verifyError } = await this.client
                    .from('quiz_logins')
                    .select('score_summary')
                    .eq('id', SYSTEM_RECORDS.DYNAMIC_SUBJECTS)
                    .limit(1);
                if (verifyError) throw verifyError;
                const verifiedSubjects = JSON.parse(verified?.[0]?.score_summary || '[]');
                if (!Array.isArray(verifiedSubjects) || JSON.stringify(verifiedSubjects) !== payloadStr) {
                    throw new Error('Cloud chưa xác minh đúng danh sách môn học vừa lưu.');
                }
            } catch (e) {
                console.error("[DatabaseService] Lỗi lưu môn học động:", e);
                throw e;
            }
        }

        return cleanList;
    }

    async addDynamicSubject(subjectObj) {
        if (!subjectObj || !subjectObj.key || (!subjectObj.name && !subjectObj.title)) {
            throw new Error("Thông tin môn học phải có mã key và tiêu đề môn.");
        }
        const subjects = await this.fetchDynamicSubjects();
        const existingIdx = subjects.findIndex(s => s.key === subjectObj.key);
        if (existingIdx !== -1) {
            subjects[existingIdx] = { ...subjects[existingIdx], ...subjectObj };
        } else {
            subjects.push(subjectObj);
        }
        return await this.saveDynamicSubjects(subjects);
    }

    async saveDynamicSubject(subjectObj) {
        return await this.addDynamicSubject(subjectObj);
    }

    async deleteDynamicSubject(subjectKey) {
        const cleanSubject = String(subjectKey || '').trim();
        if (!cleanSubject) return { success: false, error: 'Thiếu mã môn học.' };
        let subjects = await this.fetchDynamicSubjects();
        const questionDelete = await this.clearQuestionsBySubject(cleanSubject);
        if (!questionDelete?.success) {
            throw new Error(questionDelete?.error || 'Không thể xóa ngân hàng câu hỏi; môn học chưa bị xóa.');
        }
        subjects = subjects.filter(s => String(s.key || s.subject_key || '') !== cleanSubject);
        const saved = await this.saveDynamicSubjects(subjects);
        if (saved?.success === false) throw new Error(saved.error || 'Không thể lưu danh sách môn học.');
        return { success: true, subjectKey: cleanSubject, deletedQuestions: questionDelete.count || 0 };
    }

    // =========================================================================
    // PHẦN 9: BẢNG XẾP HẠNG (LEADERBOARD) & XUẤT BẢNG ĐIỂM EXCEL
    // =========================================================================

    /**
     * Lấy dữ liệu Bảng Xếp Hạng Top N học sinh điểm cao & nhanh nhất
     */
    async autoSubmitStaleAttempts(rows, options = {}) {
        this._autoSubmitInFlight = this._autoSubmitInFlight || new Set();
        const isForce = Boolean(options.force);
        const staleMs = Number(options.staleMs) > 0 ? Number(options.staleMs) : 5 * 60 * 1000;
        const nowMs = Date.now() + Number(this.serverClockOffsetMs || 0);
        if (!Array.isArray(rows) || rows.length === 0) return 0;

        let submittedCount = 0;
        for (const row of rows) {
            const rowId = String(row?.id || '');
            if (!row || !row.id || rowId.startsWith('local_') || this._autoSubmitInFlight.has(rowId)) continue;
            if (SYSTEM_RECORD_IDS.has(row.id) || String(row.player_name || '').trim().startsWith('__') ||
                String(row.ip_address || '').trim() === 'SYSTEM' || /admin/i.test(String(row.status || '')) ||
                /^BANNED/i.test(String(row.status || '').trim())) continue;

            const rawStatus = String(row.status || '');
            const fullRawScore = String(row.score_summary || '');
            const detailIdx = fullRawScore.indexOf('\n__DETAIL__:');
            const rawScore = detailIdx >= 0 ? fullRawScore.slice(0, detailIdx) : fullRawScore;
            const detailSuffix = detailIdx >= 0 ? fullRawScore.slice(detailIdx) : '';
            let detail = null;
            if (detailIdx >= 0) {
                try { detail = JSON.parse(fullRawScore.slice(detailIdx + '\n__DETAIL__:'.length)); } catch (e) {}
            }
            if (/đã nộp bài|hoàn thành/i.test(rawStatus) || /\d+(?:[.,]\d+)?\s*điểm/i.test(rawScore)) continue;

            const lastActiveMs = new Date(row.last_active || row.created_at || 0).getTime() || 0;
            if (!isForce && (lastActiveMs <= 0 || (nowMs - lastActiveMs) < staleMs)) continue;

            const subjMatch = rawStatus.match(/^\[((?:\[[^\]]*\]|[^\]])*)\]/) || rawScore.match(/^\[((?:\[[^\]]*\]|[^\]])*)\]/);
            const subject = subjMatch ? subjMatch[1].trim() : 'Bài ôn tập';
            let answered = 0;
            let total = 0;
            let correct = 0;
            if (Array.isArray(detail?.items) && detail.items.length > 0) {
                total = detail.items.length;
                correct = detail.items.filter(i => i?.ok === true).length;
                const wrong = detail.items.filter(i => i?.ok === false).length;
                answered = correct + wrong;
            } else {
                const progMatch = rawStatus.match(/(?:Tiến độ|Chờ nộp bài)\s*:\s*(\d+)\s*\/\s*(\d+)/i);
                if (progMatch) {
                    answered = Number(progMatch[1]) || 0;
                    total = Number(progMatch[2]) || 0;
                }
                const correctMatch = rawScore.match(/đúng\s*(\d+)(?:\s*\/\s*(\d+))?/i);
                if (correctMatch) {
                    correct = Number(correctMatch[1]) || 0;
                    if (correctMatch[2] && (total <= 0 || answered <= 0)) {
                        total = Number(correctMatch[2]) || total;
                        if (answered <= 0) answered = total;
                    }
                }
            }
            if (!isForce && answered <= 0) continue;
            if (isForce && answered <= 0 && (total <= 0 || /đang xem trang chủ|chưa chọn|chờ vào/i.test(rawStatus))) continue;
            total = Math.max(total, answered, 1);
            const finalScore = total > 0 ? Math.round((correct / total) * 100) : 0;

            let durationSec = 0;
            if (Number.isFinite(Number(detail?.sec)) && Number(detail.sec) >= 0) {
                durationSec = Math.round(Number(detail.sec));
            } else {
                const timeMatch = rawScore.match(/(\d{1,3}):(\d{2})/) || rawStatus.match(/(\d{1,3}):(\d{2})/);
                const minuteMatch = rawScore.match(/(\d{1,3})\s*(?:phút|p)\s*(?:(\d{1,2})\s*(?:giây|s))?/i) || rawStatus.match(/(\d{1,3})\s*(?:phút|p)\s*(?:(\d{1,2})\s*(?:giây|s))?/i);
                if (timeMatch) durationSec = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
                else if (minuteMatch) durationSec = Number(minuteMatch[1]) * 60 + Number(minuteMatch[2] || 0);
                else {
                    const createdMs = new Date(row.created_at || 0).getTime() || 0;
                    const elapsed = Math.round((lastActiveMs - createdMs) / 1000);
                    if (elapsed > 0 && elapsed < 14400) durationSec = elapsed;
                }
            }
            const timeStr = String(Math.floor(durationSec / 60)).padStart(2, '0') + ':' + String(durationSec % 60).padStart(2, '0');
            const outsideTag = (/\[Ngoài lớp\]/i.test(rawStatus) || detail?.outsideRoster === true) ? ' [Ngoài lớp]' : '';
            const submitNote = isForce ? 'Ép nộp' : 'Tự nộp sau 5p';
            const nextStatus = `[${subject}] Đã nộp bài (${submitNote})${outsideTag}`;
            const nextScore = `[${subject}] Đúng ${correct}/${total} ý (${finalScore} điểm) - ${timeStr}${outsideTag}${detailSuffix}`;

            this._autoSubmitInFlight.add(rowId);
            try {
                if (typeof options.updateFn === 'function') {
                    await options.updateFn(row.id, { status: nextStatus, score_summary: nextScore });
                    row.status = nextStatus;
                    row.score_summary = nextScore;
                    submittedCount++;
                } else if (this.isSupabaseActive && this.client) {
                    const { error } = await this.client.from('quiz_logins').update({ status: nextStatus, score_summary: nextScore }).eq('id', row.id).not('status', 'like', 'BANNED%').not('status', 'ilike', '%đã nộp bài%').not('status', 'ilike', '%hoàn thành%');
                    if (!error) {
                        row.status = nextStatus;
                        row.score_summary = nextScore;
                        submittedCount++;
                    }
                }
            } finally {
                this._autoSubmitInFlight.delete(rowId);
            }
        }
        return submittedCount;
    }

    async fetchLeaderboard(subjectKey = '', limit = 10) {
        const normalizeKey = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
        const logins = await this.getLoginHistory(500, { excludeVisitors: true });
        await this.autoSubmitStaleAttempts(logins).catch(() => 0);
        let devicePins = {};
        try {
            const rosterCfg = typeof this.fetchRosterConfig === 'function' ? await this.fetchRosterConfig() : null;
            if (rosterCfg?.devicePins && typeof rosterCfg.devicePins === 'object') {
                devicePins = rosterCfg.devicePins;
            }
        } catch (e) {}
        if (!Object.keys(devicePins).length && typeof localStorage !== 'undefined') {
            try {
                const cachedRoster = JSON.parse(localStorage.getItem('quiz_roster_config') || 'null');
                if (cachedRoster?.devicePins && typeof cachedRoster.devicePins === 'object') {
                    devicePins = cachedRoster.devicePins;
                }
            } catch (e) {}
        }
        let dynamicSubjectName = '';
        if (subjectKey) {
            const appSubjects = (typeof window !== 'undefined' && Array.isArray(window.app?.dynamicSubjects))
                ? window.app.dynamicSubjects
                : [];
            let matchedSub = appSubjects.find(s => (s.key || s.subject_key) === subjectKey);
            if (!matchedSub) {
                try {
                    const cachedSubs = JSON.parse(localStorage.getItem(STORAGE_KEYS.DYNAMIC_SUBJECTS) || '[]');
                    if (Array.isArray(cachedSubs)) {
                        matchedSub = cachedSubs.find(s => (s.key || s.subject_key) === subjectKey);
                    }
                } catch (e) { }
            }
            if (!matchedSub && typeof this.fetchDynamicSubjects === 'function') {
                try {
                    const fetchedSubs = await this.fetchDynamicSubjects();
                    if (Array.isArray(fetchedSubs)) {
                        matchedSub = fetchedSubs.find(s => (s.key || s.subject_key) === subjectKey);
                    }
                } catch (e) { }
            }
            dynamicSubjectName = String(matchedSub?.name || matchedSub?.title || '').trim().toLowerCase();
        }

        const parseResult = (item) => {
            const raw = String(item.score_summary || item.status || '');
            const marker = raw.indexOf('\n__DETAIL__:');
            const rawScoreOnly = marker >= 0 ? raw.slice(0, marker) : raw;
            let detail = null;
            if (marker >= 0) { try { detail = JSON.parse(raw.slice(marker + '\n__DETAIL__:'.length)); } catch (e) {} }
            return { rawScoreOnly, detail, status: String(item.status || '') };
        };
        // Lọc các bản ghi đã nộp bài, không đọc nội dung JSON chi tiết để xác định điểm/môn.
        const submitted = logins.filter(item => {
            const parsed = parseResult(item);
            if (String(item.status || '').includes('[Ngoài lớp]') || parsed.detail?.outsideRoster === true) return false;
            const status = parsed.status.toLowerCase();
            const summary = parsed.rawScoreOnly.toLowerCase();
            const isFinished = status.includes("đã nộp") || status.includes("hoàn thành") || summary.includes("điểm");
            if (!isFinished) return false;
            if (/^\[phục thù\]|\[phục thù\]/i.test(parsed.status) || /^\[phục thù\]|\[phục thù\]/i.test(parsed.rawScoreOnly) || parsed.detail?.revenge === true) return false;

            if (subjectKey) {
                const combined = status + " " + summary;
                const subjectMatch = parsed.rawScoreOnly.match(/^\[((?:\[[^\]]*\]|[^\]])*)\]/);
                const extractedSubject = String(subjectMatch?.[1] || '').trim().toLowerCase();
                if (dynamicSubjectName && extractedSubject === dynamicSubjectName) return true;
                if (dynamicSubjectName && combined.includes(dynamicSubjectName)) return true;
                if (subjectKey === 'geography' && combined.includes('địa')) return true;
                if (subjectKey === 'physics' && (combined.includes('lí') || combined.includes('vật'))) return true;
                if (subjectKey === 'history' && combined.includes('sử')) return true;
                if (combined.includes(subjectKey.toLowerCase())) return true;
                return false;
            }
            return true;
        });

        const parseTimeSeconds = (t) => {
            if (!t || typeof t !== 'string') return Number.MAX_SAFE_INTEGER;
            const m = t.match(/^(\d{1,3}):(\d{2})$/);
            if (!m) return Number.MAX_SAFE_INTEGER;
            return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        };

        // Trích xuất điểm số & thời gian
        const parsedResults = submitted.map(item => {
            let score = 0;
            let correctCount = 0;
            let totalCount = 0;

            const parsed = parseResult(item);
            const scoreMatch = parsed.rawScoreOnly.match(/(\d+(?:\.\d+)?)\s*điểm/i);
            if (scoreMatch) score = parseFloat(scoreMatch[1]);

            const ratioMatch = parsed.rawScoreOnly.match(/đúng\s*(\d+)\/(\d+)/i) || parsed.status.match(/(\d+)\/(\d+)/i);
            if (ratioMatch) {
                correctCount = parseInt(ratioMatch[1], 10);
                totalCount = parseInt(ratioMatch[2], 10);
                if (!score && totalCount > 0) {
                    score = Math.round((correctCount / totalCount) * 100);
                }
            }
            if (score <= 10 && totalCount > 0) {
                const expected100 = (correctCount / totalCount) * 100;
                if (Math.abs((score * 10) - expected100) < Math.abs(score - expected100)) {
                    score = Math.round(score * 10);
                }
            }

            let timeSpent = '—';
            const timeMatch = parsed.rawScoreOnly.match(/-\s*(\d{1,3}:\d{2})/);
            if (timeMatch) timeSpent = timeMatch[1];

            const devCode = extractDeviceCode(item.device_info);
            const pinName = devCode ? String(devicePins[devCode] || '').trim() : '';
            const resolvedName = pinName || item.player_name || "Thí sinh ẩn danh";

            return {
                id: item.id,
                playerName: resolvedName,
                player_name: resolvedName,
                ipAddress: item.ip_address || "Chưa rõ",
                ip_address: item.ip_address || "Chưa rõ",
                deviceInfo: item.device_info || "Trình duyệt",
                device_info: item.device_info || "Trình duyệt",
                _deviceCode: devCode,
                _pinnedName: pinName,
                score: score,
                timeSpent: timeSpent,
                time_spent: timeSpent,
                correctCount: correctCount,
                correct_count: correctCount,
                totalCount: totalCount,
                total_count: totalCount,
                status: item.status,
                scoreSummary: item.score_summary,
                submittedAt: item.last_active || item.created_at
            };
        });

        // Lọc trùng theo Mã máy (nếu có) hoặc Tên + IP, chỉ giữ lượt thi điểm cao nhất
        const studentBestMap = new Map();
        parsedResults.forEach(res => {
            const key = res._pinnedName ? 'pin:' + normalizeKey(res._pinnedName) : (res._deviceCode ? 'dev:' + res._deviceCode : (res.playerName.toLowerCase().trim() + '___' + res.ipAddress));
            const existing = studentBestMap.get(key);
            if (
                !existing ||
                existing.score < res.score ||
                (existing.score === res.score && parseTimeSeconds(res.timeSpent) < parseTimeSeconds(existing.timeSpent))
            ) {
                studentBestMap.set(key, res);
            }
        });

        const uniqueResults = Array.from(studentBestMap.values());
        // Sắp xếp: Điểm cao nhất lên đầu, nếu bằng điểm thì ưu tiên thời gian làm bài nhanh hơn (timeSpent) trước rồi mới tới submittedAt
        uniqueResults.sort((a, b) => {
            const scoreValA = Number(a.score) || 0;
            const scoreValB = Number(b.score) || 0;
            if (scoreValB !== scoreValA) return scoreValB - scoreValA;
            const timeA = parseTimeSeconds(a.timeSpent);
            const timeB = parseTimeSeconds(b.timeSpent);
            if (timeA !== timeB) return timeA - timeB;
            return new Date(a.submittedAt) - new Date(b.submittedAt);
        });

        return uniqueResults.slice(0, limit);
    }

    /**
     * Lấy toàn bộ bảng điểm đầy đủ để xuất file Excel
     */
    async fetchScoreboardForExport(subjectKey = '') {
        const logins = await this.getLoginHistory(500, { excludeVisitors: true });
        let dynamicSubjectName = '';
        if (subjectKey) {
            const subjects = (typeof this.fetchDynamicSubjects === 'function') ? await this.fetchDynamicSubjects().catch(() => []) : [];
            const matched = (Array.isArray(subjects) ? subjects : []).find(s => (s.key || s.subject_key) === subjectKey);
            dynamicSubjectName = String(matched?.name || matched?.title || '').trim().toLowerCase();
        }
        return logins
            .filter(item => {
                const raw = String(item.score_summary || item.status || '');
                const marker = raw.indexOf('\n__DETAIL__:');
                const scoreOnly = marker >= 0 ? raw.slice(0, marker) : raw;
                let detail = null;
                if (marker >= 0) { try { detail = JSON.parse(raw.slice(marker + '\n__DETAIL__:'.length)); } catch (e) {} }
                if (String(item.status || '').includes('[Ngoài lớp]') || detail?.outsideRoster === true) return false;
                const s = String(item.status || '').toLowerCase();
                const sc = scoreOnly.toLowerCase();
                if (!(s.includes("đã nộp") || s.includes("hoàn thành") || /\d+\s*điểm/i.test(scoreOnly))) return false;
                if (!subjectKey) return true;
                const m = scoreOnly.match(/^\[((?:\[[^\]]*\]|[^\]])*)\]/);
                const name = String(m?.[1] || '').trim().toLowerCase();
                return (dynamicSubjectName && name === dynamicSubjectName) || name === subjectKey.toLowerCase() || scoreOnly.toLowerCase().includes(subjectKey.toLowerCase());
            })
            .map(item => {
                const raw = String(item.score_summary || item.status || '');
                const marker = raw.indexOf('\n__DETAIL__:');
                const scoreOnly = marker >= 0 ? raw.slice(0, marker) : raw;
                let score = 0;
                const scoreMatch = scoreOnly.match(/(\d+(?:\.\d+)?)\s*điểm/i);
                if (scoreMatch) score = Math.min(100, Math.max(0, parseFloat(scoreMatch[1])));

                let correctCount = '-';
                let totalItems = '-';
                let correctText = "";
                const ratioMatch = scoreOnly.match(/đúng\s*(\d+)\/(\d+)/i) || scoreOnly.match(/đúng\s*(\d+\/\d+)/i);
                if (ratioMatch) {
                    if (ratioMatch[2]) {
                        correctCount = parseInt(ratioMatch[1], 10);
                        totalItems = parseInt(ratioMatch[2], 10);
                        correctText = `${correctCount}/${totalItems}`;
                    } else {
                        correctText = ratioMatch[1];
                    }
                }

                let timeSpent = '—';
                const timeMatch = (item.score_summary || "").match(/-\s*(\d{1,2}:\d{2})/);
                if (timeMatch) timeSpent = timeMatch[1];

                let subjName = 'Chung';
                const subjMatch = scoreOnly.match(/^\[((?:\[[^\]]*\]|[^\]])*)\]/);
                if (subjMatch) subjName = subjMatch[1];

                let timeStr = "";
                try {
                    timeStr = new Date(item.last_active || item.created_at).toLocaleString('vi-VN');
                } catch (e) {
                    timeStr = item.last_active || "";
                }

                return {
                    // Vietnamese keys
                    "Họ Và Tên": item.player_name || "Thí sinh",
                    "Địa Chỉ IP": item.ip_address || "Chưa rõ",
                    "Thiết Bị": item.device_info || "Trình duyệt",
                    "Môn Thi": subjName,
                    "Điểm Số": score,
                    "Số Câu Đúng": correctText,
                    "Chi Tiết Kết Quả": item.score_summary || item.status,
                    "Thời Gian Làm Bài": timeSpent,
                    "Thời Gian Nộp": timeStr,

                    // English snake_case keys (chuẩn cho app.js adminExportScoreboardExcel)
                    player_name: item.player_name || "Thí sinh",
                    playerName: item.player_name || "Thí sinh",
                    client_ip: item.ip_address || "Chưa rõ",
                    ip_address: item.ip_address || "Chưa rõ",
                    device_info: item.device_info || "Trình duyệt",
                    subject_name: subjName,
                    final_score: score,
                    score: score,
                    correct_count: correctCount,
                    total_items: totalItems,
                    time_spent: timeSpent,
                    status: item.score_summary || item.status,
                    created_at: item.last_active || item.created_at
                };
            });
    }

    // =========================================================================
    // PHẦN 10: ĐÓNG GÓI LƯU TRỮ (ARCHIVE) & LÀM SẠCH DỮ LIỆU SAU KỲ THI
    // =========================================================================

    /**
     * Xuất toàn bộ dữ liệu lịch sử thành JSON Backup và xóa sạch dữ liệu học sinh cũ
     */
    async archiveAndClearExamData() {
        // 1. Tải toàn bộ dữ liệu học sinh hiện có (phân trang đầy đủ để không mất dữ liệu vượt quá 1000 dòng)
        const studentLogins = await this.getLoginHistory(Infinity, { paginate: true });
        const backupData = {
            archivedAt: new Date().toISOString(),
            totalStudents: studentLogins.length,
            records: studentLogins
        };

        // 2. Xóa toàn bộ học sinh trên Supabase Cloud (bảo toàn cấu hình hệ thống __...)
        if (this.isSupabaseActive && this.client) {
            const adminToken = this.getAdminSessionToken();
            if (adminToken) {
                const adminConfig = await this.fetchAdminIpsConfig();
                const rpcAdminIps = [adminConfig?.masterIp, ...(adminConfig?.ips || []), ...(adminConfig?.allowedIps || []).map(item => typeof item === 'string' ? item : item?.ip)].filter(Boolean);
                const { error: rpcErr } = await this.client.rpc('admin_clear_all_logins', { p_admin_token: adminToken, p_admin_ips: rpcAdminIps });
                if (!rpcErr) {
                    localStorage.removeItem(STORAGE_KEYS.LOCAL_LOGINS);
                    return backupData;
                }
                if (!this._isMissingRpcError(rpcErr)) throw rpcErr;
            }
            const fallbackAdminConfig = await this.fetchAdminIpsConfig();
            const adminIps = new Set([
                fallbackAdminConfig?.masterIp,
                ...(Array.isArray(fallbackAdminConfig?.ips) ? fallbackAdminConfig.ips : []),
                ...(Array.isArray(fallbackAdminConfig?.allowedIps) ? fallbackAdminConfig.allowedIps.map(item => typeof item === 'string' ? item : item?.ip) : [])
            ].map(ip => String(ip || '').trim()).filter(Boolean));
            const systemIds = Object.values(SYSTEM_RECORDS);
            const allRows = [];
            const pageSize = 500;
            for (let offset = 0; ; offset += pageSize) {
                const { data, error: selectError } = await this.client
                    .from('quiz_logins')
                    .select('id, player_name, ip_address')
                    .order('created_at', { ascending: true })
                    .range(offset, offset + pageSize - 1);
                if (selectError) throw new Error(`Không thể đọc dữ liệu trước khi dọn: ${selectError.message}`);
                if (!Array.isArray(data) || data.length === 0) break;
                allRows.push(...data);
                if (data.length < pageSize) break;
            }
            const ids = allRows.filter(item => !systemIds.includes(item.id) && !String(item.player_name || '').startsWith('__') && !adminIps.has(String(item.ip_address || '').trim())).map(item => item.id).filter(Boolean);
            if (ids.length > 0) {
                for (let offset = 0; offset < ids.length; offset += 100) {
                    const { error } = await this.client.from('quiz_logins').delete().in('id', ids.slice(offset, offset + 100));
                    if (error) throw new Error(`Không thể dọn dữ liệu trên Cloud: ${error.message}`);
                }
            }
        }

        // 3. Xóa LocalStorage
        localStorage.removeItem(STORAGE_KEYS.LOCAL_LOGINS);

        return backupData;
    }

    // =========================================================================
    // PHẦN 11: CẤU HÌNH TRỢ LÝ AI GEMINI TOÀN HỆ THỐNG (CLOUD SHARED KEY)
    // =========================================================================

    /**
     * Tải khóa Gemini API Key dùng chung toàn hệ thống từ Supabase Cloud
     */
    async fetchGeminiApiKey() {
        let key = "";
        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { data, error } = await this.client.rpc('admin_manage_config', {
                        p_admin_token: adminToken, p_action: 'get', p_record_id: SYSTEM_RECORDS.GEMINI_CONFIG, p_payload: null
                    });
                    if (!error && data?.status === 'ACTIVE' && data.score_summary) key = String(data.score_summary).trim();
                }
            } catch (err) {
                console.warn("[DatabaseService] Lỗi khi tải Gemini API Key từ Cloud:", err);
            }
        }
        return key;
    }

    /**
     * Lưu khóa Gemini API Key lên Supabase Cloud (Để toàn bộ học sinh đều dùng được ngay)
     */
    async saveGeminiApiKey(apiKey) {
        const cleanKey = (apiKey || "").trim();
        if (this.isSupabaseActive && this.client) {
            const nowIso = this.getNowIso();
            try {
                const { error } = await this.client
                    .from('quiz_logins')
                    .upsert([{
                        id: SYSTEM_RECORDS.GEMINI_CONFIG,
                        player_name: '__GEMINI_CONFIG__',
                        ip_address: 'SYSTEM',
                        device_info: 'GEMINI_AI_CURRENT_MODELS',
                        status: 'ACTIVE',
                        score_summary: cleanKey,
                        last_active: nowIso
                    }], { onConflict: 'id' });
                if (error) throw error;
                return true;
            } catch (err) {
                console.error("[DatabaseService] Lỗi khi lưu Gemini API Key lên Cloud:", err);
            }
        }
        return false;
    }

    /**
     * Tải danh sách IP được Admin cấp quyền sử dụng Trợ lý AI từ Supabase Cloud
     */
    async fetchAiIpsConfig() {
        let allowedIps = [];
        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (!adminToken) return [];
                const { data, error } = await this.client.rpc('admin_manage_config', {
                    p_admin_token: adminToken, p_action: 'get', p_record_id: SYSTEM_RECORDS.AI_IPS, p_payload: null
                });
                if (!error && data?.status === 'ACTIVE' && data.score_summary) {
                    try {
                        const parsed = JSON.parse(data.score_summary);
                        if (Array.isArray(parsed)) allowedIps = parsed;
                        else if (parsed && Array.isArray(parsed.ips)) allowedIps = parsed.ips;
                    } catch (e) { }
                }
                return Array.isArray(allowedIps) ? allowedIps : [];
            } catch (err) {
                console.warn("[DatabaseService] Lỗi khi tải danh sách IP cấp quyền AI:", err);
            }
        }
        return [];
    }

    /**
     * Lưu danh sách IP được Admin cấp quyền sử dụng Trợ lý AI lên Supabase Cloud
     */
    async saveAiIpsConfig(ipsList) {
        const cleanList = Array.isArray(ipsList) ? ipsList : [];

        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { error: rpcErr } = await this.client.rpc('admin_manage_config', { p_admin_token: adminToken, p_action: 'set', p_record_id: SYSTEM_RECORDS.AI_IPS, p_payload: { player_name: '__AI_IPS_CONFIG__', device_info: 'AI_IP_WHITELIST', status: 'ACTIVE', score_summary: JSON.stringify(cleanList) } });
                    if (!rpcErr) return true;
                    if (!this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                const nowIso = new Date().toISOString();
                const { error } = await this.client
                    .from('quiz_logins')
                    .upsert([{
                        id: SYSTEM_RECORDS.AI_IPS,
                        player_name: '__AI_IPS_CONFIG__',
                        ip_address: 'SYSTEM',
                        device_info: 'AI_IP_WHITELIST',
                        status: 'ACTIVE',
                        score_summary: JSON.stringify(cleanList),
                        last_active: nowIso
                    }], { onConflict: 'id' });
                if (error) throw error;
                return true;
            } catch (err) {
                console.error("[DatabaseService] Lỗi lưu danh sách AI IP:", err);
            }
        }
        return false;
    }

    _isAccessTokenValidRecord(record) {
        if (!record || typeof record !== 'object') return false;
        if (record.revoked === true || String(record.status || '').toUpperCase() === 'REVOKED') return false;
        const expVal = record.expiresAt || record.expires_at;
        if (expVal) {
            const parsedExp = Date.parse(expVal);
            if (Number.isFinite(parsedExp) && parsedExp <= Date.now()) return false;
        }
        return true;
    }

    /**
     * PHẦN 8: XÁC THỰC QUYỀN HẠN BẰNG TOKEN (TOKEN-BASED AUTH)
     * Tải danh sách mã token hợp lệ kèm quyền hạn từ Cloud
     */
    async fetchAccessTokens({ allowOfflineCache = true } = {}) {
        const ACCESS_TOKEN_CACHE_TTL_MS = 15 * 60 * 1000;
        let tokens = [];
        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { data: rpcConfig, error: rpcErr } = await this.client.rpc('admin_manage_config', { p_admin_token: adminToken, p_action: 'get', p_record_id: SYSTEM_RECORDS.ACCESS_TOKENS, p_payload: null });
                    if (!rpcErr && rpcConfig) {
                        try { const parsed = JSON.parse(rpcConfig.score_summary || '[]'); tokens = Array.isArray(parsed) ? parsed : (parsed?.tokens || []); } catch (e) {}
                        if (Array.isArray(tokens)) return tokens;
                    }
                    if (rpcErr && !this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('status, score_summary')
                    .eq('id', SYSTEM_RECORDS.ACCESS_TOKENS)
                    .limit(1);
                if (!error && data && data.length > 0 && data[0].status === 'ACTIVE' && data[0].score_summary) {
                    try {
                        const parsed = JSON.parse(data[0].score_summary);
                        if (Array.isArray(parsed)) tokens = parsed;
                        else if (parsed && Array.isArray(parsed.tokens)) tokens = parsed.tokens;
                    } catch (e) {}
                }
                if (!error && Array.isArray(tokens)) {
                    try {
                        localStorage.setItem('quiz_cached_access_tokens', JSON.stringify({ savedAt: Date.now(), tokens }));
                    } catch (e) {}
                    return tokens;
                }
            } catch (err) {
                console.warn("[DatabaseService] Lỗi khi tải danh sách access tokens:", err);
            }
        }
        if (!allowOfflineCache) return [];
        try {
            const raw = localStorage.getItem('quiz_cached_access_tokens');
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!parsed || Array.isArray(parsed) || typeof parsed.savedAt !== 'number' || (Date.now() - parsed.savedAt > ACCESS_TOKEN_CACHE_TTL_MS)) {
                localStorage.removeItem('quiz_cached_access_tokens');
                return [];
            }
            const cachedList = Array.isArray(parsed.tokens) ? parsed.tokens : [];
            return cachedList.filter((t) => this._isAccessTokenValidRecord(t) && t.role !== 'admin');
        } catch (e) {
            try { localStorage.removeItem('quiz_cached_access_tokens'); } catch (_) {}
            return [];
        }
    }

    /**
     * Lưu danh sách mã token hợp lệ lên Cloud
     */
    async saveAccessTokens(tokensList) {
        const cleanList = Array.isArray(tokensList) ? tokensList : [];
        try {
            localStorage.setItem('quiz_cached_access_tokens', JSON.stringify({ savedAt: Date.now(), tokens: cleanList }));
        } catch (e) {}

        if (this.isSupabaseActive && this.client) {
            try {
                const adminToken = this.getAdminSessionToken();
                if (adminToken) {
                    const { error: rpcErr } = await this.client.rpc('admin_manage_config', { p_admin_token: adminToken, p_action: 'set', p_record_id: SYSTEM_RECORDS.ACCESS_TOKENS, p_payload: { player_name: '__ACCESS_TOKENS_CONFIG__', device_info: 'TOKEN_AUTH', status: 'ACTIVE', score_summary: JSON.stringify(cleanList) } });
                    if (!rpcErr) return true;
                    if (!this._isMissingRpcError(rpcErr)) throw rpcErr;
                }
                const nowIso = new Date().toISOString();
                const { error } = await this.client
                    .from('quiz_logins')
                    .upsert([{
                        id: SYSTEM_RECORDS.ACCESS_TOKENS,
                        player_name: '__ACCESS_TOKENS_CONFIG__',
                        ip_address: 'SYSTEM',
                        device_info: 'TOKEN_AUTH',
                        status: 'ACTIVE',
                        score_summary: JSON.stringify(cleanList),
                        last_active: nowIso
                    }], { onConflict: 'id' });
                if (error) throw error;
                return true;
            } catch (err) {
                console.error("[DatabaseService] Lỗi khi lưu danh sách access tokens:", err);
                throw err;
            }
        }
        return false;
    }

    /**
     * Xác thực nhanh một mã token trên Cloud / Cache (kết hợp theo Token, Mã máy hoặc IP)
     */
    async verifyAccessToken(rawToken, clientIp = '') {
        let rpcFailedOnline = false;
        if (this.isSupabaseActive && this.client) {
            try {
                const { data: rpcTok, error: rpcTokErr } = await this.client.rpc('public_verify_access_token', {
                    p_token: String(rawToken || ''),
                    p_ip: String(clientIp || '')
                });
                if (!rpcTokErr) {
                    if (rpcTok && !this._isAccessTokenValidRecord(rpcTok)) return null;
                    return rpcTok || null;
                }
                if (!this._isMissingRpcError(rpcTokErr)) {
                    rpcFailedOnline = true;
                }
            } catch (e) {
                if (typeof navigator !== 'undefined' && navigator.onLine) rpcFailedOnline = true;
            }
        }
        const tokens = await this.fetchAccessTokens({ allowOfflineCache: !rpcFailedOnline });
        if (!Array.isArray(tokens) || tokens.length === 0) return null;

        const validTokens = tokens.filter((t) => this._isAccessTokenValidRecord(t) && (!rpcFailedOnline || t.role !== 'admin'));
        if (validTokens.length === 0) return null;

        const clean = String(rawToken || '').trim().toLowerCase();
        const cleanIp = String(clientIp || '').trim().replace(/^\[|\]$/g, '').toLowerCase();

        const ipMatches = (ipVal) => Boolean(cleanIp && ipVal && (
            cleanIp === ipVal ||
            cleanIp.endsWith(':' + ipVal) ||
            ipVal.endsWith(':' + cleanIp)
        ));

        const isIpOnlyRecord = (tokenVal, rawCodeVal, ipVal) => {
            if (!ipVal) return false;
            return (!rawCodeVal || rawCodeVal === ipVal) && (!tokenVal || tokenVal === ipVal);
        };

        const extractMachineCode = (val) => {
            if (!val) return '';
            return val.includes('-') ? val.split('-').pop() : val;
        };

        // 1. Ưu tiên khớp chính xác chuỗi token / rawCode gửi lên
        if (clean) {
            const exactMatch = validTokens.find(t => {
                const tokenVal = String(t.token || '').trim().toLowerCase();
                const rawCodeVal = String(t.rawCode || '').trim().toLowerCase();
                const ipVal = String(t.ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
                return tokenVal === clean || (rawCodeVal && rawCodeVal === clean) || (ipVal && clean === ipVal);
            });
            if (exactMatch) return exactMatch;

            // 2. Khớp theo hậu tố mã máy kết hợp (ví dụ: cùng kết thúc bằng -qm-xxxxxx khi đổi IP mạng/4G)
            const cleanMachineCode = extractMachineCode(clean);
            if (cleanMachineCode && cleanMachineCode.length >= 5) {
                const machineMatch = validTokens.find(t => {
                    const tokenVal = String(t.token || '').trim().toLowerCase();
                    const rawCodeVal = String(t.rawCode || '').trim().toLowerCase();
                    const tokenMachineCode = tokenVal.includes('-') ? tokenVal.split('-').pop() : (rawCodeVal || '');
                    return tokenMachineCode && tokenMachineCode === cleanMachineCode && tokenMachineCode.length >= 5;
                });
                if (machineMatch) return machineMatch;
            }
        }

        // 3. Dự phòng khớp theo IP: chỉ khớp bản ghi IP-only (không khóa theo mã máy riêng)
        if (cleanIp) {
            const ipOnlyMatch = validTokens.find(t => {
                const tokenVal = String(t.token || '').trim().toLowerCase();
                const rawCodeVal = String(t.rawCode || '').trim().toLowerCase();
                const ipVal = String(t.ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
                return ipMatches(ipVal) && isIpOnlyRecord(tokenVal, rawCodeVal, ipVal);
            });
            if (ipOnlyMatch) return ipOnlyMatch;
        }

        return null;
    }
}

const RESERVED_STUDENT_FULL_NAMES = new Set([
    'hoc sinh', 'khach truy cap', 'nguoi dung', 'thi sinh', 'khong ten', 'vo danh',
    'chua co ten', 'nguyen van a', 'tran van a', 'le van a', 'nguyen van b',
    'test user', 'hoc sinh a', 'nguyen van an', 'nguyen van c', 'nguyen thi a',
    'nguyen thi b', 'nguyen thi c', 'tran van b', 'tran thi a', 'tran thi b',
    'le van b', 'le thi a', 'le thi b', 'pham van a', 'pham van b', 'hoang van a',
    'nguyen van teo', 'tran van teo', 'le van teo', 'nguyen thi no', 'khong co ten',
    'an danh', 'nguoi la', 'dep trai', 'xinh gai', 'trai dep', 'gai xinh', 'sieu nhan',
    'hacker', 'khong biet', 'ai biet'
]);
const BLOCKED_STUDENT_NAME_WORDS = new Set([
    'admin', 'administrator', 'moderator', 'mod', 'root', 'system',
    'test', 'testing', 'tester', 'demo', 'sample', 'guest', 'visitor',
    'user', 'unknown', 'anonymous', 'null', 'undefined', 'none',
    'abc', 'abcd', 'abcde', 'abcdef', 'xyz', 'qwe', 'qwerty', 'asd', 'asdf',
    'zxc', 'zxcv', 'hehe', 'haha', 'hihi', 'huhu', 'kaka', 'lol', 'lmao',
    'wtf', 'bruh', 'spam', 'fake', 'bot'
]);
const VIET_VOWEL_RE = /[aeiouyăâêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i;

function foldVietnameseForName(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .toLowerCase();
}

function validateStudentName(rawName) {
    const cleaned = String(rawName || '').trim().replace(/\s+/g, ' ');
    if (!cleaned) {
        return { valid: false, normalized: '', reason: 'Vui lòng nhập đầy đủ Họ và Tên thật của bạn (có thể kèm lớp, ví dụ kèm - 11A1).' };
    }
    if (cleaned.length < 4) {
        return { valid: false, normalized: cleaned, reason: 'Họ và Tên quá ngắn. Vui lòng nhập đầy đủ Họ và Tên thật của bạn.' };
    }
    if (cleaned.length > 40) {
        return { valid: false, normalized: cleaned, reason: 'Họ và Tên tối đa 40 ký tự.' };
    }
    if (!/^[\p{L}0-9\s\-().]+$/u.test(cleaned)) {
        return { valid: false, normalized: cleaned, reason: 'Họ và Tên không được chứa ký tự đặc biệt.' };
    }

    const rawTokens = cleaned.split(/[\s\-().]+/).filter(Boolean);
    const isClassToken = (tok) => /^(?:lop)?\d{1,2}[a-z]?\d{0,2}$/i.test(foldVietnameseForName(tok));
    const nameWords = [];
    for (let i = 0; i < rawTokens.length; i++) {
        const tok = rawTokens[i];
        const foldedTok = foldVietnameseForName(tok);
        if (foldedTok === 'lop' && i + 1 < rawTokens.length && isClassToken(rawTokens[i + 1])) {
            continue;
        }
        if (isClassToken(tok)) continue;
        if (/\d/.test(tok)) {
            return { valid: false, normalized: cleaned, reason: 'Tên không hợp lệ. Chỉ nhập Họ và Tên thật (có thể kèm lớp như 11A1, 5A).' };
        }
        nameWords.push(tok);
    }

    if (nameWords.length < 2) {
        return { valid: false, normalized: cleaned, reason: 'Vui lòng nhập đầy đủ Họ và Tên thật của bạn (có thể kèm lớp, ví dụ kèm - 11A1).' };
    }

    const nameOnlyFolded = nameWords.map(foldVietnameseForName).join(' ');
    if (RESERVED_STUDENT_FULL_NAMES.has(nameOnlyFolded) || /^(nguyen|tran|le|pham|hoang|huynh|phan|vu|vo|dang|bui|do|ho|ngo|duong|ly)\s+(van|thi)\s+[a-z]$/i.test(nameOnlyFolded)) {
        return { valid: false, normalized: cleaned, reason: 'Vui lòng nhập Họ và Tên thật của bạn.' };
    }

    const joinedLetters = nameWords.map(foldVietnameseForName).join('');
    if (joinedLetters.length >= 3 && (
        'abcdefghijklmnopqrstuvwxyz'.includes(joinedLetters) ||
        'zyxwvutsrqponmlkjihgfedcba'.includes(joinedLetters) ||
        'qwertyuiopasdfghjklzxcvbnm'.includes(joinedLetters)
    )) {
        return { valid: false, normalized: cleaned, reason: 'Vui lòng nhập Họ và Tên thật, không nhập ký tự mẫu (như a b c, abc...).' };
    }

    let hasMultiCharWord = false;
    for (const word of nameWords) {
        const folded = foldVietnameseForName(word);
        if (BLOCKED_STUDENT_NAME_WORDS.has(folded)) {
            return { valid: false, normalized: cleaned, reason: 'Vui lòng nhập Họ và Tên thật, không dùng tên giả hoặc viết tắt không hợp lệ.' };
        }
        if (word.length === 1) {
            if (!/^[yýỳỷỹỵ]$/i.test(word)) {
                return { valid: false, normalized: cleaned, reason: 'Vui lòng nhập đầy đủ từng từ trong Họ và Tên (không viết tắt 1 chữ cái như "a b c" hay "Lê h").' };
            }
            continue;
        }
        hasMultiCharWord = true;
        if (!VIET_VOWEL_RE.test(word)) {
            return { valid: false, normalized: cleaned, reason: 'Họ và Tên có từ không hợp lệ. Vui lòng kiểm tra lại chính tả.' };
        }
        if (/(.)\1{2,}/i.test(folded) || (word.length === 2 && folded[0] === folded[1])) {
            return { valid: false, normalized: cleaned, reason: 'Vui lòng nhập Họ và Tên thật, không nhập ký tự lặp (như aaa, bbb...).' };
        }
        if (/^[a-z]{2}$/i.test(word) && /^[aeiou][bcdfghjklqrsvwxz]$/i.test(word)) {
            return { valid: false, normalized: cleaned, reason: 'Vui lòng nhập Họ và Tên thật, không nhập ký tự vô nghĩa (như ac ab, ab cd...).' };
        }
    }

    if (!hasMultiCharWord) {
        return { valid: false, normalized: cleaned, reason: 'Vui lòng nhập đầy đủ Họ và Tên thật của bạn.' };
    }

    return { valid: true, normalized: cleaned, reason: '' };
}

DatabaseService.validateStudentName = validateStudentName;
DatabaseService.SYSTEM_UUIDS = SYSTEM_UUIDS;
DatabaseService.SYSTEM_PLAYER_NAMES = SYSTEM_PLAYER_NAMES;
DatabaseService.extractDeviceCode = extractDeviceCode;
DatabaseService.getStudentGroupKey = getStudentGroupKey;
DatabaseService.normalizeRosterConfig = normalizeRosterConfig;
DatabaseService.getSubjectScheduleState = getSubjectScheduleState;
DatabaseService.isFlashcardEnabledForSubject = isFlashcardEnabledForSubject;
if (typeof window !== 'undefined') {
    window.DatabaseService = DatabaseService;
    window.validateStudentName = validateStudentName;
    window.SYSTEM_UUIDS = SYSTEM_UUIDS;
    window.SYSTEM_PLAYER_NAMES = SYSTEM_PLAYER_NAMES;
}

// Khởi tạo instance Singleton toàn cục
window.dbService = new DatabaseService();
window.dbService.validateStudentName = validateStudentName;
window.dbService.extractDeviceCode = extractDeviceCode;
window.dbService.getStudentGroupKey = getStudentGroupKey;
window.dbService.normalizeRosterConfig = normalizeRosterConfig;
window.dbService.getSubjectScheduleState = getSubjectScheduleState;
window.dbService.isFlashcardEnabledForSubject = isFlashcardEnabledForSubject;
