const els = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element]),
);

const REVIEW_INTERVALS = [10 * 60e3, 864e5, 3 * 864e5, 7 * 864e5, 14 * 864e5, 30 * 864e5, 60 * 864e5];
const STAGE_NAMES = ["10 分钟巩固", "1 天复习", "3 天复习", "7 天复习", "14 天复习", "30 天复习", "60 天复习"];
const STORAGE_KEY = "wordloom-progress-v1";
const ACTIVE_SESSION_KEY = "wordloom-active-session-v1";
const DELETED_WORDS_KEY = "wordloom-deleted-words-v1";
const CUSTOM_WORDS_KEY = "wordloom-custom-words-v1";
const SPELLING_EQUIVALENT_GROUPS = [
  ["generalization", "generalisation"],
  ["specialization", "specialisation"],
  ["urbanization", "urbanisation"],
  ["marvelous", "marvellous"],
  ["inquiry", "enquiry"],
  ["maneuver", "manoeuvre"],
  ["utilization", "utilisation"],
  ["acclimatize", "acclimatise"],
];
const SPELLING_EQUIVALENTS = new Map(
  SPELLING_EQUIVALENT_GROUPS.flatMap((group) => group.map((word) => [word, group])),
);
let words = [];
let source = "smart";
let mode = "random";
let session = [];
let current = 0;
let checked = false;
let correct = 0;
let assisted = 0;
let mistakes = 0;
let usedPronunciationHint = false;
let initialTotal = 0;
let startedAt = 0;
let sessionMisses = new Map();
let progress = loadProgress();
const study = window.WORD_STUDY || {};

function loadProgress() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || { words: {}, sessions: [] };
    stored.words = stored.words && typeof stored.words === "object" ? stored.words : {};
    stored.sessions = Array.isArray(stored.sessions) ? stored.sessions : [];
    if (stored.protocolVersion !== 3) {
      Object.values(stored.words || {}).forEach((state) => {
        state.stage = typeof state.stage === "number" ? Math.max(-1, Math.min(state.stage, REVIEW_INTERVALS.length - 1)) : -1;
        state.relearning = false;
        state.recovery = false;
        state.resumeStage = null;
      });
      stored.protocolVersion = 3;
    }
    return stored;
  } catch {
    return { protocolVersion: 3, words: {}, sessions: [] };
  }
}

function saveProgress() {
  let saved = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    saved = false;
  }
  window.wordloomSyncSave?.(STORAGE_KEY);
  updateStats();
  if (!saved) els.protocolMessage.textContent = "学习记录保存失败，请检查浏览器是否允许本地存储。";
}

function activeSessionSnapshot(nextCurrent = current) {
  return {
    version: 1,
    savedAt: Date.now(),
    source,
    mode,
    wordIds: session.map((item) => item.id),
    current: nextCurrent,
    correct,
    assisted,
    mistakes,
    initialTotal,
    startedAt,
    sessionMisses: Object.fromEntries(sessionMisses),
  };
}

function saveActiveSession(nextCurrent = current) {
  if (!session.length) return;
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(activeSessionSnapshot(nextCurrent)));
  } catch {
    els.protocolMessage.textContent = "当前练习保存失败，请避免刷新页面。";
  }
}

function clearActiveSession() {
  localStorage.removeItem(ACTIVE_SESSION_KEY);
}

function readActiveSession() {
  try {
    const stored = JSON.parse(localStorage.getItem(ACTIVE_SESSION_KEY));
    return stored && Array.isArray(stored.wordIds) ? stored : null;
  } catch {
    return null;
  }
}

function restoreActiveSession() {
  const stored = readActiveSession();
  if (!stored) return false;
  const wordsById = new Map(words.map((item) => [item.id, item]));
  const restoredWords = stored.wordIds.map((id) => wordsById.get(id)).filter(Boolean);
  if (!restoredWords.length || restoredWords.length !== stored.wordIds.length) {
    clearActiveSession();
    return false;
  }
  source = stored.source || "smart";
  mode = stored.mode || "random";
  session = restoredWords;
  current = Math.max(0, Math.min(Number(stored.current) || 0, session.length));
  correct = Number(stored.correct) || 0;
  assisted = Number(stored.assisted) || 0;
  mistakes = Number(stored.mistakes) || 0;
  initialTotal = Number(stored.initialTotal) || session.length;
  startedAt = Number(stored.startedAt) || Date.now();
  sessionMisses = new Map(Object.entries(stored.sessionMisses || {}).map(([id, count]) => [Number(id), Number(count) || 0]));
  checked = false;
  usedPronunciationHint = false;
  els.emptyState.classList.add("hidden");
  els.result.classList.add("hidden");
  if (current >= session.length) {
    finishSession();
  } else {
    els.quiz.classList.remove("hidden");
    renderQuestion();
    els.protocolMessage.textContent = `已恢复未完成练习：继续第 ${current + 1} 题，共 ${session.length} 题。`;
  }
  return true;
}

function deletedWordIds() {
  try {
    const stored = JSON.parse(localStorage.getItem(DELETED_WORDS_KEY));
    return new Set(Array.isArray(stored) ? stored.map(Number) : []);
  } catch {
    return new Set();
  }
}

function customWords() {
  try {
    const stored = JSON.parse(localStorage.getItem(CUSTOM_WORDS_KEY));
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function dayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function wordState(id) {
  const state = progress.words[id];
  if (!state) return null;
  if (typeof state.stage !== "number") state.stage = -1;
  state.mastered = Boolean(state.mastered);
  state.relearning = Boolean(state.relearning);
  state.recovery = Boolean(state.recovery);
  state.assistedReview = Boolean(state.assistedReview);
  return state;
}

function relativeTime(timestamp) {
  if (!timestamp) return "—";
  const diff = timestamp - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60e3) return diff <= 0 ? "现在" : "1 分钟内";
  if (abs < 3600e3) return `${Math.ceil(abs / 60e3)} 分钟${diff <= 0 ? "前" : "后"}`;
  if (abs < 864e5) return `${Math.ceil(abs / 3600e3)} 小时${diff <= 0 ? "前" : "后"}`;
  return `${Math.ceil(abs / 864e5)} 天${diff <= 0 ? "前" : "后"}`;
}

function stageLabel(state) {
  if (!state) return "首次学习";
  if (state.mastered) return "长期掌握";
  if (state.assistedReview) return "读音辅助 · 10 分钟巩固";
  if (state.relearning) return state.nextReview > Date.now() ? "错词重学 · 10 分钟" : "错词回炉 · 待重答";
  if (state.recovery) return "错词重学 · 10 分钟";
  if (state.stage < 0) return "首次学习";
  return `第 ${state.stage + 2}/8 次 · ${STAGE_NAMES[state.stage]}`;
}

function speakText(text, button = null) {
  return window.playHumanPronunciation(text, button);
}

function speakWord(word, button = null) {
  return speakText(word, button);
}

function openQuickDictionary(event) {
  event.preventDefault();
  const query = els.quickDictionaryInput.value.trim();
  if (!query) {
    els.quickDictionaryHint.textContent = "请先输入要查询的英文单词";
    els.quickDictionaryInput.focus();
    return;
  }
  els.quickDictionaryHint.textContent = `正在查询 ${query}`;
  const opened = window.open("", "_blank");
  if (opened) {
    opened.opener = null;
    opened.location.href = `https://dictionary.cambridge.org/dictionary/english-chinese-simplified/${encodeURIComponent(query)}`;
  } else {
    els.quickDictionaryHint.textContent = "弹窗被浏览器拦截，请允许此页面打开新窗口";
  }
}

function updateCurrentDateTime() {
  const now = new Date();
  const date = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(now);
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  els.today.textContent = `${date} · ${time}`;
}

function openResetDialog() {
  const learnedWords = Object.keys(progress.words).length;
  const sessions = progress.sessions.length;
  els.resetImpact.textContent = `${learnedWords} 个已学习单词 · ${sessions} 组历史记录`;
  els.resetConfirmInput.value = "";
  els.confirmReset.disabled = true;
  els.resetDialog.showModal();
  els.resetConfirmInput.focus();
}

function closeResetDialog() {
  els.resetDialog.close();
}

function clearLearningRecords(event) {
  event.preventDefault();
  if (els.resetConfirmInput.value.trim() !== "清除") return;
  localStorage.removeItem(STORAGE_KEY);
  window.wordloomSyncSave?.(STORAGE_KEY);
  clearActiveSession();
  progress = { protocolVersion: 3, words: {}, sessions: [] };
  session = [];
  current = 0;
  checked = false;
  correct = 0;
  assisted = 0;
  mistakes = 0;
  usedPronunciationHint = false;
  initialTotal = 0;
  startedAt = 0;
  sessionMisses = new Map();
  window.stopHumanPronunciation?.();
  els.quiz.classList.add("hidden");
  els.result.classList.add("hidden");
  els.emptyState.classList.remove("hidden");
  closeResetDialog();
  updateStats();
  updateAvailable();
}

function updateStats() {
  const attempts = Object.values(progress.words).reduce((sum, item) => sum + (item.attempts || 0), 0);
  const hits = Object.values(progress.words).reduce((sum, item) => sum + (item.correct || 0), 0);
  const now = Date.now();
  const states = Object.values(progress.words);
  const due = states.filter((item) => !item.mastered && item.nextReview && item.nextReview <= now);
  const overdue = due.filter((item) => now - item.nextReview >= 864e5);
  const learning = states.filter((item) => !item.mastered && item.attempts > 0);
  const mastered = states.filter((item) => item.mastered);
  const upcoming = states
    .filter((item) => !item.mastered && item.nextReview && item.nextReview > now)
    .sort((a, b) => a.nextReview - b.nextReview)[0];
  const nextTask = due.sort((a, b) => a.nextReview - b.nextReview)[0] || upcoming;
  const todaySessions = progress.sessions.filter((item) => item.date === dayKey());
  els.todayDone.textContent = todaySessions.reduce((sum, item) => sum + item.total, 0);
  els.accuracy.textContent = attempts ? `${Math.round((hits / attempts) * 100)}%` : "—";
  els.reviewCount.textContent = due.length;
  els.overdueCount.textContent = overdue.length;
  els.learningCount.textContent = learning.length;
  els.masteredCount.textContent = mastered.length;
  els.nextReviewTime.textContent = due.length ? "现在" : nextTask ? relativeTime(nextTask.nextReview) : "—";
  els.nextReviewStage.textContent = nextTask ? stageLabel(nextTask) : "暂无计划";
  els.protocolMessage.textContent = overdue.length
    ? `有 ${overdue.length} 个复习任务已逾期。系统建议先完成到期复习，再学习新词。`
    : due.length
      ? `有 ${due.length} 个单词已经到达最佳复习时间。`
      : upcoming
        ? `当前没有到期任务，下一次复习将在${relativeTime(upcoming.nextReview)}开始。`
        : "还没有学习计划，从一组新词开始建立记忆周期。";
}

function poolForSource() {
  const start = Math.min(Number(els.wordStart.value) || 1, Number(els.wordEnd.value) || 1);
  const end = Math.max(Number(els.wordStart.value) || 1, Number(els.wordEnd.value) || 1);
  let pool = words.filter((item) => item.id >= start && item.id <= end);
  if (source === "all") pool = pool.filter((item) => !wordState(item.id));
  if (source === "wrong") pool = pool.filter((item) => wordState(item.id)?.wrong > 0 && !wordState(item.id)?.mastered);
  if (source === "review") {
    pool = pool
      .filter((item) => wordState(item.id)?.nextReview <= Date.now() && !wordState(item.id)?.mastered)
      .sort((a, b) => wordState(a.id).nextReview - wordState(b.id).nextReview);
  }
  return pool;
}

function smartPool(count) {
  const start = Math.min(Number(els.wordStart.value) || 1, Number(els.wordEnd.value) || 1);
  const end = Math.max(Number(els.wordStart.value) || 1, Number(els.wordEnd.value) || 1);
  const range = words.filter((item) => item.id >= start && item.id <= end);
  const due = range
    .filter((item) => wordState(item.id)?.nextReview <= Date.now() && !wordState(item.id)?.mastered)
    .sort((a, b) => {
      const wrongPriority = Number(wordState(b.id).wrong > 0) - Number(wordState(a.id).wrong > 0);
      return wrongPriority || wordState(a.id).nextReview - wordState(b.id).nextReview;
    });
  const fresh = range.filter((item) => !wordState(item.id));
  const chosen = [...due.slice(0, count)];
  const requestedNewLimit = Math.max(0, Number(els.smartNewLimit.value) || 0);
  const newLimit = Math.min(requestedNewLimit, Math.max(0, count - chosen.length));
  const orderedFresh = mode === "random" ? shuffled(fresh) : fresh;
  chosen.push(...orderedFresh.slice(0, newLimit));
  return chosen.slice(0, count);
}

function updateAvailable() {
  if (!words.length) return;
  document.querySelectorAll(".mode-segment").forEach((button) => {
    button.disabled = source === "review";
  });
  const requestedCount = Math.max(1, Number(els.wordCount.value) || 1);
  if (source === "smart") {
    const plan = smartPool(requestedCount);
    const dueWrong = plan.filter((item) => wordState(item.id)?.nextReview <= Date.now() && wordState(item.id)?.wrong > 0).length;
    const dueRegular = plan.filter((item) => wordState(item.id)?.nextReview <= Date.now() && !wordState(item.id)?.wrong).length;
    const fresh = plan.filter((item) => !wordState(item.id)).length;
    els.available.textContent = `智能计划 ${plan.length} 词：到期错词 ${dueWrong} · 其他到期 ${dueRegular} · 新词 ${fresh}`;
    els.startButton.disabled = plan.length === 0;
    els.startButton.style.opacity = plan.length === 0 ? ".45" : "1";
    els.smartPlanPreview.classList.remove("hidden");
    els.smartNewLimitField.classList.remove("hidden");
    els.modeControls.classList.remove("field-disabled");
    els.wordCountLabel.textContent = "本组词数上限";
    els.quotaHint.textContent = "只处理已到期任务，再按上限补充新词；填 0 可只复习";
    return;
  }
  els.smartPlanPreview.classList.add("hidden");
  els.smartNewLimitField.classList.add("hidden");
  els.modeControls.classList.toggle("field-disabled", source === "review");
  els.wordCountLabel.textContent = "本组词数";
  els.quotaHint.textContent = source === "review" ? "严格按照复习到期时间安排" : source === "wrong" ? "集中巩固尚未掌握的错词" : "从未学习的单词中安排本组任务";
  const count = poolForSource().length;
  const effectiveMode = source === "review" ? "sequential" : mode;
  const sessionCount = Math.min(count, requestedCount);
  els.available.textContent =
    source === "review"
      ? `严格按到期时间排序，本组练习 ${sessionCount} 个复习任务`
      : effectiveMode === "random"
      ? `当前范围有 ${count} 个词，本组随机抽取 ${sessionCount} 个`
      : `当前范围有 ${count} 个词，本组按序练习 ${sessionCount} 个`;
  els.startButton.disabled = count === 0;
  els.startButton.style.opacity = count === 0 ? ".45" : "1";
}

function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function startSession() {
  const count = Math.max(1, Number(els.wordCount.value) || 1);
  if (source === "smart") session = smartPool(count);
  else {
  const pool = poolForSource();
  session = source === "review" ? pool.slice(0, count) : mode === "random" ? shuffled(pool).slice(0, count) : pool.slice(0, count);
  }
  if (!session.length) return;
  initialTotal = session.length;
  current = 0;
  correct = 0;
  assisted = 0;
  mistakes = 0;
  sessionMisses = new Map();
  checked = false;
  usedPronunciationHint = false;
  startedAt = Date.now();
  els.emptyState.classList.add("hidden");
  els.result.classList.add("hidden");
  els.quiz.classList.remove("hidden");
  renderQuestion();
}

function renderQuestion() {
  const item = session[current];
  checked = false;
  usedPronunciationHint = false;
  els.quizProgress.textContent = `${String(current + 1).padStart(2, "0")} / ${String(session.length).padStart(2, "0")}`;
  els.progressBar.style.width = `${(current / session.length) * 100}%`;
  els.promptIndex.textContent = `单词序号 #${String(item.id).padStart(4, "0")}`;
  const cefr = window.wordCefrLevel(item);
  els.cefrBadge.textContent = cefr ? `剑桥 CEFR ${window.wordCefrLabel(item)}` : "剑桥 CEFR 未标注";
  els.cefrBadge.className = `cefr-badge${cefr ? ` level-${cefr.toLowerCase()}` : " level-unmarked"}`;
  els.cefrBadge.title = cefr ? "剑桥词典不同释义可能对应多个 CEFR 等级" : "剑桥词典当前词条未提供 CEFR 等级";
  els.stageBadge.textContent = stageLabel(wordState(item.id));
  els.meaning.textContent = item.meaning;
  els.currentDictionaryLink.href = `https://dictionary.cambridge.org/dictionary/english-chinese-simplified/${encodeURIComponent(item.word)}`;
  els.currentDictionaryLink.classList.add("hidden");
  els.speakButton.classList.remove("hidden");
  els.speakButton.classList.remove("hint-used");
  els.speakButton.classList.remove("pronunciation-missing");
  els.speakButton.textContent = "♪";
  els.speakButton.title = "播放免费真人读音；使用后本题计为提示答对";
  window.prepareHumanPronunciation?.(item.word);
  els.answerInput.value = "";
  els.answerInput.disabled = false;
  els.checkButton.textContent = "校验";
  els.feedback.className = "feedback";
  els.feedback.innerHTML = "";
  els.nextReviewNotice.classList.add("hidden");
  els.nextReviewNotice.textContent = "";
  saveActiveSession();
  els.answerInput.focus();
}

function normalize(value) {
  return value.trim().toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ");
}

function isAcceptedAnswer(answer, target) {
  const normalizedTarget = normalize(target);
  return answer === normalizedTarget || SPELLING_EQUIVALENTS.get(normalizedTarget)?.includes(answer);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function pdfStudyFeedback(item) {
  const content = study[item.id];
  const point = window.ieltsPointsFor(item, content);
  const examPoint = `<section class="answer-study-card ielts-point-card">
    <div class="answer-study-heading"><span>雅思真题考点</span><small>${escapeHtml(point.basis)}</small></div>
    <div class="ielts-point-meta"><span>${escapeHtml(point.topic)}</span><span>${escapeHtml(point.pos)}</span><span>${escapeHtml(point.level)}</span></div>
    <div class="answer-study-block"><strong>主要考法</strong><p>${escapeHtml(point.examUse)}</p></div>
    <div class="answer-study-block"><strong>答题注意</strong><p>${escapeHtml(point.caution)} ${escapeHtml(point.family)}</p></div>
  </section>`;
  if (!content) {
    return `${examPoint}<section class="answer-study-card answer-study-empty">
      <div class="answer-study-heading"><span>雅思词汇书学习内容</span><small>暂无匹配内容</small></div>
      <p>该单词暂未从雅思词汇书中匹配到清晰的学习内容。</p>
    </section>`;
  }
  if (content.type === "related") {
    return `${examPoint}<section class="answer-study-card">
      <div class="answer-study-heading"><span>雅思词汇书关联内容</span><small>第 ${content.pdfPage} 页</small></div>
      <p>该词作为 <b>${escapeHtml(content.parent)}</b> 的派生词或相关词出现。</p>
      <button type="button" class="study-speak-button" data-speak-text="${escapeHtml(content.parent)}"><span>♪</span>朗读关联词</button>
    </section>`;
  }
  const examples = content.examples.length
    ? `<div class="answer-study-block"><strong>例句</strong>${content.examples.map((example) => `
      <div class="answer-study-example"><p>${escapeHtml(example)}</p></div>`).join("")}</div>`
    : '<div class="answer-study-block"><strong>例句</strong><p>该词条未提取到清晰英文例句。</p></div>';
  const related = content.related.length
    ? `<div class="answer-study-block"><strong>派生／相关词</strong><div class="answer-study-related">${content.related.map((word) =>
      `<button type="button" class="study-related-word" data-speak-text="${escapeHtml(word)}">${escapeHtml(word)}<span>♪</span></button>`
    ).join("")}</div></div>`
    : "";
  return `${examPoint}<section class="answer-study-card">
    <div class="answer-study-heading"><span>雅思词汇书学习内容</span><small>第 ${content.pdfPage} 页</small></div>
    <button type="button" class="study-speak-button" data-speak-text="${escapeHtml(item.word)}"><span>♪</span>朗读单词</button>
    ${examples}${related}
  </section>`;
}

function scheduleReview(item, isCorrect, deferRelearning = false, wasAssisted = false) {
  const state = wordState(item.id) || { attempts: 0, correct: 0, wrong: 0, stage: -1, mastered: false, lapses: 0, relearning: false, recovery: false, assistedReview: false };
  state.attempts += 1;
  if (isCorrect && wasAssisted) {
    state.assisted = (state.assisted || 0) + 1;
    state.assistedReview = true;
    state.mastered = false;
    state.nextReview = Date.now() + REVIEW_INTERVALS[0];
  } else if (isCorrect) {
    state.correct += 1;
    state.assistedReview = false;
    if (state.relearning) {
      state.relearning = false;
      state.recovery = true;
      state.stage = state.resumeStage ?? 0;
      state.nextReview = Date.now() + REVIEW_INTERVALS[0];
    } else if (state.recovery) {
      state.recovery = false;
      if (state.stage >= REVIEW_INTERVALS.length - 1) {
        state.mastered = true;
        state.nextReview = null;
      } else {
        state.stage += 1;
        state.nextReview = Date.now() + REVIEW_INTERVALS[state.stage];
      }
    } else if (state.stage >= REVIEW_INTERVALS.length - 1) {
      state.mastered = true;
      state.nextReview = null;
    } else {
      state.stage += 1;
      state.nextReview = Date.now() + REVIEW_INTERVALS[state.stage];
    }
  } else {
    state.wrong += 1;
    state.lapses = (state.lapses || 0) + 1;
    state.assistedReview = false;
    state.resumeStage = Math.max(0, Math.floor(Math.max(0, state.stage) / 2));
    state.relearning = true;
    state.recovery = false;
    state.mastered = false;
    state.nextReview = Date.now() + (deferRelearning ? REVIEW_INTERVALS[0] : 0);
  }
  state.lastAttempt = Date.now();
  progress.words[item.id] = state;
  saveProgress();
  return state;
}

function checkAnswer(event) {
  event.preventDefault();
  if (checked) {
    nextQuestion();
    return;
  }
  const item = session[current];
  const answer = normalize(els.answerInput.value);
  if (!answer) {
    els.feedback.textContent = "先写下你的答案，再进行校验。";
    els.feedback.className = "feedback wrong";
    return;
  }
  checked = true;
  const isCorrect = isAcceptedAnswer(answer, item.word);
  const usedSpellingVariant = isCorrect && answer !== normalize(item.word);
  if (isCorrect) {
    if (usedPronunciationHint) {
      assisted += 1;
      els.feedback.innerHTML = `<div class="answer-verdict">拼写正确。<b>${escapeHtml(item.word)}</b>${usedSpellingVariant ? `（接受拼写变体：${escapeHtml(els.answerInput.value.trim())}）` : ""}</div>${pdfStudyFeedback(item)}`;
      els.feedback.className = "feedback correct";
    } else {
      correct += 1;
      els.feedback.innerHTML = `<div class="answer-verdict">独立答对。<b>${escapeHtml(item.word)}</b>${usedSpellingVariant ? `（接受拼写变体：${escapeHtml(els.answerInput.value.trim())}）` : ""}</div>${pdfStudyFeedback(item)}`;
      els.feedback.className = "feedback correct";
    }
  } else {
    mistakes += 1;
    const misses = (sessionMisses.get(item.id) || 0) + 1;
    sessionMisses.set(item.id, misses);
    const willRetryThisSession = misses <= 2;
    if (willRetryThisSession) session.splice(Math.min(session.length, current + 4), 0, item);
    els.feedback.innerHTML = `<div class="answer-verdict">正确答案是 <b>${escapeHtml(item.word)}</b>，你的答案：${escapeHtml(els.answerInput.value.trim())}</div>${pdfStudyFeedback(item)}`;
    els.feedback.className = "feedback wrong";
  }
  els.quizProgress.textContent = `${String(current + 1).padStart(2, "0")} / ${String(session.length).padStart(2, "0")}`;
  els.answerInput.disabled = true;
  els.checkButton.textContent = current === session.length - 1 ? "查看结果" : "下一词";
  els.progressBar.style.width = `${((current + 1) / session.length) * 100}%`;
  const willRetryThisSession = !isCorrect && (sessionMisses.get(item.id) || 0) <= 2;
  const state = scheduleReview(item, isCorrect, !isCorrect && !willRetryThisSession, usedPronunciationHint);
  saveActiveSession(current + 1);
  els.currentDictionaryLink.classList.remove("hidden");
  els.speakButton.classList.remove("hidden");
  els.nextReviewNotice.classList.toggle("hidden", isCorrect && usedPronunciationHint);
  els.nextReviewNotice.textContent = isCorrect && usedPronunciationHint
    ? ""
    : isCorrect
    ? state.mastered
      ? "已完成长期复习周期，进入长期掌握。"
      : state.recovery
        ? "本轮已重新答对。10 分钟后进行错词重学，通过后恢复到降低后的复习阶段。"
      : `下一阶段：${stageLabel(state)}，${relativeTime(state.nextReview)}到期。`
    : willRetryThisSession
      ? "将在最多间隔 3 题后重新出现。本轮最多重答两次；重新答对后，10 分钟再复习一次。"
      : "本轮重答次数已达上限，10 分钟后重新学习，避免重复猜测削弱记忆。";
}

function nextQuestion() {
  current += 1;
  if (current >= session.length) {
    finishSession();
  } else {
    renderQuestion();
  }
}

function finishSession() {
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  clearActiveSession();
  progress.sessions.push({ date: dayKey(), total: initialTotal, correct, assisted, mistakes, seconds });
  progress.sessions = progress.sessions.slice(-100);
  saveProgress();
  els.quiz.classList.add("hidden");
  els.result.classList.remove("hidden");
  const totalAttempts = correct + assisted + mistakes;
  els.resultScore.textContent = `${totalAttempts ? Math.round((correct / totalAttempts) * 100) : 0}%`;
  els.resultCorrect.textContent = correct;
  els.resultAssisted.textContent = assisted;
  els.resultWrong.textContent = mistakes;
  els.resultTime.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const accuracy = totalAttempts ? correct / totalAttempts : 0;
  els.resultAdvice.textContent =
    mistakes === 0 && assisted === 0
      ? "本组全部通过。建议结束本轮，等待系统安排下一次间隔复习。"
      : mistakes === 0 && assisted > 0
        ? "本组已完成。使用读音提示的单词已保留在复习计划中。"
      : accuracy >= 0.8
        ? "整体记忆稳定。错词已进入短间隔重学，下次优先完成到期复习。"
        : "本组提取较吃力。建议暂不增加新词，下一组使用智能计划继续巩固。";
}

async function speakCurrent() {
  if (!session[current]) return;
  const played = await speakWord(session[current].word, els.speakButton);
  if (!played) return;
  if (!checked) {
    usedPronunciationHint = true;
    els.speakButton.classList.add("hint-used");
    els.speakButton.title = "已使用读音提示，本题将计为提示答对";
  }
}

function enhanceNumberInputs(inputs) {
  inputs.forEach((input) => {
    input.dataset.defaultValue = input.value;
    input.classList.add("number-input");
    input.addEventListener("focus", () => {
      input.dataset.replaceReady = "true";
    });
    input.addEventListener("beforeinput", (event) => {
      if (input.dataset.replaceReady === "true" && event.inputType.startsWith("insert")) {
        input.value = "";
        input.dataset.replaceReady = "false";
      }
    });
    input.addEventListener("keydown", (event) => {
      if (input.dataset.replaceReady === "true" && (event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        input.value = "";
        input.dataset.replaceReady = "false";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    input.addEventListener("blur", () => {
      input.dataset.replaceReady = "false";
      const min = input.min === "" ? -Infinity : Number(input.min);
      const max = input.max === "" ? Infinity : Number(input.max);
      const value = input.value === "" ? Number(input.dataset.defaultValue) : Number(input.value);
      input.value = Math.min(max, Math.max(min, Number.isFinite(value) ? value : Number(input.dataset.defaultValue)));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    input.addEventListener("wheel", (event) => {
      if (document.activeElement === input) {
        event.preventDefault();
        input.blur();
      }
    }, { passive: false });
  });
}

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".segment").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    source = button.dataset.source;
    updateAvailable();
  });
});

document.querySelectorAll(".mode-segment").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".mode-segment").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    mode = button.dataset.mode;
    updateAvailable();
  });
});

[els.wordStart, els.wordEnd].forEach((input) => input.addEventListener("input", updateAvailable));
els.wordCount.addEventListener("input", updateAvailable);
els.smartNewLimit.addEventListener("input", updateAvailable);
enhanceNumberInputs([els.wordStart, els.wordEnd, els.wordCount, els.smartNewLimit]);
els.startButton.addEventListener("click", startSession);
els.restartButton.addEventListener("click", startSession);
els.answerForm.addEventListener("submit", checkAnswer);
els.speakButton.addEventListener("click", speakCurrent);
els.quickDictionaryForm.addEventListener("submit", openQuickDictionary);
els.feedback.addEventListener("click", (event) => {
  const button = event.target.closest("[data-speak-text]");
  if (button) speakText(button.dataset.speakText, button);
});
els.resetProgress.addEventListener("click", openResetDialog);
els.cancelReset.addEventListener("click", closeResetDialog);
els.resetConfirmInput.addEventListener("input", () => {
  els.confirmReset.disabled = els.resetConfirmInput.value.trim() !== "清除";
});
els.resetDialogForm.addEventListener("submit", clearLearningRecords);
els.resetDialog.addEventListener("click", (event) => {
  if (event.target === els.resetDialog) closeResetDialog();
});

updateCurrentDateTime();

const deletedIds = deletedWordIds();
const completeWords = [...(window.WORDS || []), ...customWords()];
words = completeWords.filter((item) => !deletedIds.has(item.id));
if (words.length) {
  els.wordEnd.max = Math.max(...completeWords.map((item) => item.id));
  els.wordStart.max = els.wordEnd.max;
  updateAvailable();
  updateStats();
  restoreActiveSession();
} else {
  els.available.textContent = (window.WORDS || []).length
    ? "当前没有可学习单词，请前往词库中心检查已删除单词"
    : "词库读取失败，请确认 words.js 与网页在同一文件夹";
}

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    progress = loadProgress();
    updateStats();
    updateAvailable();
    return;
  }
  if (event.key === DELETED_WORDS_KEY || event.key === CUSTOM_WORDS_KEY) window.location.reload();
});

window.setInterval(() => {
  updateCurrentDateTime();
  updateStats();
  updateAvailable();
}, 60e3);

window.setInterval(updateCurrentDateTime, 1e3);
