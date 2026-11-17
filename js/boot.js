/* =====================================================================
 * 啟動：先載入 Three.js，再依序載入程式檔
 * 程式檔都是一般 <script>（不是 ES module），所以直接雙擊 index.html 也能開。
 * 檔案之間共用全域的函式與常數，下面 APP_FILES 的順序就是執行順序。
 * ===================================================================== */

const APP_FILES = [
  'js/config.js', // 設定檔：人數、掉落表、機率、職業
  'js/net.js', // 傳輸層（目前單機；第 3 步接 PeerJS）
  'js/room.js', // 房間狀態與規則（房主判定）
  'js/scene.js', // 3D 場景、寶箱、角色
  'js/main.js', // 主程式（最後載入）
];

/* 顯示無法繼續的錯誤，並停止載入後面的檔案 */
window.__fatal = (msg) => {
  const e = document.getElementById('err');
  e.hidden = false;
  e.textContent = msg;
  window.__stopped = true;
};

/* 依序嘗試多個來源載入一個函式庫（同站檔案 → cdnjs → jsDelivr → unpkg），每個 6 秒逾時 */
function loadLib(srcs, ok, done) {
  let i = 0;
  (function next() {
    if (ok() || i >= srcs.length) return done();
    const sc = document.createElement('script');
    let settled = false;
    const fin = () => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      ok() ? done() : next();
    };
    const to = setTimeout(() => {
      sc.remove();
      fin();
    }, 6000);
    sc.onload = fin;
    sc.onerror = fin;
    sc.src = srcs[i++];
    document.head.appendChild(sc);
  })();
}
const loadThree = (done) =>
  loadLib(
    [
      'three.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/three.js/r152/three.min.js',
      'https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.min.js',
      'https://unpkg.com/three@0.152.2/build/three.min.js',
    ],
    () => !!window.THREE,
    done,
  );
// PeerJS（多人連線）：載不到也能用單人模式
const loadPeer = (done) =>
  loadLib(
    [
      'peerjs.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js',
      'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
      'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
    ],
    () => !!window.Peer,
    done,
  );

/* 一個接一個載入（保持順序）；任何一個失敗就停下並顯示訊息 */
function loadApp(files) {
  if (window.__stopped || !files.length) return;
  const sc = document.createElement('script');
  sc.src = files[0];
  sc.onload = () => loadApp(files.slice(1));
  sc.onerror = () => window.__fatal(`程式檔 ${files[0]} 載入失敗，請重新整理。`);
  document.body.appendChild(sc);
}

loadThree(() => {
  if (!window.THREE)
    return window.__fatal(
      '3D 引擎（Three.js）載入失敗：同站檔案與三個 CDN 都連不上。請確認公司網路或擋廣告外掛沒有封鎖，然後重新整理。',
    );
  loadPeer(() => loadApp(APP_FILES));
});
