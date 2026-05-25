'use strict';

const DATA_DIR = 'data/';
const IMG_DIR = 'images/';

// ===== ローカルストレージ =====
const LS = { OVERRIDES: 'kastudy_overrides', HISTORY: 'kastudy_history' };

function qKey(q) { return q._meta.year + '_' + q._meta.period + '_No' + q.number; }

function getOverrides() {
  try { return JSON.parse(localStorage.getItem(LS.OVERRIDES) || '{}'); } catch { return {}; }
}
function saveOverride(key, answer) {
  const ov = getOverrides(); ov[key] = answer;
  localStorage.setItem(LS.OVERRIDES, JSON.stringify(ov));
}
function getHistory() {
  try { return JSON.parse(localStorage.getItem(LS.HISTORY) || '[]'); } catch { return []; }
}
function addHistory(q, chosen, isCorrect) {
  const hist = getHistory();
  hist.push({
    date: new Date().toISOString(),
    key: qKey(q),
    year: q._meta.year,
    period: q._meta.period,
    number: q.number,
    category: q.category || 'その他',
    chosen,
    correct: q.answer,
    isCorrect,
  });
  localStorage.setItem(LS.HISTORY, JSON.stringify(hist));
  if (chosen !== null) updateSRS(qKey(q), isCorrect);
}

// ===== SRS / ストリーク 定数 =====
const LS_SRS       = 'kastudy_srs';
const LS_STREAK    = 'kastudy_streak';
const LS_EXAM_DATE = 'kastudy_exam_date';
const SRS_INTERVALS = [1, 3, 7, 14, 30]; // level 0-4

// ===== SRS（間隔反復）=====
function getSRS() { try { return JSON.parse(localStorage.getItem(LS_SRS) || '{}'); } catch { return {}; } }

function updateSRS(key, isCorrect) {
  const srs = getSRS();
  const entry = srs[key] || { level: 0 };
  entry.level = isCorrect
    ? Math.min(entry.level + 1, SRS_INTERVALS.length)
    : Math.max(0, entry.level - 1);
  const days = entry.level < SRS_INTERVALS.length ? SRS_INTERVALS[entry.level] : 999;
  const next = new Date();
  next.setDate(next.getDate() + days);
  entry.nextDate = next.toISOString().slice(0, 10);
  entry.lastDate = new Date().toISOString().slice(0, 10);
  srs[key] = entry;
  localStorage.setItem(LS_SRS, JSON.stringify(srs));
}

function getSRSDue(pool) {
  const srs = getSRS();
  const today = new Date().toISOString().slice(0, 10);
  return pool.filter(q => {
    const e = srs[qKey(q)];
    if (!e) return true;
    if (e.level >= SRS_INTERVALS.length) return false;
    return !e.nextDate || e.nextDate <= today;
  });
}

function getSRSStats() {
  const srs = getSRS();
  const today = new Date().toISOString().slice(0, 10);
  let due = 0, graduated = 0, total = Object.keys(srs).length;
  Object.values(srs).forEach(e => {
    if (e.level >= SRS_INTERVALS.length) graduated++;
    else if (!e.nextDate || e.nextDate <= today) due++;
  });
  return { due, graduated, total };
}

// ===== ストリーク =====
function getStreak() { try { return JSON.parse(localStorage.getItem(LS_STREAK) || '{"count":0,"lastDate":"","todayDone":false}'); } catch { return {count:0,lastDate:'',todayDone:false}; } }

function markDailyDone() {
  const streak = getStreak();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yest = yesterday.toISOString().slice(0, 10);
  if (streak.lastDate === today) { streak.todayDone = true; }
  else if (streak.lastDate === yest) { streak.count++; streak.lastDate = today; streak.todayDone = true; }
  else { streak.count = 1; streak.lastDate = today; streak.todayDone = true; }
  localStorage.setItem(LS_STREAK, JSON.stringify(streak));
  return streak;
}

function updateStreakBadge() {
  const streak = getStreak();
  const today = new Date().toISOString().slice(0, 10);
  const badge = $('streak-badge');
  if (!badge) return;
  const done = streak.lastDate === today && streak.todayDone;
  badge.textContent = done ? '✅ ' + streak.count + '日連続' : '🔥 ' + streak.count + '日連続';
  badge.className = 'streak-badge' + (streak.count >= 3 ? ' active' : '');
}

const state = {
  allExams: [],
  extraExams: [],
  selectedIds: new Set(),
  questions: [],
  currentIndex: 0,
  answers: [],
  score: 0,
  wrongQuestions: [],
  settings: { order: 'random', count: 'all', onlyWithAnswer: true },
  isMockMode: false,
  isFlashcardMode: false,
  timeRemaining: 0,
  mockTimer: null,
};

const $ = id => document.getElementById(id);

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  window.scrollTo(0, 0);
}

// ===== データ読み込み =====
let lastLoadTime = 0;

async function loadIndex() {
  const res = await fetch(DATA_DIR + 'index.json?t=' + Date.now());
  if (!res.ok) throw new Error('index.json が読み込めません');
  return (await res.json()).exams;
}

async function loadExam(id) {
  const res = await fetch(DATA_DIR + encodeURIComponent(id) + '.json?t=' + Date.now());
  if (!res.ok) throw new Error(id + '.json が読み込めません');
  return res.json();
}

async function initApp() {
  try {
    lastLoadTime = Date.now();
    const metas = await loadIndex();
    const exams = await Promise.all(metas.map(m => loadExam(m.id)));
    state.allExams = exams;
    renderExamList();
    updateStartButton();
    updateRepeatWrongBadge();
    updateStreakBadge();
    updateWeakSub();
  } catch (e) {
    $('exam-list').innerHTML = '<div style="color:red">読み込み失敗: ' + e.message + '</div>';
  }
}

// フォーカス復帰時に自動リロード（セットアップ画面のみ・5分以上経過時）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const active = document.querySelector('.screen.active');
    if (active && active.id === 'screen-setup' && Date.now() - lastLoadTime > 5 * 60 * 1000) {
      initApp();
    }
  }
});

// ===== 設定画面 =====
function renderExamList() {
  const container = $('exam-list');
  const all = [...state.allExams, ...state.extraExams];
  container.innerHTML = '';
  if (!all.length) { container.innerHTML = '<div class="loading">データなし</div>'; return; }

  all.forEach(exam => {
    const { meta, questions } = exam;
    const withAns = questions.filter(q => q.answer).length;
    const item = document.createElement('label');
    item.className = 'exam-item' + (state.selectedIds.has(meta.id) ? ' checked' : '');
    item.innerHTML =
      '<input type="checkbox" data-id="' + meta.id + '"' + (state.selectedIds.has(meta.id) ? ' checked' : '') + '>' +
      '<div class="exam-item-info">' +
        '<div class="exam-title">' + meta.title + '</div>' +
        '<div class="exam-count">' + questions.length + '問（解答あり: ' + withAns + '問）</div>' +
      '</div>';
    item.querySelector('input').addEventListener('change', e => {
      const id = e.target.dataset.id;
      e.target.checked ? state.selectedIds.add(id) : state.selectedIds.delete(id);
      item.classList.toggle('checked', e.target.checked);
      updateStartButton();
    });
    container.appendChild(item);
  });
}

function updateStartButton() {
  const all = [...state.allExams, ...state.extraExams];
  const sel = all.filter(e => state.selectedIds.has(e.meta.id));
  const onlyAns = $('only-with-answer').checked;
  let total = 0;
  sel.forEach(ex => {
    total += onlyAns ? ex.questions.filter(q => q.answer).length : ex.questions.length;
  });
  const count = $('count-select').value;
  const actual = count === 'all' ? total : Math.min(parseInt(count), total);
  const info = $('selected-count');
  const btn = $('btn-start');
  if (!sel.length) {
    info.textContent = '年度を選択してください';
    btn.disabled = true;
  } else {
    info.textContent = sel.length + '年度選択中 — 出題数: ' + actual + '問';
    btn.disabled = total === 0;
  }
}

// ===== クイズ開始 =====
function startQuiz() {
  const all = [...state.allExams, ...state.extraExams];
  const onlyAns = $('only-with-answer').checked;
  state.settings.order = $('order-select').value;
  state.settings.count = $('count-select').value;

  let pool = [];
  all.filter(e => state.selectedIds.has(e.meta.id)).forEach(exam => {
    const qs = onlyAns ? exam.questions.filter(q => q.answer) : exam.questions;
    qs.forEach(q => pool.push(Object.assign({}, q, { _meta: exam.meta })));
  });

  if (state.settings.order === 'random') pool = shuffle(pool);
  if (state.settings.count !== 'all') pool = pool.slice(0, parseInt(state.settings.count));

  // 解答上書き適用
  const overrides = getOverrides();
  pool = pool.map(q => {
    const k = qKey(q);
    return overrides[k] !== undefined
      ? Object.assign({}, q, { answer: overrides[k], _overridden: true })
      : q;
  });

  state.questions = pool;
  state.currentIndex = 0;
  state.answers = new Array(pool.length).fill(null);
  state.score = 0;
  state.wrongQuestions = [];

  showScreen('quiz');
  renderQuestion();
}

// ===== 問題表示 =====
function renderQuestion() {
  const q = state.questions[state.currentIndex];
  const idx = state.currentIndex;
  const total = state.questions.length;

  // ヘッダー
  $('progress-text').textContent = (idx + 1) + ' / ' + total;
  $('progress-fill').style.width = ((idx + 1) / total * 100).toFixed(1) + '%';
  $('score-display').textContent = state.score;
  $('score-denom').textContent = '/' + idx;

  // タグ
  $('q-year-tag').textContent = q._meta.year + '年度 ' + q._meta.period;
  $('q-cat-tag').textContent = q.category || 'その他';
  $('q-no-tag').textContent = 'No.' + q.number + '  (p.' + q.page + ')';

  // 画像表示
  loadQuestionImage(q);

  // ボタン状態リセット
  const saved = state.answers[idx];
  const btns = document.querySelectorAll('.option-btn');
  btns.forEach(btn => {
    const n = parseInt(btn.dataset.num);
    btn.className = 'option-btn';
    btn.disabled = false;
    if (saved !== null) {
      applyStyle(btn, n, saved.chosen, q.answer);
      btn.disabled = true;
    }
    // イベント再バインド（クローンで重複防止）
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    if (saved === null) {
      clone.addEventListener('click', () => onAnswer(parseInt(clone.dataset.num)));
    }
  });

  // フィードバック
  if (saved !== null) {
    showFeedback(q, saved.chosen);
    $('feedback-area').style.display = '';
  } else {
    $('feedback-area').style.display = 'none';
    $('footer-feedback').style.display = 'none';
    $('footer-feedback').className = 'footer-feedback';
    $('footer-correction-panel').style.display = 'none';
  }

  $('btn-prev').disabled = idx === 0;
  updateNextBtn();

  // カードアニメーション
  const card = $('question-card');
  card.style.animation = 'none';
  requestAnimationFrame(() => { card.style.animation = ''; });

  // モック試験: フィードバック非表示
  if (state.isMockMode) {
    $('feedback-area').style.display = 'none';
    $('footer-feedback').style.display = 'none';
    $('footer-feedback').className = 'footer-feedback';
    $('footer-correction-panel').style.display = 'none';
  }

  // フラッシュカードモード: 選択肢ボタン非表示 → フラッシュカードUI表示
  if (state.isFlashcardMode) {
    $('footer-top-normal').style.display = 'none';
    if (saved === null) {
      $('flashcard-area').style.display = '';
      $('flashcard-revealed').style.display = 'none';
    } else {
      $('flashcard-area').style.display = 'none';
    }
  } else {
    $('footer-top-normal').style.display = '';
    $('flashcard-area').style.display = 'none';
  }
}

function loadQuestionImage(q) {
  const wrap = $('question-image-wrap');
  const img = $('question-img');
  const loading = $('img-loading');
  const errEl = $('img-error');

  img.style.display = 'none';
  errEl.style.display = 'none';
  loading.style.display = '';

  const pageNum = String(q.page).padStart(3, '0');
  const src = IMG_DIR + 'page_' + pageNum + '.png';

  img.onload = () => {
    loading.style.display = 'none';
    img.style.display = 'block';
  };
  img.onerror = () => {
    loading.style.display = 'none';
    errEl.style.display = '';
    $('img-error-detail').textContent = src + ' が見つかりません';
  };
  img.src = src;
}

// 画像タップでズーム
document.addEventListener('click', e => {
  const img = e.target;
  if (img.id === 'question-img' && img.style.display !== 'none') {
    img.classList.toggle('zoomed');
  }
  if (img.classList.contains('zoomed') && e.target !== $('question-img')) {
    $('question-img').classList.remove('zoomed');
  }
});

function applyStyle(btn, n, chosen, correct) {
  if (n === correct) {
    btn.classList.add(chosen === correct ? 'correct' : 'reveal');
  } else if (n === chosen && chosen !== correct) {
    btn.classList.add('wrong');
  }
}

function onAnswer(chosen) {
  const q = state.questions[state.currentIndex];
  const correct = q.answer;
  const isCorrect = chosen === correct;

  state.answers[state.currentIndex] = { chosen, correct, isCorrect };
  if (isCorrect) state.score++;
  else state.wrongQuestions.push(Object.assign({}, q, { chosen }));

  document.querySelectorAll('.option-btn').forEach(btn => {
    applyStyle(btn, parseInt(btn.dataset.num), chosen, correct);
    btn.disabled = true;
  });

  addHistory(q, chosen, isCorrect);
  if (!state.isMockMode) {
    showFeedback(q, chosen);
    $('feedback-area').style.display = '';
  }
  $('score-display').textContent = state.score;
  $('score-denom').textContent = '/' + (state.currentIndex + 1);
  updateNextBtn();
}

// ===== ページビューアーモーダル =====
function openPageModal(srcs, title) {
  const body = $('page-modal-body');
  body.innerHTML = '';
  srcs.forEach(src => {
    const img = document.createElement('img');
    img.src = src;
    img.alt = title;
    body.appendChild(img);
  });
  $('page-modal-title').textContent = title;
  $('page-modal').style.display = 'flex';
}

function closePageModal() {
  $('page-modal').style.display = 'none';
}

function ansImgSrc(page) {
  return IMG_DIR + 'page_' + String(page).padStart(3, '0') + '.png';
}

function textImgSrcs(p0, p1) {
  const srcs = [];
  for (let p = p0; p <= p1; p++)
    srcs.push(IMG_DIR + 'text_' + String(p).padStart(3, '0') + '.png');
  return srcs;
}

function makeRefBtn(label, srcs, title) {
  const btn = document.createElement('button');
  btn.className = 'ref-page-btn';
  btn.textContent = label;
  btn.addEventListener('click', () => openPageModal(srcs, title));
  return btn;
}

function showFeedback(q, chosen) {
  const correct = q.answer;
  const ap = q._meta.answer_page;

  // ---- フッターフィードバックバー ----
  const fb = $('footer-feedback');
  const fbRes = $('footer-feedback-result');
  const fbRef = $('footer-feedback-ref');

  if (chosen === null) {
    fbRes.textContent = '⏭ スキップ';
    fb.className = 'footer-feedback skip';
  } else if (chosen === correct) {
    fbRes.textContent = '✅ 正解！';
    fb.className = 'footer-feedback ok';
  } else {
    fbRes.textContent = '❌ 不正解  正答: ' + correct;
    fb.className = 'footer-feedback ng';
  }

  // 参照ページをクリッカブルボタンで表示
  fbRef.innerHTML = '';
  const qLabel = document.createElement('span');
  qLabel.textContent = '過去問 p.' + q.page;
  fbRef.appendChild(qLabel);

  if (ap) {
    fbRef.appendChild(document.createTextNode('　'));
    fbRef.appendChild(makeRefBtn('解答 p.' + ap, [ansImgSrc(ap)], '解答ページ p.' + ap));
  }
  if (q.textbook_refs && q.textbook_refs.length) {
    const r = q.textbook_refs[0];
    const ps = r.pages[0] === r.pages[1] ? 'p.' + r.pages[0] : 'p.' + r.pages[0] + '-' + r.pages[1];
    fbRef.appendChild(document.createTextNode('　'));
    fbRef.appendChild(makeRefBtn('📖 テキスト ' + ps + '（' + r.topic + '）',
      textImgSrcs(r.pages[0], r.pages[1]),
      'テキスト ' + ps + ' ' + r.topic));
  }
  fb.style.display = '';
  $('footer-correction-panel').style.display = 'none';

  // ---- カード内の詳細フィードバック（スクロールで見える）----
  const res = $('feedback-result');
  if (chosen === null) {
    res.textContent = '⏭ スキップ'; res.className = 'feedback-result skip';
  } else if (chosen === correct) {
    res.textContent = '✅ 正解！'; res.className = 'feedback-result ok';
  } else {
    res.textContent = '❌ 不正解  正答: ' + correct; res.className = 'feedback-result ng';
  }

  // 修正ボタン表示リセット
  $('answer-correction').style.display = 'none';
  const togBtn = $('btn-correction-toggle');
  togBtn.textContent = q._overridden
    ? '✏️ 解答修正済み（変更する場合はここ）'
    : '解答が間違ってる場合はここ';

  // 解答ページリンク
  const api = $('answer-page-info');
  api.innerHTML = '📄 過去問「' + q._meta.source_pdf + '」' + q.page + 'ページ';
  if (ap) {
    api.appendChild(document.createTextNode('　'));
    api.appendChild(makeRefBtn('✅ 解答 p.' + ap, [ansImgSrc(ap)], '解答ページ p.' + ap));
  }

  // テキスト参照リンク
  const refs = $('textbook-refs');
  refs.innerHTML = '';
  if (q.textbook_refs && q.textbook_refs.length) {
    q.textbook_refs.forEach(r => {
      const ps = r.pages[0] === r.pages[1] ? r.pages[0] + 'ページ' : r.pages[0] + '〜' + r.pages[1] + 'ページ';
      const btn = document.createElement('button');
      btn.className = 'ref-item-btn';
      btn.innerHTML = '<div class="ref-topic">📖 テキスト: ' + r.topic + '</div>' +
                      '<div class="ref-pages">土木2級1次テキスト.pdf — ' + ps + ' ▶ タップして表示</div>';
      btn.addEventListener('click', () =>
        openPageModal(textImgSrcs(r.pages[0], r.pages[1]),
          'テキスト p.' + r.pages[0] + (r.pages[0] !== r.pages[1] ? '-' + r.pages[1] : '') + ' ' + r.topic));
      refs.appendChild(btn);
    });
  }
}

// ===== 解答修正 =====
function applyCorrection(newAnswer) {
  const idx = state.currentIndex;
  const q = state.questions[idx];
  saveOverride(qKey(q), newAnswer);
  q.answer = newAnswer;
  q._overridden = true;

  const saved = state.answers[idx];
  if (saved !== null) {
    const wasCorrect = saved.isCorrect;
    const nowCorrect = saved.chosen === newAnswer;
    saved.correct = newAnswer;
    saved.isCorrect = nowCorrect;
    if (!wasCorrect && nowCorrect) state.score++;
    if (wasCorrect && !nowCorrect) state.score--;
    $('score-display').textContent = state.score;
    // ボタン色を更新
    document.querySelectorAll('.option-btn').forEach(btn => {
      const n = parseInt(btn.dataset.num);
      btn.className = 'option-btn';
      applyStyle(btn, n, saved.chosen, newAnswer);
    });
  }
  showFeedback(q, saved ? saved.chosen : null);
}

// ===== 分析画面 =====
function applyHistOverrides(rawHist) {
  const overrides = getOverrides();
  return rawHist.map(h => {
    const correct = overrides[h.key] !== undefined ? overrides[h.key] : h.correct;
    return Object.assign({}, h, { correct, isCorrect: h.chosen === correct });
  });
}

function updateDateFilterCount() {
  const from = $('filter-date-from').value;
  const to   = $('filter-date-to').value;
  if (!from && !to) { $('date-filter-count').textContent = ''; return; }
  const hist = getHistory();
  const count = hist.filter(h => {
    const d = h.date.slice(0, 10);
    return (!from || d >= from) && (!to || d <= to);
  }).length;
  $('date-filter-count').textContent = count + '件が削除対象';
}

function deleteHistoryByDateRange() {
  const from = $('filter-date-from').value;
  const to   = $('filter-date-to').value;
  if (!from && !to) { alert('日付を入力してください'); return; }
  const hist = getHistory();
  const toDelete = hist.filter(h => {
    const d = h.date.slice(0, 10);
    return (!from || d >= from) && (!to || d <= to);
  });
  if (!toDelete.length) { alert('削除対象がありません'); return; }
  if (!confirm(toDelete.length + '件の履歴を削除しますか？')) return;
  const newHist = hist.filter(h => {
    const d = h.date.slice(0, 10);
    return (from && d < from) || (to && d > to);
  });
  localStorage.setItem(LS.HISTORY, JSON.stringify(newHist));
  $('filter-date-from').value = '';
  $('filter-date-to').value = '';
  showStats();
}

function renderDailyChart(hist) {
  const now = new Date();
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const dayData = {};
  days.forEach(d => { dayData[d] = { c: 0, w: 0 }; });
  hist.forEach(h => {
    const d = h.date ? h.date.slice(0, 10) : '';
    if (!dayData[d]) return;
    if (h.isCorrect) dayData[d].c++;
    else if (h.chosen !== null) dayData[d].w++;
  });
  const maxVal = Math.max(...days.map(d => dayData[d].c + dayData[d].w), 1);
  const H = 72;
  const bars = days.map((d, i) => {
    const data = dayData[d];
    const cH = Math.max(Math.round(data.c / maxVal * H), data.c > 0 ? 3 : 0);
    const wH = Math.max(Math.round(data.w / maxVal * H), data.w > 0 ? 3 : 0);
    const isToday = i === 29;
    const lbl = (d.slice(5,7) === '01' || i === 0 || i === 14 || i === 29)
      ? d.slice(5) : '';
    return '<div class="chart-day' + (isToday ? ' today' : '') + '">' +
      '<div class="chart-tooltip">' + d + '<br>正:' + data.c + ' 誤:' + data.w + '</div>' +
      '<div class="chart-stacks">' +
        '<div class="bar-wrong" style="height:' + wH + 'px"></div>' +
        '<div class="bar-correct" style="height:' + cH + 'px"></div>' +
      '</div>' +
      '<div class="bar-label">' + lbl + '</div>' +
    '</div>';
  }).join('');
  return '<div class="chart-container"><div class="chart-bars">' + bars + '</div>' +
    '<div class="chart-legend"><span class="legend-item ok">■ 正解</span>' +
    '<span class="legend-item ng">■ 不正解</span></div></div>';
}

function renderCarelessMistakes(hist) {
  const byKey = {};
  hist.forEach(h => {
    if (!byKey[h.key]) byKey[h.key] = [];
    byKey[h.key].push(h);
  });
  const careless = Object.values(byKey).filter(arr => {
    const last = arr[arr.length - 1];
    return last && !last.isCorrect && last.chosen !== null && arr.some(a => a.isCorrect);
  }).map(arr => arr[arr.length - 1]).slice(-30).reverse();

  if (!careless.length) return '<div class="stats-empty">ケアレスミスなし 👍</div>';
  return careless.map(h =>
    '<div class="careless-item">' +
    '<span class="careless-key">' + h.year + ' ' + h.period + ' No.' + h.number + '</span>' +
    '<span class="careless-cat">' + (h.category || '') + '</span>' +
    '<span class="careless-badge">⚠️ ケアレス</span>' +
    '</div>'
  ).join('');
}

function showStats() {
  showScreen('stats');
  const hist = applyHistOverrides(getHistory());
  const overrides = getOverrides();

  // 合格予測
  renderPassPrediction(hist);

  // 30日グラフ
  $('stats-daily-chart').innerHTML = renderDailyChart(hist);

  // サマリー
  const total = hist.length;
  const correctCount = hist.filter(h => h.isCorrect).length;
  const skipCount = hist.filter(h => h.chosen === null).length;
  const wrongCount = total - correctCount - skipCount;
  const pct = total ? Math.round(correctCount / total * 100) : 0;
  const overrideCount = Object.keys(overrides).length;

  $('stats-summary').innerHTML = [
    statRow('総回答数', total + '問'),
    statRow('正解', correctCount + '問', 'ok'),
    statRow('不正解', wrongCount + '問', 'ng'),
    statRow('スキップ', skipCount + '問'),
    statRow('正答率', pct + '%', pct >= 60 ? 'ok' : 'ng'),
    overrideCount ? statRow('解答修正済み', overrideCount + '問') : '',
  ].join('');

  // ケアレスミス
  $('stats-careless').innerHTML = renderCarelessMistakes(hist);

  // 年度別
  const byExam = {};
  hist.forEach(h => {
    const k = h.year + ' ' + h.period;
    if (!byExam[k]) byExam[k] = { t: 0, c: 0 };
    byExam[k].t++;
    if (h.isCorrect) byExam[k].c++;
  });
  $('stats-by-exam').innerHTML = Object.entries(byExam).map(([k, v]) => {
    const p = Math.round(v.c / v.t * 100);
    return statRow(k, v.c + '/' + v.t + '問 <strong class="' + (p >= 60 ? 'ok' : 'ng') + '">(' + p + '%)</strong>');
  }).join('') || '<div class="stats-empty">データなし</div>';

  // カテゴリ別
  const byCat = {};
  hist.forEach(h => {
    const cat = h.category || 'その他';
    if (!byCat[cat]) byCat[cat] = { t: 0, c: 0 };
    byCat[cat].t++;
    if (h.isCorrect) byCat[cat].c++;
  });
  const catSorted = Object.entries(byCat).sort((a, b) => a[1].c / a[1].t - b[1].c / b[1].t);
  $('stats-by-cat').innerHTML = catSorted.map(([cat, v]) => {
    const p = Math.round(v.c / v.t * 100);
    return statRow(cat, v.c + '/' + v.t + '問 <strong class="' + (p >= 60 ? 'ok' : 'ng') + '">(' + p + '%)</strong>');
  }).join('') || '<div class="stats-empty">データなし</div>';

  // 最近の間違い
  const recentWrong = hist.filter(h => !h.isCorrect && h.chosen !== null).slice(-20).reverse();
  $('stats-recent-wrong').innerHTML = recentWrong.map(h =>
    '<div class="stats-row">' +
    '<span class="wrong-no">' + h.year + ' ' + h.period + ' No.' + h.number + '</span>' +
    '<span style="flex:1;font-size:12px;color:var(--text-muted);padding:0 6px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">' + (h.category || '') + '</span>' +
    '<span class="wrong-ans">→' + h.chosen + '</span>' +
    '<span class="wrong-correct">　正:' + h.correct + '</span>' +
    '</div>'
  ).join('') || '<div class="stats-empty">間違いなし</div>';
}

// ===== 全問プールを取得（オーバーライド適用済み）=====
function getAllPool(onlyWithAnswer) {
  const overrides = getOverrides();
  let pool = [];
  [...state.allExams, ...state.extraExams].forEach(exam => {
    const qs = onlyWithAnswer
      ? exam.questions.filter(q => q.answer || overrides[qKey(Object.assign({}, q, { _meta: exam.meta }))] !== undefined)
      : exam.questions;
    qs.forEach(q => {
      const fakeQ = Object.assign({}, q, { _meta: exam.meta });
      const k = qKey(fakeQ);
      pool.push(overrides[k] !== undefined
        ? Object.assign({}, fakeQ, { answer: overrides[k], _overridden: true })
        : fakeQ);
    });
  });
  return pool;
}

// ===== 模擬試験モード =====
const MOCK_Q = 60, MOCK_SEC = 100 * 60;

function startMockExam() {
  let pool = getAllPool(true);
  if (!pool.length) { alert('年度を選択してください'); return; }
  pool = shuffle(pool).slice(0, Math.min(MOCK_Q, pool.length));

  state.questions = pool;
  state.currentIndex = 0;
  state.answers = new Array(pool.length).fill(null);
  state.score = 0; state.wrongQuestions = [];
  state.isMockMode = true; state.isFlashcardMode = false;
  state.timeRemaining = MOCK_SEC;

  showScreen('quiz');
  $('mock-timer').style.display = '';
  $('score-badge-wrap').style.display = 'none';
  $('q-mode-tag').style.display = '';
  $('q-mode-tag').textContent = '🏆 模擬試験';
  renderQuestion();
  startMockTimer();
}

function startMockTimer() {
  if (state.mockTimer) clearInterval(state.mockTimer);
  state.mockTimer = setInterval(() => {
    state.timeRemaining--;
    updateTimerDisplay();
    if (state.timeRemaining <= 0) { clearInterval(state.mockTimer); showResult(); }
  }, 1000);
}

function stopMockTimer() {
  if (state.mockTimer) { clearInterval(state.mockTimer); state.mockTimer = null; }
}

function updateTimerDisplay() {
  const el = $('mock-timer');
  if (!el) return;
  const m = Math.floor(state.timeRemaining / 60);
  const s = state.timeRemaining % 60;
  el.textContent = m + ':' + String(s).padStart(2, '0');
  if (state.timeRemaining <= 300) el.classList.add('timer-warning');
}

function resetMockMode() {
  stopMockTimer();
  state.isMockMode = false; state.isFlashcardMode = false;
  $('mock-timer').style.display = 'none';
  $('score-badge-wrap').style.display = '';
  $('q-mode-tag').style.display = 'none';
}

// ===== フラッシュカードモード =====
function startFlashcardMode() {
  let pool = getAllPool(true);
  if (!pool.length) { alert('年度を選択してください'); return; }
  pool = shuffle(pool);
  if (state.settings.count !== 'all') pool = pool.slice(0, parseInt(state.settings.count));

  state.questions = pool;
  state.currentIndex = 0;
  state.answers = new Array(pool.length).fill(null);
  state.score = 0; state.wrongQuestions = [];
  state.isMockMode = false; state.isFlashcardMode = true;

  showScreen('quiz');
  $('q-mode-tag').style.display = '';
  $('q-mode-tag').textContent = '🃏 フラッシュカード';
  renderQuestion();
}

function onFlashcardJudge(isCorrect) {
  const q = state.questions[state.currentIndex];
  const idx = state.currentIndex;
  state.answers[idx] = { chosen: q.answer, correct: q.answer, isCorrect };
  if (isCorrect) state.score++;
  else state.wrongQuestions.push(Object.assign({}, q, { chosen: null }));
  addHistory(q, isCorrect ? q.answer : 0, isCorrect);
  showFeedback(q, isCorrect ? q.answer : 0);
  $('feedback-area').style.display = '';
  $('flashcard-area').style.display = 'none';
  $('footer-top-normal').style.display = '';
  $('score-display').textContent = state.score;
  $('score-denom').textContent = '/' + (idx + 1);
  updateNextBtn();
}

// ===== デイリーチャレンジ =====
function startDailyChallenge() {
  const pool = getAllPool(true);
  if (!pool.length) { alert('年度を選択してください'); return; }

  const hist = applyHistOverrides(getHistory());
  // SRS優先で5問
  const due = shuffle(getSRSDue(pool)).slice(0, 5);
  // 弱点カテゴリから残りを補完
  const byCat = {};
  hist.forEach(h => {
    const c = h.category || 'その他';
    if (!byCat[c]) byCat[c] = { t: 0, ok: 0 };
    byCat[c].t++; if (h.isCorrect) byCat[c].ok++;
  });
  const weakCats = Object.entries(byCat)
    .filter(([, v]) => v.t >= 3 && v.ok / v.t < 0.6).map(([c]) => c);
  const dueKeys = new Set(due.map(qKey));
  const weakPool = shuffle(pool.filter(q => weakCats.includes(q.category || 'その他') && !dueKeys.has(qKey(q))));
  const selected = [...due, ...weakPool].slice(0, 10);
  // まだ足りなければランダム補完
  if (selected.length < 10) {
    const selKeys = new Set(selected.map(qKey));
    const rest = shuffle(pool.filter(q => !selKeys.has(qKey(q))));
    selected.push(...rest.slice(0, 10 - selected.length));
  }

  state.questions = selected;
  state.currentIndex = 0;
  state.answers = new Array(selected.length).fill(null);
  state.score = 0; state.wrongQuestions = [];
  state.isMockMode = false; state.isFlashcardMode = false;

  showScreen('quiz');
  $('q-mode-tag').style.display = '';
  $('q-mode-tag').textContent = '📅 デイリー';
  renderQuestion();

  // クリア時にストリーク更新（結果画面で行う）
  state._isDailyMode = true;
}

// ===== 弱点集中 =====
function startWeakCategoryQuiz() {
  const pool = getAllPool(true);
  if (!pool.length) { alert('年度を選択してください'); return; }

  const hist = applyHistOverrides(getHistory());
  const byCat = {};
  hist.forEach(h => {
    const c = h.category || 'その他';
    if (!byCat[c]) byCat[c] = { t: 0, ok: 0 };
    byCat[c].t++; if (h.isCorrect) byCat[c].ok++;
  });
  const weakCats = Object.entries(byCat)
    .filter(([, v]) => v.t >= 3 && v.ok / v.t < 0.6)
    .sort((a, b) => a[1].ok / a[1].t - b[1].ok / b[1].t)
    .slice(0, 3).map(([c]) => c);

  if (!weakCats.length) {
    alert('弱点カテゴリが検出されませんでした。\n（各カテゴリ3問以上の回答履歴が必要です）');
    return;
  }

  const weakPool = shuffle(pool.filter(q => weakCats.includes(q.category || 'その他')));
  state.questions = weakPool.slice(0, 30);
  state.currentIndex = 0;
  state.answers = new Array(state.questions.length).fill(null);
  state.score = 0; state.wrongQuestions = [];
  state.isMockMode = false; state.isFlashcardMode = false;

  const tag = '🎯 弱点：' + weakCats.slice(0, 2).join('・');
  showScreen('quiz');
  $('q-mode-tag').style.display = '';
  $('q-mode-tag').textContent = tag;
  renderQuestion();
}

function updateWeakSub() {
  const hist = applyHistOverrides(getHistory());
  const byCat = {};
  hist.forEach(h => {
    const c = h.category || 'その他';
    if (!byCat[c]) byCat[c] = { t: 0, ok: 0 };
    byCat[c].t++; if (h.isCorrect) byCat[c].ok++;
  });
  const weak = Object.entries(byCat)
    .filter(([, v]) => v.t >= 3 && v.ok / v.t < 0.6)
    .sort((a, b) => a[1].ok / a[1].t - b[1].ok / b[1].t);
  const el = $('weak-sub');
  if (el && weak.length) el.textContent = weak[0][0] + ' ' + Math.round(weak[0][1].ok / weak[0][1].t * 100) + '%';
}

// ===== 5分クイック復習 =====
function startQuickReview() {
  const pool = getAllPool(true);
  if (!pool.length) { alert('年度を選択してください'); return; }
  const due = getSRSDue(pool);
  const selected = shuffle(due.length >= 5 ? due : pool).slice(0, 5);

  state.questions = selected;
  state.currentIndex = 0;
  state.answers = new Array(selected.length).fill(null);
  state.score = 0; state.wrongQuestions = [];
  state.isMockMode = false; state.isFlashcardMode = false;

  showScreen('quiz');
  $('q-mode-tag').style.display = '';
  $('q-mode-tag').textContent = '⚡ 5分クイック';
  renderQuestion();
}

// ===== 直前プラン =====
const PLAN_DAYS = [
  { label: '5日前', icon: '🔥', title: '頻出問題を攻略', desc: '複数年度で出題された重要問題に集中。出題パターンを把握する。', action: 'frequent' },
  { label: '4日前', icon: '🎯', title: '弱点カテゴリ集中', desc: '正答率が低いカテゴリを徹底強化。苦手を潰す日。', action: 'weak' },
  { label: '3日前', icon: '🔁', title: '繰り返し間違い克服', desc: '何度も間違えている問題を反復。確実に定着させる。', action: 'repeat' },
  { label: '2日前', icon: '🎲', title: '全範囲ランダム復習', desc: '全年度からランダム出題。総合的な仕上げ確認。', action: 'random' },
  { label: '前日',  icon: '🏆', title: '模擬試験（本番形式）', desc: '60問・100分で本番同様のシミュレーション。合否ライン確認。', action: 'mock' },
];

function showPlan() {
  showScreen('plan');
  const savedDate = localStorage.getItem(LS_EXAM_DATE);
  if (savedDate) {
    $('exam-date-input').value = savedDate;
    renderPlan(savedDate);
  }
}

function renderPlan(examDateStr) {
  const today = new Date().toISOString().slice(0, 10);
  const examDate = examDateStr ? new Date(examDateStr) : null;
  const todayDate = new Date();

  let infoText = '';
  if (examDate) {
    const diff = Math.ceil((examDate - todayDate) / (1000 * 60 * 60 * 24));
    infoText = diff > 0 ? `試験まで ${diff} 日` : diff === 0 ? '🎌 今日が試験日！' : '試験日は過去の日付です';
    $('exam-date-info').textContent = infoText;
  }

  // 試験日から逆算して各日を特定
  const container = $('plan-list');
  container.innerHTML = '';

  PLAN_DAYS.forEach((plan, i) => {
    let planDate = null;
    if (examDate) {
      planDate = new Date(examDate);
      planDate.setDate(planDate.getDate() - (4 - i));
    }
    const planDateStr = planDate ? planDate.toISOString().slice(0, 10) : null;
    const isToday = planDateStr === today;
    const isPast = planDateStr && planDateStr < today;

    const div = document.createElement('div');
    div.className = 'plan-day' + (isToday ? ' today' : '') + (isPast ? ' past' : '');

    const dateLabel = planDateStr
      ? planDateStr.slice(5).replace('-', '/') + '（' + plan.label + '）'
      : plan.label;

    div.innerHTML =
      '<div class="plan-day-header">' +
        '<span class="plan-day-num' + (isToday ? ' today' : '') + '">' + plan.icon + ' ' + dateLabel + '</span>' +
        '<span class="plan-day-title">' + plan.title + '</span>' +
        (isToday ? '<span class="plan-today-badge">TODAY</span>' : '') +
      '</div>' +
      '<div class="plan-day-body">' +
        '<div class="plan-day-desc">' + plan.desc + '</div>' +
        '<button class="plan-start-btn" data-action="' + plan.action + '">' +
          '▶ ' + (isToday ? '今日のメニューを開始' : 'このメニューを開始') +
        '</button>' +
      '</div>';

    div.querySelector('.plan-start-btn').addEventListener('click', () => {
      switch (plan.action) {
        case 'frequent': showFrequentQuestions(); break;
        case 'weak':     startWeakCategoryQuiz(); break;
        case 'repeat':   startRepeatWrongQuiz(); break;
        case 'random':   startRandomAll(); break;
        case 'mock':     startMockExam(); break;
      }
    });
    container.appendChild(div);
  });
}

function startRandomAll() {
  let pool = getAllPool(true);
  if (!pool.length) { alert('年度を選択してください'); return; }
  pool = shuffle(pool);
  state.questions = pool;
  state.currentIndex = 0;
  state.answers = new Array(pool.length).fill(null);
  state.score = 0; state.wrongQuestions = [];
  state.isMockMode = false; state.isFlashcardMode = false;
  showScreen('quiz');
  $('q-mode-tag').style.display = 'none';
  renderQuestion();
}

// ===== 合格予測 =====
function renderPassPrediction(hist) {
  const el = $('stats-pass-prediction');
  if (!el) return;
  if (hist.length < 10) {
    el.innerHTML = '<div class="stats-empty">10問以上の回答履歴が必要です</div>';
    return;
  }
  const recent = hist.slice(-100);
  const pct = Math.round(recent.filter(h => h.isCorrect).length / recent.length * 100);
  const cls = pct >= 70 ? 'ok' : pct >= 60 ? 'warn' : 'ng';
  const label = pct >= 70 ? '✅ 合格圏内' : pct >= 60 ? '⚠️ ボーダーライン' : '❌ 要強化';

  const srs = getSRSStats();
  const advice = pct >= 70
    ? 'このペースを維持すれば合格の可能性が高いです。苦手分野の最終確認を。'
    : pct >= 60
    ? '合格ライン（60%）付近です。弱点集中モードで重点強化しましょう。'
    : '正答率が低い状態です。頻出問題と弱点カテゴリを優先的に復習してください。';

  el.innerHTML =
    '<div class="pass-prediction-wrap">' +
      '<div style="display:flex;align-items:baseline;gap:10px">' +
        '<span class="pass-score ' + cls + '">' + pct + '%</span>' +
        '<span class="pass-label">' + label + '（直近' + recent.length + '問の正答率）</span>' +
      '</div>' +
      '<div class="pass-gauge-wrap">' +
        '<div class="pass-gauge-fill ' + cls + '" style="width:' + Math.min(pct, 100) + '%"></div>' +
        '<div class="pass-gauge-line"></div>' +
      '</div>' +
      '<div class="pass-advice">' + advice + '</div>' +
      (srs.due > 0 ? '<div class="srs-due-badge">📚 SRS復習待ち: ' + srs.due + '問</div>' : '') +
    '</div>';
}

// ===== 繰り返し間違いクイズ =====
function getRepeatWrongInfo() {
  const hist = applyHistOverrides(getHistory());
  const wrongCounts = {};
  hist.forEach(h => {
    if (!h.isCorrect && h.chosen !== null) {
      wrongCounts[h.key] = (wrongCounts[h.key] || 0) + 1;
    }
  });
  return Object.entries(wrongCounts)
    .filter(([k, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1]);
}

function updateRepeatWrongBadge() {
  const list = getRepeatWrongInfo();
  const badge = $('repeat-wrong-badge');
  if (badge) {
    if (list.length) {
      badge.textContent = list.length + '問';
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
}

function startRepeatWrongQuiz() {
  const repeatWrongKeys = getRepeatWrongInfo().map(([k]) => k);
  if (!repeatWrongKeys.length) { alert('2回以上間違えた問題がありません'); return; }

  const overrides = getOverrides();
  const pool = [];
  [...state.allExams, ...state.extraExams].forEach(exam => {
    exam.questions.forEach(q => {
      const fakeQ = Object.assign({}, q, { _meta: exam.meta });
      const k = qKey(fakeQ);
      if (repeatWrongKeys.includes(k)) {
        const ov = overrides[k];
        pool.push(ov !== undefined
          ? Object.assign({}, fakeQ, { answer: ov, _overridden: true })
          : fakeQ);
      }
    });
  });

  if (!pool.length) { alert('該当する問題データが見つかりません'); return; }
  state.questions = shuffle(pool);
  state.currentIndex = 0;
  state.answers = new Array(pool.length).fill(null);
  state.score = 0; state.wrongQuestions = [];
  showScreen('quiz'); renderQuestion();
}

// ===== 頻出問題 =====
function getFrequentQuestions(threshold) {
  const freq = {};
  [...state.allExams, ...state.extraExams].forEach(exam => {
    exam.questions.forEach(q => {
      const num = q.number;
      if (!freq[num]) freq[num] = [];
      freq[num].push({
        year: exam.meta.year,
        period: exam.meta.period,
        page: q.page,
        answer_page: exam.meta.answer_page,
        category: q.category || 'その他',
        answer: q.answer,
        examId: exam.meta.id,
        q, exam,
      });
    });
  });
  return Object.entries(freq)
    .filter(([, list]) => list.length >= threshold)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([num, list]) => {
      const answers = list.filter(a => a.answer).map(a => a.answer);
      const answerSet = new Set(answers);
      return {
        number: parseInt(num),
        count: list.length,
        appearances: list,
        category: list[0].category,
        answers,
        answerConsistent: answerSet.size <= 1,
        dominantAnswer: answers.length
          ? [...answerSet].sort((a, b) =>
              answers.filter(x => x === b).length - answers.filter(x => x === a).length)[0]
          : null,
      };
    });
}

function renderFrequentList(freqList) {
  const container = $('frequent-list');
  if (!freqList.length) {
    container.innerHTML = '<div class="stats-empty">該当する頻出問題がありません</div>';
    return;
  }
  container.innerHTML = '';
  freqList.forEach(item => {
    const div = document.createElement('div');
    div.className = 'freq-item';
    const ansText = item.answerConsistent
      ? '<span class="freq-answer-consistent">正解: ' + (item.dominantAnswer || '?') + ' （全年度一致）</span>'
      : '<span class="freq-answer-mixed">⚠️ 年度で正解が異なる（要確認）</span>';
    const yearBtns = item.appearances.map(ap => {
      const label = ap.year + ap.period + ' p.' + ap.page;
      return '<button class="freq-year-btn" data-page="' + ap.page + '">' + label + '</button>';
    }).join('');

    div.innerHTML =
      '<div class="freq-item-header">' +
        '<span class="freq-no">No.' + item.number + '</span>' +
        '<span class="freq-cat">' + item.category + '</span>' +
        '<span class="freq-count-badge">' + item.count + '年度</span>' +
        '<span class="freq-chevron">▶</span>' +
      '</div>' +
      '<div class="freq-detail">' +
        '<div class="freq-answer-row">' + ansText + '</div>' +
        '<div class="freq-years">' + yearBtns + '</div>' +
        '<button class="freq-quiz-btn" data-num="' + item.number + '">▶ この問題だけ解く</button>' +
      '</div>';

    // アコーディオン
    div.querySelector('.freq-item-header').addEventListener('click', () => {
      div.classList.toggle('open');
    });
    // 年度ページボタン
    div.querySelectorAll('.freq-year-btn').forEach((btn, i) => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const ap = item.appearances[i];
        openPageModal(
          [ansImgSrc(ap.page)],
          ap.year + ap.period + ' No.' + item.number + ' (' + ap.category + ')'
        );
      });
    });
    // この問題だけ解くボタン
    div.querySelector('.freq-quiz-btn').addEventListener('click', e => {
      e.stopPropagation();
      startFrequentQuiz([item.number]);
    });
    container.appendChild(div);
  });
}

function startFrequentQuiz(numbers) {
  const overrides = getOverrides();
  let pool = [];
  [...state.allExams, ...state.extraExams].forEach(exam => {
    exam.questions.forEach(q => {
      if (numbers && !numbers.includes(q.number)) return;
      if (!q.answer && !(overrides[qKey(Object.assign({}, q, { _meta: exam.meta }))])) return;
      const fakeQ = Object.assign({}, q, { _meta: exam.meta });
      const k = qKey(fakeQ);
      const ov = overrides[k];
      pool.push(ov !== undefined
        ? Object.assign({}, fakeQ, { answer: ov, _overridden: true })
        : fakeQ);
    });
  });
  if (!pool.length) { alert('出題できる問題がありません'); return; }
  pool = shuffle(pool);
  state.questions = pool;
  state.currentIndex = 0;
  state.answers = new Array(pool.length).fill(null);
  state.score = 0; state.wrongQuestions = [];
  showScreen('quiz'); renderQuestion();
}

function showFrequentQuestions() {
  showScreen('frequent');
  if (!state.allExams.length) {
    $('frequent-list').innerHTML = '<div class="stats-empty">データを読み込んでください</div>';
    return;
  }
  const threshold = parseInt($('freq-threshold').value);
  renderFrequentList(getFrequentQuestions(threshold));
}

// ===== GitHub API 連携 =====
const GH_REPO = 'ebr1010/kastudy2';
const GH_TOKEN_KEY = 'kastudy_gh_token';

function getGHToken() { return localStorage.getItem(GH_TOKEN_KEY) || ''; }

function updateTokenStatus() {
  const token = getGHToken();
  const el = $('gh-token-status');
  if (token) {
    el.textContent = '🔑 GitHubトークン: 設定済み';
    el.className = 'gh-token-status set';
  } else {
    el.textContent = '🔑 GitHubトークン: 未設定';
    el.className = 'gh-token-status';
  }
}

function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function applyToGitHub() {
  const token = getGHToken();
  if (!token) {
    alert('先にGitHubトークンを設定してください');
    return;
  }
  const overrides = getOverrides();
  if (!Object.keys(overrides).length) {
    alert('修正データがありません');
    return;
  }

  const btn = $('btn-apply-github');
  btn.disabled = true;
  btn.textContent = '更新中...';

  const allExams = [...state.allExams, ...state.extraExams];
  let successCount = 0;
  const errors = [];

  for (const exam of allExams) {
    // このexamに修正があるか確認
    const hasOverride = exam.questions.some(q => {
      const k = qKey(Object.assign({}, q, { _meta: exam.meta }));
      return overrides[k] !== undefined;
    });
    if (!hasOverride) continue;

    const filePath = 'data/' + exam.meta.id + '.json';
    const apiUrl = 'https://api.github.com/repos/' + GH_REPO + '/contents/' + encodeURIComponent(filePath);

    try {
      // 現在のファイルを取得
      const res = await fetch(apiUrl, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) throw new Error('取得失敗 ' + res.status + (res.status === 401 ? '（トークンを確認）' : ''));
      const fileData = await res.json();

      // 内容をデコードして修正適用
      const content = JSON.parse(decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, '')))));
      content.questions.forEach(q => {
        const k = qKey(Object.assign({}, q, { _meta: exam.meta }));
        if (overrides[k] !== undefined) q.answer = overrides[k];
      });

      // 書き戻し
      const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '解答修正: ' + exam.meta.id,
          content: toBase64(JSON.stringify(content, null, 2)),
          sha: fileData.sha,
        })
      });
      if (!putRes.ok) {
        const hint = putRes.status === 403
          ? '（書き込み権限なし → トークンを削除して再設定：repoにチェック必須）'
          : putRes.status === 401 ? '（トークンが無効 → 再設定してください）' : '';
        throw new Error('書込失敗 ' + putRes.status + hint);
      }
      successCount++;

    } catch (err) {
      errors.push(exam.meta.id + ': ' + err.message);
    }
  }

  btn.disabled = false;
  btn.textContent = '🚀 GitHubに反映（全デバイスに自動更新）';

  if (errors.length) {
    alert('エラーが発生しました:\n' + errors.join('\n'));
  } else {
    localStorage.removeItem(LS.OVERRIDES);
    updateCorrectionOverrideCount();
    const sel = $('correction-exam-select').value;
    if (sel) renderCorrectionList(sel);
    alert(successCount + '年度のデータをGitHubに反映しました。\n数分後に全デバイスへ自動更新されます。');
  }
}

// ===== 解答一括修正リスト =====
function showCorrectionList() {
  showScreen('correction');
  updateTokenStatus();
  const select = $('correction-exam-select');
  select.innerHTML = '<option value="">-- 年度を選択 --</option>';
  [...state.allExams, ...state.extraExams].forEach(exam => {
    const opt = document.createElement('option');
    opt.value = exam.meta.id;
    opt.textContent = exam.meta.title + '（' + exam.questions.length + '問）';
    select.appendChild(opt);
  });
  $('correction-list').innerHTML = '';
  updateCorrectionOverrideCount();
}

function updateCorrectionOverrideCount() {
  const ov = getOverrides();
  const n = Object.keys(ov).length;
  $('correction-override-count').textContent = n ? '修正済み: ' + n + '問' : '';
}

function renderCorrectionList(examId) {
  const exam = [...state.allExams, ...state.extraExams].find(e => e.meta.id === examId);
  const container = $('correction-list');
  if (!exam) { container.innerHTML = ''; return; }

  const overrides = getOverrides();
  const wrap = document.createElement('div');
  wrap.className = 'correction-list-wrap';

  exam.questions.forEach(q => {
    const fakeQ = Object.assign({}, q, { _meta: exam.meta });
    const k = qKey(fakeQ);
    const origAns = q.answer;
    const overriddenAns = overrides[k];
    const currentAns = overriddenAns !== undefined ? overriddenAns : origAns;
    const isOverridden = overriddenAns !== undefined;

    const item = document.createElement('div');
    item.className = 'correction-item' + (isOverridden ? ' overridden' : '');
    item.dataset.key = k;

    const info = document.createElement('div');
    info.className = 'correction-item-info';
    info.innerHTML =
      '<div class="correction-item-no">' + exam.meta.year + ' ' + exam.meta.period + ' No.' + q.number + '</div>' +
      '<div class="correction-item-cat">' + (q.category || 'その他') + '</div>';

    const btns = document.createElement('div');
    btns.className = 'correction-item-btns';

    if (origAns === null && overriddenAns === undefined) {
      // 解答なし問題 → 全ボタン表示（設定可能）
      btns.innerHTML = '<span class="correction-no-answer">解答なし</span>';
    }

    [1, 2, 3, 4].forEach(n => {
      const btn = document.createElement('button');
      btn.className = 'correction-ans-btn' +
        (currentAns === n ? ' active' + (isOverridden ? ' is-override' : '') : '');
      btn.textContent = n;
      btn.addEventListener('click', () => {
        saveOverride(k, n);
        renderCorrectionList(examId);
        updateCorrectionOverrideCount();
      });
      btns.appendChild(btn);
    });

    item.appendChild(info);
    item.appendChild(btns);
    wrap.appendChild(item);
  });

  container.innerHTML = '';
  container.appendChild(wrap);
}

function statRow(label, val, cls) {
  return '<div class="stats-row"><span>' + label + '</span>' +
    '<strong' + (cls ? ' class="' + cls + '"' : '') + '>' + val + '</strong></div>';
}

function updateNextBtn() {
  const btn = $('btn-next');
  const answered = state.answers[state.currentIndex] !== null;
  btn.disabled = !answered;
  btn.textContent = state.currentIndex >= state.questions.length - 1 ? '結果を見る' : '次へ ▶';
}

// ===== ナビ =====
function goNext() {
  if (state.currentIndex >= state.questions.length - 1) showResult();
  else { state.currentIndex++; renderQuestion(); }
}

function goPrev() {
  if (state.currentIndex > 0) { state.currentIndex--; renderQuestion(); }
}

function skipQuestion() {
  const idx = state.currentIndex;
  if (state.answers[idx] !== null) return;
  state.answers[idx] = { chosen: null, correct: state.questions[idx].answer, isCorrect: false };
  state.wrongQuestions.push(Object.assign({}, state.questions[idx], { chosen: null }));
  document.querySelectorAll('.option-btn').forEach(b => { b.disabled = true; });
  addHistory(state.questions[idx], null, false);
  showFeedback(state.questions[idx], null);
  $('feedback-area').style.display = '';
  updateNextBtn();
}

// ===== 結果 =====
function showResult() {
  stopMockTimer();
  showScreen('result');
  const total = state.questions.length;
  const answered = state.answers.filter(Boolean);
  const correct = answered.filter(a => a.isCorrect).length;
  const wrong = answered.filter(a => !a.isCorrect && a.chosen !== null).length;
  const skipped = answered.filter(a => a.chosen === null).length;
  const pct = total ? Math.round(correct / total * 100) : 0;

  let emoji = '😢', title = 'もう少し頑張りましょう！';
  if (pct >= 80) { emoji = '🏆'; title = '素晴らしい！合格圏内です！'; }
  else if (pct >= 60) { emoji = '🎉'; title = '合格ライン到達！'; }
  else if (pct >= 40) { emoji = '😤'; title = 'あと少し！'; }

  $('result-emoji').textContent = emoji;
  $('result-title').textContent = title;
  $('result-correct').textContent = correct;
  $('result-total').textContent = total;
  $('result-pct').textContent = '正答率: ' + pct + '%';

  $('result-breakdown').innerHTML =
    row('出題数', total + '問') +
    row('正解', correct + '問', 'ok') +
    row('不正解', wrong + '問', 'ng') +
    row('スキップ', skipped + '問') +
    row('正答率', pct + '%', pct >= 60 ? 'ok' : 'ng');

  // 模擬試験合否判定
  const mockBadge = $('mock-result-badge');
  if (state.isMockMode) {
    const passed = pct >= 60;
    mockBadge.textContent = passed
      ? '🏆 合格！ ' + pct + '% — 合格ライン（60%）突破！'
      : '❌ 不合格 ' + pct + '% （60%以上で合格）';
    mockBadge.className = 'mock-result-badge ' + (passed ? 'pass' : 'fail');
    mockBadge.style.display = '';
  } else {
    mockBadge.style.display = 'none';
  }

  // デイリーモード完了: ストリーク更新
  if (state._isDailyMode) {
    markDailyDone();
    updateStreakBadge();
  }
  state._isDailyMode = false;

  // モード表示リセット
  $('q-mode-tag').style.display = 'none';

  const wrongItems = state.answers
    .map((a, i) => ({ a, q: state.questions[i] }))
    .filter(({ a }) => a && !a.isCorrect);

  const wl = $('result-wrong-list');
  if (!wrongItems.length) { wl.style.display = 'none'; return; }
  wl.style.display = '';
  wl.innerHTML = '<h3>❌ 間違えた問題 (' + wrongItems.length + '問)</h3>';
  wrongItems.forEach(({ a, q }) => {
    const el = document.createElement('div');
    el.className = 'wrong-item';
    el.innerHTML =
      '<span class="wrong-no">' + q._meta.year + ' ' + q._meta.period + ' No.' + q.number + '</span>' +
      '<span style="flex:1"></span>' +
      '<span class="wrong-ans">→ ' + (a.chosen ?? 'skip') + '</span>' +
      '<span class="wrong-correct">　正: ' + (q.answer ?? '?') + '</span>';
    wl.appendChild(el);
  });
}

function row(label, val, cls) {
  return '<div class="breakdown-row"><span class="breakdown-label">' + label + '</span>' +
         '<span class="breakdown-val' + (cls ? ' ' + cls : '') + '">' + val + '</span></div>';
}

// ===== 追加JSON =====
function handleExtraFiles(files) {
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.meta || !data.questions) throw new Error('形式が不正');
        const idx = state.extraExams.findIndex(ex => ex.meta.id === data.meta.id);
        idx >= 0 ? state.extraExams[idx] = data : state.extraExams.push(data);
        $('extra-files-list').insertAdjacentHTML('beforeend',
          '<div>✅ 追加: ' + data.meta.title + ' (' + data.questions.length + '問)</div>');
        renderExamList(); updateStartButton();
      } catch (err) {
        $('extra-files-list').insertAdjacentHTML('beforeend',
          '<div style="color:red">❌ ' + file.name + ': ' + err.message + '</div>');
      }
    };
    reader.readAsText(file, 'utf-8');
  });
}

// ===== ユーティリティ =====
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ===== イベント =====
$('btn-select-all').addEventListener('click', () => {
  [...state.allExams, ...state.extraExams].forEach(e => state.selectedIds.add(e.meta.id));
  renderExamList(); updateStartButton();
});
$('btn-deselect-all').addEventListener('click', () => {
  state.selectedIds.clear(); renderExamList(); updateStartButton();
});
$('order-select').addEventListener('change', updateStartButton);
$('count-select').addEventListener('change', updateStartButton);
$('only-with-answer').addEventListener('change', updateStartButton);
$('extra-json').addEventListener('change', e => { if (e.target.files.length) handleExtraFiles(e.target.files); });
$('btn-start').addEventListener('click', startQuiz);

$('btn-back-to-setup').addEventListener('click', () => {
  if (confirm('設定に戻りますか？（進捗がリセットされます）')) {
    resetMockMode();
    state._isDailyMode = false;
    showScreen('setup');
  }
});
$('btn-prev').addEventListener('click', goPrev);
$('btn-next').addEventListener('click', goNext);
$('btn-skip').addEventListener('click', skipQuestion);

$('btn-retry-wrong').addEventListener('click', () => {
  if (!state.wrongQuestions.length) { alert('間違えた問題がありません'); return; }
  state.questions = shuffle([...state.wrongQuestions]);
  state.currentIndex = 0;
  state.answers = new Array(state.questions.length).fill(null);
  state.score = 0; state.wrongQuestions = [];
  showScreen('quiz'); renderQuestion();
});
$('btn-retry-all').addEventListener('click', startQuiz);
$('btn-to-setup').addEventListener('click', () => { resetMockMode(); showScreen('setup'); });

$('page-modal-backdrop').addEventListener('click', closePageModal);
$('page-modal-close').addEventListener('click', closePageModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePageModal(); });

// 解答修正（カード内トグル）
$('btn-correction-toggle').addEventListener('click', () => {
  const el = $('answer-correction');
  el.style.display = el.style.display === 'none' ? '' : 'none';
});
// 解答修正（フッター✏️ボタン）
$('btn-footer-correction').addEventListener('click', () => {
  const panel = $('footer-correction-panel');
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
});
document.querySelectorAll('.correction-btn').forEach(btn => {
  btn.addEventListener('click', () => applyCorrection(parseInt(btn.dataset.num)));
});

// GitHub トークンモーダル
function openTokenModal() {
  $('gh-token-input').value = getGHToken();
  $('gh-token-modal').style.display = 'flex';
}
function closeTokenModal() { $('gh-token-modal').style.display = 'none'; }

$('btn-gh-token-setup').addEventListener('click', openTokenModal);
$('gh-token-modal-close').addEventListener('click', closeTokenModal);
$('gh-token-backdrop').addEventListener('click', closeTokenModal);
$('gh-token-save').addEventListener('click', () => {
  const token = $('gh-token-input').value.trim();
  if (token) {
    localStorage.setItem(GH_TOKEN_KEY, token);
    closeTokenModal();
    updateTokenStatus();
  } else {
    alert('トークンを入力してください');
  }
});
$('gh-token-delete').addEventListener('click', () => {
  localStorage.removeItem(GH_TOKEN_KEY);
  $('gh-token-input').value = '';
  closeTokenModal();
  updateTokenStatus();
});
$('btn-apply-github').addEventListener('click', applyToGitHub);

// 解答一括修正
$('btn-correction-list').addEventListener('click', showCorrectionList);
$('btn-back-from-correction').addEventListener('click', () => showScreen('setup'));
$('correction-exam-select').addEventListener('change', e => {
  if (e.target.value) renderCorrectionList(e.target.value);
  else $('correction-list').innerHTML = '';
});

$('btn-clear-overrides').addEventListener('click', () => {
  if (confirm('全ての解答修正をリセットしますか？')) {
    localStorage.removeItem(LS.OVERRIDES);
    const sel = $('correction-exam-select').value;
    if (sel) renderCorrectionList(sel);
    updateCorrectionOverrideCount();
  }
});

// 繰り返し間違いクイズ
$('btn-repeat-wrong').addEventListener('click', startRepeatWrongQuiz);

// 頻出問題
$('btn-frequent').addEventListener('click', showFrequentQuestions);
$('btn-back-from-frequent').addEventListener('click', () => showScreen('setup'));
$('btn-start-frequent-all').addEventListener('click', () => {
  const threshold = parseInt($('freq-threshold').value);
  const freqList = getFrequentQuestions(threshold);
  if (!freqList.length) { alert('頻出問題がありません'); return; }
  startFrequentQuiz(freqList.map(f => f.number));
});
$('freq-threshold').addEventListener('change', () => {
  const threshold = parseInt($('freq-threshold').value);
  renderFrequentList(getFrequentQuestions(threshold));
});

// 分析画面
$('btn-stats').addEventListener('click', showStats);
$('btn-back-from-stats').addEventListener('click', () => showScreen('setup'));
$('filter-date-from').addEventListener('change', updateDateFilterCount);
$('filter-date-to').addEventListener('change', updateDateFilterCount);
$('btn-delete-by-date').addEventListener('click', deleteHistoryByDateRange);
$('btn-clear-history').addEventListener('click', () => {
  if (confirm('回答履歴を全て削除しますか？（解答修正は残ります）')) {
    localStorage.removeItem(LS.HISTORY);
    showStats();
  }
});

// ===== 学習モードボタン =====
$('btn-daily').addEventListener('click', startDailyChallenge);
$('btn-mock').addEventListener('click', startMockExam);
$('btn-weak').addEventListener('click', startWeakCategoryQuiz);
$('btn-quick').addEventListener('click', startQuickReview);
$('btn-flashcard-mode').addEventListener('click', startFlashcardMode);
$('btn-plan').addEventListener('click', showPlan);

// 直前プラン画面
$('btn-back-from-plan').addEventListener('click', () => showScreen('setup'));
$('btn-set-exam-date').addEventListener('click', () => {
  const date = $('exam-date-input').value;
  if (!date) { alert('試験日を入力してください'); return; }
  localStorage.setItem(LS_EXAM_DATE, date);
  renderPlan(date);
});

// フラッシュカードモード
$('btn-flashcard-reveal').addEventListener('click', () => {
  const q = state.questions[state.currentIndex];
  $('flashcard-answer-text').textContent = '正解: ' + (q.answer || '?');
  $('flashcard-revealed').style.display = '';
});
$('btn-fc-correct').addEventListener('click', () => onFlashcardJudge(true));
$('btn-fc-wrong').addEventListener('click', () => onFlashcardJudge(false));

initApp();
