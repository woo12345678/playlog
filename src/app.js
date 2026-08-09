import { games, platforms } from './catalog.js';
import { recommendGames } from './recommender.js';
import { calculateStats, encodeShare, decodeShare, normalizeLibrary } from './library.js';
import { findRememberedGames, memoryPrompts } from './memory-finder.js';
import { searchGames, createCustomGame, normalizeCustomGames, mergeCatalog } from './game-entry.js';
import { normalizeNewsSelection, collectSelectedNews, selectedNewsFreshness, youtubeSearchUrl, googleNewsSearchUrl } from './news.js';
import { escapeHtml, safeCssColor, safeHttpsAttribute } from './html.js';

const STORAGE_KEY = 'playlog-state-v1';
const defaults = {
  seeds: ['elden-ring', 'stardew-valley', 'hades', 'portal-2', 'monster-hunter-world'],
  library: [],
  customGames: [],
  newsGames: ['elden-ring', 'stardew-valley', 'hades', 'zelda-tears-of-the-kingdom', 'brawl-stars'],
  profile: { name: '플레이어', bio: '게임을 만들고, 플레이하고, 기록합니다.' }
};
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let state = loadState();
let allGames = mergeCatalog(games, state.customGames);
let gameMap = new Map(allGames.map(game => [game.id, game]));
let sharedProfile = null;
let newsCache = null;
let newsRequest = null;
let toastTimer;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const customGames = normalizeCustomGames(saved?.customGames || [], games);
    const catalog = mergeCatalog(games, customGames);
    return {
      seeds: Array.isArray(saved?.seeds) ? [...new Set(saved.seeds.filter(id => catalog.some(game => game.id === id)))].slice(0, 10) : [...defaults.seeds],
      library: normalizeLibrary(saved?.library || [], catalog),
      customGames,
      newsGames: normalizeNewsSelection(saved?.newsGames || defaults.newsGames, catalog),
      profile: { name: String(saved?.profile?.name || defaults.profile.name).slice(0, 30), bio: String(saved?.profile?.bio || defaults.profile.bio).slice(0, 100) }
    };
  } catch { return structuredClone(defaults); }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function refreshCatalog() {
  allGames = mergeCatalog(games, state.customGames);
  gameMap = new Map(allGames.map(game => [game.id, game]));
  $('#catalogCount').textContent = allGames.length;
}
function coverImage(game, className = '') {
  const source = game?.coverUrl || game?.fallbackCoverUrl || 'favicon.svg';
  const fallback = game?.fallbackCoverUrl || 'favicon.svg';
  return `<img class="game-cover ${className}" src="${escapeHtml(source)}" data-cover-fallback="${escapeHtml(fallback)}" alt="${escapeHtml(game?.title || '게임')} 표지" loading="lazy" decoding="async">`;
}
function bindCoverFallbacks(root = document) {
  root.querySelectorAll('img[data-cover-fallback]').forEach(image => image.addEventListener('error', () => {
    const fallback = image.dataset.coverFallback;
    if (fallback && image.getAttribute('src') !== fallback) image.src = fallback;
  }, { once:true }));
}
function money(value) { return value === 0 ? '무료' : `${Number(value).toLocaleString('ko-KR')}원대`; }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2400); }
function yearLabel(game) { return Number.isFinite(game.year) ? game.year : '연도 미상'; }

function switchTab(tab) {
  $$('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  $$('[data-view]').forEach(view => { const active = view.dataset.view === tab; view.hidden = !active; view.classList.toggle('active', active); });
  if (tab === 'profile') renderProfile();
  if (tab === 'library') renderLibrary();
  if (tab === 'news') { renderNews(); loadNewsCache(); }
  window.scrollTo({ top: 0, behavior: 'instant' });
  document.title = `${({recommend:'게임 추천',memory:'추억 찾기',library:'내 라이브러리',profile:'플레이 기록',news:'게임 소식',accounts:'계정 연동'})[tab]} — PLAYLOG`;
}
$$('[data-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));

function seedSuggestions(index, query) {
  const choices = query.trim() ? searchGames(allGames, query, 8) : allGames.filter(game => !state.seeds.includes(game.id)).slice(0, 8);
  const results = document.querySelector(`[data-seed-results="${index}"]`);
  results.innerHTML = choices.length ? choices.map(game => `<button class="game-search-option" type="button" data-seed-choice="${escapeHtml(game.id)}">${coverImage(game)}<span class="game-search-copy"><strong>${escapeHtml(game.title)}</strong><small>${yearLabel(game)} · ${escapeHtml(game.platforms.join(' · '))}</small></span></button>`).join('') : '<div class="game-search-option"><strong>찾는 게임이 없습니다.</strong><small>내 라이브러리에서 직접 추가할 수 있어요.</small></div>';
  results.classList.add('cover-results');
  bindCoverFallbacks(results);
  results.hidden = false;
  $$('[data-seed-choice]').forEach(button => button.addEventListener('mousedown', event => event.preventDefault()));
  results.querySelectorAll('[data-seed-choice]').forEach(button => button.addEventListener('click', () => {
    const next = button.dataset.seedChoice;
    if (state.seeds.some((id, other) => id === next && other !== index)) { showToast('이미 넣은 게임입니다.'); return; }
    state.seeds[index] = next; saveState(); renderSeeds(); runRecommendations();
  }));
}

function renderSeeds() {
  const list = $('#seedList');
  list.innerHTML = state.seeds.map((id, index) => {
    const game = gameMap.get(id) || allGames[0];
    return `<div class="seed-row"><span>${String(index + 1).padStart(2, '0')}</span><div class="seed-search-wrap"><input type="search" value="${escapeHtml(game.title)}" aria-label="좋아한 게임 ${index + 1} 검색" aria-autocomplete="list" aria-controls="seedResults${index}" data-seed-search="${index}"><div id="seedResults${index}" class="game-search-results" data-seed-results="${index}" hidden></div></div><button class="remove-seed" type="button" data-remove-seed="${index}" aria-label="${index + 1}번 게임 제거" ${state.seeds.length <= 2 ? 'disabled' : ''}>×</button></div>`;
  }).join('');
  $('#seedCounter').textContent = `${state.seeds.length} / 10`;
  $('#addSeed').disabled = state.seeds.length >= 10;
  $$('[data-seed-search]').forEach(input => {
    input.addEventListener('focus', event => { event.currentTarget.select(); seedSuggestions(Number(event.currentTarget.dataset.seedSearch), ''); });
    input.addEventListener('input', event => seedSuggestions(Number(event.currentTarget.dataset.seedSearch), event.currentTarget.value));
    input.addEventListener('blur', event => { const field = event.currentTarget; const index = Number(field.dataset.seedSearch); setTimeout(() => { const results = document.querySelector(`[data-seed-results="${index}"]`); if (results) results.hidden = true; const game = gameMap.get(state.seeds[index]); if (game && field.isConnected) field.value = game.title; }, 120); });
  });
  $$('[data-remove-seed]').forEach(button => button.addEventListener('click', () => {
    if (state.seeds.length <= 2) return;
    state.seeds.splice(Number(button.dataset.removeSeed), 1); saveState(); renderSeeds(); runRecommendations();
  }));
}
$('#addSeed').addEventListener('click', () => {
  if (state.seeds.length >= 10) return;
  const next = allGames.find(game => !state.seeds.includes(game.id));
  if (next) state.seeds.push(next.id);
  saveState(); renderSeeds(); runRecommendations();
});

function renderPlatformOptions() {
  $('#platformFilter').insertAdjacentHTML('beforeend', platforms.map(platform => `<option>${escapeHtml(platform)}</option>`).join(''));
  $('#libraryPlatform').innerHTML = [...platforms, '기타'].map(platform => `<option>${escapeHtml(platform)}</option>`).join('');
}

function runRecommendations() {
  const filters = { platform: $('#platformFilter').value, mode: $('#modeFilter').value, maxPrice: $('#priceFilter').value };
  const results = recommendGames(allGames, state.seeds, filters);
  $('#recommendSummary').textContent = `${state.seeds.length}개 취향 기준 · 조건을 통과한 상위 ${results.length}개`;
  $('#recommendResults').innerHTML = results.length ? results.map((item, index) => {
    const game = item.game;
    return `<article class="recommend-card" style="--game-color:${safeCssColor(game.color)}">
      ${coverImage(game, 'recommend-cover')}
      <div class="recommend-copy">
        <span class="card-index">MATCH / ${String(index + 1).padStart(2, '0')}</span>
        <h3>${escapeHtml(game.title)}</h3>
        <div class="score-line"><strong>${item.score}</strong><span>취향<br>점수</span></div>
        <div class="game-meta"><span>${escapeHtml(game.platforms.slice(0, 3).join(' · '))}</span><span>${escapeHtml(game.modes.join(' · '))}</span><span>${money(game.priceKRW)}</span><span>${escapeHtml(game.length)}</span></div>
        <ul class="reason-list">${item.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
      </div>
      <footer class="card-footer">${safeHttpsAttribute(game.storeUrl) ? `<a href="${safeHttpsAttribute(game.storeUrl)}" target="_blank" rel="noopener">공식 페이지</a>` : '<span>사용자 추가 게임</span>'}<button type="button" data-add-game="${escapeHtml(game.id)}">＋ 기록에 추가</button></footer>
    </article>`;
  }).join('') : '<div class="empty-state"><h2>조건에 맞는 게임이 없습니다.</h2><p>가격이나 플랫폼 조건을 조금 넓혀보세요.</p></div>';
  bindCoverFallbacks($('#recommendResults'));
  $$('[data-add-game]').forEach(button => button.addEventListener('click', () => openLibraryForm(button.dataset.addGame)));
}
$('#runRecommend').addEventListener('click', runRecommendations);
$('#resetFilters').addEventListener('click', () => { $('#platformFilter').value = '전체'; $('#modeFilter').value = '전체'; $('#priceFilter').value = ''; runRecommendations(); });

function renderMemoryPrompts() {
  $('#memoryPrompts').innerHTML = memoryPrompts.map((prompt, index) => `<button type="button" data-prompt="${index}">${escapeHtml(prompt)}</button>`).join('');
  $$('[data-prompt]').forEach(button => button.addEventListener('click', () => {
    const query = $('#memoryQuery');
    query.value += `${query.value.trim() ? '\n' : ''}${memoryPrompts[Number(button.dataset.prompt)]} `;
    query.focus();
  }));
}
function runMemoryFinder() {
  const query = { text: $('#memoryQuery').value, era: $('#memoryEra').value, perspective: $('#memoryPerspective').value, mode: $('#memoryMode').value, platform: $('#memoryPlatform').value };
  const results = findRememberedGames(allGames, query);
  $('#memorySummary').textContent = results.length ? `${results.length}개 후보를 단서 일치 순서로 찾았습니다.` : '단서가 부족합니다. 캐릭터·맵·조작 방식이나 플레이한 장소를 더 적어주세요.';
  $('#memoryResults').innerHTML = results.map(item => `<article class="memory-card" style="--game-color:${safeCssColor(item.game.color)}"><div class="confidence">${item.confidence}%</div><div><h3>${escapeHtml(item.game.title)}</h3><p>${yearLabel(item.game)} · ${escapeHtml(item.game.genres.join(' · '))} · ${escapeHtml(item.game.platforms.join(' · '))}</p><div class="clues">${item.matchedClues.map(clue => `<span class="clue">${escapeHtml(clue)}</span>`).join('')}</div></div>${safeHttpsAttribute(item.game.storeUrl) ? `<a href="${safeHttpsAttribute(item.game.storeUrl)}" target="_blank" rel="noopener">확인하기 →</a>` : '<span>내가 추가한 게임</span>'}</article>`).join('');
}
$('#findMemory').addEventListener('click', runMemoryFinder);

function selectLibraryGame(gameId) {
  const game = gameMap.get(gameId);
  if (!game) return;
  $('#libraryGameId').value = game.id;
  $('#libraryGameSearch').value = game.title;
  $('#librarySelection').textContent = `선택됨 · ${game.title} · ${yearLabel(game)}`;
  $('#librarySearchResults').hidden = true;
  $('#customGameFields').hidden = true;
  $('#showCustomGame').textContent = '목록에 없나요? 내 게임 직접 추가';
  const platform = game.platforms.find(item => [...$('#libraryPlatform').options].some(option => option.value === item));
  if (platform) $('#libraryPlatform').value = platform;
}

function renderLibrarySearch(query) {
  const results = query.trim() ? searchGames(allGames, query, 12) : allGames.slice(0, 10);
  const panel = $('#librarySearchResults');
  panel.innerHTML = results.length ? results.map(game => `<button class="game-search-option" type="button" data-library-choice="${escapeHtml(game.id)}">${coverImage(game)}<span class="game-search-copy"><strong>${escapeHtml(game.title)}</strong><small>${yearLabel(game)} · ${escapeHtml(game.platforms.join(' · '))}</small></span></button>`).join('') : '<div class="game-search-option"><strong>검색 결과가 없습니다.</strong><small>아래에서 내 게임을 직접 추가하세요.</small></div>';
  panel.classList.add('cover-results');
  bindCoverFallbacks(panel);
  panel.hidden = false;
  panel.querySelectorAll('[data-library-choice]').forEach(button => {
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => selectLibraryGame(button.dataset.libraryChoice));
  });
}

function resetLibraryForm() {
  $('#libraryGameId').value = '';
  $('#libraryGameSearch').value = '';
  $('#librarySelection').textContent = '검색 결과에서 게임을 선택해 주세요.';
  $('#librarySearchResults').hidden = true;
  $('#customGameFields').hidden = true;
  $('#customGameTitle').value = '';
  $('#customGameGenre').value = '';
  $('#customGameMemory').value = '';
  $('#showCustomGame').textContent = '목록에 없나요? 내 게임 직접 추가';
}

function openLibraryForm(gameId) {
  $('#libraryForm').hidden = false;
  resetLibraryForm();
  if (gameId && gameMap.has(gameId)) selectLibraryGame(gameId);
  $('#libraryForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!gameId) $('#libraryGameSearch').focus();
}
$('#libraryGameSearch').addEventListener('focus', event => renderLibrarySearch(event.currentTarget.value));
$('#libraryGameSearch').addEventListener('input', event => { $('#libraryGameId').value = ''; $('#librarySelection').textContent = '검색 결과에서 게임을 선택해 주세요.'; renderLibrarySearch(event.currentTarget.value); });
$('#libraryGameSearch').addEventListener('blur', () => setTimeout(() => $('#librarySearchResults').hidden = true, 140));
$('#showCustomGame').addEventListener('click', () => {
  const fields = $('#customGameFields');
  fields.hidden = !fields.hidden;
  $('#showCustomGame').textContent = fields.hidden ? '목록에 없나요? 내 게임 직접 추가' : '직접 추가 취소';
  if (!fields.hidden) { $('#customGameTitle').value ||= $('#libraryGameSearch').value.trim(); $('#customGameTitle').focus(); $('#libraryGameId').value = ''; }
});
$('#showAddGame').addEventListener('click', () => openLibraryForm());
$('#closeLibraryForm').addEventListener('click', () => { $('#libraryForm').hidden = true; resetLibraryForm(); });
$('#libraryForm').addEventListener('submit', event => {
  event.preventDefault();
  let gameId = $('#libraryGameId').value;
  if (!$('#customGameFields').hidden) {
    try {
      const custom = createCustomGame({ title: $('#customGameTitle').value, genre: $('#customGameGenre').value, platform: $('#libraryPlatform').value, memory: $('#customGameMemory').value }, allGames);
      state.customGames.push(custom);
      refreshCatalog();
      gameId = custom.id;
    } catch (error) {
      showToast(error.message === 'duplicate-title' ? '같은 제목의 게임이 이미 있습니다. 검색해서 선택해 주세요.' : '새 게임의 제목을 입력해 주세요.');
      return;
    }
  }
  if (!gameId || !gameMap.has(gameId)) { showToast('게임을 검색해 선택하거나 직접 추가해 주세요.'); return; }
  const entry = { gameId, platform: $('#libraryPlatform').value, hours: Number($('#libraryHours').value), status: $('#libraryStatus').value, rating: Number($('#libraryRating').value) };
  const existing = state.library.findIndex(item => item.gameId === entry.gameId);
  if (existing >= 0) state.library[existing] = entry; else state.library.push(entry);
  state.library = normalizeLibrary(state.library, allGames); saveState(); $('#libraryForm').hidden = true; resetLibraryForm(); renderLibrary(); renderProfile(); renderSeeds(); showToast(existing >= 0 ? '게임 기록을 업데이트했습니다.' : '게임 기록을 추가했습니다.');
});

function renderLibrary() {
  const empty = !state.library.length;
  $('#libraryEmpty').hidden = !empty;
  $('#libraryList').innerHTML = state.library.map((entry, index) => {
    const game = gameMap.get(entry.gameId);
    if (!game) return '';
    return `<article class="library-row" style="--game-color:${safeCssColor(game.color)}">${coverImage(game, 'library-cover')}<div><h3>${escapeHtml(game.title)}</h3><p>${escapeHtml(game.genres.join(' · '))}</p></div><div class="library-hours"><strong>${entry.hours}</strong> h</div><div class="platform">${escapeHtml(entry.platform)}</div><div class="status"><span>${escapeHtml(entry.status)}</span><div class="rating">${'★'.repeat(entry.rating)}${'☆'.repeat(5-entry.rating)}</div></div><button class="delete-entry" type="button" data-delete-entry="${escapeHtml(entry.gameId)}" aria-label="${escapeHtml(game.title)} 기록 삭제">×</button></article>`;
  }).join('');
  bindCoverFallbacks($('#libraryList'));
  $$('[data-delete-entry]').forEach(button => button.addEventListener('click', () => { state.library = state.library.filter(entry => entry.gameId !== button.dataset.deleteEntry); saveState(); renderLibrary(); renderProfile(); showToast('기록을 삭제했습니다.'); }));
}
$('#loadExample').addEventListener('click', () => {
  if (state.library.length && !confirm('현재 기록을 예시 기록으로 바꿀까요? 먼저 JSON으로 내보낼 수 있습니다.')) return;
  state.library = normalizeLibrary([
    { gameId:'elden-ring',hours:186.4,platform:'Steam',status:'완료',rating:5 },
    { gameId:'stardew-valley',hours:121.8,platform:'Switch',status:'플레이 중',rating:5 },
    { gameId:'hades',hours:64.2,platform:'Steam',status:'완료',rating:5 },
    { gameId:'portal-2',hours:18.6,platform:'Steam',status:'완료',rating:5 },
    { gameId:'monster-hunter-world',hours:94.5,platform:'PlayStation',status:'보류',rating:4 }
  ], allGames); saveState(); renderLibrary(); renderProfile(); showToast('명확히 표시된 예시 기록을 불러왔습니다.');
});

function download(name, contents, type) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([contents], { type })); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
$('#exportLibrary').addEventListener('click', () => download('playlog-library.json', JSON.stringify({ version:2, exportedAt:new Date().toISOString(), customGames:state.customGames, library:state.library }, null, 2), 'application/json'));
$('#importLibrary').addEventListener('click', () => $('#importFile').click());
$('#accountImport').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    let imported;
    const text = await file.text();
    if (file.name.toLowerCase().endsWith('.csv')) {
      imported = text.split(/\r?\n/).slice(1).map(line => {
        const [title, hours, platform = '기타', status = '플레이 중', rating = 0] = line.split(',').map(value => value?.trim());
        const game = games.find(item => item.title.toLocaleLowerCase() === String(title).toLocaleLowerCase());
        return game ? { gameId:game.id, hours:Number(hours), platform, status, rating:Number(rating) } : null;
      });
    } else {
      const parsed = JSON.parse(text);
      imported = Array.isArray(parsed) ? parsed : parsed.library;
      const incomingCustom = normalizeCustomGames(parsed.customGames || [], allGames);
      if (incomingCustom.length) { state.customGames = normalizeCustomGames([...state.customGames, ...incomingCustom], games); refreshCatalog(); }
    }
    const clean = normalizeLibrary(imported, allGames);
    if (!clean.length) throw new Error('일치하는 게임 없음');
    state.library = normalizeLibrary([...state.library, ...clean], allGames); saveState(); renderLibrary(); renderProfile(); renderSeeds(); showToast(`${clean.length}개 기록을 가져왔습니다.`);
  } catch { showToast('가져올 수 없습니다. PLAYLOG JSON 또는 title,hours,platform CSV인지 확인하세요.'); }
  event.target.value = '';
});

function renderProfile() {
  const source = sharedProfile || { ...state.profile, customGames: state.customGames, library: state.library };
  const profileCatalog = mergeCatalog(games, source.customGames || []);
  const profileMap = new Map(profileCatalog.map(game => [game.id, game]));
  const library = normalizeLibrary(source.library, profileCatalog);
  const stats = calculateStats(library, profileCatalog);
  $('#sharedNotice').hidden = !sharedProfile;
  $('#profileName').value = source.name || '플레이어'; $('#profileBio').value = source.bio || '';
  $('#profileName').disabled = Boolean(sharedProfile); $('#profileBio').disabled = Boolean(sharedProfile); $('#shareProfile').hidden = Boolean(sharedProfile);
  $('#totalHours').textContent = stats.totalHours.toLocaleString('ko-KR'); $('#gameCount').textContent = stats.gameCount;
  const max = Math.max(1, ...Object.values(stats.platformHours));
  $('#platformChart').innerHTML = Object.entries(stats.platformHours).sort((a,b)=>b[1]-a[1]).map(([platform,hours]) => `<div class="bar-item"><header><span>${escapeHtml(platform)}</span><strong>${hours.toLocaleString('ko-KR')} h</strong></header><div class="bar-track"><div class="bar-fill" style="width:${Math.max(3,hours/max*100)}%"></div></div></div>`).join('') || '<p>라이브러리에 게임을 추가하면 플랫폼별 시간이 표시됩니다.</p>';
  const top = stats.topGame && profileMap.get(stats.topGame.gameId);
  $('#topGameCard').style.setProperty('--game-color', top?.color || 'var(--ink)');
  $('#topGameCard').innerHTML = top ? `<span>MOST PLAYED</span><strong>${escapeHtml(top.title)}</strong><small>${stats.topGame.hours.toLocaleString('ko-KR')}시간 · ${escapeHtml(stats.topGame.platform)}</small>` : '<span>MOST PLAYED</span><strong>기록을 기다리는 중</strong><small>첫 게임을 추가해 주세요.</small>';
}
$('#profileName').addEventListener('input', event => { if (!sharedProfile) { state.profile.name = event.target.value.slice(0,30); saveState(); } });
$('#profileBio').addEventListener('input', event => { if (!sharedProfile) { state.profile.bio = event.target.value.slice(0,100); saveState(); } });
$('#shareProfile').addEventListener('click', async () => {
  const encoded = encodeShare({ ...state.profile, customGames: state.customGames, library: state.library });
  const url = `${location.origin}${location.pathname}#share=${encoded}`;
  try { await navigator.clipboard.writeText(url); showToast('공개 플레이 기록 링크를 복사했습니다.'); }
  catch { prompt('아래 링크를 복사하세요.', url); }
});

function newsDate(item) {
  if (item.relativeTime) return item.relativeTime;
  const date = new Date(item.publishedAt);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ko-KR', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }).format(date) : '날짜 확인';
}

function renderNewsSearch(query = '') {
  const panel = $('#newsSearchResults');
  if (state.newsGames.length >= 5) {
    panel.innerHTML = '<div class="game-search-option"><strong>다섯 게임을 모두 골랐습니다.</strong><small>다른 게임을 넣으려면 위 카드에서 하나를 빼주세요.</small></div>';
    panel.hidden = false;
    return;
  }
  const candidates = (query.trim() ? searchGames(allGames, query, 12) : allGames.filter(game => state.seeds.includes(game.id) || state.library.some(entry => entry.gameId === game.id)).slice(0, 12))
    .filter(game => !state.newsGames.includes(game.id));
  panel.innerHTML = candidates.length ? candidates.map(game => `<button class="game-search-option" type="button" data-news-choice="${escapeHtml(game.id)}">${coverImage(game)}<span class="game-search-copy"><strong>${escapeHtml(game.title)}</strong><small>${yearLabel(game)} · ${escapeHtml(game.platforms.join(' · '))}</small></span></button>`).join('') : '<div class="game-search-option"><strong>일치하는 게임이 없습니다.</strong><small>다른 제목이나 한글 별칭으로 검색해 보세요.</small></div>';
  bindCoverFallbacks(panel);
  panel.hidden = false;
  panel.querySelectorAll('[data-news-choice]').forEach(button => {
    button.addEventListener('click', () => {
      state.newsGames = normalizeNewsSelection([...state.newsGames, button.dataset.newsChoice], allGames);
      saveState();
      $('#newsGameSearch').value = '';
      panel.hidden = true;
      renderNews();
    });
  });
}

function renderNews() {
  state.newsGames = normalizeNewsSelection(state.newsGames, allGames);
  const selected = state.newsGames.map(id => gameMap.get(id)).filter(Boolean);
  $('#newsGameCounter').textContent = `${selected.length} / 5`;
  $('#newsGameSearch').disabled = selected.length >= 5;
  $('#newsGameSearch').placeholder = selected.length >= 5 ? '최대 5개를 모두 선택했습니다.' : '예: 엘든 링, 젤다, 마리오, 브롤스타즈';
  $('#newsSelectedGames').innerHTML = selected.length ? selected.map(game => `<article class="news-selected" style="--game-color:${safeCssColor(game.color)}">${coverImage(game)}<div class="news-selected-copy"><strong>${escapeHtml(game.title)}</strong><small>${escapeHtml(game.platforms.slice(0,2).join(' · '))}</small></div><button type="button" data-remove-news="${escapeHtml(game.id)}" aria-label="${escapeHtml(game.title)} 소식에서 제거">×</button></article>`).join('') : '<div class="news-empty"><strong>아직 고른 게임이 없습니다.</strong><p>아래 검색창에서 소식을 보고 싶은 게임을 추가하세요.</p></div>';
  bindCoverFallbacks($('#newsSelectedGames'));
  $$('[data-remove-news]').forEach(button => button.addEventListener('click', () => {
    state.newsGames = state.newsGames.filter(id => id !== button.dataset.removeNews);
    saveState(); renderNews();
  }));

  const freshness = newsCache ? selectedNewsFreshness(newsCache, state.newsGames) : { status:'stale', label:'소식 데이터 확인 중', referenceAt:null, unavailable:0, partial:0 };
  const badge = $('#newsFreshness');
  badge.className = `freshness-badge ${freshness.status}`;
  const freshnessText = freshness.referenceAt
    ? `${freshness.label} · ${new Intl.DateTimeFormat('ko-KR', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(freshness.referenceAt))}${freshness.partial ? ` · 부분 ${freshness.partial}` : ''}${freshness.unavailable ? ` · 불가 ${freshness.unavailable}` : ''}`
    : freshness.label;
  const dot = document.createElement('i');
  const freshnessLabel = document.createElement('span');
  freshnessLabel.textContent = freshnessText;
  badge.replaceChildren(dot, freshnessLabel);
  const rows = collectSelectedNews(newsCache, state.newsGames, allGames, 8);
  const cacheNotice = newsCache ? `${freshness.partial ? ` · 부분 캐시 ${freshness.partial}개` : ''}${freshness.unavailable ? ` · 수집 불가 ${freshness.unavailable}개` : ''}` : '';
  $('#newsSummary').textContent = newsCache ? `${selected.length}개 게임 · 최신 소식 ${rows.length}개 · 자동 갱신 ${newsCache.refreshHours || 12}시간${cacheNotice}` : '선택한 게임의 마지막 정상 소식을 준비하고 있습니다.';
  $('#newsGameRail').innerHTML = selected.map(game => `<button type="button" data-news-anchor="news-${escapeHtml(game.id)}">${coverImage(game)}<span>${escapeHtml(game.title)}</span></button>`).join('');
  bindCoverFallbacks($('#newsGameRail'));
  $$('[data-news-anchor]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.newsAnchor)?.scrollIntoView({ behavior:'smooth', block:'start' })));

  const labels = { news:'NEWS', event:'EVENT', video:'VIDEO' };
  $('#newsFeed').innerHTML = selected.length ? selected.map(game => {
    const gameRows = rows.filter(row => row.game.id === game.id);
    const cards = gameRows.length ? gameRows.map(({ item }) => {
      const media = item.thumbnail ? `<img src="${escapeHtml(item.thumbnail)}" data-cover-fallback="${escapeHtml(game.coverUrl || game.fallbackCoverUrl || 'favicon.svg')}" alt="" loading="lazy" decoding="async">` : coverImage(game);
      return `<a class="news-card ${item.type}" href="${safeHttpsAttribute(item.url)}" target="_blank" rel="noopener" style="--game-color:${safeCssColor(game.color)}"><div class="news-card-media">${media}<span class="news-card-type">${labels[item.type]}</span></div><div class="news-card-body"><h4>${escapeHtml(item.title)}</h4><div class="news-card-meta"><span>${escapeHtml(item.source)}</span><time datetime="${escapeHtml(item.publishedAt)}">${escapeHtml(newsDate(item))}</time></div></div></a>`;
    }).join('') : '<div class="news-empty"><strong>아직 캐시된 소식이 없습니다.</strong><p>자동 수집 전에도 오른쪽의 뉴스·YouTube 검색으로 바로 확인할 수 있습니다.</p></div>';
    return `<section class="news-game-section" id="news-${escapeHtml(game.id)}"><header class="news-game-heading">${coverImage(game)}<div><h3>${escapeHtml(game.title)}</h3><p>${escapeHtml(game.genres.slice(0,3).join(' · '))} · ${gameRows.length}개 최신 항목</p></div><div class="news-external-links"><a href="${safeHttpsAttribute(googleNewsSearchUrl(game))}" target="_blank" rel="noopener">뉴스 전체</a><a href="${safeHttpsAttribute(youtubeSearchUrl(game))}" target="_blank" rel="noopener">YouTube 최신</a></div></header><div class="news-card-grid">${cards}</div></section>`;
  }).join('') : '<div class="news-empty"><strong>소식 게임을 선택해 주세요.</strong><p>최대 5개까지 저장되며 다음 방문에도 그대로 유지됩니다.</p></div>';
  bindCoverFallbacks($('#newsFeed'));
}

async function loadNewsCache(force = false) {
  if (newsRequest) return newsRequest;
  const button = $('#refreshNews');
  button.disabled = true;
  button.querySelector('span').textContent = '…';
  newsRequest = fetch(`data/news.json${force ? `?refresh=${Date.now()}` : ''}`, { cache:force ? 'no-store' : 'default' })
    .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
    .then(data => { newsCache = data; renderNews(); if (force) showToast('서버의 최신 소식 캐시를 불러왔습니다.'); })
    .catch(() => { renderNews(); showToast('소식 서버가 잠시 쉬는 중입니다. 마지막 정상 결과를 유지합니다.'); })
    .finally(() => { newsRequest = null; button.disabled = false; button.querySelector('span').textContent = '↻'; });
  return newsRequest;
}

$('#newsGameSearch').addEventListener('focus', event => renderNewsSearch(event.currentTarget.value));
$('#newsGameSearch').addEventListener('input', event => renderNewsSearch(event.currentTarget.value));
$('#newsGameSearch').addEventListener('keydown', event => { if (event.key === 'Escape') $('#newsSearchResults').hidden = true; });
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.news-picker')) $('#newsSearchResults').hidden = true;
});
$('#refreshNews').addEventListener('click', () => loadNewsCache(true));

const accountInfo = {
  steam:['Steam 연동 조건','Steam OpenID로 본인 확인이 가능하고, Web API의 GetOwnedGames로 공개 라이브러리와 플레이 시간을 가져올 수 있습니다. 하지만 API 키는 브라우저에 넣으면 노출되므로 별도 서버가 필요합니다.','https://steamcommunity.com/dev'],
  epic:['Epic Games 대안','일반 사용자 전체 라이브러리와 플레이 시간을 읽는 안정적인 공개 API가 없습니다. PLAYLOG JSON·CSV 가져오기를 사용하거나 향후 공식 권한이 열릴 때 연동합니다.','https://dev.epicgames.com/docs/epic-account-services'],
  xbox:['Xbox 연동 조건','Microsoft ID 로그인만으로 게임 기록 전체가 자동 공개되지는 않습니다. 승인된 Xbox 서비스 범위와 서버 구성이 필요합니다. 현재는 수동 기록을 권장합니다.','https://learn.microsoft.com/gaming/'],
  nintendo:['Nintendo 대안','Nintendo 계정의 소유 게임과 전체 플레이 시간을 외부 개인 앱에 제공하는 공식 공개 API가 없습니다. Switch 본체의 플레이 기록을 보고 직접 추가할 수 있습니다.','https://developer.nintendo.com/'],
  playstation:['PlayStation 연동 조건','PlayStation 파트너 등록과 제품 승인이 필요한 영역입니다. 비공식 스크래핑으로 비밀번호나 세션 쿠키를 요구하지 않습니다.','https://partners.playstation.net/'],
  google:['Google Play Games 대안','Play Games Services는 개발자가 자신의 게임에 업적과 저장 기능을 붙이는 API입니다. 사용자의 모든 모바일 게임 시간을 모으는 범용 API가 아닙니다.','https://developers.google.com/games/services']
};
$$('.account-info').forEach(button => button.addEventListener('click', () => { const [title,body,url] = accountInfo[button.dataset.account]; $('#dialogContent').innerHTML = `<div class="dialog-copy"><p class="kicker">CONNECTION REALITY</p><h2>${title}</h2><p>${body}</p><p><a href="${url}" target="_blank" rel="noopener">공식 개발자 문서 확인 →</a></p></div>`; $('#infoDialog').showModal(); }));
$('#closeDialog').addEventListener('click', () => $('#infoDialog').close());

function loadSharedProfile() {
  const match = location.hash.match(/^#share=(.+)$/);
  if (!match) return;
  const decoded = decodeShare(match[1]);
  if (!decoded) { showToast('공유 링크가 손상되었거나 지원하지 않는 형식입니다.'); return; }
  sharedProfile = decoded; switchTab('profile');
}

$('#catalogCount').textContent = allGames.length;
renderPlatformOptions(); renderSeeds(); renderMemoryPrompts(); renderLibrary(); renderProfile(); runRecommendations(); loadSharedProfile();
