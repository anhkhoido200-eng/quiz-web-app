const test = require('node:test');
const assert = require('node:assert/strict');

function normalizeAnswer(value) {
  return String(value ?? '').trim().replace(/,/g, '.').toLowerCase();
}

function isShortAnswerCorrect(question, answer) {
  const candidate = normalizeAnswer(answer);
  if (!candidate) return false;
  const accepted = [question.correctValue, ...(question.acceptedValues || [])]
    .map(normalizeAnswer)
    .filter(Boolean);
  return accepted.includes(candidate);
}

function gradeQuestion(question, answer) {
  if (question.qType === 'mcq') {
    return Number(answer) === Number(question.correct);
  }
  if (question.qType === 'tf_group') {
    const actual = answer && typeof answer === 'object' ? answer : [];
    return question.statements.length > 0 && question.statements.every((statement, index) => (
      actual[index] !== undefined && Boolean(actual[index]) === Boolean(statement.answer)
    ));
  }
  if (question.qType === 'short_answer') {
    return isShortAnswerCorrect(question, answer);
  }
  return false;
}

function speedBonus(responseMs, perQuestionSec = null, offline = false) {
  if (offline) return 0;
  const elapsed = Math.max(0, Number(responseMs) || 0);
  if (perQuestionSec !== null && perQuestionSec !== undefined) {
    return Math.max(0, Math.min(20, Math.round(20 * (1 - elapsed / (perQuestionSec * 1000)))));
  }
  return Math.max(0, Math.min(20, 20 - Math.floor(elapsed / 3000)));
}

function scoreAnswer(question, answer, responseMs, options = {}) {
  if (!gradeQuestion(question, answer)) return 0;
  return 100 + speedBonus(responseMs, options.perQuestionSec, options.offline);
}

function validateSessionRequest(request, attempt) {
  if (!request || !attempt) return { valid: false, reason: 'missing_context' };
  if (!String(request.sessionToken || '').trim()) return { valid: false, reason: 'missing_token' };
  if (request.sessionToken !== attempt.activeSessionToken) return { valid: false, reason: 'SESSION_REPLACED' };
  if (request.attemptId !== attempt.id) return { valid: false, reason: 'wrong_attempt' };
  if (!attempt.questionOrder.includes(request.questionId)) return { valid: false, reason: 'question_not_in_attempt' };
  if (attempt.questionOrder[attempt.currentIndex] !== request.questionId) return { valid: false, reason: 'wrong_question_order' };
  return { valid: true };
}

test('chấm MCQ theo index đáp án, không tin điểm do client gửi', () => {
  const question = { qType: 'mcq', correct: 2 };
  assert.equal(gradeQuestion(question, 2), true);
  assert.equal(gradeQuestion(question, '2'), true);
  assert.equal(gradeQuestion(question, 1), false);
  assert.equal(scoreAnswer(question, 2, 1000), 120);
  assert.equal(scoreAnswer(question, 2, 1000, { clientScore: 999999 }), 120);
});

test('chấm TF group chỉ đúng khi mọi mệnh đề được trả lời chính xác', () => {
  const question = {
    qType: 'tf_group',
    statements: [{ answer: true }, { answer: false }, { answer: true }]
  };
  assert.equal(gradeQuestion(question, { 0: true, 1: false, 2: true }), true);
  assert.equal(gradeQuestion(question, [true, false, true]), true);
  assert.equal(gradeQuestion(question, { 0: true, 1: true, 2: true }), false);
  assert.equal(gradeQuestion(question, { 0: true, 1: false }), false);
  assert.equal(scoreAnswer(question, [true, false, true], 2000, { perQuestionSec: 10 }), 116);
});

test('chấm short answer chuẩn hóa khoảng trắng, chữ hoa và dấu phẩy thập phân', () => {
  const question = { qType: 'short_answer', correctValue: '3.14', acceptedValues: ['pi', ' 3,14 '] };
  assert.equal(isShortAnswerCorrect(question, ' 3,14 '), true);
  assert.equal(isShortAnswerCorrect(question, 'PI'), true);
  assert.equal(isShortAnswerCorrect(question, '3.15'), false);
  assert.equal(isShortAnswerCorrect(question, ''), false);
  assert.equal(scoreAnswer(question, 'pi', 500), 120);
});

test('speed bonus bị giới hạn 0..20 và giảm theo thời gian', () => {
  assert.equal(speedBonus(0, 10), 20);
  assert.equal(speedBonus(5000, 10), 10);
  assert.equal(speedBonus(10000, 10), 0);
  assert.equal(speedBonus(20000, 10), 0);
  assert.equal(speedBonus(0, null), 20);
  assert.equal(speedBonus(60000, null), 0);
  assert.equal(speedBonus(1000, 10, true), 0);
});

test('offline sync không nhận speed bonus dù client khai báo thời gian rất nhỏ', () => {
  const question = { qType: 'mcq', correct: 0 };
  assert.equal(scoreAnswer(question, 0, 1, { perQuestionSec: 30, offline: true }), 100);
  assert.equal(scoreAnswer(question, 0, 1, { perQuestionSec: 30, offline: false }), 120);
});

test('token phiên hợp lệ phải khớp attempt, question và thứ tự server', () => {
  const attempt = {
    id: 'attempt-1',
    activeSessionToken: 'session-secret-123456',
    questionOrder: [11, 12],
    currentIndex: 0
  };
  const valid = validateSessionRequest({
    attemptId: 'attempt-1', sessionToken: 'session-secret-123456', questionId: 11
  }, attempt);
  assert.deepEqual(valid, { valid: true });

  assert.equal(validateSessionRequest({
    attemptId: 'attempt-1', sessionToken: 'old-session', questionId: 11
  }, attempt).reason, 'SESSION_REPLACED');
  assert.equal(validateSessionRequest({
    attemptId: 'attempt-1', sessionToken: 'session-secret-123456', questionId: 12
  }, attempt).reason, 'wrong_question_order');
  assert.equal(validateSessionRequest({
    attemptId: 'attempt-1', sessionToken: 'session-secret-123456', questionId: 99
  }, attempt).reason, 'question_not_in_attempt');
});

test('request thiếu token hoặc attempt id không được xác thực', () => {
  const attempt = {
    id: 'attempt-1', activeSessionToken: 'session-secret-123456', questionOrder: [1], currentIndex: 0
  };
  assert.equal(validateSessionRequest({ attemptId: 'attempt-1', questionId: 1 }, attempt).reason, 'missing_token');
  assert.equal(validateSessionRequest({
    attemptId: 'other-attempt', sessionToken: 'session-secret-123456', questionId: 1
  }, attempt).reason, 'wrong_attempt');
});

test('replay cùng question không được tạo điểm lần thứ hai', () => {
  const seen = new Set();
  const submitOnce = (attemptId, questionId) => {
    const key = `${attemptId}:${questionId}`;
    if (seen.has(key)) return { duplicate: true, points: 0 };
    seen.add(key);
    return { duplicate: false, points: 120 };
  };
  assert.deepEqual(submitOnce('attempt-1', 11), { duplicate: false, points: 120 });
  assert.deepEqual(submitOnce('attempt-1', 11), { duplicate: true, points: 0 });
  assert.deepEqual(submitOnce('attempt-1', 12), { duplicate: false, points: 120 });
});
