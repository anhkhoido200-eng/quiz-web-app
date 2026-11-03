/**
 * supabase.js - Quản lý kết nối Supabase Cloud & LocalStorage Fallback
 * Hỗ trợ lưu trữ điểm số và Quản lý ngân hàng câu hỏi trực tuyến (Admin CRUD)
 */

const STORAGE_KEYS = {
    SUPABASE_URL: 'quiz_supabase_url',
    SUPABASE_KEY: 'quiz_supabase_key',
    LOCAL_LEADERBOARD: 'quiz_local_leaderboard',
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

    // ==========================================
    // PHẦN 1: QUẢN LÝ ĐIỂM SỐ & BẢNG XẾP HẠNG
    // ==========================================
    async saveResult(resultData) {
        const payload = {
            player_name: resultData.playerName.trim(),
            score: resultData.score,
            correct_count: resultData.correctCount,
            total_questions: resultData.totalQuestions,
            time_spent_seconds: resultData.timeSpentSeconds,
            created_at: new Date().toISOString()
        };

        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_results')
                    .insert([payload])
                    .select();

                if (error) {
                    console.error("[DatabaseService] Lỗi khi lưu lên Supabase:", error);
                    this._saveToLocalStorage(payload);
                    return { success: false, fallback: true, error: error.message };
                }
                return { success: true, data: data[0] };
            } catch (error) {
                this._saveToLocalStorage(payload);
                return { success: false, fallback: true, error: error.message };
            }
        } else {
            this._saveToLocalStorage(payload);
            return { success: true, local: true };
        }
    }

    async getLeaderboard(limit = 50) {
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_results')
                    .select('*')
                    .order('score', { ascending: false })
                    .order('time_spent_seconds', { ascending: true })
                    .limit(limit);

                if (error) return this._getFromLocalStorage();
                return data || [];
            } catch (err) {
                return this._getFromLocalStorage();
            }
        }
        return this._getFromLocalStorage();
    }

    async deleteResult(resultId) {
        if (this.isSupabaseActive && this.client) {
            try {
                await this.client.from('quiz_results').delete().eq('id', resultId);
            } catch (e) {}
        }
        let list = this._getFromLocalStorage().filter(item => item.id !== resultId);
        localStorage.setItem(STORAGE_KEYS.LOCAL_LEADERBOARD, JSON.stringify(list));
    }

    async clearAllResults() {
        if (this.isSupabaseActive && this.client) {
            try {
                await this.client.from('quiz_results').delete().neq('score', -999);
            } catch (e) {}
        }
        localStorage.removeItem(STORAGE_KEYS.LOCAL_LEADERBOARD);
    }

    // ==========================================
    // PHẦN 2: QUẢN LÝ CÂU HỎI TRỰC TUYẾN (ADMIN)
    // ==========================================
    async fetchQuestionsOnline() {
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_questions')
                    .select('*')
                    .order('id', { ascending: true });

                if (!error && data && data.length > 0) {
                    // Chuẩn hóa dữ liệu từ Supabase
                    return data.map(q => ({
                        id: Number(q.id),
                        category: q.category,
                        question: q.question,
                        options: Array.isArray(q.options) ? q.options : JSON.parse(q.options || "[]"),
                        correct: Number(q.correct),
                        isMultiple: false,
                        explanation: q.explanation || ""
                    }));
                }
            } catch (err) {
                console.warn("[DatabaseService] Lỗi khi tải câu hỏi từ Supabase:", err);
            }
        }
        // Fallback: Đọc từ local cache nếu có
        try {
            const cached = localStorage.getItem(STORAGE_KEYS.CUSTOM_QUESTIONS);
            if (cached) return JSON.parse(cached);
        } catch (e) {}

        // Mặc định trả về từ file questions.js
        return window.QUIZ_QUESTIONS || [];
    }

    async saveQuestion(qObj) {
        const payload = {
            id: Number(qObj.id),
            category: qObj.category || 'Lịch Sử 11',
            question: qObj.question.trim(),
            options: qObj.options,
            correct: Number(qObj.correct),
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

        // Đồng bộ vào local cache
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
                category: q.category || 'Lịch Sử 11',
                question: q.question,
                options: q.options,
                correct: Number(q.correct),
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

    // Helper nội bộ
    _saveToLocalStorage(item) {
        const list = this._getFromLocalStorage();
        item.id = 'local_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        list.push(item);
        list.sort((a, b) => b.score !== a.score ? b.score - a.score : a.time_spent_seconds - b.time_spent_seconds);
        localStorage.setItem(STORAGE_KEYS.LOCAL_LEADERBOARD, JSON.stringify(list.slice(0, 100)));
    }

    _getFromLocalStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_LEADERBOARD);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
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
