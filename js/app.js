/* =========================================================
   激活盒子 Activation Box — 交互逻辑
   ---------------------------------------------------------
   职责：
   1. 外观设置：主题颜色（森林绿 / 紫光蓝 / 橙渐白）
                × 明暗模式（白天 / 黑夜）两条独立的轴
   2. 读取「激活密钥」文本域的内容
   3. 校验 + 解析（Base64 → 原始文本，UTF-8 安全）
   4. 写入只读的「激活结果」文本域
   5. 自动复制到剪贴板，并在页面上提示「已复制」
   6. 所有异常给出友好的中文提示，绝不抛出原始错误
   ---------------------------------------------------------
   注意：主题化文案要求 —— 页面内部逻辑命名也用「密钥 / 激活」
   的语义，不暴露底层编解码词汇给用户。
   ========================================================= */

(function () {
  'use strict';

  /* ---------------- DOM 引用 ---------------- */
  const $ = (id) => document.getElementById(id);

  const els = {
    input:       $('inputBox'),
    output:      $('outputBox'),
    outputWrap:  $('outputWrap'),

    inputCount:  $('inputCount'),
    outputCount: $('outputCount'),
    outputHint:  $('outputHint'),

    activateBtn: $('activateBtn'),
    copyBtn:     $('copyBtn'),
    clearBtn:    $('clearBtn'),

    statusBar:   $('statusBar'),
    statusText:  $('statusText'),

    toast:       $('toast'),
    toastIcon:   $('toastIcon'),
    toastText:   $('toastText'),

    themeSwitch: $('themeSwitch'),
    themeGlider: $('themeGlider'),
    modeSwitch:  $('modeSwitch'),
    modeGlider:  $('modeGlider'),
  };

  /* ---------------- 常量配置 ---------------- */

  // 单次可接纳的密钥上限（字符），防止误粘贴超大文件卡住页面。
  // 5 MB 是按"字符数"计的：密钥是纯文本，一个字符基本对应一个字节，
  // 所以 5 MB 的密钥约能解出 3.7 MB 的原始内容。
  const MAX_LEN = 5 * 1024 * 1024;

  // 单次可接纳的密钥上限的展示写法，与 MAX_LEN 保持同步
  const MAX_LEN_LABEL = '5 MB';

  // 状态文案（主题化措辞，避免出现底层术语）
  const MSG = {
    empty:     '盒子是空的 —— 请先粘贴你的激活密钥。',
    tooLong:   `密钥体积过大（超过 ${MAX_LEN_LABEL}），请确认内容是否正确。`,
    onlySpace: '密钥里只有空白字符，请检查是否复制完整。',
    badChar:   (ch) => `密钥中出现了无法识别的字符「${ch}」，请重新复制。`,
    badLength: '密钥长度不合法，可能在复制时被截断了，请重新复制。',
    badFormat: '这段密钥无法被盒子解析，请确认它是一段完整的激活密钥。',
    success:   (n) => `激活成功！已解析出 ${n} 个字符，并复制到剪贴板。`,
    successNoCopy: (n) => `激活成功！已解析出 ${n} 个字符，但自动复制被浏览器拦截，请点「复制结果」。`,
    copied:    '已复制到剪贴板！',
    copyFail:  '复制没有成功，请手动选中结果后使用 Ctrl + C。',
    clear:     '盒子已清空，等待新的激活密钥。',
    idle:      '盒子已就绪，等待你的激活密钥。',
  };

  /* =========================================================
     外观系统
     ---------------------------------------------------------
     外观由两个属性共同决定，各自是一条独立的轴：

       data-theme  主题颜色   forest 森林绿 | violet 紫光蓝 | amber 橙渐白
       data-mode   明暗模式   night 黑夜    | day 白天

     3 × 2 = 6 套完整配色，全部写在 CSS 里（见 style.css 第 1 节）。
     JS 只负责三件事：
       1. 记住选择（两条轴各存一个 key）
       2. 把选中态同步到无障碍语义上（aria-checked / tabindex）
       3. 移动滑动指示器（glider）
     真正的"过渡动画"完全由 CSS 的 transition 完成，
     JS 不参与任何逐帧计算 —— 这样切换是即时的，动画也是连续的。

     两条轴的交互逻辑完全一致，所以抽成一个工厂函数，
     避免把同一段代码抄两遍。
     ========================================================= */

  const THEME_KEY = 'activation-box-theme';
  const MODE_KEY  = 'activation-box-mode';

  const THEMES = ['forest', 'violet', 'amber'];
  const MODES  = ['day', 'night'];

  const DEFAULT_THEME = 'forest';   // 默认主题颜色：森林绿
  const DEFAULT_MODE  = 'day';      // 默认明暗模式：白天（纯白底）

  const THEME_LABEL = { forest: '森林绿', violet: '紫光蓝', amber: '橙渐白' };
  const MODE_LABEL  = { day: '白天', night: '黑夜' };

  const APPEARANCE_KEYS = [THEME_KEY, MODE_KEY];

  /**
   * 初始化一个分段切换控件。
   * @param {object} cfg
   *   root       {HTMLElement} 控件容器
   *   glider     {HTMLElement} 滑动指示器
   *   attr       {string}      写到 <html> 上的属性名
   *   storageKey {string}      localStorage 键
   *   allowed    {string[]}    合法取值（同时作为白名单校验）
   *   fallback   {string}      兜底取值
   * @returns {{apply: Function, realign: Function, read: Function}}
   */
  function initSwitch(cfg) {
    const opts = Array.prototype.slice.call(
      cfg.root.querySelectorAll('[data-value]')
    );

    /** 当前处于选中态的按钮 */
    function current() {
      return opts.filter(function (o) {
        return o.getAttribute('aria-checked') === 'true';
      })[0] || opts[0];
    }

    /**
     * 把滑动指示器对齐到某个选项。
     * instant 为 true 时临时关闭过渡，用于首屏定位与尺寸变化后的重排
     * （否则会看到指示器从上一处滑到新位置的"多余动画"）。
     */
    function moveGlider(opt, instant) {
      if (!opt) return;
      if (instant) cfg.glider.style.transition = 'none';
      cfg.glider.style.width = opt.offsetWidth + 'px';
      cfg.glider.style.transform = 'translateX(' + opt.offsetLeft + 'px)';
      if (instant) {
        void cfg.glider.offsetWidth;      // 强制重排，让上面的定位立即生效
        cfg.glider.style.transition = ''; // 还原，交还给 CSS 的过渡
      }
    }

    /** 应用一个取值 */
    function apply(name, o) {
      o = o || {};
      const value = cfg.allowed.indexOf(name) !== -1 ? name : cfg.fallback;

      // 唯一的全局开关：改这一个属性，整页配色由 CSS 接手过渡
      document.documentElement.setAttribute(cfg.attr, value);

      let target = null;
      opts.forEach(function (opt) {
        const on = opt.getAttribute('data-value') === value;
        opt.setAttribute('aria-checked', on ? 'true' : 'false');
        // 单选组语义：只有选中项进入 Tab 序列，其余用方向键访问
        opt.setAttribute('tabindex', on ? '0' : '-1');
        if (on) target = opt;
      });

      moveGlider(target, !!o.instant);

      try { localStorage.setItem(cfg.storageKey, value); } catch (err) { /* 忽略 */ }

      if (!o.instant) scheduleChromeSync();
      return value;
    }

    // 点击切换
    opts.forEach(function (opt) {
      opt.addEventListener('click', function () {
        apply(opt.getAttribute('data-value'));
      });

      // 方向键切换（单选组的无障碍惯例），在组内循环
      opt.addEventListener('keydown', function (e) {
        const step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1
                   : (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   ? -1
                   : 0;
        if (!step) return;
        e.preventDefault();
        const i = opts.indexOf(opt);
        const next = opts[(i + step + opts.length) % opts.length];
        apply(next.getAttribute('data-value'));
        next.focus();
      });
    });

    // 尺寸变化时重新对齐（窗口缩放、字体加载完成都会改变按钮宽度）
    if (window.ResizeObserver) {
      new ResizeObserver(function () { moveGlider(current(), true); }).observe(cfg.root);
    }
    window.addEventListener('resize', function () { moveGlider(current(), true); });

    return {
      apply: apply,
      realign: function () { moveGlider(current(), true); },
      read: function () { return document.documentElement.getAttribute(cfg.attr); },
    };
  }

  // 两条轴
  const themeSwitch = initSwitch({
    root: els.themeSwitch, glider: els.themeGlider,
    attr: 'data-theme', storageKey: THEME_KEY,
    allowed: THEMES, fallback: DEFAULT_THEME,
  });

  const modeSwitch = initSwitch({
    root: els.modeSwitch, glider: els.modeGlider,
    attr: 'data-mode', storageKey: MODE_KEY,
    allowed: MODES, fallback: DEFAULT_MODE,
  });

  /** 读取某个键，非法值一律回落到兜底值 */
  function readStored(key, allowed, fallback) {
    try {
      const v = localStorage.getItem(key);
      if (v && allowed.indexOf(v) !== -1) return v;
    } catch (err) { /* 隐私模式等场景下忽略 */ }
    return fallback;
  }

  /**
   * 同步浏览器的界面配色（移动端地址栏 / 状态栏）。
   * 必须等过渡结束再取值，否则读到的是过渡开始时的旧颜色。
   */
  function syncBrowserChrome() {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    const bg = window.getComputedStyle(document.body).backgroundColor;
    if (bg) meta.setAttribute('content', bg);
  }

  let chromeTimer = null;
  function scheduleChromeSync() {
    clearTimeout(chromeTimer);
    chromeTimer = setTimeout(syncBrowserChrome, 420);   // 等 .36s 的过渡走完
  }

  /* ---------------- 界面状态 ---------------- */

  function setStatus(text, type) {
    els.statusText.textContent = text;
    els.statusBar.className = 'status status--' + (type || 'idle');
  }

  let toastTimer = null;
  function toast(text, type) {
    const kind = type || 'ok';
    els.toastText.textContent = text;
    els.toastIcon.textContent = kind === 'err' ? '!' : (kind === 'info' ? 'i' : '✓');
    els.toast.className = 'toast toast--' + kind + ' is-show';

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('is-show');
    }, 2400);
  }

  function shake(node) {
    node.classList.remove('shake');
    void node.offsetWidth;                            // 强制重排，让动画可以重复触发
    node.classList.add('shake');
    setTimeout(function () { node.classList.remove('shake'); }, 460);
  }

  function countLabel(str) {
    return str.length + ' 字符';
  }

  function updateInputCount() {
    els.inputCount.textContent = countLabel(els.input.value);
  }

  function setOutput(text) {
    const has = text.length > 0;
    els.output.value = text;
    els.outputCount.textContent = countLabel(text);
    els.outputWrap.classList.toggle('is-empty', !has);
    els.outputWrap.classList.toggle('is-ready', has);
    els.copyBtn.disabled = !has;
    els.outputHint.textContent = has ? '解析完成 · 只读' : '等待激活';
  }

  /* ---------------- 解析核心 ---------------- */

  /**
   * 把用户的激活密钥规整成标准的 Base64 字符串。
   * - 去掉所有空白（含换行、制表符、全角空格）
   * - 把 URL 安全字符集（- _）还原为标准字符集（+ /）
   * - 补齐缺失的 "=" 填充
   * 返回 { ok: true, value } 或 { ok: false, message }
   */
  function normalizeKey(raw) {
    if (!raw || raw.trim() === '') {
      return { ok: false, message: MSG.empty };
    }
    if (raw.length > MAX_LEN) {
      return { ok: false, message: MSG.tooLong };
    }

    let cleaned = raw.replace(/[\s\u3000]/g, '');
    cleaned = cleaned.replace(/-/g, '+').replace(/_/g, '/');

    if (cleaned === '') {
      return { ok: false, message: MSG.onlySpace };
    }

    // 字符白名单校验：找出第一个非法字符，给出精确提示
    const illegal = cleaned.match(/[^A-Za-z0-9+/=]/);
    if (illegal) {
      return { ok: false, message: MSG.badChar(illegal[0]) };
    }

    // 去掉结尾的 "=" 后重新补齐，兼容多写或少写填充的情况
    cleaned = cleaned.replace(/=+$/, '');
    if (cleaned.length % 4 === 1) {
      return { ok: false, message: MSG.badLength };
    }
    while (cleaned.length % 4 !== 0) {
      cleaned += '=';
    }
    if (cleaned.length === 0) {
      return { ok: false, message: MSG.empty };
    }

    return { ok: true, value: cleaned };
  }

  /**
   * 将规整后的密钥解析为原始文本。
   * 采用 UTF-8 优先策略：先按严格 UTF-8 解码，
   * 若字节流并非合法 UTF-8，则退化为按单字节（Latin-1）呈现，
   * 保证任何合法密钥都不会解析失败。
   */
  function readKey(base64) {
    let binary;
    try {
      binary = atob(base64);
    } catch (err) {
      return { ok: false, message: MSG.badFormat };
    }

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (err) {
      // 非 UTF-8 字节流：按单字节映射，至少让用户看到内容
      text = binary;
    }

    // 去掉可能存在的 UTF-8 BOM
    text = text.replace(/^\uFEFF/, '');

    return { ok: true, value: text };
  }

  /* ---------------- 剪贴板 ---------------- */

  /**
   * 复制文本到剪贴板，返回 Promise<boolean>。
   * 优先使用异步剪贴板 API；在 file:// 或旧浏览器下
   * 自动退回到 execCommand 方案，尽量做到"总能复制上"。
   */
  async function copyText(text) {
    // 方案一：现代异步 API
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        /* 继续尝试方案二 */
      }
    }

    // 方案二：临时 textarea + execCommand
    try {
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.top = '-2000px';
      helper.style.left = '-2000px';
      helper.style.opacity = '0';
      document.body.appendChild(helper);

      const selection = document.getSelection();
      const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

      helper.select();
      helper.setSelectionRange(0, helper.value.length);

      const ok = document.execCommand('copy');
      document.body.removeChild(helper);

      // 还原用户原有的选区，避免"顺手清掉用户选中的文字"
      if (previous && selection) {
        selection.removeAllRanges();
        selection.addRange(previous);
      }
      return ok;
    } catch (err) {
      return false;
    }
  }

  /* ---------------- 激活主流程 ---------------- */

  let busy = false;

  async function activate() {
    if (busy) return;

    const raw = els.input.value;

    /* 步骤 1：规整与校验 */
    const normalized = normalizeKey(raw);
    if (!normalized.ok) {
      setOutput('');
      setStatus(normalized.message, 'err');
      toast(normalized.message, 'err');
      shake(els.input.parentElement);
      els.input.focus();
      return;
    }

    /* 步骤 2：解析 */
    const parsed = readKey(normalized.value);
    if (!parsed.ok) {
      setOutput('');
      setStatus(parsed.message, 'err');
      toast(parsed.message, 'err');
      shake(els.input.parentElement);
      return;
    }

    /* 步骤 3：输出结果 */
    const text = parsed.value;
    setOutput(text);

    /* 步骤 4：自动复制（带一点"处理中"的仪式感） */
    busy = true;
    els.activateBtn.classList.add('is-busy');
    els.activateBtn.querySelector('.btn__text').textContent = '激活中…';
    setStatus('正在启动激活程序……', 'idle');

    const copied = await copyText(text);

    busy = false;
    els.activateBtn.classList.remove('is-busy');
    els.activateBtn.querySelector('.btn__text').textContent = '启动激活';

    /* 步骤 5：反馈 */
    if (copied) {
      setStatus(MSG.success(text.length), 'ok');
      toast(MSG.copied, 'ok');
    } else {
      setStatus(MSG.successNoCopy(text.length), 'info');
      toast(MSG.copyFail, 'info');
    }

    // 让结果区域自动滚动到顶部，方便查看
    els.output.scrollTop = 0;
  }

  /* ---------------- 事件绑定 ---------------- */

  els.activateBtn.addEventListener('click', activate);

  els.copyBtn.addEventListener('click', async function () {
    const text = els.output.value;
    if (!text) return;
    const ok = await copyText(text);
    if (ok) {
      setStatus(MSG.copied, 'ok');
      toast(MSG.copied, 'ok');
    } else {
      setStatus(MSG.copyFail, 'info');
      toast(MSG.copyFail, 'info');
    }
  });

  els.clearBtn.addEventListener('click', function () {
    els.input.value = '';
    updateInputCount();
    setOutput('');
    setStatus(MSG.clear, 'idle');
    els.input.focus();
  });

  // 输入时实时更新计数，并顺带清理上一次的错误态
  els.input.addEventListener('input', function () {
    updateInputCount();
    if (els.statusBar.classList.contains('status--err')) {
      setStatus(MSG.idle, 'idle');
    }
  });

  // 快捷键：Ctrl / Cmd + Enter 直接激活
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      activate();
    }
  });

  /* ---------------- 初始化 ---------------- */

  // 恢复上次选择的外观；未选择过则使用默认（森林绿 + 白天，即纯白底）
  themeSwitch.apply(readStored(THEME_KEY, THEMES, DEFAULT_THEME), { instant: true });
  modeSwitch.apply(readStored(MODE_KEY, MODES, DEFAULT_MODE), { instant: true });
  syncBrowserChrome();

  // 字体加载完成后按钮宽度可能变化，重新对齐两个指示器
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      themeSwitch.realign();
      modeSwitch.realign();
    });
  }

  updateInputCount();
  setOutput('');
  setStatus(MSG.idle, 'idle');

  // 暴露一个极小的调试入口，方便在控制台手动触发
  window.ActivationBox = {
    activate: activate,
    setTheme: themeSwitch.apply,
    setMode: modeSwitch.apply,
    appearance: function () {
      return { theme: themeSwitch.read(), mode: modeSwitch.read() };
    },
    themes: THEMES.slice(),
    modes: MODES.slice(),
    labels: { theme: THEME_LABEL, mode: MODE_LABEL },
    maxLen: MAX_LEN,
    version: '1.5.0',
  };
})();
