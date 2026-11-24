(() => {
  'use strict';

  const state = {
    overview: null,
    hospitals: [],
    currentPage: 'index',
    viewMode: 'before', // before | after | compare | wechat
    elderlyFilter: false,
    srActive: false,
    srItemsBefore: [],
    srItemsAfter: [],
    srIndex: -1,
    srAutoTimer: null,
    modalOpen: true,
    selectedDefectId: null,
    showAllDefects: false,
    diffByFile: {},
    lastReportMd: '',
    hospitalFilter: 'all',
    selectedHospitalSlug: null,
    hospitalShotView: 'desktop', // desktop | mobile
    b3LastImageObj: null,
    b3LastResult: null,
  };

  const PAGE_META = {
    index: { route: 'pages/index/index', label: '① 选医院' },
    departments: { route: 'pages/departments/departments', label: '② 选科室' },
    doctors: { route: 'pages/doctors/doctors', label: '③ 选医生' },
    confirm: { route: 'pages/confirm/confirm', label: '④ 核对提交' },
  };

  const DEFECT_FIX_NOTES = {
    D01: '修复前仅 28rpx(=14px)；修复后升至 36rpx(=18px)，符合适老提示字号要求。',
    D02: '修复前长正文仅 38rpx(=19px)；修复后升至 40rpx(=20px) 并加大行距。',
    D03: '修复前浅灰 #aaaaaa 在白底对比度仅 2.32:1；修复后改为 #595959（7.0:1，注：4.5:1 依据 WCAG 1.4.3 / 工信部附件2 / 微信规范，非 GB/T 37668-2019 条文）。',
    D04: '修复前收藏钮仅 30×30px；修复后扩大至 44×44px（88×88rpx）防误触。',
    D05: '修复前扫码按钮内只有图标无 aria-label；修复后补齐 aria-label="扫码"。',
    D06: '修复前三个快捷图标无任何可见文字；修复后图标下方补齐「发热门诊 / 儿科 / 眼科」中文标签。',
    D07: '修复前弹窗关闭 × 仅 16×16px 贴角；修复后扩至 44×44px 并新增底部「我知道了」大按钮（微信 v2 实测另暴露 184px 宽度回归）。',
    D08: '修复前必须拖动滑块过验证；修复后新增「无法拖动？改用短信或语音验证」替代入口（本地演示占位，待接后台）。',
    D09: '修复前源码把提交按钮写在 DOM 第1位再用 CSS order:9 推到底部，造成读屏顺序混乱；修复后删除 order:9 并把提交按钮移回源码末位。',
    D10: '修复前号源时段用 <view bindtap> 无按钮语义；修复后补充 role="button" 与完整 aria-label（且证明纯运行时模拟器会漏检此项）。',
    D11: '修复前仅靠红/绿圆点区分有号与约满；修复后圆点旁新增可见中文「有号 / 约满」及 aria-label。',
    D12: '修复前身份证框只有 placeholder，输入即消失；修复后新增独立可见标签「就诊人身份证号」与 aria-label。',
  };

  const WF_ZH_LABELS = {
    n1_intake: '① 入口校验与路由',
    n2_web: '② 通道A 网页体检',
    n3_b3: '③ 通道B3 截图视觉',
    n4_elderly: '④ 老年人画像推理',
    n5_blind: '⑤ 视障读屏推理',
    n6_patch: '⑥ 生成修复补丁',
    n6b_verify: '⑦ 沙箱回归复测',
    n7_report: '⑧ 汇总预评测报告',
  };

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const STATIC = window.CARELENS_STATIC === true;

  function staticRoute(url, options) {
    const method = (options.method || 'GET').toUpperCase();
    let body = {};
    try { body = options.body ? JSON.parse(options.body) : {}; } catch (_) {}
    if (method === 'GET') {
      if (/^api\/demo\/(domestic-hospital|sample-screenshot)\//.test(url)) return url + '.json';
      if (url === 'api/demo/overview' || url === 'api/demo/domestic-hospitals') return url + '.json';
      return url;
    }
    if (url === 'api/v1/patch/generate') {
      return body.target === 'web'
        ? `api/v1/patch/generate_web_${body.web_cached_slug}.json`
        : 'api/v1/patch/generate_mp.json';
    }
    if (url === 'api/v1/patch/verify') {
      return body.run_render ? 'api/v1/patch/verify_deep.json' : 'api/v1/patch/verify_fast.json';
    }
    if (url === 'api/v1/report/generate') return 'api/v1/report/generate.json';
    if (url === 'invocations') return 'api/v1/invocations.json';
    if (url === 'api/v1/audit/screenshots') {
      const name = (body.images && body.images[0] && body.images[0].name) || '';
      return `api/v1/audit/screenshots_${name}.json`;
    }
    return url;
  }

  async function apiJson(url, options = {}) {
    if (STATIC) {
      const target = staticRoute(url, options);
      const r = await fetch(target);
      if (!r.ok) {
        if (url === 'api/v1/audit/screenshots') {
          throw new Error('静态演示版只支持内置样例截图的预存结果；分析自选截图请在本地运行体验台。');
        }
        if (url === 'api/v1/patch/generate') {
          throw new Error('该页面无预存的 Web 修复建议（如被 WAF 拦截的目标）。');
        }
        throw new Error('HTTP ' + r.status);
      }
      return r.json();
    }
    const resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
    if (!resp.ok) {
      throw new Error((data && (data.detail || data.response)) || ('HTTP ' + resp.status));
    }
    return data;
  }

  // ---------- Tab Navigation ----------
  function initTabs() {
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        document.querySelectorAll('.nav-tab').forEach(b => {
          const active = b.dataset.tab === target;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', String(active));
        });
        document.querySelectorAll('.tab-panel').forEach(p => {
          p.classList.toggle('active', p.id === 'tab-' + target);
        });
      });
    });
  }

  // ---------- Tab 1: Interactive Miniapp Lab ----------
  function getActivePreviewFrames() {
    if (state.viewMode === 'before') {
      return [document.getElementById('phone-frame-single')];
    }
    if (state.viewMode === 'after') {
      return [document.getElementById('phone-frame-single')];
    }
    if (state.viewMode === 'compare') {
      return [
        document.getElementById('phone-frame-before'),
        document.getElementById('phone-frame-after'),
      ];
    }
    return [];
  }

  function postToFrames(msg) {
    getActivePreviewFrames().forEach(frame => {
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage(msg, '*');
      }
    });
  }

  function syncLabView() {
    const singleWrap = document.getElementById('single-phone-wrap');
    const compareWrap = document.getElementById('compare-phones-wrap');
    const wechatWrap = document.getElementById('wechat-sim-wrap');
    const modalBtn = document.getElementById('btn-toggle-modal');

    document.querySelectorAll('#page-steps .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.page === state.currentPage);
    });
    document.querySelectorAll('#view-modes .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === state.viewMode);
    });

    modalBtn.classList.toggle('hidden', state.currentPage !== 'doctors' || state.viewMode === 'wechat');

    singleWrap.classList.toggle('hidden', state.viewMode !== 'before' && state.viewMode !== 'after');
    compareWrap.classList.toggle('hidden', state.viewMode !== 'compare');
    wechatWrap.classList.toggle('hidden', state.viewMode !== 'wechat');

    if (state.viewMode === 'before' || state.viewMode === 'after') {
      const f = document.getElementById('phone-frame-single');
      const label = document.getElementById('single-phone-label');
      const route = document.getElementById('single-phone-route');
      label.textContent = state.viewMode === 'before' ? '修复前（12坑原版） · 375px' : '修复后（青囊补丁版） · 375px';
      route.textContent = PAGE_META[state.currentPage].route;
      const targetSrc = `api/demo/preview/${state.viewMode}/${state.currentPage}.html`;
      if (!f.getAttribute('src') || f.getAttribute('src') !== targetSrc) {
        f.setAttribute('src', targetSrc);
      }
    } else if (state.viewMode === 'compare') {
      const fb = document.getElementById('phone-frame-before');
      const fa = document.getElementById('phone-frame-after');
      const srcB = `api/demo/preview/before/${state.currentPage}.html`;
      const srcA = `api/demo/preview/after/${state.currentPage}.html`;
      if (fb.getAttribute('src') !== srcB) fb.setAttribute('src', srcB);
      if (fa.getAttribute('src') !== srcA) fa.setAttribute('src', srcA);
    } else if (state.viewMode === 'wechat') {
      const imgB = document.getElementById('img-wechat-before');
      const imgA = document.getElementById('img-wechat-after');
      const fname = `automator_${state.currentPage}.png`;
      imgB.src = `api/demo/evidence-image/automator_before/${fname}`;
      imgA.src = `api/demo/evidence-image/automator_after/${fname}`;
    }

    stopSrAuto();
    state.srIndex = -1;
    updateSrDisplay(null);
    renderDefectList();
  }

  function renderDefectList() {
    const container = document.getElementById('defect-list');
    const title = document.getElementById('defect-panel-title');
    if (!state.overview || !state.overview.ground_truth) {
      container.innerHTML = '<div class="empty-state">加载缺陷清单中...</div>';
      return;
    }
    const allDefects = state.overview.ground_truth.defects || [];
    const route = PAGE_META[state.currentPage].route;
    const filtered = state.showAllDefects ? allDefects : allDefects.filter(d => d.page === route);

    title.textContent = state.showAllDefects
      ? `全部预埋缺陷清单 (${filtered.length} 项)`
      : `${PAGE_META[state.currentPage].label} · 本页缺陷 (${filtered.length} 项)`;

    if (!filtered.length) {
      container.innerHTML = '<div class="empty-state">当前页面无预埋缺陷</div>';
      return;
    }

    container.innerHTML = filtered.map(d => {
      const selected = state.selectedDefectId === d.id ? ' selected' : '';
      const stdText = (d.standards || []).join(' ｜ ');
      return `
        <div class="defect-card${selected}" data-defect-id="${esc(d.id)}" data-defect-page="${esc(d.page)}" data-el-ids="${esc((d.element_ids || []).join(','))}">
          <div class="defect-top">
            <div class="defect-badges">
              <span class="badge-id">${esc(d.id)} · ${esc(d.rule)}</span>
              <span class="badge-persona">卡点群体：${esc(d.persona)}</span>
            </div>
            <span class="badge-page">${esc(d.page.replace('pages/', ''))}</span>
          </div>
          <div class="defect-title">${esc(d.title)}</div>
          <div class="defect-impl"><strong>修复前现状：</strong>${esc(d.implementation)}</div>
          <div class="defect-fix"><strong>青囊怎么修：</strong>${esc(DEFECT_FIX_NOTES[d.id] || '')}</div>
          <div class="defect-std"><strong>标准依据：</strong>${esc(stdText)}</div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.defect-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.defectId;
        const pageRoute = card.dataset.defectPage;
        const pageKey = Object.keys(PAGE_META).find(k => PAGE_META[k].route === pageRoute);
        const ids = (card.dataset.elIds || '').split(',').filter(Boolean);
        state.selectedDefectId = id;
        if (pageKey && pageKey !== state.currentPage) {
          state.currentPage = pageKey;
          syncLabView();
          setTimeout(() => postToFrames({ type: 'highlight', ids }), 320);
        } else {
          if (state.viewMode === 'wechat') {
            state.viewMode = 'before';
            syncLabView();
            setTimeout(() => postToFrames({ type: 'highlight', ids }), 320);
          } else {
            postToFrames({ type: 'highlight', ids });
          }
          renderDefectList();
        }
      });
    });
  }

  function getActiveSrItems() {
    if (state.viewMode === 'after') return state.srItemsAfter;
    return state.srItemsBefore;
  }

  function speakZh(text) {
    const chk = document.getElementById('chk-sr-tts');
    if (!chk || !chk.checked || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  function updateSrDisplay(itemsOverride) {
    const items = itemsOverride || getActiveSrItems();
    const counter = document.getElementById('sr-step-counter');
    const spokenEl = document.getElementById('sr-spoken-text');
    const diagEl = document.getElementById('sr-diag-text');
    if (!items || !items.length) {
      counter.textContent = '第 0 / 0 步';
      return;
    }
    if (state.srIndex < 0 || state.srIndex >= items.length) {
      counter.textContent = `第 0 / ${items.length} 步`;
      spokenEl.textContent = `本页共识别到 ${items.length} 个读屏焦点节点。点击「下一项 (Tab)」按源码 DOM 顺序依次模拟朗读。`;
      diagEl.textContent = state.currentPage === 'confirm' && state.viewMode !== 'after'
        ? '提示：在修复前版本中，第 1 个按钮就是视觉在最底部的「提交预约」（D09 错位）！'
        : '点击按钮开始逐步听读。';
      diagEl.style.color = '#0369a1';
      return;
    }
    const item = items[state.srIndex];
    counter.textContent = `第 ${state.srIndex + 1} / ${items.length} 步`;
    spokenEl.textContent = `🔊 读屏播报：「${item.spoken}」`;
    diagEl.textContent = (item.isDefect ? '⚠️ 障碍诊断：' : '✅ 正常：') + item.diag;
    diagEl.style.color = item.isDefect ? '#be123c' : '#047857';
  }

  function stepSr(delta) {
    const items = getActiveSrItems();
    if (!items.length) {
      postToFrames({ type: 'srQueryOrder' });
      return;
    }
    let next = state.srIndex + delta;
    if (next >= items.length) next = 0;
    if (next < 0) next = items.length - 1;
    state.srIndex = next;
    postToFrames({ type: 'srFocusStep', index: next });
    updateSrDisplay(items);
    speakZh(items[next].spoken);
  }

  function stopSrAuto() {
    if (state.srAutoTimer) {
      clearInterval(state.srAutoTimer);
      state.srAutoTimer = null;
      const btn = document.getElementById('btn-sr-auto');
      if (btn) btn.textContent = '▶ 自动连播';
    }
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
  }

  function initLabEvents() {
    document.querySelectorAll('#page-steps .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.currentPage = btn.dataset.page;
        state.selectedDefectId = null;
        syncLabView();
      });
    });

    document.querySelectorAll('#view-modes .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.viewMode = btn.dataset.mode;
        syncLabView();
      });
    });

    document.getElementById('btn-elderly-filter').addEventListener('click', (e) => {
      state.elderlyFilter = !state.elderlyFilter;
      e.currentTarget.setAttribute('aria-pressed', String(state.elderlyFilter));
      e.currentTarget.textContent = state.elderlyFilter
        ? '👴 模拟老人低视力视角：开'
        : '👴 模拟老人低视力视角：关';
      postToFrames({ type: 'elderlyFilter', enabled: state.elderlyFilter });
    });

    document.getElementById('btn-toggle-modal').addEventListener('click', () => {
      state.modalOpen = !state.modalOpen;
      postToFrames({ type: 'toggleModal', show: state.modalOpen });
      setTimeout(() => postToFrames({ type: 'srQueryOrder' }), 120);
    });

    document.getElementById('btn-clear-highlight').addEventListener('click', () => {
      state.selectedDefectId = null;
      postToFrames({ type: 'clearHighlight' });
      renderDefectList();
    });

    document.getElementById('chk-show-all-defects').addEventListener('change', (e) => {
      state.showAllDefects = !!e.target.checked;
      renderDefectList();
    });

    document.getElementById('btn-sr-mode').addEventListener('click', () => {
      state.srActive = !state.srActive;
      document.getElementById('btn-sr-mode').setAttribute('aria-pressed', String(state.srActive));
      document.getElementById('sr-bar').classList.toggle('hidden', !state.srActive);
      if (state.srActive) {
        if (state.viewMode === 'wechat') {
          state.viewMode = 'before';
          syncLabView();
        }
        state.srIndex = -1;
        postToFrames({ type: 'srQueryOrder' });
      } else {
        stopSrAuto();
        postToFrames({ type: 'srReset' });
      }
    });

    document.getElementById('btn-sr-next').addEventListener('click', () => stepSr(1));
    document.getElementById('btn-sr-prev').addEventListener('click', () => stepSr(-1));
    document.getElementById('btn-sr-auto').addEventListener('click', (e) => {
      if (state.srAutoTimer) {
        stopSrAuto();
        return;
      }
      e.currentTarget.textContent = '⏸ 停止连播';
      stepSr(1);
      state.srAutoTimer = setInterval(() => stepSr(1), 2800);
    });
    document.getElementById('btn-sr-close').addEventListener('click', () => {
      state.srActive = false;
      stopSrAuto();
      document.getElementById('btn-sr-mode').setAttribute('aria-pressed', 'false');
      document.getElementById('sr-bar').classList.add('hidden');
      postToFrames({ type: 'srReset' });
    });

    window.addEventListener('message', (ev) => {
      const d = ev.data || {};
      if (d.type === 'carelens:ready') {
        if (d.variant === 'before') state.srItemsBefore = d.items || [];
        if (d.variant === 'after') state.srItemsAfter = d.items || [];
        if (typeof d.modalOpen === 'boolean') state.modalOpen = d.modalOpen;
        postToFrames({ type: 'elderlyFilter', enabled: state.elderlyFilter });
        updateSrDisplay();
      } else if (d.type === 'carelens:srInfo') {
        if (d.variant === 'before') state.srItemsBefore = d.items || [];
        if (d.variant === 'after') state.srItemsAfter = d.items || [];
        if (typeof d.activeIndex === 'number' && d.activeIndex >= 0) {
          state.srIndex = d.activeIndex;
        }
        updateSrDisplay(d.items || []);
      } else if (d.type === 'carelens:navigate' && d.page && PAGE_META[d.page]) {
        state.currentPage = d.page;
        state.selectedDefectId = null;
        syncLabView();
      } else if (d.type === 'carelens:modalState') {
        state.modalOpen = !!d.open;
      }
    });
  }

  // ---------- Tab 2: Closed-Loop Pipeline ----------
  function renderWorkflowNodes(activeIds = [], doneIds = []) {
    const strip = document.getElementById('workflow-strip');
    if (!state.overview || !state.overview.workflow) return;
    const nodes = state.overview.workflow.nodes || [];
    strip.innerHTML = nodes.map(n => {
      const cls = activeIds.includes(n.id) ? ' running' : (doneIds.includes(n.id) ? ' done' : '');
      return `
        <div class="wf-node${cls}">
          <div class="wf-node-id">${esc(WF_ZH_LABELS[n.id] || n.id)}</div>
          <div class="wf-node-name">${esc(n.operationId || n.name || n.trace_span)}</div>
          <div class="wf-node-type">${esc(n.endpoint || n.type)}</div>
        </div>
      `;
    }).join('');
  }

  function parseUnifiedDiff(diffText) {
    const files = {};
    let curName = '全部补丁';
    const lines = (diffText || '').split('\n');
    for (const line of lines) {
      if (line.startsWith('--- a/') || line.startsWith('--- ')) {
        const raw = line.replace(/^---\s+(?:a\/)?/, '').trim();
        if (raw) curName = raw;
        if (!files[curName]) files[curName] = [];
        files[curName].push(line);
      } else {
        if (!files[curName]) files[curName] = [];
        files[curName].push(line);
      }
    }
    return files;
  }

  function renderDiffFile(fileKey) {
    const viewer = document.getElementById('diff-viewer');
    const lines = state.diffByFile[fileKey] || [];
    if (!lines.length) {
      viewer.textContent = '暂无 Diff 内容';
      return;
    }
    viewer.innerHTML = lines.map(l => {
      if (l.startsWith('+') && !l.startsWith('+++')) return `<span class="diff-line-add">${esc(l)}</span>`;
      if (l.startsWith('-') && !l.startsWith('---')) return `<span class="diff-line-del">${esc(l)}</span>`;
      if (l.startsWith('@@')) return `<span class="diff-line-hunk">${esc(l)}</span>`;
      return esc(l);
    }).join('\n');

    document.querySelectorAll('#diff-file-tabs .seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.file === fileKey);
    });
  }

  function renderSimpleMarkdown(md) {
    const lines = (md || '').split('\n');
    let html = '';
    let inTable = false;
    let inList = false;

    function fmtInline(s) {
      return esc(s)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
    }

    for (const raw of lines) {
      const line = raw.trimEnd();
      if (line.startsWith('|')) {
        if (inList) { html += '</ul>'; inList = false; }
        const cells = line.split('|').slice(1, -1).map(c => c.trim());
        if (cells.every(c => /^[-:]+$/.test(c))) continue;
        if (!inTable) {
          html += '<div class="report-table-wrap"><table><thead><tr>' + cells.map(c => `<th>${fmtInline(c)}</th>`).join('') + '</tr></thead><tbody>';
          inTable = true;
        } else {
          html += '<tr>' + cells.map(c => `<td>${fmtInline(c)}</td>`).join('') + '</tr>';
        }
        continue;
      }
      if (inTable) { html += '</tbody></table></div>'; inTable = false; }

      if (line.startsWith('- ')) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${fmtInline(line.slice(2))}</li>`;
        continue;
      }
      if (inList) { html += '</ul>'; inList = false; }

      if (!line.trim()) continue;
      if (line.startsWith('### ')) html += `<h3>${fmtInline(line.slice(4))}</h3>`;
      else if (line.startsWith('## ')) html += `<h2>${fmtInline(line.slice(3))}</h2>`;
      else if (line.startsWith('# ')) html += `<h1>${fmtInline(line.slice(2))}</h1>`;
      else if (line.startsWith('> ')) html += `<blockquote>${fmtInline(line.slice(2))}</blockquote>`;
      else html += `<p>${fmtInline(line)}</p>`;
    }
    if (inTable) html += '</tbody></table></div>';
    if (inList) html += '</ul>';
    return html;
  }

  async function runClosedLoop(deepRender = false) {
    const fastBtn = document.getElementById('btn-run-fast-loop');
    const deepBtn = document.getElementById('btn-run-deep-verify');
    fastBtn.disabled = true;
    deepBtn.disabled = true;

    try {
      renderWorkflowNodes(['n1_intake', 'n6_patch'], []);
      const patchRes = await apiJson('api/v1/patch/generate', {
        method: 'POST',
        body: JSON.stringify({
          target: 'miniprogram',
          apply: true,
          miniprogram: { use_benchmark: true },
        }),
      });

      const diffText = patchRes.unified_diff || '';
      const summary = patchRes.summary || {};
      const diffLines = summary.diff_lines != null
        ? summary.diff_lines
        : (diffText ? diffText.trimEnd().split('\n').length : 0);
      document.getElementById('kpi-patches').textContent = `${summary.patched || 0} 处 / ${diffLines} 行`;
      document.getElementById('kpi-patches-note').textContent = `已生成补丁（仅内存，未改原源码）`;

      state.diffByFile = parseUnifiedDiff(diffText);
      const fileKeys = Object.keys(state.diffByFile);
      const tabsEl = document.getElementById('diff-file-tabs');
      tabsEl.innerHTML = fileKeys.map((k, idx) =>
        `<button class="seg-btn${idx === 0 ? ' active' : ''}" data-file="${esc(k)}">${esc(k.split('/').slice(-1)[0])}</button>`
      ).join('');
      tabsEl.querySelectorAll('.seg-btn').forEach(b => {
        b.addEventListener('click', () => renderDiffFile(b.dataset.file));
      });
      if (fileKeys.length) renderDiffFile(fileKeys[0]);
      document.getElementById('diff-summary-text').textContent =
        `实时生成 ${fileKeys.length} 个文件补丁（共 ${diffLines} 行 Unified Diff）`;

      renderWorkflowNodes(['n6b_verify'], ['n1_intake', 'n6_patch']);
      const verifyRes = await apiJson('api/v1/patch/verify', {
        method: 'POST',
        body: JSON.stringify({
          use_benchmark: true,
          run_render: deepRender,
          patched_files: patchRes.patched_files,
        }),
      });

      document.getElementById('kpi-before').textContent = `${verifyRes.before_findings_count} 条告警`;
      const reg = verifyRes.benchmark_regression;
      if (reg) {
        document.getElementById('kpi-after').textContent =
          `${verifyRes.after_findings_count} 条（缺陷 ${reg.defects_before}→${reg.defects_after}）`;
        document.getElementById('kpi-after-note').textContent =
          `模式：${verifyRes.mode} · 零新副作用 · 通过率 ${(reg.detector_pass_rate * 100).toFixed(0)}%`;
        document.getElementById('kpi-honesty').textContent = `axe规则外 ${reg.axe_out_of_taxonomy_after} 条`;
      } else {
        document.getElementById('kpi-after').textContent = `${verifyRes.after_findings_count} 条（静态清零）`;
        document.getElementById('kpi-after-note').textContent =
          `模式：${verifyRes.mode} · 消除了 ${verifyRes.resolved_findings_count} 条告警，0 副作用`;
      }

      renderWorkflowNodes(['n7_report'], ['n1_intake', 'n6_patch', 'n6b_verify']);
      const reportRes = await apiJson('api/v1/report/generate', {
        method: 'POST',
        body: JSON.stringify({
          target_name: '青囊智巡 · 靶场小程序与广州医疗网页本地联合实测',
          web_cached_slugs: ['fsyyy_home', 'gz_platform_hospdetail_1001'],
          include_miniprogram_benchmark: true,
        }),
      });

      state.lastReportMd = reportRes.markdown || '';
      document.getElementById('report-preview').innerHTML = renderSimpleMarkdown(state.lastReportMd);
      document.getElementById('btn-copy-report').disabled = false;
      renderWorkflowNodes([], ['n1_intake', 'n2_web', 'n4_elderly', 'n5_blind', 'n6_patch', 'n6b_verify', 'n7_report']);
    } catch (err) {
      document.getElementById('kpi-after').textContent = '运行出错';
      document.getElementById('kpi-after-note').textContent = err.message;
    } finally {
      fastBtn.disabled = false;
      deepBtn.disabled = false;
    }
  }

  function initPipelineEvents() {
    document.getElementById('btn-run-fast-loop').addEventListener('click', () => runClosedLoop(false));
    document.getElementById('btn-run-deep-verify').addEventListener('click', () => runClosedLoop(true));
    document.getElementById('btn-copy-report').addEventListener('click', async () => {
      if (!state.lastReportMd) return;
      try {
        await navigator.clipboard.writeText(state.lastReportMd);
        const btn = document.getElementById('btn-copy-report');
        btn.textContent = '✓ 已复制';
        setTimeout(() => { btn.textContent = '📋 复制报告'; }, 1800);
      } catch (_) {}
    });

    document.getElementById('btn-test-invocations').addEventListener('click', async () => {
      const box = document.getElementById('invocations-output');
      box.textContent = '正在调用 POST /invocations ...';
      try {
        const res = await apiJson('invocations', {
          method: 'POST',
          body: JSON.stringify({ operation: 'orchestrateOwnedSample', arguments: {} }),
        });
        box.textContent = JSON.stringify(res, null, 2);
      } catch (err) {
        box.textContent = '调用失败：' + err.message;
      }
    });
  }

  // ---------- Tab 3: Domestic Hospitals & B3 Screenshots ----------
  function renderHospitalList() {
    const listEl = document.getElementById('hospital-list');
    const items = state.hospitals.filter(h =>
      state.hospitalFilter === 'all' || h.group === state.hospitalFilter
    );
    listEl.innerHTML = items.map(h => {
      const active = h.slug === state.selectedHospitalSlug ? ' selected' : '';
      const badge = h.blocked
        ? '<span class="pill pill-red">403 WAF 停测</span>'
        : `<span class="pill pill-green">200 · axe ${esc(h.axe_nodes)}</span>`;
      const statLine = h.blocked
        ? `${esc(h.overseas_status)} → 国内 403 如实停测`
        : `<18px文本 ${esc(h.text_lt18)}/${esc(h.text_total)} · <44px点击 ${esc(h.click_lt44)}/${esc(h.click_total)} · Tab停BODY ${esc(h.tab_on_body)}`;
      return `
        <div class="hosp-row${active}" data-slug="${esc(h.slug)}">
          <div class="hosp-row-top">
            <span class="hosp-row-name">${esc(h.name)}</span>
            ${badge}
          </div>
          <div class="hosp-row-meta">${esc(h.group_label)} · ${statLine}</div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.hosp-row').forEach(row => {
      row.addEventListener('click', () => loadHospitalDetail(row.dataset.slug));
    });
  }

  function formatIssueMetric(issue) {
    const m = issue.metric || {};
    switch (issue.rule) {
      case 'FONT_SMALL':
        return `主字号 ${m.dominant_body_font_px}px；文本块 ${m.text_blocks_lt_18px}/${m.text_blocks_total} 小于 18px`;
      case 'TOUCH_SMALL':
        return `可点击控件 ${m.clickable_lt_44x44}/${m.clickable_visible_total} 小于 44×44px`;
      case 'REFLOW':
        return `200%缩放溢出：${m.overflow_at_200pct_640 ? '是' : '否'}；375px手机溢出：${m.overflow_at_375 ? '是' : '否'}`;
      case 'color-contrast':
        return `${m.nodes} 个元素文字与背景对比度不足 4.5:1（依据 WCAG 1.4.3 / 工信部附件2）`;
      case 'WECHAT_REDIRECT':
        return `检测到跳转微信/公众号/小程序提示：${(m.keyword_sentences || []).slice(0, 2).join('；')}`;
      case 'TAB_FOCUS_ON_BODY':
        return `12 次 Tab 键盘走查有 ${m.steps_on_body} 次停在 BODY（是否卡死：${m.focus_stuck ? '是！' : '否'}）`;
      case 'TAB_UNNAMED': {
        const total = m.a11y_tree_interactive ?? 0;
        const unnamed = m.a11y_tree_interactive_unnamed ?? 0;
        const tabUnnamed = m.unnamed_focus_targets_in_12_tabs ?? 0;
        const imgUnnamed = m.images_unnamed ?? 0;
        return `无障碍树共 ${total} 个交互控件，其中 ${unnamed} 个无名字；12次Tab中 ${tabUnnamed} 个无名焦点，无名图片 ${imgUnnamed} 张`;
      }
      case 'WAF_CAPTCHA':
        return issue.detail || '触发拦截，遵循合规红线不绕过';
      default:
        return `${issue.rule}：命中 ${m.nodes != null ? m.nodes + ' 个节点' : JSON.stringify(m)}`;
    }
  }

  async function loadHospitalDetail(slug) {
    state.selectedHospitalSlug = slug;
    renderHospitalList();
    const detailEl = document.getElementById('hospital-detail');
    detailEl.innerHTML = '<div class="empty-state">正在读取真实国内实测证据...</div>';

    try {
      const pkg = await apiJson(`api/demo/domestic-hospital/${encodeURIComponent(slug)}`);
      const elderlyIssues = (pkg.elderly && pkg.elderly.issues) || [];
      const blindIssues = (pkg.blind && pkg.blind.issues) || [];
      const meta = pkg.meta || {};

      let shotHtml = '';
      if (pkg.screenshot_blocked_privacy) {
        shotHtml = `
          <div class="privacy-shield">
            <strong>🛡️ 隐私脱敏保护已激活（HTTP 403 硬拦截）：</strong><br>
            该目标（健康 160）在 2026-11-21 国内实测中触发创宇盾 HTTP 403 WAF 阻断并如实停测。因该拦截图页脚图像自身渲染了客户端公网 IP，本体验台按隐私红线硬拦截原图展示，对外申报前必须打码裁剪；同时严禁复用废止的旧口头计数。
          </div>
        `;
      } else {
        const imgUrl = state.hospitalShotView === 'mobile' && pkg.mobile_img_url
          ? pkg.mobile_img_url
          : pkg.desktop_img_url;
        shotHtml = `
          <div class="hosp-shot-box">
            <div class="hosp-shot-toolbar">
              <strong>真实实测页面截图（2026-11-21 广州移动直连）</strong>
              <div class="segmented">
                <button class="seg-btn${state.hospitalShotView === 'desktop' ? ' active' : ''}" data-shot="desktop">桌面 1280px 实拍</button>
                <button class="seg-btn${state.hospitalShotView === 'mobile' ? ' active' : ''}" data-shot="mobile"${pkg.mobile_img_url ? '' : ' disabled'}>手机 375px 实拍</button>
              </div>
            </div>
            ${imgUrl ? `<img class="hosp-shot-img" src="${esc(imgUrl)}" alt="${esc(meta.name || slug)}实测截图" />` : '<div class="muted">该视图无截图</div>'}
          </div>
        `;
      }

      detailEl.innerHTML = `
        <div class="hosp-detail-head">
          <div>
            <h3>${esc(meta.name || pkg.title || slug)}</h3>
            <div class="muted">${esc(pkg.url || '')} · 出口：${esc(pkg.network_vantage || '')}</div>
          </div>
          <button class="btn-sm btn-sm-primary" id="btn-gen-web-patch" data-slug="${esc(slug)}">🛠️ 为此页生成 Web 修复建议</button>
        </div>

        <p style="margin: 0 0 12px; font-size: 14px;"><strong>实测结论：</strong>${esc(meta.domestic_note || '')}</p>

        <div class="persona-grid">
          <div class="persona-box">
            <h4>👴 老年人画像卡点</h4>
            <ul>${elderlyIssues.map(i => `<li><strong>${esc(i.rule)}：</strong>${esc(formatIssueMetric(i))}</li>`).join('') || '<li>无</li>'}</ul>
          </div>
          <div class="persona-box">
            <h4>🕶️ 全盲读屏画像卡点</h4>
            <ul>${blindIssues.map(i => `<li><strong>${esc(i.rule)}：</strong>${esc(formatIssueMetric(i))}</li>`).join('') || '<li>无</li>'}</ul>
          </div>
        </div>

        ${shotHtml}

        <div id="web-patch-output" class="hidden" style="margin-top: 12px;"></div>
      `;

      detailEl.querySelectorAll('[data-shot]').forEach(b => {
        b.addEventListener('click', () => {
          state.hospitalShotView = b.dataset.shot;
          loadHospitalDetail(slug);
        });
      });

      const patchBtn = document.getElementById('btn-gen-web-patch');
      if (patchBtn) {
        patchBtn.addEventListener('click', async () => {
          const out = document.getElementById('web-patch-output');
          out.classList.remove('hidden');
          out.innerHTML = '<div class="muted">正在调用后端 patch_generator 为该医院生成 Web 修复补丁...</div>';
          try {
            const p = await apiJson('api/v1/patch/generate', {
              method: 'POST',
              body: JSON.stringify({ target: 'web', web_cached_slug: slug }),
            });
            const patches = p.patches || [];
            out.innerHTML = `
              <div class="card" style="background:#f8fafc;">
                <strong>Web 修复建议（共 ${patches.length} 条）：</strong>
                <pre class="json-box" style="margin-top:8px;">${esc(JSON.stringify(patches, null, 2))}</pre>
              </div>
            `;
          } catch (err) {
            out.innerHTML = `<div class="muted">生成失败：${esc(err.message)}</div>`;
          }
        });
      }
    } catch (err) {
      detailEl.innerHTML = `<div class="empty-state">加载失败：${esc(err.message)}</div>`;
    }
  }

  // Channel B3 Canvas & Upload
  function drawB3Canvas(imgObj, regions) {
    const canvas = document.getElementById('b3-canvas');
    const placeholder = document.getElementById('b3-placeholder');
    canvas.width = imgObj.naturalWidth;
    canvas.height = imgObj.naturalHeight;
    canvas.style.display = 'block';
    placeholder.style.display = 'none';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgObj, 0, 0);

    (regions || []).forEach((reg, idx) => {
      const [x, y, w, h] = reg.bbox || [0, 0, 0, 0];
      ctx.save();
      ctx.strokeStyle = '#e11d48';
      ctx.lineWidth = Math.max(2, Math.round(canvas.width / 180));
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = 'rgba(225, 29, 72, 0.88)';
      const badgeW = 28;
      const badgeH = 20;
      ctx.fillRect(x, Math.max(0, y - badgeH), badgeW, badgeH);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText('#' + (idx + 1), x + 4, Math.max(14, y - 5));
      ctx.restore();
    });
  }

  async function analyzeScreenshotBase64(name, base64Data, dataUrl) {
    const resultsEl = document.getElementById('b3-results');
    const vw = parseInt(document.getElementById('b3-viewport-width').value || '375', 10) || 375;
    resultsEl.innerHTML = '<div class="empty-state">正在调用 Pillow+numpy 分块引擎检测局部低对比度风险区...</div>';

    try {
      const imgObj = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = dataUrl;
      });
      state.b3LastImageObj = imgObj;

      const res = await apiJson('api/v1/audit/screenshots', {
        method: 'POST',
        body: JSON.stringify({
          images: [{ name, base64: base64Data }],
          viewport_css_width: vw,
          use_ocr: true,
        }),
      });
      const r = (res.results && res.results[0]) || {};
      state.b3LastResult = r;
      const regions = r.low_contrast_regions || [];
      drawB3Canvas(imgObj, regions);

      resultsEl.innerHTML = `
        <div style="margin-bottom:10px;">
          <span class="pill pill-amber">${esc(r.evidence_level || '视觉级证据')}</span>
          <span class="pill pill-blue">分辨率 ${esc((r.size_px || []).join('×'))} · 耗时 ${esc(r.elapsed_s)}s</span>
        </div>
        <p style="font-size:13px; margin:0 0 8px;">
          <strong>OCR 引擎：</strong>${esc(r.ocr_engine || '无（本地未安装 RapidOCR，仅运行纯像素分块低对比度启发式）')}<br>
          <strong>检出低对比度风险区：</strong>${regions.length} 块（红框已标注在左侧图片上）
        </p>
        <div style="max-height:280px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
          ${regions.slice(0, 12).map((reg, idx) => `
            <div style="border:1px solid #fecdd3; background:#fff1f2; border-radius:8px; padding:7px 10px; font-size:12px;">
              <strong>#${idx + 1} 风险区</strong> · 坐标 [${esc((reg.bbox || []).join(', '))}] · 含 ${esc(reg.tiles)} 个 24px 块 · 最低对比度约 <strong>${esc(reg.min_local_contrast)}:1</strong>
            </div>
          `).join('') || '<div class="muted">未发现超过阈值的分块低对比度区</div>'}
        </div>
        <p class="muted" style="margin-top:8px;">${esc(r.method_note || '')}（注意：B3 视觉覆盖上限 41.67%，不能替代代码级审计）</p>
      `;
    } catch (err) {
      resultsEl.innerHTML = `<div class="empty-state">分析失败：${esc(err.message)}</div>`;
    }
  }

  function initHospitalAndB3Events() {
    document.querySelectorAll('#hospital-filters .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.hospitalFilter = btn.dataset.group;
        document.querySelectorAll('#hospital-filters .seg-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.group === state.hospitalFilter);
        });
        renderHospitalList();
      });
    });

    document.querySelectorAll('[data-sample]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const sample = await apiJson(`api/demo/sample-screenshot/${encodeURIComponent(btn.dataset.sample)}`);
          document.getElementById('b3-viewport-width').value = sample.viewport_css_width || 375;
          await analyzeScreenshotBase64(
            sample.name,
            sample.base64,
            'data:image/png;base64,' + sample.base64
          );
        } catch (err) {
          document.getElementById('b3-results').innerHTML = `<div class="empty-state">加载样例失败：${esc(err.message)}</div>`;
        }
      });
    });

    function handleFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const base64 = dataUrl.split(',')[1] || '';
        analyzeScreenshotBase64(file.name, base64, dataUrl);
      };
      reader.readAsDataURL(file);
    }

    document.getElementById('b3-file-input').addEventListener('change', (e) => {
      handleFile(e.target.files && e.target.files[0]);
    });

    const dz = document.getElementById('b3-dropzone');
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      handleFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });
  }

  // ---------- Tab 4: Overview & Redlines ----------
  function renderOverviewTab() {
    if (!state.overview) return;
    const flags = state.overview.acceptance_flags || {};
    const flagMap = [
      ['local_windows_pass', 'Windows 本地全量闭环'],
      ['wechat_devtools_simulator_pass', '微信 PC 真模拟器 (v2)'],
      ['domestic_web_retest_pass', '国内 13 目标医院直连'],
      ['agentarts_official_eval_50_package_pass', '50 条官方评测包校验'],
      ['agentarts_eval_set_shell_created', 'AgentArts 评测集空壳'],
      ['maas_live_runner_ready', '脱敏 MaaS 脚本就绪'],
      ['agentarts_eval_50_rows_imported', '50 条导入云端控制台 (待传)'],
      ['wechat_real_phone_screen_reader_verified', '真实手机 TalkBack/VoiceOver'],
      ['deployed', '华为云 SWR 镜像部署'],
      ['dependency_services_authorized', '6 项周边云服务授权'],
    ];

    document.getElementById('acceptance-matrix').innerHTML = flagMap.map(([k, label]) => {
      const ok = !!flags[k];
      return `
        <div class="acc-item ${ok ? 'acc-ok' : 'acc-wait'}">
          <span>${esc(label)}</span>
          <strong>${ok ? '✅ 已通过' : '⏳ 待完成'}</strong>
        </div>
      `;
    }).join('');

    const q = state.overview.console_quotas || {};
    document.getElementById('quotas-box').innerHTML = `
      <strong>华为云西南-贵阳一（体验版）配额与费用防线：</strong><br>
      CU：${esc(q.cu || '0/20')} ｜ 应用：${esc(q.applications || '0/50')} ｜ 免费 MaaS：${esc(q.maas_free_tokens || '0/200万')} ｜
      <strong>评测实验免费次数：${esc(q.evaluation_experiments_free || '0/0')}</strong>
    `;

    const actionZh = [
      {
        p0: true,
        title: 'P0 硬截止（2026-11-30 23:59:59 北京时间，不可逆）：',
        body: '登录华为人才在线完成「3 名学生 + 1 名同校指导老师」全实名报名（创新赛赛题 2），并下载官方申报书模板与评分表。',
      },
      {
        p0: false,
        title: 'P1（用户 2 分钟手动零成本操作）：',
        body: '① 打开 AgentArts 评测集 carelens-eval-50-v20261121 手动上传 carelens-eval-50-official-template.xlsx（导入 50 条后暂不点运行 0/0 实验）；② 在 ModelArts Studio 审阅《MaaS 服务声明》核清 200 万免费 Tokens 抵扣后再开通 DeepSeek-V4.1-Flash-1017 并建 1 个 API Key；③ 本机跑 1 次 run_maas_live_once.py --mode maas。',
      },
      {
        p0: false,
        title: 'P1（真机读屏补全）：',
        body: '用真手机扫码预览 work_miniapp / work_miniapp_patched，实测 TalkBack / VoiceOver 读屏，关闭 wechat_real_phone_screen_reader_verified 缺口。',
      },
      {
        p0: false,
        title: 'P2（确认成本防线后再上云）：',
        body: '确认 6 项周边服务授权且默认关闭 LTS（防 500MB 超额计费）→ 配真实 CARELENS_PUBLIC_URL 跑通 deploy_check.py → 推 linux/arm64 镜像到 SWR 抓 1 条云端 Trace 后即停删运行态实例防耗尽 20 CU。',
      },
      {
        p0: false,
        title: 'P3（脱敏与终稿收口）：',
        body: '对外使用前对 jk160_home.png 底部公网 IP 打码裁剪；决定是否修复微信 style:"v2" 184px 按钮截断回归，全部实测证据齐备后再定稿正式申报书。',
      },
    ];
    document.getElementById('action-list').innerHTML = actionZh.map(a => `
      <div class="action-item${a.p0 ? ' p0' : ''}"><strong>${esc(a.title)}</strong>${esc(a.body)}</div>
    `).join('');

    const notClaimed = state.overview.not_claimed || [];
    document.getElementById('not-claimed-list').innerHTML = notClaimed.map(n => `<li>${esc(n)}</li>`).join('');
  }

  // ---------- Bootstrap ----------
  async function boot() {
    initTabs();
    initLabEvents();
    initPipelineEvents();
    initHospitalAndB3Events();

    const pill = document.getElementById('engine-status-pill');
    try {
      const [ov, hosp] = await Promise.all([
        apiJson('api/demo/overview'),
        apiJson('api/demo/domestic-hospitals'),
      ]);
      state.overview = ov;
      state.hospitals = hosp.items || [];
      pill.textContent = '本地真实引擎在线 (127.0.0.1:8787)';

      syncLabView();
      renderWorkflowNodes();
      renderHospitalList();
      if (state.hospitals.length) {
        const fs = state.hospitals.find(h => h.slug === 'fsyyy_home') || state.hospitals[0];
        loadHospitalDetail(fs.slug);
      }
      renderOverviewTab();
    } catch (err) {
      pill.className = 'pill pill-red';
      pill.textContent = '后端连接失败：' + err.message;
    }
  }

  boot();
})();
