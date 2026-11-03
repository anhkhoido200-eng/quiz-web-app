/**
 * supabase.js - Module quản lý kết nối cơ sở dữ liệu Supabase & LocalStorage Fallback
 * 
 * Hỗ trợ 2 chế độ:
 * 1. Supabase Mode (Cloud Database): Đồng bộ điểm số qua mạng cho mọi người dùng
 * 2. LocalStorage Mode: Tự động kích hoạt khi chưa có key Supabase để kiểm thử offline mượt mà
 */

const STORAGE_KEYS = {
    SUPABASE_URL: 'quiz_supabase_url',
    SUPABASE_KEY: 'quiz_supabase_key',
    LOCAL_LEADERBOARD: 'quiz_local_leaderboard'
};

// Cấu hình mặc định của dự án Supabase
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

    /**
     * Khởi tạo kết nối Supabase từ LocalStorage hoặc hằng số mặc định
     */
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
                console.warn("[DatabaseService] Lỗi khởi tạo Supabase client, chuyển về chế độ LocalStorage:", err);
                this.client = null;
                this.isSupabaseActive = false;
            }
        } else {
            this.client = null;
            this.isSupabaseActive = false;
            console.log("%c[DatabaseService] Đang chạy chế độ lưu trữ trình duyệt (LocalStorage)", "color: #f59e0b;");
        }
    }

    /**
     * Lưu cấu hình URL và Anon Key mới vào LocalStorage
     */
    saveConfig(url, anonKey) {
        if (!url || !anonKey) {
            throw new Error("Vui lòng nhập đầy đủ Project URL và Anon Public Key.");
        }
        localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, formatSupabaseUrl(url));
        localStorage.setItem(STORAGE_KEYS.SUPABASE_KEY, anonKey.trim());
        this.init();
    }

    /**
     * Xóa cấu hình Supabase để quay lại dùng LocalStorage
     */
    clearConfig() {
        localStorage.removeItem(STORAGE_KEYS.SUPABASE_URL);
        localStorage.removeItem(STORAGE_KEYS.SUPABASE_KEY);
        this.init();
    }

    /**
     * Lấy thông tin cấu hình hiện tại
     */
    getConfig() {
        return {
            url: localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || DEFAULT_SUPABASE_CONFIG.url,
            anonKey: localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY) || DEFAULT_SUPABASE_CONFIG.anonKey,
            isActive: this.isSupabaseActive
        };
    }

    /**
     * Lưu kết quả làm bài của thí sinh
     * @param {Object} resultData - { playerName, score, correctCount, totalQuestions, timeSpentSeconds }
     */
    async saveResult(resultData) {
        const payload = {
            player_name: resultData.playerName.trim(),
            score: resultData.score,
            correct_count: resultData.correctCount,
            total_questions: resultData.totalQuestions,
            time_spent_seconds: resultData.timeSpentSeconds,
            created_at: new Date().toISOString()
        };

        // Nếu có Supabase
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_results')
                    .insert([payload])
                    .select();

                if (error) {
                    console.error("[DatabaseService] Lỗi khi lưu lên Supabase:", error);
                    // Lưu dự phòng vào LocalStorage
                    this._saveToLocalStorage(payload);
                    return { success: false, fallback: true, error: error.message };
                }
                return { success: true, data: data[0] };
            } catch (error) {
                console.error("[DatabaseService] Ngoại lệ khi đẩy dữ liệu lên Supabase:", error);
                this._saveToLocalStorage(payload);
                return { success: false, fallback: true, error: error.message };
            }
        } else {
            // Chế độ LocalStorage
            this._saveToLocalStorage(payload);
            return { success: true, local: true };
        }
    }

    /**
     * Lấy danh sách bảng xếp hạng (Top điểm cao nhất, nếu bằng điểm thì ưu tiên thời gian ít hơn)
     * @param {number} limit - Số lượng thí sinh hiển thị tối đa (mặc định 50)
     */
    async getLeaderboard(limit = 50) {
        if (this.isSupabaseActive && this.client) {
            try {
                const { data, error } = await this.client
                    .from('quiz_results')
                    .select('*')
                    .order('score', { ascending: false })
                    .order('time_spent_seconds', { ascending: true })
                    .limit(limit);

                if (error) {
                    console.warn("[DatabaseService] Không thể đọc bảng xếp hạng từ Supabase, chuyển sang đọc LocalStorage:", error);
                    return this._getFromLocalStorage();
                }
                return data || [];
            } catch (err) {
                console.warn("[DatabaseService] Lỗi mạng khi gọi Supabase:", err);
                return this._getFromLocalStorage();
            }
        } else {
            return this._getFromLocalStorage();
        }
    }

    /**
     * Helper: Lưu vào LocalStorage
     */
    _saveToLocalStorage(item) {
        const list = this._getFromLocalStorage();
        // Gán id giả lập ngẫu nhiên
        item.id = 'local_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        list.push(item);
        // Sắp xếp: Điểm cao trước, thời gian ngắn trước
        list.sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return a.time_spent_seconds - b.time_spent_seconds;
        });
        localStorage.setItem(STORAGE_KEYS.LOCAL_LEADERBOARD, JSON.stringify(list.slice(0, 100)));
    }

    /**
     * Helper: Lấy danh sách từ LocalStorage
     */
    _getFromLocalStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_LEADERBOARD);
            if (!raw) return [];
            return JSON.parse(raw);
        } catch (e) {
            return [];
        }
    }
}

// Khởi tạo đối tượng dùng chung
window.dbService = new DatabaseService();
