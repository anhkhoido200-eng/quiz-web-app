/**
 * supabase.js - Quản lý kết nối Supabase Cloud & LocalStorage Fallback
 * Hỗ trợ:
 * 1. Ghi nhận địa chỉ IP, thiết bị & tên học sinh đăng nhập (Tự động nhận diện)
 * 2. Giám sát thiết bị đăng nhập thời gian thực cho Admin
 * 3. Quản lý ngân hàng 74 câu hỏi trực tuyến (Admin Thêm/Sửa/Xóa)
 */

const STORAGE_KEYS = {
    SUPABASE_URL: 'quiz_supabase_url',
    SUPABASE_KEY: 'quiz_supabase_key',
    LOCAL_LOGINS: 'quiz_local_logins_history',
    CUSTOM_QUESTIONS: 'quiz_custom_questions',
    BANNED_IPS: 'quiz_banned_ips',
    MAINTENANCE: 'quiz_maintenance_mode',
    MAINTENANCE_MSG: 'quiz_maintenance_msg'
};

// Cấu hình mặc định của dự án Supabase (Đã được điền tự động)
const DEFAULT_SUPABASE_CONFIG = {
    url: "https://qotfikuiwmruicsvsbgq.supabase.co",
    anonKey: "sb_publishable_KtAmEX6Jj97BNElniBrX6w_wVyCeQYs"
};

function generateUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        try { return crypto.randomUUID(); } catch (e) {}
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

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

        if (storedUrl && storedKey && window.supabase) {
            try {
                this.client = window.supabase.createClient(storedUrl, storedKey);
                this.isSupabaseActive = true;
                console.log("%c[DatabaseService] Đã kích hoạt kết nối Supabase Cloud!", "color: #10b981; font-weight: bold;");
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
     * Tạo mã UUID v4 hợp lệ theo chuẩn RFC4122 (tránh lỗi null value in column "id" trên PostgreSQL)
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
    // PHẦN 1: GHI NHẬN ĐỊA CHỈ IP, THIẾT BỊ & TỰ ĐỘNG NHẬN DIỆN TÊN HỌC SINH
    // =========================================================================
    
    /**
     * Ghi nhận lượt đăng nhập (IP, Tên, Thiết bị, Trạng thái)
     */
    async recordLogin(data) {
        const cleanName = (data.playerName || "").trim();
        const cleanIp = (data.ipAddress || "Chưa xác định").trim();
        const cleanDevice = (data.deviceInfo || "Chưa rõ").trim();
        const status = data.status || "Đang ôn tập";
        const scoreSummary = data.scoreSummary || "";
        const nowIso = new Date().toISOString();

        const record = {
            player_name: cleanName,
            ip_address: cleanIp,
            device_info: cleanDevice,
            status: status,
            score_summary: scoreSummary,
            last_active: nowIso,
            created_at: nowIso
        };

        // 1. Luôn lưu vào LocalStorage để ghi nhớ tức thì trên trình duyệt này
        try {
            localStorage.setItem('quiz_saved_player_name', cleanName);
            localStorage.setItem('quiz_saved_ip', cleanIp);
            if (cleanIp !== "Chưa xác định") {
                localStorage.setItem(`quiz_ip_map_${cleanIp}`, cleanName);
            }

            let localLogs = this._getLocalLogins();
            record.id = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            // Đưa lượt mới nhất lên đầu danh sách
            localLogs.unshift(record);
            localStorage.setItem(STORAGE_KEYS.LOCAL_LOGINS, JSON.stringify(localLogs.slice(0, 100)));
        } catch (e) {}

        // 2. Lưu lên Supabase Cloud để máy Admin có thể xem được thời gian thực
        if (this.isSupabaseActive && this.client) {
            try {
                const cloudId = this.generateUUID();
                const { data: inserted, error } = await this.client
                    .from('quiz_logins')
                    .insert([{
                        id: cloudId,
                        player_name: cleanName,
                        ip_address: cleanIp,
                        device_info: cleanDevice,
                        status: status,
                        score_summary: scoreSummary,
                        last_active: nowIso,
                        created_at: nowIso
                    }])
                    .select();

                if (!error && inserted && inserted[0]) {
                    return inserted[0].id;
                }
                if (error) {
                    console.warn("[DatabaseService] Lỗi insert quiz_logins:", error.message);
                }
            } catch (err) {
                console.warn("[DatabaseService] Chưa lưu được lên Supabase quiz_logins (sẽ dùng bản local):", err);
            }
        }

        return record.id;
    }

    /**
     * Tra cứu tên học sinh đã từng đăng nhập bằng IP này
     */
    async getLoginByIp(ipAddress) {
        if (!ipAddress || ipAddress === "Chưa xác định") return null;
        const cleanIp = ipAddress.trim();

        // 1. Kiểm tra bộ nhớ cục bộ trên máy
        try {
            const localName = localStorage.getItem(`quiz_ip_map_${cleanIp}`) || localStorage.getItem('quiz_saved_player_name');
            if (localName) return { playerName: localName };
        } catch (e) {}

        // 2. Tra cứu trên Supabase Cloud
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('player_name, last_active, device_info')
                    .eq('ip_address', cleanIp)
                    .order('last_active', { ascending: false })
                    .limit(1);

                if (!error && data && data.length > 0 && data[0].player_name) {
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
     * Cập nhật trạng thái làm bài (Ví dụ: "Đã nộp bài: 9.5đ (70/74 câu)")
     */
    async updateLoginStatus(loginId, status, scoreSummary = "") {
        const nowIso = new Date().toISOString();

        if (this.isSupabaseActive && this.client && loginId && !String(loginId).startsWith('local_')) {
            try {
                await this.client
                    .from('quiz_logins')
                    .update({
                        status: status,
                        score_summary: scoreSummary,
                        last_active: nowIso
                    })
                    .eq('id', loginId);
            } catch (e) {}
        }

        // Cập nhật local
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
     * Lấy danh sách máy & người đăng nhập cho Admin
     */
    async getLoginHistory(limit = 250) {
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('*')
                    .order('last_active', { ascending: false })
                    .limit(limit);

                if (!error && Array.isArray(data)) {
                    // Lọc bỏ các bản ghi hệ thống nội bộ (__SYSTEM_NOTICE__, __ALLOWED_GEO_IPS__)
                    const realLogins = data.filter(item => !item.player_name || !item.player_name.startsWith('__'));
                    return realLogins;
                }
            } catch (err) {
                console.warn("[DatabaseService] Lỗi khi tải quiz_logins từ Supabase:", err);
            }
        }
        return this._getLocalLogins().filter(item => !item.player_name || !item.player_name.startsWith('__'));
    }

    /**
     * Xóa 1 bản ghi đăng nhập
     */
    async deleteLoginRecord(loginId) {
        if (this.isSupabaseActive && this.client && loginId && !String(loginId).startsWith('local_')) {
            try {
                await this.client.from('quiz_logins').delete().eq('id', loginId);
            } catch (e) {}
        }
        let list = this._getLocalLogins();
        list = list.filter(item => item.id !== loginId);
        localStorage.setItem(STORAGE_KEYS.LOCAL_LOGINS, JSON.stringify(list));
    }

    /**
     * Xóa sạch toàn bộ lịch sử đăng nhập
     */
    async clearAllLogins() {
        if (this.isSupabaseActive && this.client) {
            try {
                await this.client.from('quiz_logins').delete().neq('player_name', '___NON_EXISTENT___');
            } catch (e) {}
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
    // PHẦN 2: QUẢN LÝ NGÂN HÀNG CÂU HỎI TRỰC TUYẾN (ONLINE QUESTIONS CRUD)
    // =========================================================================

    async fetchQuestionsOnline() {
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_questions')
                    .select('*')
                    .order('id', { ascending: true });

                if (!error && data && data.length > 0) {
                    return data.map(row => ({
                        id: row.id,
                        qType: row.q_type || (Array.isArray(row.statements) && row.statements.length > 0 ? 'tf_group' : 'mcq'),
                        category: row.category || 'Lịch Sử 11',
                        question: row.question,
                        options: Array.isArray(row.options) ? row.options : [],
                        correct: row.correct !== undefined ? row.correct : 0,
                        statements: Array.isArray(row.statements) ? row.statements : [],
                        explanation: row.explanation || ""
                    }));
                }
            } catch (err) {
                console.warn("[DatabaseService] Lỗi khi tải câu hỏi từ Supabase:", err);
            }
        }
        try {
            const cached = localStorage.getItem(STORAGE_KEYS.CUSTOM_QUESTIONS);
            if (cached) return JSON.parse(cached);
        } catch (e) {}

        return window.QUIZ_QUESTIONS || [];
    }

    async saveQuestion(qObj) {
        const payload = {
            id: Number(qObj.id),
            q_type: qObj.qType || (Array.isArray(qObj.statements) && qObj.statements.length > 0 ? 'tf_group' : 'mcq'),
            category: qObj.category || 'Lịch Sử 11',
            question: qObj.question ? qObj.question.trim() : "",
            options: qObj.options || [],
            correct: Number(qObj.correct) || 0,
            statements: qObj.statements || [],
            explanation: qObj.explanation ? qObj.explanation.trim() : "",
            updated_at: new Date().toISOString()
        };

        let cloudSuccess = false;
        let cloudError = null;

        if (this.isSupabaseActive && this.client) {
            try {
                const { error } = await this.client
                    .from('quiz_questions')
                    .upsert([payload], { onConflict: 'id' });
                if (error) {
                    console.error("[DatabaseService] Lỗi upsert câu hỏi:", error);
                    cloudError = error.message;
                } else {
                    cloudSuccess = true;
                }
            } catch (e) {
                cloudError = e.message;
            }
        }

        this._updateLocalQuestionCache(payload);
        return { success: cloudSuccess, error: cloudError };
    }

    async deleteQuestion(qId) {
        if (this.isSupabaseActive && this.client) {
            try {
                await this.client.from('quiz_questions').delete().eq('id', qId);
            } catch (e) {}
        }
        this._deleteFromLocalQuestionCache(qId);
    }

    async seedInitialQuestions(questionsList) {
        if (!this.isSupabaseActive || !this.client || !questionsList || questionsList.length === 0) {
            return { success: false, error: "Chưa kết nối Supabase" };
        }
        try {
            const formatted = questionsList.map(q => ({
                id: Number(q.id),
                q_type: q.qType || (Array.isArray(q.statements) && q.statements.length > 0 ? 'tf_group' : 'mcq'),
                category: q.category || 'Lịch Sử 11',
                question: q.question,
                options: q.options || [],
                correct: Number(q.correct) || 0,
                statements: q.statements || [],
                explanation: q.explanation || "",
                updated_at: new Date().toISOString()
            }));

            const { error } = await this.client
                .from('quiz_questions')
                .upsert(formatted, { onConflict: 'id' });

            if (error) {
                console.error("Lỗi seed:", error);
                return { success: false, error: error.message };
            }
            
            console.log(`%c[DatabaseService] Đã đồng bộ ${questionsList.length} câu hỏi lên Supabase Cloud!`, "color: #10b981; font-weight: bold;");
            return { success: true };
        } catch (e) {
            console.error("Lỗi seed câu hỏi:", e);
            return { success: false, error: e.message };
        }
    }

    _updateLocalQuestionCache(item) {
        let list = [];
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_QUESTIONS);
            list = raw ? JSON.parse(raw) : [...(window.QUIZ_QUESTIONS || [])];
        } catch (e) {
            list = [...(window.QUIZ_QUESTIONS || [])];
        }

        const idx = list.findIndex(q => q.id === item.id);
        if (idx !== -1) {
            list[idx] = { ...list[idx], ...item };
        } else {
            list.push(item);
        }
        localStorage.setItem(STORAGE_KEYS.CUSTOM_QUESTIONS, JSON.stringify(list));
    }

    _deleteFromLocalQuestionCache(qId) {
        let list = [];
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_QUESTIONS);
            list = raw ? JSON.parse(raw) : [...(window.QUIZ_QUESTIONS || [])];
        } catch (e) {
            list = [...(window.QUIZ_QUESTIONS || [])];
        }
        list = list.filter(q => q.id !== qId);
        localStorage.setItem(STORAGE_KEYS.CUSTOM_QUESTIONS, JSON.stringify(list));
    }

    // =========================================================================
    // PHẦN 3: TÍNH NĂNG CHẶN IP TỨC THÌ (REAL-TIME BAN) KÈM LÝ DO & TIẾN ĐỘ LIVE
    // =========================================================================

    /**
     * Cập nhật tiến độ làm bài thời gian thực của học sinh lên Supabase
     * Thay thế chữ "Đang làm bài" tĩnh bằng số câu cụ thể và % hoàn thành
     */
    async updateStudentProgress(loginId, answeredCount, totalCount, correctCount, subjectName) {
        if (!loginId) return;
        const percent = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;
        const subj = subjectName || "Đang làm bài";
        const statusText = `[${subj}] Tiến độ: ${answeredCount}/${totalCount} câu (${percent}%)`;
        const scoreText = `[${subj}] Đúng ${correctCount}/${answeredCount} câu đã làm`;
        const nowIso = new Date().toISOString();

        // 1. Cập nhật LocalStorage
        try {
            let localLogs = this._getLocalLogins();
            const idx = localLogs.findIndex(l => l.id === loginId);
            if (idx !== -1) {
                localLogs[idx].status = statusText;
                localLogs[idx].score_summary = scoreText;
                localLogs[idx].last_active = nowIso;
                localStorage.setItem(STORAGE_KEYS.LOCAL_LOGINS, JSON.stringify(localLogs));
            }
        } catch (e) {}

        // 2. Cập nhật Supabase Cloud
        if (this.isSupabaseActive && this.client) {
            try {
                await this.client
                    .from('quiz_logins')
                    .update({
                        status: statusText,
                        score_summary: scoreText,
                        last_active: nowIso
                    })
                    .eq('id', loginId);
            } catch (err) {
                console.warn("[DatabaseService] Lỗi cập nhật tiến độ:", err);
            }
        }
    }

    /**
     * Admin chặn IP ngay lập tức kèm lý do cụ thể
     */
    async banIp(ipAddress, reason = "Vi phạm quy chế ôn tập") {
        const cleanIp = (ipAddress || "").trim();
        if (!cleanIp || cleanIp === "Chưa xác định" || cleanIp === "IP Cục Bộ") {
            throw new Error("Địa chỉ IP không hợp lệ để chặn.");
        }

        const banReason = reason.trim() || "Vi phạm quy chế phòng thi / Gian lận";
        const banStatus = `BANNED: ${banReason}`;
        const nowIso = new Date().toISOString();

        // 1. Lưu vào danh sách banned của LocalStorage
        try {
            let bannedMap = {};
            const raw = localStorage.getItem(STORAGE_KEYS.BANNED_IPS);
            if (raw) bannedMap = JSON.parse(raw);
            bannedMap[cleanIp] = {
                reason: banReason,
                bannedAt: nowIso
            };
            localStorage.setItem(STORAGE_KEYS.BANNED_IPS, JSON.stringify(bannedMap));
        } catch (e) {}

        // 2. Cập nhật trên Supabase Cloud để đá văng máy học sinh theo thời gian thực
        if (this.isSupabaseActive && this.client) {
            try {
                await this.client
                    .from('quiz_logins')
                    .update({
                        status: banStatus,
                        last_active: nowIso
                    })
                    .eq('ip_address', cleanIp);
            } catch (err) {
                console.error("[DatabaseService] Lỗi ban IP trên Supabase:", err);
            }
        }

        return { success: true, ip: cleanIp, reason: banReason };
    }

    /**
     * Admin mở khóa cho IP
     */
    async unbanIp(ipAddress) {
        const cleanIp = (ipAddress || "").trim();
        if (!cleanIp) return { success: false };

        // 1. Xóa khỏi LocalStorage
        try {
            let bannedMap = {};
            const raw = localStorage.getItem(STORAGE_KEYS.BANNED_IPS);
            if (raw) bannedMap = JSON.parse(raw);
            delete bannedMap[cleanIp];
            localStorage.setItem(STORAGE_KEYS.BANNED_IPS, JSON.stringify(bannedMap));
        } catch (e) {}

        // 2. Mở khóa trên Supabase Cloud
        if (this.isSupabaseActive && this.client) {
            try {
                await this.client
                    .from('quiz_logins')
                    .update({
                        status: 'Đã mở khóa (Sẵn sàng)',
                        last_active: new Date().toISOString()
                    })
                    .eq('ip_address', cleanIp)
                    .like('status', 'BANNED%');
            } catch (err) {
                console.error("[DatabaseService] Lỗi unban IP trên Supabase:", err);
            }
        }

        return { success: true, ip: cleanIp };
    }

    /**
     * Kiểm tra xem địa chỉ IP hiện tại có đang bị chặn hay không (dùng cho Heartbeat học sinh)
     */
    async checkIsIpBanned(ipAddress) {
        const cleanIp = (ipAddress || "").trim();
        if (!cleanIp || cleanIp === "Chưa xác định" || cleanIp === "IP Cục Bộ") {
            return { isBanned: false };
        }

        // 1. Kiểm tra trực tiếp trên Supabase Cloud (Nguồn dữ liệu chuẩn nhất)
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('status')
                    .eq('ip_address', cleanIp)
                    .like('status', 'BANNED%')
                    .order('last_active', { ascending: false })
                    .limit(1);

                if (!error && data && data.length > 0) {
                    const statusStr = data[0].status || "";
                    const reason = statusStr.replace(/^BANNED:\s*/, "") || "Vi phạm quy chế phòng thi";
                    return { isBanned: true, reason: reason };
                } else if (!error) {
                    // Nếu trên Supabase đã được mở khóa, tự động làm sạch cache local
                    try {
                        let bannedMap = {};
                        const raw = localStorage.getItem(STORAGE_KEYS.BANNED_IPS);
                        if (raw) {
                            bannedMap = JSON.parse(raw);
                            if (bannedMap[cleanIp]) {
                                delete bannedMap[cleanIp];
                                localStorage.setItem(STORAGE_KEYS.BANNED_IPS, JSON.stringify(bannedMap));
                            }
                        }
                    } catch (e) {}
                    return { isBanned: false };
                }
            } catch (err) {
                console.warn("[DatabaseService] Lỗi kiểm tra ban IP trên server:", err);
            }
        }

        // 2. Fallback kiểm tra cache cục bộ (nếu mất mạng hoặc chạy offline)
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.BANNED_IPS);
            if (raw) {
                const map = JSON.parse(raw);
                if (map[cleanIp]) {
                    return { isBanned: true, reason: map[cleanIp].reason || "Vi phạm quy chế" };
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

    // =========================================================================
    // PHẦN 4: PHÁT THÔNG BÁO TỪ GIÁM THỊ ĐẾN THÍ SINH (HIỆN NỔI BẬT 5 GIÂY)
    // =========================================================================

    /**
     * Admin phát thông báo tới màn hình học sinh (Hiện trong 5 giây)
     * targetIp: 'ALL' (toàn bộ học sinh) hoặc địa chỉ IP cụ thể
     */
    async sendBroadcastNotice(message, targetIp = 'ALL') {
        const cleanMsg = (message || '').trim();
        if (!cleanMsg) return { success: false, error: 'Nội dung thông báo không được để trống.' };

        const nowIso = new Date().toISOString();
        const noticeId = this.generateUUID();
        const noticeData = {
            id: noticeId,
            player_name: '__SYSTEM_NOTICE__',
            ip_address: targetIp,
            device_info: '5s',
            status: 'ACTIVE',
            score_summary: cleanMsg,
            last_active: nowIso,
            created_at: nowIso
        };

        // 1. Lưu LocalStorage để có thể nhận ngay trên cùng máy
        try {
            localStorage.setItem('quiz_latest_system_notice', JSON.stringify({
                id: noticeId,
                message: cleanMsg,
                targetIp: targetIp,
                timestamp: Date.now()
            }));
        } catch (e) {}

        // 2. Gửi lên Supabase Cloud để đồng bộ xuống mọi máy học sinh
        if (this.isSupabaseActive && this.client) {
            try {
                const { error } = await this.client
                    .from('quiz_logins')
                    .insert([noticeData]);
                if (error) {
                    console.error("[DatabaseService] Lỗi gửi thông báo lên Supabase:", error);
                    return { success: false, error: error.message };
                }
            } catch (e) {
                console.error("[DatabaseService] Exception gửi thông báo:", e);
                return { success: false, error: e.message };
            }
        }

        return { success: true, message: cleanMsg, targetIp: targetIp };
    }

    /**
     * Kiểm tra thông báo mới nhất từ Giám thị
     */
    async fetchLatestNotice(clientIp) {
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('*')
                    .eq('player_name', '__SYSTEM_NOTICE__')
                    .order('last_active', { ascending: false })
                    .limit(5);

                if (!error && data && data.length > 0) {
                    const match = data.find(item => item.ip_address === 'ALL' || (clientIp && item.ip_address === clientIp));
                    if (match && match.score_summary) {
                        return {
                            id: match.id,
                            message: match.score_summary,
                            targetIp: match.ip_address,
                            timestamp: new Date(match.last_active || match.created_at).getTime()
                        };
                    }
                }
            } catch (e) {
                console.warn("[DatabaseService] Lỗi kiểm tra thông báo:", e);
            }
        }

        // Fallback LocalStorage
        try {
            const raw = localStorage.getItem('quiz_latest_system_notice');
            if (raw) {
                return JSON.parse(raw);
            }
        } catch (e) {}

        return null;
    }

    // =========================================================================
    // PHẦN 5: QUẢN LÝ DANH SÁCH IP ĐƯỢC MỞ MÔN ĐỊA LÍ (IP WHITELIST)
    // =========================================================================

    /**
     * Lấy cấu hình phân quyền môn Địa Lí (Chế độ PUBLIC/PRIVATE và danh sách IP)
     */
    async fetchGeoConfig() {
        let mode = 'PRIVATE';
        let ips = [];

        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('device_info, score_summary')
                    .eq('id', '00000000-0000-0000-0000-000000000002')
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
                            }
                        } catch (e) {}
                    }
                    try {
                        localStorage.setItem('quiz_geo_mode', mode);
                        localStorage.setItem('quiz_allowed_geo_ips', JSON.stringify(ips));
                    } catch (e) {}
                    return { mode, ips };
                }
            } catch (e) {
                console.warn("[DatabaseService] Lỗi lấy cấu hình phân quyền môn Địa:", e);
            }
        }

        // Fallback localStorage
        try {
            mode = localStorage.getItem('quiz_geo_mode') || 'PRIVATE';
            const raw = localStorage.getItem('quiz_allowed_geo_ips');
            ips = raw ? JSON.parse(raw) : [];
        } catch (e) {}

        return { mode, ips };
    }

    /**
     * Lưu cấu hình phân quyền môn Địa Lí (Chế độ và danh sách IP)
     */
    async saveGeoConfig(mode = 'PRIVATE', ipList = []) {
        const cleanMode = (mode === 'PUBLIC') ? 'PUBLIC' : 'PRIVATE';
        const cleanList = Array.isArray(ipList) ? [...new Set(ipList.map(ip => String(ip).trim()).filter(Boolean))] : [];

        try {
            localStorage.setItem('quiz_geo_mode', cleanMode);
            localStorage.setItem('quiz_allowed_geo_ips', JSON.stringify(cleanList));
        } catch (e) {}

        if (this.isSupabaseActive && this.client) {
            try {
                await this.client
                    .from('quiz_logins')
                    .upsert([{
                        id: '00000000-0000-0000-0000-000000000002',
                        player_name: '__ALLOWED_GEO_IPS__',
                        ip_address: 'SYSTEM',
                        device_info: cleanMode,
                        status: 'ACTIVE',
                        score_summary: JSON.stringify({ mode: cleanMode, ips: cleanList }),
                        last_active: new Date().toISOString()
                    }], { onConflict: 'id' });
            } catch (e) {
                console.error("[DatabaseService] Lỗi lưu cấu hình phân quyền môn Địa lên Supabase:", e);
            }
        }

        return { mode: cleanMode, ips: cleanList };
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

    /**
     * Cập nhật trạng thái Chế độ Bảo trì (Bật/Tắt & Lời nhắn) lên Supabase Cloud hoặc LocalStorage
     */
    async setMaintenanceStatus(isActive, message = "Trang web đang tạm dừng để cập nhật đề cương và dữ liệu mới. Vui lòng quay lại sau!") {
        const cleanActive = !!isActive;
        const cleanMsg = (message || "").trim() || "Trang web đang tạm dừng để cập nhật đề cương và dữ liệu mới. Vui lòng quay lại sau!";
        const nowIso = new Date().toISOString();

        try {
            localStorage.setItem('quiz_maintenance_mode', cleanActive ? 'true' : 'false');
            localStorage.setItem('quiz_maintenance_msg', cleanMsg);
        } catch (e) {}

        if (this.isSupabaseActive && this.client) {
            try {
                await this.client
                    .from('quiz_logins')
                    .upsert([{
                        id: '00000000-0000-0000-0000-000000000003',
                        player_name: '__SYSTEM_MAINTENANCE__',
                        ip_address: 'SYSTEM',
                        device_info: cleanActive ? 'ON' : 'OFF',
                        status: cleanActive ? 'ACTIVE' : 'INACTIVE',
                        score_summary: cleanMsg,
                        last_active: nowIso
                    }], { onConflict: 'id' });
            } catch (e) {
                console.error("[DatabaseService] Lỗi cập nhật trạng thái bảo trì lên Supabase:", e);
            }
        }

        return { isActive: cleanActive, message: cleanMsg };
    }

    /**
     * Kiểm tra trạng thái Chế độ Bảo trì hiện tại để các máy học sinh đọc được
     */
    async checkMaintenanceStatus() {
        let isActive = false;
        let message = "Trang web đang tạm dừng để cập nhật đề cương và dữ liệu mới. Vui lòng quay lại sau!";

        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('device_info, status, score_summary, last_active')
                    .eq('id', '00000000-0000-0000-0000-000000000003')
                    .limit(1);

                if (!error && data && data.length > 0) {
                    const row = data[0];
                    isActive = (row.status === 'ACTIVE' || row.device_info === 'ON');
                    if (row.score_summary) message = row.score_summary;

                    try {
                        localStorage.setItem('quiz_maintenance_mode', isActive ? 'true' : 'false');
                        localStorage.setItem('quiz_maintenance_msg', message);
                    } catch (e) {}

                    return { isActive, message };
                }
            } catch (e) {
                console.warn("[DatabaseService] Lỗi kiểm tra bảo trì từ Supabase:", e);
            }
        }

        // Fallback LocalStorage
        try {
            isActive = localStorage.getItem('quiz_maintenance_mode') === 'true';
            const savedMsg = localStorage.getItem('quiz_maintenance_msg');
            if (savedMsg) message = savedMsg;
        } catch (e) {}

        return { isActive, message };
    }
}

window.dbService = new DatabaseService();
