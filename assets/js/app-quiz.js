/* Module tách từ QuizApp (app.js) */
(function (root) {
    'use strict';
    const QuizApp = root.QuizApp;
    if (typeof QuizApp !== 'function') {
        throw new Error('QuizApp must be loaded before QuizAppQuizMixin');
    }

    class QuizAppQuizMixin {
    hasSubmittedAnswer(qId) {
        return Object.prototype.hasOwnProperty.call(this.userAnswers || {}, qId);
    }

    isShortAnswerCorrect(question, value) {
        if (!question || question.correctValue == null || value === undefined || value === null) return false;
        const normalize = (v) => String(v).trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, ' ');
        const normalizedValue = normalize(value);
        if (!normalizedValue) return false;

        const acceptedValues = [question.correctValue, ...(Array.isArray(question.acceptedValues) ? question.acceptedValues : [])]
            .map(normalize)
            .filter(Boolean);
        return acceptedValues.includes(normalizedValue);
    }

    /* ============================================================== */
    /* 9. THỰC HIỆN LÀM BÀI TRẮC NGHIỆM & TÍNH ĐIỂM                    */
    /* ============================================================== */

    validateStudentNameInput(rawName) {
        if (typeof window.validateStudentName === 'function') {
            return window.validateStudentName(rawName);
        }
        const normalized = String(rawName || '').trim().replace(/\s+/g, ' ');
        return normalized
            ? { valid: true, normalized, reason: '' }
            : { valid: false, normalized: '', reason: 'Vui lòng nhập Họ và Tên của bạn để bắt đầu làm bài!' };
    }

    showPlayerNameError(message) {
        const input = document.getElementById('player-name-input');
        const err = document.getElementById('player-name-error');
        const errText = document.getElementById('player-name-error-text');
        const msg = String(message || 'Vui lòng nhập đầy đủ Họ và Tên của bạn để bắt đầu.');
        if (errText) errText.textContent = msg;
        else if (err) err.textContent = msg;
        if (err) err.classList.remove('hidden');
        if (input) {
            input.focus();
            input.classList.add('ring-2', 'ring-rose-500');
            clearTimeout(this._playerNameErrTimer);
            this._playerNameErrTimer = setTimeout(() => input.classList.remove('ring-2', 'ring-rose-500'), 2500);
        }
    }

    clearPlayerNameError() {
        const input = document.getElementById('player-name-input');
        const err = document.getElementById('player-name-error');
        if (err) err.classList.add('hidden');
        if (input) input.classList.remove('ring-2', 'ring-rose-500');
    }

    async startQuiz() {
        const isAdminBypass = this.hasAdminBypass();
        if (!isAdminBypass && this.showForceRenameModalIfNeeded()) return;
        const input = document.getElementById('player-name-input');
        const rawName = this.pinnedDeviceName || (input ? input.value.trim() : '');
        const { gradeRoster } = this.getRosterGradeConfig();
        const normalizedRoster = this.normalizeRosterSearch(rawName);
        let rosterName = rawName;
        if (!isAdminBypass && gradeRoster?.enabled && !this.isOutsideGuestMode && !this.pinnedDeviceName) {
            const match = (gradeRoster.students || []).map((s) => typeof s === 'string' ? s : s?.name).find((s) => this.normalizeRosterSearch(s) === normalizedRoster);
            if (!match) { this.showPlayerNameError('Vui lòng chọn đúng tên trong Danh sách lớp.'); document.getElementById('player-name-roster-dropdown')?.classList.remove('hidden'); this.renderRosterSuggestions(); return; }
            rosterName = match;
        }
        let name = rawName || 'Admin';
        if (!isAdminBypass) {
            const nameCheck = this.validateStudentNameInput(rosterName);
            if (!nameCheck.valid) {
                this.showPlayerNameError(nameCheck.reason);
                this.showToastNotification(`⚠️ ${nameCheck.reason}`, 'warning');
                return;
            }
            name = nameCheck.normalized;
        }
        this.clearPlayerNameError();
        const activeSubObj = this.getCurrentSubjectObj();
        const schedule = this.getSubjectScheduleState(activeSubObj);
        if (!isAdminBypass && (schedule.status === 'upcoming' || schedule.status === 'closed')) {
            this.updateHomeScheduleAndFlashcardUI();
            this.showToastNotification(schedule.status === 'upcoming' ? 'Đề chưa tới giờ mở.' : 'Đề đã hết hạn mở.', 'warning');
            return;
        }
        const maxAttempts = Number(activeSubObj?.maxAttempts || 0);
        const usedAttempts = this.getSubjectAttemptCount(activeSubObj, name);
        if (!isAdminBypass && maxAttempts > 0 && usedAttempts >= maxAttempts) {
            this.updateHomeScheduleAndFlashcardUI();
            this.showToastNotification(`🚫 Bạn đã dùng hết ${usedAttempts}/${maxAttempts} lượt nộp cho đề này.`, 'warning');
            return;
        }
        if (input && !isAdminBypass) input.value = name;
        this.playerName = name;
        this.currentAttemptOutsideRoster = Boolean(!isAdminBypass && gradeRoster?.enabled && this.isOutsideGuestMode);
        this._draftPlayerName = isAdminBypass ? rawName : name;
        this.isPlayerNameCommitted = true;
        this.currentLoginId = null;
        if (!isAdminBypass) {
            localStorage.setItem('quiz_user_name', name);
            const savedNameEl = document.getElementById('saved-user-name');
            if (savedNameEl) savedNameEl.textContent = name;
            const savedBannerEl = document.getElementById('saved-user-banner');
            if (savedBannerEl) savedBannerEl.classList.remove('hidden');
        }

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
        this.awaySwitchCount = 0;
        try { sessionStorage.removeItem('quiz_current_login_id'); } catch (e) {}

        // Khôi phục tiến độ Auto-Save (nếu có) trước khi khởi tạo phiên mới
        this.loadAutoSaveProgress();
        const hasResumedAnswers = Object.keys(this.userAnswers || {}).length > 0;
        const freshAttemptId = (window.dbService && typeof window.dbService.generateUUID === 'function')
            ? window.dbService.generateUUID()
            : `attempt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        if (!hasResumedAnswers || !this.quizAttemptId) {
            this.quizAttemptId = freshAttemptId;
        }

        // Khởi tạo bài thi trên Cloud Supabase ở nền; không bắt học sinh chờ
        // truy vấn lookup + insert/update trước khi nhìn thấy câu hỏi.
        // Admin vào làm bài thử thì không lưu lịch sử đăng nhập / tiến độ.
        if (!isAdminBypass && window.dbService && typeof window.dbService.recordLogin === 'function') {
            // Giữ promise để auto-submit có thể chờ ID cloud trước khi ghi điểm.
            this.pendingStudentProgress = null;
            this.progressSyncRunning = false;
            const attemptId = this.quizAttemptId;
            this.loginRecordPromise = window.dbService.recordLogin({
                playerName: this.playerName,
                clientIp: this.clientIp,
                deviceInfo: this.deviceInfo,
                subjectTitle: this.getSubjectTitle(),
                status: `Đang làm bài${this.currentAttemptOutsideRoster ? ' [Ngoài lớp]' : ''}`,
                scoreSummary: `[${this.getSubjectTitle()}] Bắt đầu làm bài${this.currentAttemptOutsideRoster ? ' [Ngoài lớp]' : ''}`,
                sessionId: this.getOrCreateClientSessionId(),
                attemptId,
                newAttempt: !hasResumedAnswers ? true : false,
                loginId: hasResumedAnswers ? (this.currentLoginId || null) : null
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

        // Cập nhật Header
        const headerName = document.getElementById('quiz-header-player-name');
        if (headerName) headerName.textContent = this.playerName;

        const topSubTitle = document.getElementById('quiz-top-subject-title');
        if (topSubTitle) topSubTitle.textContent = this.getSubjectTitle();

        const currentSubjectObj = (this.dynamicSubjects || []).find((subject) => subject.key === this.currentSubject);
        this.setExamMode(currentSubjectObj?.mode === 'exam');

        const homeGrid = document.getElementById('home-subjects-grid');
        const quizAdminMark = document.getElementById('quiz-admin-mark');
        const currentSubjNorm = String(this.currentSubject || '').trim().toLowerCase();

        if (homeGrid) {
            let matchedIcon = false;
            let matchedTitle = false;
            homeGrid.querySelectorAll('[data-subject-card]').forEach((cardEl) => {
                const isMatch = String(cardEl.dataset.subjectCard || '').trim().toLowerCase() === currentSubjNorm;
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
        quizAdminMark?.classList.remove('vt-subject-icon');
        topSubTitle?.classList.remove('vt-subject-title');

        const applyQuizScreenDom = () => {
            if (homeGrid) {
                homeGrid.querySelectorAll('.vt-subject-icon').forEach((el) => el.classList.remove('vt-subject-icon'));
                homeGrid.querySelectorAll('.vt-subject-title').forEach((el) => el.classList.remove('vt-subject-title'));
            }
            quizAdminMark?.classList.add('vt-subject-icon');
            topSubTitle?.classList.add('vt-subject-title');

            this.switchScreen('quiz');
            this.observeQuizHeader();
            this.renderAllQuestions(true);
            this.startStopwatch();
            this.updateLiveStats();
        };

        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (typeof document.startViewTransition === 'function' && !reduceMotion) {
            try {
                const vt = document.startViewTransition(() => {
                    applyQuizScreenDom();
                });
                if (vt && vt.finished && typeof vt.finished.finally === 'function') {
                    vt.finished.catch(() => {}).finally(() => {
                        quizAdminMark?.classList.remove('vt-subject-icon');
                        topSubTitle?.classList.remove('vt-subject-title');
                    });
                } else {
                    quizAdminMark?.classList.remove('vt-subject-icon');
                    topSubTitle?.classList.remove('vt-subject-title');
                }
            } catch (err) {
                applyQuizScreenDom();
                quizAdminMark?.classList.remove('vt-subject-icon');
                topSubTitle?.classList.remove('vt-subject-title');
            }
        } else {
            applyQuizScreenDom();
            quizAdminMark?.classList.remove('vt-subject-icon');
            topSubTitle?.classList.remove('vt-subject-title');
        }
    }

    loadAutoSaveProgress() {
        const result = window.AppSync.loadAutoSaveProgress(this);
        if (this.isExamMode) {
            const key = `quiz_autosave_${this.currentSubject}_${this.playerName}`;
            try {
                const saved = JSON.parse(localStorage.getItem(key) || 'null');
                if (saved && saved.attemptId === this.quizAttemptId && Number.isFinite(Number(saved.examSecondsRemaining))) {
                    const elapsed = Math.max(0, Math.floor((Date.now() - Number(saved.savedAt || Date.now())) / 1000));
                    this.examSecondsRemaining = Math.max(0, Number(saved.examSecondsRemaining) - elapsed);
                }
            } catch (e) {}
        }
        return result;
    }

    saveAutoSaveProgress() {
        const result = window.AppSync.saveAutoSaveProgress(this);
        const key = `quiz_autosave_${this.currentSubject}_${this.playerName}`;
        try {
            const saved = JSON.parse(localStorage.getItem(key) || '{}');
            saved.attemptId = this.quizAttemptId || saved.attemptId || null;
            saved.answers = this.userAnswers || {};
            saved.savedAt = Date.now();
            if (this.isExamMode) saved.examSecondsRemaining = Math.max(0, Number(this.examSecondsRemaining) || 0);
            localStorage.setItem(key, JSON.stringify(saved));
        } catch (e) {}
        return result;
    }

    clearAutoSaveProgress(clearSubjectProgress = false) {
        return window.AppSync.clearAutoSaveProgress(this, clearSubjectProgress);
    }

    renderAllQuestions(skipExitAnimation = false, skipEnterAnimation = false) {
        return window.AppRender.renderAllQuestions(this, skipExitAnimation, skipEnterAnimation);
    }

    selectOption(qId, oIdx) {
        if (this.isFinishingQuiz || this.isReviewingResult) return;
        const q = this.allQuestions.find(item => String(item.id) === String(qId));
        if (!q) return;
        if (!this.isExamMode && this.hasSubmittedAnswer(qId)) {
            console.debug('[QuizApp] Bỏ qua lần chọn trắc nghiệm thứ hai:', { qId, existing: this.userAnswers[qId] });
            return;
        }

        this.userAnswers[qId] = oIdx;
        this.saveAutoSaveProgress();
        this.updateLiveStats();

        // Cập nhật DOM cục bộ trong chế độ thi để tránh giật/nhảy trang
        const qKey = this.domKey(qId);
        const card = document.getElementById(`q-card-${qKey}`);
        if (card && this.isExamMode) {
            const optButtons = card.querySelectorAll('.quiz-option-tile');
            optButtons.forEach((btn, idx) => {
                const isSelected = (idx === oIdx);
                btn.className = `quiz-option-tile w-full p-3 sm:p-3.5 rounded-xl border text-left flex items-start gap-3 transition-colors cursor-pointer disabled:cursor-default ${isSelected ? 'bg-sky-600/30 border-sky-500 text-sky-200 font-bold option-selected-user' : 'bg-slate-900 border-slate-700/80 text-slate-300 hover:border-slate-500'}`;
            });
            return;
        }

        if (card && !this.isExamMode) {
            const rawCorrectIdx = q.correct !== undefined ? q.correct : q.answer;
            const correctIdx = (rawCorrectIdx !== undefined && rawCorrectIdx !== null && rawCorrectIdx !== '') ? Number(rawCorrectIdx) : NaN;
            const optButtons = card.querySelectorAll('.quiz-option-tile');
            optButtons.forEach((btn, idx) => {
                btn.disabled = true;
                if (idx === correctIdx) {
                    btn.className = 'quiz-option-tile w-full p-3 sm:p-3.5 rounded-xl border text-left flex items-start gap-3 transition-colors cursor-default bg-emerald-600/25 border-emerald-500 text-emerald-200 font-bold option-selected-correct';
                    if (!btn.querySelector('.answer-feedback-icon')) {
                        btn.insertAdjacentHTML('beforeend', '<span class="answer-feedback-icon" aria-hidden="true"><i class="fa-solid fa-check"></i></span>');
                    }
                } else if (idx === oIdx) {
                    btn.className = 'quiz-option-tile w-full p-3 sm:p-3.5 rounded-xl border text-left flex items-start gap-3 transition-colors cursor-default bg-rose-600/25 border-rose-500 text-rose-200 font-bold option-selected-wrong';
                } else {
                    btn.className = 'quiz-option-tile w-full p-3 sm:p-3.5 rounded-xl border text-left flex items-start gap-3 transition-colors cursor-default bg-slate-900 border-slate-700/80 text-slate-300 opacity-75';
                }
            });
            if (q.explanation && !card.querySelector('.practice-explanation-box')) {
                const aiAnchor = document.getElementById(`ai-btn-${qKey}`)?.closest('div');
                const expHtml = `<div class="ui-accordion-wrap practice-explanation-accordion" aria-hidden="false"><div class="ui-accordion-inner"><div class="practice-explanation-box p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 leading-relaxed"><p class="font-bold text-amber-400 mb-1 flex items-center gap-1.5"><i class="fa-solid fa-lightbulb"></i> Giải thích chi tiết:</p><p>${this.formatScientificNotation(q.explanation)}</p></div></div></div>`;
                if (aiAnchor) {
                    aiAnchor.insertAdjacentHTML('beforebegin', expHtml);
                    const insertedWrap = aiAnchor.previousElementSibling;
                    this.renderMath(insertedWrap);
                    if (insertedWrap) {
                        void insertedWrap.offsetHeight;
                        window.requestAnimationFrame(() => {
                            insertedWrap.classList.add('is-open');
                        });
                    }
                }
            }
            return;
        }

        const scrollY = window.scrollY;
        this.renderAllQuestions(true, true);
        window.requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }

    selectTfOption(qId, stmtIdx, isTrue) {
        if (this.isFinishingQuiz || this.isReviewingResult) return;
        qId = this.allQuestions.find(item => String(item.id) === String(qId))?.id ?? qId;
        const currentAnswers = this.userAnswers[qId];
        const hasExistingAnswer = currentAnswers && typeof currentAnswers === 'object'
            && Object.prototype.hasOwnProperty.call(currentAnswers, stmtIdx);
        if (!this.isExamMode && hasExistingAnswer) {
            console.debug('[QuizApp] Bỏ qua lần chọn Đúng/Sai thứ hai:', { qId, stmtIdx, existing: currentAnswers[stmtIdx] });
            return;
        }

        if (!currentAnswers || typeof currentAnswers !== 'object' || Array.isArray(currentAnswers)) {
            this.userAnswers[qId] = {};
        }
        this.userAnswers[qId][stmtIdx] = Boolean(isTrue);
        console.debug('[QuizApp] Đã ghi nhận lựa chọn Đúng/Sai:', { qId, stmtIdx, answer: Boolean(isTrue) });
        this.saveAutoSaveProgress();
        this.updateLiveStats();

        // Cập nhật DOM cục bộ NGAY LẬP TỨC (0ms lag, không vẽ lại toàn bộ danh sách gây nhảy cuộn)
        const qKey = this.domKey(qId);
        const btnTrue = document.getElementById(`tf-btn-${qKey}-${stmtIdx}-true`);
        const btnFalse = document.getElementById(`tf-btn-${qKey}-${stmtIdx}-false`);
        if (btnTrue && btnFalse) {
            const q = this.allQuestions.find(item => String(item.id) === String(qId));
            const st = q?.statements?.[stmtIdx];
            const choice = Boolean(isTrue);

            if (this.isExamMode) {
                btnTrue.className = `tf-choice-button px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-bold ${choice === true ? 'is-exam-selected is-selected bg-sky-600 border-sky-500 text-white font-bold' : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'}`;
                btnFalse.className = `tf-choice-button px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-bold ${choice === false ? 'is-exam-selected is-selected bg-sky-600 border-sky-500 text-white font-bold' : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'}`;
                btnTrue.setAttribute('aria-pressed', String(choice === true));
                btnFalse.setAttribute('aria-pressed', String(choice === false));
            } else {
                const isCorrect = (choice === st?.answer);
                btnTrue.disabled = true;
                btnFalse.disabled = true;
                if (choice === true) {
                    btnTrue.className = `tf-choice-button px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-bold is-selected ${isCorrect ? 'is-selected-correct bg-emerald-600 border-emerald-500 text-white font-bold' : 'is-selected-wrong bg-rose-600 border-rose-500 text-white font-bold'}`;
                    btnFalse.className = 'tf-choice-button px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-bold is-locked bg-slate-900 border-slate-700 text-slate-300';
                } else {
                    btnFalse.className = `tf-choice-button px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-bold is-selected ${isCorrect ? 'is-selected-correct bg-emerald-600 border-emerald-500 text-white font-bold' : 'is-selected-wrong bg-rose-600 border-rose-500 text-white font-bold'}`;
                    btnTrue.className = 'tf-choice-button px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-bold is-locked bg-slate-900 border-slate-700 text-slate-300';
                }
                btnTrue.setAttribute('aria-pressed', String(choice === true));
                btnFalse.setAttribute('aria-pressed', String(choice === false));
            }
            return;
        }

        const scrollY = window.scrollY;
        this.renderAllQuestions(true, true);
        window.requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }

    buildShortAnswerFeedbackHtml(question, userVal) {
        return window.AppRender.buildShortAnswerFeedbackHtml(this, question, userVal);
    }

    saveShortAnswer(qId, val) {
        if (this.isFinishingQuiz || this.isReviewingResult) return;
        const question = this.allQuestions.find(item => String(item.id) === String(qId));
        if (!question || question.qType !== 'short_answer') return;
        if (!this.isExamMode && this.hasSubmittedAnswer(qId)) {
            console.debug('[QuizApp] Bỏ qua lần nhập trả lời ngắn thứ hai:', { qId, existing: this.userAnswers[qId] });
            return;
        }

        const normalizedValue = String(val ?? '').trim();
        if (!normalizedValue) {
            if (!this.isExamMode) return;
            delete this.userAnswers[qId];
            this.saveAutoSaveProgress();
            this.updateLiveStats();
            const qKey = this.domKey(qId);
            const card = document.getElementById(`q-card-${qKey}`);
            if (card) {
                const inputEl = card.querySelector('.answer-text-input');
                const submitBtn = card.querySelector('.answer-submit-button');
                if (inputEl) {
                    inputEl.value = '';
                    inputEl.classList.remove('is-submitted');
                }
                if (submitBtn) {
                    submitBtn.classList.remove('is-submitted');
                    submitBtn.innerHTML = '<i class="fa-solid fa-arrow-right"></i><span>Ghi nhận</span>';
                }
                card.querySelector('.short-answer-feedback')?.remove();
            }
            return;
        }
        this.userAnswers[qId] = normalizedValue;
        console.debug('[QuizApp] Đã ghi nhận trả lời ngắn:', { qId, answered: true });
        this.saveAutoSaveProgress();
        this.updateLiveStats();

        const qKey = this.domKey(qId);
        const card = document.getElementById(`q-card-${qKey}`);
        if (!card) {
            this.renderAllQuestions(true, true);
            return;
        }

        const isInputLocked = !this.isExamMode;
        const inputEl = card.querySelector('.answer-text-input');
        const submitBtn = card.querySelector('.answer-submit-button');
        if (inputEl) {
            inputEl.value = normalizedValue;
            inputEl.classList.add('is-submitted');
            inputEl.disabled = isInputLocked;
            inputEl.setAttribute('aria-disabled', String(isInputLocked));
        }
        if (submitBtn) {
            submitBtn.classList.add('is-submitted');
            submitBtn.disabled = isInputLocked;
            submitBtn.setAttribute('aria-disabled', String(isInputLocked));
            submitBtn.innerHTML = `<i class="fa-solid fa-check"></i><span>${this.isExamMode ? 'Cập nhật' : 'Đã ghi nhận'}</span>`;
        }

        const feedbackHtml = this.buildShortAnswerFeedbackHtml(question, normalizedValue);
        const existingFeedback = card.querySelector('.short-answer-feedback');
        if (existingFeedback) {
            existingFeedback.outerHTML = feedbackHtml;
        } else {
            const inputRow = inputEl?.closest('div');
            if (inputRow) inputRow.insertAdjacentHTML('afterend', feedbackHtml);
        }
        this.renderMath(card);
    }

    isQuestionWrong(q) {
        if (q.qType === 'short_answer') {
            const val = this.userAnswers[q.id];
            if (val === undefined) return false;
            return !this.isShortAnswerCorrect(q, val);
        } else if (q.qType === 'tf_group') {
            const ansObj = this.userAnswers[q.id] || {};
            return (q.statements || []).some((st, idx) => ansObj[idx] !== undefined && Boolean(ansObj[idx]) !== Boolean(st.answer));
        } else {
            const sel = this.userAnswers[q.id];
            if (sel === undefined) return false;
            const correctIdx = q.correct !== undefined ? q.correct : q.answer;
            return Number(sel) !== Number(correctIdx);
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
                    const isMatch = this.isShortAnswerCorrect(q, val);
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
                    if (Number(sel) === Number(correctIdx)) correctCount++; else wrongCount++;
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
        if (wrongBadge) wrongBadge.textContent = this.isExamMode ? '?' : wrongCount;

        const percent = totalItems > 0 ? Math.round((attemptedCount / totalItems) * 100) : 0;
        if (progressText) progressText.textContent = `Đã làm ${attemptedCount}/${totalItems} ý (${percent}%)`;
        if (progressBar) progressBar.style.width = `${percent}%`;

        this.queueStudentProgress(attemptedCount, totalItems, correctCount);
    }

    buildStudentProgressDetail() {
        return window.AppSync.buildStudentProgressDetail(this);
    }

    queueStudentProgress(attemptedCount, totalItems, correctCount) {
        return window.AppSync.queueStudentProgress(this, attemptedCount, totalItems, correctCount);
    }

    async flushStudentProgress(attemptId = this.quizAttemptId) {
        return window.AppSync.flushStudentProgress(this, attemptId);
    }

    startStopwatch() {
        clearInterval(this.scheduleCloseTimer);
        const closeMs = this.getSubjectScheduleState(this.getCurrentSubjectObj()).closeMs;
        this._scheduleCloseWarned = false;
        if (closeMs && !this.hasAdminBypass()) {
            this.scheduleCloseTimer = setInterval(() => {
                const remaining = closeMs - this.getServerNowMs();
                if (remaining <= 60000 && remaining > 0 && !this._scheduleCloseWarned) {
                    this._scheduleCloseWarned = true;
                    this.showToastNotification('⏰ Sắp hết giờ mở đề! Hệ thống sẽ tự nộp bài sau 60 giây.', 'warning');
                }
                if (remaining <= 0) { clearInterval(this.scheduleCloseTimer); this.finishQuiz('schedule-closed'); }
            }, 1000);
        }
        clearInterval(this.timerInterval);
        this.awayStartedAt = null;
        this.lastQuizActivityAt = Date.now();
        this.startIdleAutoSubmitTimer('quiz started');
        const timerDisplay = document.getElementById('timer-display');
        if (timerDisplay) timerDisplay.classList.remove('timer-critical-pulse');

        if (this.isExamMode) {
            this.examSecondsRemaining = this.examMinutes * 60;
            if (timerDisplay) {
                timerDisplay.textContent = `${String(this.examMinutes).padStart(2, '0')}:00`;
                timerDisplay.classList.toggle('timer-critical-pulse', this.examSecondsRemaining <= 10 && this.examSecondsRemaining > 0);
            }
            this.timerInterval = setInterval(() => {
                if (this.checkAndAutoSubmitIfStale('tick')) return;
                this.examSecondsRemaining--;
                if (this.examSecondsRemaining <= 0) {
                    clearInterval(this.timerInterval);
                    if (timerDisplay) timerDisplay.classList.remove('timer-critical-pulse');
                    this.showAlertModal("⏰ ĐÃ HẾT GIỜ LÀM BÀI! Hệ thống đang tự động nộp bài của bạn.");
                    this.finishQuiz('time-expired');
                    return;
                }
                const m = Math.floor(this.examSecondsRemaining / 60);
                const s = this.examSecondsRemaining % 60;
                if (timerDisplay) {
                    timerDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                    timerDisplay.classList.toggle('timer-critical-pulse', this.examSecondsRemaining <= 10 && this.examSecondsRemaining > 0);
                }
            }, 1000);
        } else {
            this.secondsElapsed = 0;
            this.timerInterval = setInterval(() => {
                if (this.checkAndAutoSubmitIfStale('tick')) return;
                this.secondsElapsed++;
                const m = Math.floor(this.secondsElapsed / 60);
                const s = this.secondsElapsed % 60;
                if (timerDisplay) timerDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            }, 1000);
        }
    }

    checkAndAutoSubmitIfStale(reason = '') {
        if (this.currentScreen !== 'quiz' || this.isReviewingResult || this.isFinishingQuiz || this.hasAdminBypass()) return false;
        const now = Date.now();
        if (this.awayStartedAt && (now - this.awayStartedAt >= 5 * 60 * 1000)) {
            this.showToastNotification('⏰ Bạn đã rời khỏi bài thi quá 5 phút. Hệ thống đã tự động nộp bài để bảo toàn kết quả.', 'warning');
            this.finishQuiz('away');
            return true;
        }
        if (this.lastQuizActivityAt && (now - this.lastQuizActivityAt >= 5 * 60 * 1000)) {
            this.showToastNotification('⏰ Bạn không thao tác trong 5 phút. Hệ thống đã tự động nộp bài để bảo toàn kết quả.', 'warning');
            this.finishQuiz('idle');
            return true;
        }
        return false;
    }

    startAwayAutoSubmitTimer(reason = 'unknown') {
        if (this.currentScreen !== 'quiz' || this.isFinishingQuiz) return;
        if (this.hasAdminBypass()) return;
        if (this.awayAutoSubmitTimer !== null) {
            console.debug('[QuizApp] Away auto-submit timer already running:', { reason });
            return;
        }
        const delayMs = 5 * 60 * 1000;
        console.debug('[QuizApp] Away auto-submit timer started:', { reason, delayMs });
        if (this.hasAdminBypass()) return;
        if (!this.awayStartedAt) this.awayStartedAt = Date.now();
        if (Date.now() - this.awayStartedAt >= 5 * 60 * 1000) {
            this.finishQuiz('away');
            return;
        }
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
        if (this.hasAdminBypass()) return;
        if (this.idleAutoSubmitTimer !== null) return;
        const delayMs = 5 * 60 * 1000;
        console.debug('[QuizApp] Idle auto-submit timer started:', { reason, delayMs });
        if (this.hasAdminBypass()) return;
        this.lastQuizActivityAt = Date.now();
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
        if (this.hasAdminBypass()) return;
        this.lastQuizActivityAt = Date.now();
        this.cancelIdleAutoSubmitTimer(reason);
        this.startIdleAutoSubmitTimer(reason);
    }

    cancelAwayAutoSubmitTimer(reason = 'unknown') {
        const hadTimer = this.awayAutoSubmitTimer !== null;
        if (hadTimer) {
            clearTimeout(this.awayAutoSubmitTimer);
            this.awayAutoSubmitTimer = null;
        }
        this.awayStartedAt = null;
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
        clearInterval(this.scheduleCloseTimer);
        this.scheduleCloseTimer = null;
        clearInterval(this.timerInterval);
        document.getElementById('timer-display')?.classList.remove('timer-critical-pulse');
        this.cancelAwayAutoSubmitTimer('stop stopwatch');
        this.awayStartedAt = null;
        this.lastQuizActivityAt = null;
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
        return window.AppSync.finishQuiz(this, autoSubmitReason);
    }

    backToResultScreen() {
        this.switchScreen('result');
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
        const optChars = ['A', 'B', 'C', 'D', 'E', 'F'];

        questions.forEach((q, idx) => {
            const qKey = this.domKey(q.id);
            const card = document.createElement('div');
            card.className = "p-4 sm:p-5 rounded-2xl glass-card-pro border border-slate-700/80 text-xs space-y-3";

            let ansReview = '';
            if (q.qType === 'short_answer') {
                const userVal = this.userAnswers[q.id];
                const isMatch = userVal !== undefined && this.isShortAnswerCorrect(q, userVal);
                const correctVal = String(q.correctValue ?? q.acceptedValues?.[0] ?? '').trim();
                ansReview = `
                    <div class="p-2.5 rounded-xl ${isMatch ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'} font-bold">
                        Đáp án của bạn: ${userVal !== undefined && String(userVal).trim() !== '' ? this.escapeHtml(userVal) : 'Chưa trả lời'} • Đáp án đúng: ${correctVal ? this.formatScientificNotation(correctVal) : 'Chưa thiết lập'}
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
                const isCorrect = sel !== undefined && Number(sel) === Number(correctIdx);
                const selText = sel !== undefined && q.options?.[sel] ? `${optChars[sel]}. ${this.formatScientificNotation(q.options[sel])}` : (sel !== undefined ? optChars[sel] : 'Chưa chọn');
                const correctText = q.options?.[correctIdx] ? `${optChars[correctIdx]}. ${this.formatScientificNotation(q.options[correctIdx])}` : (optChars[correctIdx] || '—');
                ansReview = `
                    <div class="p-2.5 rounded-xl ${isCorrect ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'} font-semibold space-y-1">
                        <div>Bạn chọn: <strong>${selText}</strong></div>
                        <div>Đáp án đúng: <strong>${correctText}</strong></div>
                    </div>
                `;
            }

            const safeReviewImg = this.sanitizeMediaUrl(q.image_url || q.imageUrl);
            const reviewImgHtml = safeReviewImg ? `
                <div class="rounded-xl overflow-hidden border border-slate-700/70 bg-slate-950/50 p-2 flex justify-center">
                    <img src="${this.escapeHtml(safeReviewImg)}" alt="Hình minh họa câu ${idx + 1}" class="max-h-56 w-auto object-contain rounded-lg" loading="lazy">
                </div>
            ` : '';

            card.innerHTML = `
                <div class="flex items-center justify-between font-bold text-white">
                    <span>Câu ${idx + 1}: ${this.formatScientificNotation(q.question)}</span>
                </div>
                ${reviewImgHtml}
                ${ansReview}
                ${q.explanation ? `<p class="text-[11px] text-slate-300 italic leading-relaxed"><strong class="text-amber-400">Giải thích:</strong> ${this.formatScientificNotation(q.explanation)}</p>` : ''}
                <div class="mt-2.5 pt-2 border-t border-slate-700/60 flex items-center justify-between gap-2 flex-wrap">
                    <button type="button" onclick="app.askAiExplanation(${this.attrArg(q.id)})" id="ai-btn-review-${qKey}" class="btn-3d px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer">
                        <i class="fa-solid fa-robot text-amber-300"></i>
                        <span>Hỏi AI giải thích chi tiết</span>
                    </button>
                    <span class="text-[11px] text-blue-300/80 font-medium flex items-center gap-1"><i class="fa-solid fa-bolt text-amber-400 text-[10px]"></i> AI Sư Phạm</span>
                </div>
                <div id="ai-explanation-review-${qKey}" class="ui-accordion-wrap" aria-hidden="true"><div class="ui-accordion-inner"><div class="p-3.5 rounded-2xl ai-explanation-box text-xs text-slate-200 space-y-2"></div></div></div>
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
            return this.isShortAnswerCorrect(q, val);
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
            } else if (this.isQuestionWrong(q)) {
                // Chỉ thêm vào ngân hàng câu sai khi học sinh thực sự đã làm nhưng sai (không tính câu bỏ trống)
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
                badgeAllCorrect.classList.toggle('hidden', !(this._lastResultCorrectCount === this._lastResultTotalQuestions && this._lastResultTotalQuestions > 0));
            }
        }
    }

    async startMistakeQuiz() {
        return this.startRevengeQuiz();
    }

    async startRevengeQuiz() {
        // Tuyệt đối không bắt học sinh phải thoát ra màn hình chính hay chọn lại môn
        const isAdminBypass = this.hasAdminBypass();
        const { gradeRoster } = this.getRosterGradeConfig();
        let rawName = this.pinnedDeviceName || this.playerName || (document.getElementById('player-name-input')?.value.trim()) || (!isAdminBypass ? localStorage.getItem('quiz_user_name') : '') || '';
        if (!isAdminBypass && gradeRoster?.enabled && !this.isOutsideGuestMode && !this.pinnedDeviceName) {
            const match = (gradeRoster.students || []).map((s) => typeof s === 'string' ? s : s?.name).find((s) => this.normalizeRosterSearch(s) === this.normalizeRosterSearch(rawName));
            if (!match) { this.showPlayerNameError('Vui lòng chọn đúng tên trong Danh sách lớp.'); document.getElementById('player-name-roster-dropdown')?.classList.remove('hidden'); this.renderRosterSuggestions(); return; }
            rawName = match;
        }
        let name = rawName || 'Admin';
        if (!isAdminBypass) {
            const nameCheck = this.validateStudentNameInput(rawName);
            if (!nameCheck.valid) {
                this.switchScreen('home');
                this.showPlayerNameError(nameCheck.reason);
                this.showToastNotification(`⚠️ ${nameCheck.reason}`, 'warning');
                return;
            }
            name = nameCheck.normalized;
        }
        this.playerName = name;
        this.currentAttemptOutsideRoster = Boolean(!isAdminBypass && gradeRoster?.enabled && this.isOutsideGuestMode);
        this._draftPlayerName = isAdminBypass ? rawName : name;
        this.isPlayerNameCommitted = true;
        this.currentLoginId = null;
        if (!isAdminBypass) {
            try { localStorage.setItem('quiz_user_name', name); } catch (e) {}
        }

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
        this.isReviewingResult = false;
        this.isFinishingQuiz = false;
        document.getElementById('btn-back-to-result')?.classList.add('hidden');
        document.getElementById('btn-submit-quiz')?.classList.remove('hidden');
        this.setExamMode(false);
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

        if (!isAdminBypass && window.dbService && typeof window.dbService.recordLogin === 'function') {
            this.quizAttemptId = (window.dbService.generateUUID ? window.dbService.generateUUID() : `attempt_${Date.now()}_${Math.random().toString(36).slice(2)}`);
            this.pendingStudentProgress = null;
            this.progressSyncRunning = false;
            const attemptId = this.quizAttemptId;
            this.loginRecordPromise = window.dbService.recordLogin({
                playerName: this.playerName,
                clientIp: this.clientIp,
                deviceInfo: this.deviceInfo,
                subjectTitle: `[Phục thù] ${this.getSubjectTitle()}`,
                status: `Đang làm bài${this.currentAttemptOutsideRoster ? ' [Ngoài lớp]' : ''}`,
                scoreSummary: `[Bắt đầu Đề Phục Thù: ${mistakeQuestions.length} câu]${this.currentAttemptOutsideRoster ? ' [Ngoài lớp]' : ''}`,
                sessionId: this.getOrCreateClientSessionId(),
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

    }

    const descriptors = Object.getOwnPropertyDescriptors(QuizAppQuizMixin.prototype);
    delete descriptors.constructor;
    Object.defineProperties(QuizApp.prototype, descriptors);

    // Giữ kết quả chấm short-answer nhất quán với giao diện và thống kê trực tiếp.
    const buildProgressDetail = QuizApp.prototype.buildStudentProgressDetail;
    QuizApp.prototype.buildStudentProgressDetail = function () {
        const detail = buildProgressDetail.call(this);
        if (!detail || !Array.isArray(detail.items)) return detail;
        (this.allQuestions || []).forEach((q) => {
            if (q.qType !== 'short_answer') return;
            const item = detail.items.find((entry) => String(entry.id) === String(q.id));
            if (!item) return;
            const value = this.userAnswers?.[q.id];
            const hasValue = value !== undefined && String(value).trim() !== '';
            const nextOk = hasValue ? this.isShortAnswerCorrect(q, value) : null;
            if (item.ok === nextOk) return;
            const cat = detail.cats?.[item.cat];
            if (cat && item.ok === true) cat[0] = Math.max(0, cat[0] - 1);
            if (cat && nextOk === true) cat[0] += 1;
            item.ok = nextOk;
        });
        return detail;
    };

    // Lưu snapshot thời gian trong lúc bài thi đang chạy, không chỉ khi đổi đáp án.
    const originalStartStopwatch = QuizApp.prototype.startStopwatch;
    const originalStopStopwatch = QuizApp.prototype.stopStopwatch;
    QuizApp.prototype.startStopwatch = function () {
        const result = originalStartStopwatch.call(this);
        clearInterval(this._quizAutosaveTimer);
        this.saveAutoSaveProgress();
        this._quizAutosaveTimer = window.setInterval(() => {
            if (this.currentScreen === 'quiz' && !this.isFinishingQuiz) this.saveAutoSaveProgress();
        }, 5000);
        return result;
    };
    QuizApp.prototype.stopStopwatch = function () {
        clearInterval(this._quizAutosaveTimer);
        this._quizAutosaveTimer = null;
        this.saveAutoSaveProgress();
        return originalStopStopwatch.call(this);
    };

    // Nếu updateLoginStatus lỗi/ret false, cho phép nộp lại và hoàn tác lượt cục bộ.
    const originalFinishQuiz = QuizApp.prototype.finishQuiz;
    QuizApp.prototype.finishQuiz = async function (autoSubmitReason = '') {
        const updateLoginStatus = window.dbService?.updateLoginStatus;
        const previousLoginId = this.currentLoginId;
        const subject = this.getCurrentSubjectObj?.();
        const attemptKey = this.getSubjectAttemptStorageKey?.(subject?.key || this.currentSubject, this.playerName);
        const attemptsBefore = attemptKey ? localStorage.getItem(attemptKey) : null;
        let cloudAttempted = false;
        let cloudConfirmed = false;
        if (typeof updateLoginStatus === 'function') {
            window.dbService.updateLoginStatus = async (...args) => {
                cloudAttempted = true;
                const result = await updateLoginStatus.apply(window.dbService, args);
                cloudConfirmed = result === true;
                return result;
            };
        }
        try {
            await originalFinishQuiz.call(this, autoSubmitReason);
        } finally {
            if (typeof updateLoginStatus === 'function') window.dbService.updateLoginStatus = updateLoginStatus;
        }
        if (cloudAttempted && !cloudConfirmed) {
            if (attemptKey) {
                try {
                    if (attemptsBefore === null) localStorage.removeItem(attemptKey);
                    else localStorage.setItem(attemptKey, attemptsBefore);
                } catch (e) {}
            }
            this.currentLoginId = previousLoginId;
            this.isFinishingQuiz = false;
            this.isReviewingResult = false;
            this.switchScreen('quiz');
            this.renderAllQuestions(true, true);
            this.startStopwatch();
            const submitButton = document.getElementById('btn-submit-quiz');
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.classList.remove('opacity-60', 'cursor-not-allowed');
                submitButton.removeAttribute('aria-busy');
            }
            this.showToastNotification?.('Không thể kết nối máy chủ. Bài làm vẫn được giữ lại, hãy thử nộp lại.', 'warning');
        }
    };

    if (!root.app) root.app = new QuizApp();
})(window);
