// ==UserScript==
// @name         超星章节测验提取与自动答题
// @namespace    local.codex.chaoxing.quiz
// @version      2.5.2
// @description  提取题目，支持注入JSON答案并自动勾选提交（兼容标题序号与iframe提交）
// @author       Codex
// @match        *://mooc1.chaoxing.com/mycourse/studentstudy*
// @match        *://*.chaoxing.com/mycourse/studentstudy*
// @match        *://*.chaoxing.com/mooc2-ans/mycourse/studentstudy*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    if (window.__CX_QUIZ_SCRAPER__) return;
    window.__CX_QUIZ_SCRAPER__ = true;

    let isRunning = false;
    let answerData = {};

    // 标题归一化：去掉开头序号、空格、全角空格、标点
    function normalizeTitle(t) {
        return String(t || '')
            .replace(/\u3000/g, ' ')
            .replace(/^\s*[\d]+([\.\、\s]+[\d]*)*[\s\.\、]*/, '') // 去掉 "1.1 " "1、" "3.5 "
            .replace(/\s+/g, '')
            .trim();
    }

    // 模糊查答案：先精确，再归一化
    function getAnswerByTitle(title) {
        if (answerData[title]) return { key: title, answers: answerData[title] };
        const n = normalizeTitle(title);
        for (const k of Object.keys(answerData)) {
            if (normalizeTitle(k) === n) return { key: k, answers: answerData[k] };
        }
        return null;
    }

    function createPanel() {
        const panel = document.createElement('div');
        panel.id = 'cx-quiz-panel';
        panel.style.cssText = `
            position: fixed; right: 20px; top: 60px; width: 480px; height: 650px;
            background: #ffffff; border: 2px solid #4CAF50; border-radius: 8px;
            z-index: 999999; display: flex; flex-direction: column;
            box-shadow: 0 8px 24px rgba(0,0,0,0.2); font-family: system-ui, sans-serif;
        `;
        panel.innerHTML = `
            <div style="background: #4CAF50; color: white; padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; border-radius: 6px 6px 0 0;">
                <span style="font-weight: bold; font-size: 14px;" id="cx-quiz-title">📚 V2.5.2 标题模糊匹配版</span>
                <div>
                    <button id="cx-quiz-scrape" style="cursor: pointer; background: #fff; color: #4CAF50; border: none; border-radius: 4px; padding: 4px 10px; font-weight: bold; margin-right: 5px;">1. 提取题目</button>
                    <button id="cx-quiz-close" style="cursor: pointer; background: transparent; color: white; border: none; font-size: 16px;">✖</button>
                </div>
            </div>
            <div style="display: flex; flex: 1; overflow: hidden;">
                <div style="flex: 1; display: flex; flex-direction: column; border-right: 1px solid #eee;">
                    <div style="padding: 5px; background: #f0f0f0; font-size: 12px; text-align: center; font-weight: bold;">提取结果 / 运行日志</div>
                    <textarea id="cx-quiz-content" style="flex: 1; width: 100%; border: none; padding: 10px; resize: none; font-family: monospace; font-size: 12px; outline: none;" placeholder="这里显示提取结果或运行日志..."></textarea>
                </div>
                <div style="flex: 1; display: flex; flex-direction: column;">
                    <div style="padding: 5px; background: #e3f2fd; font-size: 12px; text-align: center; font-weight: bold;">AI答案注入 (JSON)</div>
                    <textarea id="cx-quiz-json-input" style="flex: 1; width: 100%; border: none; padding: 10px; resize: none; font-family: monospace; font-size: 12px; outline: none;" placeholder="将 AI 返回的 JSON 粘贴到这里..."></textarea>
                    <button id="cx-quiz-answer" style="cursor: pointer; background: #2196F3; color: #fff; border: none; padding: 10px; font-weight: bold; font-size: 14px;">2. 开始自动答题</button>
                </div>
            </div>
            <div id="cx-quiz-status" style="padding: 8px 15px; background: #f8f9fa; border-top: 1px solid #eee; font-size: 12px; color: #666;">就绪</div>
        `;
        document.body.appendChild(panel);

        document.getElementById('cx-quiz-close').onclick = () => {
            if (confirm('停止并关闭？')) { isRunning = false; panel.remove(); window.__CX_QUIZ_SCRAPER__ = false; }
        };

        document.getElementById('cx-quiz-scrape').onclick = () => {
            if (isRunning) return;
            isRunning = true;
            document.getElementById('cx-quiz-content').value = "";
            startScraping();
        };

        document.getElementById('cx-quiz-answer').onclick = () => {
            if (isRunning) return;
            const jsonStr = document.getElementById('cx-quiz-json-input').value.trim();
            if (!jsonStr) return alert('请先在右侧粘贴 AI 返回的 JSON 答案！');
            try {
                const cleanJson = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
                answerData = JSON.parse(cleanJson);
                isRunning = true;
                const ta = document.getElementById('cx-quiz-content');
                if (ta) ta.value = "=== 答题日志 ===\n";
                startAnswering();
            } catch (e) {
                alert('JSON 解析失败，请检查格式是否正确:\n' + e.message);
            }
        };
    }

    function log(msg, isError = false) {
        const ta = document.getElementById('cx-quiz-content');
        if (!ta) return;
        const time = new Date().toLocaleTimeString();
        ta.value += `[${time}] ${isError ? '❌ ' : '👉 '}${msg}\n`;
        ta.scrollTop = ta.scrollHeight;
        if (isError) console.error(msg); else console.log(msg);
    }

    function updateStatus(statusText) {
        const el = document.getElementById('cx-quiz-status');
        if (el) el.textContent = statusText;
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function findQuizDoc(rootDoc) {
        let questions = rootDoc.querySelectorAll('.singleQuesId');
        if (questions.length === 0) questions = rootDoc.querySelectorAll('.TiMu');
        if (questions.length > 0) return rootDoc;
        const iframes = rootDoc.querySelectorAll('iframe');
        for (let i = 0; i < iframes.length; i++) {
            let innerDoc = null;
            try { innerDoc = iframes[i].contentDocument || iframes[i].contentWindow?.document; } catch (e) { continue; }
            if (innerDoc) {
                const res = findQuizDoc(innerDoc);
                if (res) return res;
            }
        }
        return null;
    }

    // 提交按钮：先题目doc，再父页面，再所有iframe
    function findSubmitBtn(targetDoc) {
        let btn = targetDoc ? targetDoc.querySelector('.btnSubmit') : null;
        if (btn) return btn;
        btn = document.querySelector('.btnSubmit');
        if (btn) return btn;
        const iframes = document.querySelectorAll('iframe');
        for (let f of iframes) {
            try {
                const d = f.contentDocument || f.contentWindow?.document;
                if (d) {
                    const b = d.querySelector('.btnSubmit');
                    if (b) return b;
                }
            } catch (e) {}
        }
        return null;
    }

    async function handlePopups() {
        const workpop = document.querySelector('#workpop');
        if (workpop && workpop.style.display !== 'none') {
            log("⚠️ 发现残留弹窗，自动点击确认/提交...");
            const okBtn = workpop.querySelector('#popok');
            if (okBtn) { okBtn.click(); await sleep(1000); return true; }
            const closeBtn = workpop.querySelector('.popClose');
            if (closeBtn) { closeBtn.click(); await sleep(1000); return true; }
        }
        return false;
    }

    async function startScraping() {
        let sidebarNodes = Array.from(document.querySelectorAll('#coursetree .posCatalog_select:not(.firstLayer) .posCatalog_name'));
        if (sidebarNodes.length === 0) sidebarNodes = Array.from(document.querySelectorAll('.posCatalog .posCatalog_select:not(.firstLayer) .posCatalog_name'));

        log(`找到 ${sidebarNodes.length} 个目录节点，准备开始提取题目...`);
        await sleep(1000);

        for (let i = 0; i < sidebarNodes.length; i++) {
            if (!isRunning) break;
            await handlePopups();

            const node = sidebarNodes[i];
            const nodeTitle = node.getAttribute('title') || node.textContent.trim();

            updateStatus(`[${i + 1}/${sidebarNodes.length}] 正在提取: ${nodeTitle}`);
            log(`--- 开始提取: ${nodeTitle} ---`);

            node.click();
            await sleep(1500);

            let tabFound = false;
            for (let t = 0; t < 15; t++) {
                let tabs = document.querySelectorAll('#prev_tab li');
                for (let tab of tabs) {
                    if (tab.getAttribute('title') === '章节测验') {
                        if (!tab.classList.contains('active')) {
                            log("找到测验 Tab，切换中...");
                            tab.click();
                            await sleep(1000);
                        }
                        tabFound = true; break;
                    }
                }
                if (tabFound) break;
                await sleep(200);
            }

            if (!tabFound) { log("当前章节无测验，跳过。"); continue; }

            let targetDoc = null;
            for (let retry = 0; retry < 16; retry++) {
                targetDoc = findQuizDoc(document);
                if (targetDoc) break;
                await sleep(500);
            }

            if (!targetDoc) { log("题目加载超时，跳过。", true); continue; }

            let questions = targetDoc.querySelectorAll('.singleQuesId');
            if (questions.length === 0) questions = targetDoc.querySelectorAll('.TiMu');

            if (questions.length === 0) { log("未检测到题目节点，跳过。"); continue; }

            let resultText = `\n【${nodeTitle}】\n`;

            questions.forEach((q, index) => {
                let qText = "";
                const titleEl = q.querySelector('.Zy_TItle') || q.querySelector('.qtContent');
                if (titleEl) {
                    qText = titleEl.innerText.replace(/\s+/g, ' ').trim();
                } else {
                    qText = "未知题目(请手动检查)";
                }
                resultText += `${index + 1}. ${qText}\n`;

                const options = q.querySelectorAll('.Zy_ulTop li, .answerList li, .qtDetail li');
                options.forEach(opt => {
                    let optText = opt.innerText.replace(/\s+/g, ' ').trim();
                    optText = optText.replace(/^[A-Z][、. \s]/, '').trim();
                    resultText += `   ${optText}\n`;
                });
                resultText += "\n";
            });

            const ta = document.getElementById('cx-quiz-content');
            if (ta) {
                ta.value += resultText;
                ta.scrollTop = ta.scrollHeight;
            }

            log(`提取完成，共 ${questions.length} 题。`);
            updateStatus('提取中...');
            await sleep(1000);
        }

        if (isRunning) {
            updateStatus('🎉 提取完毕');
            log("=== 所有章节已尝试提取完毕，请复制左侧文本发送给AI ===");
        }
        isRunning = false;
    }

    async function startAnswering() {
        let sidebarNodes = Array.from(document.querySelectorAll('#coursetree .posCatalog_select:not(.firstLayer) .posCatalog_name'));
        if (sidebarNodes.length === 0) sidebarNodes = Array.from(document.querySelectorAll('.posCatalog .posCatalog_select:not(.firstLayer) .posCatalog_name'));

        log(`找到 ${sidebarNodes.length} 个目录节点，准备开始...`);
        await sleep(1000);

        for (let i = 0; i < sidebarNodes.length; i++) {
            if (!isRunning) break;
            await handlePopups();

            const node = sidebarNodes[i];
            const rawTitle = node.getAttribute('title') || node.textContent.trim();

            const matched = getAnswerByTitle(rawTitle);
            if (!matched) {
                log(`⏭️ 跳过（JSON无此章节）: ${rawTitle}`);
                updateStatus(`⏭️ 跳过: ${rawTitle}`);
                continue;
            }

            const nodeTitle = matched.key;
            const answers = matched.answers;

            updateStatus(`[${i + 1}/${sidebarNodes.length}] 正在答: ${nodeTitle}`);
            log(`--- 开始处理: ${rawTitle} -> 匹配 ${nodeTitle} ---`);

            node.click();
            await sleep(1500);

            let tabFound = false;
            for (let t = 0; t < 15; t++) {
                let tabs = document.querySelectorAll('#prev_tab li');
                for (let tab of tabs) {
                    if (tab.getAttribute('title') === '章节测验') {
                        if (!tab.classList.contains('active')) {
                            log("找到测验 Tab，切换中...");
                            tab.click();
                            await sleep(1000);
                        }
                        tabFound = true; break;
                    }
                }
                if (tabFound) break;
                await sleep(200);
            }

            if (!tabFound) { log("当前章节无测验，跳过。"); continue; }

            log("等待题目加载渲染...");
            let isLoaded = false;
            for (let retry = 0; retry < 16; retry++) {
                if (findQuizDoc(document)) { isLoaded = true; break; }
                await sleep(500);
            }
            if (!isLoaded) { log("题目加载超时。", true); continue; }

            log("开始解析题目并勾选选项...");
            let successCount = autoCheckAnswers(answers);

            log(`勾选完成，匹配了 ${successCount} 个选项，准备提交...`);
            updateStatus('提交中...');
            await sleep(1000);

            const targetDoc = findQuizDoc(document);
            const submitBtn = findSubmitBtn(targetDoc);
            if (submitBtn) {
                submitBtn.click();
                await sleep(1500);
                await handlePopups();
            } else {
                log("未找到提交按钮！", true);
            }

            log(`--- ${nodeTitle} 处理完毕 ---\n`);
            await sleep(2000);
        }

        if (isRunning) {
            updateStatus('🎉 全部答题完成');
            log("=== 所有章节已尝试作答完毕 ===");
        }
        isRunning = false;
    }

    function autoCheckAnswers(answersArray) {
        const targetDoc = findQuizDoc(document);
        if (!targetDoc) return 0;

        const targetWindow = targetDoc.defaultView || window;
        const $ = targetWindow.$ || targetWindow.jQuery;

        let questions = targetDoc.querySelectorAll('.singleQuesId');
        if (questions.length === 0) questions = targetDoc.querySelectorAll('.TiMu');

        let count = 0;

        questions.forEach((q, index) => {
            const ans = String(answersArray[index] || "").trim();
            if (!ans) return;

            const ansList = ans.split('');
            const options = q.querySelectorAll('.Zy_ulTop li, .answerList li, .qtDetail li');

            log(`第 ${index + 1} 题 (目标答案: ${ans})，检测到 ${options.length} 个选项。`);

            if (options.length > 0) {
                let questionMatched = false;
                options.forEach(opt => {
                    let letterText = "";
                    const spanTag = opt.querySelector('span.num_option');
                    const iTag = opt.querySelector('i');

                    if (spanTag) {
                        letterText = spanTag.getAttribute('data') || spanTag.textContent;
                    } else if (iTag) {
                        letterText = iTag.textContent.replace(/[、. \s]/g, '');
                    } else {
                        letterText = opt.textContent.trim().substring(0, 2).replace(/[、. \s]/g, '');
                    }

                    const text = opt.textContent.trim();

                    let isMatch = false;
                    if (letterText === ans) isMatch = true;
                    else if (ansList.includes(letterText) && letterText !== '') isMatch = true;

                    if (ans.toLowerCase() === 'true' && (letterText === 'true' || text.includes('对') || text.includes('正确'))) isMatch = true;
                    if (ans.toLowerCase() === 'false' && (letterText === 'false' || text.includes('错') || text.includes('错误'))) isMatch = true;

                    if (isMatch) {
                        let isSelected = opt.classList.contains('active') || opt.classList.contains('current') || opt.classList.contains('selected');
                        const radioCheckbox = opt.querySelector('input[type="radio"], input[type="checkbox"]');
                        if (radioCheckbox && radioCheckbox.checked) isSelected = true;

                        if (isSelected) {
                            log(`   -> 选项 ${letterText} 已经是选中状态，跳过。`);
                            questionMatched = true;
                            return;
                        }

                        log(`   -> 命中选项 ${letterText}，执行点击...`);

                        const innerA = opt.querySelector('a');
                        if (innerA) innerA.click();

                        opt.click();
                        if ($) { try { $(opt).trigger('click'); } catch (e) {} }

                        if (radioCheckbox) {
                            radioCheckbox.checked = true;
                            radioCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                        }

                        opt.classList.add('active', 'current', 'selected');
                        if (spanTag) spanTag.classList.add('active');

                        count++;
                        questionMatched = true;
                    }
                });
                if (!questionMatched) log(`   ⚠️ 警告：未找到匹配 [${ans}] 的选项！`);
            } else {
                log(`   -> 未检测到选项列表，尝试按判断题文本匹配...`);
                const allElements = q.querySelectorAll('*');
                let matchedJudge = false;
                for (let el of allElements) {
                    if (el.children.length === 0) {
                        const txt = el.textContent.trim();
                        if (ans.toLowerCase() === 'true' && txt === '对') {
                            el.click(); if ($) try { $(el).trigger('click'); } catch (e) {}
                            log(`   -> 命中判断题: 对`); matchedJudge = true; break;
                        } else if (ans.toLowerCase() === 'false' && txt === '错') {
                            el.click(); if ($) try { $(el).trigger('click'); } catch (e) {}
                            log(`   -> 命中判断题: 错`); matchedJudge = true; break;
                        }
                    }
                }
                if (!matchedJudge) log(`   ⚠️ 警告：未能点击到判断题。`);
            }
        });
        return count;
    }

    setTimeout(createPanel, 2000);
})();