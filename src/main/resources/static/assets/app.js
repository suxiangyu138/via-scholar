'use strict';

/* =========================================================
   问道 Via Scholar · 前端应用
   DeepSeek 单厂商：动态模型、账户余额、流式回答与用量指标
   ========================================================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';
const FALLBACK_MODELS = [
  { id: 'deepseek-flash', name: 'DeepSeek-Flash', contextWindow: 1048576,
    inputModalities: ['text', 'image'] },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1048576,
    inputModalities: ['text'] }
];

const MAX_ATTACHMENTS = 50;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 25 * 1024 * 1024;
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const TEXT_EXT = new Set(['pdf', 'txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm', 'tex', 'log']);

const LS = {
  config: 'deepseekConfigV2',
  session: 'currentDbSessionId',
  errorBook: 'mathErrorBook'
};

const AVATAR_SVG = '<img src="/assets/brand-mark-black.png" alt="">';
const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const BOOKMARK_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M6 4h12v17l-6-4-6 4V4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

const state = {
  config: null,
  draft: null,
  modelOptions: FALLBACK_MODELS.slice(),
  modelsLoaded: false,
  dbSessionId: null,
  loading: false,
  abort: null,
  currentAi: null,
  lastQuestion: '',
  lastAnswer: '',
  errorBook: [],
  savedIndex: -1,
  balanceLoading: false,
  attachments: [],
  uploading: false,
  attachSeq: 0,
  sentPreviews: [],
  toastTimer: null
};

/* ---------------- 基础工具 ---------------- */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ESCAPE_MAP[ch]);
}

function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ---------------- Markdown / KaTeX / XSS ---------------- */

function setupMarked() {
  if (!window.marked) return;
  window.marked.use({
    breaks: true,
    gfm: true,
    renderer: {
      code({ text, lang }) {
        const code = text == null ? '' : String(text);
        const language = (lang || '').trim().split(/\s+/)[0];
        let body = escapeHtml(code);
        if (window.hljs && language && window.hljs.getLanguage(language)) {
          try {
            body = window.hljs.highlight(code, { language, ignoreIllegals: true }).value;
          } catch (_) { /* 保持转义文本 */ }
        }
        return '<pre><code class="hljs">' + body + '</code></pre>';
      }
    }
  });
}

function sanitizeHtml(html) {
  if (!window.DOMPurify) return escapeHtml(html);
  try {
    return window.DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, mathMl: true, svg: true }
    });
  } catch (_) {
    return escapeHtml(html);
  }
}

function cleanLeakedHtml(text) {
  text = text.replace(/<span[^>]*class="katex[^"]*"[^>]*>/g, '');
  text = text.replace(/<\/span>/g, '');
  text = text.replace(/<math[^>]*>/g, '');
  text = text.replace(/<\/math>/g, '');
  text = text.replace(/<semantics>[^<]*<\/semantics>/g, '');
  text = text.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, '');
  text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return text;
}

function cleanLatexText(raw) {
  let text = raw;
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, function (m, inner) {
    let cleaned = inner.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '');
    if (!/\\\\/.test(cleaned) && !/\\begin/.test(cleaned)) {
      cleaned = cleaned.replace(/\n+/g, ' ');
    }
    return '$$' + cleaned + '$$';
  });
  text = text.replace(/[\u200b\u200c\u200d\u200e\u200f\ufeff]/g, '');
  text = text.replace(/\b(a|b|c|x|y|z|S|P|A|B|C|t|r)\s+(\d+)\b/g, '$1_$2');
  text = text.replace(/\b(a|b|c|x|y|z|S|P|A|B|C|t|r)\s+(n)(\W|$)/g, '$1_n$3');
  text = text.replace(/\u3000/g, ' ');
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$');
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, '$$1$');
  return text;
}

function autoWrapBareLatex(text) {
  text = text.replace(/(\\(?:frac|sqrt|sum|int|lim|infty|pm|mp|times|div|cdot|leq|geq|neq|approx|equiv|sim|partial|nabla|forall|exists|in|notin|subset|subseteq|cup|cap|angle|triangle|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|omega|mathbf|mathbb|mathcal|bar|hat|vec|dot|widetilde|widehat|overline|underline|operatorname|text|begin|end|left|right)\b[^\n$<>]*)/g,
    function (m) {
      if (/<span|<div|class="katex/.test(m)) return m;
      try {
        return window.katex.renderToString(m.trim(), {
          displayMode: false, throwOnError: false, trust: true, strict: false
        });
      } catch (_) { return m; }
    });
  text = text.replace(/([a-zA-Z]\\?'{1,2}\([^)]*\)(?:\s*=\s*[^\n$<>]+)?)/g, function (m) {
    if (/<span|<div|class="katex/.test(m)) return m;
    try {
      return window.katex.renderToString(m.trim(), {
        displayMode: false, throwOnError: false, trust: true, strict: false
      });
    } catch (_) { return m; }
  });
  return text;
}

function renderLatex(rawText, isFinal) {
  let text = String(rawText == null ? '' : rawText);
  if (!window.katex) return text;
  text = cleanLeakedHtml(text);
  text = cleanLatexText(text);

  text = text.replace(/(?<!\$)\$([^\$\n]+?)\$(?!\$)/g, function (m, formula) {
    try {
      return window.katex.renderToString(formula.trim(), {
        displayMode: false, throwOnError: false, trust: true, strict: false
      });
    } catch (_) { return m; }
  });

  text = text.replace(/\$\$([\s\S]*?)\$\$/g, function (m, formula) {
    const inner = formula.trim();
    const display = /\n/.test(inner) || inner.length >= 80;
    try {
      return window.katex.renderToString(inner, {
        displayMode: display, throwOnError: false, trust: true, strict: false
      });
    } catch (_) { return m; }
  });

  if (!isFinal) {
    const open = text.indexOf('$$');
    if (open >= 0 && text.indexOf('$$', open + 2) < 0) {
      text = text.substring(0, open) + '<span class="katex-pending">$$</span>';
    }
  } else {
    text = autoWrapBareLatex(text);
    text = text.replace(/\$\$/g, '');
  }
  return text;
}

function renderMarkdown(rawText, isFinal) {
  const text = String(rawText == null ? '' : rawText);
  if (!window.marked) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
  try {
    const html = window.marked.parse(renderLatex(text, !!isFinal));
    return sanitizeHtml(html);
  } catch (_) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
}

/* ---------------- 配置与余额 ---------------- */

function readLegacyConfig() {
  try {
    const direct = JSON.parse(localStorage.getItem(LS.config) || 'null');
    if (direct && typeof direct === 'object') return direct;
  } catch (_) { /* 忽略 */ }
  try {
    const old = JSON.parse(localStorage.getItem('modelConfigs') || '{}');
    if (old && old.deepseek) return old.deepseek;
  } catch (_) { /* 忽略 */ }
  try {
    const old2 = JSON.parse(localStorage.getItem('modelConfigsV2') || '{}');
    if (old2 && old2.deepseek) return old2.deepseek;
  } catch (_) { /* 忽略 */ }
  return null;
}

function migrateModelName(name) {
  const legacy = {
    'deepseek-chat': 'deepseek-flash',
    'deepseek-v3.2': 'deepseek-flash',
    'deepseek-v4-flash': 'deepseek-flash',
    'deepseek-v4-flash-vision-exp': 'deepseek-flash',
    'deepseek-r1': 'deepseek-v4-pro',
    'deepseek-reasoner': 'deepseek-v4-pro'
  };
  return legacy[name] || name || FALLBACK_MODELS[0].id;
}

function initConfig() {
  const saved = readLegacyConfig() || {};
  state.config = {
    modelName: migrateModelName(saved.modelName),
    apiKey: saved.apiKey || '',
    baseUrl: saved.baseUrl || DEEPSEEK_BASE,
    temperature: 0.3,
    maxTokens: 8192
  };
  state.modelOptions = FALLBACK_MODELS.slice();
  state.modelsLoaded = false;
  updateModelLabels();
}

function persistConfig() {
  if (!state.config) return;
  try {
    localStorage.setItem(LS.config, JSON.stringify(state.config));
  } catch (_) { /* 隐私模式忽略 */ }
}

function modelDisplayName(id) {
  const found = state.modelOptions.find(m => m.id === id);
  const raw = (found && found.name) || id || '未选择模型';
  return raw.replace(/^deepseek[-_\s]*/i, '') || raw;
}

function updateModelLabels() {
  const cfg = state.config;
  const model = cfg && cfg.modelName ? modelDisplayName(cfg.modelName) : '未选择模型';
  const label = 'DeepSeek · ' + model;
  const configured = !!(cfg && cfg.apiKey);

  const chipText = $('#model-chip-text');
  const chipDot = $('#model-chip-dot');
  const sideLabel = $('#sidebar-model-label');
  const sideDot = $('#sidebar-model-dot');

  if (chipText) {
    chipText.textContent = label;
    chipText.title = label;
  }
  if (sideLabel) {
    sideLabel.textContent = model;
    sideLabel.title = label;
  }
  if (chipDot) chipDot.classList.toggle('on', configured);
  if (sideDot) sideDot.classList.toggle('on', configured);
}

function setBalanceText(text, title) {
  const value = $('#balance-value');
  const chip = $('#balance-chip');
  if (value) value.textContent = text;
  if (chip) chip.title = title || ('账户余额 ' + text + '（点击刷新）');
}

async function refreshBalance(force) {
  if (!state.config || !state.config.apiKey) {
    setBalanceText('--', '先配置 API Key');
    $('#balance-chip').classList.remove('low');
    return;
  }
  if (state.balanceLoading) return;
  state.balanceLoading = true;
  const chip = $('#balance-chip');
  chip.classList.add('loading');

  try {
    const res = await fetch('/api/deepseek/balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: state.config.apiKey, baseUrl: state.config.baseUrl })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || ('HTTP ' + res.status));
    }
    const infos = Array.isArray(data.balances) ? data.balances : [];
    if (!infos.length) {
      setBalanceText('--', '账户未返回余额');
      return;
    }
    const info = infos.find(b => b.currency === 'CNY') || infos[0];
    const symbol = info.currency === 'CNY' ? '¥' : (info.currency === 'USD' ? '$' : (info.currency + ' '));
    const total = info.totalBalance == null ? '0' : String(info.totalBalance);
    const low = Number(total) < 1 || data.isAvailable === false;
    chip.classList.toggle('low', low);
    setBalanceText(symbol + total,
      '余额 ' + symbol + total
      + ' · 赠送 ' + symbol + (info.grantedBalance || '0')
      + ' · 充值 ' + symbol + (info.toppedUpBalance || '0')
      + '（点击刷新）');
  } catch (err) {
    setBalanceText('--', '余额获取失败：' + (err.message || '网络错误'));
    chip.classList.remove('low');
    if (force) toast('余额获取失败：' + (err.message || '网络错误'));
  } finally {
    state.balanceLoading = false;
    chip.classList.remove('loading');
  }
}

/* ---------------- 模型设置 ---------------- */

function openModelSheet() {
  state.draft = {
    modelName: state.config ? state.config.modelName : FALLBACK_MODELS[0].id,
    apiKey: state.config ? state.config.apiKey : '',
    baseUrl: state.config ? state.config.baseUrl : DEEPSEEK_BASE
  };
  state.modelOptions = FALLBACK_MODELS.slice();
  state.modelsLoaded = false;
  renderModelOptions();

  const key = $('#api-key');
  const base = $('#base-url');
  key.value = state.draft.apiKey || '';
  base.value = state.draft.baseUrl || '';
  key.type = 'password';
  $('#toggle-key').textContent = '显示';
  $('#model-hint').textContent = state.draft.apiKey
    ? '正在获取上游最新模型…'
    : '填写 API Key 后可获取上游最新模型';
  $('#model-overlay').hidden = false;
  if (state.draft.apiKey) fetchModels(false);
}

function closeModelSheet() {
  $('#model-overlay').hidden = true;
  state.draft = null;
}

function modelContextLabel(model) {
  const ctx = Number(model.contextWindow || 0);
  if (!ctx) return '';
  if (ctx >= 1048576) return '1M 上下文';
  if (ctx >= 1024) return Math.round(ctx / 1024) + 'K 上下文';
  return ctx + ' 上下文';
}

function renderModelOptions() {
  if (!state.draft) return;
  const wrap = $('#model-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  const models = state.modelOptions.length ? state.modelOptions : FALLBACK_MODELS;
  models.forEach(m => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'model-option' + (m.id === state.draft.modelName ? ' active' : '');
    btn.innerHTML = '<span class="radio"></span><span class="model-text"><span class="model-name"></span><span class="model-sub"></span></span>';
    btn.querySelector('.model-name').textContent = m.name || m.id;
    const sub = [m.id];
    const ctx = modelContextLabel(m);
    if (ctx) sub.push(ctx);
    if (Array.isArray(m.inputModalities) && m.inputModalities.includes('image')) {
      sub.push('支持图片');
    }
    btn.querySelector('.model-sub').textContent = sub.join(' · ');
    btn.addEventListener('click', () => {
      state.draft.modelName = m.id;
      renderModelOptions();
    });
    wrap.appendChild(btn);
  });
}

async function fetchModels(manual) {
  if (!state.draft) return;
  const key = ($('#api-key').value || '').trim() || state.draft.apiKey;
  const base = ($('#base-url').value || '').trim() || state.draft.baseUrl || DEEPSEEK_BASE;
  const hint = $('#model-hint');
  const btn = $('#refresh-models');
  if (!key) {
    hint.textContent = '填写 API Key 后可获取上游最新模型';
    if (manual) toast('先填写 API Key');
    return;
  }

  btn.disabled = true;
  btn.textContent = '获取中…';
  hint.textContent = '正在获取上游模型…';
  try {
    const res = await fetch('/api/deepseek/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key, baseUrl: base })
    });
    const data = await res.json();
    if (!state.draft) return;
    if (!res.ok || !data.success) {
      throw new Error(data.error || ('HTTP ' + res.status));
    }
    const models = (Array.isArray(data.models) ? data.models : [])
      .filter(m => m && m.id)
      .map(m => ({ id: m.id, name: m.name || m.id, contextWindow: m.contextWindow,
        inputModalities: Array.isArray(m.inputModalities) ? m.inputModalities : [] }));
    if (!models.length) throw new Error('上游没有返回模型');

    state.modelOptions = models;
    state.modelsLoaded = true;
    const current = models.find(m => m.id === state.draft.modelName);
    if (!current) {
      hint.textContent = '已获取 ' + models.length + ' 个模型；当前模型不在列表中，请重新选择';
    } else {
      hint.textContent = '已获取 ' + models.length + ' 个最新模型';
    }
    renderModelOptions();
    if (manual) toast('已获取 ' + models.length + ' 个模型');
  } catch (err) {
    if (!state.draft) return;
    state.modelOptions = FALLBACK_MODELS.slice();
    state.modelsLoaded = false;
    renderModelOptions();
    hint.textContent = '获取失败：' + (err.message || '网络错误') + '（已显示默认模型）';
    if (manual) toast('获取失败：' + (err.message || '网络错误'));
  } finally {
    btn.disabled = false;
    btn.textContent = '获取最新模型';
  }
}

function saveModelConfig() {
  if (!state.draft) return;
  const key = ($('#api-key').value || '').trim();
  const base = ($('#base-url').value || '').trim() || DEEPSEEK_BASE;
  if (!key) {
    toast('请填写 DeepSeek API Key');
    $('#api-key').focus();
    return;
  }
  if (!/^https?:\/\//i.test(base)) {
    toast('Base URL 必须以 http:// 或 https:// 开头');
    $('#base-url').focus();
    return;
  }
  if (state.modelsLoaded && !state.modelOptions.some(m => m.id === state.draft.modelName)) {
    toast('请从最新模型列表中选择一个模型');
    return;
  }
  if (!state.draft.modelName) {
    toast('请选择模型');
    return;
  }

  state.config = {
    modelName: state.draft.modelName,
    apiKey: key,
    baseUrl: base,
    temperature: 0.3,
    maxTokens: 8192
  };
  persistConfig();
  updateModelLabels();
  closeModelSheet();
  toast('已保存，当前模型 ' + state.config.modelName);
  refreshBalance(true);
}

/* ---------------- 附件 ---------------- */

const REMOVE_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function fileExt(name) {
  const value = String(name || '');
  const dot = value.lastIndexOf('.');
  return dot < 0 ? '' : value.slice(dot + 1).toLowerCase();
}

function kindOfFile(file) {
  const ext = fileExt(file && file.name);
  if (IMAGE_EXT.has(ext)) return 'image';
  if (TEXT_EXT.has(ext)) return ext === 'pdf' ? 'pdf' : 'text';
  return null;
}

function formatSize(bytes) {
  const n = Number(bytes || 0);
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

function modelSupportsImages() {
  const cfg = state.config;
  if (!cfg) return false;
  const found = state.modelOptions.find(m => m.id === cfg.modelName);
  if (!found || !Array.isArray(found.inputModalities) || !found.inputModalities.length) {
    return true;
  }
  return found.inputModalities.includes('image');
}

function prepareImage(file) {
  return new Promise(resolve => {
    if (!file || !/^image\//.test(file.type || '') || /gif/i.test(file.type)) {
      resolve(file);
      return;
    }
    if (file.size <= 700 * 1024) {
      resolve(file);
      return;
    }
    if (!window.createImageBitmap) {
      resolve(file);
      return;
    }
    window.createImageBitmap(file).then(bitmap => {
      const max = 1600;
      if (bitmap.width <= max && bitmap.height <= max && file.size <= 1.5 * 1024 * 1024) {
        bitmap.close();
        resolve(file);
        return;
      }
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      canvas.toBlob(blob => {
        if (!blob || blob.size >= file.size) {
          resolve(file);
          return;
        }
        const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
        resolve(new File([blob], name, { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.9);
    }).catch(() => resolve(file));
  });
}

async function addFiles(fileList) {
  if (state.uploading) {
    toast('附件正在上传，请稍候');
    return;
  }
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (state.attachments.length + files.length > MAX_ATTACHMENTS) {
    toast('单条消息最多 ' + MAX_ATTACHMENTS + ' 个附件');
    return;
  }

  const accepted = [];
  let total = state.attachments.reduce((sum, a) => sum + a.size, 0);
  let imageTotal = state.attachments.filter(a => a.kind === 'image')
    .reduce((sum, a) => sum + a.size, 0);
  for (const file of files) {
    const kind = kindOfFile(file);
    if (!kind) {
      toast('不支持的文件：' + file.name);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast(file.name + ' 超过 20MB');
      continue;
    }
    if (total + file.size > MAX_TOTAL_BYTES) {
      toast('附件总大小超过 100MB');
      break;
    }
    if (kind === 'image' && imageTotal + file.size > MAX_IMAGE_TOTAL_BYTES) {
      toast('图片总量超过 25MB，请减少或压缩图片');
      continue;
    }
    total += file.size;
    if (kind === 'image') imageTotal += file.size;
    accepted.push({ file, kind });
  }
  if (!accepted.length) return;

  const items = [];
  for (const entry of accepted) {
    const prepared = entry.kind === 'image' ? await prepareImage(entry.file) : entry.file;
    items.push({
      key: 'a' + (++state.attachSeq),
      file: prepared,
      name: entry.file.name,
      size: prepared.size,
      kind: entry.kind,
      previewUrl: entry.kind === 'image' ? URL.createObjectURL(prepared) : null,
      id: null,
      status: 'pending'
    });
  }
  state.attachments.push(...items);
  state.uploading = true;
  renderAttachments();
  await uploadPending();
}

async function uploadPending() {
  const pending = state.attachments.filter(a => !a.id && a.status !== 'error');
  if (!pending.length) {
    state.uploading = false;
    renderAttachments();
    return;
  }
  state.uploading = true;
  renderAttachments();

  try {
    const form = new FormData();
    pending.forEach(a => form.append('files', a.file, a.name));
    const res = await fetch('/api/attachments', { method: 'POST', body: form });
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      throw new Error(res.status === 413
        ? '附件数量或体积超过服务限制'
        : '上传失败 HTTP ' + res.status);
    }
    if (!res.ok || !data.success) {
      throw new Error(data.error || ('HTTP ' + res.status));
    }
    const metas = Array.isArray(data.attachments) ? data.attachments : [];
    if (metas.length !== pending.length) {
      throw new Error('附件上传结果不完整');
    }
    pending.forEach((a, i) => {
      a.id = metas[i].id;
      a.status = 'ready';
    });
  } catch (err) {
    pending.forEach(a => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      a.status = 'error';
    });
    state.attachments = state.attachments.filter(a => a.status !== 'error');
    toast('附件上传失败：' + (err.message || '网络错误'));
  } finally {
    state.uploading = false;
    renderAttachments();
  }
}

function renderAttachments() {
  const wrap = $('#attachments');
  const count = $('#attach-count');
  const uploadState = $('#upload-state');
  const attachBtn = $('#attach-btn');
  if (!wrap) return;

  wrap.innerHTML = '';
  if (!state.attachments.length) {
    wrap.hidden = true;
    if (count) count.hidden = true;
    if (uploadState) uploadState.hidden = true;
    if (attachBtn) attachBtn.disabled = state.uploading;
    return;
  }

  wrap.hidden = false;
  if (count) {
    count.hidden = false;
    count.textContent = state.attachments.length + '/' + MAX_ATTACHMENTS;
  }
  if (uploadState) uploadState.hidden = !state.uploading;
  if (attachBtn) attachBtn.disabled = state.uploading;

  state.attachments.forEach(a => {
    const item = document.createElement('div');
    item.className = 'attachment' + (a.id ? '' : ' pending');

    if (a.kind === 'image' && a.previewUrl) {
      const img = document.createElement('img');
      img.className = 'attachment-thumb';
      img.src = a.previewUrl;
      img.alt = a.name;
      item.appendChild(img);
    } else {
      const file = document.createElement('span');
      file.className = 'attachment-file';
      const ext = fileExt(a.name) || 'FILE';
      file.textContent = ext.slice(0, 3).toUpperCase();
      item.appendChild(file);
    }

    const meta = document.createElement('span');
    meta.className = 'attachment-meta';
    const name = document.createElement('span');
    name.className = 'attachment-name';
    name.textContent = a.name;
    name.title = a.name;
    const size = document.createElement('span');
    size.className = 'attachment-size';
    size.textContent = formatSize(a.size) + (a.id ? '' : ' · 上传中');
    meta.appendChild(name);
    meta.appendChild(size);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'attachment-remove';
    remove.setAttribute('aria-label', '移除附件');
    remove.innerHTML = REMOVE_SVG;
    remove.addEventListener('click', () => removeAttachment(a.key));

    item.appendChild(meta);
    item.appendChild(remove);
    wrap.appendChild(item);
  });
}

function removeAttachment(key) {
  if (state.uploading) {
    toast('附件正在上传，请稍候');
    return;
  }
  const index = state.attachments.findIndex(a => a.key === key);
  if (index < 0) return;
  const item = state.attachments[index];
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  if (item.id) {
    fetch('/api/attachments/' + item.id, { method: 'DELETE' }).catch(() => {});
  }
  state.attachments.splice(index, 1);
  renderAttachments();
}

function clearAttachments(options) {
  const revoke = !options || options.revoke !== false;
  const deleteServer = !options || options.deleteServer !== false;
  state.attachments.forEach(a => {
    if (revoke && a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    if (deleteServer && a.id) {
      fetch('/api/attachments/' + a.id, { method: 'DELETE' }).catch(() => {});
    }
  });
  state.attachments = [];
  state.uploading = false;
  renderAttachments();
}

/* ---------------- SSE 聊天 ---------------- */

function setLoading(loading) {
  state.loading = loading;
  const send = $('#send-btn');
  const stop = $('#stop-btn');
  if (send) send.hidden = loading;
  if (stop) stop.hidden = !loading;
}

function updateStatus(ai, text, isError) {
  if (!ai || !ai.status) return;
  ai.status.textContent = text || '';
  ai.status.classList.toggle('error', !!isError);
}

function createSession(title, modelName) {
  return fetch('/api/history/session/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title || '新对话', modelName: modelName || '' })
  }).then(res => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).then(data => data.sessionId);
}

async function sendMessage() {
  if (state.loading) return;
  const input = $('#input-box');
  const typed = input.value.trim();
  const attachments = state.attachments.slice();
  const text = typed || (attachments.length ? '请根据上传的附件回答问题。' : '');
  if (!text) return;
  if (!state.config || !state.config.apiKey) {
    openModelSheet();
    toast('先配置 DeepSeek API Key');
    return;
  }
  if (!state.config.modelName) {
    openModelSheet();
    toast('先选择模型');
    return;
  }
  if (state.uploading) {
    toast('附件正在上传，请稍候');
    return;
  }
  if (attachments.some(a => !a.id)) {
    toast('有附件尚未上传完成');
    return;
  }
  if (attachments.some(a => a.kind === 'image') && !modelSupportsImages()) {
    toast('当前模型不支持图片输入，请切换到 DeepSeek-Flash');
    return;
  }

  const cfg = state.config;
  let dbId = state.dbSessionId;
  if (!dbId) {
    try {
      dbId = await createSession(text.slice(0, 18), cfg.modelName);
      state.dbSessionId = dbId;
      localStorage.setItem(LS.session, String(dbId));
    } catch (_) {
      toast('历史记录保存失败，本次对话仍可继续');
    }
  }

  input.value = '';
  resizeInput();
  input.focus();
  state.lastQuestion = text;
  state.lastAnswer = '';
  addUserMessage(text, attachments);

  state.attachments = [];
  state.uploading = false;
  attachments.forEach(a => {
    if (a.previewUrl) state.sentPreviews.push(a.previewUrl);
  });
  renderAttachments();

  const ai = createAiMessage(text);

  setLoading(true);
  const controller = new AbortController();
  state.abort = controller;

  const body = {
    provider: 'deepseek',
    modelName: cfg.modelName,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    temperature: cfg.temperature || 0.3,
    maxTokens: cfg.maxTokens || 8192,
    messages: [{ role: 'user', content: text }]
  };
  if (dbId) body.sessionId = dbId;
  if (attachments.length) body.attachments = attachments.map(a => a.id);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (_) { /* 忽略 */ }
      throw new Error('HTTP ' + res.status + (detail ? '：' + detail.slice(0, 160) : ''));
    }
    if (!res.body) throw new Error('当前浏览器不支持流式读取');
    await readStream(res.body, ai);
    if (!ai.finished) finishAi(ai, flushSmooth(ai), false, null);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      if (!ai.finished) finishAi(ai, flushSmooth(ai), true, null);
    } else {
      failAi(ai, friendlyError(err));
    }
  } finally {
    state.abort = null;
    setLoading(false);
    loadSessions();
    loadErrorBook();
    attachments.forEach(a => {
      if (a.id) fetch('/api/attachments/' + a.id, { method: 'DELETE' }).catch(() => {});
    });
  }
}

function friendlyError(err) {
  const raw = (err && err.message) ? String(err.message) : String(err || '未知错误');
  if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(raw)) {
    return '无法连接本机服务，请确认程序仍在运行。';
  }
  if (/HTTP 401|HTTP 403/.test(raw)) {
    return 'API Key 无效或没有权限，请在模型设置里检查。';
  }
  if (/HTTP 402/.test(raw)) {
    return '账户余额不足，请充值后再试。';
  }
  if (/HTTP 429/.test(raw)) {
    return '请求过于频繁，请稍后再试。';
  }
  if (/HTTP 5\d\d/.test(raw)) {
    return '模型服务暂时不可用，请稍后重试。';
  }
  return raw.length > 260 ? raw.slice(0, 260) + '…' : raw;
}

async function readStream(body, ai) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (handleSseBlock(block, ai)) return;
    }
  }
  if (buffer.trim()) handleSseBlock(buffer, ai);
}

function handleSseBlock(block, ai) {
  if (!block.trim()) return false;
  let event = 'message';
  const dataLines = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (!dataLines.length) return false;

  let obj;
  try {
    obj = JSON.parse(dataLines.join('\n'));
  } catch (_) {
    return false;
  }
  const type = (event && event !== 'message') ? event : obj.type;

  if (type === 'reasoning') {
    const reasoning = obj.reasoning || '';
    if (reasoning) appendThink(ai, reasoning);
    return false;
  }
  if (type === 'chunk') {
    const content = obj.content || '';
    if (content) {
      feedSmooth(ai, content);
      updateStatus(ai, '正在回答');
    }
    return false;
  }
  if (type === 'finish') {
    if (obj.fullReasoning && !ai.thinkRaw) appendThink(ai, obj.fullReasoning);
    finishAi(ai, obj.fullContent || '', false, obj.metrics || null);
    return true;
  }
  if (type === 'error') {
    failAi(ai, obj.errMsg || '模型调用失败');
    return true;
  }
  return false;
}

/* ---------------- AI 消息渲染 ---------------- */

function addUserMessage(text, attachments) {
  hideWelcome();
  const row = document.createElement('div');
  row.className = 'msg user';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  if (Array.isArray(attachments) && attachments.length) {
    const list = document.createElement('div');
    list.className = 'bubble-attachments';
    attachments.forEach(a => {
      if (a.kind === 'image' && a.previewUrl) {
        const img = document.createElement('img');
        img.className = 'bubble-attach-img';
        img.src = a.previewUrl;
        img.alt = a.name;
        img.title = a.name;
        list.appendChild(img);
      } else {
        const file = document.createElement('span');
        file.className = 'bubble-attach-file';
        file.textContent = a.name;
        file.title = a.name;
        list.appendChild(file);
      }
    });
    bubble.appendChild(list);
  }

  row.appendChild(bubble);
  $('#chat-list').appendChild(row);
  scrollToBottom(true);
}

function createAiMessage(question) {
  hideWelcome();
  const row = document.createElement('div');
  row.className = 'msg ai';
  row.innerHTML =
    '<div class="ai-avatar" aria-hidden="true">' + AVATAR_SVG + '</div>' +
    '<div class="ai-main">' +
      '<div class="ai-meta"><span class="ai-name">Pathfinder</span><span class="ai-status">正在连接…</span></div>' +
      '<details class="think" hidden><summary>推理过程</summary><div class="think-body"></div></details>' +
      '<div class="answer"><span class="typing"><i></i><i></i><i></i></span></div>' +
      '<div class="metrics" hidden></div>' +
      '<div class="msg-actions" hidden>' +
        '<button type="button" class="msg-action act-copy">' + COPY_SVG + '复制</button>' +
        '<button type="button" class="msg-action act-save">' + BOOKMARK_SVG + '收藏</button>' +
      '</div>' +
    '</div>';
  $('#chat-list').appendChild(row);

  const ai = {
    row: row,
    answer: row.querySelector('.answer'),
    think: row.querySelector('.think'),
    thinkBody: row.querySelector('.think-body'),
    status: row.querySelector('.ai-status'),
    metricsEl: row.querySelector('.metrics'),
    actions: row.querySelector('.msg-actions'),
    raw: '',
    thinkRaw: '',
    question: question || '',
    finished: false,
    smoothBuf: '',
    smoothText: '',
    smoothTimer: null
  };

  row.querySelector('.act-copy').addEventListener('click', () => copyAnswer(ai));
  row.querySelector('.act-save').addEventListener('click', () => saveAnswer(ai));
  state.currentAi = ai;
  scrollToBottom(true);
  return ai;
}

function addStaticAi(text, thinkRaw, question, usage) {
  const ai = createAiMessage(question);
  ai.finished = true;
  ai.raw = text || '';
  ai.answer.classList.add('markdown');
  ai.answer.innerHTML = text ? renderMarkdown(text, true) : '<span class="muted">（空回答）</span>';
  if (thinkRaw) {
    ai.thinkRaw = thinkRaw;
    ai.think.hidden = false;
    ai.think.querySelector('summary').textContent = '推理过程';
    ai.thinkBody.innerHTML = renderMarkdown(thinkRaw, true);
  }
  updateStatus(ai, '');
  if (usage) renderMetrics(ai, usage);
  ai.actions.hidden = false;
  state.lastAnswer = ai.raw;
}

function appendThink(ai, text) {
  if (!ai || !text) return;
  ai.thinkRaw += text;
  ai.think.hidden = false;
  ai.thinkBody.textContent = ai.thinkRaw;
  ai.think.querySelector('summary').textContent = '推理过程 · 思考中';
  updateStatus(ai, '深度思考中…');
}

function renderThinkFinal(ai) {
  if (!ai || !ai.thinkRaw) return;
  ai.think.hidden = false;
  ai.think.querySelector('summary').textContent = '推理过程';
  ai.thinkBody.innerHTML = renderMarkdown(ai.thinkRaw, true);
}

function feedSmooth(ai, chunk) {
  ai.smoothBuf += chunk;
  if (ai.smoothTimer) return;
  ai.smoothTimer = setInterval(() => tickSmooth(ai), 50);
}

function tickSmooth(ai) {
  if (!ai.smoothBuf) {
    clearInterval(ai.smoothTimer);
    ai.smoothTimer = null;
    return;
  }
  const size = ai.smoothBuf.length > 300 ? 40 : (ai.smoothBuf.length > 100 ? 12 : 4);
  ai.smoothText += ai.smoothBuf.slice(0, size);
  ai.smoothBuf = ai.smoothBuf.slice(size);
  ai.answer.classList.add('markdown');
  ai.answer.innerHTML = renderMarkdown(ai.smoothText, false);
  if (isNearBottom()) scrollToBottom(false);
}

function flushSmooth(ai) {
  if (ai.smoothTimer) {
    clearInterval(ai.smoothTimer);
    ai.smoothTimer = null;
  }
  if (ai.smoothBuf) {
    ai.smoothText += ai.smoothBuf;
    ai.smoothBuf = '';
  }
  return ai.smoothText;
}

function finishAi(ai, fullText, stopped, metrics) {
  if (!ai || ai.finished) return;
  ai.finished = true;
  if (ai.smoothTimer) {
    clearInterval(ai.smoothTimer);
    ai.smoothTimer = null;
  }
  const text = (typeof fullText === 'string' && fullText) ? fullText : (ai.smoothText + ai.smoothBuf);
  ai.smoothText = text;
  ai.smoothBuf = '';
  ai.raw = text;

  if (text) {
    ai.answer.classList.add('markdown');
    ai.answer.innerHTML = renderMarkdown(text, true);
  } else {
    ai.answer.innerHTML = '<div class="error-box">' + (stopped ? '已停止生成。' : '模型没有返回正文，请重试或换一个模型。') + '</div>';
  }
  updateStatus(ai, stopped ? '已停止' : '回答完成');
  renderThinkFinal(ai);
  if (metrics) renderMetrics(ai, metrics);
  ai.actions.hidden = false;
  state.lastAnswer = text;
  scrollToBottom(true);
  if (!stopped) refreshBalance(false);
}

function failAi(ai, message) {
  if (!ai || ai.finished) return;
  ai.finished = true;
  if (ai.smoothTimer) {
    clearInterval(ai.smoothTimer);
    ai.smoothTimer = null;
  }
  ai.answer.innerHTML = '<div class="error-box"></div>';
  ai.answer.querySelector('.error-box').textContent = message;
  updateStatus(ai, '调用失败', true);
  ai.actions.hidden = true;
  state.lastAnswer = '';
  scrollToBottom(true);
}

/* ---------------- 用量指标 ---------------- */

function formatInt(value) {
  const n = Number(value || 0);
  return n.toLocaleString('zh-CN');
}

function formatCost(value) {
  const n = Number(value || 0);
  if (n >= 0.01) return '$' + n.toFixed(4);
  if (n >= 0.000001) return '$' + n.toFixed(6);
  return '$' + n.toFixed(8);
}

function formatTtft(ms) {
  const n = Number(ms || 0);
  if (!n) return '';
  return n < 1000 ? n + ' ms' : (n / 1000).toFixed(2) + ' s';
}

function addMetricItem(container, label, value, extraClass, title) {
  const item = document.createElement('span');
  item.className = 'metric' + (extraClass ? ' ' + extraClass : '');
  const name = document.createElement('b');
  name.textContent = label;
  const val = document.createElement('strong');
  val.textContent = value;
  item.appendChild(name);
  item.appendChild(val);
  if (title) item.title = title;
  container.appendChild(item);
}

function renderMetrics(ai, metrics) {
  if (!ai || !ai.metricsEl || !metrics) return;
  const el = ai.metricsEl;
  el.innerHTML = '';

  const prompt = Number(metrics.promptTokens || 0);
  const completion = Number(metrics.completionTokens || 0);
  const ttft = Number(metrics.ttftMs || 0);
  const tps = Number(metrics.outputTps || 0);
  const hitRate = Number(metrics.cacheHitRate || 0);
  const hitTokens = Number(metrics.cacheHitTokens || 0);
  const missTokens = Number(metrics.cacheMissTokens || 0);
  const hasUsage = prompt > 0 || completion > 0;

  if (prompt > 0) addMetricItem(el, '输入', formatInt(prompt));
  if (completion > 0) addMetricItem(el, '输出', formatInt(completion));
  if (hasUsage && prompt > 0) {
    addMetricItem(el, '缓存', Math.round(hitRate) + '%', '', hitTokens + ' 命中 / ' + missTokens + ' 未命中');
  }
  if (ttft > 0) addMetricItem(el, '首 token', formatTtft(ttft));
  if (tps > 0) addMetricItem(el, '输出速率', tps.toFixed(1) + ' tok/s');

  if (hasUsage) {
    const peak = metrics.peak ? '高峰时段' : '低峰时段';
    if (metrics.costUsd == null) {
      addMetricItem(el, '费用', '—', 'cost', '该模型未配置费率');
    } else {
      const costText = formatCost(metrics.costUsd);
      const item = document.createElement('span');
      item.className = 'metric cost';
      item.title = '按 DeepSeek 官方美元价估算（' + peak + '，节假日未计入）';
      const name = document.createElement('b');
      name.textContent = '费用';
      const val = document.createElement('strong');
      val.textContent = costText;
      const est = document.createElement('span');
      est.className = 'est';
      est.textContent = '估';
      item.appendChild(name);
      item.appendChild(val);
      item.appendChild(est);
      el.appendChild(item);
    }
  }

  el.hidden = el.children.length === 0;
}

function copyAnswer(ai) {
  const text = (ai && ai.raw) ? ai.raw : '';
  if (!text) {
    toast('暂无可复制的回答');
    return;
  }
  copyText(text).then(() => toast('已复制回答')).catch(() => toast('复制失败，请长按选择文本'));
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
    } catch (err) {
      reject(err);
    } finally {
      document.body.removeChild(ta);
    }
  });
}

/* ---------------- 滚动与欢迎区 ---------------- */

function isNearBottom() {
  const el = $('#chat-scroll');
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}

function scrollToBottom(force) {
  const el = $('#chat-scroll');
  if (!el) return;
  if (force || isNearBottom()) {
    el.scrollTop = el.scrollHeight;
    $('#scroll-bottom').classList.remove('show');
  }
}

function syncScrollButton() {
  const el = $('#chat-scroll');
  const btn = $('#scroll-bottom');
  if (!el || !btn) return;
  const show = el.scrollHeight > el.clientHeight + 240 && !isNearBottom();
  btn.classList.toggle('show', show);
}

function hideWelcome() {
  const el = $('#welcome');
  if (el) el.hidden = true;
}

function showWelcome() {
  const el = $('#welcome');
  if (el) el.hidden = false;
}

function clearChat() {
  state.sentPreviews.forEach(url => {
    try { URL.revokeObjectURL(url); } catch (_) { /* 忽略 */ }
  });
  state.sentPreviews = [];
  clearAttachments({ revoke: true, deleteServer: true });
  $('#chat-list').innerHTML = '';
  showWelcome();
  state.currentAi = null;
  state.lastAnswer = '';
}

/* ---------------- 历史会话 ---------------- */

function groupLabel(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '更早';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((today - target) / 86400000);
  if (diff <= 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff < 7) return '本周';
  return '更早';
}

function timeLabel(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) {
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }
  return String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

async function loadSessions() {
  try {
    const res = await fetch('/api/history/sessions?page=0&size=50', { cache: 'no-store' });
    if (!res.ok) return;
    const list = await res.json();
    renderSessions(Array.isArray(list) ? list : []);
  } catch (_) { /* 网络异常时保留现有列表 */ }
}

function renderSessions(sessions) {
  const wrap = $('#history-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = '还没有历史对话。发送第一条消息后会自动保存。';
    wrap.appendChild(empty);
    return;
  }

  let currentGroup = '';
  sessions.forEach(s => {
    const date = new Date(s.updateTime || s.createTime || '');
    const group = groupLabel(date);
    if (group !== currentGroup) {
      currentGroup = group;
      const label = document.createElement('div');
      label.className = 'history-group-label';
      label.textContent = group;
      wrap.appendChild(label);
    }

    const item = document.createElement('div');
    item.className = 'history-item' + (Number(s.sessionId) === Number(state.dbSessionId) ? ' active' : '');
    item.dataset.id = s.sessionId;

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'history-main';
    const title = document.createElement('span');
    title.className = 'history-title';
    title.textContent = s.title || '新对话';
    const time = document.createElement('span');
    time.className = 'history-time';
    time.textContent = timeLabel(date);
    main.appendChild(title);
    main.appendChild(time);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'h-del';
    del.setAttribute('aria-label', '删除对话');
    del.innerHTML = TRASH_SVG;

    item.appendChild(main);
    item.appendChild(del);
    wrap.appendChild(item);
  });
}

function markActiveSession() {
  $$('.history-item').forEach(item => {
    item.classList.toggle('active', Number(item.dataset.id) === Number(state.dbSessionId));
  });
}

async function openSession(id, silent) {
  if (!id) return;
  if (state.abort) {
    try { state.abort.abort(); } catch (_) { /* 忽略 */ }
  }
  setLoading(false);
  state.dbSessionId = id;
  localStorage.setItem(LS.session, String(id));
  markActiveSession();
  if (!silent) closeDrawer();

  try {
    const res = await fetch('/api/history/messages/' + id, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const messages = await res.json();
    clearChat();
    if (!Array.isArray(messages) || !messages.length) {
      showWelcome();
      return;
    }
    hideWelcome();
    let lastUser = '';
    messages.forEach(m => {
      if (m.role === 'user') {
        lastUser = m.content || '';
        addUserMessage(lastUser);
      } else if (m.role === 'assistant') {
        addStaticAi(m.content || '', m.thinkRaw || '', lastUser, m.usage || null);
      }
    });
    scrollToBottom(true);
  } catch (_) {
    clearChat();
    if (!silent) toast('对话加载失败');
    if (silent) {
      state.dbSessionId = null;
      localStorage.removeItem(LS.session);
    }
  }
}

async function deleteSession(id) {
  if (!confirm('删除这条对话？删除后无法恢复。')) return;
  try {
    await fetch('/api/history/session/' + id, { method: 'DELETE' });
    if (Number(id) === Number(state.dbSessionId)) {
      newChat();
    }
    loadSessions();
    toast('已删除');
  } catch (_) {
    toast('删除失败，请稍后重试');
  }
}

function newChat() {
  if (state.abort) {
    try { state.abort.abort(); } catch (_) { /* 忽略 */ }
  }
  setLoading(false);
  state.dbSessionId = null;
  localStorage.removeItem(LS.session);
  clearChat();
  closeDrawer();
  markActiveSession();
  const input = $('#input-box');
  input.value = '';
  resizeInput();
  input.focus();
}

/* ---------------- 错题本 ---------------- */

function loadErrorBook() {
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(LS.errorBook) || '[]');
  } catch (_) {
    list = [];
  }
  state.errorBook = Array.isArray(list) ? list : [];
  renderErrorBook();
}

function saveErrorBook() {
  try {
    localStorage.setItem(LS.errorBook, JSON.stringify(state.errorBook.slice(0, 50)));
  } catch (_) { /* 忽略 */ }
}

function renderErrorBook() {
  const wrap = $('#error-list');
  const count = $('#error-count');
  if (!wrap) return;
  if (count) count.textContent = String(state.errorBook.length);
  wrap.innerHTML = '';
  if (!state.errorBook.length) {
    const empty = document.createElement('div');
    empty.className = 'error-empty';
    empty.textContent = '在回答下方点「收藏」，题目会保存在这里。';
    wrap.appendChild(empty);
    return;
  }
  state.errorBook.forEach((item, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'error-item';
    btn.dataset.index = String(index);
    const q = document.createElement('span');
    q.className = 'eq';
    q.textContent = item.question || '（未记录题目）';
    const meta = document.createElement('span');
    meta.className = 'em';
    meta.textContent = item.time || '';
    btn.appendChild(q);
    btn.appendChild(meta);
    wrap.appendChild(btn);
  });
}

function saveAnswer(ai) {
  const answer = (ai && ai.raw) ? ai.raw : '';
  if (!answer) {
    toast('暂无可收藏的回答');
    return;
  }
  const question = (ai && ai.question) || state.lastQuestion || '';
  const exists = state.errorBook.some(item => item.answer === answer && item.question === question);
  if (exists) {
    toast('这道题已经在错题本里');
    return;
  }
  state.errorBook.unshift({
    question: question,
    answer: answer,
    time: new Date().toLocaleString('zh-CN', { hour12: false })
  });
  saveErrorBook();
  renderErrorBook();
  toast('已收藏到错题本');
}

function openSaved(index) {
  const item = state.errorBook[index];
  if (!item) return;
  state.savedIndex = index;
  $('#saved-time').textContent = item.time || '';
  $('#saved-question').textContent = item.question || '（未记录题目）';
  $('#saved-answer').innerHTML = item.answer
    ? renderMarkdown(item.answer, true)
    : '<span class="muted">（空回答）</span>';
  $('#saved-overlay').hidden = false;
}

function closeSaved() {
  $('#saved-overlay').hidden = true;
  state.savedIndex = -1;
}

/* ---------------- 抽屉 ---------------- */

function openDrawer() {
  document.body.classList.add('drawer-open');
}

function closeDrawer() {
  document.body.classList.remove('drawer-open');
}

function closeAllOverlays() {
  if (!$('#model-overlay').hidden) closeModelSheet();
  if (!$('#saved-overlay').hidden) closeSaved();
  closeDrawer();
}

/* ---------------- 输入 ---------------- */

function resizeInput() {
  const input = $('#input-box');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
}

/* ---------------- 初始化与事件 ---------------- */

function syncViewport() {
  const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
}

function wireEvents() {
  $('#menu-btn').addEventListener('click', openDrawer);
  $('#drawer-mask').addEventListener('click', closeDrawer);
  $('#sidebar-close').addEventListener('click', closeDrawer);
  $('#new-chat-btn').addEventListener('click', newChat);
  $('#top-new-chat').addEventListener('click', newChat);
  $('#refresh-history').addEventListener('click', loadSessions);
  $('#sidebar-model-btn').addEventListener('click', openModelSheet);
  $('#model-chip').addEventListener('click', openModelSheet);
  $('#balance-chip').addEventListener('click', () => refreshBalance(true));

  $('#history-list').addEventListener('click', event => {
    const del = event.target.closest('.h-del');
    const item = event.target.closest('.history-item');
    if (!item) return;
    const id = Number(item.dataset.id);
    if (del) {
      event.stopPropagation();
      deleteSession(id);
      return;
    }
    openSession(id, false);
  });

  $('#error-list').addEventListener('click', event => {
    const btn = event.target.closest('.error-item');
    if (!btn) return;
    openSaved(Number(btn.dataset.index));
  });

  $('#send-btn').addEventListener('click', sendMessage);
  $('#stop-btn').addEventListener('click', () => {
    if (state.abort) {
      updateStatus(state.currentAi, '正在停止…');
      state.abort.abort();
    } else {
      setLoading(false);
    }
  });

  $('#input-box').addEventListener('input', resizeInput);
  $('#input-box').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  });
  $('#input-box').addEventListener('focus', () => {
    setTimeout(() => scrollToBottom(true), 120);
  });

  $('#attach-btn').addEventListener('click', () => {
    if (state.uploading) {
      toast('附件正在上传，请稍候');
      return;
    }
    $('#file-input').click();
  });
  $('#file-input').addEventListener('change', async event => {
    const files = event.target.files;
    event.target.value = '';
    await addFiles(files);
  });

  $('#chat-scroll').addEventListener('scroll', syncScrollButton);
  $('#scroll-bottom').addEventListener('click', () => scrollToBottom(true));

  $('#model-close').addEventListener('click', closeModelSheet);
  $('#model-overlay').addEventListener('click', event => {
    if (event.target === $('#model-overlay')) closeModelSheet();
  });
  $('#save-model').addEventListener('click', saveModelConfig);
  $('#refresh-models').addEventListener('click', () => fetchModels(true));
  $('#toggle-key').addEventListener('click', () => {
    const input = $('#api-key');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('#toggle-key').textContent = show ? '隐藏' : '显示';
  });

  $('#saved-close').addEventListener('click', closeSaved);
  $('#saved-close-bottom').addEventListener('click', closeSaved);
  $('#saved-overlay').addEventListener('click', event => {
    if (event.target === $('#saved-overlay')) closeSaved();
  });
  $('#saved-copy').addEventListener('click', () => {
    const item = state.errorBook[state.savedIndex];
    if (!item) return;
    copyText(item.answer || '').then(() => toast('已复制答案')).catch(() => toast('复制失败'));
  });
  $('#saved-delete').addEventListener('click', () => {
    if (state.savedIndex < 0) return;
    if (!confirm('从错题本删除这道题？')) return;
    state.errorBook.splice(state.savedIndex, 1);
    saveErrorBook();
    renderErrorBook();
    closeSaved();
    toast('已删除');
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeAllOverlays();
  });

  window.addEventListener('resize', syncViewport);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      syncViewport();
      if (document.activeElement === $('#input-box')) {
        setTimeout(() => scrollToBottom(true), 80);
      }
    });
  }
}

async function init() {
  setupMarked();
  wireEvents();
  syncViewport();
  initConfig();
  loadErrorBook();
  loadSessions();
  refreshBalance(false);

  let saved = null;
  try { saved = localStorage.getItem(LS.session); } catch (_) { /* 忽略 */ }
  if (saved) {
    const id = Number(saved);
    if (id) {
      await openSession(id, true);
    }
  }

  if (!state.dbSessionId) showWelcome();
  updateModelLabels();
  resizeInput();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
