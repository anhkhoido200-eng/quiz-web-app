/**
 * app.js - Logic điều phối ứng dụng trắc nghiệm Đa Môn (Lịch Sử 11 & Vật Lí 11)
 * Chế độ:
 * 1. Hỗ trợ đa môn học: Lịch Sử 11 (74 câu) & Vật Lí 11 (43 câu: Đầy đủ 3 phần trắc nghiệm + Đúng Sai + Điền số)
 * 2. Tự động nhận diện thiết bị & địa chỉ IP để học sinh không cần nhập lại tên cũ
 * 3. Cuộn dọc liên tục, Phản hồi đáp án tức thì (Instant Feedback), Không xáo trộn đáp án
 * 4. Nút "Làm lại từ đầu" (Reset toàn bộ đáp án và cuộn về đầu trang)
 * 5. Bảng Admin giám sát máy và thí sinh đăng nhập thời gian thực
 * 6. Cập nhật trực tiếp ngân hàng câu hỏi bằng quyền Admin
 */

class QuizApp {
    constructor() {
        // Môn học hiện tại
        this.currentSubject = 'history'; // 'history' hoặc 'physics'

        // Thông tin người học & Thiết bị & IP
        this.playerName = "";
        this.clientIp = "Đang nhận diện...";
        this.deviceInfo = this.detectDevice();
        this.currentLoginId = null;

        // Đồng hồ bấm giờ (đếm tiến)
        this.secondsElapsed = 0;
        this.timerInterval = null;

        // Dữ liệu câu hỏi & Trạng thái làm bài
        this.allQuestions = this.normalizeQuestions(window.QUIZ_QUESTIONS ? [...window.QUIZ_QUESTIONS] : []);
        this.userAnswers = {};      // { [qId]: selectedIndex hoặc { [stmtIdx]: boolean } hoặc string }
        this.currentFilter = 'all';

        // Quyền quản trị Admin & Danh sách IP mở môn Địa
        this.isAdminAuthenticated = false;
        this.adminCurrentTab = 'questions';
        this.adminSecretPass = '034569';
        this.allowedGeoIps = [];
        this.geoMode = 'PRIVATE';

        // Cache màn hình
        this.screens = {
            home: document.getElementById('screen-home'),
            quiz: document.getElementById('screen-quiz'),
            result: document.getElementById('screen-result')
        };

        this.init();
    }

    /**
     * Chuẩn hóa dữ liệu câu hỏi (đảm bảo luôn có cả correct và answer hợp lệ)
     */
    normalizeQuestions(list) {
        if (!Array.isArray(list)) return [];
        return list.map(q => {
            if (q.qType !== 'short_answer' && q.qType !== 'tf_group' && q.qType !== 'essay') {
                const c = q.correct !== undefined ? q.correct : q.answer;
                q.correct = c;
                q.answer = c;
            }
            return q;
        });
    }

    async init() {
        this.initEventListeners();
        this.displayDeviceInfo();
        this.checkSavedUser();
        await this.fetchClientIp();
        this.renderFilterTabs();
        await this.loadQuestionsFromDb();
        this.updateTotalQuestionDisplay();
        await this.refreshGeographyAccess();
        this.startRealtimeBanChecker();
    }

    getSubjectTitle() {
        if (this.currentSubject === 'physics') return 'Vật Lí 11';
        if (this.currentSubject === 'geography') return 'Địa Lí 11';
        return 'Lịch Sử 11';
    }

    /**
     * Chuyển đổi môn học ôn tập (Lịch Sử 11 / Vật Lí 11 / Địa Lí 11)
     */
    selectSubject(subj) {
        if (subj === this.currentSubject) return;
        this.currentSubject = subj;

        const btnHistory = document.getElementById('tab-btn-history');
        const btnPhysics = document.getElementById('tab-btn-physics');
        const btnGeography = document.getElementById('tab-btn-geography');
        const titleEl = document.getElementById('navbar-subject-title');
        const subTitleEl = document.getElementById('navbar-subject-subtitle');
        const badgeEl = document.getElementById('home-subject-badge');

        const resetBtn = (btn) => {
            if (!btn) return;
            btn.className = "p-2.5 sm:p-3 rounded-xl border transition-all text-left flex items-center gap-2.5 cursor-pointer bg-slate-800/80 border-slate-700 hover:border-slate-600 text-slate-300";
        };
        resetBtn(btnHistory);
        resetBtn(btnPhysics);
        resetBtn(btnGeography);

        if (subj === 'physics') {
            if (btnPhysics) {
                btnPhysics.className = "p-2.5 sm:p-3 rounded-xl border transition-all text-left flex items-center gap-2.5 cursor-pointer bg-purple-600/25 border-purple-500 text-white shadow-md shadow-purple-600/20";
            }
            if (titleEl) titleEl.textContent = "Vật Lí 11";
            if (subTitleEl) subTitleEl.textContent = "Đề Cương Ôn Thi Giữa Kì 1 (43 câu / 52 ý)";
            if (badgeEl) badgeEl.textContent = "Vật Lí 11 (43 câu / 52 ý)";

            this.allQuestions = this.normalizeQuestions(window.PHYSICS_QUESTIONS ? [...window.PHYSICS_QUESTIONS] : []);
        } else if (subj === 'geography') {
            if (btnGeography) {
                btnGeography.className = "p-2.5 sm:p-3 rounded-xl border transition-all text-left flex items-center gap-2.5 cursor-pointer bg-emerald-600/25 border-emerald-500 text-white shadow-md shadow-emerald-600/20";
            }
            if (titleEl) titleEl.textContent = "Địa Lí 11";
            if (subTitleEl) subTitleEl.textContent = "Đề Cương Ôn Thi Giữa Kì 1 (52 câu trắc nghiệm & 4 câu tự luận)";
            if (badgeEl) badgeEl.textContent = "Địa Lí 11 (52 câu / 67 ý)";

            this.allQuestions = this.normalizeQuestions(window.GEOGRAPHY_QUESTIONS ? [...window.GEOGRAPHY_QUESTIONS] : []);
        } else {
            if (btnHistory) {
                btnHistory.className = "p-2.5 sm:p-3 rounded-xl border transition-all text-left flex items-center gap-2.5 cursor-pointer bg-indigo-600/25 border-indigo-500 text-white shadow-md shadow-indigo-600/20";
            }
            if (titleEl) titleEl.textContent = "Lịch Sử 11";
            if (subTitleEl) subTitleEl.textContent = "Đề Cương Ôn Thi Giữa Kì 1 (74 câu / 101 ý)";
            if (badgeEl) badgeEl.textContent = "Lịch Sử 11 (74 câu / 101 ý)";

            this.allQuestions = this.normalizeQuestions(window.QUIZ_QUESTIONS ? [...window.QUIZ_QUESTIONS] : []);
        }

        const topSubjTitle = document.getElementById('quiz-top-subject-title');
        if (topSubjTitle) {
            topSubjTitle.textContent = this.getSubjectTitle();
        }

        // Cập nhật trạng thái môn học của học sinh lên Supabase ngay khi đổi tab
        if (window.dbService && this.currentLoginId) {
            window.dbService.updateLoginStatus(this.currentLoginId, `[${this.getSubjectTitle()}] Đang làm bài`, '');
        }

        this.userAnswers = {};
        this.currentFilter = 'all';
        this.updateTotalQuestionDisplay();
        this.renderFilterTabs();
        this.renderAllQuestions();
        this.renderAdminQuestionsList();
    }

    renderFilterTabs() {
        const container = document.getElementById('quiz-filter-tabs-container');
        if (!container) return;

        let tabsHtml = '';
        if (this.currentSubject === 'physics') {
            tabsHtml = `
                <span class="text-slate-500 text-[11px] font-semibold mr-1">Lọc:</span>
                <button onclick="app.filterQuestions('all')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-indigo-600 text-white cursor-pointer" data-filter="all">Tất cả (43)</button>
                <button onclick="app.filterQuestions('dao_dong')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer" data-filter="dao_dong">Dao động cơ</button>
                <button onclick="app.filterQuestions('song_co')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer" data-filter="song_co">Sóng cơ</button>
                <button onclick="app.filterQuestions('mcq')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer" data-filter="mcq">4 lựa chọn (31)</button>
                <button onclick="app.filterQuestions('tf')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-amber-300 cursor-pointer" data-filter="tf">Đúng - Sai (3)</button>
                <button onclick="app.filterQuestions('short')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-purple-300 cursor-pointer" data-filter="short">Điền số (9)</button>
            `;
        } else if (this.currentSubject === 'geography') {
            tabsHtml = `
                <span class="text-slate-500 text-[11px] font-semibold mr-1">Lọc:</span>
                <button onclick="app.filterQuestions('all')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-emerald-600 text-white cursor-pointer" data-filter="all">Tất cả (52)</button>
                <button onclick="app.filterQuestions('geo_b1')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer" data-filter="geo_b1">Bài 1: KT-XH (6)</button>
                <button onclick="app.filterQuestions('geo_b2')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer" data-filter="geo_b2">Bài 2: Toàn cầu hóa (6)</button>
                <button onclick="app.filterQuestions('geo_b4')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer" data-filter="geo_b4">Bài 4: An ninh (10)</button>
                <button onclick="app.filterQuestions('geo_latin')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer" data-filter="geo_latin">Mỹ Latinh (17)</button>
                <button onclick="app.filterQuestions('mcq')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer" data-filter="mcq">4 lựa chọn (39)</button>
                <button onclick="app.filterQuestions('tf')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-amber-300 cursor-pointer" data-filter="tf">Đúng - Sai (5)</button>
                <button onclick="app.filterQuestions('short')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-teal-300 cursor-pointer" data-filter="short">Điền số (8)</button>
                <button onclick="app.openGeographyEssayModal()" class="filter-tab-btn px-3 py-1 rounded-full font-bold transition bg-emerald-700/90 hover:bg-emerald-600 text-emerald-100 cursor-pointer flex items-center gap-1.5 shadow-sm"><i class="fa-solid fa-book-open text-xs"></i> Dàn ý Tự luận (4 câu)</button>
            `;
        } else {
            tabsHtml = `
                <span class="text-slate-500 text-[11px] font-semibold mr-1">Lọc:</span>
                <button onclick="app.filterQuestions('all')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-indigo-600 text-white cursor-pointer" data-filter="all">Tất cả (74)</button>
                <button onclick="app.filterQuestions('b1')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer" data-filter="b1">Bài 1: CM Tư Sản (35)</button>
                <button onclick="app.filterQuestions('b2')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer" data-filter="b2">Bài 2: Sự xác lập CNTB (39)</button>
                <button onclick="app.filterQuestions('mcq')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer" data-filter="mcq">4 lựa chọn (65)</button>
                <button onclick="app.filterQuestions('tf')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-amber-300 cursor-pointer" data-filter="tf">Đúng - Sai (9)</button>
            `;
        }
        container.innerHTML = tabsHtml;
    }

    /**
     * Nhận diện hệ điều hành và trình duyệt của người dùng
     */
    detectDevice() {
        const ua = navigator.userAgent || "";
        let os = "Thiết bị khác";
        if (/Windows NT/i.test(ua)) os = "Máy tính Windows";
        else if (/Macintosh|Mac OS/i.test(ua)) os = "Máy Mac (macOS)";
        else if (/iPhone/i.test(ua)) os = "Điện thoại iPhone (iOS)";
        else if (/iPad/i.test(ua)) os = "Máy tính bảng iPad";
        else if (/Android/i.test(ua)) os = "Điện thoại Android";
        else if (/Linux/i.test(ua)) os = "Hệ thống Linux";

        let browser = "Trình duyệt";
        if (/Edg\//i.test(ua)) browser = "Edge";
        else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = "Chrome";
        else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";
        else if (/Firefox\//i.test(ua)) browser = "Firefox";
        else if (/CocCoc/i.test(ua)) browser = "Cốc Cốc";

        return `${os} • ${browser}`;
    }

    displayDeviceInfo() {
        const el = document.getElementById('user-device-display');
        if (el) el.textContent = this.deviceInfo;
    }

    /**
     * Lấy địa chỉ IP công khai của thí sinh qua API
     */
    async fetchClientIp() {
        const ipDisplay = document.getElementById('user-ip-display');
        try {
            const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3500) });
            if (res.ok) {
                const data = await res.json();
                if (data && data.ip) {
                    this.clientIp = data.ip;
                }
            }
        } catch (e) {
            try {
                const res2 = await fetch('https://api64.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
                if (res2.ok) {
                    const data2 = await res2.json();
                    if (data2 && data2.ip) {
                        this.clientIp = data2.ip;
                    }
                }
            } catch (e2) {
                this.clientIp = "IP Cục Bộ";
            }
        }

        if (ipDisplay) ipDisplay.textContent = this.clientIp;

        // Nếu ô tên đang trống, tra cứu xem IP này đã từng đăng nhập trước đó chưa
        const nameInput = document.getElementById('player-name-input');
        if (nameInput && !nameInput.value.trim() && window.dbService) {
            const matched = await window.dbService.getLoginByIp(this.clientIp);
            if (matched && matched.playerName) {
                nameInput.value = matched.playerName;
                this.showSavedUserBanner(matched.playerName);
            }
        }
    }

    /**
     * Kiểm tra xem máy này đã từng lưu tên học sinh trước đó chưa (LocalStorage)
     */
    checkSavedUser() {
        const savedName = localStorage.getItem('quiz_saved_player_name');
        const nameInput = document.getElementById('player-name-input');
        if (savedName && nameInput) {
            nameInput.value = savedName;
            this.showSavedUserBanner(savedName);
        }
    }

    showSavedUserBanner(name) {
        const banner = document.getElementById('saved-user-banner');
        const nameEl = document.getElementById('saved-user-name');
        if (banner && nameEl) {
            nameEl.textContent = name;
            banner.classList.remove('hidden');
        }
    }

    clearSavedUser() {
        localStorage.removeItem('quiz_saved_player_name');
        const nameInput = document.getElementById('player-name-input');
        const banner = document.getElementById('saved-user-banner');
        if (nameInput) {
            nameInput.value = '';
            nameInput.focus();
        }
        if (banner) {
            banner.classList.add('hidden');
        }
    }

    switchUser() {
        this.clearSavedUser();
        this.switchScreen('home');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /**
     * Tải câu hỏi mới nhất từ Supabase Cloud Database (hoặc LocalStorage)
     */
    async loadQuestionsFromDb() {
        if (window.dbService && this.currentSubject === 'history') {
            try {
                const list = await window.dbService.fetchQuestionsOnline();
                if (list && list.length > 0) {
                    this.allQuestions = this.normalizeQuestions(list);
                    window.QUIZ_QUESTIONS = [...this.allQuestions];
                    this.updateTotalQuestionDisplay();
                    this.renderAllQuestions();
                    this.renderAdminQuestionsList();
                }
            } catch (e) {
                console.warn("[QuizApp] Lỗi nạp câu hỏi:", e);
            }
        }
    }

    /**
     * Gắn các sự kiện ban đầu
     */
    initEventListeners() {
        const nameInput = document.getElementById('player-name-input');
        if (nameInput) {
            nameInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.startQuiz();
                }
            });
        }

        const adminPassInput = document.getElementById('admin-pass-input');
        if (adminPassInput) {
            adminPassInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.verifyAdminPassword();
                }
            });
        }

        // Phím tắt mở Admin: Alt + A
        window.addEventListener('keydown', (e) => {
            if (e.altKey && (e.key === 'a' || e.key === 'A')) {
                e.preventDefault();
                this.promptAdminAuth();
            }
        });
    }

    updateTotalQuestionDisplay() {
        let defaultCount = 74;
        if (this.currentSubject === 'physics') defaultCount = 43;
        else if (this.currentSubject === 'geography') defaultCount = 52;
        const count = this.allQuestions ? this.allQuestions.length : defaultCount;
        const qBadge = document.getElementById('admin-badge-q-count');
        if (qBadge) qBadge.textContent = count;
    }

    /**
     * Bắt đầu bài làm
     */
    async startQuiz() {
        const nameInput = document.getElementById('player-name-input');
        const nameError = document.getElementById('player-name-error');
        const rawName = nameInput ? nameInput.value.trim() : "";

        if (!rawName) {
            if (nameError) nameError.classList.remove('hidden');
            if (nameInput) nameInput.focus();
            return;
        }

        // TÍNH NĂNG BÍ MẬT: NHẬP TÊN '034569' -> TỰ ĐỘNG CHUYỂN QUA ROLE ADMIN
        if (rawName === this.adminSecretPass || rawName.toLowerCase() === 'admin' || rawName === 'admin123') {
            if (nameInput) nameInput.value = '';
            if (nameError) nameError.classList.add('hidden');
            this.isAdminAuthenticated = true;
            this.openAdminDashboard();
            return;
        }

        if (nameError) nameError.classList.add('hidden');
        this.playerName = rawName;

        // Lưu tên học sinh để lần sau mở web không cần gõ lại
        localStorage.setItem('quiz_saved_player_name', rawName);

        // Hiển thị tên người chơi ở thanh sticky trên cùng
        const headerName = document.getElementById('quiz-header-player-name');
        if (headerName) headerName.textContent = rawName;

        const subjTitle = this.getSubjectTitle();

        // Ghi nhận lượt đăng nhập vào hệ thống Supabase Cloud (để Admin giám sát)
        if (window.dbService) {
            try {
                this.currentLoginId = await window.dbService.recordLogin({
                    playerName: rawName,
                    ipAddress: this.clientIp,
                    deviceInfo: this.deviceInfo,
                    status: `[${subjTitle}] Đang làm bài`
                });
            } catch (err) {
                console.warn("Lỗi ghi nhận đăng nhập:", err);
            }
        }

        // Reset trạng thái làm bài
        this.userAnswers = {};
        this.secondsElapsed = 0;
        this.currentFilter = 'all';

        // Bắt đầu bấm giờ
        this.startStopwatch();

        // Render toàn bộ câu hỏi thành một hàng dài cuộn dọc
        this.renderAllQuestions();
        this.updateLiveStats();

        // Chuyển sang màn hình làm bài
        this.switchScreen('quiz');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /**
     * NÚT LÀM LẠI: Reset toàn bộ đáp án đã chọn và cuộn mượt về đầu trang
     */
    resetCurrentQuiz() {
        const answeredCount = Object.keys(this.userAnswers).length;
        if (answeredCount > 0) {
            if (!confirm(`Bạn có chắc chắn muốn xóa hết ${answeredCount} câu đã làm và làm lại từ đầu không?`)) {
                return;
            }
        }

        // 1. Reset đáp án và đồng hồ
        this.userAnswers = {};
        this.secondsElapsed = 0;
        this.currentFilter = 'all';

        const timerDisplay = document.getElementById('timer-display');
        if (timerDisplay) timerDisplay.textContent = '00:00';

        // Cập nhật trạng thái trong Admin nếu có
        if (window.dbService && this.currentLoginId) {
            window.dbService.updateLoginStatus(this.currentLoginId, `Đang làm lại (${this.getSubjectTitle()})`, '');
        }

        // 2. Render lại danh sách câu hỏi sạch
        this.renderAllQuestions();
        this.updateLiveStats();

        // 3. Đảm bảo ở màn hình quiz và cuộn mượt về đầu trang
        this.switchScreen('quiz');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /**
     * Đồng hồ bấm giờ đếm tiến (Stopwatch)
     */
    startStopwatch() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        const timerDisplay = document.getElementById('timer-display');

        this.timerInterval = setInterval(() => {
            this.secondsElapsed++;
            const minutes = Math.floor(this.secondsElapsed / 60);
            const seconds = this.secondsElapsed % 60;
            if (timerDisplay) {
                timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            }
        }, 1000);
    }

    stopStopwatch() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    /**
     * NÚT TRỞ VỀ TRANG CHỦ / ĐỔI MÔN KHÁC:
     * Cho phép học sinh quay về màn hình chính để chuyển sang ôn tập môn khác
     */
    returnToHome() {
        const answeredCount = Object.keys(this.userAnswers).length;
        if (answeredCount > 0) {
            const subjName = this.getSubjectTitle();
            if (!confirm(`Bạn đang làm dở môn ${subjName} (${answeredCount} câu đã chọn).\nBạn có chắc muốn quay lại trang chủ để đổi sang môn học khác không?`)) {
                return;
            }
        }
        this.stopStopwatch();
        this.switchScreen('home');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /**
     * HEARTBEAT THỜI GIAN THỰC (Mỗi 3 giây):
     * 1. Kiểm tra lệnh Chặn IP (Bị chặn là đá ra ngay)
     * 2. Kiểm tra Thông báo mới từ Giám thị (Bật lên màn hình đúng 5 giây)
     */
    startRealtimeBanChecker() {
        if (this.banCheckInterval) clearInterval(this.banCheckInterval);
        this.lastSeenNoticeTime = Date.now(); // Ghi nhận mốc thời gian lúc mở trang

        this.banCheckInterval = setInterval(async () => {
            if (!this.clientIp || this.clientIp === "Chưa xác định" || this.clientIp === "IP Cục Bộ") return;
            if (window.dbService) {
                // 1. Kiểm tra xem IP có bị Admin chặn không
                try {
                    const res = await window.dbService.checkIsIpBanned(this.clientIp);
                    if (res && res.isBanned) {
                        this.showBlockedScreen(res.reason);
                    }
                } catch (e) {}

                // 2. Kiểm tra có Thông báo mới từ Giám thị không (Hiện 5s)
                try {
                    const notice = await window.dbService.fetchLatestNotice(this.clientIp);
                    if (notice && notice.timestamp && notice.timestamp > this.lastSeenNoticeTime) {
                        // Chỉ hiển thị thông báo phát sinh trong vòng 45 giây gần nhất
                        if (Date.now() - notice.timestamp < 45000) {
                            this.lastSeenNoticeTime = notice.timestamp;
                            this.showStudentNotice(notice.message, 5);
                        }
                    }
                } catch (e) {}

                // 3. Đồng bộ quyền mở môn Địa Lí thời gian thực
                try {
                    await this.refreshGeographyAccess();
                } catch (e) {}
            }
        }, 3000);
    }

    /**
     * PHÁT ÂM THANH CHIME NHẸ KHI CÓ THÔNG BÁO MỚI TỪ GIÁM THỊ
     */
    playNoticeSound() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
            osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.36);
        } catch (e) {}
    }

    /**
     * HIỂN THỊ THÔNG BÁO TỪ GIÁM THỊ TRƯỚC MÀN HÌNH ĐÚNG 5 GIÂY RỒI TỰ TẮT
     */
    showStudentNotice(message, durationSec = 5) {
        const banner = document.getElementById('student-notice-banner');
        const contentEl = document.getElementById('student-notice-content');
        const timerEl = document.getElementById('student-notice-timer');
        const barEl = document.getElementById('student-notice-bar');

        if (!banner || !contentEl) return;

        this.playNoticeSound();

        contentEl.textContent = message;
        if (timerEl) timerEl.textContent = `${durationSec}s`;
        if (barEl) barEl.style.width = '100%';

        banner.classList.remove('hidden');
        banner.classList.add('flex');

        if (this._noticeCountdownInterval) clearInterval(this._noticeCountdownInterval);
        if (this._noticeTimeout) clearTimeout(this._noticeTimeout);

        const startTime = Date.now();
        const totalMs = durationSec * 1000;

        this._noticeCountdownInterval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const remainingSec = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
            const percentRemaining = Math.max(0, 100 - (elapsed / totalMs) * 100);

            if (timerEl) timerEl.textContent = `${remainingSec}s`;
            if (barEl) barEl.style.width = `${percentRemaining}%`;

            if (elapsed >= totalMs) {
                this.hideStudentNotice();
            }
        }, 80);
    }

    /**
     * TẮT THÔNG BÁO
     */
    hideStudentNotice() {
        if (this._noticeCountdownInterval) {
            clearInterval(this._noticeCountdownInterval);
            this._noticeCountdownInterval = null;
        }
        if (this._noticeTimeout) {
            clearTimeout(this._noticeTimeout);
            this._noticeTimeout = null;
        }

        const banner = document.getElementById('student-notice-banner');
        if (banner) {
            banner.classList.add('hidden');
            banner.classList.remove('flex');
        }
    }

    /**
     * HIỂN THỊ MÀN HÌNH KHÓA TRUY CẬP (BANNED SCREEN)
     */
    showBlockedScreen(reason) {
        const modal = document.getElementById('blocked-screen');
        const ipEl = document.getElementById('blocked-ip-text');
        const reasonEl = document.getElementById('blocked-reason-text');
        if (ipEl) ipEl.textContent = this.clientIp;
        if (reasonEl) reasonEl.textContent = reason || "Vi phạm quy chế phòng thi / Gian lận";
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
        this.stopStopwatch();
    }

    /**
     * Render toàn bộ danh sách câu hỏi cuộn dọc
     */
    renderAllQuestions() {
        const container = document.getElementById('questions-container');
        if (!container) return;

        container.innerHTML = '';
        const questions = (this.allQuestions && this.allQuestions.length > 0) 
            ? this.allQuestions 
            : (this.currentSubject === 'physics' 
                ? (window.PHYSICS_QUESTIONS || []) 
                : (this.currentSubject === 'geography' ? (window.GEOGRAPHY_QUESTIONS || []) : (window.QUIZ_QUESTIONS || [])));

        let filtered = questions.filter(q => {
            if (this.currentFilter === 'all') return true;
            if (this.currentFilter === 'wrong') return this.isQuestionWrong(q);
            if (this.currentFilter === 'mcq') return q.qType === 'mcq' || (!q.qType && !q.statements);
            if (this.currentFilter === 'tf') return q.qType === 'tf_group';
            if (this.currentFilter === 'short') return q.qType === 'short_answer';

            // Lọc môn Lịch Sử
            if (this.currentFilter === 'b1') return (q.category || '').includes('Bài 1');
            if (this.currentFilter === 'b2') return (q.category || '').includes('Bài 2');

            // Lọc môn Vật Lí
            if (this.currentFilter === 'dao_dong') return (q.category || '').includes('Dao động') || (q.category || '').includes('lắc');
            if (this.currentFilter === 'song_co') return (q.category || '').includes('Sóng');

            // Lọc môn Địa Lí
            if (this.currentFilter === 'geo_b1') return (q.category || '').includes('Bài 1');
            if (this.currentFilter === 'geo_b2') return (q.category || '').includes('Bài 2');
            if (this.currentFilter === 'geo_b4') return (q.category || '').includes('Bài 4');
            if (this.currentFilter === 'geo_latin') return (q.category || '').includes('Mỹ Latinh');

            return true;
        });

        if (filtered.length === 0) {
            if (this.currentFilter === 'wrong') {
                container.innerHTML = `
                    <div class="text-center py-12 bg-slate-800/60 rounded-2xl border border-slate-700/60 p-6">
                        <i class="fa-solid fa-circle-check text-4xl text-emerald-400 mb-3"></i>
                        <h4 class="font-bold text-white text-base mb-1">Hiện tại bạn chưa làm sai câu nào!</h4>
                        <p class="text-xs text-slate-400 mb-4">Các câu trả lời chưa đúng sẽ tự động được lọc tại đây để bạn ôn lại.</p>
                        <button onclick="app.filterQuestions('all')" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer">Xem tất cả câu hỏi</button>
                    </div>
                `;
            } else {
                container.innerHTML = `
                    <div class="text-center py-12 bg-slate-800/60 rounded-2xl border border-slate-700/60 p-6">
                        <i class="fa-solid fa-folder-open text-4xl text-slate-500 mb-3"></i>
                        <p class="text-slate-400 text-xs">Không có câu hỏi nào trong danh mục này.</p>
                    </div>
                `;
            }
            return;
        }

        filtered.forEach((q) => {
            const card = document.createElement('div');
            card.id = `q-card-${q.id}`;
            card.className = "p-5 sm:p-6 rounded-2xl bg-slate-800/70 border border-slate-700/70 shadow-xl transition-all duration-200";

            if (q.qType === 'short_answer') {
                card.innerHTML = this.buildShortAnswerQuestionHTML(q);
            } else if (q.qType === 'tf_group' || (Array.isArray(q.statements) && q.statements.length > 0)) {
                card.innerHTML = this.buildTrueFalseQuestionHTML(q);
            } else {
                card.innerHTML = this.buildMCQQuestionHTML(q);
            }

            container.appendChild(card);
        });
    }

    /**
     * Tạo HTML cho câu hỏi trắc nghiệm 4 lựa chọn (MCQ)
     */
    buildMCQQuestionHTML(q) {
        const letters = ['A', 'B', 'C', 'D'];
        const userAnswer = this.userAnswers[q.id];
        const isAnswered = userAnswer !== undefined;
        const qCorrect = (q.correct !== undefined ? q.correct : q.answer);
        const isCorrect = isAnswered && (userAnswer === qCorrect);

        let optionsHtml = '';
        (q.options || []).forEach((optText, optIdx) => {
            const letter = letters[optIdx];
            const isChosen = userAnswer === optIdx;
            const isTheRightOne = optIdx === qCorrect;

            let btnClasses = "w-full text-left p-3.5 rounded-xl border transition-all duration-200 flex items-start gap-3 mb-2.5 text-xs sm:text-sm ";

            if (!isAnswered) {
                btnClasses += "bg-slate-900/80 hover:bg-slate-700/70 border-slate-700/80 text-slate-200 cursor-pointer hover:border-indigo-500/50 hover:shadow-md";
            } else {
                if (isTheRightOne) {
                    btnClasses += "bg-emerald-950/70 border-emerald-500 text-emerald-100 font-semibold ring-1 ring-emerald-500 shadow-md shadow-emerald-900/30";
                } else if (isChosen && !isTheRightOne) {
                    btnClasses += "bg-rose-950/70 border-rose-500 text-rose-100 ring-1 ring-rose-500 shadow-md shadow-rose-900/30";
                } else {
                    btnClasses += "bg-slate-900/40 border-slate-800 text-slate-500 opacity-60";
                }
            }

            let badgeClasses = "w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ";
            if (!isAnswered) {
                badgeClasses += "bg-slate-800 text-indigo-300 border border-slate-700";
            } else if (isTheRightOne) {
                badgeClasses += "bg-emerald-500 text-slate-950 font-extrabold";
            } else if (isChosen && !isTheRightOne) {
                badgeClasses += "bg-rose-500 text-white font-extrabold";
            } else {
                badgeClasses += "bg-slate-800 text-slate-500";
            }

            let iconTag = '';
            if (isAnswered) {
                if (isTheRightOne) {
                    iconTag = '<i class="fa-solid fa-circle-check text-emerald-400 text-base ml-auto shrink-0 mt-0.5"></i>';
                } else if (isChosen && !isTheRightOne) {
                    iconTag = '<i class="fa-solid fa-circle-xmark text-rose-400 text-base ml-auto shrink-0 mt-0.5"></i>';
                }
            }

            const clickHandler = !isAnswered ? `onclick="app.selectMCQOption(${q.id}, ${optIdx})"` : '';

            optionsHtml += `
                <button type="button" ${clickHandler} class="${btnClasses}" ${isAnswered ? 'disabled' : ''}>
                    <span class="${badgeClasses}">${letter}</span>
                    <span class="flex-1 mt-0.5 leading-relaxed">${this.escapeHtml(optText)}</span>
                    ${iconTag}
                </button>
            `;
        });

        let explanationBox = '';
        if (isAnswered) {
            const displayLetter = letters[qCorrect] !== undefined ? letters[qCorrect] : (q.options ? q.options[qCorrect] : '');
            explanationBox = `
                <div class="mt-4 p-4 rounded-xl ${isCorrect ? 'bg-emerald-950/40 border-emerald-500/40' : 'bg-rose-950/40 border-rose-500/40'} border text-xs leading-relaxed space-y-1.5 animate-fadeIn">
                    <div class="flex items-center gap-2 font-bold ${isCorrect ? 'text-emerald-400' : 'text-rose-400'}">
                        <i class="fa-solid ${isCorrect ? 'fa-check-circle' : 'fa-circle-xmark'}"></i>
                        <span>${isCorrect ? 'CHÍNH XÁC!' : 'CHƯA CHÍNH XÁC!'}</span>
                        <span class="text-slate-300 font-normal ml-2">Đáp án đúng là: <strong class="text-emerald-400 font-bold">${displayLetter}</strong></span>
                    </div>
                    ${q.explanation ? `<div class="text-slate-300 pt-1 border-t border-slate-700/60"><strong class="text-indigo-300">Giải thích:</strong> ${this.escapeHtml(q.explanation)}</div>` : ''}
                </div>
            `;
        }

        return `
            <div class="flex items-center justify-between gap-3 mb-3 pb-2.5 border-b border-slate-700/60 text-xs">
                <div class="flex items-center gap-2">
                    <span class="px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 font-extrabold border border-indigo-500/30">
                        Câu ${q.id}
                    </span>
                    <span class="text-slate-400 font-medium">${this.escapeHtml(q.category || (this.currentSubject === 'physics' ? 'Vật Lí 11' : 'Lịch Sử 11'))}</span>
                </div>
                ${isAnswered ? `
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${isCorrect ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}">
                        <i class="fa-solid ${isCorrect ? 'fa-check' : 'fa-xmark'}"></i>
                        ${isCorrect ? 'Đúng' : 'Sai'}
                    </span>
                ` : '<span class="text-slate-500 text-[11px]">Chưa làm</span>'}
            </div>

            <h3 class="font-medium text-slate-100 text-sm sm:text-base leading-relaxed mb-4">
                ${this.escapeHtml(q.question)}
            </h3>

            <div class="space-y-1">
                ${optionsHtml}
            </div>

            ${explanationBox}
        `;
    }

    /**
     * Tạo HTML cho câu hỏi trắc nghiệm Đúng - Sai (gồm 4 ý a, b, c, d)
     */
    buildTrueFalseQuestionHTML(q) {
        const statements = q.statements || [];
        const ansObj = this.userAnswers[q.id] || {};

        let statementsHtml = '';
        statements.forEach((st, idx) => {
            const userChoice = ansObj[idx];
            const isAnswered = userChoice !== undefined;
            const isCorrectChoice = isAnswered && (Boolean(userChoice) === Boolean(st.answer));

            let trueBtnClasses = "px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ";
            let falseBtnClasses = "px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ";

            if (!isAnswered) {
                trueBtnClasses += "bg-slate-800 hover:bg-emerald-600/30 text-slate-300 hover:text-emerald-300 border border-slate-700";
                falseBtnClasses += "bg-slate-800 hover:bg-rose-600/30 text-slate-300 hover:text-rose-300 border border-slate-700";
            } else {
                if (st.answer === true) {
                    trueBtnClasses += "bg-emerald-600 text-white font-extrabold shadow-md shadow-emerald-600/30 ring-1 ring-emerald-400";
                    falseBtnClasses += (userChoice === false) 
                        ? "bg-rose-600 text-white font-extrabold line-through" 
                        : "bg-slate-900 text-slate-600 border border-slate-800 opacity-50";
                } else {
                    falseBtnClasses += "bg-rose-600 text-white font-extrabold shadow-md shadow-rose-600/30 ring-1 ring-rose-400";
                    trueBtnClasses += (userChoice === true) 
                        ? "bg-rose-900/60 text-rose-300 line-through" 
                        : "bg-slate-900 text-slate-600 border border-slate-800 opacity-50";
                }
            }

            statementsHtml += `
                <div class="p-3.5 rounded-xl ${isAnswered ? (isCorrectChoice ? 'bg-emerald-950/20 border border-emerald-500/30' : 'bg-rose-950/20 border border-rose-500/30') : 'bg-slate-900/70 border border-slate-700/80'} transition-all">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div class="flex items-start gap-2.5 flex-1">
                            <span class="w-6 h-6 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                                ${st.label || String.fromCharCode(97 + idx)}
                            </span>
                            <div class="text-xs sm:text-sm text-slate-200 leading-relaxed">
                                ${this.escapeHtml(st.text)}
                            </div>
                        </div>

                        <div class="flex items-center gap-2 self-end sm:self-center shrink-0">
                            <button type="button" ${!isAnswered ? `onclick="app.selectStatementTF(${q.id}, ${idx}, true)"` : 'disabled'} class="${trueBtnClasses}">
                                <i class="fa-solid fa-check"></i> ĐÚNG
                            </button>
                            <button type="button" ${!isAnswered ? `onclick="app.selectStatementTF(${q.id}, ${idx}, false)"` : 'disabled'} class="${falseBtnClasses}">
                                <i class="fa-solid fa-xmark"></i> SAI
                            </button>
                        </div>
                    </div>

                    ${isAnswered ? `
                        <div class="mt-2.5 pt-2 border-t border-slate-800 text-xs flex flex-wrap items-center justify-between gap-2">
                            <span class="font-semibold ${isCorrectChoice ? 'text-emerald-400' : 'text-rose-400'} flex items-center gap-1.5">
                                <i class="fa-solid ${isCorrectChoice ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
                                ${isCorrectChoice ? 'Chính xác!' : 'Chưa đúng!'}
                                <span class="text-slate-300 font-normal">Đáp án: <strong class="${st.answer ? 'text-emerald-400' : 'text-rose-400'}">${st.answer ? 'ĐÚNG' : 'SAI'}</strong></span>
                            </span>
                            ${st.explanation ? `<span class="text-slate-400 text-[11px] italic">${this.escapeHtml(st.explanation)}</span>` : ''}
                        </div>
                    ` : ''}
                </div>
            `;
        });

        return `
            <div class="flex items-center justify-between gap-3 mb-3 pb-2.5 border-b border-slate-700/60 text-xs">
                <div class="flex items-center gap-2">
                    <span class="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 font-extrabold border border-amber-500/30">
                        Câu ${q.id} (Đúng - Sai)
                    </span>
                    <span class="text-slate-400 font-medium">${this.escapeHtml(q.category || 'Phần II: Câu hỏi Đúng - Sai')}</span>
                </div>
            </div>

            <div class="p-4 rounded-2xl bg-slate-900/90 border-l-4 border-indigo-500 border-y border-r border-slate-700/80 text-xs sm:text-sm text-slate-100 leading-relaxed mb-4 whitespace-pre-line font-sans font-medium shadow-sm">
                ${this.escapeHtml(q.question)}
            </div>

            <p class="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
                Chọn ĐÚNG hoặc SAI cho mỗi ý dưới đây:
            </p>

            <div class="space-y-2.5">
                ${statementsHtml}
            </div>
        `;
    }

    /**
     * Tạo HTML cho câu hỏi trả lời ngắn (Điền số / kết quả)
     */
    buildShortAnswerQuestionHTML(q) {
        const userVal = this.userAnswers[q.id];
        const isAnswered = userVal !== undefined;
        const isCorrect = isAnswered && (
            (q.acceptedValues && q.acceptedValues.some(val => String(val).trim().toLowerCase() === String(userVal).trim().toLowerCase())) ||
            String(q.correctValue).trim().toLowerCase() === String(userVal).trim().toLowerCase()
        );

        return `
            <div class="flex items-center justify-between gap-3 mb-3 pb-2.5 border-b border-slate-700/60 text-xs">
                <div class="flex items-center gap-2">
                    <span class="px-2.5 py-1 rounded-lg bg-purple-500/20 text-purple-300 font-extrabold border border-purple-500/30">
                        Câu ${q.id} (Trả lời ngắn)
                    </span>
                    <span class="text-slate-400 font-medium">${this.escapeHtml(q.category || 'Phần III: Trả lời ngắn')}</span>
                </div>
                ${isAnswered ? `
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${isCorrect ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}">
                        <i class="fa-solid ${isCorrect ? 'fa-check' : 'fa-xmark'}"></i>
                        ${isCorrect ? 'Chính xác' : 'Chưa đúng'}
                    </span>
                ` : '<span class="text-slate-500 text-[11px]">Chưa trả lời</span>'}
            </div>

            <h3 class="font-medium text-slate-100 text-sm sm:text-base leading-relaxed mb-4">
                ${this.escapeHtml(q.question)}
            </h3>

            <div class="p-3.5 rounded-xl bg-slate-900/80 border border-slate-700 space-y-2">
                <div class="flex items-center gap-2">
                    <input type="text" id="short-input-${q.id}" value="${isAnswered ? this.escapeHtml(userVal) : ''}" ${isAnswered ? 'disabled' : ''} placeholder="Nhập đáp số (VD: 5, 0.5, 2.5...)" 
                        onkeydown="if(event.key==='Enter'){event.preventDefault();app.submitShortAnswer(${q.id}, this.value);}"
                        class="flex-1 px-3.5 py-2.5 bg-slate-950 border ${isAnswered ? (isCorrect ? 'border-emerald-500 text-emerald-300 font-bold' : 'border-rose-500 text-rose-300 font-bold') : 'border-slate-700 text-white'} rounded-xl text-xs sm:text-sm outline-none focus:ring-1 focus:ring-indigo-500">
                    <button type="button" ${isAnswered ? 'disabled' : `onclick="app.submitShortAnswer(${q.id}, document.getElementById('short-input-${q.id}').value)"`} class="px-4 py-2.5 rounded-xl ${isAnswered ? 'bg-slate-800 text-slate-600' : 'bg-indigo-600 hover:bg-indigo-500 text-white font-semibold cursor-pointer shadow'} text-xs transition">
                        ${isAnswered ? 'Đã kiểm tra' : 'Kiểm tra'}
                    </button>
                </div>
                ${isAnswered ? `
                    <div class="mt-2 pt-2 border-t border-slate-800 text-xs">
                        <div class="flex items-center gap-2 font-bold ${isCorrect ? 'text-emerald-400' : 'text-rose-400'}">
                            <i class="fa-solid ${isCorrect ? 'fa-check-circle' : 'fa-circle-xmark'}"></i>
                            <span>${isCorrect ? 'ĐÁP SỐ CHÍNH XÁC!' : 'ĐÁP SỐ CHƯA ĐÚNG!'}</span>
                            <span class="text-slate-300 font-normal ml-2">Đáp số chuẩn: <strong class="text-emerald-400 font-bold">${this.escapeHtml(q.correctValue)}</strong></span>
                        </div>
                        ${q.explanation ? `<div class="text-slate-300 pt-1 mt-1 border-t border-slate-800"><strong class="text-indigo-300">Lời giải:</strong> ${this.escapeHtml(q.explanation)}</div>` : ''}
                    </div>
                ` : ''}
            </div>
        `;
    }

    submitShortAnswer(qId, val) {
        if (!val || !val.trim()) {
            alert("Vui lòng nhập đáp số của bạn!");
            return;
        }
        if (this.userAnswers[qId] !== undefined) return;

        this.userAnswers[qId] = val.trim();

        const card = document.getElementById(`q-card-${qId}`);
        const q = this.allQuestions.find(item => item.id === qId);
        if (card && q) {
            card.innerHTML = this.buildShortAnswerQuestionHTML(q);
        }

        this.updateLiveStats();
    }

    /**
     * Xử lý chọn đáp án MCQ -> Phản hồi tức thì ngay lập tức
     */
    selectMCQOption(qId, optIdx) {
        if (this.userAnswers[qId] !== undefined) return;
        this.userAnswers[qId] = optIdx;

        // Cập nhật giao diện của câu hỏi đó
        const card = document.getElementById(`q-card-${qId}`);
        const q = this.allQuestions.find(item => item.id === qId);
        if (card && q) {
            card.innerHTML = this.buildMCQQuestionHTML(q);
        }

        this.updateLiveStats();
    }

    /**
     * Xử lý chọn Đúng / Sai cho từng ý
     */
    selectStatementTF(qId, stmtIdx, choiceBool) {
        if (!this.userAnswers[qId]) {
            this.userAnswers[qId] = {};
        }
        if (this.userAnswers[qId][stmtIdx] !== undefined) return;

        this.userAnswers[qId][stmtIdx] = choiceBool;

        const card = document.getElementById(`q-card-${qId}`);
        const q = this.allQuestions.find(item => item.id === qId);
        if (card && q) {
            card.innerHTML = this.buildTrueFalseQuestionHTML(q);
        }

        this.updateLiveStats();
    }

    /**
     * Kiểm tra xem câu hỏi này có làm sai không (dành cho bộ lọc "Câu làm sai")
     */
    isQuestionWrong(q) {
        if (q.qType === 'short_answer') {
            const ans = this.userAnswers[q.id];
            if (ans === undefined) return false;
            const isMatch = (q.acceptedValues && q.acceptedValues.some(val => String(val).trim().toLowerCase() === String(ans).trim().toLowerCase())) ||
                String(q.correctValue).trim().toLowerCase() === String(ans).trim().toLowerCase();
            return !isMatch;
        } else if (q.qType === 'tf_group' && Array.isArray(q.statements)) {
            const ansObj = this.userAnswers[q.id];
            if (!ansObj) return false;
            return q.statements.some((st, idx) => {
                return ansObj[idx] !== undefined && Boolean(ansObj[idx]) !== Boolean(st.answer);
            });
        } else {
            const ans = this.userAnswers[q.id];
            if (ans === undefined) return false;
            const qCorrect = (q.correct !== undefined ? q.correct : q.answer);
            return ans !== qCorrect;
        }
    }

    /**
     * Cập nhật các chỉ số thời gian thực trên Sticky Top Bar
     */
    updateLiveStats() {
        const questions = this.allQuestions || [];
        let totalItems = 0;
        let attemptedCount = 0;
        let correctCount = 0;
        let wrongCount = 0;

        questions.forEach(q => {
            if (q.qType === 'short_answer') {
                totalItems++;
                const ans = this.userAnswers[q.id];
                if (ans !== undefined) {
                    attemptedCount++;
                    const isMatch = (q.acceptedValues && q.acceptedValues.some(val => String(val).trim().toLowerCase() === String(ans).trim().toLowerCase())) ||
                        String(q.correctValue).trim().toLowerCase() === String(ans).trim().toLowerCase();
                    if (isMatch) correctCount++;
                    else wrongCount++;
                }
            } else if (q.qType === 'tf_group' && Array.isArray(q.statements)) {
                const ansObj = this.userAnswers[q.id] || {};
                let hasWrong = false;
                q.statements.forEach((st, idx) => {
                    totalItems++;
                    if (ansObj[idx] !== undefined) {
                        attemptedCount++;
                        if (Boolean(ansObj[idx]) === Boolean(st.answer)) {
                            correctCount++;
                        } else {
                            hasWrong = true;
                        }
                    }
                });
                if (hasWrong) wrongCount++;
            } else {
                totalItems++;
                if (this.userAnswers[q.id] !== undefined) {
                    attemptedCount++;
                    const qCorrect = (q.correct !== undefined ? q.correct : q.answer);
                    if (this.userAnswers[q.id] === qCorrect) {
                        correctCount++;
                    } else {
                        wrongCount++;
                    }
                }
            }
        });

        // Cập nhật UI Header
        const liveScore = document.getElementById('quiz-live-score');
        const attemptedEl = document.getElementById('quiz-attempted-count');
        const wrongBadge = document.getElementById('wrong-count-badge');
        const progressText = document.getElementById('quiz-progress-text');
        const progressBar = document.getElementById('quiz-progress-bar');

        if (liveScore) liveScore.textContent = correctCount;
        if (attemptedEl) attemptedEl.textContent = attemptedCount;
        if (wrongBadge) wrongBadge.textContent = wrongCount;

        const percent = totalItems > 0 ? Math.round((attemptedCount / totalItems) * 100) : 0;
        if (progressText) progressText.textContent = `Đã làm ${attemptedCount}/${totalItems} ý (${percent}%)`;
        if (progressBar) progressBar.style.width = `${percent}%`;

        // Đồng bộ tiến độ chi tiết lên Supabase Cloud để Admin nhìn thấy thanh tiến độ
        this.syncProgressToCloud(attemptedCount, totalItems, correctCount);
    }

    /**
     * Đồng bộ tiến độ làm bài lên Cloud Supabase (Debounced 1.2s tránh spam request)
     */
    syncProgressToCloud(attempted, total, correct) {
        if (!this.currentLoginId || !window.dbService) return;
        const subjName = this.getSubjectTitle();
        if (this._progressSyncTimeout) clearTimeout(this._progressSyncTimeout);
        this._progressSyncTimeout = setTimeout(() => {
            window.dbService.updateStudentProgress(this.currentLoginId, attempted, total, correct, subjName);
        }, 1200);
    }

    /**
     * Lọc danh sách câu hỏi
     */
    filterQuestions(filterKey) {
        this.currentFilter = filterKey;

        // Cập nhật style nút filter
        const buttons = document.querySelectorAll('.filter-tab-btn');
        buttons.forEach(btn => {
            if (btn.getAttribute('data-filter') === filterKey) {
                btn.className = "filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-indigo-600 text-white cursor-pointer";
            } else {
                btn.className = "filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer";
            }
        });

        const btnWrong = document.getElementById('btn-filter-wrong');
        if (btnWrong) {
            if (filterKey === 'wrong') {
                btnWrong.className = "px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer";
            } else {
                btnWrong.className = "px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer";
            }
        }

        this.renderAllQuestions();
        window.scrollTo({ top: 120, behavior: 'smooth' });
    }

    /**
     * Xác nhận và nộp bài
     */
    confirmSubmit() {
        const questions = this.allQuestions || [];
        let totalItems = 0;
        let attemptedCount = 0;

        questions.forEach(q => {
            if (q.qType === 'short_answer') {
                totalItems++;
                if (this.userAnswers[q.id] !== undefined) attemptedCount++;
            } else if (q.qType === 'tf_group' && Array.isArray(q.statements)) {
                const ansObj = this.userAnswers[q.id] || {};
                q.statements.forEach((st, idx) => {
                    totalItems++;
                    if (ansObj[idx] !== undefined) attemptedCount++;
                });
            } else {
                totalItems++;
                if (this.userAnswers[q.id] !== undefined) attemptedCount++;
            }
        });

        const unattempted = totalItems - attemptedCount;
        let msg = `Bạn đã hoàn thành ${attemptedCount}/${totalItems} ý hỏi.`;
        if (unattempted > 0) {
            msg += ` Còn ${unattempted} ý chưa trả lời. Bạn có chắc chắn muốn nộp bài ngay bây giờ?`;
        } else {
            msg += ` Bạn đã trả lời hết toàn bộ bài thi! Bạn có muốn nộp bài để xem điểm tổng kết?`;
        }

        if (confirm(msg)) {
            this.finishQuiz();
        }
    }

    finishQuiz() {
        this.stopStopwatch();

        const questions = this.allQuestions || [];
        let totalItems = 0;
        let correctCount = 0;

        questions.forEach(q => {
            if (q.qType === 'short_answer') {
                totalItems++;
                const ans = this.userAnswers[q.id];
                if (ans !== undefined) {
                    const isMatch = (q.acceptedValues && q.acceptedValues.some(val => String(val).trim().toLowerCase() === String(ans).trim().toLowerCase())) ||
                        String(q.correctValue).trim().toLowerCase() === String(ans).trim().toLowerCase();
                    if (isMatch) correctCount++;
                }
            } else if (q.qType === 'tf_group' && Array.isArray(q.statements)) {
                const ansObj = this.userAnswers[q.id] || {};
                q.statements.forEach((st, idx) => {
                    totalItems++;
                    if (ansObj[idx] !== undefined && Boolean(ansObj[idx]) === Boolean(st.answer)) {
                        correctCount++;
                    }
                });
            } else {
                totalItems++;
                const qCorrect = (q.correct !== undefined ? q.correct : q.answer);
                if (this.userAnswers[q.id] === qCorrect) {
                    correctCount++;
                }
            }
        });

        const finalScore = totalItems > 0 ? Math.round((correctCount / totalItems) * 100) : 0;
        const subjTitle = this.getSubjectTitle();

        // Cập nhật kết quả lên màn hình Result
        const greetingEl = document.getElementById('result-player-greeting');
        if (greetingEl) greetingEl.textContent = `Chúc mừng ${this.playerName} đã hoàn thành bài thi ${subjTitle}!`;

        const scoreEl = document.getElementById('result-score');
        if (scoreEl) scoreEl.textContent = finalScore;

        const ratioEl = document.getElementById('result-correct-ratio');
        if (ratioEl) ratioEl.textContent = `${correctCount}/${totalItems}`;

        const minutes = Math.floor(this.secondsElapsed / 60);
        const seconds = this.secondsElapsed % 60;
        const timeSpentEl = document.getElementById('result-time-spent');
        if (timeSpentEl) timeSpentEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        // Cập nhật trạng thái và điểm của thí sinh lên Supabase Cloud (để Admin theo dõi)
        if (window.dbService && this.currentLoginId) {
            window.dbService.updateLoginStatus(
                this.currentLoginId, 
                `[${subjTitle}] Đã nộp bài`, 
                `Đúng ${correctCount}/${totalItems} ý (${finalScore} điểm)`
            );
        }

        // Bắn pháo hoa ăn mừng
        if (typeof confetti === 'function') {
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 }
            });
        }

        this.renderReviewList();
        this.switchScreen('result');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    renderReviewList() {
        const reviewList = document.getElementById('review-list');
        if (!reviewList) return;

        reviewList.innerHTML = '';
        const questions = this.allQuestions || [];

        questions.forEach((q) => {
            const card = document.createElement('div');
            card.className = "p-4 rounded-xl bg-slate-900/80 border border-slate-700/80 text-xs space-y-2";

            if (q.qType === 'short_answer') {
                const userAns = this.userAnswers[q.id];
                const isMatch = userAns !== undefined && (
                    (q.acceptedValues && q.acceptedValues.some(val => String(val).trim().toLowerCase() === String(userAns).trim().toLowerCase())) ||
                    String(q.correctValue).trim().toLowerCase() === String(userAns).trim().toLowerCase()
                );
                card.innerHTML = `
                    <div class="flex items-center justify-between font-bold">
                        <span class="text-purple-300">Câu ${q.id} (Trả lời ngắn):</span>
                        <span class="${isMatch ? 'text-emerald-400' : 'text-rose-400'}">${isMatch ? 'ĐÚNG ✅' : 'CHƯA ĐÚNG ❌'}</span>
                    </div>
                    <div class="text-slate-200">${this.escapeHtml(q.question)}</div>
                    <div class="pt-1 text-slate-300">
                        Đáp số của bạn: <strong>${userAns !== undefined ? this.escapeHtml(userAns) : '(Chưa làm)'}</strong> | Đáp số chuẩn: <strong class="text-emerald-400">${this.escapeHtml(q.correctValue)}</strong>
                    </div>
                    ${q.explanation ? `<div class="text-slate-400 italic pt-1 border-t border-slate-800">Lời giải: ${this.escapeHtml(q.explanation)}</div>` : ''}
                `;
            } else if (q.qType === 'tf_group' && Array.isArray(q.statements)) {
                const ansObj = this.userAnswers[q.id] || {};
                let stRows = '';
                q.statements.forEach((st, idx) => {
                    const ans = ansObj[idx];
                    const isRight = ans !== undefined && Boolean(ans) === Boolean(st.answer);
                    stRows += `
                        <div class="p-2 rounded-lg ${isRight ? 'bg-emerald-950/30 border border-emerald-500/30' : 'bg-rose-950/30 border border-rose-500/30'} flex items-center justify-between gap-2">
                            <span><strong>${st.label || String.fromCharCode(97+idx)}.</strong> ${this.escapeHtml(st.text)}</span>
                            <span class="font-bold shrink-0 ${st.answer ? 'text-emerald-400' : 'text-rose-400'}">
                                Đáp án: ${st.answer ? 'ĐÚNG' : 'SAI'} ${isRight ? '✅' : '❌'}
                            </span>
                        </div>
                    `;
                });
                card.innerHTML = `
                    <div class="font-bold text-amber-300">Câu ${q.id} (Đúng - Sai):</div>
                    <div class="italic text-slate-300">${this.escapeHtml(q.question)}</div>
                    <div class="space-y-1.5 pt-1">${stRows}</div>
                `;
            } else {
                const letters = ['A', 'B', 'C', 'D'];
                const userAns = this.userAnswers[q.id];
                const qCorrect = (q.correct !== undefined ? q.correct : q.answer);
                const isRight = userAns === qCorrect;
                const rightLetter = letters[qCorrect] !== undefined ? letters[qCorrect] : (q.options ? q.options[qCorrect] : '');
                const rightText = (q.options && q.options[qCorrect]) ? q.options[qCorrect] : '';
                card.innerHTML = `
                    <div class="flex items-center justify-between font-bold">
                        <span class="text-indigo-300">Câu ${q.id}:</span>
                        <span class="${isRight ? 'text-emerald-400' : 'text-rose-400'}">${isRight ? 'ĐÚNG ✅' : 'CHƯA ĐÚNG ❌'}</span>
                    </div>
                    <div class="text-slate-200">${this.escapeHtml(q.question)}</div>
                    <div class="pt-1 text-slate-300">
                        Đáp án đúng: <strong class="text-emerald-400">${rightLetter}${rightText ? `. ${this.escapeHtml(rightText)}` : ''}</strong>
                    </div>
                    ${q.explanation ? `<div class="text-slate-400 italic pt-1 border-t border-slate-800">Giải thích: ${this.escapeHtml(q.explanation)}</div>` : ''}
                `;
            }
            reviewList.appendChild(card);
        });
    }

    switchScreen(screenName) {
        // Khi làm bài thi, ẩn header chung để thanh điều hành bài thi dính sát mép trên cùng (không bị lửng lơ)
        const mainHeader = document.getElementById('main-header');
        if (mainHeader) {
            if (screenName === 'quiz') {
                mainHeader.classList.add('hidden');
            } else {
                mainHeader.classList.remove('hidden');
            }
        }

        Object.keys(this.screens).forEach(key => {
            if (this.screens[key]) {
                if (key === screenName) {
                    this.screens[key].classList.remove('hidden');
                } else {
                    this.screens[key].classList.add('hidden');
                }
            }
        });
    }

    showHome() {
        this.switchScreen('home');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // =========================================================================
    // QUẢN TRỊ VIÊN (ADMIN DASHBOARD): GIÁM SÁT MÁY & SỬA CÂU HỎI TRỰC TIẾP
    // =========================================================================

    promptAdminAuth() {
        if (this.isAdminAuthenticated) {
            this.openAdminDashboard();
            return;
        }
        const modal = document.getElementById('modal-admin-auth');
        const passInput = document.getElementById('admin-pass-input');
        const errText = document.getElementById('admin-auth-error');
        if (errText) errText.classList.add('hidden');
        if (passInput) passInput.value = '';

        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            setTimeout(() => passInput?.focus(), 100);
        }
    }

    closeAdminAuthModal() {
        const modal = document.getElementById('modal-admin-auth');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    verifyAdminPassword() {
        const passInput = document.getElementById('admin-pass-input');
        const errText = document.getElementById('admin-auth-error');
        const pass = passInput ? passInput.value.trim() : '';

        if (pass === this.adminSecretPass || pass === 'admin123') {
            this.isAdminAuthenticated = true;
            this.closeAdminAuthModal();
            this.openAdminDashboard();
        } else {
            if (errText) errText.classList.remove('hidden');
            if (passInput) passInput.select();
        }
    }

    openAdminDashboard() {
        this.isAdminAuthenticated = true;
        this.refreshGeographyAccess();
        const modal = document.getElementById('modal-admin-dashboard');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            this.switchAdminTab(this.adminCurrentTab);
        }
    }

    closeAdminDashboard() {
        const modal = document.getElementById('modal-admin-dashboard');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    switchAdminTab(tabName) {
        this.adminCurrentTab = tabName;
        const tabQContent = document.getElementById('admin-tab-questions-content');
        const tabSContent = document.getElementById('admin-tab-students-content');
        const tabIContent = document.getElementById('admin-tab-ips-content');

        const btnQ = document.getElementById('admin-tab-btn-questions');
        const btnS = document.getElementById('admin-tab-btn-students');
        const btnI = document.getElementById('admin-tab-btn-ips');

        // Ẩn tất cả tab nội dung
        tabQContent?.classList.add('hidden');
        tabSContent?.classList.add('hidden');
        tabIContent?.classList.add('hidden');

        // Đặt lại style mặc định của tất cả các tab
        [btnQ, btnS, btnI].forEach(btn => {
            btn?.classList.remove('bg-slate-900', 'text-amber-400', 'text-emerald-400', 'border-t-2', 'border-amber-500', 'border-emerald-500');
            btn?.classList.add('text-slate-400');
        });

        if (tabName === 'questions') {
            tabQContent?.classList.remove('hidden');
            btnQ?.classList.add('bg-slate-900', 'text-amber-400', 'border-t-2', 'border-amber-500');
            btnQ?.classList.remove('text-slate-400');
            this.renderAdminQuestionsList();
        } else if (tabName === 'ips') {
            tabIContent?.classList.remove('hidden');
            btnI?.classList.add('bg-slate-900', 'text-emerald-400', 'border-t-2', 'border-emerald-500');
            btnI?.classList.remove('text-slate-400');
            this.updateAdminGeoModeUI();
            this.renderAdminGeoIpBadges();
            this.renderAdminIpsTabList();
        } else {
            // Tab 2: Giám sát thí sinh
            tabSContent?.classList.remove('hidden');
            btnS?.classList.add('bg-slate-900', 'text-amber-400', 'border-t-2', 'border-amber-500');
            btnS?.classList.remove('text-slate-400');
            this.renderAdminStudentsList();
        }
    }

    /**
     * Render danh sách câu hỏi cho Admin chỉnh sửa
     */
    renderAdminQuestionsList() {
        const listContainer = document.getElementById('admin-questions-list');
        const searchInput = document.getElementById('admin-search-q-input');
        const filterCategory = document.getElementById('admin-filter-category');
        if (!listContainer) return;

        const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
        const catFilter = filterCategory ? filterCategory.value : 'all';

        const questions = (this.allQuestions && this.allQuestions.length > 0) 
            ? this.allQuestions 
            : (this.currentSubject === 'physics' ? (window.PHYSICS_QUESTIONS || []) : (window.QUIZ_QUESTIONS || []));

        let filtered = questions.filter(q => {
            const matchesText = !keyword || q.question.toLowerCase().includes(keyword) || (q.explanation && q.explanation.toLowerCase().includes(keyword));
            let matchesCat = true;
            if (catFilter === 'b1') matchesCat = (q.category || '').includes('Bài 1');
            else if (catFilter === 'b2') matchesCat = (q.category || '').includes('Bài 2');
            return matchesText && matchesCat;
        });

        if (filtered.length === 0) {
            listContainer.innerHTML = '<div class="text-center py-8 text-slate-500 text-xs">Không tìm thấy câu hỏi phù hợp.</div>';
            return;
        }

        listContainer.innerHTML = '';
        filtered.forEach(q => {
            const item = document.createElement('div');
            item.className = "p-3.5 rounded-xl bg-slate-800/80 border border-slate-700/80 hover:border-slate-600 transition text-xs space-y-2";

            const letters = ['A', 'B', 'C', 'D'];
            let answerSnippet = '';
            if (q.qType === 'short_answer') {
                answerSnippet = `<span class="text-purple-300 font-semibold">[Trả lời ngắn: ${this.escapeHtml(q.correctValue)}]</span>`;
            } else if (q.qType === 'tf_group' && Array.isArray(q.statements)) {
                answerSnippet = `<span class="text-amber-300 font-semibold">[Đúng - Sai: ${q.statements.length} ý]</span>`;
            } else {
                const qCorrect = (q.correct !== undefined ? q.correct : q.answer);
                answerSnippet = `<span class="text-emerald-400 font-semibold">Đáp án đúng: ${letters[qCorrect] || 'A'}</span>`;
            }

            item.innerHTML = `
                <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 space-y-1">
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold text-[11px]">Câu #${q.id}</span>
                            <span class="text-slate-400 text-[11px]">${this.escapeHtml(q.category || (this.currentSubject === 'physics' ? 'Vật Lí 11' : 'Lịch Sử 11'))}</span>
                            ${answerSnippet}
                        </div>
                        <p class="font-medium text-slate-200 line-clamp-2 leading-relaxed">${this.escapeHtml(q.question)}</p>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <button onclick="app.openEditQuestion(${q.id})" class="px-2.5 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-300 hover:text-white transition cursor-pointer" title="Chỉnh sửa">
                            <i class="fa-solid fa-pen-to-square"></i> Sửa
                        </button>
                        <button onclick="app.deleteQuestion(${q.id})" class="px-2.5 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white transition cursor-pointer" title="Xóa">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            `;
            listContainer.appendChild(item);
        });
    }

    openNewQuestionModal() {
        document.getElementById('editor-modal-title').textContent = "Thêm Câu Hỏi Mới";
        document.getElementById('edit-q-id').value = "";
        document.getElementById('edit-q-category').value = this.currentSubject === 'physics' ? "Dao động cơ" : "Bài 1: Cách mạng tư sản";
        document.getElementById('edit-q-text').value = "";
        document.getElementById('edit-q-opt-0').value = "";
        document.getElementById('edit-q-opt-1').value = "";
        document.getElementById('edit-q-opt-2').value = "";
        document.getElementById('edit-q-opt-3').value = "";
        document.getElementById('edit-q-explanation').value = "";

        const radios = document.querySelectorAll('input[name="edit-q-correct"]');
        if (radios.length > 0) radios[0].checked = true;

        const modal = document.getElementById('modal-question-editor');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    }

    openEditQuestion(qId) {
        const q = this.allQuestions.find(item => item.id === qId);
        if (!q) return;

        document.getElementById('editor-modal-title').textContent = `Chỉnh Sửa Câu Hỏi #${q.id}`;
        document.getElementById('edit-q-id').value = q.id;
        document.getElementById('edit-q-category').value = q.category || (this.currentSubject === 'physics' ? "Dao động cơ" : "Bài 1: Cách mạng tư sản");
        document.getElementById('edit-q-text').value = q.question;

        if (Array.isArray(q.options)) {
            document.getElementById('edit-q-opt-0').value = q.options[0] || "";
            document.getElementById('edit-q-opt-1').value = q.options[1] || "";
            document.getElementById('edit-q-opt-2').value = q.options[2] || "";
            document.getElementById('edit-q-opt-3').value = q.options[3] || "";
        }

        document.getElementById('edit-q-explanation').value = q.explanation || "";

        const radios = document.querySelectorAll('input[name="edit-q-correct"]');
        const qCorrect = (q.correct !== undefined ? q.correct : q.answer);
        radios.forEach((r, idx) => {
            r.checked = (idx === qCorrect);
        });

        const modal = document.getElementById('modal-question-editor');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    }

    closeQuestionEditor() {
        const modal = document.getElementById('modal-question-editor');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    /**
     * LƯU CÂU HỎI TRỰC TIẾP BẰNG QUYỀN ADMIN
     */
    async saveQuestionFromEditor() {
        const idInput = document.getElementById('edit-q-id').value;
        const category = document.getElementById('edit-q-category').value;
        const questionText = document.getElementById('edit-q-text').value.trim();
        const opt0 = document.getElementById('edit-q-opt-0').value.trim();
        const opt1 = document.getElementById('edit-q-opt-1').value.trim();
        const opt2 = document.getElementById('edit-q-opt-2').value.trim();
        const opt3 = document.getElementById('edit-q-opt-3').value.trim();
        const explanation = document.getElementById('edit-q-explanation').value.trim();

        const checkedRadio = document.querySelector('input[name="edit-q-correct"]:checked');
        const correctIndex = checkedRadio ? parseInt(checkedRadio.value) : 0;

        if (!questionText) {
            alert("Vui lòng nhập nội dung câu hỏi!");
            return;
        }

        let qId = idInput ? parseInt(idInput) : null;
        if (!qId) {
            const maxId = this.allQuestions.reduce((max, q) => Math.max(max, q.id), 0);
            qId = maxId + 1;
        }

        const oldQ = this.allQuestions.find(q => q.id === qId);
        const qType = oldQ ? oldQ.qType : 'mcq';
        const statements = oldQ ? oldQ.statements : [];
        const correctValue = oldQ ? oldQ.correctValue : undefined;
        const acceptedValues = oldQ ? oldQ.acceptedValues : undefined;

        const newQObj = {
            id: qId,
            qType: qType,
            category: category,
            question: questionText,
            options: [opt0, opt1, opt2, opt3],
            correct: correctIndex,
            statements: statements,
            correctValue: correctValue,
            acceptedValues: acceptedValues,
            explanation: explanation
        };

        // 1. Cập nhật vào mảng allQuestions
        const existingIdx = this.allQuestions.findIndex(q => q.id === qId);
        if (existingIdx !== -1) {
            this.allQuestions[existingIdx] = newQObj;
        } else {
            this.allQuestions.push(newQObj);
        }

        if (this.currentSubject === 'physics' && Array.isArray(window.PHYSICS_QUESTIONS)) {
            const wIdx = window.PHYSICS_QUESTIONS.findIndex(q => q.id === qId);
            if (wIdx !== -1) window.PHYSICS_QUESTIONS[wIdx] = newQObj;
            else window.PHYSICS_QUESTIONS.push(newQObj);
        } else if (this.currentSubject === 'geography' && Array.isArray(window.GEOGRAPHY_QUESTIONS)) {
            const wIdx = window.GEOGRAPHY_QUESTIONS.findIndex(q => q.id === qId);
            if (wIdx !== -1) window.GEOGRAPHY_QUESTIONS[wIdx] = newQObj;
            else window.GEOGRAPHY_QUESTIONS.push(newQObj);
        } else if (Array.isArray(window.QUIZ_QUESTIONS)) {
            const wIdx = window.QUIZ_QUESTIONS.findIndex(q => q.id === qId);
            if (wIdx !== -1) window.QUIZ_QUESTIONS[wIdx] = newQObj;
            else window.QUIZ_QUESTIONS.push(newQObj);
        }

        // 2. Xóa đáp án cũ của câu này để cập nhật theo đáp án mới
        if (this.userAnswers[qId] !== undefined) {
            delete this.userAnswers[qId];
        }

        // 3. Lưu vào Database
        let syncNotice = "";
        if (window.dbService && this.currentSubject === 'history') {
            const res = await window.dbService.saveQuestion(newQObj);
            if (res && res.error) {
                syncNotice = `\n\n⚠️ Lưu ý: Đã lưu trên máy bạn, máy chủ báo lỗi: ${res.error}`;
            } else if (res && res.success) {
                syncNotice = `\n\n✅ Đã đồng bộ trực tiếp lên Supabase Cloud!`;
            }
        }

        // 4. Cập nhật giao diện
        this.updateTotalQuestionDisplay();
        this.renderAdminQuestionsList();
        this.closeQuestionEditor();
        this.renderAllQuestions();
        this.updateLiveStats();

        alert(`Đã lưu Câu #${qId} thành công!${syncNotice}`);
    }

    async deleteQuestion(qId) {
        if (!confirm(`Bạn có chắc chắn muốn xóa Câu #${qId} không?`)) return;

        this.allQuestions = this.allQuestions.filter(q => q.id !== qId);
        if (this.currentSubject === 'physics' && Array.isArray(window.PHYSICS_QUESTIONS)) {
            window.PHYSICS_QUESTIONS = window.PHYSICS_QUESTIONS.filter(q => q.id !== qId);
        } else if (this.currentSubject === 'geography' && Array.isArray(window.GEOGRAPHY_QUESTIONS)) {
            window.GEOGRAPHY_QUESTIONS = window.GEOGRAPHY_QUESTIONS.filter(q => q.id !== qId);
        } else if (Array.isArray(window.QUIZ_QUESTIONS)) {
            window.QUIZ_QUESTIONS = window.QUIZ_QUESTIONS.filter(q => q.id !== qId);
        }
        delete this.userAnswers[qId];

        if (window.dbService && this.currentSubject === 'history') {
            await window.dbService.deleteQuestion(qId);
        }

        this.updateTotalQuestionDisplay();
        this.renderAdminQuestionsList();
        this.renderAllQuestions();
        this.updateLiveStats();
        alert(`Đã xóa Câu #${qId} thành công!`);
    }

    async seedDefaultQuestionsToCloud() {
        if (!confirm("Hành động này sẽ tải toàn bộ câu hỏi lên Supabase Cloud Database để mọi máy khác đều được đồng bộ. Tiếp tục?")) {
            return;
        }
        if (window.dbService) {
            const res = await window.dbService.seedInitialQuestions(this.allQuestions);
            if (res && res.error) {
                alert(`⚠️ Lỗi từ máy chủ: ${res.error}`);
            } else {
                alert(`✅ Đã lưu thành công ${this.allQuestions.length} câu hỏi lên Supabase Cloud!`);
            }
        }
    }

    /**
     * GIÁM SÁT MÁY & ĐĂNG NHẬP THỜI GIAN THỰC (KÈM CHIA 3 CỘT MÔN SỬ / MÔN LÍ / MÔN ĐỊA & CHẶN IP TỨC THÌ)
     */
    async renderAdminStudentsList() {
        const tbody = document.getElementById('admin-students-tbody');
        const badgeCount = document.getElementById('admin-badge-login-count');
        const historyListEl = document.getElementById('history-students-list');
        const historyCountEl = document.getElementById('history-active-count');
        const physicsListEl = document.getElementById('physics-students-list');
        const physicsCountEl = document.getElementById('physics-active-count');
        const geographyListEl = document.getElementById('geography-students-list');
        const geographyCountEl = document.getElementById('geography-active-count');

        if (!window.dbService) return;

        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-slate-500">Đang tải lịch sử đăng nhập thiết bị...</td></tr>';
        const list = await window.dbService.getLoginHistory(250);
        this.lastFetchedLogins = list || [];

        if (badgeCount) badgeCount.textContent = list ? list.length : 0;

        if (!list || list.length === 0) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-slate-500">Chưa có thí sinh nào đăng nhập.</td></tr>';
            if (historyListEl) historyListEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-4">Chưa có ai đang làm môn Sử.</p>';
            if (physicsListEl) physicsListEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-4">Chưa có ai đang làm môn Lí.</p>';
            if (geographyListEl) geographyListEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-4">Chưa có ai đang làm môn Địa.</p>';
            if (historyCountEl) historyCountEl.textContent = '0';
            if (physicsCountEl) physicsCountEl.textContent = '0';
            if (geographyCountEl) geographyCountEl.textContent = '0';
            return;
        }

        const bannedMap = window.dbService.getBannedIps ? window.dbService.getBannedIps() : {};

        let historyStudents = [];
        let physicsStudents = [];
        let geographyStudents = [];

        list.forEach(item => {
            const status = (item.status || "").toLowerCase();
            const summary = (item.score_summary || "").toLowerCase();
            const combined = status + " " + summary;

            // 1. ƯU TIÊN SỐ 1: MÔN ĐỊA LÍ 11
            // Chỉ duy nhất đề cương Địa có đúng 67 ý điểm (/67), hoặc có nhãn địa lí
            if (combined.includes("/67") || combined.includes("địa lí") || combined.includes("địa li") || combined.includes("dia li") || combined.includes("môn địa") || combined.includes("mon dia")) {
                geographyStudents.push(item);
            }
            // 2. ƯU TIÊN SỐ 2: MÔN VẬT LÍ 11
            // Chỉ môn Vật Lí có đúng 52 ý điểm hoặc 43 câu, hoặc từ khóa vật lí
            else if (combined.includes("/52") || combined.includes("/43") || combined.includes("vật lí") || combined.includes("vật li") || combined.includes("vat li") || combined.includes("môn lí") || combined.includes("mon li")) {
                physicsStudents.push(item);
            }
            // 3. CÒN LẠI: MÔN LỊCH SỬ 11
            else {
                historyStudents.push(item);
            }
        });

        // Lọc trùng theo Tên + IP để mỗi học sinh xuất hiện 1 card mới nhất, đúng môn đang làm
        const dedupeStudents = (arr) => {
            const seen = new Set();
            return arr.filter(item => {
                const name = (item.player_name || '').trim().toLowerCase();
                const ip = (item.ip_address || '').trim();
                const key = `${name}___${ip}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        };

        const uniqueGeo = dedupeStudents(geographyStudents);
        const uniquePhys = dedupeStudents(physicsStudents);
        const uniqueHist = dedupeStudents(historyStudents);

        if (historyCountEl) historyCountEl.textContent = uniqueHist.length;
        if (physicsCountEl) physicsCountEl.textContent = uniquePhys.length;
        if (geographyCountEl) geographyCountEl.textContent = uniqueGeo.length;

        // 1. Render Cột MÔN SỬ ĐANG CÓ AI
        if (historyListEl) {
            if (uniqueHist.length === 0) {
                historyListEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-4">Hiện chưa có ai đang làm môn Sử.</p>';
            } else {
                historyListEl.innerHTML = uniqueHist.map(st => this._buildStudentCardHTML(st, bannedMap, 'Lịch Sử')).join('');
            }
        }

        // 2. Render Cột MÔN LÍ ĐANG CÓ AI
        if (physicsListEl) {
            if (uniquePhys.length === 0) {
                physicsListEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-4">Hiện chưa có ai đang làm môn Lí.</p>';
            } else {
                physicsListEl.innerHTML = uniquePhys.map(st => this._buildStudentCardHTML(st, bannedMap, 'Vật Lí')).join('');
            }
        }

        // 3. Render Cột MÔN ĐỊA ĐANG CÓ AI
        if (geographyListEl) {
            if (uniqueGeo.length === 0) {
                geographyListEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-4">Hiện chưa có ai đang làm môn Địa.</p>';
            } else {
                geographyListEl.innerHTML = uniqueGeo.map(st => this._buildStudentCardHTML(st, bannedMap, 'Địa Lí')).join('');
            }
        }

        // 4. Render BẢNG CHI TIẾT TOÀN BỘ DANH SÁCH
        if (tbody) {
            tbody.innerHTML = '';
            list.forEach((item) => {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-slate-800/40 transition";

                let timeStr = "";
                try {
                    const d = new Date(item.last_active || item.created_at);
                    timeStr = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString('vi-VN');
                } catch (e) {
                    timeStr = "Vừa xong";
                }

                const status = item.status || "Đang làm bài";
                const isBanned = status.startsWith("BANNED") || !!bannedMap[item.ip_address];
                const banReason = isBanned ? (status.replace(/^BANNED:\s*/, "") || (bannedMap[item.ip_address]?.reason) || "Vi phạm quy chế") : "";
                const isFinished = status.includes("Đã nộp bài") || status.includes("Hoàn thành");

                // Tính toán thanh tiến độ trực quan (% hoàn thành)
                let percent = 0;
                let progressMatch = status.match(/(\d+)\/(\d+)\s*câu/i) || (item.score_summary && item.score_summary.match(/(\d+)\/(\d+)\s*ý/i));
                if (progressMatch) {
                    const cur = parseInt(progressMatch[1], 10);
                    const tot = parseInt(progressMatch[2], 10);
                    if (tot > 0) percent = Math.min(100, Math.round((cur / tot) * 100));
                } else if (isFinished) {
                    percent = 100;
                }

                const isGeoAllowed = this.allowedGeoIps && this.allowedGeoIps.includes(item.ip_address);

                tr.innerHTML = `
                    <td class="py-2.5 px-3 font-semibold text-slate-100 flex items-center gap-2">
                        <div class="w-7 h-7 rounded-lg ${isBanned ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-indigo-500/20 text-indigo-400'} flex items-center justify-center text-xs shrink-0">
                            <i class="${isBanned ? 'fa-solid fa-ban text-rose-400' : 'fa-solid fa-user'}"></i>
                        </div>
                        <div>
                            <span class="${isBanned ? 'line-through text-rose-300' : ''}">${this.escapeHtml(item.player_name || 'Khách')}</span>
                            ${isBanned ? `<span class="ml-1.5 px-1.5 py-0.2 rounded bg-rose-950 text-rose-400 border border-rose-500/50 text-[10px] font-bold">BỊ CHẶN</span>` : ''}
                        </div>
                    </td>
                    <td class="py-2.5 px-3 font-mono text-xs ${isBanned ? 'text-rose-400' : 'text-emerald-400'}">
                        <i class="fa-solid fa-network-wired text-[10px] mr-1 text-slate-500"></i>${this.escapeHtml(item.ip_address || 'Chưa rõ')}
                    </td>
                    <td class="py-2.5 px-3 text-slate-300 text-xs">
                        <i class="fa-solid fa-laptop text-[10px] mr-1 text-indigo-400"></i>${this.escapeHtml(item.device_info || 'Trình duyệt')}
                    </td>
                    <td class="py-2.5 px-3 text-center text-slate-400 text-[11px]">${timeStr}</td>
                    <td class="py-2.5 px-3">
                        ${isBanned ? `
                            <div class="p-1.5 rounded-lg bg-rose-950/60 border border-rose-500/40 text-[11px] text-rose-300">
                                <span class="font-bold">ĐÃ BỊ CHẶN:</span> ${this.escapeHtml(banReason)}
                            </div>
                        ` : `
                            <div>
                                <div class="flex items-center justify-between text-[11px] mb-1">
                                    <span class="font-bold text-slate-200">${this.escapeHtml(status)}</span>
                                    <span class="font-bold text-indigo-400 font-mono">${percent}%</span>
                                </div>
                                <div class="w-full bg-slate-700/80 rounded-full h-1.5 overflow-hidden">
                                    <div class="bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 h-full rounded-full transition-all duration-300" style="width: ${percent}%"></div>
                                </div>
                                ${item.score_summary ? `<div class="text-[10px] text-emerald-300 mt-1 font-semibold flex items-center gap-1"><i class="fa-solid fa-check text-[9px]"></i> ${this.escapeHtml(item.score_summary)}</div>` : ''}
                            </div>
                        `}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap">
                        <div class="inline-flex items-center gap-1.5">
                            <button onclick="app.adminToggleGeoIp('${item.ip_address}', ${!isGeoAllowed})" class="px-2 py-1 rounded-lg ${isGeoAllowed ? 'bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/40 text-emerald-300' : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400'} font-bold text-xs transition cursor-pointer flex items-center gap-1" title="${isGeoAllowed ? 'Hủy quyền mở môn Địa của IP này' : 'Cấp quyền mở môn Địa cho IP này'}">
                                <i class="fa-solid fa-earth-americas text-[10px]"></i> ${isGeoAllowed ? 'Đã cấp Địa' : '+ Cấp Địa'}
                            </button>
                            <button onclick="app.adminDirectNotice('${item.ip_address}', '${this.escapeHtml(item.player_name || 'Học sinh')}')" class="px-2.5 py-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/40 border border-amber-500/40 text-amber-300 font-bold text-xs transition cursor-pointer flex items-center gap-1" title="Gửi thông báo nhắc nhở riêng 5s">
                                <i class="fa-solid fa-bullhorn text-[10px]"></i> Nhắc
                            </button>
                            ${isBanned ? `
                                <button onclick="app.adminUnbanIp('${item.ip_address}')" class="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/40 text-emerald-300 font-bold text-xs transition cursor-pointer flex items-center gap-1" title="Mở khóa IP này">
                                    <i class="fa-solid fa-lock-open text-[10px]"></i> Mở Khóa
                                </button>
                            ` : `
                                <button onclick="app.adminBanIp('${item.ip_address}')" class="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/40 border border-rose-500/40 text-rose-300 font-bold text-xs transition cursor-pointer flex items-center gap-1" title="Chặn IP này ngay lập tức kèm lý do">
                                    <i class="fa-solid fa-ban text-[10px]"></i> Chặn IP
                                </button>
                            `}
                            <button onclick="app.adminDeleteLogin('${item.id}')" class="p-1.5 text-slate-500 hover:text-rose-400 transition cursor-pointer" title="Xóa bản ghi này">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        this.renderAdminIpsTabList();
    }

    /**
     * Helper tạo card cho danh sách thí sinh từng môn
     */
    _buildStudentCardHTML(item, bannedMap, subjectLabel) {
        let status = item.status || "Đang làm bài";
        const isBanned = status.startsWith("BANNED") || !!bannedMap[item.ip_address];
        const banReason = isBanned ? (status.replace(/^BANNED:\s*/, "") || (bannedMap[item.ip_address]?.reason) || "Vi phạm quy chế") : "";

        // Làm sạch hiển thị môn học nếu bị gắn nhãn cũ từ trước
        if (subjectLabel === 'Địa Lí') {
            status = status.replace(/Lịch Sử 11/g, 'Địa Lí 11');
        } else if (subjectLabel === 'Vật Lí') {
            status = status.replace(/Lịch Sử 11/g, 'Vật Lí 11');
        }

        // Trích xuất % tiến độ
        let percent = 0;
        let progressMatch = status.match(/(\d+)\/(\d+)\s*câu/i) || (item.score_summary && item.score_summary.match(/(\d+)\/(\d+)\s*ý/i));
        if (progressMatch) {
            const cur = parseInt(progressMatch[1], 10);
            const tot = parseInt(progressMatch[2], 10);
            if (tot > 0) percent = Math.min(100, Math.round((cur / tot) * 100));
        }

        // Hiển thị tóm tắt điểm nếu đã nộp bài
        let displayStatus = status;
        if (item.score_summary && (displayStatus.includes('Đã nộp bài') || displayStatus.includes('Hoàn thành'))) {
            displayStatus = `${displayStatus} - ${item.score_summary.replace(/^\[.*?\]\s*/, '')}`;
        }

        const isGeoAllowed = (this.geoMode === 'PUBLIC') || (this.allowedGeoIps && this.allowedGeoIps.includes(item.ip_address));

        return `
            <div class="p-2.5 rounded-xl ${isBanned ? 'bg-rose-950/40 border border-rose-500/40' : 'bg-slate-900/80 border border-slate-700/70'} flex items-center justify-between gap-2 transition hover:border-slate-600">
                <div class="overflow-hidden flex-1 min-w-0">
                    <div class="flex items-center gap-1.5">
                        <span class="font-bold text-xs ${isBanned ? 'line-through text-rose-300' : 'text-white'} truncate">${this.escapeHtml(item.player_name || 'Học sinh')}</span>
                        ${isBanned ? `<span class="px-1 py-0.2 rounded bg-rose-500/20 text-rose-400 text-[9px] font-bold uppercase">Bị chặn</span>` : ''}
                    </div>
                    <div class="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                        <span>IP: ${this.escapeHtml(item.ip_address || 'Chưa rõ')}</span>
                        <span>•</span>
                        <span class="truncate">${this.escapeHtml(item.device_info || 'Trình duyệt')}</span>
                    </div>
                    <!-- Thanh tiến độ bài làm trực quan -->
                    <div class="mt-1.5">
                        <div class="flex items-center justify-between text-[10px] mb-0.5">
                            <span class="text-slate-300 font-semibold truncate">${isBanned ? `Lý do: ${this.escapeHtml(banReason)}` : this.escapeHtml(displayStatus)}</span>
                            ${!isBanned ? `<span class="font-bold text-indigo-400 font-mono">${percent}%</span>` : ''}
                        </div>
                        ${!isBanned ? `
                            <div class="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                                <div class="bg-gradient-to-r from-indigo-500 to-emerald-400 h-full rounded-full" style="width: ${percent}%"></div>
                            </div>
                        ` : ''}
                    </div>
                </div>
                <div class="shrink-0 flex items-center gap-1">
                    <button onclick="app.adminToggleGeoIp('${item.ip_address}', ${!isGeoAllowed})" class="px-2 py-1 rounded-lg ${isGeoAllowed ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50' : 'bg-slate-800 text-slate-400 border border-slate-700'} text-[10px] font-bold cursor-pointer transition flex items-center gap-0.5" title="${isGeoAllowed ? 'Hủy quyền mở môn Địa' : 'Cấp quyền mở môn Địa'}">
                        <i class="fa-solid fa-earth-americas text-[9px]"></i> ${isGeoAllowed ? 'Địa' : '+Địa'}
                    </button>
                    <button onclick="app.adminDirectNotice('${item.ip_address}', '${this.escapeHtml(item.player_name || 'Học sinh')}')" class="px-2 py-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-500/40 text-[10px] font-bold cursor-pointer transition flex items-center gap-0.5" title="Gửi nhắc nhở riêng 5s">
                        <i class="fa-solid fa-bullhorn text-[9px]"></i> Nhắc
                    </button>
                    ${isBanned ? `
                        <button onclick="app.adminUnbanIp('${item.ip_address}')" class="px-2 py-1 rounded-lg bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 border border-emerald-500/50 text-[10px] font-bold cursor-pointer transition" title="Mở khóa">
                            <i class="fa-solid fa-lock-open mr-1"></i> Mở
                        </button>
                    ` : `
                        <button onclick="app.adminBanIp('${item.ip_address}')" class="px-2 py-1 rounded-lg bg-rose-600/30 hover:bg-rose-600 text-rose-200 border border-rose-500/50 text-[10px] font-bold cursor-pointer transition" title="Chặn IP ngay">
                            <i class="fa-solid fa-ban mr-1"></i> Chặn
                        </button>
                    `}
                </div>
            </div>
        `;
    }

    /**
     * Admin chặn IP thủ công từ ô nhập input
     */
    async adminBanManualIp() {
        const input = document.getElementById('admin-ban-ip-input');
        const ip = input ? input.value.trim() : "";
        if (!ip) {
            alert("Vui lòng nhập địa chỉ IP cần chặn!");
            return;
        }
        await this.adminBanIp(ip);
        if (input) input.value = '';
    }

    /**
     * Admin chặn IP kèm lý do
     */
    async adminBanIp(ipAddress) {
        if (!ipAddress) return;

        // Cảnh báo nếu Admin lỡ bấm chặn IP của chính mình
        if (ipAddress === this.clientIp) {
            if (!confirm(`⚠️ CẢNH BÁO NGUY HIỂM:\nĐây chính là địa chỉ IP của BẠN (${ipAddress})!\nNếu bạn chặn IP này, chính bạn cũng sẽ bị khóa và đá văng ngay lập tức.\nBạn có THỰC SỰ muốn tự chặn chính mình không?`)) {
                return;
            }
        }

        const reason = prompt(`Nhập lý do chặn IP [${ipAddress}]:\n(Lý do này sẽ hiển thị trực tiếp lên màn hình của học sinh bị chặn)`, "Vi phạm quy chế phòng thi / Gian lận");
        if (reason === null) return; // Người dùng ấn Hủy

        const cleanReason = reason.trim() || "Vi phạm quy chế phòng thi / Gian lận";
        try {
            await window.dbService.banIp(ipAddress, cleanReason);
            alert(`Đã CHẶN IP ${ipAddress} thành công!\nLý do: "${cleanReason}"\nThiết bị này sẽ bị khóa và đá văng ngay lập tức.`);
            await this.renderAdminStudentsList();
        } catch (err) {
            alert("Lỗi khi chặn IP: " + err.message);
        }
    }

    /**
     * Mở khóa khẩn cấp khi Admin lỡ tay tự chặn IP của chính mình
     */
    async adminEmergencyUnban() {
        const pass = prompt("Nhập mật khẩu Admin để mở khóa khẩn cấp:", "");
        if (pass === null) return;
        if (pass.trim() === this.adminSecretPass || pass.trim() === 'admin123') {
            try {
                // 1. Xóa sạch cache ban trong localStorage
                localStorage.removeItem('quiz_banned_ips');
                
                // 2. Mở khóa trên Supabase Cloud
                if (window.dbService && this.clientIp) {
                    await window.dbService.unbanIp(this.clientIp);
                }

                const modal = document.getElementById('blocked-screen');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.classList.remove('flex');
                }
                alert("Đã mở khóa khẩn cấp thành công! Trang sẽ tải lại ngay bây giờ.");
                location.reload();
            } catch (e) {
                alert("Lỗi mở khóa: " + e.message);
            }
        } else {
            alert("Mật khẩu Admin không chính xác!");
        }
    }

    /**
     * Admin mở khóa cho IP
     */
    async adminUnbanIp(ipAddress) {
        if (!confirm(`Bạn có chắc muốn MỞ KHÓA cho địa chỉ IP [${ipAddress}] không?`)) return;
        try {
            await window.dbService.unbanIp(ipAddress);
            alert(`Đã MỞ KHÓA cho IP ${ipAddress} thành công! Thí sinh có thể truy cập lại.`);
            await this.renderAdminStudentsList();
        } catch (err) {
            alert("Lỗi khi mở khóa IP: " + err.message);
        }
    }

    /**
     * PHÁT THÔNG BÁO TỚI MÀN HÌNH HỌC SINH (HIỆN NỔI BẬT 5 GIÂY)
     */
    async adminBroadcastNotice() {
        const input = document.getElementById('admin-notice-input');
        const msg = input ? input.value.trim() : "";
        if (!msg) {
            alert("Vui lòng nhập nội dung thông báo trước khi gửi!");
            return;
        }

        try {
            const res = await window.dbService.sendBroadcastNotice(msg, 'ALL');
            if (res && res.error) {
                alert("Lỗi: " + res.error);
                return;
            }
            alert(`📢 ĐÃ PHÁT THÔNG BÁO TỚI TOÀN BỘ PHÒNG THI:\n"${msg}"\n\nThông báo sẽ tự động bật lên trước màn hình mọi thí sinh đúng 5 giây!`);
            if (input) input.value = '';
        } catch (e) {
            alert("Lỗi khi phát thông báo: " + e.message);
        }
    }

    /**
     * Gửi mẫu thông báo nhanh có sẵn
     */
    async adminQuickNotice(text) {
        const input = document.getElementById('admin-notice-input');
        if (input) input.value = text;
        if (!confirm(`Phát ngay thông báo này tới toàn bộ học sinh (bật trước màn hình 5s)?\n\n"${text}"`)) return;

        try {
            const res = await window.dbService.sendBroadcastNotice(text, 'ALL');
            if (res && res.error) {
                alert("Lỗi: " + res.error);
                return;
            }
            alert(`📢 ĐÃ PHÁT THÔNG BÁO THÀNH CÔNG:\n"${text}"`);
            if (input) input.value = '';
        } catch (e) {
            alert("Lỗi khi phát thông báo: " + e.message);
        }
    }

    /**
     * Gửi thông báo riêng đến 1 học sinh cụ thể (Hiện 5s trên máy bạn đó)
     */
    async adminDirectNotice(ipAddress, studentName) {
        if (!ipAddress) return;
        const msg = prompt(`Gửi thông báo riêng đến thí sinh [${studentName}] (IP: ${ipAddress}):\n(Thông báo sẽ hiện nổi bật trên màn hình của bạn này trong 5 giây)`, "Em tập trung làm bài, nghiêm túc!");
        if (msg === null) return;
        const cleanMsg = msg.trim();
        if (!cleanMsg) return;

        try {
            const res = await window.dbService.sendBroadcastNotice(cleanMsg, ipAddress);
            if (res && res.error) {
                alert("Lỗi: " + res.error);
                return;
            }
            alert(`💬 Đã gửi thông báo riêng tới [${studentName}]!\n"${cleanMsg}"`);
        } catch (e) {
            alert("Lỗi khi gửi thông báo: " + e.message);
        }
    }

    async adminDeleteLogin(loginId) {
        if (!confirm("Xóa bản ghi đăng nhập này khỏi danh sách?")) return;
        if (window.dbService) {
            await window.dbService.deleteLoginRecord(loginId);
            this.renderAdminStudentsList();
        }
    }

    async adminClearAllLogins() {
        if (!confirm("CẢNH BÁO: Bạn có chắc chắn muốn xóa TOÀN BỘ nhật ký thiết bị đăng nhập không?")) return;
        if (window.dbService) {
            await window.dbService.clearAllLogins();
            this.renderAdminStudentsList();
            alert("Đã làm sạch toàn bộ lịch sử đăng nhập!");
        }
    }

    openSettingsModal() {
        const modal = document.getElementById('modal-settings');
        const urlInput = document.getElementById('supabase-url-input');
        const keyInput = document.getElementById('supabase-key-input');

        if (window.dbService) {
            const config = window.dbService.getConfig();
            if (urlInput) urlInput.value = config.url || '';
            if (keyInput) keyInput.value = config.anonKey || '';
        }

        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    }

    closeSettingsModal() {
        const modal = document.getElementById('modal-settings');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    saveSupabaseConfig() {
        const urlInput = document.getElementById('supabase-url-input');
        const keyInput = document.getElementById('supabase-key-input');

        const url = urlInput ? urlInput.value.trim() : '';
        const key = keyInput ? keyInput.value.trim() : '';

        if (!url || !key) {
            alert("Vui lòng điền đầy đủ Supabase URL và Anon Public Key.");
            return;
        }

        try {
            window.dbService.saveConfig(url, key);
            alert("Đã lưu cấu hình Supabase thành công!");
            this.closeSettingsModal();
        } catch (e) {
            alert("Lỗi: " + e.message);
        }
    }

    clearSupabaseConfig() {
        if (window.confirm("Bạn có muốn xóa kết nối Supabase và chuyển sang lưu trữ LocalStorage không?")) {
            window.dbService.clearConfig();
            this.closeSettingsModal();
        }
    }

    openGeographyEssayModal() {
        const modal = document.getElementById('modal-geography-essay');
        const container = document.getElementById('geography-essay-content');
        if (!modal || !container) return;

        if (window.GEOGRAPHY_ESSAY_OUTLINES) {
            container.innerHTML = window.GEOGRAPHY_ESSAY_OUTLINES.map((item, idx) => `
                <div class="p-4 rounded-xl bg-slate-800/90 border border-emerald-500/30 shadow-md space-y-2">
                    <h4 class="font-bold text-emerald-400 text-sm sm:text-base flex items-center gap-2">
                        <span class="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-300 text-xs flex items-center justify-center font-bold shrink-0">${idx + 1}</span>
                        <span>${this.escapeHtml(item.title)}</span>
                    </h4>
                    <div class="text-xs sm:text-sm text-slate-300 leading-relaxed whitespace-pre-line pl-3 border-l-2 border-emerald-500/40">
                        ${item.content.trim()}
                    </div>
                </div>
            `).join('');
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    closeGeographyEssayModal() {
        const modal = document.getElementById('modal-geography-essay');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    /**
     * Đồng bộ và kiểm tra quyền truy cập môn Địa Lí 11
     */
    async refreshGeographyAccess() {
        if (!window.dbService) return;

        try {
            const config = await window.dbService.fetchGeoConfig();
            this.geoMode = config.mode || 'PRIVATE';
            this.allowedGeoIps = config.ips || [];
        } catch (e) {
            this.allowedGeoIps = this.allowedGeoIps || [];
            this.geoMode = this.geoMode || 'PRIVATE';
        }

        const tabBtn = document.getElementById('tab-btn-geography');
        const isLocalUnlocked = localStorage.getItem('quiz_geo_manual_unlocked') === 'true';
        const hasIpAccess = this.clientIp && this.allowedGeoIps && this.allowedGeoIps.includes(this.clientIp);

        // Nếu là PUBLIC thì TẤT CẢ mọi học sinh đều vào được; nếu là PRIVATE thì phải qua IP hoặc Admin
        const isAllowed = (this.geoMode === 'PUBLIC') || this.isAdmin || isLocalUnlocked || hasIpAccess;

        if (tabBtn) {
            if (isAllowed) {
                tabBtn.classList.remove('hidden');
            } else {
                tabBtn.classList.add('hidden');
                // Nếu đang chọn môn Địa mà bị thu hồi quyền hoặc đổi chế độ thì quay lại môn Sử
                if (this.currentSubject === 'geography') {
                    this.selectSubject('history');
                }
            }
        }

        this.updateAdminGeoModeUI();
        this.renderAdminGeoIpBadges();
        this.renderAdminIpsTabList();
    }

    /**
     * Admin đổi chế độ Môn Địa Lí 11: PUBLIC (Công khai) hoặc PRIVATE (Ẩn theo IP)
     */
    async adminSetGeoMode(mode) {
        const cleanMode = (mode === 'PUBLIC') ? 'PUBLIC' : 'PRIVATE';
        this.geoMode = cleanMode;

        if (window.dbService) {
            await window.dbService.setGeoMode(cleanMode);
        }

        this.updateAdminGeoModeUI();
        await this.refreshGeographyAccess();

        if (cleanMode === 'PUBLIC') {
            alert("ĐÃ BẬT CHẾ ĐỘ PUBLIC (CÔNG KHAI)!\nTất cả học sinh ở mọi máy đều có thể nhìn thấy nút Môn Địa Lí 11 và làm bài bình thường.");
        } else {
            alert("ĐÃ BẬT CHẾ ĐỘ ẨN (RIÊNG TƯ)!\nMôn Địa Lí 11 đã bị ẩn. Chỉ những máy có địa chỉ IP trong danh sách được cấp phép mới nhìn thấy môn Địa.");
        }
    }

    /**
     * Cập nhật giao diện chuyển đổi chế độ trong Admin Tab 3
     */
    updateAdminGeoModeUI() {
        const isPublic = this.geoMode === 'PUBLIC';
        const badge = document.getElementById('admin-geo-current-mode-badge');
        const pill = document.getElementById('admin-geo-mode-pill');
        const cardPrivate = document.getElementById('admin-mode-card-private');
        const cardPublic = document.getElementById('admin-mode-card-public');
        const indPrivate = document.getElementById('admin-mode-indicator-private');
        const indPublic = document.getElementById('admin-mode-indicator-public');

        if (badge) {
            if (isPublic) {
                badge.className = "px-2.5 py-1 rounded-full text-[11px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40";
                badge.innerHTML = '<i class="fa-solid fa-globe mr-1"></i> 🌐 ĐANG CÔNG KHAI (Mọi người đều thấy)';
            } else {
                badge.className = "px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40";
                badge.innerHTML = '<i class="fa-solid fa-lock mr-1"></i> 🔒 ĐANG ẨN (Chỉ IP Được Cấp Mới Thấy)';
            }
        }

        if (pill) {
            if (isPublic) {
                pill.className = "px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 text-[10px] uppercase font-bold tracking-wider border border-sky-500/30";
                pill.textContent = "Công Khai";
            } else {
                pill.className = "px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] uppercase font-bold tracking-wider border border-amber-500/30";
                pill.textContent = "Đang Ẩn";
            }
        }

        if (cardPrivate && cardPublic) {
            if (isPublic) {
                // Public active
                cardPublic.className = "p-3.5 rounded-xl border-2 cursor-pointer transition flex items-start gap-3 bg-sky-950/40 border-sky-500 text-white shadow-md";
                cardPrivate.className = "p-3.5 rounded-xl border-2 cursor-pointer transition flex items-start gap-3 bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700";
                if (indPublic) indPublic.className = "w-2.5 h-2.5 rounded-full bg-sky-400 shadow-sm shadow-sky-400";
                if (indPrivate) indPrivate.className = "w-2.5 h-2.5 rounded-full bg-transparent";
            } else {
                // Private active
                cardPrivate.className = "p-3.5 rounded-xl border-2 cursor-pointer transition flex items-start gap-3 bg-emerald-950/40 border-emerald-500 text-white shadow-md";
                cardPublic.className = "p-3.5 rounded-xl border-2 cursor-pointer transition flex items-start gap-3 bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700";
                if (indPrivate) indPrivate.className = "w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400";
                if (indPublic) indPublic.className = "w-2.5 h-2.5 rounded-full bg-transparent";
            }
        }
    }

    /**
     * Mở popup cho thí sinh hoặc Admin nhập mật khẩu hoặc IP để mở môn Địa
     */
    async promptUnlockGeography() {
        const myIp = this.clientIp || "Đang lấy...";
        const input = prompt(`MÔN ĐỊA LÍ 11 ĐANG ĐƯỢC BẢO VỆ\n\nĐịa chỉ IP máy bạn: ${myIp}\n\nNhập mật mã mở khóa (hoặc yêu cầu Admin cấp phép cho IP trên):`);
        if (!input) return;

        const val = input.trim();
        const isSecret = (val === '034569' || val === 'admin123');
        const isWhitelisted = this.allowedGeoIps && (this.allowedGeoIps.includes(val) || (this.clientIp && this.allowedGeoIps.includes(this.clientIp)));

        if (isSecret || isWhitelisted) {
            localStorage.setItem('quiz_geo_manual_unlocked', 'true');
            if (this.clientIp && isSecret && window.dbService) {
                await window.dbService.addGeoAllowedIp(this.clientIp);
            }
            await this.refreshGeographyAccess();
            this.selectSubject('geography');
            alert("Chúc mừng! Đã mở khóa thành công môn Địa Lí 11.");
        } else {
            alert(`Mật mã không đúng hoặc IP [${myIp}] chưa được Admin cấp phép!\nVui lòng gửi địa chỉ IP của bạn cho Admin để được cấp quyền.`);
        }
    }

    /**
     * Admin thêm IP vào danh sách được mở môn Địa
     */
    async adminAddGeoIp(ipToAdd) {
        const inputEl = document.getElementById('admin-geo-ip-input');
        const ip = (ipToAdd || (inputEl ? inputEl.value : '')).trim();

        if (!ip) {
            alert("Vui lòng nhập địa chỉ IP hợp lệ.");
            return;
        }

        if (window.dbService) {
            this.allowedGeoIps = await window.dbService.addGeoAllowedIp(ip);
            if (inputEl) inputEl.value = '';
            this.updateAdminGeoModeUI();
            this.renderAdminGeoIpBadges();
            this.renderAdminIpsTabList();
            if (this.lastFetchedLogins) {
                this.renderAdminStudentsList(this.lastFetchedLogins);
            }
        }
    }

    /**
     * Admin xóa IP khỏi danh sách mở môn Địa
     */
    async adminRemoveGeoIp(ipToRemove) {
        if (!ipToRemove) return;
        if (confirm(`Bạn có chắc muốn hủy quyền mở môn Địa của IP: ${ipToRemove}?`)) {
            if (window.dbService) {
                this.allowedGeoIps = await window.dbService.removeGeoAllowedIp(ipToRemove);
                this.updateAdminGeoModeUI();
                this.renderAdminGeoIpBadges();
                this.renderAdminIpsTabList();
                if (this.lastFetchedLogins) {
                    this.renderAdminStudentsList(this.lastFetchedLogins);
                }
            }
        }
    }

    /**
     * Admin cấp nhanh quyền cho IP của máy đang thao tác
     */
    async adminAuthorizeCurrentIp() {
        if (!this.clientIp || this.clientIp === "Chưa xác định" || this.clientIp === "IP Cục Bộ") {
            alert("Chưa lấy được địa chỉ IP của máy bạn. Vui lòng kiểm tra lại kết nối mạng.");
            return;
        }
        await this.adminAddGeoIp(this.clientIp);
        alert(`Đã cấp quyền mở môn Địa thành công cho IP máy này: ${this.clientIp}`);
    }

    /**
     * Admin bật/tắt quyền môn Địa trực tiếp từ bảng giám sát học sinh
     */
    async adminToggleGeoIp(ip, allow) {
        if (!ip || ip === 'Chưa rõ') return;
        if (window.dbService) {
            if (allow) {
                this.allowedGeoIps = await window.dbService.addGeoAllowedIp(ip);
            } else {
                this.allowedGeoIps = await window.dbService.removeGeoAllowedIp(ip);
            }
            this.updateAdminGeoModeUI();
            this.renderAdminGeoIpBadges();
            this.renderAdminIpsTabList();
            if (this.lastFetchedLogins) {
                this.renderAdminStudentsList(this.lastFetchedLogins);
            }
        }
    }

    /**
     * Admin xóa toàn bộ IP được cấp quyền mở môn Địa
     */
    async adminClearAllGeoIps() {
        if (!confirm("Bạn có chắc chắn muốn xóa TẤT CẢ các IP đã cấp quyền môn Địa không?\n(Môn Địa Lí 11 sẽ bị ẩn trên tất cả các máy)")) return;
        if (window.dbService) {
            this.allowedGeoIps = await window.dbService.saveAllowedGeoIps([]);
            this.updateAdminGeoModeUI();
            this.renderAdminGeoIpBadges();
            this.renderAdminIpsTabList();
            if (this.lastFetchedLogins) {
                this.renderAdminStudentsList(this.lastFetchedLogins);
            }
            alert("Đã xóa toàn bộ danh sách IP được cấp quyền.");
        }
    }

    /**
     * Hiển thị danh sách badge IP được cấp quyền mở môn Địa trong Admin
     */
    renderAdminGeoIpBadges() {
        const container = document.getElementById('admin-geo-ip-badges');
        const countEl = document.getElementById('admin-geo-ip-count');
        const badgeCountEl = document.getElementById('admin-badge-geo-count');
        const ips = this.allowedGeoIps || [];

        if (countEl) countEl.textContent = ips.length;
        if (badgeCountEl) badgeCountEl.textContent = ips.length;
        if (!container) return;

        if (ips.length === 0) {
            container.innerHTML = '<span class="text-xs text-slate-500 italic">Chưa có IP nào trong danh sách. Chỉ Admin mới thấy môn Địa. Hãy nhập IP của học sinh bên trên để cấp quyền.</span>';
            return;
        }

        container.innerHTML = ips.map(ip => `
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 font-mono text-xs shadow-sm">
                <i class="fa-solid fa-earth-americas text-[10px]"></i>
                <span>${this.escapeHtml(ip)}</span>
                <button onclick="app.adminRemoveGeoIp('${ip}')" class="text-slate-400 hover:text-rose-400 cursor-pointer ml-1 text-[11px] transition" title="Xóa IP này khỏi danh sách">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </span>
        `).join('');
    }

    /**
     * Hiển thị bảng thí sinh với nút gạt cấp quyền nhanh trong Tab 3
     */
    renderAdminIpsTabList() {
        const tbody = document.getElementById('admin-ips-students-table');
        if (!tbody) return;

        const list = this.lastFetchedLogins || [];
        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-slate-500 italic">Chưa có dữ liệu thí sinh đăng nhập. Khi có học sinh vào phòng, danh sách sẽ hiển thị tại đây để Admin cấp quyền nhanh bằng 1 cú nhấp chuột.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        list.forEach(item => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-800/40 transition";

            const ip = item.ip_address || "Chưa rõ";
            const isAllowed = this.allowedGeoIps && this.allowedGeoIps.includes(ip);

            tr.innerHTML = `
                <td class="py-2.5 px-3 font-semibold text-slate-100 flex items-center gap-2">
                    <div class="w-7 h-7 rounded-lg ${isAllowed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'} flex items-center justify-center text-xs shrink-0 font-bold">
                        <i class="fa-solid fa-user"></i>
                    </div>
                    <span>${this.escapeHtml(item.player_name || 'Khách')}</span>
                </td>
                <td class="py-2.5 px-3 font-mono text-xs text-indigo-300">
                    ${this.escapeHtml(ip)}
                </td>
                <td class="py-2.5 px-3 text-slate-400 text-xs truncate max-w-[140px]">
                    ${this.escapeHtml(item.device_info || 'Trình duyệt')}
                </td>
                <td class="py-2.5 px-3 text-center">
                    ${isAllowed ? `
                        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold">
                            <i class="fa-solid fa-check"></i> ĐÃ CẤP QUYỀN
                        </span>
                    ` : `
                        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 text-[11px]">
                            <i class="fa-solid fa-lock"></i> Chưa cấp
                        </span>
                    `}
                </td>
                <td class="py-2.5 px-3 text-right">
                    ${isAllowed ? `
                        <button onclick="app.adminToggleGeoIp('${ip}', false)" class="px-3 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/40 text-xs font-bold transition cursor-pointer flex items-center gap-1 ml-auto">
                            <i class="fa-solid fa-xmark"></i> Thu Hồi Quyền
                        </button>
                    ` : `
                        <button onclick="app.adminToggleGeoIp('${ip}', true)" class="px-3 py-1 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold transition cursor-pointer flex items-center gap-1 shadow-md shadow-emerald-900/20 ml-auto">
                            <i class="fa-solid fa-plus"></i> + Cấp Quyền Địa
                        </button>
                    `}
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    escapeHtml(text) {
        if (!text) return "";
        const clean = String(text).normalize('NFC');
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return clean.replace(/[&<>"']/g, m => map[m]);
    }
}

// Khởi tạo ứng dụng sau khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
    window.app = new QuizApp();
});
