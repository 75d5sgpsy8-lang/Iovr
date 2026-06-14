(() => {
  const API = "https://commons.wikimedia.org/w/api.php";
  const CACHE_KEY = "wordloom-human-pronunciation-v4";
  const MISS_RETRY_MS = 24 * 60 * 60 * 1000;
  const cache = loadCache();
  let currentAudio = null;

  function loadCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {}
  }

  function secureUrl(url) {
    if (!url) return url;
    if (url.startsWith("//")) return `https:${url}`;
    return url.replace(/^http:/, "https:");
  }

  function isSingleWord(text) {
    return /^[a-z]+(?:[-'][a-z]+)*$/i.test(text.trim());
  }

  function mediaInfo(page) {
    return page.videoinfo?.[0] || {};
  }

  function candidateScore(page, word) {
    const title = page.title.replace(/^File:/, "").replace(/\.(?:wav|ogg|oga|mp3|flac)$/i, "");
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const info = mediaInfo(page);
    const categories = info.extmetadata?.Categories?.value || "";
    const license = info.extmetadata?.LicenseShortName?.value || "";
    if (!/CC0|public domain|CC BY/i.test(license) || !/English|pronunciation-eng/i.test(categories)) return -1;
    const licenseBonus = /CC0|public domain/i.test(license) ? 10 : 0;
    if (new RegExp(`^En-(?:uk|gb)-${escaped}$`, "i").test(title)) return 100 + licenseBonus;
    if (new RegExp(`^LL-Q1860 \\(eng\\)-.+-${escaped}$`, "i").test(title)) return 90 + licenseBonus;
    if (new RegExp(`^En-${escaped}$`, "i").test(title)) return 80 + licenseBonus;
    if (new RegExp(`^En-us-${escaped}$`, "i").test(title)) return 70 + licenseBonus;
    return -1;
  }

  async function findRecording(word) {
    const key = word.toLowerCase();
    if (cache[key]?.recording) return cache[key].recording;
    if (cache[key]?.missingAt && Date.now() - cache[key].missingAt < MISS_RETRY_MS) return null;
    const params = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: `intitle:${word} filetype:audio`,
      gsrnamespace: "6",
      gsrlimit: "20",
      prop: "videoinfo",
      viprop: "url|derivatives|extmetadata",
      format: "json",
      origin: "*",
    });
    const response = await fetch(`${API}?${params}`);
    if (!response.ok) throw new Error(`Wikimedia HTTP ${response.status}`);
    const pages = Object.values((await response.json()).query?.pages || {});
    const chosen = pages
      .map((page) => ({ page, score: candidateScore(page, key) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)[0]?.page;
    const info = chosen ? mediaInfo(chosen) : null;
    const mp3 = info?.derivatives?.find((item) => item.type === "audio/mpeg");
    const recording = chosen ? {
      url: secureUrl(mp3?.src || info.url),
      source: info.descriptionurl,
      title: chosen.title,
      license: info.extmetadata?.LicenseShortName?.value || "免费许可",
      artist: String(info.extmetadata?.Artist?.value || "Wikimedia Commons").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    } : null;
    cache[key] = recording ? { recording } : { missingAt: Date.now() };
    saveCache();
    return recording;
  }

  function setButtonState(button, text, state = "ready") {
    if (!button) return;
    button.title = text;
    button.setAttribute("aria-label", text);
    button.classList.toggle("pronunciation-missing", state === "missing");
    button.classList.toggle("pronunciation-ready", state === "prepared");
    const icon = button.matches(".sound-button") ? button : button.querySelector("span");
    if (icon) icon.textContent = state === "loading" ? "…" : state === "prepared" ? "▶" : "♪";
  }

  function playRecording(recording, button) {
    currentAudio?.pause();
    currentAudio = new Audio();
    currentAudio.preload = "auto";
    currentAudio.setAttribute("playsinline", "");
    currentAudio.src = secureUrl(recording.url);
    const playback = currentAudio.play();
    playback?.then(() => {
      setButtonState(button, `真人录音：${recording.title} · ${recording.artist} · ${recording.license} · 来源 Wikimedia Commons`);
    }).catch((error) => {
      if (error?.name === "NotAllowedError") {
        setButtonState(button, "录音已准备，请再次点击播放", "prepared");
      } else {
        setButtonState(button, "真人录音播放失败，请再次点击", "prepared");
      }
    });
    return playback;
  }

  async function playHumanPronunciation(text, button = null) {
    const word = String(text || "").trim();
    if (!isSingleWord(word)) {
      setButtonState(button, "完整句子暂无真人录音", "missing");
      return false;
    }
    const cachedRecording = cache[word.toLowerCase()]?.recording;
    if (cachedRecording) {
      playRecording(cachedRecording, button);
      return true;
    }

    setButtonState(button, "正在准备真人录音，请稍候…", "loading");
    try {
      const recording = await findRecording(word);
      if (!recording) {
        setButtonState(button, "暂无免费真人录音", "missing");
        return false;
      }
      // iPad Safari may revoke user activation while the recording is fetched.
      // Mark it ready so the next tap starts playback synchronously from cache.
      setButtonState(button, "真人录音已准备，请再次点击播放", "prepared");
      return false;
    } catch {
      setButtonState(button, "真人录音加载失败，请检查网络", "missing");
      return false;
    }
  }

  window.playHumanPronunciation = playHumanPronunciation;
  window.prepareHumanPronunciation = (word) => isSingleWord(String(word || ""))
    ? findRecording(String(word).trim()).then((recording) => {
      if (recording) recording.url = secureUrl(recording.url);
      return recording;
    }).catch(() => null)
    : Promise.resolve(null);
  window.stopHumanPronunciation = () => currentAudio?.pause();
})();
