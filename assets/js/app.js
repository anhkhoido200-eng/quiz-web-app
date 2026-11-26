/**
 *  Hệ Thống Ôn Thi Trực Tuyến Toàn Diện
 * Tự động hóa toàn bộ: Phân quyền IP Admin, Đa môn học động, Nạp đề Word/Excel,
 * Xuất điểm Excel, Bảng xếp hạng Top 10, Chế độ bảo trì, Luyện tập vs Thi thử.
 */

class QuizApp {
    constructor() {
        // Môn học & Đa môn học động (Ghi nhớ môn đã chọn gần nhất)
        this.currentSubject = this.safeStorageGet('quiz_last_selected_subject') || '';
        this.homeGradeFilter = 'all';
        this.dynamicSubjects = [];
        this.rosterConfig = null;
        this.isOutsideGuestMode = false;
        this.pinnedDeviceName = '';
        this.currentAttemptOutsideRoster = false;
        this.flashcardSession = null;
        this.flashcardTimer = null;

        // Thông tin người học & Thiết bị & IP
        this.playerName = "";
        this.isPlayerNameCommitted = false;
        this._draftPlayerName = "";
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
        this.awayStartedAt = null;
        this.lastQuizActivityAt = null;
        this.loginRecordPromise = null;
        this.quizAttemptId = null;
        this.pendingStudentProgress = null;
        this.progressSyncRunning = false;
        this.isFinishingQuiz = false;
        this.awaySwitchCount = 0;
        this.isExamMode = false;
        this.examMinutes = 45;
        this.examSecondsRemaining = 45 * 60;

        // Âm thanh Ting / Bíp (Web Audio API)
        this.soundEnabled = this.safeStorageGet('quiz_sound_enabled') !== 'false';

        // Dữ liệu câu hỏi & Đáp án người dùng
        this.allQuestions = [];
        this.fullQuestionsPool = [];
        this.isRevengeMode = false;
        this.isMistakeMode = false;
        this.currentMistakeQuestions = [];
        this.userAnswers = {};      // { [qId]: selectedIndex hoặc { [stmtIdx]: boolean } hoặc string }
        this.currentFilter = 'all';

        // Quyền Quản trị viên (Chỉ xác thực qua máy chủ / IP Whitelist Cloud)
        this.isAdminAuthenticated = false;
        this.adminCurrentTab = 'questions';
        this.allowedAdminIps = [];
        this.masterAdminIp = '';
        this.adminIpConfig = { masterIp: '', allowedIps: [] };

        // Phân quyền sử dụng Trợ lý AI theo địa chỉ IP
        this.allowedAiIps = [];

        // Phân quyền kết hợp Token (Token-based Auth)
        const _localTestState = (() => {
            try {
                const host = String(window.location.hostname || '').toLowerCase();
                const isLocalHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
                const requestedIp = new URLSearchParams(window.location.search).get('test_ip') || '';
                const hasTestIp = isLocalHost && /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[0-9a-f:]+)$/i.test(requestedIp.trim());
                return {
                    hasTestIp,
                    // Chỉ khóa cứng chế độ preview ẩn Lớp 5 trên cổng 4173 khi KHÔNG truyền ?test_ip= tường minh.
                    override: isLocalHost && !hasTestIp && String(window.location.port || '') === '4173'
                };
            } catch (e) {
                return { hasTestIp: false, override: false };
            }
        })();
        this.hasLocalTestIpParam = _localTestState.hasTestIp;
        this.localTestIpOverride = _localTestState.override;
        const _isolateLocalProfile = this.localTestIpOverride || this.hasLocalTestIpParam;
        this.userToken = _isolateLocalProfile ? '' : (this.safeStorageGet('quiz_access_token') || '').trim();
        this.tokenInfo = null;
        try {
            const cachedToken = _isolateLocalProfile ? '' : this.safeStorageGet('quiz_token_info');
            if (cachedToken) {
                const parsedToken = JSON.parse(cachedToken);
                this.tokenInfo = parsedToken && typeof parsedToken === 'object' && !Array.isArray(parsedToken) ? parsedToken : null;
            }
            if (_isolateLocalProfile) {
                ['quiz_admin_token', 'quiz_access_token', 'quiz_token_info', 'quiz_is_admin', 'quiz_admin_authenticated', 'quiz_admin_saved_ip']
                    .forEach((key) => localStorage.removeItem(key));
            }
        } catch (e) {}

        // Danh sách các IP đang bị chặn (Banned IPs)
        this.bannedIpsList = [];

        // Phân quyền môn Địa Lí (hoặc các môn Private)
        this.allowedGeoIps = [];
        this.geoMode = 'PRIVATE';
        this.class5AllowedIps = [];
        try {
            const cachedG5 = this.safeStorageGet('quiz_cache_grade5_ips');
            if (cachedG5) {
                const parsedG5 = JSON.parse(cachedG5);
                this.class5AllowedIps = Array.isArray(parsedG5) ? parsedG5 : [];
            }
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
        this._quizHeaderResizeHandler = null;
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
        const savedModel = this.safeStorageGet('gemini_model');
        const supportedGeminiModels = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
        if (!supportedGeminiModels.includes(savedModel)) {
            this.safeStorageSet('gemini_model', supportedGeminiModels[0]);
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
        if (this._headerOffsetRaf) return;
        this._headerOffsetRaf = window.requestAnimationFrame(() => {
            this._headerOffsetRaf = null;
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
                questions.style.paddingTop = `${headerHeight + safePadding}px`;
            } else {
                questions.style.paddingTop = `${safePadding}px`;
            }
        });
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
        if (!this._quizHeaderResizeHandler) {
            this._quizHeaderResizeHandler = () => this.syncQuizHeaderOffset();
            window.addEventListener('resize', this._quizHeaderResizeHandler, { passive: true });
        }
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
        const cleanMsg = String(msg ?? '')
            .replace(/[🎉⚠️✅❌👁🔥✨🚀🏆📋👑⏰🔒🗑️]/gu, '')
            .replace(/!+(?=\s*$)/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        if (typeof this.showNetworkToast === 'function') {
            this.showNetworkToast(cleanMsg, type);
        } else {
            console.log(cleanMsg);
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
                    <div id="custom-confirm-copy-box" class="hidden p-3.5 rounded-2xl bg-gradient-to-r from-sky-950/80 via-slate-900 to-cyan-950/70 border border-cyan-500/40 shadow-inner">
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
                        <input id="custom-confirm-input" type="text" autocomplete="off" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-sky-400 focus:outline-none text-white text-xs sm:text-sm" placeholder="Nhập nội dung...">
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
                accent: 'h-1.5 w-full bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-400',
                iconWrap: 'w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-500/35 text-sky-400 flex items-center justify-center text-xl shrink-0 shadow-lg',
                badge: 'inline-block text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 mb-1',
                badgeText: 'Thông tin hệ thống',
                icon: 'fa-solid fa-circle-info',
                okBtn: 'btn-3d btn-3d-navy px-5 py-2.5 rounded-xl text-white font-heading font-extrabold text-xs sm:text-sm transition flex items-center gap-1.5 cursor-pointer'
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
        if (msgEl) msgEl.textContent = rawMsg.replace(/[🎉⚠️✅❌👁🔥✨🚀🏆📋👑⏰🔒🗑️]/gu, '').replace(/!+(?=\s*$)/g, '').trim();
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
                    inlineCopyBtn.classList.remove('is-copied-feedback');
                    inlineCopyBtn.innerHTML = '<i class="fa-regular fa-copy"></i><span>Copy IP</span>';
                    inlineCopyBtn.onclick = async () => {
                        const copied = await this.copyTextToClipboard(opts.copyValue);
                        if (copied) {
                            this.triggerCopyButtonFeedback(inlineCopyBtn, 'Đã chép!', 1500);
                            this.showToastNotification(`✅ Đã sao chép IP: ${opts.copyValue}`, 'success');
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
        const cleanMsg = raw.replace(/^(?:✅|⚠️|❌|🔒|✨|👑|⏰)\s*/, '').replace(/[🎉⚠️✅❌👁🔥✨🚀🏆📋👑⏰🔒🗑️]/gu, '').replace(/!+(?=\s*$)/g, '').replace(/\s{2,}/g, ' ').trim();
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
                icon = 'fa-solid fa-robot';
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

    ensureWorkspaceOverlay() {
        let overlay = document.getElementById('workspace-transition-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'workspace-transition-overlay';
            overlay.className = 'workspace-transition-overlay';
            overlay.setAttribute('aria-hidden', 'true');
            overlay.innerHTML = `
                <div class="workspace-transition-badge">
                    <span class="workspace-transition-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
                    <span id="workspace-transition-text" class="workspace-transition-text">Đang mở Control Center...</span>
                </div>
            `;
            document.body.appendChild(overlay);
        }
        return overlay;
    }

    initWorkspaceTransitions() {
        let shouldFadeInFromAdmin = false;
        try {
            if (sessionStorage.getItem('quiz_workspace_transition') === 'to-student') {
                sessionStorage.removeItem('quiz_workspace_transition');
                shouldFadeInFromAdmin = true;
            }
        } catch (e) {}

        if (shouldFadeInFromAdmin) {
            const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            const overlay = this.ensureWorkspaceOverlay();
            const textEl = document.getElementById('workspace-transition-text');
            if (textEl) textEl.textContent = 'Đang quay về Trang học sinh...';
            if (reduceMotion) {
                overlay.classList.remove('is-active');
                overlay.setAttribute('aria-hidden', 'true');
                document.body.classList.remove('workspace-entering', 'workspace-leaving');
            } else {
                overlay.classList.add('is-active');
                overlay.setAttribute('aria-hidden', 'false');
                document.body.classList.add('workspace-entering');
                void overlay.offsetWidth;
                window.requestAnimationFrame(() => {
                    overlay.classList.remove('is-active');
                    overlay.setAttribute('aria-hidden', 'true');
                });
                clearTimeout(this._workspaceEnterTimer);
                this._workspaceEnterTimer = setTimeout(() => {
                    document.body.classList.remove('workspace-entering');
                }, 380);
            }
        }

        if (!this._workspaceTransitionsBound) {
            this._workspaceTransitionsBound = true;
            window.addEventListener('pageshow', () => {
                this._navigatingWorkspace = false;
                clearTimeout(this._workspaceEnterTimer);
                const overlay = document.getElementById('workspace-transition-overlay');
                if (overlay) {
                    overlay.classList.remove('is-active');
                    overlay.setAttribute('aria-hidden', 'true');
                }
                document.body.classList.remove('workspace-leaving', 'workspace-entering');
            });

            document.querySelectorAll('a[href="admin.html"], #floating-admin-btn, #nav-admin-btn').forEach((link) => {
                link.addEventListener('click', (event) => {
                    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
                    if (link.getAttribute('target') === '_blank') return;
                    event.preventDefault();
                    this.navigateToAdminWithTransition(link.getAttribute('href') || 'admin.html');
                });
            });
        }
    }

    navigateToAdminWithTransition(targetUrl = 'admin.html') {
        if (this._navigatingWorkspace) return;
        this._navigatingWorkspace = true;
        try {
            sessionStorage.setItem('quiz_workspace_transition', 'to-admin');
        } catch (e) {}

        const overlay = this.ensureWorkspaceOverlay();
        const textEl = document.getElementById('workspace-transition-text');
        if (textEl) textEl.textContent = 'Đang mở Control Center...';
        overlay.classList.add('is-active');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('workspace-leaving');

        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const delay = reduceMotion ? 0 : 220;
        if (delay === 0) {
            window.location.href = targetUrl;
            return;
        }
        setTimeout(() => {
            window.location.href = targetUrl;
        }, delay);
    }

    updateSlidingTabIndicator(container, activeBtn, animate = true) {
        if (!container) return;
        container.classList.add('has-sliding-indicator');
        let indicator = container.querySelector(':scope > .sliding-tab-indicator');
        if (!indicator) {
            indicator = document.createElement('span');
            indicator.className = 'sliding-tab-indicator';
            indicator.setAttribute('aria-hidden', 'true');
            container.prepend(indicator);
        }
        if (!activeBtn) {
            indicator.style.opacity = '0';
            return;
        }

        const targetLeft = activeBtn.offsetParent === container
            ? activeBtn.offsetLeft
            : Math.round(activeBtn.getBoundingClientRect().left - container.getBoundingClientRect().left + container.scrollLeft);
        const targetWidth = activeBtn.offsetWidth;
        if (targetWidth <= 0) return;

        if (this._homeTabIndicatorRaf) {
            window.cancelAnimationFrame(this._homeTabIndicatorRaf);
            this._homeTabIndicatorRaf = null;
        }

        const prevRect = this._homeTabIndicatorRect;
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

        if (animate && !reduceMotion && prevRect && prevRect.width > 0) {
            indicator.style.transition = 'none';
            indicator.style.transform = `translateX(${prevRect.left}px)`;
            indicator.style.width = `${prevRect.width}px`;
            indicator.style.opacity = '1';
            void indicator.offsetWidth;
            indicator.style.transition = '';
            this._homeTabIndicatorRaf = window.requestAnimationFrame(() => {
                this._homeTabIndicatorRaf = null;
                indicator.style.transform = `translateX(${targetLeft}px)`;
                indicator.style.width = `${targetWidth}px`;
                indicator.style.opacity = '1';
                this._homeTabIndicatorRect = { left: targetLeft, width: targetWidth };
            });
        } else {
            indicator.style.transition = 'none';
            indicator.style.transform = `translateX(${targetLeft}px)`;
            indicator.style.width = `${targetWidth}px`;
            indicator.style.opacity = '1';
            void indicator.offsetWidth;
            indicator.style.transition = '';
            this._homeTabIndicatorRect = { left: targetLeft, width: targetWidth };
        }
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
            const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
            const paramToken = urlParams.get('token') || hashParams.get('token');
            const viewParam = (urlParams.get('view') || '').toLowerCase();
            if (viewParam === 'progress' || viewParam === 'parent' || viewParam === 'observer') {
                shouldOpenProgress = true;
            }
            if (paramToken && paramToken.trim()) {
                const cleanToken = paramToken.trim();
                this.userToken = cleanToken;
                hasUrlToken = true;
                // Xóa token trên thanh URL ngay để tránh lộ trong lịch sử/referrer; chỉ lưu sau khi xác thực thành công
                try {
                    const cleanUrl = window.location.pathname + (hashParams.has('token') ? '' : window.location.hash);
                    window.history.replaceState({}, document.title, cleanUrl);
                } catch (e) {}
            }
        } catch (e) {
            console.warn('[QuizApp] Lỗi đọc URL token:', e);
        }
        this._hasUrlToken = hasUrlToken;

        this.initWorkspaceTransitions();
        this.initTheme();
        this.showInAppBrowserBannerIfNeeded();
        this.initNetworkListeners();
        this.initEventListeners();
        this.loadRosterConfig().catch(() => {});
        this.updateSoundIcons();
        try { await this.fetchClientIp(); } catch (e) { console.warn(e); }
        try {
            if (window.dbService?.checkIsIpBanned && this.clientIp) {
                const banInfo = await window.dbService.checkIsIpBanned(this.clientIp);
                if (banInfo?.isBanned) {
                    this.showBlockedScreen(banInfo.reason);
                    return;
                }
            }
        } catch (e) {}
        try { await this.loadBannedIpsList(); } catch (e) { console.warn(e); }
        try { await this.loadDynamicSubjects(); } catch (e) { console.warn(e); }
        try { await this.loadRosterConfig(); } catch (e) { console.warn(e); }
        this.showForceRenameModalIfNeeded();
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
        this.applyNameInputRosterState();
        this.updateHomeScheduleAndFlashcardUI();
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
            const cached = this.safeStorageGet('quiz_dynamic_subjects');
            if (cached) {
                try { loaded = JSON.parse(cached); } catch (e) { }
            }
        }

        // Không tự tạo môn mẫu: chỉ hiển thị những môn Admin đã lưu trên Cloud.
        if (!Array.isArray(loaded)) loaded = [];

        this.dynamicSubjects = loaded;
        this.safeStorageSet('quiz_dynamic_subjects', JSON.stringify(loaded));
        console.debug('[QuizApp] Dynamic subjects loaded:', {
            online: navigator.onLine,
            cloudAvailable,
            currentSubject: this.currentSubject,
            subjects: loaded.map((subject) => ({ key: subject?.key, name: subject?.name, grade: this.getSubjectGrade(subject), visibility: subject?.visibility, count: subject?.count }))
        });

        this.renderHomeSubjects();
        this.populateSubjectDropdowns();
        this.applyNameInputRosterState();
        this.updateHomeScheduleAndFlashcardUI();
    }

    getSubjectGrade(subject) {
        const explicitGrade = String(subject?.grade || subject?.class || subject?.grade_level || '').match(/5|11/);
        if (explicitGrade) return explicitGrade[0];

        const source = `${subject?.key || ''} ${subject?.name || subject?.title || ''}`;
        const gradeMatch = source.match(/(?:^|[^0-9])(5|11)(?:$|[^0-9])/);
        // Môn không có metadata cũ được coi là Lớp 11 để hệ thống chỉ còn hai lớp cố định.
        return gradeMatch ? gradeMatch[1] : '11';
    }

    safeStorageGet(key, storage = 'local') {
        try {
            const store = storage === 'session' ? window.sessionStorage : window.localStorage;
            return store.getItem(String(key));
        } catch (e) {
            return null;
        }
    }

    safeStorageSet(key, value, storage = 'local') {
        try {
            const store = storage === 'session' ? window.sessionStorage : window.localStorage;
            store.setItem(String(key), String(value));
            return true;
        } catch (e) {
            return false;
        }
    }

    safeStorageRemove(key, storage = 'local') {
        try {
            const store = storage === 'session' ? window.sessionStorage : window.localStorage;
            store.removeItem(String(key));
        } catch (e) {}
    }

    getCurrentSubjectObj() {
        const key = String(this.currentSubject || '').trim().toLowerCase();
        return (this.dynamicSubjects || []).find((s) => String(s?.key || '').trim().toLowerCase() === key) || null;
    }

    hasAdminBypass() {
        return Boolean(this.isAdminAuthenticated || this.hasAdminIpAccess?.() || this.hasTokenRole?.('admin'));
    }

    async loadRosterConfig() {
        let config = null;
        try {
            if (window.dbService && typeof window.dbService.fetchRosterConfig === 'function') {
                config = await window.dbService.fetchRosterConfig();
            }
        } catch (e) { console.warn('[QuizApp] Roster config load failed:', e); }
        if (!config) {
            try { config = JSON.parse(localStorage.getItem('quiz_roster_config') || 'null'); } catch (e) { config = null; }
        }
        if (typeof window.normalizeRosterConfig === 'function') {
            try { config = window.normalizeRosterConfig(config || {}); } catch (e) {}
        }
        this.rosterConfig = config || { grade5: { enabled: false, students: [] }, grade11: { enabled: false, students: [] }, devicePins: {}, renameRequests: {} };
        this.applyNameInputRosterState();
        return this.rosterConfig;
    }

    getActiveRenameRequest() {
        if (this.hasAdminBypass()) return null;
        const machineCode = this.getOrCreateDeviceMachineCode();
        const req = this.rosterConfig?.renameRequests?.[machineCode];
        if (!req) return null;
        try {
            if (localStorage.getItem('quiz_rename_completed_at_' + machineCode) === String(req.requestedAt || '')) return null;
        } catch (e) {}
        return { machineCode, ...req };
    }

    showForceRenameModalIfNeeded() {
        const req = this.getActiveRenameRequest();
        if (!req) return false;
        if (document.getElementById('modal-force-rename')) return true;
        const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
        const otherPinnedSet = new Set(Object.entries(this.rosterConfig?.devicePins || {}).filter(([code]) => String(code).toUpperCase() !== String(req.machineCode).toUpperCase()).map(([, name]) => fold(name)));
        const grade = this.getSubjectGrade(this.getCurrentSubjectObj());
        const preferred = grade === '5' ? this.rosterConfig?.grade5?.students : this.rosterConfig?.grade11?.students;
        const allStudents = [...(Array.isArray(preferred) ? preferred : []), ...(Array.isArray(this.rosterConfig?.grade5?.students) ? this.rosterConfig.grade5.students : []), ...(Array.isArray(this.rosterConfig?.grade11?.students) ? this.rosterConfig.grade11.students : [])]
            .map((student) => typeof student === 'string' ? student : student?.name).map((name) => String(name || '').trim()).filter(Boolean).filter((name, index, list) => list.findIndex((item) => fold(item) === fold(name)) === index);
        const hasRoster = allStudents.length > 0;
        const overlay = document.createElement('div');
        overlay.id = 'modal-force-rename';
        overlay.className = 'fixed inset-0 z-[210000] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4';
        overlay.innerHTML = `<div class="w-full max-w-lg rounded-3xl border border-amber-400/30 bg-slate-900 p-6 shadow-2xl" role="dialog" aria-modal="true"><h2 class="text-xl font-bold text-amber-300">Yêu cầu nhập lại Họ và Tên thật</h2><p class="mt-3 text-sm text-slate-300">${this.escapeHtml(req.reason || 'Tên hiện tại không được chấp nhận.')} </p><p class="mt-2 text-xs text-slate-400">Tên cũ bị từ chối: <b class="text-slate-200">${this.escapeHtml(req.oldName || 'Không rõ')}</b></p><div class="mt-5">${hasRoster ? '<input id="force-rename-search" class="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2.5 text-sm text-slate-100" placeholder="Tìm tên trong danh sách lớp..."><div id="force-rename-options" class="mt-2 max-h-64 overflow-y-auto space-y-2"></div>' : '<input id="force-rename-input" maxlength="40" class="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2.5 text-sm text-slate-100" placeholder="Nhập Họ và Tên thật của bạn...">'}<p id="force-rename-error" class="mt-2 min-h-5 text-xs text-rose-300"></p></div><button id="force-rename-confirm" type="button" class="mt-5 w-full rounded-xl bg-amber-400 px-4 py-3 font-bold text-slate-950 hover:bg-amber-300">Xác nhận tên thật</button></div>`;
        document.body.appendChild(overlay);
        const confirm = overlay.querySelector('#force-rename-confirm');
        const errorEl = overlay.querySelector('#force-rename-error');
        let selectedName = '';
        const renderOptions = () => {
            const needle = fold(overlay.querySelector('#force-rename-search')?.value);
            const options = overlay.querySelector('#force-rename-options');
            if (!options) return;
            options.innerHTML = allStudents.filter((name) => fold(name).includes(needle)).map((name) => {
                const taken = otherPinnedSet.has(fold(name));
                return `<button type="button" data-force-name="${this.escapeHtml(name)}" ${taken ? 'disabled' : ''} class="w-full rounded-xl border border-slate-700 px-3 py-2 text-left text-sm ${taken ? 'cursor-not-allowed opacity-50' : 'hover:border-amber-300 hover:bg-slate-800'}">${this.escapeHtml(name)}${taken ? ' <span class="text-xs text-rose-300">Đã có máy khác nhận</span>' : ''}</button>`;
            }).join('');
            options.querySelectorAll('[data-force-name]:not(:disabled)').forEach((button) => button.addEventListener('click', () => { selectedName = button.dataset.forceName || ''; options.querySelectorAll('[data-force-name]').forEach((item) => item.classList.remove('ring-2', 'ring-amber-300')); button.classList.add('ring-2', 'ring-amber-300'); }));
        };
        overlay.querySelector('#force-rename-search')?.addEventListener('input', renderOptions);
        renderOptions();
        confirm.addEventListener('click', async () => {
            let finalName = hasRoster ? selectedName : overlay.querySelector('#force-rename-input')?.value || '';
            const check = this.validateStudentNameInput(finalName);
            const sameOld = fold(finalName) === fold(req.oldName);
            const taken = otherPinnedSet.has(fold(finalName));
            if (!check.valid || sameOld || taken || (hasRoster && !selectedName)) {
                errorEl && (errorEl.textContent = taken ? 'Tên này đã thuộc thiết bị khác, vui lòng nhập đúng tên thật của bạn' : (sameOld ? 'Vui lòng nhập tên thật khác với tên cũ bị từ chối.' : (check.reason || 'Vui lòng chọn tên hợp lệ trong danh sách lớp.')));
                return;
            }
            finalName = check.normalized;
            confirm.disabled = true;
            try { await window.dbService?.renameDeviceHistory?.(req.machineCode, finalName); } catch (e) { console.warn('[QuizApp] Rename history failed:', e); }
            try { localStorage.setItem('quiz_user_name', finalName); localStorage.setItem('quiz_rename_completed_at_' + req.machineCode, String(req.requestedAt || 'done')); } catch (e) {}
            this.playerName = finalName; this._draftPlayerName = finalName; this.isPlayerNameCommitted = true;
            const input = document.getElementById('player-name-input'); if (input) input.value = finalName;
            overlay.remove();
            this.showToastNotification('Đã cập nhật tên thật thành công.', 'success');
        });
        return true;
    }

    getRosterGradeConfig() {
        const grade = this.getSubjectGrade(this.getCurrentSubjectObj());
        const config = this.rosterConfig || {};
        return { grade, gradeRoster: grade === '5' ? (config.grade5 || {}) : (config.grade11 || {}) };
    }

    normalizeRosterSearch(value) {
        return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    renderRosterSuggestions() {
        const dropdown = document.getElementById('player-name-roster-dropdown');
        const input = document.getElementById('player-name-input');
        if (!dropdown || !input || this.isOutsideGuestMode) return;
        const { gradeRoster } = this.getRosterGradeConfig();
        if (!gradeRoster?.enabled) { dropdown.classList.add('hidden'); return; }
        const needle = this.normalizeRosterSearch(input.value);
        const students = Array.isArray(gradeRoster.students) ? gradeRoster.students : [];
        const matches = students.filter((s) => this.normalizeRosterSearch(typeof s === 'string' ? s : s?.name).includes(needle)).slice(0, 12);
        dropdown.innerHTML = matches.map((s) => {
            const name = typeof s === 'string' ? s : s?.name;
            return `<button type="button" data-roster-name="${this.escapeHtml(name)}" class="block w-full text-left px-3 py-2 text-sm hover:bg-slate-800 rounded-lg">${this.escapeHtml(name)}</button>`;
        }).join('');
        dropdown.classList.toggle('hidden', matches.length === 0);
        dropdown.querySelectorAll('[data-roster-name]').forEach((el) => el.addEventListener('click', () => {
            input.value = el.dataset.rosterName || '';
            this.playerName = input.value;
            dropdown.classList.add('hidden');
            this.clearPlayerNameError();
        }));
    }

    applyNameInputRosterState() {
        const input = document.getElementById('player-name-input');
        if (!input) return;
        const badge = document.getElementById('player-name-pinned-badge');
        const dropdown = document.getElementById('player-name-roster-dropdown');
        const toggleWrap = document.getElementById('player-name-guest-toggle-wrap');
        const toggle = document.getElementById('btn-toggle-outside-guest');
        const { gradeRoster } = this.getRosterGradeConfig();
        let machineCode = '';
        try { machineCode = this.getOrCreateDeviceMachineCode().toUpperCase(); } catch (e) {}
        const pinned = this.rosterConfig?.devicePins?.[machineCode];
        if (pinned) {
            input.value = pinned; input.readOnly = true; this.pinnedDeviceName = pinned; this.playerName = pinned; this.isPlayerNameCommitted = true; this.isOutsideGuestMode = false;
            badge?.classList.remove('hidden'); dropdown?.classList.add('hidden'); toggleWrap?.classList.add('hidden');
            return;
        }
        input.readOnly = false; this.pinnedDeviceName = ''; badge?.classList.add('hidden');
        if (this.hasAdminBypass()) {
            dropdown?.classList.add('hidden');
            toggleWrap?.classList.add('hidden');
            input.placeholder = 'Admin (Không cần nhập tên — bấm Bắt Đầu ngay)';
            return;
        }
        const sub = this.getCurrentSubjectObj();
        const canGuest = Boolean(gradeRoster?.allowGuestsInPractice) && String(sub?.mode || 'practice').toLowerCase() !== 'exam';
        toggleWrap?.classList.toggle('hidden', !canGuest);
        if (!canGuest) this.isOutsideGuestMode = false;
        if (!gradeRoster?.enabled) {
            dropdown?.classList.add('hidden'); input.placeholder = 'Nhập đầy đủ Họ và Tên thật của bạn...';
        } else if (this.isOutsideGuestMode && canGuest) {
            if (toggle) toggle.textContent = '← Chọn lại từ Danh sách lớp';
            input.placeholder = 'Nhập Họ và Tên thật (Ôn tự do ngoài lớp)'; dropdown?.classList.add('hidden');
        } else {
            if (toggle) toggle.textContent = 'Tôi không có trong danh sách (Ôn tự do)';
            input.placeholder = 'Gõ 2–3 chữ để tìm & chọn tên trong danh sách lớp';
            this.renderRosterSuggestions();
        }
    }

    getServerNowMs() { return Date.now() + Number(window.dbService?.serverClockOffsetMs || 0); }

    getSubjectScheduleState(sub, now = this.getServerNowMs()) {
        if (typeof window.getSubjectScheduleState === 'function') {
            const s = window.getSubjectScheduleState(sub, now) || {};
            return {
                ...s,
                openMs: s.openMs ?? s.openAt ?? null,
                closeMs: s.closeMs ?? s.closeAt ?? null
            };
        }
        const openMs = sub?.openAt ? Date.parse(sub.openAt) : null;
        const closeMs = sub?.closeAt ? Date.parse(sub.closeAt) : null;
        const validOpen = openMs && !Number.isNaN(openMs) ? openMs : null;
        const validClose = closeMs && !Number.isNaN(closeMs) ? closeMs : null;
        if (validOpen && now < validOpen) return { status: 'upcoming', openMs: validOpen, closeMs: validClose, remainingOpenMs: validOpen - now, remainingCloseMs: validClose ? Math.max(0, validClose - now) : 0 };
        if (validClose && now > validClose) return { status: 'closed', openMs: validOpen, closeMs: validClose, remainingOpenMs: 0, remainingCloseMs: 0 };
        return { status: 'open', openMs: validOpen, closeMs: validClose, remainingOpenMs: 0, remainingCloseMs: validClose ? Math.max(0, validClose - now) : 0 };
    }

    getSubjectAttemptStorageKey(subjectKey = this.currentSubject, rawName = '') {
        const subKey = String(subjectKey || 'default').trim().toLowerCase() || 'default';
        const fallbackName = this.pinnedDeviceName || this.playerName || this._draftPlayerName || document.getElementById('player-name-input')?.value || localStorage.getItem('quiz_user_name') || '';
        const namePart = this.normalizeRosterSearch(rawName || fallbackName).replace(/[^a-z0-9]+/g, '_') || '_device';
        return `quiz_subject_attempts_${subKey}_${namePart}`;
    }

    getSubjectAttemptCount(sub, rawName = '') {
        if (!sub) return 0;
        const key = this.getSubjectAttemptStorageKey(sub.key || this.currentSubject, rawName);
        try { return Math.max(0, parseInt(localStorage.getItem(key) || '0', 10) || 0); } catch (e) { return 0; }
    }

    updateHomeScheduleAndFlashcardUI() {
        const sub = this.getCurrentSubjectObj();
        const start = document.getElementById('btn-start-quiz');
        const banner = document.getElementById('home-schedule-banner');
        if (!sub) return;
        const sched = this.getSubjectScheduleState(sub);
        const bypass = this.hasAdminBypass();
        const used = this.getSubjectAttemptCount(sub);
        const max = Number(sub?.maxAttempts || 0);
        let msg = '';
        let tone = 'rose';
        if (sched.status === 'upcoming' && !bypass && sched.openMs) {
            tone = 'amber';
            msg = `⏳ Đề sẽ mở lúc ${new Date(sched.openMs).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${new Date(sched.openMs).toLocaleDateString('vi-VN')} (còn ${this.formatScheduleCountdown(sched.openMs - this.getServerNowMs())})`;
        } else if (sched.status === 'closed' && !bypass && sched.closeMs) {
            msg = `🔒 Đề đã đóng lúc ${new Date(sched.closeMs).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${new Date(sched.closeMs).toLocaleDateString('vi-VN')}`;
        } else if (max > 0 && used >= max && !bypass) {
            msg = `🚫 Đã hết lượt nộp (${used}/${max} lượt)`;
        }
        if (start) start.disabled = Boolean(msg);
        if (banner) {
            banner.textContent = msg;
            banner.classList.toggle('hidden', !msg);
            banner.classList.toggle('bg-amber-500/15', Boolean(msg) && tone === 'amber');
            banner.classList.toggle('border-amber-500/40', Boolean(msg) && tone === 'amber');
            banner.classList.toggle('text-amber-300', Boolean(msg) && tone === 'amber');
            banner.classList.toggle('bg-rose-500/15', Boolean(msg) && tone !== 'amber');
            banner.classList.toggle('border-rose-500/40', Boolean(msg) && tone !== 'amber');
            banner.classList.toggle('text-rose-300', Boolean(msg) && tone !== 'amber');
        }
        clearInterval(this.homeScheduleInterval);
        if (document.getElementById('screen-home') && !document.getElementById('screen-home').classList.contains('hidden') && (sched.status === 'upcoming' || (sched.status === 'open' && sched.closeMs))) {
            this.homeScheduleInterval = setInterval(() => this.updateHomeScheduleAndFlashcardUI(), 1000);
        }
    }

    formatScheduleCountdown(ms) {
        const sec = Math.max(0, Math.floor(Number(ms || 0) / 1000)); const d = Math.floor(sec / 86400); const h = Math.floor(sec % 86400 / 3600); const m = Math.floor(sec % 3600 / 60); const s = sec % 60;
        return `${d ? `${d} ngày ` : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    /* ============================================================== */
    /* 1.1 PHÂN QUYỀN KẾT HỢP TOKEN & IP (TOKEN-BASED AUTH)            */
    /* ============================================================== */

    hasTokenRole(role) {
        if (this.localTestIpOverride) return false;
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

    getOrCreateClientSessionId() {
        if (this.clientSessionId) return this.clientSessionId;
        try {
            const existing = sessionStorage.getItem('quiz_client_session_id');
            if (existing) {
                this.clientSessionId = existing;
                return existing;
            }
        } catch (e) {}
        const generated = (window.dbService && typeof window.dbService.generateUUID === 'function')
            ? window.dbService.generateUUID()
            : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        this.clientSessionId = generated;
        try { sessionStorage.setItem('quiz_client_session_id', generated); } catch (e) {}
        return generated;
    }

    getOrCreateDeviceMachineCode() {
        let code = '';
        try {
            code = localStorage.getItem('quiz_device_machine_code') || '';
        } catch (e) {}

        if (!/^QM-[A-Z0-9]{4,}$/i.test(code)) {
            try {
                const cookie = document.cookie.split(';').map(item => item.trim()).find(item => item.startsWith('quiz_device_machine_code='));
                const cookieCode = cookie ? decodeURIComponent(cookie.slice('quiz_device_machine_code='.length)) : '';
                if (/^QM-[A-Z0-9]{4,}$/i.test(cookieCode)) code = cookieCode;
            } catch (e) {}
        }

        if (!/^QM-[A-Z0-9]{4,}$/i.test(code)) {
            const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
            let randomPart = '';
            for (let i = 0; i < 6; i++) {
                randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            code = `QM-${randomPart}`;
        }
        try { localStorage.setItem('quiz_device_machine_code', code); } catch (e) {}
        try { document.cookie = 'quiz_device_machine_code=' + encodeURIComponent(code) + '; max-age=31536000; path=/; SameSite=Lax'; } catch (e) {}
        this.deviceMachineCode = code;
        return code;
    }

    detectInAppBrowser() {
        const userAgent = String(navigator.userAgent || '');
        if (/Zalo/i.test(userAgent)) return 'Zalo';
        if (/FBAN\/Messenger|MessengerForiOS|FB_IAB.*Messenger/i.test(userAgent)) return 'Messenger';
        if (/FBAN|FBAV|FB_IAB/i.test(userAgent)) return 'Facebook';
        if (/Instagram/i.test(userAgent)) return 'Instagram';
        if (/\bLine\//i.test(userAgent)) return 'Line';
        return '';
    }

    showInAppBrowserBannerIfNeeded() {
        const appName = this.detectInAppBrowser();
        if (!appName || sessionStorage.getItem('quiz_dismiss_inapp_banner') === '1') return;
        if (document.getElementById('inapp-browser-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'inapp-browser-banner';
        banner.className = 'mx-auto max-w-6xl px-4 pt-3';
        banner.innerHTML = `
            <div class="rounded-2xl border border-amber-400/30 bg-slate-900/95 px-4 py-3 text-sm text-slate-100 shadow-lg shadow-amber-950/20 sm:flex sm:items-center sm:gap-4">
                <div class="min-w-0 flex-1"><p class="font-semibold text-amber-200">Bạn đang mở bằng trình duyệt của ${appName}</p><p class="mt-1 text-xs leading-relaxed text-slate-300">Hãy bấm biểu tượng <b>⋯</b> (góc trên/dưới) → chọn <b class="text-sky-300">Mở bằng Safari / Chrome</b> để giữ nguyên lịch sử bài làm và không bị đổi mã máy.</p></div>
                <div class="mt-3 flex shrink-0 gap-2 sm:mt-0"><button type="button" data-inapp-copy class="rounded-xl border border-sky-400/40 bg-sky-500/15 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/25">Sao chép link</button><button type="button" data-inapp-dismiss aria-label="Đóng" class="rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-lg leading-none text-slate-300 hover:bg-slate-700">×</button></div>
            </div>`;
        const header = document.getElementById('main-header');
        if (header?.parentNode) header.parentNode.insertBefore(banner, header);
        else document.body.insertBefore(banner, document.body.firstChild);
        banner.querySelector('[data-inapp-copy]')?.addEventListener('click', async () => {
            const copied = await this.copyTextToClipboard(window.location.href);
            this.showToastNotification(copied ? 'Đã sao chép link.' : 'Không thể sao chép link.', copied ? 'success' : 'error');
        });
        banner.querySelector('[data-inapp-dismiss]')?.addEventListener('click', () => {
            try { sessionStorage.setItem('quiz_dismiss_inapp_banner', '1'); } catch (e) {}
            banner.remove();
        });
    }

    getCombinedDeviceKey() {
        const code = this.getOrCreateDeviceMachineCode();
        const ip = (this.clientIp && !this.clientIp.startsWith('Đang') && this.clientIp !== 'Chưa xác định') 
            ? this.clientIp.trim() 
            : '';
        return ip ? `${ip}-${code}` : code;
    }

    async copyCombinedAuthCode(btnEl = null) {
        if (!this.clientIp || this.clientIp.startsWith('Đang') || this.clientIp === 'Chưa xác định') {
            try { await this.fetchClientIp(); } catch (e) {}
        }
        const combinedKey = this.getCombinedDeviceKey();
        const copied = await this.copyTextToClipboard(combinedKey);
        if (copied) {
            if (btnEl) this.triggerCopyButtonFeedback(btnEl, 'Đã chép', 1500);
            this.showToastNotification(`Đã sao chép IP và Mã máy: ${combinedKey}`, 'success');
        } else {
            this.showToastNotification(`Mã thiết bị của bạn: ${combinedKey}`, 'info');
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
            if (this.localTestIpOverride) {
                console.debug('[QuizApp] Local test mode: bỏ qua xác thực token/Admin cloud.');
            } else {
            if (window.dbService && typeof window.dbService.verifyAccessToken === 'function') {
                // Ưu tiên số 1: Kiểm tra theo chuỗi kết hợp IP-QM-...
                if (combinedKey) {
                    matched = await window.dbService.verifyAccessToken(combinedKey, this.clientIp);
                }
                // Ưu tiên số 2: Kiểm tra theo mã máy QM-... đơn lẻ
                if (!matched && this.deviceMachineCode) {
                    matched = await window.dbService.verifyAccessToken(this.deviceMachineCode, this.clientIp);
                }
                // Ưu tiên số 3: Kiểm tra token nhập tay / link
                if (!matched && this.userToken) {
                    matched = await window.dbService.verifyAccessToken(this.userToken, this.clientIp);
                }
                // Ưu tiên số 4: Dự phòng theo IP của thiết bị hiện tại (cho các cấp quyền chỉ dùng IP)
                if (!matched && this.clientIp && !this.clientIp.startsWith('Đang') && this.clientIp !== 'Chưa xác định') {
                    matched = await window.dbService.verifyAccessToken('', this.clientIp);
                }
            }
            }
        } catch (e) {
            console.warn('[QuizApp] Không thể xác thực token qua Cloud:', e);
        }

        if (matched) {
            const hadPermissionBefore = Boolean(this.tokenInfo);
            this.tokenInfo = matched;
            try {
                if (this.userToken) localStorage.setItem('quiz_access_token', this.userToken);
                localStorage.setItem('quiz_token_info', JSON.stringify(matched));
            } catch (e) {}

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
            this.populateSubjectDropdowns();

            // Không tự động chuyển màn hình; người dùng sẽ bấm nút [👁 Xem Tiến Trình] khi cần

            return matched;
        } else {
            this.isInitialValidated = true;
            if (window.dbService?.isSupabaseActive) {
                this.tokenInfo = null;
                this.userToken = '';
                try {
                    localStorage.removeItem('quiz_access_token');
                    localStorage.removeItem('quiz_token_info');
                    localStorage.removeItem('quiz_cached_access_tokens');
                    if (!this.hasAdminIpAccess()) {
                        localStorage.removeItem('quiz_admin_token');
                        localStorage.removeItem('quiz_is_admin');
                        localStorage.removeItem('quiz_admin_authenticated');
                        this.isAdminAuthenticated = false;
                    }
                } catch (e) {}
                this.updateTokenStatusUi();
                this.populateSubjectDropdowns();
                if (showToastOnSuccess) {
                    this.showToastNotification(`⚠️ Mã ${combinedKey} chưa được Admin duyệt. Hãy gửi mã này cho Admin.`, 'error');
                }
            } else {
                this.tokenInfo = this.getCachedTokenInfo();
                this.updateTokenStatusUi();
                this.populateSubjectDropdowns();
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
            floatObsBtn.classList.toggle('flex', canViewProgress);
        }
        const headerParentBtn = document.getElementById('header-parent-monitor-btn');
        if (headerParentBtn) {
            headerParentBtn.classList.toggle('hidden', !canViewProgress);
            headerParentBtn.classList.toggle('flex', canViewProgress);
        }

        if (badge) {
            if (isAdmin) {
                badge.className = "text-[11px] font-bold px-2.5 py-1 rounded-xl bg-sky-500/20 text-sky-300 border border-sky-500/30";
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
        if (typeof this.applyNameInputRosterState === 'function') {
            this.applyNameInputRosterState();
        }

        const box = document.getElementById('token-active-status-box');
        const nameEl = document.getElementById('token-user-name');
        const codeEl = document.getElementById('token-code-display');
        const badgesEl = document.getElementById('token-roles-badges');
        const inputField = document.getElementById('token-input-field');
        const combinedDisplay = document.getElementById('modal-combined-code-display');
        if (combinedDisplay) {
            combinedDisplay.textContent = this.getCombinedDeviceKey();
        }

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
                    html += '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/25 text-blue-300 border border-blue-500/40">✓ Trợ lý AI</span>';
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
        if (!this.clientIp || this.clientIp.startsWith('Đang') || this.clientIp === 'Chưa xác định') {
            this.fetchClientIp().then(() => this.updateTokenStatusUi()).catch(() => {});
        }
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
        if (this.localTestIpOverride) return false;
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

    hasGrade5OnlyAccess() {
        if (this.localTestIpOverride || this.isAdminAuthenticated || this.hasAdminIpAccess() || this.hasTokenRole('admin')) {
            return false;
        }
        return this.canViewGrade5();
    }

    isSubjectAccessibleToCurrentUser(subjectOrKey) {
        if (!this.hasGrade5OnlyAccess()) return true;
        const rawKey = typeof subjectOrKey === 'object'
            ? (subjectOrKey?.key || subjectOrKey?.subject_key)
            : subjectOrKey;
        const targetNorm = String(rawKey || '').trim().toLowerCase();
        const subject = typeof subjectOrKey === 'object'
            ? subjectOrKey
            : (this.dynamicSubjects || []).find((item) => String(item?.key || item?.subject_key || '').trim().toLowerCase() === targetNorm);
        return Boolean(subject) && this.getSubjectGrade(subject) === '5';
    }

    getHomeGradeFilter() {
        const canViewGrade5 = this.canViewGrade5();
        const grade5Only = this.hasGrade5OnlyAccess();
        if (grade5Only && this.homeGradeFilter === '11') this.homeGradeFilter = canViewGrade5 ? '5' : 'all';
        if (!canViewGrade5 && this.homeGradeFilter === '5') this.homeGradeFilter = 'all';
        const availableGrades = grade5Only
            ? (canViewGrade5 ? ['all', '5'] : ['all'])
            : (canViewGrade5 ? ['all', '5', '11'] : ['all', '11']);
        return availableGrades.includes(this.homeGradeFilter) ? this.homeGradeFilter : 'all';
    }

    isIpOnlyTokenRecord(tokenRecord, normalizedIp = '') {
        if (!tokenRecord) return false;
        const ip = String(normalizedIp || (typeof tokenRecord.ip === 'object' ? tokenRecord.ip?.ip : tokenRecord.ip) || '')
            .trim().replace(/^\[|\]$/g, '').toLowerCase();
        const rawCodeNorm = String(tokenRecord.rawCode || '').trim().toLowerCase();
        const tokenNorm = String(tokenRecord.token || '').trim().toLowerCase();
        return (!rawCodeNorm || (ip && rawCodeNorm === ip)) && (!tokenNorm || (ip && tokenNorm === ip));
    }

    getMatchedAllowedSubjects() {
        if (this.isAdminAuthenticated || this.hasAdminIpAccess()) return null;
        const normalizeIp = (ip) => String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
        const currentIp = normalizeIp(this.clientIp);
        const tokens = Array.isArray(this.accessTokens) ? this.accessTokens : [];

        let matched = null;
        if (this.tokenInfo && this.tokenInfo.token) {
            matched = tokens.find(t => String(t.token || '').toUpperCase() === String(this.tokenInfo.token || '').toUpperCase()) || this.tokenInfo;
        }
        if (!matched && currentIp && !currentIp.startsWith('đang') && currentIp !== 'chưa xác định') {
            matched = tokens.find(t => t.ip && normalizeIp(t.ip) === currentIp && this.isIpOnlyTokenRecord(t, currentIp)) || null;
        }
        if (!matched) {
            const cached = this.getCachedTokenInfo();
            if (cached && Array.isArray(cached.allowedSubjects) && cached.allowedSubjects.length > 0) {
                matched = cached;
            }
        }
        const list = Array.isArray(matched?.allowedSubjects) ? matched.allowedSubjects.map(k => String(k || '').trim().toLowerCase()).filter(Boolean) : [];
        return list.length > 0 ? new Set(list) : null;
    }

    getHomeVisibleSubjects() {
        const assignedSet = this.getMatchedAllowedSubjects();
        const canViewGrade5 = this.canViewGrade5();
        const grade5Only = this.hasGrade5OnlyAccess();
        const currentIp = String(this.clientIp || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
        const normalizedGeoIps = new Set((this.allowedGeoIps || []).map(ip => String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase()).filter(Boolean));
        const canViewPrivateByIp = Boolean(currentIp) && normalizedGeoIps.has(currentIp);
        const allowedSubjects = (this.dynamicSubjects || []).filter((sub) => {
            const subKey = String(sub.key || sub.subject_key || '').trim().toLowerCase();
            if (assignedSet) {
                return assignedSet.has(subKey) && (!grade5Only || this.getSubjectGrade(sub) === '5');
            }
            const grade = this.getSubjectGrade(sub);
            const canViewGrade = grade === '5'
                ? canViewGrade5
                : grade === '11' && !grade5Only;
            const visibility = String(sub.visibility || '').toUpperCase();
            const isPrivate = visibility === 'PRIVATE' || visibility === 'HIDDEN' || sub.is_public === false;
            const canViewPrivate = this.isAdminAuthenticated || this.hasAdminIpAccess() || canViewPrivateByIp || (grade === '5' && canViewGrade5);
            return canViewGrade && (!isPrivate || canViewPrivate);
        });
        console.debug('[QuizApp] Visible subject decision:', {
            currentIp,
            canViewGrade5,
            grade5Only,
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
                    this.accessTokens = tokens;
                    tokens.forEach(t => {
                        const r = String(t.role || '').toLowerCase();
                        if ((r === 'grade5' || r === 'all' || r === 'class5') && t.ip) {
                            const cleanIp = String(t.ip).trim().toLowerCase();
                            if (cleanIp && this.isIpOnlyTokenRecord(t, cleanIp) && !this.class5AllowedIps.includes(cleanIp)) {
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
        this.populateSubjectDropdowns();
    }

    getSubjectFolderInfo(sub) {
        const grade = this.getSubjectGrade(sub);
        const explicitFolder = String(sub?.folder || sub?.group || '').trim();
        if (explicitFolder) {
            return {
                folderKey: `${grade}::${explicitFolder.toLowerCase()}`,
                folderLabel: explicitFolder
            };
        }
        const rawName = String(sub?.name || sub?.title || sub?.key || '').trim();
        const m = rawName.match(/^(.+?)(?:\s*[-–—:|]\s*|\s+)(?:đề|bài|chuyên\s*đề|test|tập|phần)\s*(?:số\s*)?(?:\d+|[ivx]+)\b.*$/i);
        if (!m) return null;
        const base = m[1].trim();
        if (!base || base.length < 2) return null;
        const cleanBase = base.replace(/^môn\s+/i, '').trim();
        const titleBase = cleanBase.charAt(0).toUpperCase() + cleanBase.slice(1);
        const folderLabel = /^môn\s+/i.test(base) ? titleBase : `Môn ${titleBase}`;
        return {
            folderKey: `${grade}::${cleanBase.toLowerCase()}`,
            folderLabel
        };
    }

    renderHomeSubjects() {
        const grid = document.getElementById('home-subjects-grid');
        if (!grid) return;

        const visibleSubjects = this.getHomeVisibleSubjects();
        const activeGrade = this.getHomeGradeFilter();
        const tabs = document.getElementById('home-semester-tabs');
        if (tabs) {
            const assignedSet = this.getMatchedAllowedSubjects();
            const currentIp = String(this.clientIp || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
            const normalizedGeoIps = new Set((this.allowedGeoIps || []).map(ip => String(typeof ip === 'object' ? ip?.ip : ip || '').trim().replace(/^\[|\]$/g, '').toLowerCase()).filter(Boolean));
            const canViewPrivateByIp = Boolean(currentIp) && normalizedGeoIps.has(currentIp);
            const canViewPrivateG11 = this.isAdminAuthenticated || this.hasAdminIpAccess() || canViewPrivateByIp;
            const canViewGrade5 = this.canViewGrade5() || (assignedSet && (this.dynamicSubjects || []).some(s => assignedSet.has(String(s.key || s.subject_key || '').trim().toLowerCase()) && this.getSubjectGrade(s) === '5'));
            const hasG11 = !this.hasGrade5OnlyAccess() && (this.dynamicSubjects || []).some(s => {
                if (this.getSubjectGrade(s) !== '11') return false;
                const subKey = String(s.key || s.subject_key || '').trim().toLowerCase();
                if (assignedSet) return assignedSet.has(subKey);
                const visibility = String(s.visibility || '').toUpperCase();
                const isPrivate = visibility === 'PRIVATE' || visibility === 'HIDDEN' || s.is_public === false;
                return !isPrivate || canViewPrivateG11;
            });
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
                    this.homeOpenFolder = null;
                    this.renderHomeSubjects();
                });
            });
            this.updateSlidingTabIndicator(tabs, tabs.querySelector('.home-grade-tab.is-active'));
            if (!this._homeTabResizeBound) {
                this._homeTabResizeBound = true;
                window.addEventListener('resize', () => {
                    const currentTabs = document.getElementById('home-semester-tabs');
                    const currentActive = currentTabs?.querySelector('.home-grade-tab.is-active');
                    if (currentTabs && currentActive) {
                        this.updateSlidingTabIndicator(currentTabs, currentActive, false);
                    }
                }, { passive: true });
            }
        }

        // Nếu môn đang chọn hiện tại bị ẩn, tự động chuyển sang môn công khai đầu tiên
        const currentSubjNorm = String(this.currentSubject || '').trim().toLowerCase();
        if (visibleSubjects.length > 0 && !visibleSubjects.some(s => String(s.key || '').trim().toLowerCase() === currentSubjNorm)) {
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

        // Gom nhóm các đề cùng môn (VD: toán đề 1..4 -> thư mục "Môn Toán") nếu có >= 2 đề
        const folderMap = new Map();
        visibleSubjects.forEach((sub) => {
            const info = this.getSubjectFolderInfo(sub);
            if (!info) return;
            if (!folderMap.has(info.folderKey)) {
                folderMap.set(info.folderKey, { key: info.folderKey, label: info.folderLabel, items: [] });
            }
            folderMap.get(info.folderKey).items.push(sub);
        });
        const activeFolders = new Map();
        folderMap.forEach((group, key) => {
            if (group.items.length >= 2) activeFolders.set(key, group);
        });
        if (this.homeOpenFolder && !activeFolders.has(this.homeOpenFolder)) {
            this.homeOpenFolder = null;
        }

        const fragment = document.createDocumentFragment();
        this._subjectCountCache = this._subjectCountCache || {};
        let vtTargetApplied = false;
        const currentSubjForVt = String(this.currentSubject || '').trim().toLowerCase();
        const renderSubjectCard = (sub) => {
            const subKeyNorm = String(sub.key || '').trim().toLowerCase();
            const isSelected = Boolean(currentSubjForVt) && subKeyNorm === currentSubjForVt && this.currentSubject === sub.key;
            const applyVt = isSelected && !vtTargetApplied;
            if (applyVt) vtTargetApplied = true;
            const subName = sub.name || sub.title || sub.key || 'Môn học';
            const schedule = this.getSubjectScheduleState(sub);
            const scheduleBadge = schedule.status === 'upcoming' && schedule.openMs ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">Sắp mở ${new Date(schedule.openMs).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${new Date(schedule.openMs).toLocaleDateString('vi-VN')}</span>` : (schedule.status === 'closed' ? '<span class="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30">Đã đóng</span>' : '');
            const subCount = Number(sub.count) || 0;
            const cacheKey = `sub:${sub.key}`;
            const prevSubCount = Object.prototype.hasOwnProperty.call(this._subjectCountCache, cacheKey)
                ? this._subjectCountCache[cacheKey]
                : 0;
            this._subjectCountCache[cacheKey] = subCount;
            const card = document.createElement('button');
            card.type = 'button';

            let grad = sub.gradient || 'indigo';
            let iconColorClass = "bg-sky-600/30 text-sky-300 border-sky-500/30";
            if (grad === 'purple') iconColorClass = "bg-blue-600/30 text-blue-300 border-blue-500/30";
            else if (grad === 'emerald') iconColorClass = "bg-emerald-600/30 text-emerald-300 border-emerald-500/30";
            else if (grad === 'rose') iconColorClass = "bg-rose-600/30 text-rose-300 border-rose-500/30";
            else if (grad === 'amber') iconColorClass = "bg-amber-600/30 text-amber-300 border-amber-500/30";

            card.dataset.subjectCard = sub.key;
            card.className = `p-3.5 rounded-2xl text-left flex flex-col justify-between cursor-pointer subject-card-interactive transition-all relative min-h-[118px] ${isSelected ? 'selected-' + grad : 'hover:border-slate-600'}`;
            card.onclick = () => this.selectSubject(sub.key);
            card.innerHTML = `
                <!-- Hàng 1: Icon môn học và Badge trạng thái -->
                <div class="flex items-center justify-between gap-2 mb-2 w-full">
                    <div class="subject-card-icon-box ${applyVt ? 'vt-subject-icon ' : ''}w-10 h-10 rounded-xl ${iconColorClass} border flex items-center justify-center text-lg shrink-0 shadow-md">
                        <i class="fa-solid ${sub.icon || 'fa-book'}"></i>
                    </div>
                    ${scheduleBadge || (isSelected ? '<span class="text-[10px] px-2.5 py-1 rounded-full bg-sky-500/30 text-sky-200 border border-sky-400/50 font-bold flex items-center gap-1 shrink-0 shadow-sm"><i class="fa-solid fa-check text-[9px]"></i> Đã chọn</span>' : '')}
                </div>
                <!-- Hàng 2: Tên môn học -->
                <div class="w-full mb-2">
                    <p class="subject-card-title-text ${applyVt ? 'vt-subject-title ' : ''}font-heading font-extrabold text-sm sm:text-base text-white leading-snug break-words">${this.escapeHtml(subName)}</p>
                </div>
                <!-- Hàng 3: Học kỳ và Chữ số lượng câu hỏi -->
                <div class="flex items-center justify-between gap-1 text-[11px] text-slate-400 w-full pt-2 border-t border-slate-800/80 mt-auto">
                    <span class="px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300 font-medium text-[10px] truncate max-w-[80px]">${this.escapeHtml(sub.semester || 'Đề cương')}</span>
                    <span class="text-amber-400 font-bold text-xs shrink-0 whitespace-nowrap"><i class="fa-solid fa-bolt text-[10px] mr-1"></i><span data-home-count="${subCount}" data-prev-value="${prevSubCount}">${prevSubCount}</span> câu</span>
                </div>
            `;
            return card;
        };

        if (this.homeOpenFolder && activeFolders.has(this.homeOpenFolder)) {
            const group = activeFolders.get(this.homeOpenFolder);
            const bar = document.createElement('div');
            bar.className = 'col-span-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-700/80';
            bar.innerHTML = `
                <button type="button" id="btn-home-folder-back" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition">
                    <i class="fa-solid fa-arrow-left"></i> Quay lại
                </button>
                <span class="text-xs sm:text-sm font-extrabold text-amber-300 flex items-center gap-1.5">
                    <i class="fa-solid fa-folder-open"></i> ${this.escapeHtml(group.label)} (${group.items.length} đề)
                </span>
            `;
            bar.querySelector('#btn-home-folder-back')?.addEventListener('click', () => {
                this.homeOpenFolder = null;
                this.renderHomeSubjects();
            });
            fragment.appendChild(bar);
            group.items.forEach((sub) => fragment.appendChild(renderSubjectCard(sub)));
        } else {
            const renderedFolders = new Set();
            visibleSubjects.forEach((sub) => {
                const info = this.getSubjectFolderInfo(sub);
                if (info && activeFolders.has(info.folderKey)) {
                    if (renderedFolders.has(info.folderKey)) return;
                    renderedFolders.add(info.folderKey);
                    const group = activeFolders.get(info.folderKey);
                    const hasSelected = group.items.some((item) => item.key === this.currentSubject);
                    const totalCount = group.items.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
                    const folderCacheKey = `folder:${group.key}`;
                    const prevFolderCount = Object.prototype.hasOwnProperty.call(this._subjectCountCache, folderCacheKey)
                        ? this._subjectCountCache[folderCacheKey]
                        : 0;
                    this._subjectCountCache[folderCacheKey] = totalCount;
                    const firstSub = group.items[0] || sub;
                    const grad = firstSub.gradient || 'indigo';
                    const card = document.createElement('button');
                    card.type = 'button';
                    card.className = `p-3.5 rounded-2xl text-left flex flex-col justify-between cursor-pointer subject-card-interactive transition-all relative min-h-[118px] ${hasSelected ? 'selected-' + grad : 'hover:border-slate-600'}`;
                    card.onclick = () => {
                        this.homeOpenFolder = group.key;
                        this.renderHomeSubjects();
                    };
                    card.innerHTML = `
                        <div class="flex items-center justify-between gap-2 mb-2 w-full">
                            <div class="folder-card-icon-box w-10 h-10 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/35 flex items-center justify-center text-lg shrink-0 shadow-md">
                                <i class="fa-solid fa-folder-closed"></i>
                            </div>
                            <span class="text-[10px] px-2.5 py-1 rounded-full ${hasSelected ? 'bg-sky-500/30 text-sky-200 border border-sky-400/50' : 'folder-card-count-badge bg-amber-500/15 text-amber-300 border border-amber-500/30'} font-bold flex items-center gap-1 shrink-0 shadow-sm">
                                <i class="fa-solid fa-layer-group text-[9px]"></i> ${group.items.length} đề
                            </span>
                        </div>
                        <div class="w-full mb-2">
                            <p class="font-heading font-extrabold text-sm sm:text-base text-white leading-snug break-words">${this.escapeHtml(group.label)}</p>
                        </div>
                        <div class="flex items-center justify-between gap-1 text-[11px] text-slate-400 w-full pt-2 border-t border-slate-800/80 mt-auto">
                            <span class="px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300 font-medium text-[10px] truncate max-w-[100px]">Bấm mở thư mục</span>
                            <span class="text-amber-400 font-bold text-xs shrink-0 whitespace-nowrap"><i class="fa-solid fa-bolt text-[10px] mr-1"></i><span data-home-count="${totalCount}" data-prev-value="${prevFolderCount}">${prevFolderCount}</span> câu</span>
                        </div>
                    `;
                    fragment.appendChild(card);
                } else {
                    fragment.appendChild(renderSubjectCard(sub));
                }
            });
        }

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
            const subjects = id === 'leaderboard-subject-select'
                ? (this.dynamicSubjects || []).filter(sub => this.isSubjectAccessibleToCurrentUser(sub))
                : (this.dynamicSubjects || []);
            select.innerHTML = '';
            subjects.forEach(sub => {
                const opt = document.createElement('option');
                opt.value = sub.key;
                opt.textContent = `${sub.name} (${sub.semester || 'Học kỳ'})`;
                if (sub.key === currentVal) opt.selected = true;
                select.appendChild(opt);
            });
            if (id === 'leaderboard-subject-select' && subjects.length > 0 && !subjects.some(sub => sub.key === currentVal)) {
                select.value = subjects[0].key;
            }
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
            const existingHomeCountEl = document.getElementById('home-subject-count');
            const prevBadgeCount = existingHomeCountEl?.dataset?.prevValue !== undefined
                ? Number(existingHomeCountEl.dataset.prevValue) || 0
                : (this._lastBadgeSubjectCount || 0);
            this._lastBadgeSubjectCount = count;
            badge.innerHTML = `${this.escapeHtml(name)} (<span id="home-subject-count" data-home-count="${count}" data-prev-value="${prevBadgeCount}">${prevBadgeCount}</span> câu)`;
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

    animateHomeCount(target, value, duration = 400) {
        const element = typeof target === 'string' ? document.getElementById(target) : target;
        if (!element) return;
        const nextValue = Math.max(0, Math.round(Number(value) || 0));
        const rawPrev = element.dataset.prevValue !== undefined
            ? Number(element.dataset.prevValue)
            : Number(String(element.textContent || '').replace(/[^\d.-]/g, ''));
        const startValue = Number.isFinite(rawPrev) ? Math.max(0, Math.round(rawPrev)) : 0;
        element.dataset.prevValue = String(nextValue);

        if (element._countRafId) {
            cancelAnimationFrame(element._countRafId);
            element._countRafId = null;
        }

        const prefersReduced = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReduced || startValue === nextValue || duration <= 0) {
            element.textContent = String(nextValue);
            return;
        }

        const startTime = performance.now();
        const delta = nextValue - startValue;
        const step = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            // Cubic ease-out: 1 - (1 - t)^3
            const eased = 1 - Math.pow(1 - progress, 3);
            element.textContent = String(Math.round(startValue + delta * eased));
            if (progress < 1) {
                element._countRafId = requestAnimationFrame(step);
            } else {
                element._countRafId = null;
                element.textContent = String(nextValue);
            }
        };
        element._countRafId = requestAnimationFrame(step);
    }

    renderSkeletonCards(count = 3, type = 'observer') {
        const items = [];
        for (let i = 0; i < count; i++) {
            if (type === 'podium') {
                items.push(`
                    <div class="flex flex-col items-center ${i === 1 ? '-mt-3' : ''}" aria-hidden="true">
                        <div class="skeleton-shimmer w-12 h-12 rounded-2xl mb-2"></div>
                        <div class="skeleton-shimmer w-full rounded-2xl p-3 space-y-2">
                            <div class="skeleton-block h-3 w-12 mx-auto"></div>
                            <div class="skeleton-block h-3.5 w-3/4 mx-auto"></div>
                            <div class="skeleton-block h-4 w-1/2 mx-auto"></div>
                        </div>
                    </div>
                `);
            } else if (type === 'leaderboard-row') {
                items.push(`
                    <tr aria-hidden="true">
                        <td class="py-2.5 px-3 text-center"><div class="skeleton-shimmer skeleton-block h-4 w-6 mx-auto"></div></td>
                        <td class="py-2.5 px-3"><div class="skeleton-shimmer skeleton-block h-4 w-32"></div></td>
                        <td class="py-2.5 px-3 text-center"><div class="skeleton-shimmer skeleton-block h-4 w-12 mx-auto"></div></td>
                        <td class="py-2.5 px-3 text-right"><div class="skeleton-shimmer skeleton-block h-4 w-14 ml-auto"></div></td>
                    </tr>
                `);
            } else {
                items.push(`
                    <div class="obs-skeleton-card skeleton-shimmer rounded-2xl p-4 sm:p-5 min-h-[146px] flex flex-col justify-between gap-3" aria-hidden="true">
                        <div class="flex items-center justify-between gap-3">
                            <div class="flex items-center gap-2.5">
                                <div class="skeleton-block w-10 h-10 rounded-xl"></div>
                                <div class="space-y-1.5">
                                    <div class="skeleton-block h-3.5 w-28"></div>
                                    <div class="skeleton-block h-2.5 w-20"></div>
                                </div>
                            </div>
                            <div class="skeleton-block h-5 w-20 rounded-full"></div>
                        </div>
                        <div class="skeleton-block h-2.5 w-full rounded-full"></div>
                        <div class="flex justify-between">
                            <div class="skeleton-block h-3 w-24"></div>
                            <div class="skeleton-block h-3 w-16"></div>
                        </div>
                    </div>
                `);
            }
        }
        return items.join('');
    }

    triggerCopyButtonFeedback(btnEl, copiedLabel = null, duration = 1500) {
        if (!btnEl) return;
        if (btnEl._copyFeedbackTimer) {
            clearTimeout(btnEl._copyFeedbackTimer);
            btnEl._copyFeedbackTimer = null;
        }
        if (btnEl.dataset.origCopyHtml === undefined) {
            btnEl.dataset.origCopyHtml = btnEl.innerHTML;
        }
        btnEl.classList.add('is-copied-feedback');
        if (copiedLabel !== null) {
            btnEl.innerHTML = `<i class="fa-solid fa-check copy-feedback-icon"></i> <span>${this.escapeHtml(copiedLabel)}</span>`;
        } else {
            const icon = btnEl.querySelector('i');
            if (icon) {
                if (icon.dataset.origClass === undefined) {
                    icon.dataset.origClass = icon.className;
                }
                icon.className = 'fa-solid fa-check copy-feedback-icon';
            }
        }
        btnEl._copyFeedbackTimer = window.setTimeout(() => {
            btnEl._copyFeedbackTimer = null;
            btnEl.classList.remove('is-copied-feedback');
            if (btnEl.dataset.origCopyHtml !== undefined) {
                btnEl.innerHTML = btnEl.dataset.origCopyHtml;
                delete btnEl.dataset.origCopyHtml;
            }
        }, duration);
    }

    syncHomeSubjectViewTransitionTargets(targetKey = this.currentSubject) {
        const homeGrid = document.getElementById('home-subjects-grid');
        if (!homeGrid) return;
        const targetNorm = String(targetKey || '').trim().toLowerCase();
        let matchedIcon = false;
        let matchedTitle = false;
        homeGrid.querySelectorAll('[data-subject-card]').forEach((cardEl) => {
            const isMatch = Boolean(targetNorm) && String(cardEl.dataset.subjectCard || '').trim().toLowerCase() === targetNorm;
            const iconBox = cardEl.querySelector('.subject-card-icon-box');
            const titleEl = cardEl.querySelector('.subject-card-title-text');
            if (iconBox) {
                const enableIcon = isMatch && !matchedIcon;
                iconBox.classList.toggle('vt-subject-icon', enableIcon);
                if (enableIcon) matchedIcon = true;
            }
            if (titleEl) {
                const enableTitle = isMatch && !matchedTitle;
                titleEl.classList.toggle('vt-subject-title', enableTitle);
                if (enableTitle) matchedTitle = true;
            }
        });
    }

    async selectSubject(subjKey) {
        const targetNorm = String(subjKey || '').trim().toLowerCase();
        const selected = (this.dynamicSubjects || []).find((subject) => String(subject.key || '').trim().toLowerCase() === targetNorm);
        console.debug('[QuizApp] Subject selection requested:', { subjKey, selected, currentSubject: this.currentSubject, visible: this.getHomeVisibleSubjects().some((subject) => String(subject.key || '').trim().toLowerCase() === targetNorm) });
        if (!selected || !this.isSubjectAccessibleToCurrentUser(selected) || !this.getHomeVisibleSubjects().some((subject) => String(subject.key || '').trim().toLowerCase() === targetNorm)) {
            this.showToastNotification('Môn học này không thuộc khu vực được cấp quyền trên thiết bị hiện tại.');
            return;
        }
        if (targetNorm === String(this.currentSubject || '').trim().toLowerCase()) return;
        this.currentSubject = selected.key;
        this.setExamMode(selected?.mode === 'exam');
        localStorage.setItem('quiz_last_selected_subject', selected.key);
        this.syncHomeSubjectViewTransitionTargets(selected.key);
        this.renderHomeSubjects();
        await this.loadQuestionsForCurrentSubject();
        this.updateTotalQuestionDisplay();
        this.renderFilterTabs();
        this.applyNameInputRosterState();
        this.updateHomeScheduleAndFlashcardUI();
    }

    async loadQuestionsForCurrentSubject() {
        if (!this.currentSubject) {
            this.allQuestions = [];
            this.renderFilterTabs();
            return;
        }
        if (!this.isSubjectAccessibleToCurrentUser(this.currentSubject)) {
            console.warn('[QuizApp] Blocked question load for an inaccessible subject:', this.currentSubject);
            this.allQuestions = [];
            this.fullQuestionsPool = [];
            this.renderFilterTabs();
            return;
        }
        let questions = [];
        let cloudQuestionsLoaded = false;
        this.isLoadingQuestions = true;
        const subjectAtStart = this.currentSubject;
        const previousQuestions = this._lastLoadedSubjectKey === this.currentSubject && Array.isArray(this.allQuestions) && this.allQuestions.length > 0
            ? [...this.allQuestions]
            : [];
        console.debug('[QuizApp] Loading questions:', { subject: this.currentSubject, online: navigator.onLine, supabaseActive: Boolean(window.dbService?.isSupabaseActive) });

        // 1. Thử lấy từ Supabase Cloud nếu Online
        if (navigator.onLine) {
            try {
                if (window.dbService && typeof window.dbService.fetchQuestionsBySubject === 'function') {
                    const cloudQuestions = await window.dbService.fetchQuestionsBySubject(this.currentSubject);
                    if (Array.isArray(cloudQuestions)) {
                        questions = cloudQuestions.filter((question) => question?.is_deleted !== true);
                        // Một truy vấn Cloud thành công nhưng trả [] không đồng nghĩa
                        // với việc ngân hàng câu hỏi đã bị xóa. Giữ cache/bộ câu hỏi
                        // nhúng làm nguồn dự phòng để không làm màn hình học sinh rỗng.
                        cloudQuestionsLoaded = Boolean(window.dbService.isSupabaseActive && questions.length > 0);
                        console.debug('[QuizApp] Cloud questions loaded:', {
                            subject: this.currentSubject,
                            count: questions.length,
                            usableCloudData: cloudQuestionsLoaded
                        });
                        if (questions.length > 0) {
                            try {
                                localStorage.setItem(`quiz_cache_${this.currentSubject}`, JSON.stringify(questions));
                            } catch (ce) { }
                        }
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

        // Không xóa đề đang hiển thị chỉ vì một lần tải nền bị trả rỗng/lỗi.
        if (questions.length === 0 && previousQuestions.length > 0) {
            questions = previousQuestions;
            console.warn('[QuizApp] Cloud/cache không có dữ liệu mới; giữ lại bộ câu hỏi đang hiển thị:', {
                subject: this.currentSubject,
                count: questions.length
            });
        }

        if (this.currentSubject !== subjectAtStart) {
            this.isLoadingQuestions = false;
            return;
        }
        this.allQuestions = this.normalizeQuestions(questions);
        this._lastLoadedSubjectKey = this.currentSubject;
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

            // 2. Chuẩn hóa nội dung câu hỏi (giữ nguyên dữ liệu gốc, chỉ format/escape khi render)
            if (typeof item.question === 'string') {
                item.question = item.question.trim();
            }

            // 3. Chuẩn hóa 4 phương án options: Hỗ trợ cả mảng và object { A, B, C, D }, loại bỏ hoàn toàn tiền tố "A. ", "B. ", "C. ", "D. "
            let rawOpts = item.options;
            if (rawOpts && typeof rawOpts === 'object' && !Array.isArray(rawOpts)) {
                rawOpts = [rawOpts.A || '', rawOpts.B || '', rawOpts.C || '', rawOpts.D || ''];
            }
            if (Array.isArray(rawOpts)) {
                item.options = rawOpts.map(opt => {
                    if (opt && typeof opt === 'object') {
                        if (opt.math ?? opt.latex ?? opt.formula) {
                            return opt;
                        }
                        const rawText = opt.text ?? opt.value ?? opt.content ?? '';
                        return String(rawText).replace(/^[A-D][\s.):\/\-–]\s*/i, '').trim();
                    }
                    return String(opt || '').replace(/^[A-D][\s.):\/\-–]\s*/i, '').trim();
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
                    if (!st || typeof st !== 'object') return { text: String(st || '').trim(), answer: true };
                    const statementText = st.text ?? st.content ?? '';
                    const statementValue = st.math ?? st.latex ?? st.formula
                        ? { text: statementText, math: st.math ?? st.latex ?? st.formula }
                        : String(statementText).trim();
                    return { text: statementValue, answer: this._parseBoolAnswer(st.answer) };
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

            // 5. Chuẩn hóa giải thích (giữ nguyên dữ liệu gốc)
            item.explanation = typeof item.explanation === 'string' ? item.explanation.trim() : '';

            return item;
        });
    }

    /* ============================================================== */
    /* 2. NHẬN DIỆN IP ADMIN & PHÂN QUYỀN (PASSWORDLESS ADMIN IP)     */
    /* ============================================================== */

    async fetchClientIp(forceRefresh = false) {
        // Chế độ giả lập IP chỉ dành cho test local trong VS Code.
        // Không cho phép query override trên domain triển khai thật.
        let localTestIp = '';
        try {
            const isLocalHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(String(window.location.hostname || '').toLowerCase());
            const requestedIp = new URLSearchParams(window.location.search).get('test_ip') || '';
            if (isLocalHost && /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[0-9a-f:]+)$/i.test(requestedIp.trim())) {
                localTestIp = requestedIp.trim();
            }
        } catch (e) {}

        if (localTestIp) {
            this.clientIp = localTestIp;
            // Khi truyền ?test_ip=<ip> tường minh trên local, cho phép kiểm thử quyền thật của IP đó
            // thay vì ép localTestIpOverride = true (chỉ khóa trắng cổng 4173 khi không có ?test_ip=).
            this.localTestIpOverride = false;
            this.hasLocalTestIpParam = true;
            try {
                const keysToReset = [
                    'quiz_admin_token',
                    'quiz_is_admin',
                    'quiz_admin_authenticated',
                    'quiz_admin_saved_ip'
                ];
                if (!this._hasUrlToken) {
                    keysToReset.push('quiz_access_token', 'quiz_token_info');
                    this.userToken = '';
                    this.tokenInfo = null;
                }
                keysToReset.forEach((key) => localStorage.removeItem(key));
            } catch (e) {}
            this.isAdminAuthenticated = false;
            console.debug('[QuizApp] Local test IP active:', localTestIp);
        }

        const cachedIp = (!forceRefresh && !localTestIp) ? sessionStorage.getItem('quiz_stable_client_ip') : '';
        if (localTestIp) {
            // Đã gán IP test ở trên; không gọi dịch vụ nhận diện IP thật.
        } else if (cachedIp && cachedIp !== 'Chưa xác định' && !cachedIp.startsWith('Đang')) {
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
        let copiedOk = false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(combinedKey);
                copiedOk = true;
            } else {
                const ta = document.createElement('textarea');
                ta.value = combinedKey;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                copiedOk = document.execCommand('copy');
                document.body.removeChild(ta);
            }
        } catch (e) {}
        if (copiedOk) {
            this.triggerCopyButtonFeedback(document.getElementById('btn-show-ip'), null, 1500);
        }

        this.showToastNotification(`Đã sao chép mã: ${combinedKey}. Hãy gửi mã này cho Admin để được cấp quyền.`, 'success');

        await this.showConfirmModal({
            title: 'Mã xác thực thiết bị của bạn',
            badge: 'IP & Mã máy kết hợp',
            copyValue: combinedKey,
            copyLabel: 'Mã thiết bị kết hợp (IP & Mã máy)',
            copyOnConfirm: true,
            message: `Đã tự động sao chép mã thiết bị. Hãy gửi mã này cho Admin để được cấp quyền.`,
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
                    if (this.currentScreen === 'quiz') {
                        console.debug('[QuizApp] Đang làm bài, bỏ qua tải lại câu hỏi Realtime để tránh mất đáp án.');
                        return;
                    }
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
                .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_logins', filter: 'id=eq.00000000-0000-0000-0000-000000000010' }, () => {
                    this.loadRosterConfig().catch(() => {});
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
            if (this.currentScreen === 'quiz') return;
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
        if (this.localTestIpOverride) return false;
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

        const myDeviceCode = String(this.getOrCreateDeviceMachineCode?.() || this.deviceMachineCode || '').trim().toUpperCase();
        const masterDeviceCode = String(this.masterAdminDeviceCode || '').trim().toUpperCase();
        const rawAllowedList = Array.isArray(this.adminConfigAllowed) ? this.adminConfigAllowed : [];
        const matchesMyDevice = (item) => {
            if (!myDeviceCode || !item) return false;
            if (typeof item === 'string') {
                const up = item.trim().toUpperCase();
                return up === myDeviceCode || up.endsWith('-' + myDeviceCode);
            }
            const itemDev = String(item.deviceCode || '').trim().toUpperCase();
            const itemRaw = String(item.rawCode || '').trim().toUpperCase();
            const itemTok = String(item.token || '').trim().toUpperCase();
            return itemDev === myDeviceCode || itemRaw === myDeviceCode || itemTok === myDeviceCode || itemTok.endsWith('-' + myDeviceCode);
        };
        // Khi Admin đã khóa quyền theo Mã máy Master -> chỉ đúng mã máy đã cấp mới lên Admin (điện thoại chung WiFi sẽ là học sinh bình thường)
        if (masterDeviceCode) {
            if (!myDeviceCode) return false;
            return myDeviceCode === masterDeviceCode || rawAllowedList.some(matchesMyDevice);
        }
        if (myDeviceCode && rawAllowedList.some(matchesMyDevice)) return true;

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
                this.masterAdminDeviceCode = String(cfg.masterDeviceCode || '').trim().toUpperCase();
                this.adminIpConfig = { masterIp: this.masterAdminIp, masterDeviceCode: this.masterAdminDeviceCode, allowedIps: this.allowedAdminIps, rawAllowed: this.adminConfigAllowed };
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
            this.navigateToAdminWithTransition();
            return;
        }
        const modal = document.getElementById('modal-admin-auth');
        if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
    }

    closeAdminAuthModal() {
        const modal = document.getElementById('modal-admin-auth');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    async verifyAdminPassword() {
        const passInput = document.getElementById('admin-pass-input');
        const password = passInput ? passInput.value : '';
        if (password && window.dbService && typeof window.dbService.verifyAdminLogin === 'function') {
            try {
                const res = await window.dbService.verifyAdminLogin({ password, ip: this.clientIp });
                if (res && (res.valid || res.ok || res.success || res.authenticated)) {
                    this.isAdminAuthenticated = true;
                    this.closeAdminAuthModal();
                    this.updateAdminUIVisibility();
                    this.navigateToAdminWithTransition();
                    return;
                }
            } catch (e) {
                console.warn('[QuizApp] verifyAdminLogin error:', e);
            }
        }
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
                    allowedIps: this.adminConfigAllowed,
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
                this.adminConfigAllowed = this.adminConfigAllowed || [];
                this.adminConfigAllowed.push({ name, token: '', rawCode: ip, addedAt: new Date().toISOString() });
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
                this.adminConfigAllowed = (this.adminConfigAllowed || []).filter(item => (typeof item === 'string' ? item : item?.rawCode) !== ip);
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
            const safeIp = this.escapeHtml(ip);
            card.innerHTML = `
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-lg ${isMaster ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-800 text-slate-300'} flex items-center justify-center font-bold">
                        <i class="fa-solid ${isMaster ? 'fa-crown' : 'fa-laptop'}"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-mono font-bold text-white text-xs sm:text-sm">${safeIp}</span>
                            ${isMaster ? '<span class="px-2 py-0.2 rounded bg-amber-500/20 text-amber-300 font-extrabold text-[10px]">MASTER ADMIN</span>' : ''}
                            ${isCurrent ? '<span class="px-2 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[10px]">Máy Hiện Tại</span>' : ''}
                        </div>
                    </div>
                </div>
                <div>
                    ${!isMaster ? `
                        <button type="button" class="js-revoke-admin-ip px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-[11px] font-semibold transition cursor-pointer">
                            <i class="fa-solid fa-user-xmark mr-1"></i> Thu hồi
                        </button>
                    ` : '<span class="text-[11px] text-amber-400/80 italic font-medium">Bảo vệ vĩnh viễn</span>'}
                </div>
            `;
            const revokeBtn = card.querySelector('.js-revoke-admin-ip');
            if (revokeBtn) revokeBtn.addEventListener('click', () => this.adminRevokeAdminIp(ip));
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
                    this.accessTokens = tokens;
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
            icon: 'fa-solid fa-robot'
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
            const safeIp = this.escapeHtml(ip);
            const safeName = this.escapeHtml(name);
            card.innerHTML = `
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center justify-center font-bold">
                        <i class="fa-solid fa-robot text-amber-300"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-mono text-blue-300 font-bold">${safeIp}</span>
                            ${isCurrent ? '<span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">Máy của bạn</span>' : ''}
                        </div>
                        <p class="text-[11px] text-slate-400 font-medium">${safeName}</p>
                    </div>
                </div>
                <button type="button" class="js-revoke-ai-ip px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-semibold transition cursor-pointer">
                    <i class="fa-solid fa-trash-can mr-1"></i> Thu hồi
                </button>
            `;
            const revokeAiBtn = card.querySelector('.js-revoke-ai-ip');
            if (revokeAiBtn) revokeAiBtn.addEventListener('click', () => this.adminRevokeAiIp(ip));
            container.appendChild(card);
        });
    }

    /* ============================================================== */
    /* 3. BẢNG ĐIỀU KHIỂN QUẢN TRỊ VIÊN & CHUYỂN TAB (ADMIN DASHBOARD)*/
    /* ============================================================== */

    openAdminDashboard() {
        if (!this.isAdminAuthenticated || !this.hasAdminIpAccess()) return;
        this.navigateToAdminWithTransition();
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
            const cachedMsg = localStorage.getItem('quiz_maintenance_msg');
            if (cachedMsg) this.maintenanceMessage = cachedMsg;
            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    this.isMaintenanceMode = Boolean(parsed.isActive);
                    if (parsed.message) this.maintenanceMessage = parsed.message;
                } catch (e) {
                    this.isMaintenanceMode = cached === 'true';
                }
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
            if (subtext) subtext.innerHTML = `<span class="text-rose-400 font-semibold">Hệ thống đang khóa. Lời nhắn: "${this.escapeHtml(this.maintenanceMessage)}"</span>`;
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
                const res = await window.dbService.saveQuestionsBulk(this.currentSubject, this.allQuestions, true);
                if (res?.success === false) throw new Error(res.error || 'Cloud không lưu được đề.');
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
                const res = await window.dbService.clearQuestionsBySubject(this.currentSubject);
                if (res?.success === false) throw new Error(res.error || 'Cloud không xóa được đề.');
                localStorage.removeItem(`quiz_cache_${this.currentSubject}`);
                const sub = this.dynamicSubjects.find(s => s.key === this.currentSubject);
                if (sub) sub.count = 0;
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
            const qText = String(q.question?.text ?? q.question ?? '').toLowerCase();
            const expText = String(q.explanation?.text ?? q.explanation ?? '').toLowerCase();
            const matchesText = !keyword || qText.includes(keyword) || expText.includes(keyword);
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

            const optChars = ['A', 'B', 'C', 'D', 'E', 'F'];
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
                    const optText = window.MathNotation?.readValue ? window.MathNotation.readValue(opt).text : (typeof opt === 'string' ? opt : (opt?.text ?? opt?.math ?? ''));
                    const optContent = optText.trim() ? this.formatScientificNotation(optText) : '<span class="text-amber-400/90 italic font-mono text-[11px]">[Trống nội dung - Bấm "Sửa" để bổ sung công thức]</span>';
                    return `
                        <button type="button" onclick="app.adminQuickChangeAnswer(${this.attrArg(q.id)}, ${oIdx})" class="admin-opt-btn w-full text-left p-2.5 rounded-xl border transition cursor-pointer flex items-center gap-2 ${isCorrect ? 'border-emerald-500 bg-emerald-950/30 text-emerald-300 font-semibold shadow-sm' : 'border-slate-800 bg-slate-900/80 text-slate-300 hover:border-slate-600 hover:bg-slate-800/80'}" title="Nhấp vào để chọn làm đáp án đúng">
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
                                    <strong class="text-blue-400">${letter})</strong>
                                    <span class="flex-1">${this.formatScientificNotation(st.text)}</span>
                                </div>
                                <div class="inline-flex items-center gap-1 shrink-0 p-0.5 rounded-lg bg-slate-950 border border-slate-800">
                                    <button type="button" onclick="app.adminQuickToggleTfAnswer(${this.attrArg(q.id)}, ${sIdx}, true)"
                                        class="px-2.5 py-0.5 rounded-md text-xs font-bold transition cursor-pointer ${isTrue ? 'bg-emerald-500 text-slate-950 font-black shadow ring-1 ring-emerald-400' : 'text-slate-400 hover:text-white'}"
                                        title="Đặt ý ${letter} thành ĐÚNG">
                                        ĐÚNG
                                    </button>
                                    <button type="button" onclick="app.adminQuickToggleTfAnswer(${this.attrArg(q.id)}, ${sIdx}, false)"
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
                        <span class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 font-medium text-[11px]">${this.escapeHtml(q.category || 'Ôn tập')}</span>
                        <span class="admin-q-badge-ans px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold text-[11px] border border-emerald-500/30">Đáp án đúng: ${correctLetter}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <button onclick="app.openEditQuestionModal(${this.attrArg(q.id)})" class="px-3 py-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-900 text-emerald-400 font-bold text-xs transition cursor-pointer flex items-center gap-1 border border-emerald-500/40" title="Sửa câu hỏi">
                            <span>Sửa</span>
                        </button>
                        <button onclick="app.adminDeleteQuestion(${this.attrArg(q.id)})" class="px-3 py-1 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 hover:text-white font-bold text-xs transition cursor-pointer flex items-center gap-1 border border-rose-500/40" title="Xóa câu hỏi">
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

        const optChars = ['A', 'B', 'C', 'D', 'E', 'F'];
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
            const safeName = this.escapeHtml(sub.name);
            const safeKey = this.escapeHtml(sub.key);
            const safeIcon = this.escapeHtml(sub.icon || 'fa-book');
            const safeSemester = this.escapeHtml(sub.semester || 'Học kỳ');
            card.innerHTML = `
                <div class="flex items-start justify-between gap-3">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-slate-700 text-white flex items-center justify-center text-lg">
                            <i class="fa-solid ${safeIcon}"></i>
                        </div>
                        <div>
                            <h4 class="font-bold text-white text-sm">${safeName}</h4>
                            <p class="text-[11px] text-slate-400 font-mono">key: ${safeKey}</p>
                        </div>
                    </div>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isPrivate ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'}">
                        ${isPrivate ? '🔒 Riêng tư' : '🌍 Công khai'}
                    </span>
                </div>
                <div class="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-700/60">
                    <span>Thẻ: <strong class="text-slate-200">${safeSemester}</strong></span>
                    <span>Đề: <strong class="text-sky-400">${Number(sub.count) || 0} câu</strong></span>
                </div>
                <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-700/60 flex-wrap">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <button type="button" class="js-sub-import px-2.5 py-1.5 rounded-lg bg-sky-600/30 hover:bg-sky-600 text-sky-200 border border-sky-500/40 text-xs font-bold transition cursor-pointer flex items-center gap-1 shadow-sm" title="Nạp nhanh đề từ file Word/PDF/Excel vào môn này">
                            <i class="fa-solid fa-file-arrow-up text-sky-400"></i> Nạp Đề File
                        </button>
                        <button type="button" class="js-sub-new-q px-2.5 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 border border-emerald-500/40 text-xs font-bold transition cursor-pointer flex items-center gap-1 shadow-sm" title="Tạo thêm câu hỏi mới cho môn này">
                            <i class="fa-solid fa-plus text-emerald-400"></i> Thêm Câu Hỏi
                        </button>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <button type="button" class="js-sub-toggle-vis px-2.5 py-1.5 rounded-lg ${isPrivate ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600 hover:text-white' : 'bg-amber-600/20 text-amber-300 border border-amber-500/40 hover:bg-amber-600 hover:text-white'} text-xs font-semibold transition cursor-pointer" title="Bấm để chuyển đổi Công khai / Riêng tư">
                            <i class="fa-solid ${isPrivate ? 'fa-eye' : 'fa-eye-slash'} mr-1"></i> ${isPrivate ? 'Công khai' : 'Riêng tư'}
                        </button>
                        <button type="button" class="js-sub-edit px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold transition cursor-pointer" title="Chỉnh sửa thông tin môn học">
                            <i class="fa-solid fa-pen-to-square mr-1"></i> Sửa
                        </button>
                        <button type="button" class="js-sub-delete px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-semibold transition cursor-pointer" title="Xóa môn học này">
                            <i class="fa-solid fa-trash-can mr-1"></i> Xóa
                        </button>
                    </div>
                </div>
            `;
            card.querySelector('.js-sub-import')?.addEventListener('click', () => this.openImporterForSubject(sub.key));
            card.querySelector('.js-sub-new-q')?.addEventListener('click', () => this.openNewQuestionForSubject(sub.key));
            card.querySelector('.js-sub-toggle-vis')?.addEventListener('click', () => this.adminToggleSubjectVisibility(sub.key));
            card.querySelector('.js-sub-edit')?.addEventListener('click', () => this.openSubjectEditor(sub.key));
            card.querySelector('.js-sub-delete')?.addEventListener('click', () => this.adminDeleteSubject(sub.key));
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
            const requestedTarget = subjKey || this.currentSubject;
            const target = this.isSubjectAccessibleToCurrentUser(requestedTarget)
                ? requestedTarget
                : (select?.options?.[0]?.value || '');
            if (select && target) select.value = target;
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

        if (!subjKey || !this.isSubjectAccessibleToCurrentUser(subjKey)) {
            if (podiumContainer) podiumContainer.innerHTML = '<div class="col-span-3 text-center py-6 text-slate-500 italic">Không có dữ liệu bảng xếp hạng cho môn học này.</div>';
            if (tbody) tbody.innerHTML = '';
            return;
        }

        if (podiumContainer) podiumContainer.innerHTML = this.renderSkeletonCards(3, 'podium');
        if (tbody) tbody.innerHTML = this.renderSkeletonCards(3, 'leaderboard-row');

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
            if (tbody) tbody.innerHTML = '';
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
        const badge = document.getElementById('quiz-mode-badge');
        if (badge) {
            badge.textContent = this.isExamMode ? 'Thi đấu' : 'Luyện tập';
            badge.className = this.isExamMode
                ? 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30 hidden sm:inline-block'
                : 'px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-sky-500/20 text-sky-300 border border-sky-500/30 hidden sm:inline-block';
        }
        const wrongFilterBtn = document.getElementById('btn-filter-wrong');
        if (wrongFilterBtn) {
            wrongFilterBtn.classList.toggle('hidden', this.isExamMode);
        }
        const homeRules = document.getElementById('home-rules-count-text');
        if (homeRules) {
            homeRules.textContent = this.isExamMode
                ? 'Chế độ thi đấu: Ẩn đáp án khi làm bài, chấm điểm sau khi nộp bài.'
                : 'Chế độ luyện tập: Tự động chấm điểm & xem đáp án ngay.';
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
        const iconClass = this.soundEnabled ? 'fa-solid fa-volume-high text-sky-400' : 'fa-solid fa-volume-xmark text-slate-500';

        if (headerIcon) headerIcon.className = iconClass;
        if (quizIcon) quizIcon.className = iconClass;
    }

    playTingSound() {
        if (!this.soundEnabled) return;
        try {
            const ctx = this._audioCtx || (this._audioCtx = new (window.AudioContext || window.webkitAudioContext)());
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
            const ctx = this._audioCtx || (this._audioCtx = new (window.AudioContext || window.webkitAudioContext)());
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
        return this.escapeHtml(typeof text === 'string' ? text : String(text ?? ''));
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

    escapeJsString(value) {
        return String(value ?? '')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029');
    }

    attrArg(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return `'${this.escapeJsString(value).replace(/"/g, '&quot;')}'`;
    }

    sanitizeMediaUrl(url) {
        const raw = String(url ?? '').trim();
        if (!raw) return '';
        if (/^https?:\/\//i.test(raw) || /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=]+$/i.test(raw)) {
            return raw;
        }
        return '';
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

    switchScreen(screenName) {
        const prevScreen = this.currentScreen;
        this.currentScreen = screenName;
        if (screenName === 'quiz' && !this.isReviewingResult) {
            this.resetIdleAutoSubmitTimer('quiz screen active');
            const windowUnfocused = typeof document.hasFocus === 'function' && !document.hasFocus();
            if (document.hidden || windowUnfocused) {
                this.startAwayAutoSubmitTimer('quiz screen entered while away');
            } else {
                this.cancelAwayAutoSubmitTimer('quiz screen active');
            }
        } else {
            if (screenName !== 'quiz') {
                this.quizAttemptId = null;
            }
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
                    const wasHidden = el.classList.contains('hidden');
                    el.classList.remove('hidden');
                    if (prevScreen !== screenName || wasHidden) {
                        el.classList.remove('screen-view-enter');
                        void el.offsetWidth;
                        el.classList.add('screen-view-enter');
                    }
                } else {
                    el.classList.add('hidden');
                }
            }
        });

        if (screenName === 'home') {
            const homeTabs = document.getElementById('home-semester-tabs');
            const activeTab = homeTabs?.querySelector('.home-grade-tab.is-active');
            if (homeTabs && activeTab) {
                this.updateSlidingTabIndicator(homeTabs, activeTab, false);
            }
            this.applyNameInputRosterState();
            this.updateHomeScheduleAndFlashcardUI();
        }
    }

    showHome() {
        this.exitObserverMode();
        this.switchScreen('home');
    }

    async returnToHome() {
        // Bug 4 Fix: Chỉ cảnh báo khi đang ở màn hình thi 'quiz' và đã trả lời câu hỏi
        const isCurrentlyQuiz = this.screens.quiz && !this.screens.quiz.classList.contains('hidden');
        const hasAnswers = Object.keys(this.userAnswers).length > 0;

        if (isCurrentlyQuiz && hasAnswers && !this.isReviewingResult) {
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
        this.pendingStudentProgress = null;
        this.currentLoginId = null;
        this.quizAttemptId = null;
        try { sessionStorage.removeItem('quiz_current_login_id'); } catch (e) {}
        this.isRevengeMode = false;
        this.isReviewingResult = false;
        this.currentFilter = 'all';
        this.isFinishingQuiz = false;
        const backToResultBtn = document.getElementById('btn-back-to-result');
        if (backToResultBtn) backToResultBtn.classList.add('hidden');
        const submitQuizBtn = document.getElementById('btn-submit-quiz');
        if (submitQuizBtn) submitQuizBtn.classList.remove('hidden');
        if (this.fullQuestionsPool && this.fullQuestionsPool.length > 0) {
            this.allQuestions = [...this.fullQuestionsPool];
        }
        this.updateHomeRevengeBanner();
        this.switchScreen('home');
    }

    recordLogin() {
        if (this.hasAdminBypass()) {
            this.loginRecordPromise = Promise.resolve(null);
            return this.loginRecordPromise;
        }
        if (!window.dbService || typeof window.dbService.recordLogin !== 'function') {
            this.loginRecordPromise = Promise.resolve(null);
            return this.loginRecordPromise;
        }
        if (!this.quizAttemptId) {
            this.quizAttemptId = (window.dbService && typeof window.dbService.generateUUID === 'function')
                ? window.dbService.generateUUID()
                : `attempt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        }
        this.pendingStudentProgress = null;
        this.progressSyncRunning = false;
        const attemptId = this.quizAttemptId;
        this.loginRecordPromise = window.dbService.recordLogin({
            playerName: this.playerName,
            clientIp: this.clientIp,
            deviceInfo: this.deviceInfo,
            subjectTitle: this.getSubjectTitle(),
            scoreSummary: `[${this.getSubjectTitle()}] Bắt đầu làm bài`,
            sessionId: this.getOrCreateClientSessionId(),
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
        return this.loginRecordPromise;
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
        document.getElementById('timer-display')?.classList.remove('timer-critical-pulse');
        this.quizAttemptId = (window.dbService && typeof window.dbService.generateUUID === 'function')
            ? window.dbService.generateUUID()
            : `attempt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        this.awaySwitchCount = 0;
        this.currentLoginId = null;
        try { sessionStorage.removeItem('quiz_current_login_id'); } catch (e) {}
        this.isFinishingQuiz = false;
        this.isReviewingResult = false;
        document.getElementById('btn-back-to-result')?.classList.add('hidden');
        document.getElementById('btn-submit-quiz')?.classList.remove('hidden');
        this.userAnswers = {};
        this.clearAutoSaveProgress();
        if (this.fullQuestionsPool && this.fullQuestionsPool.length > 0) {
            this.allQuestions = [...this.fullQuestionsPool];
        }
        this.isRevengeMode = false;
        this.isMistakeMode = false;
        const currentSubjectObj = (this.dynamicSubjects || []).find((subject) => subject.key === this.currentSubject);
        this.setExamMode(currentSubjectObj?.mode === 'exam');
        const topSubTitle = document.getElementById('quiz-top-subject-title');
        if (topSubTitle) topSubTitle.textContent = this.getSubjectTitle();
        this.switchScreen('quiz');
        if (window.dbService) {
            this.recordLogin();
        }
        this.renderAllQuestions();
        this.startStopwatch();
        this.updateLiveStats();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    filterQuestions(filterKey) {
        const effectiveKey = (this.isExamMode && !this.isReviewingResult && filterKey === 'wrong') ? 'all' : filterKey;
        this.currentFilter = effectiveKey;
        const container = document.getElementById('quiz-filter-tabs-container');
        if (container) {
            container.querySelectorAll('.filter-tab-btn').forEach(btn => {
                const isActive = btn.getAttribute('data-filter') === effectiveKey;
                btn.classList.toggle('bg-sky-600', isActive);
                btn.classList.toggle('text-white', isActive);
                btn.classList.toggle('shadow-md', isActive);
                btn.classList.toggle('bg-slate-800', !isActive);
                btn.classList.toggle('hover:bg-slate-700', !isActive);
                btn.classList.toggle('text-slate-300', !isActive);
            });
        }
        // Bug 3 Fix: Luôn chuyển sang màn hình 'quiz' để người dùng nhìn thấy câu hỏi đã lọc
        const backBtn = document.getElementById('btn-back-to-result');
        const submitBtn = document.getElementById('btn-submit-quiz');
        if (backBtn) backBtn.classList.toggle('hidden', !this.isReviewingResult);
        if (submitBtn) submitBtn.classList.toggle('hidden', Boolean(this.isReviewingResult));
        this.switchScreen('quiz');
        this.renderAllQuestions();
        if (window.scrollY > 120) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    switchUser() {
        localStorage.removeItem('quiz_user_name');
        localStorage.removeItem('quiz_saved_player_name');
        this.playerName = "";
        this._draftPlayerName = "";
        this.isPlayerNameCommitted = false;
        this.currentLoginId = null;
        this.quizAttemptId = null;
        try { sessionStorage.removeItem('quiz_current_login_id'); } catch (e) {}
        const input = document.getElementById('player-name-input');
        if (input) input.value = '';
        this.checkSavedUser();
        this.updateHomeRevengeBanner();
        this.switchScreen('home');
    }

    checkSavedUser() {
        const rawSaved = localStorage.getItem('quiz_user_name');
        const banner = document.getElementById('saved-user-banner');
        const nameEl = document.getElementById('saved-user-name');
        const input = document.getElementById('player-name-input');
        const savedCheck = rawSaved ? this.validateStudentNameInput(rawSaved) : { valid: false, normalized: '' };
        const saved = savedCheck.valid ? savedCheck.normalized : '';

        if (rawSaved && !savedCheck.valid) {
            localStorage.removeItem('quiz_user_name');
            localStorage.removeItem('quiz_saved_player_name');
            this.playerName = '';
            this.isPlayerNameCommitted = false;
        }

        const hasDraft = input && (document.activeElement === input || String(input.value || '').trim() !== '');
        if (saved && banner && nameEl) {
            this.playerName = saved;
            this.isPlayerNameCommitted = true;
            nameEl.textContent = saved;
            banner.classList.remove('hidden');
            if (input && !hasDraft) input.value = saved;
        } else if (banner) {
            banner.classList.add('hidden');
        }
        this.updateHomeRevengeBanner();
    }

    clearSavedUser() {
        localStorage.removeItem('quiz_user_name');
        localStorage.removeItem('quiz_saved_player_name');
        this.playerName = "";
        this._draftPlayerName = "";
        this.isPlayerNameCommitted = false;
        this.currentLoginId = null;
        this.quizAttemptId = null;
        try { sessionStorage.removeItem('quiz_current_login_id'); } catch (e) {}
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
        if (this.hasAdminBypass()) return;
        if (!window.dbService || typeof window.dbService.recordLogin !== 'function') return;
        if (this.currentScreen === 'quiz' || this.isFinishingQuiz || this.quizAttemptId) return;
        if (this._visitorPresenceInFlight) return this._visitorPresenceInFlight;
        this.presenceHeartbeatAt = Date.now();
        this._visitorPresenceInFlight = (async () => {
            try {
                if (!this.clientIp || this.clientIp.startsWith('Đang')) {
                    await this.fetchClientIp();
                }
                if (this.currentScreen === 'quiz' || this.isFinishingQuiz || this.quizAttemptId) return;
                let savedName = '';
                try {
                    savedName = this.isPlayerNameCommitted ? this.playerName : (localStorage.getItem('quiz_user_name') || '');
                } catch (e) {}
                const name = String(savedName || 'Khách truy cập').trim() || 'Khách truy cập';
                const res = await window.dbService.recordLogin({
                    playerName: name,
                    clientIp: this.clientIp,
                    deviceInfo: this.deviceInfo,
                    subjectTitle: statusText || 'Đang xem trang chủ',
                    scoreSummary: '',
                    loginId: this.visitorLoginId || null,
                    status: statusText || 'Đang xem trang chủ',
                    isVisitor: true,
                    newAttempt: false,
                    sessionId: 'visitor_' + this.getOrCreateClientSessionId()
                });
                const loginId = (res && res.id) ? res.id : (typeof res === 'string' ? res : null);
                if (loginId) {
                    this.visitorLoginId = loginId;
                    try { sessionStorage.setItem('quiz_visitor_login_id', loginId); } catch (e) {}
                }
            } catch (e) {
            } finally {
                this._visitorPresenceInFlight = null;
            }
        })();
        return this._visitorPresenceInFlight;
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
                ? 'bg-sky-600 text-white shadow-md'
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
        const rawNoticeMsg = String(notice.content || notice.message || '');
        const isForceSubmit = rawNoticeMsg.includes('[__FORCE_SUBMIT__]');
        const cleanNoticeMsg = rawNoticeMsg.replace(/\[__FORCE_SUBMIT__\]\s*/g, '').trim();
        if (isForceSubmit && this.currentScreen === 'quiz' && !this.isReviewingResult && !this.isFinishingQuiz && !this.hasAdminBypass()) {
            this.showToastNotification(cleanNoticeMsg || '⏰ Giáo viên đã thu bài! Hệ thống tự động nộp bài của bạn.', 'warning');
            this.finishQuiz('force-submit');
            return;
        }
        if (cleanNoticeMsg) {
            this.showStudentNotice(cleanNoticeMsg);
        }
    }

    startRealtimeHeartbeat() {
        this.checkSystemNotice(true).catch(() => { });

        // Tự động pulse heartbeat ngay khi chuyển tab hoặc mở lại màn hình
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                const activeLoginId = this.currentLoginId || this.visitorLoginId;
                if (activeLoginId && window.dbService?.heartbeat) {
                    this.presenceHeartbeatAt = Date.now();
                    window.dbService.heartbeat(activeLoginId).catch(() => {});
                } else {
                    this.recordVisitorPresence('Đang xem trang chủ').catch(() => {});
                }
            }
        });
        window.addEventListener('focus', () => {
            const activeLoginId = this.currentLoginId || this.visitorLoginId;
            if (activeLoginId && window.dbService?.heartbeat) {
                this.presenceHeartbeatAt = Date.now();
                window.dbService.heartbeat(activeLoginId).catch(() => {});
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
                    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'quiz_logins' }, (payload) => {
                        const row = payload?.new;
                        if (row && this.currentLoginId && String(row.id) === String(this.currentLoginId)
                            && /đã nộp bài|hoàn thành/i.test(String(row.status || ''))
                            && this.currentScreen === 'quiz' && !this.isReviewingResult && !this.isFinishingQuiz && !this.hasAdminBypass()) {
                            this.showToastNotification('⏰ Giáo viên đã thu bài! Hệ thống đã tự động nộp bài của bạn.', 'warning');
                            this.finishQuiz('force-submit');
                        }
                    })
                    .subscribe();
            }
        } catch (e) { }

        // Kiểm tra quyền thường xuyên nhưng chỉ ghi heartbeat hiện diện mỗi 20-30 giây.
        setInterval(async () => {
            if (document.hidden || !window.dbService) return;
            if (this._heartbeatRunning) return;
            this._heartbeatRunning = true;
            try {
                const activeLoginId = this.currentLoginId || this.visitorLoginId;
                if (Date.now() - (this.presenceHeartbeatAt || 0) >= 20000) {
                    this.presenceHeartbeatAt = Date.now();
                    if (activeLoginId) {
                        await window.dbService.heartbeat?.(activeLoginId);
                    } else {
                        await this.recordVisitorPresence('Đang xem trang chủ');
                    }
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

                // 3. Đồng bộ phân quyền Admin theo IP (bảo lưu nếu đăng nhập bằng Token Admin hợp lệ hoặc đang dùng mật khẩu Master)
                try {
                    if (typeof window.dbService.checkIsAdminIp === 'function' && this.clientIp) {
                        const isIpAdmin = await window.dbService.checkIsAdminIp(this.clientIp, this.getOrCreateDeviceMachineCode());
                        const hasTokenAdmin = this.hasTokenRole('admin');
                        const hasMasterSession = Boolean(window.dbService?.getAdminSessionToken?.());
                        const isAdmin = Boolean(isIpAdmin || hasTokenAdmin || hasMasterSession);
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
            } finally {
                this._heartbeatRunning = false;
            }
        }, 10000);
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
            if (typeof this.playTingSound === 'function') this.playTingSound();
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
                    <div class="p-3 rounded-xl bg-slate-900/90 border border-sky-500/30 flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <i class="fa-solid fa-users text-sky-400 text-xs"></i>
                            <span class="text-xs font-semibold text-slate-300">Tổng Lượt Truy Cập:</span>
                        </div>
                        <span class="text-sm font-extrabold text-sky-300">${list.length}</span>
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

                const scoreInfo = String(student.score_summary || student.status || 'Đang ôn tập').replace(/\n__DETAIL__:[\s\S]*$/, '').trim();

                const isAiGranted = (this.allowedAiIps || []).some(item => (typeof item === 'string' ? item : item.ip) === ip);

                const safeName = this.escapeHtml(name);
                const safeIp = this.escapeHtml(ip);
                const safeDevice = this.escapeHtml(device);
                const safeScoreInfo = this.escapeHtml(scoreInfo);
                const jsIp = this.attrArg(ip);
                const jsName = this.attrArg(name);

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
                            <span class="px-2.5 py-1 rounded-lg ${isBanned ? 'bg-rose-500/20 text-rose-200 border border-rose-500/30' : 'bg-sky-500/20 text-sky-200 border border-sky-500/30'} font-semibold text-[11px] inline-block max-w-[220px] truncate" title="${safeScoreInfo}">
                                ${safeScoreInfo}
                            </span>
                        </td>
                        <td class="py-2.5 px-3 text-right">
                            <div class="flex items-center justify-end gap-1.5 flex-wrap">
                                <button onclick="app.adminToggleStudentAiRole(${jsIp}, ${jsName})" class="px-2.5 py-1 rounded-lg ${isAiGranted ? 'bg-blue-600/30 text-blue-200 border border-blue-500/50 hover:bg-rose-600/30' : 'bg-slate-800 text-slate-300 hover:text-white border border-slate-700 hover:bg-blue-600/30'} text-xs font-bold transition cursor-pointer" title="${isAiGranted ? 'Bấm để thu hồi quyền Trợ lý AI' : 'Bấm để cấp quyền sử dụng Trợ lý AI cho IP này'}">
                                    <i class="fa-solid fa-robot mr-1 ${isAiGranted ? 'text-amber-300' : 'text-slate-400'}"></i> ${isAiGranted ? 'Đã có AI' : 'Cấp AI'}
                                </button>
                                ${isBanned ? `
                                    <button onclick="app.adminUnbanStudentIp(${jsIp})" class="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 text-xs font-bold transition cursor-pointer" title="Bấm để mở chặn cho IP này">
                                        <i class="fa-solid fa-lock-open mr-1"></i> Mở Chặn
                                    </button>
                                ` : `
                                    <button onclick="app.adminBanStudentIp(${jsIp})" class="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-bold transition cursor-pointer" title="Bấm để chặn ngay IP này">
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
            tbody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-rose-400">Lỗi tải danh sách: ${this.escapeHtml(e.message)}</td></tr>`;
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
            const timeStr = this.escapeHtml(item.bannedAt ? new Date(item.bannedAt).toLocaleString('vi-VN') : '—');
            const name = this.escapeHtml(item.playerName || 'Không rõ');
            const reason = this.escapeHtml(item.reason || 'Vi phạm quy chế');
            const safeIp = this.escapeHtml(item.ip || '');
            const safeDevice = this.escapeHtml(item.deviceInfo || '—');
            return `
                <div class="p-2.5 rounded-xl bg-slate-950/80 border border-rose-500/30 flex flex-wrap items-center justify-between gap-2.5">
                    <div class="flex items-center gap-2.5">
                        <div class="w-7 h-7 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center text-xs shrink-0">
                            <i class="fa-solid fa-ban"></i>
                        </div>
                        <div>
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="font-mono font-bold text-rose-300 text-xs">${safeIp}</span>
                                <span class="text-[11px] text-slate-300 font-semibold">(${name})</span>
                                <span class="text-[10px] px-2 py-0.5 rounded-full bg-rose-950 text-rose-400 border border-rose-800">${reason}</span>
                            </div>
                            <p class="text-[10px] text-slate-500 mt-0.5">Thời gian chặn: ${timeStr} • Thiết bị: ${safeDevice}</p>
                        </div>
                    </div>
                    <button onclick="app.adminUnbanStudentIp(${this.attrArg(item.ip || '')})" class="px-3 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ml-auto shrink-0" title="Bỏ chặn IP này để thí sinh vào lại">
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
        try {
            if (!window.dbService || typeof window.dbService.verifyAdminLogin !== 'function') {
                this.showAlertModal("Hệ thống xác thực máy chủ chưa sẵn sàng.");
                return;
            }
            const authRes = await window.dbService.verifyAdminLogin({ password: pass, ip: this.clientIp });
            if (!authRes || !(authRes.valid || authRes.ok || authRes.success || authRes.authenticated)) {
                this.showAlertModal("Mật khẩu không chính xác!");
                return;
            }
            if (typeof window.dbService.unbanIp === 'function') {
                await window.dbService.unbanIp(this.clientIp);
                await this.showAlertModal("Đã gỡ chặn IP thành công! Đang tải lại trang...");
                location.reload();
            }
        } catch (e) {
            this.showAlertModal("Lỗi mở khóa: " + (e?.message || 'Không xác định'));
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
                        const getClient = window.getSharedSupabaseClient;
                        const client = typeof getClient === 'function'
                            ? getClient(url, key)
                            : window.supabase.createClient(url, key);
                        window.dbService.client = client;
                        window.dbService.isSupabaseActive = Boolean(client);
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
        const title = document.getElementById('editor-modal-badge');
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
                this._editingQuestionMeta = { qType: q.qType, statements: q.statements, correctValue: q.correctValue, acceptedValues: q.acceptedValues };
                if (badge) badge.textContent = `Đang sửa Câu #${q.id}`;
                if (idInput) idInput.value = q.id;
                const rawText = (val) => (val && typeof val === 'object') ? (val.math ?? val.latex ?? val.formula ?? val.text ?? val.value ?? val.content ?? '') : (val ?? '');
                if (catInput) catInput.value = q.category || 'Ôn tập';
                if (textInput) textInput.value = rawText(q.question);
                if (imgInput) imgInput.value = q.image_url || q.imageUrl || '';
                if (expInput) expInput.value = rawText(q.explanation);

                if (q.options && q.options.length >= 4) {
                    for (let i = 0; i < 4; i++) {
                        const optEl = document.getElementById(`edit-q-opt-${i}`);
                        if (optEl) optEl.value = rawText(q.options[i]);
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
        const optChars = ['A', 'B', 'C', 'D', 'E', 'F'];
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
        const rawId = idInput && idInput.value ? idInput.value.trim() : '';
        const qId = rawId ? (/^\d+$/.test(rawId) ? parseInt(rawId, 10) : rawId) : null;
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
            qType: this._editingQuestionMeta?.qType || 'mcq',
            category: catInput ? catInput.value.trim() : 'Ôn tập',
            question: questionText,
            image_url: imgInput ? imgInput.value.trim() : null,
            options: options,
            correct: correct,
            answer: correct,
            correctAnswer: optLetter,
            explanation: expInput ? expInput.value.trim() : ''
        };
        if (newQ.qType === 'tf_group') newQ.statements = this._editingQuestionMeta?.statements || [];
        if (newQ.qType === 'short_answer') {
            newQ.correctValue = this._editingQuestionMeta?.correctValue || '';
            newQ.acceptedValues = this._editingQuestionMeta?.acceptedValues || [];
            newQ.options = [];
        }

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
                    <h4 class="font-bold text-emerald-300 text-xs sm:text-sm">${this.escapeHtml(item.title)}</h4>
                    <p class="text-slate-300 whitespace-pre-line text-xs leading-relaxed">${this.escapeHtml(item.content)}</p>
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

    getGeminiProxyUrl() {
        return (typeof window !== 'undefined' && window.__QUIZ_CONFIG__?.geminiProxyUrl) || '/api/gemini';
    }

    async loadGlobalGeminiApiKey() {
        let localKey = '';
        try { localKey = (localStorage.getItem('gemini_api_key') || '').trim(); } catch (e) {}
        if (window.dbService && typeof window.dbService.fetchGeminiApiKey === 'function') {
            try {
                const cloudKey = (await window.dbService.fetchGeminiApiKey() || '').trim();
                if (cloudKey) {
                    try { localStorage.setItem('gemini_api_key', cloudKey); } catch (e) {}
                    return cloudKey;
                }
            } catch (e) {}
        }
        return localKey;
    }

    async getAvailableGeminiModels() {
        return ['gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
    }

    async openAiSettingsModal() {
        if (!this.isAdminAuthenticated) {
            this.showAlertModal("🔒 Tính năng cấu hình Trợ lý AI chỉ dành riêng cho Quản trị viên (Admin).");
            return;
        }
        const modal = document.getElementById('modal-ai-settings');
        const input = document.getElementById('gemini-api-key-input');
        if (input) {
            input.value = '';
            const existingKey = await this.loadGlobalGeminiApiKey();
            if (existingKey) input.value = existingKey;
        }
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
            this.showAlertModal("🔒 Chỉ Quản trị viên mới được cấu hình Trợ lý AI.");
            return;
        }
        const input = document.getElementById('gemini-api-key-input');
        const rawKey = (input ? input.value : '').trim().replace(/^Bearer\s+/i, '').replace(/^['"]|['"]$/g, '').trim();
        if (!rawKey || rawKey.length < 20) {
            this.showAlertModal("⚠️ Vui lòng dán mã Gemini API Key hợp lệ (ít nhất 20 ký tự, ví dụ AIza... hoặc AQ....).");
            return;
        }
        try { localStorage.setItem('gemini_api_key', rawKey); } catch (e) {}
        let cloudSaved = false;
        if (window.dbService && typeof window.dbService.saveGeminiApiKey === 'function') {
            cloudSaved = await window.dbService.saveGeminiApiKey(rawKey);
        }
        this.closeAiSettingsModal();
        this.showAlertModal(cloudSaved
            ? "✅ Đã lưu Gemini API Key lên Supabase Cloud! Toàn bộ học sinh được cấp quyền AI có thể dùng ngay."
            : "✅ Đã lưu Gemini API Key trên trình duyệt hiện tại.");
    }

    async clearAiApiKey() {
        if (!this.isAdminAuthenticated) {
            this.showAlertModal("🔒 Chỉ Quản trị viên mới được thao tác cấu hình AI.");
            return;
        }
        try { localStorage.removeItem('gemini_api_key'); } catch (e) {}
        if (window.dbService && typeof window.dbService.saveGeminiApiKey === 'function') {
            await window.dbService.saveGeminiApiKey('');
        }
        const input = document.getElementById('gemini-api-key-input');
        if (input) input.value = '';
        this.showAlertModal("🗑️ Đã xóa Gemini API Key khỏi trình duyệt và Supabase Cloud.");
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

        const proxyUrl = this.getGeminiProxyUrl();

        const q = (this.allQuestions || []).find(item => String(item.id) === String(qId));
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

        const contentHost = targetDiv.querySelector('.ai-explanation-box') || targetDiv;
        targetDiv.classList.remove('hidden');
        targetDiv.setAttribute('aria-hidden', 'false');
        contentHost.innerHTML = `
            <div class="flex items-center gap-2.5 text-blue-300 font-bold py-2">
                <i class="fa-solid fa-spinner fa-spin text-base text-amber-400"></i>
                <span>Trợ lý AI đang phân tích câu hỏi & biên soạn lời giải thích ngắn gọn, dễ hiểu...</span>
            </div>
        `;
        if (!targetDiv.classList.contains('is-open')) {
            void targetDiv.offsetHeight;
            window.requestAnimationFrame(() => {
                targetDiv.classList.add('is-open');
            });
        }

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
            const optChars = ['A', 'B', 'C', 'D', 'E', 'F'];
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
            const candidateModels = await this.getAvailableGeminiModels();
            const clientApiKey = await this.loadGlobalGeminiApiKey();
            const reqHeaders = { 'Content-Type': 'application/json' };
            if (clientApiKey) reqHeaders['x-gemini-api-key'] = clientApiKey;

            let res = null;
            let lastErrMsg = "";

            for (const model of candidateModels) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 20000);
                    const startedAt = performance.now();
                    let callResp;
                    try {
                        callResp = await fetch(proxyUrl, {
                            method: 'POST',
                            headers: reqHeaders,
                            signal: controller.signal,
                            body: JSON.stringify({
                                model,
                                prompt,
                                contents: [{ parts: [{ text: prompt }] }],
                                generationConfig: { temperature: 0.2, maxOutputTokens: 700 }
                            })
                        });
                    } finally {
                        clearTimeout(timeoutId);
                    }
                    console.debug('[QuizMaster AI] Gemini proxy timing:', { model, elapsedMs: Math.round(performance.now() - startedAt), status: callResp?.status || 'network-error' });

                    if (callResp.ok) {
                        res = callResp;
                        break;
                    } else {
                        const errData = await callResp.json().catch(() => ({}));
                        lastErrMsg = errData?.error?.message || errData?.error || `Lỗi HTTP ${callResp.status} (${model})`;
                        console.debug('[QuizMaster AI] Gemini proxy diagnostic:', { model, status: callResp.status, message: lastErrMsg, isAdmin: this.isAdminAuthenticated, currentIp: this.clientIp });
                        console.warn(`[QuizMaster AI] Model ${model} gặp lỗi (${callResp.status}):`, lastErrMsg);

                        if (callResp.status === 401 || callResp.status === 403) {
                            break;
                        }

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
                throw new Error(quota ? 'Model Gemini đã thử đang hết quota hoặc bị giới hạn tốc độ.' : (lastErrMsg || "Không thể kết nối đến máy chủ Trợ lý AI (/api/gemini)."));
            }

            const data = await res.json();
            const replyText = data?.text || data?.candidates?.[0]?.content?.parts?.[0]?.text || "Không nhận được phản hồi từ AI.";

            let formattedHtml = this.formatScientificNotation(replyText)
                .replace(/^### (.*$)/gim, '<h4 class="font-bold text-amber-300 mt-2 mb-1">$1</h4>')
                .replace(/^## (.*$)/gim, '<h3 class="font-bold text-blue-300 mt-2 mb-1 text-sm">$1</h3>')
                .replace(/\*\*(.*?)\*\*/g, '<strong class="text-amber-300 font-bold">$1</strong>')
                .replace(/^\* (.*$)/gim, '<li class="ml-4 list-disc text-slate-200">$1</li>')
                .replace(/\n\n/g, '<p class="mt-1.5"></p>')
                .replace(/\n/g, '<br>');

            contentHost.innerHTML = `
                <div class="flex items-center justify-between pb-2 mb-2 border-b border-blue-500/30">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-lightbulb text-amber-300"></i>
                        <span class="font-heading font-bold text-white text-xs">Lời Giải Thích Chi Tiết Từ Trợ Lý AI (Gemini)</span>
                    </div>
                    <button onclick="app.copyAiText(this)" class="px-2 py-0.5 rounded-lg bg-blue-600/30 hover:bg-blue-600 text-blue-200 hover:text-white text-[10px] font-semibold transition cursor-pointer flex items-center gap-1">
                        <i class="fa-regular fa-copy"></i> Sao chép
                    </button>
                </div>
                <div class="ai-content-body text-xs leading-relaxed text-slate-200">
                    ${formattedHtml}
                </div>
            `;
            targetDiv.classList.add('is-open');
            targetDiv.setAttribute('aria-hidden', 'false');

            this.renderMath(contentHost);
        } catch (err) {
            contentHost.innerHTML = `
                <div class="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs space-y-1">
                    <p class="font-bold flex items-center gap-1.5"><i class="fa-solid fa-triangle-exclamation"></i> Không thể tải lời giải thích AI:</p>
                    <p class="text-[11px]">${this.escapeHtml(err?.message || 'Lỗi không xác định')}</p>
                    <p class="text-[10px] text-slate-400">Mẹo: Kiểm tra lại API Key trong nút [Cài API Key] hoặc mạng Internet.</p>
                </div>
            `;
            targetDiv.classList.add('is-open');
            targetDiv.setAttribute('aria-hidden', 'false');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async copyAiText(btnEl) {
        const body = btnEl?.closest('.ai-explanation-box')?.querySelector('.ai-content-body');
        if (!body) return;
        const text = body.innerText;
        const copied = await this.copyTextToClipboard(text);
        if (copied) {
            this.triggerCopyButtonFeedback(btnEl, 'Đã chép!', 1500);
        }
    }

    /* ============================================================== */
    /* 15. CHẾ ĐỘ NỀN SÁNG / TỐI (DARK / LIGHT MODE TOGGLE)           */
    /* ============================================================== */

    initTheme() {
        let saved = null;
        try { saved = localStorage.getItem('quiz_theme'); } catch (e) {}
        this.applyTheme(saved === 'dark' ? 'dark' : 'light', false);
    }

    toggleTheme() {
        const isDark = document.documentElement.classList.contains('dark')
            || document.body.classList.contains('dark');
        const next = isDark ? 'light' : 'dark';
        this.applyTheme(next, true);
    }

    applyTheme(theme, persist = false) {
        const normalized = theme === 'dark' ? 'dark' : 'light';
        if (persist) {
            try { localStorage.setItem('quiz_theme', normalized); } catch (e) {}
        }
        const icons = document.querySelectorAll('.theme-toggle-icon-sync, #theme-toggle-icon');
        if (normalized === 'light') {
            document.documentElement.classList.remove('dark');
            document.body.classList.remove('dark');
            document.body.classList.add('light-theme');
            icons.forEach((icon) => { icon.className = 'fa-solid fa-moon text-slate-600 theme-toggle-icon-sync'; });
        } else {
            document.documentElement.classList.add('dark');
            document.body.classList.add('dark');
            document.body.classList.remove('light-theme');
            icons.forEach((icon) => { icon.className = 'fa-solid fa-sun text-amber-400 theme-toggle-icon-sync'; });
        }
    }

    /* ============================================================== */
    /* 16. BỘ PHÁT ÂM THANH CHIẾN THẮNG (CELEBRATION FANFARE SOUND)   */
    /* ============================================================== */

    playFanfareSound() {
        if (!this.soundEnabled) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            const ctx = this._audioCtx || (this._audioCtx = new AudioCtx());
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
            if (list.length > 8) list = list.slice(0, 8);
            localStorage.setItem('quiz_my_history', JSON.stringify(list));
        } catch (e) {
            console.warn("Lỗi lưu lịch sử cá nhân:", e);
        }
    }

    async clearPersonalHistory() {
        if (!(await this.showConfirmModal({
            title: 'Xóa nhật ký ôn tập cá nhân?',
            badge: 'Lịch sử làm bài',
            message: 'Bạn có chắc chắn muốn xóa toàn bộ 8 bài làm gần nhất trong lịch sử cá nhân trên thiết bị này?',
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

        const displayList = list.slice(0, 8);
        tbody.innerHTML = displayList.map((item, idx) => {
            const timeDate = item.submittedAt ? new Date(item.submittedAt).toLocaleString('vi-VN', {
                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
            }) : '—';

            let scoreBadgeClass = "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
            if (item.score < 50) scoreBadgeClass = "bg-rose-500/20 text-rose-300 border-rose-500/30";
            else if (item.score < 80) scoreBadgeClass = "bg-amber-500/20 text-amber-300 border-amber-500/30";

            const latestBadge = idx === 0
                ? `<span class="ml-1.5 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9px] font-extrabold uppercase tracking-wide align-middle">Mới nhất</span>`
                : '';

            return `
                <tr class="hover:bg-slate-800/40 transition">
                    <td class="py-2.5 px-3 font-mono text-[11px] text-slate-400">${this.escapeHtml(timeDate)}</td>
                    <td class="py-2.5 px-3 font-bold text-white">${this.escapeHtml(item.subjectTitle || 'Chung')}${latestBadge}</td>
                    <td class="py-2.5 px-3">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                            ${this.escapeHtml(item.mode || 'Luyện tập')}
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
                    <td class="py-2.5 px-3 text-right font-mono text-sky-300">
                        ${this.escapeHtml(String(item.timeSpent ?? '')) || '—'}
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
            this.validateUserToken(false).then(() => this.syncClass5Access()).then(() => this.loadRosterConfig()).then(() => this.renderHomeSubjects()).catch(() => {});
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

        banner.className = `fixed top-2 left-1/2 -translate-x-1/2 z-[100000] flex items-center gap-2 px-4 py-2 rounded-2xl shadow-2xl text-xs font-bold transition-all duration-300 ${type === 'success' ? 'bg-emerald-600/90 text-white border border-emerald-400' : 'bg-slate-900/95 text-sky-300 border border-sky-500'}`;
        icon.className = type === 'success' ? "fa-solid fa-circle-check text-emerald-200" : "fa-solid fa-info-circle text-sky-300";
        text.textContent = msg;
        banner.classList.remove('hidden');
        if (this.networkToastTimer) clearTimeout(this.networkToastTimer);
        this.networkToastTimer = setTimeout(() => {
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
            if (this.currentScreen !== 'quiz' || this.isReviewingResult || this.hasAdminBypass()) return;
            if (document.hidden) {
                clearTimeout(this._awayCountDebounce);
                this._awayCountDebounce = setTimeout(() => { this.awaySwitchCount = (this.awaySwitchCount || 0) + 1; }, 400);
                this.startAwayAutoSubmitTimer('document hidden');
            } else {
                if (this.checkAndAutoSubmitIfStale('return')) return;
                this.cancelAwayAutoSubmitTimer('document visible');
                this.resetIdleAutoSubmitTimer('document visible');
            }
        }, { passive: true });

        window.addEventListener('blur', () => {
            if (this.currentScreen === 'quiz' && !this.isReviewingResult) {
                clearTimeout(this._awayCountDebounce);
                this._awayCountDebounce = setTimeout(() => { this.awaySwitchCount = (this.awaySwitchCount || 0) + 1; }, 400);
                this.startAwayAutoSubmitTimer('window blur');
            }
        }, { passive: true });

        window.addEventListener('focus', () => {
            if (this.currentScreen === 'quiz' && !this.isReviewingResult && !this.hasAdminBypass()) {
                if (this.checkAndAutoSubmitIfStale('return')) return;
                this.cancelAwayAutoSubmitTimer('window focus');
                this.resetIdleAutoSubmitTimer('window focus');
            }
        }, { passive: true });

        ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((eventName) => {
            document.addEventListener(eventName, () => {
                if (this.currentScreen === 'quiz' && !this.isReviewingResult) {
                    this.resetIdleAutoSubmitTimer(eventName);
                }
            }, { passive: true });
        });

        // Chỉ kiểm tra hợp lệ khi gõ/rời ô; chỉ lưu tên & ghi nhận lên máy chủ khi học sinh bấm Bắt Đầu
        const nameInput = document.getElementById('player-name-input');
        if (nameInput) {
            nameInput.addEventListener('focus', () => this.renderRosterSuggestions());
            nameInput.addEventListener('change', () => {
                const val = nameInput.value.trim();
                if (!val) {
                    this.clearPlayerNameError();
                    return;
                }
                const check = this.validateStudentNameInput(val);
                if (!check.valid) {
                    this.showPlayerNameError(check.reason);
                } else {
                    nameInput.value = check.normalized;
                    this.clearPlayerNameError();
                }
            });
            nameInput.addEventListener('input', () => {
                const val = nameInput.value.trim();
                this._draftPlayerName = val;
                if (!val || this.validateStudentNameInput(val).valid) {
                    this.clearPlayerNameError();
                }
                this.updateHomeRevengeBanner();
                this.renderRosterSuggestions();
            });
            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.startQuiz();
                }
            });
        }

        const guestToggle = document.getElementById('btn-toggle-outside-guest');
        if (guestToggle) guestToggle.addEventListener('click', () => { this.isOutsideGuestMode = !this.isOutsideGuestMode; this.applyNameInputRosterState(); });
        document.addEventListener('click', (event) => {
            if (!event.target.closest('#player-name-input, #player-name-roster-dropdown')) {
                document.getElementById('player-name-roster-dropdown')?.classList.add('hidden');
            }
        });

        // Nhấn Enter tại ô mật mã Admin
        const passInput = document.getElementById('admin-pass-input');
        if (passInput) {
            passInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.verifyAdminPassword();
                }
            });
        }
    }
}

window.QuizApp = QuizApp;
