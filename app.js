/**
 * app.js - Logic điều phối ứng dụng trắc nghiệm Lịch Sử 11
 * Chế độ: Cuộn dọc liên tục, Phản hồi đáp án tức thì (Instant Feedback), Không xáo trộn đáp án
 */

class QuizApp {
    constructor() {
        // Thông tin người học & Thời gian
        this.playerName = "";
        this.secondsElapsed = 0;
        this.timerInterval = null;

        // Dữ liệu câu hỏi & Trạng thái làm bài
        this.allQuestions = window.QUIZ_QUESTIONS ? [...window.QUIZ_QUESTIONS] : [];
        this.userAnswers = {};      // { [qId]: selectedIndex hoặc { [stmtIdx]: boolean } }
        this.currentFilter = 'all';

        // Quyền quản trị Admin
        this.isAdminAuthenticated = false;
        this.adminCurrentTab = 'questions';
        this.adminSecretPass = '034569';

        // Cache màn hình
        this.screens = {
            home: document.getElementById('screen-home'),
            quiz: document.getElementById('screen-quiz'),
            result: document.getElementById('screen-result'),
            leaderboard: document.getElementById('screen-leaderboard')
        };

        this.initEventListeners();
        this.loadQuestionsFromDb();
        this.updateTotalQuestionDisplay();
    }

    /**
     * Tải câu hỏi mới nhất từ Supabase Cloud Database (hoặc LocalStorage)
     */
    async loadQuestionsFromDb() {
        if (window.dbService) {
            try {
                const list = await window.dbService.fetchQuestionsOnline();
                if (list && list.length > 0) {
                    this.allQuestions = list;
                    this.updateTotalQuestionDisplay();
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
            const savedName = localStorage.getItem('quiz_last_player_name');
            if (savedName) {
                nameInput.value = savedName;
            }
        }

        // Phím tắt mở Admin: Alt + A
        window.addEventListener('keydown', (e) => {
            if (e.altKey && (e.key === 'a' || e.key === 'A' || e.code === 'KeyA')) {
                e.preventDefault();
                this.promptAdminAuth();
            }
        });
    }

    updateTotalQuestionDisplay() {
        const countSpan = document.getElementById('info-total-questions');
        const count = (this.allQuestions && this.allQuestions.length > 0) 
            ? this.allQuestions.length 
            : 74;
            
        if (countSpan) {
            countSpan.textContent = `${count} câu`;
        }
        const badgeAdmin = document.getElementById('admin-badge-q-count');
        if (badgeAdmin) {
            badgeAdmin.textContent = count;
        }
    }

    switchScreen(targetScreenName) {
        Object.keys(this.screens).forEach(screenName => {
            const screen = this.screens[screenName];
            if (screenName === targetScreenName) {
                screen.classList.remove('hidden');
            } else {
                screen.classList.add('hidden');
            }
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /**
     * Bắt đầu bài làm (Giữ nguyên 100% thứ tự câu hỏi và thứ tự đáp án A, B, C, D)
     */
    startQuiz() {
        const nameInput = document.getElementById('player-name-input');
        const nameError = document.getElementById('player-name-error');
        const rawName = nameInput ? nameInput.value.trim() : "";

        if (!rawName) {
            if (nameError) nameError.classList.remove('hidden');
            if (nameInput) nameInput.focus();
            return;
        }

        if (nameError) nameError.classList.add('hidden');
        this.playerName = rawName;
        localStorage.setItem('quiz_last_player_name', rawName);

        // Hiển thị tên người chơi ở thanh điều hướng trên cùng
        const headerName = document.getElementById('quiz-header-player-name');
        if (headerName) headerName.textContent = rawName;

        // Reset trạng thái làm bài
        this.userAnswers = {};
        this.secondsElapsed = 0;
        this.currentFilter = 'all';

        // Bắt đầu bấm giờ (Đếm tiến thời gian thực)
        this.startStopwatch();

        // Render toàn bộ câu hỏi thành một hàng dài cuộn dọc
        this.renderAllQuestions();
        this.updateLiveStats();

        // Chuyển sang màn hình làm bài
        this.switchScreen('quiz');
    }

    /**
     * Đồng hồ đếm tiến (Stopwatch) không giới hạn thời gian
     */
    startStopwatch() {
        clearInterval(this.timerInterval);
        this.updateStopwatchDisplay();

        this.timerInterval = setInterval(() => {
            this.secondsElapsed++;
            this.updateStopwatchDisplay();
        }, 1000);
    }

    updateStopwatchDisplay() {
        const timerDisplay = document.getElementById('timer-display');
        const minutes = Math.floor(this.secondsElapsed / 60);
        const seconds = this.secondsElapsed % 60;
        const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        if (timerDisplay) {
            timerDisplay.textContent = formatted;
        }
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
            : (window.QUIZ_QUESTIONS || []);

        let filtered = questions.filter(q => {
            if (this.currentFilter === 'all') return true;
            if (this.currentFilter === 'b1') return (q.category || '').includes('Bài 1');
            if (this.currentFilter === 'b2') return (q.category || '').includes('Bài 2');
            if (this.currentFilter === 'mcq') return q.qType !== 'tf_group';
            if (this.currentFilter === 'tf') return q.qType === 'tf_group';
            if (this.currentFilter === 'wrong') return this.isQuestionWrong(q);
            return true;
        });

        if (filtered.length === 0) {
            if (this.currentFilter === 'wrong') {
                container.innerHTML = `
                    <div class="text-center py-12 bg-slate-800/60 rounded-2xl border border-slate-700/60 p-6">
                        <i class="fa-solid fa-circle-check text-4xl text-emerald-400 mb-3"></i>
                        <h4 class="font-bold text-white text-base mb-1">Hiện tại bạn chưa làm sai câu nào!</h4>
                        <p class="text-xs text-slate-400 mb-4">Các câu trả lời chưa đúng sẽ tự động được lọc tại đây để bạn ôn lại.</p>
                        <button onclick="app.filterQuestions('all')" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold">Xem tất cả câu hỏi</button>
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
            card.className = "p-5 sm:p-6 rounded-2xl bg-slate-800/60 backdrop-blur-xl border border-slate-700/60 shadow-xl transition-all duration-200 hover:border-slate-600";

            if (q.qType === 'tf_group' && Array.isArray(q.statements)) {
                card.innerHTML = this.buildTrueFalseQuestionHTML(q);
            } else {
                card.innerHTML = this.buildMCQQuestionHTML(q);
            }

            container.appendChild(card);
        });
    }

    /**
     * Tạo HTML cho câu hỏi trắc nghiệm 4 lựa chọn (A, B, C, D)
     */
    buildMCQQuestionHTML(q) {
        const letters = ['A', 'B', 'C', 'D'];
        const userAnswer = this.userAnswers[q.id];
        const isAnswered = userAnswer !== undefined;
        const isCorrect = isAnswered && (userAnswer === q.correct);

        let optionsHtml = '';
        q.options.forEach((optText, optIdx) => {
            const letter = letters[optIdx];
            const isChosen = userAnswer === optIdx;
            const isTheRightOne = optIdx === q.correct;

            let btnClasses = "w-full text-left p-3.5 rounded-xl border transition-all duration-200 flex items-start gap-3 mb-2.5 text-xs sm:text-sm ";
            let iconHtml = `<span class="w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center font-bold text-xs bg-slate-800 text-slate-400 border border-slate-700">${letter}</span>`;

            if (!isAnswered) {
                btnClasses += "border-slate-700/80 bg-slate-900/60 hover:bg-slate-800/80 hover:border-indigo-500/50 text-slate-200 cursor-pointer";
            } else {
                if (isTheRightOne) {
                    btnClasses += "border-emerald-500/80 bg-emerald-950/40 text-emerald-200 font-semibold cursor-default";
                    iconHtml = `<span class="w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center font-bold text-xs bg-emerald-600 text-white"><i class="fa-solid fa-check"></i></span>`;
                } else if (isChosen && !isTheRightOne) {
                    btnClasses += "border-rose-500/80 bg-rose-950/40 text-rose-200 line-through cursor-default";
                    iconHtml = `<span class="w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center font-bold text-xs bg-rose-600 text-white"><i class="fa-solid fa-xmark"></i></span>`;
                } else {
                    btnClasses += "border-slate-800 bg-slate-900/40 text-slate-500 opacity-50 cursor-default";
                }
            }

            optionsHtml += `
                <button type="button" ${isAnswered ? 'disabled' : ''} onclick="app.selectMCQAnswer(${q.id}, ${optIdx})" class="${btnClasses}">
                    ${iconHtml}
                    <span class="pt-0.5 leading-relaxed font-normal">${this.escapeHtml(optText)}</span>
                </button>
            `;
        });

        // Hộp giải thích hiển thị ngay khi vừa ấn chọn
        let explanationBox = '';
        if (isAnswered) {
            explanationBox = `
                <div class="mt-4 p-4 rounded-xl border text-xs leading-relaxed animate-fadeIn ${
                    isCorrect 
                        ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200' 
                        : 'border-rose-500/40 bg-rose-950/30 text-rose-200'
                }">
                    <div class="flex items-center gap-2 mb-1.5 font-bold">
                        <i class="fa-solid ${isCorrect ? 'fa-circle-check text-emerald-400' : 'fa-circle-xmark text-rose-400'} text-sm"></i>
                        <span>${isCorrect ? 'Chính xác! 🎉' : 'Chưa đúng ❌'}</span>
                        <span class="text-slate-400 font-normal">| Đáp án đúng: <strong class="text-emerald-300 font-bold">${letters[q.correct]}</strong></span>
                    </div>
                    <p class="text-slate-300 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 mt-2">
                        <i class="fa-regular fa-lightbulb text-amber-400 mr-1.5"></i>
                        ${this.escapeHtml(q.explanation || "Đáp án đúng theo chuẩn kiến thức Lịch Sử 11.")}
                    </p>
                </div>
            `;
        }

        return `
            <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                    <span class="px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 font-bold text-xs border border-indigo-500/30">
                        Câu ${q.id}
                    </span>
                    <span class="text-xs font-semibold text-slate-400">${this.escapeHtml(q.category || 'Lịch Sử 11')}</span>
                </div>
                ${isAnswered ? (isCorrect ? '<span class="text-xs font-bold text-emerald-400 flex items-center gap-1"><i class="fa-solid fa-check"></i> Đúng</span>' : '<span class="text-xs font-bold text-rose-400 flex items-center gap-1"><i class="fa-solid fa-xmark"></i> Sai</span>') : ''}
            </div>

            <h3 class="font-heading text-sm sm:text-base font-bold text-slate-100 mb-4 leading-relaxed">
                ${this.escapeHtml(q.question)}
            </h3>

            <div class="space-y-2">
                ${optionsHtml}
            </div>

            ${explanationBox}
        `;
    }

    /**
     * Tạo HTML cho câu hỏi trắc nghiệm Đúng - Sai (gồm 4 ý a, b, c, d)
     */
    buildTrueFalseQuestionHTML(q) {
        const ansObj = this.userAnswers[q.id] || {};
        const stmts = q.statements || [];

        let stmtsHtml = '';
        stmts.forEach((st, idx) => {
            const chosen = ansObj[idx];
            const isStmtAnswered = chosen !== undefined;
            const isCorrect = isStmtAnswered && (Boolean(chosen) === Boolean(st.answer));

            let rowClass = "p-3 sm:p-3.5 rounded-xl border mb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm ";
            if (!isStmtAnswered) {
                rowClass += "border-slate-700/60 bg-slate-900/50";
            } else {
                rowClass += isCorrect ? "border-emerald-500/40 bg-emerald-950/20" : "border-rose-500/40 bg-rose-950/20";
            }

            // Nút ĐÚNG
            let btnTrueClass = "px-3.5 py-1.5 rounded-lg border font-bold text-xs transition cursor-pointer ";
            if (!isStmtAnswered) {
                btnTrueClass += "bg-slate-800 hover:bg-emerald-600/30 text-slate-300 border-slate-700";
            } else if (st.answer === true) {
                btnTrueClass += "bg-emerald-600 text-white border-emerald-500 shadow-sm";
            } else if (chosen === true && st.answer === false) {
                btnTrueClass += "bg-rose-600 text-white border-rose-500 line-through";
            } else {
                btnTrueClass += "bg-slate-900/60 text-slate-500 border-slate-800 opacity-40 cursor-default";
            }

            // Nút SAI
            let btnFalseClass = "px-3.5 py-1.5 rounded-lg border font-bold text-xs transition cursor-pointer ";
            if (!isStmtAnswered) {
                btnFalseClass += "bg-slate-800 hover:bg-rose-600/30 text-slate-300 border-slate-700";
            } else if (st.answer === false) {
                btnFalseClass += "bg-emerald-600 text-white border-emerald-500 shadow-sm";
            } else if (chosen === false && st.answer === true) {
                btnFalseClass += "bg-rose-600 text-white border-rose-500 line-through";
            } else {
                btnFalseClass += "bg-slate-900/60 text-slate-500 border-slate-800 opacity-40 cursor-default";
            }

            let stmtExplanation = '';
            if (isStmtAnswered) {
                stmtExplanation = `
                    <div class="w-full text-xs text-slate-300 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 mt-2">
                        <span class="font-bold text-amber-400 mr-1">Đáp án: ${st.answer ? 'ĐÚNG' : 'SAI'}</span> - ${this.escapeHtml(st.explanation || '')}
                    </div>
                `;
            }

            stmtsHtml += `
                <div class="${rowClass}">
                    <div class="flex items-start gap-2.5 flex-1">
                        <span class="w-6 h-6 rounded-md bg-amber-500/20 text-amber-300 font-bold text-xs flex items-center justify-center shrink-0 border border-amber-500/30 mt-0.5">
                            ${st.key || ['a','b','c','d'][idx]})
                        </span>
                        <div class="flex-1">
                            <p class="leading-relaxed text-slate-200">${this.escapeHtml(st.text)}</p>
                            ${stmtExplanation}
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <button type="button" ${isStmtAnswered ? 'disabled' : ''} onclick="app.selectTrueFalseAnswer(${q.id}, ${idx}, true)" class="${btnTrueClass}">
                            <i class="fa-solid fa-check mr-1"></i> Đúng
                        </button>
                        <button type="button" ${isStmtAnswered ? 'disabled' : ''} onclick="app.selectTrueFalseAnswer(${q.id}, ${idx}, false)" class="${btnFalseClass}">
                            <i class="fa-solid fa-xmark mr-1"></i> Sai
                        </button>
                    </div>
                </div>
            `;
        });

        return `
            <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                    <span class="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 font-bold text-xs border border-amber-500/30">
                        Câu ${q.id} (Đúng - Sai)
                    </span>
                    <span class="text-xs font-semibold text-slate-400">${this.escapeHtml(q.category || 'Đúng - Sai')}</span>
                </div>
            </div>

            <!-- Khung tư liệu / Đoạn dẫn -->
            <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-700/80 text-xs sm:text-sm text-slate-200 leading-relaxed whitespace-pre-line mb-4 font-normal shadow-inner">
                ${this.escapeHtml(q.question)}
            </div>

            <div class="space-y-2">
                ${stmtsHtml}
            </div>
        `;
    }

    /**
     * Xử lý khi thí sinh chọn đáp án MCQ (Phản hồi tức thì)
     */
    selectMCQAnswer(questionId, optionIndex) {
        if (this.userAnswers[questionId] !== undefined) return;
        this.userAnswers[questionId] = optionIndex;

        // Cập nhật thẻ câu hỏi cụ thể trong DOM
        const card = document.getElementById(`q-card-${questionId}`);
        const q = this.allQuestions.find(item => item.id === questionId);
        if (card && q) {
            card.innerHTML = this.buildMCQQuestionHTML(q);
        }

        this.updateLiveStats();
    }

    /**
     * Xử lý khi thí sinh chọn Đúng/Sai cho từng mệnh đề (Phản hồi tức thì)
     */
    selectTrueFalseAnswer(questionId, stmtIndex, boolVal) {
        if (!this.userAnswers[questionId] || typeof this.userAnswers[questionId] !== 'object') {
            this.userAnswers[questionId] = {};
        }
        if (this.userAnswers[questionId][stmtIndex] !== undefined) return;
        this.userAnswers[questionId][stmtIndex] = Boolean(boolVal);

        // Cập nhật thẻ câu hỏi trong DOM
        const card = document.getElementById(`q-card-${questionId}`);
        const q = this.allQuestions.find(item => item.id === questionId);
        if (card && q) {
            card.innerHTML = this.buildTrueFalseQuestionHTML(q);
        }

        this.updateLiveStats();
    }

    /**
     * Kiểm tra xem câu hỏi có bị làm sai ít nhất 1 ý hay không
     */
    isQuestionWrong(q) {
        if (q.qType === 'tf_group' && Array.isArray(q.statements)) {
            const ansObj = this.userAnswers[q.id];
            if (!ansObj || typeof ansObj !== 'object') return false;
            return q.statements.some((st, idx) => ansObj[idx] !== undefined && Boolean(ansObj[idx]) !== Boolean(st.answer));
        } else {
            const ans = this.userAnswers[q.id];
            if (ans === undefined) return false;
            return ans !== q.correct;
        }
    }

    /**
     * Cập nhật điểm số thời gian thực và thanh tiến trình
     */
    updateLiveStats() {
        let correctCount = 0;
        let attemptedCount = 0;
        let wrongCount = 0;

        const questions = (this.allQuestions && this.allQuestions.length > 0) 
            ? this.allQuestions 
            : (window.QUIZ_QUESTIONS || []);

        questions.forEach(q => {
            if (q.qType === 'tf_group' && Array.isArray(q.statements)) {
                const ansObj = this.userAnswers[q.id] || {};
                let hasWrong = false;
                q.statements.forEach((st, idx) => {
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
                if (this.userAnswers[q.id] !== undefined) {
                    attemptedCount++;
                    if (this.userAnswers[q.id] === q.correct) {
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
        const progressBar = document.getElementById('quiz-progress-bar');
        const progressText = document.getElementById('quiz-progress-text');

        if (liveScore) liveScore.textContent = correctCount;
        if (attemptedEl) attemptedEl.textContent = attemptedCount;
        if (wrongBadge) wrongBadge.textContent = wrongCount;

        // Tổng số mục (65 trắc nghiệm + 36 ý đúng sai = 101 mục)
        const totalItems = 101;
        const percent = Math.min(100, Math.round((attemptedCount / totalItems) * 100));

        if (progressBar) progressBar.style.width = `${percent}%`;
        if (progressText) progressText.textContent = `Đã làm ${attemptedCount}/${totalItems} ý (${percent}%)`;
    }

    /**
     * Lọc danh sách câu hỏi theo danh mục
     */
    filterQuestions(filterKey) {
        this.currentFilter = filterKey;

        document.querySelectorAll('.filter-tab-btn').forEach(btn => {
            if (btn.getAttribute('data-filter') === filterKey) {
                btn.className = "filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-indigo-600 text-white cursor-pointer";
            } else {
                btn.className = "filter-tab-btn px-3 py-1 rounded-full font-semibold transition bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer";
            }
        });

        const wrongBtn = document.getElementById('btn-filter-wrong');
        if (wrongBtn) {
            if (filterKey === 'wrong') {
                wrongBtn.classList.add('ring-2', 'ring-rose-500', 'bg-rose-600/40');
            } else {
                wrongBtn.classList.remove('ring-2', 'ring-rose-500', 'bg-rose-600/40');
            }
        }

        this.renderAllQuestions();
        window.scrollTo({ top: 100, behavior: 'smooth' });
    }

    /**
     * Xác nhận và nộp bài
     */
    confirmSubmit() {
        if (window.confirm("Bạn có chắc chắn muốn nộp bài và tổng kết điểm không?")) {
            this.submitQuiz();
        }
    }

    async submitQuiz() {
        clearInterval(this.timerInterval);

        let totalItems = 0;
        let correctCount = 0;

        const questions = (this.allQuestions && this.allQuestions.length > 0) 
            ? this.allQuestions 
            : (window.QUIZ_QUESTIONS || []);

        questions.forEach(q => {
            if (q.qType === 'tf_group' && Array.isArray(q.statements)) {
                const ansObj = this.userAnswers[q.id] || {};
                q.statements.forEach((st, idx) => {
                    totalItems++;
                    if (ansObj[idx] !== undefined && Boolean(ansObj[idx]) === Boolean(st.answer)) {
                        correctCount++;
                    }
                });
            } else {
                totalItems++;
                if (this.userAnswers[q.id] === q.correct) {
                    correctCount++;
                }
            }
        });

        const finalScore = totalItems > 0 ? Math.round((correctCount / totalItems) * 100) : 0;

        // Cập nhật kết quả lên màn hình Result
        document.getElementById('result-player-greeting').textContent = 
            `Chúc mừng ${this.playerName} đã hoàn thành bài thi!`;
        document.getElementById('result-score').textContent = finalScore;
        document.getElementById('result-correct-ratio').textContent = `${correctCount}/${totalItems}`;

        const minutes = Math.floor(this.secondsElapsed / 60);
        const seconds = this.secondsElapsed % 60;
        document.getElementById('result-time-spent').textContent = 
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        if (finalScore >= 70 && typeof confetti === 'function') {
            confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
        }

        // Lưu kết quả vào Supabase Database
        if (window.dbService) {
            window.dbService.saveResult({
                playerName: this.playerName,
                score: finalScore,
                correctCount: correctCount,
                totalQuestions: totalItems,
                timeSpentSeconds: this.secondsElapsed
            });
        }

        this.switchScreen('result');
    }

    restartQuiz() {
        this.startQuiz();
    }

    async showLeaderboard() {
        this.switchScreen('leaderboard');
        await this.refreshLeaderboard();
    }

    async refreshLeaderboard() {
        const tbody = document.getElementById('leaderboard-table-body');
        const podiumContainer = document.getElementById('podium-container');
        const statusText = document.getElementById('storage-status-text');
        if (!tbody || !window.dbService) return;

        const config = window.dbService.getConfig();
        if (config.isActive) {
            statusText.innerHTML = '<span class="inline-flex items-center gap-1 text-emerald-400"><i class="fa-solid fa-cloud"></i> Đang đồng bộ từ Supabase Cloud Database</span>';
        } else {
            statusText.innerHTML = '<span class="inline-flex items-center gap-1 text-amber-400"><i class="fa-solid fa-hard-drive"></i> Đang hiển thị điểm lưu trên trình duyệt (LocalStorage)</span>';
        }

        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-slate-500">Đang tải bảng vàng...</td></tr>';
        const list = await window.dbService.getLeaderboard(50);

        if (!list || list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-slate-500">Chưa có ai hoàn thành bài thi. Hãy là người đầu tiên ghi danh!</td></tr>';
            if (podiumContainer) podiumContainer.innerHTML = '';
            return;
        }

        this.renderPodium(list.slice(0, 3));

        tbody.innerHTML = '';
        list.forEach((item, index) => {
            const rank = index + 1;
            const row = document.createElement('tr');
            row.className = "hover:bg-slate-800/40 transition";

            const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('vi-VN') : 'Mới đây';
            const minutes = Math.floor((item.time_spent_seconds || 0) / 60);
            const seconds = (item.time_spent_seconds || 0) % 60;
            const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

            let rankBadge = `<span class="font-bold text-slate-400">${rank}</span>`;
            if (rank === 1) rankBadge = `<span class="w-6 h-6 rounded-full bg-amber-400 text-slate-950 font-extrabold flex items-center justify-center mx-auto text-xs shadow-md shadow-amber-400/20">1</span>`;
            else if (rank === 2) rankBadge = `<span class="w-6 h-6 rounded-full bg-slate-300 text-slate-950 font-extrabold flex items-center justify-center mx-auto text-xs shadow-md shadow-slate-300/20">2</span>`;
            else if (rank === 3) rankBadge = `<span class="w-6 h-6 rounded-full bg-amber-700 text-amber-100 font-extrabold flex items-center justify-center mx-auto text-xs shadow-md shadow-amber-700/20">3</span>`;

            row.innerHTML = `
                <td class="py-3 px-4 text-center">${rankBadge}</td>
                <td class="py-3 px-4 font-semibold text-slate-200">${this.escapeHtml(item.player_name || 'Học sinh')}</td>
                <td class="py-3 px-4 text-center font-bold text-indigo-400">${item.score} đ</td>
                <td class="py-3 px-4 text-center text-slate-400 font-mono">${timeStr}</td>
                <td class="py-3 px-4 text-right text-slate-500 text-[11px]">${dateStr}</td>
            `;
            tbody.appendChild(row);
        });
    }

    renderPodium(top3) {
        const podiumContainer = document.getElementById('podium-container');
        if (!podiumContainer || top3.length === 0) {
            if (podiumContainer) podiumContainer.innerHTML = '';
            return;
        }

        const rank2 = top3[1];
        const rank1 = top3[0];
        const rank3 = top3[2];

        podiumContainer.innerHTML = `
            <div class="text-center">
                ${rank2 ? `
                    <div class="w-12 h-12 mx-auto rounded-full bg-slate-700 border-2 border-slate-300 flex items-center justify-center text-slate-200 font-bold mb-2 shadow-lg">
                        <i class="fa-solid fa-medal text-slate-300 text-lg"></i>
                    </div>
                    <p class="font-bold text-xs truncate text-slate-200">${this.escapeHtml(rank2.player_name)}</p>
                    <p class="text-xs text-indigo-400 font-bold">${rank2.score} điểm</p>
                    <div class="h-16 mt-2 rounded-t-xl bg-slate-800 border-t border-slate-600 flex items-center justify-center text-slate-400 font-black text-sm">#2</div>
                ` : ''}
            </div>
            <div class="text-center">
                ${rank1 ? `
                    <div class="w-14 h-14 mx-auto rounded-full bg-amber-500/20 border-2 border-amber-400 flex items-center justify-center text-amber-400 font-bold mb-2 shadow-xl shadow-amber-500/20 animate-pulse">
                        <i class="fa-solid fa-crown text-amber-400 text-xl"></i>
                    </div>
                    <p class="font-extrabold text-sm truncate text-amber-300">${this.escapeHtml(rank1.player_name)}</p>
                    <p class="text-xs text-amber-400 font-black">${rank1.score} điểm</p>
                    <div class="h-24 mt-2 rounded-t-xl bg-gradient-to-t from-amber-600/30 to-amber-500/40 border-t-2 border-amber-400 flex items-center justify-center text-amber-300 font-black text-base">#1</div>
                ` : ''}
            </div>
            <div class="text-center">
                ${rank3 ? `
                    <div class="w-12 h-12 mx-auto rounded-full bg-slate-800 border-2 border-amber-700 flex items-center justify-center text-amber-600 font-bold mb-2 shadow-lg">
                        <i class="fa-solid fa-award text-amber-700 text-lg"></i>
                    </div>
                    <p class="font-bold text-xs truncate text-slate-300">${this.escapeHtml(rank3.player_name)}</p>
                    <p class="text-xs text-indigo-400 font-bold">${rank3.score} điểm</p>
                    <div class="h-12 mt-2 rounded-t-xl bg-slate-800/80 border-t border-amber-800 flex items-center justify-center text-amber-700 font-black text-sm">#3</div>
                ` : ''}
            </div>
        `;
    }

    showHome() {
        this.switchScreen('home');
    }

    // ==========================================
    // PHẦN QUẢN TRỊ VIÊN (ADMIN DASHBOARD & CRUD)
    // ==========================================
    promptAdminAuth() {
        if (this.isAdminAuthenticated) {
            this.openAdminDashboard();
            return;
        }
        const modal = document.getElementById('modal-admin-auth');
        const input = document.getElementById('admin-password-input');
        const err = document.getElementById('admin-auth-error-msg');
        if (input) input.value = '';
        if (err) err.classList.add('hidden');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            setTimeout(() => input?.focus(), 50);
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
        const input = document.getElementById('admin-password-input');
        const err = document.getElementById('admin-auth-error-msg');
        const entered = input ? input.value.trim() : '';

        if (entered === this.adminSecretPass || entered === 'admin123') {
            this.isAdminAuthenticated = true;
            this.closeAdminAuthModal();
            this.openAdminDashboard();
        } else {
            if (err) err.classList.remove('hidden');
        }
    }

    openAdminDashboard() {
        const modal = document.getElementById('modal-admin-dashboard');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            this.switchAdminTab('questions');
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
        const btnQ = document.getElementById('admin-tab-btn-questions');
        const btnS = document.getElementById('admin-tab-btn-students');

        if (tabName === 'questions') {
            tabQContent?.classList.remove('hidden');
            tabSContent?.classList.add('hidden');
            btnQ?.classList.add('bg-slate-900', 'text-amber-400', 'border-t-2', 'border-amber-500');
            btnQ?.classList.remove('text-slate-400');
            btnS?.classList.remove('bg-slate-900', 'text-amber-400', 'border-t-2', 'border-amber-500');
            btnS?.classList.add('text-slate-400');
            this.renderAdminQuestionsList();
        } else {
            tabQContent?.classList.add('hidden');
            tabSContent?.classList.remove('hidden');
            btnS?.classList.add('bg-slate-900', 'text-amber-400', 'border-t-2', 'border-amber-500');
            btnS?.classList.remove('text-slate-400');
            btnQ?.classList.remove('bg-slate-900', 'text-amber-400', 'border-t-2', 'border-amber-500');
            btnQ?.classList.add('text-slate-400');
            this.renderAdminStudentsList();
        }
    }

    renderAdminQuestionsList() {
        const listContainer = document.getElementById('admin-questions-list');
        const searchInput = document.getElementById('admin-search-q-input');
        const filterCategory = document.getElementById('admin-filter-category');
        if (!listContainer) return;

        const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
        const catFilter = filterCategory ? filterCategory.value : 'all';

        const questions = (this.allQuestions && this.allQuestions.length > 0) 
            ? this.allQuestions 
            : (window.QUIZ_QUESTIONS || []);

        let filtered = questions.filter(q => {
            const matchesText = !keyword || q.question.toLowerCase().includes(keyword) || (q.explanation && q.explanation.toLowerCase().includes(keyword));
            let matchesCat = true;
            if (catFilter === 'b1') matchesCat = (q.category || '').includes('Bài 1');
            else if (catFilter === 'b2') matchesCat = (q.category || '').includes('Bài 2');
            return matchesText && matchesCat;
        });

        if (filtered.length === 0) {
            listContainer.innerHTML = '<div class="text-center py-8 text-slate-500 text-xs">Không tìm thấy câu hỏi nào phù hợp.</div>';
            return;
        }

        const letters = ['A', 'B', 'C', 'D'];
        listContainer.innerHTML = '';

        filtered.forEach((q) => {
            const card = document.createElement('div');
            card.className = "p-4 rounded-xl bg-slate-800/80 border border-slate-700/80 hover:border-slate-600 transition flex flex-col md:flex-row md:items-center justify-between gap-3";

            let previewHtml = '';
            if (q.qType === 'tf_group' && Array.isArray(q.statements)) {
                previewHtml = `<span class="inline-block px-2 py-0.5 rounded text-[11px] bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">4 Mệnh đề Đúng - Sai</span>`;
            } else if (Array.isArray(q.options)) {
                previewHtml = q.options.map((opt, i) => {
                    const isCorrect = i === q.correct;
                    return `<span class="inline-block px-2 py-0.5 rounded text-[11px] ${isCorrect ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30' : 'bg-slate-900 text-slate-400'}">${letters[i]}: ${this.escapeHtml(opt.length > 25 ? opt.substring(0, 25) + '...' : opt)}</span>`;
                }).join(' ');
            }

            card.innerHTML = `
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1.5">
                        <span class="w-6 h-6 rounded-md bg-amber-500/20 text-amber-300 font-bold text-xs flex items-center justify-center shrink-0 border border-amber-500/30">
                            #${q.id}
                        </span>
                        <span class="text-[11px] font-semibold text-indigo-400">${this.escapeHtml(q.category || 'Lịch Sử 11')}</span>
                    </div>
                    <p class="text-xs font-medium text-slate-100 line-clamp-2 mb-2 leading-relaxed">
                        ${this.escapeHtml(q.question)}
                    </p>
                    <div class="flex flex-wrap gap-1.5">
                        ${previewHtml}
                    </div>
                </div>
                <div class="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-700/60">
                    <button onclick="app.openEditQuestion(${q.id})" class="px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 text-xs font-semibold transition flex items-center gap-1 cursor-pointer">
                        <i class="fa-solid fa-pen"></i> Sửa
                    </button>
                    <button onclick="app.deleteQuestion(${q.id})" class="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 text-xs font-semibold transition flex items-center gap-1 cursor-pointer">
                        <i class="fa-solid fa-trash-can"></i> Xóa
                    </button>
                </div>
            `;
            listContainer.appendChild(card);
        });
    }

    openNewQuestionEditor() {
        document.getElementById('editor-modal-title').textContent = "Thêm Câu Hỏi Mới";
        document.getElementById('edit-q-id').value = "";
        document.getElementById('edit-q-category').value = "Bài 1: Cách mạng tư sản";
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
        document.getElementById('edit-q-category').value = q.category || "Bài 1: Cách mạng tư sản";
        document.getElementById('edit-q-text').value = q.question;

        if (Array.isArray(q.options)) {
            document.getElementById('edit-q-opt-0').value = q.options[0] || "";
            document.getElementById('edit-q-opt-1').value = q.options[1] || "";
            document.getElementById('edit-q-opt-2').value = q.options[2] || "";
            document.getElementById('edit-q-opt-3').value = q.options[3] || "";
        }
        document.getElementById('edit-q-explanation').value = q.explanation || "";

        const radios = document.querySelectorAll('input[name="edit-q-correct"]');
        radios.forEach((r, idx) => {
            r.checked = (idx === q.correct);
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

        const newQObj = {
            id: qId,
            qType: 'mcq',
            category: category,
            question: questionText,
            options: [opt0, opt1, opt2, opt3],
            correct: correctIndex,
            isMultiple: false,
            explanation: explanation
        };

        const existingIdx = this.allQuestions.findIndex(q => q.id === qId);
        if (existingIdx !== -1) {
            this.allQuestions[existingIdx] = newQObj;
        } else {
            this.allQuestions.push(newQObj);
        }

        if (window.dbService) {
            await window.dbService.saveQuestion(newQObj);
        }

        this.updateTotalQuestionDisplay();
        this.renderAdminQuestionsList();
        this.closeQuestionEditor();
        this.renderAllQuestions();
        alert(`Đã lưu Câu #${qId} thành công và đồng bộ lên hệ thống!`);
    }

    async deleteQuestion(qId) {
        if (!confirm(`Bạn có chắc chắn muốn xóa Câu #${qId} không?`)) return;

        this.allQuestions = this.allQuestions.filter(q => q.id !== qId);
        if (window.dbService) {
            await window.dbService.deleteQuestion(qId);
        }

        this.updateTotalQuestionDisplay();
        this.renderAdminQuestionsList();
        this.renderAllQuestions();
        alert(`Đã xóa Câu #${qId} thành công!`);
    }

    async seedDefaultQuestionsToCloud() {
        if (!confirm("Hành động này sẽ lưu toàn bộ câu hỏi lên Supabase để bạn có thể chỉnh sửa mọi lúc mọi nơi. Tiếp tục?")) {
            return;
        }
        if (window.dbService) {
            await window.dbService.seedInitialQuestions(this.allQuestions);
            alert("Đã lưu thành công lên cơ sở dữ liệu Supabase Cloud!");
        }
    }

    async renderAdminStudentsList() {
        const tbody = document.getElementById('admin-students-tbody');
        if (!tbody || !window.dbService) return;

        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-slate-500">Đang tải danh sách thí sinh...</td></tr>';
        const list = await window.dbService.getLeaderboard(100);

        if (!list || list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-slate-500">Chưa có bài nộp nào.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        list.forEach((item) => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-800/40 transition";

            const minutes = Math.floor((item.time_spent_seconds || 0) / 60);
            const seconds = (item.time_spent_seconds || 0) % 60;
            const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

            tr.innerHTML = `
                <td class="py-2.5 px-3 font-semibold text-slate-200">${this.escapeHtml(item.player_name)}</td>
                <td class="py-2.5 px-3 text-center font-bold text-indigo-400">${item.score} đ</td>
                <td class="py-2.5 px-3 text-center text-slate-400">${item.correct_count || 0}/${item.total_questions || 74}</td>
                <td class="py-2.5 px-3 text-center text-slate-400 font-mono">${timeStr}</td>
                <td class="py-2.5 px-3 text-right">
                    <button onclick="app.adminDeleteScore('${item.id}')" class="text-rose-400 hover:text-rose-300 font-semibold text-xs">
                        <i class="fa-solid fa-trash-can"></i> Xóa
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    async adminDeleteScore(scoreId) {
        if (!confirm("Xóa kết quả này khỏi bảng vàng?")) return;
        if (window.dbService) {
            await window.dbService.deleteResult(scoreId);
            this.renderAdminStudentsList();
            this.refreshLeaderboard();
        }
    }

    async adminClearAllScores() {
        if (!confirm("CẢNH BÁO: Bạn có chắc chắn muốn xóa TOÀN BỘ bảng xếp hạng không?")) return;
        if (window.dbService) {
            await window.dbService.clearAllResults();
            this.renderAdminStudentsList();
            this.refreshLeaderboard();
            alert("Đã làm sạch toàn bộ bảng xếp hạng!");
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
            alert("Vui lòng nhập đầy đủ Project URL và Anon Public Key!");
            return;
        }

        try {
            window.dbService.saveConfig(url, key);
            alert("Đã lưu cấu hình Supabase thành công!");
            this.closeSettingsModal();
            this.refreshLeaderboard();
        } catch (e) {
            alert("Lỗi: " + e.message);
        }
    }

    clearSupabaseConfig() {
        if (window.confirm("Bạn có muốn xóa kết nối Supabase và chuyển sang lưu trữ LocalStorage không?")) {
            window.dbService.clearConfig();
            this.closeSettingsModal();
            this.refreshLeaderboard();
        }
    }

    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new QuizApp();
});
