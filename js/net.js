/* =====================================================================
 * 傳輸層：PeerJS（WebRTC，瀏覽器之間直接連線；透過 PeerJS 公開服務配對，不用自己架伺服器）
 *
 *   房主：用「房間代碼」當自己的 Peer ID 開房；收到成員連線後，
 *         把對方送來的意圖交給 Room.hostHandle，broadcast 時送給每條連線。
 *   成員：連到房主（PREFIX + 房間代碼）；toHost 送到房主連線，收到的事件交給 Room.apply。
 *   單機：PeerJS 載不到或連不上時，自己當房主、只在本機傳（可以一個人測試）。
 *
 * 其他檔案只透過 Net.toHost / Net.broadcast / Net.sendTo 溝通，不知道底下怎麼傳。
 * ===================================================================== */

const PEER_PREFIX = 'cdloot-v1-'; // Peer ID 前綴（避免跟別人的 PeerJS 專案撞名）
const PEER_OPTS = { debug: 0 };
// 心跳：每 2 秒互傳一次；超過 30 秒沒收到對方任何訊息就當作斷線
// （直接關掉瀏覽器時，WebRTC 不一定會馬上通知斷線）
// 逾時不能太短：電腦很忙或分頁切到背景時，計時器會被瀏覽器放慢，太短會把還在線上的人誤踢。
// （正常關閉網頁會送 bye，可以立刻離開，不用等逾時）
const HB_EVERY = 2000,
  HB_TIMEOUT = 30000,
  CONNECT_TIMEOUT = 30000; // 連線服務被網路擋住時最多等 30 秒（公開服務忙的時候，加入房間可能要 15 秒左右）

const Net = {
  mode: 'solo', // solo / host / member
  myId: 'host',
  hostId: 'host',
  code: null, // 房間代碼
  peer: null,
  conns: {}, // 房主端：pid → 連線
  hostConn: null, // 成員端：到房主的連線
  lastSeen: {}, // 房主端：pid → 最後收到訊息的時間
  lastHost: 0, // 成員端：最後收到房主訊息的時間
  get isHost() {
    return this.myId === this.hostId;
  },

  /* ---------- 三個對外介面 ---------- */
  // 成員 → 房主：送出意圖
  toHost(msg) {
    if (this.isHost) Room.hostHandle(msg, this.myId);
    else if (this.hostConn && this.hostConn.open) this.hostConn.send(msg);
  },
  // 房主 → 所有人：廣播事件（房主自己也套用）；except = 不用再送回給這個人
  broadcast(evt, except) {
    Room.apply(evt);
    Object.entries(this.conns).forEach(([pid, c]) => {
      if (pid !== except && c.open) c.send(evt);
    });
  },
  // 房主 → 單一玩家
  sendTo(pid, evt) {
    if (pid === this.myId) return Room.apply(evt);
    const c = this.conns[pid];
    if (c && c.open) c.send(evt);
  },

  /* ---------- 開房（房主） ---------- */
  host(onReady, onError) {
    if (!window.Peer) return onError('連線元件（PeerJS）載不到');
    const code = randomCode();
    const peer = (this.peer = new Peer(PEER_PREFIX + code, PEER_OPTS));
    const giveUp = setTimeout(() => {
      if (this.mode === 'host') return;
      peer.destroy();
      onError('連線服務沒有回應');
    }, CONNECT_TIMEOUT);
    peer.on('open', (id) => {
      clearTimeout(giveUp);
      this.mode = 'host';
      this.myId = this.hostId = id;
      this.code = code;
      // 心跳：送給每個成員，並把太久沒消息的成員踢出
      setInterval(() => {
        const now = performance.now();
        Object.entries(this.conns).forEach(([pid, c]) => {
          if (now - (this.lastSeen[pid] || now) > HB_TIMEOUT) {
            c.close();
            return this.dropPeer(pid);
          }
          if (c.open) c.send({ type: 'hb' });
        });
      }, HB_EVERY);
      onReady(code);
    });
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        this.conns[conn.peer] = conn;
        this.lastSeen[conn.peer] = performance.now();
      });
      conn.on('data', (msg) => {
        this.lastSeen[conn.peer] = performance.now();
        if (msg.type === 'ping') return;
        if (msg.type === 'bye') return this.dropPeer(conn.peer);
        Room.hostHandle(msg, conn.peer);
      });
      conn.on('close', () => this.dropPeer(conn.peer));
      conn.on('error', () => this.dropPeer(conn.peer));
    });
    peer.on('disconnected', () => {
      // 跟配對伺服器斷線不影響已建立的連線；試著重連，讓新的人還能加入
      if (!peer.destroyed) peer.reconnect();
    });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') {
        // 房間代碼剛好被用走了 → 換一個
        peer.destroy();
        return this.host(onReady, onError);
      }
      if (this.mode !== 'host') {
        clearTimeout(giveUp);
        onError(peerErrText(e));
      }
    });
  },
  dropPeer(pid) {
    if (!this.conns[pid]) return;
    delete this.conns[pid];
    delete this.lastSeen[pid];
    Room.hostHandle({ type: 'leave' }, pid);
  },

  /* ---------- 加入（成員） ---------- */
  join(code, onOpen, onError, onClose) {
    if (!window.Peer) return onError('連線元件（PeerJS）載不到');
    const peer = (this.peer = new Peer(undefined, PEER_OPTS));
    let opened = false,
      failed = false;
    const fail = (msg) => {
      if (opened || failed) return;
      failed = true;
      clearTimeout(giveUp);
      onError(msg);
    };
    const giveUp = setTimeout(() => {
      peer.destroy();
      fail('連線逾時（連線服務沒有回應，或房主的網路擋住了直接連線）');
    }, CONNECT_TIMEOUT);
    peer.on('open', (id) => {
      this.myId = id;
      this.hostId = PEER_PREFIX + code;
      this.code = code;
      const conn = (this.hostConn = peer.connect(this.hostId, { reliable: true }));
      let closed = false;
      const lost = () => {
        if (!opened || closed) return;
        closed = true;
        onClose();
      };
      conn.on('open', () => {
        if (failed) return;
        clearTimeout(giveUp);
        opened = true;
        this.mode = 'member';
        this.lastHost = performance.now();
        // 心跳：送給房主；房主太久沒消息 → 當作房間解散
        setInterval(() => {
          if (performance.now() - this.lastHost > HB_TIMEOUT) return lost();
          if (conn.open) conn.send({ type: 'ping' });
        }, HB_EVERY);
        onOpen();
      });
      conn.on('data', (evt) => {
        this.lastHost = performance.now();
        if (evt.type !== 'hb') Room.apply(evt);
      });
      conn.on('close', lost);
    });
    peer.on('error', (e) => {
      if (!opened) fail(peerErrText(e));
    });
  },
  // 關掉網頁時主動告知（正常關閉可以立刻反應，不用等心跳逾時）
  // 分頁切回前景：立刻補送一次心跳
  pingNow() {
    if (this.mode === 'member' && this.hostConn && this.hostConn.open) this.hostConn.send({ type: 'ping' });
    if (this.mode === 'host') Object.values(this.conns).forEach((c) => c.open && c.send({ type: 'hb' }));
  },
  bye() {
    if (this.mode === 'member' && this.hostConn && this.hostConn.open) this.hostConn.send({ type: 'bye' });
    if (this.peer) this.peer.destroy();
  },
  inviteUrl() {
    return `${location.origin}${location.pathname}?room=${this.code}`;
  },
};

// 6 碼房間代碼（去掉容易看錯的 0 O 1 I L）
function randomCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
function peerErrText(e) {
  const t = e && e.type;
  if (t === 'peer-unavailable') return '找不到這個房間（房主可能已經關掉網頁，或代碼打錯）';
  if (t === 'browser-incompatible') return '這個瀏覽器不支援 WebRTC 連線';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed')
    return '連不上連線服務（PeerJS），請確認網路後再試';
  return '連線失敗（' + (t || e) + '）';
}

addEventListener('pagehide', () => Net.bye());
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && Net.pingNow());
