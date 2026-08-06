import { games, platforms } from './catalog.js';
import { recommendGames } from './recommender.js';
import { calculateStats, encodeShare, decodeShare, normalizeLibrary } from './library.js';
import { findRememberedGames, memoryPrompts } from './memory-finder.js';

const STORAGE_KEY = 'playlog-state-v1';
const defaults = {
  seeds: ['elden-ring', 'stardew-valley', 'hades', 'portal-2', 'monster-hunter-world'],
  library: [],
  profile: { name: '플레이어', bio: '게임을 만들고, 플레이하고, 기록합니다.' }
};
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const gameMap = new Map(games.map(game => [game.id, game]));
let state = loadState();
let sharedProfile = null;
let toastTimer;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      seeds: Array.isArray(saved?.seeds) ? [...new Set(saved.seeds.filter(id => gameMap.has(id)))].slice(0, 10) : [...defaults.seeds],
      library: normalizeLibrary(saved?.library || [], games),
      profile: { name: String(saved?.profile?.name || defaults.profile.name).slice(0, 30), bio: String(saved?.profile?.bio || defaults.profile.bio).slice(0, 100) }
    };
  } catch { return structuredClone(defaults); }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char])); }
function money(value) { return value === 0 ? '무료' : `${Number(value).toLocaleString('ko-KR')}원대`; }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2400); }
function optionMarkup(selected = '') { return games.map(game => `<option value="${game.id}" ${game.id === selected ? 'selected' : ''}>${escapeHtml(game.title)} (${game.year})</option>`).join(''); }

function switchTab(tab) {
  $$('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  $$('[data-view]').forEach(view => { const active = view.dataset.view === tab; view.hidden = !active; view.classList.toggle('active', active); });
  if (tab === 'profile') renderProfile();
  if (tab === 'library') renderLibrary();
  window.scrollTo({ top: 0, behavior: 'instant' });
  document.title = `${({recommend:'게임 추천',memory:'추억 찾기',library:'내 라이브러리',profile:'플레이 기록',accounts:'계정 연동'})[tab]} — PLAYLOG`;
}
$$('[data-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));

function renderSeeds() {
  const list = $('#seedList');
  list.innerHTML = state.seeds.map((id, index) => `<div class="seed-row"><span>${String(index + 1).padStart(2, '0')}</span><select aria-label="좋아한 게임 ${index + 1}" data-seed-index="${index}">${optionMarkup(id)}</select><button class="remove-seed" type="button" data-remove-seed="${index}" aria-label="${index + 1}번 게임 제거" ${state.seeds.length <= 2 ? 'disabled' : ''}>×</button></div>`).join('');
  $('#seedCounter').textContent = `${state.seeds.length} / 10`;
  $('#addSeed').disabled = state.seeds.length >= 10;
  $$('[data-seed-index]').forEach(select => select.addEventListener('change', event => {
    const index = Number(event.currentTarget.dataset.seedIndex);
    const next = event.currentTarget.value;
    if (state.seeds.some((id, other) => id === next && other !== index)) { event.currentTarget.value = state.seeds[index]; showToast('이미 넣은 게임입니다. 다른 게임을 골라주세요.'); return; }
    state.seeds[index] = next; saveState(); runRecommendations();
  }));
  $$('[data-remove-seed]').forEach(button => button.addEventListener('click', () => {
    if (state.seeds.length <= 2) return;
    state.seeds.splice(Number(button.dataset.removeSeed), 1); saveState(); renderSeeds(); runRecommendations();
  }));
}
$('#addSeed').addEventListener('click', () => {
  if (state.seeds.length >= 10) return;
  const next = games.find(game => !state.seeds.includes(game.id));
  if (next) state.seeds.push(next.id);
  saveState(); renderSeeds(); runRecommendations();
});

function renderPlatformOptions() {
  $('#platformFilter').insertAdjacentHTML('beforeend', platforms.map(platform => `<option>${platform}</option>`).join(''));
  $('#libraryPlatform').innerHTML = platforms.map(platform => `<option>${platform}</option>`).join('');
  $('#libraryGame').innerHTML = optionMarkup(games[0].id);
}

function runRecommendations() {
  const filters = { platform: $('#platformFilter').value, mode: $('#modeFilter').value, maxPrice: $('#priceFilter').value };
  const results = recommendGames(games, state.seeds, filters);
  $('#recommendSummary').textContent = `${state.seeds.length}개 취향 기준 · 조건을 통과한 상위 ${results.length}개`;
  $('#recommendResults').innerHTML = results.length ? results.map((item, index) => {
    const game = item.game;
    return `<article class="recommend-card" style="--game-color:${game.color}">
      <span class="card-index">MATCH / ${String(index + 1).padStart(2, '0')}</span>
      <h3>${escapeHtml(game.title)}</h3>
      <div class="score-line"><strong>${item.score}</strong><span>취향<br>점수</span></div>
      <div class="game-meta"><span>${game.platforms.slice(0, 3).join(' · ')}</span><span>${game.modes.join(' · ')}</span><span>${money(game.priceKRW)}</span><span>${game.length}</span></div>
      <ul class="reason-list">${item.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
      <footer class="card-footer"><a href="${game.storeUrl}" target="_blank" rel="noopener">공식 페이지</a><button type="button" data-add-game="${game.id}">＋ 기록에 추가</button></footer>
    </article>`;
  }).join('') : '<div class="empty-state"><h2>조건에 맞는 게임이 없습니다.</h2><p>가격이나 플랫폼 조건을 조금 넓혀보세요.</p></div>';
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
  const results = findRememberedGames(games, query);
  $('#memorySummary').textContent = results.length ? `${results.length}개 후보를 단서 일치 순서로 찾았습니다.` : '단서가 부족합니다. 캐릭터·맵·조작 방식이나 플레이한 장소를 더 적어주세요.';
  $('#memoryResults').innerHTML = results.map(item => `<article class="memory-card" style="--game-color:${item.game.color}"><div class="confidence">${item.confidence}%</div><div><h3>${escapeHtml(item.game.title)}</h3><p>${item.game.year} · ${item.game.genres.join(' · ')} · ${item.game.platforms.join(' · ')}</p><div class="clues">${item.matchedClues.map(clue => `<span class="clue">${escapeHtml(clue)}</span>`).join('')}</div></div><a href="${item.game.storeUrl}" target="_blank" rel="noopener">확인하기 →</a></article>`).join('');
}
$('#findMemory').addEventListener('click', runMemoryFinder);

function openLibraryForm(gameId) {
  $('#libraryForm').hidden = false;
  if (gameId && gameMap.has(gameId)) $('#libraryGame').value = gameId;
  $('#libraryForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#showAddGame').addEventListener('click', () => openLibraryForm());
$('#closeLibraryForm').addEventListener('click', () => $('#libraryForm').hidden = true);
$('#libraryForm').addEventListener('submit', event => {
  event.preventDefault();
  const entry = { gameId: $('#libraryGame').value, platform: $('#libraryPlatform').value, hours: Number($('#libraryHours').value), status: $('#libraryStatus').value, rating: Number($('#libraryRating').value) };
  const existing = state.library.findIndex(item => item.gameId === entry.gameId);
  if (existing >= 0) state.library[existing] = entry; else state.library.push(entry);
  state.library = normalizeLibrary(state.library, games); saveState(); $('#libraryForm').hidden = true; renderLibrary(); showToast(existing >= 0 ? '게임 기록을 업데이트했습니다.' : '게임 기록을 추가했습니다.');
});

function renderLibrary() {
  const empty = !state.library.length;
  $('#libraryEmpty').hidden = !empty;
  $('#libraryList').innerHTML = state.library.map((entry, index) => {
    const game = gameMap.get(entry.gameId);
    return `<article class="library-row"><div class="swatch" style="--game-color:${game.color}">${String(index + 1).padStart(2, '0')}</div><div><h3>${escapeHtml(game.title)}</h3><p>${game.genres.join(' · ')}</p></div><div class="library-hours"><strong>${entry.hours}</strong> h</div><div class="platform">${escapeHtml(entry.platform)}</div><div class="status"><span>${entry.status}</span><div class="rating">${'★'.repeat(entry.rating)}${'☆'.repeat(5-entry.rating)}</div></div><button class="delete-entry" type="button" data-delete-entry="${entry.gameId}" aria-label="${escapeHtml(game.title)} 기록 삭제">×</button></article>`;
  }).join('');
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
  ], games); saveState(); renderLibrary(); renderProfile(); showToast('명확히 표시된 예시 기록을 불러왔습니다.');
});

function download(name, contents, type) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([contents], { type })); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
$('#exportLibrary').addEventListener('click', () => download('playlog-library.json', JSON.stringify({ version:1, exportedAt:new Date().toISOString(), library:state.library }, null, 2), 'application/json'));
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
    } else { const parsed = JSON.parse(text); imported = Array.isArray(parsed) ? parsed : parsed.library; }
    const clean = normalizeLibrary(imported, games);
    if (!clean.length) throw new Error('일치하는 게임 없음');
    state.library = normalizeLibrary([...state.library, ...clean], games); saveState(); renderLibrary(); renderProfile(); showToast(`${clean.length}개 기록을 가져왔습니다.`);
  } catch { showToast('가져올 수 없습니다. PLAYLOG JSON 또는 title,hours,platform CSV인지 확인하세요.'); }
  event.target.value = '';
});

function renderProfile() {
  const source = sharedProfile || { ...state.profile, library: state.library };
  const library = normalizeLibrary(source.library, games);
  const stats = calculateStats(library, games);
  $('#sharedNotice').hidden = !sharedProfile;
  $('#profileName').value = source.name || '플레이어'; $('#profileBio').value = source.bio || '';
  $('#profileName').disabled = Boolean(sharedProfile); $('#profileBio').disabled = Boolean(sharedProfile); $('#shareProfile').hidden = Boolean(sharedProfile);
  $('#totalHours').textContent = stats.totalHours.toLocaleString('ko-KR'); $('#gameCount').textContent = stats.gameCount;
  const max = Math.max(1, ...Object.values(stats.platformHours));
  $('#platformChart').innerHTML = Object.entries(stats.platformHours).sort((a,b)=>b[1]-a[1]).map(([platform,hours]) => `<div class="bar-item"><header><span>${escapeHtml(platform)}</span><strong>${hours.toLocaleString('ko-KR')} h</strong></header><div class="bar-track"><div class="bar-fill" style="width:${Math.max(3,hours/max*100)}%"></div></div></div>`).join('') || '<p>라이브러리에 게임을 추가하면 플랫폼별 시간이 표시됩니다.</p>';
  const top = stats.topGame && gameMap.get(stats.topGame.gameId);
  $('#topGameCard').style.setProperty('--game-color', top?.color || 'var(--ink)');
  $('#topGameCard').innerHTML = top ? `<span>MOST PLAYED</span><strong>${escapeHtml(top.title)}</strong><small>${stats.topGame.hours.toLocaleString('ko-KR')}시간 · ${escapeHtml(stats.topGame.platform)}</small>` : '<span>MOST PLAYED</span><strong>기록을 기다리는 중</strong><small>첫 게임을 추가해 주세요.</small>';
}
$('#profileName').addEventListener('input', event => { if (!sharedProfile) { state.profile.name = event.target.value.slice(0,30); saveState(); } });
$('#profileBio').addEventListener('input', event => { if (!sharedProfile) { state.profile.bio = event.target.value.slice(0,100); saveState(); } });
$('#shareProfile').addEventListener('click', async () => {
  const encoded = encodeShare({ ...state.profile, library: state.library });
  const url = `${location.origin}${location.pathname}#share=${encoded}`;
  try { await navigator.clipboard.writeText(url); showToast('공개 플레이 기록 링크를 복사했습니다.'); }
  catch { prompt('아래 링크를 복사하세요.', url); }
});

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

$('#catalogCount').textContent = games.length;
renderPlatformOptions(); renderSeeds(); renderMemoryPrompts(); renderLibrary(); renderProfile(); runRecommendations(); loadSharedProfile();
