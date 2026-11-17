/* =====================================================================
 * 3D 場景：渲染器、相機、暗之雲通關後的場地、寶箱模型、角色模型（頭上 ID＋職業）
 * 座標：x 往東、z 往南（北 = -z）。場地是半徑 ARENA_R 的圓台，四周是暗雲與虛空。
 * ===================================================================== */

const $ = (id) => document.getElementById(id);
const T = THREE;
const ARENA_R = 22;

let renderer;
try {
  renderer = new T.WebGLRenderer({ antialias: true });
} catch (e) {
  window.__fatal('無法建立 WebGL，請開啟瀏覽器硬體加速。');
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
$('stage').appendChild(renderer.domElement);

const scene = new T.Scene();
scene.background = new T.Color(0x0c0716);
scene.fog = new T.Fog(0x0c0716, 30, 90);
const camera = new T.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 220);
scene.add(new T.HemisphereLight(0xd9ccff, 0x1a0f26, 0.85));
const sun = new T.DirectionalLight(0xffe9d0, 1.1);
sun.position.set(-12, 30, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 80 });
scene.add(sun);

function canvasTex(cv) {
  const t = new T.CanvasTexture(cv);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ---------- 地板：深色石台＋紫色光紋 ---------- */
function floorTexture() {
  const W = 1024,
    c = W / 2,
    k = W / (ARENA_R * 2),
    cv = document.createElement('canvas');
  cv.width = cv.height = W;
  const g = cv.getContext('2d');
  const bg = g.createRadialGradient(c, c, 0, c, c, c);
  bg.addColorStop(0, '#3a3046');
  bg.addColorStop(1, '#1d1726');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, W);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '230,210,255' : '5,0,12'},${Math.random() * 0.07})`;
    g.fillRect(Math.random() * W, Math.random() * W, Math.random() * 6 + 1, Math.random() * 6 + 1);
  }
  // 同心光環與放射線
  g.strokeStyle = 'rgba(170,110,255,.35)';
  g.lineWidth = 3;
  [5, 9, 13.5, 18].forEach((r) => {
    g.beginPath();
    g.arc(c, c, r * k, 0, 7);
    g.stroke();
  });
  g.strokeStyle = 'rgba(170,110,255,.18)';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * 5 * k, c + Math.sin(a) * 5 * k);
    g.lineTo(c + Math.cos(a) * 18 * k, c + Math.sin(a) * 18 * k);
    g.stroke();
  }
  // 中央的暗雲紋章（擊敗後殘留）
  const cg = g.createRadialGradient(c, c, 0, c, c, 4.5 * k);
  cg.addColorStop(0, 'rgba(150,80,255,.55)');
  cg.addColorStop(1, 'rgba(150,80,255,0)');
  g.fillStyle = cg;
  g.beginPath();
  g.arc(c, c, 4.5 * k, 0, 7);
  g.fill();
  g.strokeStyle = 'rgba(220,190,255,.8)';
  g.lineWidth = 8;
  g.beginPath();
  g.arc(c, c, ARENA_R * k - 5, 0, 7);
  g.stroke();
  return canvasTex(cv);
}
const floor = new T.Mesh(
  new T.CircleGeometry(ARENA_R, 96).rotateX(-Math.PI / 2),
  new T.MeshStandardMaterial({ map: floorTexture(), roughness: 0.85 }),
);
floor.receiveShadow = true;
scene.add(floor);
const rim = new T.Mesh(
  new T.CylinderGeometry(ARENA_R, ARENA_R - 1.5, 3, 96, 1, true),
  new T.MeshStandardMaterial({ color: 0x241b30, roughness: 0.9 }),
);
rim.position.y = -1.5;
scene.add(rim);

/* ---------- 四周的暗雲（緩慢旋轉的半透明雲團）＋飄浮光點 ---------- */
const clouds = new T.Group();
{
  const mat = new T.MeshStandardMaterial({
    color: 0x2a1840,
    emissive: 0x1a0830,
    roughness: 1,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = ARENA_R + 6 + Math.random() * 22;
    const s = 3 + Math.random() * 6;
    const m = new T.Mesh(new T.SphereGeometry(s, 12, 10), mat);
    m.position.set(Math.cos(a) * r, -4 + Math.random() * 10, Math.sin(a) * r);
    m.scale.y = 0.55;
    clouds.add(m);
  }
}
scene.add(clouds);
const motes = (() => {
  const n = 260,
    pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2,
      r = Math.random() * 40;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.random() * 14;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  const p = new T.Points(
    geo,
    new T.PointsMaterial({ color: 0xc9a6ff, size: 0.18, transparent: true, opacity: 0.8, depthWrite: false }),
  );
  scene.add(p);
  return p;
})();
// 王消散後留下的光柱（場地中央）
const beam = new T.Mesh(
  new T.CylinderGeometry(1.2, 2.2, 30, 32, 1, true),
  new T.MeshBasicMaterial({ color: 0xa070ff, transparent: true, opacity: 0.12, depthWrite: false, side: T.DoubleSide }),
);
beam.position.y = 15;
scene.add(beam);

/* ---------- 文字標籤（頭上 ID、職業） ---------- */
function labelTex(text, color, font = 44) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 96;
  const g = cv.getContext('2d');
  let fs = font;
  g.font = `700 ${fs}px "Noto Sans TC",system-ui,sans-serif`;
  while (fs > 20 && g.measureText(text).width > 490) {
    fs -= 2;
    g.font = `700 ${fs}px "Noto Sans TC",system-ui,sans-serif`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 9;
  g.strokeStyle = 'rgba(8,4,14,.92)';
  g.strokeText(text, 256, 50);
  g.fillStyle = color;
  g.fillText(text, 256, 50);
  return canvasTex(cv);
}
function makeLabel(text, color, font) {
  const s = new T.Sprite(new T.SpriteMaterial({ map: labelTex(text, color, font), transparent: true, depthWrite: false }));
  s.scale.set(3.6, 0.68, 1);
  s.renderOrder = 20;
  return s;
}

/* ---------- 角色 ---------- */
function makeAvatar(p, isMe) {
  const job = jobOf(p.job),
    role = ROLES[job.role];
  const col = new T.Color(role.col);
  const g = new T.Group();
  const mat = new T.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.1 });
  const body = new T.Mesh(new T.CylinderGeometry(0.28, 0.34, 1.05, 16), mat);
  body.position.y = 0.72;
  body.castShadow = true;
  const head = new T.Mesh(new T.SphereGeometry(0.25, 16, 12), mat);
  head.position.y = 1.47;
  head.castShadow = true;
  // 面向（鼻子）
  const nose = new T.Mesh(new T.ConeGeometry(0.08, 0.22, 8), new T.MeshStandardMaterial({ color: 0xffffff }));
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.47, 0.28);
  const ring = new T.Mesh(
    new T.RingGeometry(0.45, 0.58, 32).rotateX(-Math.PI / 2),
    new T.MeshBasicMaterial({ color: isMe ? 0xe9c46a : col, transparent: true, opacity: isMe ? 1 : 0.6 }),
  );
  ring.position.y = 0.04;
  const body3 = new T.Group();
  body3.add(body, head, nose);
  const name = makeLabel(p.name, isMe ? '#ffd76a' : '#f2ecff');
  name.position.y = 2.4;
  const jobL = makeLabel(`${job.name}`, role.col, 40);
  jobL.position.y = 1.92;
  jobL.scale.multiplyScalar(0.85);
  g.add(body3, ring, name, jobL);
  scene.add(g);
  return { g, body3, y: 0, vy: 0 };
}

/* ---------- 寶箱（原創設計：深色木箱＋金邊、拱形蓋子） ---------- */
function makeChest() {
  const g = new T.Group();
  const wood = new T.MeshStandardMaterial({ color: 0x3b2a5a, roughness: 0.6 });
  const gold = new T.MeshStandardMaterial({ color: 0xe8c45f, roughness: 0.35, metalness: 0.75 });
  const base = new T.Mesh(new T.BoxGeometry(1.8, 0.9, 1.2), wood);
  base.position.y = 0.45;
  base.castShadow = true;
  g.add(base);
  // 金屬包邊
  [-0.86, 0.86].forEach((x) => {
    const b = new T.Mesh(new T.BoxGeometry(0.1, 0.95, 1.25), gold);
    b.position.set(x, 0.47, 0);
    g.add(b);
  });
  const band = new T.Mesh(new T.BoxGeometry(1.85, 0.1, 1.25), gold);
  band.position.y = 0.88;
  g.add(band);
  // 蓋子：以後緣為軸
  const lidPivot = new T.Group();
  lidPivot.position.set(0, 0.9, -0.6);
  const lid = new T.Mesh(new T.CylinderGeometry(0.6, 0.6, 1.8, 24, 1, false, 0, Math.PI), wood);
  lid.rotation.z = Math.PI / 2;
  lid.position.set(0, 0, 0.6);
  lid.castShadow = true;
  const lidBand = new T.Mesh(new T.CylinderGeometry(0.62, 0.62, 0.12, 24, 1, false, 0, Math.PI), gold);
  lidBand.rotation.z = Math.PI / 2;
  lidBand.position.set(0, 0, 0.6);
  const lock = new T.Mesh(new T.BoxGeometry(0.28, 0.32, 0.08), gold);
  lock.position.set(0, -0.05, 1.22);
  lidPivot.add(lid, lidBand, lock);
  g.add(lidPivot);
  // 地上的光圈（提示可以靠近）
  const glow = new T.Mesh(
    new T.RingGeometry(1.4 / 1.35, CONFIG.OPEN_RADIUS / 1.35, 48).rotateX(-Math.PI / 2), // 整個寶箱放大 1.35 倍，光圈要除回去才會等於實際開箱距離
    new T.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.18, depthWrite: false }),
  );
  glow.position.y = 0.03;
  g.add(glow);
  // 開箱時的光柱
  const light = new T.Mesh(
    new T.CylinderGeometry(0.5, 0.9, 7, 24, 1, true),
    new T.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide }),
  );
  light.position.y = 4.2;
  g.add(light);
  const pt = new T.PointLight(0xffd27a, 0, 9);
  pt.position.y = 1.6;
  g.add(pt);
  g.scale.setScalar(1.35);
  scene.add(g);
  return { g, lidPivot, glow, light, pt, open: 0, target: 0 };
}
