/* Question import helpers for the admin workspace. */
window.AdminImport = window.AdminImport || {};
window.AdminImport.configure = function (context) {
    'use strict';
    const {
        state, $, esc, htmlText, notationText, TYPE_LABELS, normalizeAiQuestion,
        validateAiQuestionSet, subjectMatchKey, subjectName, fillLibrarySubjects,
        switchView, openModal, closeModal, fillForm, renderMath, notify, confirmDialog,
        setActionBusy, nextQuestionId, toRecord, upsertRestoredRows, moveQuestionsToTrash,
        addActivityLog, loadQuestions
    } = context;

    async function extractFile(file) { return file.text(); }

    function openImport() {
        state.importQuestions = []; state.importIndex = 0; state.sourceText = ''; state.importError = '';
        if ($('import-text')) $('import-text').value = '';
        if ($('import-replace')) $('import-replace').checked = false;
        if ($('import-preview')) $('import-preview').innerHTML = '<p class="muted-copy">Dán JSON câu hỏi rồi bấm “Đọc JSON” để xem trước và lưu.</p>';
        fillLibrarySubjects(); switchView('questions'); openModal('import-modal');
    }

    function extractJsonPayload(raw) {
        const text = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        const candidates = [text];
        const arrayStart = text.indexOf('['); const arrayEnd = text.lastIndexOf(']');
        if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(text.slice(arrayStart, arrayEnd + 1));
        const objectStart = text.indexOf('{'); const objectEnd = text.lastIndexOf('}');
        if (objectStart >= 0 && objectEnd > objectStart) candidates.push(text.slice(objectStart, objectEnd + 1));
        for (const candidate of candidates) {
            try {
                const parsed = JSON.parse(candidate);
                const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.questions) ? parsed.questions : (Array.isArray(parsed.data) ? parsed.data : [parsed]));
                if (list.length) return list;
            } catch (error) { /* Try the next JSON boundary. */ }
        }
        throw new Error('Dữ liệu không phải JSON hợp lệ hoặc không có câu hỏi.');
    }

    function parseJsonInput(text) {
        state.importError = '';
        try {
            const parsed = extractJsonPayload(text);
            const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.questions) ? parsed.questions : [parsed]);
            const normalized = list.map(normalizeAiQuestion);
            const structureErrors = validateAiQuestionSet(normalized);
            if (structureErrors.length) { state.importError = structureErrors.slice(0, 3).join('; '); return []; }
            state.importIntegrity = validateVerbatimQuestions(normalized, text);
            return normalized;
        } catch (error) {
            state.importError = `JSON lỗi cú pháp: ${error.message}`;
            return [];
        }
    }

    function persistImportDraft() {
        try { sessionStorage.setItem('quiz_import_draft', JSON.stringify({ questions: state.importQuestions, sourceText: state.sourceText, subject: state.importSubject, integrity: state.importIntegrity })); } catch (error) { /* Ignore storage quota errors */ }
    }

    function restoreImportDraft() {
        try {
            const draft = JSON.parse(sessionStorage.getItem('quiz_import_draft') || 'null');
            if (!draft || !Array.isArray(draft.questions) || !draft.questions.length) return false;
            state.importQuestions = draft.questions.map(normalizeAiQuestion); state.sourceText = draft.sourceText || '';
            state.importSubject = draft.subject || state.importSubject; state.importIntegrity = draft.integrity || validateVerbatimQuestions(state.importQuestions, state.sourceText);
            state.importIndex = 0; renderImportReview(); return true;
        } catch (error) { return false; }
    }

    function renderImportReview() {
        const root = $('import-preview');
        if (!root) return;
        if (!state.importQuestions.length) { root.innerHTML = '<p class="muted-copy">Chưa có câu hỏi đã đọc.</p>'; return; }
        const q = normalizeAiQuestion(state.importQuestions[state.importIndex]);
        const type = TYPE_LABELS[q.qType] || TYPE_LABELS.mcq;
        const detail = q.qType === 'tf_group' ? q.statements.map((item) => `<div class="tf-preview-row"><b>${esc(item.key)}</b><span>${htmlText(item.text)}</span><span class="tf-preview-answer ${item.answer ? '' : 'false'}">${item.answer ? 'ĐÚNG' : 'SAI'}</span></div>`).join('') : q.qType === 'short_answer' ? `<div class="item-option is-correct">Đáp án: ${esc(q.correctValue)}</div>` : q.options.map((item, index) => `<div class="preview-option ${index === q.correct ? 'is-correct' : ''}"><b>${'ABCD'[index]}</b><span>${htmlText(item)}</span></div>`).join('');
        const integrity = state.importIntegrity.valid ? '<div class="strict-warning"><i class="fa-solid fa-lock"></i><span>Giữ nguyên nội dung và thứ tự theo JSON đã đọc. Hãy duyệt từng câu trước khi lưu.</span></div>' : `<div class="strict-warning" style="border-color:#fca5a5;background:#fff0f0;color:#b91c1c"><i class="fa-solid fa-triangle-exclamation"></i><span>Không khớp nguyên văn một số trường sau khi chuẩn hóa khoảng trắng: ${esc(state.importIntegrity.errors.join(' | '))}. Khi bấm lưu, Admin sẽ được hỏi xác nhận tiếp tục.</span></div>`;
        root.innerHTML = `<div class="ai-review"><div class="ai-review-toolbar"><b>Câu ${state.importIndex + 1}/${state.importQuestions.length} · ${esc(type)}</b><div><button type="button" class="button button-secondary compact" data-import-prev ${state.importIndex === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button> <button type="button" class="button button-secondary compact" data-import-next ${state.importIndex === state.importQuestions.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button></div></div><div class="ai-review-list">${state.importQuestions.map((item, index) => `<button type="button" class="ai-review-index ${index === state.importIndex ? 'is-active' : ''}" data-import-index="${index}">Câu ${index + 1}</button>`).join('')}</div><div class="ai-review-question"><b>${htmlText(q.question)}</b><div style="margin-top:9px">${detail}</div><p class="muted-copy">${htmlText(q.explanation)}</p></div>${integrity}</div>`;
        renderMath(root);
    }

    function validateVerbatimQuestions(questions, source) {
        if (!source) return { valid: true, errors: [] };
        const errors = []; const normalizeVerbatim = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
        const normalizedSource = normalizeVerbatim(source);
        const check = (value, label) => { const normalizedValue = normalizeVerbatim(value); if (normalizedValue && !normalizedSource.toLowerCase().includes(normalizedValue.toLowerCase())) errors.push(label); };
        questions.forEach((raw, index) => { const q = normalizeAiQuestion(raw); check(notationText(q.question), `Câu ${index + 1}: câu hỏi`); if (q.qType === 'mcq') q.options.forEach((value, optionIndex) => check(notationText(value), `Câu ${index + 1}: phương án ${'ABCD'[optionIndex]}`)); if (q.qType === 'tf_group') q.statements.forEach((value, statementIndex) => check(notationText(value.text ?? value.content), `Câu ${index + 1}: ý ${'abcd'[statementIndex]}`)); });
        return { valid: errors.length === 0, errors };
    }

    async function saveImportQuestions() {
        if (state.importSaving) return;
        if (!state.importQuestions.length) { if (restoreImportDraft()) return notify('Đã khôi phục bản nháp câu hỏi. Bấm Lưu vào ngân hàng để tiếp tục.'); return notify(state.importError || 'Chưa có câu hỏi để lưu. Hãy dán JSON hợp lệ rồi bấm Đọc JSON.', true); }
        if (!state.importIntegrity.valid && !(await confirmDialog({ title: 'Tiếp tục lưu câu hỏi?', message: 'Không thể xác minh hoàn toàn văn bản nguồn. Admin vẫn muốn tiếp tục lưu các câu hỏi này?', confirmText: 'Vẫn tiếp tục lưu', variant: 'warning' }))) return;
        if ($('import-replace')?.checked && !(await confirmDialog({ title: 'Ghi đè câu hỏi cũ?', message: 'Xóa toàn bộ câu hỏi cũ của môn này trước khi nạp bộ đề mới?', confirmText: 'Xóa cũ & Nạp mới', variant: 'danger' }))) return;
        state.importSaving = true; setActionBusy('save-import', true, 'Đang lưu...');
        try {
            const selectedSubject = String($('import-subject-select')?.value || state.importSubject || '').trim();
            if (!selectedSubject) throw new Error('Chưa chọn môn đích cho bộ câu hỏi.');
            state.importSubject = selectedSubject;
            const replacing = Boolean($('import-replace')?.checked);
            let replaceIdsToDelete = [];
            let replaceRows = [];
            let insertedIds = [];
            if (replacing) {
                const rawKeys = Array.from(new Set([selectedSubject, ...(state.questions || []).filter((q) => subjectMatchKey(q.subject_key || q.subjectKey) === subjectMatchKey(selectedSubject)).map((q) => String(q.subject_key || q.subjectKey || '').trim()).filter(Boolean)]));
                const oldRowsQuery = rawKeys.length > 1 ? state.client.from('quiz_questions').select('*').in('subject_key', rawKeys) : state.client.from('quiz_questions').select('*').eq('subject_key', selectedSubject);
                const { data: oldRows, error: oldErr } = await oldRowsQuery; if (oldErr) throw oldErr; replaceIdsToDelete = (oldRows || []).map((r) => r.id).filter(Boolean);
                replaceRows = oldRows || [];
            }
            const firstId = await nextQuestionId(); const records = state.importQuestions.map((item, index) => toRecord(item, selectedSubject, firstId + index));
            insertedIds = records.map((record) => record.id).filter(Boolean);
            const verifiedCount = await upsertRestoredRows(records, { returnIds: true });
            if (verifiedCount < records.length) throw new Error(`Cloud chỉ xác minh ${verifiedCount}/${records.length} câu vừa nhập ở môn ${selectedSubject}.`);
            if (replaceIdsToDelete.length > 0) {
                await moveQuestionsToTrash((state.questions || []).filter((q) => replaceIdsToDelete.some((id) => String(id) === String(q.id))), 'Thay thế bộ câu hỏi cũ');
                const newIdSet = new Set(records.map((r) => String(r.id))); const safeDeleteIds = replaceIdsToDelete.filter((id) => !newIdSet.has(String(id)));
                for (let i = 0; i < safeDeleteIds.length; i += 50) { const { error: delErr } = await state.client.from('quiz_questions').delete().in('id', safeDeleteIds.slice(i, i + 50)); if (delErr) throw delErr; }
            }
            addActivityLog('Nạp JSON câu hỏi hàng loạt', `Đã lưu ${records.length} câu vào môn ${subjectName(selectedSubject)}`, 'import'); notify(`Đã lưu và xác minh ${records.length} câu vào môn ${selectedSubject}.`); sessionStorage.removeItem('quiz_import_draft'); closeModal('import-modal'); await loadQuestions();
        } catch (error) {
            let rollbackError = null;
            if (replacing && insertedIds.length > 0 && state.client) {
                try {
                    for (let i = 0; i < insertedIds.length; i += 50) {
                        const { error: rollbackDeleteError } = await state.client.from('quiz_questions').delete().in('id', insertedIds.slice(i, i + 50));
                        if (rollbackDeleteError) throw rollbackDeleteError;
                    }
                    if (replaceRows.length > 0) {
                        const rowsToRestore = replaceRows.map((row) => ({
                            ...row,
                            is_deleted: false,
                            deleted_at: null,
                            deleted_by: null
                        }));
                        const restoredCount = await upsertRestoredRows(rowsToRestore, { returnIds: true });
                        if (restoredCount < replaceRows.length) throw new Error(`chỉ khôi phục ${restoredCount}/${replaceRows.length} câu cũ`);
                    }
                } catch (restoreError) {
                    rollbackError = restoreError;
                }
            }
            const detail = rollbackError
                ? ` Dữ liệu có thể chưa được khôi phục đầy đủ: ${rollbackError.message || rollbackError}.`
                : (replacing && insertedIds.length > 0 ? ' Đã hủy các câu mới và cố gắng khôi phục dữ liệu cũ.' : '');
            notify(`Không thể hoàn tất thay thế bộ câu hỏi: ${error.message || error}.${detail}`, true);
        } finally { state.importSaving = false; setActionBusy('save-import', false); }
    }

    async function handleImportFile(file) {
        if (!file) return;
        try { const source = await extractFile(file); $('import-text').value = source; const list = parseJsonInput(source); if (!list.length) throw new Error(state.importError || 'File không chứa JSON câu hỏi hợp lệ.'); state.sourceText = source; state.importQuestions = list; state.importError = ''; state.importIndex = 0; state.importIntegrity = validateVerbatimQuestions(list, source); persistImportDraft(); renderImportReview(); notify(`Đã đọc ${list.length} câu từ ${file.name}.`); } catch (error) { notify(`Không thể đọc file: ${error.message}`, true); }
    }

    async function analyzeWithGemini() { return notify('Gemini phân tích đề đã được tắt. Hãy dán JSON rồi bấm Đọc JSON.', true); }

    return { extractFile, openImport, parseJsonInput, extractJsonPayload, persistImportDraft, restoreImportDraft, renderImportReview, validateVerbatimQuestions, saveImportQuestions, handleImportFile, analyzeWithGemini };
};
