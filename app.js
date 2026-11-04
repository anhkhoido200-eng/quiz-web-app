/**
 * QuizMaster Pro v4.0 - Hệ Thống Ôn Thi Trực Tuyến Toàn Diện
 * Tự động hóa toàn bộ: Phân quyền IP Admin, Đa môn học động, Nạp đề Word/Excel,
 * Xuất điểm Excel, Bảng xếp hạng Top 10, Chế độ bảo trì, Luyện tập vs Thi thử.
 */

class QuizApp {
    constructor() {
        // Môn học & Đa môn học động & Phân loại đợt kiểm tra
        this.currentSubject = 'history';
        this.dynamicSubjects = [];
        this.selectedSemesterFilter = 'all';

        // Thông tin người học & Thiết bị & IP
        this.playerName = "";
        this.clientIp = "Đang nhận diện...";
        this.deviceInfo = this.detectDevice();
        this.currentLoginId = null;

        // Đồng hồ bấm giờ làm bài
        this.secondsElapsed = 0;
        this.timerInterval = null;
        this.isExamMode = false;

        // Âm thanh Ting / Bíp (Web Audio API)
        this.soundEnabled = localStorage.getItem('quiz_sound_enabled') !== 'false';

        // Dữ liệu câu hỏi & Đáp án người dùng
        this.allQuestions = [];
        this.userAnswers = {};      // { [qId]: selectedIndex hoặc { [stmtIdx]: boolean } hoặc string }
        this.currentFilter = 'all';

        // Quyền Quản trị viên (Passwordless Admin IP Whitelist)
        this.isAdminAuthenticated = false;
        this.adminCurrentTab = 'questions';
        this.adminSecretPass = '034569';
        this.allowedAdminIps = [];
        this.masterAdminIp = '';

        // Phân quyền môn Địa Lí (hoặc các môn Private)
        this.allowedGeoIps = [];
        this.geoMode = 'PRIVATE';

        // Chế độ bảo trì hệ thống (Maintenance Mode)
        this.isMaintenanceMode = false;
        this.maintenanceMessage = "Trang web đang tạm dừng để cập nhật đề cương và dữ liệu mới. Vui lòng quay lại sau!";
        this.maintenanceClickCount = 0;
        this.maintenanceClickTimer = null;
        this._maintenanceKeyBlocker = null;

        // Dữ liệu bóc tách từ bộ nạp đề
        this.parsedImportQuestions = [];

        // Cache màn hình
        this.screens = {
            home: document.getElementById('screen-home'),
            quiz: document.getElementById('screen-quiz'),
            result: document.getElementById('screen-result')
        };

        this.init();
    }

    /**
     * Khởi tạo toàn bộ ứng dụng
     */
    async init() {
        this.initEventListeners();
        this.updateSoundIcons();
        this.checkSavedUser();
        await this.loadDynamicSubjects();
        await this.fetchClientIp();
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
        try {
            if (window.dbService && typeof window.dbService.fetchDynamicSubjects === 'function') {
                loaded = await window.dbService.fetchDynamicSubjects();
            }
        } catch (e) {
            console.warn("Không thể tải môn học từ cloud, dùng dữ liệu mặc định:", e);
        }

        if (!Array.isArray(loaded) || loaded.length === 0) {
            const cached = localStorage.getItem('quiz_dynamic_subjects');
            if (cached) {
                try { loaded = JSON.parse(cached); } catch (e) {}
            }
        }

        if (!Array.isArray(loaded) || loaded.length === 0) {
            loaded = this.getDefaultSubjects();
        }

        this.dynamicSubjects = loaded;
        localStorage.setItem('quiz_dynamic_subjects', JSON.stringify(loaded));

        this.renderHomeSubjects();
        this.populateSubjectDropdowns();
    }

    setSemesterFilter(sem) {
        this.selectedSemesterFilter = sem;
        this.renderHomeSubjects();
    }

    createSubjectCard(sub) {
        const isPrivate = sub.visibility === 'PRIVATE';
        const isSelected = this.currentSubject === sub.key;
        const card = document.createElement('button');
        card.type = 'button';
        card.onclick = () => this.selectSubject(sub.key);

        let bgClass = "bg-slate-800/80 border-slate-700 hover:border-slate-600 text-slate-300";
        let iconBg = "bg-slate-700/60 text-slate-300";

        if (isSelected) {
            if (sub.gradient === 'purple') {
                bgClass = "bg-purple-600/25 border-purple-500 text-white shadow-lg shadow-purple-600/20";
                iconBg = "bg-purple-600 text-white";
            } else if (sub.gradient === 'emerald') {
                bgClass = "bg-emerald-600/25 border-emerald-500 text-white shadow-lg shadow-emerald-600/20";
                iconBg = "bg-emerald-600 text-white";
            } else if (sub.gradient === 'rose') {
                bgClass = "bg-rose-600/25 border-rose-500 text-white shadow-lg shadow-rose-600/20";
                iconBg = "bg-rose-600 text-white";
            } else if (sub.gradient === 'amber') {
                bgClass = "bg-amber-600/25 border-amber-500 text-white shadow-lg shadow-amber-600/20";
                iconBg = "bg-amber-600 text-white";
            } else {
                bgClass = "bg-indigo-600/25 border-indigo-500 text-white shadow-lg shadow-indigo-600/20";
                iconBg = "bg-indigo-600 text-white";
            }
        }

        card.className = `p-3 rounded-2xl border transition-all text-left flex items-center gap-3 cursor-pointer ${bgClass}`;
        card.innerHTML = `
            <div class="w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center text-lg shrink-0 shadow">
                <i class="fa-solid ${sub.icon || 'fa-book'}"></i>
            </div>
            <div class="overflow-hidden flex-1">
                <div class="flex items-center justify-between gap-1">
                    <p class="font-bold text-xs sm:text-sm truncate text-white">${sub.name}</p>
                    ${isPrivate ? '<span class="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold">Riêng tư</span>' : ''}
                </div>
                <p class="text-[10px] text-slate-400 mt-0.5 truncate">${sub.semester || 'Đề cương'} • ${sub.count || 0} câu</p>
            </div>
        `;
        return card;
    }

    renderHomeSubjects() {
        const grid = document.getElementById('home-subjects-grid');
        const tabsContainer = document.getElementById('home-semester-tabs');
        if (!grid) return;

        // 1. Lọc các môn học được phép hiển thị cho người dùng hiện tại
        const authorized = this.dynamicSubjects.filter(sub => {
            const isPrivate = sub.visibility === 'PRIVATE';
            return !isPrivate || this.isAdminAuthenticated || this.allowedGeoIps.includes(this.clientIp);
        });

        // 2. Render Tabs Đợt Thi / Phân loại kì thi
        if (tabsContainer) {
            tabsContainer.innerHTML = '';
            const standardOrder = ['Kiểm Tra 15 Phút', 'Kiểm Tra 1 Tiết', 'Giữa Kì 1', 'Cuối Kì 1', 'Giữa Kì 2', 'Cuối Kì 2', 'Ôn Tập Tự Do'];
            const semSet = new Set();
            authorized.forEach(s => semSet.add(s.semester || 'Ôn Tập Tự Do'));

            const sortedSemesters = Array.from(semSet).sort((a, b) => {
                let ia = standardOrder.indexOf(a);
                let ib = standardOrder.indexOf(b);
                if (ia === -1) ia = 99;
                if (ib === -1) ib = 99;
                return ia - ib;
            });

            // Tab [Tất Cả]
            const isAll = this.selectedSemesterFilter === 'all';
            const allBtn = document.createElement('button');
            allBtn.type = 'button';
            allBtn.onclick = () => this.setSemesterFilter('all');
            allBtn.className = `px-3 py-1.5 rounded-xl border text-xs font-semibold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${isAll ? 'bg-indigo-600 text-white border-indigo-500 shadow-md' : 'bg-slate-800/80 text-slate-300 border-slate-700/80 hover:border-slate-600'}`;
            allBtn.innerHTML = `<i class="fa-solid fa-sparkles text-amber-300"></i> Tất Cả (${authorized.length})`;
            tabsContainer.appendChild(allBtn);

            // Từng Tab đợt thi
            sortedSemesters.forEach(sem => {
                const count = authorized.filter(s => (s.semester || 'Ôn Tập Tự Do') === sem).length;
                const isSelected = this.selectedSemesterFilter === sem;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.onclick = () => this.setSemesterFilter(sem);

                let icon = 'fa-bookmark';
                if (sem.includes('15')) icon = 'fa-bolt text-amber-400';
                else if (sem.includes('Tiết') || sem.includes('tiết')) icon = 'fa-pen-clip text-sky-400';
                else if (sem.includes('Giữa')) icon = 'fa-book-open text-indigo-400';
                else if (sem.includes('Cuối')) icon = 'fa-flag-checkered text-emerald-400';
                else if (sem.includes('Tự Do') || sem.includes('tự do')) icon = 'fa-lightbulb text-purple-400';

                btn.className = `px-3 py-1.5 rounded-xl border text-xs font-semibold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${isSelected ? 'bg-indigo-600 text-white border-indigo-500 shadow-md' : 'bg-slate-800/80 text-slate-300 border-slate-700/80 hover:border-slate-600'}`;
                btn.innerHTML = `<i class="fa-solid ${icon}"></i> ${sem} (${count})`;
                tabsContainer.appendChild(btn);
            });
        }

        // 3. Render Grid môn học
        grid.innerHTML = '';
        if (authorized.length === 0) {
            grid.innerHTML = '<div class="p-6 text-center text-slate-400 text-xs italic">Chưa có môn học nào được mở cho thiết bị của bạn.</div>';
            return;
        }

        if (this.selectedSemesterFilter === 'all') {
            // Gộp theo từng nhóm đợt thi
            const standardOrder = ['Kiểm Tra 15 Phút', 'Kiểm Tra 1 Tiết', 'Giữa Kì 1', 'Cuối Kì 1', 'Giữa Kì 2', 'Cuối Kì 2', 'Ôn Tập Tự Do'];
            const groups = {};
            authorized.forEach(sub => {
                const sem = sub.semester || 'Ôn Tập Tự Do';
                if (!groups[sem]) groups[sem] = [];
                groups[sem].push(sub);
            });

            const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
                let ia = standardOrder.indexOf(a);
                let ib = standardOrder.indexOf(b);
                if (ia === -1) ia = 99;
                if (ib === -1) ib = 99;
                return ia - ib;
            });

            sortedGroupKeys.forEach(semName => {
                const subList = groups[semName];
                const groupWrapper = document.createElement('div');
                groupWrapper.className = 'space-y-2';

                let icon = 'fa-folder-open text-indigo-400';
                if (semName.includes('15')) icon = 'fa-bolt text-amber-400';
                else if (semName.includes('Tiết') || semName.includes('tiết')) icon = 'fa-pen-clip text-sky-400';
                else if (semName.includes('Giữa')) icon = 'fa-book-open text-indigo-400';
                else if (semName.includes('Cuối')) icon = 'fa-flag-checkered text-emerald-400';

                groupWrapper.innerHTML = `
                    <div class="flex items-center gap-2 pt-1">
                        <span class="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-slate-800/90 text-slate-200 border border-slate-700/80 flex items-center gap-1.5 shadow-sm">
                            <i class="fa-solid ${icon}"></i> ${semName}
                            <span class="text-[10px] text-slate-400 font-normal">(${subList.length} môn)</span>
                        </span>
                        <div class="flex-1 h-px bg-slate-800/80"></div>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-2.5"></div>
                `;
                const subGrid = groupWrapper.querySelector('.grid');
                subList.forEach(sub => {
                    subGrid.appendChild(this.createSubjectCard(sub));
                });
                grid.appendChild(groupWrapper);
            });
        } else {
            // Hiển thị các môn thuộc tab được chọn
            const filtered = authorized.filter(sub => (sub.semester || 'Ôn Tập Tự Do') === this.selectedSemesterFilter);
            if (filtered.length === 0) {
                grid.innerHTML = `<div class="p-6 text-center text-slate-400 text-xs italic">Chưa có môn học nào trong đợt kiểm tra "${this.selectedSemesterFilter}".</div>`;
                return;
            }
            const subGrid = document.createElement('div');
            subGrid.className = 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-2.5';
            filtered.forEach(sub => {
                subGrid.appendChild(this.createSubjectCard(sub));
            });
            grid.appendChild(subGrid);
        }

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
        const sub = this.dynamicSubjects.find(s => s.key === this.currentSubject);
        const name = sub ? sub.name : this.getSubjectTitle();
        const count = this.allQuestions ? this.allQuestions.length : 0;
        const semester = sub ? sub.semester : 'Giữa Kì 1';

        const navTitle = document.getElementById('navbar-subject-title');
        const navSub = document.getElementById('navbar-subject-subtitle');
        const badge = document.getElementById('home-subject-badge');
        const topTitle = document.getElementById('quiz-top-subject-title');

        if (navTitle) navTitle.textContent = name;
        if (navSub) navSub.textContent = `Hệ Thống Ôn Tập Đề Cương ${semester}`;
        if (badge) badge.textContent = `${name} (${count} câu)`;
        if (topTitle) topTitle.textContent = name;
    }

    getSubjectTitle() {
        const s = this.dynamicSubjects.find(sub => sub.key === this.currentSubject);
        return s ? s.name : (this.currentSubject === 'physics' ? 'Vật Lí 11' : (this.currentSubject === 'geography' ? 'Địa Lí 11' : 'Lịch Sử 11'));
    }

    async selectSubject(subjKey) {
        if (subjKey === this.currentSubject) return;
        this.currentSubject = subjKey;
        this.renderHomeSubjects();
        await this.loadQuestionsForCurrentSubject();
        this.updateTotalQuestionDisplay();
        this.renderFilterTabs();
    }

    async loadQuestionsForCurrentSubject() {
        let questions = [];

        // 1. Thử lấy từ Supabase Cloud
        try {
            if (window.dbService && typeof window.dbService.fetchQuestionsBySubject === 'function') {
                const cloudQuestions = await window.dbService.fetchQuestionsBySubject(this.currentSubject);
                if (Array.isArray(cloudQuestions) && cloudQuestions.length > 0) {
                    questions = cloudQuestions;
                }
            }
        } catch (e) {
            console.warn("Lỗi tải câu hỏi từ Supabase:", e);
        }

        // 2. Dự phòng: Dữ liệu biến toàn cục đã nhúng trong file JS
        if (questions.length === 0) {
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
            if (!q.id) q.id = idx + 1;
            if (q.qType !== 'short_answer' && q.qType !== 'tf_group' && q.qType !== 'essay') {
                const c = q.correct !== undefined ? q.correct : q.answer;
                q.correct = c;
                q.answer = c;
            }
            return q;
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
                if (this.clientIp.startsWith('Đang')) this.clientIp = "127.0.0.1";
            }
        }

        // Cập nhật nhãn IP hiện tại
        const myIpEl = document.getElementById('admin-my-ip-display');
        if (myIpEl) myIpEl.textContent = this.clientIp;

        // Đồng bộ danh sách IP Admin từ Supabase
        await this.syncAdminIpsConfig();
    }

    async syncAdminIpsConfig() {
        try {
            if (window.dbService && typeof window.dbService.fetchAdminIpsConfig === 'function') {
                const cfg = await window.dbService.fetchAdminIpsConfig();
                this.allowedAdminIps = Array.isArray(cfg.ips) ? cfg.ips : [];
                this.masterAdminIp = cfg.masterIp || '';
            }
        } catch (e) {
            console.warn("Không thể tải danh sách IP Admin:", e);
        }

        // Kiểm tra xem IP hiện tại có quyền Admin không
        const isWhitelisted = this.allowedAdminIps.includes(this.clientIp) || (this.masterAdminIp && this.masterAdminIp === this.clientIp);
        if (isWhitelisted) {
            this.isAdminAuthenticated = true;
        }

        this.updateAdminUIVisibility();
        this.renderAdminIpsTab();
    }

    updateAdminUIVisibility() {
        const floatBtn = document.getElementById('floating-admin-btn');
        const navBtn = document.getElementById('nav-admin-btn');
        const homeActions = document.getElementById('home-admin-subject-actions');

        if (this.isAdminAuthenticated) {
            if (floatBtn) {
                floatBtn.classList.remove('hidden');
                floatBtn.classList.add('flex');
            }
            if (navBtn) {
                navBtn.classList.remove('hidden');
                navBtn.classList.add('flex');
            }
            if (homeActions) homeActions.classList.remove('hidden');
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
        if (this.isAdminAuthenticated) {
            this.openAdminDashboard();
            return;
        }
        const modal = document.getElementById('modal-admin-auth');
        const input = document.getElementById('admin-pass-input');
        const err = document.getElementById('admin-auth-error');
        if (input) input.value = '';
        if (err) err.classList.add('hidden');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            input?.focus();
        }
    }

    closeAdminAuthModal() {
        const modal = document.getElementById('modal-admin-auth');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    async verifyAdminPassword() {
        const input = document.getElementById('admin-pass-input');
        const err = document.getElementById('admin-auth-error');
        const val = input ? input.value.trim() : '';

        if (val === this.adminSecretPass) {
            this.isAdminAuthenticated = true;
            this.closeAdminAuthModal();

            // Tự động cấp quyền vĩnh viễn cho IP hiện tại (Fallback)
            try {
                if (window.dbService && typeof window.dbService.addAdminIp === 'function') {
                    await window.dbService.addAdminIp(this.clientIp, 'Admin Máy Hiện Tại');
                    if (!this.allowedAdminIps.includes(this.clientIp)) {
                        this.allowedAdminIps.push(this.clientIp);
                    }
                }
            } catch (e) {}

            this.updateAdminUIVisibility();
            this.openAdminDashboard();
        } else {
            if (err) err.classList.remove('hidden');
            input?.focus();
        }
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

    /* ============================================================== */
    /* 3. BẢNG ĐIỀU KHIỂN QUẢN TRỊ VIÊN & CHUYỂN TAB (ADMIN DASHBOARD)*/
    /* ============================================================== */

    openAdminDashboard() {
        const modal = document.getElementById('modal-admin-dashboard');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            this.updateAdminMaintenanceUI();
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
        }

        // Kích hoạt render dữ liệu theo từng tab
        if (tabName === 'questions') {
            this.renderAdminQuestionsList();
        } else if (tabName === 'students') {
            this.renderAdminStudentsList();
        } else if (tabName === 'admin-ips') {
            this.renderAdminIpsTab();
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
                } catch (e) {}
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
            } catch (e) {}
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

    openSmartImporter() {
        const modal = document.getElementById('modal-smart-importer');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            this.populateSubjectDropdowns();
            const select = document.getElementById('importer-subject-select');
            if (select) select.value = this.currentSubject;
            this.parsedImportQuestions = [];
            this.renderImporterPreview();
        }
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

    handleImporterFileUpload(event) {
        const file = event.target.files ? event.target.files[0] : null;
        if (!file) return;

        const fileName = file.name.toLowerCase();
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
        }
    }

    convertExcelRowsToQuestions(rows) {
        if (!Array.isArray(rows)) return [];
        return rows.map((r, idx) => {
            const qText = r['Câu hỏi'] || r['Question'] || r['Nội dung'] || r['question'] || `Câu hỏi ${idx + 1}`;
            const optA = String(r['A'] || r['Phương án A'] || '');
            const optB = String(r['B'] || r['Phương án B'] || '');
            const optC = String(r['C'] || r['Phương án C'] || '');
            const optD = String(r['D'] || r['Phương án D'] || '');
            const rawAns = String(r['Đáp án'] || r['Answer'] || r['correct'] || 'A').trim().toUpperCase();
            const exp = String(r['Giải thích'] || r['Explanation'] || '');

            let correctIdx = 0;
            if (rawAns === 'B' || rawAns === '1') correctIdx = 1;
            else if (rawAns === 'C' || rawAns === '2') correctIdx = 2;
            else if (rawAns === 'D' || rawAns === '3') correctIdx = 3;

            return {
                id: idx + 1,
                qType: 'mcq',
                category: r['Chủ đề'] || r['Category'] || 'Đề cương ôn tập',
                question: qText,
                options: [optA, optB, optC, optD],
                correct: correctIdx,
                answer: correctIdx,
                explanation: exp
            };
        });
    }

    parseImporterInput() {
        const textarea = document.getElementById('importer-text-input');
        const rawText = textarea ? textarea.value.trim() : '';

        if (!rawText) {
            alert("Vui lòng dán nội dung văn bản đề thi vào ô trước khi phân tích.");
            return;
        }

        const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
        const questions = [];
        let currentQ = null;

        const saveCurrentQ = () => {
            if (currentQ && currentQ.question) {
                // Xác định dạng câu hỏi
                if (currentQ.statements && currentQ.statements.length > 0) {
                    currentQ.qType = 'tf_group';
                } else if (currentQ.options && currentQ.options.length >= 2) {
                    currentQ.qType = 'mcq';
                } else if (currentQ.correctValue !== undefined) {
                    currentQ.qType = 'short_answer';
                } else {
                    currentQ.qType = 'mcq';
                    if (!currentQ.options) currentQ.options = ["Đúng", "Sai"];
                }
                currentQ.id = questions.length + 1;
                questions.push(currentQ);
            }
            currentQ = null;
        };

        const questionRegex = /^(?:câu|bài|question)\s*(\d+)[\s.:]/i;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (questionRegex.test(line)) {
                saveCurrentQ();
                currentQ = {
                    category: 'Đề cương',
                    question: line.replace(questionRegex, '').trim(),
                    options: [],
                    statements: [],
                    explanation: ''
                };
                continue;
            }

            if (!currentQ) {
                currentQ = {
                    category: 'Đề cương',
                    question: line,
                    options: [],
                    statements: [],
                    explanation: ''
                };
                continue;
            }

            // Nhận diện 4 phương án A, B, C, D
            const mcqMatch = line.match(/^([A-D])[\s.):-]\s*(.*)$/i);
            if (mcqMatch) {
                currentQ.options.push(mcqMatch[2].trim());
                continue;
            }

            // Nhận diện Đúng/Sai nhiều ý a), b), c), d)
            const tfMatch = line.match(/^([a-d])[\s.):-]\s*(.*)$/);
            if (tfMatch) {
                currentQ.statements.push({
                    text: tfMatch[2].trim(),
                    answer: true
                });
                continue;
            }

            // Nhận diện dòng Đáp án
            if (/^(?:đáp án|answer)[\s.:]/i.test(line)) {
                const ansStr = line.replace(/^(?:đáp án|answer)[\s.:]/i, '').trim();

                // Kiểm tra xem có phải dạng a-Đ, b-S không
                if (/a\s*[-:=]\s*[đds]/i.test(ansStr)) {
                    const parts = ansStr.split(/[,;\s]+/);
                    parts.forEach((p, sIdx) => {
                        const m = p.match(/([a-d])\s*[-:=]\s*([đdsStTfF])/i);
                        if (m && currentQ.statements && currentQ.statements[sIdx]) {
                            const val = m[2].toUpperCase();
                            currentQ.statements[sIdx].answer = (val === 'Đ' || val === 'D' || val === 'T');
                        }
                    });
                } else if (/^[A-D]$/i.test(ansStr)) {
                    const char = ansStr.toUpperCase();
                    currentQ.correct = char === 'A' ? 0 : (char === 'B' ? 1 : (char === 'C' ? 2 : 3));
                    currentQ.answer = currentQ.correct;
                } else {
                    currentQ.correctValue = ansStr;
                }
                continue;
            }

            // Nhận diện dòng Giải thích
            if (/^(?:giải thích|lời giải|explanation)[\s.:]/i.test(line)) {
                currentQ.explanation = line.replace(/^(?:giải thích|lời giải|explanation)[\s.:]/i, '').trim();
                continue;
            }

            // Dòng nối tiếp của câu hỏi hoặc phương án
            if (currentQ.options.length > 0) {
                currentQ.options[currentQ.options.length - 1] += ' ' + line;
            } else {
                currentQ.question += ' ' + line;
            }
        }
        saveCurrentQ();

        this.parsedImportQuestions = questions;
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

        this.parsedImportQuestions.forEach((q, idx) => {
            const tr = document.createElement('tr');
            let typeBadge = '<span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold text-[10px]">MCQ (4 đáp án)</span>';
            let ansDisplay = '';

            if (q.qType === 'tf_group') {
                typeBadge = '<span class="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold text-[10px]">Đúng/Sai (Ý)</span>';
                ansDisplay = (q.statements || []).map((st, i) => `${String.fromCharCode(97 + i)}: ${st.answer ? 'Đ' : 'S'}`).join(', ');
            } else if (q.qType === 'short_answer') {
                typeBadge = '<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[10px]">Trả lời ngắn</span>';
                ansDisplay = String(q.correctValue || '');
            } else {
                const optChars = ['A', 'B', 'C', 'D'];
                ansDisplay = optChars[q.correct || 0] || 'A';
            }

            tr.innerHTML = `
                <td class="py-2.5 px-3 text-center font-bold text-slate-400">${idx + 1}</td>
                <td class="py-2.5 px-3">${typeBadge}</td>
                <td class="py-2.5 px-3 font-medium text-white max-w-sm truncate">${q.question}</td>
                <td class="py-2.5 px-3 font-mono font-bold text-amber-300">${ansDisplay}</td>
                <td class="py-2.5 px-3 text-slate-400 italic max-w-xs truncate">${q.explanation || '—'}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    async saveParsedQuestionsToSubject() {
        if (!this.parsedImportQuestions || this.parsedImportQuestions.length === 0) {
            alert("Không có câu hỏi nào để lưu.");
            return;
        }

        const select = document.getElementById('importer-subject-select');
        const replaceCheckbox = document.getElementById('importer-replace-checkbox');
        const targetSubject = select ? select.value : this.currentSubject;
        const replaceAll = replaceCheckbox ? replaceCheckbox.checked : false;

        const count = this.parsedImportQuestions.length;
        if (!confirm(`Bạn có chắc chắn muốn lưu ${count} câu hỏi vào môn [${targetSubject}]?`)) return;

        try {
            if (window.dbService && typeof window.dbService.saveQuestionsBulk === 'function') {
                await window.dbService.saveQuestionsBulk(targetSubject, this.parsedImportQuestions, replaceAll);
            }

            // Nếu đang chọn môn hiện tại thì nạp lại vào bộ nhớ
            if (targetSubject === this.currentSubject) {
                await this.loadQuestionsForCurrentSubject();
            }

            alert(`✅ Đã lưu thành công ${count} câu hỏi vào môn [${targetSubject}]!`);
            this.closeSmartImporter();
            this.renderAdminQuestionsList();
        } catch (e) {
            alert("Lỗi khi lưu câu hỏi vào cơ sở dữ liệu: " + e.message);
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
            card.className = "p-4 rounded-xl bg-slate-800/80 border border-slate-700/80 text-xs space-y-2";

            let optionsHtml = '';
            if (q.options && q.options.length > 0) {
                const optChars = ['A', 'B', 'C', 'D'];
                optionsHtml = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                    ${q.options.map((opt, oIdx) => {
                        const isCorrect = oIdx === (q.correct !== undefined ? q.correct : q.answer);
                        return `
                            <div class="p-1.5 rounded-lg ${isCorrect ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30' : 'bg-slate-900/60 text-slate-300'}">
                                <span class="font-bold">${optChars[oIdx]}.</span> ${opt}
                            </div>
                        `;
                    }).join('')}
                </div>`;
            } else if (q.statements && q.statements.length > 0) {
                optionsHtml = `<div class="space-y-1 pt-1">
                    ${q.statements.map((st, sIdx) => `
                        <div class="flex items-center justify-between p-1.5 rounded-lg bg-slate-900/60 text-slate-300">
                            <span><strong>${String.fromCharCode(97 + sIdx)})</strong> ${st.text}</span>
                            <span class="px-2 py-0.2 rounded font-bold ${st.answer ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}">${st.answer ? 'ĐÚNG' : 'SAI'}</span>
                        </div>
                    `).join('')}
                </div>`;
            }

            card.innerHTML = `
                <div class="flex items-start justify-between gap-3">
                    <div class="flex items-center gap-2">
                        <span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold font-mono">#${q.id || (idx + 1)}</span>
                        <span class="px-2 py-0.5 rounded bg-slate-700 text-slate-300 font-semibold">${q.category || 'Đề cương'}</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <button onclick="app.openEditQuestionModal(${q.id})" class="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition cursor-pointer">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button onclick="app.adminDeleteQuestion(${q.id})" class="px-2 py-1 rounded bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white transition cursor-pointer">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>
                <p class="font-bold text-white text-xs sm:text-sm">${q.question}</p>
                ${optionsHtml}
                ${q.explanation ? `<p class="text-[11px] text-slate-400 italic pt-1 border-t border-slate-700/60"><strong class="text-amber-400">Giải thích:</strong> ${q.explanation}</p>` : ''}
            `;
            container.appendChild(card);
        });

        this.renderMath(container);
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
                <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-700/60">
                    <button onclick="app.openSubjectEditor('${sub.key}')" class="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold transition cursor-pointer">
                        <i class="fa-solid fa-pen-to-square mr-1"></i> Sửa
                    </button>
                    <button onclick="app.adminDeleteSubject('${sub.key}')" class="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-semibold transition cursor-pointer">
                        <i class="fa-solid fa-trash-can mr-1"></i> Xóa
                    </button>
                </div>
            `;
            container.appendChild(card);
        });
    }

    onSemesterSelectChange(val) {
        const customBox = document.getElementById('edit-sub-custom-semester-box');
        const input = document.getElementById('edit-sub-semester');
        if (val === '__CUSTOM__') {
            if (customBox) customBox.classList.remove('hidden');
            if (input) {
                input.value = '';
                input.focus();
            }
        } else {
            if (customBox) customBox.classList.add('hidden');
            if (input) input.value = val;
        }
    }

    openSubjectEditor(key) {
        const modal = document.getElementById('modal-subject-editor');
        const title = document.getElementById('subject-editor-title');
        const idInput = document.getElementById('edit-sub-id');
        const nameInput = document.getElementById('edit-sub-name');
        const keyInput = document.getElementById('edit-sub-key');
        const semInput = document.getElementById('edit-sub-semester');
        const semSelect = document.getElementById('edit-sub-semester-select');
        const customBox = document.getElementById('edit-sub-custom-semester-box');
        const iconSelect = document.getElementById('edit-sub-icon');
        const gradSelect = document.getElementById('edit-sub-gradient');

        let targetSem = 'Giữa Kì 1';

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
                targetSem = sub.semester || 'Giữa Kì 1';
                if (iconSelect) iconSelect.value = sub.icon || 'fa-book';
                if (gradSelect) gradSelect.value = sub.gradient || 'indigo';

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
            targetSem = 'Giữa Kì 1';
        }

        if (semInput) semInput.value = targetSem;
        if (semSelect) {
            let matched = false;
            for (let i = 0; i < semSelect.options.length; i++) {
                if (semSelect.options[i].value === targetSem) {
                    semSelect.selectedIndex = i;
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                semSelect.value = '__CUSTOM__';
                if (customBox) customBox.classList.remove('hidden');
            } else {
                if (customBox) customBox.classList.add('hidden');
            }
        }

        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
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
        const semInput = document.getElementById('edit-sub-semester');
        const semSelect = document.getElementById('edit-sub-semester-select');
        const iconSelect = document.getElementById('edit-sub-icon');
        const gradSelect = document.getElementById('edit-sub-gradient');

        const name = nameInput ? nameInput.value.trim() : '';
        const key = keyInput ? keyInput.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') : '';
        
        let semester = semInput ? semInput.value.trim() : '';
        if (!semester && semSelect && semSelect.value !== '__CUSTOM__') {
            semester = semSelect.value;
        }
        if (!semester) semester = 'Ôn Tập Tự Do';

        const icon = iconSelect ? iconSelect.value : 'fa-book';
        const gradient = gradSelect ? gradSelect.value : 'indigo';

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
        } catch (e) {}

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
                "Họ và Tên": item.player_name || 'Học sinh',
                "Địa Chỉ IP": item.client_ip || '—',
                "Thiết Bị": item.device_info || '—',
                "Môn Thi": item.subject_name || 'Chung',
                "Điểm Số (Thang 100)": item.final_score !== undefined ? item.final_score : '—',
                "Số Ý Đúng": item.correct_count !== undefined ? item.correct_count : '—',
                "Tổng Số Ý": item.total_items !== undefined ? item.total_items : '—',
                "Thời Gian Làm Bài": item.time_spent || '—',
                "Trạng Thái": item.status || 'Hoàn thành',
                "Thời Gian Nộp": item.created_at ? new Date(item.created_at).toLocaleString('vi-VN') : '—'
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
                            <p class="font-bold text-white text-xs truncate" title="${top2.player_name}">${top2.player_name}</p>
                            <p class="font-extrabold text-amber-300 text-sm">${top2.score || 0}đ</p>
                            <p class="text-[10px] text-slate-400 font-mono">${top2.time_spent || '—'}</p>
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
                            <p class="font-extrabold text-white text-xs sm:text-sm truncate" title="${top1.player_name}">${top1.player_name}</p>
                            <p class="font-extrabold text-amber-300 text-base sm:text-lg">${top1.score || 0}đ</p>
                            <p class="text-[10px] text-amber-200/80 font-mono">${top1.time_spent || '—'}</p>
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
                            <p class="font-bold text-white text-xs truncate" title="${top3.player_name}">${top3.player_name}</p>
                            <p class="font-extrabold text-amber-300 text-sm">${top3.score || 0}đ</p>
                            <p class="text-[10px] text-slate-400 font-mono">${top3.time_spent || '—'}</p>
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
                        <td class="py-2.5 px-3 font-semibold text-white max-w-[140px] truncate">${item.player_name}</td>
                        <td class="py-2.5 px-3 text-center font-bold text-emerald-400">${item.score || 0}đ</td>
                        <td class="py-2.5 px-3 text-right font-mono text-slate-400">${item.time_spent || '—'}</td>
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
    /* 8. ÂM THANH & TRẢI NGHIỆM HỌC TẬP (UX ENHANCEMENTS)             */
    /* ============================================================== */

    setExamMode(isExam) {
        this.isExamMode = false;
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
        } catch (e) {}
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
        } catch (e) {}
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
        } catch (e) {}
    }

    /* ============================================================== */
    /* 9. THỰC HIỆN LÀM BÀI TRẮC NGHIỆM & TÍNH ĐIỂM                    */
    /* ============================================================== */

    startQuiz() {
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

        // Khởi tạo bài thi trên Cloud Supabase
        if (window.dbService && typeof window.dbService.recordLogin === 'function') {
            window.dbService.recordLogin(this.playerName, this.clientIp, this.deviceInfo, this.getSubjectTitle())
                .then(id => { this.currentLoginId = id; });
        }

        // Cập nhật Header
        const headerName = document.getElementById('quiz-header-player-name');
        if (headerName) headerName.textContent = this.playerName;

        const modeBadge = document.getElementById('quiz-mode-badge');
        if (modeBadge) {
            modeBadge.textContent = "Ôn Luyện";
            modeBadge.className = "px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30";
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

    clearAutoSaveProgress() {
        const key = `quiz_autosave_${this.currentSubject}_${this.playerName}`;
        localStorage.removeItem(key);
    }

    renderAllQuestions() {
        const container = document.getElementById('questions-container');
        if (!container) return;
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

        filtered.forEach((q, idx) => {
            const card = document.createElement('div');
            card.id = `q-card-${q.id}`;
            card.className = "bg-slate-800/80 backdrop-blur-xl border border-slate-700/80 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4";

            // Render hình ảnh đính kèm nếu có
            const imgHtml = q.image_url ? `
                <div class="my-3 rounded-xl overflow-hidden border border-slate-700 max-w-md mx-auto">
                    <img src="${q.image_url}" alt="Hình minh họa" class="w-full object-contain max-h-64">
                </div>
            ` : '';

            // 1. Dạng Trắc Nghiệm 4 Đáp Án (MCQ)
            if (q.qType !== 'tf_group' && q.qType !== 'short_answer') {
                const optChars = ['A', 'B', 'C', 'D'];
                const selected = this.userAnswers[q.id];
                const isAnswered = selected !== undefined;
                const correctIdx = q.correct !== undefined ? q.correct : q.answer;

                card.innerHTML = `
                    <div class="flex items-center justify-between gap-2">
                        <span class="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold text-xs">Câu ${idx + 1} / ${questions.length}</span>
                        <span class="text-[11px] text-slate-400">${q.category || 'Trắc nghiệm'}</span>
                    </div>
                    <h3 class="font-bold text-white text-sm sm:text-base leading-relaxed">${q.question}</h3>
                    ${imgHtml}
                    <div class="grid grid-cols-1 gap-2 pt-1">
                        ${(q.options || []).map((opt, oIdx) => {
                            let optStyle = "bg-slate-900/80 hover:bg-slate-800 border-slate-700 text-slate-200";
                            if (isAnswered) {
                                if (oIdx === correctIdx) {
                                    optStyle = "bg-emerald-600/25 border-emerald-500 text-emerald-200 font-bold option-selected-correct";
                                } else if (selected === oIdx) {
                                    optStyle = "bg-rose-600/25 border-rose-500 text-rose-200 font-bold option-selected-wrong";
                                }
                            }

                            return `
                                <button type="button" onclick="app.selectOption(${q.id}, ${oIdx})" class="w-full p-3 sm:p-3.5 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${optStyle}">
                                    <span class="w-6 h-6 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs shrink-0">${optChars[oIdx]}</span>
                                    <span class="text-xs sm:text-sm font-medium flex-1 pt-0.5">${opt}</span>
                                </button>
                            `;
                        }).join('')}
                    </div>
                    ${(isAnswered && q.explanation) ? `
                        <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 leading-relaxed">
                            <p class="font-bold text-amber-400 mb-1 flex items-center gap-1.5"><i class="fa-solid fa-lightbulb"></i> Giải thích chi tiết:</p>
                            <p>${q.explanation}</p>
                        </div>
                    ` : ''}
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
                    <h3 class="font-bold text-white text-sm sm:text-base leading-relaxed">${q.question}</h3>
                    ${imgHtml}
                    <div class="space-y-2.5 pt-1">
                        ${stmts.map((st, sIdx) => {
                            const val = ansObj[sIdx];
                            const isAnswered = val !== undefined;

                            let trueBtnClass = "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500";
                            let falseBtnClass = "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500";

                            if (isAnswered) {
                                if (val === true) {
                                    trueBtnClass = (st.answer === true) ? "bg-emerald-600 border-emerald-500 text-white font-bold" : "bg-rose-600 border-rose-500 text-white font-bold";
                                }
                                if (val === false) {
                                    falseBtnClass = (st.answer === false) ? "bg-emerald-600 border-emerald-500 text-white font-bold" : "bg-rose-600 border-rose-500 text-white font-bold";
                                }
                            }

                            return `
                                <div class="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                                    <div class="flex items-start gap-2 flex-1">
                                        <span class="font-bold text-indigo-400">${String.fromCharCode(97 + sIdx)})</span>
                                        <span class="text-slate-200 font-medium">${st.text}</span>
                                    </div>
                                    <div class="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                                        <button type="button" onclick="app.selectTfOption(${q.id}, ${sIdx}, true)" class="px-3 py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${trueBtnClass}">
                                            ĐÚNG
                                        </button>
                                        <button type="button" onclick="app.selectTfOption(${q.id}, ${sIdx}, false)" class="px-3 py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${falseBtnClass}">
                                            SAI
                                        </button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
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
                    <h3 class="font-bold text-white text-sm sm:text-base leading-relaxed">${q.question}</h3>
                    ${imgHtml}
                    <div class="pt-2 flex flex-col sm:flex-row gap-2">
                        <input type="text" id="short-input-${q.id}" value="${userVal}" onchange="app.saveShortAnswer(${q.id}, this.value)" placeholder="Nhập đáp án của bạn..." class="flex-1 px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm outline-none focus:border-indigo-500 font-mono">
                        <button type="button" onclick="app.saveShortAnswer(${q.id}, document.getElementById('short-input-${q.id}').value)" class="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition cursor-pointer">
                            Ghi nhận
                        </button>
                    </div>
                `;
            }

            container.appendChild(card);
        });

        this.renderMath(container);
    }

    selectOption(qId, oIdx) {
        const q = this.allQuestions.find(item => item.id === qId);
        if (!q) return;

        this.userAnswers[qId] = oIdx;
        this.saveAutoSaveProgress();

        const correctIdx = q.correct !== undefined ? q.correct : q.answer;
        if (oIdx === correctIdx) {
            this.playTingSound();
        } else {
            this.playBeepSound();
        }

        this.renderAllQuestions();
        this.updateLiveStats();
    }

    selectTfOption(qId, stmtIdx, isTrue) {
        if (!this.userAnswers[qId]) this.userAnswers[qId] = {};
        this.userAnswers[qId][stmtIdx] = isTrue;
        this.saveAutoSaveProgress();

        const q = this.allQuestions.find(item => item.id === qId);
        if (q && q.statements && q.statements[stmtIdx]) {
            if (Boolean(q.statements[stmtIdx].answer) === isTrue) {
                this.playTingSound();
            } else {
                this.playBeepSound();
            }
        }

        this.renderAllQuestions();
        this.updateLiveStats();
    }

    saveShortAnswer(qId, val) {
        if (!val || !val.trim()) return;
        this.userAnswers[qId] = val.trim();
        this.saveAutoSaveProgress();
        this.renderAllQuestions();
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

        if (liveScore) liveScore.textContent = correctCount;
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
        this.secondsElapsed = 0;
        this.timerInterval = setInterval(() => {
            this.secondsElapsed++;
            const m = Math.floor(this.secondsElapsed / 60);
            const s = this.secondsElapsed % 60;
            if (timerDisplay) timerDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }, 1000);
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

        if (scoreEl) scoreEl.textContent = finalScore;
        if (ratioEl) ratioEl.textContent = `${correctCount}/${totalItems}`;

        const secondsUsed = this.secondsElapsed;
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

        // Bắn pháo hoa ăn mừng
        if (typeof confetti === 'function') {
            confetti({ particleCount: 120, spread: 75, origin: { y: 0.6 } });
        }

        this.renderReviewList();
        this.switchScreen('result');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    renderReviewList() {
        const reviewContainer = document.getElementById('review-list');
        if (!reviewContainer) return;
        reviewContainer.innerHTML = '';

        const questions = this.allQuestions || [];
        const optChars = ['A', 'B', 'C', 'D'];

        questions.forEach((q, idx) => {
            const card = document.createElement('div');
            card.className = "p-4 rounded-xl bg-slate-900/80 border border-slate-700/80 text-xs space-y-2";

            let ansReview = '';
            if (q.qType === 'short_answer') {
                const userVal = this.userAnswers[q.id];
                const isMatch = userVal !== undefined && (
                    (q.acceptedValues && q.acceptedValues.some(v => String(v).trim().toLowerCase() === String(userVal).trim().toLowerCase())) ||
                    String(q.correctValue).trim().toLowerCase() === String(userVal).trim().toLowerCase()
                );
                ansReview = `
                    <div class="p-2 rounded-lg ${isMatch ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'} font-bold">
                        Đáp án của bạn: ${userVal || 'Chưa trả lời'} • Đáp án đúng: ${q.correctValue}
                    </div>
                `;
            } else if (q.qType === 'tf_group') {
                const ansObj = this.userAnswers[q.id] || {};
                ansReview = `<div class="space-y-1">
                    ${(q.statements || []).map((st, sIdx) => {
                        const val = ansObj[sIdx];
                        const isCorrect = val !== undefined && Boolean(val) === Boolean(st.answer);
                        return `
                            <div class="flex items-center justify-between p-1.5 rounded bg-slate-950/60">
                                <span>${String.fromCharCode(97 + sIdx)}) ${st.text}</span>
                                <span class="font-bold ${isCorrect ? 'text-emerald-400' : 'text-rose-400'}">
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
                    <div class="p-2 rounded-lg ${isCorrect ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'} font-semibold">
                        Bạn chọn: <strong>${sel !== undefined ? optChars[sel] : 'Chưa chọn'}</strong> • Đáp án đúng: <strong>${optChars[correctIdx]}</strong>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="flex items-center justify-between font-bold text-white">
                    <span>Câu ${idx + 1}: ${q.question}</span>
                </div>
                ${ansReview}
                ${q.explanation ? `<p class="text-[11px] text-slate-400 italic"><strong class="text-amber-400">Giải thích:</strong> ${q.explanation}</p>` : ''}
            `;
            reviewContainer.appendChild(card);
        });

        this.renderMath(reviewContainer);
    }

    /* ============================================================== */
    /* 10. ĐIỀU HƯỚNG MÀN HÌNH & BẢO MẬT & HEARTBEAT                  */
    /* ============================================================== */

    switchScreen(screenName) {
        Object.keys(this.screens).forEach(key => {
            const el = this.screens[key];
            if (el) {
                if (key === screenName) {
                    el.classList.remove('hidden');
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
        const ua = navigator.userAgent;
        if (/android/i.test(ua)) return "Android Phone";
        if (/iphone|ipad|ipod/i.test(ua)) return "iPhone/iPad";
        if (/windows/i.test(ua)) return "Windows PC";
        if (/macintosh/i.test(ua)) return "MacBook/Mac";
        return "Trình duyệt Web";
    }

    updateTotalQuestionDisplay() {
        const count = this.allQuestions ? this.allQuestions.length : 0;
        const countText = document.getElementById('home-rules-count-text');
        if (countText) countText.innerHTML = `Nội dung: <strong>${count} câu hỏi</strong> trắc nghiệm bám sát đề cương kiến thức.`;
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
        // Chu kỳ 3 giây kiểm tra trạng thái bảo trì, chặn IP và phân quyền Admin
        setInterval(async () => {
            if (!window.dbService) return;

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
            } catch (e) {}

            // 2. Kiểm tra xem IP hiện tại có bị chặn không
            try {
                if (typeof window.dbService.checkIsIpBanned === 'function' && this.clientIp) {
                    const banInfo = await window.dbService.checkIsIpBanned(this.clientIp);
                    if (banInfo && banInfo.isBanned) {
                        this.showBlockedScreen(banInfo.reason);
                    }
                }
            } catch (e) {}

            // 3. Đồng bộ phân quyền Admin theo IP
            try {
                if (typeof window.dbService.checkIsAdminIp === 'function' && this.clientIp) {
                    const isAdmin = await window.dbService.checkIsAdminIp(this.clientIp);
                    if (this.isAdminAuthenticated !== isAdmin) {
                        this.isAdminAuthenticated = isAdmin;
                        this.updateAdminUIVisibility();
                        if (!isAdmin) this.closeAdminDashboard();
                    }
                }
            } catch (e) {}

            // 4. Kiểm tra thông báo từ Giám thị
            try {
                if (typeof window.dbService.getSystemNotice === 'function') {
                    const notice = await window.dbService.getSystemNotice();
                    if (notice && notice.content && notice.active) {
                        this.showStudentNotice(notice.content);
                    }
                }
            } catch (e) {}
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
        text.textContent = content;
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

    async renderAdminStudentsList() {
        const tbody = document.getElementById('admin-students-tbody');
        const badgeCount = document.getElementById('admin-badge-login-count');

        if (!tbody || !window.dbService) return;
        tbody.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-slate-400">Đang tải danh sách thí sinh...</td></tr>';

        try {
            const list = (window.dbService && typeof window.dbService.fetchActiveLogins === 'function')
                ? await window.dbService.fetchActiveLogins()
                : (window.dbService && typeof window.dbService.getLoginHistory === 'function')
                    ? await window.dbService.getLoginHistory()
                    : [];
            if (badgeCount) badgeCount.textContent = list.length;
            tbody.innerHTML = '';

            if (list.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-slate-500 italic">Chưa có thí sinh nào đăng nhập.</td></tr>';
                return;
            }

            list.forEach(student => {
                const isAdmin = this.allowedAdminIps.includes(student.client_ip);
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="py-2.5 px-3 font-semibold text-white max-w-[130px] truncate">${student.player_name}</td>
                    <td class="py-2.5 px-3 font-mono text-slate-400 text-[11px]">${student.client_ip || '—'}</td>
                    <td class="py-2.5 px-3 text-slate-400 text-[11px]">${student.device_info || '—'}</td>
                    <td class="py-2.5 px-3 text-center text-slate-400 text-[11px]">${student.created_at ? new Date(student.created_at).toLocaleTimeString('vi-VN') : '—'}</td>
                    <td class="py-2.5 px-3 text-center">
                        <span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold text-[10px]">${student.score_summary || student.status || 'Đang làm bài'}</span>
                    </td>
                    <td class="py-2.5 px-3 text-center">
                        <button onclick="app.adminToggleStudentAdminRole('${student.client_ip}', '${student.player_name}')" class="px-2.5 py-1 rounded-lg ${isAdmin ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-400 hover:text-amber-400'} border border-slate-700 text-[10px] transition cursor-pointer">
                            <i class="fa-solid fa-crown mr-0.5"></i> ${isAdmin ? 'Thu Hồi' : '+ Cấp Admin'}
                        </button>
                    </td>
                    <td class="py-2.5 px-3 text-right">
                        <button onclick="app.adminBanStudentIp('${student.client_ip}')" class="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-[10px] font-bold transition cursor-pointer">
                            <i class="fa-solid fa-ban mr-0.5"></i> Chặn IP
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-rose-400">Lỗi tải danh sách: ${e.message}</td></tr>`;
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
                this.renderAdminStudentsList();
            }
        } catch (e) {
            alert("Lỗi chặn IP: " + e.message);
        }
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

        if (urlInput && window.dbService) urlInput.value = window.dbService.url || '';
        if (keyInput && window.dbService) keyInput.value = window.dbService.anonKey || '';

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

        if (url && key && window.dbService) {
            window.dbService.init(url, key);
            localStorage.setItem('supabase_url', url);
            localStorage.setItem('supabase_key', key);
            alert("Đã lưu kết nối Supabase Cloud thành công!");
            this.closeSettingsModal();
        }
    }

    clearSupabaseConfig() {
        if (!confirm("Bạn có chắc chắn muốn xóa cấu hình Supabase?")) return;
        localStorage.removeItem('supabase_url');
        localStorage.removeItem('supabase_key');
        alert("Đã xóa cấu hình. Hệ thống sẽ tải lại trang.");
        location.reload();
    }

    openNewQuestionModal() {
        this.openEditQuestionModal(null);
    }

    openEditQuestionModal(qId) {
        const modal = document.getElementById('modal-question-editor');
        const title = document.getElementById('editor-modal-title');
        const idInput = document.getElementById('edit-q-id');
        const subjSelect = document.getElementById('edit-q-subject');
        const catInput = document.getElementById('edit-q-category');
        const textInput = document.getElementById('edit-q-text');
        const imgInput = document.getElementById('edit-q-image');
        const expInput = document.getElementById('edit-q-explanation');

        this.populateSubjectDropdowns();
        if (subjSelect) subjSelect.value = this.currentSubject;

        if (qId) {
            const q = this.allQuestions.find(item => item.id === qId);
            if (q) {
                if (title) title.textContent = `Chỉnh Sửa Câu Hỏi #${q.id}`;
                if (idInput) idInput.value = q.id;
                if (catInput) catInput.value = q.category || '';
                if (textInput) textInput.value = q.question || '';
                if (imgInput) imgInput.value = q.image_url || '';
                if (expInput) expInput.value = q.explanation || '';

                if (q.options && q.options.length >= 4) {
                    for (let i = 0; i < 4; i++) {
                        const optEl = document.getElementById(`edit-q-opt-${i}`);
                        if (optEl) optEl.value = q.options[i] || '';
                    }
                }
                const correctIdx = q.correct !== undefined ? q.correct : q.answer;
                const radios = document.getElementsByName('edit-q-correct');
                radios.forEach(r => { if (parseInt(r.value, 10) === correctIdx) r.checked = true; });
            }
        } else {
            if (title) title.textContent = "Thêm Câu Hỏi Mới";
            if (idInput) idInput.value = '';
            if (catInput) catInput.value = 'Đề cương ôn tập';
            if (textInput) textInput.value = '';
            if (imgInput) imgInput.value = '';
            if (expInput) expInput.value = '';
            for (let i = 0; i < 4; i++) {
                const optEl = document.getElementById(`edit-q-opt-${i}`);
                if (optEl) optEl.value = '';
            }
        }

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

    async saveQuestionFromEditor() {
        const idInput = document.getElementById('edit-q-id');
        const catInput = document.getElementById('edit-q-category');
        const textInput = document.getElementById('edit-q-text');
        const imgInput = document.getElementById('edit-q-image');
        const expInput = document.getElementById('edit-q-explanation');

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

        let correct = 0;
        const radios = document.getElementsByName('edit-q-correct');
        radios.forEach(r => { if (r.checked) correct = parseInt(r.value, 10); });

        const newQ = {
            id: qId || (this.allQuestions.length + 1),
            qType: 'mcq',
            category: catInput ? catInput.value.trim() : 'Đề cương',
            question: questionText,
            image_url: imgInput ? imgInput.value.trim() : null,
            options: options,
            correct: correct,
            answer: correct,
            explanation: expInput ? expInput.value.trim() : ''
        };

        if (qId) {
            const idx = this.allQuestions.findIndex(item => item.id === qId);
            if (idx >= 0) this.allQuestions[idx] = newQ;
        } else {
            this.allQuestions.push(newQ);
        }

        // Tự động lưu lên Supabase nếu có kết nối
        try {
            if (window.dbService && typeof window.dbService.saveQuestionsBulk === 'function') {
                await window.dbService.saveQuestionsBulk(this.currentSubject, this.allQuestions, true);
            }
        } catch (e) {}

        this.closeQuestionEditor();
        this.renderAdminQuestionsList();
        this.updateNavbarAndBadge();
        alert("✅ Đã lưu câu hỏi thành công!");
    }

    async adminDeleteQuestion(qId) {
        if (!confirm(`Bạn có chắc muốn xóa câu hỏi #${qId}?`)) return;
        this.allQuestions = this.allQuestions.filter(q => q.id !== qId);
        try {
            if (window.dbService && typeof window.dbService.saveQuestionsBulk === 'function') {
                await window.dbService.saveQuestionsBulk(this.currentSubject, this.allQuestions, true);
            }
        } catch (e) {}
        this.renderAdminQuestionsList();
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

    initEventListeners() {
        // Nhấn phím Enter tại ô tên học sinh -> bắt đầu làm bài
        const nameInput = document.getElementById('player-name-input');
        if (nameInput) {
            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.startQuiz();
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
