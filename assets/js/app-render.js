/* Tiện ích hiển thị và danh sách câu hỏi. */
(function (root) {
    'use strict';
    const AppRender = root.AppRender = root.AppRender || {};
    AppRender.escapeHtml = function (value) {
        return String(value ?? '').replace(/[&<>"']/g, (character) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[character]));
    };
    AppRender.escapeJsString = function (value) {
        return String(value ?? '')
            .replace(/\\/g, '\\\\').replace(/'/g, "\\'")
            .replace(/\n/g, '\\n').replace(/\r/g, '\\r')
            .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    };
    AppRender.attrArg = function (value) {
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return AppRender.escapeHtml(`'${AppRender.escapeJsString(value)}'`);
    };
    AppRender.domKey = function (value) {
        return String(value ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    };
    AppRender.sanitizeMediaUrl = function (url) {
        const raw = String(url ?? '').trim();
        if (!raw) return '';
        return /^https?:\/\//i.test(raw) || /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=]+$/i.test(raw) ? raw : '';
    };
    /**
     * Tự động chuẩn hóa toàn bộ ký hiệu Toán, Lý, Hóa, Sinh, Địa, Anh...
     * Biến các ký hiệu gõ thô (//, <=>, ->, Delta H, KC, độ C, m/s^2, H2O, CaCO3, v.v.)
     * thành chuẩn LaTeX / KaTeX sắc nét, loại bỏ triệt để các ký hiệu // thô kệch.
     */
    AppRender.formatScientificNotation = function (text) {
        if (typeof root.MathNotation !== 'undefined' && typeof root.MathNotation.format === 'function') return root.MathNotation.format(text);
        return AppRender.escapeHtml(text);
    };

    AppRender.buildShortAnswerFeedbackHtml = function (app, question, userVal) {
        const isCorrect = app.isShortAnswerCorrect(question, userVal);
        const correctValue = String(question.correctValue ?? '').trim() || String(question.acceptedValues?.[0] ?? '').trim();
        const showGrading = !app.isExamMode || app.isReviewingResult;
        return `
            <div class="short-answer-feedback ${!showGrading ? 'is-pending' : (isCorrect ? 'is-correct' : 'is-wrong')}" role="status" aria-live="polite">
                <div class="short-answer-feedback-title">
                    <i class="fa-solid ${!showGrading ? 'fa-lock' : (isCorrect ? 'fa-circle-check' : 'fa-circle-xmark')}"></i>
                    <span>${!showGrading ? 'Đã ghi nhận câu trả lời' : (isCorrect ? 'Chính xác' : 'Chưa chính xác')}</span>
                </div>
                <div class="short-answer-feedback-line">
                    <span>Bạn nhập:</span>
                    <strong>${userVal ? app.escapeHtml(userVal) : 'Chưa trả lời'}</strong>
                </div>
                ${showGrading ? `
                    <div class="short-answer-feedback-line">
                        <span>Đáp án đúng:</span>
                        <strong>${correctValue ? app.formatScientificNotation(correctValue) : 'Chưa thiết lập'}</strong>
                    </div>
                ` : ''}
            </div>
        `;
    };

    AppRender.renderAllQuestions = function (app, skipExitAnimation = false, skipEnterAnimation = false) {
        const container = document.getElementById('questions-container');
        if (!container) return;

        // Let the current cards leave before inserting the freshly-rendered state.
        // This keeps answer feedback readable without changing quiz logic.
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (!skipExitAnimation && !reduceMotion && container.querySelector('.quiz-question-card')) {
            clearTimeout(app.questionRenderTimer);
            container.classList.add('question-list-exit');
            app.questionRenderTimer = setTimeout(() => {
                container.classList.remove('question-list-exit');
                app.renderAllQuestions(true, skipEnterAnimation);
            }, 180);
            return;
        }
        clearTimeout(app.questionRenderTimer);
        container.classList.remove('question-list-exit');

        container.innerHTML = '';

        if (app.isExamMode && !app.isReviewingResult && app.currentFilter === 'wrong') {
            app.currentFilter = 'all';
        }

        const questions = app.allQuestions || [];
        const filtered = questions.filter(q => {
            if (app.currentFilter === 'all') return true;
            if (app.currentFilter === 'mcq') return q.qType !== 'tf_group' && q.qType !== 'short_answer';
            if (app.currentFilter === 'tf') return q.qType === 'tf_group';
            if (app.currentFilter === 'short') return q.qType === 'short_answer';
            if (app.currentFilter === 'wrong') {
                if (app.isExamMode && !app.isReviewingResult) return true;
                return app.isQuestionWrong(q);
            }
            return (q.category || '').toLowerCase().includes(app.currentFilter.toLowerCase());
        });

        if (filtered.length === 0) {
            container.innerHTML = `<div class="p-8 text-center text-slate-400">Không có câu hỏi nào thuộc danh mục này.</div>`;
            return;
        }

        const fragment = document.createDocumentFragment();

        filtered.forEach((q, idx) => {
            const qKey = app.domKey(q.id);
            const card = document.createElement('div');
            card.id = `q-card-${qKey}`;
            const animationClass = !skipEnterAnimation ? ' question-card-enter' : '';
            card.className = `glass-card-pro quiz-question-card${animationClass} rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4`;
            card.style.setProperty('--question-index', Math.min(idx, 6));

            // Render hình ảnh đính kèm nếu có
            const safeImgUrl = app.sanitizeMediaUrl(q.image_url || q.imageUrl);
            const imgHtml = safeImgUrl ? `
                <div class="my-3 rounded-xl overflow-hidden border border-slate-700 max-w-md mx-auto">
                    <img src="${app.escapeHtml(safeImgUrl)}" alt="Hình minh họa" class="w-full object-contain max-h-64">
                </div>
            ` : '';

            // Nút Hỏi AI dùng chung cho chế độ Luyện tập
            const aiButtonHtml = app.isAiFeatureEnabled() && !app.isExamMode ? `
                <div class="mt-3 pt-2.5 border-t border-slate-700/50 flex flex-wrap items-center justify-between gap-2">
                    <button type="button" onclick="app.askAiExplanation(${app.attrArg(q.id)})" id="ai-btn-${qKey}" class="btn-3d px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition cursor-pointer">
                        <i class="fa-solid fa-robot text-amber-300"></i>
                        <span>Hỏi AI giải thích chi tiết</span>
                    </button>
                    <span class="text-[11px] text-blue-300/80 font-medium flex items-center gap-1"><i class="fa-solid fa-bolt text-amber-400 text-[10px]"></i> AI Sư Phạm</span>
                </div>
                <div id="ai-explanation-${qKey}" class="ui-accordion-wrap" aria-hidden="true"><div class="ui-accordion-inner"><div class="p-3.5 rounded-2xl ai-explanation-box text-xs text-slate-200 space-y-2"></div></div></div>
            ` : '';

            // 1. Dạng Trắc Nghiệm 4 Đáp Án (MCQ)
            if (q.qType !== 'tf_group' && q.qType !== 'short_answer') {
                const optChars = ['A', 'B', 'C', 'D', 'E', 'F'];
                const selected = app.userAnswers[q.id];
                const isAnswered = selected !== undefined;
                const showGrading = !app.isExamMode || app.isReviewingResult;
                const lockMcq = app.isReviewingResult || (!app.isExamMode && isAnswered);
                const rawCorrectIdx = q.correct !== undefined ? q.correct : q.answer;
                const correctIdx = (rawCorrectIdx !== undefined && rawCorrectIdx !== null && rawCorrectIdx !== '') ? Number(rawCorrectIdx) : NaN;

                card.innerHTML = `
                    <div class="quiz-card-meta flex items-center justify-between gap-2">
                        <span class="quiz-number">${String(idx + 1).padStart(2, '0')} <span>/ ${questions.length}</span></span>
                        <span class="quiz-category">${app.escapeHtml(q.category || 'Trắc nghiệm')}</span>
                    </div>
                    <h3 class="quiz-question-title font-bold text-white text-sm sm:text-base leading-relaxed">${app.formatScientificNotation(q.question)}</h3>
                    ${imgHtml}
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        ${(q.options || []).map((opt, oIdx) => {
                    let optStyle = "bg-slate-900/80 hover:bg-slate-800 border-slate-700 text-slate-200";

                    if (!showGrading) {
                        if (selected === oIdx) {
                            optStyle = "bg-sky-600/30 border-sky-500 text-white font-bold ring-2 ring-sky-500/50";
                        }
                    } else if (isAnswered || app.isReviewingResult) {
                        if (oIdx === correctIdx) {
                            optStyle = "bg-emerald-600/25 border-emerald-500 text-emerald-200 font-bold option-selected-correct";
                        } else if (selected === oIdx) {
                            optStyle = "bg-rose-600/25 border-rose-500 text-rose-200 font-bold option-selected-wrong";
                        }
                    }

                    const feedbackIcon = showGrading && (isAnswered || app.isReviewingResult) && oIdx === correctIdx
                        ? '<span class="answer-feedback-icon" aria-hidden="true"><i class="fa-solid fa-check"></i></span>'
                        : '';

                    return `
                                <button type="button" onclick="app.selectOption(${app.attrArg(q.id)}, ${oIdx})" ${lockMcq ? 'disabled' : ''} class="quiz-option-tile w-full p-3 sm:p-3.5 rounded-xl border text-left flex items-start gap-3 transition-colors cursor-pointer disabled:cursor-default ${optStyle}">
                                    <span class="quiz-option-letter">${optChars[oIdx]}</span>
                                    <span class="quiz-option-content text-xs sm:text-sm font-medium flex-1 pt-0.5">${app.formatScientificNotation(opt)}</span>
                                    ${feedbackIcon}
                                </button>
                            `;
                }).join('')}
                    </div>
                    ${(showGrading && (isAnswered || app.isReviewingResult) && q.explanation) ? `
                        <div class="ui-accordion-wrap is-open practice-explanation-accordion"><div class="ui-accordion-inner"><div class="practice-explanation-box p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 leading-relaxed">
                            <p class="font-bold text-amber-400 mb-1 flex items-center gap-1.5"><i class="fa-solid fa-lightbulb"></i> Giải thích chi tiết:</p>
                            <p>${app.formatScientificNotation(q.explanation)}</p>
                        </div></div></div>
                    ` : ''}
                    ${aiButtonHtml}
                `;
            }

            // 2. Dạng Đúng/Sai Nhiều Ý (True / False Group)
            else if (q.qType === 'tf_group') {
                const ansObj = app.userAnswers[q.id] || {};
                const stmts = q.statements || [];
                const showGrading = !app.isExamMode || app.isReviewingResult;

                card.innerHTML = `
                    <div class="flex items-center justify-between gap-2">
                        <span class="px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-bold text-xs">Câu ${idx + 1} (Đúng / Sai)</span>
                        <span class="text-[11px] text-slate-400">${app.escapeHtml(q.category || 'Đúng/Sai')}</span>
                    </div>
                    <h3 class="font-bold text-white text-sm sm:text-base leading-relaxed">${app.formatScientificNotation(q.question)}</h3>
                    ${imgHtml}
                    <div class="space-y-2.5 pt-1">
                        ${stmts.map((st, sIdx) => {
                    const val = ansObj[sIdx];
                    const isAnswered = val !== undefined;
                    const lockTf = app.isReviewingResult || (!app.isExamMode && isAnswered);

                    let trueBtnClass = "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500";
                    let falseBtnClass = "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500";

                    if (!showGrading) {
                        if (val === true) trueBtnClass = "bg-sky-600 border-sky-500 text-white font-bold";
                        if (val === false) falseBtnClass = "bg-sky-600 border-sky-500 text-white font-bold";
                    } else if (isAnswered) {
                        if (val === true) {
                            trueBtnClass = (st.answer === true) ? "bg-emerald-600 border-emerald-500 text-white font-bold" : "bg-rose-600 border-rose-500 text-white font-bold";
                        }
                        if (val === false) {
                            falseBtnClass = (st.answer === false) ? "bg-emerald-600 border-emerald-500 text-white font-bold" : "bg-rose-600 border-rose-500 text-white font-bold";
                        }
                    }

                    const trueStateClass = val === true
                        ? `is-selected ${showGrading ? (st.answer === true ? 'is-selected-correct' : 'is-selected-wrong') : 'is-exam-selected'}`
                        : (lockTf ? 'is-locked' : '');
                    const falseStateClass = val === false
                        ? `is-selected ${showGrading ? (st.answer === false ? 'is-selected-correct' : 'is-selected-wrong') : 'is-exam-selected'}`
                        : (lockTf ? 'is-locked' : '');

                    return `
                                <div class="tf-statement-row p-2.5 sm:p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-2.5 sm:gap-3 text-xs" id="tf-row-${qKey}-${sIdx}">
                                    <div class="flex items-start gap-2 flex-1 min-w-0">
                                        <span class="font-bold text-sky-400 shrink-0">${String.fromCharCode(97 + sIdx)})</span>
                                        <span class="text-slate-200 font-medium leading-relaxed break-words">${app.formatScientificNotation(st.text)}</span>
                                    </div>
                                    <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
                                        <button type="button" id="tf-btn-${qKey}-${sIdx}-true" onclick="app.selectTfOption(${app.attrArg(q.id)}, ${sIdx}, true)" ${lockTf ? 'disabled' : ''} aria-pressed="${val === true}" class="tf-choice-button px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-bold ${trueStateClass} ${trueBtnClass}">
                                            ĐÚNG
                                        </button>
                                        <button type="button" id="tf-btn-${qKey}-${sIdx}-false" onclick="app.selectTfOption(${app.attrArg(q.id)}, ${sIdx}, false)" ${lockTf ? 'disabled' : ''} aria-pressed="${val === false}" class="tf-choice-button px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-bold ${falseStateClass} ${falseBtnClass}">
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
                const hasSubmitted = app.hasSubmittedAnswer(q.id);
                const userVal = hasSubmitted ? String(app.userAnswers[q.id] ?? '') : '';
                const shortFeedbackHtml = (hasSubmitted || app.isReviewingResult) ? app.buildShortAnswerFeedbackHtml(q, userVal) : '';

                const isInputLocked = app.isReviewingResult || (!app.isExamMode && hasSubmitted);

                card.innerHTML = `
                    <div class="flex items-center justify-between gap-2">
                        <span class="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-xs">Câu ${idx + 1} (Trả lời ngắn)</span>
                        <span class="text-[11px] text-slate-400">${app.escapeHtml(q.category || 'Điền số/chữ')}</span>
                    </div>
                    <h3 class="font-bold text-white text-sm sm:text-base leading-relaxed">${app.formatScientificNotation(q.question)}</h3>
                    ${imgHtml}
                    <div class="pt-2 flex flex-col sm:flex-row gap-2">
                        <input type="text" id="short-input-${qKey}" value="${app.escapeHtml(userVal)}" ${isInputLocked ? 'disabled' : ''} aria-disabled="${isInputLocked}" onchange="app.saveShortAnswer(${app.attrArg(q.id)}, this.value)" onkeydown="if (event.key === 'Enter') { event.preventDefault(); app.saveShortAnswer(${app.attrArg(q.id)}, this.value); }" placeholder="Nhập đáp án của bạn..." class="answer-text-input flex-1 px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-base sm:text-sm outline-none focus:border-sky-500 font-mono ${hasSubmitted ? 'is-submitted' : ''}">
                        <button type="button" ${isInputLocked ? 'disabled' : ''} aria-disabled="${isInputLocked}" onclick="app.saveShortAnswer(${app.attrArg(q.id)}, this.parentElement.querySelector('.answer-text-input').value)" class="answer-submit-button px-5 py-2.5 rounded-xl text-white font-bold text-xs cursor-pointer ${hasSubmitted ? 'is-submitted' : ''}">
                            <i class="fa-solid ${hasSubmitted ? 'fa-check' : 'fa-arrow-right'}"></i>
                            <span>${hasSubmitted ? (app.isExamMode ? 'Cập nhật' : 'Đã ghi nhận') : 'Ghi nhận'}</span>
                        </button>
                    </div>
                    ${shortFeedbackHtml}
                    ${aiButtonHtml}
                `;
            }

            fragment.appendChild(card);
        });

        container.appendChild(fragment);

        app.renderMath(container);
    };
})(window);
