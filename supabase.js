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
    BANNED_IPS: 'quiz_banned_ips',
    MAINTENANCE: 'quiz_maintenance_mode',
    MAINTENANCE_MSG: 'quiz_maintenance_msg',
    ADMIN_IPS_CONFIG: 'quiz_admin_ips_config',
    DYNAMIC_SUBJECTS: 'quiz_dynamic_subjects'
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
    AI_IPS: '00000000-0000-0000-0000-000000000006'
};

function formatSupabaseUrl(rawUrl) {
    if (!rawUrl) return "";
    return rawUrl.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
}

class DatabaseService {
    constructor() {
        this.client = null;
        this.isSupabaseActive = false;
        this.init();
    }

    init() {
        let storedUrl = localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || DEFAULT_SUPABASE_CONFIG.url;
        const storedKey = localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || DEFAULT_SUPABASE_CONFIG.anonKey;

        storedUrl = formatSupabaseUrl(storedUrl);
        this.url = storedUrl;
        this.anonKey = storedKey;

        if (storedUrl && storedKey && window.supabase) {
            try {
                this.client = window.supabase.createClient(storedUrl, storedKey);
                this.isSupabaseActive = true;
                console.log("%c[DatabaseService] QuizMaster Pro v4.0 - Đã kích hoạt Supabase Cloud!", "color: #10b981; font-weight: bold;");
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

    saveConfig(url, anonKey) {
        if (!url || !anonKey) {
            throw new Error("Vui lòng nhập đầy đủ Project URL và Anon Public Key.");
        }
        localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, formatSupabaseUrl(url));
        localStorage.setItem(STORAGE_KEYS.SUPABASE_KEY, anonKey.trim());
        this.init();
    }

    clearConfig() {
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
     */
    async recordLogin(data, ipAddress, deviceInfo, subjectTitle) {
        let cleanName = "";
        let cleanIp = "Chưa xác định";
        let cleanDevice = "Trình duyệt Web";
        let status = "Đang làm bài";
        let scoreSummary = "";

        if (typeof data === 'object' && data !== null) {
            cleanName = (data.playerName || data.name || "").trim();
            cleanIp = (data.ipAddress || data.clientIp || ipAddress || "").trim();
            cleanDevice = (data.deviceInfo || deviceInfo || "Trình duyệt Web").trim();
            status = data.status || "Đang làm bài";
            scoreSummary = data.scoreSummary || (data.subjectTitle ? `Môn: ${data.subjectTitle}` : "");
        } else {
            cleanName = String(data || "").trim();
            cleanIp = String(ipAddress || "").trim();
            cleanDevice = String(deviceInfo || "Trình duyệt Web").trim();
            status = "Đang làm bài";
            scoreSummary = subjectTitle ? `[${subjectTitle}] Bắt đầu làm bài` : "";
        }

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

        const nowIso = new Date().toISOString();

        const record = {
            player_name: cleanName,
            ip_address: cleanIp,
            device_info: cleanDevice,
            status: status,
            score_summary: scoreSummary,
            session_id: sessionId,
            last_active: nowIso,
            created_at: nowIso
        };

        // 1. Lưu LocalStorage tức thì
        try {
            localStorage.setItem('quiz_saved_player_name', cleanName);
            localStorage.setItem('quiz_saved_ip', cleanIp);
            if (cleanIp !== "Chưa xác định") {
                localStorage.setItem(`quiz_ip_map_${cleanIp}`, cleanName);
            }

            let localLogs = this._getLocalLogins();
            record.id = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            const normName = cleanName.toLowerCase();
            const existingLocal = localLogs.find((item) => {
                const itemName = String(item.player_name || '').trim().toLowerCase();
                if (normName && normName !== 'khách truy cập' && itemName === normName) return true;
                return item.session_id === sessionId || (cleanIp !== 'Chưa xác định' && item.ip_address === cleanIp && itemName === normName);
            });
            if (existingLocal) {
                Object.assign(existingLocal, record, { id: existingLocal.id, created_at: existingLocal.created_at || nowIso });
                record.id = existingLocal.id;
            } else {
                localLogs.unshift(record);
            }
            localStorage.setItem(STORAGE_KEYS.LOCAL_LOGINS, JSON.stringify(localLogs.slice(0, 100)));
        } catch (e) {}

        // 2. Lưu Supabase Cloud cho Admin giám sát (Cập nhật thẳng bản ghi cũ của học sinh thay vì tạo dòng mới)
        if (this.isSupabaseActive && this.client) {
            try {
                const systemIds = Object.values(SYSTEM_RECORDS);
                let existingRows = [];

                // Tìm theo tên học sinh (hoặc theo IP nếu là Khách truy cập) để gộp về 1 dòng mới nhất duy nhất
                if (cleanName && cleanName.toLowerCase() !== 'khách truy cập') {
                    const { data: byName } = await this.client
                        .from('quiz_logins')
                        .select('id, player_name, ip_address, score_summary, last_active')
                        .ilike('player_name', cleanName)
                        .order('last_active', { ascending: false })
                        .limit(20);
                    if (Array.isArray(byName)) {
                        existingRows = byName.filter((r) => !systemIds.includes(r.id) && !String(r.player_name || '').startsWith('__'));
                    }
                } else if (cleanIp && cleanIp !== 'Chưa xác định') {
                    const { data: byIp } = await this.client
                        .from('quiz_logins')
                        .select('id, player_name, ip_address, score_summary, last_active')
                        .eq('ip_address', cleanIp)
                        .eq('player_name', 'Khách truy cập')
                        .order('last_active', { ascending: false })
                        .limit(10);
                    if (Array.isArray(byIp)) {
                        existingRows = byIp.filter((r) => !systemIds.includes(r.id));
                    }
                }

                if (existingRows.length > 0) {
                    const targetRow = existingRows[0];
                    const nextSummary = scoreSummary || targetRow.score_summary || '';
                    const { error: updateError } = await this.client
                        .from('quiz_logins')
                        .update({
                            player_name: cleanName,
                            ip_address: cleanIp,
                            device_info: cleanDevice,
                            status,
                            score_summary: nextSummary,
                            last_active: nowIso
                        })
                        .eq('id', targetRow.id);

                    // Xóa các dòng trùng lặp cũ hơn của cùng học sinh để bảng giám sát luôn gọn
                    if (existingRows.length > 1) {
                        const duplicateIds = existingRows.slice(1).map((r) => r.id).filter(Boolean);
                        if (duplicateIds.length) {
                            this.client.from('quiz_logins').delete().in('id', duplicateIds).then(() => {});
                        }
                    }

                    if (!updateError) {
                        const resObj = { id: targetRow.id, success: true };
                        resObj.toString = () => targetRow.id;
                        return resObj;
                    }
                }

                const cloudId = this.generateUUID();
                const payload = {
                    id: cloudId, player_name: cleanName, ip_address: cleanIp,
                    device_info: cleanDevice, status, score_summary: scoreSummary,
                    session_id: sessionId, last_active: nowIso, created_at: nowIso
                };
                let { data: inserted, error } = await this.client.from('quiz_logins').insert([payload]).select('id');
                // Cho phép hệ thống cũ vẫn ghi nhận học sinh trước khi Admin chạy migration session_id.
                if (error && /session_id|column/i.test(error.message || '')) {
                    const legacyPayload = { ...payload };
                    delete legacyPayload.session_id;
                    ({ data: inserted, error } = await this.client.from('quiz_logins').insert([legacyPayload]).select('id'));
                }

                if (error && /policy|permission|not allowed/i.test(error.message || '')) {
                    console.warn('[DatabaseService] Supabase từ chối ghi phiên, không dùng fallback giả online.');
                }

                if (!error && inserted && inserted[0]) {
                    const finalId = inserted[0].id;
                    const resObj = { id: finalId, success: true };
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
        const nowIso = new Date().toISOString();
        if (this.isSupabaseActive && this.client && loginId && !String(loginId).startsWith('local_')) {
            try {
                const { error } = await this.client.from('quiz_logins').update({ last_active: nowIso }).eq('id', loginId);
                if (error) throw error;
                console.debug('[DatabaseService] Heartbeat updated:', { loginId, last_active: nowIso });
            } catch (error) {
                console.warn('[DatabaseService] Không cập nhật được heartbeat:', error);
            }
        }
        try {
            const list = this._getLocalLogins();
            const item = list.find((entry) => entry.id === loginId || entry.session_id === sessionStorage.getItem('quiz_presence_session'));
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
        if (localName && !localName.startsWith('__')) return { playerName: localName };

        // 2. Tra cứu trên Supabase Cloud (Loại trừ bản ghi hệ thống có tiền tố __)
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('player_name, last_active, device_info')
                    .eq('ip_address', cleanIp)
                    .not('player_name', 'like', '__%')
                    .order('last_active', { ascending: false })
                    .limit(1);

                if (!error && data && data.length > 0 && data[0].player_name && !data[0].player_name.startsWith('__')) {
                    return {
                        playerName: data[0].player_name,
                        deviceInfo: data[0].device_info,
                        lastActive: data[0].last_active
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
        const nowIso = new Date().toISOString();

        // Cập nhật Cloud Supabase (kèm hàng đợi khi offline)
        if (this.isSupabaseActive && this.client && loginId && !String(loginId).startsWith('local_')) {
            if (!navigator.onLine) {
                this.enqueueOfflineSync('updateStatus', { loginId, status, scoreSummary, last_active: nowIso });
            } else {
                try {
                    await this.client
                        .from('quiz_logins')
                        .update({
                            status: status,
                            score_summary: scoreSummary,
                            last_active: nowIso
                        })
                        .eq('id', loginId);
                } catch (e) {
                    this.enqueueOfflineSync('updateStatus', { loginId, status, scoreSummary, last_active: nowIso });
                }
            }
        }

        // Cập nhật Local
        try {
            let list = this._getLocalLogins();
            if (list.length > 0) {
                const item = list.find(l => l.id === loginId) || list[0];
                item.status = status;
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
                queuedAt: new Date().toISOString()
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
        if (!navigator.onLine || !this.isSupabaseActive || !this.client) return 0;
        try {
            const raw = localStorage.getItem('quiz_offline_sync_queue');
            if (!raw) return 0;
            const queue = JSON.parse(raw);
            if (!Array.isArray(queue) || queue.length === 0) return 0;

            let syncedCount = 0;
            const remaining = [];
            for (const item of queue) {
                let synced = false;
                try {
                    if (item.type === 'updateProgress' && item.payload) {
                        const { loginId, statusText, scoreText, last_active } = item.payload;
                        if (loginId && !String(loginId).startsWith('local_')) {
                            const { error } = await this.client.from('quiz_logins').update({
                                status: statusText,
                                score_summary: scoreText,
                                last_active: last_active || new Date().toISOString()
                            }).eq('id', loginId);
                            if (error) throw error;
                            syncedCount++;
                            synced = true;
                        }
                    } else if (item.type === 'updateStatus' && item.payload) {
                        const { loginId, status, scoreSummary, last_active } = item.payload;
                        if (loginId && !String(loginId).startsWith('local_')) {
                            const { error } = await this.client.from('quiz_logins').update({
                                status: status,
                                score_summary: scoreSummary,
                                last_active: last_active || new Date().toISOString()
                            }).eq('id', loginId);
                            if (error) throw error;
                            syncedCount++;
                            synced = true;
                        }
                    }
                } catch (err) {
                    console.warn("[OfflineSync] Lỗi sync item:", err);
                }
                if (!synced) remaining.push(item);
            }

            if (remaining.length) localStorage.setItem('quiz_offline_sync_queue', JSON.stringify(remaining));
            else localStorage.removeItem('quiz_offline_sync_queue');
            return syncedCount;
        } catch (e) {
            console.warn("[OfflineSync] Lỗi syncPendingOfflineData:", e);
            return 0;
        }
    }

    /**
     * Cập nhật tiến độ chi tiết của thí sinh
     */
    async updateStudentProgress(loginId, answeredCount, totalCount, correctCount, subjectName) {
        if (!loginId) return;
        const nowIso = new Date().toISOString();
        const percent = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;
        const subj = subjectName || 'Lịch Sử 11';
        const statusText = `[${subj}] Tiến độ: ${answeredCount}/${totalCount} câu (${percent}%)`;
        const scoreText = `[${subj}] Đúng ${correctCount}/${answeredCount} câu đã làm`;

        try {
            let list = this._getLocalLogins();
            const idx = list.findIndex(l => l.id === loginId);
            if (idx !== -1) {
                list[idx].status = statusText;
                list[idx].score_summary = scoreText;
                list[idx].last_active = nowIso;
                localStorage.setItem(STORAGE_KEYS.LOCAL_LOGINS, JSON.stringify(list));
            }
        } catch (e) {}

        if (this.isSupabaseActive && this.client && !String(loginId).startsWith('local_')) {
            if (!navigator.onLine) {
                this.enqueueOfflineSync('updateProgress', { loginId, statusText, scoreText, last_active: nowIso });
            } else {
                try {
                    await this.client
                        .from('quiz_logins')
                        .update({
                            status: statusText,
                            score_summary: scoreText,
                            last_active: nowIso
                        })
                        .eq('id', loginId);
                } catch (e) {
                    this.enqueueOfflineSync('updateProgress', { loginId, statusText, scoreText, last_active: nowIso });
                }
            }
        }
    }

    /**
     * Lấy danh sách máy & người đăng nhập cho Admin (Mặc định tải 300 lượt)
     */
    async getLoginHistory(limit = 300) {
        const systemIds = [
            SYSTEM_RECORDS.ADMIN_IPS,
            SYSTEM_RECORDS.GEO_CONFIG,
            SYSTEM_RECORDS.MAINTENANCE,
            SYSTEM_RECORDS.DYNAMIC_SUBJECTS,
            SYSTEM_RECORDS.GEMINI_CONFIG,
            SYSTEM_RECORDS.AI_IPS
        ];
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
            const playerName = String(item?.player_name || '').trim();
            const ip = String(item?.ip_address || item?.client_ip || '').trim();
            return !systemIds.includes(item?.id) && !playerName.startsWith('__') && !adminIps.has(ip);
        };
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('id, player_name, ip_address, device_info, status, score_summary, last_active, created_at')
                    .order('last_active', { ascending: false })
                    .limit(limit);

                if (!error && Array.isArray(data)) {
                    console.debug('[DatabaseService] Student monitor records loaded:', { count: data.length });
                    // Lọc bỏ toàn bộ các bản ghi hệ thống nội bộ (__...) và systemIds
                    const realLogins = data
                        .filter(isStudentLogin)
                        .map(item => ({
                            ...item,
                            ip_address: item.ip_address || item.client_ip || 'Chưa xác định',
                            client_ip: item.ip_address || item.client_ip || 'Chưa xác định',
                            player_name: (item.player_name && item.player_name.trim()) ? item.player_name.trim() : 'Khách truy cập',
                            device_info: (item.device_info && item.device_info !== 'Chưa rõ') ? item.device_info : 'Trình duyệt Web'
                        }));
                    const seenKeys = new Set();
                    const duplicateIds = [];
                    const deduped = [];
                    for (const row of realLogins) {
                        const normName = String(row.player_name || '').trim().toLowerCase();
                        const normIp = String(row.ip_address || '').trim().toLowerCase();
                        const key = (normName && normName !== 'khách truy cập') ? `name:${normName}` : `ip:${normIp}`;
                        if (seenKeys.has(key)) {
                            if (row.id) duplicateIds.push(row.id);
                        } else {
                            seenKeys.add(key);
                            deduped.push(row);
                        }
                    }
                    if (duplicateIds.length > 0) {
                        this.client.from('quiz_logins').delete().in('id', duplicateIds).then(() => {});
                    }
                    return deduped;
                } else if (error) {
                    console.warn('[DatabaseService] Student monitor query failed:', { message: error.message, code: error.code });
                }
            } catch (err) {
                console.warn("[DatabaseService] Lỗi khi tải quiz_logins từ Supabase:", err);
            }
        }
        return this._getLocalLogins()
            .filter(isStudentLogin)
            .map(item => ({
                ...item,
                ip_address: item.ip_address || item.client_ip || 'Chưa xác định',
                client_ip: item.ip_address || item.client_ip || 'Chưa xác định',
                player_name: (item.player_name && item.player_name.trim()) ? item.player_name.trim() : 'Khách truy cập',
                device_info: (item.device_info && item.device_info !== 'Chưa rõ') ? item.device_info : 'Trình duyệt Web'
            }));
    }

    /**
     * Alias cho fetchActiveLogins (tương thích toàn bộ lời gọi hàm trong Admin)
     */
    async fetchActiveLogins(limit = 300) {
        return await this.getLoginHistory(limit);
    }

    /**
     * Xóa 1 bản ghi đăng nhập
     */
    async deleteLoginRecord(loginId) {
        if (this.isSupabaseActive && this.client && loginId && !String(loginId).startsWith('local_')) {
            const { error } = await this.client.from('quiz_logins').delete().eq('id', loginId);
            if (error) throw new Error(`Không thể xóa lịch sử đăng nhập: ${error.message}`);
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
            const adminConfig = await this.fetchAdminIpsConfig();
            const adminIps = new Set([
                adminConfig?.masterIp,
                ...(Array.isArray(adminConfig?.ips) ? adminConfig.ips : []),
                ...(Array.isArray(adminConfig?.allowedIps) ? adminConfig.allowedIps.map(item => typeof item === 'string' ? item : item?.ip) : [])
            ].map(ip => String(ip || '').trim()).filter(Boolean));
            const { data, error: selectError } = await this.client
                .from('quiz_logins')
                .select('id, player_name, ip_address');
            if (selectError) throw new Error(`Không thể đọc lịch sử đăng nhập trước khi xóa: ${selectError.message}`);

            const ids = (data || [])
                .filter(item => !String(item.player_name || '').startsWith('__') && !adminIps.has(String(item.ip_address || '').trim()))
                .map(item => item.id)
                .filter(Boolean);
            if (ids.length > 0) {
                const { error: deleteError } = await this.client.from('quiz_logins').delete().in('id', ids);
                if (deleteError) throw new Error(`Không thể xóa lịch sử đăng nhập: ${deleteError.message}`);
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

    /**
     * Tải câu hỏi trực tuyến theo môn học
     */
    async fetchQuestionsOnline(subjectKey = 'history') {
        if (this.isSupabaseActive && this.client) {
            try {
                let query = this.client
                    .from('quiz_questions')
                    .select('*')
                    .order('id', { ascending: true });

                if (subjectKey) {
                    query = query.eq('subject_key', subjectKey);
                }

                const { data, error } = await query;

        if (!error) {
                    console.debug('[DatabaseService] Questions query succeeded:', { subjectKey, count: (data || []).length });
                    return (data || []).map(row => ({
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
                        explanation: row.explanation || '',
                        imageUrl: row.image_url || ''
                    }));
                }
                console.warn('[DatabaseService] Questions query failed:', { subjectKey, error: error?.message, code: error?.code, details: error?.details });
                throw error;
            } catch (err) {
                console.warn("[DatabaseService] Lỗi fetch questions từ Supabase:", err);
                return null;
            }
        }

        // Cache cục bộ
        const cached = localStorage.getItem(`${STORAGE_KEYS.CUSTOM_QUESTIONS}_${subjectKey}`);
        if (cached) return JSON.parse(cached);
        return [];
    }

    async getNextQuestionId() {
        let maxId = 0;
        if (this.isSupabaseActive && this.client) {
            try {
                const { data } = await this.client
                    .from('quiz_questions')
                    .select('id')
                    .order('id', { ascending: false })
                    .limit(1);
                if (data && data.length > 0 && typeof data[0].id === 'number') {
                    maxId = data[0].id;
                }
            } catch (e) {
                maxId = 1000;
            }
        }
        return maxId + 1;
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

        const record = {
            subject_key: qObj.subjectKey || qObj.subject_key || subjectKey || 'history',
            category: qObj.category || 'Bài học',
            q_type: qObj.qType || qObj.q_type || 'mcq',
            question: qObj.question,
            options: cleanOptions,
            statements: qObj.statements || [],
            correct: correctInt,
            answer: correctInt,
            correct_value: qObj.correctValue !== undefined ? String(qObj.correctValue) : String(qObj.correct_value || qObj.correctAnswer || qObj.answer || qObj.correct || ''),
            explanation: qObj.explanation || '',
            image_url: qObj.image_url || qObj.imageUrl || '',
            updated_at: new Date().toISOString()
        };

        if (qObj.id !== undefined && qObj.id !== null && qObj.id !== '' && Number.isInteger(Number(qObj.id))) {
            record.id = Number(qObj.id);
        } else {
            record.id = await this.getNextQuestionId();
        }

        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_questions')
                    .upsert([record], { onConflict: 'id' })
                    .select();

                if (!error) {
                    const item = data?.[0] || record;
                    if (qObj.id === undefined || qObj.id === null || qObj.id === '') qObj.id = item.id;
                    return { success: true, item };
                }
                if (error) throw error;
            } catch (err) {
                console.error("[DatabaseService] Lỗi khi lưu câu hỏi lên Supabase:", err);
                return { success: false, error: err.message };
            }
        }

        return { success: true, localOnly: true };
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
            try {
                const { data: existingRows } = await this.client
                    .from('quiz_questions')
                    .select('id, subject_key');
                (existingRows || []).forEach(row => {
                    if (row && row.id !== undefined && row.subject_key !== cleanSubject) {
                        otherSubjectIds.add(Number(row.id));
                    }
                });
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
            q.id = id;
            return {
                id,
                subject_key: cleanSubject,
                category: q.category || 'Bài tập',
                q_type: q.qType || q.type || 'mcq',
                question: q.question,
                options: cleanOptions,
                statements: q.statements || [],
                correct: correctInt,
                answer: correctInt,
                correct_value: q.correctValue !== undefined ? String(q.correctValue) : '',
                explanation: q.explanation || '',
                image_url: q.image_url || q.imageUrl || '',
                updated_at: new Date().toISOString()
            };
        });

        // Cập nhật lại bộ nhớ local của trình duyệt
        try {
            localStorage.setItem(`${STORAGE_KEYS.CUSTOM_QUESTIONS}_${cleanSubject}`, JSON.stringify(questionsList));
        } catch (e) { }

        if (this.isSupabaseActive && this.client) {
            try {
                // Chia nhỏ chunk 50 câu để tránh quá tải payload
                const chunkSize = 50;
                let insertedCount = 0;
                for (let i = 0; i < records.length; i += chunkSize) {
                    const chunk = records.slice(i, i + chunkSize);
                    const { data, error } = await this.client
                        .from('quiz_questions')
                        .upsert(chunk, { onConflict: 'id' })
                        .select('id');
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
     * Xóa 1 câu hỏi theo ID
     */
    async deleteQuestion(qId) {
        if (this.isSupabaseActive && this.client && qId) {
            try {
                const { error } = await this.client.from('quiz_questions').delete().eq('id', qId);
                if (error) throw error;
                return true;
            } catch (e) {
                console.error("[DatabaseService] Lỗi khi xóa câu hỏi:", e);
                throw e;
            }
        }
        return false;
    }

    /**
     * Xóa toàn bộ câu hỏi của một môn học
     */
    async clearQuestionsBySubject(subjectKey) {
        const cleanSubject = String(subjectKey || '').trim();
        if (!cleanSubject) return { success: false, count: 0, error: 'Thiếu mã môn học.' };
        if (!this.isSupabaseActive || !this.client) {
            return { success: false, count: 0, error: 'Supabase Cloud chưa sẵn sàng.' };
        }

        try {
            const { error: deleteError } = await this.client
                .from('quiz_questions')
                .delete()
                .eq('subject_key', cleanSubject);
            if (deleteError) throw deleteError;

            // Không coi request DELETE thành công nếu RLS chặn silently hoặc
            // còn câu hỏi mồ côi. Chỉ trả success sau khi đọc xác minh count=0.
            const { count, error: verifyError } = await this.client
                .from('quiz_questions')
                .select('id', { count: 'exact', head: true })
                .eq('subject_key', cleanSubject);
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
        if (!cleanIp || cleanIp === "Chưa xác định" || cleanIp === "IP Cục Bộ") {
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
                const { data: updated, error: updateErr } = await this.client
                    .from('quiz_logins')
                    .update({ status: banStatus, score_summary: reason, last_active: nowIso })
                    .eq('ip_address', cleanIp)
                    .select();

                // Nếu IP này chưa từng đăng nhập (0 dòng được update), INSERT một bản ghi __BANNED_IP__
                if (!updateErr && (!updated || updated.length === 0)) {
                    await this.client
                        .from('quiz_logins')
                        .insert([{
                            id: this.generateUUID(),
                            player_name: '__BANNED_IP__',
                            ip_address: cleanIp,
                            device_info: 'Manual Ban',
                            status: banStatus,
                            score_summary: reason,
                            last_active: nowIso,
                            created_at: nowIso
                        }]);
                }
            } catch (err) {
                console.error("[DatabaseService] Lỗi khi chặn IP trên Supabase:", err);
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
        const nowIso = new Date().toISOString();

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
                // Phục hồi trạng thái bình thường
                await this.client
                    .from('quiz_logins')
                    .update({ status: "Đang ôn tập", last_active: nowIso })
                    .eq('ip_address', cleanIp)
                    .like('status', 'BANNED%');

                // Xóa bản ghi chặn thủ công nếu có
                await this.client
                    .from('quiz_logins')
                    .delete()
                    .eq('ip_address', cleanIp)
                    .eq('player_name', '__BANNED_IP__');
            } catch (err) {}
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
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('status, score_summary')
                    .eq('ip_address', cleanIp)
                    .like('status', 'BANNED%')
                    .limit(1);

                if (!error && data && data.length > 0) {
                    const reason = data[0].score_summary || data[0].status.replace(/^BANNED:\s*/, "") || "Vi phạm quy chế";
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
                            const reason = item.score_summary || (item.status ? item.status.replace(/^BANNED:\s*/, "") : "Vi phạm quy chế");
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
     * Giám thị phát thông báo cho toàn phòng hoặc riêng 1 IP
     */
    async sendBroadcastNotice(message, targetIp = 'ALL') {
        const cleanMsg = (message || "").trim();
        if (!cleanMsg) return { success: false, error: 'Nội dung thông báo không được để trống.' };
        const cleanTargetIp = String(targetIp || 'ALL').trim() || 'ALL';

        const nowIso = new Date().toISOString();
        const noticeId = this.generateUUID();

        const record = {
            id: noticeId,
            player_name: '__SYSTEM_NOTICE__',
            ip_address: cleanTargetIp,
            device_info: '5s',
            status: 'ACTIVE',
            score_summary: cleanMsg,
            last_active: nowIso,
            created_at: nowIso
        };

        try {
            localStorage.setItem('quiz_latest_system_notice', JSON.stringify({
                id: noticeId,
                message: cleanMsg,
                targetIp: cleanTargetIp,
                timestamp: Date.now()
            }));
        } catch (e) {}

        if (this.isSupabaseActive && this.client) {
            try {
                const { error } = await this.client
                    .from('quiz_logins')
                    .insert([record]);
                if (error) throw error;
            } catch (err) {
                console.error("[DatabaseService] Lỗi phát thông báo:", err);
                return { success: false, error: err.message };
            }
        }

        return { success: true, id: noticeId, message: cleanMsg, targetIp: cleanTargetIp };
    }

    /**
     * Máy học sinh lắng nghe thông báo mới nhất
     */
    async fetchLatestNotice(clientIp) {
        const isValidNotice = (message, timestamp) => {
            const cleanMessage = typeof message === 'string' ? message.trim() : '';
            // Ignore accidental test characters and notices that have already expired.
            return cleanMessage.length >= 2 && (!timestamp || Date.now() - timestamp <= 10 * 60 * 1000);
        };

        if (this.isSupabaseActive && this.client) {
            try {
                let query = this.client
                    .from('quiz_logins')
                    .select('*')
                    .eq('player_name', '__SYSTEM_NOTICE__');
                if (clientIp) query = query.in('ip_address', ['ALL', String(clientIp).trim()]);
                const { data, error } = await query.order('last_active', { ascending: false }).limit(20);

                if (!error && data && data.length > 0) {
                    const match = data.find(item => item.ip_address === 'ALL' || (clientIp && item.ip_address === clientIp));
                    const timestamp = match ? new Date(match.last_active || match.created_at).getTime() : 0;
                    if (match && isValidNotice(match.score_summary, timestamp)) {
                        return {
                            id: match.id,
                            message: match.score_summary,
                            targetIp: match.ip_address,
                            timestamp
                        };
                    }
                }
            } catch (e) {}
        }

        try {
            const raw = localStorage.getItem('quiz_latest_system_notice');
            if (raw) {
                const n = JSON.parse(raw);
                if (isValidNotice(n.message, n.timestamp) && (n.targetIp === 'ALL' || (clientIp && n.targetIp === clientIp))) {
                    return n;
                }
            }
        } catch (e) {}

        return null;
    }

    /**
     * Alias phát thông báo tương thích với app.js
     */
    async broadcastNotice(message, targetIp = 'ALL') {
        return await this.sendBroadcastNotice(message, targetIp);
    }

    /**
     * Lấy thông báo mới nhất cho học sinh (tương thích app.js)
     */
    async getSystemNotice(clientIp) {
        const notice = await this.fetchLatestNotice(clientIp);
        if (!notice) return null;
        return {
            id: notice.id,
            content: notice.message,
            message: notice.message,
            active: true,
            targetIp: notice.targetIp,
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
            try {
                localStorage.setItem('quiz_geo_mode', mode);
                localStorage.setItem('quiz_allowed_geo_ips', JSON.stringify(ips));
                localStorage.setItem('quiz_allowed_grade5_ips', JSON.stringify(grade5Ips));
            } catch (e) {}
            grade5Ips = grade5Ips.map(ip => String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase()).filter(Boolean);
            console.debug('[DatabaseService] Loaded Grade 5 access config from Supabase:', { mode, ips, grade5Ips });
            return { mode, ips, grade5Ips };
                }
            } catch (e) {
                console.warn("[DatabaseService] Lỗi lấy cấu hình phân quyền môn Địa:", e);
            }
            console.debug('[DatabaseService] Geo config fetch result:', { mode, ips, grade5Ips, error: undefined });
            return { mode, ips, grade5Ips };
        }

        try {
            mode = localStorage.getItem('quiz_geo_mode') || 'PUBLIC';
            const raw = localStorage.getItem('quiz_allowed_geo_ips');
            ips = raw ? JSON.parse(raw) : [];
            const grade5Raw = localStorage.getItem('quiz_allowed_grade5_ips');
            grade5Ips = grade5Raw ? JSON.parse(grade5Raw) : [];
        } catch (e) {}

        grade5Ips = grade5Ips.map(ip => String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase()).filter(Boolean);
        console.debug('[DatabaseService] Loaded Grade 5 access config from localStorage:', { mode, ips, grade5Ips });
        return { mode, ips, grade5Ips };
    }

    async saveGeoConfig(mode = 'PUBLIC', ipList = [], grade5IpList) {
        const cleanMode = (mode === 'PRIVATE') ? 'PRIVATE' : 'PUBLIC';
        const cleanList = Array.isArray(ipList) ? [...new Set(ipList.map(ip => String(ip).trim()).filter(Boolean))] : [];
        let storedGrade5Ips = grade5IpList;
        if (!Array.isArray(storedGrade5Ips)) {
            try { storedGrade5Ips = JSON.parse(localStorage.getItem('quiz_allowed_grade5_ips') || '[]'); } catch (e) { storedGrade5Ips = []; }
        }
        const cleanGrade5Ips = Array.isArray(storedGrade5Ips) ? [...new Set(storedGrade5Ips.map(ip => String(ip).trim()).filter(Boolean))] : [];

        try {
            localStorage.setItem('quiz_geo_mode', cleanMode);
            localStorage.setItem('quiz_allowed_geo_ips', JSON.stringify(cleanList));
            localStorage.setItem('quiz_allowed_grade5_ips', JSON.stringify(cleanGrade5Ips));
        } catch (e) {}

        if (this.isSupabaseActive && this.client) {
            try {
                await this.client
                    .from('quiz_logins')
                    .upsert([{
                        id: SYSTEM_RECORDS.GEO_CONFIG,
                        player_name: '__ALLOWED_GEO_IPS__',
                        ip_address: 'SYSTEM',
                        device_info: cleanMode,
                        status: 'ACTIVE',
                        score_summary: JSON.stringify({ mode: cleanMode, ips: cleanList, grade5Ips: cleanGrade5Ips }),
                        last_active: new Date().toISOString()
                    }], { onConflict: 'id' });
            } catch (e) {
                console.error("[DatabaseService] Lỗi lưu cấu hình môn Địa:", e);
            }
        }

        return { mode: cleanMode, ips: cleanList, grade5Ips: cleanGrade5Ips };
    }

    async setGeoMode(mode) {
        const config = await this.fetchGeoConfig();
        return await this.saveGeoConfig(mode, config.ips);
    }

    async fetchAllowedGeoIps() {
        const config = await this.fetchGeoConfig();
        return config.ips;
    }

    async saveAllowedGeoIps(ipList) {
        const config = await this.fetchGeoConfig();
        const res = await this.saveGeoConfig(config.mode, ipList);
        return res.ips;
    }

    async addGeoAllowedIp(ipAddress) {
        const cleanIp = (ipAddress || "").trim();
        if (!cleanIp) return false;
        const config = await this.fetchGeoConfig();
        if (!config.ips.includes(cleanIp)) {
            config.ips.push(cleanIp);
            await this.saveGeoConfig(config.mode, config.ips);
        }
        return config.ips;
    }

    async removeGeoAllowedIp(ipAddress) {
        const cleanIp = (ipAddress || "").trim();
        if (!cleanIp) return false;
        const config = await this.fetchGeoConfig();
        config.ips = config.ips.filter(ip => ip !== cleanIp);
        await this.saveGeoConfig(config.mode, config.ips);
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
                await this.client
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
            } catch (e) {
                console.error("[DatabaseService] Lỗi cập nhật trạng thái bảo trì:", e);
            }
        }

        return { isActive: cleanActive, message: cleanMsg };
    }

    async checkMaintenanceStatus() {
        let isActive = false;
        let message = "Trang web đang tạm dừng để cập nhật đề cương và dữ liệu mới. Vui lòng quay lại sau!";

        if (this.isSupabaseActive && this.client) {
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
        let allowedIps = []; // mảng các đối tượng: [{ ip: "1.2.3.4", name: "Máy bàn", isMaster: true }]

        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('device_info, score_summary')
                    .eq('id', SYSTEM_RECORDS.ADMIN_IPS)
                    .limit(1);

                if (!error && data && data.length > 0) {
                    const row = data[0];
                    if (row.score_summary) {
                        try {
                            const parsed = JSON.parse(row.score_summary);
                            if (Array.isArray(parsed)) {
                                allowedIps = parsed;
                            } else if (parsed && typeof parsed === 'object') {
                                masterIp = parsed.masterIp || "";
                                allowedIps = Array.isArray(parsed.allowedIps) ? parsed.allowedIps : (Array.isArray(parsed.ips) ? parsed.ips.map(ip => ({ ip, name: 'Admin', isMaster: ip === masterIp })) : []);
                            }
                        } catch (e) {}
                    }
                    // Đồng nhất cấu trúc
                    const ips = allowedIps.map(x => typeof x === 'string' ? x : x.ip).filter(Boolean);
                    try {
                        localStorage.setItem(STORAGE_KEYS.ADMIN_IPS_CONFIG, JSON.stringify({ masterIp, allowedIps, ips }));
                    } catch (e) {}
                    return { masterIp, allowedIps, ips };
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
                    return { masterIp: cached.masterIp || "", allowedIps: cached.allowedIps || [], ips };
                }
            }
        } catch (e) {}

        const ips = allowedIps.map(x => typeof x === 'string' ? x : x.ip).filter(Boolean);
        return { masterIp, allowedIps, ips };
    }

    /**
     * Lưu cấu hình Whitelist IP Admin lên Supabase Cloud & LocalStorage
     */
    async saveAdminIpsConfig(config) {
        const masterIp = (config && config.masterIp) ? String(config.masterIp).trim() : "";
        let allowedIps = [];
        if (config && Array.isArray(config.allowedIps)) {
            allowedIps = config.allowedIps;
        } else if (config && Array.isArray(config.ips)) {
            allowedIps = config.ips.map(ip => typeof ip === 'string' ? { ip, name: 'Admin', isMaster: ip === masterIp } : ip);
        }
        const ips = allowedIps.map(x => typeof x === 'string' ? x : x.ip).filter(Boolean);
        const payloadStr = JSON.stringify({ masterIp, allowedIps, ips });
        const nowIso = new Date().toISOString();

        try {
            localStorage.setItem(STORAGE_KEYS.ADMIN_IPS_CONFIG, payloadStr);
        } catch (e) {}

        if (this.isSupabaseActive && this.client) {
            try {
                await this.client
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
            } catch (e) {
                console.error("[DatabaseService] Lỗi lưu Admin IPs lên Supabase:", e);
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
    async checkIsAdminIp(ip) {
        const cleanIp = (ip || "").trim();
        if (!cleanIp || cleanIp === "Chưa xác định" || cleanIp === "IP Cục Bộ") return false;

        const config = await this.fetchAdminIpsConfig();
        if (config.masterIp && config.masterIp === cleanIp) return true;
        if (Array.isArray(config.ips) && config.ips.includes(cleanIp)) return true;
        return config.allowedIps.some(item => (typeof item === 'string' ? item : item.ip) === cleanIp);
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
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('score_summary')
                    .eq('id', SYSTEM_RECORDS.DYNAMIC_SUBJECTS)
                    .limit(1);

                if (!error && data && data.length > 0 && data[0].score_summary) {
                    try {
                        const parsed = JSON.parse(data[0].score_summary);
                        if (Array.isArray(parsed)) subjects = parsed;
                    } catch (e) {}
                    try {
                        localStorage.setItem(STORAGE_KEYS.DYNAMIC_SUBJECTS, JSON.stringify(subjects));
                    } catch (e) {}
                    return subjects;
                }
                // Cloud là nguồn sự thật khi đang online; không phục hồi cache cũ sau khi Admin đã xóa dữ liệu.
                if (error || !data || data.length === 0) return [];
            } catch (e) {}
            return subjects;
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
    async fetchLeaderboard(subjectKey = '', limit = 10) {
        const logins = await this.getLoginHistory(350);
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

        // Lọc các bản ghi đã nộp bài
        const submitted = logins.filter(item => {
            const status = (item.status || "").toLowerCase();
            const summary = (item.score_summary || "").toLowerCase();
            const isFinished = status.includes("đã nộp") || status.includes("hoàn thành") || summary.includes("điểm");
            if (!isFinished) return false;

            if (subjectKey) {
                const combined = status + " " + summary;
                if (dynamicSubjectName && combined.includes(dynamicSubjectName)) return true;
                if (subjectKey === 'geography' && (combined.includes('địa') || combined.includes('/67'))) return true;
                if (subjectKey === 'physics' && (combined.includes('lí') || combined.includes('vật') || combined.includes('/52') || combined.includes('/43'))) return true;
                if (subjectKey === 'history' && (combined.includes('sử') || combined.includes('/101') || combined.includes('/74'))) return true;
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

            const scoreMatch = (item.score_summary || "").match(/(\d+(?:\.\d+)?)\s*điểm/i);
            if (scoreMatch) score = parseFloat(scoreMatch[1]);

            const ratioMatch = (item.score_summary || "").match(/đúng\s*(\d+)\/(\d+)/i) || (item.status || "").match(/(\d+)\/(\d+)/i);
            if (ratioMatch) {
                correctCount = parseInt(ratioMatch[1], 10);
                totalCount = parseInt(ratioMatch[2], 10);
                if (!score && totalCount > 0) {
                    score = Math.round((correctCount / totalCount) * 100) / 10;
                }
            }

            let timeSpent = '—';
            const timeMatch = (item.score_summary || "").match(/-\s*(\d{1,2}:\d{2})/);
            if (timeMatch) timeSpent = timeMatch[1];

            return {
                id: item.id,
                playerName: item.player_name || "Thí sinh ẩn danh",
                player_name: item.player_name || "Thí sinh ẩn danh",
                ipAddress: item.ip_address || "Chưa rõ",
                ip_address: item.ip_address || "Chưa rõ",
                deviceInfo: item.device_info || "Trình duyệt",
                device_info: item.device_info || "Trình duyệt",
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

        // Lọc trùng theo Tên + IP, chỉ giữ lượt thi điểm cao nhất (nếu bằng điểm thì lấy thời gian làm bài nhanh hơn)
        const studentBestMap = new Map();
        parsedResults.forEach(res => {
            const key = `${res.playerName.toLowerCase().trim()}___${res.ipAddress}`;
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
        const logins = await this.getLoginHistory(500);
        return logins
            .filter(item => {
                const s = (item.status || "").toLowerCase();
                const sc = (item.score_summary || "").toLowerCase();
                return s.includes("đã nộp") || s.includes("hoàn thành") || sc.includes("điểm") || sc.includes("đúng");
            })
            .map(item => {
                let score = 0;
                const scoreMatch = (item.score_summary || "").match(/(\d+(?:\.\d+)?)\s*điểm/i);
                if (scoreMatch) score = parseFloat(scoreMatch[1]);

                let correctCount = '-';
                let totalItems = '-';
                let correctText = "";
                const ratioMatch = (item.score_summary || "").match(/đúng\s*(\d+)\/(\d+)/i) || (item.score_summary || "").match(/đúng\s*(\d+\/\d+)/i);
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
                const subjMatch = (item.status || "").match(/\[(.*?)\]/);
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
        // 1. Tải toàn bộ dữ liệu học sinh hiện có
        const studentLogins = await this.getLoginHistory(1000);
        const backupData = {
            archivedAt: new Date().toISOString(),
            totalStudents: studentLogins.length,
            records: studentLogins
        };

        // 2. Xóa toàn bộ học sinh trên Supabase Cloud (bảo toàn cấu hình hệ thống __...)
        if (this.isSupabaseActive && this.client) {
            const adminConfig = await this.fetchAdminIpsConfig();
            const adminIps = new Set([
                adminConfig?.masterIp,
                ...(Array.isArray(adminConfig?.ips) ? adminConfig.ips : []),
                ...(Array.isArray(adminConfig?.allowedIps) ? adminConfig.allowedIps.map(item => typeof item === 'string' ? item : item?.ip) : [])
            ].map(ip => String(ip || '').trim()).filter(Boolean));
            const { data, error: selectError } = await this.client.from('quiz_logins').select('id, player_name, ip_address');
            if (selectError) throw new Error(`Không thể đọc dữ liệu trước khi dọn: ${selectError.message}`);
            const ids = (data || []).filter(item => !String(item.player_name || '').startsWith('__') && !adminIps.has(String(item.ip_address || '').trim())).map(item => item.id).filter(Boolean);
            if (ids.length > 0) {
                const { error } = await this.client.from('quiz_logins').delete().in('id', ids);
                if (error) throw new Error(`Không thể dọn dữ liệu trên Cloud: ${error.message}`);
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
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('status, score_summary')
                    .eq('id', SYSTEM_RECORDS.GEMINI_CONFIG)
                    .limit(1);

                if (!error && data && data.length > 0 && data[0].status === 'ACTIVE' && data[0].score_summary) {
                    key = data[0].score_summary.trim();
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
            const nowIso = new Date().toISOString();
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
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('status, score_summary')
                    .eq('id', SYSTEM_RECORDS.AI_IPS)
                    .limit(1);
                if (!error && data && data.length > 0 && data[0].status === 'ACTIVE' && data[0].score_summary) {
                    try {
                        const parsed = JSON.parse(data[0].score_summary);
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
}

// Khởi tạo instance Singleton toàn cục
window.dbService = new DatabaseService();
