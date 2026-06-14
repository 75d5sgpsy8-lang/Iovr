const els = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const STORAGE_KEY = "wordloom-progress-v1";
const ACTIVE_SESSION_KEY = "wordloom-active-session-v1";
const DELETED_WORDS_KEY = "wordloom-deleted-words-v1";
const CUSTOM_WORDS_KEY = "wordloom-custom-words-v1";
const WORD_TAGS_KEY = "wordloom-word-tags-v1";
const STAGE_NAMES = ["10 分钟巩固", "1 天复习", "3 天复习", "7 天复习", "14 天复习", "30 天复习", "60 天复习"];
const ERROR_REASON_ADVICE = {
  "拼写错误": "这个单词你知道意思，但拼写还不稳定。请重点观察字母顺序、双写字母和词尾变化，并重新默写 2-3 遍。",
  "词义混淆": "这个单词容易和相近词混淆。请重点对比核心含义、使用场景和同义替换。",
  "完全不会": "这个单词还没有形成记忆。请先看中文释义、例句和使用场景，再重新默写。",
  "搭配不会": "你可能知道意思，但还不会自然使用。请重点记住常用搭配和例句。",
  "发音不熟": "这个单词的发音还不稳定，可能影响听力识别和拼写。请先跟读，再默写。",
  "一时想不起来": "这个单词不是完全不会，而是提取速度不够快。请缩短复习间隔，连续几天快速默写。",
};
const IELTS_TAGS = ["Task 1 数据描述", "Task 2 观点论证", "口语 Part 1", "口语 Part 2", "口语 Part 3", "阅读同义替换", "听力拼写高频", "地图流程图", "学术场景", "生活场景"];
const SPECIAL_TRAINING = [
  ["拼写错误", "开始拼写专项", "集中练习拼写错误的单词，重点强化字母顺序、双写字母和词尾变化。"],
  ["词义混淆", "开始词义辨析", "集中练习容易混淆词义的单词，重点对比核心含义、使用场景和同义替换。"],
  ["完全不会", "开始完全不会专项", "集中重新学习完全没有记住的单词，先理解释义，再进行默写。"],
  ["搭配不会", "开始搭配强化", "集中学习搭配不会的单词，重点查看常用搭配、例句和雅思写作用法。"],
  ["发音不熟", "开始发音强化", "集中处理发音不熟的单词，先跟读，再进行听音和默写练习。"],
  ["一时想不起来", "开始快速回忆", "集中练习一时想不起来的单词，提高反应速度和主动提取能力。"],
];
const PAGE_SIZE = 20;
const baseWords = window.WORDS || [];
let customWords = loadCustomWords();
let allWords = combinedWords();
const study = window.WORD_STUDY || {};
let progress = loadProgress();
let deletedIds = loadDeletedIds();
let wordTags = loadWordTags();
let words = availableWords();
let view = ["all", "wrong", "due", "deleted"].includes(new URLSearchParams(window.location.search).get("view"))
  ? new URLSearchParams(window.location.search).get("view")
  : "all";
let page = 1;
let highlightedWordId = null;

function loadProgress() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || { words: {}, sessions: [] };
    stored.words = stored.words && typeof stored.words === "object" ? stored.words : {};
    stored.sessions = Array.isArray(stored.sessions) ? stored.sessions : [];
    return stored;
  } catch {
    return { words: {}, sessions: [] };
  }
}

function loadDeletedIds() {
  try {
    const stored = JSON.parse(localStorage.getItem(DELETED_WORDS_KEY));
    return new Set(Array.isArray(stored) ? stored.map(Number) : []);
  } catch {
    return new Set();
  }
}

function loadCustomWords() {
  try {
    const stored = JSON.parse(localStorage.getItem(CUSTOM_WORDS_KEY));
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function loadWordTags() {
  try {
    const stored = JSON.parse(localStorage.getItem(WORD_TAGS_KEY));
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

function saveWordTags() {
  localStorage.setItem(WORD_TAGS_KEY, JSON.stringify(wordTags));
  window.wordloomSyncSave?.(WORD_TAGS_KEY);
}

function combinedWords() {
  return [...baseWords, ...customWords].sort((a, b) => a.id - b.id);
}

function saveCustomWords() {
  localStorage.setItem(CUSTOM_WORDS_KEY, JSON.stringify(customWords));
  window.wordloomSyncSave?.(CUSTOM_WORDS_KEY);
}

function availableWords() {
  return allWords.filter((item) => !deletedIds.has(item.id));
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  window.wordloomSyncSave?.(STORAGE_KEY);
}

function saveDeletedIds() {
  localStorage.setItem(DELETED_WORDS_KEY, JSON.stringify([...deletedIds].sort((a, b) => a - b)));
  window.wordloomSyncSave?.(DELETED_WORDS_KEY);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(rows, filename) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function splitTags(value) {
  return [...new Set(String(value || "").split(/[、,，/;；|]+/).map((tag) => tag.trim()).filter(Boolean))];
}

function tagsFor(item) {
  const tags = [...splitTags(item.tags), ...splitTags(wordTags[item.id])];
  const scene = String(item.scene || "");
  IELTS_TAGS.forEach((tag) => {
    if (scene.includes(tag) && !tags.includes(tag)) tags.push(tag);
  });
  if (!tags.length) {
    const point = window.ieltsPointsFor(item, study[item.id]);
    const text = `${point.topic || ""} ${point.examUse || ""}`;
    if (/写作|论证|观点/.test(text)) tags.push("Task 2 观点论证");
    if (/阅读|同义/.test(text)) tags.push("阅读同义替换");
    if (/听力|拼写/.test(text)) tags.push("听力拼写高频");
    if (/学术/.test(text)) tags.push("学术场景");
  }
  return [...new Set(tags)];
}

function downloadImportTemplate() {
  downloadCsv([["word", "meaning", "partOfSpeech", "cefr", "ieltsScene", "collocation", "example", "synonym", "bookSource", "note", "tags"]], "ielts-vocabulary-import-template.csv");
  els.librarySummary.textContent = "已下载导入模板。建议至少填写 word 和 meaning。";
}

function exportNewWords() {
  const newWords = words.filter((item) => !wordState(item.id));
  if (!newWords.length) {
    els.librarySummary.textContent = "当前没有可导出的新单词。";
    return;
  }
  const rows = [
    ["序号", "单词", "剑桥 CEFR 等级", "中文释义"],
    ...newWords.map((item) => [item.id, item.word, window.wordCefrLabel(item), item.meaning]),
  ];
  downloadCsv(rows, `wordloom-new-words-${new Date().toISOString().slice(0, 10)}.csv`);
  els.librarySummary.textContent = `已导出 ${newWords.length} 个尚未学习的新单词。`;
}

function exportLibrary() {
  const rows = [
    ["单词", "中文释义", "雅思场景", "常用搭配", "例句", "同义替换", "剑桥 CEFR 等级"],
    ...words.map((item) => [item.word, item.meaning, item.scene, item.collocation, item.example, item.synonyms, window.wordCefrLabel(item)]),
  ];
  downloadCsv(rows, `ielts-vocabulary-library-${new Date().toISOString().slice(0, 10)}.csv`);
  els.librarySummary.textContent = `已导出 ${words.length} 个可见单词。`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

async function importLibraryFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  let rows;
  try {
    if (/\.xlsx?$/i.test(file.name)) {
      if (!window.XLSX) throw new Error("Excel 解析组件未加载，请检查网络后重试，或改用 CSV。");
      const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
      rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
    } else rows = parseCsv((await file.text()).replace(/^\uFEFF/, ""));
  } catch (error) {
    els.librarySummary.textContent = `导入失败：${error.message || "请检查文件格式、字段名称和单词内容。"}`;
    event.target.value = "";
    return;
  }
  const headers = (rows.shift() || []).map((value) => String(value ?? "").trim());
  const indexOf = (...names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
  const wordIndex = indexOf("单词", "英文单词", "word");
  const meaningIndex = indexOf("中文释义", "释义", "meaning");
  if (wordIndex < 0 || meaningIndex < 0) {
    els.librarySummary.textContent = "导入失败：表格必须包含“单词”和“中文释义”列。";
    event.target.value = "";
    return;
  }
  const fieldIndexes = {
    scene: indexOf("雅思场景", "ieltsScene"),
    collocation: indexOf("常用搭配", "collocation"),
    example: indexOf("例句", "example"),
    synonyms: indexOf("同义替换", "synonym"),
    partOfSpeech: indexOf("词性", "partOfSpeech"),
    cefr: indexOf("剑桥 CEFR 等级", "cefr"),
    bookSource: indexOf("雅思词汇书", "bookSource"),
    note: indexOf("备注", "note"),
    tags: indexOf("雅思标签", "tags"),
  };
  const known = new Set(allWords.map((item) => item.word.toLowerCase()));
  let nextId = Math.max(0, ...allWords.map((item) => item.id)) + 1;
  let added = 0;
  let skipped = 0;
  rows.forEach((row) => {
    const word = (row[wordIndex] || "").trim().toLowerCase().replace(/\s+/g, " ");
    const meaning = (row[meaningIndex] || "").trim();
    if (!word || !meaning || known.has(word)) {
      skipped += 1;
      return;
    }
    customWords.push({
      id: nextId++,
      page: null,
      word,
      meaning,
      custom: true,
      scene: fieldIndexes.scene >= 0 ? (row[fieldIndexes.scene] || "").trim() : "",
      collocation: fieldIndexes.collocation >= 0 ? (row[fieldIndexes.collocation] || "").trim() : "",
      example: fieldIndexes.example >= 0 ? (row[fieldIndexes.example] || "").trim() : "",
      synonyms: fieldIndexes.synonyms >= 0 ? (row[fieldIndexes.synonyms] || "").trim() : "",
      partOfSpeech: fieldIndexes.partOfSpeech >= 0 ? (row[fieldIndexes.partOfSpeech] || "").trim() : "",
      cefr: fieldIndexes.cefr >= 0 ? (row[fieldIndexes.cefr] || "").trim() : "",
      bookSource: fieldIndexes.bookSource >= 0 ? (row[fieldIndexes.bookSource] || "").trim() : "",
      note: fieldIndexes.note >= 0 ? (row[fieldIndexes.note] || "").trim() : "",
      tags: fieldIndexes.tags >= 0 ? splitTags(row[fieldIndexes.tags]) : [],
    });
    known.add(word);
    added += 1;
  });
  saveCustomWords();
  allWords = combinedWords();
  words = availableWords();
  els.libraryEnd.max = Math.max(...allWords.map((item) => item.id));
  els.libraryEnd.value = els.libraryEnd.max;
  event.target.value = "";
  render();
  els.librarySummary.textContent = added ? `导入成功：已新增 ${added} 个单词，跳过 ${skipped} 个重复或无效单词。` : "导入失败。请检查文件格式、字段名称和单词内容是否正确。";
}

function clearLibraryFilters() {
  view = "all";
  page = 1;
  els.librarySearch.value = "";
  els.libraryStart.value = 1;
  els.libraryEnd.value = Math.max(...allWords.map((item) => item.id));
  els.wrongReasonFilter.value = "all";
  els.proficiencyFilter.value = "all";
  els.tagFilter.value = "all";
  document.querySelectorAll(".library-tab").forEach((button) => button.classList.toggle("active", button.dataset.libraryView === "all"));
  render();
}

function removeFromActiveSession(id) {
  try {
    const active = JSON.parse(localStorage.getItem(ACTIVE_SESSION_KEY));
    if (active?.wordIds?.includes(id)) localStorage.removeItem(ACTIVE_SESSION_KEY);
  } catch {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
  }
}

function deleteWord(id) {
  const item = allWords.find((word) => word.id === id);
  if (!item || !window.confirm(`确认隐藏单词 “${item.word}” 吗？\n\n该词将不再显示或进入学习计划，但已有学习记录会完整保留，可在“已删除单词”列表恢复。`)) return;
  deletedIds.add(id);
  saveDeletedIds();
  removeFromActiveSession(id);
  words = availableWords();
  highlightedWordId = null;
  render();
  els.librarySummary.textContent = `已隐藏单词 “${item.word}”，学习记录仍然保留。`;
}

function restoreWord(id) {
  const item = allWords.find((word) => word.id === id);
  if (!item) return;
  deletedIds.delete(id);
  saveDeletedIds();
  words = availableWords();
  render();
  els.librarySummary.textContent = `已恢复单词 “${item.word}”。`;
}

function editWordTags(id) {
  const item = allWords.find((word) => word.id === id);
  if (!item) return;
  const current = tagsFor(item).join("、");
  const value = window.prompt(`为 “${item.word}” 添加雅思场景标签：\n可填写多个标签，用顿号、逗号或斜杠分隔。`, current);
  if (value === null) return;
  wordTags[id] = splitTags(value);
  saveWordTags();
  render();
  els.librarySummary.textContent = `已更新 “${item.word}” 的雅思标签。`;
}

function openAddWordDialog() {
  els.addWordForm.reset();
  els.addWordMessage.textContent = "";
  els.addWordDialog.showModal();
  els.newWordText.focus();
}

function openBulkPasteDialog() {
  els.bulkPasteForm.reset();
  els.bulkPasteMessage.textContent = "";
  els.bulkPasteDialog.showModal();
  els.bulkPasteText.focus();
}

function closeBulkPasteDialog() {
  els.bulkPasteDialog.close();
}

function importBulkPaste(event) {
  event.preventDefault();
  const known = new Set(allWords.map((item) => item.word.toLowerCase()));
  let nextId = Math.max(0, ...allWords.map((item) => item.id)) + 1;
  let added = 0;
  let skipped = 0;
  els.bulkPasteText.value.split(/\r?\n/).filter(Boolean).forEach((line) => {
    const [rawWord, rawMeaning, rawTags = ""] = line.split("\t");
    const word = String(rawWord || "").trim().toLowerCase().replace(/\s+/g, " ");
    const meaning = String(rawMeaning || "").trim();
    if (!word || !meaning || known.has(word)) {
      skipped += 1;
      return;
    }
    customWords.push({ id: nextId++, page: null, word, meaning, custom: true, tags: splitTags(rawTags) });
    known.add(word);
    added += 1;
  });
  if (!added) {
    els.bulkPasteMessage.textContent = "导入失败。请按“英文单词 + 制表符 + 中文释义”的格式填写。";
    return;
  }
  saveCustomWords();
  allWords = combinedWords();
  words = availableWords();
  closeBulkPasteDialog();
  render();
  els.librarySummary.textContent = `导入成功：已新增 ${added} 个单词，跳过 ${skipped} 个重复或无效单词。`;
}

function closeAddWordDialog() {
  els.addWordDialog.close();
}

function addCustomWord(event) {
  event.preventDefault();
  const word = els.newWordText.value.trim().toLowerCase().replace(/\s+/g, " ");
  const meaning = els.newWordMeaning.value.trim();
  if (!word || !meaning) return;
  if (allWords.some((item) => item.word.toLowerCase() === word)) {
    els.addWordMessage.textContent = "该单词已存在于词库中。";
    return;
  }
  const id = Math.max(0, ...allWords.map((item) => item.id)) + 1;
  const item = {
    id, page: null, word, meaning, custom: true,
    scene: els.newWordScene.value.trim(),
    collocation: els.newWordCollocation.value.trim(),
    example: els.newWordExample.value.trim(),
    synonyms: els.newWordSynonyms.value.trim(),
    tags: splitTags(els.newWordTags.value),
  };
  customWords.push(item);
  saveCustomWords();
  allWords = combinedWords();
  words = availableWords();
  els.libraryEnd.max = id;
  els.libraryEnd.value = id;
  closeAddWordDialog();
  view = "all";
  document.querySelectorAll(".library-tab").forEach((button) => button.classList.toggle("active", button.dataset.libraryView === "all"));
  els.librarySearch.value = word;
  page = 1;
  render();
  els.librarySummary.textContent = `已新增单词 “${word}”，可立即进入新词学习。`;
}

function wordState(id) {
  const state = progress.words?.[id];
  if (!state) return null;
  if (typeof state.stage !== "number") state.stage = -1;
  return state;
}

function relativeTime(timestamp) {
  if (!timestamp) return "—";
  const minutes = Math.max(0, Math.ceil((timestamp - Date.now()) / 60000));
  if (minutes <= 0) return "现在";
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;
  return `${Math.ceil(hours / 24)} 天后`;
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

function proficiencyLabel(state) {
  if (!state) return "未学习";
  if (state.mastered) return "已掌握";
  if (state.relearning || state.recovery || (state.wrong || 0) > 0 && (state.lastWrongAt || 0) >= Date.now() - 30 * 864e5) return "易错";
  if ((state.independentStreak || 0) >= 2) return "熟悉";
  if ((state.attempts || 0) <= 1) return "初识";
  return "学习中";
}

function isDue(state) {
  return Boolean(state && !state.mastered && state.nextReview && state.nextReview <= Date.now());
}

function matchesView(item) {
  const state = wordState(item.id);
  if (view === "deleted") return deletedIds.has(item.id);
  if (view === "wrong") return state?.wrong > 0;
  if (view === "due") return isDue(state);
  return true;
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

function results() {
  const query = els.librarySearch.value.trim().toLowerCase();
  const start = Math.min(Number(els.libraryStart.value) || 1, Number(els.libraryEnd.value) || words.length);
  const end = Math.max(Number(els.libraryStart.value) || 1, Number(els.libraryEnd.value) || words.length);
  const sourceWords = view === "deleted" ? allWords : words;
  const filtered = sourceWords.filter((item) => {
    const pdfStudy = study[item.id];
    const studyText = pdfStudy ? [...pdfStudy.examples, ...pdfStudy.related, pdfStudy.parent].join(" ").toLowerCase() : "";
    const customText = [item.scene, item.collocation, item.example, item.synonyms, ...tagsFor(item)].filter(Boolean).join(" ").toLowerCase();
    const matchesQuery = !query || item.word.toLowerCase().includes(query) || item.meaning.toLowerCase().includes(query) || studyText.includes(query) || customText.includes(query) || String(item.id) === query;
    const state = wordState(item.id);
    const reasonFilter = els.wrongReasonFilter.value;
    const reasons = errorReasonsFor(state);
    const matchesReason = view !== "wrong"
      || reasonFilter === "all"
      || (reasonFilter === "unmarked" ? reasons.length === 0 : reasons.includes(reasonFilter));
    const matchesProficiency = els.proficiencyFilter.value === "all" || proficiencyLabel(state) === els.proficiencyFilter.value;
    const matchesTag = els.tagFilter.value === "all" || tagsFor(item).includes(els.tagFilter.value);
    return item.id >= start && item.id <= end && matchesQuery && matchesReason && matchesProficiency && matchesTag && matchesView(item);
  });
  if (view === "wrong") {
    filtered.sort((a, b) => {
      const aState = wordState(a.id);
      const bState = wordState(b.id);
      if (els.wrongSort.value === "recent") return (bState.lastAttempt || 0) - (aState.lastAttempt || 0);
      if (els.wrongSort.value === "id") return a.id - b.id;
      return (bState.wrong || 0) - (aState.wrong || 0) || a.id - b.id;
    });
  } else if (view === "due") {
    filtered.sort((a, b) => wordState(a.id).nextReview - wordState(b.id).nextReview || a.id - b.id);
  }
  return filtered;
}

function detailBlock(label, value) {
  return value ? `<div class="study-block"><b>${label}</b><p>${escapeHtml(value)}</p></div>` : "";
}

function errorReasonsFor(state) {
  const reasons = Object.entries(state?.errorReasons || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason]) => reason);
  return reasons.length || !state?.lastErrorReason ? reasons : [state.lastErrorReason];
}

function studyCell(item) {
  const content = study[item.id];
  const point = window.ieltsPointsFor(item, content);
  const usageContent = [
    detailBlock("雅思场景", item.scene || point.topic),
    detailBlock("阅读、写作与听力使用建议", point.examUse),
    detailBlock("上下文辨义与拼写提醒", point.caution),
    detailBlock("词族与同义替换建议", point.family),
  ].filter(Boolean).join("");
  const examples = item.example
    ? [item.example]
    : content?.examples || [];
  const collocationContent = [
    detailBlock("常用搭配", item.collocation),
    examples.length ? `<div class="study-block"><b>例句</b>${examples.map((example) => `<div class="study-example"><p>${escapeHtml(example)}</p></div>`).join("")}</div>` : "",
    detailBlock("同义替换", item.synonyms || content?.related?.join("、")),
  ].filter(Boolean).join("");
  let bookContent = '<span class="study-empty">暂无雅思词汇书匹配内容</span>';
  if (content) {
    bookContent = `<span class="study-source">雅思词汇书第 ${content.pdfPage} 页</span>`;
    if (content.type === "related") {
      bookContent += `<p>作为 <b>${escapeHtml(content.parent)}</b> 的派生词或相关词出现。</p>`;
    } else {
      bookContent += `<p>该单词已匹配雅思词汇书学习内容。</p>`;
    }
  }
  const tagContent = tagsFor(item).length ? `<div class="ielts-tag-list">${tagsFor(item).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : "";
  return `${tagContent}<div class="study-detail-list">
    <details class="study-details"><summary>查看雅思用法</summary><div class="study-content">${usageContent || '<span class="study-empty">暂无雅思用法内容</span>'}</div></details>
    <details class="study-details"><summary>查看搭配例句</summary><div class="study-content">${collocationContent || '<span class="study-empty">暂无搭配例句内容</span>'}</div></details>
    <details class="study-details"><summary>查看词汇书匹配</summary><div class="study-content">${bookContent}</div></details>
  </div>`;
}

function wrongReasonCell(state) {
  const reasons = errorReasonsFor(state);
  const reasonLabel = reasons.length > 1
    ? `常见错误原因：${reasons.join(" / ")}`
    : `错误原因：${reasons[0] || "未标记"}`;
  const primaryReason = state?.lastErrorReason || reasons[0];
  const advice = ERROR_REASON_ADVICE[primaryReason] || "建议结合中文释义、发音和例句重新完成一次独立默写。";
  return `<div class="wrong-reason-card">
    <strong>${escapeHtml(reasonLabel)}</strong>
    <p>${escapeHtml(advice)}</p>
  </div>`;
}

function renderWrongInsights() {
  const wrongWords = words.filter((item) => wordState(item.id)?.wrong > 0);
  const historyTotals = Object.fromEntries(ERROR_REASON_ADVICE && Object.keys(ERROR_REASON_ADVICE).map((reason) => [reason, 0]));
  let unmarked = 0;
  wrongWords.forEach((item) => {
    const state = wordState(item.id);
    const reasons = errorReasonsFor(state);
    if (!reasons.length) unmarked += 1;
    Object.entries(state?.errorReasons || {}).forEach(([reason, count]) => {
      if (reason in historyTotals) historyTotals[reason] += Number(count) || 0;
    });
  });
  const totalMarked = Object.values(historyTotals).reduce((sum, count) => sum + count, 0);
  els.reasonStats.innerHTML = totalMarked || unmarked
    ? [...Object.entries(historyTotals), ["未标记", unmarked]].map(([reason, count]) => `<div><span>${escapeHtml(reason)}</span><strong>${count} 个</strong></div>`).join("")
    : "<p>暂无错误原因统计。完成默写并标记错误原因后，这里会自动生成分析结果。</p>";
  els.specialTrainingGrid.innerHTML = SPECIAL_TRAINING.map(([reason, label, copy]) => {
    const count = wrongWords.filter((item) => errorReasonsFor(wordState(item.id)).includes(reason)).length;
    return `<article><strong>${escapeHtml(reason)} · ${count}</strong><p>${escapeHtml(copy)}</p><a href="index.html?source=wrong&reason=${encodeURIComponent(reason)}">${escapeHtml(label)}</a></article>`;
  }).join("");
}

function render() {
  const wrongCount = words.filter((item) => wordState(item.id)?.wrong > 0).length;
  const dueCount = words.filter((item) => isDue(wordState(item.id))).length;
  els.wrongLibraryCount.textContent = wrongCount;
  els.dueLibraryCount.textContent = dueCount;
  els.deletedLibraryCount.textContent = deletedIds.size;
  els.wrongSortField.classList.toggle("hidden", view !== "wrong");
  els.wrongReasonField.classList.toggle("hidden", view !== "wrong");
  els.wrongViewNote.classList.toggle("hidden", view !== "wrong");
  els.wrongInsights.classList.toggle("hidden", view !== "wrong");
  if (view === "wrong") renderWrongInsights();
  const filtered = results();
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  page = Math.min(page, pages);
  els.wordTableBody.innerHTML = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((item) => {
    const state = wordState(item.id);
    const wrong = state?.wrong || 0;
    return `<tr data-word-id="${item.id}" class="${item.id === highlightedWordId ? "resume-highlight" : ""}"><td><span class="word-number">#${String(item.id).padStart(4, "0")}</span></td>
      <td><button class="word-speak" data-word="${escapeHtml(item.word)}">${escapeHtml(item.word)}<span class="ui-icon icon-play" aria-hidden="true"></span></button></td>
      <td><span class="cefr-badge ${window.wordCefrLevel(item) ? `level-${window.wordCefrLevel(item).toLowerCase()}` : "level-unmarked"}" title="剑桥词典不同释义可能对应多个 CEFR 等级">${window.wordCefrLabel(item)}</span></td>
      <td>${escapeHtml(item.meaning).replace(/\n/g, "<br>")}</td>
      <td>${escapeHtml(window.ieltsPointsFor(item, study[item.id]).pos)}</td>
      <td>${view === "wrong" ? wrongReasonCell(state) : ""}${studyCell(item)}</td>
      <td><span class="table-stage proficiency-${proficiencyLabel(state)} ${state?.mastered ? "mastered" : ""}">${proficiencyLabel(state)}<small>${stageLabel(state)}</small></span></td>
      <td><span class="${wrong ? "wrong-count" : "zero-count"}">${wrong}</span></td>
      <td>${state?.nextReview ? relativeTime(state.nextReview) : "—"}</td>
      <td><a class="dictionary-link compact" href="https://dictionary.cambridge.org/dictionary/english-chinese-simplified/${encodeURIComponent(item.word)}" target="_blank" rel="noopener noreferrer"><span>英汉简体</span><i class="ui-icon icon-external" aria-hidden="true"></i></a></td>
      <td>${view === "deleted"
        ? `<button class="restore-word-button" type="button" data-restore-word="${item.id}">恢复显示</button>`
        : `<button class="tag-word-button" type="button" data-tag-word="${item.id}">添加标签</button><button class="delete-word-button" type="button" data-delete-word="${item.id}">删除单词</button>`}</td></tr>`;
  }).join("");
  filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).slice(0, 8).forEach((item) => window.prepareHumanPronunciation?.(item.word));
  els.libraryEmpty.classList.toggle("hidden", filtered.length > 0);
  if (!filtered.length) {
    els.libraryEmpty.innerHTML = view === "wrong"
      ? "<strong>目前没有错词</strong><span>继续保持，也可以开始学习一组新词。</span>"
      : view === "due"
        ? "<strong>今天没有到期复习任务</strong><span>你可以选择学习新词，或复盘之前的错词。</span>"
        : view === "deleted"
          ? "<strong>没有已隐藏单词</strong><span>当前词库中的单词均正常显示。</span>"
          : els.librarySearch.value.trim()
            ? "<strong>没有搜索结果</strong><span>没有找到符合条件的单词。请尝试更换关键词，或检查筛选条件。</span>"
            : "<strong>你的词库里还没有单词</strong><span>先添加一批雅思高频词，开始第一组默写吧。</span>";
  }
  els.librarySummary.textContent = view === "all"
    ? `找到 ${filtered.length} 个单词`
    : view === "due"
      ? `找到 ${filtered.length} 个到期复习单词，按到期时间排序`
      : view === "deleted"
        ? `找到 ${filtered.length} 个已隐藏单词；学习记录仍然保留`
      : `找到 ${filtered.length} 个默写错误单词${els.wrongReasonFilter.value === "all" ? "" : ` · 筛选：${els.wrongReasonFilter.options[els.wrongReasonFilter.selectedIndex].text}`}`;
  els.libraryPage.textContent = `第 ${page} / ${pages} 页`;
  els.libraryJumpPage.max = pages;
  els.libraryJumpPage.value = page;
  els.libraryPrev.disabled = page <= 1;
  els.libraryNext.disabled = page >= pages;
}

function jumpToPage() {
  const pages = Math.max(1, Math.ceil(results().length / PAGE_SIZE));
  page = Math.max(1, Math.min(Number(els.libraryJumpPage.value) || 1, pages));
  highlightedWordId = null;
  render();
  els.libraryCenter.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resumeLastWord() {
  const candidates = words
    .filter((item) => wordState(item.id)?.lastAttempt && matchesView(item))
    .sort((a, b) => wordState(b.id).lastAttempt - wordState(a.id).lastAttempt);
  const lastWord = candidates[0];
  if (!lastWord) {
    els.resumeWord.classList.add("no-history");
    els.resumeWord.querySelector("b").textContent = "暂无学习记录";
    window.setTimeout(() => {
      els.resumeWord.classList.remove("no-history");
      els.resumeWord.querySelector("b").textContent = "跳至上次学习";
    }, 1800);
    return;
  }
  els.librarySearch.value = "";
  els.libraryStart.value = 1;
  els.libraryEnd.value = Math.max(...allWords.map((item) => item.id));
  const filtered = results();
  const index = filtered.findIndex((item) => item.id === lastWord.id);
  page = Math.floor(index / PAGE_SIZE) + 1;
  highlightedWordId = lastWord.id;
  render();
  requestAnimationFrame(() => {
    document.querySelector(`[data-word-id="${lastWord.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function speak(word, button = null) {
  window.playHumanPronunciation(word, button);
}

function enhanceNumberInputs(inputs) {
  inputs.forEach((input) => {
    input.dataset.defaultValue = input.value;
    input.classList.add("number-input");
    input.addEventListener("focus", () => {
      input.dataset.replaceReady = "true";
      requestAnimationFrame(() => input.select());
    });
    input.addEventListener("beforeinput", (event) => {
      if (input.dataset.replaceReady === "true" && event.inputType.startsWith("insert")) {
        input.value = "";
        input.dataset.replaceReady = "false";
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
        return;
      }
      if (input.dataset.replaceReady === "true" && (event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        input.value = "";
        input.dataset.replaceReady = "false";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    input.addEventListener("click", () => {
      if (input.dataset.replaceReady === "true") input.select();
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

document.querySelectorAll(".library-tab").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".library-tab").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  view = button.dataset.libraryView;
  page = 1;
  render();
}));
[els.librarySearch, els.libraryStart, els.libraryEnd].forEach((input) => input.addEventListener("input", () => { page = 1; render(); }));
enhanceNumberInputs([els.libraryStart, els.libraryEnd, els.libraryJumpPage]);
els.wrongSort.addEventListener("change", () => { page = 1; render(); });
els.wrongReasonFilter.addEventListener("change", () => { page = 1; render(); });
els.proficiencyFilter.addEventListener("change", () => { page = 1; render(); });
els.tagFilter.addEventListener("change", () => { page = 1; render(); });
els.libraryPrev.addEventListener("click", () => { page -= 1; render(); });
els.libraryNext.addEventListener("click", () => { page += 1; render(); });
els.libraryJumpButton.addEventListener("click", jumpToPage);
els.libraryJumpPage.addEventListener("keydown", (event) => {
  if (event.key === "Enter") jumpToPage();
});
els.resumeWord.addEventListener("click", resumeLastWord);
els.exportNewWords.addEventListener("click", exportNewWords);
els.exportLibrary.addEventListener("click", exportLibrary);
els.importLibrary.addEventListener("click", () => els.importLibraryFile.click());
els.importLibraryFile.addEventListener("change", importLibraryFile);
els.downloadImportTemplate.addEventListener("click", downloadImportTemplate);
els.openBulkPaste.addEventListener("click", openBulkPasteDialog);
els.clearLibraryFilters.addEventListener("click", clearLibraryFilters);
els.openAddWord.addEventListener("click", openAddWordDialog);
els.cancelAddWord.addEventListener("click", closeAddWordDialog);
els.addWordForm.addEventListener("submit", addCustomWord);
els.addWordDialog.addEventListener("click", (event) => {
  if (event.target === els.addWordDialog) closeAddWordDialog();
});
els.cancelBulkPaste.addEventListener("click", closeBulkPasteDialog);
els.bulkPasteForm.addEventListener("submit", importBulkPaste);
els.bulkPasteDialog.addEventListener("click", (event) => {
  if (event.target === els.bulkPasteDialog) closeBulkPasteDialog();
});
els.wordTableBody.addEventListener("click", (event) => {
  const restoreButton = event.target.closest("[data-restore-word]");
  if (restoreButton) {
    restoreWord(Number(restoreButton.dataset.restoreWord));
    return;
  }
  const deleteButton = event.target.closest("[data-delete-word]");
  if (deleteButton) {
    deleteWord(Number(deleteButton.dataset.deleteWord));
    return;
  }
  const tagButton = event.target.closest("[data-tag-word]");
  if (tagButton) {
    editWordTags(Number(tagButton.dataset.tagWord));
    return;
  }
  const studyButton = event.target.closest("[data-speak-text]");
  if (studyButton) {
    speak(studyButton.dataset.speakText, studyButton);
    return;
  }
  const wordButton = event.target.closest(".word-speak");
  if (wordButton) speak(wordButton.dataset.word, wordButton);
});
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) progress = loadProgress();
  else if (event.key === DELETED_WORDS_KEY) {
    deletedIds = loadDeletedIds();
    words = availableWords();
  } else if (event.key === CUSTOM_WORDS_KEY) {
    customWords = loadCustomWords();
    allWords = combinedWords();
    words = availableWords();
    els.libraryEnd.max = Math.max(...allWords.map((item) => item.id));
  } else if (event.key === WORD_TAGS_KEY) {
    wordTags = loadWordTags();
  } else return;
  render();
});
els.libraryEnd.max = Math.max(...allWords.map((item) => item.id));
els.libraryEnd.value = els.libraryEnd.max;
IELTS_TAGS.forEach((tag) => {
  const option = document.createElement("option");
  option.value = tag;
  option.textContent = tag;
  els.tagFilter.appendChild(option);
});
document.querySelectorAll(".library-tab").forEach((button) => button.classList.toggle("active", button.dataset.libraryView === view));
render();

window.setInterval(render, 60e3);
