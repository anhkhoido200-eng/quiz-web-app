/* arena.js - Competitive Arena Engine (Student + Host Console) */
(function () {
    'use strict';

    function esc(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function fmtMs(ms) {
        const totalSec = Math.max(0, Math.round(Number(ms || 0) / 1000));
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return m > 0 ? `${m}p ${String(s).padStart(2, '0')}s` : `${s}s`;
    }

    function fmtClock(sec) {
        const safe = Math.max(0, Math.ceil(Number(sec || 0)));
        const m = Math.floor(safe / 60);
        const s = safe % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function getClient() {
        return window.dbService?.client || null;
    }

    function isMissingSchemaError(err) {
        const msg = String(err?.message || err || '');
        return /match_rooms|PGRST205|42P01|does not exist|schema cache/i.test(msg);
    }

    /* =========================================================================
       1. STUDENT ARENA CLIENT
       ========================================================================= */
    const ArenaClient = {
        room: null,
        attempt: null,
        questions: [],
        sessionToken: '',
        clockOffsetMs: 0,
        currentIndex: 0,
        submissionSeq: 0,
        tickTimer: null,
        pollTimer: null,
        realtimeChannel: null,
        lastViolationAt: 0,
        antiCheatBound: false,
        pendingQueueKey: '',
        isFlushingQueue: false,

        async syncClock() {
            const client = getClient();
            if (!client) return;
            try {
                const t0 = Date.now();
                const { data, error } = await client.rpc('arena_get_server_time');
                if (!error && data) {
                    const t1 = Date.now();
                    const rtt = (t1 - t0) / 2;
                    this.clockOffsetMs = new Date(data).getTime() + rtt - t1;
                }
            } catch (e) { /* keep existing offset */ }
        },

        serverNowMs() {
            return Date.now() + (this.clockOffsetMs || 0);
        },

        openJoinModal(prefillCode = '') {
            let modal = document.getElementById('arena-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'arena-modal';
                modal.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-slate-950/85 backdrop-blur-sm p-3 sm:p-5';
                modal.innerHTML = `
                    <div id="arena-modal-card" class="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl p-4 sm:p-6 text-slate-100 space-y-4">
                        <div class="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
                            <div class="flex items-center gap-2.5">
                                <span class="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center justify-center">
                                    <i class="fa-solid fa-trophy"></i>
                                </span>
                                <div>
                                    <h2 class="text-base sm:text-lg font-extrabold text-white">Phòng Thi Đấu Trực Tuyến</h2>
                                    <p class="text-[11px] text-slate-400">Đồng bộ máy chủ • Chống gian lận • Xếp hạng công bằng</p>
                                </div>
                            </div>
                            <button type="button" id="arena-close-btn" class="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div id="arena-stage"></div>
                    </div>
                `;
                document.body.appendChild(modal);
                modal.addEventListener('click', (e) => {
                    if (e.target.closest('#arena-close-btn')) this.closeModal();
                });
            }
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            this.renderJoinForm(prefillCode);
        },

        closeModal() {
            const modal = document.getElementById('arena-modal');
            if (modal) {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
            this.cleanupTimers();
            this.unbindAntiCheat();
        },

        cleanupTimers() {
            clearInterval(this.tickTimer);
            clearInterval(this.pollTimer);
            if (this.realtimeChannel && getClient()?.removeChannel) {
                try { getClient().removeChannel(this.realtimeChannel); } catch (e) {}
                this.realtimeChannel = null;
            }
        },

        renderJoinForm(prefillCode = '') {
            const stage = document.getElementById('arena-stage');
            if (!stage) return;
            const savedName = localStorage.getItem('quiz_player_name') || document.getElementById('player-name-input')?.value?.trim() || '';
            stage.innerHTML = `
                <form id="arena-join-form" class="space-y-4">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label class="block space-y-1.5">
                            <span class="text-xs font-bold text-slate-300">Họ và tên thí sinh</span>
                            <input id="arena-player-name" type="text" required maxlength="40" value="${esc(savedName)}" placeholder="Ví dụ: Nguyễn Văn An - 11A1"
                                class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-base sm:text-sm outline-none focus:border-amber-400">
                        </label>
                        <label class="block space-y-1.5">
                            <span class="text-xs font-bold text-slate-300">Mã phòng thi đấu (6 ký tự)</span>
                            <input id="arena-room-code" type="text" required maxlength="8" value="${esc(prefillCode)}" placeholder="VD: A1B2C3"
                                class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-amber-300 font-mono font-extrabold uppercase tracking-widest text-base sm:text-sm outline-none focus:border-amber-400">
                        </label>
                    </div>
                    <div id="arena-join-error" class="hidden p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-semibold"></div>
                    <div class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400 space-y-1">
                        <p class="font-bold text-slate-200"><i class="fa-solid fa-shield-halved text-amber-400 mr-1.5"></i> Quy tắc phòng thi công bằng:</p>
                        <p>• Câu hỏi và đáp án A, B, C, D được xáo trộn riêng cho từng thí sinh.</p>
                        <p>• Hệ thống ghi nhận chuyển tab, rời cửa sổ, thoát toàn màn hình và tự động nộp bài khi vượt ngưỡng.</p>
                        <p>• Điểm xếp hạng dựa trên số câu đúng và tốc độ phản hồi theo đồng hồ máy chủ.</p>
                    </div>
                    <button type="submit" class="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:brightness-110 text-slate-950 font-extrabold text-sm cursor-pointer">
                        <i class="fa-solid fa-right-to-bracket mr-1.5"></i> Tham Gia Phòng Thi Đấu
                    </button>
                </form>
            `;
            document.getElementById('arena-join-form')?.addEventListener('submit', (e) => {
                e.preventDefault();
                this.joinRoom(
                    document.getElementById('arena-room-code')?.value?.trim(),
                    document.getElementById('arena-player-name')?.value?.trim()
                );
            });
        },

        async joinRoom(code, playerName) {
            const errBox = document.getElementById('arena-join-error');
            const showErr = (msg) => {
                if (errBox) {
                    errBox.textContent = msg;
                    errBox.classList.remove('hidden');
                }
            };
            const client = getClient();
            if (!client) return showErr('Chưa kết nối được Supabase Cloud.');
            if (!code || !playerName) return showErr('Vui lòng nhập đầy đủ họ tên và mã phòng.');

            localStorage.setItem('quiz_player_name', playerName);
            const playerKey = playerName.toLowerCase().replace(/\s+/g, ' ').trim();
            const tokenKey = `arena_session_${code.toUpperCase()}_${playerKey}`;
            this.sessionToken = localStorage.getItem(tokenKey) || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
            localStorage.setItem(tokenKey, this.sessionToken);

            await this.syncClock();
            const { data, error } = await client.rpc('arena_join_room', {
                p_room_code: code.toUpperCase(),
                p_player_name: playerName,
                p_player_key: playerKey,
                p_session_token: this.sessionToken
            });
            if (error) {
                if (isMissingSchemaError(error)) {
                    return showErr('Hệ thống chưa chạy file supabase_arena_setup.sql trên Supabase.');
                }
                return showErr(error.message || 'Không thể tham gia phòng.');
            }

            if (data?.server_now) {
                this.clockOffsetMs = new Date(data.server_now).getTime() - Date.now();
            }
            this.room = data.room;
            this.attempt = data.attempt;
            this.questions = Array.isArray(data.questions) ? data.questions : [];
            this.currentIndex = Number(this.attempt?.current_index || 0);
            this.pendingQueueKey = `arena_pending_${this.attempt.id}`;

            this.subscribeRoom();
            this.flushPendingAnswers();
            this.routeByState();
        },

        subscribeRoom() {
            const client = getClient();
            if (!client || !this.room?.id) return;
            if (typeof client.channel === 'function') {
                this.realtimeChannel = client
                    .channel(`arena-room-${this.room.id}`)
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_rooms', filter: `id=eq.${this.room.id}` }, (payload) => {
                        if (payload?.new) {
                            this.room = payload.new;
                            this.routeByState();
                        }
                    })
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_attempts', filter: `room_id=eq.${this.room.id}` }, (payload) => {
                        if (payload?.new && payload.new.id === this.attempt?.id) {
                            if (payload.new.active_session_token && payload.new.active_session_token !== this.sessionToken) {
                                this.renderSessionReplaced();
                                return;
                            }
                            this.attempt = payload.new;
                        }
                        if (this.room?.status === 'WAITING' || this.room?.status === 'FINISHED') {
                            this.refreshLobbyOrLeaderboard();
                        }
                    })
                    .subscribe();
            }
            clearInterval(this.pollTimer);
            this.pollTimer = setInterval(() => this.pollRoomState(), 4000);
        },

        async pollRoomState() {
            const client = getClient();
            if (!client || !this.room?.id) return;
            const { data: roomRow } = await client.from('match_rooms').select('*').eq('id', this.room.id).maybeSingle();
            if (roomRow) {
                const prevStatus = this.room.status;
                this.room = roomRow;
                if (prevStatus !== roomRow.status) this.routeByState();
            }
            if (this.attempt?.id) {
                const { data: attRow } = await client.from('match_attempts').select('*').eq('id', this.attempt.id).maybeSingle();
                if (attRow) {
                    if (attRow.active_session_token && attRow.active_session_token !== this.sessionToken) {
                        this.renderSessionReplaced();
                        return;
                    }
                    this.attempt = attRow;
                    if ((attRow.status === 'SUBMITTED' || attRow.status === 'FORCED') && document.getElementById('arena-exam-view')) {
                        this.renderLeaderboardView();
                    }
                }
            }
            if (this.room?.status === 'WAITING') this.refreshLobbyOrLeaderboard();
            this.flushPendingAnswers();
        },

        routeByState() {
            if (!this.room || !this.attempt) return;
            if (this.attempt.status === 'SUBMITTED' || this.attempt.status === 'FORCED' || this.room.status === 'FINISHED') {
                this.unbindAntiCheat();
                this.renderLeaderboardView();
                return;
            }
            this.renderExamView();
        },

        async refreshLobbyOrLeaderboard() {
            const client = getClient();
            if (!client || !this.room?.id) return;
            const { data } = await client
                .from('match_attempts')
                .select('id, player_name, status, correct_count, score, total_time_ms, violation_count')
                .eq('room_id', this.room.id)
                .order('correct_count', { ascending: false })
                .order('score', { ascending: false })
                .order('total_time_ms', { ascending: true })
                .order('violation_count', { ascending: true });

            const lobbyEl = document.getElementById('arena-lobby-players');
            if (lobbyEl && Array.isArray(data)) {
                lobbyEl.innerHTML = data.map((p) => `
                    <div class="p-2.5 rounded-xl bg-slate-800/70 border border-slate-700/70 text-xs font-semibold flex items-center gap-2">
                        <i class="fa-solid fa-user-check text-emerald-400"></i>
                        <span class="truncate">${esc(p.player_name)}</span>
                    </div>
                `).join('');
            }
            const lbEl = document.getElementById('arena-lb-rows');
            if (lbEl && Array.isArray(data)) {
                lbEl.innerHTML = this.buildLeaderboardRowsHtml(data);
            }
        },

        renderExamView() {
            const stage = document.getElementById('arena-stage');
            if (!stage) return;
            if (this.room?.require_fullscreen && document.documentElement.requestFullscreen && !document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            }
            this.bindAntiCheat();

            if (this.currentIndex >= this.questions.length) {
                this.finishAttempt('USER_SUBMIT');
                return;
            }
            const q = this.questions[this.currentIndex];
            const totalQ = this.questions.length;

            stage.innerHTML = `
                <div id="arena-exam-view" class="space-y-4 select-none">
                    <div class="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                        <span class="text-xs font-bold text-indigo-300">Câu ${this.currentIndex + 1} / ${totalQ}</span>
                        <div class="flex items-center gap-3 text-xs font-mono font-bold">
                            <span class="text-emerald-400">Điểm: <b id="arena-live-score">${this.attempt?.score || 0}</b></span>
                            <span class="text-rose-400">Vi phạm: <b id="arena-live-violations">${this.attempt?.violation_count || 0}/${this.room?.max_violations || 0}</b></span>
                            <span class="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                <i class="fa-regular fa-clock mr-1"></i><span id="arena-match-timer">--:--</span>
                            </span>
                        </div>
                    </div>
                    ${this.room?.per_question_sec ? `
                        <div class="space-y-1">
                            <div class="flex justify-between text-[11px] text-slate-400">
                                <span>Thời gian câu hiện tại</span>
                                <b id="arena-q-timer" class="text-cyan-300">${this.room.per_question_sec}s</b>
                            </div>
                            <div class="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                                <div id="arena-q-bar" class="h-full bg-gradient-to-r from-cyan-400 to-indigo-500 transition-all duration-200" style="width:100%"></div>
                            </div>
                        </div>
                    ` : ''}
                    <div id="arena-warning-banner" class="hidden p-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs font-bold"></div>
                    <div class="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3">
                        <div class="text-sm sm:text-base font-bold text-white leading-relaxed">${esc(q.question)}</div>
                        ${q.qType === 'short_answer' ? `
                            <div class="flex gap-2">
                                <input id="arena-short-input" type="text" placeholder="Nhập đáp án..." class="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-base sm:text-sm select-text outline-none focus:border-indigo-400">
                                <button id="arena-short-submit" type="button" class="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs cursor-pointer">Gửi</button>
                            </div>
                        ` : `
                            <div class="grid grid-cols-1 gap-2">
                                ${(q.options || []).map((opt, idx) => `
                                    <button type="button" class="arena-opt-btn text-left px-4 py-3 rounded-xl bg-slate-900 hover:bg-indigo-600/25 border border-slate-700 hover:border-indigo-400 text-sm text-slate-100 flex items-center gap-3 cursor-pointer transition" data-opt-idx="${idx}">
                                        <span class="w-7 h-7 rounded-lg bg-slate-800 border border-slate-600 flex items-center justify-center font-bold text-xs shrink-0">${['A', 'B', 'C', 'D'][idx] || idx + 1}</span>
                                        <span>${esc(opt)}</span>
                                    </button>
                                `).join('')}
                            </div>
                        `}
                    </div>
                </div>
            `;

            const examEl = document.getElementById('arena-exam-view');
            if (examEl) {
                ['copy', 'cut', 'paste', 'contextmenu'].forEach((evt) => {
                    examEl.addEventListener(evt, (e) => {
                        if (e.target.id === 'arena-short-input' && evt === 'paste') return;
                        e.preventDefault();
                    });
                });
            }

            document.querySelectorAll('.arena-opt-btn').forEach((btn) => {
                btn.addEventListener('click', () => this.submitAnswer(q.id, Number(btn.dataset.optIdx), null));
            });
            document.getElementById('arena-short-submit')?.addEventListener('click', () => {
                const val = document.getElementById('arena-short-input')?.value?.trim();
                if (val) this.submitAnswer(q.id, null, val);
            });

            this.startExamTimers(q.id);
        },

        startExamTimers(questionId) {
            clearInterval(this.tickTimer);
            const attemptStartMs = this.attempt?.started_at ? new Date(this.attempt.started_at).getTime() : this.serverNowMs();
            const matchEndMs = this.room?.match_duration_sec ? (attemptStartMs + Number(this.room.match_duration_sec) * 1000) : null;
            const qStartMs = this.attempt?.question_started_at ? new Date(this.attempt.question_started_at).getTime() : this.serverNowMs();
            const perQSec = Number(this.room?.per_question_sec || 0);

            this.tickTimer = setInterval(() => {
                const nowMs = this.serverNowMs();
                if (matchEndMs) {
                    const remainSec = Math.max(0, (matchEndMs - nowMs) / 1000);
                    const el = document.getElementById('arena-match-timer');
                    if (el) el.textContent = fmtClock(remainSec);
                    if (remainSec <= 0) {
                        clearInterval(this.tickTimer);
                        this.finishAttempt('TIME_UP');
                        return;
                    }
                }
                if (perQSec > 0) {
                    const elapsedSec = Math.max(0, (nowMs - qStartMs) / 1000);
                    const qRemain = Math.max(0, perQSec - elapsedSec);
                    const qEl = document.getElementById('arena-q-timer');
                    const qBar = document.getElementById('arena-q-bar');
                    if (qEl) qEl.textContent = `${Math.ceil(qRemain)}s`;
                    if (qBar) qBar.style.width = `${Math.max(0, Math.min(100, (qRemain / perQSec) * 100))}%`;
                    if (qRemain <= 0) {
                        clearInterval(this.tickTimer);
                        this.submitAnswer(questionId, null, '');
                    }
                }
            }, 250);
        },

        async submitAnswer(questionId, selectedDisplay, textAnswer) {
            this.submissionSeq += 1;
            const payload = {
                p_attempt_id: this.attempt.id,
                p_session_token: this.sessionToken,
                p_question_id: questionId,
                p_selected_display: selectedDisplay,
                p_text_answer: textAnswer,
                p_submission_seq: this.submissionSeq
            };

            const client = getClient();
            if (!navigator.onLine || !client) {
                this.enqueuePendingAnswer(payload);
                this.currentIndex += 1;
                this.renderExamView();
                return;
            }

            const { data, error } = await client.rpc('arena_submit_answer', payload);
            if (error) {
                if (String(error.message || '').includes('SESSION_REPLACED')) return this.renderSessionReplaced();
                if (String(error.message || '').includes('MATCH_TIME_UP')) return this.renderLeaderboardView();
                this.enqueuePendingAnswer(payload);
            } else if (data?.attempt) {
                this.attempt = data.attempt;
            }
            this.currentIndex = Math.max(this.currentIndex + 1, Number(this.attempt?.current_index || 0));
            this.renderExamView();
        },

        enqueuePendingAnswer(payload) {
            if (!this.pendingQueueKey) return;
            try {
                const list = JSON.parse(localStorage.getItem(this.pendingQueueKey) || '[]');
                list.push(payload);
                localStorage.setItem(this.pendingQueueKey, JSON.stringify(list));
            } catch (e) {}
        },

        async flushPendingAnswers() {
            const client = getClient();
            if (!client || !navigator.onLine || !this.pendingQueueKey || this.isFlushingQueue) return;
            let list = [];
            try { list = JSON.parse(localStorage.getItem(this.pendingQueueKey) || '[]'); } catch (e) { list = []; }
            if (!list.length) return;
            this.isFlushingQueue = true;
            const remaining = [];
            for (const item of list) {
                const { error } = await client.rpc('arena_submit_answer', item);
                if (error && !/MATCH_TIME_UP|SESSION_REPLACED/i.test(String(error.message || ''))) {
                    remaining.push(item);
                }
            }
            try {
                if (remaining.length) localStorage.setItem(this.pendingQueueKey, JSON.stringify(remaining));
                else localStorage.removeItem(this.pendingQueueKey);
            } catch (e) {}
            this.isFlushingQueue = false;
        },

        bindAntiCheat() {
            if (this.antiCheatBound) return;
            this.antiCheatBound = true;
            this._onVisibility = () => { if (document.hidden) this.handleViolation('TAB_SWITCH'); };
            this._onBlur = () => this.handleViolation('WINDOW_BLUR');
            this._onFullscreen = () => {
                if (this.room?.require_fullscreen && !document.fullscreenElement) {
                    this.handleViolation('FULLSCREEN_EXIT');
                }
            };
            document.addEventListener('visibilitychange', this._onVisibility);
            window.addEventListener('blur', this._onBlur);
            document.addEventListener('fullscreenchange', this._onFullscreen);
        },

        unbindAntiCheat() {
            if (!this.antiCheatBound) return;
            this.antiCheatBound = false;
            document.removeEventListener('visibilitychange', this._onVisibility);
            window.removeEventListener('blur', this._onBlur);
            document.removeEventListener('fullscreenchange', this._onFullscreen);
        },

        async handleViolation(eventType) {
            if (!this.attempt?.id || this.attempt.status === 'SUBMITTED' || this.attempt.status === 'FORCED') return;
            const now = Date.now();
            if (now - this.lastViolationAt < 1000) return;
            this.lastViolationAt = now;

            const client = getClient();
            if (!client) return;
            const q = this.questions[this.currentIndex];
            const { data, error } = await client.rpc('arena_log_violation', {
                p_attempt_id: this.attempt.id,
                p_session_token: this.sessionToken,
                p_event_type: eventType,
                p_meta: { question_id: q?.id || null, index: this.currentIndex }
            });
            if (error && String(error.message || '').includes('SESSION_REPLACED')) {
                return this.renderSessionReplaced();
            }
            if (data?.attempt) this.attempt = data.attempt;
            const vEl = document.getElementById('arena-live-violations');
            if (vEl) vEl.textContent = `${this.attempt?.violation_count || 0}/${this.room?.max_violations || 0}`;
            const warn = document.getElementById('arena-warning-banner');
            if (warn) {
                warn.textContent = `Cảnh báo: Phát hiện ${eventType} (${this.attempt?.violation_count || 0}/${this.room?.max_violations || 0} lần).`;
                warn.classList.remove('hidden');
            }
            if (data?.forced) {
                this.unbindAntiCheat();
                this.renderLeaderboardView();
            }
        },

        async finishAttempt(reason = 'USER_SUBMIT') {
            this.unbindAntiCheat();
            clearInterval(this.tickTimer);
            await this.flushPendingAnswers();
            const client = getClient();
            if (client && this.attempt?.id) {
                const { data } = await client.rpc('arena_finish_attempt', {
                    p_attempt_id: this.attempt.id,
                    p_session_token: this.sessionToken,
                    p_reason: reason
                });
                if (data) this.attempt = data;
            }
            this.renderLeaderboardView();
        },

        renderSessionReplaced() {
            this.unbindAntiCheat();
            clearInterval(this.tickTimer);
            const stage = document.getElementById('arena-stage');
            if (!stage) return;
            stage.innerHTML = `
                <div class="p-6 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-center space-y-2">
                    <i class="fa-solid fa-user-lock text-3xl text-rose-400"></i>
                    <h3 class="text-base font-extrabold text-white">Phiên thi đã được mở ở thiết bị khác</h3>
                    <p class="text-xs text-rose-200">Mỗi tài khoản chỉ được phép thi trên một phiên hợp lệ tại một thời điểm.</p>
                </div>
            `;
        },

        buildLeaderboardRowsHtml(rows) {
            return rows.map((r, idx) => `
                <tr class="border-b border-slate-800/80 ${r.id === this.attempt?.id ? 'bg-indigo-500/15' : ''}">
                    <td class="py-2.5 px-2 font-black text-amber-400">#${idx + 1}</td>
                    <td class="py-2.5 px-2 font-bold text-white">${esc(r.player_name)}</td>
                    <td class="py-2.5 px-2 text-emerald-400 font-bold">${r.correct_count || 0}</td>
                    <td class="py-2.5 px-2 font-extrabold text-amber-300">${r.score || 0}</td>
                    <td class="py-2.5 px-2 text-slate-300 font-mono">${fmtMs(r.total_time_ms)}</td>
                    <td class="py-2.5 px-2 text-rose-400 font-bold">${r.violation_count || 0}</td>
                </tr>
            `).join('');
        },

        async renderLeaderboardView() {
            const stage = document.getElementById('arena-stage');
            if (!stage) return;
            stage.innerHTML = `
                <div class="space-y-4">
                    <div class="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <span class="text-[11px] font-bold uppercase text-emerald-400">Bảng xếp hạng trận đấu</span>
                            <h3 class="text-base font-extrabold text-white">${esc(this.room?.title || 'Phòng thi đấu')} (${esc(this.room?.room_code || '')})</h3>
                        </div>
                        <span class="px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold">
                            Trạng thái của bạn: ${esc(this.attempt?.finish_reason || this.attempt?.status || 'SUBMITTED')}
                        </span>
                    </div>
                    <div class="overflow-x-auto rounded-xl border border-slate-800">
                        <table class="w-full text-left text-xs">
                            <thead class="bg-slate-950 text-slate-400 uppercase text-[10px]">
                                <tr>
                                    <th class="py-2.5 px-2">Hạng</th>
                                    <th class="py-2.5 px-2">Thí sinh</th>
                                    <th class="py-2.5 px-2">Đúng</th>
                                    <th class="py-2.5 px-2">Điểm</th>
                                    <th class="py-2.5 px-2">Thời gian</th>
                                    <th class="py-2.5 px-2">Vi phạm</th>
                                </tr>
                            </thead>
                            <tbody id="arena-lb-rows">
                                <tr><td colspan="6" class="py-4 text-center text-slate-400">Đang tải bảng xếp hạng...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
            this.refreshLobbyOrLeaderboard();
        }
    };

    /* =========================================================================
       2. ADMIN ARENA HOST CONSOLE
       ========================================================================= */
    const ArenaHost = {
        selectedRoomId: null,
        mounted: false,

        mount(subjects = []) {
            const root = document.getElementById('arena-host-root');
            if (!root) return;
            if (!this.mounted) {
                this.mounted = true;
                root.innerHTML = `
                    <div class="arena-host-grid">
                        <section class="panel">
                            <div class="panel-title">
                                <div>
                                    <p class="eyebrow">COMPETITIVE ARENA</p>
                                    <h2>Tạo phòng thi đấu</h2>
                                    <p>Cấu hình chống gian lận, đồng hồ máy chủ và luật xếp hạng</p>
                                </div>
                            </div>
                            <form id="arena-create-form" class="form-grid">
                                <div class="form-grid two-columns">
                                    <label>Tên bài kiểm tra<input id="arena-host-title" value="Kiểm tra nhanh" required></label>
                                    <label>Môn học<select id="arena-host-subject"></select></label>
                                </div>
                                <div class="form-grid two-columns">
                                    <label>Thời gian toàn bài (giây)
                                        <input id="arena-host-duration" type="number" min="30" value="600">
                                    </label>
                                    <label>Giới hạn mỗi câu
                                        <select id="arena-host-perq">
                                            <option value="">Không giới hạn từng câu</option>
                                            <option value="15">15 giây / câu</option>
                                            <option value="20">20 giây / câu</option>
                                            <option value="30">30 giây / câu</option>
                                        </select>
                                    </label>
                                </div>
                                <div class="form-grid two-columns">
                                    <label>Vi phạm tối đa (tự nộp bài)
                                        <input id="arena-host-maxv" type="number" min="0" max="10" value="3">
                                    </label>
                                    <label>Đăng nhập đồng thời
                                        <select id="arena-host-concurrent">
                                            <option value="KICK_OLD">Ngắt phiên cũ, giữ phiên mới</option>
                                            <option value="BLOCK_NEW">Chặn thiết bị mới</option>
                                        </select>
                                    </label>
                                </div>
                                <label class="checkbox-label"><input id="arena-host-fs" type="checkbox"> Bắt buộc toàn màn hình</label>
                                <div class="form-actions">
                                    <button type="submit" class="button button-primary"><i class="fa-solid fa-plus"></i> Tạo mã kiểm tra</button>
                                </div>
                            </form>
                        </section>

                        <section class="panel">
                            <div class="panel-title">
                                <div>
                                    <p class="eyebrow">ACTIVE ROOMS</p>
                                    <h2>Danh sách phòng & Điều khiển</h2>
                                </div>
                                <button id="arena-host-refresh" type="button" class="button button-secondary compact"><i class="fa-solid fa-rotate"></i> Làm mới</button>
                            </div>
                            <div id="arena-host-rooms" class="stack-list"></div>
                        </section>
                    </div>

                    <section class="panel" style="margin-top:17px;">
                        <div class="panel-title">
                            <div>
                                <p class="eyebrow">TRANSPARENCY & AUDIT</p>
                                <h2>Bảng xếp hạng & Nhật ký kiểm toán</h2>
                                <p>Chọn một phòng ở trên để xem BXH và tra cứu vi phạm khiếu nại</p>
                            </div>
                        </div>
                        <div id="arena-host-detail"><p class="muted-copy">Chưa chọn phòng nào.</p></div>
                    </section>
                `;

                document.getElementById('arena-create-form')?.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.createRoom();
                });
                document.getElementById('arena-host-refresh')?.addEventListener('click', () => this.loadRooms());
            }

            const subjSel = document.getElementById('arena-host-subject');
            if (subjSel && Array.isArray(subjects) && subjects.length > 0) {
                subjSel.innerHTML = subjects.map((s) => `<option value="${esc(s.key)}">${esc(s.name)} (${esc(s.key)})</option>`).join('');
            }
            this.loadRooms();
        },

        async createRoom() {
            const client = getClient();
            if (!client) return;
            const perQRaw = document.getElementById('arena-host-perq')?.value;
            const { data, error } = await client.rpc('arena_create_room', {
                p_title: document.getElementById('arena-host-title')?.value?.trim() || 'Bài kiểm tra',
                p_subject_key: document.getElementById('arena-host-subject')?.value || 'history',
                p_match_duration_sec: Number(document.getElementById('arena-host-duration')?.value || 600),
                p_per_question_sec: perQRaw ? Number(perQRaw) : null,
                p_max_violations: Number(document.getElementById('arena-host-maxv')?.value || 3),
                p_concurrent_policy: document.getElementById('arena-host-concurrent')?.value || 'KICK_OLD',
                p_require_fullscreen: Boolean(document.getElementById('arena-host-fs')?.checked)
            });
            if (error) {
                alert(isMissingSchemaError(error)
                    ? 'Vui lòng chạy file supabase_arena_setup.sql trong Supabase SQL Editor trước khi tạo phòng.'
                    : `Không thể tạo phòng: ${error.message}`);
                return;
            }
            this.selectedRoomId = data?.id || null;
            this.loadRooms();
        },

        async loadRooms() {
            const client = getClient();
            const listEl = document.getElementById('arena-host-rooms');
            if (!client || !listEl) return;
            const { data, error } = await client.from('match_rooms').select('*').order('created_at', { ascending: false }).limit(12);
            if (error) {
                listEl.innerHTML = isMissingSchemaError(error)
                    ? '<p class="muted-copy">Chưa cài đặt bảng phòng thi đấu. Hãy chạy <code>supabase_arena_setup.sql</code> trong Supabase SQL Editor.</p>'
                    : `<p class="muted-copy">${esc(error.message)}</p>`;
                return;
            }
            if (!data || data.length === 0) {
                listEl.innerHTML = '<p class="muted-copy">Chưa có phòng thi đấu nào.</p>';
                return;
            }
            listEl.innerHTML = data.map((r) => `
                <div class="stack-item" style="flex-wrap:wrap;gap:10px;">
                    <div class="stack-item-main">
                        <b>${esc(r.title)} • <span style="color:var(--primary)">${esc(r.room_code)}</span></b>
                        <small>${esc(r.subject_key)} · ${Math.round((r.match_duration_sec || 600) / 60)} phút · Trạng thái: ${esc(r.status)}</small>
                    </div>
                    <div class="actions" style="display:flex;gap:6px;flex-wrap:wrap;">
                        <button type="button" class="button button-secondary compact" data-arena-copy="${esc(r.room_code)}"><i class="fa-solid fa-link"></i> Link</button>
                        ${r.status !== 'FINISHED' ? `<button type="button" class="button button-danger-solid compact" data-arena-end="${esc(r.id)}"><i class="fa-solid fa-flag-checkered"></i> Đóng bài</button>` : ''}
                        <button type="button" class="button button-secondary compact" data-arena-inspect="${esc(r.id)}"><i class="fa-solid fa-magnifying-glass"></i> Chi tiết</button>
                    </div>
                </div>
            `).join('');

            listEl.querySelectorAll('[data-arena-copy]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const url = new URL('index.html', window.location.href);
                    url.searchParams.set('arena', btn.dataset.arenaCopy);
                    navigator.clipboard?.writeText(url.toString());
                    btn.innerHTML = '<i class="fa-solid fa-check"></i> Đã chép';
                });
            });
            listEl.querySelectorAll('[data-arena-start]').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    await client.rpc('arena_start_room', { p_room_id: btn.dataset.arenaStart });
                    this.selectedRoomId = btn.dataset.arenaStart;
                    this.loadRooms();
                });
            });
            listEl.querySelectorAll('[data-arena-end]').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    await client.rpc('arena_end_room', { p_room_id: btn.dataset.arenaEnd });
                    this.selectedRoomId = btn.dataset.arenaEnd;
                    this.loadRooms();
                });
            });
            listEl.querySelectorAll('[data-arena-inspect]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this.selectedRoomId = btn.dataset.arenaInspect;
                    this.loadRoomDetail(this.selectedRoomId);
                });
            });

            if (this.selectedRoomId) this.loadRoomDetail(this.selectedRoomId);
        },

        async loadRoomDetail(roomId) {
            const client = getClient();
            const detailEl = document.getElementById('arena-host-detail');
            if (!client || !detailEl || !roomId) return;

            const [{ data: attempts }, { data: logs }] = await Promise.all([
                client.from('match_attempts')
                    .select('player_name, status, correct_count, score, total_time_ms, violation_count, finish_reason')
                    .eq('room_id', roomId)
                    .order('correct_count', { ascending: false })
                    .order('score', { ascending: false })
                    .order('total_time_ms', { ascending: true }),
                client.from('match_audit_logs')
                    .select('player_name, event_type, meta, created_at')
                    .eq('room_id', roomId)
                    .order('created_at', { ascending: false })
                    .limit(40)
            ]);

            detailEl.innerHTML = `
                <div class="table-wrap" style="margin-bottom:16px;">
                    <table>
                        <thead>
                            <tr><th>Hạng</th><th>Thí sinh</th><th>Trạng thái</th><th>Đúng</th><th>Điểm</th><th>Thời gian</th><th>Vi phạm</th></tr>
                        </thead>
                        <tbody>
                            ${(attempts || []).map((a, i) => `
                                <tr>
                                    <td><b>#${i + 1}</b></td>
                                    <td>${esc(a.player_name)}</td>
                                    <td>${esc(a.finish_reason || a.status)}</td>
                                    <td>${a.correct_count || 0}</td>
                                    <td><b>${a.score || 0}</b></td>
                                    <td>${fmtMs(a.total_time_ms)}</td>
                                    <td>${a.violation_count || 0}</td>
                                </tr>
                            `).join('') || '<tr><td colspan="7">Chưa có thí sinh tham gia.</td></tr>'}
                        </tbody>
                    </table>
                </div>
                <h3 style="font-size:13px;margin:0 0 8px;">Nhật ký kiểm toán & chống gian lận gần nhất</h3>
                <div class="stack-list">
                    ${(logs || []).map((l) => `
                        <div class="stack-item">
                            <div class="stack-item-main">
                                <b>${esc(l.player_name)} — ${esc(l.event_type)}</b>
                                <small>${new Date(l.created_at).toLocaleTimeString('vi-VN')} · ${esc(JSON.stringify(l.meta || {}))}</small>
                            </div>
                        </div>
                    `).join('') || '<p class="muted-copy">Chưa có nhật ký.</p>'}
                </div>
            `;
        }
    };

    window.ArenaClient = ArenaClient;
    window.ArenaHost = ArenaHost;

    document.addEventListener('DOMContentLoaded', () => {
        const params = new URLSearchParams(window.location.search);
        const arenaCode = params.get('arena');
        if (arenaCode && document.getElementById('btn-start-quiz')) {
            setTimeout(() => ArenaClient.openJoinModal(arenaCode), 350);
        }
    });
})();
