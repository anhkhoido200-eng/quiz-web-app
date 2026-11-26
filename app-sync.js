/* Lưu tiến độ tạm, đồng bộ tiến độ và nộp bài. */
(function (root) {
    'use strict';
    const AppSync = root.AppSync = root.AppSync || {};

    AppSync.loadAutoSaveProgress = function (app) {
        const key = `quiz_autosave_${app.currentSubject}_${app.playerName}`;
        const saved = localStorage.getItem(key);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'answers')) {
                    if (parsed.savedAt && (Date.now() - Number(parsed.savedAt) >= 5 * 60 * 1000)) {
                        try { localStorage.removeItem(key); } catch (e) {}
                        app.userAnswers = {};
                        return;
                    }
                    if (parsed.attemptId) {
                        app.quizAttemptId = parsed.attemptId;
                    }
                    app.userAnswers = parsed.answers || {};
                } else {
                    app.userAnswers = parsed || {};
                }
            } catch (e) {
                app.userAnswers = {};
            }
        } else {
            app.userAnswers = {};
        }
    };

    AppSync.saveAutoSaveProgress = function (app) {
        const key = `quiz_autosave_${app.currentSubject}_${app.playerName}`;
        localStorage.setItem(key, JSON.stringify({
            attemptId: app.quizAttemptId || null,
            answers: app.userAnswers,
            savedAt: Date.now()
        }));
    };

    AppSync.clearAutoSaveProgress = function (app, clearSubjectProgress = false) {
        const prefix = `quiz_autosave_${app.currentSubject}_`;
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
        localStorage.removeItem(`${prefix}${app.playerName}`);
    };

    AppSync.buildStudentProgressDetail = function (app) {
        const questions = app.allQuestions || [];
        const cats = {};
        const items = [];
        const ensureCat = (name) => {
            const key = String(name || 'Chung').trim() || 'Chung';
            if (!cats[key]) cats[key] = [0, 0, 0];
            return key;
        };

        questions.forEach((q) => {
            const cat = ensureCat(q.category);
            if (q.qType === 'short_answer') {
                cats[cat][2] += 1;
                const val = app.userAnswers[q.id];
                const hasVal = val !== undefined && String(val).trim() !== '';
                let ok = null;
                if (hasVal) {
                    cats[cat][1] += 1;
                    ok = (q.acceptedValues && q.acceptedValues.some(v => String(v).trim().toLowerCase() === String(val).trim().toLowerCase())) ||
                        String(q.correctValue).trim().toLowerCase() === String(val).trim().toLowerCase();
                    if (ok) cats[cat][0] += 1;
                }
                items.push({
                    id: q.id,
                    t: 'sa',
                    cat,
                    ok,
                    ua: hasVal ? String(val).trim().slice(0, 60) : null,
                    ca: String(q.correctValue ?? q.acceptedValues?.[0] ?? '').trim().slice(0, 60)
                });
            } else if (q.qType === 'tf_group') {
                const ansObj = app.userAnswers[q.id] || {};
                const stmts = q.statements || [];
                const ua = [];
                const ca = [];
                let anyAnswered = false;
                let anyWrong = false;
                let allCorrect = stmts.length > 0;
                stmts.forEach((st, idx) => {
                    cats[cat][2] += 1;
                    const expected = Boolean(st.answer);
                    ca.push(expected);
                    if (ansObj[idx] !== undefined) {
                        anyAnswered = true;
                        cats[cat][1] += 1;
                        const chosen = Boolean(ansObj[idx]);
                        ua.push(chosen);
                        if (chosen === expected) cats[cat][0] += 1;
                        else { anyWrong = true; allCorrect = false; }
                    } else {
                        ua.push(null);
                        allCorrect = false;
                    }
                });
                items.push({
                    id: q.id,
                    t: 'tf',
                    cat,
                    ok: anyAnswered ? (anyWrong ? false : (allCorrect ? true : null)) : null,
                    ua,
                    ca
                });
            } else {
                cats[cat][2] += 1;
                const sel = app.userAnswers[q.id];
                const correctIdx = q.correct !== undefined ? q.correct : q.answer;
                let ok = null;
                if (sel !== undefined) {
                    cats[cat][1] += 1;
                    ok = Number(sel) === Number(correctIdx);
                    if (ok) cats[cat][0] += 1;
                }
                items.push({
                    id: q.id,
                    t: 'mcq',
                    cat,
                    ok,
                    ua: sel !== undefined ? sel : null,
                    ca: correctIdx
                });
            }
        });

        return {
            v: 1,
            subjectKey: app.currentSubject,
            grade: app.getRosterGradeConfig().grade,
            mode: app.isExamMode ? 'exam' : 'practice',
            sec: Math.max(0, Math.round(app.isExamMode ? ((app.examMinutes * 60) - app.examSecondsRemaining) : (app.secondsElapsed || 0))),
            revenge: Boolean(app.isRevengeMode || app.isMistakeMode),
            outsideRoster: Boolean(app.currentAttemptOutsideRoster),
            away: Number(app.awaySwitchCount || 0),
            cats,
            items
        };
    };

    AppSync.queueStudentProgress = function (app, attemptedCount, totalItems, correctCount) {
        // Đồng bộ ngay lên Supabase; nếu attempt còn đang tạo thì giữ bản mới nhất
        // và flush ngay sau khi loginRecordPromise trả về ID.
        app.pendingStudentProgress = {
            attemptedCount, totalItems, correctCount,
            subjectName: app.getSubjectTitle(),
            durationSeconds: app.isExamMode ? ((app.examMinutes * 60) - app.examSecondsRemaining) : app.secondsElapsed,
            attemptId: app.quizAttemptId,
            detail: app.buildStudentProgressDetail()
        };
        app.flushStudentProgress(app.quizAttemptId);
    };

    AppSync.flushStudentProgress = async function (app, attemptId = app.quizAttemptId) {
        if (app.hasAdminBypass()) return;
        const progress = app.pendingStudentProgress;
        if (!progress || !attemptId || progress.attemptId !== attemptId || !app.currentLoginId ||
            !window.dbService || typeof window.dbService.updateStudentProgress !== 'function' || app.progressSyncRunning) return;
        app.progressSyncRunning = true;
        try {
            await window.dbService.updateStudentProgress(
                app.currentLoginId,
                progress.attemptedCount,
                progress.totalItems,
                progress.correctCount,
                progress.subjectName,
                progress.durationSeconds,
                progress.detail
            );
        } finally {
            app.progressSyncRunning = false;
            // Nếu học sinh chọn thêm trong lúc request trước đang chạy, gửi snapshot mới nhất.
            if (app.pendingStudentProgress && app.pendingStudentProgress !== progress && app.currentScreen === 'quiz') {
                app.flushStudentProgress(attemptId);
            }
        }
    };

    AppSync.finishQuiz = async function (app, autoSubmitReason = '') {
        if (app.isFinishingQuiz) {
            console.debug('[QuizApp] Duplicate finishQuiz call ignored.');
            return;
        }
        app.isFinishingQuiz = true;
        app.pendingStudentProgress = null;
        app.stopStopwatch();

        const progressDeadline = Date.now() + 1500;
        while (app.progressSyncRunning && Date.now() < progressDeadline) {
            await new Promise((resolve) => window.setTimeout(resolve, 50));
        }

        if (app.loginRecordPromise) {
            try {
                await Promise.race([
                    app.loginRecordPromise,
                    new Promise((resolve) => window.setTimeout(resolve, 1500))
                ]);
            } catch (error) { console.warn('[QuizApp] Không chờ được bản ghi phiên trước khi nộp:', error); }
        }

        const questions = app.allQuestions || [];
        let totalItems = 0;
        let correctCount = 0;

        questions.forEach(q => {
            if (q.qType === 'short_answer') {
                totalItems++;
                const val = app.userAnswers[q.id];
                if (val !== undefined && app.isShortAnswerCorrect(q, val)) {
                    correctCount++;
                }
            } else if (q.qType === 'tf_group') {
                const ansObj = app.userAnswers[q.id] || {};
                (q.statements || []).forEach((st, idx) => {
                    totalItems++;
                    if (ansObj[idx] !== undefined && Boolean(ansObj[idx]) === Boolean(st.answer)) {
                        correctCount++;
                    }
                });
            } else {
                totalItems++;
                const sel = app.userAnswers[q.id];
                const correctIdx = q.correct !== undefined ? q.correct : q.answer;
                if (sel !== undefined && Number(sel) === Number(correctIdx)) correctCount++;
            }
        });

        const finalScore = totalItems > 0 ? Math.round((correctCount / totalItems) * 100) : 0;
        app._lastResultCorrectCount = correctCount;
        app._lastResultTotalQuestions = totalItems;
        const subjTitle = `${app.isRevengeMode || app.isMistakeMode ? '[Phục thù] ' : ''}${app.getSubjectTitle()}`;

        const isAdminBypass = app.hasAdminBypass();
        if (!isAdminBypass && !app.currentLoginId && window.dbService?.recordLogin) {
            try {
                const fallback = await window.dbService.recordLogin({
                    playerName: app.playerName, clientIp: app.clientIp, deviceInfo: app.deviceInfo,
                    subjectTitle: subjTitle, status: `Đang làm bài${app.currentAttemptOutsideRoster ? ' [Ngoài lớp]' : ''}`,
                    scoreSummary: `[${subjTitle}] Chờ nộp bài`,
                    sessionId: app.getOrCreateClientSessionId(), attemptId: app.quizAttemptId, newAttempt: true
                });
                app.currentLoginId = fallback?.id || (typeof fallback === 'string' ? fallback : null);
            } catch (error) {
                console.warn('[QuizApp] Không thể tạo bản ghi phiên để nộp bài:', error);
            }
        }

        // Cập nhật màn hình Kết Quả
        const scoreEl = document.getElementById('result-score');
        const ratioEl = document.getElementById('result-correct-ratio');
        const score10El = document.getElementById('result-score-10');
        const timeSpentEl = document.getElementById('result-time-spent');
        const greetingEl = document.getElementById('result-player-greeting');

        if (scoreEl) scoreEl.textContent = '0%';
        if (score10El) score10El.textContent = '0.0';
        if (ratioEl) ratioEl.textContent = `${correctCount}/${totalItems}`;

        let secondsUsed = app.secondsElapsed;
        if (app.isExamMode) {
            secondsUsed = (app.examMinutes * 60) - app.examSecondsRemaining;
        }
        const m = Math.floor(secondsUsed / 60);
        const s = secondsUsed % 60;
        const timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        if (timeSpentEl) timeSpentEl.textContent = timeStr;
        if (greetingEl) greetingEl.textContent = `Chúc mừng ${app.playerName} đã hoàn thành bài thi ${subjTitle}!`;

        // Cập nhật lên Supabase Cloud (bỏ qua nếu là Admin)
        let cloudConfirmed = false;
        if (!isAdminBypass && window.dbService && app.currentLoginId && typeof window.dbService.updateLoginStatus === 'function') {
            let summaryWithDetail = `[${subjTitle}] Đúng ${correctCount}/${totalItems} ý (${finalScore} điểm) - ${timeStr}`;
            try {
                summaryWithDetail += `\n__DETAIL__:${JSON.stringify(app.buildStudentProgressDetail())}`;
            } catch (e) {}
            try {
                cloudConfirmed = await window.dbService.updateLoginStatus(
                    app.currentLoginId,
                    `[${subjTitle}] Đã nộp bài${app.currentAttemptOutsideRoster ? ' [Ngoài lớp]' : ''}`,
                    summaryWithDetail
                ) === true;
            } catch (error) {
                console.warn('[QuizApp] Không thể đồng bộ bài nộp:', error);
            }
        }
        if (!isAdminBypass && !app.isRevengeMode && !app.isMistakeMode) {
            const sub = app.getCurrentSubjectObj();
            const key = app.getSubjectAttemptStorageKey(sub?.key || app.currentSubject, app.playerName);
            try { localStorage.setItem(key, String(Number(localStorage.getItem(key) || 0) + 1)); } catch (e) {}
        }
        app.currentLoginId = null;
        try { sessionStorage.removeItem('quiz_current_login_id'); } catch (e) {}

        // Xóa tiến độ autosave
        if (isAdminBypass || cloudConfirmed) app.clearAutoSaveProgress();

        // Lưu vào Nhật Ký Ôn Tập Cá Nhân (bỏ qua nếu là Admin)
        if (!isAdminBypass) {
            app.saveToPersonalHistory({
                id: 'hist_' + Date.now(),
                subjectTitle: subjTitle,
                score: finalScore,
                correctCount: correctCount,
                totalCount: totalItems,
                timeSpent: timeStr,
                submittedAt: new Date().toISOString(),
                mode: app.isRevengeMode ? 'Ôn câu sai' : (app.isExamMode ? 'Thi thử' : 'Luyện tập')
            });
        }

        // Phát âm thanh nhẹ khi hoàn tất, không dùng hiệu ứng gây rối mắt.
        if (finalScore >= 90) {
            app.playFanfareSound();
        } else if (finalScore >= 50) {
            app.playTingSound();
        } else {
            app.playBeepSound();
        }

        // Cập nhật Ngân hàng câu sai cá nhân (Mistake Bank)
        const remainingWrong = app.updateMistakeBankOnFinish(questions);
        app.updateResultRevengeButton();
        app.updateHomeRevengeBanner();

        if (app.isRevengeMode) {
            if (correctCount === totalItems) {
                app.showToastNotification('🏆 XUẤT SẮC! Bạn đã phục thù thành công 100% các câu sai!', 'success');
            } else {
                app.showToastNotification(`Bạn đã sửa đúng ${correctCount}/${totalItems} ý. Còn ${remainingWrong.length} câu sai cần tiếp tục phục thù!`, 'info');
            }
        }

        app.isReviewingResult = true;
        app.isFinishingQuiz = false;
        app.renderReviewList();
        app.switchScreen('result');
        app.animateResultScore(finalScore);
        if (score10El) score10El.textContent = (finalScore / 10).toFixed(1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
})(window);
