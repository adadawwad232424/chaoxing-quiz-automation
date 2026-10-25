// ==UserScript==
// @name         超星章节测验提取与自动答题 (V3.1 全章遍历)
// @namespace    local.codex.chaoxing.quiz
// @version      3.1.0
// @description  提取阶段自动遍历全部章节测验；答案按 chapterId/sbar 唯一匹配；数据清洗
// @author       Codex
// @match        *://mooc1.chaoxing.com/mycourse/studentstudy*
// @match        *://*.chaoxing.com/mycourse/studentstudy*
// @match        *://*.chaoxing.com/mooc2-ans/mycourse/studentstudy*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  if (window.__CX_QUIZ_SCRAPER__) return;
  window.__CX_QUIZ_SCRAPER__ = true;

  let isRunning = false;
  let answerData = {};

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /* ================================================================
   * 一、UI
   * ================================================================ */
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'cx-quiz-panel';
    panel.style.cssText = `
      position: fixed; right: 20px; top: 60px; width: 540px; height: 700px;
      background:#fff; border:2px solid #4CAF50; border-radius:8px;
      z-index:999999; display:flex; flex-direction:column;
      box-shadow:0 8px 24px rgba(0,0,0,.2); font-family:system-ui,sans-serif;
    `;
    panel.innerHTML = `
      <div style="background:#4CAF50;color:#fff;padding:10px 15px;display:flex;justify-content:space-between;align-items:center;border-radius:6px 6px 0 0;">
        <span style="font-weight:bold;font-size:14px;" id="cx-quiz-title">📚 V3.1 全章遍历提取</span>
        <div>
          <button id="cx-quiz-scrape" style="cursor:pointer;background:#fff;color:#4CAF50;border:none;border-radius:4px;padding:4px 10px;font-weight:bold;margin-right:5px;">1. 遍历提取全部题目</button>
          <button id="cx-quiz-close"  style="cursor:pointer;background:transparent;color:#fff;border:none;font-size:16px;">✖</button>
        </div>
      </div>
      <div style="display:flex;flex:1;overflow:hidden;">
        <div style="flex:1;display:flex;flex-direction:column;border-right:1px solid #eee;">
          <div style="padding:5px;background:#f0f0f0;font-size:12px;text-align:center;font-weight:bold;">提取结果 / 运行日志</div>
          <textarea id="cx-quiz-content" style="flex:1;width:100%;border:none;padding:10px;resize:none;font-family:monospace;font-size:12px;outline:none;" placeholder="这里显示提取结果或运行日志..."></textarea>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;">
          <div style="padding:5px;background:#e3f2fd;font-size:12px;text-align:center;font-weight:bold;">AI 答案注入 (JSON)</div>
          <textarea id="cx-quiz-json-input" style="flex:1;width:100%;border:none;padding:10px;resize:none;font-family:monospace;font-size:12px;outline:none;" placeholder='把答案模板填好后粘贴到这里：{"1267275427":["A","B",...], "1267275431":[...]}'></textarea>
          <button id="cx-quiz-answer" style="cursor:pointer;background:#2196F3;color:#fff;border:none;padding:10px;font-weight:bold;font-size:14px;">2. 遍历自动答题</button>
        </div>
      </div>
      <div id="cx-quiz-status" style="padding:8px 15px;background:#f8f9fa;border-top:1px solid #eee;font-size:12px;color:#666;">就绪</div>
    `;
    document.body.appendChild(panel);

    document.getElementById('cx-quiz-close').onclick = () => {
      if (confirm('停止并关闭？')) {
        isRunning = false;
        panel.remove();
        window.__CX_QUIZ_SCRAPER__ = false;
      }
    };
    document.getElementById('cx-quiz-scrape').onclick = () => {
      if (isRunning) return;
      isRunning = true;
      document.getElementById('cx-quiz-content').value = '';
      startScraping().finally(() => { isRunning = false; });
    };
    document.getElementById('cx-quiz-answer').onclick = () => {
      if (isRunning) return;
      const raw = document.getElementById('cx-quiz-json-input').value.trim();
      if (!raw) return alert('请先在右侧粘贴 AI 返回的 JSON 答案！');
      try {
        const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
        answerData = JSON.parse(clean);
        isRunning = true;
        const ta = document.getElementById('cx-quiz-content');
        if (ta) ta.value = '=== 答题日志 ===\n';
        startAnswering().finally(() => { isRunning = false; });
      } catch (e) {
        alert('JSON 解析失败:\n' + e.message);
      }
    };
  }

  function log(msg, isError = false) {
    const ta = document.getElementById('cx-quiz-content');
    if (ta) {
      const time = new Date().toLocaleTimeString();
      ta.value += `[${time}] ${isError ? '❌ ' : '👉 '}${msg}\n`;
      ta.scrollTop = ta.scrollHeight;
    }
    (isError ? console.error : console.log)('[CX-QUIZ]', msg);
  }
  function updateStatus(t) {
    const el = document.getElementById('cx-quiz-status');
    if (el) el.textContent = t;
  }

  /* ================================================================
   * 二、节点识别 & 排序
   * ================================================================ */
  function getNodeMeta(node) {
    const sbar = node.querySelector('.posCatalog_sbar');
    const sbarText = sbar ? sbar.textContent.trim().replace(/[^\d.]/g, '') : '';
    const title = (node.getAttribute('title') || node.textContent.trim())
      .replace(/\s+/g, '')
      .replace(/^[\d.]+\s*/, '');
    const onclick = node.getAttribute('onclick') || '';
    let chapterId = '';
    const m = onclick.match(/getTeacherAjax\(([^)]+)\)/);
    if (m) {
      const parts = m[1].match(/'([^']*)'/g);
      if (parts && parts.length >= 3) chapterId = parts[2].replace(/'/g, '');
    }
    if (!chapterId) {
      const wrap = node.closest('.posCatalog_select');
      if (wrap && wrap.id && wrap.id.startsWith('cur')) chapterId = wrap.id.substring(3);
    }
    return { sbar: sbarText, title, chapterId };
  }

  function isQuizNode(node) {
    const t = getNodeMeta(node).title;
    return t.includes('测验') || t.includes('检测') || t === '测验';
  }

  // 按 "1.6" / "2.10" 这样的 sbar 排序（防止 1.10 排到 1.6 前）
  function compareSbar(a, b) {
    if (!a) return 1;
    if (!b) return -1;
    const [a1, a2] = a.split('.').map(x => parseInt(x, 10) || 0);
    const [b1, b2] = b.split('.').map(x => parseInt(x, 10) || 0);
    return (a1 - b1) || (a2 - b2);
  }

  function collectQuizNodes() {
    const all = Array.from(document.querySelectorAll(
      '#coursetree .posCatalog_select:not(.firstLayer) .posCatalog_name'
    ));
    const quiz = all.filter(isQuizNode);
    quiz.sort((a, b) => compareSbar(getNodeMeta(a).sbar, getNodeMeta(b).sbar));
    return quiz;
  }

  /* ================================================================
   * 三、答案查找（提取阶段用不到，答题阶段用）
   * ================================================================ */
  function findAnswersForNode(node) {
    const meta = getNodeMeta(node);
    if (meta.chapterId && answerData[meta.chapterId] !== undefined) return answerData[meta.chapterId];
    if (meta.sbar) {
      const tries = [
        `${meta.sbar}_${meta.title}`, `${meta.sbar} ${meta.title}`,
        `${meta.sbar}_章节测验`, `${meta.sbar} 章节测验`, meta.sbar,
      ];
      for (const k of tries) if (answerData[k] !== undefined) return answerData[k];
    }
    const nest = answerData['章节测验'];
    if (nest && typeof nest === 'object' && !Array.isArray(nest)) {
      if (meta.chapterId && nest[meta.chapterId] !== undefined) return nest[meta.chapterId];
      if (meta.sbar && nest[meta.sbar] !== undefined) return nest[meta.sbar];
    }
    const quizCount = collectQuizNodes().length;
    if (quizCount === 1 && answerData['章节测验'] !== undefined) return answerData['章节测验'];
    return null;
  }

  function isAnswersNonEmpty(ans) {
    if (ans == null) return false;
    if (Array.isArray(ans)) return ans.some(a => String(a).trim() !== '');
    if (typeof ans === 'object') return Object.keys(ans).length > 0;
    return String(ans).trim() !== '';
  }

  /* ================================================================
   * 四、弹窗处理
   * ================================================================ */
   async function handlePopups() {
    // 改用 getComputedStyle 判断可见性，避免 offsetParent 在某些 CSS 下失效
    const vis = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    const popups = [
      ['#workpop', ['#popok', '.popClose']],
      ['#worktoast', ['.popClose']],
      ['#hintPop', ['#hintOk']],
    ];
    for (const [pSel, btnSels] of popups) {
      const p = document.querySelector(pSel);
      if (!vis(p)) continue;
      for (const bSel of btnSels) {
        const b = p.querySelector(bSel);
        if (b) { b.click(); await sleep(600); return true; }
      }
    }
    const vTip = document.querySelector('#chapterVerificationCodeTip');
    if (vis(vTip)) {
      const ok = vTip.querySelector('.bluebtn');
      if (ok) { ok.click(); await sleep(400); return true; }
    }
    const freeze = document.querySelector('#freezePage2');
    if (vis(freeze)) {
      const btn = freeze.querySelector('a[onclick*="continue_learning"]');
      if (btn) { btn.click(); await sleep(400); return true; }
    }
    return false;
  }
  /* ================================================================
   * 五、定位题库 iframe
   * ================================================================ */
  function findQuizDoc(rootDoc) {
    let qs = rootDoc.querySelectorAll('.singleQuesId');
    if (qs.length === 0) qs = rootDoc.querySelectorAll('.TiMu');
    if (qs.length > 0) return rootDoc;
    const iframes = rootDoc.querySelectorAll('iframe');
    for (let i = 0; i < iframes.length; i++) {
      let inner = null;
      try { inner = iframes[i].contentDocument || iframes[i].contentWindow?.document; } catch (e) { continue; }
      if (inner) {
        const r = findQuizDoc(inner);
        if (r) return r;
      }
    }
    return null;
  }

  function isQuizArea() {
    const prevTitle = document.querySelector('.prev_title');
    if (prevTitle) {
      const t = prevTitle.getAttribute('title') || prevTitle.textContent.trim();
      if (t.includes('测验') || t.includes('检测')) return true;
    }
    for (const tab of document.querySelectorAll('#prev_tab li')) {
      const t = tab.getAttribute('title') || '';
      if (t.includes('测验') || t.includes('检测')) return true;
    }
    return false;
  }

  /* ================================================================
   * 六、切换章节并等待就绪
   * ================================================================ */
  async function clickAndWaitForChapter(node, targetChapterId) {
    // 已经是当前章节就直接返回
    const activeNow = document.querySelector('#coursetree .posCatalog_select.posCatalog_active');
    if (activeNow && activeNow.id === `cur${targetChapterId}` && findQuizDoc(document)) {
      return true;
    }

    const iframe = document.querySelector('#iframe');
    const oldSrc = iframe ? iframe.getAttribute('src') || '' : '';

    node.click();

    // 1) 等 active 变化
    for (let i = 0; i < 40; i++) {
      await sleep(200);
      const active = document.querySelector('#coursetree .posCatalog_select.posCatalog_active');
      if (active && active.id === `cur${targetChapterId}`) break;
    }

    // 2) 等 iframe src 变化 + 内部题库可访问
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      const f = document.querySelector('#iframe');
      if (!f) continue;
      const newSrc = f.getAttribute('src') || '';
      if (newSrc && newSrc !== oldSrc && findQuizDoc(document)) {
        await sleep(700); // 渲染缓冲
        return true;
      }
      // src 没变但题库已出（局部刷新场景兜底）
      if (newSrc === oldSrc && findQuizDoc(document) && i > 8) {
        await sleep(500);
        return true;
      }
    }
    return !!findQuizDoc(document);
  }

  /* ================================================================
   * 七、题目解析 + 清洗
   * ================================================================ */
  function cleanStemText(raw) {
    let t = String(raw).replace(/[\t\n\r]+/g, ' ');
    // 从【题型】处开始（去掉前面的题号噪音）
    const m = t.match(/【[^】]+】/);
    if (m && typeof m.index === 'number') t = t.substring(m.index);
    else t = t.replace(/^\s*\d+\s*[、.．]?\s*/, '');
    return t.replace(/\s+/g, ' ').trim();
  }

  function detectType(q, stemText) {
    if (/【多选题】/.test(stemText) || /【多选】/.test(stemText)) return 'multiple';
    if (/【判断题】/.test(stemText) || /【判断】/.test(stemText)) return 'judge';
    if (/【单选题】/.test(stemText) || /【单选】/.test(stemText)) return 'single';
    if (q.querySelector('input[type="checkbox"]')) return 'multiple';
    if (q.querySelector('input[type="radio"]')) return 'single';
    return 'single';
  }

  function normalizeOption(opt, idx) {
    const spanTag = opt.querySelector('span.num_option');
    const iTag = opt.querySelector('i');

    let rawLetter = '';
    if (spanTag) rawLetter = (spanTag.getAttribute('data') || spanTag.textContent || '').trim();
    else if (iTag) rawLetter = iTag.textContent.replace(/[、.．\s]/g, '').trim();

    const fullText = opt.textContent.replace(/\s+/g, ' ').trim();

    let letter = rawLetter;
    if (!letter) {
      const m = fullText.match(/^([A-Za-z])(?:[、.．\s]|$)/);
      if (m) letter = m[1];
    }
    const lc = String(letter).toLowerCase();
    if (lc === 'true') letter = 'A';
    else if (lc === 'false') letter = 'B';
    else if (/^[a-z]$/.test(lc)) letter = letter.toUpperCase();
    else letter = String.fromCharCode(65 + idx);

    let text = fullText;
    // 去掉开头的字母前缀（A / A. / A、 / A ）
    const escLetter = letter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^\\s*${escLetter}\\s*[、.．]?\\s*`, 'i'), '');
    // 去掉 true/false 前缀
    text = text.replace(/^\s*(true|false)\s*[、.．]?\s*/i, '');
    text = text.replace(/\s+/g, ' ').trim();
    return { letter, text };
  }

  function extractQuestions(doc) {
    let qs = doc.querySelectorAll('.singleQuesId');
    if (qs.length === 0) qs = doc.querySelectorAll('.TiMu');

    return Array.from(qs).map((q, i) => {
      let rawStem = '';
      for (const sel of ['.Zy_TItle', '.questionTitle', '.timu']) {
        const el = q.querySelector(sel);
        if (el && el.textContent.trim()) { rawStem = el.textContent; break; }
      }
      if (!rawStem) rawStem = q.textContent.slice(0, 400);

      const stem = cleanStemText(rawStem);
      const type = detectType(q, stem);

      const optEls = q.querySelectorAll('.Zy_ulTop li, .answerList li, .qtDetail li');
      const options = Array.from(optEls).map((opt, oi) => normalizeOption(opt, oi));

      return { index: i + 1, type, stem, options };
    });
  }

  /* ================================================================
   * 八、阶段一：遍历提取全部题目
   * ================================================================ */
  async function startScraping() {
    await handlePopups();

    const quizNodes = collectQuizNodes();
    if (quizNodes.length === 0) {
      log('未找到任何章节测验节点。请确认已在课程学习页面。', true);
      return;
    }
    log(`发现 ${quizNodes.length} 个章节测验节点`);

    const entries = [];
    const readableParts = [];

    for (let i = 0; i < quizNodes.length; i++) {
      if (!isRunning) { log('用户中止', true); break; }
      const node = quizNodes[i];
      const meta = getNodeMeta(node);
      updateStatus(`提取中 [${i + 1}/${quizNodes.length}] ${meta.sbar} ${meta.title}`);

      log(`\n─── [${i + 1}/${quizNodes.length}] 切换至 ${meta.sbar} ${meta.title} (${meta.chapterId}) ───`);

      await clickAndWaitForChapter(node, meta.chapterId);
      await handlePopups();

      // 若未自动激活测验区域，主动点一下 .prev_title
      if (!isQuizArea()) {
        const pt = document.querySelector('.prev_title');
        if (pt) { pt.click(); await sleep(600); await handlePopups(); }
      }

      const doc = findQuizDoc(document);
      if (!doc) { log(`${meta.sbar}: 未检测到题库`, true); continue; }

      const questions = extractQuestions(doc);
      if (questions.length === 0) { log(`${meta.sbar}: 未解析到题目`, true); continue; }

      entries.push({
        chapterId: meta.chapterId,
        sbar: meta.sbar,
        title: meta.title,
        questions,
      });

      let text = `=== ${meta.sbar} ${meta.title} (${meta.chapterId}) ===\n`;
      questions.forEach(q => {
        text += `\n【第${q.index}题】(${q.type}) ${q.stem}\n`;
        q.options.forEach(o => { text += `  ${o.letter}. ${o.text}\n`; });
      });
      readableParts.push(text);

      log(`✓ 已提取 ${questions.length} 题`);
    }

    // 答案空模板
    const answersTemplate = {};
    entries.forEach(e => { answersTemplate[e.chapterId] = new Array(e.questions.length).fill(''); });

    const tail =
      `\n\n═════════════════════════════════════════════\n` +
      `请把上面的题目内容粘给 AI，让它返回每题答案（A/B/C/D/对/错，多选用连写如 "AB" 或 ["A","B"]）。\n` +
      `然后把答案填入下方模板的数组里，再整段粘贴回右侧输入框。\n` +
      `═════════════════════════════════════════════\n` +
      `=== 答案模板 (共 ${entries.length} 个测验) ===\n` +
      Object.entries(entries)
        .map(([_, e]) => `// ${e.sbar} ${e.title} (${e.chapterId}) — ${e.questions.length}题`)
        .join('\n') + '\n\n' +
      JSON.stringify(answersTemplate, null, 2);

    document.getElementById('cx-quiz-content').value =
      readableParts.join('\n\n') + tail;

    log(`\n✅ 全部完成，共提取 ${entries.length} 个测验`);
    updateStatus(`提取完成: ${entries.length} 个测验`);
  }

  /* ================================================================
   * 九、阶段二：遍历自动答题
   * ================================================================ */
  function pickAnswerFor(answers, idx) {
    if (answers == null) return '';
    if (Array.isArray(answers)) {
      // 每一题是一个字符串
      const v = answers[idx];
      if (v !== undefined && v !== null) return String(v).trim();
      return '';
    }
    if (typeof answers === 'object') {
      if (answers[String(idx + 1)] !== undefined) return String(answers[String(idx + 1)]).trim();
      if (answers[idx] !== undefined) return String(answers[idx]).trim();
    }
    return String(answers).trim();
  }

  function autoCheckAnswers(answersArray) {
    const doc = findQuizDoc(document);
    if (!doc) return 0;
    const w = doc.defaultView || window;
    const $ = w.$ || w.jQuery;

    let qs = doc.querySelectorAll('.singleQuesId');
    if (qs.length === 0) qs = doc.querySelectorAll('.TiMu');

    let count = 0;
    qs.forEach((q, index) => {
      const ans = pickAnswerFor(answersArray, index);
      if (!ans) return;
      const ansChars = ans.split('').filter(c => /[A-Za-z对错]/.test(c));
      const options = q.querySelectorAll('.Zy_ulTop li, .answerList li, .qtDetail li');

      log(`第 ${index + 1} 题 目标: [${ans}] / ${options.length} 个选项`);

      if (options.length > 0) {
        let matched = false;
        options.forEach((opt, oi) => {
          const { letter, text } = normalizeOption(opt, oi);

          let isMatch = false;
          if (letter === ans) isMatch = true;
          else if (ansChars.includes(letter) && letter) isMatch = true;

          const ansLower = ans.toLowerCase();
          if (ansLower === 'true' && (letter === 'A' || text === '对' || text === '正确')) isMatch = true;
          if (ansLower === 'false' && (letter === 'B' || text === '错' || text === '错误')) isMatch = true;
          if (ansLower === '对' && (letter === 'A' || text === '对')) isMatch = true;
          if (ansLower === '错' && (letter === 'B' || text === '错')) isMatch = true;

          if (!isMatch) return;

          // 已选中判定
          let selected =
            opt.classList.contains('active') ||
            opt.classList.contains('current') ||
            opt.classList.contains('selected');
          const rc = opt.querySelector('input[type="radio"], input[type="checkbox"]');
          if (rc && rc.checked) selected = true;
          if (selected) { log(`  → ${letter} 已选中`); matched = true; return; }

          log(`  → 点击 ${letter} (${text.slice(0, 20)})`);
          const innerA = opt.querySelector('a');
          if (innerA) innerA.click();
          opt.click();
          if ($) { try { $(opt).trigger('click'); } catch (e) {} }
          if (rc) {
            rc.checked = true;
            rc.dispatchEvent(new Event('change', { bubbles: true }));
          }
          opt.classList.add('active', 'current', 'selected');
          const span = opt.querySelector('span.num_option');
          if (span) span.classList.add('active');
          count++;
          matched = true;
        });
        if (!matched) log(`  ⚠️ 未找到匹配 [${ans}] 的选项`, true);
      } else {
        // 无选项的判断题
        let matched = false;
        for (const el of q.querySelectorAll('*')) {
          if (el.children.length !== 0) continue;
          const t = el.textContent.trim();
          const wantTrue = ansLower === 'true' || ansLower === '对' || ans === 'A';
          const wantFalse = ansLower === 'false' || ansLower === '错' || ans === 'B';
          if (wantTrue && t === '对') {
            el.click(); if ($) try { $(el).trigger('click'); } catch (e) {}
            log('  → 判断: 对'); matched = true; break;
          }
          if (wantFalse && t === '错') {
            el.click(); if ($) try { $(el).trigger('click'); } catch (e) {}
            log('  → 判断: 错'); matched = true; break;
          }
        }
        if (!matched) log('  ⚠️ 未能点击判断题', true);
      }
    });
    return count;
  }

  async function startAnswering() {
    await handlePopups();

    const quizNodes = collectQuizNodes();
    log(`目录中共 ${quizNodes.length} 个测验节点`);

    const toProcess = quizNodes.filter(n => isAnswersNonEmpty(findAnswersForNode(n)));
    log(`匹配到非空答案的测验: ${toProcess.length}`);
    if (toProcess.length === 0) {
      log('没有节点匹配到非空答案。检查 JSON 是否用 chapterId 或 "1.6_章节测验" 做键。', true);
      return;
    }

    for (let i = 0; i < toProcess.length; i++) {
      if (!isRunning) { log('用户中止', true); break; }
      await handlePopups();

      const node = toProcess[i];
      const meta = getNodeMeta(node);
      const answers = findAnswersForNode(node);
      const label = `${meta.sbar} ${meta.title}`.trim() || meta.chapterId;

      updateStatus(`[${i + 1}/${toProcess.length}] 作答 ${label}`);
      log(`\n─── 作答 [${label}] ───`);

      await clickAndWaitForChapter(node, meta.chapterId);
      await handlePopups();

      // 如果没在测验区域，点一下测验标签
      if (!isQuizArea()) {
        const pt = document.querySelector('.prev_title');
        if (pt) { pt.click(); await sleep(600); await handlePopups(); }
      }

      const doc = findQuizDoc(document);
      if (!doc) { log(`${label}: 题库未加载，跳过`, true); continue; }

      // 开始自动勾选
      const okCount = autoCheckAnswers(answers);
      log(`已勾选 ${okCount} 个选项`);

      updateStatus('提交中...');
      await sleep(800);

      // 定位提交按钮
      const qDoc = findQuizDoc(document);
      const submit = qDoc
        ? (qDoc.querySelector('.btnSubmit') ||
           qDoc.querySelector('.completeBtn') ||
           qDoc.querySelector('a[onclick*="submit"]'))
        : null;

      if (submit) {
        log('已点击底部提交，等待确认弹窗...');
        submit.click();
        
        let confirmed = false;
        // 死等确认弹窗出现（最多等 6 秒）
        for (let t = 0; t < 30; t++) {
          await sleep(200);
          const pop = document.querySelector('#workpop');
          // 只要发现 workpop 出现，立即点击里面的“提交/确定”
          if (pop && window.getComputedStyle(pop).display !== 'none') {
            const okBtn = pop.querySelector('#popok');
            if (okBtn) {
              okBtn.click();
              confirmed = true;
              log('✅ 发现并点击了确认提交弹窗');
              break;
            }
          }
        }

        if (confirmed) {
          await sleep(1500); // 等待接口响应
          // 连续处理可能出现的“提交成功”或“成绩”弹窗（最多连点3次）
          for (let c = 0; c < 3; c++) {
            const handled = await handlePopups();
            if (!handled) break; // 如果没弹窗了，就退出循环
            await sleep(500);
          }
        } else {
          log('⚠️ 未检测到确认弹窗，可能已直接提交或页面结构变异', true);
        }
      } else {
        log(`${label}: 未找到提交按钮`, true);
      }

      // 稍微停顿，防止切得太快导致下一章加载不完全
      await sleep(1200);
    }

    updateStatus('🎉 全部完成');
    log('=== 所有匹配章节处理完毕 ===');
  }
  setTimeout(createPanel, 2000);
})();