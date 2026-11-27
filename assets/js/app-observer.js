/* Module tách từ QuizApp (app.js) */
(function (root) {
    'use strict';
    const QuizApp = root.QuizApp;
    if (typeof QuizApp !== 'function') {
        throw new Error('QuizApp must be loaded before QuizAppObserverMixin');
    }

    class QuizAppObserverMixin {
    _getProgressDetailStatementStates(it) {
        if (it.t !== 'tf' && !Array.isArray(it.ca) && !Array.isArray(it.ua)) return null;
        const ua = Array.isArray(it.ua) ? it.ua : [];
        const ca = Array.isArray(it.ca) ? it.ca : [];
        return Array.from({ length: ca.length || ua.length }, (_, i) => {
            const isAnswered = ua[i] === true || ua[i] === false;
            return isAnswered ? ua[i] === ca[i] : null;
        });
    }

    _isProgressDetailItemAnswered(it) {
        return (it.answer !== undefined && it.answer !== null && String(it.answer).trim() !== '') ||
            (it.ua !== undefined && it.ua !== null && String(it.ua).trim() !== '') ||
            it.ua === false || it.ua === 0;
    }

    _countProgressDetailItems(items) {
        let detailAnswered = 0;
        let detailCorrect = 0;
        let detailTotal = 0;
        for (const it of items) {
            if (!it) continue;
            const states = this._getProgressDetailStatementStates(it);
            if (states) {
                detailTotal += states.length;
                for (const state of states) {
                    if (state !== null) detailAnswered++;
                    if (state === true) detailCorrect++;
                }
            } else {
                detailTotal++;
                if (this._isProgressDetailItemAnswered(it)) detailAnswered++;
                if (it.ok === true) detailCorrect++;
            }
        }
        return { detailAnswered, detailCorrect, detailTotal };
    }

    parseStudentProgressRecord(row) {
        const rawStatus = String(row?.status || '');
        const fullRawScore = String(row?.score_summary || '');
        const detailMarkerIdx = fullRawScore.indexOf('\n__DETAIL__:');
        let detail = null;
        if (detailMarkerIdx >= 0) {
            try {
                detail = JSON.parse(fullRawScore.slice(detailMarkerIdx + '\n__DETAIL__:'.length));
            } catch (e) {}
        }
        const rawScore = detailMarkerIdx >= 0 ? fullRawScore.slice(0, detailMarkerIdx) : fullRawScore;
        let subjectName = '';
        // Hỗ trợ ngoặc lồng nhau: "[[Phục thù] Toán đề 1] ..."
        const bracketRe = /^\[((?:\[[^\]]*\]|[^\]])*)\]/;
        const subjMatch = rawStatus.match(bracketRe) || rawScore.match(bracketRe);
        if (subjMatch) subjectName = subjMatch[1].trim();

        const isRevenge = /^\[?\s*phục\s*thù\s*\]?/i.test(subjectName) || Boolean(detail && detail.revenge);
        const baseSubjectName = subjectName.replace(/^\[\s*phục\s*thù\s*\]\s*/i, '').replace(/^phục\s*thù\s*[:\-]?\s*/i, '').trim();

        let isGrade5 = false;
        let gradeResolved = false;
        if (baseSubjectName && Array.isArray(this.dynamicSubjects) && typeof this.getSubjectGrade === 'function') {
            const baseNorm = baseSubjectName.toLowerCase().replace(/\s+/g, ' ');
            const matchedSub = this.dynamicSubjects.find((s) => {
                const title = String(s?.title || s?.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
                const key = String(s?.key || s?.id || '').trim().toLowerCase();
                return (title && title === baseNorm) || (key && key === baseNorm);
            });
            if (matchedSub) {
                isGrade5 = String(this.getSubjectGrade(matchedSub)) === '5';
                gradeResolved = true;
            }
        }
        if (!gradeResolved && baseSubjectName) {
            const looksOtherGrade = /lớp\s*(?:[0-46-9]|1[0-2])\b|vật\s*l[íý]|hóa\s*học|lịch\s*sử|địa\s*l[íý]|sinh\s*học|\b(?:6|7|8|9|10|11|12)\b/i.test(baseSubjectName);
            isGrade5 = !looksOtherGrade && (/lớp\s*5|math5|toán/i.test(baseSubjectName));
        }

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

        const isCompleted = /đã nộp bài/i.test(rawStatus) || /hoàn thành/i.test(rawScore) || /(?:^|[|•\s])(?:điểm\s*[:=]?\s*\d|\d+(?:[.,]\d+)?\s*điểm)/i.test(rawScore);
        const hasDetailItems = Array.isArray(detail?.items) && detail.items.length > 0;
        if (hasDetailItems) {
            const { detailAnswered, detailCorrect, detailTotal } = this._countProgressDetailItems(detail.items);
            answered = detailAnswered;
            correct = detailCorrect;
            wrong = Math.max(0, answered - correct);
            if (detailTotal > 0) total = detailTotal;
            percent = total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0;
        }
        if (isCompleted && !hasDetailItems && percent === 0 && total > 0) percent = 100;

        let finalScore = null;
        const scoreMatch = rawScore.match(/(\d+(?:[.,]\d+)?)\s*điểm/i);
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

        const durationSecFromDetail = Number(detail?.sec);
        let durationSec = Number.isFinite(durationSecFromDetail) && durationSecFromDetail >= 0 ? durationSecFromDetail : null;
        if (durationSec === null) {
            const elapsedMatch = rawScore.match(/-\s*(\d{1,3}):(\d{2})(?:\s|$)/) || rawStatus.match(/-\s*(\d{1,3}):(\d{2})(?:\s|$)/);
            if (elapsedMatch) durationSec = parseInt(elapsedMatch[1], 10) * 60 + parseInt(elapsedMatch[2], 10);
        }
        if (durationSec === null) {
            const elapsedMatch = rawScore.match(/(\d+)\s*p\s*(\d+)\s*s/i) || rawStatus.match(/(\d+)\s*p\s*(\d+)\s*s/i);
            if (elapsedMatch) durationSec = parseInt(elapsedMatch[1], 10) * 60 + parseInt(elapsedMatch[2], 10);
        }
        if (durationSec === null) {
            const elapsedMatch = rawScore.match(/(\d+)\s*(?:giây|s)\b/i) || rawStatus.match(/(\d+)\s*(?:giây|s)\b/i);
            if (elapsedMatch) durationSec = parseInt(elapsedMatch[1], 10);
        }
        let durationLabel = 'Vừa bắt đầu';
        if (durationSec !== null) {
            const m = Math.floor(durationSec / 60);
            const s = durationSec % 60;
            durationLabel = m > 0 ? `${m}p ${s}s` : `${s}s`;
        } else if (!isWaiting && row?.created_at && row?.last_active) {
            const diffSec = Math.max(0, Math.round((new Date(row.last_active).getTime() - new Date(row.created_at).getTime()) / 1000));
            if (Number.isFinite(diffSec) && diffSec > 0) {
                const m = Math.floor(diffSec / 60);
                const s = diffSec % 60;
                durationLabel = m > 0 ? `${m}p ${s}s` : `${s}s`;
            }
        }

        return {
            id: row?.id,
            name: row?.player_name || 'Học sinh',
            ip: row?.ip_address || '',
            device: row?.device_info || '',
            subject: subjectName || 'Chưa chọn môn',
            baseSubject: baseSubjectName,
            isRevenge,
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
            detail,
            durationLabel,
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
        if (this.observerRealtimeChannel) {
            try { window.dbService?.client?.removeChannel?.(this.observerRealtimeChannel); } catch (e) {}
            try { this.observerRealtimeChannel.unsubscribe?.(); } catch (e) {}
            this.observerRealtimeChannel = null;
        }
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

    buildObserverProgressBarHtml(p, percent) {
        const items = p.detail?.items;
        if (Array.isArray(items) && items.length > 0) {
            return `<div class="obs-progress-segments">${items.map((it, idx) => {
                if (!it) return '';
                const renderSegment = (state, label) => {
                    const cls = state === true ? 'is-ok' : (state === false ? 'is-bad' : 'is-none');
                    const status = state === true ? 'Đúng' : (state === false ? 'Sai' : 'Chưa làm');
                    return `<span class="obs-progress-seg ${cls}" title="${label}: ${status}"></span>`;
                };
                const states = this._getProgressDetailStatementStates(it);
                if (states) {
                    return states.map((state, i) => renderSegment(state, `Câu ${idx + 1}, ý ${i + 1}`)).join('');
                }
                const state = it.ok === true ? true : (this._isProgressDetailItemAnswered(it) ? false : null);
                return renderSegment(state, `Câu ${idx + 1}`);
            }).join('')}</div>`;
        }
        const wrongCount = Number.isFinite(p.wrong) ? p.wrong : (p.isCompleted ? Math.max(0, (p.total || p.answered || 0) - (p.correct || 0)) : 0);
        const totalBase = p.total > 0 ? p.total : Math.max(1, (p.correct || 0) + wrongCount);
        const okPct = totalBase > 0 ? Math.min(100, Math.round(((p.correct || 0) / totalBase) * 1000) / 10) : 0;
        const badPct = totalBase > 0 ? Math.min(Math.max(0, 100 - okPct), Math.round((wrongCount / totalBase) * 1000) / 10) : 0;
        if (okPct === 0 && badPct === 0 && percent > 0) {
            return `<div class="obs-progress-fill h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-sky-500" style="width:${percent}%;"></div>`;
        }
        return `<div class="obs-progress-split">
            ${okPct > 0 ? `<div class="obs-progress-fill is-ok" style="width:${okPct}%"></div>` : ''}
            ${badPct > 0 ? `<div class="obs-progress-fill is-bad" style="width:${badPct}%"></div>` : ''}
        </div>`;
    }

    buildObserverCardHistoryStripHtml(p) {
        const history = Array.isArray(p?.history) ? p.history.slice(0, 8) : [];
        if (history.length <= 1) return '';
        const shown = history.slice(0, 8);
        return `
            <div class="pt-2 border-t border-slate-800/70 space-y-1.5">
                <div class="flex items-center justify-between text-[11px] text-slate-400">
                    <span class="font-semibold flex items-center gap-1.5">
                        <i class="fa-solid fa-clock-rotate-left text-sky-400 text-[10px]"></i>
                        Lịch sử làm bài (${history.length} đề gần nhất)
                    </span>
                </div>
                <div class="flex flex-wrap gap-1.5">
                    ${shown.map((att, idx) => {
                        const isLatest = idx === 0;
                        const isCurrent = String(att.id) === String(p.id);
                        const scoreText = att.isCompleted
                            ? `${att.score10.toFixed(1)}đ`
                            : `${att.answered}/${att.total || '?'} câu`;
                        const chipCls = isCurrent
                            ? 'bg-sky-500/20 border-sky-400/60 text-sky-200'
                            : (att.isCompleted
                                ? 'bg-slate-950/80 border-slate-700/80 text-slate-300 hover:border-sky-500/60 hover:text-white'
                                : 'bg-amber-500/10 border-amber-500/35 text-amber-300 hover:border-amber-400');
                        const latestBadge = isLatest
                            ? `<span class="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9px] font-extrabold uppercase tracking-wide shrink-0">Mới nhất</span>`
                            : '';
                        return `<button type="button" data-obs-history-id="${this.escapeHtml(att.id)}" class="px-2 py-1 rounded-lg border text-[10px] font-semibold inline-flex items-center gap-1 cursor-pointer transition max-w-full ${chipCls}" title="Xem bài làm ${this.escapeHtml(att.subject)}">
                            <span class="${att.isCompleted ? 'text-emerald-400' : 'text-amber-400'}">${att.isCompleted ? '✓' : '•'}</span>
                            <span class="truncate max-w-[115px]">${this.escapeHtml(att.subject)}</span>
                            <span class="font-extrabold ${att.isCompleted ? 'text-amber-300' : 'text-cyan-300'} shrink-0">${scoreText}</span>
                            ${latestBadge}
                        </button>`;
                    }).join('')}
                </div>
            </div>
        `;
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
                            <h3 class="font-bold text-white text-base truncate obs-card-name">${this.escapeHtml(p.name)} ${p.machineBadge ? `<span class="text-[10px] text-cyan-300">${this.escapeHtml(p.machineBadge)}</span>` : ''} ${p.outsideRoster ? '<span class="text-[10px] text-amber-300">[Ngoài lớp]</span>' : ''}</h3>${p.aliases?.length ? `<small class="text-[10px] text-slate-500 truncate">Tên khác cùng IP: ${this.escapeHtml(p.aliases.join(', '))}</small>` : ''}
                            <small class="text-xs text-slate-400 flex items-center gap-1"><i class="fa-solid fa-clock text-[10px]"></i> <span class="obs-card-time">${this.escapeHtml(timeAgo)}</span>${p._ips?.length > 1 ? ` <span title="${this.escapeHtml(p._ips.join(', '))}">+${p._ips.length - 1} IP</span>` : ''}</small>
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

                <div class="obs-card-history-slot">${this.buildObserverCardHistoryStripHtml(p)}</div>

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
                        <div class="w-10 h-10 rounded-xl bg-sky-500/15 text-sky-400 flex items-center justify-center text-lg border border-sky-500/20 shrink-0">
                            <i class="fa-solid fa-award"></i>
                        </div>
                        <div class="min-w-0">
                            <h3 class="font-bold text-white text-base truncate obs-card-name">${this.escapeHtml(p.name)} ${p.machineBadge ? `<span class="text-[10px] text-cyan-300">${this.escapeHtml(p.machineBadge)}</span>` : ''} ${p.outsideRoster ? '<span class="text-[10px] text-amber-300">[Ngoài lớp]</span>' : ''}</h3>${p.aliases?.length ? `<small class="text-[10px] text-slate-500 truncate">Tên khác cùng IP: ${this.escapeHtml(p.aliases.join(', '))}</small>` : ''}
                            <small class="text-xs text-slate-400 flex items-center gap-1"><i class="fa-solid fa-clock text-[10px]"></i> <span class="obs-card-time">${this.escapeHtml(timeAgo)}</span>${p._ips?.length > 1 ? ` <span title="${this.escapeHtml(p._ips.join(', '))}">+${p._ips.length - 1} IP</span>` : ''}</small>
                        </div>
                    </div>
                    <span class="px-2.5 py-1 rounded-full bg-sky-500/20 border border-sky-500/40 text-sky-300 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 shadow-sm">
                        <i class="fa-solid fa-circle-check text-sky-400 text-[10px]"></i> Đã nộp bài
                    </span>
                </div>

                <div class="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-2.5">
                    <div class="flex items-center justify-between text-xs">
                        <span class="font-semibold text-slate-200 flex items-center gap-1.5 truncate">
                            <i class="fa-solid fa-book-open text-sky-400"></i> <span class="obs-card-subject">${this.escapeHtml(p.subject)}</span>
                        </span>
                        <span class="font-bold text-sky-400 shrink-0 obs-card-count">Hoàn thành: ${p.answered}/${p.total || p.answered} câu</span>
                    </div>
                    <div class="obs-progress-track h-3 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800 shadow-inner">
                        ${this.buildObserverProgressBarHtml(p, percent)}
                    </div>
                    <div class="flex items-center justify-between text-xs pt-0.5">
                        <span class="text-slate-300 obs-card-score">Đúng: <b class="text-emerald-400">${p.correct}</b> • <span class="text-rose-400 font-semibold">Sai: ${Number.isFinite(p.wrong) ? p.wrong : (p.isCompleted ? Math.max(0, (p.total || p.answered || 0) - (p.correct || 0)) : 0)}</span> (${percent}%)</span>
                        <span class="text-xs font-extrabold text-amber-400 bg-amber-500/15 px-2.5 py-1 rounded-lg border border-amber-500/30 shadow-sm">
                            <i class="fa-solid fa-trophy mr-1"></i> ${p.score10.toFixed(1)} / 10 điểm
                        </span>
                    </div>
                </div>

                <div class="obs-card-history-slot">${this.buildObserverCardHistoryStripHtml(p)}</div>

                <div class="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
                    <span class="flex items-center gap-1.5"><i class="fa-solid fa-clock text-slate-500"></i> <span class="obs-card-duration">Đã làm: ${this.escapeHtml(p.durationLabel || '—')}</span></span>
                    <span class="text-sky-300 font-semibold inline-flex items-center gap-1"><i class="fa-solid fa-magnifying-glass-chart"></i> Xem chi tiết</span>
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
                        <h3 class="font-bold text-white text-base truncate obs-card-name">${this.escapeHtml(p.name)} ${p.machineBadge ? `<span class="text-[10px] text-cyan-300">${this.escapeHtml(p.machineBadge)}</span>` : ''} ${p.outsideRoster ? '<span class="text-[10px] text-amber-300">[Ngoài lớp]</span>' : ''}</h3>${p.aliases?.length ? `<small class="text-[10px] text-slate-500 truncate">Tên khác cùng IP: ${this.escapeHtml(p.aliases.join(', '))}</small>` : ''}
                        <small class="text-xs text-slate-400 flex items-center gap-1"><i class="fa-solid fa-clock text-[10px]"></i> <span class="obs-card-time">${this.escapeHtml(timeAgo)}</span>${p._ips?.length > 1 ? ` <span title="${this.escapeHtml(p._ips.join(', '))}">+${p._ips.length - 1} IP</span>` : ''}</small>
                    </div>
                </div>
                <span class="px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 shadow-sm">
                    <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Đang làm bài
                </span>
            </div>

            <div class="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-2.5">
                <div class="flex items-center justify-between text-xs">
                    <span class="font-semibold text-slate-200 flex items-center gap-1.5 truncate">
                        <i class="fa-solid fa-book-open text-sky-400"></i> <span class="obs-card-subject">${this.escapeHtml(p.subject)}</span>
                    </span>
                    <span class="font-bold text-cyan-400 shrink-0 obs-card-count">${p.answered}/${p.total || p.answered || 0} câu</span>
                </div>
                <div class="obs-progress-track h-3 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800 shadow-inner">
                    ${this.buildObserverProgressBarHtml(p, percent)}
                </div>
                <div class="flex items-center justify-between text-xs pt-0.5">
                    <span class="text-slate-400">Tiến độ: <b class="text-white obs-card-percent">${percent}%</b></span>
                    <span class="text-xs text-slate-300 obs-card-score">
                        <b class="text-emerald-400 font-semibold">Đúng: ${p.correct}</b> • <span class="text-rose-400 font-semibold">Sai: ${p.wrong}</span> (<b>${p.score10.toFixed(1)}/10 đ</b>)
                    </span>
                </div>
            </div>

            <div class="obs-card-history-slot">${this.buildObserverCardHistoryStripHtml(p)}</div>

            <div class="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
                <span class="flex items-center gap-1.5"><i class="fa-solid fa-clock text-slate-500"></i> <span class="obs-card-duration">Đã làm: ${this.escapeHtml(p.durationLabel || '—')}</span></span>
                <span class="text-sky-300 font-semibold inline-flex items-center gap-1"><i class="fa-solid fa-magnifying-glass-chart"></i> Xem chi tiết</span>
            </div>
        `;
    }

    renderObserverCardsSmoothly(container, sorted) {
        this.observerRecordsMap = new Map();
        (sorted || []).forEach((item) => {
            this.observerRecordsMap.set(String(item.id), item);
            (item.history || []).forEach((att) => {
                if (att && att.id !== undefined && att.id !== null) {
                    this.observerRecordsMap.set(String(att.id), item);
                }
            });
        });
        if (!container.dataset.obsDetailBound) {
            container.dataset.obsDetailBound = 'true';
            container.addEventListener('click', (event) => {
                const histBtn = event.target.closest('[data-obs-history-id]');
                const card = event.target.closest('.obs-student-card[data-student-id]');
                if (!card) return;
                if (histBtn) {
                    event.stopPropagation();
                    this.openObserverStudentDetail(card.dataset.studentId, histBtn.dataset.obsHistoryId);
                    return;
                }
                if (card.dataset.cardType === 'waiting') return;
                this.openObserverStudentDetail(card.dataset.studentId);
            });
        }
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
        container.querySelectorAll('.obs-skeleton-card, .skeleton-shimmer').forEach((el) => el.remove());

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
                card.className = `obs-student-card p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col gap-3 shadow-lg hover:border-slate-700 transition-all duration-300${cardType !== 'waiting' ? ' cursor-pointer' : ''}`;
                card.dataset.studentId = p.id;
                card.dataset.cardType = cardType;
                card.innerHTML = this.buildObserverCardInnerHtml(p, cardType, percent, timeAgo);
                const targetChild = container.children[index];
                container.insertBefore(card, targetChild || null);
            } else {
                card.classList.toggle('cursor-pointer', cardType !== 'waiting');
                if (card.dataset.cardType !== cardType) {
                    card.dataset.cardType = cardType;
                    card.innerHTML = this.buildObserverCardInnerHtml(p, cardType, percent, timeAgo);
                } else {
                    const elName = card.querySelector('.obs-card-name');
                    if (elName) {
                        const nextNameHtml = `${this.escapeHtml(p.name)} ${p.machineBadge ? `<span class="text-[10px] text-cyan-300">${this.escapeHtml(p.machineBadge)}</span>` : ''} ${p.outsideRoster ? '<span class="text-[10px] text-amber-300">[Ngoài lớp]</span>' : ''}`;
                        if (elName.innerHTML !== nextNameHtml) elName.innerHTML = nextNameHtml;
                    }

                    const elTime = card.querySelector('.obs-card-time');
                    if (elTime && elTime.textContent !== timeAgo) elTime.textContent = timeAgo;

                    const elSubj = card.querySelector('.obs-card-subject');
                    if (elSubj && elSubj.textContent !== p.subject) elSubj.textContent = p.subject;

                    const elDur = card.querySelector('.obs-card-duration');
                    const durText = `Đã làm: ${p.durationLabel || '—'}`;
                    if (elDur && elDur.textContent !== durText) elDur.textContent = durText;

                    const histSlot = card.querySelector('.obs-card-history-slot');
                    if (histSlot) {
                        const nextHistHtml = this.buildObserverCardHistoryStripHtml(p);
                        if (histSlot.innerHTML !== nextHistHtml) histSlot.innerHTML = nextHistHtml;
                    }

                    if (cardType === 'doing') {
                        const elCount = card.querySelector('.obs-card-count');
                        const countText = `${p.answered}/${p.total || p.answered || 0} câu`;
                        if (elCount && elCount.textContent !== countText) elCount.textContent = countText;

                        const track = card.querySelector('.obs-progress-track');
                        if (track) {
                            const nextBarHtml = this.buildObserverProgressBarHtml(p, percent);
                            if (track.innerHTML !== nextBarHtml) track.innerHTML = nextBarHtml;
                        }

                        const elPercent = card.querySelector('.obs-card-percent');
                        if (elPercent && elPercent.textContent !== `${percent}%`) elPercent.textContent = `${percent}%`;

                        const elScore = card.querySelector('.obs-card-score');
                        if (elScore) {
                            elScore.innerHTML = `<b class="text-emerald-400 font-semibold">Đúng: ${p.correct}</b> • <span class="text-rose-400 font-semibold">Sai: ${p.wrong}</span> (<b>${p.score10.toFixed(1)}/10 đ</b>)`;
                        }
                    } else if (cardType === 'completed') {
                        const elCount = card.querySelector('.obs-card-count');
                        const countText = `Hoàn thành: ${p.answered}/${p.total || p.answered || 0} câu`;
                        if (elCount) elCount.textContent = countText;
                        const scoreEl = card.querySelector('.obs-card-score');
                        if (scoreEl) scoreEl.innerHTML = `<b class="text-emerald-400 font-semibold">Đúng: ${p.correct}</b> • <span class="text-rose-400 font-semibold">Sai: ${p.wrong}</span> (${percent}%)`;
                        const track = card.querySelector('.obs-progress-track');
                        if (track) {
                            const nextBarHtml = this.buildObserverProgressBarHtml(p, percent);
                            if (track.innerHTML !== nextBarHtml) track.innerHTML = nextBarHtml;
                        }
                    }
                }
                const targetChild = container.children[index];
                if (targetChild !== card) {
                    container.insertBefore(card, targetChild || null);
                }
            }
        });
    }

    resolveObserverSubjectKey(subjectName) {
        const raw = String(subjectName || '').trim();
        if (!raw) return '';
        const norm = raw.toLowerCase().replace(/\s+/g, ' ');
        const matched = (this.dynamicSubjects || []).find((sub) => {
            const key = String(sub?.key || sub?.subject_key || '').trim().toLowerCase().replace(/\s+/g, ' ');
            const name = String(sub?.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
            const title = String(sub?.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
            return norm === key || norm === name || norm === title;
        });
        if (matched) return String(matched.key || matched.subject_key || '').trim();
        return raw;
    }

    async getObserverQuestionsForSubject(subjectName) {
        if (!this._observerQuestionsCache) this._observerQuestionsCache = new Map();
        if (!this._observerQuestionsPending) this._observerQuestionsPending = new Map();

        const subjKey = this.resolveObserverSubjectKey(subjectName);
        const cacheKey = String(subjKey || subjectName || '').trim().toLowerCase();
        if (!cacheKey) return [];
        if (!this.isSubjectAccessibleToCurrentUser(subjKey)) {
            console.warn('[Observer] Blocked detail questions for an inaccessible subject:', subjectName);
            return [];
        }

        const currentNorm = String(this.currentSubject || '').trim().toLowerCase();
        if (currentNorm && cacheKey === currentNorm && Array.isArray(this.allQuestions) && this.allQuestions.length > 0) {
            this._observerQuestionsCache.set(cacheKey, this.allQuestions);
            return this.allQuestions;
        }

        if (this._observerQuestionsCache.has(cacheKey)) {
            return this._observerQuestionsCache.get(cacheKey);
        }

        if (this._observerQuestionsPending.has(cacheKey)) {
            return this._observerQuestionsPending.get(cacheKey);
        }

        const promise = (async () => {
            let questions = [];
            if (subjKey && navigator.onLine && window.dbService && typeof window.dbService.fetchQuestionsBySubject === 'function') {
                try {
                    const cloudQuestions = await window.dbService.fetchQuestionsBySubject(subjKey);
                    if (Array.isArray(cloudQuestions)) {
                        questions = cloudQuestions.filter((question) => question?.is_deleted !== true);
                        if (questions.length > 0) {
                            try {
                                localStorage.setItem(`quiz_cache_${subjKey}`, JSON.stringify(questions));
                            } catch (e) {}
                        }
                    }
                } catch (e) {
                    console.warn('Không thể tải câu hỏi môn học để xem chi tiết:', e);
                }
            }

            if (questions.length === 0 && subjKey) {
                try {
                    const cachedRaw = localStorage.getItem(`quiz_cache_${subjKey}`);
                    if (cachedRaw) {
                        const parsed = JSON.parse(cachedRaw);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            questions = parsed.filter((question) => question?.is_deleted !== true);
                        }
                    }
                } catch (e) {}
            }

            if (questions.length === 0 && subjKey) {
                if (subjKey === 'history' && Array.isArray(window.QUIZ_QUESTIONS)) {
                    questions = window.QUIZ_QUESTIONS.filter((question) => question?.is_deleted !== true);
                } else if (subjKey === 'physics' && Array.isArray(window.PHYSICS_QUESTIONS)) {
                    questions = window.PHYSICS_QUESTIONS.filter((question) => question?.is_deleted !== true);
                } else if (subjKey === 'geography' && Array.isArray(window.GEOGRAPHY_QUESTIONS)) {
                    questions = window.GEOGRAPHY_QUESTIONS.filter((question) => question?.is_deleted !== true);
                }
            }

            const normalized = questions.length > 0 ? this.normalizeQuestions(questions) : [];
            if (normalized.length > 0) {
                this._observerQuestionsCache.set(cacheKey, normalized);
            }
            return normalized;
        })().finally(() => {
            this._observerQuestionsPending?.delete(cacheKey);
        });

        this._observerQuestionsPending.set(cacheKey, promise);
        return promise;
    }

    renderObserverQuestionExpandedHtml(it, idx, qObj, opts = {}) {
        const { showNav = false, totalItems = 0, isLoadingQuestions = false } = opts;
        const statusBadge = it?.ok === true
            ? '<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold">✓ Làm đúng</span>'
            : (it?.ok === false
                ? '<span class="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[11px] font-bold">✗ Làm sai</span>'
                : '<span class="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 text-[11px] font-bold">Chưa hoàn thành</span>');

        const isTf = it?.t === 'tf' || qObj?.qType === 'tf_group' || qObj?.q_type === 'tf_group';
        const isSa = it?.t === 'sa' || qObj?.qType === 'short_answer' || qObj?.q_type === 'short_answer';
        const typeLabel = isTf ? 'Đúng / Sai' : (isSa ? 'Trả lời ngắn' : 'Trắc nghiệm');
        const catLabel = String(it?.cat || qObj?.category || '').trim();

        const questionStemHtml = qObj?.question
            ? `<div class="text-sm font-semibold text-white leading-relaxed break-words">${this.formatScientificNotation(qObj.question)}</div>`
            : `<div class="text-xs text-slate-400 italic">${isLoadingQuestions ? '<i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-sky-400"></i>Đang tải nội dung đề bài...' : `Câu hỏi số ${idx + 1}${catLabel ? ` (${this.escapeHtml(catLabel)})` : ''} — xem lựa chọn và đáp án đúng bên dưới.`}</div>`;

        const safeImgUrl = this.sanitizeMediaUrl(qObj?.image_url || qObj?.imageUrl);
        const imgHtml = safeImgUrl ? `
            <div class="rounded-xl overflow-hidden border border-slate-700/80 bg-slate-950/70 p-2 flex justify-center">
                <img src="${this.escapeHtml(safeImgUrl)}" alt="Hình minh họa câu ${idx + 1}" class="max-h-52 w-auto object-contain rounded-lg" loading="lazy">
            </div>
        ` : '';

        let detailBodyHtml = '';
        if (isTf) {
            const stmts = Array.isArray(qObj?.statements) ? qObj.statements : [];
            const uaArr = Array.isArray(it?.ua) ? it.ua : [];
            const caArr = Array.isArray(it?.ca)
                ? it.ca.map(v => this._parseBoolAnswer(v))
                : stmts.map(s => this._parseBoolAnswer(s?.answer));
            const count = Math.max(stmts.length, uaArr.length, caArr.length);

            detailBodyHtml = count > 0 ? `
                <div class="space-y-1.5">
                    ${Array.from({ length: count }).map((_, sIdx) => {
                        const st = stmts[sIdx];
                        const rawUa = uaArr[sIdx];
                        const hasPick = rawUa !== null && rawUa !== undefined;
                        const userBool = hasPick ? this._parseBoolAnswer(rawUa) : null;
                        const hasCa = sIdx < caArr.length && caArr[sIdx] !== null && caArr[sIdx] !== undefined;
                        const correctBool = hasCa ? Boolean(caArr[sIdx]) : false;
                        const isRight = hasPick && hasCa && userBool === correctBool;

                        const rowCls = !hasPick
                            ? 'bg-slate-900/70 border-slate-800'
                            : (isRight
                                ? 'bg-emerald-500/10 border-emerald-500/40'
                                : 'bg-rose-500/10 border-rose-500/40');
                        const userPickCls = !hasPick
                            ? 'bg-slate-800 text-slate-400 border-slate-700'
                            : (isRight
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                : 'bg-rose-500/20 text-rose-300 border-rose-500/40');

                        return `
                            <div class="p-2.5 rounded-xl border ${rowCls} flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                                <div class="text-slate-200 leading-relaxed break-words">
                                    <b class="text-sky-300 mr-1">${String.fromCharCode(97 + sIdx)})</b>
                                    ${st?.text ? this.formatScientificNotation(st.text) : `<span class="text-slate-400">Ý ${String.fromCharCode(97 + sIdx)}</span>`}
                                </div>
                                <div class="flex items-center gap-1.5 shrink-0 flex-wrap">
                                    <span class="px-2 py-0.5 rounded-lg border text-[11px] font-bold ${userPickCls}">
                                        ${!hasPick ? 'Chưa chọn' : (isRight ? `✓ Chọn: ${userBool ? 'Đúng' : 'Sai'}` : `✗ Chọn: ${userBool ? 'Đúng' : 'Sai'}`)}
                                    </span>
                                    ${hasCa ? `<span class="px-2 py-0.5 rounded-lg border bg-emerald-500/15 text-emerald-300 border-emerald-500/35 text-[11px] font-bold">Đúng: ${correctBool ? 'Đúng' : 'Sai'}</span>` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : `<p class="text-xs text-slate-400 italic">Chưa có dữ liệu chi tiết các ý Đúng/Sai.</p>`;
        } else if (isSa) {
            const rawUa = it?.ua !== null && it?.ua !== undefined ? String(it.ua).trim() : '';
            const hasPick = rawUa !== '';
            const rawCa = String(it?.ca ?? qObj?.correctValue ?? qObj?.correct_value ?? qObj?.acceptedValues?.[0] ?? qObj?.answer ?? '').trim();

            detailBodyHtml = `
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div class="p-3 rounded-xl border ${!hasPick ? 'bg-slate-900/70 border-slate-800' : (it?.ok ? 'bg-emerald-500/15 border-emerald-500/40' : 'bg-rose-500/15 border-rose-500/40')}">
                        <div class="text-[11px] uppercase tracking-wider font-bold text-slate-400 mb-1">Học sinh trả lời</div>
                        <div class="font-bold text-sm break-words ${!hasPick ? 'text-slate-400 italic' : (it?.ok ? 'text-emerald-300' : 'text-rose-300')}">
                            ${hasPick ? `${it?.ok ? '✓ ' : '✗ '}${this.escapeHtml(rawUa)}` : 'Chưa trả lời'}
                        </div>
                    </div>
                    <div class="p-3 rounded-xl border bg-emerald-500/10 border-emerald-500/35">
                        <div class="text-[11px] uppercase tracking-wider font-bold text-emerald-400/90 mb-1">Đáp án đúng</div>
                        <div class="font-bold text-sm text-emerald-300 break-words">
                            ${rawCa ? `✓ ${this.formatScientificNotation(rawCa)}` : 'Chưa thiết lập'}
                        </div>
                    </div>
                </div>
            `;
        } else {
            const optChars = ['A', 'B', 'C', 'D', 'E', 'F'];
            const hasUa = it?.ua !== null && it?.ua !== undefined && it?.ua !== '' && !Number.isNaN(Number(it.ua));
            const uaIdx = hasUa ? Number(it.ua) : -1;
            const rawCa = (it?.ca !== null && it?.ca !== undefined && it?.ca !== '')
                ? it.ca
                : (qObj?.correct !== undefined ? qObj.correct : qObj?.answer);
            const hasCa = rawCa !== null && rawCa !== undefined && rawCa !== '' && !Number.isNaN(Number(rawCa));
            const caIdx = hasCa ? Number(rawCa) : -1;

            const uaLabel = hasUa ? (optChars[uaIdx] || String(uaIdx + 1)) : 'Chưa chọn';
            const caLabel = hasCa ? (optChars[caIdx] || String(caIdx + 1)) : '—';
            const options = Array.isArray(qObj?.options) ? qObj.options : [];

            const summaryStrip = `
                <div class="grid grid-cols-2 gap-2 text-xs">
                    <div class="p-2.5 rounded-xl border ${!hasUa ? 'bg-slate-900/70 border-slate-800 text-slate-400' : (it?.ok ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-rose-500/15 border-rose-500/40 text-rose-300')}">
                        <span class="block text-[10px] uppercase tracking-wider opacity-80 font-bold">Học sinh chọn</span>
                        <span class="font-extrabold text-sm">${hasUa ? `${it?.ok ? '✓' : '✗'} Đáp án ${this.escapeHtml(uaLabel)}` : 'Chưa chọn'}</span>
                    </div>
                    <div class="p-2.5 rounded-xl border bg-emerald-500/10 border-emerald-500/35 text-emerald-300">
                        <span class="block text-[10px] uppercase tracking-wider opacity-80 font-bold">Đáp án đúng</span>
                        <span class="font-extrabold text-sm">${hasCa ? `✓ Đáp án ${this.escapeHtml(caLabel)}` : '—'}</span>
                    </div>
                </div>
            `;

            const optionsListHtml = options.length > 0 ? `
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    ${options.map((opt, oIdx) => {
                        const isPicked = hasUa && oIdx === uaIdx;
                        const isCorrectOpt = hasCa && oIdx === caIdx;
                        let boxCls = 'bg-slate-900/75 border-slate-800 text-slate-300';
                        let letterCls = 'bg-slate-800 text-slate-300 border-slate-700';
                        let tagHtml = '';

                        if (isPicked && isCorrectOpt) {
                            boxCls = 'bg-emerald-500/15 border-emerald-500/60 text-emerald-100';
                            letterCls = 'bg-emerald-500 text-slate-950 border-emerald-400';
                            tagHtml = '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 shrink-0">✓ Học sinh chọn (Đúng)</span>';
                        } else if (isPicked && !isCorrectOpt) {
                            boxCls = 'bg-rose-500/15 border-rose-500/60 text-rose-100';
                            letterCls = 'bg-rose-500 text-white border-rose-400';
                            tagHtml = '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/25 text-rose-300 border border-rose-500/40 shrink-0">✗ Học sinh chọn (Sai)</span>';
                        } else if (isCorrectOpt) {
                            boxCls = 'bg-emerald-500/10 border-emerald-500/50 text-emerald-100';
                            letterCls = 'bg-emerald-500/30 text-emerald-200 border-emerald-400/60';
                            tagHtml = '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0">✓ Đáp án đúng</span>';
                        }

                        return `
                            <div class="p-2.5 rounded-xl border ${boxCls} flex flex-col gap-1.5 text-xs">
                                <div class="flex items-start gap-2">
                                    <span class="w-6 h-6 rounded-lg border ${letterCls} flex items-center justify-center font-extrabold text-[11px] shrink-0">${optChars[oIdx] || oIdx + 1}</span>
                                    <span class="flex-1 leading-relaxed break-words pt-0.5">${this.formatScientificNotation(opt)}</span>
                                </div>
                                ${tagHtml ? `<div class="pl-8">${tagHtml}</div>` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : '';

            detailBodyHtml = `${summaryStrip}${optionsListHtml}`;
        }

        const explanationHtml = qObj?.explanation ? `
            <div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-slate-200 leading-relaxed">
                <p class="font-bold text-amber-300 mb-1 flex items-center gap-1.5"><i class="fa-solid fa-lightbulb"></i> Giải thích chi tiết:</p>
                <div class="break-words">${this.formatScientificNotation(qObj.explanation)}</div>
            </div>
        ` : '';

        const navHtml = showNav ? `
            <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/90 text-xs">
                <button type="button" data-obs-nav="-1" ${idx <= 0 ? 'disabled' : ''} class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 font-bold flex items-center gap-1.5 cursor-pointer transition">
                    <i class="fa-solid fa-chevron-left text-[10px]"></i> Câu trước
                </button>
                <span class="text-slate-400 font-semibold">Câu ${idx + 1} / ${totalItems}</span>
                <button type="button" data-obs-nav="1" ${idx >= totalItems - 1 ? 'disabled' : ''} class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 font-bold flex items-center gap-1.5 cursor-pointer transition">
                    Câu tiếp <i class="fa-solid fa-chevron-right text-[10px]"></i>
                </button>
            </div>
        ` : '';

        return `
            <div class="rounded-2xl bg-slate-950/75 border border-slate-800 p-3.5 sm:p-4 space-y-3">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="px-2.5 py-0.5 rounded-lg bg-sky-500/20 text-sky-300 border border-sky-500/40 text-xs font-extrabold">Câu ${idx + 1}</span>
                        <span class="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 text-[11px] font-semibold">${typeLabel}</span>
                        ${catLabel ? `<span class="px-2 py-0.5 rounded-lg bg-slate-900 text-slate-400 border border-slate-800 text-[11px]">${this.escapeHtml(catLabel)}</span>` : ''}
                    </div>
                    ${statusBadge}
                </div>
                ${questionStemHtml}
                ${imgHtml}
                ${detailBodyHtml}
                ${explanationHtml}
                ${navHtml}
            </div>
        `;
    }

    renderObserverDetailInspector(shouldScroll = false) {
        const state = this._obsDetailState;
        const body = document.getElementById('obs-modal-body');
        if (!state || !body) return;

        const items = state.items || [];
        const qList = Array.isArray(state.questions) ? state.questions : [];
        const qById = new Map(qList.map(q => [String(q.id), q]));

        // Cập nhật trạng thái active trên các nút câu hỏi
        body.querySelectorAll('[data-obs-q-idx]').forEach((btn) => {
            const idx = Number(btn.dataset.obsQIdx);
            const isActive = state.viewMode === 'single' && state.selectedIdx === idx;
            btn.classList.toggle('ring-2', isActive);
            btn.classList.toggle('ring-sky-400', isActive);
            btn.classList.toggle('shadow-md', isActive);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        // Cập nhật nút chế độ "Xem tất cả câu sai"
        const wrongModeBtn = body.querySelector('[data-obs-view-mode]');
        if (wrongModeBtn) {
            const isWrongMode = state.viewMode === 'wrong';
            wrongModeBtn.classList.toggle('bg-rose-500/25', isWrongMode);
            wrongModeBtn.classList.toggle('border-rose-400', isWrongMode);
            wrongModeBtn.classList.toggle('text-rose-200', isWrongMode);
        }

        const inspectorWrap = document.getElementById('obs-question-inspector-wrap');
        const inspector = document.getElementById('obs-question-inspector');
        if (!inspectorWrap || !inspector) return;

        const wasOpen = inspectorWrap.classList.contains('is-open');
        const scrollToInspector = () => {
            if (!shouldScroll) return;
            window.setTimeout(() => {
                if (inspectorWrap.isConnected && inspectorWrap.classList.contains('is-open')) {
                    inspectorWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }, wasOpen ? 16 : 240);
        };

        if (state.viewMode === 'wrong') {
            const wrongIndices = items.map((it, idx) => (it?.ok === false ? idx : -1)).filter((idx) => idx >= 0);
            if (wrongIndices.length === 0) {
                inspector.innerHTML = `<div class="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 font-semibold text-center">Học sinh chưa có câu làm sai nào trong bài này.</div>`;
            } else {
                inspector.innerHTML = `<div class="space-y-3">${wrongIndices.map((idx) => {
                    const it = items[idx];
                    const qObj = qById.get(String(it?.id)) || qList[idx] || null;
                    return this.renderObserverQuestionExpandedHtml(it, idx, qObj, {
                        showNav: false,
                        totalItems: items.length,
                        isLoadingQuestions: state.isLoadingQuestions
                    });
                }).join('')}</div>`;
            }
            inspectorWrap.classList.add('is-open');
            inspectorWrap.setAttribute('aria-hidden', 'false');
            this.renderMath(inspector);
            scrollToInspector();
            return;
        }

        if (state.selectedIdx === null || state.selectedIdx < 0 || state.selectedIdx >= items.length) {
            inspectorWrap.classList.remove('is-open');
            inspectorWrap.setAttribute('aria-hidden', 'true');
            return;
        }

        const idx = state.selectedIdx;
        const it = items[idx];
        const qObj = qById.get(String(it?.id)) || qList[idx] || null;
        inspector.innerHTML = this.renderObserverQuestionExpandedHtml(it, idx, qObj, {
            showNav: true,
            totalItems: items.length,
            isLoadingQuestions: state.isLoadingQuestions
        });
        inspectorWrap.classList.add('is-open');
        inspectorWrap.setAttribute('aria-hidden', 'false');
        this.renderMath(inspector);
        scrollToInspector();
    }

    openObserverStudentDetail(studentId, preferredAttemptId = null) {
        const rootRecord = this.observerRecordsMap?.get(String(studentId));
        if (!rootRecord) return;

        const history = (Array.isArray(rootRecord.history) && rootRecord.history.length > 0)
            ? rootRecord.history.slice(0, 8)
            : [rootRecord];
        const p = preferredAttemptId
            ? (history.find(h => String(h.id) === String(preferredAttemptId)) || rootRecord)
            : (String(rootRecord.id) === String(studentId)
                ? rootRecord
                : (history.find(h => String(h.id) === String(studentId)) || rootRecord));

        let modal = document.getElementById('observer-detail-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'observer-detail-modal';
            modal.className = 'fixed inset-0 z-[60] hidden items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-5';
            modal.innerHTML = `
                <div class="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl p-4 sm:p-6 space-y-4 text-slate-100">
                    <div class="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                        <div>
                            <p class="text-[11px] font-bold uppercase tracking-wider text-sky-400">Chi tiết bài làm học sinh</p>
                            <h3 id="obs-modal-title" class="text-lg font-bold text-white mt-0.5"></h3>
                            <p id="obs-modal-subtitle" class="text-xs text-slate-400 mt-0.5"></p>
                        </div>
                        <button type="button" id="obs-modal-close" class="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center shrink-0">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div id="obs-modal-body" class="space-y-4"></div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal || e.target.closest('#obs-modal-close')) {
                    modal.classList.add('hidden');
                    modal.classList.remove('flex');
                    return;
                }

                const state = this._obsDetailState;
                if (!state) return;

                const attBtn = e.target.closest('[data-obs-attempt-id]');
                if (attBtn) {
                    const attemptId = attBtn.dataset.obsAttemptId;
                    this.openObserverStudentDetail(state.rootStudentId || state.studentId, attemptId);
                    return;
                }

                const qBtn = e.target.closest('[data-obs-q-idx]');
                if (qBtn) {
                    const idx = Number(qBtn.dataset.obsQIdx);
                    if (Number.isFinite(idx)) {
                        if (state.viewMode === 'single' && state.selectedIdx === idx) {
                            state.selectedIdx = null;
                        } else {
                            state.viewMode = 'single';
                            state.selectedIdx = idx;
                        }
                        this.renderObserverDetailInspector(true);
                    }
                    return;
                }

                const viewBtn = e.target.closest('[data-obs-view-mode]');
                if (viewBtn) {
                    const nextMode = viewBtn.dataset.obsViewMode;
                    state.viewMode = state.viewMode === nextMode ? 'single' : nextMode;
                    if (state.viewMode === 'single' && (state.selectedIdx === null || state.selectedIdx < 0)) {
                        const firstWrong = state.items.findIndex(it => it?.ok === false);
                        state.selectedIdx = firstWrong >= 0 ? firstWrong : (state.items.length > 0 ? 0 : null);
                    }
                    this.renderObserverDetailInspector(true);
                    return;
                }

                const navBtn = e.target.closest('[data-obs-nav]');
                if (navBtn && state.items.length > 0) {
                    const step = Number(navBtn.dataset.obsNav || 0);
                    const cur = typeof state.selectedIdx === 'number' ? state.selectedIdx : 0;
                    const nextIdx = Math.max(0, Math.min(state.items.length - 1, cur + step));
                    state.viewMode = 'single';
                    state.selectedIdx = nextIdx;
                    this.renderObserverDetailInspector(false);
                }
            });
        }

        const totalQ = p.total || p.answered || 0;
        const wrongCount = Number.isFinite(p.wrong) ? p.wrong : (p.isCompleted ? Math.max(0, totalQ - p.correct) : 0);
        const unansweredCount = Math.max(0, totalQ - p.correct - wrongCount);
        const items = Array.isArray(p.detail?.items) ? p.detail.items : [];
        const rawCats = p.detail?.cats;
        let cats = [];
        if (Array.isArray(rawCats)) {
            cats = rawCats.map(c => ({ n: c?.n || 'Chuyên đề', c: Number(c?.c || 0), t: Number(c?.t || 0) }));
        } else if (rawCats && typeof rawCats === 'object') {
            cats = Object.entries(rawCats).map(([catName, arr]) => ({
                n: catName,
                c: Number(arr?.[0] || 0),
                t: Number(arr?.[2] || arr?.[1] || 0)
            }));
        }

        const sameAttempt = this._obsDetailState && String(this._obsDetailState.studentId) === String(p.id);
        const firstWrongIdx = items.findIndex(it => it?.ok === false);
        const defaultIdx = firstWrongIdx >= 0 ? firstWrongIdx : (items.length > 0 ? 0 : null);
        const selectedIdx = (sameAttempt && typeof this._obsDetailState.selectedIdx === 'number' && this._obsDetailState.selectedIdx < items.length)
            ? this._obsDetailState.selectedIdx
            : defaultIdx;

        const subjKey = this.resolveObserverSubjectKey(p.subject);
        const cacheKey = String(subjKey || p.subject || '').trim().toLowerCase();
        const currentNorm = String(this.currentSubject || '').trim().toLowerCase();
        const cachedQuestions = (currentNorm && cacheKey === currentNorm && Array.isArray(this.allQuestions) && this.allQuestions.length > 0)
            ? this.allQuestions
            : (this._observerQuestionsCache?.get(cacheKey) || null);

        this._obsDetailState = {
            rootStudentId: String(rootRecord.id),
            studentId: String(p.id),
            subject: p.subject,
            items,
            viewMode: sameAttempt ? this._obsDetailState.viewMode : 'single',
            selectedIdx,
            questions: cachedQuestions,
            isLoadingQuestions: !cachedQuestions && items.length > 0
        };

        document.getElementById('obs-modal-title').textContent = `${p.name} — ${p.subject}`;
        document.getElementById('obs-modal-subtitle').textContent = `${p.isCompleted ? 'Đã nộp bài' : 'Đang làm bài'} • Thời gian làm: ${p.durationLabel || '—'} • Điểm: ${p.score10.toFixed(1)}/10`;

        const historyBarHtml = history.length > 1 ? `
            <div class="p-3 rounded-2xl bg-slate-950/75 border border-slate-800 space-y-2">
                <div class="flex items-center justify-between gap-2">
                    <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <i class="fa-solid fa-clock-rotate-left text-sky-400"></i>
                        Lịch sử bài đã làm (${history.length} đề)
                    </h4>
                    <span class="text-[11px] text-slate-400">Ấn để xem lại từng đề</span>
                </div>
                <div class="flex flex-wrap gap-1.5">
                    ${history.map((att, idx) => {
                        const isLatest = idx === 0;
                        const isSelected = String(att.id) === String(p.id);
                        const statusText = att.isCompleted
                            ? `${att.score10.toFixed(1)}đ`
                            : `${att.answered}/${att.total || '?'} câu`;
                        const latestBadge = isLatest
                            ? `<span class="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9px] font-extrabold uppercase tracking-wide shrink-0">Mới nhất</span>`
                            : '';
                        return `<button type="button" data-obs-attempt-id="${this.escapeHtml(att.id)}" class="px-2.5 py-1.5 rounded-xl border text-left transition cursor-pointer flex items-center gap-2 text-xs ${isSelected ? 'bg-sky-600/30 border-sky-400 text-white ring-2 ring-sky-500/40' : 'bg-slate-900/90 border-slate-700/80 hover:border-sky-500/50 text-slate-300'}">
                            <span class="${att.isCompleted ? 'text-emerald-400' : 'text-amber-400'} font-bold">${att.isCompleted ? '✓' : '•'}</span>
                            <span class="font-bold truncate max-w-[140px]">${this.escapeHtml(att.subject)}</span>
                            <span class="font-extrabold ${att.isCompleted ? 'text-amber-300' : 'text-cyan-300'} shrink-0">${statusText}</span>
                            ${latestBadge}
                            <span class="text-[10px] text-slate-400 shrink-0">${this.escapeHtml(this.formatRelativeTime(att.lastActive))}</span>
                        </button>`;
                    }).join('')}
                </div>
            </div>
        ` : '';

        const catsHtml = cats.length > 0 ? `
            <div class="space-y-2">
                <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400">Phân tích theo chuyên đề</h4>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    ${cats.map(c => {
                        const pct = c.t > 0 ? Math.round((c.c / c.t) * 100) : 0;
                        const tone = pct >= 80 ? 'text-emerald-400' : (pct >= 50 ? 'text-amber-400' : 'text-rose-400');
                        return `<div class="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-xs">
                            <span class="font-medium text-slate-200 truncate pr-2">${this.escapeHtml(c.n || 'Chuyên đề')}</span>
                            <b class="${tone} shrink-0">${c.c}/${c.t} (${pct}%)</b>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        ` : '';

        const wrongItemCount = items.filter(it => it?.ok === false).length;
        const optChars = ['A', 'B', 'C', 'D', 'E', 'F'];

        const itemsHtml = items.length > 0 ? `
            <div class="space-y-2.5">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400">Chi tiết từng câu (${items.length} câu)</h4>
                        <p class="text-[11px] text-slate-400 mt-0.5">Ấn vào từng câu để xem đề, đáp án học sinh chọn &amp; đáp án đúng</p>
                    </div>
                    ${wrongItemCount > 0 ? `
                        <button type="button" data-obs-view-mode="wrong" class="px-2.5 py-1 rounded-lg border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-[11px] font-bold cursor-pointer transition flex items-center gap-1.5">
                            <i class="fa-solid fa-triangle-exclamation text-[10px]"></i>
                            <span>Xem tất cả câu sai (${wrongItemCount})</span>
                        </button>
                    ` : ''}
                </div>
                <div class="flex flex-wrap gap-1.5">
                    ${items.map((it, idx) => {
                        if (!it) return '';
                        const states = this._getProgressDetailStatementStates(it);
                        let outcome = it.ok;
                        let label = it.ok === true ? 'Đúng' : (it.ok === false ? 'Sai' : 'Trống');
                        if (states) {
                            const tfCorrect = states.filter(state => state === true).length;
                            label = states.some(state => state !== null) ? `${tfCorrect}/${states.length} ý` : 'Trống';
                            outcome = states.includes(false) ? false : (states.length > 0 && tfCorrect === states.length ? true : null);
                        }
                        const cls = outcome === true
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                            : (outcome === false
                                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
                                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700/80');
                        let ansTooltip = '';
                        if (it.t === 'mcq' && it.ua !== null && it.ua !== undefined && it.ua !== '') {
                            ansTooltip = ` — Chọn: ${optChars[Number(it.ua)] || it.ua}`;
                        } else if (it.t === 'sa' && it.ua) {
                            ansTooltip = ` — Nhập: ${String(it.ua)}`;
                        }
                        return `<button type="button" data-obs-q-idx="${idx}" class="px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer transition ${cls}" title="Câu ${idx + 1}: ${label}${this.escapeHtml(ansTooltip)} — Bấm để xem chi tiết">Câu ${idx + 1}: ${label}</button>`;
                    }).join('')}
                </div>
                <div id="obs-question-inspector-wrap" class="ui-accordion-wrap" aria-hidden="true">
                    <div class="ui-accordion-inner">
                        <div id="obs-question-inspector" class="pt-1"></div>
                    </div>
                </div>
            </div>
        ` : `<p class="text-xs text-slate-400 italic">Phiên làm bài này chưa có dữ liệu chi tiết từng câu.</p>`;

        document.getElementById('obs-modal-body').innerHTML = `
            ${historyBarHtml}
            <div class="grid grid-cols-3 gap-2 text-center">
                <div class="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                    <div class="text-lg font-extrabold text-emerald-400">${p.correct}</div>
                    <div class="text-[11px] text-slate-300">Câu đúng</div>
                </div>
                <div class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30">
                    <div class="text-lg font-extrabold text-rose-400">${wrongCount}</div>
                    <div class="text-[11px] text-slate-300">Câu sai</div>
                </div>
                <div class="p-3 rounded-xl bg-slate-800/80 border border-slate-700">
                    <div class="text-lg font-extrabold text-slate-300">${unansweredCount}</div>
                    <div class="text-[11px] text-slate-400">Chưa làm</div>
                </div>
            </div>
            <div class="obs-progress-track h-3 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                ${this.buildObserverProgressBarHtml(p, p.percent)}
            </div>
            ${catsHtml}
            ${itemsHtml}
        `;

        modal.classList.remove('hidden');
        modal.classList.add('flex');

        if (items.length > 0) {
            this.renderObserverDetailInspector(false);
            if (!cachedQuestions) {
                const targetAttemptId = String(p.id);
                this.getObserverQuestionsForSubject(p.subject).then((questions) => {
                    if (!this._obsDetailState || String(this._obsDetailState.studentId) !== targetAttemptId) return;
                    this._obsDetailState.questions = questions;
                    this._obsDetailState.isLoadingQuestions = false;
                    if (!modal.classList.contains('hidden')) {
                        this.renderObserverDetailInspector(false);
                    }
                });
            }
        }
    }

    async fetchAndRenderObserverFullscreen() {
        const container = document.getElementById('observer-progress-cards');
        if (!container) return;
        if (this.observerProgressLoading) {
            this.observerProgressRefreshQueued = true;
            return;
        }
        this.observerProgressLoading = true;
        if (!container.querySelector('.obs-student-card') && !container.querySelector('.obs-skeleton-card') && !container.querySelector('.col-span-1.md\\:col-span-2')) {
            container.innerHTML = this.renderSkeletonCards(3, 'observer');
        }

        try {
            if (!this.rosterConfig || Object.keys(this.rosterConfig?.devicePins || {}).length === 0) {
                await this.loadRosterConfig().catch(() => {});
            }
            let rows = [];
            try {
                 if (window.dbService && typeof window.dbService.getLoginHistory === 'function') {
                     rows = await window.dbService.getLoginHistory(300);
                     if (window.dbService?.autoSubmitStaleAttempts) {
                         await window.dbService.autoSubmitStaleAttempts(rows).catch(() => 0);
                     }
                 }
            } catch (e) {
                console.warn('Lỗi tải tiến trình:', e);
            }

            const SYSTEM_IDS = [
                '00000000-0000-0000-0000-000000000001',
                '00000000-0000-0000-0000-000000000002',
                '00000000-0000-0000-0000-000000000003',
                '00000000-0000-0000-0000-000000000004',
                '00000000-0000-0000-0000-000000000005',
                '00000000-0000-0000-0000-000000000006',
                '00000000-0000-0000-0000-000000000007',
                '00000000-0000-0000-0000-000000000008',
                '00000000-0000-0000-0000-000000000009',
                '00000000-0000-0000-0000-000000000010'
            ];
            const studentRows = (rows || []).filter(r => {
                const name = String(r.player_name || '').trim().toLowerCase();
                const status = String(r.status || '').toLowerCase();
                return !SYSTEM_IDS.includes(r.id) && name !== '__SYSTEM_ROSTER__' && !name.startsWith('__') &&
                    name !== 'khách truy cập' && name !== 'visitor' &&
                    !status.includes('admin') && String(r.ip_address || '').trim() !== 'SYSTEM';
            });
            const groupedByStudent = new Map();
            const normalizeIdentityKey = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
            for (const row of studentRows) {
                const name = String(row.player_name || '').trim().toLowerCase();
                const ip = String(row.ip_address || '').trim().toLowerCase();
                const device = String(row.device_info || '').trim().toLowerCase();
                const validIp = ip && !['chưa xác định', '—', 'system'].includes(ip);
                const helperKey = typeof window.getStudentGroupKey === 'function' ? window.getStudentGroupKey(row) : '';
                const devCode = (typeof window.extractDeviceCode === 'function' ? window.extractDeviceCode(row.device_info) : String(row.device_info || '').match(/QM-[A-Z0-9]{4,}/i)?.[0])?.toUpperCase() || '';
                const pinName = devCode ? String(this.rosterConfig?.devicePins?.[devCode] || '').trim() : '';
                const key = pinName ? 'pin:' + normalizeIdentityKey(pinName) : (helperKey || ((devCode ? `[${devCode}]` : '') || (validIp ? `ip:${ip}` : (name && name !== 'học sinh' ? `name:${name}` : `row:${row.id}`))));
                const time = new Date(row.last_active || row.created_at || 0).getTime() || 0;
                if (!groupedByStudent.has(key)) groupedByStudent.set(key, []);
                groupedByStudent.get(key).push({ row, time });
            }

            const grade5Only = this.hasGrade5OnlyAccess();
            const matchesObserverFilter = (item) => Boolean(
                item && (grade5Only
                    ? item.isGrade5
                    : (item.isGrade5 || item.answered > 0 || item.subject.toLowerCase().includes('toán') || item.subject.toLowerCase().includes('lớp 5')))
            );

            const parsed = [];
            groupedByStudent.forEach((entries, studentKey) => {
                entries.sort((a, b) => b.time - a.time);
                const records = entries.map(e => this.parseStudentProgressRecord(e.row))
                    .filter((record) => !grade5Only || record.isGrade5);
                if (records.length === 0) return;
                const seenIds = new Set();
                const realAttempts = records.filter((r) => {
                    const idKey = String(r.id);
                    if (seenIds.has(idKey)) return false;
                    seenIds.add(idKey);
                    return !r.isWaiting || r.isCompleted || r.answered > 0 || (Array.isArray(r.detail?.items) && r.detail.items.length > 0);
                });
                const latestCompleted = realAttempts.find(r => r.isCompleted);
                const latestCompletedTime = latestCompleted ? (new Date(latestCompleted.lastActive || 0).getTime() || 0) : 0;
                const inProgress = realAttempts.find(r => {
                    const time = new Date(r.lastActive || 0).getTime() || 0;
                    return !r.isCompleted && !r.isWaiting && Date.now() - time <= 30 * 60 * 1000 && time >= latestCompletedTime;
                });
                const primary = inProgress || latestCompleted || realAttempts[0] || records[0];
                if (!primary) return;
                primary.history = (realAttempts.length > 0 ? realAttempts : [primary]).slice(0, 8);
                primary._deviceCodes = Array.from(new Set(entries.map((e) => {
                    const extracted = typeof window.extractDeviceCode === 'function' ? window.extractDeviceCode(e.row?.device_info) : String(e.row?.device_info || '').match(/QM-[A-Z0-9]{4,}/i)?.[0];
                    return String(extracted || '').toUpperCase();
                }).filter(Boolean)));
                primary.machineBadge = primary._deviceCodes.length ? `[${primary._deviceCodes[0]}]${primary._deviceCodes.length > 1 ? ` (+${primary._deviceCodes.length - 1} máy)` : ''}` : '';
                const machineCode = primary._deviceCodes[0] || '';
                const pinName = machineCode ? String(this.rosterConfig?.devicePins?.[machineCode] || '').trim() : '';
                const latestNamed = realAttempts.find((r) => r.name && !/^(khách truy cập|học sinh|visitor)$/i.test(String(r.name).trim()));
                if (pinName) {
                    primary.name = pinName;
                } else if (latestNamed) {
                    primary.name = latestNamed.name;
                }
                primary.aliases = Array.from(new Set(realAttempts.map((r) => String(r.name || '').trim()).filter((n) => n && n.toLowerCase() !== String(primary.name || '').trim().toLowerCase() && !/^(khách truy cập|học sinh|visitor)$/i.test(n))));
                primary.studentKey = studentKey;
                primary._ips = Array.from(new Set(entries.map((e) => String(e.row?.ip_address || '').trim()).filter((ip) => ip && !['Chưa xác định', '—', 'SYSTEM'].includes(ip))));
                primary.outsideRoster = Boolean(primary.detail?.outsideRoster || /\[Ngoài lớp\]/i.test(primary.rawStatus || ''));
                if (matchesObserverFilter(primary) || primary.history.some(matchesObserverFilter)) {
                    parsed.push(primary);
                }
            });

            let doingCount = 0;
            let submittedCount = 0;
            parsed.forEach(p => {
                if (p.isCompleted) submittedCount++;
                else if (!p.isWaiting) doingCount++;
            });

            this.animateHomeCount('obs-stat-doing', doingCount);
            this.animateHomeCount('obs-stat-submitted', submittedCount);
            this.animateHomeCount('obs-stat-total', parsed.length);

            // Ưu tiên đưa học sinh đang thi lên đầu -> Đã nộp bài -> Người đang chờ
            const sorted = [...parsed].sort((a, b) => {
                const aScore = (!a.isCompleted && !a.isWaiting) ? 2 : (a.isCompleted ? 1 : 0);
                const bScore = (!b.isCompleted && !b.isWaiting) ? 2 : (b.isCompleted ? 1 : 0);
                if (bScore !== aScore) return bScore - aScore;
                return new Date(b.lastActive || 0).getTime() - new Date(a.lastActive || 0).getTime();
            });

            this.renderObserverCardsSmoothly(container, sorted);
        } finally {
            this.observerProgressLoading = false;
            if (this.observerProgressRefreshQueued) {
                this.observerProgressRefreshQueued = false;
                setTimeout(() => this.fetchAndRenderObserverFullscreen(), 500);
            }
        }
    }

    async fetchAndRenderParentProgress() {
        return this.fetchAndRenderObserverFullscreen();
    }

    }

    const descriptors = Object.getOwnPropertyDescriptors(QuizAppObserverMixin.prototype);
    delete descriptors.constructor;
    Object.defineProperties(QuizApp.prototype, descriptors);

})(window);
