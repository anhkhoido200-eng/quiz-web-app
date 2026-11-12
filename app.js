/**
 *  Hệ Thống Ôn Thi Trực Tuyến Toàn Diện
 * Tự động hóa toàn bộ: Phân quyền IP Admin, Đa môn học động, Nạp đề Word/Excel,
 * Xuất điểm Excel, Bảng xếp hạng Top 10, Chế độ bảo trì, Luyện tập vs Thi thử.
 */

class QuizApp {
    constructor() {
        // Môn học & Đa môn học động (Ghi nhớ môn đã chọn gần nhất)
        this.currentSubject = localStorage.getItem('quiz_last_selected_subject') || '';
        this.homeGradeFilter = 'all';
        this.dynamicSubjects = [];

        // Thông tin người học & Thiết bị & IP
        this.playerName = "";
        this.clientIp = "Đang nhận diện...";
        this.deviceMachineCode = this.getOrCreateDeviceMachineCode();
        this.deviceInfo = `${this.detectDevice()} [${this.deviceMachineCode}]`;
        this.currentLoginId = null;
        this.presenceHeartbeatAt = 0;

        // Đồng hồ bấm giờ (Luyện tập: Đếm tiến / Thi thử: Đếm ngược)
        this.secondsElapsed = 0;
        this.timerInterval = null;
        this.awayAutoSubmitTimer = null;
        this.idleAutoSubmitTimer = null;
        this.loginRecordPromise = null;
        this.quizAttemptId = null;
        this.pendingStudentProgress = null;
        this.progressSyncRunning = false;
        this.isFinishingQuiz = false;
        this.isExamMode = false;
        this.examMinutes = 45;
        this.examSecondsRemaining = 45 * 60;

        // Âm thanh Ting / Bíp (Web Audio API)
        this.soundEnabled = localStorage.getItem('quiz_sound_enabled') !== 'false';

        // Dữ liệu câu hỏi & Đáp án người dùng
        this.allQuestions = [];
        this.fullQuestionsPool = [];
        this.isRevengeMode = false;
        this.isMistakeMode = false;
        this.currentMistakeQuestions = [];
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
        this.adminIpConfig = { masterIp: '', allowedIps: [] };

        // Phân quyền sử dụng Trợ lý AI theo địa chỉ IP
        this.allowedAiIps = [];

        // Phân quyền kết hợp Token (Token-based Auth)
        this.userToken = (localStorage.getItem('quiz_access_token') || '').trim();
        this.tokenInfo = null;
        try {
            const cachedToken = localStorage.getItem('quiz_token_info');
            if (cachedToken) this.tokenInfo = JSON.parse(cachedToken);
        } catch (e) {}

        // Danh sách các IP đang bị chặn (Banned IPs)
        this.bannedIpsList = [];

        // Phân quyền môn Địa Lí (hoặc các môn Private)
        this.allowedGeoIps = [];
        this.geoMode = 'PRIVATE';
        this.class5AllowedIps = [];
        try {
            const cachedG5 = localStorage.getItem('quiz_cache_grade5_ips');
            if (cachedG5) this.class5AllowedIps = JSON.parse(cachedG5);
        } catch (e) {}

        // Chế độ bảo trì hệ thống (Maintenance Mode)
        this.isMaintenanceMode = false;
        this.maintenanceMessage = "Trang web đang tạm dừng để cập nhật đề cương và dữ liệu mới. Vui lòng quay lại sau!";
        this.maintenanceClickCount = 0;
        this.maintenanceClickTimer = null;
        this._maintenanceKeyBlocker = null;
        this.parentProgressInterval = null;

        // Dữ liệu bóc tách từ bộ nạp đề
        this.parsedImportQuestions = [];
        this.isAppReady = false;
        this.isLoadingQuestions = false;
        this.questionSyncChannel = null;
        this.questionSyncPoll = null;
        this.quizHeaderResizeObserver = null;
        this.studentNoticeTimer = null;

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
        const supportedGeminiModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
        if (!supportedGeminiModels.includes(savedModel)) {
            localStorage.setItem('gemini_model', supportedGeminiModels[0]);
        }
        this.selectedGeminiModel = supportedGeminiModels.includes(savedModel) ? savedModel : supportedGeminiModels[0];

        // Cache màn hình
        this.screens = {
            home: document.getElementById('screen-home'),
            quiz: document.getElementById('screen-quiz'),
            result: document.getElementById('screen-result'),
            observer: document.getElementById('screen-observer')
        };

        this.init();
    }

    syncQuizHeaderOffset() {
        const header = document.getElementById('quiz-sticky-header');
        const questions = document.getElementById('questions-container');
        if (!header || !questions) return;

        const headerHeight = Math.ceil(header.getBoundingClientRect().height);
        questions.style.setProperty('--quiz-header-height', `${headerHeight}px`);
        document.documentElement.style.setProperty('--quiz-header-height', `${headerHeight}px`);

        // Tự động nhận diện position của header: sticky hay fallback fixed
        const isFixed = window.getComputedStyle(header).position === 'fixed';
        const safePadding = window.innerWidth <= 640 ? 16 : 24;

        if (isFixed) {
            // Nếu header ở chế độ fixed (nằm tách khỏi layout): bù toàn bộ chiều cao header + đệm
            questions.style.paddingTop = `${headerHeight + safePadding}px`;
        } else {
            // Nếu header ở chế độ sticky: phần tử đã nằm trong luồng tài liệu (document flow),
            // chỉ cần áp dụng khoảng đệm tự nhiên để câu hỏi đầu tiên không bị dính sát header.
            questions.style.paddingTop = `${safePadding}px`;
        }
    }

    observeQuizHeader() {
        const header = document.getElementById('quiz-sticky-header');
        if (!header) return;
        this.syncQuizHeaderOffset();
        if (this.quizHeaderResizeObserver) this.quizHeaderResizeObserver.disconnect();
        if (typeof ResizeObserver === 'function') {
            this.quizHeaderResizeObserver = new ResizeObserver(() => this.syncQuizHeaderOffset());
            this.quizHeaderResizeObserver.observe(header);
        }
        window.addEventListener('resize', () => this.syncQuizHeaderOffset(), { passive: true });
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

    async copyTextToClipboard(text) {
        const value = String(text || '').trim();
        if (!value) return false;
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(value);
                return true;
            }
        } catch (e) { }
        try {
            const ta = document.createElement('textarea');
            ta.value = value;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return Boolean(ok);
        } catch (e) {
            return false;
        }
    }

    ensureConfirmModalExists() {
        let modal = document.getElementById('modal-custom-confirm');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'modal-custom-confirm';
        modal.className = 'fixed inset-0 z-[200000] bg-slate-950/80 backdrop-blur-md hidden items-center justify-center p-4 select-none';
        modal.innerHTML = `
            <div id="custom-confirm-card" class="confirm-modal-card rounded-3xl max-w-md w-full overflow-hidden relative">
                <div id="custom-confirm-accent-bar" class="h-1.5 w-full bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500"></div>
                <div class="p-6 space-y-4">
                    <div class="flex items-start gap-4">
                        <div id="custom-confirm-icon-wrap" class="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/35 text-amber-400 flex items-center justify-center text-xl shrink-0 shadow-lg">
                            <i id="custom-confirm-icon" class="fa-solid fa-circle-question"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <span id="custom-confirm-badge" class="inline-block text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 mb-1">Xác nhận thao tác</span>
                            <h3 id="custom-confirm-title" class="font-heading font-extrabold text-white text-base sm:text-lg leading-snug">Bạn có chắc chắn không?</h3>
                        </div>
                        <button type="button" id="custom-confirm-close-btn" class="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer shrink-0" aria-label="Đóng">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div id="custom-confirm-copy-box" class="hidden p-3.5 rounded-2xl bg-gradient-to-r from-indigo-950/80 via-slate-900 to-cyan-950/70 border border-cyan-500/40 shadow-inner">
                        <span id="custom-confirm-copy-label" class="block text-[10px] font-extrabold uppercase tracking-wider text-cyan-300/90 mb-1">Địa chỉ IP hiện tại của bạn</span>
                        <div class="flex items-center justify-between gap-2">
                            <code id="custom-confirm-copy-value" class="font-mono font-extrabold text-base sm:text-lg text-white tracking-wider select-all break-all">0.0.0.0</code>
                            <button type="button" id="custom-confirm-inline-copy-btn" class="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-200 border border-cyan-400/40 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shrink-0">
                                <i class="fa-regular fa-copy"></i>
                                <span>Copy IP</span>
                            </button>
                        </div>
                    </div>
                    <div id="custom-confirm-message" class="text-xs sm:text-sm text-slate-300 leading-relaxed whitespace-pre-line bg-slate-900/70 border border-slate-800/90 rounded-2xl p-3.5"></div>
                    <div id="custom-confirm-input-wrap" class="hidden">
                        <input id="custom-confirm-input" type="text" autocomplete="off" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-indigo-400 focus:outline-none text-white text-xs sm:text-sm" placeholder="Nhập nội dung...">
                    </div>
                    <div class="flex items-center justify-end gap-2.5 pt-1">
                        <button type="button" id="custom-confirm-cancel-btn" class="btn-3d btn-3d-slate px-4 py-2.5 rounded-xl text-slate-200 font-heading font-bold text-xs sm:text-sm transition cursor-pointer">
                            Hủy bỏ
                        </button>
                        <button type="button" id="custom-confirm-ok-btn" class="btn-3d btn-3d-amber px-5 py-2.5 rounded-xl text-slate-950 font-heading font-extrabold text-xs sm:text-sm transition flex items-center gap-1.5 cursor-pointer">
                            <i id="custom-confirm-ok-icon" class="fa-solid fa-check"></i>
                            <span id="custom-confirm-ok-text">Đồng ý</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        return modal;
    }

    showConfirmModal(options = {}) {
        const opts = typeof options === 'string' ? { message: options } : (options || {});
        const rawMsg = String(opts.message || 'Bạn có chắc chắn muốn thực hiện thao tác này?');
        const isDangerDefault = /xóa|chặn|thu hồi|bảo trì|dọn dẹp/i.test(rawMsg);
        const variant = opts.variant || (isDangerDefault ? 'danger' : 'warning');

        const themes = {
            warning: {
                accent: 'h-1.5 w-full bg-gradient-to-r from-amber-400 via-orange-500 to-amber-500',
                iconWrap: 'w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/35 text-amber-400 flex items-center justify-center text-xl shrink-0 shadow-lg',
                badge: 'inline-block text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 mb-1',
                badgeText: 'Xác nhận thao tác',
                icon: 'fa-solid fa-triangle-exclamation',
                okBtn: 'btn-3d btn-3d-amber px-5 py-2.5 rounded-xl text-slate-950 font-heading font-extrabold text-xs sm:text-sm transition flex items-center gap-1.5 cursor-pointer'
            },
            danger: {
                accent: 'h-1.5 w-full bg-gradient-to-r from-rose-500 via-red-500 to-orange-500',
                iconWrap: 'w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/35 text-rose-400 flex items-center justify-center text-xl shrink-0 shadow-lg',
                badge: 'inline-block text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 mb-1',
                badgeText: 'Cảnh báo quan trọng',
                icon: 'fa-solid fa-trash-can',
                okBtn: 'btn-3d btn-3d-rose px-5 py-2.5 rounded-xl text-white font-heading font-extrabold text-xs sm:text-sm transition flex items-center gap-1.5 cursor-pointer'
            },
            primary: {
                accent: 'h-1.5 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-400',
                iconWrap: 'w-12 h-12 rounded-2xl bg-indigo-500/15 border border-indigo-500/35 text-indigo-400 flex items-center justify-center text-xl shrink-0 shadow-lg',
                badge: 'inline-block text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 mb-1',
                badgeText: 'Thông tin hệ thống',
                icon: 'fa-solid fa-circle-info',
                okBtn: 'btn-3d btn-3d-indigo px-5 py-2.5 rounded-xl text-white font-heading font-extrabold text-xs sm:text-sm transition flex items-center gap-1.5 cursor-pointer'
            },
            success: {
                accent: 'h-1.5 w-full bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-500',
                iconWrap: 'w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-400 flex items-center justify-center text-xl shrink-0 shadow-lg',
                badge: 'inline-block text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 mb-1',
                badgeText: 'Hoàn tất & Đồng bộ',
                icon: 'fa-solid fa-circle-check',
                okBtn: 'btn-3d btn-3d-emerald px-5 py-2.5 rounded-xl text-white font-heading font-extrabold text-xs sm:text-sm transition flex items-center gap-1.5 cursor-pointer'
            }
        };

        const theme = themes[variant] || themes.warning;
        const modal = this.ensureConfirmModalExists();
        const card = document.getElementById('custom-confirm-card');
        const accentBar = document.getElementById('custom-confirm-accent-bar');
        const iconWrap = document.getElementById('custom-confirm-icon-wrap');
        const iconEl = document.getElementById('custom-confirm-icon');
        const badgeEl = document.getElementById('custom-confirm-badge');
        const titleEl = document.getElementById('custom-confirm-title');
        const copyBox = document.getElementById('custom-confirm-copy-box');
        const copyLabel = document.getElementById('custom-confirm-copy-label');
        const copyValue = document.getElementById('custom-confirm-copy-value');
        const inlineCopyBtn = document.getElementById('custom-confirm-inline-copy-btn');
        const msgEl = document.getElementById('custom-confirm-message');
        const inputWrap = document.getElementById('custom-confirm-input-wrap');
        const inputEl = document.getElementById('custom-confirm-input');
        const cancelBtn = document.getElementById('custom-confirm-cancel-btn');
        const okBtn = document.getElementById('custom-confirm-ok-btn');
        const okIcon = document.getElementById('custom-confirm-ok-icon');
        const okText = document.getElementById('custom-confirm-ok-text');
        const closeBtn = document.getElementById('custom-confirm-close-btn');

        if (accentBar) accentBar.className = theme.accent;
        if (iconWrap) iconWrap.className = theme.iconWrap;
        if (iconEl) iconEl.className = opts.icon || theme.icon;
        if (badgeEl) {
            badgeEl.className = theme.badge;
            badgeEl.textContent = opts.badge || theme.badgeText;
        }
        if (titleEl) titleEl.textContent = opts.title || 'Xác nhận thực hiện?';
        if (msgEl) msgEl.textContent = rawMsg;
        if (inputWrap && inputEl) {
            if (opts.withInput) {
                inputWrap.classList.remove('hidden');
                inputEl.type = opts.inputType || 'text';
                inputEl.placeholder = opts.placeholder || 'Nhập nội dung...';
                inputEl.value = opts.defaultValue !== undefined ? String(opts.defaultValue) : '';
            } else {
                inputWrap.classList.add('hidden');
                inputEl.value = '';
            }
        }

        if (copyBox) {
            if (opts.copyValue) {
                copyBox.classList.remove('hidden');
                if (copyLabel) copyLabel.textContent = opts.copyLabel || 'Địa chỉ IP hiện tại của bạn';
                if (copyValue) copyValue.textContent = String(opts.copyValue);
                if (inlineCopyBtn) {
                    inlineCopyBtn.innerHTML = '<i class="fa-regular fa-copy"></i><span>Copy IP</span>';
                    inlineCopyBtn.onclick = async () => {
                        const copied = await this.copyTextToClipboard(opts.copyValue);
                        if (copied) {
                            inlineCopyBtn.innerHTML = '<i class="fa-solid fa-check text-emerald-300"></i><span>Đã chép!</span>';
                            this.showToastNotification(`✅ Đã sao chép IP: ${opts.copyValue}`, 'success');
                            setTimeout(() => {
                                if (inlineCopyBtn) inlineCopyBtn.innerHTML = '<i class="fa-regular fa-copy"></i><span>Copy IP</span>';
                            }, 2000);
                        }
                    };
                }
            } else {
                copyBox.classList.add('hidden');
                if (inlineCopyBtn) inlineCopyBtn.onclick = null;
            }
        }

        if (cancelBtn) {
            if (opts.hideCancel) {
                cancelBtn.classList.add('hidden');
            } else {
                cancelBtn.classList.remove('hidden');
                cancelBtn.textContent = opts.cancelText || 'Hủy bỏ';
            }
        }
        if (okBtn) okBtn.className = theme.okBtn;
        if (okIcon) okIcon.className = opts.okIcon || 'fa-solid fa-check';
        if (okText) okText.textContent = opts.confirmText || 'Đồng ý';

        if (card) {
            card.style.animation = 'none';
            void card.offsetWidth;
            card.style.animation = '';
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');

        return new Promise((resolve) => {
            let settled = false;
            const finish = (result) => {
                if (settled) return;
                settled = true;
                modal.classList.add('hidden');
                modal.classList.remove('flex');
                window.removeEventListener('keydown', onKeyDown, true);
                modal.onclick = null;
                if (okBtn) okBtn.onclick = null;
                if (cancelBtn) cancelBtn.onclick = null;
                if (closeBtn) closeBtn.onclick = null;
                if (inlineCopyBtn) inlineCopyBtn.onclick = null;
                if (opts.withInput) {
                    resolve(result ? String(inputEl ? inputEl.value : '') : null);
                } else {
                    resolve(result);
                }
            };

            const handleOk = async () => {
                if (opts.copyOnConfirm && opts.copyValue) {
                    const copied = await this.copyTextToClipboard(opts.copyValue);
                    if (copied) {
                        this.showToastNotification(`✅ Đã sao chép IP: ${opts.copyValue}`, 'success');
                    }
                }
                finish(true);
            };

            const onKeyDown = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    finish(false);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleOk();
                }
            };

            window.addEventListener('keydown', onKeyDown, true);
            modal.onclick = (e) => {
                if (e.target === modal) finish(false);
            };
            if (okBtn) okBtn.onclick = handleOk;
            if (cancelBtn) cancelBtn.onclick = () => finish(false);
            if (closeBtn) closeBtn.onclick = () => finish(false);

            setTimeout(() => {
                if (opts.withInput && inputEl) {
                    inputEl.focus();
                    inputEl.select();
                } else if (variant === 'danger' && cancelBtn && !opts.hideCancel) {
                    cancelBtn.focus();
                } else if (okBtn) {
                    okBtn.focus();
                }
            }, 20);
        });
    }

    showPromptModal(options = {}) {
        const opts = typeof options === 'string' ? { message: options } : (options || {});
        return this.showConfirmModal({
            variant: 'primary',
            title: 'Nhập thông tin',
            badge: 'Nhập dữ liệu',
            confirmText: 'Xác nhận',
            ...opts,
            withInput: true
        });
    }

    showAlertModal(options = {}) {
        const opts = typeof options === 'string' ? { message: options } : (options || {});
        const raw = String(opts.message || '');
        const cleanMsg = raw.replace(/^(?:✅|⚠️|❌|🔒|✨|👑|⏰)s*/, '');
        let variant = opts.variant || 'primary';
        let icon = opts.icon || 'fa-solid fa-circle-info';
        let title = opts.title || 'Thông báo hệ thống';
        let badge = opts.badge || 'Thông báo';

        if (!opts.variant) {
            if (/^✅|thành công|đã lưu|đã mở|đã cấp/i.test(raw)) {
                variant = 'success';
                icon = 'fa-solid fa-circle-check';
                title = opts.title || 'Thao tác thành công';
                badge = opts.badge || 'Hoàn tất';
            } else if (/^❌|lỗi|không thể|không hợp lệ|không chính xác/i.test(raw)) {
                variant = 'danger';
                icon = 'fa-solid fa-circle-exclamation';
                title = opts.title || 'Đã xảy ra lỗi';
                badge = opts.badge || 'Cảnh báo lỗi';
            } else if (/^⚠️|^🔒|^⏰|vui lòng|chưa|hết giờ|tạm ẩn/i.test(raw)) {
                variant = 'warning';
                icon = /^🔒/.test(raw) ? 'fa-solid fa-lock' : (/^⏰/.test(raw) ? 'fa-solid fa-clock' : 'fa-solid fa-triangle-exclamation');
                title = opts.title || (/^🔒/.test(raw) ? 'Yêu cầu quyền truy cập' : 'Lưu ý từ hệ thống');
                badge = opts.badge || 'Chú ý';
            } else if (/^👑/.test(raw)) {
                variant = 'warning';
                icon = 'fa-solid fa-crown';
                title = opts.title || 'Master Admin';
                badge = opts.badge || 'Quyền tối cao';
            } else if (/^✨/.test(raw)) {
                variant = 'primary';
                icon = 'fa-solid fa-wand-magic-sparkles';
                title = opts.title || 'Trợ lý AI Sư Phạm';
                badge = opts.badge || 'Gemini AI';
            }
        }

        return this.showConfirmModal({
            ...opts,
            title,
            badge,
            message: cleanMsg,
            variant,
            icon,
            hideCancel: opts.hideCancel !== undefined ? opts.hideCancel : true,
            confirmText: opts.confirmText || 'Đã hiểu',
            okIcon: opts.okIcon || 'fa-solid fa-check'
        });
    }

    /**
     * Khởi tạo toàn bộ ứng dụng
     */
    async init() {
        // 1. Kiểm tra mã kích hoạt token qua URL query params (?token=...)
        let hasUrlToken = false;
        let shouldOpenProgress = false;
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const paramToken = urlParams.get('token');
            const viewParam = (urlParams.get('view') || '').toLowerCase();
            if (viewParam === 'progress' || viewParam === 'parent' || viewParam === 'observer') {
                shouldOpenProgress = true;
            }
            if (paramToken && paramToken.trim()) {
                const cleanToken = paramToken.trim();
                this.userToken = cleanToken;
                try { localStorage.setItem('quiz_access_token', cleanToken); } catch (e) {}
                hasUrlToken = true;
                // Xóa query param trên thanh URL để bảo mật và giữ link sạch
                try {
                    const cleanUrl = window.location.pathname + window.location.hash;
                    window.history.replaceState({}, document.title, cleanUrl);
                } catch (e) {}
            }
        } catch (e) {
            console.warn('[QuizApp] Lỗi đọc URL token:', e);
        }

        this.initTheme();
        this.initNetworkListeners();
        this.initEventListeners();
        this.updateSoundIcons();
        try { await this.fetchClientIp(); } catch (e) { console.warn(e); }
        try { await this.loadBannedIpsList(); } catch (e) { console.warn(e); }
        try { await this.loadDynamicSubjects(); } catch (e) { console.warn(e); }
        try { await this.validateUserToken(hasUrlToken); } catch (e) { console.warn(e); }
        try { await this.syncClass5Access(); } catch (e) { console.warn(e); }
        try { await this.loadAiIpsConfig(); } catch (e) { console.warn(e); }
        this.checkSavedUser();
        // Thiết bị mới chưa có môn ghi nhớ hoặc môn cũ bị ẩn: tự động chọn môn hợp lệ đầu tiên
        const visible = this.getHomeVisibleSubjects();
        if (!this.currentSubject || !visible.some(s => s.key === this.currentSubject)) {
            if (visible && visible.length > 0) {
                this.currentSubject = visible[0].key;
                try { localStorage.setItem('quiz_last_selected_subject', this.currentSubject); } catch (e) {}
            }
        }
        try { await this.loadQuestionsForCurrentSubject(); } catch (e) { console.warn(e); }
        this.updateTotalQuestionDisplay();
        this.renderFilterTabs();
        this.renderHomeSubjects();
        try { await this.initMaintenance(); } catch (e) { console.warn(e); }
        // Khôi phục hoặc tạo phiên hiện diện ngay khi mở trang web trên thiết bị
        try {
            this.visitorLoginId = sessionStorage.getItem('quiz_visitor_login_id') || null;
        } catch (e) {
            this.visitorLoginId = null;
        }
        if (!this.visitorLoginId) {
            this.recordVisitorPresence('Đang xem trang chủ').catch(() => {});
        }
        this.startRealtimeHeartbeat();
        this.startRealtimeQuestionSync();
        this.isAppReady = true;
        const startButton = document.getElementById('btn-start-quiz');
        if (startButton) {
            startButton.disabled = false;
            startButton.removeAttribute('aria-busy');
            startButton.classList.remove('opacity-60', 'cursor-wait');
        }

        const isAdminUser = this.isAdminAuthenticated || this.hasAdminIpAccess() || this.hasTokenRole('admin');
        if (!isAdminUser && shouldOpenProgress) {
            setTimeout(() => {
                this.enterObserverMode();
            }, 300);
        }
    }

    /* ============================================================== */
    /* 1. QUẢN LÝ ĐA MÔN HỌC ĐỘNG (DYNAMIC SUBJECTS HUB)               */
    /* ============================================================== */

    getDefaultSubjects() {
        return [];
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
            console.warn("Không thể tải môn học từ cloud, giữ danh sách rỗng:", e);
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
        console.debug('[QuizApp] Dynamic subjects loaded:', {
            online: navigator.onLine,
            cloudAvailable,
            currentSubject: this.currentSubject,
            subjects: loaded.map((subject) => ({ key: subject?.key, name: subject?.name, grade: this.getSubjectGrade(subject), visibility: subject?.visibility, count: subject?.count }))
        });

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

    /* ============================================================== */
    /* 1.1 PHÂN QUYỀN KẾT HỢP TOKEN & IP (TOKEN-BASED AUTH)            */
    /* ============================================================== */

    hasTokenRole(role) {
        const info = this.tokenInfo || this.getCachedTokenInfo();
        if (!info || !info.role) return false;
        const r = String(info.role).trim().toLowerCase();
        if (role === 'admin') {
            return r === 'admin' || r === 'master';
        }
        if (role === 'parent' || role === 'observer') {
            return r === 'parent' || r === 'phuhuynh' || r === 'observer' || r === 'observer_grade5';
        }
        if (role === 'grade5') {
            // Học sinh Lớp 5, gói VIP và cả Người giám sát/theo dõi đều có quyền coi/làm đề Lớp 5
            return r === 'grade5' || r === 'class5' || r === 'lop5' || r === 'all' || r === 'full' || r === 'combo' || r === 'admin' || r === 'parent' || r === 'observer' || r === 'observer_grade5' || r === 'phuhuynh';
        }
        if (role === 'ai') {
            // Học sinh AI, gói VIP và cả Người giám sát/theo dõi đều có quyền dùng Trợ lý AI
            return r === 'ai' || r === 'gemini' || r === 'troly_ai' || r === 'all' || r === 'full' || r === 'combo' || r === 'admin' || r === 'parent' || r === 'observer' || r === 'observer_grade5' || r === 'phuhuynh';
        }
        if (role === 'all') {
            return r === 'all' || r === 'full' || r === 'combo' || r === 'admin';
        }
        return false;
    }

    canViewProgress() {
        const isAdmin = this.isAdminAuthenticated || this.hasAdminIpAccess() || this.hasTokenRole('admin');
        if (isAdmin) return false; // Admin vào thẳng trang admin.html, không cần nút theo dõi trên trang học sinh
        return this.hasTokenRole('parent');
    }

    getCachedTokenInfo() {
        if (this.tokenInfo) return this.tokenInfo;
        try {
            const raw = localStorage.getItem('quiz_token_info');
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    getOrCreateDeviceMachineCode() {
        let code = '';
        try {
            code = localStorage.getItem('quiz_device_machine_code') || '';
        } catch (e) {}

        if (!code || !code.startsWith('QM-')) {
            const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
            let randomPart = '';
            for (let i = 0; i < 6; i++) {
                randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            code = `QM-${randomPart}`;
            try {
                localStorage.setItem('quiz_device_machine_code', code);
            } catch (e) {}
        }
        this.deviceMachineCode = code;
        return code;
    }

    getCombinedDeviceKey() {
        const code = this.getOrCreateDeviceMachineCode();
        const ip = (this.clientIp && !this.clientIp.startsWith('Đang') && this.clientIp !== 'Chưa xác định') 
            ? this.clientIp.trim() 
            : '';
        return ip ? `${ip}-${code}` : code;
    }

    async copyCombinedAuthCode() {
        const combinedKey = this.getCombinedDeviceKey();
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(combinedKey);
            } else {
                const ta = document.createElement('textarea');
                ta.value = combinedKey;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            this.showToastNotification(`📋 Đã chép mã: ${combinedKey}. Hãy gửi mã này cho Admin qua Zalo/Mess để kích hoạt!`, 'success');
        } catch (e) {
            this.showToastNotification(`Mã xác thực của bạn: ${combinedKey}`, 'info');
        }
    }

    async copyDeviceMachineCode() {
        return this.copyCombinedAuthCode();
    }

    async validateUserToken(showToastOnSuccess = false) {
        this.deviceMachineCode = this.getOrCreateDeviceMachineCode();
        const combinedKey = this.getCombinedDeviceKey();

        let matched = null;
        try {
            if (window.dbService && typeof window.dbService.verifyAccessToken === 'function') {
                // Ưu tiên số 1: Kiểm tra theo IP của thiết bị hiện tại
                if (this.clientIp && !this.clientIp.startsWith('Đang') && this.clientIp !== 'Chưa xác định') {
                    matched = await window.dbService.verifyAccessToken('', this.clientIp);
                }
                // Ưu tiên số 2: Kiểm tra theo chuỗi kết hợp IP-QM-...
                if (!matched && combinedKey) {
                    matched = await window.dbService.verifyAccessToken(combinedKey, this.clientIp);
                }
                // Ưu tiên số 3: Kiểm tra theo mã máy QM-... đơn lẻ
                if (!matched && this.deviceMachineCode) {
                    matched = await window.dbService.verifyAccessToken(this.deviceMachineCode, this.clientIp);
                }
                // Ưu tiên số 4: Kiểm tra token nhập tay / link
                if (!matched && this.userToken) {
                    matched = await window.dbService.verifyAccessToken(this.userToken, this.clientIp);
                }
            }
        } catch (e) {
            console.warn('[QuizApp] Không thể xác thực token qua Cloud:', e);
        }

        if (matched) {
            const hadPermissionBefore = Boolean(this.tokenInfo);
            this.tokenInfo = matched;
            try { localStorage.setItem('quiz_token_info', JSON.stringify(matched)); } catch (e) {}

            if (matched.role !== 'admin') {
                // Đảm bảo học sinh hoặc người theo dõi không giữ cờ Admin trong máy
                localStorage.removeItem('quiz_admin_token');
                localStorage.removeItem('quiz_is_admin');
                localStorage.removeItem('quiz_admin_authenticated');
                this.isAdminAuthenticated = false;
            }

            this.updateTokenStatusUi();

            const isObserverRole = !this.hasTokenRole('admin') && (this.hasTokenRole('parent') || matched.role === 'parent' || matched.role === 'observer');

            if (showToastOnSuccess || (!hadPermissionBefore && this.isInitialValidated)) {
                const roleDesc = matched.role === 'admin'
                    ? 'Quản Trị Viên (Toàn quyền)'
                    : (isObserverRole
                        ? 'Quyền Giám Sát (Kèm Xem Đề & Trợ Lý AI)'
                        : (matched.role === 'all' 
                            ? 'Gói VIP (Lớp 5 + Trợ lý AI)' 
                            : (matched.role === 'ai' ? 'Trợ lý AI' : 'Lớp 5')));
                this.showToastNotification(`🎉 Thiết bị (${this.clientIp || combinedKey}) đã kích hoạt: ${roleDesc}!`, 'success');
            }
            this.isInitialValidated = true;
            this.renderHomeSubjects();

            // Không tự động chuyển màn hình; người dùng sẽ bấm nút [👁 Xem Tiến Trình] khi cần

            return matched;
        } else {
            this.isInitialValidated = true;
            if (window.dbService?.isSupabaseActive) {
                this.tokenInfo = null;
                try {
                    localStorage.removeItem('quiz_token_info');
                    if (!this.hasAdminIpAccess()) {
                        localStorage.removeItem('quiz_admin_token');
                        localStorage.removeItem('quiz_is_admin');
                        localStorage.removeItem('quiz_admin_authenticated');
                        this.isAdminAuthenticated = false;
                    }
                } catch (e) {}
                this.updateTokenStatusUi();
                if (showToastOnSuccess) {
                    this.showToastNotification(`⚠️ Mã ${combinedKey} chưa được Admin duyệt. Hãy gửi mã này cho Admin.`, 'error');
                }
            } else {
                this.tokenInfo = this.getCachedTokenInfo();
                this.updateTokenStatusUi();
            }
            return this.tokenInfo;
        }
    }

    updateTokenStatusUi() {
        const badge = document.getElementById('ip-permission-badge');
        const canG5 = this.canViewGrade5();
        const isAdmin = this.isAdminAuthenticated || this.hasAdminIpAccess() || this.hasTokenRole('admin');
        const info = this.tokenInfo || this.getCachedTokenInfo();
        const isParent = !isAdmin && this.hasTokenRole('parent');
        const canViewProgress = isParent;

        const floatObsBtn = document.getElementById('floating-observer-btn');
        if (floatObsBtn) {
            floatObsBtn.classList.toggle('hidden', !canViewProgress);
        }
        const headerParentBtn = document.getElementById('header-parent-monitor-btn');
        if (headerParentBtn) {
            headerParentBtn.classList.toggle('hidden', !canViewProgress);
        }

        if (badge) {
            if (isAdmin) {
                badge.className = "text-[11px] font-bold px-2.5 py-1 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30";
                badge.innerHTML = '<i class="fa-solid fa-crown mr-1 text-amber-400"></i> Admin (Toàn quyền)';
                badge.classList.remove('hidden');
            } else if (isParent) {
                badge.className = "text-[11px] font-bold px-2.5 py-1 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30";
                badge.innerHTML = '<i class="fa-solid fa-eye mr-1 text-amber-400"></i> Giám sát (Xem Đề + AI)';
                badge.classList.remove('hidden');
            } else if (canG5) {
                const roleText = info?.role === 'all' ? 'VIP (Lớp 5 + AI)' : 'Lớp 5';
                badge.className = "text-[11px] font-bold px-2.5 py-1 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
                badge.innerHTML = `<i class="fa-solid fa-circle-check mr-1 text-emerald-400"></i> Đã mở: ${roleText}`;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }

        const box = document.getElementById('token-active-status-box');
        const nameEl = document.getElementById('token-user-name');
        const codeEl = document.getElementById('token-code-display');
        const badgesEl = document.getElementById('token-roles-badges');
        const inputField = document.getElementById('token-input-field');

        if (info && info.token) {
            if (box) box.classList.remove('hidden');
            if (nameEl) nameEl.textContent = info.name || (isParent ? 'Người theo dõi' : 'Học sinh');
            if (codeEl) codeEl.textContent = info.token;
            if (badgesEl) {
                let html = '';
                if (this.hasTokenRole('grade5')) {
                    html += '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/25 text-emerald-300 border border-emerald-500/40">✓ Coi & Làm Đề Lớp 5</span>';
                }
                if (this.hasTokenRole('ai')) {
                    html += '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/25 text-purple-300 border border-purple-500/40">✓ Trợ lý AI</span>';
                }
                if (isParent) {
                    html += '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/25 text-amber-300 border border-amber-500/40">✓ Giám sát tiến trình</span>';
                }
                badgesEl.innerHTML = html;
            }
            if (inputField && !inputField.value) {
                inputField.value = info.token;
            }
        } else {
            if (box) box.classList.add('hidden');
        }
    }

    openTokenModal() {
        const modal = document.getElementById('modal-token-activation');
        if (!modal) return;
        this.updateTokenStatusUi();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        const input = document.getElementById('token-input-field');
        if (input) {
            setTimeout(() => input.focus(), 100);
        }
    }

    closeTokenModal() {
        const modal = document.getElementById('modal-token-activation');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    async submitTokenActivation() {
        const input = document.getElementById('token-input-field');
        const val = input ? input.value.trim() : '';
        if (!val) {
            this.showToastNotification('Vui lòng nhập mã kích hoạt (Token)!', 'error');
            return;
        }

        const btn = document.getElementById('btn-submit-token');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang xác thực...';
        }

        this.userToken = val;
        try { localStorage.setItem('quiz_access_token', val); } catch (e) {}

        const matched = await this.validateUserToken(true);

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Kích Hoạt Ngay';
        }

        if (matched) {
            this.closeTokenModal();
            const isObserverRole = !this.hasTokenRole('admin') && (this.hasTokenRole('parent') || matched.role === 'parent' || matched.role === 'observer');
            if (isObserverRole) {
                this.showToastNotification('🎉 Đã kích hoạt quyền giám sát (kèm xem đề & Trợ lý AI)! Bạn có thể xem đề thi, hỏi AI và bấm nút [👁 Xem Tiến Trình] bất cứ lúc nào.', 'success');
            }
        }
    }

    renderHomeGradeTabs() {
        // Tab lớp được hiển thị đồng bộ và tự động qua renderHomeSubjects
    }

    removeToken() {
        this.userToken = '';
        this.tokenInfo = null;
        try {
            localStorage.removeItem('quiz_access_token');
            localStorage.removeItem('quiz_token_info');
        } catch (e) {}
        this.updateTokenStatusUi();
        this.renderHomeSubjects();
        this.showToastNotification('Đã gỡ mã kích hoạt quyền khỏi thiết bị này.', 'info');
    }

    canViewGrade5() {
        // 1. Admin luôn có toàn quyền xem toàn bộ nội dung Lớp 5
        if (this.isAdminAuthenticated || this.hasAdminIpAccess()) {
            return true;
        }

        // 2. Học sinh: Kiểm tra theo Token / Mã máy / Chuỗi kết hợp IP-QM-...
        if (this.hasTokenRole('grade5')) {
            return true;
        }

        // 3. Học sinh: Kiểm tra theo IP Whitelist Lớp 5
        const normalizeIp = (ip) => String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
        const currentIp = normalizeIp(this.clientIp);
        if (currentIp && !currentIp.startsWith('đang') && currentIp !== 'chưa xác định') {
            const allowedIps = Array.isArray(this.class5AllowedIps) ? this.class5AllowedIps.map(normalizeIp).filter(Boolean) : [];
            if (allowedIps.includes(currentIp)) {
                return true;
            }
        }

        // 4. Kiểm tra cache quyền token đã lưu trên thiết bị
        const cached = this.getCachedTokenInfo();
        if (cached && (cached.role === 'all' || cached.role === 'grade5' || cached.role === 'class5' || cached.role === 'parent' || cached.role === 'observer' || cached.role === 'observer_grade5')) {
            return true;
        }

        return false;
    }

    getHomeGradeFilter() {
        const canViewGrade5 = this.canViewGrade5();
        if (!canViewGrade5 && this.homeGradeFilter === '5') this.homeGradeFilter = 'all';
        return (canViewGrade5 ? ['all', '5', '11'] : ['all', '11']).includes(this.homeGradeFilter) ? this.homeGradeFilter : 'all';
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
            const canViewPrivate = this.isAdminAuthenticated || this.hasAdminIpAccess() || canViewPrivateByIp || (grade === '5' && canViewGrade5);
            return canViewGrade && (!isPrivate || canViewPrivate);
        });
        console.debug('[QuizApp] Visible subject decision:', {
            currentIp,
            canViewGrade5,
            homeGradeFilter: this.homeGradeFilter,
            subjects: (this.dynamicSubjects || []).map((sub) => ({ key: sub?.key, detectedGrade: this.getSubjectGrade(sub), visibility: sub?.visibility, visible: allowedSubjects.includes(sub) }))
        });
        const filter = this.getHomeGradeFilter();
        const filtered = filter === 'all'
            ? allowedSubjects
            : allowedSubjects.filter((sub) => this.getSubjectGrade(sub) === filter);

        if (filtered.length === 0 && allowedSubjects.length > 0 && filter !== 'all') {
            this.homeGradeFilter = 'all';
            return allowedSubjects;
        }
        return filtered;
    }

    async syncClass5Access() {
        try {
            if (window.dbService && typeof window.dbService.fetchGeoConfig === 'function') {
                const config = await window.dbService.fetchGeoConfig();
                this.allowedGeoIps = Array.isArray(config?.ips) ? config.ips : [];
                this.class5AllowedIps = Array.isArray(config?.grade5Ips) ? config.grade5Ips : (Array.isArray(config?.grade5_ips) ? config.grade5_ips : []);
                this.geoMode = config?.mode || 'PUBLIC';
            }
            if (window.dbService && typeof window.dbService.fetchAccessTokens === 'function') {
                const tokens = await window.dbService.fetchAccessTokens();
                if (Array.isArray(tokens)) {
                    tokens.forEach(t => {
                        const r = String(t.role || '').toLowerCase();
                        if ((r === 'grade5' || r === 'all' || r === 'class5') && t.ip) {
                            const cleanIp = String(t.ip).trim().toLowerCase();
                            if (cleanIp && !this.class5AllowedIps.includes(cleanIp)) {
                                this.class5AllowedIps.push(cleanIp);
                            }
                        }
                    });
                }
            }
            if (this.class5AllowedIps.length > 0) {
                try { localStorage.setItem('quiz_cache_grade5_ips', JSON.stringify(this.class5AllowedIps)); } catch (e) {}
            }
            console.debug('[QuizApp] Loaded Grade 5 access config:', { currentIp: this.clientIp, class5AllowedIps: this.class5AllowedIps });
        } catch (error) {
            console.warn('Không thể tải quyền truy cập Lớp 5:', error);
            try {
                const cachedG5 = localStorage.getItem('quiz_cache_grade5_ips');
                if (cachedG5) this.class5AllowedIps = JSON.parse(cachedG5);
            } catch (e) {}
        }

        this.homeGradeFilter = this.getHomeGradeFilter();
        console.debug('[QuizApp] Rendering Grade 5 visibility:', { currentIp: this.clientIp, canViewGrade5: this.canViewGrade5(), homeGradeFilter: this.homeGradeFilter });
        this.renderHomeSubjects();
        this.updateTokenStatusUi();
    }

    renderHomeSubjects() {
        const grid = document.getElementById('home-subjects-grid');
        if (!grid) return;

        const visibleSubjects = this.getHomeVisibleSubjects();
        const activeGrade = this.getHomeGradeFilter();
        const tabs = document.getElementById('home-semester-tabs');
        if (tabs) {
            const canViewGrade5 = this.canViewGrade5();
            const hasG11 = (this.dynamicSubjects || []).some(s => this.getSubjectGrade(s) === '11');
            const grades = ['all'];
            if (canViewGrade5) grades.push('5');
            if (hasG11) grades.push('11');

            tabs.innerHTML = grades.map((grade) => {
                    const label = grade === 'all' ? 'Tất cả' : `Lớp ${grade}`;
                    const active = activeGrade === grade;
                    return `<button type="button" class="home-grade-tab ${active ? 'is-active' : ''}" data-grade-filter="${grade}">${label}</button>`;
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
        } else if (visibleSubjects.length === 0) {
            this.currentSubject = '';
            localStorage.removeItem('quiz_last_selected_subject');
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
            const subName = sub.name || sub.title || sub.key || 'Môn học';
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
            card.onclick = () => this.selectSubject(sub.key);
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
                    <p class="font-heading font-extrabold text-sm sm:text-base text-white leading-snug break-words">${this.escapeHtml(subName)}</p>
                </div>
                <!-- Hàng 3: Học kỳ và Chữ số lượng câu hỏi -->
                <div class="flex items-center justify-between gap-1 text-[11px] text-slate-400 w-full pt-2 border-t border-slate-800/80 mt-auto">
                    <span class="px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300 font-medium text-[10px] truncate max-w-[80px]">${this.escapeHtml(sub.semester || 'Đề cương')}</span>
                    <span class="text-amber-400 font-bold text-xs shrink-0 whitespace-nowrap"><i class="fa-solid fa-bolt text-[10px] mr-1"></i><span data-home-count="${Number(sub.count) || 0}">0</span> câu</span>
                </div>
            `;
            fragment.appendChild(card);
        });

        grid.innerHTML = '';
        grid.appendChild(fragment);
        grid.querySelectorAll('[data-home-count]').forEach((element) => {
            this.animateHomeCount(element, Number(element.dataset.homeCount) || 0);
        });
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
        if (badge) {
            badge.innerHTML = `${this.escapeHtml(name)} (<span id="home-subject-count" data-home-count="${count}">0</span> câu)`;
            this.animateHomeCount('home-subject-count', count);
        }
        if (topTitle) topTitle.textContent = name;
        const uploadSubLabel = document.getElementById('home-upload-current-sub-label');
        if (uploadSubLabel) uploadSubLabel.textContent = name;
    }

    getSubjectTitle() {
        const s = this.dynamicSubjects.find(sub => sub.key === this.currentSubject);
        return s ? s.name : 'Ôn tập';
    }

    async selectSubject(subjKey) {
        const selected = (this.dynamicSubjects || []).find((subject) => subject.key === subjKey);
        console.debug('[QuizApp] Subject selection requested:', { subjKey, selected, currentSubject: this.currentSubject, visible: this.getHomeVisibleSubjects().some((subject) => subject.key === subjKey) });
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
        if (!this.currentSubject) {
            this.allQuestions = [];
            this.renderFilterTabs();
            return;
        }
        let questions = [];
        let cloudQuestionsLoaded = false;
        this.isLoadingQuestions = true;
        const subjectAtStart = this.currentSubject;
        console.debug('[QuizApp] Loading questions:', { subject: this.currentSubject, online: navigator.onLine, supabaseActive: Boolean(window.dbService?.isSupabaseActive) });

        // 1. Thử lấy từ Supabase Cloud nếu Online
        if (navigator.onLine) {
            try {
                if (window.dbService && typeof window.dbService.fetchQuestionsBySubject === 'function') {
                    const cloudQuestions = await window.dbService.fetchQuestionsBySubject(this.currentSubject);
                    if (Array.isArray(cloudQuestions)) {
                        cloudQuestionsLoaded = Boolean(window.dbService.isSupabaseActive);
                        questions = cloudQuestions.filter((question) => question?.is_deleted !== true);
                        console.debug('[QuizApp] Cloud questions loaded:', { subject: this.currentSubject, count: questions.length });
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
                        questions = parsedCache.filter((question) => question?.is_deleted !== true);
                    }
                }
            } catch (ce) { }
        }

        // 3. Dự phòng 2: Dữ liệu biến toàn cục đã nhúng trong file JS
        if (questions.length === 0 && (!navigator.onLine || !cloudQuestionsLoaded)) {
            if (this.currentSubject === 'history' && Array.isArray(window.QUIZ_QUESTIONS)) {
                questions = window.QUIZ_QUESTIONS.filter((question) => question?.is_deleted !== true);
            } else if (this.currentSubject === 'physics' && Array.isArray(window.PHYSICS_QUESTIONS)) {
                questions = window.PHYSICS_QUESTIONS.filter((question) => question?.is_deleted !== true);
            } else if (this.currentSubject === 'geography' && Array.isArray(window.GEOGRAPHY_QUESTIONS)) {
                questions = window.GEOGRAPHY_QUESTIONS.filter((question) => question?.is_deleted !== true);
            }
        }

        if (this.currentSubject !== subjectAtStart) {
            this.isLoadingQuestions = false;
            return;
        }
        this.allQuestions = this.normalizeQuestions(questions);
        this.fullQuestionsPool = [...this.allQuestions];
        this.updateHomeRevengeBanner();
        this.isLoadingQuestions = false;
        console.debug('[QuizApp] Questions load completed:', { subject: this.currentSubject, count: this.allQuestions.length, cloudQuestionsLoaded, source: cloudQuestionsLoaded ? 'cloud' : (questions.length ? 'cache-or-bundled' : 'empty') });

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
            const rawType = String(item.qType || item.q_type || item.type || '').trim().toLowerCase().replace(/[-\s]/g, '_');
            item.qType = rawType === 'short' || rawType === 'short_answer' || rawType === 'shortanswer' || rawType === 'fill_blank' || rawType === 'fill_in_the_blank' || rawType === 'tra_loi_ngan' || rawType === 'text_answer' || rawType === 'free_text' ? 'short_answer' : rawType === 'true_false' || rawType === 'truefalse' || rawType === 'tf' || rawType === 'tf_group' ? 'tf_group' : rawType || 'mcq';
            item.q_type = item.qType;

            if (item.correctValue === undefined && item.correct_value !== undefined) {
                item.correctValue = item.correct_value;
            }
            if (item.acceptedValues === undefined && item.accepted_values !== undefined) {
                item.acceptedValues = item.accepted_values;
            }

            // 2. Chuẩn hóa nội dung câu hỏi
            if (item.question !== undefined && item.question !== null) {
                item.question = this.formatScientificNotation(item.question);
            }

            // 3. Chuẩn hóa 4 phương án options: Hỗ trợ cả mảng và object { A, B, C, D }, loại bỏ hoàn toàn tiền tố "A. ", "B. ", "C. ", "D. "
            let rawOpts = item.options;
            if (rawOpts && typeof rawOpts === 'object' && !Array.isArray(rawOpts)) {
                rawOpts = [rawOpts.A || '', rawOpts.B || '', rawOpts.C || '', rawOpts.D || ''];
            }
            if (Array.isArray(rawOpts)) {
                item.options = rawOpts.map(opt => {
                    if (opt && typeof opt === 'object') {
                        const rawText = opt.text ?? opt.value ?? opt.content ?? '';
                        if (opt.math ?? opt.latex ?? opt.formula) {
                            return this.formatScientificNotation(opt);
                        }
                        return this.formatScientificNotation(String(rawText).replace(/^[A-D][\s.):\/\-–]\s*/i, '').trim());
                    }
                    const cleanOpt = String(opt || '').replace(/^[A-D][\s.):\/\-–]\s*/i, '').trim();
                    return this.formatScientificNotation(cleanOpt);
                });
            } else {
                item.options = [];
            }

            // 4. Chuẩn hóa và ràng buộc chặt chẽ đáp án đúng (A, B, C, D -> 0, 1, 2, 3)
            if (item.qType === 'short_answer') {
                const rawAccepted = item.acceptedValues !== undefined ? item.acceptedValues : item.accepted_values;
                const acceptedValues = Array.isArray(rawAccepted) ? rawAccepted : rawAccepted !== undefined && rawAccepted !== null ? [rawAccepted] : [];
                const rawValue = item.correctValue !== undefined ? item.correctValue : (item.correct_value !== undefined ? item.correct_value : (item.correctAnswer !== undefined ? item.correctAnswer : (item.acceptedAnswer !== undefined ? item.acceptedAnswer : (item.answer !== undefined ? item.answer : (item.correct !== undefined ? item.correct : acceptedValues[0] || '')))));
                item.correctValue = String(rawValue && typeof rawValue === 'object' ? (rawValue.value ?? rawValue.answer ?? rawValue.text ?? '') : rawValue).trim();
                item.acceptedValues = acceptedValues.map(value => String(value));
                item.correct = 0;
                item.answer = 0;
                item.correctAnswer = item.correctValue;
            } else if (item.qType === 'tf_group') {
                if (!Array.isArray(item.statements)) item.statements = [];
                item.statements = item.statements.map(st => {
                    if (!st || typeof st !== 'object') return { text: this.formatScientificNotation(String(st || '')), answer: true };
                    const statementText = st.text ?? st.content ?? '';
                    const statementValue = st.math ?? st.latex ?? st.formula
                        ? { text: statementText, math: st.math ?? st.latex ?? st.formula }
                        : String(statementText).trim();
                    return { text: this.formatScientificNotation(statementValue), answer: this._parseBoolAnswer(st.answer) };
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

    async fetchClientIp(forceRefresh = false) {
        const cachedIp = !forceRefresh ? sessionStorage.getItem('quiz_stable_client_ip') : '';
        if (cachedIp && cachedIp !== 'Chưa xác định' && !cachedIp.startsWith('Đang')) {
            this.clientIp = cachedIp;
        } else {
            const endpoints = [
                'https://api4.ipify.org?format=json',
                'https://api.ipify.org?format=json',
                'https://ipapi.co/json/'
            ];
            for (const url of endpoints) {
                try {
                    const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
                    const data = await res.json();
                    const detected = String(data?.ip || '').trim();
                    if (detected) {
                        this.clientIp = detected;
                        sessionStorage.setItem('quiz_stable_client_ip', detected);
                        break;
                    }
                } catch (e) { }
            }
            if (!this.clientIp || this.clientIp.startsWith('Đang')) {
                this.clientIp = 'Chưa xác định';
            }
        }

        // Cập nhật nhãn IP hiện tại và mã xác thực thiết bị kết hợp
        const myIpEl = document.getElementById('admin-my-ip-display');
        if (myIpEl) myIpEl.textContent = this.clientIp;
        this.updateTokenStatusUi();

        console.debug('[QuizApp] Detected public IP:', this.clientIp);

        // Đồng bộ danh sách IP Admin từ Supabase
        await this.syncAdminIpsConfig();
        this.updateTokenStatusUi();
    }

    async showMyIp() {
        if (!this.clientIp || this.clientIp.startsWith('Đang') || this.clientIp === 'Chưa xác định') {
            await this.fetchClientIp();
        }

        const ip = String(this.clientIp || '').trim();
        if (!ip || ip === 'Chưa xác định' || ip.startsWith('Đang')) {
            await this.showAlertModal({
                title: 'Chưa nhận diện được IP',
                badge: 'Kiểm tra kết nối',
                message: 'Chưa xác định được địa chỉ IP của bạn. Vui lòng kiểm tra kết nối mạng và thử lại sau giây lát.',
                variant: 'warning',
                icon: 'fa-solid fa-wifi'
            });
            return;
        }

        const code = this.getOrCreateDeviceMachineCode();
        const combinedKey = this.getCombinedDeviceKey();

        // Tự động sao chép mã kết hợp (IP-Mã máy) vào clipboard
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(combinedKey);
            } else {
                const ta = document.createElement('textarea');
                ta.value = combinedKey;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
        } catch (e) {}

        this.showToastNotification(`📋 Đã sao chép: ${combinedKey}. Hãy gửi mã này cho Admin để được mở Lớp 5!`, 'success');

        await this.showConfirmModal({
            title: 'Mã xác thực thiết bị của bạn',
            badge: 'IP & Mã máy kết hợp',
            copyValue: combinedKey,
            copyLabel: 'Mã thiết bị kết hợp (IP & Mã máy)',
            copyOnConfirm: true,
            message: `Mã thiết bị của bạn là:\n\n${combinedKey}\n\n(Đã tự động sao chép vào bộ nhớ tạm!).\n\n📌 Mã này kết hợp IP hiện tại (${ip}) và Mã máy cố định (${code}), giúp hệ thống nhận diện bạn ngay cả khi bạn đổi Wi-Fi hay dùng 4G.\nHãy gửi mã này cho Admin qua Zalo/Mess để được mở khóa Lớp 5 & AI!`,
            confirmText: 'Sao chép lại mã',
            cancelText: 'Đóng',
            okIcon: 'fa-regular fa-copy',
            icon: 'fa-solid fa-network-wired',
            variant: 'primary'
        });
    }

    startRealtimeQuestionSync() {
        const service = window.dbService;
        if (!service?.isSupabaseActive || !service.client) return;

        // Supabase Realtime giúp các tab học sinh nhận bộ đề mới và quyền hạn ngay sau khi Admin cấp
        try {
            this.questionSyncChannel = service.client
                .channel('quiz-questions-live-sync')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_questions' }, (payload) => {
                    const changedSubject = payload?.new?.subject_key || payload?.old?.subject_key;
                    if (!changedSubject || changedSubject === this.currentSubject) {
                        this.loadQuestionsForCurrentSubject().catch((error) => console.debug('[QuizApp] Realtime question refresh skipped:', error));
                    }
                })
                .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_logins', filter: 'id=eq.00000000-0000-0000-0000-000000000004' }, () => {
                    this.loadDynamicSubjects().catch((error) => console.debug('[QuizApp] Realtime subject refresh skipped:', error));
                })
                .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_logins', filter: 'id=eq.00000000-0000-0000-0000-000000000008' }, () => {
                    console.debug('[QuizApp] Nhận tín hiệu Realtime cập nhật token quyền truy cập');
                    this.validateUserToken().then(() => this.syncClass5Access()).catch(() => {});
                })
                .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_logins', filter: 'id=eq.00000000-0000-0000-0000-000000000002' }, () => {
                    console.debug('[QuizApp] Nhận tín hiệu Realtime cập nhật GEO / Lớp 5');
                    this.syncClass5Access().catch(() => {});
                })
                .subscribe((status) => console.debug('[QuizApp] Question realtime status:', status));
        } catch (error) {
            console.warn('[QuizApp] Không bật được Realtime, dùng polling dự phòng:', error);
        }

        // Dự phòng cho project chưa bật Realtime publication.
        this.questionSyncPoll = window.setInterval(() => {
            if (document.hidden) return;
            // Không chạy sync đề nền khi học sinh đang tập trung làm bài thi để giữ khung hình 60fps tuyệt đối
            if (this.currentScreen === 'quiz') return;
            // Tự động kiểm tra quyền Lớp 5 và nạp danh sách đề ngay khi Admin vừa cấp quyền
            if (!this.canViewGrade5() || !this.tokenInfo) {
                this.validateUserToken(false).then(() => this.syncClass5Access()).catch(() => {});
            }
            if (this.currentSubject && !this.isLoadingQuestions) {
                this.loadQuestionsForCurrentSubject().catch(() => {});
            }
        }, 8000);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                if (!this.canViewGrade5() || !this.tokenInfo) {
                    this.validateUserToken(false).then(() => this.syncClass5Access()).catch(() => {});
                }
                if (this.currentSubject) this.loadQuestionsForCurrentSubject().catch(() => {});
            }
        }, { passive: true });
    }

    async refreshAccessAndSubjects(reloadQuestions = true) {
        await this.fetchClientIp();
        await this.syncClass5Access();
        await this.loadDynamicSubjects();
        if (reloadQuestions && this.currentSubject) await this.loadQuestionsForCurrentSubject();
        this.isAppReady = true;
    }

    hasAdminIpAccess() {
        // CHỈ chấp nhận role admin (TUYỆT ĐỐI KHÔNG chấp nhận role 'all' vì role 'all' là gói VIP Lớp 5 + AI của học sinh)
        if (this.hasTokenRole('admin')) return true;

        const storedAdminToken = (localStorage.getItem('quiz_admin_token') || '').trim();
        if (storedAdminToken) {
            const normalizeAdminCode = (value) => {
                const clean = String(value || '').trim().toLowerCase();
                if (!clean) return '';
                const parts = clean.split('-');
                return parts.length > 1 && (/^[0-9a-f:.]+$/i.test(parts[0]) || parts[0] === 'localhost')
                    ? parts.slice(1).join('-')
                    : clean;
            };
            const rawAllowed = Array.isArray(this.adminConfigAllowed) ? this.adminConfigAllowed : [];
            const cleanToken = storedAdminToken.toLowerCase();
            const cleanCode = normalizeAdminCode(cleanToken);
            const matchedToken = rawAllowed.some(it => {
                if (typeof it === 'string') return it.toLowerCase() === cleanToken || normalizeAdminCode(it) === cleanCode;
                const itTok = String(it.token || '').toLowerCase();
                const itRaw = String(it.rawCode || '').toLowerCase();
                if (itTok && itTok === cleanToken) return true;
                if (itRaw && itRaw === cleanToken && itRaw.length >= 6) return true;
                if (cleanCode && normalizeAdminCode(itTok) === cleanCode) return true;
                if (cleanCode && itRaw && normalizeAdminCode(itRaw) === cleanCode) return true;
                return false;
            });
            if (matchedToken) return true;
        }

        const clientIp = String(this.clientIp || '').trim();
        const isValidIp = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[0-9a-f:]+)$/i.test(clientIp);
        if (!isValidIp) return false;
        const allowedIps = (Array.isArray(this.allowedAdminIps) ? this.allowedAdminIps : [])
            .map((item) => typeof item === 'string' ? item : item?.ip)
            .map((ip) => String(ip || '').trim())
            .filter(Boolean);
        return allowedIps.includes(clientIp) || (this.masterAdminIp && clientIp === String(this.masterAdminIp).trim());
    }

    async syncAdminIpsConfig() {
        try {
            if (window.dbService && typeof window.dbService.fetchAdminIpsConfig === 'function') {
                const cfg = await window.dbService.fetchAdminIpsConfig();
                let ips = [];
                if (Array.isArray(cfg.ips)) ips = cfg.ips;
                else if (Array.isArray(cfg.allowedIps)) ips = cfg.allowedIps.map(x => typeof x === 'string' ? x : x.ip);
                this.allowedAdminIps = ips.filter(Boolean);
                this.adminConfigAllowed = Array.isArray(cfg.allowedIps) ? cfg.allowedIps : [];
                this.masterAdminIp = cfg.masterIp || '';
                this.adminIpConfig = { masterIp: this.masterAdminIp, allowedIps: this.allowedAdminIps, rawAllowed: this.adminConfigAllowed };
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
            localStorage.removeItem('quiz_admin_token');
        }

        this.updateAdminUIVisibility();
        this.renderAdminIpsTab();
    }

    updateAdminUIVisibility() {
        const floatBtn = document.getElementById('floating-admin-btn');
        const floatObsBtn = document.getElementById('floating-observer-btn');
        const navBtn = document.getElementById('nav-admin-btn');
        const headerObsBtn = document.getElementById('header-parent-monitor-btn');
        const homeActions = document.getElementById('home-admin-subject-actions');

        const isAdmin = (this.isAdminAuthenticated || this.hasAdminIpAccess() || this.hasTokenRole('admin'));
        const isObserver = !isAdmin && (this.hasTokenRole('parent') || (this.tokenInfo && (this.tokenInfo.role === 'parent' || this.tokenInfo.role === 'observer')));

        // 1. Quản trị viên (Admin): Luôn hiện nút 👑 Mở Bảng Admin ở góc dưới bên phải bình thường
        if (isAdmin) {
            if (floatBtn) {
                floatBtn.classList.remove('hidden');
                floatBtn.classList.add('flex');
            }
            if (navBtn) {
                navBtn.classList.remove('hidden');
                navBtn.classList.add('flex');
            }
            // Admin không cần nút xem tiến trình trên trang làm bài
            if (floatObsBtn) {
                floatObsBtn.classList.add('hidden');
                floatObsBtn.classList.remove('flex');
            }
            if (headerObsBtn) headerObsBtn.classList.add('hidden');
        } else {
            if (floatBtn) {
                floatBtn.classList.add('hidden');
                floatBtn.classList.remove('flex');
            }
            if (navBtn) {
                navBtn.classList.add('hidden');
                navBtn.classList.remove('flex');
            }
        }

        // 2. Người theo dõi (Observer): Hiện nút xem tiến trình nhỏ ở góc dưới bên phải
        if (isObserver) {
            if (floatObsBtn && this.currentScreen !== 'observer') {
                floatObsBtn.classList.remove('hidden');
                floatObsBtn.classList.add('flex');
            } else if (floatObsBtn) {
                floatObsBtn.classList.add('hidden');
                floatObsBtn.classList.remove('flex');
            }
            if (headerObsBtn) {
                headerObsBtn.classList.remove('hidden');
                headerObsBtn.classList.add('flex');
            }
        } else if (!isAdmin) {
            if (floatObsBtn) {
                floatObsBtn.classList.add('hidden');
                floatObsBtn.classList.remove('flex');
            }
            if (headerObsBtn) headerObsBtn.classList.add('hidden');
        }

        if (homeActions) homeActions.classList.add('hidden');
        this.renderHomeSubjects();
    }

    promptAdminAuth() {
        if (this.hasAdminIpAccess()) {
            this.isAdminAuthenticated = true;
            this.updateAdminUIVisibility();
            window.location.href = 'admin.html';
            return;
        }
        this.showToastNotification('Thiết bị này chưa được cấp quyền Quản Trị Viên (Admin).', 'error');
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

    async adminLogout() {
        if (!(await this.showConfirmModal({
            title: 'Đăng xuất quyền Admin?',
            badge: 'Bảo mật Admin',
            message: 'Bạn có chắc muốn đăng xuất quyền Admin trên thiết bị này?\n(Để vào lại, bạn sẽ cần xác thực lại quyền Admin)',
            confirmText: 'Đăng xuất',
            cancelText: 'Ở lại',
            variant: 'warning',
            icon: 'fa-solid fa-right-from-bracket'
        }))) return;
        this.isAdminAuthenticated = false;
        localStorage.removeItem('quiz_is_admin');
        localStorage.removeItem('quiz_admin_authenticated');
        this.closeAdminDashboard();
        this.updateAdminUIVisibility();
        this.showToastNotification("Đã đăng xuất quyền Admin trên thiết bị này.");
    }

    async adminSaveCurrentIpAsMaster() {
        if (!(await this.showConfirmModal({
            title: 'Thiết lập Master Admin?',
            badge: 'Quyền tối cao',
            message: `Xác nhận lưu địa chỉ IP [${this.clientIp}] làm Master Admin vĩnh viễn?\nIP này sẽ luôn được bảo vệ và không thể bị thu hồi quyền.`,
            confirmText: 'Lưu Master IP',
            cancelText: 'Hủy bỏ',
            variant: 'warning',
            icon: 'fa-solid fa-crown'
        }))) {
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
                this.showAlertModal("👑 Đã lưu IP máy này làm Master Admin vĩnh viễn thành công!");
                this.renderAdminIpsTab();
            }
        } catch (e) {
            this.showAlertModal("Lỗi khi lưu Master Admin: " + e.message);
        }
    }

    async adminAddManualAdminIp() {
        const ipInput = document.getElementById('admin-manual-ip-input');
        const nameInput = document.getElementById('admin-manual-ip-name');
        const ip = ipInput ? ipInput.value.trim() : '';
        const name = nameInput ? nameInput.value.trim() : 'Admin';

        if (!ip) {
            this.showAlertModal("Vui lòng nhập địa chỉ IP cần cấp quyền.");
            return;
        }

        try {
            if (window.dbService && typeof window.dbService.addAdminIp === 'function') {
                await window.dbService.addAdminIp(ip, name);
                if (!this.allowedAdminIps.includes(ip)) this.allowedAdminIps.push(ip);
                if (ipInput) ipInput.value = '';
                if (nameInput) nameInput.value = '';
                this.showAlertModal(`Đã cấp quyền Admin thành công cho IP: ${ip} (${name})`);
                this.renderAdminIpsTab();
            }
        } catch (e) {
            this.showAlertModal("Lỗi cấp quyền Admin: " + e.message);
        }
    }

    async adminRevokeAdminIp(ip) {
        if (ip === this.masterAdminIp) {
            this.showAlertModal("⚠️ IP này là Master Admin nên không thể thu hồi!");
            return;
        }

        if (!(await this.showConfirmModal({
            title: 'Thu hồi quyền Admin?',
            badge: 'Quản lý truy cập',
            message: `Bạn có chắc chắn muốn thu hồi quyền Admin của địa chỉ IP: ${ip}?`,
            confirmText: 'Thu hồi quyền',
            cancelText: 'Hủy bỏ',
            variant: 'danger',
            icon: 'fa-solid fa-user-shield'
        }))) return;

        try {
            if (window.dbService && typeof window.dbService.removeAdminIp === 'function') {
                await window.dbService.removeAdminIp(ip);
                this.allowedAdminIps = this.allowedAdminIps.filter(item => item !== ip);
                this.showAlertModal(`Đã thu hồi quyền Admin của IP: ${ip}`);
                this.renderAdminIpsTab();
            }
        } catch (e) {
            this.showAlertModal("Lỗi thu hồi quyền: " + e.message);
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
                    this.showAlertModal(`Đã cấp quyền Admin thành công cho: ${studentName} (${ip})`);
                }
            } catch (e) {
                this.showAlertModal("Lỗi cấp quyền: " + e.message);
            }
        }
        this.renderAdminStudentsList();
        this.renderAdminIpsTab();
    }

    /* -------------------------------------------------------------- */
    /* QUẢN LÝ PHÂN QUYỀN TRỢ LÝ AI THEO ĐỊA CHỈ IP (AI WHITELIST)    */
    /* -------------------------------------------------------------- */

    async loadAiIpsConfig() {
        if (Array.isArray(this.allowedAiIps) && this.aiIpsLoadedAt && Date.now() - this.aiIpsLoadedAt < 60000) return this.allowedAiIps;
        let loaded = [];
        try {
            if (window.dbService && typeof window.dbService.fetchAiIpsConfig === 'function') {
                loaded = await window.dbService.fetchAiIpsConfig();
            }
            if (window.dbService && typeof window.dbService.fetchAccessTokens === 'function') {
                const tokens = await window.dbService.fetchAccessTokens();
                if (Array.isArray(tokens)) {
                    tokens.forEach(t => {
                        const r = String(t.role || '').toLowerCase();
                        if ((r === 'ai' || r === 'all') && t.ip) {
                            const cleanIp = String(t.ip).trim().toLowerCase();
                            if (cleanIp && !loaded.some(x => String(typeof x === 'string' ? x : x?.ip || '').trim().toLowerCase() === cleanIp)) {
                                loaded.push({ ip: cleanIp, name: t.name || 'Học sinh AI' });
                            }
                        }
                    });
                }
            }
        } catch (e) {
            console.warn("Không thể tải danh sách IP cấp quyền AI:", e);
        }
        this.allowedAiIps = Array.isArray(loaded) ? loaded : [];
        this.aiIpsLoadedAt = Date.now();
        return this.allowedAiIps;
    }

    isAiAllowedForCurrentClient() {
        if (this.isAdminAuthenticated || this.hasAdminIpAccess()) {
            console.debug('[QuizApp] AI access granted to authenticated Admin.');
            return true;
        }

        // Ưu tiên số 1: Token hợp lệ trên Cloud có quyền ai hoặc all
        if (this.hasTokenRole('ai')) {
            console.debug('[QuizApp] AI access granted via Token:', this.tokenInfo);
            return true;
        }

        // Ưu tiên số 2 (Fallback): Whitelist IP như hiện tại
        const currentIp = String(this.clientIp || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
        if (!currentIp || currentIp.startsWith('đang') || currentIp === 'chưa xác định') return false;

        // Kiểm tra trong danh sách IP được Admin cấp quyền AI
        const cleanList = (this.allowedAiIps || []).map(item => String((typeof item === 'string' ? item : item?.ip) || '').trim().replace(/^\[|\]$/g, '').toLowerCase()).filter(Boolean);
        if (cleanList.includes(currentIp)) return true;

        // Kiểm tra trong tokens danh sách
        const tokenList = (window.dbService && Array.isArray(window.dbService.cachedTokens)) 
            ? window.dbService.cachedTokens 
            : [];
        return tokenList.some(t => (t.role === 'ai' || t.role === 'all' || t.role === 'parent' || t.role === 'observer' || t.role === 'observer_grade5') && String(t.ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase() === currentIp);
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
            this.showAlertModal(`Đã thu hồi quyền sử dụng Trợ lý AI của: ${studentName || 'Học sinh'} (${cleanIp})`);
        } else {
            // Chưa có -> Cấp quyền
            this.allowedAiIps.push({ ip: cleanIp, name: studentName || 'Học sinh', grantedAt: new Date().toISOString() });
            this.showAlertModal(`✨ Đã cấp quyền sử dụng Trợ lý AI thành công cho: ${studentName || 'Học sinh'} (${cleanIp})!`);
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
            this.showAlertModal("Vui lòng nhập địa chỉ IP cần cấp quyền Trợ lý AI.");
            return;
        }

        const exists = (this.allowedAiIps || []).some(item => (typeof item === 'string' ? item : item.ip) === ip);
        if (exists) {
            this.showAlertModal(`Địa chỉ IP ${ip} đã được cấp quyền Trợ lý AI từ trước.`);
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
        this.showAlertModal(`✨ Đã cấp quyền Trợ lý AI cho IP: ${ip} (${name}) thành công!`);
        this.renderAdminAiIpsList();
        this.renderAdminStudentsList();
    }

    async adminRevokeAiIp(ip) {
        if (!(await this.showConfirmModal({
            title: 'Thu hồi quyền Trợ lý AI?',
            badge: 'Quyền AI',
            message: `Bạn có chắc muốn thu hồi quyền sử dụng Trợ lý AI của IP: ${ip}?`,
            confirmText: 'Thu hồi AI',
            cancelText: 'Hủy bỏ',
            variant: 'danger',
            icon: 'fa-solid fa-wand-magic-sparkles'
        }))) return;
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
            const confirmed = await this.showConfirmModal({
                title: 'Bật Chế Độ Bảo Trì?',
                badge: 'Khóa hệ thống',
                message: '• Toàn bộ máy học sinh sẽ bị KHÓA MÀN HÌNH ngay lập tức trong 3 giây.\n• Admin vẫn có toàn quyền sử dụng bình thường.',
                confirmText: 'Khóa Web Ngay',
                cancelText: 'Hủy bỏ',
                variant: 'danger',
                icon: 'fa-solid fa-power-off'
            });
            if (!confirmed) {
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
            this.showAlertModal("Lỗi cập nhật bảo trì lên Cloud: " + e.message);
        }

        this.updateAdminMaintenanceUI();
        this.applyMaintenanceMode();
    }

    async adminEditMaintenanceMsg() {
        const newMsg = await this.showPromptModal({
            title: 'Đổi lời nhắn bảo trì',
            badge: 'Chế độ bảo trì',
            message: 'Nhập nội dung lời nhắn bảo trì hiển thị cho thí sinh khi hệ thống tạm khóa:',
            defaultValue: this.maintenanceMessage,
            confirmText: 'Lưu lời nhắn',
            icon: 'fa-solid fa-screwdriver-wrench'
        });
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
            this.showAlertModal("⚠️ Dung lượng file quá lớn (" + (file.size / (1024 * 1024)).toFixed(1) + "MB). Tối đa cho phép là 15MB.");
            if (event.target) event.target.value = '';
            return;
        }

        const fileName = file.name.toLowerCase();
        // Bảo mật 07: Whitelist định dạng file cho phép
        const isAllowedExtension = fileName.endsWith('.json') || fileName.endsWith('.docx') || fileName.endsWith('.pdf') || fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
        if (!isAllowedExtension) {
            this.showAlertModal("⚠️ Định dạng file không hợp lệ. Vui lòng chỉ tải lên file .docx, .pdf, .xlsx, .xls hoặc .json!");
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
                        this.showAlertModal("File JSON không hợp lệ (Phải là một mảng câu hỏi).");
                    }
                } catch (err) {
                    this.showAlertModal("Lỗi đọc file JSON: " + err.message);
                }
            };
            reader.readAsText(file);
        } else if (fileName.endsWith('.docx')) {
            if (typeof mammoth === 'undefined') {
                this.showAlertModal("Thư viện bóc tách Word Mammoth chưa sẵn sàng. Vui lòng kiểm tra kết nối mạng hoặc thử lại.");
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
                    this.showAlertModal("Lỗi đọc file Word (.docx): " + err.message);
                } finally {
                    // Giải phóng bộ nhớ RAM tránh tụt FPS khi file chứa nhiều ảnh Base64
                    if (event && event.target) event.target.value = '';
                }
            };
            reader.readAsArrayBuffer(file);
        } else if (fileName.endsWith('.pdf')) {
            if (typeof pdfjsLib === 'undefined') {
                this.showAlertModal("Thư viện bóc tách PDF chưa sẵn sàng. Vui lòng kiểm tra kết nối mạng hoặc thử lại.");
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
                    this.showAlertModal("Lỗi đọc file PDF (.pdf): " + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
        } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            if (typeof XLSX === 'undefined') {
                this.showAlertModal("Thư viện SheetJS chưa sẵn sàng, vui lòng tải lại trang.");
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
                    this.showAlertModal("Lỗi đọc file Excel: " + err.message);
                }
            };
            reader.readAsArrayBuffer(file);
        } else {
            this.showAlertModal("Định dạng file không được hỗ trợ. Vui lòng chọn file Word (.docx), PDF (.pdf), Excel (.xlsx/.xls) hoặc JSON (.json).");
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
            this.showAlertModal("Vui lòng dán nội dung văn bản đề thi vào ô trước khi phân tích.");
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
            this.showAlertModal("Không có câu hỏi nào để lưu.");
            return;
        }

        const select = document.getElementById('importer-subject-select');
        const replaceCheckbox = document.getElementById('importer-replace-checkbox');
        const targetSubject = (select && select.value) ? select.value : this.currentSubject;
        const replaceAll = replaceCheckbox ? replaceCheckbox.checked : false;

        // Chuẩn hóa toàn bộ câu hỏi trước khi lưu
        const cleanQuestions = this.normalizeQuestions(this.parsedImportQuestions);
        const count = cleanQuestions.length;

        if (!(await this.showConfirmModal({
            title: 'Lưu câu hỏi vào ngân hàng?',
            badge: 'Nạp đề thi',
            message: `Bạn có chắc chắn muốn lưu ${count} câu hỏi vào môn [${targetSubject}]?`,
            confirmText: `Lưu ${count} câu`,
            cancelText: 'Kiểm tra lại',
            variant: 'primary',
            icon: 'fa-solid fa-file-import'
        }))) return;

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
                this.showAlertModal(`✅ Đã lưu thành công ${count} câu hỏi vào môn [${targetSubject}] lên toàn hệ thống Cloud & mọi thiết bị!`);
            } else {
                this.showAlertModal(`⚠️ Đã lưu ${count} câu hỏi vào máy này thành công.\nLưu ý Cloud báo: ${errMsg}`);
            }
        } catch (e) {
            console.error("Lỗi khi lưu câu hỏi:", e);
            this.showAlertModal("Lỗi khi lưu câu hỏi vào cơ sở dữ liệu: " + e.message);
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
            this.showAlertModal("Môn học này hiện chưa có câu hỏi nào để lưu lên Cloud.");
            return;
        }

        if (!(await this.showConfirmModal({
            title: 'Đồng bộ đề lên Cloud?',
            badge: 'Supabase Cloud',
            message: `Xác nhận lưu toàn bộ ${count} câu hỏi của môn [${this.getSubjectTitle()}] lên Supabase Cloud?\nMọi thí sinh sẽ lập tức nhận được đề thi này.`,
            confirmText: 'Đồng bộ ngay',
            cancelText: 'Hủy bỏ',
            variant: 'success',
            icon: 'fa-solid fa-cloud-arrow-up'
        }))) {
            return;
        }

        try {
            if (window.dbService && typeof window.dbService.saveQuestionsBulk === 'function') {
                await window.dbService.saveQuestionsBulk(this.currentSubject, this.allQuestions, true);
                this.showAlertModal(`✅ Đã lưu ${count} câu hỏi môn [${this.getSubjectTitle()}] lên Supabase Cloud thành công!`);
            }
        } catch (e) {
            this.showAlertModal("Lỗi lưu đề lên Cloud: " + e.message);
        }
    }

    async clearSubjectQuestions() {
        if (!(await this.showConfirmModal({
            title: 'Xóa toàn bộ câu hỏi môn này?',
            badge: 'Cảnh báo xóa dữ liệu',
            message: `Bạn có chắc chắn muốn XÓA TOÀN BỘ câu hỏi của môn [${this.getSubjectTitle()}]?\nThao tác này không thể hoàn tác.`,
            confirmText: 'Xóa toàn bộ',
            cancelText: 'Giữ lại',
            variant: 'danger',
            icon: 'fa-solid fa-trash-can'
        }))) {
            return;
        }

        try {
            if (window.dbService && typeof window.dbService.clearQuestionsBySubject === 'function') {
                await window.dbService.clearQuestionsBySubject(this.currentSubject);
            }
            this.allQuestions = [];
            this.renderAdminQuestionsList();
            this.updateNavbarAndBadge();
            this.showAlertModal("Đã xóa toàn bộ câu hỏi của môn này.");
        } catch (e) {
            this.showAlertModal("Lỗi xóa đề: " + e.message);
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
            this.showAlertModal(`Không thể đồng bộ đáp án câu #${q.id} lên Supabase Cloud.\n${error.message}`);
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
            this.showAlertModal(`Không thể đồng bộ đáp án câu #${q.id} lên Supabase Cloud.\n${error.message}`);
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
            this.showAlertModal("Vui lòng nhập Tên môn học và Mã định danh (key).");
            return;
        }

        const existingIdx = this.dynamicSubjects.findIndex(s => s.key === key);
        const previousSubject = existingIdx >= 0 ? { ...this.dynamicSubjects[existingIdx] } : null;
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
            } else {
                throw new Error('Dịch vụ Cloud chưa sẵn sàng.');
            }
        } catch (e) {
            this.dynamicSubjects = existingIdx >= 0
                ? this.dynamicSubjects.map((item, index) => index === existingIdx ? previousSubject : item)
                : this.dynamicSubjects.filter((item) => item.key !== key);
            console.warn("Lưu môn học vào Cloud thất bại:", e);
            this.showAlertModal(`❌ Không thể đồng bộ môn học: ${e.message}`);
            return;
        }

        localStorage.setItem('quiz_dynamic_subjects', JSON.stringify(this.dynamicSubjects));
        this.closeSubjectEditor();
        this.renderAdminSubjectsList();
        this.renderHomeSubjects();
        this.populateSubjectDropdowns();
        this.showAlertModal(`✅ Đã lưu môn học [${name}] thành công!`);
    }

    async adminDeleteSubject(key) {
        const isDefault = ['history', 'physics'].includes(key);
        const ok = await this.showConfirmModal({
            title: 'Xóa môn học khỏi hệ thống?',
            badge: isDefault ? 'Môn mặc định' : 'Quản lý môn học',
            message: isDefault
                ? `Môn [${key}] là môn cơ sở mặc định. Bạn có chắc chắn muốn xóa môn này không?`
                : `Xác nhận xóa môn học [${key}] khỏi hệ thống?`,
            confirmText: 'Xóa môn học',
            cancelText: 'Hủy bỏ',
            variant: 'danger',
            icon: 'fa-solid fa-layer-group'
        });
        if (!ok) return;

        const previousSubjects = this.dynamicSubjects.slice();
        try {
            if (window.dbService && typeof window.dbService.deleteDynamicSubject === 'function') {
                const result = await window.dbService.deleteDynamicSubject(key);
                if (!result?.success) throw new Error(result?.error || 'Cloud chưa xác minh xóa thành công.');
            }
        } catch (e) {
            this.dynamicSubjects = previousSubjects;
            this.showAlertModal(`❌ Không thể xóa môn [${key}]: ${e.message}`);
            return;
        }

        this.dynamicSubjects = previousSubjects.filter(s => s.key !== key);
        localStorage.setItem('quiz_dynamic_subjects', JSON.stringify(this.dynamicSubjects));
        try { localStorage.removeItem(`quiz_cache_${key}`); } catch (e) { }
        if (this.currentSubject === key) {
            this.currentSubject = this.dynamicSubjects[0] ? this.dynamicSubjects[0].key : '';
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
            this.showAlertModal("Thư viện SheetJS chưa được tải hoàn tất. Vui lòng thử lại sau vài giây.");
            return;
        }

        try {
            let data = [];
            if (window.dbService && typeof window.dbService.fetchScoreboardForExport === 'function') {
                data = await window.dbService.fetchScoreboardForExport();
            }

            if (!Array.isArray(data) || data.length === 0) {
                this.showAlertModal("Hiện chưa có dữ liệu kết quả thi nào để xuất Excel.");
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
            this.showAlertModal("Lỗi xuất bảng điểm Excel: " + e.message);
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
            const top2Name = top2 ? this.escapeHtml(top2.player_name || top2.playerName || 'Thí sinh') : '';
            const top2Time = top2 ? this.escapeHtml(top2.time_spent || top2.timeSpent || '—') : '';
            const top1Name = top1 ? this.escapeHtml(top1.player_name || top1.playerName || 'Thí sinh') : '';
            const top1Time = top1 ? this.escapeHtml(top1.time_spent || top1.timeSpent || '—') : '';
            const top3Name = top3 ? this.escapeHtml(top3.player_name || top3.playerName || 'Thí sinh') : '';
            const top3Time = top3 ? this.escapeHtml(top3.time_spent || top3.timeSpent || '—') : '';
            podiumContainer.innerHTML = `
                <!-- Top 2: Bạc -->
                <div class="flex flex-col items-center">
                    ${top2 ? `
                        <div class="w-12 h-12 rounded-2xl bg-slate-400/20 text-slate-200 border-2 border-slate-300 flex items-center justify-center text-xl shadow mb-2">
                            🥈
                        </div>
                        <div class="w-full podium-silver p-2.5 rounded-2xl text-center space-y-1">
                            <span class="text-[10px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-slate-700 text-slate-200">Hạng 2</span>
                            <p class="font-bold text-white text-xs truncate" title="${top2Name}">${top2Name}</p>
                            <p class="font-extrabold text-amber-300 text-sm">${top2.score || 0}đ</p>
                            <p class="text-[10px] text-slate-400 font-mono">${top2Time}</p>
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
                            <p class="font-extrabold text-white text-xs sm:text-sm truncate" title="${top1Name}">${top1Name}</p>
                            <p class="font-extrabold text-amber-300 text-base sm:text-lg">${top1.score || 0}đ</p>
                            <p class="text-[10px] text-amber-200/80 font-mono">${top1Time}</p>
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
                            <p class="font-bold text-white text-xs truncate" title="${top3Name}">${top3Name}</p>
                            <p class="font-extrabold text-amber-300 text-sm">${top3.score || 0}đ</p>
                            <p class="text-[10px] text-slate-400 font-mono">${top3Time}</p>
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
                    const itemName = this.escapeHtml(item.player_name || item.playerName || 'Thí sinh');
                    const itemTime = this.escapeHtml(item.time_spent || item.timeSpent || '—');
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td class="py-2.5 px-3 text-center font-bold text-slate-400">#${rank}</td>
                        <td class="py-2.5 px-3 font-semibold text-white max-w-[140px] truncate" title="${itemName}">${itemName}</td>
                        <td class="py-2.5 px-3 text-center font-bold text-emerald-400">${item.score || 0}đ</td>
                        <td class="py-2.5 px-3 text-right font-mono text-slate-400">${itemTime}</td>
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
            this.showAlertModal("Lỗi sao lưu JSON: " + e.message);
        }
    }

    async adminArchiveAndClearExam() {
        if (!(await this.showConfirmModal({
            title: 'Dọn dẹp dữ liệu kỳ thi cũ?',
            badge: 'Sao lưu & Làm sạch',
            message: '• Toàn bộ kết quả thi của học sinh cũ sẽ bị xóa sạch.\n• Hệ thống sẽ tự động tải trước 1 file Backup JSON để lưu trữ.\n• Cấu hình IP Admin và ngân hàng câu hỏi được giữ nguyên.',
            confirmText: 'Sao lưu & Dọn dẹp',
            cancelText: 'Hủy bỏ',
            variant: 'danger',
            icon: 'fa-solid fa-broom'
        }))) {
            return;
        }

        // Tự động backup trước khi xóa
        await this.adminExportFullBackupJson();

        try {
            if (window.dbService && typeof window.dbService.archiveAndClearExamData === 'function') {
                await window.dbService.archiveAndClearExamData();
                this.showAlertModal("✅ Đã dọn dẹp sạch sẽ dữ liệu kỳ thi cũ. Hệ thống đã sẵn sàng cho kỳ thi mới!");
                this.renderAdminStudentsList();
            }
        } catch (e) {
            this.showAlertModal("Lỗi dọn dẹp dữ liệu: " + e.message);
        }
    }

    /* ============================================================== */
    /* 8. CHẾ ĐỘ LUYỆN TẬP THÔNG MINH & ÂM THANH (UX ENHANCEMENTS)    */
    /* ============================================================== */

    setExamMode(isExam) {
        this.isExamMode = Boolean(isExam);
        const ind = document.getElementById('exam-mode-indicator-text');
        if (ind) {
            ind.textContent = this.isExamMode ? "Chế độ Thi thử (Ẩn đáp án)" : "Chế độ Luyện Tập (Xem đáp án ngay)";
            ind.className = this.isExamMode ? "text-[11px] font-bold text-amber-400" : "text-[11px] font-bold text-emerald-400";
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
        if (!container) return;
        // KaTeX có thể chiếm main thread khá lâu với đề lớn. Để trình duyệt
        // vẽ giao diện trước rồi mới xử lý công thức ở frame rảnh kế tiếp.
        const render = () => {
            if (!container.isConnected) return;
            if (typeof renderMathInElement !== 'function') {
                if (!container.dataset.mathRenderRetry) container.dataset.mathRenderRetry = '0';
                const retry = Number(container.dataset.mathRenderRetry);
                if (retry < 20) {
                    container.dataset.mathRenderRetry = String(retry + 1);
                    window.setTimeout(render, 50);
                }
                return;
            }
            try {
                renderMathInElement(container, {
                    delimiters: [
                        { left: '$$', right: '$$', display: true },
                        { left: '$', right: '$', display: false }
                    ],
                    throwOnError: false
                });
            } catch (e) { }
        };
        container.dataset.mathRenderRetry = '0';
        if (typeof renderMathInElement === 'function') {
            render();
        } else {
            requestAnimationFrame(render);
        }
    }

    /**
     * Tự động chuẩn hóa toàn bộ ký hiệu Toán, Lý, Hóa, Sinh, Địa, Anh...
     * Biến các ký hiệu gõ thô (//, <=>, ->, Delta H, KC, độ C, m/s^2, H2O, CaCO3, v.v.)
     * thành chuẩn LaTeX / KaTeX sắc nét, loại bỏ triệt để các ký hiệu // thô kệch.
     */
    formatScientificNotation(text) {
        if (typeof MathNotation !== 'undefined' && typeof MathNotation.format === 'function') {
            return MathNotation.format(text);
        }
        return typeof text === 'string' ? text : String(text ?? '');
    }

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[character]));
    }

    formatRelativeTime(isoString) {
        if (!isoString) return 'Vừa mới đây';
        const timeMs = new Date(isoString).getTime();
        if (isNaN(timeMs)) return 'Vừa mới đây';
        const diffSec = Math.max(0, Math.round((Date.now() - timeMs) / 1000));
        if (diffSec < 15) return 'Vừa mới xong';
        if (diffSec < 60) return `${diffSec} giây trước`;
        const diffMin = Math.round(diffSec / 60);
        if (diffMin < 60) return `${diffMin} phút trước`;
        const diffHours = Math.round(diffMin / 60);
        if (diffHours < 24) return `${diffHours} giờ trước`;
        return new Date(timeMs).toLocaleDateString('vi-VN');
    }

    parseStudentProgressRecord(row) {
        const rawStatus = String(row?.status || '');
        const rawScore = String(row?.score_summary || '');
        let subjectName = '';
        const subjMatch = rawStatus.match(/^\[(.*?)\]/) || rawScore.match(/^\[(.*?)\]/);
        if (subjMatch) subjectName = subjMatch[1].trim();

        const isGrade5 = /lớp\s*5|toán|math5|toán\s*đề/i.test(subjectName) || 
                        /lớp\s*5/i.test(rawStatus) || /lớp\s*5/i.test(rawScore) ||
                        subjectName.toLowerCase().startsWith('toán');

        let answered = 0, total = 0, percent = 0;
        const progMatch = rawStatus.match(/(\d+)\s*\/\s*(\d+)/);
        if (progMatch) {
            answered = parseInt(progMatch[1], 10);
            total = parseInt(progMatch[2], 10);
            percent = total > 0 ? Math.round((answered / total) * 100) : 0;
        }

        let correct = 0, wrong = 0;
        const correctMatch = rawScore.match(/đúng\s*(\d+)(?:\s*\/\s*(\d+))?/i);
        if (correctMatch) {
            correct = parseInt(correctMatch[1], 10);
            if (correctMatch[2]) {
                const outOf = parseInt(correctMatch[2], 10);
                if (total === 0) total = outOf;
                if (answered === 0) answered = total;
                wrong = Math.max(0, (answered || total) - correct);
            } else if (answered >= correct) {
                wrong = answered - correct;
            }
        }

        const isCompleted = /đã nộp bài/i.test(rawStatus) || /hoàn thành/i.test(rawScore) || /điểm/i.test(rawScore);
        if (isCompleted && percent === 0 && total > 0) percent = 100;

        let finalScore = null;
        const scoreMatch = rawScore.match(/(\d+)\s*điểm/i);
        if (scoreMatch) finalScore = Number(scoreMatch[1].replace(',', '.'));

        const isWaiting = !isCompleted && (answered === 0 || /đang xem trang chủ|trang chủ|chưa chọn|chờ vào/i.test(rawStatus) || /trang chủ/i.test(subjectName));

        // Quy đổi sang Thang Điểm 10 khoa học (Tối đa 10 điểm mỗi đề)
        let score10 = 0;
        if (isCompleted) {
            if (finalScore !== null && !isNaN(finalScore)) {
                // score_summary stores percentage points (0-100), never raw points.
                const s = Number(finalScore) / 10;
                score10 = Math.min(10, Math.max(0, Math.round(s * 10) / 10));
            } else if (total > 0) {
                score10 = Math.min(10, Math.max(0, Math.round((correct / total) * 100) / 10));
            }
        } else if (total > 0 && answered > 0) {
            score10 = Math.min(10, Math.max(0, Math.round((correct / total) * 100) / 10));
        }

        return {
            id: row?.id,
            name: row?.player_name || 'Học sinh',
            ip: row?.ip_address || '',
            device: row?.device_info || '',
            subject: subjectName || 'Toán Lớp 5',
            isGrade5,
            answered,
            total,
            percent,
            correct,
            wrong,
            finalScore,
            score10,
            isCompleted,
            isWaiting,
            lastActive: row?.last_active,
            rawStatus,
            rawScore
        };
    }

    enterObserverMode() {
        this.switchScreen('observer');
        const floatBtn = document.getElementById('floating-admin-btn');
        if (floatBtn) {
            floatBtn.classList.add('hidden');
            floatBtn.classList.remove('flex');
        }
        const navBtn = document.getElementById('nav-admin-btn');
        if (navBtn) {
            navBtn.classList.add('hidden');
            navBtn.classList.remove('flex');
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });

        this.fetchAndRenderObserverFullscreen();

        // 1. Kích hoạt Supabase Realtime channel cho quiz_logins (Cập nhật tức thời không chờ đợi)
        if (!this.observerRealtimeChannel && window.dbService?.client && typeof window.dbService.client.channel === 'function') {
            try {
                this.observerRealtimeChannel = window.dbService.client
                    .channel('quiz-observer-live-feed')
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_logins' }, () => {
                        if (this.observerDebounceTimer) clearTimeout(this.observerDebounceTimer);
                        this.observerDebounceTimer = setTimeout(() => {
                            const screen = document.getElementById('screen-observer');
                            if (screen && !screen.classList.contains('hidden')) {
                                this.fetchAndRenderObserverFullscreen();
                            }
                        }, 180);
                    })
                    .subscribe();
            } catch (e) {
                console.warn('[Observer] Lỗi đăng ký realtime channel:', e);
            }
        }

        // 2. Timer kiểm tra nền dự phòng mỗi 8 giây (nhờ In-place DOM update nên hoàn toàn không giật hình)
        clearInterval(this.observerInterval);
        this.observerInterval = setInterval(() => {
            const screen = document.getElementById('screen-observer');
            if (screen && !screen.classList.contains('hidden')) {
                this.fetchAndRenderObserverFullscreen();
            }
        }, 8000);
    }

    exitObserverMode() {
        clearInterval(this.observerInterval);
        if (this.observerDebounceTimer) clearTimeout(this.observerDebounceTimer);
        this.switchScreen('home');
        this.updateAdminUIVisibility();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    openParentProgressModal() {
        this.enterObserverMode();
    }

    closeParentProgressModal() {
        this.exitObserverMode();
    }

    buildObserverCardInnerHtml(p, cardType, percent, timeAgo) {
        // 1. Trường hợp ĐANG CHỜ Ở TRANG CHỦ
        if (cardType === 'waiting') {
            return `
                <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-10 h-10 rounded-xl bg-slate-800 text-slate-400 flex items-center justify-center text-lg border border-slate-700 shrink-0">
                            <i class="fa-solid fa-user-clock"></i>
                        </div>
                        <div class="min-w-0">
                            <h3 class="font-bold text-white text-base truncate obs-card-name">${this.escapeHtml(p.name)}</h3>
                            <small class="text-xs text-slate-400 flex items-center gap-1"><i class="fa-solid fa-clock text-[10px]"></i> <span class="obs-card-time">${this.escapeHtml(timeAgo)}</span></small>
                        </div>
                    </div>
                    <span class="px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0">
                        <i class="fa-solid fa-hourglass-half text-[11px]"></i> Đang chờ
                    </span>
                </div>

                <div class="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs">
                    <span class="font-medium text-slate-300 flex items-center gap-2">
                        <i class="fa-solid fa-compass text-slate-500"></i> Đang ở màn hình trang chủ
                    </span>
                    <span class="text-slate-500 italic">Chưa chọn đề thi</span>
                </div>

                <div class="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
                    <span class="flex items-center gap-1.5"><i class="fa-solid fa-network-wired text-slate-500"></i> IP: <code class="text-slate-300 font-mono text-[10px]">${this.escapeHtml(p.ip || '—')}</code></span>
                    <span class="flex items-center gap-1.5"><i class="fa-solid fa-mobile-screen text-slate-500"></i> ${this.escapeHtml(p.device ? p.device.split(' ')[0] : 'Thiết bị')}</span>
                </div>
            `;
        }

        // 2. Trường hợp ĐÃ NỘP BÀI
        if (cardType === 'completed') {
            return `
                <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center text-lg border border-indigo-500/20 shrink-0">
                            <i class="fa-solid fa-award"></i>
                        </div>
                        <div class="min-w-0">
                            <h3 class="font-bold text-white text-base truncate obs-card-name">${this.escapeHtml(p.name)}</h3>
                            <small class="text-xs text-slate-400 flex items-center gap-1"><i class="fa-solid fa-clock text-[10px]"></i> <span class="obs-card-time">${this.escapeHtml(timeAgo)}</span></small>
                        </div>
                    </div>
                    <span class="px-2.5 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 shadow-sm">
                        <i class="fa-solid fa-circle-check text-indigo-400 text-[10px]"></i> Đã nộp bài
                    </span>
                </div>

                <div class="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-2.5">
                    <div class="flex items-center justify-between text-xs">
                        <span class="font-semibold text-slate-200 flex items-center gap-1.5 truncate">
                            <i class="fa-solid fa-book-open text-indigo-400"></i> <span class="obs-card-subject">${this.escapeHtml(p.subject)}</span>
                        </span>
                        <span class="font-bold text-indigo-400 shrink-0 obs-card-count">Hoàn thành: ${p.answered}/${p.total || p.answered} câu</span>
                    </div>
                    <div class="h-3 w-full bg-slate-900 rounded-full p-0.5 overflow-hidden border border-slate-800 shadow-inner">
                        <div class="obs-progress-fill h-full rounded-full bg-gradient-to-r from-indigo-500 via-emerald-400 to-teal-400 shadow-sm shadow-emerald-500/30" style="width: 100%;"></div>
                    </div>
                    <div class="flex items-center justify-between text-xs pt-0.5">
                        <span class="text-slate-300">Đúng: <b class="text-white">${p.correct}/${p.total || p.answered} câu</b> (${percent}%)</span>
                        <span class="text-xs font-extrabold text-amber-400 bg-amber-500/15 px-2.5 py-1 rounded-lg border border-amber-500/30 shadow-sm">
                            <i class="fa-solid fa-trophy mr-1"></i> ${p.score10.toFixed(1)} / 10 điểm
                        </span>
                    </div>
                </div>

                <div class="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
                    <span class="flex items-center gap-1.5"><i class="fa-solid fa-network-wired text-slate-500"></i> IP: <code class="text-slate-300 font-mono text-[10px]">${this.escapeHtml(p.ip || '—')}</code></span>
                    <span class="flex items-center gap-1.5"><i class="fa-solid fa-mobile-screen text-slate-500"></i> ${this.escapeHtml(p.device ? p.device.split(' ')[0] : 'Thiết bị')}</span>
                </div>
            `;
        }

        // 3. Trường hợp ĐANG LÀM BÀI (Thanh bài tập mượt mà có hiệu ứng Gradient & Shimmer)
        return `
            <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center text-lg border border-amber-500/20 shrink-0">
                        <i class="fa-solid fa-graduation-cap"></i>
                    </div>
                    <div class="min-w-0">
                        <h3 class="font-bold text-white text-base truncate obs-card-name">${this.escapeHtml(p.name)}</h3>
                        <small class="text-xs text-slate-400 flex items-center gap-1"><i class="fa-solid fa-clock text-[10px]"></i> <span class="obs-card-time">${this.escapeHtml(timeAgo)}</span></small>
                    </div>
                </div>
                <span class="px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 shadow-sm">
                    <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Đang làm bài
                </span>
            </div>

            <div class="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-2.5">
                <div class="flex items-center justify-between text-xs">
                    <span class="font-semibold text-slate-200 flex items-center gap-1.5 truncate">
                        <i class="fa-solid fa-book-open text-indigo-400"></i> <span class="obs-card-subject">${this.escapeHtml(p.subject)}</span>
                    </span>
                    <span class="font-bold text-cyan-400 shrink-0 obs-card-count">${p.answered}/${p.total > 0 ? p.total : 41} câu</span>
                </div>
                <div class="h-3 w-full bg-slate-900 rounded-full p-0.5 overflow-hidden border border-slate-800 shadow-inner">
                    <div class="obs-progress-fill h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-500 shadow-sm shadow-cyan-500/40 progress-shimmer" style="width: ${percent}%;"></div>
                </div>
                <div class="flex items-center justify-between text-xs pt-0.5">
                    <span class="text-slate-400">Tiến độ: <b class="text-white obs-card-percent">${percent}%</b></span>
                    <span class="text-xs text-slate-300 obs-card-score">
                        <b class="text-emerald-400 font-semibold">Đúng: ${p.correct}</b> • <span class="text-rose-400 font-semibold">Sai: ${p.wrong}</span> (<b>${p.score10.toFixed(1)}/10 đ</b>)
                    </span>
                </div>
            </div>

            <div class="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
                <span class="flex items-center gap-1.5"><i class="fa-solid fa-network-wired text-slate-500"></i> IP: <code class="text-slate-300 font-mono text-[10px]">${this.escapeHtml(p.ip || '—')}</code></span>
                <span class="flex items-center gap-1.5"><i class="fa-solid fa-mobile-screen text-slate-500"></i> ${this.escapeHtml(p.device ? p.device.split(' ')[0] : 'Thiết bị')}</span>
            </div>
        `;
    }

    renderObserverCardsSmoothly(container, sorted) {
        if (!sorted || sorted.length === 0) {
            container.innerHTML = `
                <div class="col-span-1 md:col-span-2 text-center py-12 px-4 bg-slate-900/50 rounded-2xl border border-dashed border-slate-800">
                    <div class="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto text-xl mb-3 border border-amber-500/20">
                        <i class="fa-solid fa-graduation-cap"></i>
                    </div>
                    <p class="font-bold text-slate-200 text-sm">Chưa có học sinh nào đang làm bài Lớp 5</p>
                    <p class="text-xs text-slate-400 mt-1 max-w-xs mx-auto">Khi học sinh chọn môn đề thi và bấm làm bài, tiến trình thực tế sẽ tự động hiện lên bảng này.</p>
                </div>
            `;
            return;
        }

        const emptyPlaceholder = container.querySelector('.col-span-1.md\\:col-span-2');
        if (emptyPlaceholder) emptyPlaceholder.remove();

        const existingCards = new Map();
        container.querySelectorAll('[data-student-id]').forEach(el => {
            existingCards.set(el.dataset.studentId, el);
        });

        const activeIds = new Set(sorted.map(s => s.id));
        existingCards.forEach((cardEl, id) => {
            if (!activeIds.has(id)) {
                cardEl.remove();
                existingCards.delete(id);
            }
        });

        sorted.forEach((p, index) => {
            const timeAgo = this.formatRelativeTime(p.lastActive);
            const cardType = p.isWaiting ? 'waiting' : (p.isCompleted ? 'completed' : 'doing');
            const percent = p.total > 0 ? Math.min(100, Math.round((p.answered / p.total) * 100)) : (p.isCompleted ? 100 : 0);

            let card = existingCards.get(p.id);

            if (!card) {
                card = document.createElement('div');
                card.className = 'obs-student-card p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col gap-3 shadow-lg hover:border-slate-700 transition-all duration-300';
                card.dataset.studentId = p.id;
                card.dataset.cardType = cardType;
                card.innerHTML = this.buildObserverCardInnerHtml(p, cardType, percent, timeAgo);
                const targetChild = container.children[index];
                container.insertBefore(card, targetChild || null);
            } else {
                if (card.dataset.cardType !== cardType) {
                    card.dataset.cardType = cardType;
                    card.innerHTML = this.buildObserverCardInnerHtml(p, cardType, percent, timeAgo);
                } else {
                    const elTime = card.querySelector('.obs-card-time');
                    if (elTime && elTime.textContent !== timeAgo) elTime.textContent = timeAgo;

                    if (cardType === 'doing') {
                        const elCount = card.querySelector('.obs-card-count');
                        const countText = `${p.answered}/${p.total > 0 ? p.total : 41} câu`;
                        if (elCount && elCount.textContent !== countText) elCount.textContent = countText;

                        const elBar = card.querySelector('.obs-progress-fill');
                        if (elBar) {
                            const targetWidth = `${percent}%`;
                            if (elBar.style.width !== targetWidth) {
                                elBar.style.width = targetWidth;
                            }
                        }

                        const elPercent = card.querySelector('.obs-card-percent');
                        if (elPercent && elPercent.textContent !== `${percent}%`) elPercent.textContent = `${percent}%`;

                        const elScore = card.querySelector('.obs-card-score');
                        if (elScore) {
                            elScore.innerHTML = `<b class="text-emerald-400 font-semibold">Đúng: ${p.correct}</b> • <span class="text-rose-400 font-semibold">Sai: ${p.wrong}</span> (<b>${p.score10.toFixed(1)}/10 đ</b>)`;
                        }
                    } else if (cardType === 'completed') {
                        const elBar = card.querySelector('.obs-progress-fill');
                        if (elBar && elBar.style.width !== '100%') elBar.style.width = '100%';
                    }
                }
                const targetChild = container.children[index];
                if (targetChild !== card) {
                    container.insertBefore(card, targetChild || null);
                }
            }
        });
    }

    async fetchAndRenderObserverFullscreen() {
        const container = document.getElementById('observer-progress-cards');
        if (!container) return;
        if (this.observerProgressLoading) {
            this.observerProgressRefreshQueued = true;
            return;
        }
        this.observerProgressLoading = true;

        let rows = [];
        try {
            if (window.dbService && typeof window.dbService.getLoginHistory === 'function') {
                rows = await window.dbService.getLoginHistory(150);
            }
        } catch (e) {
            console.warn('Lỗi tải tiến trình:', e);
        }

        const systemIds = [
            '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000003',
            '00000000-0000-0000-0000-000000000004',
            '00000000-0000-0000-0000-000000000005',
            '00000000-0000-0000-0000-000000000006',
            '00000000-0000-0000-0000-000000000007',
            '00000000-0000-0000-0000-000000000008'
        ];
        const studentRows = (rows || []).filter(r => {
            const name = String(r.player_name || '').trim().toLowerCase();
            const status = String(r.status || '').toLowerCase();
            return !systemIds.includes(r.id) && !name.startsWith('__') &&
                name !== 'khách truy cập' && name !== 'visitor' &&
                !status.includes('admin') && String(r.ip_address || '').trim() !== 'SYSTEM';
        });
        const latestByStudent = new Map();
        for (const row of studentRows) {
            const name = String(row.player_name || '').trim().toLowerCase();
            const ip = String(row.ip_address || '').trim().toLowerCase();
            const device = String(row.device_info || '').trim().toLowerCase();
            const key = name && name !== 'học sinh' ? `name:${name}` : (ip ? `ip:${ip}::device:${device}` : `row:${row.id}`);
            const time = new Date(row.last_active || row.created_at || 0).getTime() || 0;
            const old = latestByStudent.get(key);
            if (!old || time > old.time) latestByStudent.set(key, { row, time });
        }
        const parsed = Array.from(latestByStudent.values()).map(item => this.parseStudentProgressRecord(item.row)).filter(p => p.isGrade5 || p.answered > 0 || p.subject.toLowerCase().includes('toán') || p.subject.toLowerCase().includes('lớp 5'));

        let doingCount = 0;
        let submittedCount = 0;
        parsed.forEach(p => {
            if (p.isCompleted) submittedCount++;
            else if (!p.isWaiting) doingCount++;
        });

        const elDoing = document.getElementById('obs-stat-doing');
        const elSubmitted = document.getElementById('obs-stat-submitted');
        const elTotal = document.getElementById('obs-stat-total');
        if (elDoing) elDoing.textContent = doingCount;
        if (elSubmitted) elSubmitted.textContent = submittedCount;
        if (elTotal) elTotal.textContent = parsed.length;

        // Ưu tiên đưa học sinh đang thi lên đầu -> Đã nộp bài -> Người đang chờ
        const sorted = [...parsed].sort((a, b) => {
            const aScore = (!a.isCompleted && !a.isWaiting) ? 2 : (a.isCompleted ? 1 : 0);
            const bScore = (!b.isCompleted && !b.isWaiting) ? 2 : (b.isCompleted ? 1 : 0);
            if (bScore !== aScore) return bScore - aScore;
            return new Date(b.lastActive || 0).getTime() - new Date(a.lastActive || 0).getTime();
        });

        this.renderObserverCardsSmoothly(container, sorted);
        this.observerProgressLoading = false;
        if (this.observerProgressRefreshQueued) {
            this.observerProgressRefreshQueued = false;
            setTimeout(() => this.fetchAndRenderObserverFullscreen(), 500);
        }
    }

    async fetchAndRenderParentProgress() {
        return this.fetchAndRenderObserverFullscreen();
    }

    hasSubmittedAnswer(qId) {
        return Object.prototype.hasOwnProperty.call(this.userAnswers || {}, qId);
    }

    isShortAnswerCorrect(question, value) {
        if (!question || value === undefined || value === null) return false;
        const normalizedValue = String(value).trim().toLowerCase();
        if (!normalizedValue) return false;

        const acceptedValues = [question.correctValue, ...(Array.isArray(question.acceptedValues) ? question.acceptedValues : [])]
            .map((accepted) => String(accepted ?? '').trim().toLowerCase())
            .filter(Boolean);
        return acceptedValues.includes(normalizedValue);
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
            input?.classList.add('ring-2', 'ring-rose-500');
            setTimeout(() => input?.classList.remove('ring-2', 'ring-rose-500'), 2500);
            this.showToastNotification('⚠️ Vui lòng nhập Họ và Tên của bạn để bắt đầu làm bài!', 'warning');
            return;
        }

        this.playerName = name;
        this.currentLoginId = null;
        localStorage.setItem('quiz_user_name', name);

        const startButton = document.getElementById('btn-start-quiz');
        if (!this.isAppReady || this.isLoadingQuestions) {
            if (startButton) {
                startButton.disabled = true;
                startButton.setAttribute('aria-busy', 'true');
                startButton.classList.add('opacity-60', 'cursor-wait');
            }
            await this.loadQuestionsForCurrentSubject();
            if (startButton) {
                startButton.disabled = false;
                startButton.removeAttribute('aria-busy');
                startButton.classList.remove('opacity-60', 'cursor-wait');
            }
        }

        // 1. Dùng dữ liệu đã tải sẵn để mở bài ngay. Chỉ đồng bộ quyền ở nền,
        // tránh chặn giao diện bởi các request Supabase tuần tự.
        let visibleSubjects = this.getHomeVisibleSubjects();
        if (visibleSubjects.length === 0 || !visibleSubjects.some((subject) => subject.key === this.currentSubject)) {
            await this.refreshAccessAndSubjects();
            visibleSubjects = this.getHomeVisibleSubjects();
        } else {
            // Cập nhật quyền/môn học ở nền, không reload lại đề đang làm.
            this.refreshAccessAndSubjects(false).catch((error) => {
                console.debug('[QuizApp] Background access refresh skipped:', error);
            });
        }
        console.debug('[QuizApp] Start quiz requested:', { name, currentSubject: this.currentSubject, visibleSubjects: this.getHomeVisibleSubjects().map((subject) => subject.key), loadedQuestions: this.allQuestions.length, clientIp: this.clientIp, online: navigator.onLine });

        if (visibleSubjects.length === 0) {
            this.showAlertModal("⚠️ Hiện tại tất cả các đề thi đều đang được Giáo viên tạm ẩn. Vui lòng quay lại sau!");
            return;
        }

        if (!visibleSubjects.some((subject) => subject.key === this.currentSubject)) {
            this.showAlertModal(`⚠️ Môn [${this.getSubjectTitle()}] không thuộc khu vực được cấp quyền trên thiết bị hiện tại.`);
            await this.selectSubject(visibleSubjects[0].key);
            return;
        }

        if (!this.allQuestions || this.allQuestions.length === 0) {
            await this.loadQuestionsForCurrentSubject();
        }

        if (!this.allQuestions || this.allQuestions.length === 0) {
            this.showAlertModal(`⚠️ Môn [${this.getSubjectTitle()}] hiện chưa có câu hỏi nào trong hệ thống!`);
            return;
        }

        // Đảm bảo IP đã xác định trước khi ghi nhận vào hệ thống
        if (!this.clientIp || this.clientIp.startsWith('Đang')) {
            await this.fetchClientIp();
        }

        // Bài mới phải có ID riêng, không để heartbeat/tiến độ chạm vào lượt cũ.
        this.currentLoginId = null;
        try { sessionStorage.removeItem('quiz_current_login_id'); } catch (e) {}

        // Khởi tạo bài thi trên Cloud Supabase ở nền; không bắt học sinh chờ
        // truy vấn lookup + insert/update trước khi nhìn thấy câu hỏi.
        if (window.dbService && typeof window.dbService.recordLogin === 'function') {
            // Giữ promise để auto-submit có thể chờ ID cloud trước khi ghi điểm.
            this.quizAttemptId = (window.dbService.generateUUID ? window.dbService.generateUUID() : `attempt_${Date.now()}_${Math.random().toString(36).slice(2)}`);
            this.pendingStudentProgress = null;
            this.progressSyncRunning = false;
            const attemptId = this.quizAttemptId;
            this.loginRecordPromise = window.dbService.recordLogin({
                playerName: this.playerName,
                clientIp: this.clientIp,
                deviceInfo: this.deviceInfo,
                subjectTitle: this.getSubjectTitle(),
                scoreSummary: `[${this.getSubjectTitle()}] Bắt đầu làm bài`,
                attemptId,
                newAttempt: true
            })
                .then((res) => {
                    const loginId = (res && res.id) ? res.id : (typeof res === 'string' ? res : null);
                    if (loginId && this.quizAttemptId === attemptId) {
                        this.currentLoginId = loginId;
                        try { sessionStorage.setItem('quiz_current_login_id', loginId); } catch (e) {}
                        this.flushStudentProgress(attemptId);
                    }
                    return loginId;
                })
                .catch((error) => {
                    console.warn("Lỗi lưu đăng nhập lên Supabase:", error);
                    return null;
                });
        } else {
            this.loginRecordPromise = Promise.resolve(null);
        }

        this.isRevengeMode = false;
        this.isFinishingQuiz = false;
        if (this.fullQuestionsPool && this.fullQuestionsPool.length > 0) {
            this.allQuestions = [...this.fullQuestionsPool];
        }

        // Cập nhật Header
        const headerName = document.getElementById('quiz-header-player-name');
        if (headerName) headerName.textContent = this.playerName;

        const topSubTitle = document.getElementById('quiz-top-subject-title');
        if (topSubTitle) topSubTitle.textContent = this.getSubjectTitle();

        const modeBadge = document.getElementById('quiz-mode-badge');
        if (modeBadge) {
            modeBadge.textContent = "Luyện Tập";
            modeBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hidden sm:inline-block";
        }

        // Tải Auto-Save tiến độ cũ nếu có
        this.loadAutoSaveProgress();

        this.switchScreen('quiz');
        this.observeQuizHeader();
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

    renderAllQuestions(skipExitAnimation = false, skipEnterAnimation = false) {
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
            const animationClass = !skipEnterAnimation && filtered.length <= 40 ? ' question-card-enter' : '';
            card.className = `glass-card-pro quiz-question-card${animationClass} rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4`;
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
                    <button type="button" onclick="app.askAiExplanation(${JSON.stringify(q.id)})" id="ai-btn-${q.id}" class="btn-3d px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-indigo-700 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-indigo-950/40 transition cursor-pointer">
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
                                <button type="button" onclick="app.selectOption(${JSON.stringify(q.id)}, ${oIdx})" ${isAnswered ? 'disabled' : ''} class="quiz-option-tile w-full p-3 sm:p-3.5 rounded-xl border text-left flex items-start gap-3 transition-colors cursor-pointer disabled:cursor-default ${optStyle}">
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

                    const trueStateClass = val === true
                        ? `is-selected ${!this.isExamMode ? (st.answer === true ? 'is-selected-correct' : 'is-selected-wrong') : 'is-exam-selected'}`
                        : (isAnswered ? 'is-locked' : '');
                    const falseStateClass = val === false
                        ? `is-selected ${!this.isExamMode ? (st.answer === false ? 'is-selected-correct' : 'is-selected-wrong') : 'is-exam-selected'}`
                        : (isAnswered ? 'is-locked' : '');

                    return `
                                <div class="tf-statement-row p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                                    <div class="flex items-start gap-2 flex-1">
                                        <span class="font-bold text-indigo-400">${String.fromCharCode(97 + sIdx)})</span>
                                        <span class="text-slate-200 font-medium">${this.formatScientificNotation(st.text)}</span>
                                    </div>
                                    <div class="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                                        <button type="button" onclick="app.selectTfOption(${JSON.stringify(q.id)}, ${sIdx}, true)" ${isAnswered ? 'disabled' : ''} aria-pressed="${val === true}" class="tf-choice-button px-3 py-1.5 rounded-lg border text-xs font-bold ${trueStateClass} ${trueBtnClass}">
                                            ĐÚNG
                                        </button>
                                        <button type="button" onclick="app.selectTfOption(${JSON.stringify(q.id)}, ${sIdx}, false)" ${isAnswered ? 'disabled' : ''} aria-pressed="${val === false}" class="tf-choice-button px-3 py-1.5 rounded-lg border text-xs font-bold ${falseStateClass} ${falseBtnClass}">
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
                const hasSubmitted = this.hasSubmittedAnswer(q.id);
                const userVal = hasSubmitted ? String(this.userAnswers[q.id] ?? '') : '';
                const isCorrect = hasSubmitted && this.isShortAnswerCorrect(q, userVal);
                const correctValue = String(q.correctValue ?? '').trim() || String(q.acceptedValues?.[0] ?? '').trim();
                const shortFeedbackHtml = hasSubmitted ? `
                    <div class="short-answer-feedback ${this.isExamMode ? 'is-pending' : (isCorrect ? 'is-correct' : 'is-wrong')}" role="status" aria-live="polite">
                        <div class="short-answer-feedback-title">
                            <i class="fa-solid ${this.isExamMode ? 'fa-lock' : (isCorrect ? 'fa-circle-check' : 'fa-circle-xmark')}"></i>
                            <span>${this.isExamMode ? 'Đã ghi nhận câu trả lời' : (isCorrect ? 'Chính xác' : 'Chưa chính xác')}</span>
                        </div>
                        <div class="short-answer-feedback-line">
                            <span>Bạn nhập:</span>
                            <strong>${this.escapeHtml(userVal)}</strong>
                        </div>
                        ${!this.isExamMode ? `
                            <div class="short-answer-feedback-line">
                                <span>Đáp án đúng:</span>
                                <strong>${correctValue ? this.formatScientificNotation(correctValue) : 'Chưa thiết lập'}</strong>
                            </div>
                        ` : ''}
                    </div>
                ` : '';

                card.innerHTML = `
                    <div class="flex items-center justify-between gap-2">
                        <span class="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-xs">Câu ${idx + 1} (Trả lời ngắn)</span>
                        <span class="text-[11px] text-slate-400">${q.category || 'Điền số/chữ'}</span>
                    </div>
                    <h3 class="font-bold text-white text-sm sm:text-base leading-relaxed">${this.formatScientificNotation(q.question)}</h3>
                    ${imgHtml}
                    <div class="pt-2 flex flex-col sm:flex-row gap-2">
                        <input type="text" id="short-input-${q.id}" value="${this.escapeHtml(userVal)}" ${hasSubmitted ? 'disabled' : ''} aria-disabled="${hasSubmitted}" onchange="app.saveShortAnswer(${JSON.stringify(q.id)}, this.value)" onkeydown="if (event.key === 'Enter') { event.preventDefault(); app.saveShortAnswer(${JSON.stringify(q.id)}, this.value); }" placeholder="Nhập đáp án của bạn..." class="answer-text-input flex-1 px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm outline-none focus:border-indigo-500 font-mono ${hasSubmitted ? 'is-submitted' : ''}">
                        <button type="button" ${hasSubmitted ? 'disabled' : ''} aria-disabled="${hasSubmitted}" onclick="app.saveShortAnswer(${JSON.stringify(q.id)}, document.getElementById('short-input-${q.id}').value)" class="answer-submit-button px-5 py-2.5 rounded-xl text-white font-bold text-xs cursor-pointer ${hasSubmitted ? 'is-submitted' : ''}">
                            <i class="fa-solid ${hasSubmitted ? 'fa-check' : 'fa-arrow-right'}"></i>
                            <span>${hasSubmitted ? 'Đã ghi nhận' : 'Ghi nhận'}</span>
                        </button>
                    </div>
                    ${shortFeedbackHtml}
                    ${aiButtonHtml}
                `;
            }

            fragment.appendChild(card);
        });

        container.appendChild(fragment);

        this.renderMath(container);
    }

    selectOption(qId, oIdx) {
        const q = this.allQuestions.find(item => String(item.id) === String(qId));
        if (!q) return;
        if (this.hasSubmittedAnswer(qId)) {
            console.debug('[QuizApp] Bỏ qua lần chọn trắc nghiệm thứ hai:', { qId, existing: this.userAnswers[qId] });
            return;
        }

        this.userAnswers[qId] = oIdx;
        this.saveAutoSaveProgress();
        const scrollY = window.scrollY;
        this.renderAllQuestions(true, true);
        window.requestAnimationFrame(() => window.scrollTo(0, scrollY));
        this.updateLiveStats();
    }

    selectTfOption(qId, stmtIdx, isTrue) {
        qId = this.allQuestions.find(item => String(item.id) === String(qId))?.id ?? qId;
        const currentAnswers = this.userAnswers[qId];
        const hasExistingAnswer = currentAnswers && typeof currentAnswers === 'object'
            && Object.prototype.hasOwnProperty.call(currentAnswers, stmtIdx);
        if (hasExistingAnswer) {
            console.debug('[QuizApp] Bỏ qua lần chọn Đúng/Sai thứ hai:', { qId, stmtIdx, existing: currentAnswers[stmtIdx] });
            return;
        }

        if (!currentAnswers || typeof currentAnswers !== 'object' || Array.isArray(currentAnswers)) {
            this.userAnswers[qId] = {};
        }
        this.userAnswers[qId][stmtIdx] = Boolean(isTrue);
        console.debug('[QuizApp] Đã ghi nhận lựa chọn Đúng/Sai:', { qId, stmtIdx, answer: Boolean(isTrue) });
        this.saveAutoSaveProgress();
        const scrollY = window.scrollY;
        this.renderAllQuestions(true, true);
        window.requestAnimationFrame(() => window.scrollTo(0, scrollY));
        this.updateLiveStats();
    }

    saveShortAnswer(qId, val) {
        const question = this.allQuestions.find(item => String(item.id) === String(qId));
        if (!question || question.qType !== 'short_answer') return;
        if (this.hasSubmittedAnswer(qId)) {
            console.debug('[QuizApp] Bỏ qua lần nhập trả lời ngắn thứ hai:', { qId, existing: this.userAnswers[qId] });
            return;
        }

        const normalizedValue = String(val ?? '').trim();
        if (!normalizedValue) return;
        this.userAnswers[qId] = normalizedValue;
        console.debug('[QuizApp] Đã ghi nhận trả lời ngắn:', { qId, answered: true });
        this.saveAutoSaveProgress();
        const scrollY = window.scrollY;
        this.renderAllQuestions(true, true);
        window.requestAnimationFrame(() => window.scrollTo(0, scrollY));
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

        // Đồng bộ ngay lên Supabase; nếu attempt còn đang tạo thì giữ bản mới nhất
        // và flush ngay sau khi loginRecordPromise trả về ID.
        this.pendingStudentProgress = {
            attemptedCount, totalItems, correctCount,
            subjectName: this.getSubjectTitle(),
            attemptId: this.quizAttemptId
        };
        this.flushStudentProgress(this.quizAttemptId);
    }

    async flushStudentProgress(attemptId = this.quizAttemptId) {
        const progress = this.pendingStudentProgress;
        if (!progress || !attemptId || progress.attemptId !== attemptId || !this.currentLoginId ||
            !window.dbService || typeof window.dbService.updateStudentProgress !== 'function' || this.progressSyncRunning) return;
        this.progressSyncRunning = true;
        try {
            await window.dbService.updateStudentProgress(
                this.currentLoginId,
                progress.attemptedCount,
                progress.totalItems,
                progress.correctCount,
                progress.subjectName
            );
        } finally {
            this.progressSyncRunning = false;
            // Nếu học sinh chọn thêm trong lúc request trước đang chạy, gửi snapshot mới nhất.
            if (this.pendingStudentProgress && this.pendingStudentProgress !== progress && this.currentScreen === 'quiz') {
                this.flushStudentProgress(attemptId);
            }
        }
    }

    startStopwatch() {
        clearInterval(this.timerInterval);
        const timerDisplay = document.getElementById('timer-display');

        if (this.isExamMode) {
            this.examSecondsRemaining = this.examMinutes * 60;
            if (timerDisplay) timerDisplay.textContent = `${String(this.examMinutes).padStart(2, '0')}:00`;
            this.timerInterval = setInterval(() => {
                this.examSecondsRemaining--;
                if (this.examSecondsRemaining <= 0) {
                    clearInterval(this.timerInterval);
                    this.showAlertModal("⏰ ĐÃ HẾT GIỜ LÀM BÀI! Hệ thống đang tự động nộp bài của bạn.");
                    this.finishQuiz('time-expired');
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

    startAwayAutoSubmitTimer(reason = 'unknown') {
        if (this.currentScreen !== 'quiz' || this.isFinishingQuiz) return;
        if (this.awayAutoSubmitTimer !== null) {
            console.debug('[QuizApp] Away auto-submit timer already running:', { reason });
            return;
        }
        const delayMs = 5 * 60 * 1000;
        console.debug('[QuizApp] Away auto-submit timer started:', { reason, delayMs });
        this.awayAutoSubmitTimer = window.setTimeout(() => {
            this.awayAutoSubmitTimer = null;
            console.debug('[QuizApp] Away auto-submit timer fired:', {
                reason,
                currentScreen: this.currentScreen,
                hidden: document.hidden,
                windowUnfocused: typeof document.hasFocus === 'function' && !document.hasFocus()
            });

            const stillAway = Boolean(document.hidden) || (typeof document.hasFocus === 'function' && !document.hasFocus());
            if (this.currentScreen !== 'quiz' || this.isFinishingQuiz || !stillAway) {
                console.debug('[QuizApp] Away auto-submit skipped because focus returned.');
                return;
            }

            this.showToastNotification('⏰ Bạn đã rời khỏi bài thi quá 5 phút. Hệ thống đã tự động nộp bài để bảo toàn kết quả.', 'warning');
            this.finishQuiz('away');
        }, delayMs);
    }

    startIdleAutoSubmitTimer(reason = 'no activity') {
        if (this.currentScreen !== 'quiz' || this.isFinishingQuiz) return;
        if (this.idleAutoSubmitTimer !== null) return;
        const delayMs = 5 * 60 * 1000;
        console.debug('[QuizApp] Idle auto-submit timer started:', { reason, delayMs });
        this.idleAutoSubmitTimer = window.setTimeout(() => {
            this.idleAutoSubmitTimer = null;
            if (this.currentScreen !== 'quiz' || this.isFinishingQuiz) return;
            console.debug('[QuizApp] Idle auto-submit timer fired:', { reason });
            this.showToastNotification('⏰ Bạn không thao tác trong 5 phút. Hệ thống đã tự động nộp bài để bảo toàn kết quả.', 'warning');
            this.finishQuiz('idle');
        }, delayMs);
    }

    resetIdleAutoSubmitTimer(reason = 'user activity') {
        if (this.currentScreen !== 'quiz' || this.isFinishingQuiz) return;
        this.cancelIdleAutoSubmitTimer(reason);
        this.startIdleAutoSubmitTimer(reason);
    }

    cancelAwayAutoSubmitTimer(reason = 'unknown') {
        const hadTimer = this.awayAutoSubmitTimer !== null;
        if (hadTimer) {
            clearTimeout(this.awayAutoSubmitTimer);
            this.awayAutoSubmitTimer = null;
        }
        console.debug('[QuizApp] Away auto-submit timer cancelled:', { reason, hadTimer });
    }

    cancelIdleAutoSubmitTimer(reason = 'unknown') {
        const hadTimer = this.idleAutoSubmitTimer !== null;
        if (hadTimer) {
            clearTimeout(this.idleAutoSubmitTimer);
            this.idleAutoSubmitTimer = null;
        }
        console.debug('[QuizApp] Idle auto-submit timer cancelled:', { reason, hadTimer });
    }

    stopStopwatch() {
        clearInterval(this.timerInterval);
        this.cancelAwayAutoSubmitTimer('stop stopwatch');
        this.cancelIdleAutoSubmitTimer('stop stopwatch');
    }

    async confirmSubmit() {
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
        const isComplete = unattempted <= 0;
        const msg = isComplete
            ? `Bạn đã hoàn thành đầy đủ ${attemptedCount}/${totalItems} ý hỏi!\nBạn có muốn nộp bài ngay để xem điểm tổng kết và lời giải chi tiết?`
            : `Bạn đã hoàn thành ${attemptedCount}/${totalItems} ý hỏi (vẫn còn ${unattempted} ý chưa trả lời).\nBạn có chắc chắn muốn nộp bài ngay bây giờ?`;

        const ok = await this.showConfirmModal({
            title: isComplete ? 'Hoàn tất & Nộp bài thi?' : 'Nộp bài khi chưa làm hết?',
            badge: isComplete ? 'Sẵn sàng chấm điểm' : `Còn ${unattempted} ý trống`,
            message: msg,
            confirmText: isComplete ? 'Nộp bài & Xem điểm' : 'Nộp bài ngay',
            cancelText: isComplete ? 'Kiểm tra lại' : 'Làm tiếp',
            variant: isComplete ? 'success' : 'warning',
            icon: isComplete ? 'fa-solid fa-circle-check' : 'fa-solid fa-paper-plane',
            okIcon: 'fa-solid fa-paper-plane'
        });
        if (ok) {
            this.finishQuiz();
        }
    }

    async finishQuiz(autoSubmitReason = '') {
        if (this.isFinishingQuiz) {
            console.debug('[QuizApp] Duplicate finishQuiz call ignored.');
            return;
        }
        this.isFinishingQuiz = true;
        this.stopStopwatch();

        if (this.loginRecordPromise) {
            try {
                await Promise.race([
                    this.loginRecordPromise,
                    new Promise((resolve) => window.setTimeout(resolve, 5000))
                ]);
            } catch (error) { console.warn('[QuizApp] Không chờ được bản ghi phiên trước khi nộp:', error); }
        }

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
        const score10El = document.getElementById('result-score-10');
        const timeSpentEl = document.getElementById('result-time-spent');
        const greetingEl = document.getElementById('result-player-greeting');

        if (scoreEl) scoreEl.textContent = '0%';
        if (score10El) score10El.textContent = '0.0';
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
                `[${subjTitle}] Đúng ${correctCount}/${totalItems} ý (${finalScore} điểm) - ${timeStr}`
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

        // Cập nhật Ngân hàng câu sai cá nhân (Mistake Bank)
        const remainingWrong = this.updateMistakeBankOnFinish(questions);
        this.updateResultRevengeButton();
        this.updateHomeRevengeBanner();

        if (this.isRevengeMode) {
            if (correctCount === totalItems) {
                this.showToastNotification('🏆 XUẤT SẮC! Bạn đã phục thù thành công 100% các câu sai!', 'success');
            } else {
                this.showToastNotification(`Bạn đã sửa đúng ${correctCount}/${totalItems} ý. Còn ${remainingWrong.length} câu sai cần tiếp tục phục thù!`, 'info');
            }
        }

        this.renderReviewList();
        this.switchScreen('result');
        this.animateResultScore(finalScore);
        if (score10El) score10El.textContent = (finalScore / 10).toFixed(1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    animateResultScore(targetScore) {
        const scoreEl = document.getElementById('result-score');
        if (!scoreEl) return;

        const target = Math.max(0, Number(targetScore) || 0);
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (reduceMotion) {
            scoreEl.textContent = `${target}%`;
            return;
        }

        const start = performance.now();
        const duration = 360;
        const tick = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            scoreEl.textContent = `${Math.round(target * eased)}%`;
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
                    <button type="button" onclick='app.askAiExplanation(${JSON.stringify(q.id)})' id="ai-btn-review-${q.id}" class="btn-3d px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer">
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
    /* NGÂN HÀNG CÂU SAI & ĐỀ PHỤC THÙ (MISTAKE BANK / REVENGE QUIZ)   */
    /* ============================================================== */

    getMistakeStorageKey(subjectKey = this.currentSubject, playerName = this.playerName) {
        const sub = subjectKey || 'default';
        const name = (playerName || '').trim() || (localStorage.getItem('quiz_user_name') || '').trim() || '';
        return name ? `quiz_wrong_questions_${sub}_${name}` : `quiz_wrong_questions_${sub}_anonymous`;
    }

    getWrongQuestionIds(subjectKey = this.currentSubject, playerName = this.playerName) {
        const key = this.getMistakeStorageKey(subjectKey, playerName);
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    saveWrongQuestionIds(ids, subjectKey = this.currentSubject, playerName = this.playerName) {
        const key = this.getMistakeStorageKey(subjectKey, playerName);
        try {
            const uniqueIds = Array.from(new Set(ids || []));
            if (uniqueIds.length === 0) {
                localStorage.removeItem(key);
            } else {
                localStorage.setItem(key, JSON.stringify(uniqueIds));
            }
        } catch (e) {
            console.warn('[QuizApp] Lỗi lưu ngân hàng câu sai:', e);
        }
        this.updateHomeRevengeBanner();
        this.updateResultRevengeButton();
    }

    isQuestionAnsweredCorrectly(q) {
        if (!q) return false;
        const qType = q.qType || q.q_type || 'mcq';
        if (qType === 'short_answer') {
            const val = this.userAnswers[q.id];
            if (val === undefined || String(val).trim() === '') return false;
            const accepted = Array.isArray(q.acceptedValues) ? q.acceptedValues : (Array.isArray(q.accepted_values) ? q.accepted_values : []);
            const targetVal = String(q.correctValue ?? q.correct_value ?? '').trim().toLowerCase();
            return accepted.some(v => String(v).trim().toLowerCase() === String(val).trim().toLowerCase()) ||
                targetVal === String(val).trim().toLowerCase();
        } else if (qType === 'tf_group') {
            const ansObj = this.userAnswers[q.id];
            if (!ansObj || typeof ansObj !== 'object') return false;
            const stmts = Array.isArray(q.statements) ? q.statements : [];
            if (stmts.length === 0) return false;
            return stmts.every((st, idx) => ansObj[idx] !== undefined && Boolean(ansObj[idx]) === Boolean(st.answer));
        } else {
            const sel = this.userAnswers[q.id];
            if (sel === undefined) return false;
            const correctIdx = q.correct !== undefined ? q.correct : q.answer;
            return Number(sel) === Number(correctIdx);
        }
    }

    updateMistakeBankOnFinish(questions = this.allQuestions) {
        const currentWrong = this.getWrongQuestionIds();
        const idSet = new Set(currentWrong.map(String));
        const currentAttemptWrong = [];

        (questions || []).forEach(q => {
            const qIdStr = String(q.id);
            if (this.isQuestionAnsweredCorrectly(q)) {
                // Đã làm đúng trong lượt này -> Gỡ khỏi ngân hàng câu sai
                idSet.delete(qIdStr);
            } else {
                // Làm sai hoặc chưa đúng -> Thêm vào ngân hàng câu sai
                idSet.add(qIdStr);
                currentAttemptWrong.push(q);
            }
        });

        // Lưu đối tượng câu sai trong phiên hiện tại để có thể bấm phục thù ngay lập tức
        this.currentMistakeQuestions = currentAttemptWrong;

        const updatedIds = Array.from(idSet).map(idStr => {
            const num = Number(idStr);
            return (!isNaN(num) && String(num) === idStr) ? num : idStr;
        });

        this.saveWrongQuestionIds(updatedIds);
        return updatedIds;
    }

    updateHomeRevengeBanner() {
        // Tuyệt đối không hiển thị Đề Phục Thù ở màn hình chính (home) theo yêu cầu người dùng
        const banner = document.getElementById('home-revenge-banner');
        if (banner) banner.classList.add('hidden');
    }

    updateResultRevengeButton() {
        const card = document.getElementById('result-revenge-card');
        const btn = document.getElementById('btn-revenge-quiz-result');
        const badge = document.getElementById('result-revenge-count-badge');
        const countText = document.getElementById('result-revenge-count-text');
        const descText = document.getElementById('result-revenge-desc');
        const textEl = document.getElementById('revenge-btn-text');
        const badgeAllCorrect = document.getElementById('badge-all-correct-result');
        const actionRevengeBtn = document.getElementById('btn-result-action-revenge');
        const actionRevengeText = document.getElementById('btn-result-action-revenge-text');

        // Ưu tiên đếm số câu sai thực tế từ lượt làm hiện tại, hoặc từ cache ngân hàng câu sai
        let count = 0;
        if (Array.isArray(this.currentMistakeQuestions) && this.currentMistakeQuestions.length > 0) {
            count = this.currentMistakeQuestions.length;
        } else {
            const wrongIds = this.getWrongQuestionIds();
            count = wrongIds.length;
        }

        if (count > 0) {
            if (card) card.classList.remove('hidden');
            if (btn) {
                btn.classList.remove('hidden', 'opacity-50', 'pointer-events-none');
                btn.classList.add('btn-revenge-glowing');
                btn.disabled = false;
            }
            if (badge) badge.textContent = `${count} câu sai`;
            if (countText) countText.textContent = String(count);
            if (descText) {
                descText.innerHTML = `Bạn có <strong class="text-amber-300 font-bold">${count}</strong> câu trả lời chưa đúng trong đề thi này. Hãy làm lại ngay để củng cố kiến thức và không bao giờ mất điểm!`;
            }
            if (textEl) {
                const prefix = this.isRevengeMode ? '🔥 Tiếp Tục Phục Thù' : '🔥 Vào Làm Lại Các Câu Sai Ngay';
                textEl.textContent = `${prefix} (${count} câu)`;
            }
            if (actionRevengeBtn) {
                actionRevengeBtn.classList.remove('hidden');
                if (actionRevengeText) {
                    actionRevengeText.textContent = `🔥 Làm lại ${count} câu sai`;
                }
            }
            if (badgeAllCorrect) badgeAllCorrect.classList.add('hidden');
        } else {
            // Không có câu sai hoặc đã hoàn thành xuất sắc 100%
            if (card) card.classList.add('hidden');
            if (btn) {
                btn.classList.remove('btn-revenge-glowing');
                btn.classList.add('hidden');
                btn.disabled = true;
            }
            if (actionRevengeBtn) {
                actionRevengeBtn.classList.add('hidden');
            }
            if (badgeAllCorrect) {
                badgeAllCorrect.classList.remove('hidden');
            }
        }
    }

    async startMistakeQuiz() {
        return this.startRevengeQuiz();
    }

    async startRevengeQuiz() {
        // Tuyệt đối không bắt học sinh phải thoát ra màn hình chính hay chọn lại môn
        let name = this.playerName || (document.getElementById('player-name-input')?.value.trim()) || localStorage.getItem('quiz_user_name') || 'Học sinh';
        this.playerName = name;
        this.currentLoginId = null;
        try { localStorage.setItem('quiz_user_name', name); } catch (e) {}

        // Đảm bảo ngân hàng câu hỏi gốc đã sẵn sàng
        if (!this.fullQuestionsPool || this.fullQuestionsPool.length === 0) {
            if (this.allQuestions && this.allQuestions.length > 0 && !this.isRevengeMode) {
                this.fullQuestionsPool = [...this.allQuestions];
            } else {
                await this.loadQuestionsForCurrentSubject();
                if (this.allQuestions && this.allQuestions.length > 0) {
                    this.fullQuestionsPool = [...this.allQuestions];
                }
            }
        }

        // Lấy danh sách các câu hỏi sai:
        // 1. Ưu tiên các câu sai từ lượt làm vừa kết thúc
        // 2. Nếu không có (ví dụ F5 trên màn kết quả), lấy từ ngân hàng câu sai đã lưu trong localStorage
        let mistakeQuestions = [];
        if (Array.isArray(this.currentMistakeQuestions) && this.currentMistakeQuestions.length > 0) {
            mistakeQuestions = [...this.currentMistakeQuestions];
        } else {
            const wrongIds = this.getWrongQuestionIds();
            if (wrongIds && wrongIds.length > 0) {
                const wrongIdSet = new Set(wrongIds.map(String));
                const pool = (this.fullQuestionsPool && this.fullQuestionsPool.length > 0)
                    ? this.fullQuestionsPool
                    : this.allQuestions;
                mistakeQuestions = pool.filter(q => wrongIdSet.has(String(q.id)));
            }
        }

        if (!mistakeQuestions || mistakeQuestions.length === 0) {
            this.showAlertModal("🎉 Tuyệt vời! Bạn hiện không còn câu hỏi nào bị làm sai ở môn này. Hãy chọn đề chính để ôn luyện nhé!");
            return;
        }

        // Kích hoạt chế độ Phục Thù
        this.isRevengeMode = true;
        this.isMistakeMode = true;
        this.isFinishingQuiz = false;
        this.allQuestions = [...mistakeQuestions];
        this.userAnswers = {};
        this.currentFilter = 'all';

        // Xóa tiến độ autosave cũ
        this.clearAutoSaveProgress();

        // Cập nhật Header bài thi
        const headerName = document.getElementById('quiz-header-player-name');
        if (headerName) headerName.textContent = this.playerName;

        const modeBadge = document.getElementById('quiz-mode-badge');
        if (modeBadge) {
            modeBadge.innerHTML = '<i class="fa-solid fa-fire text-amber-300 mr-1.5 animate-pulse"></i> ĐỀ PHỤC THÙ - THỬ THÁCH SỬA SAI';
            modeBadge.className = "px-3.5 py-1 rounded-full text-xs font-extrabold uppercase bg-gradient-to-r from-rose-600/30 via-orange-600/30 to-pink-600/30 text-rose-300 border border-rose-500/50 shadow-md inline-flex items-center";
            modeBadge.classList.remove('hidden');
        }

        const topSubTitle = document.getElementById('quiz-top-subject-title');
        if (topSubTitle) {
            topSubTitle.textContent = `${this.getSubjectTitle()} (Phục thù ${mistakeQuestions.length} câu)`;
        }

        // Đề phục thù là một lượt làm bài độc lập với lượt vừa chấm điểm.
        this.currentLoginId = null;
        try { sessionStorage.removeItem('quiz_current_login_id'); } catch (e) {}

        if (window.dbService && typeof window.dbService.recordLogin === 'function') {
            this.quizAttemptId = (window.dbService.generateUUID ? window.dbService.generateUUID() : `attempt_${Date.now()}_${Math.random().toString(36).slice(2)}`);
            this.pendingStudentProgress = null;
            this.progressSyncRunning = false;
            const attemptId = this.quizAttemptId;
            this.loginRecordPromise = window.dbService.recordLogin({
                playerName: this.playerName,
                clientIp: this.clientIp,
                deviceInfo: this.deviceInfo,
                subjectTitle: `[Phục thù] ${this.getSubjectTitle()}`,
                scoreSummary: `[Bắt đầu Đề Phục Thù: ${mistakeQuestions.length} câu]`,
                attemptId,
                newAttempt: true
            }).then((res) => {
                const loginId = (res && res.id) ? res.id : (typeof res === 'string' ? res : null);
                if (loginId && this.quizAttemptId === attemptId) {
                    this.currentLoginId = loginId;
                    try { sessionStorage.setItem('quiz_current_login_id', loginId); } catch (e) {}
                    this.flushStudentProgress(attemptId);
                }
                if (loginId && this.quizAttemptId === attemptId) {
                    try { sessionStorage.setItem('quiz_current_login_id', loginId); } catch (e) {}
                }
                return loginId;
            }).catch(() => null);
        } else {
            this.loginRecordPromise = Promise.resolve(null);
        }

        // Chuyển ngay sang màn hình thi và bắt đầu tính giờ
        this.switchScreen('quiz');
        this.observeQuizHeader();
        this.renderAllQuestions();
        this.startStopwatch();
        this.updateLiveStats();
        this.renderFilterTabs();

        this.showToastNotification(`🔥 Đã mở đề phục thù với ${mistakeQuestions.length} câu làm sai. Hãy tập trung làm lại để nắm vững kiến thức!`, 'success');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ============================================================== */
    /* 10. ĐIỀU HƯỚNG MÀN HÌNH & BẢO MẬT & HEARTBEAT                  */
    /* ============================================================== */

    switchScreen(screenName) {
        this.currentScreen = screenName;
        if (screenName === 'quiz') {
            this.resetIdleAutoSubmitTimer('quiz screen active');
            const windowUnfocused = typeof document.hasFocus === 'function' && !document.hasFocus();
            if (document.hidden || windowUnfocused) {
                this.startAwayAutoSubmitTimer('quiz screen entered while away');
            } else {
                this.cancelAwayAutoSubmitTimer('quiz screen active');
            }
        } else {
            this.quizAttemptId = null;
            this.cancelAwayAutoSubmitTimer(`screen changed to ${screenName}`);
            this.cancelIdleAutoSubmitTimer(`screen changed to ${screenName}`);
        }
        const mainHeader = document.getElementById('main-header');
        if (mainHeader) {
            if (screenName === 'quiz') {
                mainHeader.classList.add('hidden');
            } else {
                mainHeader.classList.remove('hidden');
            }
        }

        const floatBtn = document.getElementById('floating-admin-btn');
        const isObserver = this.hasTokenRole('parent') || (this.tokenInfo && (this.tokenInfo.role === 'parent' || this.tokenInfo.role === 'observer')) || screenName === 'observer';
        if (floatBtn && isObserver) {
            floatBtn.classList.add('hidden');
            floatBtn.classList.remove('flex');
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

    async returnToHome() {
        // Bug 4 Fix: Chỉ cảnh báo khi đang ở màn hình thi 'quiz' và đã trả lời câu hỏi
        const isCurrentlyQuiz = this.screens.quiz && !this.screens.quiz.classList.contains('hidden');
        const hasAnswers = Object.keys(this.userAnswers).length > 0;

        if (isCurrentlyQuiz && hasAnswers) {
            const ok = await this.showConfirmModal({
                title: 'Rời khỏi bài thi đang làm?',
                badge: 'Đổi môn học',
                message: 'Bạn đang làm bài dở. Quay lại màn hình chính sẽ kết thúc lượt làm bài này.\nBạn có chắc chắn muốn rời đi không?',
                confirmText: 'Về màn hình chính',
                cancelText: 'Ở lại làm tiếp',
                variant: 'warning',
                icon: 'fa-solid fa-house-chimney'
            });
            if (!ok) {
                return;
            }
        }

        this.stopStopwatch();
        this.isRevengeMode = false;
        this.isFinishingQuiz = false;
        if (this.fullQuestionsPool && this.fullQuestionsPool.length > 0) {
            this.allQuestions = [...this.fullQuestionsPool];
        }
        this.updateHomeRevengeBanner();
        this.switchScreen('home');
    }

    async resetCurrentQuiz() {
        const ok = await this.showConfirmModal({
            title: 'Làm lại bài thi từ đầu?',
            badge: 'Làm mới bài thi',
            message: 'Làm lại từ đầu sẽ xóa toàn bộ đáp án đã chọn của bài thi hiện tại.\nBạn có chắc chắn muốn bắt đầu lại không?',
            confirmText: 'Làm lại ngay',
            cancelText: 'Tiếp tục làm bài',
            variant: 'warning',
            icon: 'fa-solid fa-rotate-left',
            okIcon: 'fa-solid fa-rotate-left'
        });
        if (!ok) return;
        this.cancelAwayAutoSubmitTimer('quiz reset');
        this.cancelIdleAutoSubmitTimer('quiz reset');
        this.isFinishingQuiz = false;
        this.userAnswers = {};
        this.clearAutoSaveProgress();
        if (this.fullQuestionsPool && this.fullQuestionsPool.length > 0) {
            this.allQuestions = [...this.fullQuestionsPool];
        }
        this.isRevengeMode = false;
        this.isMistakeMode = false;
        const modeBadge = document.getElementById('quiz-mode-badge');
        if (modeBadge) {
            modeBadge.textContent = "Luyện Tập";
            modeBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hidden sm:inline-block";
        }
        const topSubTitle = document.getElementById('quiz-top-subject-title');
        if (topSubTitle) topSubTitle.textContent = this.getSubjectTitle();
        this.switchScreen('quiz');
        this.renderAllQuestions();
        this.startStopwatch();
        this.updateLiveStats();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    filterQuestions(filterKey) {
        this.currentFilter = filterKey;
        const container = document.getElementById('quiz-filter-tabs-container');
        if (container) {
            container.querySelectorAll('.filter-tab-btn').forEach(btn => {
                const isActive = btn.getAttribute('data-filter') === filterKey;
                btn.classList.toggle('bg-indigo-600', isActive);
                btn.classList.toggle('text-white', isActive);
                btn.classList.toggle('shadow-md', isActive);
                btn.classList.toggle('bg-slate-800', !isActive);
                btn.classList.toggle('hover:bg-slate-700', !isActive);
                btn.classList.toggle('text-slate-300', !isActive);
            });
        }
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
        this.updateHomeRevengeBanner();
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
        this.updateHomeRevengeBanner();
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
        this.updateHomeRevengeBanner();
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
        if (this.currentScreen === 'quiz' || this.isFinishingQuiz || this.quizAttemptId) return;
        if (!this.clientIp || this.clientIp.startsWith('Đang')) {
            await this.fetchClientIp();
        }
        const name = this.playerName || (document.getElementById('player-name-input')?.value || '').trim() || 'Khách truy cập';
        try {
            if (this.currentScreen === 'quiz' || this.isFinishingQuiz || this.quizAttemptId) return;
            const res = await window.dbService.recordLogin({
                playerName: name,
                clientIp: this.clientIp,
                deviceInfo: this.deviceInfo,
                subjectTitle: statusText,
                scoreSummary: '',
                sessionId: this.visitorSessionId || (this.visitorSessionId = `visitor_${this.clientIp}_${this.deviceInfo}`),
                loginId: this.visitorLoginId || null
            });
            const loginId = (res && res.id) ? res.id : (typeof res === 'string' ? res : null);
            if (loginId) {
                this.visitorLoginId = loginId;
                try { sessionStorage.setItem('quiz_visitor_login_id', loginId); } catch (e) {}
            }
        } catch (e) { }
    }

    updateTotalQuestionDisplay() {
        const count = this.allQuestions ? this.allQuestions.length : 0;
        const countText = document.getElementById('home-rules-count-text');
        if (countText) {
            countText.innerHTML = 'Nội dung: <strong><span id="home-rules-count" data-home-count="' + count + '">0</span> câu hỏi</strong> trắc nghiệm (Tự động chấm & hiện đáp án ngay).';
            this.animateHomeCount('home-rules-count', count);
        }
    }

    renderFilterTabs() {
        const container = document.getElementById('quiz-filter-tabs-container');
        if (!container) return;
        const activeFilter = this.currentFilter || 'all';
        const tabs = [
            { key: 'all', label: 'Tất cả' },
            { key: 'mcq', label: 'Trắc nghiệm' },
            { key: 'tf', label: 'Đúng / Sai' },
            { key: 'short', label: 'Trả lời ngắn' }
        ];
        container.innerHTML = tabs.map(t => {
            const isActive = t.key === activeFilter;
            const stateClass = isActive
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300';
            return `<button onclick="app.filterQuestions('${t.key}')" class="filter-tab-btn px-3 py-1 rounded-full font-semibold transition ${stateClass} cursor-pointer" data-filter="${t.key}">${t.label}</button>`;
        }).join('');
    }

    /* ============================================================== */
    /* 11. GIÁM SÁT MÁY & CHẶN IP & REALTIME HEARTBEAT               */
    /* ============================================================== */

    getActiveStudentName() {
        return String(this.playerName || document.getElementById('player-name-input')?.value || localStorage.getItem('quiz_user_name') || localStorage.getItem('quiz_saved_player_name') || '').trim();
    }

    markNoticeSeen(noticeId) {
        if (!noticeId) return;
        if (!this.seenNoticeIds) {
            try {
                this.seenNoticeIds = new Set(JSON.parse(sessionStorage.getItem('quiz_seen_notice_ids') || '[]'));
            } catch (e) {
                this.seenNoticeIds = new Set();
            }
        }
        this.seenNoticeIds.add(String(noticeId));
        this.lastReceivedNoticeId = String(noticeId);
        try {
            const arr = Array.from(this.seenNoticeIds).slice(-50);
            sessionStorage.setItem('quiz_seen_notice_ids', JSON.stringify(arr));
        } catch (e) { }
    }

    async checkSystemNotice(isInitialBaseline = false) {
        if (!window.dbService || typeof window.dbService.getSystemNotice !== 'function') return;
        if (!this.seenNoticeIds) {
            try {
                this.seenNoticeIds = new Set(JSON.parse(sessionStorage.getItem('quiz_seen_notice_ids') || '[]'));
            } catch (e) {
                this.seenNoticeIds = new Set();
            }
        }
        const currentPlayer = this.getActiveStudentName();
        const notice = await window.dbService.getSystemNotice(this.clientIp, currentPlayer);
        if (!notice || !(notice.content || notice.message) || notice.active === false) return;

        const noticeId = String(notice.id || notice.timestamp || notice.content || notice.message);
        if (this.seenNoticeIds.has(noticeId) || this.lastReceivedNoticeId === noticeId) return;

        if (isInitialBaseline) {
            let isBrandNewLocal = false;
            try {
                const rawLocal = localStorage.getItem('quiz_latest_system_notice');
                if (rawLocal) {
                    const parsed = JSON.parse(rawLocal);
                    if (parsed && String(parsed.id) === noticeId && parsed.timestamp && (Date.now() - Number(parsed.timestamp) <= 12000)) {
                        isBrandNewLocal = true;
                    }
                }
            } catch (e) { }
            this.markNoticeSeen(noticeId);
            if (isBrandNewLocal) {
                this.showStudentNotice(notice.content || notice.message);
            }
            return;
        }

        this.markNoticeSeen(noticeId);
        this.showStudentNotice(notice.content || notice.message);
    }

    startRealtimeHeartbeat() {
        this.checkSystemNotice(true).catch(() => { });

        // Tự động pulse heartbeat ngay khi chuyển tab hoặc mở lại màn hình
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                if (this.currentLoginId && window.dbService?.heartbeat) {
                    this.presenceHeartbeatAt = Date.now();
                    window.dbService.heartbeat(this.currentLoginId).catch(() => {});
                } else {
                    this.recordVisitorPresence('Đang xem trang chủ').catch(() => {});
                }
            }
        });
        window.addEventListener('focus', () => {
            if (this.currentLoginId && window.dbService?.heartbeat) {
                this.presenceHeartbeatAt = Date.now();
                window.dbService.heartbeat(this.currentLoginId).catch(() => {});
            }
        });

        window.addEventListener('storage', (event) => {
            if (event.key === 'quiz_latest_system_notice' && event.newValue) {
                this.checkSystemNotice(false).catch(() => { });
            }
        });

        try {
            if (window.dbService?.client && typeof window.dbService.client.channel === 'function' && !this.noticeRealtimeChannel) {
                this.noticeRealtimeChannel = window.dbService.client
                    .channel('quiz-system-notices-live')
                    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'quiz_logins' }, (payload) => {
                        const row = payload?.new;
                        if (row && row.player_name === '__SYSTEM_NOTICE__') {
                            this.checkSystemNotice(false).catch(() => { });
                        }
                    })
                    .subscribe();
            }
        } catch (e) { }

        // Kiểm tra quyền thường xuyên nhưng chỉ ghi heartbeat hiện diện mỗi 20-30 giây.
        setInterval(async () => {
            if (!window.dbService) return;

            if (this.currentLoginId && Date.now() - this.presenceHeartbeatAt >= 20000) {
                this.presenceHeartbeatAt = Date.now();
                await window.dbService.heartbeat?.(this.currentLoginId);
            } else if (!this.currentLoginId) {
                this.recordVisitorPresence('Đang xem trang chủ').catch(() => {});
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
                await this.checkSystemNotice(false);
            } catch (e) { }

            // 6. Tự động cập nhật danh sách giám sát thí sinh thời gian thực (nếu Admin đang mở tab Giám sát)
            try {
                const adminModal = document.getElementById('modal-admin-dashboard');
                if (adminModal && !adminModal.classList.contains('hidden') && this.adminCurrentTab === 'students' && this.isAdminAuthenticated) {
                    await this.renderAdminStudentsList(true);
                }
            } catch (e) { }
        }, 2500);
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
        if (cleanContent.length < 1) return;
        text.textContent = cleanContent;
        this.hideStudentNotice();
        banner.classList.remove('hidden');
        try {
            if (typeof this.playSound === 'function') this.playSound(true);
        } catch (e) { }
        const totalSeconds = 6;
        let secondsLeft = totalSeconds;
        if (timer) timer.textContent = `${secondsLeft}s`;
        if (bar) bar.style.width = '100%';

        this.studentNoticeTimer = setInterval(() => {
            secondsLeft--;
            if (timer) timer.textContent = `${secondsLeft}s`;
            if (bar) bar.style.width = `${(secondsLeft / totalSeconds) * 100}%`;
            if (secondsLeft <= 0) {
                this.hideStudentNotice();
            }
        }, 1000);
    }

    hideStudentNotice() {
        const banner = document.getElementById('student-notice-banner');
        if (this.studentNoticeTimer) {
            clearInterval(this.studentNoticeTimer);
            this.studentNoticeTimer = null;
        }
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

            const nowMs = Date.now() + (window.dbService?.serverClockOffsetMs || 0);
            const activeNow = list.filter(s => {
                const ts = s.last_active ? new Date(s.last_active).getTime() : (s.created_at ? new Date(s.created_at).getTime() : 0);
                if (!ts || Number.isNaN(ts) || ts <= 0) return false;
                // Hoạt động trong 5 phút qua (300,000 ms) hoặc đồng hồ chạy trước
                return ts >= nowMs - 300000 && ts <= nowMs + 86400000;
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
                const lastMs = student.last_active ? new Date(student.last_active).getTime() : (student.created_at ? new Date(student.created_at).getTime() : 0);
                const timeStr = lastMs
                    ? new Date(Math.min(lastMs, nowMs)).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : '—';
                const isOnline = activeNow.includes(student);

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

                const safeName = this.escapeHtml(name);
                const safeIp = this.escapeHtml(ip);
                const safeDevice = this.escapeHtml(device);
                const safeScoreInfo = this.escapeHtml(scoreInfo);
                const jsIp = this.escapeHtml(String(ip).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
                const jsName = this.escapeHtml(String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

                rowsHtml += `
                    <tr class="hover:bg-slate-800/40 transition">
                        <td class="py-2.5 px-3">
                            <div class="flex items-center gap-2">
                                ${displayBadge}
                                <span class="font-bold text-white text-xs truncate max-w-[150px]" title="${safeName}">${safeName}</span>
                            </div>
                        </td>
                        <td class="py-2.5 px-3 font-mono text-amber-300 text-xs">${safeIp}</td>
                        <td class="py-2.5 px-3 text-slate-300 text-xs">${safeDevice}</td>
                        <td class="py-2.5 px-3 text-center text-slate-400 text-xs font-mono">${timeStr}</td>
                        <td class="py-2.5 px-3 text-center">
                            <span class="px-2.5 py-1 rounded-lg ${isBanned ? 'bg-rose-500/20 text-rose-200 border border-rose-500/30' : 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/30'} font-semibold text-[11px] inline-block max-w-[220px] truncate" title="${safeScoreInfo}">
                                ${safeScoreInfo}
                            </span>
                        </td>
                        <td class="py-2.5 px-3 text-right">
                            <div class="flex items-center justify-end gap-1.5 flex-wrap">
                                <button onclick="app.adminToggleStudentAiRole('${jsIp}', '${jsName}')" class="px-2.5 py-1 rounded-lg ${isAiGranted ? 'bg-purple-600/30 text-purple-200 border border-purple-500/50 hover:bg-rose-600/30' : 'bg-slate-800 text-slate-300 hover:text-white border border-slate-700 hover:bg-purple-600/30'} text-xs font-bold transition cursor-pointer" title="${isAiGranted ? 'Bấm để thu hồi quyền Trợ lý AI' : 'Bấm để cấp quyền sử dụng Trợ lý AI cho IP này'}">
                                    <i class="fa-solid fa-wand-magic-sparkles mr-1 ${isAiGranted ? 'text-amber-300' : 'text-slate-400'}"></i> ${isAiGranted ? 'Đã có AI' : 'Cấp AI'}
                                </button>
                                ${isBanned ? `
                                    <button onclick="app.adminUnbanStudentIp('${jsIp}')" class="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 text-xs font-bold transition cursor-pointer" title="Bấm để mở chặn cho IP này">
                                        <i class="fa-solid fa-lock-open mr-1"></i> Mở Chặn
                                    </button>
                                ` : `
                                    <button onclick="app.adminBanStudentIp('${jsIp}')" class="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-bold transition cursor-pointer" title="Bấm để chặn ngay IP này">
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
        if (!(await this.showConfirmModal({
            title: 'Xóa toàn bộ lịch sử đăng nhập?',
            badge: 'Dọn dẹp phiên',
            message: 'Bạn có chắc chắn muốn xóa toàn bộ danh sách phiên đăng nhập và lịch sử làm bài của học sinh?',
            confirmText: 'Xóa lịch sử',
            cancelText: 'Hủy bỏ',
            variant: 'danger',
            icon: 'fa-solid fa-trash-can'
        }))) return;
        try {
            if (window.dbService && typeof window.dbService.clearAllLogins === 'function') {
                await window.dbService.clearAllLogins();
                this.renderAdminStudentsList();
            }
        } catch (e) {
            this.showAlertModal("Lỗi: " + e.message);
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
                this.showAlertModal("Đã phát thông báo thành công đến tất cả thí sinh!");
            }
        } catch (e) {
            this.showAlertModal("Lỗi phát thông báo: " + e.message);
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
            this.showAlertModal("Vui lòng nhập địa chỉ IP cần chặn.");
            return;
        }
        await this.adminBanStudentIp(ip);
        if (input) input.value = '';
    }

    async adminBanStudentIp(ip) {
        if (!(await this.showConfirmModal({
            title: 'Chặn khẩn cấp địa chỉ IP?',
            badge: 'An ninh phòng thi',
            message: `Bạn có chắc chắn muốn CHẶN NGAY LẬP TỨC địa chỉ IP: ${ip}?\nThiết bị này sẽ bị khóa màn hình ngay lập tức.`,
            confirmText: 'Chặn IP ngay',
            cancelText: 'Hủy bỏ',
            variant: 'danger',
            icon: 'fa-solid fa-ban'
        }))) return;
        try {
            if (window.dbService && typeof window.dbService.banIp === 'function') {
                await window.dbService.banIp(ip, "Gian lận / Vi phạm quy chế phòng thi");
                this.showAlertModal(`Đã kích hoạt lệnh chặn đối với IP: ${ip}!`);
                await this.loadBannedIpsList();
                this.renderAdminStudentsList();
                this.renderAdminBannedIpsList();
            }
        } catch (e) {
            this.showAlertModal("Lỗi chặn IP: " + e.message);
        }
    }

    async adminUnbanStudentIp(ip) {
        if (!(await this.showConfirmModal({
            title: 'Mở khóa địa chỉ IP?',
            badge: 'Khôi phục truy cập',
            message: `Bạn có chắc chắn muốn MỞ CHẶN cho địa chỉ IP: ${ip} để học sinh tiếp tục vào làm bài?`,
            confirmText: 'Mở khóa IP',
            cancelText: 'Hủy bỏ',
            variant: 'success',
            icon: 'fa-solid fa-lock-open'
        }))) return;
        try {
            if (window.dbService && typeof window.dbService.unbanIp === 'function') {
                await window.dbService.unbanIp(ip);
                this.showAlertModal(`✅ Đã mở chặn thành công cho IP: ${ip}!`);
                await this.loadBannedIpsList();
                this.renderAdminStudentsList();
                this.renderAdminBannedIpsList();
            }
        } catch (e) {
            this.showAlertModal("Lỗi mở chặn IP: " + e.message);
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
        const pass = await this.showPromptModal({
            title: 'Mở khóa IP khẩn cấp',
            badge: 'Khẩn cấp',
            message: 'Nhập mật khẩu Admin để mở khóa IP cho thiết bị này:',
            placeholder: 'Nhập mật khẩu Admin...',
            inputType: 'password',
            confirmText: 'Mở khóa ngay',
            icon: 'fa-solid fa-key'
        });
        if (pass === null) return;
        if (pass === this.adminSecretPass) {
            try {
                if (window.dbService && typeof window.dbService.unbanIp === 'function') {
                    await window.dbService.unbanIp(this.clientIp);
                    await this.showAlertModal("Đã gỡ chặn IP thành công! Đang tải lại trang...");
                    location.reload();
                }
            } catch (e) {
                this.showAlertModal("Lỗi mở khóa: " + e.message);
            }
        } else {
            this.showAlertModal("Mật khẩu không chính xác!");
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
            this.showAlertModal("Vui lòng nhập đầy đủ Project URL và Anon Public Key.");
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
            this.showAlertModal("✅ Đã lưu kết nối Supabase Cloud thành công!");
            this.closeSettingsModal();
        } catch (e) {
            this.showAlertModal("Lỗi lưu cấu hình: " + e.message);
        }
    }

    async clearSupabaseConfig() {
        if (!(await this.showConfirmModal({
            title: 'Khôi phục cấu hình Cloud gốc?',
            badge: 'Supabase Cloud',
            message: 'Bạn có chắc chắn muốn khôi phục về cấu hình Supabase Cloud mặc định của hệ thống?',
            confirmText: 'Khôi phục mặc định',
            cancelText: 'Hủy bỏ',
            variant: 'warning',
            icon: 'fa-solid fa-arrow-rotate-left'
        }))) return;
        localStorage.removeItem('quiz_supabase_url');
        localStorage.removeItem('quiz_supabase_key');
        localStorage.removeItem('supabase_url');
        localStorage.removeItem('supabase_key');
        if (window.dbService && typeof window.dbService.clearConfig === 'function') {
            window.dbService.clearConfig();
        }
        await this.showAlertModal("✅ Đã khôi phục cài đặt gốc! Đang tải lại trang...");
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
            this.showAlertModal("Vui lòng nhập nội dung câu hỏi.");
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
            this.showAlertModal(`Không thể lưu câu hỏi lên Supabase Cloud.\n${error.message}`);
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
        if (!(await this.showConfirmModal({
            title: `Xóa câu hỏi #${qId}?`,
            badge: 'Ngân hàng câu hỏi',
            message: `Bạn có chắc chắn muốn xóa vĩnh viễn câu hỏi #${qId} khỏi ngân hàng đề?`,
            confirmText: 'Xóa câu hỏi',
            cancelText: 'Giữ lại',
            variant: 'danger',
            icon: 'fa-solid fa-trash-can'
        }))) return;
        this.allQuestions = this.allQuestions.filter(q => q.id !== qId);
        try {
            if (window.dbService && typeof window.dbService.deleteQuestion === 'function') {
                await window.dbService.deleteQuestion(qId);
            }
        } catch (e) {
            console.error("Lỗi khi xóa câu hỏi trên Cloud:", e);
        }

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

    async loadGlobalGeminiApiKey(forceRefresh = false) {
        if (this.geminiApiKey && !forceRefresh) return this.geminiApiKey;
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

    async getAvailableGeminiModels(apiKey) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        let response;
        try {
            response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, { cache: 'no-store', signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
        if (!response.ok) throw new Error(`Không thể đọc danh sách model Gemini (HTTP ${response.status}).`);
        const data = await response.json();
        return (data.models || [])
            .filter((model) => Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent'))
            .map((model) => String(model.name || '').replace(/^models\//, ''))
            .filter((name) => /^gemini-.*flash/i.test(name) && !/image|audio|tts|live|robotics|embedding/i.test(name))
            .sort((a, b) => a.localeCompare(b));
    }

    openAiSettingsModal() {
        if (!this.isAdminAuthenticated) {
            this.showAlertModal("🔒 Tính năng cấu hình Gemini API Key chỉ dành riêng cho Quản trị viên (Admin).");
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
            this.showAlertModal("🔒 Chỉ Quản trị viên mới được thay đổi Gemini API Key.");
            return;
        }
        const input = document.getElementById('gemini-api-key-input');
        const key = (input ? input.value : '').trim();
        if (!key) {
            this.showAlertModal("Vui lòng dán mã Google Gemini API Key để lưu.");
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
            this.showAlertModal("✅ Đã lưu khóa AI trên Cloud. Học sinh chỉ sử dụng được khi IP đã được cấp quyền AI.");
        } else {
            this.showAlertModal("✅ Đã lưu khóa Gemini API Key lên Cloud.");
        }
        this.closeAiSettingsModal();
    }

    async clearAiApiKey() {
        if (!this.isAdminAuthenticated) {
            this.showAlertModal("🔒 Chỉ Quản trị viên mới được xóa Gemini API Key.");
            return;
        }
        if (!(await this.showConfirmModal({
            title: 'Xóa khóa AI khỏi hệ thống?',
            badge: 'Cấu hình Gemini AI',
            message: 'Bạn có chắc chắn muốn xóa Gemini API Key khỏi toàn bộ hệ thống?',
            confirmText: 'Xóa API Key',
            cancelText: 'Hủy bỏ',
            variant: 'danger',
            icon: 'fa-solid fa-key'
        }))) return;
        localStorage.removeItem('gemini_api_key');
        this.geminiApiKey = '';
        const input = document.getElementById('gemini-api-key-input');
        if (input) input.value = '';

        try {
            if (window.dbService && typeof window.dbService.saveGeminiApiKey === 'function') {
                await window.dbService.saveGeminiApiKey('');
            }
        } catch (e) {}

        this.showAlertModal("Đã xóa API Key khỏi hệ thống.");
    }

    async askAiExplanation(qId) {
        // Admin được dùng trực tiếp; học sinh phải nằm trong whitelist IP.
        if (!this.isAdminAuthenticated) await this.loadAiIpsConfig();
        if (!this.isAiAllowedForCurrentClient()) {
            await this.showConfirmModal({
                title: 'Chưa được cấp quyền Trợ lý AI',
                badge: 'Yêu cầu quyền AI',
                copyValue: this.clientIp || 'Chưa xác định',
                copyLabel: 'Địa chỉ IP của bạn',
                copyOnConfirm: true,
                message: 'Tính năng Trợ lý AI giải thích bài yêu cầu Quản trị viên (Admin) cấp quyền theo địa chỉ IP. Hãy sao chép địa chỉ IP trên và gửi cho Admin để được kích hoạt quyền!',
                confirmText: 'Sao chép IP',
                cancelText: 'Đóng',
                okIcon: 'fa-regular fa-copy',
                icon: 'fa-solid fa-lock',
                variant: 'warning'
            });
            return;
        }

        let apiKey = await this.loadGlobalGeminiApiKey(true);

        if (!apiKey) {
            if (this.isAdminAuthenticated) {
                this.showAlertModal("✨ Chưa cấu hình Gemini API Key. Hãy nhập khóa trong khu vực Admin, sau đó cấp quyền AI cho từng IP.");
                this.openAiSettingsModal();
            } else {
                this.showAlertModal("✨ Trợ lý AI đang chờ giáo viên/quản trị viên cấu hình khóa API chung. Vui lòng báo quản trị viên cài đặt!");
            }
            return;
        }

        const q = (this.allQuestions || []).find(item => item.id == qId);
        if (!q) {
            this.showAlertModal("Không tìm thấy dữ liệu câu hỏi.");
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

        const prompt = `Bạn là gia sư Việt Nam. Giải thích ngắn gọn 3-5 câu, dễ hiểu.
Môn: ${this.getSubjectTitle()}
Câu hỏi: ${q.question}
${optionsText ? `Phương án:\n${optionsText}\n` : ''}Đáp án đúng: ${correctText}
Học sinh chọn: ${studentAnswerText}
Trả về đúng 3 mục: Vì sao đúng; Bẫy cần tránh (nếu có); Mẹo nhớ nhanh. Không lan man.`;

        try {
            let candidateModels = [];
            try {
                candidateModels = await this.getAvailableGeminiModels(apiKey);
            } catch (modelListError) {
                console.warn('[QuizMaster AI] Không đọc được model list, dùng model mặc định:', modelListError.message);
                candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
            }
            candidateModels = candidateModels.slice(0, 3);
            if (!candidateModels.length) candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

            let res = null;
            let lastErrMsg = "";

            for (const model of candidateModels) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 20000);
                    const startedAt = performance.now();
                    let callResp;
                    try {
                        callResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            signal: controller.signal,
                            body: JSON.stringify({
                                contents: [{ parts: [{ text: prompt }] }],
                                generationConfig: { temperature: 0.2, maxOutputTokens: 700 }
                            })
                        });
                    } finally {
                        clearTimeout(timeoutId);
                    }
                    console.debug('[QuizMaster AI] Gemini response timing:', { model, elapsedMs: Math.round(performance.now() - startedAt), status: callResp?.status || 'network-error' });

                    if (callResp.ok) {
                        res = callResp;
                        break;
                    } else {
                        const errData = await callResp.json().catch(() => ({}));
                        lastErrMsg = errData?.error?.message || `Lỗi HTTP ${callResp.status} (${model})`;
                        console.debug('[QuizMaster AI] Gemini diagnostic:', { model, status: callResp.status, message: lastErrMsg, isAdmin: this.isAdminAuthenticated, currentIp: this.clientIp });
                        console.warn(`[QuizMaster AI] Model ${model} gặp lỗi (${callResp.status}):`, lastErrMsg);

                        // Dừng lặp chỉ khi API Key sai định dạng hoàn toàn
                        const isApiKeyInvalid = callResp.status === 400 && (lastErrMsg.includes('API_KEY_INVALID') || lastErrMsg.includes('API key not valid'));
                        if (isApiKeyInvalid) {
                            break;
                        }

                        // Nếu do lỗi server bận/quá tải (503), quota (429), chờ nhẹ rồi fallback
                        if (callResp.status === 429 || callResp.status === 503) await new Promise(resolve => setTimeout(resolve, 250));
                        continue;
                    }
                } catch (netErr) {
                    lastErrMsg = netErr.name === 'AbortError' ? `Model ${model} phản hồi quá 20 giây.` : netErr.message;
                    console.warn(`[QuizMaster AI] Lỗi mạng khi gọi ${model}:`, netErr);
                }
            }

            if (!res || !res.ok) {
                const quota = /quota exceeded|resource_exhausted|rate limit|free tier/i.test(lastErrMsg);
                throw new Error(quota ? 'Model Gemini đã thử đang hết quota hoặc bị giới hạn tốc độ. Kiểm tra quota theo model và project trong Google AI Studio; các key cùng project dùng chung quota.' : (lastErrMsg || "Không thể kết nối đến máy chủ Google Gemini."));
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

    async clearPersonalHistory() {
        if (!(await this.showConfirmModal({
            title: 'Xóa nhật ký ôn tập cá nhân?',
            badge: 'Lịch sử làm bài',
            message: 'Bạn có chắc chắn muốn xóa toàn bộ 10 bài làm gần nhất trong lịch sử cá nhân trên thiết bị này?',
            confirmText: 'Xóa lịch sử',
            cancelText: 'Giữ lại',
            variant: 'danger',
            icon: 'fa-solid fa-clock-rotate-left'
        }))) return;
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
        window.addEventListener('focus', () => {
            // Khi học sinh chuyển tab quay lại (ví dụ sau khi gửi mã máy QM-... cho Thầy Cô qua Zalo)
            this.validateUserToken(false).then(() => this.syncClass5Access()).then(() => this.renderHomeSubjects()).catch(() => {});
        });
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
        this.showAlertModal(`Đã đổi môn [${sub.name}] sang trạng thái: ${nextVis === 'PUBLIC' ? 'CÔNG KHAI' : 'RIÊNG TƯ'}`);
    }

    initEventListeners() {
        document.addEventListener('visibilitychange', () => {
            if (this.currentScreen !== 'quiz') return;
            if (document.hidden) {
                this.startAwayAutoSubmitTimer('document hidden');
            } else {
                this.cancelAwayAutoSubmitTimer('document visible');
                this.resetIdleAutoSubmitTimer('document visible');
            }
        }, { passive: true });

        window.addEventListener('blur', () => {
            if (this.currentScreen === 'quiz') {
                this.startAwayAutoSubmitTimer('window blur');
            }
        }, { passive: true });

        window.addEventListener('focus', () => {
            if (this.currentScreen === 'quiz') {
                this.cancelAwayAutoSubmitTimer('window focus');
                this.resetIdleAutoSubmitTimer('window focus');
            }
        }, { passive: true });

        ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((eventName) => {
            document.addEventListener(eventName, () => this.resetIdleAutoSubmitTimer(eventName), { passive: true });
        });

        // Nhấn phím Enter hoặc thay đổi tên học sinh -> tự động ghi nhớ & ghi nhận trạng thái
        const nameInput = document.getElementById('player-name-input');
        if (nameInput) {
            nameInput.addEventListener('change', () => {
                const val = nameInput.value.trim();
                if (val && val !== this.playerName) {
                    this.playerName = val;
                    localStorage.setItem('quiz_user_name', val);
                    this.updateHomeRevengeBanner();
                }
            });
            nameInput.addEventListener('input', () => {
                const val = nameInput.value.trim();
                if (val !== this.playerName) {
                    this.playerName = val;
                    this.updateHomeRevengeBanner();
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
