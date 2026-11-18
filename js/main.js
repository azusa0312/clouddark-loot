/* =====================================================================
 * 主程式：進房畫面、玩家移動／跳躍、相機、走近開箱、掉落清單、系統訊息、主迴圈
 * 畫面只根據 Room 的事件更新；要改變結果一律送意圖給房主（Net.toHost）。
 * ===================================================================== */

const SPEED = 6.5;
const avatars = {}; // pid → avatar
const chests = {}; // chestId → chest 模型
let joined = false;

/* ---------- 進房畫面：輸入 ID、選職業 ---------- */
let chosenJob = null;
try {
  $('nameIn').value = localStorage.getItem('cd-name') || '';
  chosenJob = localStorage.getItem('cd-job');
} catch (e) {}
function renderJobs() {
  const byRole = {};
  JOBS.forEach((j) => (byRole[j.role] = byRole[j.role] || []).push(j));
  $('jobs').innerHTML = Object.entries(byRole)
    .map(
      ([r, js]) =>
        `<div class="jobrow"><span class="rolelbl" style="color:${ROLES[r].col}">${ROLES[r].name}</span>${js
          .map(
            (j) =>
              `<button type="button" class="job ${j.id === chosenJob ? 'on' : ''}" data-job="${j.id}" style="--rc:${ROLES[r].col}">${j.name}</button>`,
          )
          .join('')}</div>`,
    )
    .join('');
}
renderJobs();
$('jobs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-job]');
  if (!b) return;
  chosenJob = b.dataset.job;
  renderJobs();
  checkJoin();
});
$('nameIn').addEventListener('input', checkJoin);
function checkJoin() {
  $('enter').disabled = !($('nameIn').value.trim() && chosenJob);
}
checkJoin();
// 網址有 ?room=代碼 → 加入那個房間；沒有 → 建立新房間
const roomParam = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
if (roomParam) {
  $('enter').textContent = `加入房間 ${roomParam}`;
  $('joinLede').textContent = '輸入你的 ID、選職業，加入隊友的房間。走近寶箱就會打開。';
}
function joinErr(text) {
  $('joinErr').textContent = text;
  $('joinErr').hidden = !text;
}
let connecting = false;
$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('nameIn').value.trim();
  if (!name || !chosenJob || connecting) return;
  try {
    localStorage.setItem('cd-name', name);
    localStorage.setItem('cd-job', chosenJob);
  } catch (e) {}
  connecting = true;
  joinErr('');
  const label = $('enter').textContent;
  $('enter').disabled = true;
  // 公開連線服務忙的時候，加入房間可能要十幾秒：顯示秒數，讓人知道沒有卡住
  const t0 = performance.now();
  const tick = () => ($('enter').textContent = `連線中…（${Math.floor((performance.now() - t0) / 1000)} 秒）`);
  tick();
  const ticker = setInterval(() => (joined || !connecting ? clearInterval(ticker) : tick()), 500);
  const fail = (msg) => {
    clearInterval(ticker);
    connecting = false;
    $('enter').disabled = false;
    $('enter').textContent = label;
    joinErr(msg);
  };
  const me = { type: 'join', name, job: chosenJob };
  const startAsHost = () => {
    Room.create();
    Room.state.teams.forEach((tm) => tm.chests.forEach(addChestModel));
    Net.toHost(me);
  };
  if (roomParam)
    Net.join(
      roomParam,
      () => Net.toHost(me),
      (msg) => fail(msg),
      () => showGone('房主已經離開，房間解散了。'),
    );
  else
    Net.host(
      () => startAsHost(),
      (msg) => {
        // 連不上連線服務 → 改用單人模式（還是可以自己開箱測試）
        Net.mode = 'solo';
        Net.myId = Net.hostId = 'host';
        startAsHost();
        sysLog(`${msg}，改用單人模式（沒有邀請連結）。`);
      },
    );
});
function showGone(msg) {
  $('goneMsg').textContent = msg;
  $('gone').hidden = false;
}
$('goneBtn').addEventListener('click', () => (location.href = location.pathname));

/* ---------- 房間事件 → 畫面 ---------- */
function addChestModel(c) {
  if (chests[c.id]) return;
  const m = makeChest();
  m.g.position.set(c.x, 0, c.z);
  chests[c.id] = m;
}
function addAvatar(p) {
  if (avatars[p.id]) return;
  const a = makeAvatar(p, p.id === Net.myId);
  a.x = a.tx = p.x;
  a.z = a.tz = p.z;
  a.ry = p.ry;
  avatars[p.id] = a;
}
Room.on((evt) => {
  const S = Room.state;
  switch (evt.type) {
    case 'welcome':
      S.teams.forEach((tm) =>
        tm.chests.forEach((c) => {
          addChestModel(c);
          if (c.opened) chests[c.id].target = chests[c.id].open = 1; // 中途加入：寶箱已經開了
        }),
      );
      Object.values(S.players).forEach(addAvatar);
      break;
    case 'full':
      connecting = false;
      $('enter').disabled = false;
      $('enter').textContent = `加入房間 ${roomParam}`;
      joinErr(`房間已滿（${CONFIG.TEAM_SIZE} 人）。`);
      break;
    case 'joined':
      addAvatar(evt.player);
      if (evt.player.id === Net.myId) {
        $('join').hidden = true;
        $('chat').hidden = false;
        // 場地已經開始 → 直接進場地；否則先到等待房間
        if (S.phase === 'field') enterField();
        else {
          sysLog('你進入了等待房間。按 Enter 可以聊天。');
          renderLobby();
          if (S.phase === 'ready') renderDuty();
        }
      } else sysLog(`${evt.player.name}（${jobOf(evt.player.job).name}）加入了房間。`);
      updateRoster();
      renderLobby();
      break;
    case 'dutyPop':
      sysLog('副本準備完成！請按「參加」。');
      renderLobby();
      renderDuty();
      break;
    case 'dutyAnswered':
      renderDuty();
      break;
    case 'dutyCancelled':
      $('duty').hidden = true;
      sysLog(`副本確認取消：${evt.reason}。回到等待房間。`);
      renderLobby();
      break;
    case 'dutyStart':
      $('duty').hidden = true;
      sysLog('全員確認完成，進入場地！');
      enterField();
      break;
    case 'left': {
      const a = avatars[evt.id];
      if (a) scene.remove(a.g);
      delete avatars[evt.id];
      sysLog(`${evt.name} 離開了房間。`);
      updateRoster();
      renderLobby();
      if (lootChestId) renderLoot();
      break;
    }
    case 'chat':
      chatLine(evt.name, evt.job, evt.text, evt.pid === Net.myId);
      break;
    case 'random':
      sysLog(`擲骰：${evt.name} 擲出了 ${evt.value} 點（/random 1～999）`, 'rnd');
      break;
    case 'moved': {
      const a = avatars[evt.id];
      if (a && evt.id !== Net.myId) Object.assign(a, { tx: evt.x, tz: evt.z, ry: evt.ry });
      break;
    }
    case 'jumped': {
      const a = avatars[evt.id];
      if (a && evt.id !== Net.myId && a.y === 0) a.vy = 7.5;
      break;
    }
    case 'chestOpened': {
      const c = chests[evt.chest];
      if (c) c.target = 1;
      const who = S.players[evt.by];
      sysLog(`${who ? who.name : '有人'}打開了第 ${evt.no} 箱寶箱。`);
      const f = Room.findChest(evt.chest);
      if (f && myChest() === f.chest) {
        lootChestId = f.chest.id;
        renderLoot();
        $('loot').hidden = false;
      }
      break;
    }
    case 'chose': {
      const f = Room.findChest(evt.chest);
      const it = f && f.chest.items[evt.idx];
      const p = S.players[evt.pid];
      if (it && p && !evt.auto)
        sysLog(
          evt.c === 'pass'
            ? `${p.name} 放棄了「${itemDef(it.id).name}」。`
            : `${p.name} 擲出 ${CHOICE_NAME[evt.c]} ${evt.roll} 點：「${itemDef(it.id).name}」`,
          evt.c,
        );
      if (f && f.chest.id === lootChestId) renderLoot();
      break;
    }
    case 'itemResolved': {
      const f = Room.findChest(evt.chest);
      const it = f && f.chest.items[evt.idx];
      if (it) {
        const nm = itemDef(it.id).name;
        if (evt.winner) {
          sysLog(`★ ${evt.winnerName} 獲得了「${nm}」（${CHOICE_NAME[evt.c]} ${evt.roll} 點）`, 'win');
          if (evt.winner === Net.myId) addToMine(it.id);
        } else sysLog(`沒有人拿取「${nm}」。`);
      }
      if (f && f.chest.id === lootChestId) renderLoot();
      updateRoster();
      if (!$('record').hidden) renderRecord();
      break;
    }
    case 'settings':
      renderLootNote();
      sysLog(`房主更新了掉落設定：${settingsText(S.settings)}（下一箱開始）`);
      break;
    case 'chestReset': {
      const c = chests[evt.chest];
      if (c) c.target = 0;
      openRequested[evt.chest] = 'leave'; // 要先離開光圈再走回來才會開
      if (evt.chest === lootChestId) $('loot').hidden = true;
      sysLog('新的寶箱出現了，走近就會打開。');
      break;
    }
  }
  $('btnLoot').hidden = !lootChestId;
});

/* ---------- 掉落清單（FF14 風格，原創圖示） ---------- */
const ICONS = {
  head: '<path d="M8 22c0-8 5-13 12-13s12 5 12 13v4H8z"/><path d="M6 26h28v4H6z"/>',
  body: '<path d="M13 8h14l7 6-4 5-3-2v15H13V17l-3 2-4-5z"/>',
  hands: '<path d="M12 32V18l-2-7 3-1 2 6 1-9h3l1 9 1-9h3l1 9 2-6 3 1-2 9v12z"/>',
  legs: '<path d="M11 7h18l-1 25h-6l-2-15-2 15h-6z"/>',
  feet: '<path d="M10 8h8v14l12 4v6H8z"/>',
  mount: '<circle cx="20" cy="20" r="11"/><path d="M8 28c4-6 20-6 24 0l2 5H6z" opacity=".7"/>',
  wings: '<path d="M20 30 6 12c6 0 11 4 14 10 3-6 8-10 14-10z"/><path d="M20 22v10"/>',
  minion: '<circle cx="15" cy="21" r="7"/><circle cx="24" cy="18" r="8"/><circle cx="20" cy="26" r="6"/>',
  hair: '<path d="M10 22c0-9 5-14 10-14s10 5 10 14l-3 10h-3v-9c-3-2-5-6-4-9-2 4-6 7-7 9v9h-3z"/>',
};
function iconSvg(def, rare) {
  return `<svg viewBox="0 0 40 40" class="ic ${rare ? 'rare' : ''}"><g fill="currentColor">${ICONS[def.icon]}</g></svg>`;
}
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ESC_MAP[c]);
let lootChestId = null;
function myChest() {
  const me = Room.state.players[Net.myId];
  return me ? Room.state.teams[me.team].chests[0] : null;
}
function settingsText(s) {
  return s.RARE_MODE === 'guarantee'
    ? `稀有物品必出 ${s.RARE_COUNT} 件`
    : `稀有物品各自 ${Math.round(s.RARE_RATE * 100)}%`;
}
function renderLootNote() {
  const s = Room.state.settings;
  $('lootNote').textContent = `目前設定：${settingsText(s)}，倒數 ${s.ROLL_SECONDS} 秒（自訂，非官方數據）。所有人都能選需要。`;
}
function renderLoot() {
  const f = Room.findChest(lootChestId);
  if (!f) return;
  const chest = f.chest,
    S = Room.state;
  const rows = chest.items
    .map((it, i) => {
      const d = itemDef(it.id);
      const mine = it.choices[Net.myId];
      // 每個人的選擇（點數大的在前）
      const others = Object.entries(it.choices)
        .map(([pid, x]) => ({ pid, ...x, name: (S.players[pid] || {}).name || '？' }))
        .sort((a, b) => b.roll - a.roll)
        .map((x) => {
          const val = x.c === 'pass' ? (x.auto ? '（時間到）' : '') : ' ' + x.roll;
          return `<span class="ch ${x.c} ${x.pid === it.winner ? 'won' : ''}">${esc(x.name)} ${CHOICE_NAME[x.c]}${val}</span>`;
        })
        .join('');
      let act;
      if (it.done) {
        const wn = it.winner && S.players[it.winner] ? S.players[it.winner].name : '？';
        act = it.winner
          ? `<div class="res ${it.winner === Net.myId ? 'me' : ''}">${esc(wn)} 獲得</div>`
          : '<div class="res none">沒人拿取</div>';
      } else if (mine) {
        const val = mine.c === 'pass' ? '' : ' ' + mine.roll;
        act = `<div class="res wait">你：${CHOICE_NAME[mine.c]}${val}<small>等其他人…</small></div>`;
      } else
        act = `<div class="acts">
          <button type="button" class="need" data-i="${i}" data-c="need">需要</button>
          <button type="button" class="greed" data-i="${i}" data-c="greed">貪婪</button>
          <button type="button" class="pass" data-i="${i}" data-c="pass">放棄</button>
        </div>`;
      return `<li class="${it.rare ? 'rare' : ''} ${it.done ? 'done' : ''}">
        ${iconSvg(d, it.rare)}
        <div class="nm"><b>${d.name}</b><small>${KIND_NAME[d.kind]}${it.rare ? '・稀有' : ''}</small>
          <div class="chs">${others}</div></div>
        ${act}
      </li>`;
    })
    .join('');
  const rareN = chest.items.filter((i) => i.rare).length;
  $('lootList').innerHTML = rows;
  $('lootTitle').textContent = `戰利品（第 ${chest.no} 箱）`;
  $('lootSub').textContent = rareN ? `出現 ${rareN} 件稀有物品！` : '這箱沒有稀有物品。';
  $('lootReset').hidden = !Net.isHost;
  $('lootReset').textContent = chest.items.every((x) => x.done) ? '再放一箱' : '跳過剩下的，再放一箱';
  renderLootNote();
}
$('lootList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-c]');
  if (!b) return;
  b.blur();
  Net.toHost({ type: 'choose', chest: lootChestId, idx: +b.dataset.i, choice: b.dataset.c });
});
// 倒數條（每幀更新）
function updateLootTimer() {
  const f = lootChestId && Room.findChest(lootChestId);
  if (!f || $('loot').hidden || !f.chest.opened) return;
  const c = f.chest,
    allDone = c.items.every((x) => x.done);
  const left = Math.max(0, (c.deadline - performance.now()) / 1000);
  $('lootTimerFill').style.width = allDone ? '0%' : (left / c.secs) * 100 + '%';
  $('lootTimerTxt').textContent = allDone ? '全部判定完成' : `剩餘 ${Math.ceil(left)} 秒（沒選的會自動放棄）`;
}
function showLoot(id) {
  lootChestId = id;
  renderLoot();
  $('loot').hidden = false;
  $('btnLoot').hidden = false;
}
function closeLoot() {
  if ($('loot').hidden) return;
  $('loot').hidden = true;
  sysLog('戰利品視窗已關閉：走回寶箱旁邊，或按右邊的「戰利品」就能再打開。');
}
$('lootClose').addEventListener('click', (e) => {
  e.currentTarget.blur();
  closeLoot();
});
$('btnLoot').addEventListener('click', (e) => {
  e.currentTarget.blur();
  if (lootChestId) showLoot(lootChestId);
});
$('lootReset').addEventListener('click', (e) => {
  e.currentTarget.blur();
  const c = myChest();
  if (c) Net.toHost({ type: 'resetChest', chest: c.id });
});

/* ---------- 紀錄（每個人拿過什麼＋擲骰歷史） ---------- */
function renderRecord() {
  const S = Room.state;
  const isRare = (id) => itemDef(id).kind !== 'gear';
  const rows = Object.entries(S.obtained)
    .map(([pid, o]) => {
      const total = Object.values(o.items).reduce((a, b) => a + b, 0);
      const list = Object.entries(o.items)
        .sort((a, b) => isRare(b[0]) - isRare(a[0]))
        .map(([id, n]) => `<span class="${isRare(id) ? 'rare' : ''}">${itemDef(id).name} ×${n}</span>`)
        .join('');
      return `<tr><th>${esc(o.name)}</th><td>${total}</td><td class="its">${list}</td></tr>`;
    })
    .join('');
  $('recTable').innerHTML = rows
    ? `<table><thead><tr><th>玩家</th><th>件數</th><th>物品</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="note">還沒有人拿到物品。</p>';
  const hist = S.history
    .slice()
    .reverse()
    .map((h) => {
      const d = itemDef(h.item);
      const rolls = h.rolls
        .filter((r) => r.c !== 'pass')
        .sort((a, b) => b.roll - a.roll)
        .map((r) => `${esc(r.name)} ${CHOICE_NAME[r.c]} ${r.roll}`)
        .join('、');
      const res = h.winner ? `<b>${esc(h.winnerName)}</b>（${CHOICE_NAME[h.c]} ${h.roll}）` : '沒人拿取';
      return `<li><span class="no">第 ${h.no} 箱</span> <b class="${isRare(h.item) ? 'rare' : ''}">${d.name}</b> → ${res}${rolls ? `<small>${rolls}</small>` : ''}</li>`;
    })
    .join('');
  $('recHist').innerHTML = hist || '<li class="note">還沒有擲骰紀錄。</li>';
}
$('btnRecord').addEventListener('click', (e) => {
  e.currentTarget.blur();
  renderRecord();
  $('record').hidden = false;
});
document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => ($(b.dataset.close).hidden = true)),
);

/* ---------- 我的收藏（存在自己的瀏覽器） ---------- */
function loadMine() {
  try {
    return JSON.parse(localStorage.getItem('cd-mine') || '{}');
  } catch (e) {
    return {};
  }
}
function addToMine(id) {
  const m = loadMine();
  m[id] = (m[id] || 0) + 1;
  try {
    localStorage.setItem('cd-mine', JSON.stringify(m));
  } catch (e) {}
}
function renderMine() {
  const m = loadMine();
  $('mineList').innerHTML = RARE_ITEMS.concat(GEAR_ITEMS)
    .map((d) => {
      const rare = d.kind !== 'gear';
      return `<div class="mi ${m[d.id] ? 'have' : ''} ${rare ? 'rare' : ''}">${iconSvg(d, rare)}<span>${d.name}</span><b>${m[d.id] ? '×' + m[d.id] : '未取得'}</b></div>`;
    })
    .join('');
}
let clearArmed = false;
$('btnMine').addEventListener('click', (e) => {
  e.currentTarget.blur();
  clearArmed = false;
  $('mineConfirm').hidden = true;
  renderMine();
  $('mine').hidden = false;
});
$('mineClear').addEventListener('click', () => {
  if (!clearArmed) {
    clearArmed = true;
    $('mineConfirm').hidden = false;
    return;
  }
  try {
    localStorage.removeItem('cd-mine');
  } catch (e) {}
  clearArmed = false;
  $('mineConfirm').hidden = true;
  renderMine();
});

/* ---------- 房主：掉落設定 ---------- */
$('btnSettings').addEventListener('click', (e) => {
  e.currentTarget.blur();
  const s = Room.state.settings;
  document.querySelector(`#setForm input[name=mode][value=${s.RARE_MODE}]`).checked = true;
  $('setRate').value = Math.round(s.RARE_RATE * 100);
  $('setCount').value = String(s.RARE_COUNT);
  $('setSecs').value = s.ROLL_SECONDS;
  $('settings').hidden = false;
});
$('setForm').addEventListener('submit', (e) => {
  e.preventDefault();
  Net.toHost({
    type: 'settings',
    settings: {
      RARE_MODE: document.querySelector('#setForm input[name=mode]:checked').value,
      RARE_RATE: +$('setRate').value / 100,
      RARE_COUNT: +$('setCount').value,
      ROLL_SECONDS: +$('setSecs').value,
    },
  });
  $('settings').hidden = true;
});

/* ---------- 系統訊息、成員名單 ---------- */
function sysLog(text, cls = '') {
  const d = document.createElement('div');
  d.className = 'sys ' + cls;
  d.textContent = text;
  $('log').appendChild(d);
  while ($('log').children.length > 120) $('log').firstChild.remove();
  $('log').scrollTop = 1e9;
}
function updateRoster() {
  const S = Room.state;
  $('btnSettings').hidden = !Net.isHost;
  $('roster').innerHTML = S.teams
    .map(
      (tm) =>
        `<h4>隊伍 ${tm.id + 1}（${tm.members.length}/${S.settings.TEAM_SIZE}）</h4>` +
        tm.members
          .map((pid) => {
            const p = S.players[pid],
              j = jobOf(p.job);
            const got = S.obtained[pid] ? Object.values(S.obtained[pid].items).reduce((a, b) => a + b, 0) : 0;
            const tag = `${j.name}${pid === Net.hostId ? '・房主' : ''}${got ? `・${got} 件` : ''}`;
            return `<div class="mem"><i style="background:${ROLES[j.role].col}"></i>${esc(p.name)}<small>${tag}</small></div>`;
          })
          .join(''),
    )
    .join('');
}

/* ---------- 等待房間與副本確認視窗 ---------- */
// 進場地（全員按參加之後，或場地已經開始才加入的人）
function enterField() {
  if (joined) return;
  joined = true;
  // 聊天框移回左下角
  document.body.appendChild($('chat'));
  $('chat').classList.remove('inlobby');
  $('lobby').hidden = true;
  $('duty').hidden = true;
  $('hud').hidden = false;
  showRoomBar();
  const me = Room.state.players[Net.myId];
  sysLog(`你以「${me.name}」（${jobOf(me.job).name}）進入了場地。走近寶箱就會打開。`);
  const c = myChest();
  if (c && c.opened) {
    lootChestId = c.id;
    renderLoot();
    $('loot').hidden = false;
  }
}
function renderLobby() {
  if (joined) return;
  const S = Room.state;
  $('lobby').hidden = false;
  // 等待房間時，聊天框放進卡片裡（放在左下角會蓋住開始按鈕）
  if (!$('chat').classList.contains('inlobby')) {
    document.querySelector('.lobbycard').appendChild($('chat'));
    $('chat').classList.add('inlobby');
  }
  if (Net.mode === 'solo') {
    $('lobbyCode').textContent = '單人模式（沒有邀請連結）';
    $('lobbyInvite').hidden = true;
  } else {
    $('lobbyCode').innerHTML = `房間代碼 <b>${Net.code}</b>`;
    $('lobbyInvite').hidden = false;
    $('lobbyUrl').value = Net.inviteUrl();
  }
  const members = S.teams.flatMap((tm) => tm.members);
  const slots = [];
  for (let i = 0; i < S.settings.TEAM_SIZE * S.teams.length; i++) {
    const pid = members[i];
    if (!pid) {
      slots.push('<div class="slot empty"><i></i><span>空位</span></div>');
      continue;
    }
    const p = S.players[pid],
      j = jobOf(p.job);
    const tag = [pid === Net.hostId ? '房主' : '', pid === Net.myId ? '你' : ''].filter(Boolean).join('・');
    slots.push(
      `<div class="slot" style="--rc:${ROLES[j.role].col}"><i>${j.name.slice(0, 1)}</i><span>${esc(p.name)}<small>${j.name}${tag ? '・' + tag : ''}</small></span></div>`,
    );
  }
  $('lobbySlots').innerHTML = slots.join('');
  const n = members.length,
    max = S.settings.TEAM_SIZE * S.teams.length;
  const waiting = S.phase === 'ready';
  $('lobbyStart').hidden = !Net.isHost;
  $('lobbyStart').disabled = waiting;
  $('lobbyStart').textContent = waiting ? '確認中…' : '開始（申請進入）';
  $('lobbyStatus').textContent = waiting
    ? '副本確認中…'
    : Net.isHost
      ? `目前 ${n} / ${max} 人。人到齊後按「開始」。`
      : `目前 ${n} / ${max} 人。等待房主開始…`;
}
$('lobbyStart').addEventListener('click', (e) => {
  e.currentTarget.blur();
  Net.toHost({ type: 'startDuty' });
});
$('lobbyInvite').addEventListener('click', (e) => copyInvite(e.currentTarget, $('lobbyUrl')));

// 副本確認視窗
function renderDuty() {
  const d = Room.state.duty;
  if (!d) return;
  $('duty').hidden = false;
  const ids = Object.keys(d.answers);
  $('dutySlots').innerHTML = ids
    .map((pid) => {
      const p = Room.state.players[pid] || { name: '？', job: 'PLD' },
        j = jobOf(p.job);
      const st = d.answers[pid] === true ? 'ok' : d.answers[pid] === false ? 'no' : '';
      return `<div class="dslot ${st}" style="--rc:${ROLES[j.role].col}" title="${esc(p.name)}"><i>${j.name.slice(0, 1)}</i><small>${esc(p.name)}</small></div>`;
    })
    .join('');
  const okN = ids.filter((pid) => d.answers[pid] === true).length;
  $('dutyCount').textContent = `已確認 ${okN} / ${ids.length}`;
  const mine = d.answers[Net.myId];
  const answered = mine === true || mine === false;
  $('dutyYes').hidden = $('dutyNo').hidden = answered;
  $('dutyWait').hidden = !answered;
}
function updateDutyTimer() {
  const d = Room.state && Room.state.duty;
  if (!d || $('duty').hidden) return;
  const left = Math.max(0, (d.deadline - performance.now()) / 1000);
  $('dutyFill').style.width = (left / d.secs) * 100 + '%';
}
$('dutyYes').addEventListener('click', (e) => {
  e.currentTarget.blur();
  Net.toHost({ type: 'dutyAnswer', ok: true });
});
$('dutyNo').addEventListener('click', (e) => {
  e.currentTarget.blur();
  Net.toHost({ type: 'dutyAnswer', ok: false });
});

/* ---------- 聊天室與邀請連結 ---------- */
function chatLine(name, job, text, mine) {
  const d = document.createElement('div');
  d.className = 'msg' + (mine ? ' mine' : '');
  const n = document.createElement('b');
  n.textContent = name;
  n.style.color = ROLES[jobOf(job).role].col;
  d.append(n, document.createTextNode('：' + text));
  $('log').appendChild(d);
  while ($('log').children.length > 120) $('log').firstChild.remove();
  $('log').scrollTop = 1e9;
}
$('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('chatIn').value.trim();
  if (text) Net.toHost({ type: 'chat', text });
  $('chatIn').value = '';
  $('chatIn').blur();
});
$('chatIn').addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    $('chatIn').value = '';
    $('chatIn').blur();
  }
});
function showRoomBar() {
  if (Net.mode === 'solo') {
    $('roomCode').textContent = '單人模式';
    $('btnInvite').hidden = true;
    return;
  }
  $('roomCode').innerHTML = `房間代碼 <b>${Net.code}</b>`;
  $('btnInvite').hidden = false;
  $('inviteUrl').value = Net.inviteUrl();
}
async function copyInvite(b, urlBox) {
  b.blur();
  try {
    await navigator.clipboard.writeText(Net.inviteUrl());
    b.textContent = '已複製！';
  } catch (err) {
    // 不能寫剪貼簿 → 顯示網址讓人自己複製
    urlBox.value = Net.inviteUrl();
    urlBox.hidden = false;
    urlBox.select();
    b.textContent = '請手動複製網址';
  }
  setTimeout(() => (b.textContent = '複製邀請連結'), 2000);
  sysLog(`邀請連結：${Net.inviteUrl()}`);
}
$('btnInvite').addEventListener('click', (e) => copyInvite(e.currentTarget, $('inviteUrl')));

/* ---------- 輸入：WASD、空白鍵跳躍、拖曳轉視角、滾輪縮放、手機搖桿 ---------- */
const keys = {};
addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  // Enter：開始打字聊天（跟 FF14 一樣）
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !$('chat').hidden) {
    e.preventDefault();
    Object.keys(keys).forEach((k) => (keys[k] = false));
    $('chatIn').focus();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (joined) jump();
    return;
  }
  if (e.code === 'Escape') {
    closeLoot();
    ['record', 'mine', 'settings'].forEach((id) => ($(id).hidden = true));
  }
  keys[e.code] = true;
});
addEventListener('keyup', (e) => (keys[e.code] = false));
$('chatIn').addEventListener('focus', () => Object.keys(keys).forEach((k) => (keys[k] = false)));
addEventListener('blur', () => Object.keys(keys).forEach((k) => (keys[k] = false)));
let camYaw = 0,
  camPitch = 0.62,
  camDist = 14;
const cvs = renderer.domElement;
let drag = null,
  joy = null;
const touchMove = { x: 0, y: 0 };
cvs.addEventListener('contextmenu', (e) => e.preventDefault());
cvs.addEventListener('pointerdown', (e) => {
  cvs.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch' && e.clientX < innerWidth / 2 && !joy) {
    joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
    return;
  }
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
cvs.addEventListener('pointermove', (e) => {
  if (joy && e.pointerId === joy.id) {
    let dx = e.clientX - joy.ox,
      dy = e.clientY - joy.oy;
    const l = Math.hypot(dx, dy);
    if (l > 50) {
      dx *= 50 / l;
      dy *= 50 / l;
    }
    touchMove.x = dx / 50;
    touchMove.y = dy / 50;
    return;
  }
  if (drag && e.pointerId === drag.id) {
    camYaw -= (e.clientX - drag.x) * 0.006;
    camPitch = Math.max(0.12, Math.min(1.35, camPitch + (e.clientY - drag.y) * 0.005));
    drag.x = e.clientX;
    drag.y = e.clientY;
  }
});
const endPtr = (e) => {
  if (joy && e.pointerId === joy.id) {
    joy = null;
    touchMove.x = touchMove.y = 0;
  }
  if (drag && e.pointerId === drag.id) drag = null;
};
cvs.addEventListener('pointerup', endPtr);
cvs.addEventListener('pointercancel', endPtr);
cvs.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    camDist = Math.max(5, Math.min(36, camDist + e.deltaY * 0.012));
  },
  { passive: false },
);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

/* ---------- 玩家移動與跳躍 ---------- */
function jump() {
  const a = avatars[Net.myId];
  if (!a || a.y > 0.01) return;
  a.vy = 7.5;
  Net.toHost({ type: 'jump' });
}
let lastSent = 0,
  sentPos = '';
function updateMe(dt) {
  const a = avatars[Net.myId];
  if (!a) return;
  let f = 0,
    r = 0;
  if (keys.KeyW || keys.ArrowUp) f += 1;
  if (keys.KeyS || keys.ArrowDown) f -= 1;
  if (keys.KeyD || keys.ArrowRight) r += 1;
  if (keys.KeyA || keys.ArrowLeft) r -= 1;
  f -= touchMove.y;
  r += touchMove.x;
  const l = Math.hypot(f, r);
  if (l > 0.05) {
    if (l > 1) {
      f /= l;
      r /= l;
    }
    const mx = -Math.sin(camYaw) * f + Math.cos(camYaw) * r,
      mz = -Math.cos(camYaw) * f - Math.sin(camYaw) * r;
    a.x += mx * SPEED * dt;
    a.z += mz * SPEED * dt;
    const d = Math.hypot(a.x, a.z),
      lim = ARENA_R - 0.6;
    if (d > lim) {
      a.x *= lim / d;
      a.z *= lim / d;
    }
    a.ry = Math.atan2(mx, mz);
  }
  a.tx = a.x;
  a.tz = a.z;
  // 位置每秒最多送 10 次
  const now = performance.now(),
    key = `${a.x.toFixed(2)},${a.z.toFixed(2)},${a.ry.toFixed(2)}`;
  if (now - lastSent > 100 && key !== sentPos) {
    lastSent = now;
    sentPos = key;
    Net.toHost({ type: 'move', x: +a.x.toFixed(2), z: +a.z.toFixed(2), ry: +a.ry.toFixed(2) });
  }
  checkChests(a);
}
// 走近自己隊的寶箱 → 請房主開箱（每個箱子只送一次）
const openRequested = {},
  wasInside = {};
function checkChests(a) {
  const me = Room.state.players[Net.myId];
  if (!me) return;
  Room.state.teams[me.team].chests.forEach((c) => {
    const d = Math.hypot(a.x - c.x, a.z - c.z);
    if (openRequested[c.id] === 'leave' && d > CONFIG.OPEN_RADIUS + 0.5) openRequested[c.id] = false;
    // 已經開過的箱子：關掉視窗後，走出光圈再走回來就重新打開戰利品視窗
    const inside = d < CONFIG.OPEN_RADIUS;
    if (c.opened && inside && !wasInside[c.id] && $('loot').hidden) showLoot(c.id);
    wasInside[c.id] = inside;
    if (c.opened || openRequested[c.id]) return;
    if (d < CONFIG.OPEN_RADIUS) {
      openRequested[c.id] = true;
      Net.toHost({ type: 'openChest', chest: c.id });
    }
  });
}

/* ---------- 主迴圈 ---------- */
const clock = new T.Clock();
let tAll = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  tAll += dt;
  if (joined) updateMe(dt);
  Object.entries(avatars).forEach(([pid, a]) => {
    if (pid !== Net.myId) {
      // 其他人：平滑移到最新位置
      const k = Math.min(1, dt * 10);
      a.x += (a.tx - a.x) * k;
      a.z += (a.tz - a.z) * k;
    }
    if (a.y > 0 || a.vy > 0) {
      a.vy -= 24 * dt;
      a.y = Math.max(0, a.y + a.vy * dt);
      if (a.y === 0) a.vy = 0;
    }
    a.g.position.set(a.x, a.y, a.z);
    a.body3.rotation.y = a.ry;
  });
  Object.values(chests).forEach((c) => {
    c.open += (c.target - c.open) * Math.min(1, dt * 4);
    c.lidPivot.rotation.x = -c.open * 1.9;
    c.light.material.opacity = c.open * 0.35 * (0.8 + Math.sin(tAll * 3) * 0.2);
    c.pt.intensity = c.open * 2.2;
    c.glow.material.opacity = c.target ? 0.05 : 0.14 + Math.sin(tAll * 3) * 0.06;
  });
  updateLootTimer();
  updateDutyTimer();
  clouds.rotation.y += dt * 0.02;
  motes.rotation.y -= dt * 0.03;
  beam.material.opacity = 0.1 + Math.sin(tAll * 1.3) * 0.04;
  // 相機跟著自己（還沒進房時繞場慢慢轉）
  const a = avatars[Net.myId];
  const cx = a ? a.x : 0,
    cz = a ? a.z : 0,
    cy = a ? a.y * 0.5 : 0;
  if (!a) camYaw += dt * 0.08;
  const cp = Math.cos(camPitch);
  camera.position.set(
    cx + Math.sin(camYaw) * cp * camDist,
    Math.sin(camPitch) * camDist + 1 + cy,
    cz + Math.cos(camYaw) * cp * camDist,
  );
  camera.lookAt(cx, 1.6 + cy, cz);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
