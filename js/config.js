/* =====================================================================
 * 設定檔：人數、隊伍、掉落表、機率、職業。
 * 之後要擴充成 3 隊 24 人，只要改 TEAM_COUNT，不用改其他程式。
 * ===================================================================== */

const CONFIG = {
  TEAM_COUNT: 1, // 隊伍數（實際副本是 3 隊；先做 1 隊）
  TEAM_SIZE: 8, // 每隊人數上限
  OPEN_RADIUS: 3.2, // 走到寶箱多近會打開（公尺）
  ROLL_SECONDS: 30, // 需要／貪婪／放棄的倒數秒數
  DUTY_SECS: 45, // 副本確認視窗的倒數秒數
  // 稀有物品出現方式（房主可在房間設定調整，第 2 步加入設定畫面）
  RARE_MODE: 'rate', // 'rate' = 每件各自機率；'guarantee' = 必出 N 件
  RARE_RATE: 0.15, // 每件稀有物品各自的出現機率（自訂，非官方數據）
  RARE_COUNT: 1, // 必出模式時出幾件（1～4）
  GEAR_PER_CHEST: 2, // 每箱固定的裝備箱數量（不重複）
};

// 掉落表：裝備箱（每箱固定抽 2 件不重複）
const GEAR_ITEMS = [
  { id: 'head', name: '暗雲頭部裝備箱', kind: 'gear', icon: 'head' },
  { id: 'body', name: '暗雲身體裝備箱', kind: 'gear', icon: 'body' },
  { id: 'hands', name: '暗雲手部裝備箱', kind: 'gear', icon: 'hands' },
  { id: 'legs', name: '暗雲腿部裝備箱', kind: 'gear', icon: 'legs' },
  { id: 'feet', name: '暗雲腳部裝備箱', kind: 'gear', icon: 'feet' },
];
// 稀有物品（台服名稱）
const RARE_ITEMS = [
  { id: 'dais', name: '暗黑領域', en: 'Dais of Darkness', kind: 'mount', icon: 'mount' },
  { id: 'shroud', name: '暗黑羽衣', en: 'Shroud of Darkness', kind: 'mount', icon: 'wings' },
  { id: 'wisp', name: '薄暗之雲', en: 'Wisp of Darkness', kind: 'minion', icon: 'minion' },
  { id: 'hair', name: '髮型樣式：半雙馬尾', en: 'A Half Times Two', kind: 'hair', icon: 'hair' },
];
const KIND_NAME = { gear: '裝備', mount: '坐騎', minion: '寵物', hair: '髮型' };

// 職業（只用來顯示；所有人都能選「需要」）
const ROLES = {
  tank: { name: '坦克', col: '#4f8dff' },
  healer: { name: '治療', col: '#47c27a' },
  melee: { name: '近戰', col: '#e0565b' },
  ranged: { name: '遠程物理', col: '#e0565b' },
  caster: { name: '魔法', col: '#e0565b' },
};
const JOBS = [
  { id: 'PLD', name: '騎士', role: 'tank' },
  { id: 'WAR', name: '戰士', role: 'tank' },
  { id: 'DRK', name: '暗黑騎士', role: 'tank' },
  { id: 'GNB', name: '絕槍戰士', role: 'tank' },
  { id: 'WHM', name: '白魔法師', role: 'healer' },
  { id: 'SCH', name: '學者', role: 'healer' },
  { id: 'AST', name: '占星術士', role: 'healer' },
  { id: 'SGE', name: '賢者', role: 'healer' },
  { id: 'MNK', name: '武僧', role: 'melee' },
  { id: 'DRG', name: '龍騎士', role: 'melee' },
  { id: 'NIN', name: '忍者', role: 'melee' },
  { id: 'SAM', name: '武士', role: 'melee' },
  { id: 'RPR', name: '釤鐮客', role: 'melee' },
  { id: 'VPR', name: '蝰蛇劍士', role: 'melee' },
  { id: 'BRD', name: '吟遊詩人', role: 'ranged' },
  { id: 'MCH', name: '機工士', role: 'ranged' },
  { id: 'DNC', name: '舞者', role: 'ranged' },
  { id: 'BLM', name: '黑魔法師', role: 'caster' },
  { id: 'SMN', name: '召喚師', role: 'caster' },
  { id: 'RDM', name: '赤魔法師', role: 'caster' },
  { id: 'PCT', name: '繪靈法師', role: 'caster' },
];
const jobOf = (id) => JOBS.find((j) => j.id === id) || JOBS[0];

/* 產生一箱的內容（只在房主端執行）。rng 可替換成固定種子，方便測試 */
function rollChestContents(cfg = CONFIG, rng = Math.random) {
  const pickN = (arr, n) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n);
  };
  const gear = pickN(GEAR_ITEMS, cfg.GEAR_PER_CHEST);
  let rare;
  if (cfg.RARE_MODE === 'guarantee')
    rare = pickN(RARE_ITEMS, Math.max(1, Math.min(RARE_ITEMS.length, cfg.RARE_COUNT)));
  else rare = RARE_ITEMS.filter(() => rng() < cfg.RARE_RATE);
  // 稀有物品排在前面
  return rare.concat(gear).map((it) => ({ id: it.id, rare: it.kind !== 'gear' }));
}
const itemDef = (id) => RARE_ITEMS.concat(GEAR_ITEMS).find((i) => i.id === id);
