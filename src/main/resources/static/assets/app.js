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

/* DeepSeek 官方价目以美元计价，界面按固定汇率折算成人民币，实际以账单为准 */
const USD_TO_CNY = 7.1;
const DEFAULT_ANSWER_FONT_SIZE = 14;
const MIN_ANSWER_FONT_SIZE = 12;
const MAX_ANSWER_FONT_SIZE = 22;
const MAX_ATTACHMENTS = 50;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 25 * 1024 * 1024;
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const TEXT_EXT = new Set(['pdf', 'txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm', 'tex', 'log']);

const LS = {
  config: 'deepseekConfigV2',
  session: 'currentDbSessionId',
  favorites: 'viaScholarFavoritesV1',
  legacySaved: 'mathErrorBook',
  personalPrompt: 'viaScholarPersonalPromptV1',
  answerFontSize: 'viaScholarAnswerFontSizeV1',
  deepThinking: 'viaScholarDeepThinkingV1',
  webSearch: 'viaScholarWebSearchV1'
};

const AVATAR_SVG = '<img src="/assets/brand-mark-black.png" alt="">';
const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const BOOKMARK_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M6 4h12v17l-6-4-6 4V4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const EXPORT_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const EDIT_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="m4 16-.7 4.7L8 20l11-11-3-3L4 16Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m13.5 6.5 3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const REGEN_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const HTML2PDF_URL = 'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.3/dist/html2pdf.bundle.min.js';
const DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js';
const scriptLoads = Object.create(null);

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
  favorites: [],
  favoriteIndex: -1,
  historySessions: [],
  historyEdit: false,
  selectedSessions: new Set(),
  personalPrompt: '',
  answerFontSize: DEFAULT_ANSWER_FONT_SIZE,
  deepThinking: false,
  webSearch: true,
  balanceLoading: false,
  autoScroll: true,
  lastScrollTop: 0,
  hasNewContent: false,
  exportAi: null,
  exporting: false,
  pendingEdit: null,
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
    breaks: false,
    gfm: true,
    renderer: {
      code({ text, lang }) {
        const code = text == null ? '' : String(text);
        let language = (lang || '').trim().split(/\s+/)[0].toLowerCase();
        let body = '';
        if (window.hljs) {
          try {
            if (language && window.hljs.getLanguage(language)) {
              body = window.hljs.highlight(code, {
                language: language, ignoreIllegals: true
              }).value;
            } else if (code.length <= 20000) {
              const auto = window.hljs.highlightAuto(code);
              body = auto.value;
              if (!language) language = auto.language || '';
            }
          } catch (_) { /* 保持转义文本 */ }
        }
        if (!body) body = escapeHtml(code);
        const cls = 'hljs' + (language ? ' language-' + escapeHtml(language) : '');
        return '<pre><code class="' + cls + '">' + body + '</code></pre>';
      }
    }
  });
}

function sanitizeHtml(html) {
  if (!window.DOMPurify) return escapeHtml(html);
  try {
    return window.DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, mathMl: true, svg: true },
      ADD_TAGS: ['annotation', 'semantics'],
      ADD_ATTR: ['encoding']
    });
  } catch (_) {
    return escapeHtml(html);
  }
}

function prepareMarkdown(text) {
  const codeSegments = [];
  const mathSegments = [];
  const token = 'MATHSEG' + Math.random().toString(36).slice(2).toUpperCase() + '_';
  const stashCode = (match) => {
    codeSegments.push(match);
    return token + 'C' + (codeSegments.length - 1) + 'X';
  };
  const stashMath = (match) => {
    mathSegments.push(match);
    return token + 'M' + (mathSegments.length - 1) + 'X';
  };

  let out = text.replace(/```[\s\S]*?```/g, stashCode);
  out = out.replace(/~~~[\s\S]*?~~~/g, stashCode);
  out = out.replace(/`[^`\n]*`/g, stashCode);
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (m, inner) => stashMath('$$' + inner + '$$'));
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (m, inner) => stashMath('$' + inner + '$'));
  out = out.replace(/\$\$[\s\S]*?\$\$/g, stashMath);
  out = out.replace(/(?<!\$)\$[^$\n]+\$(?!\$)/g, stashMath);
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');

  codeSegments.forEach((segment, index) => {
    out = out.split(token + 'C' + index + 'X').join(segment);
  });
  return { text: out, math: mathSegments, token: token };
}

function restoreMath(html, prepared) {
  let out = html;
  prepared.math.forEach((segment, index) => {
    out = out.split(prepared.token + 'M' + index + 'X').join(segment);
  });
  return out;
}

function renderMarkdown(rawText) {
  const text = String(rawText == null ? '' : rawText);
  if (!window.marked) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
  let html;
  try {
    const prepared = prepareMarkdown(text);
    html = restoreMath(window.marked.parse(prepared.text), prepared);
  } catch (_) {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
  html = sanitizeHtml(html);

  const renderMath = window.renderMathInElement
    || (window.katex && window.katex.renderMathInElement);
  if (renderMath) {
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    try {
      renderMath(wrap, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false,
        errorColor: '#d92d20',
        strict: false,
        trust: true,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option']
      });
      html = wrap.innerHTML;
    } catch (_) { /* 保留未渲染的 Markdown */ }
  }
  return sanitizeHtml(html);
}

function extractAnswerTitle(text) {
  const m = String(text || '').match(/^\s*#{1,4}\s+(.+?)\s*$/m);
  if (!m) return '';
  return m[1].replace(/[*_`~#]/g, '').trim().slice(0, 40);
}

function stripAnswerTitle(text) {
  return String(text || '').replace(/^\s*#{1,4}\s+[^\n]*\n+/, '');
}

function parseAnswerMeta(raw) {
  const text = String(raw || '');
  const match = /^\s*<!--\s*via-meta\s*([\s\S]*?)-->\s*/i.exec(text);
  if (!match) return { text: text, meta: null };
  const clean = text.slice(match[0].length);
  let meta = null;
  try {
    meta = JSON.parse(match[1].trim());
  } catch (_) { /* 元数据损坏时忽略 */ }
  return { text: clean, meta: meta && typeof meta === 'object' ? meta : null };
}

const ANSWER_TYPE_LABELS = {
  text: '文本',
  formula: '公式',
  chemistry: '化学方程式',
  code: '代码',
  table: '表格',
  mixed: '综合'
};

function renderAnswerMeta(ai, meta) {
  if (!ai || !ai.tags) return;
  const subject = meta && typeof meta.subject === 'string'
    ? meta.subject.trim().slice(0, 12) : '';
  const type = meta && typeof meta.type === 'string'
    ? (ANSWER_TYPE_LABELS[meta.type] || '') : '';
  const grade = meta && typeof meta.grade === 'string'
    ? meta.grade.trim().slice(0, 8) : '';
  const label = [subject, type].filter(Boolean).join(' · ');
  ai.meta = meta || null;
  ai.tags.textContent = label;
  ai.tags.hidden = !label;
  ai.tags.title = [subject, type, grade].filter(Boolean).join(' · ');
  if (ai.answer) {
    ai.answer.dataset.subject = subject;
    ai.answer.dataset.contentType = meta && meta.type ? meta.type : '';
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

  if (state.pendingEdit) {
    const edit = state.pendingEdit;
    if (!edit.sessionId || edit.sessionId !== state.dbSessionId) {
      cancelEdit(false);
      toast('会话已切换，请重新编辑');
      return;
    }
    try {
      await truncateMessages(edit.sessionId, edit.msgId);
      removeRowsFrom(edit.row);
      state.currentAi = null;
      state.pendingEdit = null;
      hideEditBanner();
    } catch (err) {
      toast('重新编辑失败：' + (err.message || '网络错误'));
      return;
    }
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
  state.autoScroll = true;
  state.hasNewContent = false;
  addUserMessage(text, attachments);

  state.attachments = [];
  state.uploading = false;
  attachments.forEach(a => {
    if (a.previewUrl) state.sentPreviews.push(a.previewUrl);
  });
  renderAttachments();

  const ai = createAiMessage(text);
  updateStatus(ai, state.webSearch ? '正在联网搜索…'
    : (state.deepThinking ? '正在深度思考…' : '正在生成…'));

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
  if (state.personalPrompt) body.customInstructions = state.personalPrompt;
  body.deepThinking = !!state.deepThinking;
  body.webSearch = !!state.webSearch;

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

function addUserMessage(text, attachments, msgId) {
  hideWelcome();
  const row = document.createElement('div');
  row.className = 'msg user';
  row.dataset.rawText = text || '';
  if (msgId) row.dataset.msgId = String(msgId);
  const wrap = document.createElement('div');
  wrap.className = 'user-wrap';
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

  const actions = document.createElement('div');
  actions.className = 'user-actions';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'msg-action act-edit';
  edit.innerHTML = EDIT_SVG + '重新编辑';
  edit.addEventListener('click', () => beginEdit(row));
  actions.appendChild(edit);

  wrap.appendChild(bubble);
  wrap.appendChild(actions);
  row.appendChild(wrap);
  $('#chat-list').appendChild(row);
  scrollToBottom(true);
}

function previousUserRow(row) {
  let el = row ? row.previousElementSibling : null;
  while (el) {
    if (el.classList && el.classList.contains('msg') && el.classList.contains('user')) {
      return el;
    }
    el = el.previousElementSibling;
  }
  return null;
}

function showEditBanner() {
  const el = $('#edit-banner');
  if (el) el.hidden = false;
}

function hideEditBanner() {
  const el = $('#edit-banner');
  if (el) el.hidden = true;
}

function cancelEdit(clearInput) {
  state.pendingEdit = null;
  hideEditBanner();
  if (clearInput) {
    const input = $('#input-box');
    if (input) {
      input.value = '';
      resizeInput();
    }
  }
}

async function syncMessageUserIds() {
  if (!state.dbSessionId) return;
  try {
    const res = await fetch('/api/history/messages/' + state.dbSessionId, { cache: 'no-store' });
    if (!res.ok) return;
    const messages = await res.json();
    if (!Array.isArray(messages)) return;
    const users = messages.filter(m => m.role === 'user');
    const rows = $$('#chat-list .msg.user');
    const count = Math.min(users.length, rows.length);
    for (let i = 0; i < count; i++) {
      rows[i].dataset.msgId = String(users[i].msgId);
      rows[i].dataset.rawText = users[i].content || '';
    }
  } catch (_) { /* 同步失败时保留现有消息ID */ }
}

async function ensureUserMsgId(row) {
  if (!row) return 0;
  let id = Number(row.dataset.msgId);
  if (id) return id;
  await syncMessageUserIds();
  return Number(row.dataset.msgId) || 0;
}

async function truncateMessages(sessionId, fromMessageId) {
  const res = await fetch('/api/history/messages/truncate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: sessionId, fromMessageId: fromMessageId })
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* 忽略 */ }
  if (!res.ok || data.success === false || !data.deleted) {
    throw new Error(data.error || '消息截断失败');
  }
  return data.deleted;
}

function removeRowsFrom(row) {
  const list = $('#chat-list');
  if (!list || !row) return;
  let el = row;
  while (el) {
    const next = el.nextElementSibling;
    list.removeChild(el);
    el = next;
  }
}

async function beginEdit(row) {
  if (!row || state.loading) {
    if (state.loading) toast('正在生成回答，请稍后再编辑');
    return;
  }
  const id = await ensureUserMsgId(row);
  if (!id) {
    toast('这条消息还没有同步，请稍后重试');
    return;
  }
  const input = $('#input-box');
  const text = row.dataset.rawText || '';
  state.pendingEdit = {
    row: row,
    msgId: id,
    text: text,
    sessionId: state.dbSessionId
  };
  input.value = text;
  resizeInput();
  showEditBanner();
  input.focus();
  input.setSelectionRange(text.length, text.length);
}

async function regenerateAnswer(ai) {
  if (!ai) return;
  if (state.loading) {
    toast('正在生成回答，请稍后再试');
    return;
  }
  const userRow = ai.userRow || previousUserRow(ai.row);
  const question = String(ai.question || (userRow && userRow.dataset.rawText) || '').trim();
  if (!userRow || !question) {
    toast('找不到对应的提问');
    return;
  }
  try {
    const id = await ensureUserMsgId(userRow);
    if (id && state.dbSessionId) {
      await truncateMessages(state.dbSessionId, id);
      removeRowsFrom(userRow);
    } else {
      removeRowsFrom(ai.row);
      userRow.remove();
    }
    state.pendingEdit = null;
    hideEditBanner();
    const input = $('#input-box');
    input.value = question;
    resizeInput();
    await sendMessage();
  } catch (err) {
    toast('重新生成失败：' + (err.message || '网络错误'));
  }
}

function createAiMessage(question) {
  hideWelcome();
  const row = document.createElement('div');
  row.className = 'msg ai';
  row.innerHTML =
    '<div class="ai-main">' +
      '<div class="ai-meta">' +
        '<span class="ai-avatar" aria-hidden="true">' + AVATAR_SVG + '</span>' +
        '<span class="ai-name">Pathfinder</span><span class="ai-status">正在连接…</span><span class="ai-tags" hidden></span>' +
      '</div>' +
      '<details class="think" hidden><summary>推理过程</summary><div class="think-body"></div></details>' +
      '<div class="answer"><span class="typing"><i></i><i></i><i></i></span></div>' +
      '<div class="metrics" hidden></div>' +
      '<div class="msg-actions" hidden>' +
        '<button type="button" class="msg-action act-copy">' + COPY_SVG + '复制</button>' +
        '<button type="button" class="msg-action act-save">' + BOOKMARK_SVG + '收藏</button>' +
        '<button type="button" class="msg-action act-regen">' + REGEN_SVG + '重新生成</button>' +
        '<button type="button" class="msg-action act-export">' + EXPORT_SVG + '导出</button>' +
      '</div>' +
    '</div>';
  $('#chat-list').appendChild(row);

  const ai = {
    row: row,
    answer: row.querySelector('.answer'),
    think: row.querySelector('.think'),
    thinkBody: row.querySelector('.think-body'),
    status: row.querySelector('.ai-status'),
    tags: row.querySelector('.ai-tags'),
    metricsEl: row.querySelector('.metrics'),
    actions: row.querySelector('.msg-actions'),
    raw: '',
    thinkRaw: '',
    question: question || '',
    userRow: previousUserRow(row),
    title: '',
    meta: null,
    finished: false,
    smoothBuf: '',
    smoothText: '',
    smoothTimer: null
  };

  row.querySelector('.act-copy').addEventListener('click', () => copyAnswer(ai));
  row.querySelector('.act-save').addEventListener('click', () => saveAnswer(ai));
  row.querySelector('.act-regen').addEventListener('click', () => regenerateAnswer(ai));
  row.querySelector('.act-export').addEventListener('click', () => openExportSheet(ai));
  state.currentAi = ai;
  scrollToBottom(true);
  return ai;
}

function addStaticAi(text, thinkRaw, question, usage) {
  const ai = createAiMessage(question);
  const parsed = parseAnswerMeta(text || '');
  ai.finished = true;
  ai.raw = parsed.text;
  ai.title = extractAnswerTitle(ai.raw);
  ai.answer.classList.add('markdown');
  ai.answer.innerHTML = ai.raw
    ? renderMarkdown(ai.raw, true)
    : '<span class="muted">（空回答）</span>';
  renderAnswerMeta(ai, parsed.meta);
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

function stripStreamingMeta(text) {
  const match = /^\s*<!--\s*via-meta\b/i.exec(text);
  if (!match) return text;
  const end = text.indexOf('-->', match.index + match[0].length);
  if (end < 0) return '';
  return text.slice(end + 3).replace(/^\s+/, '');
}

function findUnclosedMarkdown(text) {
  let i = 0;
  let code = null;
  let math = null;
  while (i < text.length) {
    if (code) {
      if (text.startsWith(code.marker, i)) {
        const len = code.marker.length;
        code = null;
        i += len;
      } else {
        i++;
      }
      continue;
    }
    if (math) {
      if (text.startsWith(math.close, i)) {
        const len = math.close.length;
        math = null;
        i += len;
      } else {
        i++;
      }
      continue;
    }
    if (text.startsWith('```', i) || text.startsWith('~~~', i)) {
      const ch = text[i];
      let j = i;
      while (text[j] === ch) j++;
      const lineStart = text.lastIndexOf('\n', i - 1) + 1;
      const before = text.slice(lineStart, i);
      if (j - i >= 3 && /^[ \t]{0,3}$/.test(before)) {
        code = { marker: ch.repeat(j - i), start: i };
        i = j;
        continue;
      }
    }
    if (text.startsWith('$$', i)) {
      math = { close: '$$', start: i };
      i += 2;
      continue;
    }
    if (text.startsWith('\\[', i)) {
      math = { close: '\\]', start: i };
      i += 2;
      continue;
    }
    if (text.startsWith('\\(', i)) {
      math = { close: '\\)', start: i };
      i += 2;
      continue;
    }
    if (text[i] === '$') {
      math = { close: '$', start: i };
      i++;
      continue;
    }
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    i++;
  }
  if (code) return { index: code.start, type: 'code' };
  if (math) return { index: math.start, type: 'math' };
  return null;
}

function renderStreamingMarkdown(rawText) {
  const text = stripStreamingMeta(rawText);
  const pending = findUnclosedMarkdown(text);
  if (!pending) return renderMarkdown(text);

  const stable = text.slice(0, pending.index);
  const tail = text.slice(pending.index);
  let html = stable ? renderMarkdown(stable) : '';
  if (pending.type === 'code') {
    const body = tail.replace(/^(```|~~~)[^\n]*\n?/, '');
    html += '<pre class="stream-pending stream-pending-code"><code>'
      + escapeHtml(body) + '</code></pre>';
  } else {
    html += '<div class="stream-pending stream-pending-math">'
      + escapeHtml(tail) + '</div>';
  }
  return html;
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
  ai.answer.innerHTML = renderStreamingMarkdown(ai.smoothText);
  if (state.autoScroll) scrollToBottom(false);
  else { state.hasNewContent = true; syncScrollButton(); }
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
  const full = (typeof fullText === 'string' && fullText) ? fullText : (ai.smoothText + ai.smoothBuf);
  const parsed = parseAnswerMeta(full);
  const text = parsed.text;
  ai.smoothText = text;
  ai.smoothBuf = '';
  ai.raw = text;
  ai.title = extractAnswerTitle(text);
  renderAnswerMeta(ai, parsed.meta);

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
  syncMessageUserIds();
  if (state.autoScroll) {
    scrollToBottom(false);
  } else {
    state.hasNewContent = true;
    syncScrollButton();
  }
  if (!stopped) refreshBalance(false);
}

function failAi(ai, message) {
  if (!ai || ai.finished) return;
  ai.finished = true;
  if (ai.smoothTimer) {
    clearInterval(ai.smoothTimer);
    ai.smoothTimer = null;
  }
  const box = document.createElement('div');
  box.className = 'error-box';
  const text = document.createElement('span');
  text.textContent = message;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'error-retry';
  retry.textContent = '重新生成';
  retry.addEventListener('click', () => regenerateAnswer(ai));
  box.appendChild(text);
  box.appendChild(retry);
  ai.answer.innerHTML = '';
  ai.answer.appendChild(box);
  updateStatus(ai, '调用失败', true);
  ai.actions.hidden = true;
  state.lastAnswer = '';
  syncMessageUserIds();
  if (state.autoScroll) {
    scrollToBottom(false);
  } else {
    state.hasNewContent = true;
    syncScrollButton();
  }
}

/* ---------------- 用量指标 ---------------- */

function formatInt(value) {
  const n = Number(value || 0);
  return n.toLocaleString('zh-CN');
}

function formatCostCny(usd) {
  const n = Number(usd || 0) * USD_TO_CNY;
  if (n >= 0.01) return '¥' + n.toFixed(4);
  if (n >= 0.000001) return '¥' + n.toFixed(6);
  return '¥' + n.toFixed(8);
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
      const costText = formatCostCny(metrics.costUsd);
      const item = document.createElement('span');
      item.className = 'metric cost';
      item.title = '按 DeepSeek 官方美元价 × ' + USD_TO_CNY + ' 折算（' + peak + '，节假日未计入），实际以账单为准';
      const name = document.createElement('b');
      name.textContent = '费用';
      const val = document.createElement('strong');
      val.textContent = '≈ ' + costText;
      item.appendChild(name);
      item.appendChild(val);
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

function isNearBottom(threshold = 120) {
  const el = $('#chat-scroll');
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

function scrollToBottom(force) {
  const el = $('#chat-scroll');
  if (!el) return;
  if (force) state.autoScroll = true;
  if (force || state.autoScroll) {
    el.scrollTop = el.scrollHeight;
    state.hasNewContent = false;
    $('#scroll-bottom').classList.remove('show', 'has-new');
  }
}

function syncScrollButton() {
  const el = $('#chat-scroll');
  const btn = $('#scroll-bottom');
  if (!el || !btn) return;

  const next = el.scrollTop;
  const goingUp = next < state.lastScrollTop - 2;
  if (goingUp) {
    state.autoScroll = false;
  } else if (isNearBottom()) {
    state.autoScroll = true;
    state.hasNewContent = false;
  }
  state.lastScrollTop = next;

  const show = el.scrollHeight > el.clientHeight + 240 && !isNearBottom();
  btn.classList.toggle('show', show);
  btn.classList.toggle('has-new', show && state.hasNewContent);
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
  state.autoScroll = true;
  state.hasNewContent = false;
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
  state.historySessions = Array.isArray(sessions) ? sessions : [];
  const wrap = $('#history-list');
  if (!wrap) return;

  const ids = new Set(state.historySessions.map(s => String(s.sessionId)));
  Array.from(state.selectedSessions).forEach(id => {
    if (!ids.has(id)) state.selectedSessions.delete(id);
  });
  if (state.historyEdit && !state.historySessions.length) {
    state.historyEdit = false;
    state.selectedSessions.clear();
  }

  wrap.innerHTML = '';
  if (!state.historySessions.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = '还没有历史对话。发送第一条消息后会自动保存。';
    wrap.appendChild(empty);
    updateHistoryEditUI();
    return;
  }

  let currentGroup = '';
  state.historySessions.forEach(s => {
    const date = new Date(s.updateTime || s.createTime || '');
    const group = groupLabel(date);
    if (group !== currentGroup) {
      currentGroup = group;
      const label = document.createElement('div');
      label.className = 'history-group-label';
      label.textContent = group;
      wrap.appendChild(label);
    }

    const key = String(s.sessionId);
    const item = document.createElement('div');
    item.className = 'history-item'
      + (Number(s.sessionId) === Number(state.dbSessionId) ? ' active' : '')
      + (state.historyEdit ? ' editing' : '')
      + (state.selectedSessions.has(key) ? ' selected' : '');
    item.dataset.id = key;

    if (state.historyEdit) {
      const check = document.createElement('span');
      check.className = 'h-check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = state.selectedSessions.has(key);
      box.tabIndex = -1;
      check.appendChild(box);
      item.appendChild(check);
    }

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
    item.appendChild(main);

    if (!state.historyEdit) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'h-del';
      del.setAttribute('aria-label', '删除对话');
      del.innerHTML = TRASH_SVG;
      item.appendChild(del);
    }

    wrap.appendChild(item);
  });

  updateHistoryEditUI();
}

function updateHistoryEditUI() {
  const edit = $('#history-edit');
  if (edit) {
    edit.textContent = state.historyEdit ? '完成' : '编辑';
    edit.disabled = !state.historySessions.length;
  }
  const bar = $('#history-edit-bar');
  if (bar) bar.hidden = !state.historyEdit;

  const total = state.historySessions.length;
  const selected = state.selectedSessions.size;
  const all = $('#history-select-all');
  if (all) {
    all.checked = total > 0 && selected === total;
    all.indeterminate = selected > 0 && selected < total;
    all.disabled = total === 0;
  }
  const del = $('#history-delete-selected');
  if (del) {
    del.disabled = selected === 0;
    del.textContent = selected ? '删除 (' + selected + ')' : '删除';
  }
}

function setHistoryEdit(on) {
  if (on && !state.historySessions.length) {
    toast('还没有可编辑的对话');
    return;
  }
  state.historyEdit = !!on;
  if (!state.historyEdit) state.selectedSessions.clear();
  renderSessions(state.historySessions);
}

function toggleSessionSelection(id) {
  const key = String(id);
  if (state.selectedSessions.has(key)) {
    state.selectedSessions.delete(key);
  } else {
    state.selectedSessions.add(key);
  }
  const item = $$('.history-item').find(el => el.dataset.id === key);
  if (item) {
    item.classList.toggle('selected', state.selectedSessions.has(key));
    const box = item.querySelector('input[type="checkbox"]');
    if (box) box.checked = state.selectedSessions.has(key);
  }
  updateHistoryEditUI();
}

function selectAllSessions(checked) {
  state.selectedSessions = checked
    ? new Set(state.historySessions.map(s => String(s.sessionId)))
    : new Set();
  renderSessions(state.historySessions);
}

async function deleteSelectedSessions() {
  const ids = Array.from(state.selectedSessions).map(Number).filter(Boolean);
  if (!ids.length) {
    toast('先选择要删除的对话');
    return;
  }
  if (!confirm('删除选中的 ' + ids.length + ' 条对话？删除后无法恢复。')) return;

  try {
    const res = await fetch('/api/history/sessions/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json().catch(() => ({}));
    const deleted = data && data.deleted != null ? Number(data.deleted) : ids.length;
    const currentDeleted = ids.includes(Number(state.dbSessionId));
    state.historyEdit = false;
    state.selectedSessions.clear();
    if (currentDeleted) newChat();
    await loadSessions();
    toast('已删除 ' + deleted + ' 条对话');
  } catch (_) {
    toast('删除失败，请稍后重试');
  }
}

function markActiveSession() {
  $$('.history-item').forEach(item => {
    item.classList.toggle('active', Number(item.dataset.id) === Number(state.dbSessionId));
  });
}

async function openSession(id, silent) {
  if (!id) return;
  if (state.pendingEdit) cancelEdit(true);
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
    state.autoScroll = true;
    state.hasNewContent = false;
    let lastUser = '';
    messages.forEach(m => {
      if (m.role === 'user') {
        lastUser = m.content || '';
        addUserMessage(lastUser, null, m.msgId);
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
  if (state.pendingEdit) cancelEdit(false);
  if (state.historyEdit) setHistoryEdit(false);
  if (state.abort) {
    try { state.abort.abort(); } catch (_) { /* 忽略 */ }
  }
  setLoading(false);
  state.dbSessionId = null;
  localStorage.removeItem(LS.session);
  state.autoScroll = true;
  state.hasNewContent = false;
  clearChat();
  closeDrawer();
  markActiveSession();
  const input = $('#input-box');
  input.value = '';
  resizeInput();
  input.focus();
}

/* ---------------- 我的收藏 ---------------- */

function loadFavorites() {
  let list = [];
  try {
    const raw = localStorage.getItem(LS.favorites);
    if (raw) {
      list = JSON.parse(raw);
    } else {
      const legacy = JSON.parse(localStorage.getItem(LS.legacySaved) || '[]');
      if (Array.isArray(legacy)) {
        list = legacy.map(item => ({
          title: item.title || extractAnswerTitle(item.answer)
            || String(item.question || '').slice(0, 30) || '回答收藏',
          question: item.question || '',
          answer: item.answer || '',
          time: item.time || ''
        }));
        if (list.length) {
          try {
            localStorage.setItem(LS.favorites, JSON.stringify(list.slice(0, 100)));
            localStorage.removeItem(LS.legacySaved);
          } catch (_) { /* 忽略 */ }
        }
      }
    }
  } catch (_) {
    list = [];
  }
  state.favorites = Array.isArray(list) ? list.slice(0, 100) : [];
  renderFavorites();
}

function saveFavorites() {
  try {
    localStorage.setItem(LS.favorites, JSON.stringify(state.favorites.slice(0, 100)));
  } catch (_) { /* 忽略 */ }
}

function renderFavorites() {
  const wrap = $('#favorite-list');
  const count = $('#favorite-count');
  if (count) count.textContent = String(state.favorites.length);
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!state.favorites.length) {
    const empty = document.createElement('div');
    empty.className = 'favorite-empty';
    empty.textContent = '在回答下方点「收藏」，答案会保存在这里。';
    wrap.appendChild(empty);
    return;
  }
  state.favorites.forEach((item, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'favorite-item';
    btn.dataset.index = String(index);
    const title = document.createElement('span');
    title.className = 'ft';
    title.textContent = item.title || item.question || '回答收藏';
    const meta = document.createElement('span');
    meta.className = 'fm';
    meta.textContent = item.time || '';
    btn.appendChild(title);
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
  const exists = state.favorites.some(item => item.answer === answer && item.question === question);
  if (exists) {
    toast('这条回答已在收藏中');
    return;
  }
  const title = (ai && ai.title) || extractAnswerTitle(answer)
    || question.slice(0, 30) || '回答收藏';
  state.favorites.unshift({
    title: title,
    question: question,
    answer: answer,
    time: new Date().toLocaleString('zh-CN', { hour12: false })
  });
  state.favorites = state.favorites.slice(0, 100);
  saveFavorites();
  renderFavorites();
  toast('已收藏');
}

function openFavorite(index) {
  const item = state.favorites[index];
  if (!item) return;
  state.favoriteIndex = index;
  $('#saved-time').textContent = item.time || '';
  const title = $('#saved-answer-title');
  if (title) {
    title.textContent = item.title || '';
    title.hidden = !item.title;
  }
  const question = $('#saved-question');
  if (question) {
    question.textContent = item.question || '';
    question.hidden = !item.question;
  }
  $('#saved-answer').innerHTML = item.answer
    ? renderMarkdown(stripAnswerTitle(item.answer), true)
    : '<span class="muted">（空回答）</span>';
  $('#saved-overlay').hidden = false;
}

function closeFavorite() {
  $('#saved-overlay').hidden = true;
  state.favoriteIndex = -1;
}

/* ---------------- 个性化设置 ---------------- */

function normalizeAnswerFontSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_ANSWER_FONT_SIZE;
  return Math.min(MAX_ANSWER_FONT_SIZE, Math.max(MIN_ANSWER_FONT_SIZE, Math.round(n)));
}

function applyAnswerFontSize(value) {
  const size = normalizeAnswerFontSize(value);
  state.answerFontSize = size;
  document.documentElement.style.setProperty('--answer-size', size + 'px');
  const label = $('#font-size-value');
  if (label) label.textContent = size + ' px';
  const range = $('#font-size-range');
  if (range && Number(range.value) !== size) range.value = String(size);
}

function setAnswerFontSize(value, persist) {
  applyAnswerFontSize(value);
  if (persist) {
    try {
      localStorage.setItem(LS.answerFontSize, String(state.answerFontSize));
    } catch (_) { /* 忽略 */ }
  }
}

function loadAnswerFontSize() {
  let saved = null;
  try { saved = localStorage.getItem(LS.answerFontSize); } catch (_) { /* 忽略 */ }
  applyAnswerFontSize(saved == null ? DEFAULT_ANSWER_FONT_SIZE : saved);
}

function loadFeaturePrefs() {
  try {
    state.deepThinking = localStorage.getItem(LS.deepThinking) === '1';
    const savedWeb = localStorage.getItem(LS.webSearch);
    state.webSearch = savedWeb === null ? true : savedWeb === '1';
  } catch (_) {
    state.deepThinking = false;
    state.webSearch = true;
  }
  updateFeatureUI();
}

function updateFeatureUI() {
  const think = $('#think-toggle');
  if (think) {
    think.classList.toggle('active', !!state.deepThinking);
    think.setAttribute('aria-pressed', state.deepThinking ? 'true' : 'false');
  }
  const web = $('#web-toggle');
  if (web) {
    web.classList.toggle('active', !!state.webSearch);
    web.setAttribute('aria-pressed', state.webSearch ? 'true' : 'false');
  }
}

function setDeepThinking(on) {
  state.deepThinking = !!on;
  try {
    localStorage.setItem(LS.deepThinking, state.deepThinking ? '1' : '0');
  } catch (_) { /* 忽略 */ }
  updateFeatureUI();
}

function setWebSearch(on) {
  state.webSearch = !!on;
  try {
    localStorage.setItem(LS.webSearch, state.webSearch ? '1' : '0');
  } catch (_) { /* 忽略 */ }
  updateFeatureUI();
}

function loadPersonalPrompt() {
  let value = '';
  try {
    value = localStorage.getItem(LS.personalPrompt) || '';
  } catch (_) { /* 忽略 */ }
  state.personalPrompt = value.slice(0, 2000);
  updatePersonalizeUI();
}

function updatePersonalizeUI() {
  const stateEl = $('#personalize-state');
  if (stateEl) stateEl.textContent = state.personalPrompt ? '已启用' : '未设置';
  const count = $('#personal-count');
  if (count) count.textContent = state.personalPrompt.length + ' / 2000';
}

function openPersonalize() {
  const input = $('#personal-prompt');
  if (input) {
    input.value = state.personalPrompt;
    updatePersonalizeUI();
  }
  applyAnswerFontSize(state.answerFontSize);
  $('#personalize-overlay').hidden = false;
}

function closePersonalize() {
  $('#personalize-overlay').hidden = true;
}

function savePersonalize() {
  const input = $('#personal-prompt');
  const value = (input ? input.value : '').trim().slice(0, 2000);
  state.personalPrompt = value;
  try {
    if (value) localStorage.setItem(LS.personalPrompt, value);
    else localStorage.removeItem(LS.personalPrompt);
  } catch (_) { /* 忽略 */ }
  updatePersonalizeUI();
  closePersonalize();
  toast(value ? '个性化设置已保存' : '已清空个性化设置');
}

function clearPersonalize() {
  const input = $('#personal-prompt');
  if (input) input.value = '';
  state.personalPrompt = '';
  try { localStorage.removeItem(LS.personalPrompt); } catch (_) { /* 忽略 */ }
  updatePersonalizeUI();
  closePersonalize();
  toast('已清空个性化设置');
}

/* ---------------- 导出 ---------------- */

function openExportSheet(ai) {
  if (!ai || !ai.raw) {
    toast('暂无可导出的回答');
    return;
  }
  state.exportAi = ai;
  $('#export-overlay').hidden = false;
}

function closeExportSheet() {
  $('#export-overlay').hidden = true;
  state.exportAi = null;
}

function exportBaseName(ai) {
  const raw = String((ai && (ai.title || ai.question)) || '回答')
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return (raw || '回答').slice(0, 48);
}

function exportTimestamp() {
  const date = new Date();
  const p = n => String(n).padStart(2, '0');
  return date.getFullYear()
    + p(date.getMonth() + 1)
    + p(date.getDate())
    + '_'
    + p(date.getHours())
    + p(date.getMinutes())
    + p(date.getSeconds())
    + '_'
    + String(date.getMilliseconds()).padStart(3, '0');
}

function exportFileName(ai, ext) {
  return exportBaseName(ai) + '_' + exportTimestamp() + '.' + ext;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function buildExportNode(ai, plainFormulas) {
  const title = (ai && (ai.title || ai.question)) || '回答';
  const question = (ai && ai.question) ? String(ai.question).trim() : '';
  const wrap = document.createElement('div');
  wrap.className = 'export-doc';

  const h1 = document.createElement('h1');
  h1.textContent = title;
  wrap.appendChild(h1);

  if (question) {
    const q = document.createElement('p');
    q.className = 'export-question';
    q.textContent = '问题：' + question;
    wrap.appendChild(q);
  }

  const body = document.createElement('div');
  body.className = 'markdown export-body';
  body.innerHTML = renderMarkdown(stripAnswerTitle(ai.raw || ''), true);

  if (plainFormulas) {
    body.querySelectorAll('.katex').forEach(node => {
      const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
      const tex = annotation ? annotation.textContent.trim() : '';
      const visual = node.querySelector('.katex-html');
      const span = document.createElement('span');
      span.className = 'export-formula';
      span.textContent = tex
        ? '$' + tex + '$'
        : (visual ? visual.textContent : (node.textContent || ''));
      node.replaceWith(span);
    });
  }

  wrap.appendChild(body);
  return wrap;
}

function exportTxt(ai) {
  const title = (ai.title || ai.question || '回答').trim();
  const question = (ai.question || '').trim();
  const body = stripAnswerTitle(ai.raw || '').trim();
  const content = [title, question ? '问题：' + question : '', body]
    .filter(Boolean).join('\n\n');
  downloadBlob(
    new Blob(['\ufeff' + content], { type: 'text/plain;charset=utf-8' }),
    exportFileName(ai, 'txt')
  );
  toast('TXT 已导出');
}

function docxRuns(node, options) {
  const D = window.docx;
  const runs = [];
  const base = Object.assign({}, options || {});
  Array.from(node.childNodes || []).forEach(child => {
    if (child.nodeType === 3) {
      const text = String(child.nodeValue || '').replace(/\s+/g, ' ');
      if (text) runs.push(new D.TextRun(Object.assign({ text: text }, base)));
      return;
    }
    if (child.nodeType !== 1) return;
    const tag = child.tagName.toLowerCase();
    const next = Object.assign({}, base);
    if (tag === 'strong' || tag === 'b') next.bold = true;
    if (tag === 'em' || tag === 'i') next.italics = true;
    if (tag === 'del' || tag === 's') next.strike = true;
    if (tag === 'code') {
      next.font = 'Consolas';
      next.size = 20;
      next.shading = { fill: 'F2F2F2' };
    }
    if (child.classList && child.classList.contains('export-formula')) {
      next.font = 'Consolas';
      next.size = 20;
      next.shading = { fill: 'F2F2F2' };
    }
    if (tag === 'br') {
      runs.push(new D.TextRun({ break: 1 }));
      return;
    }
    if (tag === 'img') {
      runs.push(new D.TextRun({ text: '[图片]', italics: true, color: '888888' }));
      return;
    }
    runs.push(...docxRuns(child, next));
  });
  return runs;
}

function docxParagraphFrom(node, options) {
  const D = window.docx;
  const runs = docxRuns(node);
  if (!runs.length) return null;
  return new D.Paragraph(Object.assign({ children: runs }, options || {}));
}

function docxListBlock(node) {
  const D = window.docx;
  const ordered = node.tagName.toLowerCase() === 'ol';
  const blocks = [];
  Array.from(node.children).forEach((li, index) => {
    if (li.tagName.toLowerCase() !== 'li') return;
    const prefix = ordered ? (index + 1) + '. ' : '• ';
    const runs = [new D.TextRun({ text: prefix })].concat(docxRuns(li));
    blocks.push(new D.Paragraph({
      children: runs,
      indent: { left: 360 },
      spacing: { after: 80 }
    }));
  });
  return blocks;
}

function docxTableBlock(node) {
  const D = window.docx;
  const rows = Array.from(node.querySelectorAll('tr')).map(tr => new D.TableRow({
    children: Array.from(tr.children).map(cell => new D.TableCell({
      children: [new D.Paragraph({ children: docxRuns(cell) })],
      shading: cell.tagName.toLowerCase() === 'th' ? { fill: 'F2F2F2' } : undefined
    }))
  }));
  if (!rows.length) return null;
  const border = { style: D.BorderStyle.SINGLE, size: 4, color: 'CCCCCC' };
  return new D.Table({
    rows: rows,
    width: { size: 100, type: D.WidthType.PERCENTAGE },
    borders: {
      top: border, bottom: border, left: border, right: border,
      insideHorizontal: border, insideVertical: border
    }
  });
}

function docxBlocks(container) {
  const D = window.docx;
  const blocks = [];
  const headingMap = {
    h1: D.HeadingLevel.HEADING_1,
    h2: D.HeadingLevel.HEADING_2,
    h3: D.HeadingLevel.HEADING_3,
    h4: D.HeadingLevel.HEADING_4
  };
  Array.from(container.childNodes || []).forEach(child => {
    if (child.nodeType === 3) {
      const text = String(child.nodeValue || '').trim();
      if (text) blocks.push(new D.Paragraph({ children: [new D.TextRun({ text: text })] }));
      return;
    }
    if (child.nodeType !== 1) return;
    const tag = child.tagName.toLowerCase();

    if (headingMap[tag]) {
      const runs = docxRuns(child, { bold: true, color: '000000' });
      if (runs.length) {
        blocks.push(new D.Paragraph({ heading: headingMap[tag], children: runs }));
      }
      return;
    }
    if (tag === 'p') {
      const p = docxParagraphFrom(child, { spacing: { after: 120 } });
      if (p) blocks.push(p);
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      blocks.push(...docxListBlock(child));
      return;
    }
    if (tag === 'pre') {
      const text = String(child.textContent || '').replace(/\n$/, '');
      const lines = text.split('\n');
      const runs = lines.map((line, index) => new D.TextRun({
        text: line || ' ',
        break: index ? 1 : 0,
        font: 'Consolas',
        size: 20
      }));
      blocks.push(new D.Paragraph({
        children: runs,
        shading: { fill: 'F2F2F2' },
        spacing: { after: 160 },
        indent: { left: 180 }
      }));
      return;
    }
    if (tag === 'table') {
      const table = docxTableBlock(child);
      if (table) blocks.push(table);
      return;
    }
    if (tag === 'blockquote') {
      const p = docxParagraphFrom(child, {
        indent: { left: 360 },
        spacing: { after: 140 }
      });
      if (p) blocks.push(p);
      return;
    }
    if (tag === 'hr') {
      blocks.push(new D.Paragraph({
        children: [new D.TextRun({ text: '────────', color: 'CCCCCC' })]
      }));
      return;
    }
    if (tag === 'div' || tag === 'section') {
      blocks.push(...docxBlocks(child));
      return;
    }
    const p = docxParagraphFrom(child, { spacing: { after: 120 } });
    if (p) blocks.push(p);
  });
  return blocks;
}

async function ensureDocx() {
  if (window.docx) return;
  await loadScriptOnce(DOCX_URL);
  if (!window.docx) throw new Error('Word 组件不可用');
}

async function exportWord(ai) {
  try {
    toast('正在生成 Word 文档…');
    await ensureDocx();
    const D = window.docx;
    const node = buildExportNode(ai, true);
    const body = node.querySelector('.export-body');
    const title = (ai.title || ai.question || '回答').trim();
    const question = (ai.question || '').trim();
    const children = [
      new D.Paragraph({
        heading: D.HeadingLevel.TITLE,
        children: [new D.TextRun({ text: title, bold: true, size: 36, color: '000000' })],
        spacing: { after: 120 }
      })
    ];
    if (question) {
      children.push(new D.Paragraph({
        children: [new D.TextRun({
          text: '问题：' + question,
          italics: true,
          color: '666666',
          size: 20
        })],
        spacing: { after: 220 }
      }));
    }
    if (body) children.push(...docxBlocks(body));

    const doc = new D.Document({
      styles: {
        default: {
          document: {
            run: { font: 'Microsoft YaHei', size: 24 },
            paragraph: { spacing: { line: 360, after: 120 } }
          }
        }
      },
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }
          }
        },
        children: children
      }]
    });
    const blob = await D.Packer.toBlob(doc);
    downloadBlob(blob, exportFileName(ai, 'docx'));
    toast('Word 文档已导出');
  } catch (err) {
    console.error(err);
    toast('Word 导出失败，请稍后重试');
  }
}

function loadScriptOnce(src) {
  if (scriptLoads[src]) return scriptLoads[src];
  scriptLoads[src] = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      delete scriptLoads[src];
      reject(new Error('脚本加载失败'));
    };
    document.head.appendChild(script);
  });
  return scriptLoads[src];
}

async function ensureHtml2Pdf() {
  if (window.html2pdf) return;
  await loadScriptOnce(HTML2PDF_URL);
  if (!window.html2pdf) throw new Error('PDF 组件不可用');
}

async function exportPdf(ai) {
  if (state.exporting) {
    toast('正在生成 PDF，请稍候');
    return;
  }
  state.exporting = true;
  let host = null;
  try {
    toast('正在生成 PDF…');
    await ensureHtml2Pdf();
    const node = buildExportNode(ai, false);
    host = document.createElement('div');
    host.className = 'pdf-export-host';
    host.appendChild(node);
    document.body.appendChild(host);
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (_) { /* 忽略 */ }
    }
    await new Promise(resolve => setTimeout(resolve, 120));
    await window.html2pdf().set({
      margin: [12, 12, 12, 12],
      filename: exportFileName(ai, 'pdf'),
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] }
    }).from(node).save();
    toast('PDF 已导出');
  } catch (err) {
    console.error(err);
    toast('PDF 导出失败，请检查网络后重试');
  } finally {
    if (host) host.remove();
    state.exporting = false;
  }
}

/* ---------------- 抽屉 ---------------- */

function openDrawer() {
  document.body.classList.add('drawer-open');
}

function closeDrawer() {
  document.body.classList.remove('drawer-open');
}

function openAttachMenu() {
  if (state.uploading) {
    toast('附件正在上传，请稍候');
    return;
  }
  $('#attach-overlay').hidden = false;
}

function closeAttachMenu() {
  $('#attach-overlay').hidden = true;
}

function closeAllOverlays() {
  if (!$('#model-overlay').hidden) closeModelSheet();
  if (!$('#saved-overlay').hidden) closeFavorite();
  if (!$('#personalize-overlay').hidden) closePersonalize();
  if (!$('#attach-overlay').hidden) closeAttachMenu();
  if (!$('#export-overlay').hidden) closeExportSheet();
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
    const item = event.target.closest('.history-item');
    if (!item) return;
    const id = Number(item.dataset.id);
    if (state.historyEdit) {
      event.preventDefault();
      toggleSessionSelection(id);
      return;
    }
    const del = event.target.closest('.h-del');
    if (del) {
      event.stopPropagation();
      deleteSession(id);
      return;
    }
    openSession(id, false);
  });

  $('#history-edit').addEventListener('click', () => setHistoryEdit(!state.historyEdit));
  $('#history-select-all').addEventListener('change', event => selectAllSessions(event.target.checked));
  $('#history-delete-selected').addEventListener('click', deleteSelectedSessions);

  $('#favorite-list').addEventListener('click', event => {
    const btn = event.target.closest('.favorite-item');
    if (!btn) return;
    openFavorite(Number(btn.dataset.index));
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
    if (!state.autoScroll) return;
    setTimeout(() => scrollToBottom(false), 120);
  });

  $('#attach-btn').addEventListener('click', openAttachMenu);
  $('#attach-close').addEventListener('click', closeAttachMenu);
  $('#attach-overlay').addEventListener('click', event => {
    if (event.target === $('#attach-overlay')) closeAttachMenu();
  });
  $('#attach-camera').addEventListener('click', () => {
    closeAttachMenu();
    $('#camera-input').click();
  });
  $('#attach-album').addEventListener('click', () => {
    closeAttachMenu();
    $('#album-input').click();
  });
  $('#attach-file').addEventListener('click', () => {
    closeAttachMenu();
    $('#file-input').click();
  });
  ['camera-input', 'album-input', 'file-input'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('change', async event => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      await addFiles(files);
    });
  });

  $('#chat-scroll').addEventListener('scroll', syncScrollButton);
  $('#scroll-bottom').addEventListener('click', () => {
    state.autoScroll = true;
    state.hasNewContent = false;
    scrollToBottom(true);
  });

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

  $('#saved-close').addEventListener('click', closeFavorite);
  $('#saved-close-bottom').addEventListener('click', closeFavorite);
  $('#saved-overlay').addEventListener('click', event => {
    if (event.target === $('#saved-overlay')) closeFavorite();
  });
  $('#saved-copy').addEventListener('click', () => {
    const item = state.favorites[state.favoriteIndex];
    if (!item) return;
    copyText(item.answer || '').then(() => toast('已复制答案')).catch(() => toast('复制失败'));
  });
  $('#saved-delete').addEventListener('click', () => {
    if (state.favoriteIndex < 0) return;
    if (!confirm('删除这条收藏？')) return;
    state.favorites.splice(state.favoriteIndex, 1);
    saveFavorites();
    renderFavorites();
    closeFavorite();
    toast('已删除收藏');
  });

  $('#export-close').addEventListener('click', closeExportSheet);
  $('#export-overlay').addEventListener('click', event => {
    if (event.target === $('#export-overlay')) closeExportSheet();
  });
  $('#export-txt').addEventListener('click', () => {
    const ai = state.exportAi;
    closeExportSheet();
    if (ai) exportTxt(ai);
  });
  $('#export-word').addEventListener('click', () => {
    const ai = state.exportAi;
    closeExportSheet();
    if (ai) exportWord(ai);
  });
  $('#export-pdf').addEventListener('click', () => {
    const ai = state.exportAi;
    closeExportSheet();
    if (ai) exportPdf(ai);
  });

  $('#edit-cancel').addEventListener('click', () => cancelEdit(true));
  $('#think-toggle').addEventListener('click', () => setDeepThinking(!state.deepThinking));
  $('#web-toggle').addEventListener('click', () => setWebSearch(!state.webSearch));

  $('#personalize-btn').addEventListener('click', openPersonalize);
  $('#personalize-close').addEventListener('click', closePersonalize);
  $('#personalize-overlay').addEventListener('click', event => {
    if (event.target === $('#personalize-overlay')) closePersonalize();
  });
  $('#personal-save').addEventListener('click', savePersonalize);
  $('#personal-clear').addEventListener('click', clearPersonalize);
  $('#font-size-range').addEventListener('input', event => {
    setAnswerFontSize(event.target.value, true);
  });
  $('#font-size-reset').addEventListener('click', () => {
    setAnswerFontSize(DEFAULT_ANSWER_FONT_SIZE, true);
    toast('已恢复默认字号');
  });
  $('#personal-prompt').addEventListener('input', event => {
    const count = $('#personal-count');
    if (count) count.textContent = event.target.value.length + ' / 2000';
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeAllOverlays();
  });

  window.addEventListener('resize', syncViewport);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      syncViewport();
      if (state.autoScroll && document.activeElement === $('#input-box')) {
        setTimeout(() => scrollToBottom(false), 80);
      }
    });
  }
}

async function init() {
  setupMarked();
  wireEvents();
  syncViewport();
  initConfig();
  loadFeaturePrefs();
  loadAnswerFontSize();
  loadFavorites();
  loadPersonalPrompt();
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
