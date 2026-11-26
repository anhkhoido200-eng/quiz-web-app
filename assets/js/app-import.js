/* Module tách từ QuizApp (app.js) */
(function (root) {
    'use strict';
    const QuizApp = root.QuizApp;
    if (typeof QuizApp !== 'function') {
        throw new Error('QuizApp must be loaded before QuizAppImportMixin');
    }

    class QuizAppImportMixin {
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
            const tfM = line.match(/^([a-d])[\s.):-]\s*(.*)$/);
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



        // Câu trả lời ngắn: không có phương án, đáp án nằm trong dòng Đáp án.
        if (options.length < 2 && ansStr) {
            const correctValue = ansStr.replace(/^[:=\-\s]+/, '').trim();
            return {
                id: qNum, qType: 'short_answer', category: currentCategory || 'Ôn tập',
                question: fullContent, options: [], correctValue,
                acceptedValues: [correctValue], correct: 0, answer: 0,
                correctAnswer: correctValue, explanation, image_url: imgUrl || ''
            };
        }

        // Trường hợp còn lại (thiếu phương án)
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

        const optChars = ['A', 'B', 'C', 'D', 'E', 'F'];

        this.parsedImportQuestions.forEach((q, idx) => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-900/60 transition";
            let typeBadge = '<span class="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-bold text-[10px]">MCQ (4 đáp án)</span>';
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
                typeBadge = '<span class="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold text-[10px]">Đúng/Sai (Ý)</span>';
                ansDisplay = `
                    <div class="flex flex-col gap-1.5 min-w-[130px]">
                        ${(q.statements || []).map((st, sIdx) => {
                            const letter = String.fromCharCode(97 + sIdx);
                            const isTrue = st.answer === true;
                            return `
                                <div class="inline-flex items-center justify-between gap-2 p-1 rounded-xl bg-slate-900 border border-slate-700/80 shadow-inner">
                                    <span class="font-bold text-blue-300 text-xs px-1.5">${letter}</span>
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
                ansDisplay = this.escapeHtml(String(q.correctValue || ''));
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

            const imgUrl = this.sanitizeMediaUrl(q.image_url || q.imageUrl);
            const imgBadge = imgUrl ? `
                <div class="mt-1 flex items-center gap-1.5">
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px] border border-amber-500/30" title="Đã đính kèm ảnh gốc thật 100% từ đề Word">
                        <i class="fa-solid fa-image"></i> Có ảnh
                    </span>
                    <img src="${this.escapeHtml(imgUrl)}" class="w-7 h-7 object-cover rounded border border-slate-700 inline-block cursor-pointer hover:scale-150 transition-transform bg-slate-800" onclick="window.open(${this.attrArg(imgUrl)}, '_blank', 'noopener,noreferrer')" title="Nhấp để xem ảnh gốc">
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
                                    <span class="font-bold text-blue-400 shrink-0">${letter})</span>
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
                const oldCache = replaceAll ? [] : JSON.parse(localStorage.getItem(`quiz_cache_${targetSubject}`) || '[]');
                localStorage.setItem(`quiz_cache_${targetSubject}`, JSON.stringify(replaceAll ? cleanQuestions : [...oldCache, ...cleanQuestions]));
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

    }

    const descriptors = Object.getOwnPropertyDescriptors(QuizAppImportMixin.prototype);
    delete descriptors.constructor;
    Object.defineProperties(QuizApp.prototype, descriptors);

})(window);
