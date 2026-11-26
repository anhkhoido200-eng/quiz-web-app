const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runInNewContext } = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-sync.js'), 'utf8');

test('nộp bài giữ autosave khi cloud trả false hoặc throw và xóa khi xác nhận', async () => {
  const cases = [false, new Error('network'), true];
  for (const result of cases) {
    const window = {
      dbService: {
        updateLoginStatus: async () => {
          if (result instanceof Error) throw result;
          return result;
        }
      },
      scrollTo() {}
    };
    const autosaveKey = 'quiz_autosave_history_Học sinh';
    const storage = new Map([[autosaveKey, '{"answers":{"q1":0}}']]);
    const localStorage = {
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    };
    runInNewContext(source, {
      window,
      document: { getElementById: () => null },
      localStorage,
      sessionStorage: { removeItem() {} },
      console: { warn() {} }
    });
    const sync = window.AppSync;
    const app = {
      playerName: 'Học sinh',
      currentSubject: 'history',
      currentLoginId: 'login-1',
      allQuestions: [{ id: 'q1', correct: 0 }],
      userAnswers: { q1: 0 },
      secondsElapsed: 60,
      stopStopwatch() {},
      getSubjectTitle: () => 'Lịch sử',
      hasAdminBypass: () => false,
      getRosterGradeConfig: () => ({ grade: '5' }),
      getCurrentSubjectObj: () => ({ key: 'history' }),
      getSubjectAttemptStorageKey: () => 'attempt-count',
      buildStudentProgressDetail: () => sync.buildStudentProgressDetail(app),
      clearAutoSaveProgress: () => sync.clearAutoSaveProgress(app),
      saveToPersonalHistory() {},
      playFanfareSound() {},
      updateMistakeBankOnFinish: () => [],
      updateResultRevengeButton() {},
      updateHomeRevengeBanner() {},
      renderReviewList() {},
      switchScreen(screen) { this.currentScreen = screen; },
      animateResultScore() {}
    };

    await sync.finishQuiz(app);
    assert.equal(storage.has(autosaveKey), result !== true);
    assert.equal(app.currentScreen, 'result');
    assert.equal(app._lastResultCorrectCount, 1);
  }
});

test('đồng bộ tiếp snapshot mới nhất khi một lần gửi đang chạy', async () => {
  const calls = [];
  const completions = [];
  const window = {
    dbService: {
      updateStudentProgress(...args) {
        calls.push(args);
        return new Promise(resolve => completions.push(resolve));
      }
    }
  };
  runInNewContext(source, { window });
  const sync = window.AppSync;
  let pendingFlush;
  const app = {
    currentScreen: 'quiz',
    quizAttemptId: 'attempt-1',
    currentLoginId: 'login-1',
    secondsElapsed: 30,
    hasAdminBypass: () => false,
    getSubjectTitle: () => 'Lịch sử',
    buildStudentProgressDetail: () => ({}),
    flushStudentProgress(attemptId) { pendingFlush = sync.flushStudentProgress(this, attemptId); }
  };

  sync.queueStudentProgress(app, 1, 3, 1);
  const firstFlush = pendingFlush;
  sync.queueStudentProgress(app, 2, 3, 1);
  assert.equal(calls.length, 1);
  completions[0]();
  await firstFlush;
  assert.deepEqual(calls.map(args => args[1]), [1, 2]);
  completions[1]();
  await pendingFlush;
  assert.equal(app.progressSyncRunning, false);
});
