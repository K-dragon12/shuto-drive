'use strict';

// =========================================================
// SHUTO RACER PRO
// Based on the user's original concept:
// - 首都高 / 3レーン / ニトロ / 交通車 / チューニング風HUD / ログ
// Rebuilt as a cleaner playable race game loop.
// =========================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const ui = {
  start: document.getElementById('startBtn'),
  pause: document.getElementById('pauseBtn'),
  reset: document.getElementById('resetBtn'),
  left: document.getElementById('leftBtn'),
  right: document.getElementById('rightBtn'),
  nitro: document.getElementById('nitroBtn'),
  car: document.getElementById('carSelect'),
  message: document.getElementById('centerMessage'),
  speed: document.getElementById('speedText'),
  distance: document.getElementById('distanceText'),
  time: document.getElementById('timeText'),
  score: document.getElementById('scoreText'),
  coin: document.getElementById('coinText'),
  log: document.getElementById('log'),
};

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    this.beginPath();
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r);
    this.lineTo(x, y + r);
    this.quadraticCurveTo(x, y, x + r, y);
    this.closePath();
    return this;
  };
}

let W = canvas.width;
let H = canvas.height;
let HZ = Math.floor(H * 0.36);
const NEAR_Z = 420;
const FAR_Z = 21000;
let ROAD_HW = W * 0.52;
const ROAD_EDGE = 1.35;
const LANES = [-0.72, 0, 0.72];
const LANE_MARKS = [-0.36, 0.36];
const TOTAL_KM = 12.0;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const newW = Math.max(800, Math.floor(rect.width * dpr));
  const newH = Math.max(450, Math.floor(rect.width * 9 / 16 * dpr));
  if (canvas.width !== newW || canvas.height !== newH) {
    canvas.width = newW;
    canvas.height = newH;
    W = canvas.width;
    H = canvas.height;
    HZ = Math.floor(H * 0.36);
    ROAD_HW = W * 0.52;
  }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const sy = z => HZ + (H - HZ) * NEAR_Z / Math.max(z, 1);
const sx = (wx, z) => W / 2 + wx * ROAD_HW * NEAR_Z / Math.max(z, 1);
const scaleZ = z => NEAR_Z / Math.max(z, 1);
const roadHalfWidthAt = z => ROAD_HW * NEAR_Z / Math.max(z, 1);

const cars = {
  r35: {
    name: 'GT-R R35',
    main: '#d4d8df',
    dark: '#2b303b',
    accent: '#ff3544',
    topSpeed: 292,
    accel: 52,
    handling: 8.5,
    nitroPower: 1.38,
  },
  f8: {
    name: 'Ferrari F8',
    main: '#d3151d',
    dark: '#360609',
    accent: '#ffd166',
    topSpeed: 330,
    accel: 64,
    handling: 9.0,
    nitroPower: 1.34,
  },
  veneno: {
    name: 'Veneno',
    main: '#7f838a',
    dark: '#15171d',
    accent: '#ff2222',
    topSpeed: 355,
    accel: 59,
    handling: 7.8,
    nitroPower: 1.45,
  },
};

const stages = [
  { km: 0, name: 'C1 都心環状', color: '#68e1ff' },
  { km: 3.0, name: '湾岸線', color: '#67f0a2' },
  { km: 6.2, name: '箱崎JCT', color: '#ffd166' },
  { km: 9.5, name: 'ラストスパート', color: '#ff7694' },
];

const state = {
  mode: 'title',
  carKey: 'r35',
  lane: 1,
  targetLane: 1,
  laneX: 0,
  speed: 0,
  km: 0,
  raceTime: 0,
  score: 0,
  coins: Number(localStorage.getItem('srp_coins') || '0'),
  frame: 0,
  scrollZ: 0,
  shake: 0,
  combo: 1,
  comboTimer: 0,
  ghostAlpha: 0,
  lastCoinTick: 0,
  wet: false,
  finishSaved: false,
};

const nitro = {
  active: false,
  timer: 0,
  cooldown: 0,
  duration: 2.5,
  cd: 5.5,
};

const input = {
  left: false,
  right: false,
  nitro: false,
};

const traffic = [];
const particles = [];
const buildings = [];
const lights = [];
const signs = [];
const streaks = [];

function rand(min, max) { return min + Math.random() * (max - min); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

function log(text, cls = '') {
  const div = document.createElement('div');
  div.textContent = text;
  if (cls) div.className = cls;
  ui.log.appendChild(div);
  ui.log.scrollTop = ui.log.scrollHeight;
}

function resetWorldObjects() {
  traffic.length = 0;
  particles.length = 0;
  buildings.length = 0;
  lights.length = 0;
  signs.length = 0;
  streaks.length = 0;

  for (let i = 0; i < 16; i++) spawnTraffic(FAR_Z * 0.1 + i * 1150 + rand(0, 900));

  for (let i = 0; i < 90; i++) {
    buildings.push({
      z: rand(NEAR_Z, FAR_Z),
      side: Math.random() < 0.5 ? -1 : 1,
      wx: rand(1.55, 2.9),
      w: rand(0.10, 0.28),
      h: rand(120, 430),
      seed: rand(0, 9999),
      shade: rand(14, 38),
    });
  }

  for (let i = 0; i < 36; i++) {
    lights.push({ z: NEAR_Z + i * 760, side: i % 2 === 0 ? -1 : 1 });
  }

  const signNames = ['首都高速 C1', '芝公園 600m', '湾岸線 →', '箱崎JCT 1km', '羽田・銀座方面'];
  for (let i = 0; i < 12; i++) {
    signs.push({ z: 1800 + i * 3100, text: signNames[i % signNames.length] });
  }

  for (let i = 0; i < 46; i++) {
    streaks.push({
      z: rand(NEAR_Z, FAR_Z),
      side: Math.random() < 0.5 ? -1 : 1,
      wx: rand(1.2, 2.4),
      len: rand(90, 260),
      alpha: rand(0.10, 0.35),
    });
  }
}

function spawnTraffic(z = FAR_Z * rand(0.35, 0.95)) {
  const keys = Object.keys(cars);
  const lane = Math.floor(rand(0, 3));
  const key = keys[Math.floor(rand(0, keys.length))];
  traffic.push({
    key,
    lane,
    targetLane: lane,
    laneX: LANES[lane],
    z,
    speed: rand(90, 190),
    width: rand(0.90, 1.12),
    crashed: false,
    nearMiss: false,
    blink: rand(0, 99),
  });
}

function resetGame() {
  state.mode = 'title';
  state.lane = 1;
  state.targetLane = 1;
  state.laneX = 0;
  state.speed = 0;
  state.km = 0;
  state.raceTime = 0;
  state.score = 0;
  state.frame = 0;
  state.scrollZ = 0;
  state.shake = 0;
  state.combo = 1;
  state.comboTimer = 0;
  state.ghostAlpha = 0;
  state.lastCoinTick = 0;
  state.wet = false;
  state.finishSaved = false;
  nitro.active = false;
  nitro.timer = 0;
  nitro.cooldown = 0;
  resetWorldObjects();
  ui.message.classList.remove('hidden');
  ui.pause.textContent = 'PAUSE';
  ui.log.innerHTML = 'EnterかSTARTで首都高へ。';
  updateUI();
}

function startGame() {
  if (state.mode === 'finish') resetGame();
  state.mode = 'running';
  state.speed = Math.max(state.speed, 30);
  ui.message.classList.add('hidden');
  log(`🏎️ ${cars[state.carKey].name} 発進。首都高へ。`, 'good');
}

function togglePause() {
  if (state.mode === 'title') return startGame();
  if (state.mode === 'finish') return resetGame();
  state.mode = state.mode === 'running' ? 'pause' : 'running';
  ui.pause.textContent = state.mode === 'pause' ? 'RESUME' : 'PAUSE';
  ui.message.classList.toggle('hidden', state.mode === 'running');
  ui.message.querySelector('h2').textContent = state.mode === 'pause' ? 'PAUSED' : 'SHUTO RACER PRO';
  ui.message.querySelector('p').textContent = state.mode === 'pause' ? 'Enter / PAUSEで再開' : '← → / A D：レーン移動　Space：ニトロ　Enter：スタート';
}

function moveLane(dir) {
  if (state.mode === 'title') startGame();
  if (state.mode !== 'running') return;
  const next = clamp(state.targetLane + dir, 0, 2);
  if (next !== state.targetLane) {
    state.targetLane = next;
    state.ghostAlpha = 1;
  }
}

function triggerNitro() {
  if (state.mode === 'title') startGame();
  if (state.mode !== 'running') return;
  if (nitro.active || nitro.cooldown > 0) return;
  nitro.active = true;
  nitro.timer = nitro.duration;
  log('💨 NITRO ON。流れを切れ。', 'hot');
}

function finishRace() {
  state.mode = 'finish';
  state.speed = 0;
  ui.message.classList.remove('hidden');
  ui.message.querySelector('h2').textContent = 'FINISH';
  ui.message.querySelector('p').textContent = `TIME ${fmtTime(state.raceTime)} / SCORE ${state.score}pt / Enterでリスタート`;
  if (!state.finishSaved) {
    state.finishSaved = true;
    const bonus = Math.max(50, Math.floor(400 - state.raceTime * 6));
    state.coins += bonus;
    localStorage.setItem('srp_coins', String(state.coins));
    log(`🏁 完走。タイム ${fmtTime(state.raceTime)} / ボーナス ${bonus}枚`, 'good');
  }
}

function updateGame(dt) {
  if (state.mode !== 'running') return;

  const car = cars[state.carKey];
  state.frame++;
  state.raceTime += dt;

  if (state.km > 7.0 && !state.wet) {
    state.wet = true;
    log('🌧️ 雨。グリップ低下。ブレーキ距離に注意。', 'warn');
  }

  if (nitro.active) {
    nitro.timer -= dt;
    if (nitro.timer <= 0) {
      nitro.active = false;
      nitro.cooldown = nitro.cd;
      log('ニトロ終了。クールダウン。');
    }
  } else if (nitro.cooldown > 0) {
    nitro.cooldown = Math.max(0, nitro.cooldown - dt);
  }

  const wetPenalty = state.wet ? 0.88 : 1;
  const nitroMul = nitro.active ? car.nitroPower : 1;
  const targetTop = car.topSpeed * wetPenalty * nitroMul;
  const accel = car.accel * (nitro.active ? 1.8 : 1) * (state.speed < 80 ? 1.2 : 1);
  state.speed = lerp(state.speed, targetTop, clamp(accel * dt / 250, 0, 0.08));

  state.km += (state.speed / 3600) * dt;
  state.scrollZ += state.speed * dt * 55;

  state.laneX = lerp(state.laneX, LANES[state.targetLane], clamp(car.handling * dt, 0, 0.22));
  state.ghostAlpha = Math.max(0, state.ghostAlpha - dt * 3);
  state.shake = Math.max(0, state.shake - dt * 12);

  if (state.comboTimer > 0) {
    state.comboTimer -= dt;
  } else {
    state.combo = 1;
  }

  const coinTick = Math.floor(state.km * 10);
  if (coinTick > state.lastCoinTick) {
    state.lastCoinTick = coinTick;
    state.coins += 1;
    localStorage.setItem('srp_coins', String(state.coins));
  }

  updateTraffic(dt);
  updateWorldObjects(dt);
  updateParticles(dt);

  state.score += Math.floor((state.speed / 160) * dt * 60 * state.combo);

  if (state.km >= TOTAL_KM) finishRace();
}

function updateTraffic(dt) {
  traffic.forEach(t => {
    t.z -= (state.speed - t.speed) * dt * 40;
    t.blink += dt * 6;

    if (Math.random() < dt * 0.08) t.targetLane = Math.floor(rand(0, 3));
    t.lane = lerp(t.lane, t.targetLane, dt * 1.6);
    t.laneX = lerp(t.laneX, LANES[Math.round(t.lane)] || 0, dt * 2.5);

    if (t.z < NEAR_Z * 0.65) {
      t.z = FAR_Z * rand(0.55, 1.05);
      t.lane = Math.floor(rand(0, 3));
      t.targetLane = t.lane;
      t.laneX = LANES[t.lane];
      t.speed = rand(95, 205);
      t.nearMiss = false;
    }

    const dz = Math.abs(t.z - NEAR_Z * 1.15);
    const dx = Math.abs(t.laneX - state.laneX);

    if (dz < 120 && dx < 0.36) {
      crashAt(t);
      t.z = FAR_Z * rand(0.65, 1.1);
      t.lane = Math.floor(rand(0, 3));
      t.targetLane = t.lane;
      t.laneX = LANES[t.lane];
      t.nearMiss = false;
    } else if (dz < 310 && dx < 0.62 && !t.nearMiss && state.speed > 120) {
      t.nearMiss = true;
      state.combo = Math.min(8, state.combo + 0.5);
      state.comboTimer = 2.4;
      const gain = Math.floor(45 * state.combo);
      state.score += gain;
      state.coins += 3;
      localStorage.setItem('srp_coins', String(state.coins));
      makeSparks(sx(t.laneX, t.z), sy(t.z), '#68e1ff', 10);
      log(`😤 ニアミス x${state.combo.toFixed(1)} +${gain}pt`, 'hot');
    }
  });
}

function updateWorldObjects(dt) {
  const speedFactor = Math.max(55, state.speed * 0.9);

  buildings.forEach(b => {
    b.z -= speedFactor * dt * 36;
    if (b.z < NEAR_Z * 0.65) {
      b.z = FAR_Z + rand(1000, 6500);
      b.side = Math.random() < 0.5 ? -1 : 1;
      b.wx = rand(1.55, 2.9);
      b.w = rand(0.10, 0.28);
      b.h = rand(120, 430);
      b.seed = rand(0, 9999);
      b.shade = rand(14, 38);
    }
  });

  lights.forEach(l => {
    l.z -= state.speed * dt * 55;
    if (l.z < NEAR_Z * 0.7) l.z = FAR_Z + rand(0, 1400);
  });

  signs.forEach(s => {
    s.z -= state.speed * dt * 55;
    if (s.z < NEAR_Z * 0.8) s.z = FAR_Z + rand(3000, 9000);
  });

  streaks.forEach(s => {
    s.z -= Math.max(120, state.speed * 1.8) * dt * 70;
    if (s.z < NEAR_Z * 0.55) {
      s.z = FAR_Z + rand(1000, 6000);
      s.side = Math.random() < 0.5 ? -1 : 1;
      s.wx = rand(1.2, 2.4);
      s.len = rand(90, 260);
      s.alpha = rand(0.10, 0.35);
    }
  });
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    p.r *= 0.985;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function crashAt(t) {
  const x = sx(state.laneX, NEAR_Z * 1.15);
  const y = H - H * 0.18;
  state.speed *= 0.58;
  state.score = Math.max(0, state.score - 300);
  state.combo = 1;
  state.comboTimer = 0;
  state.shake = 12;
  makeSparks(x, y, '#ff6333', 42);
  makeSparks(x, y, '#ffd166', 18);
  log(`💥 接触。-${300}pt。速度低下。`, 'warn');
}

function makeSparks(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(90, 420);
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      r: rand(2, 7),
      color,
      life: rand(0.25, 0.85),
    });
  }
}

function draw() {
  resizeCanvas();

  const ox = state.shake ? rand(-state.shake, state.shake) : 0;
  const oy = state.shake ? rand(-state.shake, state.shake) : 0;

  ctx.save();
  ctx.translate(ox, oy);
  ctx.clearRect(-30, -30, W + 60, H + 60);

  drawSky();
  drawDistantCity();
  drawBuildings();
  drawRoad();
  drawLights();
  drawSigns();
  drawSpeedStreaks();
  if (state.wet) drawRain();
  drawTraffic();
  drawParticles();
  drawPlayerCar();
  drawRaceHUD();

  ctx.restore();
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, HZ + 30);
  g.addColorStop(0, '#03040d');
  g.addColorStop(0.5, '#070a1e');
  g.addColorStop(1, '#101331');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, HZ + 40);

  for (let i = 0; i < 90; i++) {
    const x = (Math.sin(i * 52.13) * 0.5 + 0.5) * W;
    const y = (Math.sin(i * 91.73) * 0.5 + 0.5) * HZ * 0.75;
    const a = 0.25 + (Math.sin(state.frame * 0.04 + i) * 0.5 + 0.5) * 0.45;
    ctx.fillStyle = `rgba(220,230,255,${a})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  const glow = ctx.createRadialGradient(W * 0.5, HZ, 10, W * 0.5, HZ, W * 0.65);
  glow.addColorStop(0, 'rgba(80,130,255,0.20)');
  glow.addColorStop(1, 'rgba(80,130,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, HZ + 80);
}

function drawDistantCity() {
  const parallax = (state.scrollZ * 0.015) % 90;
  for (let i = -2; i < 40; i++) {
    const bw = 42 + (i % 5) * 14;
    const bh = 45 + ((i * 37) % 120);
    const x = i * 70 - parallax;
    ctx.fillStyle = 'rgba(3,5,14,0.94)';
    ctx.fillRect(x, HZ - bh, bw, bh);

    for (let r = 0; r < bh / 13; r++) {
      for (let c = 0; c < bw / 12; c++) {
        if (Math.sin(i * 20 + r * 5 + c * 11) > 0.35) {
          ctx.fillStyle = 'rgba(255,222,150,0.45)';
          ctx.fillRect(x + 5 + c * 12, HZ - bh + 8 + r * 13, 4, 3);
        }
      }
    }
  }
}

function drawBuildings() {
  const sorted = [...buildings].sort((a, b) => b.z - a.z);
  sorted.forEach(b => {
    const z = b.z;
    const y = sy(z);
    const sc = scaleZ(z);
    if (y < HZ - 250 || y > H + 220) return;

    const x = sx(b.side * b.wx, z);
    const bw = Math.max(10, b.w * ROAD_HW * sc * 3.0);
    const bh = Math.max(30, b.h * sc);
    const bx = x - bw / 2;
    const by = y - bh;
    const a = clamp(0.18 + sc * 4, 0.18, 0.92);

    ctx.fillStyle = `rgba(${b.shade},${b.shade + 5},${b.shade + 18},${a})`;
    ctx.fillRect(bx, by, bw, bh);

    ctx.fillStyle = `rgba(110,145,210,${0.06 + sc * 0.48})`;
    ctx.fillRect(bx + bw * 0.68, by, bw * 0.32, bh);

    const cols = Math.max(2, Math.floor(bw / 9));
    const rows = Math.max(3, Math.floor(bh / 13));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (Math.sin(b.seed + r * 4.7 + c * 9.1) > 0.10) {
          ctx.fillStyle = `rgba(255,223,146,${0.18 + clamp(sc * 2.5, 0, 0.52)})`;
          ctx.fillRect(bx + 4 + c * (bw / cols), by + 7 + r * 12, Math.max(2, bw / cols - 5), 3);
        }
      }
    }

    if (sc > 0.19) {
      ctx.strokeStyle = `rgba(210,230,255,${0.04 + sc * 0.25})`;
      ctx.lineWidth = Math.max(1, sc * 7);
      ctx.beginPath();
      ctx.moveTo(bx + bw * 0.5, by);
      ctx.lineTo(bx + bw * 0.5 + b.side * 28 * sc, by + bh);
      ctx.stroke();
    }
  });
}

function drawRoad() {
  const roadGrad = ctx.createLinearGradient(0, HZ, 0, H);
  roadGrad.addColorStop(0, '#161827');
  roadGrad.addColorStop(0.55, state.wet ? '#151a2e' : '#1c1e2d');
  roadGrad.addColorStop(1, state.wet ? '#11192d' : '#10111b');

  ctx.fillStyle = roadGrad;
  ctx.beginPath();
  ctx.moveTo(sx(-ROAD_EDGE, FAR_Z), HZ);
  ctx.lineTo(sx(ROAD_EDGE, FAR_Z), HZ);
  ctx.lineTo(sx(ROAD_EDGE, NEAR_Z), H + 30);
  ctx.lineTo(sx(-ROAD_EDGE, NEAR_Z), H + 30);
  ctx.closePath();
  ctx.fill();

  const strip = 700;
  const offset = state.scrollZ % strip;
  for (let z = NEAR_Z; z < FAR_Z; z += strip) {
    const z0 = z + offset;
    const z1 = z0 + strip;
    const y0 = sy(z0);
    const y1 = sy(z1);
    if (y1 < HZ || y0 > H + 60) continue;

    const alt = Math.floor((z0 + state.scrollZ) / strip) % 2 === 0;
    ctx.fillStyle = alt ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.06)';
    ctx.beginPath();
    ctx.moveTo(sx(-ROAD_EDGE, z0), y0);
    ctx.lineTo(sx(ROAD_EDGE, z0), y0);
    ctx.lineTo(sx(ROAD_EDGE, z1), y1);
    ctx.lineTo(sx(-ROAD_EDGE, z1), y1);
    ctx.closePath();
    ctx.fill();
  }

  // Lane dashes
  const dash = 300;
  const gap = 300;
  const pattern = dash + gap;
  LANE_MARKS.forEach(mx => {
    for (let base = NEAR_Z; base < FAR_Z; base += pattern) {
      const z0 = ((base - state.scrollZ % pattern + pattern) % FAR_Z) + NEAR_Z;
      const z1 = z0 + dash;
      const y0 = sy(z0);
      const y1 = sy(z1);
      if (y0 < HZ || y1 > H + 30) continue;
      const lw = Math.max(2, roadHalfWidthAt(z0) * 0.018);
      ctx.strokeStyle = state.wet ? 'rgba(255,235,130,0.80)' : 'rgba(255,230,96,0.90)';
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(sx(mx, z0), y0);
      ctx.lineTo(sx(mx, z1), y1);
      ctx.stroke();
    }
  });

  [-ROAD_EDGE, ROAD_EDGE].forEach(edge => {
    ctx.strokeStyle = 'rgba(240,245,255,0.90)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sx(edge, NEAR_Z), sy(NEAR_Z));
    ctx.lineTo(sx(edge, FAR_Z), sy(FAR_Z));
    ctx.stroke();
  });

  // Guard rails
  [-1, 1].forEach(side => {
    const edge = side * 1.52;
    ctx.strokeStyle = 'rgba(155,190,255,0.34)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(sx(edge, NEAR_Z), sy(NEAR_Z));
    ctx.lineTo(sx(edge, FAR_Z), sy(FAR_Z));
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx(edge, NEAR_Z), sy(NEAR_Z) - 10);
    ctx.lineTo(sx(edge, FAR_Z), sy(FAR_Z) - 2);
    ctx.stroke();
  });

  if (state.wet) {
    const sheen = ctx.createLinearGradient(0, HZ, 0, H);
    sheen.addColorStop(0, 'rgba(120,160,255,0.00)');
    sheen.addColorStop(0.55, 'rgba(120,160,255,0.12)');
    sheen.addColorStop(1, 'rgba(255,255,255,0.06)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, HZ, W, H - HZ);
  }
}

function drawLights() {
  lights.forEach((l, i) => {
    const z = l.z;
    const y = sy(z);
    const sc = scaleZ(z);
    if (y < HZ || y > H + 40) return;
    const x = sx(l.side * 1.62, z);
    const poleH = 130 * sc;
    const arm = 55 * sc;

    ctx.strokeStyle = `rgba(170,180,205,${clamp(sc * 3, 0.15, 0.8)})`;
    ctx.lineWidth = Math.max(1, sc * 5);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - poleH);
    ctx.lineTo(x - l.side * arm, y - poleH - 18 * sc);
    ctx.stroke();

    const lx = x - l.side * arm;
    const ly = y - poleH - 18 * sc;
    ctx.fillStyle = `rgba(255,226,150,${clamp(0.25 + sc * 3, 0.25, 0.92)})`;
    ctx.beginPath();
    ctx.arc(lx, ly, Math.max(2, 8 * sc), 0, Math.PI * 2);
    ctx.fill();

    const glow = ctx.createRadialGradient(lx, y, 0, lx, y, 80 * sc);
    glow.addColorStop(0, `rgba(255,225,140,${0.18 * clamp(sc * 4, 0, 1)})`);
    glow.addColorStop(1, 'rgba(255,225,140,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lx, y, 80 * sc, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawSigns() {
  signs.forEach(s => {
    const z = s.z;
    const y = sy(z);
    const sc = scaleZ(z);
    if (y < HZ + 15 || y > H * 0.86 || sc < 0.035) return;

    const boardW = roadHalfWidthAt(z) * 1.25;
    const boardH = Math.max(14, 42 * sc);
    const bx = W / 2 - boardW / 2;
    const by = y - 135 * sc;

    ctx.strokeStyle = `rgba(190,200,215,${0.35 + sc * 1.5})`;
    ctx.lineWidth = Math.max(1, 4 * sc);
    [-1, 1].forEach(side => {
      ctx.beginPath();
      ctx.moveTo(sx(side * 1.3, z), y);
      ctx.lineTo(sx(side * 1.3, z), by);
      ctx.stroke();
    });

    ctx.fillStyle = `rgba(0,82,62,${0.88})`;
    ctx.beginPath();
    ctx.roundRect(bx, by, boardW, boardH, Math.max(2, 8 * sc));
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1, 2 * sc);
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(10, 24 * sc)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(s.text, W / 2, by + boardH * 0.65);
    ctx.textAlign = 'left';
  });
}

function drawSpeedStreaks() {
  if (state.speed < 120) return;
  streaks.forEach(s => {
    const z = s.z;
    const y = sy(z);
    const sc = scaleZ(z);
    if (y < HZ || y > H) return;
    const x = sx(s.side * s.wx, z);
    ctx.strokeStyle = `rgba(215,235,255,${s.alpha * clamp(sc * 4.5, 0, 1)})`;
    ctx.lineWidth = Math.max(1, sc * 8);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - s.side * s.len * sc, y + 42 * sc);
    ctx.stroke();
  });
}

function drawRain() {
  ctx.save();
  ctx.strokeStyle = 'rgba(180,220,255,0.38)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 120; i++) {
    const x = (Math.sin(i * 91.3 + state.frame * 0.15) * 0.5 + 0.5) * W;
    const y = ((i * 53 + state.frame * 17) % H);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 18, y + 38);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTraffic() {
  [...traffic].sort((a, b) => b.z - a.z).forEach(t => {
    if (t.z < NEAR_Z * 0.65 || t.z > FAR_Z) return;
    const x = sx(t.laneX, t.z);
    const y = sy(t.z);
    const sc = scaleZ(t.z) * 1.45 * t.width;
    if (y < HZ || y > H + 70 || sc < 0.035) return;
    drawFrontCar(x, y, sc, cars[t.key], t.blink);
  });
}

function drawFrontCar(x, y, sc, car, blink) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);

  const w = 92;
  const h = 40;

  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();
  ctx.ellipse(0, h / 2 + 14, w * 0.48, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = car.dark;
  ctx.beginPath();
  ctx.moveTo(-w / 2, h / 2);
  ctx.lineTo(-w / 2 + 9, -h / 2 + 6);
  ctx.lineTo(-w / 2 + 26, -h / 2 - 5);
  ctx.lineTo(w / 2 - 26, -h / 2 - 5);
  ctx.lineTo(w / 2 - 9, -h / 2 + 6);
  ctx.lineTo(w / 2, h / 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = car.main;
  ctx.beginPath();
  ctx.roundRect(-w / 2 + 10, -h / 2 + 2, w - 20, 22, 7);
  ctx.fill();

  ctx.fillStyle = 'rgba(140,210,255,0.58)';
  ctx.beginPath();
  ctx.roundRect(-26, -h / 2 - 12, 52, 16, 5);
  ctx.fill();

  [-1, 1].forEach(side => {
    ctx.fillStyle = 'rgba(255,246,205,0.98)';
    ctx.beginPath();
    ctx.ellipse(side * 30, 8, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,235,180,0.18)';
    ctx.beginPath();
    ctx.ellipse(side * 32, 12, 38, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  if (Math.sin(blink) > 0.55) {
    ctx.fillStyle = 'rgba(255,160,40,0.95)';
    ctx.beginPath();
    ctx.arc(-40, 8, 4, 0, Math.PI * 2);
    ctx.arc(40, 8, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#050508';
  ctx.beginPath();
  ctx.roundRect(-20, h / 2 - 12, 40, 9, 3);
  ctx.fill();

  [-1, 1].forEach(side => {
    ctx.fillStyle = '#050508';
    ctx.beginPath();
    ctx.ellipse(side * (w / 2 - 9), h / 2 + 3, 10, 13, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

function drawPlayerCar() {
  const x = sx(state.laneX, NEAR_Z);
  const y = H - H * 0.135;
  const sc = H / 420;
  if (state.ghostAlpha > 0) {
    ctx.globalAlpha = state.ghostAlpha * 0.22;
    drawRearCar(x, y - 8, sc * 1.08, cars[state.carKey], nitro.active);
    ctx.globalAlpha = 1;
  }
  drawRearCar(x, y, sc * 1.22, cars[state.carKey], nitro.active);
}

function drawRearCar(x, y, sc, car, nitroOn) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sc, sc);

  const w = 92;
  const h = 38;

  ctx.fillStyle = 'rgba(0,0,0,0.48)';
  ctx.beginPath();
  ctx.ellipse(0, h / 2 + 20, w * 0.55, 15, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = car.dark;
  ctx.beginPath();
  ctx.moveTo(-w / 2, h / 2);
  ctx.lineTo(-w / 2 + 6, -h / 2 + 4);
  ctx.lineTo(-w / 2 + 23, -h / 2 - 9);
  ctx.lineTo(w / 2 - 23, -h / 2 - 9);
  ctx.lineTo(w / 2 - 6, -h / 2 + 4);
  ctx.lineTo(w / 2, h / 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = car.main;
  ctx.beginPath();
  ctx.roundRect(-w / 2 + 8, -h / 2 + 0, w - 16, 27, 8);
  ctx.fill();

  ctx.fillStyle = 'rgba(80,120,160,0.75)';
  ctx.beginPath();
  ctx.roundRect(-27, -h / 2 - 17, 54, 19, 6);
  ctx.fill();

  ctx.fillStyle = '#060609';
  ctx.beginPath();
  ctx.roundRect(-w / 2 + 6, h / 2 - 11, w - 12, 14, 4);
  ctx.fill();

  ctx.strokeStyle = car.accent;
  ctx.lineWidth = 4;
  [-1, 1].forEach(side => {
    ctx.beginPath();
    ctx.moveTo(side * 24, -1);
    ctx.lineTo(side * 39, -1);
    ctx.stroke();
  });

  ctx.fillStyle = car.accent;
  ctx.fillRect(-w / 2 + 8, h / 2 - 10, w - 16, 3);

  // wing
  ctx.fillStyle = '#060609';
  ctx.beginPath();
  ctx.roundRect(-w / 2 - 10, -h / 2 - 27, w + 20, 6, 2);
  ctx.fill();
  ctx.fillRect(-30, -h / 2 - 24, 6, 22);
  ctx.fillRect(24, -h / 2 - 24, 6, 22);

  [-1, 1].forEach(side => {
    ctx.fillStyle = '#050508';
    ctx.beginPath();
    ctx.ellipse(side * (w / 2 - 9), h / 2 + 4, 11, 15, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  if (nitroOn) {
    for (let i = 0; i < 4; i++) {
      const len = 38 + Math.sin(state.frame * 0.7 + i) * 8;
      ctx.fillStyle = ['rgba(255,255,255,.9)', 'rgba(120,230,255,.8)', 'rgba(30,120,255,.65)', 'rgba(255,150,40,.45)'][i];
      ctx.beginPath();
      ctx.ellipse(-w / 2 - len * 0.25 - i * 5, h / 2 - 2, len * (1 - i * 0.12), 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawParticles() {
  particles.forEach(p => {
    ctx.globalAlpha = clamp(p.life, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

function drawRaceHUD() {
  const pad = 22;
  const barW = W * 0.36;
  const pct = clamp(state.km / TOTAL_KM, 0, 1);
  const stage = getStage();

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(pad, pad, barW, 56, 10);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.roundRect(pad + 14, pad + 35, barW - 28, 8, 4);
  ctx.fill();

  ctx.fillStyle = stage.color;
  ctx.beginPath();
  ctx.roundRect(pad + 14, pad + 35, (barW - 28) * pct, 8, 4);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(14, W * 0.014)}px sans-serif`;
  ctx.fillText(`${stage.name}  ${state.km.toFixed(1)} / ${TOTAL_KM.toFixed(1)}km`, pad + 14, pad + 24);

  // Nitro gauge
  const nw = 190;
  const nx = W - nw - pad;
  const ny = pad;
  let fill = 1;
  if (nitro.active) fill = nitro.timer / nitro.duration;
  else if (nitro.cooldown > 0) fill = 1 - nitro.cooldown / nitro.cd;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(nx, ny, nw, 56, 10);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.roundRect(nx + 14, ny + 35, nw - 28, 8, 4);
  ctx.fill();
  ctx.fillStyle = nitro.active ? '#ffffff' : nitro.cooldown > 0 ? '#ff7694' : '#68e1ff';
  ctx.beginPath();
  ctx.roundRect(nx + 14, ny + 35, (nw - 28) * clamp(fill, 0, 1), 8, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(13, W * 0.012)}px sans-serif`;
  ctx.fillText(nitro.active ? 'NITRO ACTIVE' : nitro.cooldown > 0 ? 'COOLDOWN' : 'NITRO READY', nx + 14, ny + 24);

  if (state.combo > 1) {
    ctx.fillStyle = 'rgba(255,209,102,0.95)';
    ctx.font = `900 ${Math.max(24, W * 0.028)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`COMBO x${state.combo.toFixed(1)}`, W / 2, HZ - 18);
    ctx.textAlign = 'left';
  }
}

function getStage() {
  let current = stages[0];
  for (const s of stages) if (state.km >= s.km) current = s;
  return current;
}

function updateUI() {
  ui.speed.textContent = Math.round(state.speed);
  ui.distance.textContent = state.km.toFixed(1);
  ui.time.textContent = fmtTime(state.raceTime);
  ui.score.textContent = state.score;
  ui.coin.textContent = state.coins;

  ui.nitro.classList.toggle('active', nitro.active);
  ui.nitro.classList.toggle('cooldown', !nitro.active && nitro.cooldown > 0);
  ui.nitro.classList.toggle('ready', !nitro.active && nitro.cooldown <= 0);
  ui.nitro.textContent = nitro.active ? 'BOOST!' : nitro.cooldown > 0 ? `CD ${nitro.cooldown.toFixed(1)}s` : 'NITRO';
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  updateGame(dt);
  draw();
  updateUI();
  requestAnimationFrame(loop);
}

function bindControls() {
  ui.start.addEventListener('click', startGame);
  ui.pause.addEventListener('click', togglePause);
  ui.reset.addEventListener('click', resetGame);
  ui.left.addEventListener('click', () => moveLane(-1));
  ui.right.addEventListener('click', () => moveLane(1));
  ui.nitro.addEventListener('click', triggerNitro);
  ui.car.addEventListener('change', e => {
    state.carKey = e.target.value;
    resetGame();
    ui.car.value = state.carKey;
    log(`車両変更: ${cars[state.carKey].name}`, 'good');
  });

  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') { e.preventDefault(); moveLane(-1); }
    if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') { e.preventDefault(); moveLane(1); }
    if (e.key === ' ') { e.preventDefault(); triggerNitro(); }
    if (e.key === 'Enter') { e.preventDefault(); state.mode === 'running' ? togglePause() : startGame(); }
    if (e.key.toLowerCase() === 'r') { e.preventDefault(); resetGame(); }
  });

  let touchX = null;
  let touchY = null;
  canvas.addEventListener('touchstart', e => {
    const t = e.touches[0];
    touchX = t.clientX;
    touchY = t.clientY;
  }, { passive: true });
  canvas.addEventListener('touchend', e => {
    if (touchX === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchX;
    const dy = t.clientY - touchY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 24) moveLane(dx > 0 ? 1 : -1);
    else triggerNitro();
    touchX = null;
    touchY = null;
  }, { passive: true });
}

bindControls();
resetWorldObjects();
updateUI();
requestAnimationFrame(loop);
