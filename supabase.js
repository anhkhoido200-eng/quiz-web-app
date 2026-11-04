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
    DYNAMIC_SUBJECTS: '00000000-0000-0000-0000-000000000004'
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

        // 1. Lưu LocalStorage tức thì
        try {
            localStorage.setItem('quiz_saved_player_name', cleanName);
            localStorage.setItem('quiz_saved_ip', cleanIp);
            if (cleanIp !== "Chưa xác định") {
                localStorage.setItem(`quiz_ip_map_${cleanIp}`, cleanName);
            }

            let localLogs = this._getLocalLogins();
            record.id = 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            localLogs.unshift(record);
            localStorage.setItem(STORAGE_KEYS.LOCAL_LOGINS, JSON.stringify(localLogs.slice(0, 100)));
        } catch (e) {}

        // 2. Lưu Supabase Cloud cho Admin giám sát
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
                    .select('id');

                if (!error && inserted && inserted[0]) {
                    return inserted[0].id;
                }
            } catch (err) {
                console.warn("[DatabaseService] Lỗi ghi nhận đăng nhập lên Supabase:", err);
            }
        }

        return record.id;
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
            try {
                await this.client
                    .from('quiz_logins')
                    .update({
                        status: statusText,
                        score_summary: scoreText,
                        last_active: nowIso
                    })
                    .eq('id', loginId);
            } catch (e) {}
        }
    }

    /**
     * Lấy danh sách máy & người đăng nhập cho Admin (Mặc định tải 300 lượt)
     */
    async getLoginHistory(limit = 300) {
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_logins')
                    .select('*')
                    .order('last_active', { ascending: false })
                    .limit(limit);

                if (!error && Array.isArray(data)) {
                    // Lọc bỏ toàn bộ các bản ghi hệ thống nội bộ (__...)
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
            try {
                await this.client.from('quiz_logins').delete().eq('id', loginId);
            } catch (e) {}
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
            try {
                await this.client
                    .from('quiz_logins')
                    .delete()
                    .not('player_name', 'like', '__%');
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

                if (!error && data && data.length > 0) {
                    return data.map(row => ({
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
            } catch (err) {
                console.warn("[DatabaseService] Lỗi fetch questions từ Supabase:", err);
            }
        }

        // Cache cục bộ
        const cached = localStorage.getItem(`${STORAGE_KEYS.CUSTOM_QUESTIONS}_${subjectKey}`);
        if (cached) return JSON.parse(cached);
        return [];
    }

    /**
     * Lưu/Cập nhật 1 câu hỏi lên Supabase
     */
    async saveQuestion(qObj, subjectKey = 'history') {
        const record = {
            subject_key: qObj.subjectKey || subjectKey || 'history',
            category: qObj.category || 'Bài học',
            q_type: qObj.qType || 'mcq',
            question: qObj.question,
            options: qObj.options || [],
            statements: qObj.statements || [],
            correct: qObj.correct !== undefined ? qObj.correct : (qObj.answer || 0),
            answer: qObj.correct !== undefined ? qObj.correct : (qObj.answer || 0),
            correct_value: qObj.correctValue || '',
            explanation: qObj.explanation || '',
            image_url: qObj.imageUrl || '',
            updated_at: new Date().toISOString()
        };

        if (qObj.id && Number.isInteger(Number(qObj.id))) {
            record.id = Number(qObj.id);
        }

        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_questions')
                    .upsert([record])
                    .select();

                if (!error && data && data.length > 0) {
                    return { success: true, item: data[0] };
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
     */
    async saveQuestionsBulk(questionsList, subjectKey = 'history') {
        if (!Array.isArray(questionsList) || questionsList.length === 0) {
            return { success: false, count: 0, error: "Danh sách câu hỏi rỗng." };
        }

        const cleanSubject = subjectKey || 'history';
        const records = questionsList.map((q, idx) => ({
            subject_key: cleanSubject,
            category: q.category || 'Bài tập',
            q_type: q.qType || 'mcq',
            question: q.question,
            options: q.options || [],
            statements: q.statements || [],
            correct: q.correct !== undefined ? q.correct : (q.answer || 0),
            answer: q.correct !== undefined ? q.correct : (q.answer || 0),
            correct_value: q.correctValue || '',
            explanation: q.explanation || '',
            image_url: q.imageUrl || '',
            updated_at: new Date().toISOString()
        }));

        if (this.isSupabaseActive && this.client) {
            try {
                // Chia nhỏ chunk 50 câu để tránh quá tải payload
                const chunkSize = 50;
                let insertedCount = 0;
                for (let i = 0; i < records.length; i += chunkSize) {
                    const chunk = records.slice(i, i + chunkSize);
                    const { data, error } = await this.client
                        .from('quiz_questions')
                        .insert(chunk)
                        .select('id');
                    if (error) throw error;
                    insertedCount += (data ? data.length : chunk.length);
                }
                return { success: true, count: insertedCount };
            } catch (e) {
                console.error("[DatabaseService] Lỗi bulk insert câu hỏi:", e);
                return { success: false, count: 0, error: e.message };
            }
        }

        // Lưu local
        localStorage.setItem(`${STORAGE_KEYS.CUSTOM_QUESTIONS}_${cleanSubject}`, JSON.stringify(questionsList));
        return { success: true, count: questionsList.length, localOnly: true };
    }

    /**
     * Xóa 1 câu hỏi theo ID
     */
    async deleteQuestion(qId) {
        if (this.isSupabaseActive && this.client && qId) {
            try {
                await this.client.from('quiz_questions').delete().eq('id', qId);
                return true;
            } catch (e) {}
        }
        return false;
    }

    /**
     * Xóa toàn bộ câu hỏi của một môn học
     */
    async clearQuestionsBySubject(subjectKey) {
        if (this.isSupabaseActive && this.client && subjectKey) {
            try {
                await this.client.from('quiz_questions').delete().eq('subject_key', subjectKey);
                return true;
            } catch (e) {}
        }
        return false;
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

    // =========================================================================
    // PHẦN 4: PHÁT THÔNG BÁO THỜI GIAN THỰC CHO THÍ SINH (5 GIÂY)
    // =========================================================================

    /**
     * Giám thị phát thông báo cho toàn phòng hoặc riêng 1 IP
     */
    async sendBroadcastNotice(message, targetIp = 'ALL') {
        const cleanMsg = (message || "").trim();
        if (!cleanMsg) return { success: false, error: 'Nội dung thông báo không được để trống.' };

        const nowIso = new Date().toISOString();
        const noticeId = this.generateUUID();

        const record = {
            id: noticeId,
            player_name: '__SYSTEM_NOTICE__',
            ip_address: targetIp,
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
                targetIp: targetIp,
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

        return { success: true, id: noticeId, message: cleanMsg, targetIp: targetIp };
    }

    /**
     * Máy học sinh lắng nghe thông báo mới nhất
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
            } catch (e) {}
        }

        try {
            const raw = localStorage.getItem('quiz_latest_system_notice');
            if (raw) {
                const n = JSON.parse(raw);
                if (n.targetIp === 'ALL' || (clientIp && n.targetIp === clientIp)) {
                    return n;
                }
            }
        } catch (e) {}

        return null;
    }

    // =========================================================================
    // PHẦN 5: PHÂN QUYỀN & CHẾ ĐỘ MÔN ĐỊA LÍ 11
    // =========================================================================

    async fetchGeoConfig() {
        let mode = 'PUBLIC';
        let ips = [];

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

        try {
            mode = localStorage.getItem('quiz_geo_mode') || 'PUBLIC';
            const raw = localStorage.getItem('quiz_allowed_geo_ips');
            ips = raw ? JSON.parse(raw) : [];
        } catch (e) {}

        return { mode, ips };
    }

    async saveGeoConfig(mode = 'PUBLIC', ipList = []) {
        const cleanMode = (mode === 'PRIVATE') ? 'PRIVATE' : 'PUBLIC';
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
                        id: SYSTEM_RECORDS.GEO_CONFIG,
                        player_name: '__ALLOWED_GEO_IPS__',
                        ip_address: 'SYSTEM',
                        device_info: cleanMode,
                        status: 'ACTIVE',
                        score_summary: JSON.stringify({ mode: cleanMode, ips: cleanList }),
                        last_active: new Date().toISOString()
                    }], { onConflict: 'id' });
            } catch (e) {
                console.error("[DatabaseService] Lỗi lưu cấu hình môn Địa:", e);
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
                                allowedIps = Array.isArray(parsed.allowedIps) ? parsed.allowedIps : [];
                            }
                        } catch (e) {}
                    }
                    try {
                        localStorage.setItem(STORAGE_KEYS.ADMIN_IPS_CONFIG, JSON.stringify({ masterIp, allowedIps }));
                    } catch (e) {}
                    return { masterIp, allowedIps };
                }
            } catch (e) {
                console.warn("[DatabaseService] Lỗi tải cấu hình Admin IPs:", e);
            }
        }

        try {
            const raw = localStorage.getItem(STORAGE_KEYS.ADMIN_IPS_CONFIG);
            if (raw) return JSON.parse(raw);
        } catch (e) {}

        return { masterIp, allowedIps };
    }

    /**
     * Lưu cấu hình Whitelist IP Admin lên Supabase Cloud & LocalStorage
     */
    async saveAdminIpsConfig(config) {
        const masterIp = (config && config.masterIp) ? String(config.masterIp).trim() : "";
        const allowedIps = (config && Array.isArray(config.allowedIps)) ? config.allowedIps : [];
        const payloadStr = JSON.stringify({ masterIp, allowedIps });
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

        return { masterIp, allowedIps };
    }

    /**
     * Thêm một IP vào danh sách Admin
     */
    async addAdminIp(ip, name = "Admin", isMaster = false) {
        const cleanIp = (ip || "").trim();
        if (!cleanIp || cleanIp === "Chưa xác định") return false;

        const config = await this.fetchAdminIpsConfig();
        const existingIdx = config.allowedIps.findIndex(item => item.ip === cleanIp);

        if (existingIdx !== -1) {
            config.allowedIps[existingIdx].name = name || config.allowedIps[existingIdx].name;
            if (isMaster) config.allowedIps[existingIdx].isMaster = true;
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

        config.allowedIps = config.allowedIps.filter(item => item.ip !== cleanIp);
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
        return config.allowedIps.some(item => item.ip === cleanIp);
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
                await this.client
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
            } catch (e) {
                console.error("[DatabaseService] Lỗi lưu môn học động:", e);
            }
        }

        return cleanList;
    }

    async addDynamicSubject(subjectObj) {
        if (!subjectObj || !subjectObj.key || !subjectObj.title) {
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

    async deleteDynamicSubject(subjectKey) {
        if (!subjectKey) return;
        let subjects = await this.fetchDynamicSubjects();
        subjects = subjects.filter(s => s.key !== subjectKey);
        await this.clearQuestionsBySubject(subjectKey);
        return await this.saveDynamicSubjects(subjects);
    }

    // =========================================================================
    // PHẦN 9: BẢNG XẾP HẠNG (LEADERBOARD) & XUẤT BẢNG ĐIỂM EXCEL
    // =========================================================================

    /**
     * Lấy dữ liệu Bảng Xếp Hạng Top N học sinh điểm cao & nhanh nhất
     */
    async fetchLeaderboard(subjectKey = '', limit = 10) {
        const logins = await this.getLoginHistory(350);
        // Lọc các bản ghi đã nộp bài
        const submitted = logins.filter(item => {
            const status = (item.status || "").toLowerCase();
            const summary = (item.score_summary || "").toLowerCase();
            const isFinished = status.includes("đã nộp") || status.includes("hoàn thành") || summary.includes("điểm");
            if (!isFinished) return false;

            if (subjectKey) {
                const combined = status + " " + summary;
                if (subjectKey === 'geography' && (combined.includes('địa') || combined.includes('/67'))) return true;
                if (subjectKey === 'physics' && (combined.includes('lí') || combined.includes('vật') || combined.includes('/52') || combined.includes('/43'))) return true;
                if (subjectKey === 'history' && (combined.includes('sử') || combined.includes('/101') || combined.includes('/74'))) return true;
                if (combined.includes(subjectKey.toLowerCase())) return true;
                return false;
            }
            return true;
        });

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

            return {
                id: item.id,
                playerName: item.player_name || "Thí sinh ẩn danh",
                ipAddress: item.ip_address || "Chưa rõ",
                deviceInfo: item.device_info || "Trình duyệt",
                score: score,
                correctCount: correctCount,
                totalCount: totalCount,
                status: item.status,
                scoreSummary: item.score_summary,
                submittedAt: item.last_active || item.created_at
            };
        });

        // Lọc trùng theo Tên + IP, chỉ giữ lượt thi điểm cao nhất
        const studentBestMap = new Map();
        parsedResults.forEach(res => {
            const key = `${res.playerName.toLowerCase().trim()}___${res.ipAddress}`;
            if (!studentBestMap.has(key) || studentBestMap.get(key).score < res.score) {
                studentBestMap.set(key, res);
            }
        });

        const uniqueResults = Array.from(studentBestMap.values());
        // Sắp xếp: Điểm cao nhất lên đầu, nếu bằng điểm thì ai nộp trước xếp trước
        uniqueResults.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
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

                let correctText = "";
                const ratioMatch = (item.score_summary || "").match(/đúng\s*(\d+\/\d+)/i);
                if (ratioMatch) correctText = ratioMatch[1];

                let timeStr = "";
                try {
                    timeStr = new Date(item.last_active || item.created_at).toLocaleString('vi-VN');
                } catch (e) {
                    timeStr = item.last_active || "";
                }

                return {
                    "Họ Và Tên": item.player_name || "Thí sinh",
                    "Địa Chỉ IP": item.ip_address || "Chưa rõ",
                    "Thiết Bị": item.device_info || "Trình duyệt",
                    "Điểm Số": score,
                    "Số Câu Đúng": correctText,
                    "Chi Tiết Kết Quả": item.score_summary || item.status,
                    "Thời Gian Nộp": timeStr
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
            try {
                await this.client
                    .from('quiz_logins')
                    .delete()
                    .not('player_name', 'like', '__%');
            } catch (e) {
                console.error("[DatabaseService] Lỗi xóa dữ liệu trên cloud:", e);
            }
        }

        // 3. Xóa LocalStorage
        localStorage.removeItem(STORAGE_KEYS.LOCAL_LOGINS);

        return backupData;
    }
}

// Khởi tạo instance Singleton toàn cục
window.dbService = new DatabaseService();
