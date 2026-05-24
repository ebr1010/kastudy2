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
};

const $ = id => document.getElementById(id);

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  window.scrollTo(0, 0);
}

// ===== データ読み込み =====
async function loadIndex() {
  const res = await fetch(DATA_DIR + 'index.json');
  if (!res.ok) throw new Error('index.json が読み込めません');
  return (await res.json()).exams;
}

async function loadExam(id) {
  const res = await fetch(DATA_DIR + encodeURIComponent(id) + '.json');
  if (!res.ok) throw new Error(id + '.json が読み込めません');
  return res.json();
}

async function initApp() {
  try {
    const metas = await loadIndex();
    const exams = await Promise.all(metas.map(m => loadExam(m.id)));
    state.allExams = exams;
    renderExamList();
    updateStartButton();
  } catch (e) {
    $('exam-list').innerHTML = '<div style="color:red">読み込み失敗: ' + e.message + '</div>';
  }
}

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
  showFeedback(q, chosen);
  $('feedback-area').style.display = '';
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
function showStats() {
  showScreen('stats');
  const rawHist = getHistory();
  const overrides = getOverrides();

  const hist = rawHist.map(h => {
    const correct = overrides[h.key] !== undefined ? overrides[h.key] : h.correct;
    return Object.assign({}, h, { correct, isCorrect: h.chosen === correct });
  });

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

  const recentWrong = hist.filter(h => !h.isCorrect && h.chosen !== null).slice(-20).reverse();
  $('stats-recent-wrong').innerHTML = recentWrong.map(h =>
    '<div class="stats-row">' +
    '<span class="wrong-no">' + h.year + ' ' + h.period + ' No.' + h.number + '</span>' +
    '<span style="flex:1;font-size:12px;color:var(--text-muted);padding:0 6px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">' + h.category + '</span>' +
    '<span class="wrong-ans">→' + h.chosen + '</span>' +
    '<span class="wrong-correct">　正:' + h.correct + '</span>' +
    '</div>'
  ).join('') || '<div class="stats-empty">間違いなし</div>';
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
  if (confirm('設定に戻りますか？（進捗がリセットされます）')) showScreen('setup');
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
$('btn-to-setup').addEventListener('click', () => showScreen('setup'));

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

// 分析画面
$('btn-stats').addEventListener('click', showStats);
$('btn-back-from-stats').addEventListener('click', () => showScreen('setup'));
$('btn-clear-history').addEventListener('click', () => {
  if (confirm('回答履歴を全て削除しますか？（解答修正は残ります）')) {
    localStorage.removeItem(LS.HISTORY);
    showStats();
  }
});

initApp();
