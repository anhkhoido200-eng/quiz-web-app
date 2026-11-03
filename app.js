/**
 * app.js - Logic điều phối ứng dụng trắc nghiệm QuizMaster
 * Xử lý: Quản lý trạng thái, Đồng hồ đếm ngược, Chấm điểm, Render UI, Leaderboard
 */

class QuizApp {
    constructor() {
        // Trạng thái người chơi và cài đặt
        this.playerName = "";
        this.quizDurationSeconds = 180; // Mặc định 3 phút
        this.timerInterval = null;
        this.timeLeftSeconds = 0;
        this.timeSpentSeconds = 0;

        // Trạng thái bài làm
        this.questions = [];
        this.currentIndex = 0;
        this.userAnswers = {};      // { [qIndex]: selectedOptionIndex }
        this.flaggedQuestions = new Set(); // Set các câu hỏi được đánh dấu xem lại

        // Cache DOM Elements
        this.screens = {
            home: document.getElementById('screen-home'),
            quiz: document.getElementById('screen-quiz'),
            result: document.getElementById('screen-result'),
            leaderboard: document.getElementById('screen-leaderboard')
        };

        this.initEventListeners();
        this.updateTotalQuestionDisplay();
    }

    /**
     * Gắn các sự kiện ban đầu
     */
    initEventListeners() {
        // Nhấn Enter ở ô nhập tên để bắt đầu
        const nameInput = document.getElementById('player-name-input');
        if (nameInput) {
            nameInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.startQuiz();
                }
            });
            // Khôi phục tên cũ nếu có trong localStorage
            const savedName = localStorage.getItem('quiz_last_player_name');
            if (savedName) {
                nameInput.value = savedName;
            }
        }
    }

    /**
     * Cập nhật số lượng câu hỏi trên màn hình Home
     */
    updateTotalQuestionDisplay() {
        const countSpan = document.getElementById('info-total-questions');
        if (countSpan && window.QUIZ_QUESTIONS) {
            countSpan.textContent = `${window.QUIZ_QUESTIONS.length} câu`;
        }
    }

    /**
     * Chuyển đổi màn hình hiển thị (Single Page Application view switcher)
     */
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
     * Đổi thời gian thi từ nút chọn
     */
    setDuration(seconds) {
        this.quizDurationSeconds = seconds;
        document.querySelectorAll('.time-select-btn').forEach(btn => {
            const btnTime = parseInt(btn.getAttribute('data-time'));
            if (btnTime === seconds) {
                btn.classList.add('border-indigo-500', 'bg-indigo-600/20', 'text-indigo-300');
                btn.classList.remove('border-slate-700', 'bg-slate-900/50', 'text-slate-300');
            } else {
                btn.classList.remove('border-indigo-500', 'bg-indigo-600/20', 'text-indigo-300');
                btn.classList.add('border-slate-700', 'bg-slate-900/50', 'text-slate-300');
            }
        });
    }

    /**
     * Bắt đầu bài làm
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

        // Chuẩn bị dữ liệu câu hỏi (Xáo trộn ngẫu nhiên)
        this.prepareQuestions();

        // Khởi tạo trạng thái
        this.currentIndex = 0;
        this.userAnswers = {};
        this.flaggedQuestions.clear();
        this.timeLeftSeconds = this.quizDurationSeconds;
        this.timeSpentSeconds = 0;

        // Bắt đầu đếm ngược thời gian
        this.startTimer();

        // Render câu hỏi đầu tiên và ma trận câu hỏi
        this.renderQuestion(0);
        this.renderPalette();

        // Hiển thị màn hình quiz
        this.switchScreen('quiz');
    }

    /**
     * Xáo trộn câu hỏi và các phương án để tạo đề thi phong phú
     */
    prepareQuestions() {
        const sourceQuestions = window.QUIZ_QUESTIONS || [];
        // Sao chép sâu
        const cloned = JSON.parse(JSON.stringify(sourceQuestions));

        // Hàm xáo trộn mảng Fisher-Yates
        const shuffle = (array) => {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        };

        // Xáo trộn danh sách câu hỏi
        const shuffledList = shuffle(cloned);

        // Xáo trộn luôn các đáp án bên trong từng câu hỏi và cập nhật lại vị trí đáp án đúng
        this.questions = shuffledList.map((q) => {
            const originalCorrectAnswer = q.options[q.correct];
            const shuffledOptions = shuffle([...q.options]);
            const newCorrectIndex = shuffledOptions.indexOf(originalCorrectAnswer);

            return {
                ...q,
                options: shuffledOptions,
                correct: newCorrectIndex
            };
        });
    }

    /**
     * Quản lý đồng hồ đếm ngược (Countdown Timer)
     */
    startTimer() {
        clearInterval(this.timerInterval);
        this.updateTimerDisplay();

        this.timerInterval = setInterval(() => {
            this.timeLeftSeconds--;
            this.timeSpentSeconds++;
            this.updateTimerDisplay();

            if (this.timeLeftSeconds <= 0) {
                clearInterval(this.timerInterval);
                this.submitQuiz(true); // Tự động nộp bài khi hết giờ
            }
        }, 1000);
    }

    /**
     * Cập nhật giao diện đồng hồ
     */
    updateTimerDisplay() {
        const timerDisplay = document.getElementById('timer-display');
        const timerBox = document.getElementById('timer-box');
        const timerIcon = document.getElementById('timer-icon');

        const minutes = Math.floor(Math.max(0, this.timeLeftSeconds) / 60);
        const seconds = Math.max(0, this.timeLeftSeconds) % 60;
        const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        if (timerDisplay) {
            timerDisplay.textContent = formatted;
        }

        // Cảnh báo khi thời gian còn dưới 60 giây
        if (this.timeLeftSeconds <= 60 && timerBox) {
            timerBox.classList.add('border-rose-500/80', 'bg-rose-500/10', 'animate-pulse');
            if (timerIcon) timerIcon.className = 'fa-solid fa-triangle-exclamation text-rose-400';
            if (timerDisplay) timerDisplay.className = 'font-mono font-bold text-sm text-rose-400';
        } else if (timerBox) {
            timerBox.classList.remove('border-rose-500/80', 'bg-rose-500/10', 'animate-pulse');
            if (timerIcon) timerIcon.className = 'fa-regular fa-clock text-indigo-400';
            if (timerDisplay) timerDisplay.className = 'font-mono font-bold text-sm text-slate-200';
        }
    }

    /**
     * Render nội dung câu hỏi tại vị trí index
     */
    renderQuestion(index) {
        if (!this.questions || this.questions.length === 0) return;
        this.currentIndex = index;
        const q = this.questions[index];

        // Cập nhật Header
        document.getElementById('current-q-index').textContent = index + 1;
        document.getElementById('total-q-count').textContent = this.questions.length;
        document.getElementById('quiz-category-badge').textContent = q.category || "Trắc nghiệm";

        // Thanh tiến trình
        const progressPercent = ((index + 1) / this.questions.length) * 100;
        document.getElementById('quiz-progress-bar').style.width = `${progressPercent}%`;

        // Nội dung câu hỏi
        document.getElementById('question-text').textContent = `${index + 1}. ${q.question}`;

        // Nút đánh dấu cờ
        this.updateFlagButton();

        // Render danh sách lựa chọn
        const optionsContainer = document.getElementById('options-container');
        optionsContainer.innerHTML = '';

        const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
        const selectedAnswer = this.userAnswers[index];

        q.options.forEach((optText, optIdx) => {
            const isSelected = selectedAnswer === optIdx;
            const letter = letters[optIdx] || (optIdx + 1);

            const optButton = document.createElement('button');
            optButton.type = 'button';
            optButton.className = `w-full text-left p-4 rounded-xl border transition-all duration-200 flex items-start gap-3.5 group cursor-pointer ${
                isSelected 
                    ? 'border-indigo-500 bg-indigo-500/15 shadow-md shadow-indigo-500/10 text-white' 
                    : 'border-slate-700/80 bg-slate-900/60 hover:bg-slate-800/80 hover:border-slate-600 text-slate-300'
            }`;

            optButton.onclick = () => this.selectOption(index, optIdx);

            optButton.innerHTML = `
                <span class="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center font-bold text-xs transition-colors ${
                    isSelected 
                        ? 'bg-indigo-600 text-white shadow' 
                        : 'bg-slate-800 text-slate-400 group-hover:bg-slate-700 group-hover:text-slate-200'
                }">
                    ${letter}
                </span>
                <span class="text-sm pt-0.5 leading-relaxed font-normal">${optText}</span>
            `;

            optionsContainer.appendChild(optButton);
        });

        // Nút điều hướng
        const prevBtn = document.getElementById('btn-prev-question');
        const nextBtn = document.getElementById('btn-next-question');

        if (prevBtn) prevBtn.disabled = index === 0;
        if (nextBtn) {
            if (index === this.questions.length - 1) {
                nextBtn.classList.add('hidden');
            } else {
                nextBtn.classList.remove('hidden');
            }
        }

        // Cập nhật ma trận câu hỏi
        this.renderPalette();
    }

    /**
     * Xử lý khi người dùng chọn đáp án
     */
    selectOption(questionIndex, optionIndex) {
        this.userAnswers[questionIndex] = optionIndex;
        this.renderQuestion(questionIndex);
        this.renderPalette();
    }

    /**
     * Bật/tắt đánh dấu câu hỏi cần xem lại
     */
    toggleFlagCurrentQuestion() {
        if (this.flaggedQuestions.has(this.currentIndex)) {
            this.flaggedQuestions.delete(this.currentIndex);
        } else {
            this.flaggedQuestions.add(this.currentIndex);
        }
        this.updateFlagButton();
        this.renderPalette();
    }

    /**
     * Cập nhật trạng thái hiển thị của nút Cờ (Flag)
     */
    updateFlagButton() {
        const flagBtn = document.getElementById('btn-flag-question');
        if (!flagBtn) return;

        const isFlagged = this.flaggedQuestions.has(this.currentIndex);
        if (isFlagged) {
            flagBtn.className = "text-xs px-2.5 py-1 rounded-lg border border-amber-500/60 bg-amber-500/20 text-amber-300 transition flex items-center gap-1.5";
            flagBtn.innerHTML = '<i class="fa-solid fa-bookmark"></i><span>Đã đánh dấu</span>';
        } else {
            flagBtn.className = "text-xs px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-900/60 text-slate-400 hover:text-amber-400 hover:border-amber-500/40 transition flex items-center gap-1.5";
            flagBtn.innerHTML = '<i class="fa-regular fa-bookmark"></i><span>Đánh dấu xem lại</span>';
        }
    }

    /**
     * Chuyển đến câu hỏi trước
     */
    prevQuestion() {
        if (this.currentIndex > 0) {
            this.renderQuestion(this.currentIndex - 1);
        }
    }

    /**
     * Chuyển đến câu hỏi tiếp theo
     */
    nextQuestion() {
        if (this.currentIndex < this.questions.length - 1) {
            this.renderQuestion(this.currentIndex + 1);
        }
    }

    /**
     * Nhảy trực tiếp đến câu hỏi bất kỳ khi click trên bảng ma trận
     */
    jumpToQuestion(index) {
        this.renderQuestion(index);
    }

    /**
     * Render bảng ma trận câu hỏi (Question Palette)
     */
    renderPalette() {
        const grid = document.getElementById('palette-grid');
        const answeredCountBadge = document.getElementById('answered-count-badge');
        if (!grid || !this.questions) return;

        grid.innerHTML = '';
        let answeredCount = 0;

        this.questions.forEach((q, idx) => {
            const isCurrent = idx === this.currentIndex;
            const isAnswered = this.userAnswers[idx] !== undefined;
            const isFlagged = this.flaggedQuestions.has(idx);

            if (isAnswered) answeredCount++;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = idx + 1;
            btn.onclick = () => this.jumpToQuestion(idx);

            let baseClasses = "relative h-9 rounded-lg font-mono text-xs font-bold transition flex items-center justify-center ";

            if (isCurrent) {
                baseClasses += "border-2 border-indigo-400 bg-indigo-600 text-white shadow-md ";
            } else if (isAnswered) {
                baseClasses += "bg-emerald-600/80 border border-emerald-500 text-white ";
            } else {
                baseClasses += "bg-slate-900 border border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200 ";
            }

            btn.className = baseClasses;

            // Nếu có cờ xem lại, thêm chấm nhỏ màu vàng góc trên
            if (isFlagged) {
                const flagDot = document.createElement('span');
                flagDot.className = "absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-400 rounded-full border border-slate-900";
                btn.appendChild(flagDot);
            }

            grid.appendChild(btn);
        });

        if (answeredCountBadge) {
            answeredCountBadge.textContent = `${answeredCount}/${this.questions.length} đã làm`;
        }
    }

    /**
     * Xác nhận trước khi nộp bài
     */
    confirmSubmit() {
        const total = this.questions.length;
        const answered = Object.keys(this.userAnswers).length;
        const unanswered = total - answered;

        let message = "Bạn có chắc chắn muốn nộp bài thi ngay bây giờ không?";
        if (unanswered > 0) {
            message = `Bạn vẫn còn ${unanswered} câu chưa trả lời. Bạn có muốn nộp bài luôn không?`;
        }

        if (window.confirm(message)) {
            this.submitQuiz(false);
        }
    }

    /**
     * Nộp bài, chấm điểm và chuyển sang màn hình kết quả
     */
    async submitQuiz(isAuto = false) {
        clearInterval(this.timerInterval);

        // Tính điểm
        let correctCount = 0;
        this.questions.forEach((q, idx) => {
            if (this.userAnswers[idx] === q.correct) {
                correctCount++;
            }
        });

        const totalQuestions = this.questions.length;
        // Điểm thang 100
        const finalScore = Math.round((correctCount / totalQuestions) * 100);

        // Hiển thị kết quả lên giao diện
        document.getElementById('result-player-greeting').textContent = 
            `Chúc mừng ${this.playerName} đã hoàn thành bài thi trắc nghiệm!`;
        document.getElementById('result-score').textContent = finalScore;
        document.getElementById('result-correct-ratio').textContent = `${correctCount}/${totalQuestions}`;

        // Format thời gian làm bài
        const minutes = Math.floor(this.timeSpentSeconds / 60);
        const seconds = this.timeSpentSeconds % 60;
        document.getElementById('result-time-spent').textContent = 
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        // Hiệu ứng pháo hoa chúc mừng nếu đạt điểm từ 70 trở lên
        if (finalScore >= 70 && typeof confetti === 'function') {
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 }
            });
        }

        // Lưu điểm số qua DatabaseService (Supabase hoặc LocalStorage)
        if (window.dbService) {
            window.dbService.saveResult({
                playerName: this.playerName,
                score: finalScore,
                correctCount: correctCount,
                totalQuestions: totalQuestions,
                timeSpentSeconds: this.timeSpentSeconds
            });
        }

        // Ẩn bảng chi tiết đáp án ban đầu
        const reviewContainer = document.getElementById('review-container');
        if (reviewContainer) reviewContainer.classList.add('hidden');
        const toggleText = document.getElementById('btn-toggle-review-text');
        if (toggleText) toggleText.textContent = "Xem lời giải chi tiết";

        // Chuyển màn hình
        this.switchScreen('result');
    }

    /**
     * Bật/tắt xem lại lời giải chi tiết
     */
    toggleReviewDetails() {
        const reviewContainer = document.getElementById('review-container');
        const toggleText = document.getElementById('btn-toggle-review-text');
        if (!reviewContainer) return;

        if (reviewContainer.classList.contains('hidden')) {
            this.renderReviewList();
            reviewContainer.classList.remove('hidden');
            if (toggleText) toggleText.textContent = "Thu gọn lời giải";
            // Cuộn xuống xem lời giải
            reviewContainer.scrollIntoView({ behavior: 'smooth' });
        } else {
            reviewContainer.classList.add('hidden');
            if (toggleText) toggleText.textContent = "Xem lời giải chi tiết";
        }
    }

    /**
     * Render toàn bộ câu hỏi kèm đáp án đúng và giải thích
     */
    renderReviewList() {
        const reviewList = document.getElementById('review-list');
        if (!reviewList || !this.questions) return;

        reviewList.innerHTML = '';
        const letters = ['A', 'B', 'C', 'D'];

        this.questions.forEach((q, idx) => {
            const userPick = this.userAnswers[idx];
            const isCorrect = userPick === q.correct;
            const isSkipped = userPick === undefined;

            const card = document.createElement('div');
            card.className = `p-5 rounded-2xl border transition-all ${
                isCorrect 
                    ? 'border-emerald-500/40 bg-emerald-950/20' 
                    : 'border-rose-500/40 bg-rose-950/20'
            }`;

            let statusBadge = '';
            if (isCorrect) {
                statusBadge = '<span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"><i class="fa-solid fa-check mr-1"></i>Đúng</span>';
            } else if (isSkipped) {
                statusBadge = '<span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30"><i class="fa-solid fa-minus mr-1"></i>Bỏ qua</span>';
            } else {
                statusBadge = '<span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30"><i class="fa-solid fa-xmark mr-1"></i>Sai</span>';
            }

            let optionsHtml = '';
            q.options.forEach((opt, optIdx) => {
                const isSelectedByUser = userPick === optIdx;
                const isTheCorrectOne = q.correct === optIdx;

                let optClass = "p-2.5 rounded-lg border text-xs flex items-center justify-between ";
                if (isTheCorrectOne) {
                    optClass += "bg-emerald-500/20 border-emerald-500 text-emerald-200 font-semibold";
                } else if (isSelectedByUser && !isTheCorrectOne) {
                    optClass += "bg-rose-500/20 border-rose-500 text-rose-200 line-through";
                } else {
                    optClass += "bg-slate-900/60 border-slate-800 text-slate-400";
                }

                optionsHtml += `
                    <div class="${optClass}">
                        <span><strong>${letters[optIdx]}.</strong> ${opt}</span>
                        ${isTheCorrectOne ? '<i class="fa-solid fa-circle-check text-emerald-400 ml-2"></i>' : ''}
                        ${isSelectedByUser && !isTheCorrectOne ? '<i class="fa-solid fa-circle-xmark text-rose-400 ml-2"></i>' : ''}
                    </div>
                `;
            });

            card.innerHTML = `
                <div class="flex items-center justify-between mb-3">
                    <span class="text-xs font-bold text-slate-400 uppercase">Câu ${idx + 1} (${q.category})</span>
                    ${statusBadge}
                </div>
                <h4 class="text-sm font-semibold text-slate-100 mb-3">${q.question}</h4>
                <div class="space-y-2 mb-3">
                    ${optionsHtml}
                </div>
                <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-300">
                    <p class="text-indigo-400 font-semibold mb-1 flex items-center gap-1.5">
                        <i class="fa-regular fa-lightbulb"></i> Giải thích chi tiết:
                    </p>
                    <p class="leading-relaxed">${q.explanation || "Không có giải thích bổ sung."}</p>
                </div>
            `;

            reviewList.appendChild(card);
        });
    }

    /**
     * Bắt đầu bài kiểm tra mới
     */
    restartQuiz() {
        this.startQuiz();
    }

    /**
     * Hiển thị bảng xếp hạng
     */
    async showLeaderboard() {
        this.switchScreen('leaderboard');
        await this.refreshLeaderboard();
    }

    /**
     * Tải và hiển thị danh sách bảng xếp hạng từ DB
     */
    async refreshLeaderboard() {
        const tbody = document.getElementById('leaderboard-table-body');
        const podiumContainer = document.getElementById('podium-container');
        const statusText = document.getElementById('storage-status-text');

        if (!tbody || !window.dbService) return;

        // Trạng thái kết nối
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

        // Render Podium Top 3 nếu có ít nhất 1 người
        this.renderPodium(list.slice(0, 3));

        // Render bảng chi tiết
        tbody.innerHTML = '';
        list.forEach((item, index) => {
            const rank = index + 1;
            const row = document.createElement('tr');
            row.className = "hover:bg-slate-800/40 transition";

            // Format ngày
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
                <td class="py-3 px-4 font-semibold text-slate-200">
                    ${this.escapeHtml(item.player_name || 'Khách ẩn danh')}
                </td>
                <td class="py-3 px-4 text-center font-bold text-indigo-400">${item.score} đ</td>
                <td class="py-3 px-4 text-center text-slate-400 font-mono">${timeStr}</td>
                <td class="py-3 px-4 text-right text-slate-500 text-[11px]">${dateStr}</td>
            `;

            tbody.appendChild(row);
        });
    }

    /**
     * Render bục Top 3 vinh danh
     */
    renderPodium(top3) {
        const podiumContainer = document.getElementById('podium-container');
        if (!podiumContainer) return;
        if (top3.length === 0) {
            podiumContainer.innerHTML = '';
            return;
        }

        // Sắp xếp thứ tự hiển thị bục: [Hạng 2 (trái), Hạng 1 (giữa, cao nhất), Hạng 3 (phải)]
        const rank2 = top3[1];
        const rank1 = top3[0];
        const rank3 = top3[2];

        podiumContainer.innerHTML = `
            <!-- Hạng 2 -->
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

            <!-- Hạng 1 (Cao nhất) -->
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

            <!-- Hạng 3 -->
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

    /**
     * Về màn hình chính
     */
    showHome() {
        this.switchScreen('home');
    }

    /**
     * Modal cài đặt Supabase
     */
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
            alert("Vui lòng nhập đầy đủ Project URL và Anon Public Key của Supabase!");
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

    /**
     * Helper chống tấn công XSS khi hiển thị tên người chơi
     */
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

// Khởi chạy ứng dụng
document.addEventListener('DOMContentLoaded', () => {
    window.app = new QuizApp();
});
