(() => {
  const KEYS = {
    progress: "wordloom-progress-v1",
    deleted: "wordloom-deleted-words-v1",
    custom: "wordloom-custom-words-v1",
    tags: "wordloom-word-tags-v1",
  };
  const META_KEY = "wordloom-cloud-meta-v1";
  const entry = document.currentScript?.dataset.entry;
  const config = window.WORDLOOM_SUPABASE || {};
  let applying = false;
  let inFlight = null;

  function configured() {
    return /^https:\/\/.+\.supabase\.co$/i.test(config.url || "")
      && String(config.anonKey || "").length > 40
      && String(config.syncId || "").length >= 16;
  }

  function status(state, message) {
    document.documentElement.dataset.sync = state;
    let indicator = document.querySelector(".sync-status");
    if (!indicator) {
      indicator = document.createElement("button");
      indicator.type = "button";
      indicator.className = "sync-status";
      indicator.addEventListener("click", () => syncNow());
      document.body.appendChild(indicator);
    }
    indicator.textContent = message;
    indicator.title = state === "online" ? "点击立即同步" : "请检查 Supabase 云同步配置";
  }

  function read(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function meta() {
    return read(META_KEY, {});
  }

  function markChanged(key) {
    const value = meta();
    value[key] = Date.now();
    localStorage.setItem(META_KEY, JSON.stringify(value));
  }

  function mergeProgress(local, cloud) {
    const result = { ...(cloud || {}), ...(local || {}) };
    const words = { ...(cloud?.words || {}) };
    for (const [id, state] of Object.entries(local?.words || {})) {
      const existing = words[id];
      if (!existing || (state?.lastAttempt || 0) >= (existing?.lastAttempt || 0)) words[id] = state;
    }
    const sessions = [];
    const seen = new Set();
    for (const session of [...(cloud?.sessions || []), ...(local?.sessions || [])]) {
      const marker = JSON.stringify(session);
      if (!seen.has(marker)) {
        seen.add(marker);
        sessions.push(session);
      }
    }
    result.words = words;
    result.sessions = sessions.slice(-500);
    return result;
  }

  function mergeCustom(local, cloud) {
    const merged = new Map();
    for (const item of [...(cloud || []), ...(local || [])]) {
      if (item?.word) merged.set(item.word.trim().toLowerCase(), item);
    }
    return [...merged.values()].sort((a, b) => a.id - b.id);
  }

  function localPayload() {
    return {
      progress: read(KEYS.progress, null),
      deleted: read(KEYS.deleted, null),
      custom: read(KEYS.custom, null),
      tags: read(KEYS.tags, null),
      meta: meta(),
    };
  }

  function mergePayload(local, cloud) {
    const cloudMeta = cloud?.meta || {};
    const localMeta = local?.meta || {};
    const localProgressTime = localMeta.progress || 0;
    const cloudProgressTime = cloudMeta.progress || 0;
    const progress = local?.progress == null && localProgressTime > cloudProgressTime
      ? null
      : cloud?.progress == null && cloudProgressTime > localProgressTime
        ? null
        : mergeProgress(local?.progress, cloud?.progress);
    const deleted = local?.deleted == null
      ? cloud?.deleted
      : cloud?.deleted == null
        ? local.deleted
        : (localMeta.deleted || 0) >= (cloudMeta.deleted || 0) ? local.deleted : cloud.deleted;
    return {
      progress,
      deleted,
      custom: mergeCustom(local?.custom, cloud?.custom),
      tags: { ...(cloud?.tags || {}), ...(local?.tags || {}) },
      meta: {
        progress: Math.max(localMeta.progress || 0, cloudMeta.progress || 0),
        deleted: Math.max(localMeta.deleted || 0, cloudMeta.deleted || 0),
        custom: Math.max(localMeta.custom || 0, cloudMeta.custom || 0),
        tags: Math.max(localMeta.tags || 0, cloudMeta.tags || 0),
      },
    };
  }

  function apply(payload) {
    applying = true;
    for (const [name, key] of Object.entries(KEYS)) {
      const value = payload?.[name];
      const previous = localStorage.getItem(key);
      const next = value == null ? null : JSON.stringify(value);
      if (previous !== next) {
        if (next == null) localStorage.removeItem(key);
        else localStorage.setItem(key, next);
        window.dispatchEvent(new StorageEvent("storage", { key, oldValue: previous, newValue: next }));
      }
    }
    localStorage.setItem(META_KEY, JSON.stringify(payload?.meta || {}));
    applying = false;
  }

  function headers(extra = {}) {
    const result = {
      apikey: config.anonKey,
      "x-sync-id": config.syncId,
      "Content-Type": "application/json",
      ...extra,
    };
    if (!String(config.anonKey).startsWith("sb_publishable_")) {
      result.Authorization = `Bearer ${config.anonKey}`;
    }
    return result;
  }

  async function cloudRead() {
    const url = `${config.url}/rest/v1/wordloom_sync?sync_id=eq.${encodeURIComponent(config.syncId)}&select=data`;
    const response = await fetch(url, { headers: headers() });
    if (!response.ok) throw new Error(`Supabase HTTP ${response.status}`);
    return (await response.json())[0]?.data || {};
  }

  async function cloudWrite(data) {
    const response = await fetch(`${config.url}/rest/v1/wordloom_sync`, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ sync_id: config.syncId, data, updated_at: new Date().toISOString() }),
    });
    if (!response.ok) throw new Error(`Supabase HTTP ${response.status}`);
  }

  async function syncNow() {
    if (!configured()) {
      status("offline", "云端同步未配置");
      return;
    }
    if (inFlight) return inFlight;
    status("syncing", "正在同步学习记录…");
    inFlight = (async () => {
      const merged = mergePayload(localPayload(), await cloudRead());
      await cloudWrite(merged);
      apply(merged);
      status("online", "同步成功，已保存最新进度 · 已同步到云端");
    })().catch(() => {
      status("offline", "同步失败，请检查网络后重试");
    }).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function save(key) {
    if (applying) return;
    const name = Object.entries(KEYS).find(([, value]) => value === key)?.[0];
    if (name) markChanged(name);
    syncNow();
  }

  window.wordloomSyncSave = save;
  window.wordloomSyncNow = syncNow;
  window.wordloomSyncReady = syncNow();

  Promise.resolve(window.wordloomSyncReady).finally(() => {
    if (entry) {
      const script = document.createElement("script");
      script.src = entry;
      document.body.appendChild(script);
    }
    window.setInterval(syncNow, 10000);
    window.addEventListener("focus", syncNow);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) syncNow();
    });
  });
})();
