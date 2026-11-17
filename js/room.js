/* =====================================================================
 * 房間狀態與規則（房主判定）
 *
 * 所有會影響結果的事（加入、開箱內容、擲骰、之後的 /random）都由房主的瀏覽器決定，
 * 再用「事件」廣播給房內所有人；每個人收到事件後用 Room.apply 更新自己的畫面狀態。
 *
 *   玩家 →（意圖 intent）→ 房主 Room.hostHandle → 檢查＋決定結果 →（事件 event）→ 所有人 Room.apply
 *
 * 意圖：join / leave / move / jump / openChest / choose / settings / resetChest / chat（含 /random）/
 *       startDuty / dutyAnswer
 * 事件：welcome / full / joined / left / moved / jumped / chestOpened / chose / itemResolved / settings /
 *       chestReset / chat / random / dutyPop / dutyAnswered / dutyCancelled / dutyStart
 *
 * 進場流程（像 FF14 的副本申請）：
 *   等待房間（phase=lobby）→ 房主按開始 → 每個人跳出確認視窗（phase=ready）
 *   → 全員按「參加」就一起進場地（phase=field）；有人取消、倒數結束沒按、有人加入或離開 → 全員回等待房間。
 *   進場後才加入的人直接進場地。
 *
 * 擲骰規則（照 FF14）：
 *   - 每件物品每人選一次：需要／貪婪／放棄。選需要或貪婪時房主當場擲 1～99（同一件物品內不重複）。
 *   - 全隊都選完、或倒數結束（沒選的人算放棄）→ 判定：有人需要就由需要者比點數，否則貪婪者比點數；
 *     全部放棄就沒人拿。
 *   - 所有人都能選需要（不看職業）；已經拿過的物品也能再 roll。
 *
 * 結構預留多隊：state.teams 是陣列，每隊有自己的成員與寶箱；玩家只能開、只能 roll 自己隊的箱子。
 * ===================================================================== */

const CHOICES = ['need', 'greed', 'pass'];
const CHOICE_NAME = { need: '需要', greed: '貪婪', pass: '放棄' };

const Room = {
  state: null,
  listeners: [],
  timers: {}, // 房主端：每個寶箱的倒數計時器
  on(fn) {
    this.listeners.push(fn);
  },
  emit(evt) {
    this.listeners.forEach((fn) => fn(evt));
  },

  /* ---------- 房主：建立空房間 ---------- */
  create() {
    const teams = [];
    for (let i = 0; i < CONFIG.TEAM_COUNT; i++) {
      teams.push({
        id: i,
        members: [],
        // 每隊一個寶箱；多隊時沿著北邊排開
        chests: [{ id: `t${i}c0`, x: (i - (CONFIG.TEAM_COUNT - 1) / 2) * 10, z: -7, opened: false, items: [] }],
      });
    }
    this.state = {
      teams,
      players: {},
      settings: { ...CONFIG },
      history: [], // 每件物品的結果：{ item, winner, winnerName, c, roll, rolls, t }
      obtained: {}, // 每個人拿過什麼：{ pid: { name, items: { itemId: 次數 } } }
      chestNo: 0, // 開過幾箱
      phase: 'lobby', // lobby 等待房間 / ready 副本確認中 / field 場地
      duty: null, // 確認中：{ answers: { pid: null|true|false }, secs }
    };
  },
  teamOf(pid) {
    const p = this.state.players[pid];
    return p ? this.state.teams[p.team] : null;
  },
  findChest(chestId) {
    for (const tm of this.state.teams) {
      const c = tm.chests.find((c) => c.id === chestId);
      if (c) return { team: tm, chest: c };
    }
    return null;
  },

  /* ---------- 房主：處理玩家送來的意圖 ---------- */
  hostHandle(msg, from) {
    const S = this.state;
    switch (msg.type) {
      case 'join': {
        // 找還有空位的隊伍
        const team = S.teams.find((t) => t.members.length < S.settings.TEAM_SIZE);
        if (!team) return Net.sendTo(from, { type: 'full' });
        const name = String(msg.name || '').trim().slice(0, 16) || '冒險者';
        const job = jobOf(msg.job).id;
        const slot = team.members.length;
        const player = {
          id: from,
          name,
          job,
          team: team.id,
          // 進場位置：寶箱南邊排成一排
          x: (slot - 3.5) * 1.6 + (team.chests[0].x || 0),
          z: 6,
          ry: Math.PI,
        };
        // 中途加入：倒數用「剩餘秒數」傳（各台電腦時鐘不同）
        const snap = JSON.parse(JSON.stringify(S));
        snap.teams.forEach((tm) =>
          tm.chests.forEach((c) => {
            if (c.opened) c.left = Math.max(0, (c.deadline - performance.now()) / 1000);
          }),
        );
        if (snap.duty) snap.duty.left = Math.max(0, (S.duty.deadline - performance.now()) / 1000);
        Net.sendTo(from, { type: 'welcome', you: from, state: snap });
        Net.broadcast({ type: 'joined', player });
        // 確認視窗開著時有人加入 → 取消，回等待房間重來（新來的人也要確認）
        if (S.phase === 'ready') this.cancelDuty(`${name} 加入了房間`);
        return;
      }
      case 'startDuty': {
        if (from !== Net.hostId || S.phase !== 'lobby') return;
        const answers = {};
        S.teams.forEach((tm) => tm.members.forEach((pid) => (answers[pid] = null)));
        const secs = S.settings.DUTY_SECS;
        Net.broadcast({ type: 'dutyPop', answers, secs });
        clearTimeout(this.dutyTimer);
        this.dutyTimer = setTimeout(() => {
          const d = this.state.duty;
          if (this.state.phase !== 'ready' || !d) return;
          const late = Object.keys(d.answers)
            .filter((pid) => d.answers[pid] !== true)
            .map((pid) => (this.state.players[pid] || {}).name || '？');
          this.cancelDuty(`時間到，${late.join('、')} 沒有按參加`);
        }, secs * 1000);
        return;
      }
      case 'dutyAnswer': {
        const d = S.duty;
        if (S.phase !== 'ready' || !d || !(from in d.answers) || d.answers[from] !== null) return;
        const ok = !!msg.ok;
        Net.broadcast({ type: 'dutyAnswered', pid: from, ok });
        if (!ok) return this.cancelDuty(`${S.players[from].name} 取消了`);
        if (Object.values(S.duty.answers).every((x) => x === true)) {
          clearTimeout(this.dutyTimer);
          Net.broadcast({ type: 'dutyStart' });
        }
        return;
      }
      case 'leave': {
        // 連線中斷（房主端呼叫）：移出房間；正在 roll 的物品重新檢查（少一個人可能就都選完了）
        const p = S.players[from];
        if (!p) return;
        Net.broadcast({ type: 'left', id: from, name: p.name });
        if (S.phase === 'ready') this.cancelDuty(`${p.name} 離開了房間`);
        S.teams[p.team].chests.forEach((c) => {
          if (c.opened) c.items.forEach((it, i) => this.maybeResolve(c.id, i, false));
        });
        return;
      }
      case 'chat': {
        const p = S.players[from];
        const text = String(msg.text || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 200);
        if (!p || !text) return;
        // /random：房主擲 1～999（大家看到同一個結果，不能作弊）
        if (/^\/(random|隨機)(\s|$)/i.test(text)) {
          const value = 1 + Math.floor(Math.random() * 999);
          Net.broadcast({ type: 'random', pid: from, name: p.name, value });
          return;
        }
        Net.broadcast({ type: 'chat', pid: from, name: p.name, job: p.job, text });
        return;
      }
      case 'move': {
        const p = S.players[from];
        if (!p) return;
        Net.broadcast({ type: 'moved', id: from, x: +msg.x, z: +msg.z, ry: +msg.ry }, from);
        return;
      }
      case 'jump': {
        if (S.players[from]) Net.broadcast({ type: 'jumped', id: from }, from);
        return;
      }
      case 'openChest': {
        const p = S.players[from];
        const f = this.findChest(msg.chest);
        if (!p || !f || f.chest.opened) return;
        if (f.team.id !== p.team) return; // 只能開自己隊的箱子
        // 用房主記錄的位置檢查距離（多給一點容錯）
        if (Math.hypot(p.x - f.chest.x, p.z - f.chest.z) > S.settings.OPEN_RADIUS + 1.5) return;
        const items = rollChestContents(S.settings).map((it) => ({
          ...it,
          choices: {}, // pid → { c, roll, auto }
          done: false,
          winner: null,
        }));
        const secs = S.settings.ROLL_SECONDS;
        Net.broadcast({ type: 'chestOpened', chest: f.chest.id, by: from, items, secs, no: S.chestNo + 1 });
        // 倒數結束：沒選的人算放棄，全部判定
        clearTimeout(this.timers[f.chest.id]);
        this.timers[f.chest.id] = setTimeout(() => this.resolveAll(f.chest.id), secs * 1000);
        return;
      }
      case 'choose': {
        const p = S.players[from];
        const f = this.findChest(msg.chest);
        if (!p || !f || !f.chest.opened || f.team.id !== p.team) return;
        const it = f.chest.items[msg.idx];
        if (!it || it.done || it.choices[from]) return; // 已判定或已經選過
        const c = CHOICES.includes(msg.choice) ? msg.choice : 'pass';
        const roll = c === 'pass' ? 0 : this.freshRoll(it);
        Net.broadcast({ type: 'chose', chest: f.chest.id, idx: msg.idx, pid: from, c, roll });
        this.maybeResolve(f.chest.id, msg.idx, false);
        return;
      }
      case 'settings': {
        if (from !== Net.hostId) return;
        const s = msg.settings || {};
        const clean = {
          RARE_MODE: s.RARE_MODE === 'guarantee' ? 'guarantee' : 'rate',
          RARE_RATE: Math.max(0, Math.min(1, +s.RARE_RATE || 0)),
          RARE_COUNT: Math.max(1, Math.min(RARE_ITEMS.length, Math.round(+s.RARE_COUNT || 1))),
          ROLL_SECONDS: Math.max(5, Math.min(300, Math.round(+s.ROLL_SECONDS || 30))),
        };
        Net.broadcast({ type: 'settings', settings: clean });
        return;
      }
      case 'resetChest': {
        // 房主：放一個新的箱子（上一箱沒判定完的物品先全部判定）
        const f = this.findChest(msg.chest);
        if (!f || from !== Net.hostId) return;
        if (f.chest.opened) this.resolveAll(f.chest.id);
        clearTimeout(this.timers[f.chest.id]);
        Net.broadcast({ type: 'chestReset', chest: f.chest.id });
        return;
      }
    }
  },

  /* ---------- 房主：副本確認取消 → 回等待房間 ---------- */
  cancelDuty(reason) {
    clearTimeout(this.dutyTimer);
    if (this.state.phase !== 'ready') return;
    Net.broadcast({ type: 'dutyCancelled', reason });
  },

  /* ---------- 房主：擲骰與判定 ---------- */
  // 1～99，同一件物品內不重複
  freshRoll(it) {
    const used = new Set(Object.values(it.choices).map((x) => x.roll));
    let r;
    do r = 1 + Math.floor(Math.random() * 99);
    while (used.has(r));
    return r;
  },
  // 全隊都選了（或 force）→ 判定這件物品
  maybeResolve(chestId, idx, force) {
    const f = this.findChest(chestId);
    if (!f) return;
    const it = f.chest.items[idx];
    if (!it || it.done) return;
    const members = f.team.members.filter((pid) => this.state.players[pid]);
    const missing = members.filter((pid) => !it.choices[pid]);
    if (missing.length && !force) return;
    // 倒數結束：沒選的人自動放棄
    missing.forEach((pid) =>
      Net.broadcast({ type: 'chose', chest: chestId, idx, pid, c: 'pass', roll: 0, auto: true }),
    );
    const entries = Object.entries(it.choices).map(([pid, x]) => ({ pid, ...x }));
    const best = (c) => entries.filter((e) => e.c === c).sort((a, b) => b.roll - a.roll)[0];
    const w = best('need') || best('greed') || null;
    Net.broadcast({
      type: 'itemResolved',
      chest: chestId,
      idx,
      winner: w ? w.pid : null,
      winnerName: w ? this.state.players[w.pid].name : null,
      c: w ? w.c : null,
      roll: w ? w.roll : 0,
    });
    // 這箱全部判定完 → 停止倒數
    if (f.chest.items.every((x) => x.done)) clearTimeout(this.timers[chestId]);
  },
  resolveAll(chestId) {
    const f = this.findChest(chestId);
    if (!f) return;
    f.chest.items.forEach((it, i) => this.maybeResolve(chestId, i, true));
  },

  /* ---------- 所有人：套用房主廣播的事件 ---------- */
  apply(evt) {
    const S = this.state;
    switch (evt.type) {
      case 'welcome': {
        const st = JSON.parse(JSON.stringify(evt.state));
        st.teams.forEach((tm) =>
          tm.chests.forEach((c) => {
            if (c.opened) c.deadline = performance.now() + (c.left || 0) * 1000;
          }),
        );
        if (st.duty) st.duty.deadline = performance.now() + (st.duty.left || 0) * 1000;
        this.state = st;
        break;
      }
      case 'dutyPop':
        S.phase = 'ready';
        S.duty = { answers: evt.answers, secs: evt.secs, deadline: performance.now() + evt.secs * 1000 };
        break;
      case 'dutyAnswered':
        if (S.duty) S.duty.answers[evt.pid] = evt.ok;
        break;
      case 'dutyCancelled':
        S.phase = 'lobby';
        S.duty = null;
        break;
      case 'dutyStart':
        S.phase = 'field';
        S.duty = null;
        break;
      case 'joined': {
        const p = evt.player;
        S.players[p.id] = p;
        const tm = S.teams[p.team];
        if (!tm.members.includes(p.id)) tm.members.push(p.id);
        break;
      }
      case 'left': {
        const p = S.players[evt.id];
        if (p) {
          const tm = S.teams[p.team];
          tm.members = tm.members.filter((m) => m !== evt.id);
          delete S.players[evt.id];
        }
        break;
      }
      case 'moved': {
        const p = S.players[evt.id];
        if (p) Object.assign(p, { x: evt.x, z: evt.z, ry: evt.ry });
        break;
      }
      case 'chestOpened': {
        const f = this.findChest(evt.chest);
        if (f)
          Object.assign(f.chest, {
            opened: true,
            items: evt.items,
            by: evt.by,
            // 倒數用本機時間計算（各台電腦時鐘不同，只傳剩餘秒數）
            deadline: performance.now() + evt.secs * 1000,
            secs: evt.secs,
            no: evt.no,
          });
        S.chestNo = evt.no;
        break;
      }
      case 'chose': {
        const f = this.findChest(evt.chest);
        const it = f && f.chest.items[evt.idx];
        if (it) it.choices[evt.pid] = { c: evt.c, roll: evt.roll, auto: !!evt.auto };
        break;
      }
      case 'itemResolved': {
        const f = this.findChest(evt.chest);
        const it = f && f.chest.items[evt.idx];
        if (!it) break;
        Object.assign(it, { done: true, winner: evt.winner });
        S.history.push({
          no: f.chest.no,
          item: it.id,
          winner: evt.winner,
          winnerName: evt.winnerName,
          c: evt.c,
          roll: evt.roll,
          rolls: Object.entries(it.choices).map(([pid, x]) => ({
            name: (S.players[pid] || {}).name || '？',
            c: x.c,
            roll: x.roll,
          })),
        });
        if (evt.winner) {
          const o = (S.obtained[evt.winner] = S.obtained[evt.winner] || { name: evt.winnerName, items: {} });
          o.name = evt.winnerName;
          o.items[it.id] = (o.items[it.id] || 0) + 1;
        }
        break;
      }
      case 'settings':
        Object.assign(S.settings, evt.settings);
        break;
      case 'chestReset': {
        const f = this.findChest(evt.chest);
        if (f) Object.assign(f.chest, { opened: false, items: [], by: null });
        break;
      }
    }
    this.emit(evt);
  },
};
