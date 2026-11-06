/**
 *  Hệ Thống Ôn Thi Trực Tuyến Toàn Diện
 * Tự động hóa toàn bộ: Phân quyền IP Admin, Đa môn học động, Nạp đề Word/Excel,
 * Xuất điểm Excel, Bảng xếp hạng Top 10, Chế độ bảo trì, Luyện tập vs Thi thử.
 */

class QuizApp {
    constructor() {
        // Môn học & Đa môn học động (Ghi nhớ môn đã chọn gần nhất)
        this.currentSubject = localStorage.getItem('quiz_last_selected_subject') || 'history';
        this.homeGradeFilter = 'all';
        this.dynamicSubjects = [];

        // Thông tin người học & Thiết bị & IP
        this.playerName = "";
        this.clientIp = "Đang nhận diện...";
        this.deviceInfo = this.detectDevice();
        this.currentLoginId = null;
        this.presenceHeartbeatAt = 0;

        // Đồng hồ bấm giờ (Luyện tập: Đếm tiến / Thi thử: Đếm ngược)
        this.secondsElapsed = 0;
        this.timerInterval = null;
        this.isExamMode = false;
        this.examMinutes = 45;
        this.examSecondsRemaining = 45 * 60;

        // Âm thanh Ting / Bíp (Web Audio API)
        this.soundEnabled = localStorage.getItem('quiz_sound_enabled') !== 'false';

        // Dữ liệu câu hỏi & Đáp án người dùng
        this.allQuestions = [];
        this.userAnswers = {};      // { [qId]: selectedIndex hoặc { [stmtIdx]: boolean } hoặc string }
        this.currentFilter = 'all';

        // Quyền Quản trị viên (Ghi nhớ vĩnh viễn trên thiết bị & Whitelist IP Cloud)
        // Quyền Admin chỉ hợp lệ khi IP hiện tại có trong whitelist Cloud.
        // Không dùng localStorage làm quyền truy cập vì người dùng có thể xóa/sửa giá trị này.
        this.isAdminAuthenticated = false;
        this.adminCurrentTab = 'questions';
        this.adminSecretPass = '034569';
        this.allowedAdminIps = [];
        this.masterAdminIp = '';

        // Phân quyền sử dụng Trợ lý AI theo địa chỉ IP
        this.allowedAiIps = [];

        // Danh sách các IP đang bị chặn (Banned IPs)
        this.bannedIpsList = [];

        // Phân quyền môn Địa Lí (hoặc các môn Private)
        this.allowedGeoIps = [];
        this.geoMode = 'PRIVATE';
        this.class5AllowedIps = [];

        // Chế độ bảo trì hệ thống (Maintenance Mode)
        this.isMaintenanceMode = false;
        this.maintenanceMessage = "Trang web đang tạm dừng để cập nhật đề cương và dữ liệu mới. Vui lòng quay lại sau!";
        this.maintenanceClickCount = 0;
        this.maintenanceClickTimer = null;
        this._maintenanceKeyBlocker = null;

        // Dữ liệu bóc tách từ bộ nạp đề
        this.parsedImportQuestions = [];

        // Tiện ích Debounce tối ưu hiệu năng chống giật lag
        this.debouncedSearchAdminQuestions = this.debounce(() => {
            this.renderAdminQuestionsList();
        }, 300);

        this.debouncedCacheLocalQuestions = this.debounce(() => {
            try {
                localStorage.setItem(`quiz_cache_${this.currentSubject}`, JSON.stringify(this.allQuestions));
            } catch (ce) {}
        }, 400);

        this.debouncedSaveSingleQuestion = this.debounce(async (q) => {
            try {
                if (window.dbService && typeof window.dbService.saveQuestion === 'function') {
                    await window.dbService.saveQuestion(q, this.currentSubject);
                }
            } catch (e) {
                console.warn("Lỗi lưu đơn lẻ câu hỏi:", e);
            }
        }, 300);

        // Chuẩn hóa Model Gemini về danh sách model đang được hỗ trợ.
        const savedModel = localStorage.getItem('gemini_model');
        const supportedGeminiModels = ['gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.0-flash'];
        if (!supportedGeminiModels.includes(savedModel)) {
            localStorage.setItem('gemini_model', supportedGeminiModels[0]);
        }
        this.selectedGeminiModel = supportedGeminiModels.includes(savedModel) ? savedModel : supportedGeminiModels[0];

        // Cache màn hình
        this.screens = {
            home: document.getElementById('screen-home'),
            quiz: document.getElementById('screen-quiz'),
            result: document.getElementById('screen-result')
        };

        this.init();
    }

    /**
     * Tiện ích Debounce tối ưu hiệu năng
     */
    debounce(func, wait) {
        let timeout;
        return function (...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }

    showToastNotification(msg, type = 'info') {
        if (typeof this.showNetworkToast === 'function') {
            this.showNetworkToast(msg, type);
        } else {
            console.log(msg);
        }
    }

    /**
     * Khởi tạo toàn bộ ứng dụng
     */
    async init() {
        this.initTheme();
        this.initNetworkListeners();
        this.initEventListeners();
        this.updateSoundIcons();
        await this.loadBannedIpsList();
        await this.loadDynamicSubjects();
        await this.fetchClientIp();
        await this.syncClass5Access();
        this.checkSavedUser();
        await this.loadAiIpsConfig();
        await this.loadQuestionsForCurrentSubject();
        this.updateTotalQuestionDisplay();
        await this.initMaintenance();
        this.startRealtimeHeartbeat();
    }

    /* ============================================================== */
    /* 1. QUẢN LÝ ĐA MÔN HỌC ĐỘNG (DYNAMIC SUBJECTS HUB)               */
    /* ============================================================== */

    getDefaultSubjects() {
        return [
            {
                id: 'history',
                key: 'history',
                name: 'Lịch Sử 11',
                semester: 'Giữa Kì 1',
                icon: 'fa-landmark',
                gradient: 'indigo',
                visibility: 'PUBLIC',
                count: 74
            },
            {
                id: 'physics',
                key: 'physics',
                name: 'Vật Lí 11',
                semester: 'Giữa Kì 1',
                icon: 'fa-atom',
                gradient: 'purple',
                visibility: 'PUBLIC',
                count: 43
            },
            {
                id: 'geography',
                key: 'geography',
                name: 'Địa Lí 11',
                semester: 'Giữa Kì 1',
                icon: 'fa-earth-americas',
                gradient: 'emerald',
                visibility: 'PRIVATE',
                count: 52
            }
        ];
    }

    async loadDynamicSubjects() {
        let loaded = [];
        let cloudAvailable = false;
        try {
            if (window.dbService && typeof window.dbService.fetchDynamicSubjects === 'function') {
                loaded = await window.dbService.fetchDynamicSubjects();
                cloudAvailable = Boolean(window.dbService.isSupabaseActive);
            }
        } catch (e) {
            console.warn("Không thể tải môn học từ cloud, dùng dữ liệu mặc định:", e);
        }

        if ((!Array.isArray(loaded) || loaded.length === 0) && (!navigator.onLine || !cloudAvailable)) {
            const cached = localStorage.getItem('quiz_dynamic_subjects');
            if (cached) {
                try { loaded = JSON.parse(cached); } catch (e) { }
            }
        }

        // Không tự tạo môn mẫu: chỉ hiển thị những môn Admin đã lưu trên Cloud.
        if (!Array.isArray(loaded)) loaded = [];

        this.dynamicSubjects = loaded;
        localStorage.setItem('quiz_dynamic_subjects', JSON.stringify(loaded));

        this.renderHomeSubjects();
        this.populateSubjectDropdowns();
    }

    getSubjectGrade(subject) {
        const explicitGrade = String(subject?.grade || subject?.class || subject?.grade_level || '').match(/5|11/);
        if (explicitGrade) return explicitGrade[0];

        const source = `${subject?.key || ''} ${subject?.name || subject?.title || ''}`;
        const gradeMatch = source.match(/(?:^|[^0-9])(5|11)(?:$|[^0-9])/);
        // Môn không có metadata cũ được coi là Lớp 11 để hệ thống chỉ còn hai lớp cố định.
        return gradeMatch ? gradeMatch[1] : '11';
    }

    canViewGrade5() {
        const currentIp = String(this.clientIp || '').trim();
        return Boolean(
            this.isAdminAuthenticated ||
            (currentIp && !currentIp.startsWith('Đang') && this.class5AllowedIps.includes(currentIp))
        );
    }

    getHomeGradeFilter() {
        return ['all', '5', '11'].includes(this.homeGradeFilter) ? this.homeGradeFilter : 'all';
    }

    getHomeVisibleSubjects() {
        const canViewGrade5 = this.canViewGrade5();
        const currentIp = String(this.clientIp || '').trim();
        const canViewPrivateByIp = this.allowedGeoIps.includes(currentIp);
        const allowedSubjects = (this.dynamicSubjects || []).filter((sub) => {
            const grade = this.getSubjectGrade(sub);
            const canViewGrade = grade === '11' || (grade === '5' && canViewGrade5);
            const visibility = String(sub.visibility || '').toUpperCase();
            const isPrivate = visibility === 'PRIVATE' || visibility === 'HIDDEN' || sub.is_public === false;
            const canViewPrivate = this.isAdminAuthenticated || canViewPrivateByIp || (grade === '5' && canViewGrade5);
            return canViewGrade && (!isPrivate || canViewPrivate);
        });
        const filter = this.getHomeGradeFilter();
        return filter === 'all'
            ? allowedSubjects
            : allowedSubjects.filter((sub) => this.getSubjectGrade(sub) === filter);
    }

    async syncClass5Access() {
        try {
            if (window.dbService && typeof window.dbService.fetchGeoConfig === 'function') {
                const config = await window.dbService.fetchGeoConfig();
                this.allowedGeoIps = Array.isArray(config?.ips) ? config.ips : [];
                this.class5AllowedIps = Array.isArray(config?.grade5Ips) ? config.grade5Ips : [];
                this.geoMode = config?.mode || 'PUBLIC';
            }
        } catch (error) {
            this.allowedGeoIps = [];
            this.class5AllowedIps = [];
            console.warn('Không thể tải quyền truy cập Lớp 5:', error);
        }

        this.homeGradeFilter = this.getHomeGradeFilter();
        this.renderHomeSubjects();
    }

    renderHomeSubjects() {
        const grid = document.getElementById('home-subjects-grid');
        if (!grid) return;

        const visibleSubjects = this.getHomeVisibleSubjects();
        const activeGrade = this.getHomeGradeFilter();
        const tabs = document.getElementById('home-semester-tabs');
        if (tabs) {
            tabs.innerHTML = ['all', '5', '11'].map((grade) => {
                    const label = grade === 'all' ? 'Tất cả' : `Lớp ${grade}`;
                    const active = activeGrade === grade;
                    const locked = grade === '5' && !this.isAdminAuthenticated && !this.canViewGrade5();
                    return `<button type="button" class="home-grade-tab ${active ? 'is-active' : ''} ${locked ? 'is-locked' : ''}" data-grade-filter="${grade}" ${locked ? 'disabled title="Lớp 5 chưa được cấp quyền"' : ''}>${locked ? '<i class="fa-solid fa-lock"></i>' : ''}${label}</button>`;
                }).join('');
            tabs.querySelectorAll('[data-grade-filter]:not(:disabled)').forEach((button) => {
                button.addEventListener('click', () => {
                    this.homeGradeFilter = button.dataset.gradeFilter;
                    this.renderHomeSubjects();
                });
            });
        }

        // Nếu môn đang chọn hiện tại bị ẩn, tự động chuyển sang môn công khai đầu tiên
        if (visibleSubjects.length > 0 && !visibleSubjects.some(s => s.key === this.currentSubject)) {
            this.currentSubject = visibleSubjects[0].key;
            localStorage.setItem('quiz_last_selected_subject', this.currentSubject);
            this.loadQuestionsForCurrentSubject();
        }

        // Nếu tất cả các môn đều bị ẩn -> Hiện thông báo "Không có bài nào gần đây"
        if (visibleSubjects.length === 0) {
            grid.innerHTML = `
                <div class="col-span-full py-8 px-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-2">
                    <div class="w-12 h-12 rounded-2xl bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto text-xl border border-slate-700 shadow-sm">
                        <i class="fa-solid fa-folder-open"></i>
                    </div>
                    <p class="font-bold text-slate-200 text-sm">Chưa có môn ${activeGrade === 'all' ? 'nào' : `Lớp ${activeGrade}`} được mở</p>
                    <p class="text-xs text-slate-400 max-w-sm mx-auto">Hiện chưa có đề cương ôn tập nào dành cho khu vực này. Vui lòng quay lại sau!</p>
                </div>
            `;
            this.updateNavbarAndBadge();
            return;
        }

        const fragment = document.createDocumentFragment();

        visibleSubjects.forEach(sub => {
            const isSelected = this.currentSubject === sub.key;
            const subName = sub.name || (sub.key === 'physics' ? 'Vật Lí 11' : (sub.key === 'geography' ? 'Địa Lí 11' : 'Lịch Sử 11'));
            const card = document.createElement('button');
            card.type = 'button';
            card.onclick = () => this.selectSubject(sub.key);

            let grad = sub.gradient || 'indigo';
            let iconColorClass = "bg-indigo-600/30 text-indigo-300 border-indigo-500/30";
            if (grad === 'purple') iconColorClass = "bg-purple-600/30 text-purple-300 border-purple-500/30";
            else if (grad === 'emerald') iconColorClass = "bg-emerald-600/30 text-emerald-300 border-emerald-500/30";
            else if (grad === 'rose') iconColorClass = "bg-rose-600/30 text-rose-300 border-rose-500/30";
            else if (grad === 'amber') iconColorClass = "bg-amber-600/30 text-amber-300 border-amber-500/30";

            card.className = `p-3.5 rounded-2xl text-left flex flex-col justify-between cursor-pointer subject-card-interactive transition-all relative min-h-[118px] ${isSelected ? 'selected-' + grad : 'hover:border-slate-600'}`;
            card.innerHTML = `
                <!-- Hàng 1: Icon môn học và Badge trạng thái -->
                <div class="flex items-center justify-between gap-2 mb-2 w-full">
                    <div class="w-10 h-10 rounded-xl ${iconColorClass} border flex items-center justify-center text-lg shrink-0 shadow-md">
                        <i class="fa-solid ${sub.icon || 'fa-book'}"></i>
                    </div>
                    ${isSelected ? '<span class="text-[10px] px-2.5 py-1 rounded-full bg-indigo-500/30 text-indigo-200 border border-indigo-400/50 font-bold flex items-center gap-1 shrink-0 shadow-sm"><i class="fa-solid fa-check text-[9px]"></i> Đã chọn</span>' : ''}
                </div>
                <!-- Hàng 2: Tên môn học -->
                <div class="w-full mb-2">
                    <p class="font-heading font-extrabold text-sm sm:text-base text-white leading-snug break-words">${subName}</p>
                </div>
                <!-- Hàng 3: Học kỳ và Chữ số lượng câu hỏi -->
                <div class="flex items-center justify-between gap-1 text-[11px] text-slate-400 w-full pt-2 border-t border-slate-800/80 mt-auto">
                    <span class="px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300 font-medium text-[10px] truncate max-w-[80px]">${sub.semester || 'Đề cương'}</span>
                    <span class="text-amber-400 font-bold text-xs shrink-0 whitespace-nowrap"><i class="fa-solid fa-bolt text-[10px] mr-1"></i>${sub.count || 0} câu</span>
                </div>
            `;
            fragment.appendChild(card);
        });

        grid.innerHTML = '';
        grid.appendChild(fragment);
        this.updateNavbarAndBadge();
    }

    populateSubjectDropdowns() {
        const dropdownIds = ['admin-subject-select', 'importer-subject-select', 'leaderboard-subject-select', 'edit-q-subject'];
        dropdownIds.forEach(id => {
            const select = document.getElementById(id);
            if (!select) return;
            const currentVal = select.value || this.currentSubject;
            select.innerHTML = '';
            this.dynamicSubjects.forEach(sub => {
                const opt = document.createElement('option');
                opt.value = sub.key;
                opt.textContent = `${sub.name} (${sub.semester || 'Học kỳ'})`;
                if (sub.key === currentVal) opt.selected = true;
                select.appendChild(opt);
            });
        });
    }

    updateNavbarAndBadge() {
        const visibleSubjects = this.getHomeVisibleSubjects();

        const navTitle = document.getElementById('navbar-subject-title');
        const navSub = document.getElementById('navbar-subject-subtitle');
        const badge = document.getElementById('home-subject-badge');
        const topTitle = document.getElementById('quiz-top-subject-title');

        if (visibleSubjects.length === 0) {
            if (badge) badge.textContent = 'Không có bài nào gần đây';
            if (navTitle) navTitle.textContent = 'Ôn tập';
            if (navSub) navSub.textContent = 'Hiện chưa có bài ôn tập nào được mở';
            return;
        }

        const sub = visibleSubjects.find(s => s.key === this.currentSubject) || visibleSubjects[0];
        const name = sub ? sub.name : this.getSubjectTitle();
        const count = this.allQuestions ? this.allQuestions.length : 0;
        const semester = sub ? sub.semester : 'Giữa Kì 1';

        if (navTitle) navTitle.textContent = 'Ôn tập';
        if (navSub) navSub.textContent = `Hệ Thống Ôn Luyện Thông Minh • ${name}`;
        if (badge) badge.textContent = `${name} (${count} câu)`;
        if (topTitle) topTitle.textContent = name;
        const uploadSubLabel = document.getElementById('home-upload-current-sub-label');
        if (uploadSubLabel) uploadSubLabel.textContent = name;
    }

    getSubjectTitle() {
        const s = this.dynamicSubjects.find(sub => sub.key === this.currentSubject);
        return s ? s.name : (this.currentSubject === 'physics' ? 'Vật Lí 11' : (this.currentSubject === 'geography' ? 'Địa Lí 11' : 'Lịch Sử 11'));
    }

    async selectSubject(subjKey) {
        const selected = (this.dynamicSubjects || []).find((subject) => subject.key === subjKey);
        if (!selected || !this.getHomeVisibleSubjects().some((subject) => subject.key === subjKey)) {
            this.showToastNotification('Môn học này không thuộc khu vực được cấp quyền trên thiết bị hiện tại.');
            return;
        }
        if (subjKey === this.currentSubject) return;
        this.currentSubject = subjKey;
        localStorage.setItem('quiz_last_selected_subject', subjKey);
        this.renderHomeSubjects();
        await this.loadQuestionsForCurrentSubject();
        this.updateTotalQuestionDisplay();
        this.renderFilterTabs();
    }

    async loadQuestionsForCurrentSubject() {
        let questions = [];
        let cloudQuestionsLoaded = false;

        // 1. Thử lấy từ Supabase Cloud nếu Online
        if (navigator.onLine) {
            try {
                if (window.dbService && typeof window.dbService.fetchQuestionsBySubject === 'function') {
                    const cloudQuestions = await window.dbService.fetchQuestionsBySubject(this.currentSubject);
                    if (Array.isArray(cloudQuestions)) {
                        cloudQuestionsLoaded = Boolean(window.dbService.isSupabaseActive);
                        questions = cloudQuestions;
                        // Lưu cache ngoại tuyến vào localStorage
                        try {
                            localStorage.setItem(`quiz_cache_${this.currentSubject}`, JSON.stringify(questions));
                        } catch (ce) { }
                    }
                }
            } catch (e) {
                console.warn("Lỗi tải câu hỏi từ Supabase, chuyển sang cache:", e);
            }
        }

        // 2. Dự phòng 1: Nạp từ bộ nhớ Offline Cache (khi mất mạng)
        if (questions.length === 0 && (!navigator.onLine || !cloudQuestionsLoaded)) {
            try {
                const cachedRaw = localStorage.getItem(`quiz_cache_${this.currentSubject}`);
                if (cachedRaw) {
                    const parsedCache = JSON.parse(cachedRaw);
                    if (Array.isArray(parsedCache) && parsedCache.length > 0) {
                        questions = parsedCache;
                    }
                }
            } catch (ce) { }
        }

        // 3. Dự phòng 2: Dữ liệu biến toàn cục đã nhúng trong file JS
        if (questions.length === 0 && (!navigator.onLine || !cloudQuestionsLoaded)) {
            if (this.currentSubject === 'history' && Array.isArray(window.QUIZ_QUESTIONS)) {
                questions = [...window.QUIZ_QUESTIONS];
            } else if (this.currentSubject === 'physics' && Array.isArray(window.PHYSICS_QUESTIONS)) {
                questions = [...window.PHYSICS_QUESTIONS];
            } else if (this.currentSubject === 'geography' && Array.isArray(window.GEOGRAPHY_QUESTIONS)) {
                questions = [...window.GEOGRAPHY_QUESTIONS];
            }
        }

        this.allQuestions = this.normalizeQuestions(questions);

        // Cập nhật số lượng câu hỏi vào danh sách môn học
        const targetSub = this.dynamicSubjects.find(s => s.key === this.currentSubject);
        if (targetSub) {
            targetSub.count = this.allQuestions.length;
            this.updateNavbarAndBadge();
        }

        const badgeQCount = document.getElementById('admin-badge-q-count');
        if (badgeQCount) badgeQCount.textContent = this.allQuestions.length;
    }

    normalizeQuestions(list) {
        if (!Array.isArray(list)) return [];
        return list.map((q, idx) => {
            const item = { ...q };
            if (!item.id) item.id = idx + 1;

            // 1. Chuẩn hóa dạng câu hỏi
            item.qType = item.qType || item.type || 'mcq';

            // 2. Chuẩn hóa nội dung câu hỏi
            if (typeof item.question === 'string') {
                item.question = this.formatScientificNotation(item.question.trim());
            }

            // 3. Chuẩn hóa 4 phương án options: Hỗ trợ cả mảng và object { A, B, C, D }, loại bỏ hoàn toàn tiền tố "A. ", "B. ", "C. ", "D. "
            let rawOpts = item.options;
            if (rawOpts && typeof rawOpts === 'object' && !Array.isArray(rawOpts)) {
                rawOpts = [rawOpts.A || '', rawOpts.B || '', rawOpts.C || '', rawOpts.D || ''];
            }
            if (Array.isArray(rawOpts)) {
                item.options = rawOpts.map(opt => {
                    if (typeof opt !== 'string') return String(opt || '');
                    const cleanOpt = opt.replace(/^[A-D][\s.):\/\-–]\s*/i, '').trim();
                    return this.formatScientificNotation(cleanOpt);
                });
            } else {
                item.options = [];
            }

            // 4. Chuẩn hóa và ràng buộc chặt chẽ đáp án đúng (A, B, C, D -> 0, 1, 2, 3)
            if (item.qType === 'short_answer') {
                item.correctValue = String(item.correctValue !== undefined ? item.correctValue : (item.correct || item.answer || '')).trim();
                item.correct = 0;
                item.answer = 0;
                item.correctAnswer = item.correctValue;
            } else if (item.qType === 'tf_group') {
                if (!Array.isArray(item.statements)) item.statements = [];
                item.statements = item.statements.map(st => {
                    if (!st || typeof st !== 'object') return { text: String(st || ''), answer: true };
                    return { text: this.formatScientificNotation(String(st.text || '').trim()), answer: this._parseBoolAnswer(st.answer) };
                });
                item.correct = 0;
                item.answer = 0;
            } else {
                // MCQ: Hỗ trợ mọi kiểu định dạng mà Gemini hoặc Regex có thể trả về.
                // Thứ tự ưu tiên: số 0-3 (chính xác nhất) -> chữ cái -> mới đoán.
                const correctIdx = this._resolveAnswerIndex(
                    item.correct, item.answer, item.correctAnswer
                );
                item.correct = correctIdx;
                item.answer = correctIdx;
                item.correctAnswer = ['A', 'B', 'C', 'D'][correctIdx];
            }

            // 5. Chuẩn hóa giải thích
            item.explanation = typeof item.explanation === 'string' ? this.formatScientificNotation(item.explanation.trim()) : '';

            return item;
        });
    }

    /* ============================================================== */
    /* 2. NHẬN DIỆN IP ADMIN & PHÂN QUYỀN (PASSWORDLESS ADMIN IP)     */
    /* ============================================================== */

    async fetchClientIp() {
        try {
            const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3500) });
            const data = await res.json();
            if (data && data.ip) {
                this.clientIp = data.ip;
            }
        } catch (e) {
            try {
                const res2 = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3500) });
                const data2 = await res2.json();
                if (data2 && data2.ip) this.clientIp = data2.ip;
            } catch (e2) {
                if (this.clientIp.startsWith('Đang')) this.clientIp = "Chưa xác định";
            }
        }

        // Cập nhật nhãn IP hiện tại
        const myIpEl = document.getElementById('admin-my-ip-display');
        if (myIpEl) myIpEl.textContent = this.clientIp;

        // Đồng bộ danh sách IP Admin từ Supabase
        await this.syncAdminIpsConfig();
    }

    hasAdminIpAccess() {
        const clientIp = String(this.clientIp || '').trim();
        const isValidIp = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[0-9a-f:]+)$/i.test(clientIp);
        if (!isValidIp) return false;
        const allowedIps = (Array.isArray(this.allowedAdminIps) ? this.allowedAdminIps : [])
            .map((item) => typeof item === 'string' ? item : item?.ip)
            .map((ip) => String(ip || '').trim())
            .filter(Boolean);
        return allowedIps.includes(clientIp) || clientIp === String(this.masterAdminIp || '').trim();
    }

    async syncAdminIpsConfig() {
        try {
            if (window.dbService && typeof window.dbService.fetchAdminIpsConfig === 'function') {
                const cfg = await window.dbService.fetchAdminIpsConfig();
                let ips = [];
                if (Array.isArray(cfg.ips)) ips = cfg.ips;
                else if (Array.isArray(cfg.allowedIps)) ips = cfg.allowedIps.map(x => typeof x === 'string' ? x : x.ip);
                this.allowedAdminIps = ips.filter(Boolean);
                this.masterAdminIp = cfg.masterIp || '';
            }
        } catch (e) {
            console.warn("Không thể tải danh sách IP Admin:", e);
        }

        // Chỉ IP đã cấp quyền trên Cloud mới được xem là Admin.
        const isWhitelisted = this.hasAdminIpAccess();

        if (isWhitelisted) {
            this.isAdminAuthenticated = true;
            localStorage.setItem('quiz_is_admin', 'true');
            localStorage.setItem('quiz_admin_authenticated', 'true');
            if (this.clientIp && !this.clientIp.startsWith('Đang') && this.clientIp !== 'Chưa xác định') {
                localStorage.setItem('quiz_admin_saved_ip', this.clientIp);
            }
        } else {
            this.isAdminAuthenticated = false;
            localStorage.removeItem('quiz_is_admin');
            localStorage.removeItem('quiz_admin_authenticated');
        }

        this.updateAdminUIVisibility();
        this.renderAdminIpsTab();
    }

    updateAdminUIVisibility() {
        const floatBtn = document.getElementById('floating-admin-btn');
        const navBtn = document.getElementById('nav-admin-btn');
        const homeActions = document.getElementById('home-admin-subject-actions');
        const hasCurrentIpPermission = this.hasAdminIpAccess();

        if (this.isAdminAuthenticated && hasCurrentIpPermission) {
            if (floatBtn) {
                floatBtn.classList.remove('hidden');
                floatBtn.classList.add('flex');
            }
            if (navBtn) {
                navBtn.classList.remove('hidden');
                navBtn.classList.add('flex');
            }
            // Toàn bộ công cụ quản trị đã chuyển sang admin.html.
            if (homeActions) homeActions.classList.add('hidden');
        } else {
            if (floatBtn) {
                floatBtn.classList.add('hidden');
                floatBtn.classList.remove('flex');
            }
            if (navBtn) {
                navBtn.classList.add('hidden');
                navBtn.classList.remove('flex');
            }
            if (homeActions) homeActions.classList.add('hidden');
        }

        this.renderHomeSubjects();
    }

    promptAdminAuth() {
        if (this.isAdminAuthenticated && this.hasAdminIpAccess()) {
            this.isAdminAuthenticated = true;
            this.updateAdminUIVisibility();
            window.location.href = 'admin.html';
            return;
        }
        this.showToastNotification('Thiết bị này chưa được cấp quyền Admin.');
    }

    closeAdminAuthModal() {
        const modal = document.getElementById('modal-admin-auth');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    async verifyAdminPassword() {
        // Mật khẩu cũ không còn là một đường cấp quyền. Chỉ whitelist IP Cloud mới được vào Admin.
        this.promptAdminAuth();
    }

    adminLogout() {
        if (!confirm("Bạn có chắc muốn đăng xuất quyền Admin trên thiết bị này?\n(Để vào lại, bạn sẽ cần nhập lại mật khẩu Admin)")) return;
        this.isAdminAuthenticated = false;
        localStorage.removeItem('quiz_is_admin');
        localStorage.removeItem('quiz_admin_authenticated');
        this.closeAdminDashboard();
        this.updateAdminUIVisibility();
        this.showToastNotification("Đã đăng xuất quyền Admin trên thiết bị này.");
    }

    async adminSaveCurrentIpAsMaster() {
        if (!confirm(`Xác nhận lưu địa chỉ IP [${this.clientIp}] làm Master Admin vĩnh viễn?\nIP này sẽ luôn được bảo vệ và không thể bị thu hồi quyền.`)) {
            return;
        }

        try {
            if (window.dbService && typeof window.dbService.saveAdminIpsConfig === 'function') {
                if (!this.allowedAdminIps.includes(this.clientIp)) {
                    this.allowedAdminIps.push(this.clientIp);
                }
                this.masterAdminIp = this.clientIp;
                await window.dbService.saveAdminIpsConfig({
                    ips: this.allowedAdminIps,
                    masterIp: this.masterAdminIp,
                    labels: { [this.clientIp]: 'Master Admin' }
                });
                localStorage.setItem('quiz_is_admin', 'true');
                localStorage.setItem('quiz_admin_authenticated', 'true');
                alert("👑 Đã lưu IP máy này làm Master Admin vĩnh viễn thành công!");
                this.renderAdminIpsTab();
            }
        } catch (e) {
            alert("Lỗi khi lưu Master Admin: " + e.message);
        }
    }

    async adminAddManualAdminIp() {
        const ipInput = document.getElementById('admin-manual-ip-input');
        const nameInput = document.getElementById('admin-manual-ip-name');
        const ip = ipInput ? ipInput.value.trim() : '';
        const name = nameInput ? nameInput.value.trim() : 'Admin';

        if (!ip) {
            alert("Vui lòng nhập địa chỉ IP cần cấp quyền.");
            return;
        }

        try {
            if (window.dbService && typeof window.dbService.addAdminIp === 'function') {
                await window.dbService.addAdminIp(ip, name);
                if (!this.allowedAdminIps.includes(ip)) this.allowedAdminIps.push(ip);
                if (ipInput) ipInput.value = '';
                if (nameInput) nameInput.value = '';
                alert(`Đã cấp quyền Admin thành công cho IP: ${ip} (${name})`);
                this.renderAdminIpsTab();
            }
        } catch (e) {
            alert("Lỗi cấp quyền Admin: " + e.message);
        }
    }

    async adminRevokeAdminIp(ip) {
        if (ip === this.masterAdminIp) {
            alert("⚠️ IP này là Master Admin nên không thể thu hồi!");
            return;
        }

        if (!confirm(`Bạn có chắc chắn muốn thu hồi quyền Admin của IP: ${ip}?`)) return;

        try {
            if (window.dbService && typeof window.dbService.removeAdminIp === 'function') {
                await window.dbService.removeAdminIp(ip);
                this.allowedAdminIps = this.allowedAdminIps.filter(item => item !== ip);
                alert(`Đã thu hồi quyền Admin của IP: ${ip}`);
                this.renderAdminIpsTab();
            }
        } catch (e) {
            alert("Lỗi thu hồi quyền: " + e.message);
        }
    }

    renderAdminIpsTab() {
        const container = document.getElementById('admin-ips-list-container');
        const badgeCount = document.getElementById('admin-badge-admin-count');
        const ipsCountEl = document.getElementById('admin-ips-count');

        const total = this.allowedAdminIps.length;
        if (badgeCount) badgeCount.textContent = total;
        if (ipsCountEl) ipsCountEl.textContent = total;

        if (!container) return;
        container.innerHTML = '';

        if (total === 0) {
            container.innerHTML = `<div class="p-4 text-center text-slate-500 italic">Chưa có IP nào được cấp quyền Admin ngoài mật khẩu mặc định.</div>`;
            return;
        }

        this.allowedAdminIps.forEach(ip => {
            const isMaster = ip === this.masterAdminIp;
            const isCurrent = ip === this.clientIp;
            const card = document.createElement('div');
            card.className = "p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-3 text-xs";
            card.innerHTML = `
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-lg ${isMaster ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-800 text-slate-300'} flex items-center justify-center font-bold">
                        <i class="fa-solid ${isMaster ? 'fa-crown' : 'fa-laptop'}"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-mono font-bold text-white text-xs sm:text-sm">${ip}</span>
                            ${isMaster ? '<span class="px-2 py-0.2 rounded bg-amber-500/20 text-amber-300 font-extrabold text-[10px]">MASTER ADMIN</span>' : ''}
                            ${isCurrent ? '<span class="px-2 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[10px]">Máy Hiện Tại</span>' : ''}
                        </div>
                    </div>
                </div>
                <div>
                    ${!isMaster ? `
                        <button onclick="app.adminRevokeAdminIp('${ip}')" class="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-[11px] font-semibold transition cursor-pointer">
                            <i class="fa-solid fa-user-xmark mr-1"></i> Thu hồi
                        </button>
                    ` : '<span class="text-[11px] text-amber-400/80 italic font-medium">Bảo vệ vĩnh viễn</span>'}
                </div>
            `;
            container.appendChild(card);
        });
    }

    async adminToggleStudentAdminRole(ip, studentName) {
        if (!ip || ip.startsWith('__')) return;
        const isCurrentAdmin = this.allowedAdminIps.includes(ip);

        if (isCurrentAdmin) {
            await this.adminRevokeAdminIp(ip);
        } else {
            try {
                if (window.dbService && typeof window.dbService.addAdminIp === 'function') {
                    await window.dbService.addAdminIp(ip, studentName || 'Học sinh');
                    if (!this.allowedAdminIps.includes(ip)) this.allowedAdminIps.push(ip);
                    alert(`Đã cấp quyền Admin thành công cho: ${studentName} (${ip})`);
                }
            } catch (e) {
                alert("Lỗi cấp quyền: " + e.message);
            }
        }
        this.renderAdminStudentsList();
        this.renderAdminIpsTab();
    }

    /* -------------------------------------------------------------- */
    /* QUẢN LÝ PHÂN QUYỀN TRỢ LÝ AI THEO ĐỊA CHỈ IP (AI WHITELIST)    */
    /* -------------------------------------------------------------- */

    async loadAiIpsConfig() {
        let loaded = [];
        try {
            if (window.dbService && typeof window.dbService.fetchAiIpsConfig === 'function') {
                loaded = await window.dbService.fetchAiIpsConfig();
            }
        } catch (e) {
            console.warn("Không thể tải danh sách IP cấp quyền AI:", e);
        }
        this.allowedAiIps = Array.isArray(loaded) ? loaded : [];
    }

    isAiAllowedForCurrentClient() {
        const currentIp = (this.clientIp || '').trim();
        if (!currentIp || currentIp.startsWith('Đang')) return false;

        // Kiểm tra trong danh sách IP được Admin cấp quyền AI
        return (this.allowedAiIps || []).some(item => {
            const ip = typeof item === 'string' ? item : item.ip;
            return ip && ip.trim() === currentIp;
        });
    }

    async adminToggleStudentAiRole(ip, studentName) {
        if (!ip || ip.startsWith('__')) return;
        const cleanIp = ip.trim();
        const existingIdx = (this.allowedAiIps || []).findIndex(item => {
            const itemIp = typeof item === 'string' ? item : item.ip;
            return itemIp === cleanIp;
        });

        if (existingIdx !== -1) {
            // Đang có -> Thu hồi
            this.allowedAiIps.splice(existingIdx, 1);
            alert(`Đã thu hồi quyền sử dụng Trợ lý AI của: ${studentName || 'Học sinh'} (${cleanIp})`);
        } else {
            // Chưa có -> Cấp quyền
            this.allowedAiIps.push({ ip: cleanIp, name: studentName || 'Học sinh', grantedAt: new Date().toISOString() });
            alert(`✨ Đã cấp quyền sử dụng Trợ lý AI thành công cho: ${studentName || 'Học sinh'} (${cleanIp})!`);
        }

        try {
            if (window.dbService && typeof window.dbService.saveAiIpsConfig === 'function') {
                await window.dbService.saveAiIpsConfig(this.allowedAiIps);
            }
        } catch (e) { }

        this.renderAdminStudentsList();
        this.renderAdminAiIpsList();
    }

    async adminAddManualAiIp() {
        const ipInput = document.getElementById('admin-manual-ai-ip-input');
        const nameInput = document.getElementById('admin-manual-ai-name-input');
        const ip = ipInput ? ipInput.value.trim() : '';
        const name = nameInput ? nameInput.value.trim() : 'Học sinh';

        if (!ip) {
            alert("Vui lòng nhập địa chỉ IP cần cấp quyền Trợ lý AI.");
            return;
        }

        const exists = (this.allowedAiIps || []).some(item => (typeof item === 'string' ? item : item.ip) === ip);
        if (exists) {
            alert(`Địa chỉ IP ${ip} đã được cấp quyền Trợ lý AI từ trước.`);
            return;
        }

        this.allowedAiIps.push({ ip, name, grantedAt: new Date().toISOString() });
        try {
            if (window.dbService && typeof window.dbService.saveAiIpsConfig === 'function') {
                await window.dbService.saveAiIpsConfig(this.allowedAiIps);
            }
        } catch (e) { }

        if (ipInput) ipInput.value = '';
        if (nameInput) nameInput.value = '';
        alert(`✨ Đã cấp quyền Trợ lý AI cho IP: ${ip} (${name}) thành công!`);
        this.renderAdminAiIpsList();
        this.renderAdminStudentsList();
    }

    async adminRevokeAiIp(ip) {
        if (!confirm(`Bạn có chắc muốn thu hồi quyền sử dụng Trợ lý AI của IP: ${ip}?`)) return;
        this.allowedAiIps = (this.allowedAiIps || []).filter(item => (typeof item === 'string' ? item : item.ip) !== ip);
        try {
            if (window.dbService && typeof window.dbService.saveAiIpsConfig === 'function') {
                await window.dbService.saveAiIpsConfig(this.allowedAiIps);
            }
        } catch (e) { }
        this.renderAdminAiIpsList();
        this.renderAdminStudentsList();
    }

    renderAdminAiIpsList() {
        const container = document.getElementById('admin-ai-ips-list-container');
        const countBadge = document.getElementById('admin-ai-ips-count');
        if (countBadge) countBadge.textContent = (this.allowedAiIps || []).length;
        if (!container) return;
        container.innerHTML = '';

        if (!this.allowedAiIps || this.allowedAiIps.length === 0) {
            container.innerHTML = `<div class="p-3 text-center text-slate-500 italic text-xs">Chưa có IP nào được cấp quyền AI.</div>`;
            return;
        }

        this.allowedAiIps.forEach(item => {
            const ip = typeof item === 'string' ? item : item.ip;
            const name = typeof item === 'object' && item.name ? item.name : 'Học sinh';
            const isCurrent = ip === this.clientIp;
            const card = document.createElement('div');
            card.className = "p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-3 text-xs";
            card.innerHTML = `
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center justify-center font-bold">
                        <i class="fa-solid fa-wand-magic-sparkles text-amber-300"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-mono text-purple-300 font-bold">${ip}</span>
                            ${isCurrent ? '<span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">Máy của bạn</span>' : ''}
                        </div>
                        <p class="text-[11px] text-slate-400 font-medium">${name}</p>
                    </div>
                </div>
                <button onclick="app.adminRevokeAiIp('${ip}')" class="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-semibold transition cursor-pointer">
                    <i class="fa-solid fa-trash-can mr-1"></i> Thu hồi
                </button>
            `;
            container.appendChild(card);
        });
    }

    /* ============================================================== */
    /* 3. BẢNG ĐIỀU KHIỂN QUẢN TRỊ VIÊN & CHUYỂN TAB (ADMIN DASHBOARD)*/
    /* ============================================================== */

    openAdminDashboard() {
        if (!this.isAdminAuthenticated || !this.hasAdminIpAccess()) return;
        window.location.href = 'admin.html';
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
        const tabs = ['questions', 'students', 'admin-ips', 'subjects', 'reports'];

        tabs.forEach(t => {
            const btn = document.getElementById(`admin-tab-btn-${t}`);
            const content = document.getElementById(`admin-tab-${t}-content`);

            if (btn) {
                btn.classList.remove('bg-slate-900', 'text-amber-400', 'text-emerald-400', 'border-t-2', 'border-amber-500', 'border-emerald-500');
                btn.classList.add('text-slate-400');
            }
            if (content) {
                content.classList.add('hidden');
                content.classList.remove('admin-tab-enter');
            }
        });

        const activeBtn = document.getElementById(`admin-tab-btn-${tabName}`);
        const activeContent = document.getElementById(`admin-tab-${tabName}-content`);

        if (activeBtn) {
            activeBtn.classList.add('bg-slate-900', 'text-amber-400', 'border-t-2', 'border-amber-500');
            activeBtn.classList.remove('text-slate-400');
        }
        if (activeContent) {
            activeContent.classList.remove('hidden');
            requestAnimationFrame(() => activeContent.classList.add('admin-tab-enter'));
        }

        // Kích hoạt render dữ liệu theo từng tab
        if (tabName === 'questions') {
            this.renderAdminQuestionsList();
        } else if (tabName === 'students') {
            this.loadBannedIpsList().then(() => {
                this.renderAdminBannedIpsList();
            });
            this.renderAdminStudentsList();
        } else if (tabName === 'admin-ips') {
            this.renderAdminIpsTab();
            this.renderAdminAiIpsList();
        } else if (tabName === 'subjects') {
            this.renderAdminSubjectsList();
        } else if (tabName === 'reports') {
            // Tab Báo cáo & Xuất Excel
        }
    }

    /* ============================================================== */
    /* 4. CHẾ ĐỘ BẢO TRÌ HỆ THỐNG (SYSTEM MAINTENANCE MODE)           */
    /* ============================================================== */

    async initMaintenance() {
        try {
            if (window.dbService && typeof window.dbService.checkMaintenanceStatus === 'function') {
                const status = await window.dbService.checkMaintenanceStatus();
                this.isMaintenanceMode = Boolean(status.isActive);
                if (status.message) this.maintenanceMessage = status.message;
            }
        } catch (e) {
            const cached = localStorage.getItem('quiz_maintenance_mode');
            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    this.isMaintenanceMode = Boolean(parsed.isActive);
                    if (parsed.message) this.maintenanceMessage = parsed.message;
                } catch (e) { }
            }
        }

        this.applyMaintenanceMode();
        this.updateAdminMaintenanceUI();
    }

    applyMaintenanceMode() {
        const screen = document.getElementById('screen-maintenance');
        const msgEl = document.getElementById('maintenance-message-text');

        if (msgEl) msgEl.textContent = this.maintenanceMessage;

        // Nếu người dùng là Admin đã xác thực thì không bao giờ bị khóa màn hình
        if (this.isMaintenanceMode && !this.isAdminAuthenticated) {
            if (screen) {
                screen.classList.remove('hidden');
                screen.classList.add('flex');
            }
            this.stopStopwatch();
            this.lockUserInteractions(true);
        } else {
            if (screen) {
                screen.classList.add('hidden');
                screen.classList.remove('flex');
            }
            this.lockUserInteractions(false);
        }
    }

    lockUserInteractions(lock) {
        if (lock) {
            document.body.style.overflow = 'hidden';
            if (!this._maintenanceKeyBlocker) {
                this._maintenanceKeyBlocker = (e) => {
                    if (['F12', 'Escape'].includes(e.key)) return;
                    e.stopPropagation();
                };
                window.addEventListener('keydown', this._maintenanceKeyBlocker, true);
            }
        } else {
            document.body.style.overflow = '';
            if (this._maintenanceKeyBlocker) {
                window.removeEventListener('keydown', this._maintenanceKeyBlocker, true);
                this._maintenanceKeyBlocker = null;
            }
        }
    }

    handleMaintenanceIconClick() {
        this.maintenanceClickCount++;
        clearTimeout(this.maintenanceClickTimer);
        this.maintenanceClickTimer = setTimeout(() => {
            this.maintenanceClickCount = 0;
        }, 1500);

        if (this.maintenanceClickCount >= 3) {
            this.maintenanceClickCount = 0;
            this.openAdminAuthFromMaintenance();
        }
    }

    openAdminAuthFromMaintenance() {
        this.promptAdminAuth();
    }

    async adminToggleMaintenance(enabled) {
        if (enabled) {
            if (!confirm("⚠️ BẬT CHẾ ĐỘ BẢO TRÌ?\n\n- Toàn bộ máy học sinh sẽ bị KHÓA MÀN HÌNH ngay lập tức trong 3 giây.\n- Admin vẫn có toàn quyền sử dụng.")) {
                const toggle = document.getElementById('admin-maintenance-toggle');
                if (toggle) toggle.checked = false;
                return;
            }
        }

        this.isMaintenanceMode = enabled;
        try {
            if (window.dbService && typeof window.dbService.setMaintenanceStatus === 'function') {
                await window.dbService.setMaintenanceStatus(enabled, this.maintenanceMessage);
            }
        } catch (e) {
            alert("Lỗi cập nhật bảo trì lên Cloud: " + e.message);
        }

        this.updateAdminMaintenanceUI();
        this.applyMaintenanceMode();
    }

    async adminEditMaintenanceMsg() {
        const newMsg = prompt("Nhập nội dung lời nhắn bảo trì hiển thị cho thí sinh:", this.maintenanceMessage);
        if (newMsg !== null && newMsg.trim() !== '') {
            this.maintenanceMessage = newMsg.trim();
            try {
                if (window.dbService && typeof window.dbService.setMaintenanceStatus === 'function') {
                    await window.dbService.setMaintenanceStatus(this.isMaintenanceMode, this.maintenanceMessage);
                }
            } catch (e) { }
            this.updateAdminMaintenanceUI();
            this.applyMaintenanceMode();
        }
    }

    updateAdminMaintenanceUI() {
        const toggle = document.getElementById('admin-maintenance-toggle');
        const badge = document.getElementById('admin-maintenance-badge');
        const indicator = document.getElementById('admin-maintenance-indicator');
        const subtext = document.getElementById('admin-maintenance-subtext');
        const toggleLabel = document.getElementById('admin-maintenance-toggle-label');

        if (toggle) toggle.checked = this.isMaintenanceMode;

        if (this.isMaintenanceMode) {
            if (badge) {
                badge.textContent = "ĐANG BẬT BẢO TRÌ";
                badge.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse";
            }
            if (indicator) indicator.className = "w-3 h-3 rounded-full bg-rose-500 shadow-md shadow-rose-500 animate-ping";
            if (subtext) subtext.innerHTML = `<span class="text-rose-400 font-semibold">Hệ thống đang khóa. Lời nhắn: "${this.maintenanceMessage}"</span>`;
            if (toggleLabel) {
                toggleLabel.textContent = "Đang Khóa Web";
                toggleLabel.className = "ml-2 text-xs font-bold text-rose-400";
            }
        } else {
            if (badge) {
                badge.textContent = "ĐANG TẮT";
                badge.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700";
            }
            if (indicator) indicator.className = "w-3 h-3 rounded-full bg-slate-500";
            if (subtext) subtext.textContent = "Trang web đang mở công khai cho tất cả thí sinh làm bài.";
            if (toggleLabel) {
                toggleLabel.textContent = "Khóa Web (Bảo Trì)";
                toggleLabel.className = "ml-2 text-xs font-bold text-slate-300";
            }
        }
    }

    /* ============================================================== */
    /* 5. BỘ NẠP ĐỀ THÔNG MINH (SMART QUESTION IMPORTER)               */
    /* ============================================================== */

    openSmartImporter(subjectKey) {
        const modal = document.getElementById('modal-smart-importer');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            this.populateSubjectDropdowns();
            const target = subjectKey || this.currentSubject;
            const select = document.getElementById('importer-subject-select');
            if (select) select.value = target;
            this.parsedImportQuestions = [];
            this.renderImporterPreview();
        }
    }

    openImporterForSubject(key) {
        if (key) {
            this.currentSubject = key;
        }
        this.openSmartImporter(key);
    }

    openNewQuestionForSubject(key) {
        if (key) {
            this.currentSubject = key;
        }
        this.openNewQuestionModal(key);
    }

    handleHomeDirectFileUpload(event) {
        const file = event.target.files ? event.target.files[0] : null;
        if (!file) return;

        // Mở modal Smart Importer với môn hiện tại
        this.openSmartImporter(this.currentSubject);

        // Chạy xử lý file và tự động bóc tách câu hỏi ngay lập tức
        this.handleImporterFileUpload({ target: { files: [file] } });

        // Reset input để sẵn sàng cho lần chọn tiếp theo
        event.target.value = '';
    }

    closeSmartImporter() {
        const modal = document.getElementById('modal-smart-importer');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    importerInsertSampleText() {
        const textarea = document.getElementById('importer-text-input');
        if (!textarea) return;
        textarea.value = `Câu 1: Thủ đô của nước Cộng hòa Xã hội Chủ nghĩa Việt Nam là thành phố nào?
A. Hà Nội
B. TP. Hồ Chí Minh
C. Đà Nẵng
D. Cần Thơ
Đáp án: A
Giải thích: Hà Nội là thủ đô nghìn năm văn hiến của Việt Nam.

Câu 2: Về chuyển động dao động điều hòa của con lắc lò xo:
a) Biên độ dao động luôn là một đại lượng dương.
b) Chu kỳ dao động phụ thuộc vào biên độ.
c) Vận tốc biến thiên điều hòa cùng tần số với li độ.
d) Động năng đạt cực đại khi vật đi qua vị trí cân bằng.
Đáp án: a-Đ, b-S, c-Đ, d-Đ
Giải thích: Chu kỳ con lắc lò xo T = 2pi*sqrt(m/k) không phụ thuộc biên độ.

Câu 3: Một vật dao động điều hòa với phương trình x = 5cos(2pi*t) (cm). Biên độ của dao động là bao nhiêu cm?
Đáp án: 5
Giải thích: Biên độ A = 5 cm.`;
        this.parseImporterInput();
    }

    convertExcelRowsToQuestions(rows) {
        if (!Array.isArray(rows)) return [];
        const read = (row, ...keys) => {
            const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(row, candidate));
            return key ? row[key] : '';
        };
        const answerIndex = (value) => {
            const normalized = String(value ?? '').trim().toUpperCase();
            if (/^[0-3]$/.test(normalized)) return Number(normalized);
            return ['A', 'B', 'C', 'D'].indexOf(normalized) >= 0 ? ['A', 'B', 'C', 'D'].indexOf(normalized) : 0;
        };

        return rows.map((row, index) => {
            const correctAnswer = String(read(row, 'Đáp án', 'Dap an', 'Đáp án đúng', 'Correct Answer')).trim().toUpperCase();
            const correctIndex = answerIndex(correctAnswer);
            return {
                id: read(row, 'ID', 'Id', 'id') || undefined,
                qType: 'mcq',
                category: String(read(row, 'Chuyên đề', 'Chuyen de', 'Category') || 'Ôn tập').trim(),
                question: String(read(row, 'Câu hỏi', 'Cau hoi', 'Question') || '').trim(),
                options: ['A', 'B', 'C', 'D'].map((letter) => String(read(row, letter, letter.toLowerCase()) || '').trim()),
                correct: correctIndex,
                answer: correctIndex,
                correctAnswer: ['A', 'B', 'C', 'D'][correctIndex],
                explanation: String(read(row, 'Giải thích', 'Giai thich', 'Explanation') || '').trim()
            };
        }).filter((item) => item.question);
    }

    toggleAiProviderFields() {
        const provider = document.getElementById('ai-provider-select')?.value;
        const fields = document.getElementById('ai-openai-fields');
        if (fields) fields.classList.toggle('hidden', provider !== 'openai_compatible');
    }

    handleImporterFileUpload(event) {
        const file = event.target.files ? event.target.files[0] : null;
        if (!file) return;

        // Bảo mật 08: Giới hạn dung lượng file tối đa (15MB) chống tràn RAM trình duyệt
        const MAX_FILE_SIZE = 15 * 1024 * 1024;
        if (file.size > MAX_FILE_SIZE) {
            alert("⚠️ Dung lượng file quá lớn (" + (file.size / (1024 * 1024)).toFixed(1) + "MB). Tối đa cho phép là 15MB.");
            if (event.target) event.target.value = '';
            return;
        }

        const fileName = file.name.toLowerCase();
        // Bảo mật 07: Whitelist định dạng file cho phép
        const isAllowedExtension = fileName.endsWith('.json') || fileName.endsWith('.docx') || fileName.endsWith('.pdf') || fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
        if (!isAllowedExtension) {
            alert("⚠️ Định dạng file không hợp lệ. Vui lòng chỉ tải lên file .docx, .pdf, .xlsx, .xls hoặc .json!");
            if (event.target) event.target.value = '';
            return;
        }

        if (fileName.endsWith('.json')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const parsed = JSON.parse(e.target.result);
                    if (Array.isArray(parsed)) {
                        this.parsedImportQuestions = this.normalizeQuestions(parsed);
                        this.renderImporterPreview();
                    } else {
                        alert("File JSON không hợp lệ (Phải là một mảng câu hỏi).");
                    }
                } catch (err) {
                    alert("Lỗi đọc file JSON: " + err.message);
                }
            };
            reader.readAsText(file);
        } else if (fileName.endsWith('.docx')) {
            if (typeof mammoth === 'undefined') {
                alert("Thư viện bóc tách Word Mammoth chưa sẵn sàng. Vui lòng kiểm tra kết nối mạng hoặc thử lại.");
                return;
            }

            const countBadge = document.getElementById('importer-preview-count');
            if (countBadge) countBadge.textContent = "⏳ Đang bóc tách Word và trích xuất ảnh thật...";

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    // Dùng mammoth convertToHtml với options convertImage để xuất ảnh Base64 thật 100%
                    const options = {
                        convertImage: mammoth.images.imgElement((image) => {
                            return image.read("base64").then((imageBuffer) => {
                                return {
                                    src: "data:" + image.contentType + ";base64," + imageBuffer
                                };
                            });
                        })
                    };
                    const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer }, options);
                    const html = result.value || '';

                    // Trích xuất văn bản có cấu trúc sạch và ảnh thật từ file Word
                    this._docxExtractedImages = [];
                    const cleanFormattedText = this.htmlToTextWithImgMarkers(html, this._docxExtractedImages);
                    const textarea = document.getElementById('importer-text-input');
                    if (textarea) textarea.value = cleanFormattedText;

                    // Bóc tách câu hỏi và hình ảnh bằng engine bóc tách thông minh chống dính câu
                    this.parseDocxHtmlToQuestions(html, cleanFormattedText);


                } catch (err) {
                    console.error("Lỗi đọc file Word .docx:", err);
                    alert("Lỗi đọc file Word (.docx): " + err.message);
                } finally {
                    // Giải phóng bộ nhớ RAM tránh tụt FPS khi file chứa nhiều ảnh Base64
                    if (event && event.target) event.target.value = '';
                }
            };
            reader.readAsArrayBuffer(file);
        } else if (fileName.endsWith('.pdf')) {
            if (typeof pdfjsLib === 'undefined') {
                alert("Thư viện bóc tách PDF chưa sẵn sàng. Vui lòng kiểm tra kết nối mạng hoặc thử lại.");
                return;
            }

            const countBadge = document.getElementById('importer-preview-count');
            if (countBadge) countBadge.textContent = "⏳ Đang đọc nội dung file PDF và trích xuất câu hỏi...";

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
                        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                    }
                    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                    const pdfDoc = await loadingTask.promise;
                    let fullText = '';

                    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                        const page = await pdfDoc.getPage(pageNum);
                        const textContent = await page.getTextContent();
                        const pageText = textContent.items.map(item => item.str).join(' ');
                        fullText += pageText + '\n\n';
                    }

                    const cleanText = fullText.trim();
                    const textarea = document.getElementById('importer-text-input');
                    if (textarea) textarea.value = cleanText;

                    // Tự động phân tích câu hỏi ngay lập tức!
                    this.parseImporterInput();


                } catch (err) {
                    console.error("Lỗi đọc file PDF:", err);
                    alert("Lỗi đọc file PDF (.pdf): " + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
        } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            if (typeof XLSX === 'undefined') {
                alert("Thư viện SheetJS chưa sẵn sàng, vui lòng tải lại trang.");
                return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const json = XLSX.utils.sheet_to_json(firstSheet);
                    this.parsedImportQuestions = this.convertExcelRowsToQuestions(json);
                    this.renderImporterPreview();
                } catch (err) {
                    alert("Lỗi đọc file Excel: " + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
        } else {
            alert("Định dạng file không được hỗ trợ. Vui lòng chọn file Word (.docx), PDF (.pdf), Excel (.xlsx/.xls) hoặc JSON (.json).");
        }
    }

    /* ============================================================== */
    /* LÕI BÓC TÁCH CÂU HỎI ĐỀ THI THÔNG MINH (CHỐNG DÍNH CÂU & CHỐNG LỖI BẢNG) */
    /* ============================================================== */

    htmlToTextWithImgMarkers(html, imagesCollector) {
        if (!html) return '';

        // Tự động nhận diện phương án in đậm (Bold) hoặc gạch chân (Underline) trong file Word làm đáp án đúng
        let s = html.replace(/<(?:strong|b|u)>\s*([A-D])[\s.):-]([\s\S]*?)<\/(?:strong|b|u)>/gi, ' [[ANS:$1]] $1. $2 ');
        s = s.replace(/<(?:strong|b|u)>\s*([A-D])[\s.):-]\s*<\/(?:strong|b|u)>/gi, ' [[ANS:$1]] $1. ');

        s = s.replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, (match, src) => {
            if (imagesCollector) imagesCollector.push(src);
            const idx = imagesCollector ? imagesCollector.length : 1;
            return ' [[IMG:' + idx + ']] ';
        });
        s = s.replace(/<br\s*\/?>/gi, '\n');
        s = s.replace(/<\/p>/gi, '\n\n');
        s = s.replace(/<\/tr>/gi, '\n\n');
        s = s.replace(/<\/td>/gi, '   ');
        s = s.replace(/<\/div>/gi, '\n');
        s = s.replace(/<\/li>/gi, '\n');
        s = s.replace(/<[^>]+>/g, '');
        s = s.replace(/&nbsp;/gi, ' ')
             .replace(/&lt;/gi, '<')
             .replace(/&gt;/gi, '>')
             .replace(/&amp;/gi, '&')
             .replace(/&quot;/gi, '"');
        return s;
    }

    findOptionSequence(matches, fullText) {
        if (!Array.isArray(matches) || matches.length === 0) return [];

        // 1. Kiểm tra nếu có đủ 4 chữ cái A, B, C, D (hỗ trợ cả dạng bảng 2 cột: A C B D hoặc A B C D)
        const letters = new Set(matches.map(m => m.letter));
        if (letters.has('A') && letters.has('B') && letters.has('C') && letters.has('D')) {
            const sortedByPos = [...matches].sort((a, b) => a.index - b.index);
            const used = new Set();
            const finalMarks = [];
            for (const mark of sortedByPos) {
                if (!used.has(mark.letter)) {
                    used.add(mark.letter);
                    finalMarks.push(mark);
                    if (finalMarks.length === 4) break;
                }
            }
            finalMarks.sort((a, b) => a.index - b.index);
            return finalMarks;
        }

        // 2. Thuật toán tìm chuỗi tăng dần liên tiếp (A -> B -> C -> D)
        const order = ['A', 'B', 'C', 'D'];
        let validSequences = [];
        for (let i = 0; i < matches.length; i++) {
            if (matches[i].letter === 'A') {
                let seq = [matches[i]];
                let expectedIdx = 1;
                for (let j = i + 1; j < matches.length; j++) {
                    if (matches[j].letter === order[expectedIdx]) {
                        seq.push(matches[j]);
                        expectedIdx++;
                        if (expectedIdx >= order.length) break;
                    }
                }
                if (seq.length >= 2) validSequences.push(seq);
            }
        }
        if (validSequences.length === 0) return [];
        validSequences.sort((a, b) => {
            if (b.length !== a.length) return b.length - a.length;
            return b[0].index - a[0].index;
        });
        return validSequences[0];
    }

    parseQuestionBlock(block, qNum, externalAnswer, currentCategory, imagesCollector, headerAnswer) {
        let imgUrl = '';
        const imgMatch = block.match(/\[\[IMG:(\d+)\]\]/);
        if (imgMatch && imagesCollector) {
            const idx = parseInt(imgMatch[1], 10) - 1;
            if (imagesCollector[idx]) imgUrl = imagesCollector[idx];
        } else {
            const directImgMatch = block.match(/\[\[IMG:(data:image.+?)\]\]/);
            if (directImgMatch) imgUrl = directImgMatch[1];
        }

        // Nhận diện đáp án in đậm từ Word
        let boldAnsMatch = block.match(/\[\[ANS:([A-D])\]\]/i);
        let boldAns = boldAnsMatch ? boldAnsMatch[1].toUpperCase() : null;

        const cleanBlock = block.replace(/\[\[IMG:.+?\]\]/g, ' ').replace(/\[\[ANS:[A-D]\]\]/gi, ' ').trim();

        const lines = cleanBlock.split('\n').map(l => l.trim()).filter(Boolean);
        let options = [];
        let correctAnswer = headerAnswer || externalAnswer || boldAns || 'A';
        let correct = correctAnswer === 'B' ? 1 : (correctAnswer === 'C' ? 2 : (correctAnswer === 'D' ? 3 : 0));
        let explanation = '';
        let ansStr = '';

        const remainingLines = [];
        for (const line of lines) {
            if (/^(?:đáp\s*án|answer|key|đ\/a)[\s.:]/i.test(line)) {
                ansStr = line.replace(/^(?:đáp\s*án|answer|key|đ\/a)[\s.:]/i, '').trim();
                const m = ansStr.match(/\b([A-D])\b/i) || ansStr.match(/^([A-D])/i);
                if (m) {
                    correctAnswer = m[1].toUpperCase();
                    correct = correctAnswer === 'B' ? 1 : (correctAnswer === 'C' ? 2 : (correctAnswer === 'D' ? 3 : 0));
                }
                continue;
            }
            if (/^(?:lời\s*giải|giải\s*thích|explanation)[\s.:]/i.test(line)) {
                explanation = line.replace(/^(?:lời\s*giải|giải\s*thích|explanation)[\s.:]/i, '').trim();
                continue;
            }
            remainingLines.push(line);
        }

        // Kiểm tra câu Đúng - Sai nhiều ý con (a, b, c, d)
        let tfStatements = [];
        const inlineTfRegex = /(?:[-–—:,|]\s*)?[([]\s*(đúng|sai|[đdsStTfF])\s*[)\]]\s*$|(?:[-–—:,|]\s+)(đúng|sai|[đdsStTfF])\s*$/i;

        for (const line of remainingLines) {
            const tfM = line.match(/^([a-d])[\s.):-]\s*(.*)$/i);
            if (tfM) {
                let stmtText = tfM[2].trim();
                let stmtAns = true; // default nếu không tìm thấy đáp án

                const inlineMatch = stmtText.match(inlineTfRegex);
                if (inlineMatch) {
                    const val = (inlineMatch[1] || inlineMatch[2]).toUpperCase();
                    stmtAns = (val === 'ĐÚNG' || val === 'Đ' || val === 'D' || val === 'TRUE' || val === 'T');
                    stmtText = stmtText.replace(inlineTfRegex, '').trim();
                }
                tfStatements.push({
                    letter: tfM[1].toLowerCase(),
                    text: stmtText,
                    answer: stmtAns
                });
            }
        }

        // Phân tích đáp án Đúng/Sai từ ansStr, headerAnswer, hoặc externalAnswer
        const tfAnsSource = ansStr || headerAnswer || externalAnswer;
        if (tfAnsSource && tfStatements.length >= 2) {
            const mapPattern = /([a-d])\s*[-:=.]*\s*(đúng|sai|[đdsStTfF])\b/gi;
            let mm;
            let hasMap = false;
            while ((mm = mapPattern.exec(tfAnsSource)) !== null) {
                hasMap = true;
                const letter = mm[1].toLowerCase();
                const val = mm[2].toUpperCase();
                const isTrue = (val === 'ĐÚNG' || val === 'Đ' || val === 'D' || val === 'TRUE' || val === 'T');
                const target = tfStatements.find(s => s.letter === letter);
                if (target) target.answer = isTrue;
            }

            if (!hasMap) {
                const rawTokens = tfAnsSource.match(/\b(đúng|sai|true|false)\b|[đdsStTfF]/gi);
                if (rawTokens && rawTokens.length >= tfStatements.length) {
                    rawTokens.slice(0, tfStatements.length).forEach((token, idx) => {
                        const u = token.toUpperCase();
                        tfStatements[idx].answer = (u === 'ĐÚNG' || u === 'Đ' || u === 'D' || u === 'TRUE' || u === 'T');
                    });
                }
            }
        }

        // Phân biệt chính xác giữa True/False và MCQ (Trắc nghiệm 4 đáp án)
        const isSingleLetterMcq = /^[A-D]$/i.test((ansStr || '').trim()) || /^[A-D]$/i.test((headerAnswer || '').trim());
        const hasTfKeywords = /(?:đúng\s*[\/-]?\s*sai|khẳng\s*định|mệnh\s*đề|phát\s*biểu|đ\s*[\/-]?\s*s)/i.test(cleanBlock);
        const hasTfAnsPattern = /(?:[a-d]\s*[-:=.]*\s*(?:đúng|sai|[đdsStTfF])|[đs]\s*[-–,]\s*[đs]|\b(?:đúng|sai|true|false)\b)/i.test(tfAnsSource || '');
        const hasLowerStatements = remainingLines.some(l => /^[a-d][\s.):-]/.test(l));

        const isDefiniteTf = tfStatements.length >= 2 && !isSingleLetterMcq && (hasTfKeywords || hasTfAnsPattern || hasLowerStatements);

        if (isDefiniteTf) {
            let qLines = [];
            for (const line of remainingLines) {
                if (/^[a-d][\s.):-]/i.test(line)) break;
                qLines.push(line);
            }
            let qText = qLines.join(' ').trim();
            if (!qText) qText = `Câu hỏi Đúng / Sai #${qNum}`;

            return {
                id: qNum,
                qType: 'tf_group',
                category: currentCategory || 'Đúng/Sai',
                question: qText,
                statements: tfStatements.map(s => ({ text: s.text, answer: Boolean(s.answer) })),
                options: ['Đúng', 'Sai'],
                correctAnswer: 'A',
                correct: 0,
                explanation,
                image_url: imgUrl || ''
            };
        }

        // Kiểm tra trắc nghiệm 4 lựa chọn (MCQ) trước
        let fullContent = remainingLines.join('\n');

        // Tách đáp án nằm ngay sau nội dung câu hỏi hoặc trước các phương án (nếu có)
        // Hỗ trợ: (Đáp án: B), [Đáp án: B], (Đ/A: B), (Key: B), - Đáp án: B, . Đáp án: B, (B), [B] ở cuối câu hỏi
        let inlineAns = null;
        const inlineAnsPattern = /(?:[-––—:,|]\s*)?[([]\s*(?:đáp\s*án|answer|key|đ\/a)\s*[:=\-–]?\s*([A-D])\s*[)\]]|(?:[-––—:,|]\s*)?(?:đáp\s*án|answer|key|đ\/a)\s*[:=\-–]?\s*([A-D])\b|[([]\s*([A-D])\s*[)\]]\s*(?=\n|\r|$)/gi;
        let inlineM;
        while ((inlineM = inlineAnsPattern.exec(fullContent)) !== null) {
            inlineAns = (inlineM[1] || inlineM[2] || inlineM[3]).toUpperCase();
        }
        if (inlineAns) {
            correctAnswer = inlineAns;
            // Xóa cụm đáp án inline, giữ lại cấu trúc xuống dòng
            fullContent = fullContent.replace(inlineAnsPattern, '').replace(/[ \t]+/g, ' ');
            fullContent = fullContent.replace(/[-––—:,([]\s*(\n|$)/g, '$1').trim();
        }
        correct = correctAnswer === 'B' ? 1 : (correctAnswer === 'C' ? 2 : (correctAnswer === 'D' ? 3 : 0));

        // Regex linh hoạt: hỗ trợ A. B. hoặc A) B) hoặc A/ B/ hoặc A: B: hoặc A - B -
        // Chấp nhận cả trường hợp không có dấu cách sau dấu chấm (A.cân bằng tĩnh)
        const optRegex = /(?:^|\n|[\s\u00a0\t(])([A-D])\s*[.):\/\-–]\s*/g;
        let optMatches = [];
        let om;
        while ((om = optRegex.exec(fullContent)) !== null) {
            const letterIdx = om[0].search(/[A-D]/);
            const start = om.index + (letterIdx >= 0 ? letterIdx : 0);
            optMatches.push({ letter: om[1].toUpperCase(), index: start, len: optRegex.lastIndex - start });
        }

        const seq = this.findOptionSequence(optMatches, fullContent);
        if (seq.length >= 2) {
            let questionPart = fullContent.substring(0, seq[0].index).trim();
            questionPart = questionPart.replace(/[-––—:,([]\s*$/, '').trim();
            const optMap = {};
            for (let j = 0; j < seq.length; j++) {
                const start = seq[j].index + seq[j].len;
                const end = (j + 1 < seq.length) ? seq[j + 1].index : fullContent.length;
                let optText = fullContent.substring(start, end).trim();
                optText = optText.replace(/^[A-D][\s.):\/\-–]\s*/i, '').trim();
                optMap[seq[j].letter] = optText;
            }

            // Nếu bóc tách được các chữ cái, sắp xếp theo thứ tự A, B, C, D
            const lettersPresent = ['A', 'B', 'C', 'D'].filter(ch => optMap[ch] !== undefined);
            if (lettersPresent.length >= 2) {
                options = lettersPresent.map(ch => optMap[ch]);
            } else {
                options = seq.map(item => optMap[item.letter]);
            }

            return {
                id: qNum,
                qType: 'mcq',
                category: currentCategory || 'Ôn tập',
                question: questionPart,
                options: options.length >= 2 ? options : ['Đúng', 'Sai'],
                correctAnswer,
                correct,
                explanation,
                image_url: imgUrl || ''
            };
        }



        // Trường hợp còn lại (câu hỏi ngắn hoặc thiếu phương án)
        return {
            id: qNum,
            qType: 'mcq',
            category: currentCategory || 'Ôn tập',
            question: fullContent,
            options: ['Đúng', 'Sai'],
            correctAnswer,
            correct,
            explanation,
            image_url: imgUrl || ''
        };
    }

    parseExamText(rawText, imagesCollector) {
        let text = (rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // 1. Tách bảng đáp án ở cuối đề (nếu có: BẢNG ĐÁP ÁN: 1.A 2.B 3.C...)
        let bottomAnsMap = {};
        const tableHeaderRegex = /(?:bảng\s+đáp\s+án|đáp\s+án\s+tham\s+khảo|hướng\s+dẫn\s+chấm|bảng\s+tra\s+đáp\s+án)[\s\S]*$/i;
        const tableMatch = text.match(tableHeaderRegex);
        if (tableMatch) {
            const tableText = tableMatch[0];
            const pairRegex = /(\d+)[\s.:/-]*([A-D])\b/gi;
            let pm;
            while ((pm = pairRegex.exec(tableText)) !== null) {
                bottomAnsMap[parseInt(pm[1], 10)] = pm[2].toUpperCase();
            }
            text = text.substring(0, tableMatch.index).trim();
        }

        // 2. Ép ngắt dòng trước mỗi Câu/Bài kể cả khi bị dính cùng dòng với phương án D
        text = text.replace(/([^\n])\s*(?=(?:câu|câu\s*hỏi|question)\s*\d+[\s.:/-])/gi, '$1\n\n');

        // 3. Ép ngắt dòng trước Đáp án và Lời giải
        text = text.replace(/([^\n])\s*(?=(?:đáp\s*án|answer|lời\s*giải|giải\s*thích|explanation)[\s.:])/gi, '$1\n');

        // 4. Tìm các vị trí bắt đầu câu hỏi (Hỗ trợ cả Câu 1 (B):, Câu 1 [B]:, Câu 1 (Đáp án B):, Câu 1 - Đáp án B:)
        const hasCauPattern = /(?:câu|câu\s*hỏi|question)\s*\d+/i.test(text);
        const qRegex = hasCauPattern
            ? /(?:^|\n)\s*(?:câu|câu\s*hỏi|question)\s*(\d+)(?:\s*[([]\s*(?:đáp\s*án\s*[:=\-–]?)?\s*([A-D])\s*[)\]]|\s*[-–]\s*(?:đáp\s*án\s*[:=\-–]?)?\s*([A-D]))?[\s.:/-]\s*/gi
            : /(?:^|\n)\s*(?:bài\s*(\d+)[\s.:/-]|(\d+)[\s.:/-])\s+/gi;

        let matches = [];
        let m;
        while ((m = qRegex.exec(text)) !== null) {
            let headerAns = null;
            if (hasCauPattern) {
                if (m[2] && /[A-D]/i.test(m[2])) headerAns = m[2].toUpperCase();
                else if (m[3] && /[A-D]/i.test(m[3])) headerAns = m[3].toUpperCase();
            }
            matches.push({
                num: parseInt(m[1] || m[2], 10),
                headerAns,
                index: m.index,
                headerLen: m[0].length
            });
        }

        if (matches.length === 0) return [];

        // Tìm category mặc định hoặc từ bài đầu tiên (Bài 1: Cân bằng hoá học -> Ôn tập)
        let currentCategory = 'Ôn tập';
        const preText = text.substring(0, matches[0].index);
        const catM = preText.match(/(?:bài|chương|chủ đề)\s*\d+[\s.:-]*([^\n]+)/i);
        if (catM) currentCategory = catM[0].trim();

        const questions = [];
        for (let i = 0; i < matches.length; i++) {
            const cur = matches[i];
            const nextStart = (i + 1 < matches.length) ? matches[i + 1].index : text.length;

            if (i > 0) {
                const inBetween = text.substring(matches[i - 1].index, cur.index);
                const subCatM = inBetween.match(/(?:bài|chương|chủ đề)\s*\d+[\s.:-]*([^\n]+)/i);
                if (subCatM) currentCategory = subCatM[0].trim();
            }

            const block = text.substring(cur.index + cur.headerLen, nextStart).trim();
            const extAns = bottomAnsMap[cur.num];
            const parsed = this.parseQuestionBlock(block, cur.num, extAns, currentCategory, imagesCollector, cur.headerAns);
            questions.push(parsed);
        }

        return questions;
    }

    /**
     * Chuẩn hoá đáp án đúng của câu trắc nghiệm về chỉ số 0-3.
     */
    _resolveAnswerIndex(...candidates) {
        for (const rawAns of candidates) {
            if (rawAns === undefined || rawAns === null || rawAns === '') continue;

            if (typeof rawAns === 'number' && isFinite(rawAns)) {
                if (rawAns >= 0 && rawAns <= 3) return Math.floor(rawAns);
                continue;
            }

            const s = String(rawAns).trim();
            if (!s) continue;
            if (/^[0-3]$/.test(s)) return parseInt(s, 10);

            // "Đáp án A" / "A." / "phương án C" / "c"
            const up = s.toUpperCase();
            if (/^[A-D]$/.test(up)) return ['A', 'B', 'C', 'D'].indexOf(up);
            const letter = up.match(/\b([A-D])\b/);
            if (letter) return ['A', 'B', 'C', 'D'].indexOf(letter[1]);
        }
        return 0;
    }

    /** Chuẩn hoá giá trị Đúng/Sai từ mọi định dạng (boolean, "Đúng"/"Sai", "Đ"/"S", T/F, 1/0) */
    _parseBoolAnswer(val) {
        if (typeof val === 'boolean') return val;
        if (typeof val === 'number') return val === 1;
        const s = String(val === undefined || val === null ? '' : val).trim().toLowerCase();
        if (['đúng', 'dung', 'đ', 'd', 'true', 't', 'yes', 'y', '1', 'phải', 'chính xác'].indexOf(s) !== -1) return true;
        if (['sai', 's', 'false', 'f', 'no', 'n', '0', 'không', 'khong'].indexOf(s) !== -1) return false;
        return Boolean(val);
    }

    parseDocxHtmlToQuestions(html, cleanFormattedText) {
        let text = cleanFormattedText;
        if (!text && html) {
            this._docxExtractedImages = [];
            text = this.htmlToTextWithImgMarkers(html, this._docxExtractedImages);
        }
        if (!text) {
            this.parseImporterInput();
            return;
        }

        const questions = this.parseExamText(text, this._docxExtractedImages);
        if (questions && questions.length > 0) {
            this.parsedImportQuestions = this.normalizeQuestions(questions);
            this.renderImporterPreview();
        } else {
            this.parseImporterInput();
        }
    }

    /** Bóc tách từ văn bản thuần (dán tay, PDF, hoặc dự phòng khi Word lỗi cấu trúc) */
    parseImporterInput() {
        const textarea = document.getElementById('importer-text-input');
        const rawText = textarea ? textarea.value.trim() : '';

        if (!rawText) {
            alert("Vui lòng dán nội dung văn bản đề thi vào ô trước khi phân tích.");
            return;
        }

        const questions = this.parseExamText(rawText, this._docxExtractedImages);
        this.parsedImportQuestions = this.normalizeQuestions(questions);
        this.renderImporterPreview();
    }

renderImporterPreview() {
        const tbody = document.getElementById('importer-preview-tbody');
        const countBadge = document.getElementById('importer-preview-count');
        const saveBtn = document.getElementById('btn-importer-save');

        const total = this.parsedImportQuestions.length;
        if (countBadge) countBadge.textContent = `${total} câu hỏi`;
        if (saveBtn) saveBtn.disabled = total === 0;

        if (!tbody) return;
        tbody.innerHTML = '';

        if (total === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-500 italic">Chưa có câu hỏi nào được nạp. Hãy dán đề hoặc tải tệp lên rồi bấm "Phân Tích".</td></tr>`;
            return;
        }

        const optChars = ['A', 'B', 'C', 'D'];

        this.parsedImportQuestions.forEach((q, idx) => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-900/60 transition";
            let typeBadge = '<span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold text-[10px]">MCQ (4 đáp án)</span>';
            let ansDisplay = '';

            // Xác định chính xác index đáp án đúng (0, 1, 2, hoặc 3)
            let curIdx = 0;
            if (typeof q.correct === 'number') curIdx = q.correct;
            else if (typeof q.answer === 'number') curIdx = q.answer;
            else if (typeof q.correctAnswer === 'string') {
                const ch = q.correctAnswer.trim().toUpperCase();
                curIdx = ch === 'B' ? 1 : (ch === 'C' ? 2 : (ch === 'D' ? 3 : 0));
            } else if (typeof q.correct === 'string') {
                const ch = q.correct.trim().toUpperCase();
                curIdx = (ch === 'B' || ch === '1') ? 1 : ((ch === 'C' || ch === '2') ? 2 : ((ch === 'D' || ch === '3') ? 3 : 0));
            }

            if (q.qType === 'tf_group') {
                typeBadge = '<span class="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold text-[10px]">Đúng/Sai (Ý)</span>';
                ansDisplay = `
                    <div class="flex flex-col gap-1.5 min-w-[130px]">
                        ${(q.statements || []).map((st, sIdx) => {
                            const letter = String.fromCharCode(97 + sIdx);
                            const isTrue = st.answer === true;
                            return `
                                <div class="inline-flex items-center justify-between gap-2 p-1 rounded-xl bg-slate-900 border border-slate-700/80 shadow-inner">
                                    <span class="font-bold text-purple-300 text-xs px-1.5">${letter}</span>
                                    <div class="inline-flex items-center gap-1">
                                        <button type="button" onclick="app.toggleImporterTfAnswer(${idx}, ${sIdx}, true)" 
                                            class="w-7 h-6 rounded-md text-xs font-black cursor-pointer transition flex items-center justify-center ${isTrue ? 'bg-emerald-500 text-slate-950 shadow ring-1 ring-emerald-400 font-extrabold scale-105' : 'text-slate-400 hover:text-white hover:bg-slate-800'}"
                                            title="Chọn ý ${letter} là ĐÚNG">
                                            Đ
                                        </button>
                                        <button type="button" onclick="app.toggleImporterTfAnswer(${idx}, ${sIdx}, false)" 
                                            class="w-7 h-6 rounded-md text-xs font-black cursor-pointer transition flex items-center justify-center ${!isTrue ? 'bg-rose-500 text-white shadow ring-1 ring-rose-400 font-extrabold scale-105' : 'text-slate-400 hover:text-white hover:bg-slate-800'}"
                                            title="Chọn ý ${letter} là SAI">
                                            S
                                        </button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;
            } else if (q.qType === 'short_answer') {
                typeBadge = '<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[10px]">Trả lời ngắn</span>';
                ansDisplay = String(q.correctValue || '');
            } else {
                // Nhóm 4 nút bấm A, B, C, D trực quan, đáp án đúng nổi bật bằng viền & màu xanh ngọc
                ansDisplay = `
                    <div class="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-900 border border-slate-700/80 shadow-inner">
                        ${[0, 1, 2, 3].map(oIdx => {
                            const isSel = oIdx === curIdx;
                            return `
                                <button type="button" onclick="app.changeImporterAnswer(${idx}, ${oIdx})" 
                                    class="w-7 h-7 rounded-lg text-xs font-black transition cursor-pointer flex items-center justify-center ${isSel ? 'bg-emerald-500 text-slate-950 shadow-md ring-2 ring-emerald-400 scale-105' : 'text-slate-400 hover:text-white hover:bg-slate-800'}" 
                                    title="Chọn đáp án đúng là ${optChars[oIdx]}">
                                    ${optChars[oIdx]}
                                </button>
                            `;
                        }).join('')}
                    </div>
                `;
            }

            const imgUrl = q.image_url || q.imageUrl;
            const imgBadge = imgUrl ? `
                <div class="mt-1 flex items-center gap-1.5">
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px] border border-amber-500/30" title="Đã đính kèm ảnh gốc thật 100% từ đề Word">
                        <i class="fa-solid fa-image"></i> Có ảnh
                    </span>
                    <img src="${imgUrl}" class="w-7 h-7 object-cover rounded border border-slate-700 inline-block cursor-pointer hover:scale-150 transition-transform bg-slate-800" onclick="window.open('${imgUrl}')" title="Nhấp để xem ảnh gốc">
                </div>
            ` : '';

            // Danh sách 4 phương án hiển thị bên dưới câu hỏi để giáo viên kiểm tra ngay
            const optionsPreview = (q.options && q.options.length >= 2) ? `
                <div class="text-[11px] text-slate-400 mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-1">
                    ${q.options.map((opt, oIdx) => {
                        const isChosen = oIdx === curIdx;
                        return `
                            <span class="${isChosen ? 'text-emerald-400 font-bold' : ''}">
                                <strong class="${isChosen ? 'text-emerald-300' : 'text-slate-500'}">${optChars[oIdx]}.</strong> ${this.formatScientificNotation(opt)}
                            </span>
                        `;
                    }).join('')}
                </div>
            ` : '';

            // Khung Lời giải chi tiết hoàn chỉnh như đề cương
            const explanationPreview = q.explanation ? `
                <div class="mt-2 p-2 rounded-xl bg-amber-950/40 border border-amber-500/30 text-[11px] text-amber-200/90 leading-relaxed flex items-start gap-1.5 shadow-sm">
                    <span class="text-amber-400 font-bold shrink-0">💡 Lời giải:</span>
                    <span>${this.formatScientificNotation(q.explanation)}</span>
                </div>
            ` : '';

            // Danh sách các ý con Đúng / Sai có nút chọn Đ / S ngay bên cạnh
            const statementsPreview = (q.qType === 'tf_group' && q.statements && q.statements.length > 0) ? `
                <div class="mt-2.5 space-y-1.5 text-xs">
                    ${q.statements.map((st, sIdx) => {
                        const letter = String.fromCharCode(97 + sIdx);
                        const isTrue = st.answer === true;
                        return `
                            <div class="flex items-center justify-between gap-2.5 p-2 rounded-xl bg-slate-950/70 border border-slate-800/90 hover:border-slate-700 transition">
                                <div class="flex items-start gap-2 flex-1 min-w-0">
                                    <span class="font-bold text-purple-400 shrink-0">${letter})</span>
                                    <span class="text-slate-200 leading-snug">${this.formatScientificNotation(st.text)}</span>
                                </div>
                                <div class="inline-flex items-center gap-1 shrink-0 p-0.5 rounded-lg bg-slate-900 border border-slate-700/80">
                                    <button type="button" onclick="app.toggleImporterTfAnswer(${idx}, ${sIdx}, true)" 
                                        class="px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer transition ${isTrue ? 'bg-emerald-500 text-slate-950 ring-1 ring-emerald-400 font-extrabold' : 'text-slate-400 hover:text-white hover:bg-slate-800'}"
                                        title="Chọn ý ${letter} là ĐÚNG">
                                        ĐÚNG
                                    </button>
                                    <button type="button" onclick="app.toggleImporterTfAnswer(${idx}, ${sIdx}, false)" 
                                        class="px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer transition ${!isTrue ? 'bg-rose-500 text-white ring-1 ring-rose-400 font-extrabold' : 'text-slate-400 hover:text-white hover:bg-slate-800'}"
                                        title="Chọn ý ${letter} là SAI">
                                        SAI
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : '';

            tr.innerHTML = `
                <td class="py-2.5 px-3 text-center font-bold text-slate-400 align-top">${idx + 1}</td>
                <td class="py-2.5 px-3 align-top">${typeBadge}</td>
                <td class="py-2.5 px-3 font-medium text-white max-w-sm align-top">
                    <div class="font-semibold text-slate-100 text-xs sm:text-sm leading-snug">${this.formatScientificNotation(q.question)}</div>
                    ${imgBadge}
                    ${optionsPreview}
                    ${statementsPreview}
                    ${explanationPreview}
                </td>
                <td class="py-2.5 px-3 align-top">${ansDisplay}</td>
                <td class="py-2.5 px-3 text-slate-400 italic max-w-xs text-xs align-top">${this.formatScientificNotation(q.explanation || '—')}</td>
            `;
            tbody.appendChild(tr);
        });

        this.renderMath(tbody);
    }

    changeImporterAnswer(idx, val) {
        if (this.parsedImportQuestions && this.parsedImportQuestions[idx]) {
            let num = 0;
            if (typeof val === 'number') num = val;
            else if (typeof val === 'string') {
                const ch = val.trim().toUpperCase();
                num = (ch === 'B' || ch === '1') ? 1 : ((ch === 'C' || ch === '2') ? 2 : ((ch === 'D' || ch === '3') ? 3 : 0));
            }
            this.parsedImportQuestions[idx].correct = num;
            this.parsedImportQuestions[idx].answer = num;
            this.parsedImportQuestions[idx].correctAnswer = ['A', 'B', 'C', 'D'][num];
            this.renderImporterPreview();
        }
    }

    toggleImporterTfAnswer(qIdx, sIdx, isTrue) {
        if (this.parsedImportQuestions && this.parsedImportQuestions[qIdx]) {
            const q = this.parsedImportQuestions[qIdx];
            if (q.statements && q.statements[sIdx]) {
                q.statements[sIdx].answer = Boolean(isTrue);
                this.renderImporterPreview();
            }
        }
    }

    async saveParsedQuestionsToSubject(event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }

        if (!this.parsedImportQuestions || this.parsedImportQuestions.length === 0) {
            alert("Không có câu hỏi nào để lưu.");
            return;
        }

        const select = document.getElementById('importer-subject-select');
        const replaceCheckbox = document.getElementById('importer-replace-checkbox');
        const targetSubject = (select && select.value) ? select.value : this.currentSubject;
        const replaceAll = replaceCheckbox ? replaceCheckbox.checked : false;

        // Chuẩn hóa toàn bộ câu hỏi trước khi lưu
        const cleanQuestions = this.normalizeQuestions(this.parsedImportQuestions);
        const count = cleanQuestions.length;

        if (!confirm(`Bạn có chắc chắn muốn lưu ${count} câu hỏi vào môn [${targetSubject}]?`)) return;

        const saveBtn = document.getElementById('btn-importer-save');
        const originalText = saveBtn ? saveBtn.innerHTML : '';
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang lưu ${count} câu...</span>`;
        }

        try {
            let cloudOk = true;
            let errMsg = '';
            if (window.dbService && typeof window.dbService.saveQuestionsBulk === 'function') {
                const res = await window.dbService.saveQuestionsBulk(targetSubject, cleanQuestions, replaceAll);
                if (res && res.success === false) {
                    cloudOk = false;
                    errMsg = res.error || 'Lỗi lưu trữ Cloud';
                    console.error("Lỗi Supabase khi lưu đề:", res.error);
                }
            }

            // Đồng bộ môn học hiện tại sang môn vừa lưu
            this.currentSubject = targetSubject;
            localStorage.setItem('quiz_last_selected_subject', targetSubject);

            // Lưu cache ngoại tuyến ngay lập tức
            try {
                localStorage.setItem(`quiz_cache_${targetSubject}`, JSON.stringify(cleanQuestions));
            } catch (e) {}

            // Nạp lại dữ liệu câu hỏi vào State của môn này
            await this.loadQuestionsForCurrentSubject();

            // Cập nhật số lượng câu hỏi trong dynamicSubjects và lưu lên Cloud
            const subObj = this.dynamicSubjects.find(s => s.key === targetSubject);
            if (subObj) {
                subObj.count = this.allQuestions.length;
                if (window.dbService && typeof window.dbService.saveDynamicSubjects === 'function') {
                    await window.dbService.saveDynamicSubjects(this.dynamicSubjects);
                }
                try {
                    localStorage.setItem('quiz_dynamic_subjects', JSON.stringify(this.dynamicSubjects));
                } catch (e) { }
            }

            // Đóng Modal và Re-render toàn bộ giao diện ngay lập tức
            this.closeSmartImporter();
            this.updateNavbarAndBadge();
            this.renderHomeSubjects();
            this.renderAdminQuestionsList();
            this.renderAdminSubjectsList();

            if (cloudOk) {
                alert(`✅ Đã lưu thành công ${count} câu hỏi vào môn [${targetSubject}] lên toàn hệ thống Cloud & mọi thiết bị!`);
            } else {
                alert(`⚠️ Đã lưu ${count} câu hỏi vào máy này thành công.\nLưu ý Cloud báo: ${errMsg}`);
            }
        } catch (e) {
            console.error("Lỗi khi lưu câu hỏi:", e);
            alert("Lỗi khi lưu câu hỏi vào cơ sở dữ liệu: " + e.message);
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalText;
            }
        }
    }

    async seedCurrentSubjectToCloud() {
        const count = this.allQuestions ? this.allQuestions.length : 0;
        if (count === 0) {
            alert("Môn học này hiện chưa có câu hỏi nào để lưu lên Cloud.");
            return;
        }

        if (!confirm(`Xác nhận lưu toàn bộ ${count} câu hỏi của môn [${this.getSubjectTitle()}] lên Supabase Cloud?\nMọi thí sinh sẽ lập tức nhận được đề thi này.`)) {
            return;
        }

        try {
            if (window.dbService && typeof window.dbService.saveQuestionsBulk === 'function') {
                await window.dbService.saveQuestionsBulk(this.currentSubject, this.allQuestions, true);
                alert(`✅ Đã lưu ${count} câu hỏi môn [${this.getSubjectTitle()}] lên Supabase Cloud thành công!`);
            }
        } catch (e) {
            alert("Lỗi lưu đề lên Cloud: " + e.message);
        }
    }

    async clearSubjectQuestions() {
        if (!confirm(`⚠️ CẢNH BÁO: Bạn có chắc chắn muốn XÓA TOÀN BỘ câu hỏi của môn [${this.getSubjectTitle()}]?\nThao tác này không thể hoàn tác.`)) {
            return;
        }

        try {
            if (window.dbService && typeof window.dbService.clearQuestionsBySubject === 'function') {
                await window.dbService.clearQuestionsBySubject(this.currentSubject);
            }
            this.allQuestions = [];
            this.renderAdminQuestionsList();
            this.updateNavbarAndBadge();
            alert("Đã xóa toàn bộ câu hỏi của môn này.");
        } catch (e) {
            alert("Lỗi xóa đề: " + e.message);
        }
    }

    onAdminChangeSubject(newSubj) {
        this.currentSubject = newSubj;
        localStorage.setItem('quiz_last_selected_subject', newSubj);
        this.loadQuestionsForCurrentSubject().then(() => {
            this.renderAdminQuestionsList();
            this.renderHomeSubjects();
        });
    }

    renderAdminQuestionsList() {
        const container = document.getElementById('admin-questions-list');
        const searchInput = document.getElementById('admin-search-q-input');
        const filterCat = document.getElementById('admin-filter-category');
        const badgeCount = document.getElementById('admin-badge-q-count');

        const questions = this.allQuestions || [];
        if (badgeCount) badgeCount.textContent = questions.length;

        if (!container) return;
        container.innerHTML = '';

        const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
        const cat = filterCat ? filterCat.value : 'all';

        const filtered = questions.filter(q => {
            const matchesText = !keyword || q.question.toLowerCase().includes(keyword) || (q.explanation && q.explanation.toLowerCase().includes(keyword));
            let matchesCat = true;
            if (cat !== 'all') matchesCat = (q.category || '').includes(cat);
            return matchesText && matchesCat;
        });

        if (filtered.length === 0) {
            container.innerHTML = `<div class="p-6 text-center text-slate-500 italic">Không tìm thấy câu hỏi nào phù hợp với bộ lọc.</div>`;
            return;
        }

        filtered.forEach((q, idx) => {
            const card = document.createElement('div');
            card.id = `admin-q-card-${q.id}`;
            card.className = "p-4 rounded-xl bg-slate-800/80 border border-slate-700/80 text-xs space-y-2";

            const optChars = ['A', 'B', 'C', 'D'];
            const correctIdx = q.correct !== undefined ? q.correct : (q.answer !== undefined ? q.answer : 0);
            let correctLetter = optChars[correctIdx] || 'A';
            if (q.qType === 'tf_group' && q.statements) {
                correctLetter = q.statements.map((s, i) => `${String.fromCharCode(97 + i)}: ${s.answer ? 'Đ' : 'S'}`).join(', ');
            }

            let optionsHtml = '';
            if (q.options && q.options.length > 0) {
                optionsHtml = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    ${q.options.map((opt, oIdx) => {
                    const isCorrect = oIdx === correctIdx;
                    const optContent = (opt && opt.trim()) ? this.formatScientificNotation(opt) : '<span class="text-amber-400/90 italic font-mono text-[11px]">[Trống nội dung - Bấm "Sửa" để bổ sung công thức]</span>';
                    return `
                        <button type="button" onclick="app.adminQuickChangeAnswer(${q.id}, ${oIdx})" class="admin-opt-btn w-full text-left p-2.5 rounded-xl border transition cursor-pointer flex items-center gap-2 ${isCorrect ? 'border-emerald-500 bg-emerald-950/30 text-emerald-300 font-semibold shadow-sm' : 'border-slate-800 bg-slate-900/80 text-slate-300 hover:border-slate-600 hover:bg-slate-800/80'}" title="Nhấp vào để chọn làm đáp án đúng">
                            <strong class="${isCorrect ? 'text-emerald-400 font-bold' : 'text-slate-400'}">${optChars[oIdx]}.</strong>
                            <span class="flex-1">${optContent}</span>
                        </button>
                    `;
                }).join('')}
                </div>`;
            } else if (q.statements && q.statements.length > 0) {
                optionsHtml = `<div class="space-y-1.5 pt-1">
                    ${q.statements.map((st, sIdx) => {
                        const letter = String.fromCharCode(97 + sIdx);
                        const isTrue = st.answer === true;
                        return `
                            <div class="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-900/80 border border-slate-800 text-slate-300">
                                <div class="flex items-start gap-2 flex-1">
                                    <strong class="text-purple-400">${letter})</strong>
                                    <span class="flex-1">${this.formatScientificNotation(st.text)}</span>
                                </div>
                                <div class="inline-flex items-center gap-1 shrink-0 p-0.5 rounded-lg bg-slate-950 border border-slate-800">
                                    <button type="button" onclick="app.adminQuickToggleTfAnswer(${q.id}, ${sIdx}, true)"
                                        class="px-2.5 py-0.5 rounded-md text-xs font-bold transition cursor-pointer ${isTrue ? 'bg-emerald-500 text-slate-950 font-black shadow ring-1 ring-emerald-400' : 'text-slate-400 hover:text-white'}"
                                        title="Đặt ý ${letter} thành ĐÚNG">
                                        ĐÚNG
                                    </button>
                                    <button type="button" onclick="app.adminQuickToggleTfAnswer(${q.id}, ${sIdx}, false)"
                                        class="px-2.5 py-0.5 rounded-md text-xs font-bold transition cursor-pointer ${!isTrue ? 'bg-rose-500 text-white font-black shadow ring-1 ring-rose-400' : 'text-slate-400 hover:text-white'}"
                                        title="Đặt ý ${letter} thành SAI">
                                        SAI
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>`;
            }

            card.innerHTML = `
                <div class="flex items-center justify-between gap-3 flex-wrap">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-extrabold text-[11px] border border-emerald-500/30">Câu ${idx + 1}</span>
                        <span class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 font-medium text-[11px]">${q.category || 'Ôn tập'}</span>
                        <span class="admin-q-badge-ans px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold text-[11px] border border-emerald-500/30">Đáp án đúng: ${correctLetter}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <button onclick="app.openEditQuestionModal(${q.id})" class="px-3 py-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-900 text-emerald-400 font-bold text-xs transition cursor-pointer flex items-center gap-1 border border-emerald-500/40" title="Sửa câu hỏi">
                            <span>Sửa</span>
                        </button>
                        <button onclick="app.adminDeleteQuestion(${q.id})" class="px-3 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 hover:text-white font-bold text-xs transition cursor-pointer flex items-center gap-1 border border-rose-500/40" title="Xóa câu hỏi">
                            <span>Xóa</span>
                        </button>
                    </div>
                </div>
                <h4 class="font-bold text-white text-sm sm:text-base leading-snug">${this.formatScientificNotation(q.question)}</h4>
                ${optionsHtml}
                ${q.explanation ? `
                    <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 leading-relaxed flex items-start gap-2">
                        <span class="text-amber-400 font-bold shrink-0">💡 Lời giải:</span>
                        <span>${this.formatScientificNotation(q.explanation)}</span>
                    </div>
                ` : ''}
            `;
            container.appendChild(card);
        });

        this.renderMath(container);
    }

    async adminQuickChangeAnswer(qId, newCorrectIdx) {
        const q = this.allQuestions.find(item => item.id === qId);
        if (!q) return;

        const optChars = ['A', 'B', 'C', 'D'];
        const optLetter = optChars[newCorrectIdx] || 'A';
        const previousAnswer = { correct: q.correct, answer: q.answer, correctAnswer: q.correctAnswer };
        q.correct = newCorrectIdx;
        q.answer = newCorrectIdx;
        q.correctAnswer = optLetter;

        // Cập nhật DOM cục bộ NGAY LẬP TỨC (0ms lag, không vẽ lại toàn bộ danh sách)
        const card = document.getElementById(`admin-q-card-${qId}`);
        if (card) {
            const badgeAns = card.querySelector('.admin-q-badge-ans');
            if (badgeAns) badgeAns.textContent = `Đáp án đúng: ${optLetter}`;

            const optButtons = card.querySelectorAll('.admin-opt-btn');
            optButtons.forEach((btn, idx) => {
                const isSelected = idx === newCorrectIdx;
                if (isSelected) {
                    btn.className = "admin-opt-btn w-full text-left p-2.5 rounded-xl border transition cursor-pointer flex items-center gap-2 border-emerald-500 bg-emerald-950/30 text-emerald-300 font-semibold shadow-sm";
                    const strong = btn.querySelector('strong');
                    if (strong) strong.className = "text-emerald-400 font-bold";
                } else {
                    btn.className = "admin-opt-btn w-full text-left p-2.5 rounded-xl border transition cursor-pointer flex items-center gap-2 border-slate-800 bg-slate-900/80 text-slate-300 hover:border-slate-600 hover:bg-slate-800/80";
                    const strong = btn.querySelector('strong');
                    if (strong) strong.className = "text-slate-400";
                }
            });
        }

        try {
            const result = window.dbService && typeof window.dbService.saveQuestion === 'function'
                ? await window.dbService.saveQuestion(q, this.currentSubject)
                : { success: false, error: 'Dịch vụ Supabase chưa sẵn sàng.' };
            if (!result || result.success === false || result.localOnly) throw new Error(result?.error || 'Supabase Cloud không khả dụng, câu hỏi chưa được đồng bộ.');
            localStorage.setItem(`quiz_cache_${this.currentSubject}`, JSON.stringify(this.allQuestions));
            this.showToastNotification(`Đã đổi đáp án câu #${q.id} thành [${optLetter}] và đồng bộ Cloud.`, 'success');
        } catch (error) {
            Object.assign(q, previousAnswer);
            this.renderAdminQuestionsList();
            console.error('Lỗi đồng bộ đáp án lên Cloud:', error);
            this.showToastNotification(`Không thể đồng bộ đáp án lên Cloud: ${error.message}`, 'error');
            alert(`Không thể đồng bộ đáp án câu #${q.id} lên Supabase Cloud.\n${error.message}`);
        }
    }

    async adminQuickToggleTfAnswer(qId, sIdx, isTrue) {
        const q = this.allQuestions.find(item => item.id === qId);
        if (!q || !q.statements || !q.statements[sIdx]) return;
        const previousAnswer = q.statements[sIdx].answer;
        q.statements[sIdx].answer = Boolean(isTrue);

        this.renderAdminQuestionsList();
        try {
            const result = window.dbService && typeof window.dbService.saveQuestion === 'function'
                ? await window.dbService.saveQuestion(q, this.currentSubject)
                : { success: false, error: 'Dịch vụ Supabase chưa sẵn sàng.' };
            if (!result || result.success === false || result.localOnly) throw new Error(result?.error || 'Supabase Cloud không khả dụng, câu hỏi chưa được đồng bộ.');
            localStorage.setItem(`quiz_cache_${this.currentSubject}`, JSON.stringify(this.allQuestions));
            this.showToastNotification(`Đã đổi ý ${String.fromCharCode(97 + sIdx)} thành [${isTrue ? 'ĐÚNG' : 'SAI'}] và đồng bộ Cloud.`, 'success');
        } catch (error) {
            q.statements[sIdx].answer = previousAnswer;
            this.renderAdminQuestionsList();
            console.error('Lỗi đồng bộ đáp án Đúng/Sai lên Cloud:', error);
            this.showToastNotification(`Không thể đồng bộ đáp án lên Cloud: ${error.message}`, 'error');
            alert(`Không thể đồng bộ đáp án câu #${q.id} lên Supabase Cloud.\n${error.message}`);
        }
    }

    /* ============================================================== */
    /* 6. QUẢN LÝ MÔN HỌC ĐỘNG (TAB 4 TRONG ADMIN)                     */
    /* ============================================================== */

    renderAdminSubjectsList() {
        const container = document.getElementById('admin-subjects-list-container');
        const badgeCount = document.getElementById('admin-badge-subject-count');

        if (badgeCount) badgeCount.textContent = this.dynamicSubjects.length;
        if (!container) return;
        container.innerHTML = '';

        this.dynamicSubjects.forEach(sub => {
            const isPrivate = sub.visibility === 'PRIVATE';
            const card = document.createElement('div');
            card.className = "p-4 rounded-2xl bg-slate-800/80 border border-slate-700/80 shadow-md flex flex-col justify-between space-y-3";
            card.innerHTML = `
                <div class="flex items-start justify-between gap-3">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-slate-700 text-white flex items-center justify-center text-lg">
                            <i class="fa-solid ${sub.icon || 'fa-book'}"></i>
                        </div>
                        <div>
                            <h4 class="font-bold text-white text-sm">${sub.name}</h4>
                            <p class="text-[11px] text-slate-400 font-mono">key: ${sub.key}</p>
                        </div>
                    </div>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isPrivate ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'}">
                        ${isPrivate ? '🔒 Riêng tư' : '🌍 Công khai'}
                    </span>
                </div>
                <div class="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-700/60">
                    <span>Thẻ: <strong class="text-slate-200">${sub.semester || 'Học kỳ'}</strong></span>
                    <span>Đề: <strong class="text-indigo-400">${sub.count || 0} câu</strong></span>
                </div>
                <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-700/60 flex-wrap">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <button onclick="app.openImporterForSubject('${sub.key}')" class="px-2.5 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 border border-indigo-500/40 text-xs font-bold transition cursor-pointer flex items-center gap-1 shadow-sm" title="Nạp nhanh đề từ file Word/PDF/Excel vào môn này">
                            <i class="fa-solid fa-file-arrow-up text-sky-400"></i> Nạp Đề File
                        </button>
                        <button onclick="app.openNewQuestionForSubject('${sub.key}')" class="px-2.5 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 border border-emerald-500/40 text-xs font-bold transition cursor-pointer flex items-center gap-1 shadow-sm" title="Tạo thêm câu hỏi mới cho môn này">
                            <i class="fa-solid fa-plus text-emerald-400"></i> Thêm Câu Hỏi
                        </button>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <button onclick="app.adminToggleSubjectVisibility('${sub.key}')" class="px-2.5 py-1.5 rounded-lg ${isPrivate ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600 hover:text-white' : 'bg-amber-600/20 text-amber-300 border border-amber-500/40 hover:bg-amber-600 hover:text-white'} text-xs font-semibold transition cursor-pointer" title="Bấm để chuyển đổi Công khai / Riêng tư">
                            <i class="fa-solid ${isPrivate ? 'fa-eye' : 'fa-eye-slash'} mr-1"></i> ${isPrivate ? 'Công khai' : 'Riêng tư'}
                        </button>
                        <button onclick="app.openSubjectEditor('${sub.key}')" class="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold transition cursor-pointer" title="Chỉnh sửa thông tin môn học">
                            <i class="fa-solid fa-pen-to-square mr-1"></i> Sửa
                        </button>
                        <button onclick="app.adminDeleteSubject('${sub.key}')" class="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-semibold transition cursor-pointer" title="Xóa môn học này">
                            <i class="fa-solid fa-trash-can mr-1"></i> Xóa
                        </button>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    }

    openSubjectEditor(key) {
        const modal = document.getElementById('modal-subject-editor');
        const title = document.getElementById('subject-editor-title');
        const idInput = document.getElementById('edit-sub-id');
        const nameInput = document.getElementById('edit-sub-name');
        const keyInput = document.getElementById('edit-sub-key');
        const semSelect = document.getElementById('edit-sub-semester-select');
        const semInput = document.getElementById('edit-sub-semester');
        const customBox = document.getElementById('edit-sub-custom-semester-box');
        const iconSelect = document.getElementById('edit-sub-icon');
        const gradSelect = document.getElementById('edit-sub-gradient');
        const gradeSelect = document.getElementById('edit-sub-grade');

        if (key) {
            const sub = this.dynamicSubjects.find(s => s.key === key);
            if (sub) {
                if (title) title.textContent = "Chỉnh Sửa Môn Học";
                if (idInput) idInput.value = sub.id || sub.key;
                if (nameInput) nameInput.value = sub.name;
                if (keyInput) {
                    keyInput.value = sub.key;
                    keyInput.disabled = true;
                }
                const semesterVal = sub.semester || 'Giữa Kì 1';
                if (semInput) semInput.value = semesterVal;
                if (semSelect) {
                    const optExists = Array.from(semSelect.options).some(o => o.value === semesterVal);
                    if (optExists) {
                        semSelect.value = semesterVal;
                        if (customBox) customBox.classList.add('hidden');
                    } else {
                        semSelect.value = '__CUSTOM__';
                        if (customBox) customBox.classList.remove('hidden');
                    }
                }
                if (iconSelect) iconSelect.value = sub.icon || 'fa-book';
                if (gradSelect) gradSelect.value = sub.gradient || 'indigo';
                if (gradeSelect) gradeSelect.value = this.getSubjectGrade(sub) === '5' ? '5' : '11';

                const radios = document.getElementsByName('edit-sub-visibility');
                radios.forEach(r => {
                    if (r.value === (sub.visibility || 'PUBLIC')) r.checked = true;
                });
            }
        } else {
            if (title) title.textContent = "Thêm Môn Học Mới";
            if (idInput) idInput.value = '';
            if (nameInput) nameInput.value = '';
            if (keyInput) {
                keyInput.value = '';
                keyInput.disabled = false;
            }
            if (semInput) semInput.value = 'Giữa Kì 2';
            if (semSelect) semSelect.value = 'Giữa Kì 2';
            if (customBox) customBox.classList.add('hidden');
            if (gradeSelect) gradeSelect.value = '11';
        }

        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    }

    onSemesterSelectChange(val) {
        const customBox = document.getElementById('edit-sub-custom-semester-box');
        const customInput = document.getElementById('edit-sub-semester');
        if (val === '__CUSTOM__') {
            if (customBox) customBox.classList.remove('hidden');
            if (customInput) customInput.focus();
        } else {
            if (customBox) customBox.classList.add('hidden');
            if (customInput) customInput.value = val;
        }
    }

    closeSubjectEditor() {
        const modal = document.getElementById('modal-subject-editor');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    async saveSubjectFromEditor() {
        const idInput = document.getElementById('edit-sub-id');
        const nameInput = document.getElementById('edit-sub-name');
        const keyInput = document.getElementById('edit-sub-key');
        const semSelect = document.getElementById('edit-sub-semester-select');
        const semInput = document.getElementById('edit-sub-semester');
        const iconSelect = document.getElementById('edit-sub-icon');
        const gradSelect = document.getElementById('edit-sub-gradient');
        const gradeSelect = document.getElementById('edit-sub-grade');

        const name = nameInput ? nameInput.value.trim() : '';
        const key = keyInput ? keyInput.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') : '';
        let semester = semInput ? semInput.value.trim() : 'Đề cương';
        if (semSelect && semSelect.value && semSelect.value !== '__CUSTOM__') {
            semester = semSelect.value;
        }
        const icon = iconSelect ? iconSelect.value : 'fa-book';
        const gradient = gradSelect ? gradSelect.value : 'indigo';
        const grade = gradeSelect ? gradeSelect.value : '11';

        let visibility = 'PUBLIC';
        const radios = document.getElementsByName('edit-sub-visibility');
        radios.forEach(r => { if (r.checked) visibility = r.value; });

        if (!name || !key) {
            alert("Vui lòng nhập Tên môn học và Mã định danh (key).");
            return;
        }

        const existingIdx = this.dynamicSubjects.findIndex(s => s.key === key);
        const subjectObj = {
            id: key,
            key: key,
            name: name,
            grade: grade,
            semester: semester,
            icon: icon,
            gradient: gradient,
            visibility: visibility,
            count: existingIdx >= 0 ? this.dynamicSubjects[existingIdx].count : 0
        };

        if (existingIdx >= 0) {
            this.dynamicSubjects[existingIdx] = subjectObj;
        } else {
            this.dynamicSubjects.push(subjectObj);
        }

        // Lưu vào Supabase Cloud
        try {
            if (window.dbService && typeof window.dbService.saveDynamicSubjects === 'function') {
                await window.dbService.saveDynamicSubjects(this.dynamicSubjects);
            }
        } catch (e) {
            console.warn("Lưu môn học vào Cloud thất bại:", e);
        }

        localStorage.setItem('quiz_dynamic_subjects', JSON.stringify(this.dynamicSubjects));
        this.closeSubjectEditor();
        this.renderAdminSubjectsList();
        this.renderHomeSubjects();
        this.populateSubjectDropdowns();
        alert(`✅ Đã lưu môn học [${name}] thành công!`);
    }

    async adminDeleteSubject(key) {
        if (['history', 'physics'].includes(key)) {
            if (!confirm(`Môn [${key}] là môn cơ sở mặc định. Bạn có chắc muốn xóa không?`)) return;
        } else {
            if (!confirm(`Xác nhận xóa môn học [${key}] khỏi hệ thống?`)) return;
        }

        this.dynamicSubjects = this.dynamicSubjects.filter(s => s.key !== key);
        try {
            if (window.dbService && typeof window.dbService.deleteDynamicSubject === 'function') {
                await window.dbService.deleteDynamicSubject(key);
            }
        } catch (e) { }

        localStorage.setItem('quiz_dynamic_subjects', JSON.stringify(this.dynamicSubjects));
        if (this.currentSubject === key) {
            this.currentSubject = this.dynamicSubjects[0] ? this.dynamicSubjects[0].key : 'history';
            await this.loadQuestionsForCurrentSubject();
        }

        this.renderAdminSubjectsList();
        this.renderHomeSubjects();
        this.populateSubjectDropdowns();
    }

    /* ============================================================== */
    /* 7. XUẤT BẢNG ĐIỂM EXCEL & BẢNG XẾP HẠNG TOP 10                 */
    /* ============================================================== */

    async adminExportScoreboardExcel() {
        if (typeof XLSX === 'undefined') {
            alert("Thư viện SheetJS chưa được tải hoàn tất. Vui lòng thử lại sau vài giây.");
            return;
        }

        try {
            let data = [];
            if (window.dbService && typeof window.dbService.fetchScoreboardForExport === 'function') {
                data = await window.dbService.fetchScoreboardForExport();
            }

            if (!Array.isArray(data) || data.length === 0) {
                alert("Hiện chưa có dữ liệu kết quả thi nào để xuất Excel.");
                return;
            }

            const exportRows = data.map((item, idx) => ({
                "STT": idx + 1,
                "Họ và Tên": item.player_name || item.playerName || item["Họ Và Tên"] || item["Họ và Tên"] || 'Học sinh',
                "Địa Chỉ IP": item.client_ip || item.ip_address || item.ipAddress || item["Địa Chỉ IP"] || '—',
                "Thiết Bị": item.device_info || item.deviceInfo || item["Thiết Bị"] || '—',
                "Môn Thi": item.subject_name || item.subjectTitle || item["Môn Thi"] || 'Chung',
                "Điểm Số (Thang 100)": item.final_score !== undefined ? item.final_score : (item.score !== undefined ? item.score : (item["Điểm Số"] !== undefined ? item["Điểm Số"] : '—')),
                "Số Ý Đúng": (item.correct_count !== undefined && item.correct_count !== '-') ? item.correct_count : (item.correctCount !== undefined ? item.correctCount : (item["Số Câu Đúng"] || '—')),
                "Tổng Số Ý": (item.total_items !== undefined && item.total_items !== '-') ? item.total_items : (item.totalCount !== undefined ? item.totalCount : '—'),
                "Thời Gian Làm Bài": item.time_spent || item.timeSpent || item["Thời Gian Làm Bài"] || '—',
                "Trạng Thái": item.status || item.scoreSummary || item["Chi Tiết Kết Quả"] || 'Hoàn thành',
                "Thời Gian Nộp": item.created_at ? new Date(item.created_at).toLocaleString('vi-VN') : (item["Thời Gian Nộp"] || item.submittedAt || '—')
            }));

            const ws = XLSX.utils.json_to_sheet(exportRows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "BangDiemThiSinh");

            const dateStr = new Date().toISOString().slice(0, 10);
            XLSX.writeFile(wb, `BangDiem_QuizMaster_Pro_${dateStr}.xlsx`);
        } catch (e) {
            alert("Lỗi xuất bảng điểm Excel: " + e.message);
        }
    }

    openLeaderboardModal(subjKey) {
        const modal = document.getElementById('modal-leaderboard');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            this.populateSubjectDropdowns();
            const select = document.getElementById('leaderboard-subject-select');
            const target = subjKey || this.currentSubject;
            if (select) select.value = target;
            this.renderLeaderboard(target);
        }
    }

    closeLeaderboardModal() {
        const modal = document.getElementById('modal-leaderboard');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    async renderLeaderboard(subjKey) {
        const podiumContainer = document.getElementById('leaderboard-podium-container');
        const tbody = document.getElementById('leaderboard-list-tbody');

        if (podiumContainer) podiumContainer.innerHTML = '<div class="col-span-3 text-center py-4 text-slate-400">Đang tải bảng xếp hạng...</div>';
        if (tbody) tbody.innerHTML = '';

        let leaderboard = [];
        try {
            if (window.dbService && typeof window.dbService.fetchLeaderboard === 'function') {
                leaderboard = await window.dbService.fetchLeaderboard(subjKey, 10);
            }
        } catch (e) {
            console.warn("Lỗi tải Leaderboard:", e);
        }

        if (!Array.isArray(leaderboard) || leaderboard.length === 0) {
            if (podiumContainer) podiumContainer.innerHTML = '<div class="col-span-3 text-center py-6 text-slate-500 italic">Chưa có thí sinh nào hoàn thành bài thi môn này. Hãy là người đầu tiên!</div>';
            return;
        }

        const top1 = leaderboard[0];
        const top2 = leaderboard[1];
        const top3 = leaderboard[2];

        // Render Podium Top 3 (Thứ tự hiển thị thị giác: Top 2 bên trái, Top 1 ở giữa cao nhất, Top 3 bên phải)
        if (podiumContainer) {
            podiumContainer.innerHTML = `
                <!-- Top 2: Bạc -->
                <div class="flex flex-col items-center">
                    ${top2 ? `
                        <div class="w-12 h-12 rounded-2xl bg-slate-400/20 text-slate-200 border-2 border-slate-300 flex items-center justify-center text-xl shadow mb-2">
                            🥈
                        </div>
                        <div class="w-full podium-silver p-2.5 rounded-2xl text-center space-y-1">
                            <span class="text-[10px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-slate-700 text-slate-200">Hạng 2</span>
                            <p class="font-bold text-white text-xs truncate" title="${top2.player_name || top2.playerName || 'Thí sinh'}">${top2.player_name || top2.playerName || 'Thí sinh'}</p>
                            <p class="font-extrabold text-amber-300 text-sm">${top2.score || 0}đ</p>
                            <p class="text-[10px] text-slate-400 font-mono">${top2.time_spent || top2.timeSpent || '—'}</p>
                        </div>
                    ` : '<div class="h-24"></div>'}
                </div>

                <!-- Top 1: Vàng (Cao nhất, Lấp lánh) -->
                <div class="flex flex-col items-center -mt-3">
                    ${top1 ? `
                        <div class="w-14 h-14 rounded-2xl bg-amber-500/30 text-amber-300 border-2 border-amber-400 flex items-center justify-center text-2xl shadow-xl shadow-amber-500/20 mb-2 animate-bounce">
                            👑
                        </div>
                        <div class="w-full podium-gold p-3.5 rounded-2xl text-center space-y-1.5">
                            <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-amber-500 text-slate-950 shadow">Thủ Khoa</span>
                            <p class="font-extrabold text-white text-xs sm:text-sm truncate" title="${top1.player_name || top1.playerName || 'Thí sinh'}">${top1.player_name || top1.playerName || 'Thí sinh'}</p>
                            <p class="font-extrabold text-amber-300 text-base sm:text-lg">${top1.score || 0}đ</p>
                            <p class="text-[10px] text-amber-200/80 font-mono">${top1.time_spent || top1.timeSpent || '—'}</p>
                        </div>
                    ` : '<div class="h-28"></div>'}
                </div>

                <!-- Top 3: Đồng -->
                <div class="flex flex-col items-center">
                    ${top3 ? `
                        <div class="w-12 h-12 rounded-2xl bg-amber-700/20 text-amber-400 border-2 border-amber-600 flex items-center justify-center text-xl shadow mb-2">
                            🥉
                        </div>
                        <div class="w-full podium-bronze p-2.5 rounded-2xl text-center space-y-1">
                            <span class="text-[10px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-amber-900 text-amber-200">Hạng 3</span>
                            <p class="font-bold text-white text-xs truncate" title="${top3.player_name || top3.playerName || 'Thí sinh'}">${top3.player_name || top3.playerName || 'Thí sinh'}</p>
                            <p class="font-extrabold text-amber-300 text-sm">${top3.score || 0}đ</p>
                            <p class="text-[10px] text-slate-400 font-mono">${top3.time_spent || top3.timeSpent || '—'}</p>
                        </div>
                    ` : '<div class="h-24"></div>'}
                </div>
            `;
        }

        // Render Top 4 đến Top 10
        if (tbody) {
            tbody.innerHTML = '';
            const nextTops = leaderboard.slice(3);
            if (nextTops.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="py-3 text-center text-slate-500 italic">Chưa có thêm vị trí xếp hạng.</td></tr>`;
            } else {
                nextTops.forEach((item, idx) => {
                    const rank = idx + 4;
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td class="py-2.5 px-3 text-center font-bold text-slate-400">#${rank}</td>
                        <td class="py-2.5 px-3 font-semibold text-white max-w-[140px] truncate">${item.player_name || item.playerName || 'Thí sinh'}</td>
                        <td class="py-2.5 px-3 text-center font-bold text-emerald-400">${item.score || 0}đ</td>
                        <td class="py-2.5 px-3 text-right font-mono text-slate-400">${item.time_spent || item.timeSpent || '—'}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        }
    }

    async adminExportFullBackupJson() {
        try {
            const backupData = {
                version: "4.0",
                exported_at: new Date().toISOString(),
                subjects: this.dynamicSubjects,
                admin_ips: this.allowedAdminIps,
                master_ip: this.masterAdminIp,
                maintenance: { isActive: this.isMaintenanceMode, message: this.maintenanceMessage },
                current_subject: this.currentSubject,
                questions: this.allQuestions
            };

            const jsonStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", jsonStr);
            downloadAnchor.setAttribute("download", `QuizMaster_Backup_${new Date().toISOString().slice(0, 10)}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        } catch (e) {
            alert("Lỗi sao lưu JSON: " + e.message);
        }
    }

    async adminArchiveAndClearExam() {
        if (!confirm("⚠️ XÁC NHẬN DỌN DẸP KỲ THI CŨ?\n\n- Toàn bộ kết quả thi của học sinh cũ sẽ bị xóa sạch.\n- Hệ thống sẽ tự động tải trước 1 file Backup JSON để lưu trữ.\n- Cấu hình IP Admin và ngân hàng câu hỏi được giữ nguyên.")) {
            return;
        }

        // Tự động backup trước khi xóa
        await this.adminExportFullBackupJson();

        try {
            if (window.dbService && typeof window.dbService.archiveAndClearExamData === 'function') {
                await window.dbService.archiveAndClearExamData();
                alert("✅ Đã dọn dẹp sạch sẽ dữ liệu kỳ thi cũ. Hệ thống đã sẵn sàng cho kỳ thi mới!");
                this.renderAdminStudentsList();
            }
        } catch (e) {
            alert("Lỗi dọn dẹp dữ liệu: " + e.message);
        }
    }

    /* ============================================================== */
    /* 8. CHẾ ĐỘ LUYỆN TẬP THÔNG MINH & ÂM THANH (UX ENHANCEMENTS)    */
    /* ============================================================== */

    setExamMode(isExam) {
        this.isExamMode = false;
        const ind = document.getElementById('exam-mode-indicator-text');
        if (ind) {
            ind.textContent = "Chế độ Luyện Tập (Xem đáp án ngay)";
            ind.className = "text-[11px] font-bold text-emerald-400";
        }
    }

    toggleSound() {
        this.soundEnabled = !this.soundEnabled;
        localStorage.setItem('quiz_sound_enabled', String(this.soundEnabled));
        this.updateSoundIcons();
        if (this.soundEnabled) this.playTingSound();
    }

    updateSoundIcons() {
        const headerIcon = document.getElementById('header-sound-icon');
        const quizIcon = document.getElementById('quiz-sound-icon');
        const iconClass = this.soundEnabled ? 'fa-solid fa-volume-high text-indigo-400' : 'fa-solid fa-volume-xmark text-slate-500';

        if (headerIcon) headerIcon.className = iconClass;
        if (quizIcon) quizIcon.className = iconClass;
    }

    playTingSound() {
        if (!this.soundEnabled) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1046.5, ctx.currentTime); // C6
            osc.frequency.exponentialRampToValueAtTime(1318.5, ctx.currentTime + 0.15); // E6
            gain.gain.setValueAtTime(0.25, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.35);
        } catch (e) { }
    }

    playBeepSound() {
        if (!this.soundEnabled) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(220, ctx.currentTime); // A3
            osc.frequency.exponentialRampToValueAtTime(174, ctx.currentTime + 0.2); // F3
            gain.gain.setValueAtTime(0.18, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.25);
        } catch (e) { }
    }

    renderMath(container) {
        if (!container || typeof renderMathInElement !== 'function') return;
        try {
            renderMathInElement(container, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false }
                ],
                throwOnError: false
            });
        } catch (e) { }
    }

    /**
     * Tự động chuẩn hóa toàn bộ ký hiệu Toán, Lý, Hóa, Sinh, Địa, Anh...
     * Biến các ký hiệu gõ thô (//, <=>, ->, Delta H, KC, độ C, m/s^2, H2O, CaCO3, v.v.)
     * thành chuẩn LaTeX / KaTeX sắc nét, loại bỏ triệt để các ký hiệu // thô kệch.
     */
    formatScientificNotation(text) {
        if (!text || typeof text !== 'string') return text;

        let s = text;

        // 1. Bảo vệ các đoạn LaTeX đã có sẵn giữa $$...$$ hoặc $...$
        const latexTokens = [];
        s = s.replace(/(\$\$[\s\S]*?\$\$|\$[^\$]+?\$)/g, (m) => {
            latexTokens.push(m);
            return '___LATEX_TOKEN_' + (latexTokens.length - 1) + '___';
        });

        // 2. Hình học: Đường thẳng / Mặt phẳng song song: AB // CD, d1 // d2, (P) // (Q), (alpha) // (beta)
        s = s.replace(/(?:([A-Z]{2}|d\d?|\([A-Za-zα-ωΑ-Ω]\))\s*\/\/\s*([A-Z]{2}|d\d?|\([A-Za-zα-ωΑ-Ω]\)))/g, '$1 $\\parallel$ $2');

        // 3. Hóa học: Phản ứng thuận nghịch: Thay thế // hoặc <=> hoặc <-> hoặc ⇌ hoặc ⇄ thành \rightleftharpoons
        s = s.replace(/\s*(?:\/{2,3}|<=>|<->|⇌|⇄)\s*/g, ' $\\rightleftharpoons$ ');

        // Mũi tên phản ứng hóa học một chiều: -> hoặc ──> hoặc --->
        s = s.replace(/\s*(?:-{1,3}>|──>|⟶)\s*/g, ' $\\rightarrow$ ');

        // Mũi tên suy ra / tương đương trong toán: => hoặc <==>
        s = s.replace(/\s*=>\s*/g, ' $\\Rightarrow$ ');

        // 4. Ký hiệu so sánh toán học
        s = s.replace(/\s*>=\s*/g, ' $\\ge$ ');
        s = s.replace(/\s*<=\s*/g, ' $\\le$ ');
        s = s.replace(/\s*!=\s*/g, ' $\\ne$ ');
        s = s.replace(/\s*\+-\s*/g, ' $\\pm$ ');

        // 5. Nhiệt động học / Hóa học: Delta H, Delta_r H298^0
        s = s.replace(/\b(?:Delta|Δ)\s*([rR])\s*H(?:\s*298)?(?:\s*\^?0)?\b/g, '$\\Delta_r H_{298}^\\circ$');
        s = s.replace(/(?<!\\)\b(?:Delta|Δ)\s*H\b/g, '$\\Delta H$');
        s = s.replace(/(?<!\\)\b(?:Delta|Δ)\b/g, '$\\Delta$');

        // 6. Hằng số cân bằng hóa học KC, Kp
        s = s.replace(/\bK[Cc]\b/g, '$K_C$');
        s = s.replace(/\bK[Pp]\b/g, '$K_p$');

        // 7. Độ C (°C, ^oC, *C sau số)
        s = s.replace(/(\d+)\s*(?:°C|\^oC|\*C)/g, '$1$^{\\circ}\\text{C}$');

        // 8. Đơn vị đo lường có số mũ (Vật lý / Toán / Địa lý): m^2, cm^2, km^2, m^3, m/s^2, cm/s^2
        s = s.replace(/\b(km|cm|dm|mm|m)\^?2\b/g, '$\\text{$1}^2$');
        s = s.replace(/\b(km|cm|dm|mm|m)\^?3\b/g, '$\\text{$1}^3$');
        s = s.replace(/\b(m|cm|km)\/s\^?2\b/g, '$\\text{$1}/\\text{s}^2$');

        // 9. Công thức hóa học phổ biến khi gõ thô:
        s = s.replace(/\bH2O\b/g, '$\\text{H}_2\\text{O}$');
        s = s.replace(/\bCO2\b/g, '$\\text{CO}_2$');
        s = s.replace(/\bH2SO4\b/g, '$\\text{H}_2\\text{SO}_4$');
        s = s.replace(/\bCaCO3\b/g, '$\\text{CaCO}_3$');
        s = s.replace(/\bSO2\b/g, '$\\text{SO}_2$');
        s = s.replace(/\bNH3\b/g, '$\\text{NH}_3$');
        s = s.replace(/\bN2\b/g, '$\\text{N}_2$');
        s = s.replace(/\bO2\b/g, '$\\text{O}_2$');
        s = s.replace(/\bH2\b/g, '$\\text{H}_2$');
        s = s.replace(/\bCl2\b/g, '$\\text{Cl}_2$');
        s = s.replace(/\bI2\b/g, '$\\text{I}_2$');
        s = s.replace(/\bFe2O3\b/g, '$\\text{Fe}_2\\text{O}_3$');
        s = s.replace(/\bAl2O3\b/g, '$\\text{Al}_2\\text{O}_3$');
        s = s.replace(/\bBaSO4\b/g, '$\\text{BaSO}_4$');

        // Phân số dạng gõ nhanh (7/100, 3 / 4) hiển thị thành tử số / mẫu số.
        // Chỉ bắt các phân số số học độc lập, không ảnh hưởng ngày tháng hay đơn vị.
        s = s.replace(/(?<![\w.])(\d+)\s*\/\s*(\d+)(?![\w.])/g, '$\\frac{$1}{$2}$');

        // 10. Khôi phục lại các token LaTeX nguyên bản
        s = s.replace(/___LATEX_TOKEN_(\d+)___/g, (m, idx) => latexTokens[parseInt(idx, 10)]);

        return s;
    }

    /* ============================================================== */
    /* 9. THỰC HIỆN LÀM BÀI TRẮC NGHIỆM & TÍNH ĐIỂM                    */
    /* ============================================================== */

    async startQuiz() {
        const input = document.getElementById('player-name-input');
        const err = document.getElementById('player-name-error');
        const name = input ? input.value.trim() : '';

        if (!name) {
            if (err) err.classList.remove('hidden');
            input?.focus();
            return;
        }

        this.playerName = name;
        localStorage.setItem('quiz_user_name', name);

        // 1. Kiểm tra quyền truy cập môn học (Công khai hay Ẩn/Riêng tư)
        const visibleSubjects = this.getHomeVisibleSubjects();

        if (visibleSubjects.length === 0) {
            alert("⚠️ Hiện tại tất cả các đề thi đều đang được Giáo viên tạm ẩn. Vui lòng quay lại sau!");
            return;
        }

        if (!visibleSubjects.some((subject) => subject.key === this.currentSubject)) {
            alert(`⚠️ Môn [${this.getSubjectTitle()}] không thuộc khu vực được cấp quyền trên thiết bị hiện tại.`);
            await this.selectSubject(visibleSubjects[0].key);
            return;
        }

        if (!this.allQuestions || this.allQuestions.length === 0) {
            alert(`⚠️ Môn [${this.getSubjectTitle()}] hiện chưa có câu hỏi nào trong hệ thống!`);
            return;
        }

        // Đảm bảo IP đã xác định trước khi ghi nhận vào hệ thống
        if (!this.clientIp || this.clientIp.startsWith('Đang')) {
            await this.fetchClientIp();
        }

        // Khởi tạo bài thi trên Cloud Supabase
        if (window.dbService && typeof window.dbService.recordLogin === 'function') {
            try {
                const res = await window.dbService.recordLogin(this.playerName, this.clientIp, this.deviceInfo, this.getSubjectTitle());
                this.currentLoginId = (res && res.id) ? res.id : res;
            } catch (err) {
                console.warn("Lỗi lưu đăng nhập lên Supabase:", err);
            }
        }

        // Cập nhật Header
        const headerName = document.getElementById('quiz-header-player-name');
        if (headerName) headerName.textContent = this.playerName;

        const modeBadge = document.getElementById('quiz-mode-badge');
        if (modeBadge) {
            modeBadge.textContent = "Luyện Tập";
            modeBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30";
        }

        // Tải Auto-Save tiến độ cũ nếu có
        this.loadAutoSaveProgress();

        this.switchScreen('quiz');
        this.renderAllQuestions();
        this.startStopwatch();
        this.updateLiveStats();
    }

    loadAutoSaveProgress() {
        const key = `quiz_autosave_${this.currentSubject}_${this.playerName}`;
        const saved = localStorage.getItem(key);
        if (saved) {
            try {
                this.userAnswers = JSON.parse(saved);
            } catch (e) {
                this.userAnswers = {};
            }
        } else {
            this.userAnswers = {};
        }
    }

    saveAutoSaveProgress() {
        const key = `quiz_autosave_${this.currentSubject}_${this.playerName}`;
        localStorage.setItem(key, JSON.stringify(this.userAnswers));
    }

    clearAutoSaveProgress(clearSubjectProgress = false) {
        const prefix = `quiz_autosave_${this.currentSubject}_`;
        if (clearSubjectProgress) {
            try {
                Object.keys(localStorage).forEach((key) => {
                    if (key.startsWith(prefix)) localStorage.removeItem(key);
                });
            } catch (error) {
                console.warn('Không thể xóa toàn bộ tiến độ tạm:', error);
            }
            return;
        }
        localStorage.removeItem(`${prefix}${this.playerName}`);
    }

    renderAllQuestions(skipExitAnimation = false) {
        const container = document.getElementById('questions-container');
        if (!container) return;

        // Let the current cards leave before inserting the freshly-rendered state.
        // This keeps answer feedback readable without changing quiz logic.
        if (!skipExitAnimation && container.children.length > 0) {
            clearTimeout(this.questionRenderTimer);
            container.classList.add('question-list-exit');
            this.questionRenderTimer = setTimeout(() => {
                container.classList.remove('question-list-exit');
                this.renderAllQuestions(true);
            }, 110);
            return;
        }

        container.innerHTML = '';

        const questions = this.allQuestions || [];
        const filtered = questions.filter(q => {
            if (this.currentFilter === 'all') return true;
            if (this.currentFilter === 'mcq') return q.qType !== 'tf_group' && q.qType !== 'short_answer';
            if (this.currentFilter === 'tf') return q.qType === 'tf_group';
            if (this.currentFilter === 'short') return q.qType === 'short_answer';
            if (this.currentFilter === 'wrong') {
                return this.isQuestionWrong(q);
            }
            return (q.category || '').toLowerCase().includes(this.currentFilter.toLowerCase());
        });

        if (filtered.length === 0) {
            container.innerHTML = `<div class="p-8 text-center text-slate-400">Không có câu hỏi nào thuộc danh mục này.</div>`;
            return;
        }

        const fragment = document.createDocumentFragment();

        filtered.forEach((q, idx) => {
            const card = document.createElement('div');
            card.id = `q-card-${q.id}`;
            card.className = "glass-card-pro quiz-question-card question-card-enter rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4";
            card.style.setProperty('--question-index', idx);

            // Render hình ảnh đính kèm nếu có
            const imgHtml = q.image_url ? `
                <div class="my-3 rounded-xl overflow-hidden border border-slate-700 max-w-md mx-auto">
                    <img src="${q.image_url}" alt="Hình minh họa" class="w-full object-contain max-h-64">
                </div>
            ` : '';

            // Nút Hỏi AI dùng chung cho chế độ Luyện tập
            const aiButtonHtml = !this.isExamMode ? `
                <div class="mt-3 pt-2.5 border-t border-slate-700/50 flex flex-wrap items-center justify-between gap-2">
                    <button type="button" onclick="app.askAiExplanation(${q.id})" id="ai-btn-${q.id}" class="btn-3d px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-indigo-700 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-indigo-950/40 transition cursor-pointer">
                        <i class="fa-solid fa-wand-magic-sparkles text-amber-300"></i>
                        <span>✨ Hỏi AI giải thích chi tiết</span>
                    </button>
                    <span class="text-[11px] text-purple-300/80 font-medium flex items-center gap-1"><i class="fa-solid fa-bolt text-amber-400 text-[10px]"></i> AI Sư Phạm</span>
                </div>
                <div id="ai-explanation-${q.id}" class="hidden mt-2.5 p-3.5 rounded-2xl ai-explanation-box text-xs text-slate-200 space-y-2"></div>
            ` : '';

            // 1. Dạng Trắc Nghiệm 4 Đáp Án (MCQ)
            if (q.qType !== 'tf_group' && q.qType !== 'short_answer') {
                const optChars = ['A', 'B', 'C', 'D'];
                const selected = this.userAnswers[q.id];
                const isAnswered = selected !== undefined;
                const correctIdx = q.correct !== undefined ? q.correct : q.answer;

                card.innerHTML = `
                    <div class="quiz-card-meta flex items-center justify-between gap-2">
                        <span class="quiz-number">${String(idx + 1).padStart(2, '0')} <span>/ ${questions.length}</span></span>
                        <span class="quiz-category">${q.category || 'Trắc nghiệm'}</span>
                    </div>
                    <h3 class="quiz-question-title font-bold text-white text-sm sm:text-base leading-relaxed">${this.formatScientificNotation(q.question)}</h3>
                    ${imgHtml}
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        ${(q.options || []).map((opt, oIdx) => {
                    let optStyle = "bg-slate-900/80 hover:bg-slate-800 border-slate-700 text-slate-200";

                    if (this.isExamMode) {
                        if (selected === oIdx) {
                            optStyle = "bg-indigo-600/30 border-indigo-500 text-white font-bold ring-2 ring-indigo-500/50";
                        }
                    } else {
                        if (isAnswered) {
                            if (oIdx === correctIdx) {
                                optStyle = "bg-emerald-600/25 border-emerald-500 text-emerald-200 font-bold option-selected-correct";
                            } else if (selected === oIdx) {
                                optStyle = "bg-rose-600/25 border-rose-500 text-rose-200 font-bold option-selected-wrong";
                            }
                        }
                    }

                    const feedbackIcon = !this.isExamMode && isAnswered && oIdx === correctIdx
                        ? '<span class="answer-feedback-icon" aria-hidden="true"><i class="fa-solid fa-check"></i></span>'
                        : '';

                    return `
                                <button type="button" onclick="app.selectOption(${q.id}, ${oIdx})" ${isAnswered ? 'disabled' : ''} class="quiz-option-tile w-full p-3 sm:p-3.5 rounded-xl border text-left flex items-start gap-3 transition-colors cursor-pointer disabled:cursor-default ${optStyle}">
                                    <span class="quiz-option-letter">${optChars[oIdx]}</span>
                                    <span class="quiz-option-content text-xs sm:text-sm font-medium flex-1 pt-0.5">${this.formatScientificNotation(opt)}</span>
                                    ${feedbackIcon}
                                </button>
                            `;
                }).join('')}
                    </div>
                    ${(!this.isExamMode && isAnswered && q.explanation) ? `
                        <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 leading-relaxed">
                            <p class="font-bold text-amber-400 mb-1 flex items-center gap-1.5"><i class="fa-solid fa-lightbulb"></i> Giải thích chi tiết:</p>
                            <p>${this.formatScientificNotation(q.explanation)}</p>
                        </div>
                    ` : ''}
                    ${aiButtonHtml}
                `;
            }

            // 2. Dạng Đúng/Sai Nhiều Ý (True / False Group)
            else if (q.qType === 'tf_group') {
                const ansObj = this.userAnswers[q.id] || {};
                const stmts = q.statements || [];

                card.innerHTML = `
                    <div class="flex items-center justify-between gap-2">
                        <span class="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-bold text-xs">Câu ${idx + 1} (Đúng / Sai)</span>
                        <span class="text-[11px] text-slate-400">${q.category || 'Đúng/Sai'}</span>
                    </div>
                    <h3 class="font-bold text-white text-sm sm:text-base leading-relaxed">${this.formatScientificNotation(q.question)}</h3>
                    ${imgHtml}
                    <div class="space-y-2.5 pt-1">
                        ${stmts.map((st, sIdx) => {
                    const val = ansObj[sIdx];
                    const isAnswered = val !== undefined;

                    let trueBtnClass = "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500";
                    let falseBtnClass = "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500";

                    if (this.isExamMode) {
                        if (val === true) trueBtnClass = "bg-indigo-600 border-indigo-500 text-white font-bold";
                        if (val === false) falseBtnClass = "bg-indigo-600 border-indigo-500 text-white font-bold";
                    } else {
                        if (isAnswered) {
                            if (val === true) {
                                trueBtnClass = (st.answer === true) ? "bg-emerald-600 border-emerald-500 text-white font-bold" : "bg-rose-600 border-rose-500 text-white font-bold";
                            }
                            if (val === false) {
                                falseBtnClass = (st.answer === false) ? "bg-emerald-600 border-emerald-500 text-white font-bold" : "bg-rose-600 border-rose-500 text-white font-bold";
                            }
                        }
                    }

                    return `
                                <div class="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                                    <div class="flex items-start gap-2 flex-1">
                                        <span class="font-bold text-indigo-400">${String.fromCharCode(97 + sIdx)})</span>
                                        <span class="text-slate-200 font-medium">${this.formatScientificNotation(st.text)}</span>
                                    </div>
                                    <div class="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                                        <button type="button" onclick="app.selectTfOption(${q.id}, ${sIdx}, true)" class="btn-3d px-3 py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${trueBtnClass}">
                                            ĐÚNG
                                        </button>
                                        <button type="button" onclick="app.selectTfOption(${q.id}, ${sIdx}, false)" class="btn-3d px-3 py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${falseBtnClass}">
                                            SAI
                                        </button>
                                    </div>
                                </div>
                            `;
                }).join('')}
                    </div>
                    ${aiButtonHtml}
                `;
            }

            // 3. Dạng Câu Trả Lời Ngắn (Short Answer)
            else if (q.qType === 'short_answer') {
                const userVal = this.userAnswers[q.id] || '';
                card.innerHTML = `
                    <div class="flex items-center justify-between gap-2">
                        <span class="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-xs">Câu ${idx + 1} (Trả lời ngắn)</span>
                        <span class="text-[11px] text-slate-400">${q.category || 'Điền số/chữ'}</span>
                    </div>
                    <h3 class="font-bold text-white text-sm sm:text-base leading-relaxed">${this.formatScientificNotation(q.question)}</h3>
                    ${imgHtml}
                    <div class="pt-2 flex flex-col sm:flex-row gap-2">
                        <input type="text" id="short-input-${q.id}" value="${userVal}" onchange="app.saveShortAnswer(${q.id}, this.value)" placeholder="Nhập đáp án của bạn..." class="flex-1 px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm outline-none focus:border-indigo-500 font-mono">
                        <button type="button" onclick="app.saveShortAnswer(${q.id}, document.getElementById('short-input-${q.id}').value)" class="btn-3d btn-3d-indigo px-5 py-2.5 rounded-xl text-white font-bold text-xs transition cursor-pointer">
                            Ghi nhận
                        </button>
                    </div>
                    ${aiButtonHtml}
                `;
            }

            fragment.appendChild(card);
        });

        container.appendChild(fragment);

        this.renderMath(container);
    }

    selectOption(qId, oIdx) {
        const q = this.allQuestions.find(item => item.id === qId);
        if (!q) return;

        this.userAnswers[qId] = oIdx;
        this.saveAutoSaveProgress();
        this.renderAllQuestions(true);
        this.updateLiveStats();
    }

    selectTfOption(qId, stmtIdx, isTrue) {
        if (!this.userAnswers[qId]) this.userAnswers[qId] = {};
        this.userAnswers[qId][stmtIdx] = isTrue;
        this.saveAutoSaveProgress();
        this.renderAllQuestions(true);
        this.updateLiveStats();
    }

    saveShortAnswer(qId, val) {
        if (!val || !val.trim()) return;
        this.userAnswers[qId] = val.trim();
        this.saveAutoSaveProgress();
        this.renderAllQuestions(true);
        this.updateLiveStats();
    }

    isQuestionWrong(q) {
        if (q.qType === 'short_answer') {
            const val = this.userAnswers[q.id];
            if (val === undefined) return false;
            const isMatch = (q.acceptedValues && q.acceptedValues.some(v => String(v).trim().toLowerCase() === String(val).trim().toLowerCase())) ||
                String(q.correctValue).trim().toLowerCase() === String(val).trim().toLowerCase();
            return !isMatch;
        } else if (q.qType === 'tf_group') {
            const ansObj = this.userAnswers[q.id] || {};
            return (q.statements || []).some((st, idx) => ansObj[idx] !== undefined && Boolean(ansObj[idx]) !== Boolean(st.answer));
        } else {
            const sel = this.userAnswers[q.id];
            if (sel === undefined) return false;
            const correctIdx = q.correct !== undefined ? q.correct : q.answer;
            return sel !== correctIdx;
        }
    }

    updateLiveStats() {
        const questions = this.allQuestions || [];
        let totalItems = 0;
        let attemptedCount = 0;
        let correctCount = 0;
        let wrongCount = 0;

        questions.forEach(q => {
            if (q.qType === 'short_answer') {
                totalItems++;
                const val = this.userAnswers[q.id];
                if (val !== undefined) {
                    attemptedCount++;
                    const isMatch = (q.acceptedValues && q.acceptedValues.some(v => String(v).trim().toLowerCase() === String(val).trim().toLowerCase())) ||
                        String(q.correctValue).trim().toLowerCase() === String(val).trim().toLowerCase();
                    if (isMatch) correctCount++; else wrongCount++;
                }
            } else if (q.qType === 'tf_group') {
                const ansObj = this.userAnswers[q.id] || {};
                (q.statements || []).forEach((st, idx) => {
                    totalItems++;
                    if (ansObj[idx] !== undefined) {
                        attemptedCount++;
                        if (Boolean(ansObj[idx]) === Boolean(st.answer)) correctCount++; else wrongCount++;
                    }
                });
            } else {
                totalItems++;
                const sel = this.userAnswers[q.id];
                if (sel !== undefined) {
                    attemptedCount++;
                    const correctIdx = q.correct !== undefined ? q.correct : q.answer;
                    if (sel === correctIdx) correctCount++; else wrongCount++;
                }
            }
        });

        const liveScore = document.getElementById('quiz-live-score');
        const attemptedEl = document.getElementById('quiz-attempted-count');
        const wrongBadge = document.getElementById('wrong-count-badge');
        const progressText = document.getElementById('quiz-progress-text');
        const progressBar = document.getElementById('quiz-progress-bar');

        if (liveScore) liveScore.textContent = this.isExamMode ? '?' : correctCount;
        if (attemptedEl) attemptedEl.textContent = attemptedCount;
        if (wrongBadge) wrongBadge.textContent = wrongCount;

        const percent = totalItems > 0 ? Math.round((attemptedCount / totalItems) * 100) : 0;
        if (progressText) progressText.textContent = `Đã làm ${attemptedCount}/${totalItems} ý (${percent}%)`;
        if (progressBar) progressBar.style.width = `${percent}%`;

        // Đồng bộ lên Supabase Cloud
        if (window.dbService && this.currentLoginId && typeof window.dbService.updateStudentProgress === 'function') {
            window.dbService.updateStudentProgress(this.currentLoginId, attemptedCount, totalItems, correctCount, this.getSubjectTitle());
        }
    }

    startStopwatch() {
        clearInterval(this.timerInterval);
        const timerDisplay = document.getElementById('timer-display');

        if (this.isExamMode) {
            this.examSecondsRemaining = this.examMinutes * 60;
            this.timerInterval = setInterval(() => {
                this.examSecondsRemaining--;
                if (this.examSecondsRemaining <= 0) {
                    clearInterval(this.timerInterval);
                    alert("⏰ ĐÃ HẾT GIỜ LÀM BÀI! Hệ thống đang tự động nộp bài của bạn.");
                    this.finishQuiz();
                    return;
                }
                const m = Math.floor(this.examSecondsRemaining / 60);
                const s = this.examSecondsRemaining % 60;
                if (timerDisplay) timerDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            }, 1000);
        } else {
            this.secondsElapsed = 0;
            this.timerInterval = setInterval(() => {
                this.secondsElapsed++;
                const m = Math.floor(this.secondsElapsed / 60);
                const s = this.secondsElapsed % 60;
                if (timerDisplay) timerDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            }, 1000);
        }
    }

    stopStopwatch() {
        clearInterval(this.timerInterval);
    }

    confirmSubmit() {
        const questions = this.allQuestions || [];
        let totalItems = 0;
        let attemptedCount = 0;

        questions.forEach(q => {
            if (q.qType === 'short_answer') {
                totalItems++;
                if (this.userAnswers[q.id] !== undefined) attemptedCount++;
            } else if (q.qType === 'tf_group') {
                const ansObj = this.userAnswers[q.id] || {};
                (q.statements || []).forEach((st, idx) => {
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
            msg += ` Còn ${unattempted} ý chưa trả lời. Bạn có chắc muốn nộp bài ngay bây giờ?`;
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
                const val = this.userAnswers[q.id];
                if (val !== undefined) {
                    const isMatch = (q.acceptedValues && q.acceptedValues.some(v => String(v).trim().toLowerCase() === String(val).trim().toLowerCase())) ||
                        String(q.correctValue).trim().toLowerCase() === String(val).trim().toLowerCase();
                    if (isMatch) correctCount++;
                }
            } else if (q.qType === 'tf_group') {
                const ansObj = this.userAnswers[q.id] || {};
                (q.statements || []).forEach((st, idx) => {
                    totalItems++;
                    if (ansObj[idx] !== undefined && Boolean(ansObj[idx]) === Boolean(st.answer)) {
                        correctCount++;
                    }
                });
            } else {
                totalItems++;
                const sel = this.userAnswers[q.id];
                const correctIdx = q.correct !== undefined ? q.correct : q.answer;
                if (sel === correctIdx) correctCount++;
            }
        });

        const finalScore = totalItems > 0 ? Math.round((correctCount / totalItems) * 100) : 0;
        const subjTitle = this.getSubjectTitle();

        // Cập nhật màn hình Kết Quả
        const scoreEl = document.getElementById('result-score');
        const ratioEl = document.getElementById('result-correct-ratio');
        const timeSpentEl = document.getElementById('result-time-spent');
        const greetingEl = document.getElementById('result-player-greeting');

        if (scoreEl) scoreEl.textContent = '0';
        if (ratioEl) ratioEl.textContent = `${correctCount}/${totalItems}`;

        let secondsUsed = this.secondsElapsed;
        if (this.isExamMode) {
            secondsUsed = (this.examMinutes * 60) - this.examSecondsRemaining;
        }
        const m = Math.floor(secondsUsed / 60);
        const s = secondsUsed % 60;
        const timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        if (timeSpentEl) timeSpentEl.textContent = timeStr;
        if (greetingEl) greetingEl.textContent = `Chúc mừng ${this.playerName} đã hoàn thành bài thi ${subjTitle}!`;

        // Cập nhật lên Supabase Cloud
        if (window.dbService && this.currentLoginId && typeof window.dbService.updateLoginStatus === 'function') {
            window.dbService.updateLoginStatus(
                this.currentLoginId,
                `[${subjTitle}] Đã nộp bài`,
                `Đúng ${correctCount}/${totalItems} ý (${finalScore} điểm) - ${timeStr}`
            );
        }

        // Xóa tiến độ autosave
        this.clearAutoSaveProgress();

        // Lưu vào Nhật Ký Ôn Tập Cá Nhân (10 bài gần nhất)
        this.saveToPersonalHistory({
            id: 'hist_' + Date.now(),
            subjectTitle: subjTitle,
            score: finalScore,
            correctCount: correctCount,
            totalCount: totalItems,
            timeSpent: timeStr,
            submittedAt: new Date().toISOString(),
            mode: 'Luyện tập'
        });

        // Phát âm thanh nhẹ khi hoàn tất, không dùng hiệu ứng gây rối mắt.
        if (finalScore >= 90) {
            this.playFanfareSound();
        } else if (finalScore >= 50) {
            this.playTingSound();
        } else {
            this.playBeepSound();
        }

        this.renderReviewList();
        this.switchScreen('result');
        this.animateResultScore(finalScore);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    animateResultScore(targetScore) {
        const scoreEl = document.getElementById('result-score');
        if (!scoreEl) return;

        const target = Math.max(0, Number(targetScore) || 0);
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (reduceMotion) {
            scoreEl.textContent = String(target);
            return;
        }

        const start = performance.now();
        const duration = 360;
        const tick = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            scoreEl.textContent = String(Math.round(target * eased));
            if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    renderReviewList() {
        const reviewContainer = document.getElementById('review-list');
        if (!reviewContainer) return;
        reviewContainer.innerHTML = '';

        const questions = this.allQuestions || [];
        const optChars = ['A', 'B', 'C', 'D'];

        questions.forEach((q, idx) => {
            const card = document.createElement('div');
            card.className = "p-4 sm:p-5 rounded-2xl glass-card-pro border border-slate-700/80 text-xs space-y-3";

            let ansReview = '';
            if (q.qType === 'short_answer') {
                const userVal = this.userAnswers[q.id];
                const isMatch = userVal !== undefined && (
                    (q.acceptedValues && q.acceptedValues.some(v => String(v).trim().toLowerCase() === String(userVal).trim().toLowerCase())) ||
                    String(q.correctValue).trim().toLowerCase() === String(userVal).trim().toLowerCase()
                );
                ansReview = `
                    <div class="p-2.5 rounded-xl ${isMatch ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'} font-bold">
                        Đáp án của bạn: ${userVal || 'Chưa trả lời'} • Đáp án đúng: ${q.correctValue}
                    </div>
                `;
            } else if (q.qType === 'tf_group') {
                const ansObj = this.userAnswers[q.id] || {};
                ansReview = `<div class="space-y-1.5">
                    ${(q.statements || []).map((st, sIdx) => {
                    const val = ansObj[sIdx];
                    const isCorrect = val !== undefined && Boolean(val) === Boolean(st.answer);
                    return `
                            <div class="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                                <span class="font-medium text-slate-200">${String.fromCharCode(97 + sIdx)}) ${this.formatScientificNotation(st.text)}</span>
                                <span class="font-bold ${isCorrect ? 'text-emerald-400' : 'text-rose-400'} shrink-0 ml-2">
                                    Bạn chọn: ${val === true ? 'ĐÚNG' : (val === false ? 'SAI' : '—')} • Đáp án: ${st.answer ? 'ĐÚNG' : 'SAI'}
                                </span>
                            </div>
                        `;
                }).join('')}
                </div>`;
            } else {
                const sel = this.userAnswers[q.id];
                const correctIdx = q.correct !== undefined ? q.correct : q.answer;
                const isCorrect = sel === correctIdx;
                ansReview = `
                    <div class="p-2.5 rounded-xl ${isCorrect ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'} font-semibold">
                        Bạn chọn: <strong>${sel !== undefined ? optChars[sel] : 'Chưa chọn'}</strong> • Đáp án đúng: <strong>${optChars[correctIdx]}</strong>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="flex items-center justify-between font-bold text-white">
                    <span>Câu ${idx + 1}: ${this.formatScientificNotation(q.question)}</span>
                </div>
                ${ansReview}
                ${q.explanation ? `<p class="text-[11px] text-slate-300 italic leading-relaxed"><strong class="text-amber-400">Giải thích:</strong> ${this.formatScientificNotation(q.explanation)}</p>` : ''}
                <div class="mt-2.5 pt-2 border-t border-slate-700/60 flex items-center justify-between gap-2 flex-wrap">
                    <button type="button" onclick="app.askAiExplanation(${q.id})" id="ai-btn-review-${q.id}" class="btn-3d px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer">
                        <i class="fa-solid fa-wand-magic-sparkles text-amber-300"></i>
                        <span>✨ Hỏi AI giải thích chi tiết</span>
                    </button>
                    <span class="text-[11px] text-purple-300/80 font-medium flex items-center gap-1"><i class="fa-solid fa-bolt text-amber-400 text-[10px]"></i> AI Sư Phạm</span>
                </div>
                <div id="ai-explanation-review-${q.id}" class="hidden mt-2.5 p-3.5 rounded-2xl ai-explanation-box text-xs text-slate-200 space-y-2"></div>
            `;
            reviewContainer.appendChild(card);
        });

        this.renderMath(reviewContainer);
    }

    /* ============================================================== */
    /* 10. ĐIỀU HƯỚNG MÀN HÌNH & BẢO MẬT & HEARTBEAT                  */
    /* ============================================================== */

    switchScreen(screenName) {
        const mainHeader = document.getElementById('main-header');
        if (mainHeader) {
            if (screenName === 'quiz') {
                mainHeader.classList.add('hidden');
            } else {
                mainHeader.classList.remove('hidden');
            }
        }

        Object.keys(this.screens).forEach(key => {
            const el = this.screens[key];
            if (el) {
                if (key === screenName) {
                    el.classList.remove('hidden');
                    el.classList.remove('screen-view-enter');
                    void el.offsetWidth;
                    el.classList.add('screen-view-enter');
                } else {
                    el.classList.add('hidden');
                }
            }
        });
    }

    showHome() {
        this.switchScreen('home');
    }

    returnToHome() {
        // Bug 4 Fix: Chỉ cảnh báo khi đang ở màn hình thi 'quiz' và đã trả lời câu hỏi
        const isCurrentlyQuiz = this.screens.quiz && !this.screens.quiz.classList.contains('hidden');
        const hasAnswers = Object.keys(this.userAnswers).length > 0;

        if (isCurrentlyQuiz && hasAnswers) {
            if (!confirm("Bạn đang làm bài dở. Quay lại màn hình chính sẽ kết thúc bài thi này. Bạn có chắc không?")) {
                return;
            }
        }

        this.stopStopwatch();
        this.switchScreen('home');
    }

    resetCurrentQuiz() {
        if (!confirm("Làm lại từ đầu sẽ xóa toàn bộ đáp án của bài thi hiện tại. Bạn có chắc không?")) return;
        this.userAnswers = {};
        this.clearAutoSaveProgress();
        this.switchScreen('quiz');
        this.renderAllQuestions();
        this.startStopwatch();
        this.updateLiveStats();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    filterQuestions(filterKey) {
        this.currentFilter = filterKey;
        // Bug 3 Fix: Luôn chuyển sang màn hình 'quiz' để người dùng nhìn thấy câu hỏi đã lọc
        this.switchScreen('quiz');
        this.renderAllQuestions();
        window.scrollTo({ top: 100, behavior: 'smooth' });
    }

    switchUser() {
        localStorage.removeItem('quiz_user_name');
        this.playerName = "";
        const input = document.getElementById('player-name-input');
        if (input) input.value = '';
        this.checkSavedUser();
        this.switchScreen('home');
    }

    checkSavedUser() {
        const saved = localStorage.getItem('quiz_user_name');
        const banner = document.getElementById('saved-user-banner');
        const nameEl = document.getElementById('saved-user-name');
        const input = document.getElementById('player-name-input');

        if (saved && banner && nameEl) {
            this.playerName = saved;
            nameEl.textContent = saved;
            banner.classList.remove('hidden');
            if (input) input.value = saved;
        } else if (banner) {
            banner.classList.add('hidden');
        }
    }

    clearSavedUser() {
        localStorage.removeItem('quiz_user_name');
        this.playerName = "";
        const banner = document.getElementById('saved-user-banner');
        const input = document.getElementById('player-name-input');
        if (banner) banner.classList.add('hidden');
        if (input) {
            input.value = '';
            input.focus();
        }
    }

    detectDevice() {
        if (typeof navigator === 'undefined') return "Trình duyệt Web";
        const ua = navigator.userAgent || '';
        let os = "Máy tính / ĐT";
        if (/android/i.test(ua)) os = "Android";
        else if (/iphone/i.test(ua)) os = "iPhone";
        else if (/ipad/i.test(ua)) os = "iPad";
        else if (/windows/i.test(ua)) os = "Windows PC";
        else if (/macintosh|mac os x/i.test(ua)) os = "MacBook / Mac";
        else if (/cros/i.test(ua)) os = "Chromebook";
        else if (/linux/i.test(ua)) os = "Linux PC";

        let browser = "Web";
        if (/edg/i.test(ua)) browser = "Edge";
        else if (/chrome/i.test(ua)) browser = "Chrome";
        else if (/safari/i.test(ua)) browser = "Safari";
        else if (/firefox/i.test(ua)) browser = "Firefox";

        return `${os} • ${browser}`;
    }

    async recordVisitorPresence(statusText = 'Đang xem trang chủ') {
        if (!window.dbService || typeof window.dbService.recordLogin !== 'function') return;
        if (!this.clientIp || this.clientIp.startsWith('Đang')) {
            await this.fetchClientIp();
        }
        const name = this.playerName || (document.getElementById('player-name-input')?.value || '').trim() || 'Khách truy cập';
        try {
            const res = await window.dbService.recordLogin(name, this.clientIp, this.deviceInfo, statusText);
            if (res && res.id) this.currentLoginId = res.id;
        } catch (e) { }
    }

    updateTotalQuestionDisplay() {
        const count = this.allQuestions ? this.allQuestions.length : 0;
        const countText = document.getElementById('home-rules-count-text');
        if (countText) countText.innerHTML = `Nội dung: <strong>${count} câu hỏi</strong> trắc nghiệm (Tự động chấm & hiện đáp án ngay).`;
    }

    renderFilterTabs() {
        const container = document.getElementById('quiz-filter-tabs-container');
        if (!container) return;
        container.innerHTML = `
            <button onclick="app.filterQuestions('all')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-indigo-600 text-white cursor-pointer" data-filter="all">Tất cả</button>
            <button onclick="app.filterQuestions('mcq')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer" data-filter="mcq">Trắc nghiệm</button>
            <button onclick="app.filterQuestions('tf')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer" data-filter="tf">Đúng / Sai</button>
            <button onclick="app.filterQuestions('short')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer" data-filter="short">Trả lời ngắn</button>
        `;
    }

    /* ============================================================== */
    /* 11. GIÁM SÁT MÁY & CHẶN IP & REALTIME HEARTBEAT               */
    /* ============================================================== */

    startRealtimeHeartbeat() {
        // Kiểm tra quyền thường xuyên nhưng chỉ ghi heartbeat hiện diện mỗi 30 giây.
        setInterval(async () => {
            if (!window.dbService) return;

            if (this.currentLoginId && Date.now() - this.presenceHeartbeatAt >= 30000) {
                this.presenceHeartbeatAt = Date.now();
                await window.dbService.heartbeat?.(this.currentLoginId);
            }

            // 1. Kiểm tra trạng thái Bảo trì
            try {
                if (typeof window.dbService.checkMaintenanceStatus === 'function') {
                    const maint = await window.dbService.checkMaintenanceStatus();
                    if (this.isMaintenanceMode !== Boolean(maint.isActive) || (maint.message && maint.message !== this.maintenanceMessage)) {
                        this.isMaintenanceMode = Boolean(maint.isActive);
                        if (maint.message) this.maintenanceMessage = maint.message;
                        this.applyMaintenanceMode();
                        this.updateAdminMaintenanceUI();
                    }
                }
            } catch (e) { }

            // 2. Kiểm tra xem IP hiện tại có bị chặn không
            try {
                if (typeof window.dbService.checkIsIpBanned === 'function' && this.clientIp) {
                    const banInfo = await window.dbService.checkIsIpBanned(this.clientIp);
                    if (banInfo && banInfo.isBanned) {
                        this.showBlockedScreen(banInfo.reason);
                    }
                }
            } catch (e) { }

            // 3. Đồng bộ phân quyền Admin theo IP (Bảo lưu nếu thiết bị đã ghi nhớ Admin)
            try {
                if (typeof window.dbService.checkIsAdminIp === 'function' && this.clientIp) {
                    const isAdmin = await window.dbService.checkIsAdminIp(this.clientIp);
                    if (this.isAdminAuthenticated !== isAdmin) {
                        this.isAdminAuthenticated = isAdmin;
                        if (!isAdmin) {
                            localStorage.removeItem('quiz_is_admin');
                            localStorage.removeItem('quiz_admin_authenticated');
                        }
                        this.updateAdminUIVisibility();
                        if (!isAdmin) this.closeAdminDashboard();
                    }
                }
            } catch (e) { }

            // 4. Đồng bộ quyền AI để thu hồi quyền có hiệu lực ngay.
            try {
                await this.loadAiIpsConfig();
            } catch (e) { }

            // 5. Kiểm tra thông báo từ Giám thị
            try {
                if (typeof window.dbService.getSystemNotice === 'function') {
                    const notice = await window.dbService.getSystemNotice(this.clientIp);
                    if (notice && (notice.content || notice.message) && (notice.active !== false)) {
                        const noticeId = notice.id || notice.timestamp || notice.content || notice.message;
                        if (this.lastReceivedNoticeId !== noticeId) {
                            this.lastReceivedNoticeId = noticeId;
                            this.showStudentNotice(notice.content || notice.message);
                        }
                    }
                }
            } catch (e) { }

            // 5. Tự động cập nhật danh sách giám sát thí sinh thời gian thực (nếu Admin đang mở tab Giám sát)
            try {
                const adminModal = document.getElementById('modal-admin-dashboard');
                if (adminModal && !adminModal.classList.contains('hidden') && this.adminCurrentTab === 'students' && this.isAdminAuthenticated) {
                    await this.renderAdminStudentsList(true);
                }
            } catch (e) { }
        }, 3000);
    }

    showBlockedScreen(reason) {
        const screen = document.getElementById('blocked-screen');
        const ipEl = document.getElementById('blocked-ip-text');
        const rEl = document.getElementById('blocked-reason-text');

        if (ipEl) ipEl.textContent = this.clientIp;
        if (rEl && reason) rEl.textContent = reason;
        if (screen) {
            screen.classList.remove('hidden');
            screen.classList.add('flex');
        }
        this.stopStopwatch();
    }

    showStudentNotice(content) {
        const banner = document.getElementById('student-notice-banner');
        const text = document.getElementById('student-notice-content');
        const timer = document.getElementById('student-notice-timer');
        const bar = document.getElementById('student-notice-bar');

        if (!banner || !text) return;
        const cleanContent = typeof content === 'string' ? content.trim() : '';
        if (cleanContent.length < 2) return;
        text.textContent = cleanContent;
        banner.classList.remove('hidden');

        let secondsLeft = 5;
        if (timer) timer.textContent = `${secondsLeft}s`;
        if (bar) bar.style.width = '100%';

        const interval = setInterval(() => {
            secondsLeft--;
            if (timer) timer.textContent = `${secondsLeft}s`;
            if (bar) bar.style.width = `${(secondsLeft / 5) * 100}%`;
            if (secondsLeft <= 0) {
                clearInterval(interval);
                this.hideStudentNotice();
            }
        }, 1000);
    }

    hideStudentNotice() {
        const banner = document.getElementById('student-notice-banner');
        if (banner) banner.classList.add('hidden');
    }

    async renderAdminStudentsList(silent = false) {
        const tbody = document.getElementById('admin-students-tbody');
        const badgeCount = document.getElementById('admin-badge-login-count');
        const countersContainer = document.getElementById('admin-subject-counters');

        if (!tbody || !window.dbService) return;
        if (!silent) {
            tbody.innerHTML = '<tr><td colspan="6" class="py-4 text-center text-slate-400">Đang tải danh sách thí sinh...</td></tr>';
        }

        try {
            const fetchFn = (typeof window.dbService.fetchActiveLogins === 'function')
                ? window.dbService.fetchActiveLogins
                : window.dbService.getLoginHistory;
            const list = await fetchFn.call(window.dbService, 300);
            if (badgeCount) badgeCount.textContent = list.length;

            const nowMs = Date.now();
            const activeNow = list.filter(s => {
                const diffMs = s.last_active ? (nowMs - new Date(s.last_active).getTime()) : 9999999;
                return diffMs <= 180000; // Hoạt động trong 3 phút qua
            });

            // Render Thẻ đếm số thí sinh trực tuyến & tổng lượt
            if (countersContainer) {
                countersContainer.innerHTML = `
                    <div class="p-3 rounded-xl bg-slate-900/90 border border-emerald-500/30 flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            <span class="text-xs font-semibold text-slate-300">Đang Trực Tuyến:</span>
                        </div>
                        <span class="text-sm font-extrabold text-emerald-400">${activeNow.length} máy</span>
                    </div>
                    <div class="p-3 rounded-xl bg-slate-900/90 border border-indigo-500/30 flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <i class="fa-solid fa-users text-indigo-400 text-xs"></i>
                            <span class="text-xs font-semibold text-slate-300">Tổng Lượt Truy Cập:</span>
                        </div>
                        <span class="text-sm font-extrabold text-indigo-300">${list.length}</span>
                    </div>
                `;
            }

            if (list.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-slate-500 italic">Chưa có thí sinh nào truy cập.</td></tr>';
                return;
            }

            let rowsHtml = '';
            list.forEach(student => {
                const rawIp = student.ip_address || student.client_ip || '';
                const ip = (rawIp && rawIp !== '-') ? rawIp : 'Chưa xác định';
                const name = (student.player_name && student.player_name.trim()) ? student.player_name.trim() : 'Khách truy cập';
                const rawDev = student.device_info || '';
                const device = (rawDev && rawDev !== '-' && rawDev !== 'Chưa rõ') ? rawDev : 'Trình duyệt Web';
                const timeStr = student.last_active
                    ? new Date(student.last_active).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : (student.created_at ? new Date(student.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');

                const lastMs = student.last_active ? new Date(student.last_active).getTime() : 0;
                const isOnline = lastMs && ((nowMs - lastMs) <= 180000);

                const statusBadge = isOnline
                    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30 shrink-0">
                         <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span> Online
                       </span>`
                    : `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] shrink-0">
                         <span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span> Nghỉ
                       </span>`;

                const isBanned = (this.bannedIpsList || []).some(x => x.ip === ip) || (student.status && student.status.startsWith('BANNED'));

                const displayBadge = isBanned
                    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold border border-rose-500/40 shrink-0">
                         <i class="fa-solid fa-ban text-rose-400"></i> Bị chặn
                       </span>`
                    : statusBadge;

                const scoreInfo = student.score_summary || student.status || 'Đang ôn tập';

                const isAiGranted = (this.allowedAiIps || []).some(item => (typeof item === 'string' ? item : item.ip) === ip);

                rowsHtml += `
                    <tr class="hover:bg-slate-800/40 transition">
                        <td class="py-2.5 px-3">
                            <div class="flex items-center gap-2">
                                ${displayBadge}
                                <span class="font-bold text-white text-xs truncate max-w-[150px]" title="${name}">${name}</span>
                            </div>
                        </td>
                        <td class="py-2.5 px-3 font-mono text-amber-300 text-xs">${ip}</td>
                        <td class="py-2.5 px-3 text-slate-300 text-xs">${device}</td>
                        <td class="py-2.5 px-3 text-center text-slate-400 text-xs font-mono">${timeStr}</td>
                        <td class="py-2.5 px-3 text-center">
                            <span class="px-2.5 py-1 rounded-lg ${isBanned ? 'bg-rose-500/20 text-rose-200 border border-rose-500/30' : 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/30'} font-semibold text-[11px] inline-block max-w-[220px] truncate" title="${scoreInfo}">
                                ${scoreInfo}
                            </span>
                        </td>
                        <td class="py-2.5 px-3 text-right">
                            <div class="flex items-center justify-end gap-1.5 flex-wrap">
                                <button onclick="app.adminToggleStudentAiRole('${ip}', '${name.replace(/'/g, "\\'")}')" class="px-2.5 py-1 rounded-lg ${isAiGranted ? 'bg-purple-600/30 text-purple-200 border border-purple-500/50 hover:bg-rose-600/30' : 'bg-slate-800 text-slate-300 hover:text-white border border-slate-700 hover:bg-purple-600/30'} text-xs font-bold transition cursor-pointer" title="${isAiGranted ? 'Bấm để thu hồi quyền Trợ lý AI' : 'Bấm để cấp quyền sử dụng Trợ lý AI cho IP này'}">
                                    <i class="fa-solid fa-wand-magic-sparkles mr-1 ${isAiGranted ? 'text-amber-300' : 'text-slate-400'}"></i> ${isAiGranted ? 'Đã có AI' : 'Cấp AI'}
                                </button>
                                ${isBanned ? `
                                    <button onclick="app.adminUnbanStudentIp('${ip}')" class="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 text-xs font-bold transition cursor-pointer" title="Bấm để mở chặn cho IP này">
                                        <i class="fa-solid fa-lock-open mr-1"></i> Mở Chặn
                                    </button>
                                ` : `
                                    <button onclick="app.adminBanStudentIp('${ip}')" class="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-bold transition cursor-pointer" title="Bấm để chặn ngay IP này">
                                        <i class="fa-solid fa-ban mr-1"></i> Chặn IP
                                    </button>
                                `}
                            </div>
                        </td>
                    </tr>
                `;
            });
            tbody.innerHTML = rowsHtml;
            this.renderAdminBannedIpsList();
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-rose-400">Lỗi tải danh sách: ${e.message}</td></tr>`;
        }
    }

    async adminClearAllLogins() {
        if (!confirm("Bạn có chắc chắn muốn xóa toàn bộ lịch sử đăng nhập?")) return;
        try {
            if (window.dbService && typeof window.dbService.clearAllLogins === 'function') {
                await window.dbService.clearAllLogins();
                this.renderAdminStudentsList();
            }
        } catch (e) {
            alert("Lỗi: " + e.message);
        }
    }

    async adminBroadcastNotice() {
        const input = document.getElementById('admin-notice-input');
        const text = input ? input.value.trim() : '';
        if (!text) return;

        try {
            if (window.dbService && typeof window.dbService.broadcastNotice === 'function') {
                await window.dbService.broadcastNotice(text);
                if (input) input.value = '';
                alert("Đã phát thông báo thành công đến tất cả thí sinh!");
            }
        } catch (e) {
            alert("Lỗi phát thông báo: " + e.message);
        }
    }

    adminQuickNotice(text) {
        const input = document.getElementById('admin-notice-input');
        if (input) input.value = text;
        this.adminBroadcastNotice();
    }

    async adminBanManualIp() {
        const input = document.getElementById('admin-ban-ip-input');
        const ip = input ? input.value.trim() : '';
        if (!ip) {
            alert("Vui lòng nhập địa chỉ IP cần chặn.");
            return;
        }
        await this.adminBanStudentIp(ip);
        if (input) input.value = '';
    }

    async adminBanStudentIp(ip) {
        if (!confirm(`Bạn có chắc chắn muốn CHẶN NGAY LẬP TỨC địa chỉ IP: ${ip}?`)) return;
        try {
            if (window.dbService && typeof window.dbService.banIp === 'function') {
                await window.dbService.banIp(ip, "Gian lận / Vi phạm quy chế phòng thi");
                alert(`Đã kích hoạt lệnh chặn đối với IP: ${ip}!`);
                await this.loadBannedIpsList();
                this.renderAdminStudentsList();
                this.renderAdminBannedIpsList();
            }
        } catch (e) {
            alert("Lỗi chặn IP: " + e.message);
        }
    }

    async adminUnbanStudentIp(ip) {
        if (!confirm(`Bạn có chắc chắn muốn MỞ CHẶN cho địa chỉ IP: ${ip}?`)) return;
        try {
            if (window.dbService && typeof window.dbService.unbanIp === 'function') {
                await window.dbService.unbanIp(ip);
                alert(`✅ Đã mở chặn thành công cho IP: ${ip}!`);
                await this.loadBannedIpsList();
                this.renderAdminStudentsList();
                this.renderAdminBannedIpsList();
            }
        } catch (e) {
            alert("Lỗi mở chặn IP: " + e.message);
        }
    }

    async loadBannedIpsList() {
        try {
            if (window.dbService && typeof window.dbService.fetchBannedIpsList === 'function') {
                this.bannedIpsList = await window.dbService.fetchBannedIpsList();
            } else if (window.dbService && typeof window.dbService.getBannedIps === 'function') {
                const map = window.dbService.getBannedIps();
                this.bannedIpsList = Object.keys(map).map(k => ({ ip: k, reason: map[k].reason, bannedAt: map[k].bannedAt }));
            }
        } catch (e) {
            console.warn("Lỗi loadBannedIpsList:", e);
            this.bannedIpsList = [];
        }
    }

    renderAdminBannedIpsList() {
        const container = document.getElementById('admin-banned-ips-list-container');
        const countBadge = document.getElementById('admin-banned-ips-count');
        if (!container) return;

        const list = this.bannedIpsList || [];
        if (countBadge) countBadge.textContent = list.length;

        if (list.length === 0) {
            container.innerHTML = `
                <div class="py-3 px-4 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
                    <i class="fa-solid fa-circle-check text-emerald-400 mr-1.5"></i>
                    Hiện không có địa chỉ IP nào bị chặn. Toàn bộ thí sinh truy cập bình thường.
                </div>
            `;
            return;
        }

        container.innerHTML = list.map(item => {
            const timeStr = item.bannedAt ? new Date(item.bannedAt).toLocaleString('vi-VN') : '—';
            const name = item.playerName || 'Không rõ';
            const reason = item.reason || 'Vi phạm quy chế';
            return `
                <div class="p-2.5 rounded-xl bg-slate-950/80 border border-rose-500/30 flex flex-wrap items-center justify-between gap-2.5">
                    <div class="flex items-center gap-2.5">
                        <div class="w-7 h-7 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center text-xs shrink-0">
                            <i class="fa-solid fa-ban"></i>
                        </div>
                        <div>
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="font-mono font-bold text-rose-300 text-xs">${item.ip}</span>
                                <span class="text-[11px] text-slate-300 font-semibold">(${name})</span>
                                <span class="text-[10px] px-2 py-0.5 rounded-full bg-rose-950 text-rose-400 border border-rose-800">${reason}</span>
                            </div>
                            <p class="text-[10px] text-slate-500 mt-0.5">Thời gian chặn: ${timeStr} • Thiết bị: ${item.deviceInfo || '—'}</p>
                        </div>
                    </div>
                    <button onclick="app.adminUnbanStudentIp('${item.ip}')" class="px-3 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ml-auto shrink-0" title="Bỏ chặn IP này để thí sinh vào lại">
                        <i class="fa-solid fa-lock-open text-[11px]"></i>
                        <span>Mở Khóa IP</span>
                    </button>
                </div>
            `;
        }).join('');
    }

    async adminEmergencyUnban() {
        const pass = prompt("Nhập mật khẩu Admin để mở khóa khẩn cấp:");
        if (pass === this.adminSecretPass) {
            try {
                if (window.dbService && typeof window.dbService.unbanIp === 'function') {
                    await window.dbService.unbanIp(this.clientIp);
                    alert("Đã gỡ chặn IP thành công! Đang tải lại trang...");
                    location.reload();
                }
            } catch (e) {
                alert("Lỗi mở khóa: " + e.message);
            }
        } else {
            alert("Mật khẩu không chính xác!");
        }
    }

    /* ============================================================== */
    /* 12. CÀI ĐẶT SUPABASE CLOUD & TRÌNH SOẠN THẢO CÂU HỎI ĐƠN LẺ   */
    /* ============================================================== */

    openSettingsModal() {
        const modal = document.getElementById('modal-settings');
        const urlInput = document.getElementById('supabase-url-input');
        const keyInput = document.getElementById('supabase-key-input');
        const statusBadge = document.getElementById('supabase-modal-status-badge');

        const cfg = (window.dbService && typeof window.dbService.getConfig === 'function')
            ? window.dbService.getConfig()
            : { url: '', anonKey: '', isActive: false };

        const fallbackUrl = cfg.url || (window.dbService ? window.dbService.url : '') || localStorage.getItem('quiz_supabase_url') || 'https://qotfikuiwmruicsvsbgq.supabase.co';
        const fallbackKey = cfg.anonKey || (window.dbService ? window.dbService.anonKey : '') || localStorage.getItem('quiz_supabase_key') || 'sb_publishable_KtAmEX6Jj97BNElniBrX6w_wVyCeQYs';

        if (urlInput) urlInput.value = fallbackUrl;
        if (keyInput) keyInput.value = fallbackKey;

        if (statusBadge) {
            const isOnline = window.dbService && window.dbService.isSupabaseActive;
            statusBadge.innerHTML = isOnline
                ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">🟢 Đã Kết Nối Cloud</span>`
                : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">🟡 Đang Đồng Bộ</span>`;
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
            alert("Vui lòng nhập đầy đủ Project URL và Anon Public Key.");
            return;
        }

        try {
            if (window.dbService && typeof window.dbService.saveConfig === 'function') {
                window.dbService.saveConfig(url, key);
            } else {
                localStorage.setItem('quiz_supabase_url', url);
                localStorage.setItem('quiz_supabase_key', key);
                if (window.dbService) {
                    window.dbService.url = url;
                    window.dbService.anonKey = key;
                    if (window.supabase) {
                        window.dbService.client = window.supabase.createClient(url, key);
                        window.dbService.isSupabaseActive = true;
                    }
                }
            }
            alert("✅ Đã lưu kết nối Supabase Cloud thành công!");
            this.closeSettingsModal();
        } catch (e) {
            alert("Lỗi lưu cấu hình: " + e.message);
        }
    }

    clearSupabaseConfig() {
        if (!confirm("Bạn có chắc chắn muốn khôi phục về cấu hình Supabase Cloud mặc định của hệ thống?")) return;
        localStorage.removeItem('quiz_supabase_url');
        localStorage.removeItem('quiz_supabase_key');
        localStorage.removeItem('supabase_url');
        localStorage.removeItem('supabase_key');
        if (window.dbService && typeof window.dbService.clearConfig === 'function') {
            window.dbService.clearConfig();
        }
        alert("✅ Đã khôi phục cài đặt gốc! Đang tải lại trang...");
        location.reload();
    }

    openNewQuestionModal(subjectKey) {
        if (subjectKey) {
            this.currentSubject = subjectKey;
        }
        this.openEditQuestionModal(null, subjectKey);
    }

    openEditQuestionModal(qId, targetSubject) {
        const modal = document.getElementById('modal-question-editor');
        const title = document.getElementById('editor-modal-title');
        const idInput = document.getElementById('edit-q-id');
        const subjSelect = document.getElementById('edit-q-subject');
        const catInput = document.getElementById('edit-q-category');
        const textInput = document.getElementById('edit-q-text');
        const imgInput = document.getElementById('edit-q-image');
        const expInput = document.getElementById('edit-q-explanation');

        this.populateSubjectDropdowns();
        const activeSub = targetSubject || this.currentSubject;
        if (subjSelect) subjSelect.value = activeSub;

        if (qId) {
            const q = this.allQuestions.find(item => String(item.id) === String(qId));
            if (q) {
                const badge = document.getElementById('editor-modal-badge');
                if (badge) badge.textContent = `Đang sửa Câu #${q.id}`;
                if (idInput) idInput.value = q.id;
                if (catInput) catInput.value = q.category || 'Ôn tập';
                if (textInput) textInput.value = q.question || '';
                if (imgInput) imgInput.value = q.image_url || '';
                if (expInput) expInput.value = q.explanation || '';

                if (q.options && q.options.length >= 4) {
                    for (let i = 0; i < 4; i++) {
                        const optEl = document.getElementById(`edit-q-opt-${i}`);
                        if (optEl) optEl.value = q.options[i] || '';
                    }
                }
                const correctIdx = q.correct !== undefined ? q.correct : (q.answer !== undefined ? q.answer : 0);
                this.setEditorCorrectAnswer(correctIdx);
            }
        } else {
            const badge = document.getElementById('editor-modal-badge');
            if (badge) badge.textContent = "Thêm Câu Hỏi Mới";
            if (idInput) idInput.value = '';
            if (catInput) catInput.value = 'Ôn tập';
            if (textInput) textInput.value = '';
            if (imgInput) imgInput.value = '';
            if (expInput) expInput.value = '';
            for (let i = 0; i < 4; i++) {
                const optEl = document.getElementById(`edit-q-opt-${i}`);
                if (optEl) optEl.value = '';
            }
            this.setEditorCorrectAnswer(0);
        }

        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    }

    setEditorCorrectAnswer(idx) {
        this._editorSelectedCorrect = idx;
        const optChars = ['A', 'B', 'C', 'D'];
        for (let i = 0; i < 4; i++) {
            const btn = document.getElementById(`btn-edit-ans-${i}`);
            if (btn) {
                if (i === idx) {
                    btn.className = "px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 border border-emerald-500 bg-emerald-500/20 text-emerald-300 shadow-sm cursor-pointer";
                    btn.innerHTML = `<i class="fa-solid fa-circle-dot text-emerald-400"></i> <span>Đáp án ${optChars[i]}</span>`;
                } else {
                    btn.className = "px-3.5 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shrink-0 border border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-slate-200 cursor-pointer";
                    btn.innerHTML = `<i class="fa-regular fa-circle text-slate-500"></i> <span>Đáp án ${optChars[i]}</span>`;
                }
            }
        }
    }

    closeQuestionEditor() {
        const modal = document.getElementById('modal-question-editor');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    async saveQuestionFromEditor(event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        const idInput = document.getElementById('edit-q-id');
        const subjSelect = document.getElementById('edit-q-subject');
        const catInput = document.getElementById('edit-q-category');
        const textInput = document.getElementById('edit-q-text');
        const imgInput = document.getElementById('edit-q-image');
        const expInput = document.getElementById('edit-q-explanation');

        const targetSubject = (subjSelect && subjSelect.value) ? subjSelect.value : this.currentSubject;
        const qId = idInput && idInput.value ? parseInt(idInput.value, 10) : null;
        const questionText = textInput ? textInput.value.trim() : '';

        if (!questionText) {
            alert("Vui lòng nhập nội dung câu hỏi.");
            return;
        }

        const options = [];
        for (let i = 0; i < 4; i++) {
            const optEl = document.getElementById(`edit-q-opt-${i}`);
            options.push(optEl ? optEl.value.trim() : '');
        }

        let correct = this._editorSelectedCorrect !== undefined ? this._editorSelectedCorrect : 0;
        const optLetter = ['A', 'B', 'C', 'D'][correct];

        const newQ = {
            id: qId || undefined,
            subjectKey: targetSubject,
            qType: 'mcq',
            category: catInput ? catInput.value.trim() : 'Ôn tập',
            question: questionText,
            image_url: imgInput ? imgInput.value.trim() : null,
            options: options,
            correct: correct,
            answer: correct,
            correctAnswer: optLetter,
            explanation: expInput ? expInput.value.trim() : ''
        };

        let previousQuestion = null;
        let previousQuestionIndex = -1;
        if (targetSubject === this.currentSubject) {
            if (qId) {
                const idx = this.allQuestions.findIndex(item => String(item.id) === String(qId));
                previousQuestionIndex = idx;
                if (idx >= 0) {
                    previousQuestion = this.allQuestions[idx];
                    this.allQuestions[idx] = newQ;
                }
                else this.allQuestions.push(newQ);
            } else {
                this.allQuestions.push(newQ);
            }
            try {
                localStorage.setItem(`quiz_cache_${this.currentSubject}`, JSON.stringify(this.allQuestions));
            } catch (ce) { }
        }

        // Lưu đơn lẻ nguyên tử lên Supabase Cloud (Không xóa nhầm dữ liệu cũ)
        try {
            const result = window.dbService && typeof window.dbService.saveQuestion === 'function'
                ? await window.dbService.saveQuestion(newQ, targetSubject)
                : { success: false, error: 'Dịch vụ Supabase chưa sẵn sàng.' };
            if (!result || result.success === false || result.localOnly) throw new Error(result?.error || 'Supabase Cloud không khả dụng, câu hỏi chưa được đồng bộ.');
            if (result.item?.id !== undefined) newQ.id = result.item.id;
        } catch (error) {
            if (targetSubject === this.currentSubject) {
                if (previousQuestionIndex >= 0 && previousQuestion) this.allQuestions[previousQuestionIndex] = previousQuestion;
                else this.allQuestions = this.allQuestions.filter((item) => item !== newQ);
                try { localStorage.setItem(`quiz_cache_${targetSubject}`, JSON.stringify(this.allQuestions)); } catch (cacheError) { }
                this.renderAdminQuestionsList();
            }
            console.error("Lỗi lưu câu hỏi lên Cloud:", error);
            this.showToastNotification(`Không thể đồng bộ câu hỏi lên Cloud: ${error.message}`, 'error');
            alert(`Không thể lưu câu hỏi lên Supabase Cloud.\n${error.message}`);
            return;
        }
        if (targetSubject === this.currentSubject) {
            try { localStorage.setItem(`quiz_cache_${targetSubject}`, JSON.stringify(this.allQuestions)); } catch (e) { }
        }

        const sub = this.dynamicSubjects.find(s => s.key === targetSubject);
        if (sub) {
            if (targetSubject === this.currentSubject) {
                sub.count = this.allQuestions.length;
            }
            if (window.dbService && typeof window.dbService.saveDynamicSubjects === 'function') {
                window.dbService.saveDynamicSubjects(this.dynamicSubjects);
            }
        }

        this.closeQuestionEditor();
        this.renderAdminQuestionsList();
        this.renderHomeSubjects();
        this.updateNavbarAndBadge();
        this.showToastNotification("Đã lưu câu hỏi và đồng bộ lên Supabase Cloud.", 'success');
    }

    async adminDeleteQuestion(qId) {
        if (!confirm(`Bạn có chắc muốn xóa câu hỏi #${qId}?`)) return;
        this.allQuestions = this.allQuestions.filter(q => q.id !== qId);
        try {
            if (window.dbService && typeof window.dbService.saveQuestionsBulk === 'function') {
                await window.dbService.saveQuestionsBulk(this.currentSubject, this.allQuestions, true);
            }
        } catch (e) { }

        try {
            localStorage.setItem(`quiz_cache_${this.currentSubject}`, JSON.stringify(this.allQuestions));
        } catch (ce) { }

        const sub = this.dynamicSubjects.find(s => s.key === this.currentSubject);
        if (sub) {
            sub.count = this.allQuestions.length;
            if (window.dbService && typeof window.dbService.saveDynamicSubjects === 'function') {
                window.dbService.saveDynamicSubjects(this.dynamicSubjects);
            }
        }

        this.renderAdminQuestionsList();
        this.renderHomeSubjects();
        this.updateNavbarAndBadge();
    }

    /* ============================================================== */
    /* 13. TỰ LUẬN ĐỊA LÍ 11 (DÀN Ý ÔN TẬP CŨ)                        */
    /* ============================================================== */

    openGeographyEssayModal() {
        const modal = document.getElementById('modal-geography-essay');
        const content = document.getElementById('geography-essay-content');
        if (content && Array.isArray(window.GEOGRAPHY_ESSAY_QUESTIONS)) {
            content.innerHTML = window.GEOGRAPHY_ESSAY_QUESTIONS.map(item => `
                <div class="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/30 space-y-1.5">
                    <h4 class="font-bold text-emerald-300 text-xs sm:text-sm">${item.title}</h4>
                    <p class="text-slate-300 whitespace-pre-line text-xs leading-relaxed">${item.content}</p>
                </div>
            `).join('');
        }
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    }

    closeGeographyEssayModal() {
        const modal = document.getElementById('modal-geography-essay');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    /* ============================================================== */
    /* 14. TRỢ LÝ AI GEMINI (GEMINI 2.5 FLASH API INTEGRATION)        */
    /* ============================================================== */

    async loadGlobalGeminiApiKey() {
        try {
            if (window.dbService && typeof window.dbService.fetchGeminiApiKey === 'function') {
                const cloudKey = await window.dbService.fetchGeminiApiKey();
                if (cloudKey) {
                    this.geminiApiKey = cloudKey;
                    return cloudKey;
                }
            }
        } catch (e) {
            console.warn('Không thể tải khóa Gemini từ Cloud:', e);
        }
        this.geminiApiKey = '';
        return this.geminiApiKey;
    }

    openAiSettingsModal() {
        if (!this.isAdminAuthenticated) {
            alert("🔒 Tính năng cấu hình Gemini API Key chỉ dành riêng cho Quản trị viên (Admin).");
            return;
        }
        const modal = document.getElementById('modal-ai-settings');
        const input = document.getElementById('gemini-api-key-input');
        if (input) input.value = this.geminiApiKey || '';
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }
    }

    openGeminiApiKeyModal() {
        this.openAiSettingsModal();
    }

    closeAiSettingsModal() {
        const modal = document.getElementById('modal-ai-settings');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    async saveAiApiKey() {
        if (!this.isAdminAuthenticated) {
            alert("🔒 Chỉ Quản trị viên mới được thay đổi Gemini API Key.");
            return;
        }
        const input = document.getElementById('gemini-api-key-input');
        const key = (input ? input.value : '').trim();
        if (!key) {
            alert("Vui lòng dán mã Google Gemini API Key để lưu.");
            return;
        }
        this.geminiApiKey = key;

        let cloudSuccess = false;
        try {
            if (window.dbService && typeof window.dbService.saveGeminiApiKey === 'function') {
                cloudSuccess = await window.dbService.saveGeminiApiKey(key);
            }
        } catch (e) {
            console.warn("Lỗi lưu API key lên Cloud:", e);
        }

        if (cloudSuccess) {
            alert("✅ Đã lưu khóa AI trên Cloud. Học sinh chỉ sử dụng được khi IP đã được cấp quyền AI.");
        } else {
            alert("✅ Đã lưu khóa Gemini API Key lên Cloud.");
        }
        this.closeAiSettingsModal();
    }

    async clearAiApiKey() {
        if (!this.isAdminAuthenticated) {
            alert("🔒 Chỉ Quản trị viên mới được xóa Gemini API Key.");
            return;
        }
        if (!confirm("Bạn có chắc muốn xóa API Key khỏi toàn bộ hệ thống?")) return;
        localStorage.removeItem('gemini_api_key');
        this.geminiApiKey = '';
        const input = document.getElementById('gemini-api-key-input');
        if (input) input.value = '';

        try {
            if (window.dbService && typeof window.dbService.saveGeminiApiKey === 'function') {
                await window.dbService.saveGeminiApiKey('');
            }
        } catch (e) {}

        alert("Đã xóa API Key khỏi hệ thống.");
    }

    async askAiExplanation(qId) {
        // Kiểm tra quyền hạn theo IP: Phải là Admin hoặc được Admin cấp quyền IP
        await this.loadAiIpsConfig();
        if (!this.isAiAllowedForCurrentClient()) {
            alert(`🔒 BẠN CHƯA ĐƯỢC CẤP QUYỀN SỬ DỤNG TRỢ LÝ AI!\n\nĐịa chỉ IP của bạn: ${this.clientIp}\n\nTính năng Trợ lý AI giải thích bài yêu cầu Quản trị viên (Admin) cấp quyền theo địa chỉ IP. Vui lòng gửi địa chỉ IP của bạn cho Admin để được kích hoạt quyền.`);
            return;
        }

        let apiKey = this.geminiApiKey || '';
        if (!apiKey) {
            apiKey = await this.loadGlobalGeminiApiKey();
        }

        if (!apiKey) {
            if (this.isAdminAuthenticated) {
                alert("✨ Chưa cấu hình Gemini API Key. Hãy nhập khóa trong khu vực Admin, sau đó cấp quyền AI cho từng IP.");
                this.openAiSettingsModal();
            } else {
                alert("✨ Trợ lý AI đang chờ giáo viên/quản trị viên cấu hình khóa API chung. Vui lòng báo quản trị viên cài đặt!");
            }
            return;
        }

        const q = (this.allQuestions || []).find(item => item.id == qId);
        if (!q) {
            alert("Không tìm thấy dữ liệu câu hỏi.");
            return;
        }

        const isResultVisible = this.screens.result && !this.screens.result.classList.contains('hidden');
        const reviewDiv = document.getElementById(`ai-explanation-review-${qId}`);
        const quizDiv = document.getElementById(`ai-explanation-${qId}`);
        const targetDiv = isResultVisible ? (reviewDiv || quizDiv) : (quizDiv || reviewDiv);

        const reviewBtn = document.getElementById(`ai-btn-review-${qId}`);
        const quizBtn = document.getElementById(`ai-btn-${qId}`);
        const btn = isResultVisible ? (reviewBtn || quizBtn) : (quizBtn || reviewBtn);

        if (!targetDiv) return;

        targetDiv.classList.remove('hidden');
        targetDiv.innerHTML = `
            <div class="flex items-center gap-2.5 text-purple-300 font-bold py-2">
                <i class="fa-solid fa-spinner fa-spin text-base text-amber-400"></i>
                <span>Trợ lý AI đang phân tích câu hỏi & biên soạn lời giải thích ngắn gọn, dễ hiểu...</span>
            </div>
        `;

        if (btn) btn.disabled = true;

        let optionsText = "";
        let correctText = "";
        let studentAnswerText = "";

        if (q.qType === 'short_answer') {
            correctText = q.correctValue || (q.acceptedValues ? q.acceptedValues.join(', ') : '');
            studentAnswerText = this.userAnswers[q.id] || "Chưa trả lời";
        } else if (q.qType === 'tf_group') {
            const ansObj = this.userAnswers[q.id] || {};
            optionsText = (q.statements || []).map((st, i) => `${String.fromCharCode(97 + i)}) ${st.text} [Đáp án: ${st.answer ? 'Đúng' : 'Sai'}]`).join('\n');
            studentAnswerText = (q.statements || []).map((st, i) => `${String.fromCharCode(97 + i)}) ${ansObj[i] === true ? 'Đúng' : (ansObj[i] === false ? 'Sai' : 'Chưa chọn')}`).join(', ');
            correctText = "Đã liệt kê theo từng ý.";
        } else {
            const optChars = ['A', 'B', 'C', 'D'];
            optionsText = (q.options || []).map((opt, i) => `${optChars[i]}. ${opt}`).join('\n');
            const cIdx = q.correct !== undefined ? q.correct : q.answer;
            correctText = `${optChars[cIdx]}. ${(q.options && q.options[cIdx]) || ''}`;
            const sIdx = this.userAnswers[q.id];
            studentAnswerText = (sIdx !== undefined && q.options) ? `${optChars[sIdx]}. ${q.options[sIdx]}` : "Chưa chọn đáp án";
        }

        const prompt = `Bạn là trợ lý học tập thông minh, chuyên giải thích bài ngắn gọn và cực kỳ dễ hiểu cho học sinh Việt Nam.
Hãy giải thích câu hỏi sau một cách NGẮN GỌN, TRỌNG TÂM, DỄ HIỂU NHẤT (khoảng 3 - 5 câu, tuyệt đối không viết dài dòng):

- Môn học: ${this.getSubjectTitle()}
- Câu hỏi: ${q.question}
${optionsText ? `- Các phương án:\n${optionsText}` : ''}
- Đáp án đúng: ${correctText}
${studentAnswerText ? `- Học sinh chọn: ${studentAnswerText}` : ''}

CẤU TRÚC GIẢI THÍCH (ngắn gọn, trực tiếp, rõ ràng):
✅ **Vì sao đúng?**: Nêu bản chất/lý do cốt lõi trong 1-2 câu ngắn gọn, dễ hiểu nhất.
💡 **Bẫy cần tránh (nếu có)**: Chỉ ra điểm học sinh hay nhầm lẫn trong 1 câu ngắn.
⚡ **Mẹo nhớ nhanh**: 1 câu từ khóa / mẹo nhớ ngay lập tức.

YÊU CẦU:
- Văn phong tự nhiên, súc tích, dễ hiểu như gia sư dạy 1 kèm 1, tuyệt đối không viết văn dài dòng hay lý thuyết lan man.
- Nếu có công thức toán/lý, bắt buộc kẹp công thức LaTeX giữa dấu $ (ví dụ $v = \\omega A$, $x^2$).`;

        try {
            const candidateModels = ['gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.0-flash'];

            let res = null;
            let lastErrMsg = "";

            for (const model of candidateModels) {
                try {
                    const callResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: prompt }] }]
                        })
                    });

                    if (callResp.ok) {
                        res = callResp;
                        break;
                    } else {
                        const errData = await callResp.json().catch(() => ({}));
                        lastErrMsg = errData?.error?.message || `Lỗi HTTP ${callResp.status} (${model})`;
                        console.warn(`[QuizMaster AI] Model ${model} gặp lỗi (${callResp.status}):`, lastErrMsg);

                        // Dừng lặp chỉ khi API Key sai định dạng hoàn toàn
                        const isApiKeyInvalid = callResp.status === 400 && (lastErrMsg.includes('API_KEY_INVALID') || lastErrMsg.includes('API key not valid'));
                        if (isApiKeyInvalid) {
                            break;
                        }

                        // Nếu do lỗi server bận/quá tải (503), quota (429), chờ nhẹ rồi fallback
                        if (callResp.status === 503 || callResp.status === 429) {
                            await new Promise(resolve => setTimeout(resolve, 800));
                        }
                        continue;
                    }
                } catch (netErr) {
                    lastErrMsg = netErr.message;
                    console.warn(`[QuizMaster AI] Lỗi mạng khi gọi ${model}:`, netErr);
                }
            }

            if (!res || !res.ok) {
                throw new Error(lastErrMsg || "Không thể kết nối đến máy chủ Google Gemini.");
            }

            const data = await res.json();
            const replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Không nhận được phản hồi từ AI.";

            let formattedHtml = this.formatScientificNotation(replyText)
                .replace(/^### (.*$)/gim, '<h4 class="font-bold text-amber-300 mt-2 mb-1">$1</h4>')
                .replace(/^## (.*$)/gim, '<h3 class="font-bold text-purple-300 mt-2 mb-1 text-sm">$1</h3>')
                .replace(/\*\*(.*?)\*\*/g, '<strong class="text-amber-300 font-bold">$1</strong>')
                .replace(/^\* (.*$)/gim, '<li class="ml-4 list-disc text-slate-200">$1</li>')
                .replace(/\n\n/g, '<p class="mt-1.5"></p>')
                .replace(/\n/g, '<br>');

            targetDiv.innerHTML = `
                <div class="flex items-center justify-between pb-2 mb-2 border-b border-purple-500/30">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-wand-magic-sparkles text-amber-300"></i>
                        <span class="font-heading font-bold text-white text-xs">Lời Giải Thích Chi Tiết Từ Trợ Lý AI (Gemini)</span>
                    </div>
                    <button onclick="app.copyAiText(this)" class="px-2 py-0.5 rounded-lg bg-purple-600/30 hover:bg-purple-600 text-purple-200 hover:text-white text-[10px] font-semibold transition cursor-pointer flex items-center gap-1">
                        <i class="fa-regular fa-copy"></i> Sao chép
                    </button>
                </div>
                <div class="ai-content-body text-xs leading-relaxed text-slate-200">
                    ${formattedHtml}
                </div>
            `;

            this.renderMath(targetDiv);
        } catch (err) {
            targetDiv.innerHTML = `
                <div class="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs space-y-1">
                    <p class="font-bold flex items-center gap-1.5"><i class="fa-solid fa-triangle-exclamation"></i> Không thể tải lời giải thích AI:</p>
                    <p class="text-[11px]">${err.message}</p>
                    <p class="text-[10px] text-slate-400">Mẹo: Kiểm tra lại API Key trong nút [Cài API Key] hoặc mạng Internet.</p>
                </div>
            `;
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    copyAiText(btnEl) {
        const body = btnEl.closest('.ai-explanation-box')?.querySelector('.ai-content-body');
        if (!body) return;
        const text = body.innerText;
        navigator.clipboard.writeText(text).then(() => {
            const original = btnEl.innerHTML;
            btnEl.innerHTML = '<i class="fa-solid fa-check text-emerald-400"></i> Đã chép!';
            setTimeout(() => { btnEl.innerHTML = original; }, 2000);
        });
    }

    /* ============================================================== */
    /* 15. CHẾ ĐỘ NỀN SÁNG / TỐI (DARK / LIGHT MODE TOGGLE)           */
    /* ============================================================== */

    initTheme() {
        const theme = localStorage.getItem('quiz_theme') || 'dark';
        this.applyTheme(theme);
    }

    toggleTheme() {
        const current = localStorage.getItem('quiz_theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        this.applyTheme(next);
    }

    applyTheme(theme) {
        localStorage.setItem('quiz_theme', theme);
        const icon = document.getElementById('theme-toggle-icon');
        if (theme === 'light') {
            document.body.classList.add('light-theme');
            if (icon) icon.className = 'fa-solid fa-sun text-amber-400';
        } else {
            document.body.classList.remove('light-theme');
            if (icon) icon.className = 'fa-solid fa-moon text-amber-300';
        }
    }

    /* ============================================================== */
    /* 16. BỘ PHÁT ÂM THANH CHIẾN THẮNG (CELEBRATION FANFARE SOUND)   */
    /* ============================================================== */

    playFanfareSound() {
        if (!this.soundEnabled) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            const ctx = new AudioCtx();
            if (ctx.state === 'suspended') ctx.resume();

            // Chuỗi nốt khải hoàn C5 -> E5 -> G5 -> Hợp âm C6 ngân vang
            const notes = [
                { freq: 523.25, time: 0.00, dur: 0.12 }, // C5
                { freq: 659.25, time: 0.12, dur: 0.12 }, // E5
                { freq: 783.99, time: 0.24, dur: 0.14 }, // G5
                { freq: 1046.50, time: 0.38, dur: 1.10 } // C6 ngân dài
            ];

            notes.forEach(n => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(n.freq, ctx.currentTime + n.time);

                gain.gain.setValueAtTime(0.22, ctx.currentTime + n.time);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + n.time + n.dur);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(ctx.currentTime + n.time);
                osc.stop(ctx.currentTime + n.time + n.dur);
            });

            // Hợp âm vang phụ họa C5, E5, G5
            setTimeout(() => {
                try {
                    const chordFreqs = [523.25, 659.25, 783.99];
                    chordFreqs.forEach(cf => {
                        const osc2 = ctx.createOscillator();
                        const gain2 = ctx.createGain();
                        osc2.type = 'sine';
                        osc2.frequency.setValueAtTime(cf, ctx.currentTime);
                        gain2.gain.setValueAtTime(0.10, ctx.currentTime);
                        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
                        osc2.connect(gain2);
                        gain2.connect(ctx.destination);
                        osc2.start(ctx.currentTime);
                        osc2.stop(ctx.currentTime + 0.9);
                    });
                } catch (e) {}
            }, 380);

        } catch (e) {
            console.warn("Không thể phát âm thanh fanfare:", e);
        }
    }

    /* ============================================================== */
    /* 17. LỊCH SỬ BÀI LÀM CÁ NHÂN (MY HISTORY MODAL)                 */
    /* ============================================================== */

    getPersonalHistory() {
        try {
            const raw = localStorage.getItem('quiz_my_history');
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    saveToPersonalHistory(record) {
        try {
            let list = this.getPersonalHistory();
            list.unshift(record);
            if (list.length > 10) list = list.slice(0, 10);
            localStorage.setItem('quiz_my_history', JSON.stringify(list));
        } catch (e) {
            console.warn("Lỗi lưu lịch sử cá nhân:", e);
        }
    }

    clearPersonalHistory() {
        if (!confirm("Bạn có chắc chắn muốn xóa toàn bộ 10 bài làm gần nhất trong lịch sử cá nhân?")) return;
        localStorage.removeItem('quiz_my_history');
        this.renderMyHistoryModal();
    }

    openMyHistoryModal() {
        const modal = document.getElementById('modal-my-history');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            this.renderMyHistoryModal();
        }
    }

    closeMyHistoryModal() {
        const modal = document.getElementById('modal-my-history');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    renderMyHistoryModal() {
        const list = this.getPersonalHistory();
        const tbody = document.getElementById('my-history-tbody');
        const countEl = document.getElementById('history-total-count');
        const avgScoreEl = document.getElementById('history-avg-score');
        const avgRatioEl = document.getElementById('history-avg-ratio');

        const totalTests = list.length;
        let sumScore = 0;
        let sumCorrect = 0;
        let sumTotalItems = 0;

        list.forEach(item => {
            sumScore += (item.score || 0);
            sumCorrect += (item.correctCount || 0);
            sumTotalItems += (item.totalCount || 0);
        });

        const avgScore = totalTests > 0 ? (sumScore / totalTests).toFixed(1) : "0";
        const avgRatio = sumTotalItems > 0 ? Math.round((sumCorrect / sumTotalItems) * 100) : 0;

        if (countEl) countEl.textContent = totalTests;
        if (avgScoreEl) avgScoreEl.textContent = `${avgScore} đ`;
        if (avgRatioEl) avgRatioEl.textContent = `${avgRatio}%`;

        if (!tbody) return;

        if (totalTests === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="py-8 text-center text-slate-500 italic">
                        Bạn chưa có bài thi nào trong lịch sử. Hãy bắt đầu làm bài ôn tập ngay!
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = list.map(item => {
            const timeDate = item.submittedAt ? new Date(item.submittedAt).toLocaleString('vi-VN', {
                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
            }) : '—';

            let scoreBadgeClass = "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
            if (item.score < 50) scoreBadgeClass = "bg-rose-500/20 text-rose-300 border-rose-500/30";
            else if (item.score < 80) scoreBadgeClass = "bg-amber-500/20 text-amber-300 border-amber-500/30";

            return `
                <tr class="hover:bg-slate-800/40 transition">
                    <td class="py-2.5 px-3 font-mono text-[11px] text-slate-400">${timeDate}</td>
                    <td class="py-2.5 px-3 font-bold text-white">${item.subjectTitle || 'Chung'}</td>
                    <td class="py-2.5 px-3">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                            ${item.mode || 'Luyện tập'}
                        </span>
                    </td>
                    <td class="py-2.5 px-3 text-center">
                        <span class="px-2.5 py-0.5 rounded-full text-xs font-black border ${scoreBadgeClass}">
                            ${item.score} đ
                        </span>
                    </td>
                    <td class="py-2.5 px-3 text-center font-mono text-slate-300">
                        ${item.correctCount}/${item.totalCount}
                    </td>
                    <td class="py-2.5 px-3 text-right font-mono text-indigo-300">
                        ${item.timeSpent || '—'}
                    </td>
                </tr>
            `;
        }).join('');
    }

    /* ============================================================== */
    /* 18. CHẾ ĐỘ NGOẠI TUYẾN & TỰ ĐỘNG ĐỒNG BỘ (OFFLINE AUTO-SYNC)   */
    /* ============================================================== */

    initNetworkListeners() {
        window.addEventListener('online', () => this.handleNetworkOnline());
        window.addEventListener('offline', () => this.handleNetworkOffline());
        this.updateNetworkStatusBanner(navigator.onLine);
    }

    handleNetworkOnline() {
        this.updateNetworkStatusBanner(true);
        if (window.dbService && typeof window.dbService.syncPendingOfflineData === 'function') {
            window.dbService.syncPendingOfflineData().then(count => {
                if (count > 0) {
                    this.showNetworkToast(`✅ Đã đồng bộ thành công ${count} bản ghi lên Supabase Cloud!`, 'success');
                }
            });
        }
    }

    handleNetworkOffline() {
        this.updateNetworkStatusBanner(false);
    }

    updateNetworkStatusBanner(isOnline) {
        const banner = document.getElementById('network-status-banner');
        const icon = document.getElementById('network-status-icon');
        const text = document.getElementById('network-status-text');
        if (!banner || !icon || !text) return;

        if (isOnline) {
            banner.className = "fixed top-2 left-1/2 -translate-x-1/2 z-[100000] flex items-center gap-2 px-4 py-2 rounded-2xl shadow-2xl text-xs font-bold transition-all duration-300 bg-emerald-600/90 text-white border border-emerald-400";
            icon.className = "fa-solid fa-wifi text-emerald-200";
            text.textContent = "Đã kết nối Internet. Sẵn sàng đồng bộ!";
            setTimeout(() => {
                banner.classList.add('hidden');
                banner.classList.remove('flex');
            }, 3500);
        } else {
            banner.className = "fixed top-2 left-1/2 -translate-x-1/2 z-[100000] flex items-center gap-2 px-4 py-2.5 rounded-2xl shadow-2xl text-xs font-bold transition-all duration-300 bg-amber-600/95 text-white border border-amber-300 animate-pulse";
            icon.className = "fa-solid fa-triangle-exclamation text-amber-200 text-sm";
            text.textContent = "⚠️ Đang mất kết nối Internet! Bài làm vẫn được lưu an toàn trên máy, đừng đóng tab.";
            banner.classList.remove('hidden');
        }
    }

    showNetworkToast(msg, type = 'info') {
        const banner = document.getElementById('network-status-banner');
        const icon = document.getElementById('network-status-icon');
        const text = document.getElementById('network-status-text');
        if (!banner || !icon || !text) return;

        banner.className = `fixed top-2 left-1/2 -translate-x-1/2 z-[100000] flex items-center gap-2 px-4 py-2 rounded-2xl shadow-2xl text-xs font-bold transition-all duration-300 ${type === 'success' ? 'bg-emerald-600/90 text-white border border-emerald-400' : 'bg-slate-900/95 text-indigo-300 border border-indigo-500'}`;
        icon.className = type === 'success' ? "fa-solid fa-circle-check text-emerald-200" : "fa-solid fa-info-circle text-indigo-300";
        text.textContent = msg;
        banner.classList.remove('hidden');
        setTimeout(() => {
            banner.classList.add('hidden');
            banner.classList.remove('flex');
        }, 4000);
    }

    async adminToggleSubjectVisibility(key) {
        const sub = this.dynamicSubjects.find(s => s.key === key);
        if (!sub) return;
        const currentVis = sub.visibility || 'PUBLIC';
        const nextVis = currentVis === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC';
        sub.visibility = nextVis;

        try {
            if (window.dbService && typeof window.dbService.saveDynamicSubject === 'function') {
                await window.dbService.saveDynamicSubject(sub);
            } else if (window.dbService && typeof window.dbService.saveDynamicSubjects === 'function') {
                await window.dbService.saveDynamicSubjects(this.dynamicSubjects);
            }
        } catch (e) {
            console.warn("Lỗi lưu môn lên Supabase:", e);
        }

        localStorage.setItem('quiz_dynamic_subjects', JSON.stringify(this.dynamicSubjects));
        this.renderAdminSubjectsList();
        this.renderHomeSubjects();
        this.populateSubjectDropdowns();
        alert(`Đã đổi môn [${sub.name}] sang trạng thái: ${nextVis === 'PUBLIC' ? 'CÔNG KHAI' : 'RIÊNG TƯ'}`);
    }

    initEventListeners() {
        // Nhấn phím Enter hoặc thay đổi tên học sinh -> tự động ghi nhớ & ghi nhận trạng thái
        const nameInput = document.getElementById('player-name-input');
        if (nameInput) {
            nameInput.addEventListener('change', () => {
                const val = nameInput.value.trim();
                if (val && val !== this.playerName) {
                    this.playerName = val;
                    localStorage.setItem('quiz_user_name', val);
                }
            });
            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.startQuiz();
                }
            });
        }

        // Nhấn Enter tại ô mật mã Admin
        const passInput = document.getElementById('admin-pass-input');
        if (passInput) {
            passInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.verifyAdminPassword();
            });
        }
    }
}

// Khởi tạo ứng dụng toàn cục
window.app = new QuizApp();
