/* Print and PDF export helpers for the admin workspace. */
window.AdminPrint = window.AdminPrint || {};
window.AdminPrint.configure = function (context) {
    'use strict';
    const {
        state, $, esc, htmlText, notationText, gradeOf, subjectName, subjectGrade,
        subjectMatchKey, mergeSubjectCatalog, openModal, closeModal, renderMath,
        notify, addActivityLog
    } = context;

    function openPrintModal() {
        const subjectSelect = $('print-subject-select');
        if (subjectSelect) {
            const catalog = mergeSubjectCatalog(state.subjects);
            subjectSelect.innerHTML = '<option value="all">Tất cả các môn học</option>' + catalog.map((item) => {
                const gradeLabel = subjectGrade(item) ? ` (Lớp ${subjectGrade(item)})` : '';
                return `<option value="${esc(item.key)}">${esc(item.name)}${gradeLabel}</option>`;
            }).join('');
            subjectSelect.value = state.subject && state.subject !== 'all' ? state.subject : 'all';
        }
        const gradeSelect = $('print-grade-select');
        if (gradeSelect) gradeSelect.value = state.grade || 'all';
        updatePrintQuestionsPreview();
        openModal('print-modal');
    }

    function updatePrintQuestionsPreview() {
        const subject = $('print-subject-select')?.value || 'all';
        const grade = $('print-grade-select')?.value || 'all';
        const available = state.questions.filter((q) => {
            const matchGrade = grade === 'all' || gradeOf(q) === grade;
            const matchSubject = subject === 'all' || subjectMatchKey(q.subject_key) === subjectMatchKey(subject);
            return matchGrade && matchSubject;
        });
        const infoEl = $('print-available-count');
        if (infoEl) infoEl.textContent = `Hiện có ${available.length} câu hỏi phù hợp trong ngân hàng`;
    }

    function renderMathAndWait(element) {
        return new Promise((resolve) => {
            renderMath(element);
            setTimeout(resolve, 380);
        });
    }

    async function executePrintExam() {
        const subjectKey = $('print-subject-select')?.value || 'all';
        const gradeVal = $('print-grade-select')?.value || 'all';
        const examTitle = $('print-title-input')?.value?.trim() || 'ĐỀ KIỂM TRA ĐÁNH GIÁ CHẤT LƯỢNG HỌC KỲ';
        const schoolName = $('print-school-input')?.value?.trim() || 'SỞ GIÁO DỤC VÀ ĐÀO TẠO - TRƯỜNG QUIZ STUDIO';
        const testCode = $('print-code-input')?.value?.trim() || '101';
        const duration = $('print-duration-input')?.value?.trim() || '45 phút (không kể thời gian phát đề)';
        const countLimit = parseInt($('print-count-input')?.value || '0', 10);
        const shouldShuffle = $('print-shuffle-check')?.checked || false;
        const printMode = $('print-mode-select')?.value || 'exam_and_answers';
        let pool = state.questions.filter((q) => {
            const matchGrade = gradeVal === 'all' || gradeOf(q) === gradeVal;
            const matchSubject = subjectKey === 'all' || subjectMatchKey(q.subject_key) === subjectMatchKey(subjectKey);
            return matchGrade && matchSubject;
        });
        if (!pool.length) return notify('Không có câu hỏi nào thỏa mãn điều kiện lọc để xuất đề!', true);
        if (shouldShuffle) {
            pool = [...pool];
            for (let i = pool.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [pool[i], pool[j]] = [pool[j], pool[i]];
            }
        }
        if (countLimit > 0 && countLimit < pool.length) pool = pool.slice(0, countLimit);
        const printContainer = $('print-paper');
        if (!printContainer) return;
        const subjectTitle = subjectKey === 'all' ? 'TỔNG HỢP KIẾN THỨC' : subjectName(subjectKey).toUpperCase();
        const gradeTitle = gradeVal === 'all' ? '' : ` - KHỐI ${gradeVal}`;
        let html = `<div class="print-page-document"><header class="print-exam-header"><div class="print-header-col print-col-left"><div class="print-school-name">${esc(schoolName.toUpperCase())}</div><div class="print-exam-badge">ĐỀ THI CHÍNH THỨC</div><div class="print-sub-note"><em>(Đề thi gồm ${pool.length} câu)</em></div></div><div class="print-header-col print-col-right"><div class="print-nation-title">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div><div class="print-motto">Độc lập - Tự do - Hạnh phúc</div><div class="print-header-divider"></div></div></header><div class="print-exam-center-title"><h2>${esc(examTitle.toUpperCase())}</h2><div class="print-subject-line">Môn thi: <strong>${esc(subjectTitle)}</strong>${esc(gradeTitle)}</div><div class="print-duration-line"><em>Thời gian làm bài: ${esc(duration)}</em></div></div><div class="print-student-info-bar"><div class="print-info-left"><div class="print-info-row"><span class="info-label">Họ và tên thí sinh:</span><span class="info-dots">......................................................................................................</span></div><div class="print-info-row"><span class="info-label">Số báo danh:</span><span class="info-dots">..................................................................</span><span class="info-label" style="margin-left: 18px;">Lớp:</span><span class="info-dots">..................................</span></div></div><div class="print-test-code-badge"><span>MÃ ĐỀ THI</span><strong>${esc(testCode)}</strong></div></div><div class="print-questions-body">`;
        pool.forEach((q, idx) => {
            const qType = q.q_type || q.qType || 'mcq';
            let optionsHtml = '';
            if (qType === 'tf_group' && Array.isArray(q.statements) && q.statements.length > 0) {
                optionsHtml = `<div class="print-tf-grid">${q.statements.map((s) => `<div class="print-tf-statement"><span class="tf-key"><strong>${esc(s.key || '')})</strong></span><span class="tf-content">${htmlText(s.text)}</span><span class="tf-brackets">[ Đúng / Sai ]</span></div>`).join('')}</div>`;
            } else if (qType === 'short_answer') {
                optionsHtml = '<div class="print-short-field"><span><strong>Đáp án:</strong></span><span class="print-short-line">........................................................................................................................</span></div>';
            } else {
                const opts = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
                const maxLen = opts.reduce((acc, cur) => Math.max(acc, notationText(cur).length), 0);
                const colClass = maxLen <= 22 ? 'cols-4' : (maxLen <= 50 ? 'cols-2' : 'cols-1');
                optionsHtml = `<div class="print-options-grid ${colClass}">${opts.map((opt, oIdx) => `<div class="print-opt-item"><span class="opt-label"><strong>${'ABCD'[oIdx]}.</strong></span><span class="opt-text">${htmlText(opt)}</span></div>`).join('')}</div>`;
            }
            html += `<div class="print-question-block"><div class="print-question-text"><span class="q-label"><strong>Câu ${idx + 1}:</strong></span><span class="q-content">${htmlText(q.question)}</span></div>${optionsHtml}</div>`;
        });
        html += '</div><div class="print-end-exam"><div class="end-rule">---------- HẾT ----------</div><div class="end-note"><em>Cán bộ coi thi không giải thích gì thêm. Thí sinh không được sử dụng tài liệu.</em></div></div></div>';
        if (printMode === 'exam_and_answers') {
            html += `<div class="print-answers-page"><div class="print-answers-header"><h2>HƯỚNG DẪN CHẤM VÀ ĐÁP ÁN CHI TIẾT</h2><p>Môn thi: <strong>${esc(subjectTitle)}</strong>${esc(gradeTitle)} — Mã đề thi: <strong>${esc(testCode)}</strong></p></div><div class="print-section-title">I. BẢNG ĐÁP ÁN NHANH</div>`;
            for (let i = 0; i < pool.length; i += 10) {
                const chunk = pool.slice(i, i + 10);
                html += `<table class="print-matrix-table"><thead><tr><th class="matrix-label">Câu</th>${chunk.map((_, cIdx) => `<th>${i + cIdx + 1}</th>`).join('')}</tr></thead><tbody><tr><td class="matrix-label"><strong>Đ/A</strong></td>${chunk.map((q) => { const qType = q.q_type || q.qType || 'mcq'; if (qType === 'tf_group' && Array.isArray(q.statements)) return `<td class="matrix-tf">${esc(q.statements.map((s) => `${s.key || ''}:${s.answer ? 'Đ' : 'S'}`).join(' '))}</td>`; if (qType === 'short_answer') return `<td class="matrix-val">${esc(q.correct_value ?? q.correctValue ?? '')}</td>`; return `<td><strong>${'ABCD'[Number(q.correct ?? q.answer ?? 0)] || 'A'}</strong></td>`; }).join('')}</tr></tbody></table>`;
            }
            html += '<div class="print-section-title" style="margin-top: 22px;">II. HƯỚNG DẪN GIẢI CHI TIẾT</div><div class="print-solutions-list">';
            pool.forEach((q, idx) => {
                const qType = q.q_type || q.qType || 'mcq';
                const ansSummary = qType === 'tf_group' && Array.isArray(q.statements) ? q.statements.map((s) => `Ý ${s.key || ''}: ${s.answer ? 'ĐÚNG' : 'SAI'}`).join(', ') : qType === 'short_answer' ? `Đáp án: ${q.correct_value ?? q.correctValue ?? ''}` : `Đáp án đúng: ${'ABCD'[Number(q.correct ?? q.answer ?? 0)]}`;
                html += `<div class="print-solution-item"><div class="solution-header"><strong>Câu ${idx + 1}:</strong><span class="solution-badge">${esc(ansSummary)}</span></div><div class="solution-body">${q.explanation ? htmlText(q.explanation) : '<em>(Không có lời giải thích chi tiết)</em>'}</div></div>`;
            });
            html += '</div></div>';
        }
        printContainer.innerHTML = html;
        closeModal('print-modal');
        notify('Đang kết xuất đề thi và mở hộp thoại in...');
        await renderMathAndWait(printContainer);
        window.print();
        addActivityLog('Xuất đề thi PDF / Bản in', `Môn ${subjectTitle} · ${pool.length} câu hỏi · Mã đề ${testCode}`, 'purple');
    }

    return { openPrintModal, updatePrintQuestionsPreview, renderMathAndWait, executePrintExam };
};
