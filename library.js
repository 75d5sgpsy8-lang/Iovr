const els = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const STORAGE_KEY = "wordloom-progress-v1";
const ACTIVE_SESSION_KEY = "wordloom-active-session-v1";
const DELETED_WORDS_KEY = "wordloom-deleted-words-v1";
const CUSTOM_WORDS_KEY = "wordloom-custom-words-v1";
const STAGE_NAMES = ["10 分钟巩固", "1 天复习", "3 天复习", "7 天复习", "14 天复习", "30 天复习", "60 天复习"];
const PAGE_SIZE = 20;
const baseWords = window.WORDS || [];
let customWords = loadCustomWords();
let allWords = combinedWords();
const study = window.WORD_STUDY || {};
let progress = loadProgress();
let deletedIds = loadDeletedIds();
let words = availableWords();
let view = "all";
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
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `wordloom-new-words-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  els.librarySummary.textContent = `已导出 ${newWords.length} 个尚未学习的新单词。`;
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

function openAddWordDialog() {
  els.addWordForm.reset();
  els.addWordMessage.textContent = "";
  els.addWordDialog.showModal();
  els.newWordText.focus();
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
  const item = { id, page: null, word, meaning, custom: true };
  if (els.newWordCefr.value) item.cefr = els.newWordCefr.value;
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

function stageLabel(state) {
  if (!state) return "首次学习";
  if (state.mastered) return "长期掌握";
  if (state.assistedReview) return "读音辅助 · 10 分钟巩固";
  if (state.relearning) return state.nextReview > Date.now() ? "错词重学 · 10 分钟" : "错词回炉 · 待重答";
  if (state.recovery) return "错词重学 · 10 分钟";
  if (state.stage < 0) return "首次学习";
  return `第 ${state.stage + 2}/8 次 · ${STAGE_NAMES[state.stage]}`;
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
    const matchesQuery = !query || item.word.toLowerCase().includes(query) || item.meaning.toLowerCase().includes(query) || studyText.includes(query) || String(item.id) === query;
    return item.id >= start && item.id <= end && matchesQuery && matchesView(item);
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

function studyCell(item) {
  const content = study[item.id];
  const point = window.ieltsPointsFor(item, content);
  const examPoint = `<div class="ielts-point-summary"><b>${escapeHtml(point.topic)}</b><span>${escapeHtml(point.examUse)}</span><small>${escapeHtml(point.caution)}</small></div>`;
  if (!content) return `${examPoint}<span class="study-empty">暂无雅思词汇书匹配内容</span>`;
  if (content.type === "related") {
    return `<details class="study-details"><summary>查看考点与关联内容</summary><div class="study-content">
      ${examPoint}<span class="study-source">雅思词汇书第 ${content.pdfPage} 页</span>
      <p>作为 <b>${escapeHtml(content.parent)}</b> 的派生词或相关词出现。</p>
      <button type="button" class="study-speak-button" data-speak-text="${escapeHtml(content.parent)}"><span>♪</span>朗读关联词</button>
    </div></details>`;
  }
  const examples = content.examples.length
    ? `<div class="study-block"><b>例句</b>${content.examples.map((example) => `<div class="study-example"><p>${escapeHtml(example)}</p></div>`).join("")}</div>`
    : '<div class="study-block"><b>例句</b><p>该词条未提取到清晰英文例句。</p></div>';
  const related = content.related.length
    ? `<div class="study-related"><b>派生／相关词</b><div class="answer-study-related">${content.related.map((word) => `<button type="button" class="study-related-word" data-speak-text="${escapeHtml(word)}">${escapeHtml(word)}<span>♪</span></button>`).join("")}</div></div>`
    : "";
  return `<details class="study-details"><summary>查看雅思考点与例句</summary><div class="study-content">
    ${examPoint}<span class="study-source">雅思词汇书第 ${content.pdfPage} 页</span><button type="button" class="study-speak-button" data-speak-text="${escapeHtml(item.word)}"><span>♪</span>朗读单词</button>${examples}${related}
  </div></details>`;
}

function render() {
  const wrongCount = words.filter((item) => wordState(item.id)?.wrong > 0).length;
  const dueCount = words.filter((item) => isDue(wordState(item.id))).length;
  els.wrongLibraryCount.textContent = wrongCount;
  els.dueLibraryCount.textContent = dueCount;
  els.deletedLibraryCount.textContent = deletedIds.size;
  els.wrongSortField.classList.toggle("hidden", view !== "wrong");
  const filtered = results();
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  page = Math.min(page, pages);
  els.wordTableBody.innerHTML = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((item) => {
    const state = wordState(item.id);
    const wrong = state?.wrong || 0;
    return `<tr data-word-id="${item.id}" class="${item.id === highlightedWordId ? "resume-highlight" : ""}"><td><span class="word-number">#${String(item.id).padStart(4, "0")}</span></td>
      <td><button class="word-speak" data-word="${escapeHtml(item.word)}">${escapeHtml(item.word)}<span>♪</span></button></td>
      <td><span class="cefr-badge ${window.wordCefrLevel(item) ? `level-${window.wordCefrLevel(item).toLowerCase()}` : "level-unmarked"}" title="剑桥词典不同释义可能对应多个 CEFR 等级">${window.wordCefrLabel(item)}</span></td>
      <td>${escapeHtml(item.meaning).replace(/\n/g, "<br>")}</td>
      <td>${studyCell(item)}</td>
      <td><span class="table-stage ${state?.mastered ? "mastered" : ""}">${stageLabel(state)}</span></td>
      <td><span class="${wrong ? "wrong-count" : "zero-count"}">${wrong}</span></td>
      <td><a class="dictionary-link compact" href="https://dictionary.cambridge.org/dictionary/english-chinese-simplified/${encodeURIComponent(item.word)}" target="_blank" rel="noopener noreferrer">英汉简体 ↗</a></td>
      <td>${view === "deleted"
        ? `<button class="restore-word-button" type="button" data-restore-word="${item.id}">恢复显示</button>`
        : `<button class="delete-word-button" type="button" data-delete-word="${item.id}">删除单词</button>`}</td></tr>`;
  }).join("");
  filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).slice(0, 8).forEach((item) => window.prepareHumanPronunciation?.(item.word));
  els.libraryEmpty.classList.toggle("hidden", filtered.length > 0);
  els.librarySummary.textContent = view === "all"
    ? `找到 ${filtered.length} 个单词`
    : view === "due"
      ? `找到 ${filtered.length} 个到期复习单词，按到期时间排序`
      : view === "deleted"
        ? `找到 ${filtered.length} 个已隐藏单词；学习记录仍然保留`
      : `找到 ${filtered.length} 个默写错误单词`;
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
  els.libraryEnd.value = words.length;
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
els.libraryPrev.addEventListener("click", () => { page -= 1; render(); });
els.libraryNext.addEventListener("click", () => { page += 1; render(); });
els.libraryJumpButton.addEventListener("click", jumpToPage);
els.libraryJumpPage.addEventListener("keydown", (event) => {
  if (event.key === "Enter") jumpToPage();
});
els.resumeWord.addEventListener("click", resumeLastWord);
els.exportNewWords.addEventListener("click", exportNewWords);
els.openAddWord.addEventListener("click", openAddWordDialog);
els.cancelAddWord.addEventListener("click", closeAddWordDialog);
els.addWordForm.addEventListener("submit", addCustomWord);
els.addWordDialog.addEventListener("click", (event) => {
  if (event.target === els.addWordDialog) closeAddWordDialog();
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
  } else return;
  render();
});
els.libraryEnd.max = Math.max(...allWords.map((item) => item.id));
els.libraryEnd.value = els.libraryEnd.max;
render();

window.setInterval(render, 60e3);
