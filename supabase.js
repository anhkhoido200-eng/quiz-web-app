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
    CUSTOM_QUESTIONS: 'quiz_custom_questions'
};

// Cấu hình mặc định của dự án Supabase (Đã được điền tự động)
const DEFAULT_SUPABASE_CONFIG = {
    url: "https://qotfikuiwmruicsvsbgq.supabase.co",
    anonKey: "sb_publishable_KtAmEX6Jj97BNElniBrX6w_wVyCeQYs"
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
                const { data: inserted, error } = await this.client
                    .from('quiz_logins')
                    .insert([{
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
    async getLoginHistory(limit = 100) {
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('*')
                    .order('last_active', { ascending: false })
                    .limit(limit);

                if (!error && data && data.length > 0) {
                    return data;
                }
            } catch (err) {
                console.warn("[DatabaseService] Lỗi khi tải quiz_logins từ Supabase:", err);
            }
        }
        return this._getLocalLogins();
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

        if (this.isSupabaseActive && this.client) {
            try {
                const { error } = await this.client
                    .from('quiz_questions')
                    .upsert([payload], { onConflict: 'id' });
                if (error) console.error("[DatabaseService] Lỗi upsert câu hỏi:", error);
            } catch (e) {
                console.error(e);
            }
        }

        this._updateLocalQuestionCache(payload);
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
        if (!this.isSupabaseActive || !this.client || !questionsList || questionsList.length === 0) return;
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

            if (error) console.error("Lỗi seed:", error);
            else console.log(`%c[DatabaseService] Đã đồng bộ ${questionsList.length} câu hỏi lên Supabase Cloud!`, "color: #10b981; font-weight: bold;");
        } catch (e) {
            console.error("Lỗi seed câu hỏi:", e);
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
}

window.dbService = new DatabaseService();
