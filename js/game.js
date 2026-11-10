'use strict';
/* ============================================================================
   ESCAPA DE LOS PROFESORES - logica, IA, habilidades y render
   ============================================================================ */

const canvas = document.getElementById('game');
const mainCtx = canvas.getContext('2d');
let ctx = mainCtx;                       // cambia temporalmente para dibujar retratos
const endCelebrationCv = document.getElementById('end-celebration');
const endCelebrationCtx = endCelebrationCv.getContext('2d');
const nightCv = document.createElement('canvas');
const nctx = nightCv.getContext('2d');
const minimapCv = document.createElement('canvas');

let VW = 960, VH = 600, dpr = 1;

/* ---------------------------------------------------------------------------
   Estado general
   --------------------------------------------------------------------------- */
const keys = Object.create(null);
const S = {
  phase: 'menu',            // menu | select | intro | playing | paused | end
  intro: null,              // presentacion de los profesores antes del recreo
  chaseMusic: null,         // profesor que persigue y nivel de tension musical
  elapsed: 0,
  timeLeft: MATCH_TIME,
  timeBonus: 0,             // segundos recortados por las misiones
  timeSaved: 0,             // total recortado (para el HUD y las estadisticas)
  timeFlash: 0,
  night: false,
  role: 'student',          // rol del jugador
  selected: null,
  aiStudents: [],
  escaped: 0,
  downStudents: 0,
  downTeachers: 0,
  winner: null,
  banner: null,
  playFade: 0,             // fundido de entrada al terminar la presentacion
  messages: [],
  camShake: 0,
  stats: { dmg: 0 },
  quiz: null,               // mision abierta por el jugador
  task: null,               // tarea de limpieza activa
  aiMissionTimer: 0,
  examEarned: 0,            // puntos de examen conseguidos en esta partida
  examBreakdown: [],        // desglose para la pantalla final
  papersTotal: 0,           // apuntes de examen repartidos en la partida
  papersBonus: false,       // bonus por recoger todos los apuntes
  answerStreak: 0,          // aciertos consecutivos en misiones
  bestStreak: 0             // mejor racha de la partida
};

let entities = [], studentList = [], teacherList = [];
let exams = [], projectiles = [], fx = [], texts = [];
let examPapers = [];
let foodItems = [];
let player = null;
let cam = { x: WORLD_W / 2, y: WORLD_H / 2 };
let endCelebration = null;
let zoom = 1;
let last = performance.now();
let patrolFlows = null;
let doorGroups = [];

const isNight = () => S.night;
const EXAM_PAPER_COUNT = 10;
const EXAM_PAPER_POINTS = 4;
const EXAM_GOLDEN_COUNT = 3;
const EXAM_GOLDEN_POINTS = 10;
const EXAM_ALL_PAPERS_BONUS = 15;
const STREAK_STEP = 3;
const STREAK_POINTS = 5;
const FIRST_MISSION_DAILY_POINTS = 15;
const DEFENDED_MISSION_POINTS = 10;
const ALL_MISSIONS_BONUS = 40;

/* ---------------------------------------------------------------------------
   Progreso permanente: Puntos de examen y trajes
   --------------------------------------------------------------------------- */
const SAVE_KEY = 'escapaProfesores.progreso.v1';

function freshProgress() {
  return {
    version: 1,
    points: 0,
    totalEarned: 0,
    matches: 0,
    wins: 0,
    owned: {},
    equipped: {},
    daily: { date: '', played: false, won: false, mission: false }
  };
}

function loadProgress() {
  const base = freshProgress();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return base;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return base;
    if (Number.isFinite(data.points)) base.points = Math.max(0, Math.floor(data.points));
    if (Number.isFinite(data.totalEarned)) base.totalEarned = Math.max(0, Math.floor(data.totalEarned));
    if (Number.isFinite(data.matches)) base.matches = Math.max(0, Math.floor(data.matches));
    if (Number.isFinite(data.wins)) base.wins = Math.max(0, Math.floor(data.wins));
    if (data.owned && typeof data.owned === 'object') base.owned = data.owned;
    if (data.equipped && typeof data.equipped === 'object') base.equipped = data.equipped;
    if (data.daily && typeof data.daily === 'object') {
      base.daily = {
        date: typeof data.daily.date === 'string' ? data.daily.date : '',
        played: !!data.daily.played,
        won: !!data.daily.won,
        mission: !!data.daily.mission
      };
    }
  } catch (err) {
    console.warn('No se pudo leer el progreso de trajes:', err);
  }
  return base;
}

let progress = loadProgress();

function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(progress));
  } catch (err) {
    console.warn('No se pudo guardar el progreso de trajes:', err);
  }
}

function isSkinOwned(skin) {
  return !!skin && (skin.cost <= 0 || !!progress.owned[skin.key]);
}

function equippedSkin(kind, charId) {
  const list = skinsFor(kind, charId);
  if (!list.length) return null;
  const wanted = skinById(kind, charId, progress.equipped[charId] || 'base');
  return isSkinOwned(wanted) ? wanted : baseSkin(kind, charId);
}

function equipSkin(kind, charId, skinId) {
  const skin = skinById(kind, charId, skinId);
  if (!skin || !isSkinOwned(skin)) return false;
  progress.equipped[charId] = skin.id;
  saveProgress();
  refreshPointsUI();
  return true;
}

function buySkin(kind, charId, skinId) {
  const skin = skinById(kind, charId, skinId);
  if (!skin || isSkinOwned(skin)) return false;
  if (progress.points < skin.cost) return false;
  progress.points -= skin.cost;
  progress.owned[skin.key] = true;
  progress.equipped[charId] = skin.id;
  saveProgress();
  refreshPointsUI();
  return true;
}

/* Las IA tambien llevan trajes. Eligen al azar del catalogo de su personaje
   usando el peso de la rareza: 30 % Basico, 38 % Especial, 20 % Elite,
   9 % Legendario y 3 % Mitico. La variante de color se aplica antes del traje
   para conservar el tono de piel/pelo y distinguir a los personajes repetidos.
   Solo es cosmetico: no toca estadisticas ni IA. */
const AI_SKIN_WEIGHTS = {
  'Básico': 30,
  'Especial': 38,
  'Élite': 20,
  'Legendario': 9,
  'Mítico': 3
};

function aiOutfit(kind, charId, baseLook) {
  const list = skinsFor(kind, charId);
  const base = baseSkin(kind, charId);
  const weighted = list.filter(s => (AI_SKIN_WEIGHTS[s.rarity] || 0) > 0);
  const total = weighted.reduce((sum, s) => sum + AI_SKIN_WEIGHTS[s.rarity], 0);
  let skin = base;
  if (total > 0) {
    let roll = Math.random() * total;
    for (const s of weighted) {
      roll -= AI_SKIN_WEIGHTS[s.rarity];
      if (roll <= 0) { skin = s; break; }
    }
  }
  const variant = variantLook(baseLook, Math.random());
  return { skin, look: skinLook(variant, skin) };
}

function outfitFor(kind, charId, isPlayer, baseLook) {
  if (isPlayer) {
    const skin = equippedSkin(kind, charId);
    return { skin, look: skinLook(baseLook, skin) };
  }
  return aiOutfit(kind, charId, baseLook);
}

function refreshPointsUI() {
  const value = String(progress.points);
  const ids = ['menu-points', 'skin-points'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }
}

/* Los puntos se conceden al instante (misiones, reprobados) o al terminar la
   partida (victoria y supervivientes). Se guardan aunque cierres el navegador. */
function grantExamPoints(amount, label) {
  amount = Math.max(0, Math.round(amount || 0));
  if (!amount) return 0;
  progress.points += amount;
  progress.totalEarned += amount;
  saveProgress();
  refreshPointsUI();
  if (S.phase === 'playing' || S.phase === 'paused' || S.phase === 'end') {
    S.examEarned += amount;
    if (label) {
      const row = S.examBreakdown.find(x => x.label === label);
      if (row) row.n += amount;
      else S.examBreakdown.push({ label, n: amount });
    }
  }
  return amount;
}

function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0');
}

/* Bonificaciones diarias: se pagan una sola vez por día y se guardan con el
   resto del progreso. La primera partida del día paga aunque se pierda. */
function ensureDaily() {
  const today = todayKey();
  if (!progress.daily || progress.daily.date !== today) {
    progress.daily = { date: today, played: false, won: false, mission: false };
  }
  return progress.daily;
}

function grantDailyBonuses(won) {
  const daily = ensureDaily();
  if (!daily.played) {
    daily.played = true;
    grantExamPoints(5, 'Primera partida del día');
  }
  if (won && !daily.won) {
    daily.won = true;
    grantExamPoints(10, 'Primera victoria del día');
  }
  saveProgress();
}

/* Bonus diario por completar la primera misión. Se paga al instante para que
   el jugador lo vea en el desglose de la partida. */
function grantFirstMissionBonus() {
  const daily = ensureDaily();
  if (daily.mission) return;
  daily.mission = true;
  grantExamPoints(FIRST_MISSION_DAILY_POINTS, 'Primera misión del día');
  if (player && player.alive) {
    damageText(player.x, player.y - 58, '+' + FIRST_MISSION_DAILY_POINTS + ' pts diarios', '#ffe08a');
  }
  log('+' + FIRST_MISSION_DAILY_POINTS + ' puntos de examen por tu primera misión del día.', '#ffd166');
  saveProgress();
}

function skinRgb(e, fallback) {
  return (e && e.skin && e.skin.fx && e.skin.fx.color) || fallback;
}

function skinAccent(e, fallback) {
  return (e && e.skin && e.skin.fx && e.skin.fx.accent) || fallback;
}

/* ---------------------------------------------------------------------------
   Utilidades de mapa y movimiento
   --------------------------------------------------------------------------- */
function hasLOS(ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(d / (T * 0.4)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isSolidTile(((ax + (bx - ax) * t) / T) | 0, ((ay + (by - ay) * t) / T) | 0)) return false;
  }
  return true;
}

function freeSpot(px, py, radius) {
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * TAU, r = radius * Math.sqrt(Math.random());
    const x = clamp(px + Math.cos(a) * r, T, WORLD_W - T);
    const y = clamp(py + Math.sin(a) * r, T, WORLD_H - T);
    if (!isSolidTile((x / T) | 0, (y / T) | 0) && hasLOS(px, py, x, y)) return { x, y };
  }
  for (let i = 0; i < 400; i++) {
    const x = rnd(T, WORLD_W - T), y = rnd(T, WORLD_H - T);
    if (!isSolidTile((x / T) | 0, (y / T) | 0)) return { x, y };
  }
  return { x: px, y: py };
}

/* Reparte apuntes de examen por distintas salas. Son recogibles y dan puntos
   extra sin tocar el reloj ni las misiones. Los dorados valen más. */
function spawnExamPapers() {
  examPapers = [];
  const rooms = shuffleArray(ROOMS);
  const total = EXAM_PAPER_COUNT + EXAM_GOLDEN_COUNT;
  for (const room of rooms) {
    if (examPapers.length >= total) break;
    const cx = (room.x + room.w / 2) * T;
    const cy = (room.y + room.h / 2) * T;
    let spot = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const cand = freeSpot(cx, cy, Math.min(room.w, room.h) * T * 0.34);
      const clearOfPapers = !examPapers.some(p => Math.hypot(p.x - cand.x, p.y - cand.y) < T * 2.5);
      const clearOfMissions = !MISSIONS.some(m => Math.hypot(m.x - cand.x, m.y - cand.y) < T * 2.2);
      if (clearOfPapers && clearOfMissions) {
        spot = cand;
        break;
      }
    }
    if (spot) {
      const golden = examPapers.length >= EXAM_PAPER_COUNT;
      examPapers.push({ x: spot.x, y: spot.y, r: 12, golden });
    }
  }
  S.papersTotal = examPapers.length;
  S.papersBonus = false;
}

function updateExamPapers(dt) {
  if (!player || !player.alive) return;
  for (let i = examPapers.length - 1; i >= 0; i--) {
    const p = examPapers[i];
    if (Math.hypot(player.x - p.x, player.y - p.y) > player.r + p.r + 8) continue;
    examPapers.splice(i, 1);
    const pts = p.golden ? EXAM_GOLDEN_POINTS : EXAM_PAPER_POINTS;
    const label = S.role === 'teacher'
      ? (p.golden ? 'Examen dorado confiscado' : 'Examen confiscado')
      : (p.golden ? 'Apunte dorado recogido' : 'Apunte recogido');
    grantExamPoints(pts, label);
    damageText(player.x, player.y - 46, '+' + pts + ' pts', '#ffe08a');
    addFx({
      type: 'ring', x: p.x, y: p.y, r0: 8, r1: p.golden ? 86 : 58, dur: 0.45,
      color: p.golden ? '255,179,71' : '255,224,138'
    });
    log('+' + pts + ' puntos de examen por ' +
      (S.role === 'teacher'
        ? (p.golden ? 'confiscar un examen dorado' : 'confiscar un examen')
        : (p.golden ? 'recoger un apunte dorado' : 'recoger un apunte')), '#ffd166');
    if (!S.papersBonus && S.papersTotal > 0 && examPapers.length === 0) {
      S.papersBonus = true;
      grantExamPoints(EXAM_ALL_PAPERS_BONUS, 'Expediente completo');
      damageText(player.x, player.y - 64, '+' + EXAM_ALL_PAPERS_BONUS + ' pts extra', '#ffe08a');
      log('+' + EXAM_ALL_PAPERS_BONUS + ' puntos de examen por recoger todos los apuntes.', '#ffd166');
    }
  }
}

/* ---------------------------------------------------------------------------
   Comida peruana esparcida por el mapa
   --------------------------------------------------------------------------- */
function pickFoodType() {
  const total = FOOD_TYPES.reduce((sum, f) => sum + (f.weight || 1), 0);
  let roll = Math.random() * total;
  for (const f of FOOD_TYPES) {
    roll -= (f.weight || 1);
    if (roll <= 0) return f;
  }
  return FOOD_TYPES[0];
}

function randomFoodSpot() {
  for (let attempt = 0; attempt < 120; attempt++) {
    const room = ROOMS[(Math.random() * ROOMS.length) | 0];
    const cx = (room.x + room.w / 2) * T;
    const cy = (room.y + room.h / 2) * T;
    const cand = freeSpot(cx, cy, Math.min(room.w, room.h) * T * 0.34);
    if (isSolidTile((cand.x / T) | 0, (cand.y / T) | 0)) continue;
    if (MISSIONS.some(m => Math.hypot(m.x - cand.x, m.y - cand.y) < T * 1.15)) continue;
    if (examPapers.some(p => Math.hypot(p.x - cand.x, p.y - cand.y) < T * 1.1)) continue;
    if (foodItems.some(p => Math.hypot(p.x - cand.x, p.y - cand.y) < T * 1.25)) continue;
    if (entities.some(e => e.alive && Math.hypot(e.x - cand.x, e.y - cand.y) < T * 1.4)) continue;
    return cand;
  }
  return freeSpot(WORLD_W / 2, WORLD_H / 2, WORLD_W * 0.38);
}

function spawnFoodItem() {
  const type = pickFoodType();
  const spot = randomFoodSpot();
  foodItems.push({
    type: type.id, name: type.name, short: type.short,
    color: type.color, accent: type.accent,
    heal: type.heal || 0, speedT: type.speedT || 0, speedMul: type.speedMul || 1,
    desc: type.desc,
    x: spot.x, y: spot.y, r: 14, seed: Math.random() * TAU
  });
}

function spawnFoodItems() {
  foodItems = [];
  for (let i = 0; i < FOOD_TARGET; i++) spawnFoodItem();
  S.foodSpawnTimer = 6;
}

function applyFood(e, f) {
  let healed = 0;
  if (f.heal > 0) {
    const before = e.hp;
    e.hp = Math.min(e.maxHp, e.hp + f.heal);
    healed = e.hp - before;
  }
  if (f.speedT > 0) {
    // Si el efecto anterior ya caducó, el nuevo multiplicador manda; si sigue
    // activo, conservamos el más fuerte y alargamos el tiempo.
    if ((e.foodSpeedT || 0) <= 0 || (f.speedMul || 1) >= (e.foodSpeedMul || 1)) {
      e.foodSpeedMul = f.speedMul || 1;
    }
    e.foodSpeedT = Math.max(e.foodSpeedT || 0, f.speedT);
  }
  const c = hexToRgb(f.color);
  addFx({ type: 'ring', x: f.x, y: f.y, r0: 8, r1: 72, dur: 0.45, color: c.r + ',' + c.g + ',' + c.b });
  const bits = [];
  if (healed > 0) bits.push('+' + Math.round(healed) + ' vida');
  if (f.speedT > 0) bits.push('+' + Math.round(((f.speedMul || 1) - 1) * 100) + '% vel.');
  damageText(e.x, e.y - 46, bits.length ? bits.join(' · ') : f.name, f.color);
  if (e.isPlayer) log(f.name + ': ' + f.desc + '.', f.color);
}

function updateFoodItems(dt) {
  if (!S || S.phase !== 'playing') return;
  S.foodSpawnTimer = Math.max(0, (S.foodSpawnTimer || 0) - dt);
  if (foodItems.length < FOOD_TARGET && S.foodSpawnTimer <= 0) {
    spawnFoodItem();
    S.foodSpawnTimer = rnd(4, 8);
  }
  for (let i = foodItems.length - 1; i >= 0; i--) {
    const f = foodItems[i];
    for (const e of entities) {
      if (!e.alive || e.escaped || (e.kind !== 'student' && !e.isPlayer)) continue;
      if (Math.hypot(e.x - f.x, e.y - f.y) > e.r + f.r + 7) continue;
      applyFood(e, f);
      foodItems.splice(i, 1);
      S.foodSpawnTimer = Math.min(S.foodSpawnTimer || 0, 2.5);
      break;
    }
  }
}

function drawFoodIcon(f, x, y, tn) {
  ctx.save();
  ctx.translate(x, y);
  if (f.type === 'inca') {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(0, 11, 9, 3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f7c948';
    roundRect(ctx, -7, -10, 14, 21, 4); ctx.fill();
    ctx.fillStyle = '#d6423a';
    roundRect(ctx, -7, -2, 14, 7, 2); ctx.fill();
    ctx.fillStyle = '#fff4cf';
    ctx.fillRect(-5, 2, 10, 1.5);
    ctx.fillStyle = '#c9a227';
    roundRect(ctx, -5, -13, 10, 4, 2); ctx.fill();
  } else if (f.type === 'pan') {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(0, 11, 12, 3.2, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e7b56b';
    ctx.beginPath(); ctx.ellipse(0, 1, 12, 8, -0.1, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff8f6b';
    roundRect(ctx, -9, -2, 18, 4, 2); ctx.fill();
    ctx.fillStyle = '#ffd166';
    roundRect(ctx, -8, -6, 16, 3, 1.5); ctx.fill();
    ctx.fillStyle = '#f6d7a1';
    ctx.beginPath(); ctx.ellipse(-4, -6, 4, 2, 0.2, 0, TAU); ctx.fill();
  } else if (f.type === 'arroz') {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(0, 11, 10, 3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8fd0ff';
    ctx.beginPath(); ctx.ellipse(0, 3, 11, 6, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#f4e7c3';
    ctx.beginPath(); ctx.ellipse(0, -1, 9, 5, 0, 0, Math.PI); ctx.fill();
    ctx.strokeStyle = '#b08e55'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-5, -2); ctx.lineTo(5, -2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-3, -4); ctx.lineTo(3, -4); ctx.stroke();
  } else if (f.type === 'chicha') {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(0, 11, 8, 2.8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#6f3b8a';
    ctx.beginPath(); ctx.moveTo(-7, -9); ctx.lineTo(7, -9); ctx.lineTo(5, 9); ctx.lineTo(-5, 9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a86bd6';
    ctx.beginPath(); ctx.moveTo(-6, -3); ctx.lineTo(6, -3); ctx.lineTo(4.5, 8); ctx.lineTo(-4.5, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(-4, -6, 2, 10);
    ctx.fillStyle = '#e0b3ff';
    ctx.beginPath(); ctx.arc(2, 1, 2, 0, TAU); ctx.fill();
  } else if (f.type === 'empanada') {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(0, 11, 11, 3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffb347';
    ctx.beginPath(); ctx.arc(0, 3, 10, Math.PI, TAU); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#c97a1f'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(i * 3, 3); ctx.lineTo(i * 2, 8); ctx.stroke();
    }
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(0, 11, 9, 3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffcf5c';
    ctx.beginPath(); ctx.arc(0, 1, 8.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffb347';
    ctx.beginPath(); ctx.arc(-2, -2, 3.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#6fae4a';
    ctx.beginPath(); ctx.ellipse(5, -7, 4, 2, -0.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#8a6a1f'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(3, -7); ctx.lineTo(6, -5); ctx.stroke();
  }
  ctx.restore();
}

function drawFoodItems() {
  const tn = performance.now() / 1000;
  for (const f of foodItems) {
    if (f.x < cam.x - 900 || f.x > cam.x + 900 || f.y < cam.y - 650 || f.y > cam.y + 650) continue;
    const bob = Math.sin(tn * 2.8 + f.seed) * 2.5;
    const x = f.x, y = f.y + bob;
    ctx.save();
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 26);
    glow.addColorStop(0, hexRgba(f.color, 0.28));
    glow.addColorStop(1, hexRgba(f.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, 26, 0, TAU); ctx.fill();
    drawFoodIcon(f, x, y, tn);
    ctx.restore();
  }
}

/* ---------------------------------------------------------------------------
   Puertas animadas
   --------------------------------------------------------------------------- */
function buildDoorGroups() {
  doorGroups = [];
  if (!doorTiles || !doorTiles.length) return;
  const byKey = Object.create(null);
  for (const d of doorTiles) byKey[d.x + ',' + d.y] = d;
  const used = Object.create(null);
  const zoneAt = (tx, ty) => (ty >= 0 && ty < ROWS && tx >= 0 && tx < COLS ? zoneKind[ty][tx] : null);

  for (const d of doorTiles) {
    const key = d.x + ',' + d.y;
    if (used[key]) continue;
    const rightKey = (d.x + 1) + ',' + d.y;
    const downKey = d.x + ',' + (d.y + 1);
    const right = byKey[rightKey];
    const down = byKey[downKey];
    let orient, tiles;
    if (right && !used[rightKey]) {
      orient = 'h';
      tiles = [d, right];
    } else if (down && !used[downKey]) {
      orient = 'v';
      tiles = [d, down];
    } else {
      // Una puerta suelta no debería existir, pero inferimos la orientación
      // por los muros laterales para que el dibujo nunca quede roto.
      orient = isSolidTile(d.x - 1, d.y) && isSolidTile(d.x + 1, d.y) ? 'h' : 'v';
      tiles = [d];
    }
    for (const t of tiles) used[t.x + ',' + t.y] = true;

    const xs = tiles.map(t => t.x);
    const ys = tiles.map(t => t.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const g = {
      x: minX, y: minY,
      w: maxX - minX + 1, h: maxY - minY + 1,
      orient,
      cx: (minX + (maxX - minX + 1) / 2) * T,
      cy: (minY + (maxY - minY + 1) / 2) * T,
      open: 0, target: 0, closeDelay: 0, swing: -1,
      room: null, code: ''
    };

    g.room = ROOMS.find(r => {
      const onH = (g.y === r.y || g.y === r.y + r.h - 1) &&
        g.x <= r.x + r.w - 1 && g.x + g.w - 1 >= r.x;
      const onV = (g.x === r.x || g.x === r.x + r.w - 1) &&
        g.y <= r.y + r.h - 1 && g.y + g.h - 1 >= r.y;
      return onH || onV;
    }) || null;

    // El lado interior del aula decide hacia dónde giran las hojas.
    if (orient === 'h') {
      const northInside = zoneAt(g.x, g.y - 1) !== null;
      const southInside = zoneAt(g.x, g.y + g.h) !== null;
      g.swing = southInside && !northInside ? 1 : -1;
    } else {
      const westInside = zoneAt(g.x - 1, g.y) !== null;
      const eastInside = zoneAt(g.x + g.w, g.y) !== null;
      g.swing = eastInside && !westInside ? 1 : -1;
    }
    g.code = g.room ? (g.room.code || g.room.name.slice(0, 4).toUpperCase()) : '';
    doorGroups.push(g);
  }
}

function updateDoors(dt) {
  if (!doorGroups.length) return;
  const openRadius = T * 1.5;
  const closeRadius = T * 2.15;
  for (const g of doorGroups) {
    let near = false;
    for (const e of entities) {
      if (!e || !e.alive || e.escaped) continue;
      if (e.kind !== 'student' && e.kind !== 'teacher') continue;
      const radius = g.open > 0.06 ? closeRadius : openRadius;
      if (dxy(e.x, e.y, g.cx, g.cy) < radius) { near = true; break; }
    }
    if (near) {
      g.target = 1;
      g.closeDelay = 0.34;
    } else {
      g.closeDelay = Math.max(0, g.closeDelay - dt);
      if (g.closeDelay <= 0) g.target = 0;
    }
    const speed = g.target ? 6.4 : 3.3;
    g.open += (g.target - g.open) * Math.min(1, dt * speed);
    if (g.open < 0.015) g.open = 0;
    if (g.open > 0.997) g.open = 1;
  }
}

function drawDoorLeaf(hx, hy, len, baseAng, delta) {
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(baseAng + delta);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(ctx, 1.5, -5.5, len, 11, 2); ctx.fill();
  ctx.fillStyle = '#8a5c38';
  roundRect(ctx, 0, -5, len, 10, 2); ctx.fill();
  ctx.fillStyle = '#b37a4d';
  roundRect(ctx, 0, -5, len, 3, 1.5); ctx.fill();
  ctx.strokeStyle = 'rgba(52,30,14,0.55)';
  ctx.lineWidth = 1;
  roundRect(ctx, 3, -2.2, Math.max(4, len * 0.4), 4.4, 1); ctx.stroke();
  roundRect(ctx, 3 + len * 0.48, -2.2, Math.max(4, len * 0.4), 4.4, 1); ctx.stroke();
  ctx.strokeStyle = 'rgba(40,23,11,0.72)';
  roundRect(ctx, 0, -5, len, 10, 2); ctx.stroke();
  ctx.fillStyle = '#f0cc72';
  ctx.beginPath(); ctx.arc(len - 5, 0, 1.8, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawDoorGroup(g) {
  const px = g.x * T, py = g.y * T;
  const w = g.w * T, h = g.h * T;
  const x1 = px + w, y1 = py + h;
  const cx = px + w / 2, cy = py + h / 2;
  const floor = floorCol[g.y][g.x] || '#1b2438';
  const dark = '#2a1c13';
  const wood = '#6b472c';
  const woodLight = '#9a6a43';

  ctx.save();
  // hueco de la puerta
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  roundRect(ctx, px + 1, py + 1, w - 2, h - 2, 4); ctx.fill();
  ctx.fillStyle = shadeHex(floor, 0.06);
  roundRect(ctx, px + 7, py + 7, w - 14, h - 14, 2); ctx.fill();

  // luz que se escapa por la abertura (se nota sobre todo de noche)
  if (g.open > 0.02) {
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, T * 2.3);
    const a = (S.night ? 0.19 : 0.065) * g.open;
    glow.addColorStop(0, 'rgba(255,232,172,' + a + ')');
    glow.addColorStop(0.55, 'rgba(255,215,145,' + a * 0.38 + ')');
    glow.addColorStop(1, 'rgba(255,215,145,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - T * 2.3, cy - T * 2.3, T * 4.6, T * 4.6);
  }

  // felpudo con el código de la sala
  ctx.fillStyle = 'rgba(28,22,36,0.58)';
  roundRect(ctx, px + 13, py + 13, w - 26, h - 26, 3); ctx.fill();
  ctx.strokeStyle = 'rgba(222,184,105,0.50)';
  ctx.lineWidth = 1;
  roundRect(ctx, px + 14.5, py + 14.5, w - 29, h - 29, 2.5); ctx.stroke();
  if (g.code) {
    ctx.fillStyle = 'rgba(245,225,175,0.88)';
    ctx.font = 'bold 8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(g.code, cx, cy + 0.5);
  }

  // marco de madera
  ctx.fillStyle = wood;
  if (g.orient === 'h') {
    ctx.fillRect(px + 2, py + 2, 6, h - 4);
    ctx.fillRect(x1 - 8, py + 2, 6, h - 4);
    ctx.fillRect(px + 2, py + 2, w - 4, 5);
    ctx.fillRect(px + 2, y1 - 7, w - 4, 5);
    ctx.fillStyle = 'rgba(255,220,170,0.16)';
    ctx.fillRect(px + 2, py + 2, w - 4, 1.5);
    ctx.fillStyle = woodLight;
    ctx.fillRect(px + 7, py + 2, 2, h - 4);
    ctx.fillRect(x1 - 9, py + 2, 2, h - 4);
  } else {
    ctx.fillRect(px + 2, py + 2, w - 4, 6);
    ctx.fillRect(px + 2, y1 - 8, w - 4, 6);
    ctx.fillRect(px + 2, py + 2, 5, h - 4);
    ctx.fillRect(x1 - 7, py + 2, 5, h - 4);
    ctx.fillStyle = 'rgba(255,220,170,0.16)';
    ctx.fillRect(px + 2, py + 2, 5, h - 4);
    ctx.fillStyle = woodLight;
    ctx.fillRect(px + 2, py + 7, w - 4, 2);
    ctx.fillRect(px + 2, y1 - 9, w - 4, 2);
  }
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1;
  if (g.orient === 'h') ctx.strokeRect(px + 2.5, py + 2.5, w - 5, h - 5);
  else ctx.strokeRect(px + 2.5, py + 2.5, w - 5, h - 5);

  // hojas: doble puerta que gira hacia el interior de la sala
  const a = g.open * 1.28;
  if (g.open < 0.08) {
    ctx.fillStyle = 'rgba(24,14,9,0.55)';
    if (g.orient === 'h') ctx.fillRect(cx - 1, cy - 7, 2, 14);
    else ctx.fillRect(cx - 7, cy - 1, 14, 2);
  }
  if (g.orient === 'h') {
    const len = Math.max(12, w / 2 - 9);
    drawDoorLeaf(px + 8, cy, len, 0, g.swing * a);
    drawDoorLeaf(x1 - 8, cy, len, Math.PI, -g.swing * a);
  } else {
    const len = Math.max(12, h / 2 - 9);
    drawDoorLeaf(cx, py + 8, len, Math.PI / 2, -g.swing * a);
    drawDoorLeaf(cx, y1 - 8, len, -Math.PI / 2, g.swing * a);
  }
  ctx.restore();
}

function drawDoors(x0, x1, y0, y1) {
  for (const g of doorGroups) {
    if (g.x > x1 + 1 || g.x + g.w < x0 - 1 || g.y > y1 + 1 || g.y + g.h < y0 - 1) continue;
    drawDoorGroup(g);
  }
}

/* Campo de distancias (BFS) hacia un tile: sirve para que las IA recorran
   el colegio por puertas y pasillos sin quedarse atrapadas en las paredes. */
function buildFlowTo(tx, ty) {
  const flow = new Int16Array(COLS * ROWS);
  flow.fill(-1);
  if (isSolidTile(tx, ty)) return flow;
  const q = new Int32Array(COLS * ROWS * 2);
  let head = 0, tail = 0;
  flow[ty * COLS + tx] = 0;
  q[tail++] = tx; q[tail++] = ty;
  while (head < tail) {
    const x = q[head++], y = q[head++];
    const d = flow[y * COLS + x];
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      if (isSolidTile(nx, ny) || flow[ny * COLS + nx] !== -1) continue;
      flow[ny * COLS + nx] = d + 1;
      q[tail++] = nx; q[tail++] = ny;
    }
  }
  return flow;
}

function patrolFlow(i) {
  if (!patrolFlows) patrolFlows = [];
  const spots = isNight() ? NIGHT_SPOTS : DAY_SPOTS;
  const idx = i % spots.length;
  const key = (isNight() ? 100 : 0) + idx;
  if (!patrolFlows[key]) {
    const g = spots[idx];
    patrolFlows[key] = buildFlowTo(g[0], g[1]);
  }
  return patrolFlows[key];
}

function flowStep(flow, x, y) {
  const tx = clamp((x / T) | 0, 0, COLS - 1), ty = clamp((y / T) | 0, 0, ROWS - 1);
  let best = flow[ty * COLS + tx], bx = tx, by = ty;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = tx + dx, ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      if (isSolidTile(nx, ny)) continue;
      // no cortar esquinas en diagonal
      if (dx && dy && (isSolidTile(tx + dx, ty) || isSolidTile(tx, ty + dy))) continue;
      const v = flow[ny * COLS + nx];
      if (v === -1) continue;
      if (best === -1 || v < best) { best = v; bx = nx; by = ny; }
    }
  }
  return { x: bx * T + T / 2, y: by * T + T / 2 };
}

function resolveAxis(e, axis, d) {
  const minx = Math.floor((e.x - e.r) / T), maxx = Math.floor((e.x + e.r - 0.01) / T);
  const miny = Math.floor((e.y - e.r) / T), maxy = Math.floor((e.y + e.r - 0.01) / T);
  for (let ty = miny; ty <= maxy; ty++) {
    for (let tx = minx; tx <= maxx; tx++) {
      if (!isSolidTile(tx, ty)) continue;
      if (axis === 'x') e.x = d > 0 ? tx * T - e.r - 0.01 : (tx + 1) * T + e.r + 0.01;
      else e.y = d > 0 ? ty * T - e.r - 0.01 : (ty + 1) * T + e.r + 0.01;
    }
  }
}

function moveEntity(e, dx, dy) {
  if (dx) { e.x += dx; resolveAxis(e, 'x', dx); }
  if (dy) { e.y += dy; resolveAxis(e, 'y', dy); }
  e.x = clamp(e.x, e.r + 1, WORLD_W - e.r - 1);
  e.y = clamp(e.y, e.r + 1, WORLD_H - e.r - 1);
}

/* ---------------------------------------------------------------------------
   Mensajes, avisos y efectos
   --------------------------------------------------------------------------- */
function log(text, color) {
  const primero = S.messages[0];
  if (primero && primero.text === text) { primero.t = 6; primero.color = color || primero.color; return; }
  S.messages.unshift({ text, color: color || '#dfe8fb', t: 6 });
  if (S.messages.length > 4) S.messages.pop();
}
function banner(text, sub, dur) {
  dur = dur || 2.6;
  S.banner = { text, sub, t: dur, max: dur };
}
function damageText(x, y, amount, color) {
  texts.push({ x, y, vy: -30, t: 1.1, txt: amount, color: color || '#fff' });
}
function addFx(o) { o.t = o.dur = o.dur || 0.4; fx.push(o); }
function shake(a) { S.camShake = Math.max(S.camShake, a); }

/* Firma visual del traje: cada habilidad deja una forma distinta alrededor
   del personaje. No cambia el dano ni los tiempos, solo el diseno del efecto. */
function themeCast(e, x, y, scale) {
  const sk = e && e.skin;
  if (!sk || !sk.fx) return;
  addFx({
    type: 'theme', x: x === undefined ? e.x : x, y: y === undefined ? e.y : y,
    dur: 0.62, scale: scale || 1, style: sk.fx.style || 'spark',
    color: sk.fx.color, accent: sk.fx.accent,
    seed: Math.random() * 10
  });
}

/* ---------------------------------------------------------------------------
   Creacion de entidades
   --------------------------------------------------------------------------- */
function makeStudent(charId, isPlayer, name) {
  const c = STUDENTS[charId];
  const outfit = outfitFor('student', charId, isPlayer, c.look);
  return {
    kind: 'student', charId, char: c, isPlayer, name, skin: outfit.skin,
    look: outfit.look,
    x: 0, y: 0, r: 13, face: -Math.PI / 2,
    hp: c.hp, maxHp: c.hp, speed: c.speed,
    cd: 0, cd2: 0, cdMax: 0,
    auraT: 0, speedUp: 0, invis: 0, revealed: 0, slowT: 0, voidSlowT: 0, noAgenda: 0,
    foodSpeedT: 0, foodSpeedMul: 1,
    stun: 0, blockT: 0, sprint: 0, immune: 0, flash: 0, walk: 0,
    strikeT: 0, strikeDur: 0, strikeStyle: '', strikeDir: 0, strikeWeapon: '',
    luisFastT: 0, talkT: 0, talkLines: null,
    eatT: 0, blinkSeed: Math.random() * 4,
    alive: true, escaped: false,
    ai: {
      wx: 0, wy: 0, t: 0, stuck: 0, panic: 0,
      escT: 0, escX: undefined, escY: undefined, escFlow: null, escTX: -1, escTY: -1,
      detourT: 0, detourAng: 0, lastThreat: null, solveT: 0
    }
  };
}

function makeTeacher(teacherId, isPlayer, name) {
  const c = TEACHERS[teacherId];
  const outfit = outfitFor('teacher', teacherId, isPlayer, c.look);
  return {
    kind: 'teacher', teacherId, char: c, isPlayer, name, skin: outfit.skin,
    look: outfit.look,
    x: 0, y: 0, r: 16, face: -Math.PI / 2,
    hp: c.hp, maxHp: c.hp, speed: c.speed,
    cds: [0, 0, 0], buffNext: false, speedUp: 0, foodSpeedT: 0, foodSpeedMul: 1, stun: 0, swing: 0, flash: 0, walk: 0,
    talkT: 0, talkLines: null, pendingCharge: false,
    strikeT: 0, strikeDur: 0, strikeStyle: '', strikeDir: 0, strikeWeapon: '',
    combT: 0, chargeT: 0, chargeAng: 0,
    voidAuraT: 0, voidAuraR: 190, hiddenT: 0,
    summon: false, summonKind: null, summonT: 0, owner: null,
    retreatT: 0, retreatAng: 0,
    reTarget: 0, meleeCd: 0, flowT: 0, flowTX: -1, flowTY: -1,
    pathFlow: null, pathT: 0, pathTX: -1, pathTY: -1,
    blinkSeed: Math.random() * 4,
    alive: true, target: null, lost: 0,
    ai: { wx: 0, wy: 0, t: 0, patrolNight: false, pi: -1 }
  };
}

function nameFor(base, used, id) {
  if (!used[id]) { used[id] = 1; return base + ' (IA)'; }
  used[id]++;
  return base + ' (IA ' + used[id] + ')';
}

/* Animacion de golpe cuerpo a cuerpo. La pose se calcula con strikeT y se
   dibuja en drawPerson; aqui solo se marca el inicio y el tipo de arma. */
function startStrike(e, style, dur, weapon) {
  if (!e) return;
  const d = dur || 0.34;
  e.strikeT = d;
  e.strikeDur = d;
  e.strikeStyle = style || 'swing';
  e.strikeDir = typeof e.face === 'number' ? e.face : 0;
  e.strikeWeapon = weapon || '';
}

/* ---------------------------------------------------------------------------
   Velocidad (con todos los modificadores)
   --------------------------------------------------------------------------- */
function leoSlowActive(t) {
  for (const s of studentList) {
    if (s.alive && !s.escaped && s.auraT > 0 && dist(s, t) < 265) return true;
  }
  return false;
}

/* el profesor jugador acelera un poco cuando tiene una presa cerca */
function presaCerca(t, radio) {
  for (const s of studentList) {
    if (s.alive && !s.escaped && dist(s, t) < radio) return true;
  }
  return false;
}

function entitySpeed(e) {
  let sp = e.speed;
  if (e.stun > 0) return 0;
  if (e.foodSpeedT > 0) sp *= (e.foodSpeedMul || 1);
  // Quispe se queda quieto mientras habla, embiste o se peina. Cáceres puede
  // seguir moviéndose mientras suelta sus frases (es su forma de intimidar).
  if (e.kind === 'teacher' && (e.combT > 0 || e.chargeT > 0 ||
      (e.talkT > 0 && e.teacherId !== 'ovidio'))) return 0;
  if (e.kind === 'student') {
    if (e.voidSlowT > 0) sp *= 0.25;
    else if (e.slowT > 0) sp *= 0.45;
    if (e.speedUp > 0) sp *= 1.75;
    if (e.luisFastT > 0) sp *= 1.45;
    if (e.sprint > 0) sp *= 1.2;
    if (e.immune > 0) sp *= 0.5;      // Elias: zapatos al reves, lento pero inmune
    if (e.noAgenda > 0) sp *= 0.85;
    if (e.charId === 'luis' && e.cd > 0 && e.luisFastT <= 0) sp *= 0.85;
  } else {
    if (e.speedUp > 0) sp *= 1.6;
    if (e.target && dist(e.target, e) < 520) sp *= 1.18;   // los profesores corren detras de su presa
    if (e.isPlayer && presaCerca(e, 420)) sp *= 1.15;      // el profesor jugador aprieta el paso
    if (leoSlowActive(e)) sp *= 0.5;
  }
  return sp;
}

/* ---------------------------------------------------------------------------
   Dano
   --------------------------------------------------------------------------- */
function hurtTeacher(t, dmg, src) {
  if (!t.alive) return 0;
  dmg = Math.round(dmg);
  t.hp -= dmg;
  t.flash = 0.18;
  damageText(t.x, t.y - t.r - 12, dmg, '#ffd7d7');
  if (src && src.isPlayer) S.stats.dmg += dmg;
  if (t.hp <= 0) {
    t.hp = 0; t.alive = false;
    if (t.summon) {
      log(t.name + ' se desvanece', '#9fd8ff');
      addFx({ type: 'ring', x: t.x, y: t.y, r0: 8, r1: 96, dur: 0.5, color: '170,210,255' });
      t.summonT = Math.min(t.summonT, 0.25);
    } else {
      S.downTeachers++;
      log(t.name + ' ha sido noqueado', '#9dffb0');
      addFx({ type: 'ring', x: t.x, y: t.y, r0: 8, r1: 130, dur: 0.55, color: '255,130,130' });
      const credited = src && (src.isPlayer || (src.owner && src.owner.isPlayer));
      if (S.role === 'student' && credited) {
        grantExamPoints(12, 'Profesor noqueado');
        log('+12 puntos de examen por noquear a ' + t.name, '#ffd166');
      }
      if (t.isPlayer) endMatch('student', 'TE NOQUEARON', 'Los estudiantes acabaron contigo.');
      else checkEnd();
    }
  }
  return dmg;
}

function hurtStudent(s, dmg, src, opts) {
  opts = opts || {};
  if (!s.alive || s.escaped) return 0;
  if (s.immune > 0) {                                  // Elias con los zapatos al reves
    damageText(s.x, s.y - s.r - 26, 'INMUNE', '#6ff0e0');
    addFx({ type: 'ring', x: s.x, y: s.y, r0: 10, r1: 52, dur: 0.3, color: '110,240,224' });
    if (src && src.isPlayer) log('¡Es inmune! Los zapatos al reves lo protegen', '#6ff0e0');
    return 0;
  }
  if (opts.melee && s.charId === 'luis' && s.cd > 0) dmg *= 0.6;   // bloqueo con la regla
  dmg = Math.round(dmg);
  s.hp -= dmg;
  s.flash = 0.18;
  if (src && src.isPlayer) S.stats.dmg += dmg;
  damageText(s.x, s.y - s.r - 12, dmg, src && src.isPlayer ? '#ffe9a8' : '#ff9d9d');
  if (opts.reveal) {
    s.revealed = Math.max(s.revealed, opts.reveal);
    if (s.isPlayer) log('¡Tu posicion ha sido revelada!', '#ff9d9d');
  }
  if (opts.knock && opts.from) {
    const a = Math.atan2(s.y - opts.from.y, s.x - opts.from.x);
    moveEntity(s, Math.cos(a) * opts.knock, Math.sin(a) * opts.knock);
  }
  if (s.hp <= 0) {
    s.hp = 0; s.alive = false; S.downStudents++;
    log(s.name + ' ha sido eliminado', '#ff9d9d');
    addFx({ type: 'ring', x: s.x, y: s.y, r0: 8, r1: 120, dur: 0.55, color: '255,140,140' });
    const credited = src && (src.isPlayer || (src.owner && src.owner.isPlayer));
    if (S.role === 'teacher' && credited) {
      grantExamPoints(8, 'Estudiante reprobado');
      log('+8 puntos de examen por reprobar a ' + s.name, '#ffd166');
    }
    if (s.isPlayer) endMatch('teacher', 'TE ATRAPARON', 'Los profesores te dejaron sin vida.');
    else checkEnd();
  }
  return dmg;
}

function areaHit(t, radius, dmg, opts) {
  opts = opts || {};
  let n = 0;
  for (const s of studentList) {
    if (!s.alive || s.escaped) continue;
    if (dist(t, s) < radius + s.r) { hurtStudent(s, dmg, t, Object.assign({ melee: true }, opts)); n++; }
  }
  return n;
}

/* ---------------------------------------------------------------------------
   HABILIDADES DE LOS ESTUDIANTES
   --------------------------------------------------------------------------- */
function useStudentAbility(s, slot) {
  if (!s || !s.alive || s.escaped || s.stun > 0) return;
  const second = slot === 2;
  const ab = second ? s.char.ability2 : s.char.ability;
  const cdKey = second ? 'cd2' : 'cd';
  if (!ab || s[cdKey] > 0) return;
  const used = castStudentAbility(s, ab, {});
  if (!used) {
    s[cdKey] = Math.max(s[cdKey], 2.5);   // evita repetir el aviso sin parar
    return;
  }
  s[cdKey] = ab.cd;
}

function castStudentAbility(s, ab, opts) {
  opts = opts || {};
  if (!ab || !ab.id) return false;
  if (!(ab.id === 'invis' && !isNight()) && !opts.stolen) themeCast(s, s.x, s.y, 1);
  switch (ab.id) {
    case 'slow':
      s.auraT = 6;
      addFx({ type: 'ring', x: s.x, y: s.y, r0: 30, r1: 265, dur: 0.7, color: skinRgb(s, '120,200,255') });
      log(s.name + ': aura ralentizadora (profesores al 50%)', skinAccent(s, '#8fd0ff'));
      return true;
    case 'dance':
      s.speedUp = 5;
      addFx({ type: 'ring', x: s.x, y: s.y, r0: 12, r1: 80, dur: 0.4, color: skinRgb(s, '255,220,120') });
      log(s.name + ' se pone a bailar: ¡mas velocidad!', skinAccent(s, '#ffe08a'));
      return true;
    case 'invis':
      if (!isNight()) {
        if (s.isPlayer) log(s.name + ' solo puede desaparecer de NOCHE', '#c9b6ff');
        return false;
      }
      s.invis = 5;
      addFx({ type: 'ring', x: s.x, y: s.y, r0: 8, r1: 70, dur: 0.5, color: skinRgb(s, '190,160,255') });
      for (let i = 0; i < 5; i++) {
        addFx({ type: 'dust', x: s.x + rnd(-16, 16), y: s.y + rnd(-8, 10), r: rnd(6, 13), dur: rnd(0.35, 0.7), color: skinRgb(s, '190,160,255') });
      }
      log(s.name + ' se vuelve invisible', skinAccent(s, '#c9b6ff'));
      return true;
    case 'ruler': {
      s.blockT = 0.35;
      if (s.charId === 'luis') s.luisFastT = 4;
      startStrike(s, 'ruler', 0.4, 'ruler');
      addFx({ type: 'swing', x: s.x, y: s.y, ang: s.face, dur: 0.28, color: skinRgb(s, '150,255,190') });
      let hit = false;
      for (const t of teacherList) {
        if (!t.alive || t.hiddenT > 0) continue;
        const d = dist(s, t);
        if (d < 95 && Math.abs(normAng(Math.atan2(t.y - s.y, t.x - s.x) - s.face)) < 1.6) {
          hit = true;
          hurtTeacher(t, 20, s);
          t.stun = 2;
          addFx({ type: 'star', x: t.x, y: t.y - 20, dur: 0.7 });
          shake(6);
          log('¡' + s.name + ' golpea a ' + t.name + ' con la regla! 2 s sin moverse', '#9dffb0');
        }
      }
      if (!hit) log(s.name + ' bloquea con la regla', '#9dffb0');
      return true;
    }
    case 'eat':
      s.hp = Math.min(s.maxHp, s.hp + 35); s.eatT = 1.15;
      damageText(s.x, s.y - 26, '+35', '#7dffa0');
      addFx({ type: 'ring', x: s.x, y: s.y, r0: 8, r1: 52, dur: 0.4, color: skinRgb(s, '255,190,120') });
      log(s.name + ' se come el bocadillo y recupera 35 de vida', skinAccent(s, '#ffb27d'));
      return true;
    case 'shoes':
      s.immune = 5;
      addFx({ type: 'ring', x: s.x, y: s.y, r0: 12, r1: 86, dur: 0.55, color: skinRgb(s, '110,240,224') });
      addFx({ type: 'star', x: s.x, y: s.y - 20, dur: 0.5, color: skinRgb(s, '255,230,120') });
      log(s.name + ' se pone los zapatos al revés: más lento pero INMUNE 5 s', skinAccent(s, '#6ff0e0'));
      return true;
    case 'pageWave': {
      s.talkT = 2.1;
      s.talkLines = ['¿Por cuál página vas?'];
      addFx({ type: 'ring', x: s.x, y: s.y, r0: 20, r1: 260, dur: 0.65, color: skinRgb(s, '150,255,190') });
      addFx({ type: 'ring', x: s.x, y: s.y, r0: 10, r1: 150, dur: 0.45, color: skinRgb(s, '215,255,225') });
      let hit = 0;
      for (const t of teacherList) {
        if (!t.alive || t.hiddenT > 0) continue;
        if (dist(s, t) <= 260 + t.r) {
          retreatTeacher(t, s, 1.2, 120);
          hit++;
        }
      }
      if (hit) log(s.name + ' pregunta «¿Por cuál página vas?»: ' + hit + (hit === 1 ? ' profesor retrocede' : ' profesores retroceden'), '#9dffb0');
      else log(s.name + ' pregunta «¿Por cuál página vas?»: la onda no alcanza a ningún profesor', '#9dffb0');
      return true;
    }
    case 'steal': {
      const options = [];
      for (const o of studentList) {
        if (o === s || !o.alive || o.escaped) continue;
        for (const other of [o.char.ability, o.char.ability2]) {
          if (!other || !other.id || other.id === 'steal') continue;
          if (other.id === 'invis' && !isNight()) continue;
          options.push({ target: o, ability: other });
        }
      }
      if (!options.length) {
        if (s.isPlayer) log(s.name + ' no encuentra ninguna habilidad que robar', '#c9b6ff');
        return false;
      }
      const pick = choice(options);
      addFx({ type: 'ring', x: s.x, y: s.y, r0: 10, r1: 92, dur: 0.55, color: skinRgb(s, '190,150,255') });
      addFx({ type: 'ring', x: pick.target.x, y: pick.target.y, r0: 8, r1: 64, dur: 0.45, color: skinRgb(s, '220,190,255') });
      for (let i = 0; i < 5; i++) {
        addFx({ type: 'spark', x: s.x + rnd(-16, 16), y: s.y - rnd(4, 28), dur: 0.45, color: skinRgb(s, '255,250,210') });
      }
      damageText(s.x, s.y - 40, 'ROBO', skinAccent(s, '#d9c2ff'));
      log(s.name + ' le roba ' + pick.ability.name + ' a ' + pick.target.name + ' y la usa al instante', skinAccent(s, '#d9c2ff'));
      castStudentAbility(s, pick.ability, { stolen: true, from: pick.target });
      return true;
    }
  }
  return false;
}

function retreatTeacher(t, from, dur, push) {
  if (!t || !t.alive) return;
  const ang = Math.atan2(t.y - from.y, t.x - from.x);
  t.retreatT = Math.max(t.retreatT, dur);
  t.retreatAng = ang;
  t.talkT = 0; t.pendingCharge = false; t.combT = 0; t.chargeT = 0;
  t.target = null; t.lost = 99;
  moveEntity(t, Math.cos(ang) * push, Math.sin(ang) * push);
  addFx({ type: 'ring', x: t.x, y: t.y, r0: 8, r1: 78, dur: 0.45, color: '150,255,190' });
  addFx({ type: 'star', x: t.x, y: t.y - 22, dur: 0.5 });
}

/* ---------------------------------------------------------------------------
   HABILIDADES DE LOS PROFESORES
   --------------------------------------------------------------------------- */
function useTeacherAbility(t, i) {
  if (!t.alive || t.summon || t.stun > 0 || t.cds[i] > 0) return;
  if (t.talkT > 0 || t.combT > 0 || t.chargeT > 0) return;
  const ab = t.char.abilities[i];
  if (!ab) return;
  t.cds[i] = ab.cd;
  themeCast(t, t.x, t.y, 1);

  if (t.teacherId === 'jose') {
    if (i === 0) {                                   // Agendazo: 23 (o 46 si hay decomiso)
      t.swing = 0.28;
      startStrike(t, 'agenda', 0.38, 'agenda');
      addFx({ type: 'swing', x: t.x, y: t.y, ang: t.face, dur: 0.28, color: skinRgb(t, '255,140,140') });
      let hit = false;
      for (const s of studentList) {
        if (!s.alive || s.escaped) continue;
        const d = dist(t, s);
        if (d < 96 && Math.abs(normAng(Math.atan2(s.y - t.y, s.x - t.x) - t.face)) < 1.6) {
          hit = true;
          const dmg = t.buffNext ? 46 : 23;
          if (t.buffNext && s.isPlayer) log('¡La agenda decomisada golpea mas fuerte!', '#ff9d9d');
          hurtStudent(s, dmg, t, { melee: true, knock: 22, from: t, reveal: 3 });
          shake(4);
        }
      }
      t.buffNext = false;
      if (!hit && t.isPlayer) log('Agendazo al aire...', '#8899b5');
    } else if (i === 1) {                            // Decomiso
      const pool = studentList.filter(s => s.alive && !s.escaped);
      if (!pool.length) { t.cds[i] = 1; return; }
      const s = choice(pool);
      s.noAgenda = 10;
      t.buffNext = true;
      addFx({ type: 'ring', x: s.x, y: s.y, r0: 6, r1: 60, dur: 0.5, color: skinRgb(t, '255,190,120') });
      log('Decomiso: ' + s.name + ' se queda sin agenda. El proximo Agendazo hara 46', skinAccent(t, '#ffbe78'));
      if (s.isPlayer) log('¡Te han quitado la agenda! (mas lento 10 s)', '#ffbe78');
    } else {                                         // Examen sorpresa
      let best = null, bd = 1e9;
      for (const s of studentList) {
        if (!s.alive || s.escaped) continue;
        const d = dist(t, s);
        if (d < bd) { bd = d; best = s; }
      }
      const spot = { x: t.x + Math.cos(t.face) * 40, y: t.y + Math.sin(t.face) * 40 };
      exams.push({ x: spot.x, y: spot.y, r: 12, target: best, speed: 96, life: 14, face: 0, owner: t, color: skinAccent(t, '#ff5d5d') });
      log('¡Examen sorpresa invocado! Sigue a ' + (best ? best.name : 'nadie'), skinAccent(t, '#ffd6a0'));
    }
    return;
  }

  if (t.teacherId === 'ovidio') {
    if (i === 0) {
      // Grito a distancia: apunta al estudiante mas cercano con linea de vision.
      let best = null, bd = 560;
      for (const s of studentList) {
        if (!s.alive || s.escaped) continue;
        const d = dist(t, s);
        if (d < bd && hasLOS(t.x, t.y, s.x, s.y)) { bd = d; best = s; }
      }
      if (best) t.face = Math.atan2(best.y - t.y, best.x - t.x);
      t.swing = 0.26;
      t.talkT = 0.9;
      t.talkLines = ['¡SIÉNTATE!'];
      const sx = t.x + Math.cos(t.face) * 22;
      const sy = t.y + Math.sin(t.face) * 22;
      projectiles.push({
        kind: 'shout', x: sx, y: sy, r: 17,
        vx: Math.cos(t.face) * 560, vy: Math.sin(t.face) * 560,
        dmg: 40, life: 0.9, owner: t, color: skinAccent(t, '#ff6b8a'),
        rgb: skinRgb(t, '255,105,140'),
        knock: 46, reveal: 0
      });
      addFx({ type: 'ring', x: t.x, y: t.y, r0: 8, r1: 72, dur: 0.4, color: skinRgb(t, '255,95,130') });
      log(t.name + ': «¡SIÉNTATE!» Onda sonora a distancia', skinAccent(t, '#ff9ab4'));
    } else if (i === 1) {
      // Se intercambia con el profesor mejor colocado y deja el aura negra.
      const partner = ovidioSwapPartner(t);
      if (!partner) {
        t.cds[i] = 1.5;
        if (t.isPlayer) log('No hay otro profesor disponible para el intercambio', '#8899b5');
        return;
      }
      const ox = t.x, oy = t.y;
      t.x = partner.x; t.y = partner.y;
      partner.x = ox; partner.y = oy;
      t.px = t.x; t.py = t.y;
      partner.px = partner.x; partner.py = partner.y;
      t.target = null; t.lost = 99; t.pathFlow = null; t.retreatT = 0;
      partner.target = null; partner.lost = 99; partner.pathFlow = null; partner.retreatT = 0;
      t.voidAuraT = 8;
      t.voidAuraR = 190;
      t.talkT = 2.1;
      t.talkLines = ['No me hagas', 'perder el tiempo'];
      addFx({ type: 'ring', x: ox, y: oy, r0: 10, r1: 92, dur: 0.55, color: skinRgb(t, '150,55,190') });
      addFx({ type: 'ring', x: t.x, y: t.y, r0: 12, r1: 210, dur: 0.7, color: skinRgb(t, '115,35,150') });
      for (let k = 0; k < 14; k++) {
        addFx({ type: 'dust', x: t.x + rnd(-70, 70), y: t.y + rnd(-36, 36), r: rnd(5, 16), dur: rnd(0.45, 0.85), color: skinRgb(t, '35,12,48') });
      }
      shake(6);
      log(t.name + ': «No me hagas perder el tiempo» — intercambio con ' + partner.name, '#c58cff');
      log('AURA NEGRA: 8 s, los estudiantes dentro se mueven un 75 % más lento', '#b48cff');
    } else {
      // Invisible para los estudiantes durante 6 segundos.
      t.hiddenT = Math.max(t.hiddenT, 6);
      t.talkT = 2.0;
      t.talkLines = ['No puedes', 'vencerme'];
      t.swing = 0.2;
      addFx({ type: 'ring', x: t.x, y: t.y, r0: 8, r1: 150, dur: 0.6, color: skinRgb(t, '95,25,135') });
      for (let k = 0; k < 16; k++) {
        addFx({ type: 'dust', x: t.x + rnd(-26, 26), y: t.y + rnd(-30, 12), r: rnd(6, 18), dur: rnd(0.45, 0.9), color: skinRgb(t, '28,10,42') });
      }
      log(t.name + ': «No puedes vencerme» — invisible para los estudiantes (6 s)', '#c58cff');
    }
    return;
  }

  if (t.teacherId === 'segundo') {
    if (i === 0) {
      // Peine regla: 30 al estudiante mas cercano dentro del cono frontal
      t.swing = 0.32;
      startStrike(t, 'comb', 0.4, 'comb');
      addFx({ type: 'swing', x: t.x, y: t.y, ang: t.face, dur: 0.3, color: skinRgb(t, '225,232,255') });
      let best = null, bd = 1e9;
      for (const s of studentList) {
        if (!s.alive || s.escaped) continue;
        const d = dist(t, s);
        const ang = Math.abs(normAng(Math.atan2(s.y - t.y, s.x - t.x) - t.face));
        if (d < 108 + s.r && ang < 1.5 && d < bd) { bd = d; best = s; }
      }
      if (best) {
        hurtStudent(best, 30, t, { melee: true, knock: 24, from: t, reveal: 2 });
        addFx({ type: 'star', x: best.x, y: best.y - 18, dur: 0.6, color: skinRgb(t, '255,230,120') });
        shake(6);
        log('¡Peinazo! ' + best.name + ' recibe 30 con el peine regla', '#d9c8ff');
      } else if (t.isPlayer) {
        log('Peinazo al aire...', '#8899b5');
      }
      mirrorSummonsMelee(t);
      return;
    }

    if (i === 1) {
      // Invoca al Profe Primero y al Profe Tercero. Si ya estan los dos,
      // la invocacion los refuerza y les recarga el tiempo de presencia.
      const active = summonsOf(t);
      if (active.length >= 2) {
        for (const s of active) {
          s.summonT = Math.max(s.summonT, 9);
          s.hp = Math.min(s.maxHp, s.hp + 18);
          addFx({ type: 'ring', x: s.x, y: s.y, r0: 8, r1: 74, dur: 0.45, color: skinRgb(t, '160,200,255') });
          for (let k = 0; k < 3; k++) {
            addFx({ type: 'spark', x: s.x + rnd(-10, 10), y: s.y - rnd(4, 26), dur: 0.45, color: skinRgb(t, '255,250,210') });
          }
        }
        log(t.name + ' refuerza a sus invocados: copian la invocación', '#d9c8ff');
        banner('¡INVOCACIÓN REFORZADA!', 'El Profe Primero y el Tercero recuperan presencia y vida.', 2.2);
      } else {
        clearSummons(t);
        const p1 = spawnSummon('primero', t, -1);
        const p2 = spawnSummon('tercero', t, 1);
        if (p1 && p2) {
          log(t.name + ' invoca al Profe Primero y al Profe Tercero', '#d9c8ff');
          banner('¡REFUERZOS!', 'El Profe Primero persigue al más cercano y el Tercero al tercero más cercano.', 2.4);
        }
      }
      return;
    }

    // Castigo de recreo: primero avisa, luego embiste hacia delante.
    // Los invocados copian el aviso y la embestida. Quitamos el cartel
    // anterior para que los bocadillos no se mezclen con el.
    S.banner = null;
    t.talkT = 2.6;
    t.talkLines = ['El tiempo que me estás', 'haciendo perder lo voy', 'a tomar en el recreo'];
    t.pendingCharge = true;
    t.chargeAng = t.face;
    addFx({ type: 'ring', x: t.x, y: t.y, r0: 8, r1: 58, dur: 0.45, color: skinRgb(t, '255,220,150') });
    log(t.name + ': «' + t.talkLines.join(' ') + '»', skinAccent(t, '#ffd6a0'));
    mirrorSummonsCharge(t);
    return;
  }
}

function nearestStudentDistance(x, y) {
  let bd = 1e9;
  for (const s of studentList) {
    if (!s.alive || s.escaped) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bd) bd = d;
  }
  return bd;
}

/* Cáceres elige al profesor que este mas cerca de algun estudiante para que
   el aura negra aparezca en una zona realmente peligrosa. */
function ovidioSwapPartner(t) {
  let best = null, bd = 1e9;
  for (const o of teacherList) {
    if (o === t || !o.alive || o.summon) continue;
    const d = nearestStudentDistance(o.x, o.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

/* ---------------------------------------------------------------------------
   Los invocados copian las habilidades del Profe Quispe
   --------------------------------------------------------------------------- */
function summonsOf(owner) {
  return teacherList.filter(t => t.summon && t.owner === owner && t.alive);
}

function summonReady(s) {
  return s.alive && s.stun <= 0 && s.talkT <= 0 && s.chargeT <= 0 && s.combT <= 0;
}

function mirrorSummonsMelee(owner) {
  const summons = summonsOf(owner).filter(summonReady);
  let hits = 0;
  for (const s of summons) {
    let best = null, bd = 1e9;
    for (const st of studentList) {
      if (!st.alive || st.escaped || st.invis > 0) continue;
      const d = dist(s, st);
      if (d < 128 + st.r && d < bd) { bd = d; best = st; }
    }
    if (best) s.face = Math.atan2(best.y - s.y, best.x - s.x);
    s.swing = 0.3;
    startStrike(s, 'comb', 0.37, (s.look && s.look.acc) || 'fist');
    addFx({ type: 'swing', x: s.x, y: s.y, ang: s.face, dur: 0.3, color: skinRgb(owner, '205,218,255') });
    if (best) {
      hurtStudent(best, 30, s, { melee: true, knock: 22, from: s, reveal: 2 });
      addFx({ type: 'star', x: best.x, y: best.y - 18, dur: 0.55, color: skinRgb(owner, '255,230,120') });
      hits++;
    }
  }
  if (hits > 0) {
    shake(4);
    log('Los invocados copian el Peine regla: ' + hits + ' golpe(s) de 30', '#d9c8ff');
  }
}

function mirrorSummonsCharge(owner) {
  const summons = summonsOf(owner).filter(summonReady);
  for (const s of summons) {
    s.talkT = 2.6;
    s.talkLines = owner.talkLines ? owner.talkLines.slice() : ['El tiempo que me estás', 'haciendo perder lo voy', 'a tomar en el recreo'];
    s.pendingCharge = true;
    s.chargeAng = s.face;
    addFx({ type: 'ring', x: s.x, y: s.y, r0: 8, r1: 58, dur: 0.45, color: skinRgb(owner, '255,220,150') });
  }
  if (summons.length) log('Los invocados copian el Castigo de recreo', '#ffd6a0');
}

/* ---------------------------------------------------------------------------
   Profesores invocados por el Profe Quispe
   --------------------------------------------------------------------------- */
function clearSummons(owner) {
  for (let i = teacherList.length - 1; i >= 0; i--) {
    const s = teacherList[i];
    if (s.summon && s.owner === owner) {
      const j = entities.indexOf(s);
      if (j >= 0) entities.splice(j, 1);
      teacherList.splice(i, 1);
      addFx({ type: 'ring', x: s.x, y: s.y, r0: 6, r1: 64, dur: 0.4, color: '160,200,255' });
    }
  }
}

function spawnSummon(kind, owner, side) {
  const base = SUMMON_TEACHERS[kind];
  if (!base) return null;
  const look = Object.assign({}, base.look);
  const c = { id: 'summon_' + kind, name: base.name, color: base.color, hp: 60, speed: 126, abilities: [], look, tagline: base.desc };
  const e = makeTeacher('segundo', false, base.name);
  e.char = c;
  e.look = look;
  e.name = base.name;
  e.hp = e.maxHp = 60;
  e.speed = 126;
  e.r = 15;
  e.summon = true;
  e.summonKind = kind;
  e.owner = owner;
  e.skin = owner.skin || null;       // hereda solo la firma visual del traje del jugador
  e.summonT = 9;
  e.face = owner.face;
  e.blinkSeed = Math.random() * 4;
  const ang = owner.face + (side > 0 ? 0.95 : -0.95);
  const spot = freeSpot(owner.x + Math.cos(ang) * T * 1.15, owner.y + Math.sin(ang) * T * 1.15, T * 1.05);
  e.x = spot.x; e.y = spot.y;
  entities.push(e);
  teacherList.push(e);
  addFx({ type: 'ring', x: e.x, y: e.y, r0: 6, r1: 92, dur: 0.6, color: skinRgb(owner, base.rgb) });
  for (let i = 0; i < 5; i++) {
    addFx({ type: 'dust', x: e.x + rnd(-18, 18), y: e.y + rnd(-10, 12), r: rnd(6, 14), dur: rnd(0.45, 0.85), color: skinRgb(owner, base.rgb) });
  }
  return e;
}

function updateSummonAI(t, dt) {
  if (t.stun > 0 || t.talkT > 0 || t.chargeT > 0 || t.combT > 0) return;
  t.reTarget -= dt;
  if (t.reTarget <= 0 || !t.target || !t.target.alive || t.target.escaped || t.target.invis > 0) {
    // El Primero busca al más cercano; el Tercero entra por el tercero más
    // cercano, de modo que entre los dos intentan cerrar una huida en pinza.
    const pool = studentList.filter(s => s.alive && !s.escaped && s.invis <= 0);
    pool.sort((a, b) => dist(t, a) - dist(t, b));
    const idx = t.summonKind === 'tercero' ? Math.min(2, pool.length - 1) : 0;
    t.target = pool.length ? pool[Math.max(0, idx)] : null;
    t.reTarget = 0.24;
  }

  if (t.target) {
    const d = dist(t, t.target);
    if (d < 170) t.face = Math.atan2(t.target.y - t.y, t.target.x - t.x);
    if (d > 42) {
      // Pequeña predicción: los invocados cortan la huida en vez de perseguir
      // siempre la posición exacta del estudiante.
      const lead = Math.min(20, d * 0.12);
      let gx = t.target.x + Math.cos(t.target.face || 0) * lead;
      let gy = t.target.y + Math.sin(t.target.face || 0) * lead;
      if (!hasLOS(t.x, t.y, gx, gy)) { gx = t.target.x; gy = t.target.y; }
      if (!hasLOS(t.x, t.y, gx, gy)) {
        const tx = clamp((gx / T) | 0, 0, COLS - 1), ty = clamp((gy / T) | 0, 0, ROWS - 1);
        t.flowT -= dt;
        if (!t.flow || t.flowT <= 0 || t.flowTX !== tx || t.flowTY !== ty) {
          t.flow = buildFlowTo(tx, ty);
          t.flowTX = tx; t.flowTY = ty; t.flowT = 0.45;
        }
        const st = flowStep(t.flow, t.x, t.y);
        gx = st.x; gy = st.y;
      }
      let dx = gx - t.x, dy = gy - t.y;
      const L = Math.hypot(dx, dy) || 1;
      // Los dos invocados no se montan uno encima del otro.
      let sx = 0, sy = 0;
      for (const o of teacherList) {
        if (o === t || !o.alive) continue;
        const od = dist(t, o);
        if (od < 48 && od > 0.01) { sx += (t.x - o.x) / od; sy += (t.y - o.y) / od; }
      }
      dx = dx / L + sx * 0.55;
      dy = dy / L + sy * 0.55;
      const DL = Math.hypot(dx, dy) || 1;
      t.face = Math.atan2(dy, dx);
      const sp = entitySpeed(t);
      moveEntity(t, (dx / DL) * sp * dt, (dy / DL) * sp * dt);
    } else {
      t.face = Math.atan2(t.target.y - t.y, t.target.x - t.x);
      t.meleeCd -= dt;
      if (t.meleeCd <= 0 && hasLOS(t.x, t.y, t.target.x, t.target.y)) {
        t.meleeCd = 1.1;
        t.swing = 0.22;
        startStrike(t, 'summon', 0.3, (t.look && t.look.acc) || 'fist');
        addFx({ type: 'swing', x: t.x, y: t.y, ang: t.face, dur: 0.22, color: '170,210,255' });
        hurtStudent(t.target, 8, t, { melee: true, knock: 12, from: t });
      }
    }
  } else if (t.owner && t.owner.alive) {
    const d = dist(t, t.owner);
    if (d > 70) {
      const a = Math.atan2(t.owner.y - t.y, t.owner.x - t.x);
      t.face = a;
      const sp = entitySpeed(t) * 0.8;
      moveEntity(t, Math.cos(a) * sp * dt, Math.sin(a) * sp * dt);
    }
  }
}

/* Aviso -> embestida -> peinado. Se ejecuta para todos los profesores. */
function updateTeacherSpecials(dt) {
  for (const t of teacherList) {
    if (!t.alive) continue;
    if (t.summon) {
      t.summonT -= dt;
      if (t.summonT < 1.2 && Math.random() < dt * 8) {
        addFx({ type: 'dust', x: t.x + rnd(-10, 10), y: t.y + rnd(-6, 8), r: rnd(4, 9), dur: 0.45, color: '160,200,255' });
      }
    }
    if (t.hiddenT > 0) t.hiddenT = Math.max(0, t.hiddenT - dt);
    if (t.voidAuraT > 0) {
      t.voidAuraT = Math.max(0, t.voidAuraT - dt);
      for (const s of studentList) {
        if (!s.alive || s.escaped || s.immune > 0) continue;
        if (dist(t, s) < t.voidAuraR + s.r) s.voidSlowT = Math.max(s.voidSlowT, 0.35);
      }
      if (Math.random() < dt * 14) {
        const a = Math.random() * TAU;
        const rr = Math.sqrt(Math.random()) * t.voidAuraR;
        addFx({
          type: 'dust', x: t.x + Math.cos(a) * rr, y: t.y + Math.sin(a) * rr,
          r: rnd(4, 11), dur: rnd(0.45, 0.9), color: Math.random() < 0.5 ? '28,10,42' : '82,28,110'
        });
      }
    }
    if (t.stun > 0) {
      t.talkT = 0; t.pendingCharge = false; t.chargeT = 0; t.combT = 0;
      continue;
    }

    if (t.talkT > 0) {
      t.talkT -= dt;
      if (t.talkT <= 0) {
        t.talkT = 0;
        if (t.pendingCharge) {
          t.pendingCharge = false;
          t.chargeT = 0.8;
          // La direccion queda fijada al activar la habilidad, no al terminar de hablar.
          addFx({ type: 'ring', x: t.x, y: t.y, r0: 8, r1: 72, dur: 0.4, color: '255,220,150' });
          addFx({ type: 'dust', x: t.x, y: t.y + t.r * 0.5, r: 12, dur: 0.5, color: '190,170,145' });
          shake(4);
          log('¡' + t.name + ' embiste hacia delante!', '#ffd6a0');
        }
      }
    }

    if (t.chargeT > 0) {
      t.chargeT -= dt;
      const ang = t.chargeAng;
      const sp = 720;
      const dx = Math.cos(ang) * sp * dt, dy = Math.sin(ang) * sp * dt;
      const bx = t.x, by = t.y;
      moveEntity(t, dx, dy);
      const moved = Math.hypot(t.x - bx, t.y - by);
      if (Math.random() < 0.7) {
        addFx({ type: 'dust', x: t.x - Math.cos(ang) * t.r + rnd(-6, 6), y: t.y + t.r * 0.55 + rnd(-4, 4), r: rnd(5, 11), dur: rnd(0.3, 0.55), color: '195,175,150' });
      }
      let hits = 0;
      for (const s of studentList) {
        if (!s.alive || s.escaped) continue;
        if (dist(t, s) < t.r + s.r + 8 && hasLOS(t.x, t.y, s.x, s.y)) {
          hurtStudent(s, 60, t, { melee: true, knock: 46, from: t, reveal: 3 });
          hits++;
        }
      }
      if (hits > 0) {
        t.chargeT = 0;
        t.combT = 1.05;
        startStrike(t, 'charge', 0.5, 'comb');
        t.strikeDir = t.chargeAng;
        shake(10);
        addFx({ type: 'star', x: t.x, y: t.y - t.r * 2, dur: 0.7 });
        for (let i = 0; i < 6; i++) {
          addFx({ type: 'dust', x: t.x + rnd(-24, 24), y: t.y + rnd(0, 16), r: rnd(6, 14), dur: rnd(0.4, 0.8), color: '210,190,160' });
        }
        log('¡Embestida! ' + hits + ' estudiante(s) reciben 60. ' + t.name + ' se para a peinarse', '#ffd6a0');
      } else if (moved < Math.hypot(dx, dy) * 0.35) {
        t.chargeT = 0;
        t.combT = 0.45;
        startStrike(t, 'charge', 0.42, 'comb');
        t.strikeDir = t.chargeAng;
        shake(5);
        addFx({ type: 'dust', x: t.x, y: t.y, r: 13, dur: 0.55, color: '185,165,140' });
        log(t.name + ' se estrella contra la pared', '#ffd6a0');
      }
    }

    if (t.combT > 0) {
      t.combT -= dt;
      if (Math.random() < dt * 18) {
        addFx({ type: 'spark', x: t.x + rnd(-8, 10), y: t.y - t.r * 2.25 + rnd(-6, 4), dur: 0.4 });
      }
    }
  }

  // quita invocaciones agotadas o noqueadas
  for (let i = teacherList.length - 1; i >= 0; i--) {
    const t = teacherList[i];
    if (t.summon && (!t.alive || t.summonT <= 0)) {
      const j = entities.indexOf(t);
      if (j >= 0) entities.splice(j, 1);
      teacherList.splice(i, 1);
      addFx({ type: 'ring', x: t.x, y: t.y, r0: 6, r1: 70, dur: 0.45, color: '160,200,255' });
      for (let k = 0; k < 4; k++) {
        addFx({ type: 'dust', x: t.x + rnd(-14, 14), y: t.y + rnd(-10, 8), r: rnd(5, 11), dur: rnd(0.35, 0.7), color: '170,205,255' });
      }
    }
  }
}

/* ---------------------------------------------------------------------------
   IA de estudiantes
   --------------------------------------------------------------------------- */
function openTilesAt(x, y, rad) {
  rad = rad === undefined ? 2 : rad;
  const cx = clamp((x / T) | 0, 0, COLS - 1);
  const cy = clamp((y / T) | 0, 0, ROWS - 1);
  let open = 0, total = 0;
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      total++;
      if (!isSolidTile(nx, ny)) open++;
    }
  }
  return open / Math.max(1, total);
}

/* Elige un punto de huida que no sea una ratonera: mira dos anillos de
   distancia, el espacio abierto alrededor, la visibilidad desde cada profesor
   y la separacion con los companeros. Si el punto no se ve desde la posicion
   actual, se llega por BFS para poder cruzar puertas. */
function chooseStudentEscape(s, threat, a) {
  if ((a.escT || 0) > 0 && a.escX !== undefined) {
    return { x: a.escX, y: a.escY, flow: a.escFlow || null };
  }
  const teachers = teacherList.filter(t => t.alive && t.hiddenT <= 0);
  const away = threat ? Math.atan2(s.y - threat.y, s.x - threat.x) : s.face;
  let best = null, bestScore = -1e9;
  const rings = [T * 3.2, T * 5.2];
  for (const rad of rings) {
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * TAU;
      const px = s.x + Math.cos(ang) * rad;
      const py = s.y + Math.sin(ang) * rad;
      if (px < T * 1.2 || py < T * 1.2 || px > WORLD_W - T * 1.2 || py > WORLD_H - T * 1.2) continue;
      if (isSolidTile((px / T) | 0, (py / T) | 0)) continue;
      const los = hasLOS(s.x, s.y, px, py);
      let score = openTilesAt(px, py, 2) * 150;
      let sum = 0, minD = 1e9, seen = 0;
      for (const o of teachers) {
        const d = dxy(px, py, o.x, o.y);
        sum += Math.min(1000, d);
        if (d < minD) minD = d;
        if (hasLOS(o.x, o.y, px, py)) seen++;
      }
      if (teachers.length) {
        score += Math.min(1000, minD) * 1.25;
        score += (sum / teachers.length) * 0.35;
        score -= seen * 42;
      }
      if (!los) score -= 85;
      score += Math.cos(ang - away) * 16;
      score += Math.cos(ang - s.face) * 8;
      const edge = Math.min(px - T, WORLD_W - T - px, py - T, WORLD_H - T - py);
      score += Math.min(8, Math.max(0, edge / T)) * 10;
      for (const o of studentList) {
        if (o === s || !o.alive || o.escaped) continue;
        const d = dxy(px, py, o.x, o.y);
        if (d < 90) score -= (90 - d) * 0.45;
      }
      if (score > bestScore) { bestScore = score; best = { x: px, y: py }; }
    }
  }
  if (!best) {
    const px = clamp(s.x + Math.cos(away) * T * 2.5, T, WORLD_W - T);
    const py = clamp(s.y + Math.sin(away) * T * 2.5, T, WORLD_H - T);
    if (!isSolidTile((px / T) | 0, (py / T) | 0)) best = { x: px, y: py };
  }
  if (!best) return null;

  let flow = null;
  if (!hasLOS(s.x, s.y, best.x, best.y)) {
    const tx = clamp((best.x / T) | 0, 0, COLS - 1), ty = clamp((best.y / T) | 0, 0, ROWS - 1);
    if (!a.escFlow || a.escTX !== tx || a.escTY !== ty) {
      a.escFlow = buildFlowTo(tx, ty);
      a.escTX = tx; a.escTY = ty;
    }
    flow = a.escFlow;
  } else {
    a.escFlow = null; a.escTX = -1; a.escTY = -1;
  }
  a.escX = best.x; a.escY = best.y; a.escFlow = flow;
  a.escT = 0.28 + Math.random() * 0.12;
  return { x: best.x, y: best.y, flow };
}

function pickDetourAngle(s) {
  let best = s.face, bestScore = -1e9;
  for (const off of [-1.45, -0.9, 0.9, 1.45, Math.PI]) {
    const ang = s.face + off;
    const px = s.x + Math.cos(ang) * T * 2.2;
    const py = s.y + Math.sin(ang) * T * 2.2;
    if (px < T * 1.2 || py < T * 1.2 || px > WORLD_W - T * 1.2 || py > WORLD_H - T * 1.2) continue;
    if (isSolidTile((px / T) | 0, (py / T) | 0)) continue;
    const score = openTilesAt(px, py, 2) * 100 +
      (hasLOS(s.x, s.y, px, py) ? 25 : 0) + Math.random() * 6;
    if (score > bestScore) { bestScore = score; best = ang; }
  }
  return best;
}

function aiStudentAbilities(s, threat, td, fleeing, dt) {
  if (threat) {
    if (td < 280) s.sprint = Math.max(s.sprint || 0, 0.45);
    if (s.charId === 'luis') {
      // Primero crea espacio con la onda; si ya esta encima, se gira y usa
      // la regla (la IA no debe gastar el golpe mirando hacia la huida).
      if (td > 100 && td < 270) {
        s.face = Math.atan2(threat.y - s.y, threat.x - s.x);
        useStudentAbility(s, 2);
      } else if (td < 100) {
        s.face = Math.atan2(threat.y - s.y, threat.x - s.x);
        useStudentAbility(s);
      }
    } else if (s.charId === 'morante') {
      if (isNight() && td < 330) useStudentAbility(s);
      if (td < 440) {
        s.face = Math.atan2(threat.y - s.y, threat.x - s.x);
        useStudentAbility(s, 2);
      }
    } else if (s.charId === 'leonardo') {
      if (td < 340) useStudentAbility(s);
    } else if (s.charId === 'jonny') {
      if (td < 360) useStudentAbility(s);
    } else if (s.charId === 'elias') {
      if (td < 270) useStudentAbility(s);
    } else if (s.charId === 'ipa') {
      if (s.hp < s.maxHp * 0.62 && (td > 200 || s.hp < s.maxHp * 0.32)) useStudentAbility(s);
    }
  } else {
    if (s.charId === 'leonardo' && s.auraT <= 0 && Math.random() < dt * 0.2) useStudentAbility(s);
    if (s.charId === 'ipa' && s.hp < s.maxHp * 0.82 && Math.random() < dt * 0.55) useStudentAbility(s);
  }
  if (s.charId === 'elias' && s.hp < s.maxHp * 0.48 && (!threat || td > 190)) useStudentAbility(s);
}

function aiStudent(s, dt) {
  if (s.stun > 0) return;
  const a = s.ai;
  a.t -= dt;
  a.escT = Math.max(0, (a.escT || 0) - dt);
  a.detourT = Math.max(0, (a.detourT || 0) - dt);

  let threat = null, td = 1e9;
  for (const t of teacherList) {
    if (!t.alive || t.hiddenT > 0) continue;
    const d = dist(s, t);
    if (d < 720 && d < td && hasLOS(s.x, s.y, t.x, t.y)) { threat = t; td = d; }
  }
  if (threat) a.lastThreat = threat;
  if (a.lastThreat && (!a.lastThreat.alive || a.lastThreat.hiddenT > 0)) a.lastThreat = null;

  if (threat && td < 660) a.panic = 2.6;
  a.panic = Math.max(0, (a.panic || 0) - dt);
  const fleeing = (threat && td < 660) || a.panic > 0;
  const danger = threat || (a.panic > 0 ? a.lastThreat : null);

  let gx, gy;
  if (fleeing) {
    const esc = chooseStudentEscape(s, danger, a);
    if (esc) {
      if (esc.flow) {
        const st = flowStep(esc.flow, s.x, s.y);
        gx = st.x; gy = st.y;
      } else { gx = esc.x; gy = esc.y; }
    } else if (danger) {
      gx = s.x + Math.cos(Math.atan2(s.y - danger.y, s.x - danger.x)) * 260;
      gy = s.y + Math.sin(Math.atan2(s.y - danger.y, s.x - danger.x)) * 260;
    } else {
      gx = s.x + Math.cos(s.face) * 220;
      gy = s.y + Math.sin(s.face) * 220;
    }
  } else if (a.mission && !a.mission.done) {
    // va a resolver una mision de aula o una tarea de limpieza
    const m = a.mission;
    if (missionType(m) === 'task' && m.aiTask) {
      const next = m.aiTask.spots.find(sp => !sp.got);
      if (next) {
        const dN = Math.hypot(s.x - next.x, s.y - next.y);
        if (dN < 90 || hasLOS(s.x, s.y, next.x, next.y)) { gx = next.x; gy = next.y; }
        else {
          if (!next.flow) next.flow = buildFlowTo((next.x / T) | 0, (next.y / T) | 0);
          const st = flowStep(next.flow, s.x, s.y);
          gx = st.x; gy = st.y;
        }
      } else { gx = m.ax; gy = m.ay; }
    } else {
      const dM = Math.hypot(s.x - m.x, s.y - m.y);
      if (dM < 105) { gx = m.ax; gy = m.ay; }
      else if (hasLOS(s.x, s.y, m.ax, m.ay)) { gx = m.ax; gy = m.ay; }
      else {
        if (!m.flow) m.flow = buildFlowTo((m.ax / T) | 0, (m.ay / T) | 0);
        const st = flowStep(m.flow, s.x, s.y);
        gx = st.x; gy = st.y;
      }
    }
  } else {
    if (a.t <= 0 || Math.hypot(s.x - a.wx, s.y - a.wy) < 26) {
      const w = freeSpot(s.x, s.y, isNight() ? T * 16 : T * 12);
      a.wx = w.x; a.wy = w.y; a.t = isNight() ? rnd(2.6, 5.2) : rnd(1.6, 3.6);
    }
    gx = a.wx; gy = a.wy;
  }

  if (a.detourT > 0) {
    gx = s.x + Math.cos(a.detourAng) * T * 3;
    gy = s.y + Math.sin(a.detourAng) * T * 3;
  }

  let sepX = 0, sepY = 0;
  for (const o of studentList) {
    if (o === s || !o.alive || o.escaped) continue;
    const d = dist(s, o);
    if (d < 52 && d > 0.01) { sepX += (s.x - o.x) / d; sepY += (s.y - o.y) / d; }
  }

  let dx = gx - s.x, dy = gy - s.y;
  const L = Math.hypot(dx, dy) || 1;
  dx = dx / L + sepX * 0.8;
  dy = dy / L + sepY * 0.8;
  const DL = Math.hypot(dx, dy) || 1;
  dx /= DL; dy /= DL;
  s.face = Math.atan2(dy, dx);

  const sp = entitySpeed(s);
  const bx = s.x, by = s.y;
  moveEntity(s, dx * sp * dt, dy * sp * dt);
  if (sp > 1 && Math.hypot(s.x - bx, s.y - by) < sp * dt * 0.4) {
    a.stuck = Math.min(1.2, (a.stuck || 0) + dt * 2.5);
    if (a.stuck > 0.5) {
      a.stuck = 0;
      a.detourAng = pickDetourAngle(s);
      a.detourT = 0.38;
      a.escT = 0;
      if (!fleeing) {
        const w = freeSpot(s.x, s.y, isNight() ? T * 14 : T * 9);
        a.wx = w.x; a.wy = w.y; a.t = rnd(0.7, 1.6);
      }
    }
  } else a.stuck = Math.max(0, (a.stuck || 0) - dt * 2);

  aiStudentAbilities(s, threat, td, fleeing, dt);

  // progreso de la mision de aula o de la tarea (si no le estan persiguiendo)
  if (a.mission && !fleeing) {
    const m = a.mission;
    if (missionType(m) === 'task' && m.aiTask) {
      const next = m.aiTask.spots.find(sp => !sp.got);
      if (next && Math.hypot(s.x - next.x, s.y - next.y) < s.r + next.r + 10) {
        next.got = true;
        m.aiTask.collected++;
        m.progress = m.aiTask.collected;
        addFx({ type: 'ring', x: next.x, y: next.y, r0: 6, r1: 46, dur: 0.38, color: '255,209,102' });
        if (m.aiTask.collected >= missionGoal(m)) solveMissionByAi(m, s);
      }
    } else if (Math.hypot(s.x - m.x, s.y - m.y) < 118) {
      a.solveT = (a.solveT || 0) + dt;
      if (a.solveT >= 4) solveMissionByAi(m, s);
    } else a.solveT = 0;
  } else if (a.mission) a.solveT = 0;
}

/* ---------------------------------------------------------------------------
   IA de profesores
   --------------------------------------------------------------------------- */
const DAY_SPOTS = [[10, 15], [40, 15], [76, 15], [10, 33], [40, 33], [76, 33], [48, 49], [10, 49], [80, 49], [94, 25], [2, 25]];
const NIGHT_SPOTS = [[20, 55], [40, 58], [64, 56], [80, 58], [10, 58], [48, 62], [70, 62], [86, 52]];   // rondas nocturnas por el patio

function teacherFacing(t, s, tol) {
  const ang = Math.atan2(s.y - t.y, s.x - t.x);
  return Math.abs(normAng(ang - t.face)) < (tol || 1.3);
}

/* Punto de intercepcion: los profesores no persiguen la espalda exacta del
   alumno, sino que se adelantan un poco y, entre varios, abren un pequeno
   abanico para intentar rodearlo. */
function teacherAimPoint(t, s) {
  const d = dist(t, s);
  const f = s.face || 0;
  const lead = Math.min(38, d * 0.12);
  const mains = teacherList.filter(o => !o.summon && o.alive);
  const idx = Math.max(0, mains.indexOf(t));
  const side = (idx - 1) * Math.min(38, d * 0.12);
  let x = s.x + Math.cos(f) * lead + Math.cos(f + Math.PI / 2) * side;
  let y = s.y + Math.sin(f) * lead + Math.sin(f + Math.PI / 2) * side;
  if (x < T * 1.2 || y < T * 1.2 || x > WORLD_W - T * 1.2 || y > WORLD_H - T * 1.2) {
    return { x: s.x, y: s.y };
  }
  if (isSolidTile((x / T) | 0, (y / T) | 0)) return { x: s.x, y: s.y };
  if (!hasLOS(t.x, t.y, x, y)) return { x: s.x, y: s.y };
  return { x, y };
}

function teacherPathStep(t, gx, gy, dt) {
  if (hasLOS(t.x, t.y, gx, gy)) return { x: gx, y: gy };
  const tx = clamp((gx / T) | 0, 0, COLS - 1), ty = clamp((gy / T) | 0, 0, ROWS - 1);
  t.pathT -= dt;
  if (!t.pathFlow || t.pathT <= 0 || t.pathTX !== tx || t.pathTY !== ty) {
    t.pathFlow = buildFlowTo(tx, ty);
    t.pathTX = tx; t.pathTY = ty; t.pathT = 0.45;
  }
  return flowStep(t.pathFlow, t.x, t.y);
}

function chargeLaneClear(t, ang, len) {
  const ex = clamp(t.x + Math.cos(ang) * len, T * 1.2, WORLD_W - T * 1.2);
  const ey = clamp(t.y + Math.sin(ang) * len, T * 1.2, WORLD_H - T * 1.2);
  return hasLOS(t.x, t.y, ex, ey);
}

function aiTeacher(t, dt) {
  if (t.retreatT > 0) {
    t.face = t.retreatAng;
    const sp = entitySpeed(t);
    moveEntity(t, Math.cos(t.retreatAng) * sp * dt, Math.sin(t.retreatAng) * sp * dt);
    return;
  }
  if (t.summon) { updateSummonAI(t, dt); return; }
  if ((t.talkT > 0 && t.teacherId !== 'ovidio') || t.combT > 0 || t.chargeT > 0) return;
  const a = t.ai;
  const sight = isNight() ? 440 : 560;

  if (t.target && (!t.target.alive || t.target.escaped)) {
    t.target = null;
    t.lost = 99;
  }

  // Elige presa con memoria: mantener un objetivo visible evita que los tres
  // profesores cambien de alumno cada frame. Tambien pesa la vida baja y la
  // ventaja de no amontonarse sobre la misma persona.
  let best = null, bd = 1e9;
  for (const s of studentList) {
    if (!s.alive || s.escaped || s.invis > 0) continue;
    const d = dist(s, t);
    if (d > sight) continue;
    if (!(s.revealed > 0 || hasLOS(t.x, t.y, s.x, s.y))) continue;
    const claimed = teacherList.some(o => o !== t && !o.summon && o.alive && o.target === s);
    let score = d + (claimed ? 210 : 0);
    score += (s.hp / s.maxHp) * 55;
    if (s === t.target) score -= 120;
    if (s.revealed > 0) score -= 35;
    if (s.luisFastT > 0) score += 18;
    if (score < bd) { bd = score; best = s; }
  }
  if (best) {
    t.target = best;
    t.lost = 0;
    t.lastX = best.x;
    t.lastY = best.y;
  } else {
    t.lost = (t.lost || 0) + dt;
    // Si acaba de perderlo, mantiene la presa solo para ir a su ultima
    // posicion conocida; no la persigue a traves de las paredes.
    if (t.target && t.lost > 2.2) t.target = null;
  }

  const visibleTarget = !!(t.target && t.lost < 0.05);
  let gx, gy;
  if (visibleTarget) {
    const aim = teacherAimPoint(t, t.target);
    const st = teacherPathStep(t, aim.x, aim.y, dt);
    gx = st.x; gy = st.y;
  } else if (t.lastX !== undefined && t.lost < 4.2) {
    const st = teacherPathStep(t, t.lastX, t.lastY, dt);
    gx = st.x; gy = st.y;
  } else {
    // rondas: pasillos y aulas de dia, patio de noche
    a.t -= dt;
    if (a.patrolNight !== isNight()) { a.patrolNight = isNight(); a.pi = -1; a.t = 0; }
    const spots = isNight() ? NIGHT_SPOTS : DAY_SPOTS;
    const reached = Math.hypot(t.x - a.wx, t.y - a.wy) < 55;
    if (a.pi === undefined || a.pi < 0 || a.t <= 0 || reached) {
      const base = (a.pi === undefined || a.pi < 0) ? Math.max(0, teacherList.indexOf(t)) : a.pi + 1;
      a.pi = base % spots.length;
      const g = spots[a.pi];
      a.wx = g[0] * T + T / 2;
      a.wy = g[1] * T + T / 2;
      a.t = rnd(9, 14);
    }
    if (hasLOS(t.x, t.y, a.wx, a.wy)) { gx = a.wx; gy = a.wy; }
    else {
      const st = flowStep(patrolFlow(a.pi), t.x, t.y);
      gx = st.x; gy = st.y;
    }
  }

  let sepX = 0, sepY = 0;
  for (const o of teacherList) {
    if (o === t || !o.alive) continue;
    const d = dist(t, o);
    if (d < 82 && d > 0.01) { sepX += (t.x - o.x) / d; sepY += (t.y - o.y) / d; }
  }

  let dx = gx - t.x, dy = gy - t.y;
  const L = Math.hypot(dx, dy) || 1;
  dx = dx / L + sepX * 0.8;
  dy = dy / L + sepY * 0.8;
  const DL = Math.hypot(dx, dy) || 1;
  dx /= DL; dy /= DL;
  t.face = Math.atan2(dy, dx);
  if (visibleTarget && dist(t, t.target) < 210) {
    const aimAng = Math.atan2(t.target.y - t.y, t.target.x - t.x);
    t.face += normAng(aimAng - t.face) * 0.7;
  }

  const sp = entitySpeed(t);
  moveEntity(t, dx * sp * dt, dy * sp * dt);

  if (!visibleTarget) return;
  // Puede recordar/ver la marca de un examen a través de una pared, pero no
  // atacar a través de ella: primero tiene que llegar a una línea de visión.
  if (!hasLOS(t.x, t.y, t.target.x, t.target.y)) return;
  const d = dist(t, t.target);
  const facing = teacherFacing(t, t.target, 1.35);
  if (t.teacherId === 'jose') {
    if (d < 96 && facing) useTeacherAbility(t, 0);
    if (d > 55 && d < 380 && !t.buffNext && t.cds[1] <= 0 && Math.random() < dt * 0.9) useTeacherAbility(t, 1);
    if (d > 90 && d < 560 && t.cds[2] <= 0 && !exams.some(e => e.owner === t) && Math.random() < dt * 0.5) useTeacherAbility(t, 2);
  } else if (t.teacherId === 'ovidio') {
    // Grito a distancia: no necesita estar pegado al alumno.
    if (d < 540 && t.cds[0] <= 0 && Math.random() < dt * 1.15) useTeacherAbility(t, 0);
    // El intercambio busca al compañero mejor colocado para plantar el aura
    // negra cerca de los estudiantes; tambien sirve para escapar si esta malherido.
    if (t.cds[1] <= 0) {
      const partner = ovidioSwapPartner(t);
      if (partner) {
        const pd = nearestStudentDistance(partner.x, partner.y);
        const md = nearestStudentDistance(t.x, t.y);
        if ((pd < md - 55 || t.hp < t.maxHp * 0.55) && Math.random() < dt * 0.7) useTeacherAbility(t, 1);
      }
    }
    if (t.cds[2] <= 0 && (t.hp < t.maxHp * 0.62 || d < 260) && Math.random() < dt * 0.6) useTeacherAbility(t, 2);
  } else if (t.teacherId === 'segundo') {
    if (d < 116 && facing) useTeacherAbility(t, 0);
    const active = summonsOf(t);
    if (t.cds[1] <= 0 && active.length < 2 && (active.length === 0 || active.length === 1 || d > 230) && Math.random() < dt * 0.55) {
      useTeacherAbility(t, 1);
    }
    if (d > 145 && d < 430 && t.cds[2] <= 0) {
      const aim = Math.abs(normAng(Math.atan2(t.target.y - t.y, t.target.x - t.x) - t.face));
      if (aim < 0.42 && chargeLaneClear(t, t.face, Math.min(440, d + 110))) useTeacherAbility(t, 2);
    }
  }
}

/* ---------------------------------------------------------------------------
   Jugador
   --------------------------------------------------------------------------- */
function keyDown() {
  for (let i = 0; i < arguments.length; i++) if (keys[arguments[i]]) return true;
  return false;
}

function updatePlayer(dt) {
  if (!player || !player.alive) return;
  if (S.quiz) return;                     // estas respondiendo la mision
  if (player.kind === 'teacher' && player.retreatT > 0) {
    const sp = entitySpeed(player);
    moveEntity(player, Math.cos(player.retreatAng) * sp * dt, Math.sin(player.retreatAng) * sp * dt);
    return;
  }
  let dx = 0, dy = 0;
  if (keyDown('ArrowLeft', 'a', 'A')) dx -= 1;
  if (keyDown('ArrowRight', 'd', 'D')) dx += 1;
  if (keyDown('ArrowUp', 'w', 'W')) dy -= 1;
  if (keyDown('ArrowDown', 's', 'S')) dy += 1;
  const L = Math.hypot(dx, dy) || 1;
  if (dx || dy) player.face = Math.atan2(dy, dx);
  const sp = entitySpeed(player);
  moveEntity(player, (dx / L) * sp * dt, (dy / L) * sp * dt);

  if (player.kind === 'student') {
    if (keyDown(' ')) useStudentAbility(player);
    if (keyDown('q', 'Q')) useStudentAbility(player, 2);
  } else {
    if (keyDown('1')) useTeacherAbility(player, 0);
    if (keyDown('2')) useTeacherAbility(player, 1);
    if (keyDown('3')) useTeacherAbility(player, 2);
    if (keyDown(' ')) useTeacherAbility(player, 0);
  }
}

/* ---------------------------------------------------------------------------
   Examenes, proyectiles y efectos
   --------------------------------------------------------------------------- */
function updateExams(dt) {
  for (let i = exams.length - 1; i >= 0; i--) {
    const ex = exams[i];
    ex.life -= dt;
    if (!ex.target || !ex.target.alive || ex.target.escaped) {
      let best = null, bd = 1e9;
      for (const s of studentList) {
        if (!s.alive || s.escaped) continue;
        const d = dist(ex, s);
        if (d < bd) { bd = d; best = s; }
      }
      ex.target = best;
    }
    if (!ex.target) { exams.splice(i, 1); continue; }
    const ang = Math.atan2(ex.target.y - ex.y, ex.target.x - ex.x);
    ex.face = ang;
    const d = dist(ex, ex.target);
    const step = ex.speed * dt;
    ex.x += Math.cos(ang) * step;
    ex.y += Math.sin(ang) * step;
    if (d < ex.target.r + ex.r + 2) {
      hurtStudent(ex.target, 10, ex.owner, { reveal: 8 });
      addFx({ type: 'ring', x: ex.x, y: ex.y, r0: 4, r1: 60, dur: 0.4, color: '255,255,180' });
      log('Examen sorpresa: ' + ex.target.name + ' recibe 10 y queda revelado', '#ffe08a');
      exams.splice(i, 1);
      continue;
    }
    if (ex.life <= 0) {
      addFx({ type: 'ring', x: ex.x, y: ex.y, r0: 4, r1: 40, dur: 0.35, color: '255,255,180' });
      exams.splice(i, 1);
    }
  }
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    let dead = p.life <= 0;
    if (isSolidTile((p.x / T) | 0, (p.y / T) | 0)) {
      dead = true;
      addFx({ type: 'ring', x: p.x, y: p.y, r0: 2, r1: 26, dur: 0.3, color: '220,220,220' });
    }
    if (p.kind === 'shout' && !dead && Math.random() < dt * 26) {
      addFx({ type: 'ring', x: p.x - p.vx * dt * 0.35, y: p.y - p.vy * dt * 0.35, r0: 3, r1: 24, dur: 0.28, color: '255,95,130' });
    }
    if (!dead) {
      for (const s of studentList) {
        if (!s.alive || s.escaped) continue;
        if (dist(p, s) < p.r + s.r + 2) {
          hurtStudent(s, p.dmg, p.owner, {
            knock: p.knock === undefined ? 14 : p.knock,
            from: p.owner,
            reveal: p.reveal === undefined ? 3 : p.reveal,
            melee: p.kind === 'shout' ? false : p.r > 8
          });
          if (p.kind === 'shout') {
            addFx({ type: 'ring', x: p.x, y: p.y, r0: 8, r1: 82, dur: 0.45, color: '255,95,130' });
            shake(4);
          }
          dead = true;
          break;
        }
      }
    }
    if (dead) projectiles.splice(i, 1);
  }
}

function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) { fx[i].t -= dt; if (fx[i].t <= 0) fx.splice(i, 1); }
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    t.t -= dt; t.y += t.vy * dt; t.vy *= 0.92;
    if (t.t <= 0) texts.splice(i, 1);
  }
}

/* ---------------------------------------------------------------------------
   MISIONES DE CLASE
   --------------------------------------------------------------------------- */
function missionTimeBonus(m) {
  return Math.max(0, Number.isFinite(m && m.timeBonus) ? m.timeBonus : MISSION_BONUS);
}

function missionType(m) {
  return m && m.type === 'task' ? 'task' : 'quiz';
}

function missionGoal(m) {
  if (missionType(m) === 'task') return Math.max(1, m.goal || 5);
  return m.questions ? m.questions.length : 5;
}

function missionProgress(m) {
  return missionType(m) === 'task' ? (m.progress || 0) : (m.correct || 0);
}

function addMissionTime(sec, text) {
  if (sec <= 0) return;
  S.timeBonus += sec;
  S.timeSaved += sec;
  S.timeLeft = Math.max(0, MATCH_TIME - S.elapsed - S.timeBonus);
  S.timeFlash = 1.6;
  log(text, '#8bf1a6');
  if (player && player.alive) {
    damageText(player.x, player.y - 42, '−' + sec + ' s', '#8bf1a6');
    addFx({ type: 'ring', x: player.x, y: player.y, r0: 10, r1: 90, dur: 0.5, color: '140,240,170' });
  }
}

function nearMission() {
  if (S.phase !== 'playing' || S.quiz) return null;
  if (!player || !player.alive || player.kind !== 'student') return null;
  // Durante una tarea solo se puede interactuar con su terminal para cancelarla.
  if (S.task) {
    const tm = S.task.m;
    return Math.hypot(player.x - tm.x, player.y - tm.y) < 128 ? tm : null;
  }
  let best = null, bd = 1e9;
  for (const m of MISSIONS) {
    if (m.done) continue;
    const d = Math.hypot(player.x - m.x, player.y - m.y);
    if (d < 128 && d < bd) { bd = d; best = m; }
  }
  return best;
}

function openMission(m) {
  if (S.phase !== 'playing' || S.role !== 'student') return;
  if (!player || !player.alive || player.kind !== 'student') return;
  if (!m || m.done) return;
  if (S.task) {
    if (S.task.m === m) cancelTaskMission('Tarea cancelada. Puedes volver a intentarlo cuando quieras.');
    else log('Termina la tarea actual antes de empezar otra.', '#ffd166');
    return;
  }
  if (missionType(m) === 'task') {
    startTaskMission(m);
    return;
  }
  S.quiz = { m, locked: false };
  renderMission();
  showScreen('screen-mission');
  last = performance.now();
}

/* Tareas de limpieza: aparecen objetos por la sala, hay que recogerlos antes
   de que acabe el tiempo y se paga al completar la tarea. */
function createTaskSpots(m) {
  const room = ROOMS[m.roomIdx];
  const goal = missionGoal(m);
  const cx = (room.x + room.w / 2) * T;
  const cy = (room.y + room.h / 2) * T;
  const radius = Math.min(room.w, room.h) * T * 0.36;
  const spots = [];
  for (let i = 0; i < goal; i++) {
    let spot = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const cand = freeSpot(cx, cy, radius);
      const tx = Math.floor(cand.x / T), ty = Math.floor(cand.y / T);
      if (tx <= room.x || tx >= room.x + room.w - 1 || ty <= room.y || ty >= room.y + room.h - 1) continue;
      if (MISSIONS.some(mm => Math.hypot(mm.x - cand.x, mm.y - cand.y) < T * 1.3)) continue;
      if (spots.some(p => Math.hypot(p.x - cand.x, p.y - cand.y) < T * 1.25)) continue;
      if (examPapers.some(p => Math.hypot(p.x - cand.x, p.y - cand.y) < T * 0.9)) continue;
      spot = cand;
      break;
    }
    if (!spot) {
      // Reserva: busca cualquier tile libre dentro de la sala.
      for (let ty = room.y + 1; ty < room.y + room.h - 1 && !spot; ty++) {
        for (let tx = room.x + 1; tx < room.x + room.w - 1 && !spot; tx++) {
          if (isSolidTile(tx, ty)) continue;
          const cand = { x: tx * T + T / 2, y: ty * T + T / 2 };
          if (spots.some(p => Math.hypot(p.x - cand.x, p.y - cand.y) < T * 1.05)) continue;
          spot = cand;
        }
      }
    }
    if (!spot) spot = { x: cx, y: cy };
    spots.push({ x: spot.x, y: spot.y, r: 20, kind: m.taskKind, got: false, seed: rnd(0, TAU) });
  }
  return spots;
}

function startTaskMission(m) {
  if (S.task || !m || m.done) return;
  const goal = missionGoal(m);
  const spots = createTaskSpots(m);
  m.progress = 0;
  S.task = {
    m, spots, collected: 0,
    timeLeft: m.taskTime || 50,
    startElapsed: S.elapsed
  };
  banner('¡TAREA DE LIMPIEZA!', m.subject + ': recoge ' + goal + ' objetos por la sala.', 3.2);
  log('Tarea iniciada: ' + m.subject + '. Recoge ' + goal + ' objetos.', '#ffd166');
}

/* Una IA también puede limpiar: recorre los mismos objetos y completa la tarea
   si nadie la interrumpe. Solo ocurre cuando el jugador es profesor, igual que
   las misiones de aula de las IA. */
function startAiTask(m, s) {
  if (!m || m.done || m.aiTask) return;
  m.progress = 0;
  m.aiTask = { runner: s, spots: createTaskSpots(m), collected: 0 };
}

function cancelTaskMission(reason) {
  const task = S.task;
  if (!task) return;
  S.task = null;
  task.m.progress = 0;
  if (reason) {
    log(reason, '#ff8f8f');
    banner('TAREA CANCELADA', reason, 2.6);
  }
}

function completeTaskMission() {
  const task = S.task;
  if (!task) return;
  const m = task.m;
  const goal = missionGoal(m);
  const elapsed = S.elapsed - task.startElapsed;
  const fast = elapsed <= (m.fastTime || 25);
  const total = (m.rewardPer || 2) * goal + (m.rewardComplete || 10) + (fast ? (m.rewardFast || 10) : 0);
  S.task = null;
  m.done = true;
  m.progress = goal;
  grantExamPoints((m.rewardPer || 2) * goal, 'Tarea: ' + m.subject);
  grantExamPoints(m.rewardComplete || 10, 'Tarea completada');
  if (fast) grantExamPoints(m.rewardFast || 10, 'Limpieza rápida');
  grantFirstMissionBonus();
  addFx({ type: 'ring', x: m.x, y: m.y, r0: 20, r1: 210, dur: 0.7, color: '255,209,102' });
  banner('¡TAREA COMPLETADA!', m.subject + ': +' + total + ' puntos de examen', 3.2);
  log('¡' + m.subject + ' completada! +' + total + ' puntos de examen.', '#8bf1a6');
}

function updateTaskMission(dt) {
  if (!S.task) return;
  if (S.phase !== 'playing' || !player || !player.alive) {
    cancelTaskMission('Tarea cancelada: no puedes continuar.');
    return;
  }
  S.task.timeLeft = Math.max(0, S.task.timeLeft - dt);
  if (S.task.timeLeft <= 0) {
    cancelTaskMission('Tarea fallida: se acabó el tiempo.');
    return;
  }
  const m = S.task.m;
  const goal = missionGoal(m);
  for (const sp of S.task.spots) {
    if (sp.got) continue;
    if (Math.hypot(player.x - sp.x, player.y - sp.y) > player.r + sp.r + 8) continue;
    sp.got = true;
    S.task.collected++;
    m.progress = S.task.collected;
    addFx({ type: 'ring', x: sp.x, y: sp.y, r0: 6, r1: 46, dur: 0.38, color: '255,209,102' });
    damageText(player.x, player.y - 48, '¡Recogido!', '#ffe08a');
    log('Limpieza: ' + S.task.collected + '/' + goal, '#ffd166');
    if (S.task.collected >= goal) {
      completeTaskMission();
      return;
    }
  }
}

function renderMission() {
  const q = S.quiz;
  if (!q) return;
  const m = q.m;
  const room = ROOMS[m.roomIdx];
  const dotsBox = $('quiz-dots');
  const opts = $('quiz-options');
  const fb = $('quiz-feedback');
  const total = m.questions.length;
  const bonus = missionTimeBonus(m);

  q.locked = false;
  $('quiz-badge').textContent = m.short;
  $('quiz-badge').style.setProperty('--qc', m.color);
  $('quiz-title').textContent = 'MISIÓN DE ' + m.subject.toUpperCase() + (bonus > 0 ? '' : ' · REFUERZO');
  $('quiz-room').textContent = room.name + ' · ' + total + ' preguntas · ' + (bonus > 0 ? 'TIEMPO' : 'PUNTOS');

  dotsBox.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const d = document.createElement('i');
    if (i < m.index) d.className = 'ok';
    else if (i === m.index) d.className = 'on';
    dotsBox.appendChild(d);
  }
  fb.textContent = '';
  fb.className = 'quiz-feedback';
  opts.innerHTML = '';

  if (m.index >= total) {
    // resultado final de la mision
    $('quiz-question').textContent = m.correct === total ? '¡Perfecto! Has acertado todo' : 'Misión terminada';
    $('quiz-progress').style.width = '100%';
    const perfectBonus = m.correct === total ? 12 : 0;
    const earned = m.correct * 3 + 8 + perfectBonus;
    const res = document.createElement('div');
    res.className = 'quiz-result';
    res.innerHTML =
      '<div class="row"><span>Aciertos</span><b>' + m.correct + ' / ' + total + '</b></div>' +
      '<div class="row"><span>' + (bonus > 0 ? 'Tiempo recortado' : 'Reloj') + '</span><b>' +
        (bonus > 0 ? '−' + (m.correct * bonus) + ' s' : 'Sin cambios') + '</b></div>' +
      (perfectBonus ? '<div class="row"><span>Bonus misión perfecta</span><b>+' + perfectBonus + ' pts</b></div>' : '') +
      '<div class="row"><span>Puntos de la misión</span><b>+' + earned + ' pts</b></div>' +
      '<div class="row"><span>Estado</span><b>COMPLETADA</b></div>';
    opts.appendChild(res);
    const b = document.createElement('button');
    b.className = 'quiz-next';
    b.textContent = 'VOLVER AL COLEGIO';
    b.onclick = closeMission;
    opts.appendChild(b);
    $('quiz-hint').textContent = 'Los profesores siguen buscando: ¡vuelve al patio!';
    return;
  }

  const item = m.questions[m.index];
  $('quiz-question').textContent = item.q;
  $('quiz-progress').style.width = (m.index / total * 100) + '%';
  item.opts.forEach((txt, i) => {
    const b = document.createElement('button');
    b.className = 'quiz-opt';
    b.type = 'button';
    const num = document.createElement('b');
    num.textContent = String(i + 1);
    const span = document.createElement('span');
    span.textContent = txt;
    b.appendChild(num); b.appendChild(span);
    b.onclick = () => answerMission(i);
    opts.appendChild(b);
  });
  $('quiz-hint').innerHTML = bonus > 0
    ? 'Cada acierto resta <b>' + bonus + ' s</b> al reloj. ¡La partida sigue!'
    : 'Misión de refuerzo: cada acierto da puntos y <b>no toca el reloj</b>. ¡La partida sigue!';
}

function answerMission(idx) {
  const q = S.quiz;
  if (!q || q.locked) return;
  const m = q.m;
  const item = m.questions[m.index];
  if (!item) return;
  const correct = idx === item.a;
  q.locked = true;
  if (correct) {
    m.correct++;
    S.answerStreak = (S.answerStreak || 0) + 1;
    S.bestStreak = Math.max(S.bestStreak || 0, S.answerStreak);
    grantExamPoints(3, 'Respuesta correcta');
    if (S.answerStreak % STREAK_STEP === 0) {
      grantExamPoints(STREAK_POINTS, 'Racha de ' + STREAK_STEP + ' aciertos');
      if (player && player.alive) {
        damageText(player.x, player.y - 52, '+' + STREAK_POINTS + ' pts de racha', '#ffe08a');
      }
      log('Racha de ' + S.answerStreak + ' aciertos seguidos: +' + STREAK_POINTS + ' puntos de examen.', '#ffd166');
    }
  } else {
    S.answerStreak = 0;
  }
  m.index++;
  if (m.index >= m.questions.length) {
    m.done = true; m.runner = null;
    grantExamPoints(8, 'Misión completada');
    if (m.correct === m.questions.length) {
      grantExamPoints(12, 'Misión perfecta');
    }
    grantFirstMissionBonus();
  }

  const btns = $('quiz-options').children;
  for (let i = 0; i < btns.length; i++) {
    btns[i].classList.add('locked');
    btns[i].disabled = true;
    if (i === item.a) btns[i].classList.add('good');
    else if (i === idx) btns[i].classList.add('bad');
  }
  const fb = $('quiz-feedback');
  const bonus = missionTimeBonus(m);
  if (correct) {
    if (bonus > 0) {
      addMissionTime(bonus, '¡Correcto! ' + m.subject + ': −' + bonus + ' s del reloj');
    } else {
      log('¡Correcto! ' + m.subject + ': +3 pts (misión de refuerzo, sin tocar el reloj).', '#8bf1a6');
    }
    fb.className = 'quiz-feedback good';
    fb.textContent = '¡Bien! ' + item.why + (bonus > 0
      ? '  (−' + bonus + ' s · +3 pts de examen)'
      : '  (+3 pts de examen · misión de refuerzo)');
  } else {
    fb.className = 'quiz-feedback bad';
    fb.textContent = 'Casi. La respuesta correcta es «' + item.opts[item.a] + '». ' + item.why;
  }
  $('quiz-progress').style.width = (m.index / m.questions.length * 100) + '%';
  const dots = $('quiz-dots').children;
  if (dots[m.index - 1]) dots[m.index - 1].className = correct ? 'ok' : 'bad';

  const next = document.createElement('button');
  next.className = 'quiz-next';
  next.type = 'button';
  next.textContent = m.index >= m.questions.length ? 'VER RESULTADO' : 'SIGUIENTE PREGUNTA';
  next.onclick = nextMission;
  $('quiz-options').appendChild(next);
}

function nextMission() {
  if (!S.quiz || !S.quiz.locked) return;
  renderMission();
  const q = $('quiz-question');
  if (q && q.scrollIntoView) q.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function closeMission() {
  if (!S.quiz) return;
  S.quiz = null;
  for (const k in keys) keys[k] = false;
  const el = $('screen-mission');
  if (el && !el.classList.contains('hidden')) showScreen(null);
  last = performance.now();
}

/* Las IA de los estudiantes resuelven misiones cuando TU eres profesor:
   tienes que defender las aulas o el reloj se desploma. */
function updateAiMissions(dt) {
  if (S.role !== 'teacher') return;
  for (const m of MISSIONS) {
    if (m.runner && (!m.runner.alive || m.runner.escaped || m.done)) {
      const runner = m.runner;
      const defended = !m.done && (!runner.alive || runner.escaped);
      if (runner.ai) { runner.ai.mission = null; runner.ai.solveT = 0; }
      if (m.aiTask) { m.aiTask = null; m.progress = 0; }
      m.runner = null;
      if (defended) {
        grantExamPoints(DEFENDED_MISSION_POINTS, 'Misión defendida');
        log('+' + DEFENDED_MISSION_POINTS + ' puntos de examen por defender el aula de ' + m.subject + '.', '#ffd166');
      }
    }
  }
  S.aiMissionTimer -= dt;
  if (S.aiMissionTimer > 0) return;
  S.aiMissionTimer = rnd(16, 24);
  if (MISSIONS.some(m => m.runner)) return;
  const free = MISSIONS.filter(m => !m.done && (!S.task || S.task.m !== m));
  if (!free.length) return;
  const cands = studentList.filter(s => s.alive && !s.escaped && !s.isPlayer && !s.ai.mission);
  if (!cands.length) return;
  let best = null, bm = null, bd = 1e9;
  for (const s of cands) {
    for (const m of free) {
      const d = Math.hypot(s.x - m.x, s.y - m.y);
      if (d < bd) { bd = d; best = s; bm = m; }
    }
  }
  if (!best || !bm) return;
  best.ai.mission = bm;
  best.ai.solveT = 0;
  bm.runner = best;
  if (missionType(bm) === 'task') {
    startAiTask(bm, best);
    log(best.name + ' corre a limpiar ' + bm.subject + '. ¡Interrúmpelo!', '#ffd166');
  } else {
    log(best.name + ' corre a la misión de ' + bm.subject + '. ¡Defiende el aula!', '#ffd166');
  }
}

function solveMissionByAi(m, s) {
  const wasTask = missionType(m) === 'task';
  m.done = true;
  m.runner = null;
  s.ai.mission = null;
  s.ai.solveT = 0;
  if (m.aiTask) { m.aiTask = null; m.progress = missionGoal(m); }
  addFx({ type: 'ring', x: m.x, y: m.y, r0: 20, r1: 160, dur: 0.6, color: '255,209,102' });
  if (wasTask) {
    log(s.name + ' completó la tarea de ' + m.subject + '.', '#ffd166');
    return;
  }
  const bonus = missionTimeBonus(m);
  if (bonus > 0) {
    addMissionTime(bonus, s.name + ' resolvió la misión de ' + m.subject + ': −' + bonus + ' s');
  } else {
    log(s.name + ' resolvió la misión de refuerzo de ' + m.subject + '.', '#ffd166');
  }
}

/* ---------------------------------------------------------------------------
   Fin de partida y comprobaciones
   --------------------------------------------------------------------------- */
function checkEnd() {
  if (S.phase !== 'playing') return;
  const teachersAlive = teacherList.filter(t => t.alive && !t.summon).length;
  if (teachersAlive === 0) return endMatch('student', '¡LOS ESTUDIANTES GANAN!', 'Noqueasteis a los 3 profesores.');
  if (studentList.every(s => !s.alive)) {
    return endMatch('teacher', S.role === 'teacher' ? '¡VICTORIA!' : 'DERROTA', 'Eliminasteis a los 7 estudiantes antes del final.');
  }
}

function fmtTime(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function endMatch(winner, title, why) {
  if (S.phase === 'end') return;
  S.phase = 'end';
  S.chaseMusic = null;
  if (typeof ChaseMusic !== 'undefined') ChaseMusic.stop();
  S.winner = winner;
  if (S.quiz) closeMission();
  if (S.task) cancelTaskMission();
  const won = winner === S.role;
  const doneMissions = MISSIONS.filter(m => m.done).length;

  // Recompensas de la partida: la victoria, los supervivientes y los bonus de
  // rendimiento se pagan al terminar; misiones, apuntes y noqueos ya se pagaron
  // en vivo.
  if (won) {
    grantExamPoints(S.role === 'teacher' ? 55 : 40, S.role === 'teacher' ? 'Victoria como profesor' : 'Victoria como estudiante');
  }
  if (won && S.role === 'student') {
    const survivors = studentList.filter(s => s.alive && !s.escaped).length;
    if (survivors > 0) grantExamPoints(survivors * 4, 'Supervivientes en pie');
    if (S.downStudents === 0) grantExamPoints(20, 'Victoria impecable');
    const resistance = Math.floor(S.elapsed / 60);
    if (resistance > 0) grantExamPoints(resistance, 'Resistencia');
  }
  if (won && S.role === 'teacher' && S.downTeachers === 0) {
    grantExamPoints(15, 'Sin bajas docentes');
  }
  if (S.role === 'student' && doneMissions === MISSIONS.length) {
    grantExamPoints(ALL_MISSIONS_BONUS, 'Todas las misiones y tareas');
  }
  grantDailyBonuses(won);
  progress.matches = (progress.matches || 0) + 1;
  if (won) progress.wins = (progress.wins || 0) + 1;
  saveProgress();
  refreshPointsUI();

  const el = document.getElementById('end-title');
  el.textContent = title;
  el.className = won ? 'win' : 'lose';
  document.getElementById('end-reason').textContent = why;
  document.getElementById('end-stats').innerHTML =
    '<div class="stat"><b>' + (won ? 'VICTORIA' : 'DERROTA') + '</b><span>Resultado</span></div>' +
    '<div class="stat"><b>' + fmtTime(MATCH_TIME - S.timeLeft) + '</b><span>Duracion</span></div>' +
    '<div class="stat"><b>' + Math.round(S.stats.dmg) + '</b><span>Dano causado</span></div>' +
    '<div class="stat"><b>' + studentList.filter(s => s.alive).length + ' / ' + studentList.length + '</b><span>Estudiantes en pie</span></div>' +
    '<div class="stat"><b>' + S.downStudents + '</b><span>Estudiantes eliminados</span></div>' +
    '<div class="stat"><b>' + S.downTeachers + '</b><span>Profesores noqueados</span></div>' +
    '<div class="stat"><b>' + doneMissions + ' / ' + MISSIONS.length + '</b><span>Misiones resueltas</span></div>' +
    '<div class="stat"><b>−' + fmtTime(Math.round(S.timeSaved)) + '</b><span>Tiempo recortado</span></div>';

  const reward = document.getElementById('end-reward');
  if (reward) {
    const rows = S.examBreakdown.map(x =>
      '<div class="reward-row"><span>' + x.label + '</span><b>+' + x.n + '</b></div>'
    ).join('');
    reward.innerHTML =
      '<div class="reward-head"><span>PUNTOS DE EXAMEN GANADOS</span><b>+' + S.examEarned + '</b></div>' +
      (rows ? '<div class="reward-list">' + rows + '</div>' : '<p class="reward-empty">Esta partida no dejó puntos. Recoge apuntes, haz misiones, noquea profesores, gana o reprueba estudiantes para conseguir trajes.</p>') +
      '<div class="reward-total">Saldo actual: <b>' + progress.points + ' pts</b></div>';
  }

  startEndCelebration(winner);
  showScreen('screen-end');
}

/* ---------------------------------------------------------------------------
   Celebración de los profesores al ganar la partida
   --------------------------------------------------------------------------- */
function startEndCelebration(winner) {
  const cv = endCelebrationCv;
  if (!cv) return;
  if (winner !== 'teacher' && winner !== 'student') {
    cv.classList.remove('on', 'student-party');
    endCelebration = null;
    endCelebrationCtx.setTransform(1, 0, 0, 1, 0, 0);
    endCelebrationCtx.clearRect(0, 0, cv.width, cv.height);
    return;
  }
  const isTeacher = winner === 'teacher';
  cv.classList.toggle('student-party', !isTeacher);
  let cast;
  if (isTeacher) {
    cast = teacherList.filter(t => !t.summon && t.alive);
    if (!cast.length) cast = teacherList.filter(t => !t.summon);
    if (!cast.length) {
      cast = TEACHER_IDS.map(id => ({
        teacherId: id, char: TEACHERS[id], name: TEACHERS[id].name,
        look: TEACHERS[id].look, blinkSeed: 0
      }));
    }
    cast = cast.slice(0, 3);
  } else {
    // Solo celebran los que siguen en pie al terminar la partida. Si una
    // partida antigua conserva alumnos “escapados”, también cuentan como
    // supervivientes; y si no queda ninguno, mostramos el roster completo
    // para que la animación nunca se quede vacía.
    cast = studentList.filter(s => s.alive && !s.escaped);
    if (!cast.length) cast = studentList.filter(s => s.alive);
    if (!cast.length) cast = studentList.slice();
    if (!cast.length) {
      cast = STUDENT_IDS.map(id => ({
        charId: id, char: STUDENTS[id], name: STUDENTS[id].name,
        look: STUDENTS[id].look, blinkSeed: 0
      }));
    }
    cast = cast.slice(0, 8);
  }
  const colors = isTeacher
    ? ['#ffd166', '#7ee787', '#8fd0ff', '#c58cff', '#ff8fb0', '#f7f2da']
    : ['#7ee787', '#ffd166', '#8fd0ff', '#ff8fb0', '#54dcc9', '#f7f2da'];
  const parts = [];
  for (let i = 0; i < 110; i++) {
    parts.push({
      x: rnd(0, cv.width), y: rnd(-cv.height, cv.height),
      vx: rnd(-22, 22), vy: rnd(18, 72),
      size: rnd(3, 7.5), rot: rnd(0, TAU), spin: rnd(-4.5, 4.5),
      color: choice(colors), sway: rnd(0, TAU)
    });
  }
  endCelebration = {
    t0: performance.now(), last: performance.now(), cast, parts,
    winner, isTeacher
  };
  cv.classList.add('on');
}

function renderEndCelebration() {
  if (!endCelebration || !endCelebrationCtx) return;
  const cv = endCelebrationCv, c = endCelebrationCtx;
  const W = cv.width, H = cv.height;
  const now = performance.now();
  const dt = clamp((now - endCelebration.last) / 1000, 0, 0.05);
  endCelebration.last = now;
  const t = (now - endCelebration.t0) / 1000;
  const isTeacher = !!endCelebration.isTeacher;
  const partyColors = isTeacher
    ? ['#ffd166', '#7ee787', '#8fd0ff', '#c58cff', '#ff8fb0', '#f7f2da']
    : ['#7ee787', '#ffd166', '#8fd0ff', '#ff8fb0', '#54dcc9', '#f7f2da'];

  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, W, H);
  // Fondo de escenario dentro del propio canvas: así la celebración se lee
  // igual en la pantalla final y en cualquier captura o exportación.
  const base = c.createLinearGradient(0, 0, 0, H);
  if (isTeacher) {
    base.addColorStop(0, '#1b112d');
    base.addColorStop(1, '#090c18');
  } else {
    base.addColorStop(0, '#0d2a23');
    base.addColorStop(1, '#071012');
  }
  c.fillStyle = base;
  c.fillRect(0, 0, W, H);
  const bg = c.createRadialGradient(W / 2, H * 0.34, 10, W / 2, H * 0.58, W * 0.72);
  if (isTeacher) {
    bg.addColorStop(0, 'rgba(117,63,170,0.24)');
    bg.addColorStop(0.52, 'rgba(35,20,58,0.18)');
  } else {
    bg.addColorStop(0, 'rgba(38,157,119,0.22)');
    bg.addColorStop(0.52, 'rgba(16,52,44,0.18)');
  }
  bg.addColorStop(1, 'rgba(6,9,18,0)');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);

  const prevCtx = ctx;
  ctx = c;
  const cast = endCelebration.cast;
  const n = cast.length;
  const maxSpacing = isTeacher ? 220 : 150;
  const spacing = n > 1 ? Math.min(maxSpacing, (W - 160) / (n - 1)) : 0;
  const start = W / 2 - (n - 1) * spacing / 2;
  const baseY = 198;

  // focos de escenario
  for (let i = 0; i < n; i++) {
    const cx = start + i * spacing;
    const sg = c.createLinearGradient(cx, 0, cx, H);
    sg.addColorStop(0, isTeacher ? 'rgba(255,226,150,0.10)' : 'rgba(150,255,190,0.10)');
    sg.addColorStop(1, isTeacher ? 'rgba(255,226,150,0)' : 'rgba(150,255,190,0)');
    c.fillStyle = sg;
    c.beginPath();
    c.moveTo(cx - 22, 0); c.lineTo(cx + 22, 0);
    c.lineTo(cx + Math.min(142, spacing * 0.64), H);
    c.lineTo(cx - Math.min(142, spacing * 0.64), H);
    c.closePath(); c.fill();
  }
  c.fillStyle = isTeacher ? 'rgba(255,255,255,0.05)' : 'rgba(126,231,135,0.06)';
  c.beginPath(); c.ellipse(W / 2, H - 28, 380, 26, 0, 0, TAU); c.fill();
  c.strokeStyle = isTeacher ? 'rgba(197,140,255,0.18)' : 'rgba(126,231,135,0.26)';
  c.lineWidth = 2;
  c.beginPath(); c.ellipse(W / 2, H - 28, 330, 19, 0, 0, TAU); c.stroke();

  // confeti
  for (const p of endCelebration.parts) {
    p.vy += 22 * dt;
    p.x += (p.vx + Math.sin(t * 2.4 + p.sway) * 18) * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
    if (p.y > H + 18) {
      p.y = -18;
      p.x = rnd(0, W);
      p.vy = rnd(18, 66);
      p.color = choice(partyColors);
    }
    c.save();
    c.translate(p.x, p.y);
    c.rotate(p.rot);
    c.fillStyle = p.color;
    c.globalAlpha = 0.85;
    c.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.58);
    c.restore();
  }
  c.globalAlpha = 1;

  // estrellitas flotantes
  for (let i = 0; i < 16; i++) {
    const a = t * 0.5 + i * 1.7;
    const rr = 130 + (i % 5) * 47;
    const sx = W / 2 + Math.cos(a) * rr;
    const sy = 112 + Math.sin(a * 0.8) * 48;
    c.save();
    c.translate(sx, sy);
    c.rotate(a);
    c.fillStyle = isTeacher
      ? 'rgba(255,227,130,' + (0.3 + 0.3 * Math.sin(t * 3 + i)) + ')'
      : 'rgba(150,255,190,' + (0.3 + 0.3 * Math.sin(t * 3 + i)) + ')';
    c.fillRect(-1.5, -5, 3, 10);
    c.fillRect(-5, -1.5, 10, 3);
    c.restore();
  }

  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = 'bold 17px system-ui, sans-serif';
  c.fillStyle = isTeacher ? '#ffe08a' : '#9af7b0';
  c.fillText(isTeacher ? '¡LOS PROFESORES CELEBRAN!' : '¡LOS ESTUDIANTES CELEBRAN!', W / 2, 24);
  if (!isTeacher) {
    c.font = 'bold 10px system-ui, sans-serif';
    c.fillStyle = 'rgba(190,255,208,0.9)';
    c.fillText('SOBREVIVIENTES: ' + n, W / 2, 40);
  }

  const cheers = isTeacher
    ? { jose: '¡POR FIN!', ovidio: '¡SILENCIO!', segundo: '¡A CELEBRAR!' }
    : { leonardo: '¡LO LOGRAMOS!', jonny: '¡A BAILAR!', morante: '¡SIN TAREA!', luis: '¡LIBRE!', ipa: '¡A COMER!', elias: '¡QUÉ ALIVIO!' };
  const bubbleFont = n > 5 ? 10 : 12;
  const bubBase = isTeacher ? 48 : 54;
  for (let i = 0; i < n; i++) {
    const tt = cast[i];
    const x = start + i * spacing;
    const jump = Math.abs(Math.sin(t * 3.1 + i * 1.15)) * (isTeacher ? 12 : 16);
    const sway = Math.sin(t * 2.2 + i * 1.7) * (isTeacher ? 0.035 : 0.06);

    c.fillStyle = 'rgba(0,0,0,0.34)';
    c.beginPath(); c.ellipse(x, baseY + 10, (isTeacher ? 35 : 31) - jump * 0.45, 9, 0, 0, TAU); c.fill();

    const line = cheers[isTeacher ? tt.teacherId : tt.charId] || (isTeacher ? '¡VICTORIA!' : '¡GANAMOS!');
    c.font = 'bold ' + bubbleFont + 'px system-ui, sans-serif';
    const tw = c.measureText(line).width + 18;
    const bubY = bubBase + Math.sin(t * 2.1 + i * 1.4) * 3;
    c.fillStyle = 'rgba(14,11,24,0.92)';
    roundRect(c, x - tw / 2, bubY, tw, 24, 9); c.fill();
    c.strokeStyle = tt.char.color + 'aa';
    c.lineWidth = 1.4;
    roundRect(c, x - tw / 2, bubY, tw, 24, 9); c.stroke();
    c.fillStyle = tt.char.color;
    c.fillText(line, x, bubY + 12);
    c.fillStyle = 'rgba(14,11,24,0.92)';
    c.beginPath(); c.moveTo(x - 5, bubY + 24); c.lineTo(x + 5, bubY + 24); c.lineTo(x, bubY + 31); c.closePath(); c.fill();

    c.save();
    c.translate(x, baseY - jump);
    c.rotate(sway);
    const scale = isTeacher ? 1.22 : 1.08;
    c.scale(scale, scale);
    drawPerson({
      kind: isTeacher ? 'teacher' : 'student',
      char: tt.char, look: tt.look || tt.char.look,
      name: tt.name, teacherId: tt.teacherId, charId: tt.charId,
      x: 0, y: 0, r: 27, face: Math.PI / 2,
      walk: t * (isTeacher ? 7.5 : 9.5) + i * 1.7, noBlink: false, blinkSeed: tt.blinkSeed || i * 1.3,
      swing: 0, speedUp: 0, eatT: 0, talkT: 0, combT: 0, chargeT: 0,
      cd: 0, immune: 0, isPlayer: false, celebrate: true,
      hp: tt.hp || tt.char.hp, maxHp: tt.maxHp || tt.char.maxHp, alive: true
    });
    c.restore();

    c.font = 'bold ' + (n > 5 ? 10.5 : 12) + 'px system-ui, sans-serif';
    const nw = c.measureText(tt.name).width + 16;
    c.fillStyle = 'rgba(8,10,20,0.78)';
    roundRect(c, x - nw / 2, baseY + 18, nw, 18, 6); c.fill();
    c.fillStyle = tt.char.color;
    c.fillText(tt.name, x, baseY + 27);
  }

  // notas musicales para los profesores; estrellas para los estudiantes
  c.font = 'bold 18px system-ui, sans-serif';
  const glyphs = isTeacher ? ['\u266A', '\u266B'] : ['\u2726', '\u2605', '\u2727'];
  for (let i = 0; i < 10; i++) {
    const nx = 58 + i * 92 + Math.sin(t * 1.6 + i) * 14;
    const ny = 74 + ((t * 22 + i * 37) % 124);
    c.fillStyle = isTeacher
      ? 'rgba(255,224,138,' + (0.22 + 0.16 * Math.sin(t * 2 + i)) + ')'
      : 'rgba(154,247,176,' + (0.22 + 0.16 * Math.sin(t * 2 + i)) + ')';
    c.fillText(glyphs[i % glyphs.length], nx, ny);
  }

  ctx = prevCtx;
  c.globalAlpha = 1;
}

/* ---------------------------------------------------------------------------
   Presentacion de los profesores
   Antes de que arranque el reloj, los tres profesores se presentan en el
   escenario del colegio. La secuencia es solo visual: no toca la IA, el mapa,
   las estadisticas ni el tiempo de partida.
   --------------------------------------------------------------------------- */
const INTRO_DURATION = 5.8;
const INTRO_QUOTES = {
  jose: 'La agenda no se toca.',
  ovidio: '¡SILENCIO!',
  segundo: 'El recreo se acabó.'
};

function startTeacherIntro() {
  const cast = TEACHER_IDS.map(id => teacherList.find(t => t.teacherId === id)).filter(Boolean);
  if (!cast.length) {
    for (const id of TEACHER_IDS) {
      const c = TEACHERS[id];
      cast.push({
        teacherId: id, char: c, name: c.name, look: c.look,
        skin: baseSkin('teacher', id), blinkSeed: 0,
        hp: c.hp, maxHp: c.hp, isPlayer: false
      });
    }
  }
  S.intro = {
    t: 0,
    cast: cast.slice(0, 3).map(t => ({
      teacherId: t.teacherId, char: t.char, name: t.name,
      look: t.look, skin: t.skin, blinkSeed: t.blinkSeed || 0,
      hp: t.hp, maxHp: t.maxHp, isPlayer: !!t.isPlayer,
      quote: INTRO_QUOTES[t.teacherId] || 'El recreo se acabó.'
    }))
  };
  S.phase = 'intro';
}

function finishTeacherIntro(skipped) {
  if (S.phase !== 'intro') return;
  S.intro = null;
  for (const k in keys) keys[k] = false;
  S.phase = 'playing';
  S.playFade = skipped ? 0.18 : 0.42;
  banner(S.role === 'student' ? 'SOBREVIVE 8 MINUTOS' : 'CAZA A LOS ESTUDIANTES',
    S.role === 'student' ? 'Aguanta hasta el final: si sigues en pie al 8:00, ganas' : 'Antes de que acaben los 8 minutos, deja a todos sin vida', 3.6);
  log('3 profesores contra 7 estudiantes. Empieza el recreo.', '#9fb6dd');
  last = performance.now();
}

function updateTeacherIntro(dt) {
  if (!S.intro) return;
  S.intro.t += dt;
  if (S.intro.t >= INTRO_DURATION) finishTeacherIntro(false);
}

/* Texto con espaciado manual: da un aire de cartel de cine sin depender de
   propiedades de canvas que no existen en todos los navegadores. */
function introTrackedText(text, x, y, gap, align) {
  const chars = Array.from(text);
  const widths = chars.map(ch => ctx.measureText(ch).width);
  let total = 0;
  for (let i = 0; i < widths.length; i++) total += widths[i] + (i ? gap : 0);
  let cursor = align === 'center' ? x - total / 2
    : (align === 'right' ? x - total : x);
  ctx.textAlign = 'left';
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cursor, y);
    cursor += widths[i] + gap;
  }
}

function drawTeacherIntro() {
  const intro = S.intro;
  if (!intro) return;
  ctx.save();
  const t = intro.t;
  const W = VW, H = VH;
  const s = clamp(Math.min(W / 1100, H / 700), 0.72, 1.55);
  const cast = intro.cast;
  const n = cast.length;
  const baseY = H * 0.655;
  const spacing = Math.min(W * 0.29, 330 * s);
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(W / 2 + (i - (n - 1) / 2) * spacing);
  const fadeIn = clamp(t / 0.38, 0, 1);
  const fadeOut = clamp((t - (INTRO_DURATION - 0.5)) / 0.5, 0, 1);
  const sceneAlpha = fadeIn * (1 - fadeOut);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textBaseline = 'middle';
  ctx.lineCap = 'butt';

  // Fondo: escenario nocturno, suelo en perspectiva y luces de escenario.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#05070e');
  bg.addColorStop(0.52, '#0b0e1b');
  bg.addColorStop(1, '#180d14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const halo = ctx.createRadialGradient(W / 2, H * 0.59, 8, W / 2, H * 0.59, W * 0.62);
  halo.addColorStop(0, 'rgba(188,49,70,0.19)');
  halo.addColorStop(0.5, 'rgba(108,46,91,0.10)');
  halo.addColorStop(1, 'rgba(4,6,12,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.fillStyle = '#dce7ff';
  for (let i = -10; i < 20; i++) {
    const x = i * 110 * s;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 42 * s, 0);
    ctx.lineTo(x - H * 0.4, H);
    ctx.lineTo(x - 42 * s - H * 0.4, H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const horizon = H * 0.535;
  const floor = ctx.createLinearGradient(0, horizon, 0, H);
  floor.addColorStop(0, 'rgba(38,31,47,0.34)');
  floor.addColorStop(1, 'rgba(8,9,16,0.84)');
  ctx.fillStyle = floor;
  ctx.fillRect(0, horizon, W, H - horizon);
  ctx.strokeStyle = 'rgba(151,166,205,0.10)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 8; i++) {
    const yy = horizon + Math.pow(i / 8, 1.7) * (H - horizon);
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
  }
  for (let x = -W * 0.35; x <= W * 1.35; x += 92 * s) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + (x - W / 2) * 0.16, horizon);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  // Conos de luz individuales, uno por profesor.
  for (let i = 0; i < n; i++) {
    const start = 0.48 + i * 0.72;
    const beam = clamp((t - start + 0.22) / 0.5, 0, 1);
    if (beam <= 0) continue;
    const cx = xs[i], col = cast[i].char.color;
    const lg = ctx.createLinearGradient(0, 0, 0, baseY + 80 * s);
    lg.addColorStop(0, hexRgba(col, 0.18 * beam));
    lg.addColorStop(0.58, hexRgba(col, 0.075 * beam));
    lg.addColorStop(1, hexRgba(col, 0));
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(cx - 17 * s, 0);
    ctx.lineTo(cx + 17 * s, 0);
    ctx.lineTo(cx + 152 * s, baseY + 92 * s);
    ctx.lineTo(cx - 152 * s, baseY + 92 * s);
    ctx.closePath();
    ctx.fill();
  }

  // Polvo de tiza suspendido en el aire.
  for (let i = 0; i < 48; i++) {
    const x = ((i * 137.3 + t * (7 + (i % 5) * 5)) % (W + 60)) - 30;
    const y = H * 0.05 + ((i * 83.7 + t * (8 + (i % 6) * 4)) % (H * 0.76));
    const a = 0.10 + 0.18 * Math.sin(t * 1.7 + i * 1.3);
    ctx.fillStyle = 'rgba(220,228,245,' + Math.max(0.02, a) + ')';
    ctx.beginPath(); ctx.arc(x, y, (i % 3 === 0 ? 1.8 : 1) * s, 0, TAU); ctx.fill();
  }

  // Titulo de la secuencia.
  ctx.globalAlpha = sceneAlpha;
  ctx.fillStyle = 'rgba(255,177,185,0.78)';
  ctx.font = 'bold ' + (11 * s) + 'px system-ui, sans-serif';
  introTrackedText('EL RECREO HA TERMINADO', W / 2, H * 0.105, 3.2 * s, 'center');

  ctx.save();
  ctx.shadowColor = 'rgba(255,69,86,0.42)';
  ctx.shadowBlur = 22 * s;
  ctx.fillStyle = '#f7f2e8';
  ctx.font = '900 ' + (47 * s) + 'px system-ui, sans-serif';
  introTrackedText('LOS PROFESORES', W / 2, H * 0.178, 2.1 * s, 'center');
  ctx.restore();

  const lineW = Math.min(W * 0.34, 330 * s);
  const lg2 = ctx.createLinearGradient(W / 2 - lineW / 2, 0, W / 2 + lineW / 2, 0);
  lg2.addColorStop(0, 'rgba(255,93,93,0)');
  lg2.addColorStop(0.5, 'rgba(255,93,93,0.92)');
  lg2.addColorStop(1, 'rgba(255,93,93,0)');
  ctx.fillStyle = lg2;
  ctx.fillRect(W / 2 - lineW / 2, H * 0.213, lineW, Math.max(1, 2 * s));

  // Sombra en el suelo y entrada escalonada de cada profesor.
  for (let i = 0; i < n; i++) {
    const start = 0.55 + i * 0.72;
    const k = clamp((t - start) / 0.8, 0, 1);
    if (k <= 0) continue;
    const ease = easeOutCubic(k);
    const side = n === 1 ? 0 : (i === 0 ? -1 : (i === n - 1 ? 1 : 0));
    const x = xs[i] + side * (1 - ease) * 48 * s;
    const y = baseY - 8 * s + (1 - ease) * 64 * s;
    const r = 38 * s;
    const alpha = sceneAlpha * clamp(k * 1.8, 0, 1);

    ctx.save();
    ctx.globalAlpha = alpha * 0.72;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.ellipse(x, baseY + r * 0.98, r * 1.2, r * 0.37, 0, 0, TAU); ctx.fill();

    const aura = cast[i].look && cast[i].look.aura;
    if (aura) {
      const ag = ctx.createRadialGradient(x, y - r * 0.35, 3, x, y - r * 0.35, r * 2.6);
      ag.addColorStop(0, hexRgba(aura, 0.24 * alpha));
      ag.addColorStop(1, hexRgba(aura, 0));
      ctx.fillStyle = ag;
      ctx.beginPath(); ctx.arc(x, y - r * 0.35, r * 2.6, 0, TAU); ctx.fill();
    }
    if (cast[i].skin && cast[i].skin.fx) {
      const rgb = cast[i].skin.fx.color;
      ctx.globalAlpha = alpha * (0.32 + Math.sin(t * 2.2 + i) * 0.08);
      ctx.strokeStyle = 'rgba(' + rgb + ',0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, baseY + r * 0.98, r * (1.65 + Math.sin(t * 2 + i) * 0.12), r * 0.54, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y + Math.sin(t * 1.8 + i * 1.7) * 1.5 * s);
    ctx.rotate((1 - ease) * side * 0.12 + Math.sin(t * 1.4 + i) * 0.006);
    drawPerson({
      kind: 'teacher', teacherId: cast[i].teacherId, char: cast[i].char,
      look: cast[i].look, skin: cast[i].skin, name: cast[i].name,
      x: 0, y: 0, r: r, face: Math.PI / 2,
      walk: k < 1 ? t * 14 : Math.sin(t * 1.8 + i) * 0.55,
      noBlink: false, blinkSeed: cast[i].blinkSeed || i * 1.3,
      hp: cast[i].hp, maxHp: cast[i].maxHp,
      alive: true, strikeT: 0, strikeDur: 0, speedUp: 0, stun: 0,
      immune: 0, invis: 0, eatT: 0, talkT: 0, combT: 0, chargeT: 0
    });
    ctx.restore();

    // Bocadillo con la frase de presentación.
    const quoteA = sceneAlpha * clamp((t - start - 0.42) / 0.35, 0, 1) *
      clamp((INTRO_DURATION - 1.1 - t) / 0.35, 0, 1);
    if (quoteA > 0) {
      ctx.save();
      ctx.globalAlpha = quoteA;
      ctx.font = 'bold ' + (11 * s) + 'px system-ui, sans-serif';
      const quote = cast[i].quote;
      const qw = ctx.measureText(quote).width + 22 * s;
      const qh = 25 * s;
      const qx = x - qw / 2;
      const qy = y - r * 4.7;
      ctx.fillStyle = 'rgba(8,10,20,0.94)';
      roundRect(ctx, qx, qy, qw, qh, 9 * s); ctx.fill();
      ctx.strokeStyle = hexRgba(cast[i].char.color, 0.8);
      ctx.lineWidth = 1.4;
      roundRect(ctx, qx, qy, qw, qh, 9 * s); ctx.stroke();
      ctx.fillStyle = 'rgba(8,10,20,0.94)';
      ctx.beginPath();
      ctx.moveTo(x - 5 * s, qy + qh - 1);
      ctx.lineTo(x + 5 * s, qy + qh - 1);
      ctx.lineTo(x, qy + qh + 8 * s);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f5edf0';
      ctx.textAlign = 'center';
      ctx.fillText(quote, x, qy + qh / 2 + 0.5 * s);
      ctx.restore();
    }
  }

  // Tarjetas con nombre y especialidad.
  for (let i = 0; i < n; i++) {
    const start = 0.55 + i * 0.72;
    const ca = sceneAlpha * clamp((t - start - 0.28) / 0.35, 0, 1);
    if (ca <= 0) continue;
    const cardW = Math.min(196 * s, spacing * 0.94);
    const cardH = 51 * s;
    const cx = xs[i];
    const cy = baseY + 55 * s;
    const shortName = W < 720
      ? cast[i].char.name.replace(/^Profe\s+/i, '').split(' ')[0]
      : cast[i].char.name.replace(/^Profe\s+/i, '');
    ctx.save();
    ctx.globalAlpha = ca;
    ctx.fillStyle = 'rgba(7,10,19,0.9)';
    roundRect(ctx, cx - cardW / 2, cy, cardW, cardH, 10 * s); ctx.fill();
    ctx.strokeStyle = hexRgba(cast[i].char.color, 0.72);
    ctx.lineWidth = 1.6;
    roundRect(ctx, cx - cardW / 2, cy, cardW, cardH, 10 * s); ctx.stroke();
    ctx.fillStyle = cast[i].char.color;
    roundRect(ctx, cx - cardW / 2 + 9 * s, cy + 8 * s, 3 * s, cardH - 16 * s, 2); ctx.fill();

    ctx.textAlign = 'left';
    ctx.font = '900 ' + (14 * s) + 'px system-ui, sans-serif';
    ctx.fillStyle = '#f2f5fc';
    ctx.fillText(fitText(shortName, cardW - 22 * s), cx - cardW / 2 + 19 * s, cy + 19 * s);
    ctx.font = 'bold ' + (9.5 * s) + 'px system-ui, sans-serif';
    ctx.fillStyle = hexRgba(cast[i].char.color, 0.95);
    ctx.fillText(fitText(cast[i].char.tagline.toUpperCase(), cardW - 24 * s), cx - cardW / 2 + 19 * s, cy + 36 * s);
    if (cast[i].isPlayer) {
      ctx.textAlign = 'right';
      ctx.font = '900 ' + (9 * s) + 'px system-ui, sans-serif';
      ctx.fillStyle = '#ffd166';
      ctx.fillText('TÚ', cx + cardW / 2 - 10 * s, cy + 18 * s);
    }
    ctx.restore();
  }

  // Llamada final y aviso de salto.
  const readyA = sceneAlpha * clamp((t - 3.05) / 0.55, 0, 1);
  if (readyA > 0) {
    const readyY = baseY + 132 * s;
    ctx.save();
    ctx.globalAlpha = readyA * (0.72 + Math.sin(t * 3.2) * 0.12);
    const rw = Math.min(W * 0.52, 420 * s);
    ctx.strokeStyle = 'rgba(255,209,102,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2 - rw / 2, readyY - 12 * s);
    ctx.lineTo(W / 2 + rw / 2, readyY - 12 * s);
    ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.font = '900 ' + (13 * s) + 'px system-ui, sans-serif';
    introTrackedText('QUE EMPIECE EL RECREO', W / 2, readyY + 4 * s, 2.4 * s, 'center');
    ctx.restore();
  }

  const skipA = sceneAlpha * clamp((t - 0.75) / 0.35, 0, 1);
  if (skipA > 0) {
    ctx.save();
    ctx.globalAlpha = skipA * 0.72;
    ctx.font = 'bold ' + (10.5 * s) + 'px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#c7d2e8';
    ctx.fillText('ESPACIO / CLIC PARA SALTAR', W - 18 * s, H - 20 * s);
    ctx.restore();
  }

  // Viñeta de cine.
  const vig = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.2, W / 2, H * 0.55, W * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(0.72, 'rgba(0,0,0,0.16)');
  vig.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  if (t < 0.38) {
    ctx.fillStyle = 'rgba(0,0,0,' + (1 - t / 0.38) + ')';
    ctx.fillRect(0, 0, W, H);
  }
  if (fadeOut > 0) {
    ctx.fillStyle = 'rgba(0,0,0,' + fadeOut + ')';
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/* ---------------------------------------------------------------------------
   Musica de persecucion
   Elige el profesor que mas cerca esta cazando al jugador y deja que
   music.js haga el crossfade hacia su tema. Tambien funciona al reves: si
   juegas como profesor, suena tu tema mientras persigues a un alumno.
   --------------------------------------------------------------------------- */
function chaseMusicTarget() {
  if (S.phase !== 'playing' || !player || !player.alive) return { active: false };

  if (S.role === 'student') {
    if (player.invis > 0) return { active: false };
    const maxDistance = isNight() ? 560 : 700;
    const candidates = [];

    for (const t of teacherList) {
      if (!t.alive || t.summon || t.hiddenT > 0) continue;
      if (t.target !== player || t.lost >= 2.2) continue;
      const d = dist(t, player);
      const reach = t.lost > 0.05 ? maxDistance * 0.78 : maxDistance;
      if (d > reach) continue;
      candidates.push({ t, d, score: d + t.lost * 45 });
    }

    if (!candidates.length) return { active: false };
    candidates.sort((a, b) => a.score - b.score);
    let chosen = candidates[0];

    // Histéresis: si el perseguidor anterior sigue siendo válido, no cambiamos
    // de tema por diferencias mínimas de distancia. Así el crossfade no parpadea
    // cuando dos profesores te siguen a la vez.
    const previousId = S.chaseMusic && S.chaseMusic.active ? S.chaseMusic.id : null;
    if (previousId) {
      const previous = candidates.find(c => c.t.teacherId === previousId);
      if (previous) {
        const bestVisible = chosen.t.lost <= 0.05;
        const previousVisible = previous.t.lost <= 0.05;
        const margin = bestVisible && !previousVisible ? 40 : 110;
        if (previous.d <= chosen.d + margin) chosen = previous;
      }
    }

    const best = chosen.t;
    let intensity = clamp(1 - (chosen.d - 80) / (isNight() ? 430 : 560), 0.12, 1);
    if (best.lost > 0.05) intensity *= 0.68;
    intensity = clamp(intensity + Math.max(0, candidates.length - 1) * 0.14, 0, 1);
    return {
      active: true,
      id: best.teacherId,
      intensity,
      teacher: best.name,
      chasers: candidates.length
    };
  }

  if (S.role === 'teacher') {
    let target = player.target;
    if (!target || !target.alive || target.escaped || target.invis > 0) target = null;
    if (!target) {
      let best = null;
      let bestD = Infinity;
      for (const s of studentList) {
        if (!s.alive || s.escaped || s.invis > 0) continue;
        const d = dist(player, s);
        if (d > 500 || d >= bestD) continue;
        if (!hasLOS(player.x, player.y, s.x, s.y)) continue;
        best = s;
        bestD = d;
      }
      target = best;
    }
    if (!target) return { active: false };
    const d = dist(player, target);
    if (d > 680) return { active: false };
    let intensity = clamp(1 - (d - 70) / 600, 0.15, 1);
    if (player.lost > 0.05) intensity *= 0.65;
    return {
      active: true,
      id: player.teacherId,
      intensity,
      teacher: player.name,
      chasers: 1
    };
  }

  return { active: false };
}

function updateChaseMusic() {
  const info = chaseMusicTarget();
  S.chaseMusic = info;
  if (typeof ChaseMusic !== 'undefined') ChaseMusic.update(info);
}

function refreshMusicUI() {
  if (typeof ChaseMusic === 'undefined') return;
  const btn = document.getElementById('btn-music');
  if (btn) btn.textContent = 'MÚSICA: ' + (ChaseMusic.isMuted() ? 'OFF' : 'ON');
}

function toggleMusic() {
  if (typeof ChaseMusic === 'undefined') return;
  ChaseMusic.unlock();
  const muted = ChaseMusic.toggleMuted();
  refreshMusicUI();
  if (S.phase === 'playing') {
    log(muted ? 'Música silenciada (M)' : 'Música activada (M)', muted ? '#8899b5' : '#8fd0ff');
  }
}

/* ---------------------------------------------------------------------------
   Tick principal
   --------------------------------------------------------------------------- */
function matchClock() {
  return clamp(MATCH_TIME - S.timeLeft, 0, MATCH_TIME);
}

function phaseIsNight(clock) {
  return Math.floor(clock / DAY_NIGHT_PERIOD) % 2 === 1;
}

function nextPhaseSeconds() {
  return Math.max(1, Math.ceil(DAY_NIGHT_PERIOD - (matchClock() % DAY_NIGHT_PERIOD)));
}

function tick(dt) {
  S.elapsed += dt;
  S.timeLeft = Math.max(0, MATCH_TIME - S.elapsed - S.timeBonus);
  S.timeFlash = Math.max(0, S.timeFlash - dt);
  S.playFade = Math.max(0, S.playFade - dt);

  // Ciclo de 8:00: dia, noche, dia y noche (2:00 por fase).
  if (S.timeLeft > 0) {
    const nightNow = phaseIsNight(matchClock());
    if (nightNow !== S.night) {
      S.night = nightNow;
      if (nightNow) {
        const finalNight = matchClock() >= MATCH_TIME - DAY_NIGHT_PERIOD;
        banner('¡CAE LA NOCHE!', finalNight
          ? 'Últimos 2:00. Resiste hasta el final: no habrá otro amanecer.'
          : 'Los profesores ven menos. En 2:00 vuelve el día.', 3.4);
        log(finalNight ? 'Noche final: aguanta los últimos 2 minutos' : 'Noche: los profesores ven menos', '#8fd0ff');
      } else {
        banner('¡AMANECE!', 'Vuelve la luz. En 2:00 volverá a caer la noche.', 3.2);
        log('Día: los profesores vuelven a ver bien', '#ffd166');
      }
    }
  }

  updateAiMissions(dt);
  updateExamPapers(dt);
  updateFoodItems(dt);

  if (player && player.alive) updatePlayer(dt);
  updateTaskMission(dt);
  for (const s of studentList) if (s.alive && !s.escaped && !s.isPlayer) aiStudent(s, dt);
  for (const t of teacherList) if (t.alive && !t.isPlayer) aiTeacher(t, dt);
  updateTeacherSpecials(dt);

  for (const e of entities) {
    // animacion de caminar y destello de dano
    const moved = Math.hypot(e.x - (e.px === undefined ? e.x : e.px), e.y - (e.py === undefined ? e.y : e.py));
    e.px = e.x; e.py = e.y;
    e.walk = (e.walk || 0) + moved * 0.35;
    e.flash = Math.max(0, (e.flash || 0) - dt);
    e.strikeT = Math.max(0, (e.strikeT || 0) - dt);
    e.foodSpeedT = Math.max(0, (e.foodSpeedT || 0) - dt);
    if (e.kind === 'student') {
      e.cd = Math.max(0, e.cd - dt);
      e.cd2 = Math.max(0, e.cd2 - dt);
      e.auraT = Math.max(0, e.auraT - dt);
      e.speedUp = Math.max(0, e.speedUp - dt);
      e.invis = Math.max(0, e.invis - dt);
      e.revealed = Math.max(0, e.revealed - dt);
      e.slowT = Math.max(0, e.slowT - dt);
      e.voidSlowT = Math.max(0, e.voidSlowT - dt);
      e.noAgenda = Math.max(0, e.noAgenda - dt);
      e.stun = Math.max(0, e.stun - dt);
      e.blockT = Math.max(0, e.blockT - dt);
      e.sprint = Math.max(0, e.sprint - dt);
      e.immune = Math.max(0, e.immune - dt);
      e.eatT = Math.max(0, e.eatT - dt);
      e.luisFastT = Math.max(0, e.luisFastT - dt);
      e.talkT = Math.max(0, e.talkT - dt);
    } else {
      for (let i = 0; i < 3; i++) e.cds[i] = Math.max(0, e.cds[i] - dt);
      e.speedUp = Math.max(0, e.speedUp - dt);
      e.stun = Math.max(0, e.stun - dt);
      e.swing = Math.max(0, e.swing - dt);
      e.retreatT = Math.max(0, e.retreatT - dt);
    }
  }

  updateExams(dt);
  updateProjectiles(dt);
  updateFx(dt);

  entities.sort((a, b) => a.y - b.y);
  updateDoors(dt);

  for (const m of S.messages) m.t -= dt;
  S.messages = S.messages.filter(m => m.t > 0);
  if (S.banner) { S.banner.t -= dt; if (S.banner.t <= 0) S.banner = null; }
  S.camShake = Math.max(0, S.camShake - dt * 40);

  if (S.timeLeft <= 0) {
    const saved = Math.round(S.timeSaved);
    const extra = saved > 0 ? ' Las misiones recortaron ' + fmtTime(saved) + ' del reloj.' : '';
    if (S.role === 'student') endMatch('student', '¡SOBREVIVISTE!', 'Aguantaste hasta el final de la clase. Los estudiantes ganan la partida.' + extra);
    else endMatch('student', '¡GANAN LOS ESTUDIANTES!', 'Se acabó el tiempo y los estudiantes siguen en pie.' + extra);
  }

  updateChaseMusic();
}

/* ---------------------------------------------------------------------------
   Render
   --------------------------------------------------------------------------- */
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  VW = window.innerWidth; VH = window.innerHeight;
  canvas.width = Math.floor(VW * dpr);
  canvas.height = Math.floor(VH * dpr);
  canvas.style.width = VW + 'px';
  canvas.style.height = VH + 'px';
  nightCv.width = canvas.width; nightCv.height = canvas.height;
}

function w2sx(x) { return (x - cam.x) * zoom + VW / 2; }
function w2sy(y) { return (y - cam.y) * zoom + VH / 2; }

function roundRect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt < 0) { const k = 1 + amt; r *= k; g *= k; b *= k; }
  else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#080c16';
  ctx.fillRect(0, 0, VW, VH);

  if (S.phase === 'intro') {
    drawTeacherIntro();
    return;
  }

  const focus = (player && player.alive) ? player
    : (studentList.find(s => s.alive && !s.escaped) || teacherList.find(t => t.alive));

  if (S.phase === 'menu' || S.phase === 'select') {
    const tt = performance.now() / 1000;
    cam.x = WORLD_W / 2 + Math.cos(tt * 0.11) * WORLD_W * 0.26;
    cam.y = WORLD_H / 2 + Math.sin(tt * 0.16) * WORLD_H * 0.24;
  } else if (focus) {
    cam.x = lerp(cam.x, focus.x, 0.14);
    cam.y = lerp(cam.y, focus.y, 0.14);
  }

  zoom = clamp(Math.min(VW / (T * 21), VH / (T * 13)), 0.5, 1.9);
  const halfW = VW / (2 * zoom), halfH = VH / (2 * zoom);
  cam.x = clamp(cam.x, halfW, Math.max(halfW, WORLD_W - halfW));
  cam.y = clamp(cam.y, halfH, Math.max(halfH, WORLD_H - halfH));

  ctx.save();
  ctx.translate(VW / 2 + (Math.random() - 0.5) * S.camShake, VH / 2 + (Math.random() - 0.5) * S.camShake);
  ctx.scale(zoom, zoom);
  ctx.translate(-cam.x, -cam.y);

  const x0 = Math.max(0, Math.floor((cam.x - halfW) / T) - 1);
  const x1 = Math.min(COLS - 1, Math.ceil((cam.x + halfW) / T) + 1);
  const y0 = Math.max(0, Math.floor((cam.y - halfH) / T) - 1);
  const y1 = Math.min(ROWS - 1, Math.ceil((cam.y + halfH) / T) + 1);

  drawWorld(x0, x1, y0, y1);
  drawAuras();
  drawExamPapers();
  drawFoodItems();
  drawTaskSpots();
  for (const e of entities) drawEntity(e);
  for (const ex of exams) drawExam(ex);
  for (const p of projectiles) drawProjectile(p);
  drawMissionMarkers();
  drawFx();
  ctx.restore();

  if (S.night) drawNight();
  drawReveals();
  drawTexts();
  if (S.phase === 'playing' || S.phase === 'paused' || S.phase === 'end') drawHUD();
  if (S.playFade > 0) {
    ctx.fillStyle = 'rgba(0,0,0,' + clamp(S.playFade / 0.42, 0, 1) + ')';
    ctx.fillRect(0, 0, VW, VH);
  }
}

const ZONE_WALL = {
  aula:     '#3b4d70',
  pc:       '#2d5360',
  lab:      '#2b5860',
  lib:      '#4a4370',
  staff:    '#5f4356',
  gym:      '#544f36',
  music:    '#4b3d66',
  cafe:     '#5a4436',
  workshop: '#50493d',
  store:    '#4b4b56',
  theater:  '#553c5f',
  pavilion: '#45445c'
};

function drawDesk(px, py, kind) {
  const x = px + 6, y = py + 7, w = T - 12, h = T - 18;
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  roundRect(ctx, x, y + 5, w, h, 4); ctx.fill();
  if (kind === 'cafe') {
    ctx.fillStyle = '#8a6242';
    ctx.beginPath(); ctx.ellipse(px + T / 2, py + T / 2 + 2, w / 2, h / 2.4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#a97b52';
    ctx.beginPath(); ctx.ellipse(px + T / 2, py + T / 2, w / 2, h / 2.4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f0e6d2';
    ctx.beginPath(); ctx.ellipse(px + T / 2 - 5, py + T / 2 - 2, 7, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c9553b';
    roundRect(ctx, px + T / 2 + 3, py + T / 2 - 7, 7, 9, 2); ctx.fill();
    return;
  }
  ctx.fillStyle = '#7d5734';
  roundRect(ctx, x, y, w, h, 4); ctx.fill();
  ctx.fillStyle = '#9c7048';
  roundRect(ctx, x, y, w, 7, 3); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 4); ctx.stroke();
  if (kind === 'lab') {
    ctx.fillStyle = 'rgba(160,230,240,0.75)';
    roundRect(ctx, px + T / 2 - 7, py + 13, 14, 8, 3); ctx.fill();
    ctx.fillStyle = '#6ee7d8';
    ctx.fillRect(px + T / 2 - 2, py + 9, 4, 6);
  } else {
    ctx.fillStyle = '#efe6d2';
    roundRect(ctx, px + 13, py + 16, 22, 15, 2); ctx.fill();
    ctx.fillStyle = '#d9cdb4';
    ctx.fillRect(px + T / 2 - 1, py + 17, 2, 13);
    ctx.strokeStyle = '#b9aa8c'; ctx.lineWidth = 1;
    ctx.strokeRect(px + 13.5, py + 16.5, 21, 14);
    ctx.fillStyle = '#e0b23c';
    ctx.fillRect(px + 19, py + 35, 9, 2);
  }
}

function drawStudyCell(px, py, kind) {
  if (kind === 'lib') {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    roundRect(ctx, px + 3, py + 7, T - 6, T - 9, 3); ctx.fill();
    ctx.fillStyle = '#5c4630';
    roundRect(ctx, px + 3, py + 3, T - 6, T - 9, 3); ctx.fill();
    ctx.fillStyle = '#8a6a48';
    roundRect(ctx, px + 3, py + 3, T - 6, 6, 3); ctx.fill();
    const cols = ['#e05d5d', '#5aa9ff', '#7ee787', '#ffd166', '#c77dff'];
    const seed = Math.floor(px / T) * 7 + Math.floor(py / T) * 13;
    for (let s = 0; s < 2; s++) {
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = cols[(i + s * 2 + seed) % cols.length];
        ctx.fillRect(px + 7 + i * 5.6, py + 12 + s * 12, 4.6, 9);
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px + 3, py + 24, T - 6, 2);
    return;
  }
  if (kind === 'pc') {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    roundRect(ctx, px + 4, py + 12, T - 8, T - 16, 4); ctx.fill();
    ctx.fillStyle = '#4d5a6d';
    roundRect(ctx, px + 4, py + 8, T - 8, T - 18, 4); ctx.fill();
    ctx.fillStyle = '#202a38';
    roundRect(ctx, px + 10, py + 5, T - 20, 17, 3); ctx.fill();
    ctx.fillStyle = '#58d6ff';
    roundRect(ctx, px + 12, py + 7, T - 24, 13, 2); ctx.fill();
    ctx.fillStyle = 'rgba(10,20,30,0.55)';
    ctx.fillRect(px + 14, py + 15, 12, 2);
    ctx.fillRect(px + 14, py + 11, 17, 2);
    ctx.fillStyle = '#2a3648';
    ctx.fillRect(px + T / 2 - 2, py + 22, 4, 6);
    return;
  }
  if (kind === 'workshop') {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    roundRect(ctx, px + 3, py + 10, T - 6, T - 14, 3); ctx.fill();
    ctx.fillStyle = '#6b5842';
    roundRect(ctx, px + 3, py + 6, T - 6, T - 14, 3); ctx.fill();
    ctx.fillStyle = '#8a7154';
    roundRect(ctx, px + 3, py + 6, T - 6, 6, 3); ctx.fill();
    ctx.strokeStyle = '#d9dde6'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px + 10, py + 17); ctx.lineTo(px + 24, py + 17); ctx.stroke();
    ctx.beginPath(); ctx.arc(px + 31, py + 19, 5, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#e8b23c';
    ctx.fillRect(px + 37, py + 14, 5, 10);
    return;
  }
  if (kind === 'staff') {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    roundRect(ctx, px + 2, py + 10, T - 4, T - 14, 5); ctx.fill();
    ctx.fillStyle = '#6a4f3c';
    roundRect(ctx, px + 2, py + 5, T - 4, T - 14, 5); ctx.fill();
    ctx.fillStyle = '#8a6a50';
    roundRect(ctx, px + 2, py + 5, T - 4, 5, 3); ctx.fill();
    ctx.fillStyle = '#f4efe2';
    ctx.fillRect(px + 10, py + 16, 10, 7);
    ctx.fillRect(px + 26, py + 17, 9, 6);
    ctx.fillStyle = '#e8e2d2';
    ctx.beginPath(); ctx.arc(px + 36, py + 27, 4, 0, TAU); ctx.fill();
    return;
  }
  if (kind === 'music') {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(px + T / 2 + 2, py + 34, 14, 5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#c9ccd6'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(px + 18, py + 34); ctx.lineTo(px + 18, py + 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px + 14, py + 34); ctx.lineTo(px + 22, py + 34); ctx.stroke();
    ctx.fillStyle = '#f0e6d2';
    roundRect(ctx, px + 21, py + 12, 16, 11, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(50,50,60,0.35)'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(px + 24, py + 15 + i * 3); ctx.lineTo(px + 34, py + 15 + i * 3); ctx.stroke();
    }
    return;
  }
  if (kind === 'gym' || kind === 'pavilion') {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(ctx, px + 2, py + 12, T - 4, T - 16, 3); ctx.fill();
    ctx.fillStyle = '#8a6a44';
    roundRect(ctx, px + 2, py + 8, T - 4, 12, 3); ctx.fill();
    ctx.fillStyle = '#a88254';
    roundRect(ctx, px + 2, py + 8, T - 4, 4, 2); ctx.fill();
    ctx.fillStyle = '#5a462e';
    ctx.fillRect(px + 8, py + 20, 4, 12);
    ctx.fillRect(px + T - 12, py + 20, 4, 12);
    return;
  }
  if (kind === 'theater') {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(ctx, px + 5, py + 10, T - 10, T - 14, 5); ctx.fill();
    ctx.fillStyle = '#7a2f45';
    roundRect(ctx, px + 5, py + 6, T - 10, T - 12, 5); ctx.fill();
    ctx.fillStyle = '#a04360';
    roundRect(ctx, px + 5, py + 6, T - 10, 7, 4); ctx.fill();
    return;
  }
  if (kind === 'store') {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    roundRect(ctx, px + 5, py + 9, T - 10, T - 13, 3); ctx.fill();
    ctx.fillStyle = '#7a5c3c';
    roundRect(ctx, px + 5, py + 4, T - 10, T - 13, 3); ctx.fill();
    ctx.strokeStyle = '#5a4128'; ctx.lineWidth = 2;
    ctx.strokeRect(px + 9, py + 9, T - 18, T - 22);
    ctx.beginPath(); ctx.moveTo(px + 9, py + 20); ctx.lineTo(px + T - 9, py + 20); ctx.stroke();
    return;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  roundRect(ctx, px + 4, py + 12, T - 8, T - 16, 4); ctx.fill();
  ctx.fillStyle = '#495567';
  roundRect(ctx, px + 4, py + 6, T - 8, T - 18, 4); ctx.fill();
  ctx.fillStyle = '#63738d';
  roundRect(ctx, px + 4, py + 6, T - 8, 7, 3); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px + 4, py + T * 0.58); ctx.lineTo(px + T - 4, py + T * 0.58); ctx.stroke();
}

function drawWindowLightPools(x0, x1, y0, y1) {
  for (const d of decor) {
    if (d.kind !== 'windows') continue;
    const ww = (d.w || 1) * T, wh = (d.h || 1) * T;
    if (d.x > x1 + 2 || d.x + (d.w || 1) < x0 - 2 || d.y > y1 + 2 || d.y + (d.h || 1) < y0 - 2) continue;
    const px = d.x * T, py = d.y * T;
    const lg = ctx.createLinearGradient(0, py + wh, 0, py + wh + T * 1.9);
    lg.addColorStop(0, S.night ? 'rgba(145,190,255,0.10)' : 'rgba(185,228,255,0.075)');
    lg.addColorStop(1, 'rgba(185,228,255,0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(px + 2, py + wh);
    ctx.lineTo(px + ww - 2, py + wh);
    ctx.lineTo(px + ww + T * 0.48, py + wh + T * 1.9);
    ctx.lineTo(px - T * 0.48, py + wh + T * 1.9);
    ctx.closePath(); ctx.fill();
  }
}

function drawLampPools(x0, x1, y0, y1) {
  for (const L of LAMPS) {
    if (L.x < (x0 - 4) * T || L.x > (x1 + 4) * T || L.y < (y0 - 4) * T || L.y > (y1 + 4) * T) continue;
    const radius = T * 3.2;
    const lg = ctx.createRadialGradient(L.x, L.y + 7, 2, L.x, L.y + 7, radius);
    const alpha = S.night ? 0.22 : 0.09;
    lg.addColorStop(0, 'rgba(255,232,174,' + alpha + ')');
    lg.addColorStop(0.55, 'rgba(255,216,145,' + alpha * 0.4 + ')');
    lg.addColorStop(1, 'rgba(255,216,145,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(L.x - radius, L.y + 7 - radius, radius * 2, radius * 2);
  }
}

function drawWorld(x0, x1, y0, y1) {
  // ---------- suelo con damero ----------
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      ctx.fillStyle = floorCol[y][x];
      ctx.fillRect(x * T, y * T, T, T);
    }
  }
  // juntas suaves
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = x0; x <= x1 + 1; x++) {
    ctx.beginPath(); ctx.moveTo(x * T, y0 * T); ctx.lineTo(x * T, (y1 + 1) * T); ctx.stroke();
  }
  for (let y = y0; y <= y1 + 1; y++) {
    ctx.beginPath(); ctx.moveTo(x0 * T, y * T); ctx.lineTo((x1 + 1) * T, y * T); ctx.stroke();
  }

  // ---------- decoracion de suelo (pistas, escenario, fuente) ----------
  drawDecor(x0, x1, y0, y1, true);
  drawWindowLightPools(x0, x1, y0, y1);
  drawLampPools(x0, x1, y0, y1);

  // ---------- sombra que proyectan los muros ----------
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (grid[y][x] === 0) continue;
      if (y + 1 < ROWS && grid[y + 1][x] === 0) ctx.fillRect(x * T, (y + 1) * T, T, 9);
      if (x + 1 < COLS && grid[y][x + 1] === 0) ctx.fillRect((x + 1) * T, y * T, 7, T);
    }
  }

  // ---------- muros, pupitres y mobiliario ----------
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const v = grid[y][x];
      if (v === 0) continue;
      const px = x * T, py = y * T;
      if (v === 1) {
        const exterior = (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1);
        const base = exterior ? '#1e2839' : (ZONE_WALL[zoneKind[y][x]] || '#27364c');
        ctx.fillStyle = base;
        ctx.fillRect(px, py, T, T);

        if (exterior) {
          // muro de piedra exterior: base pesada y hiladas irregulares
          ctx.fillStyle = 'rgba(0,0,0,0.24)';
          ctx.fillRect(px, py + T - 10, T, 10);
          ctx.fillStyle = 'rgba(255,255,255,0.045)';
          ctx.fillRect(px, py + T * 0.54, T, 2);
          ctx.fillRect(px + ((x + y) % 2 ? T * 0.18 : T * 0.54), py + T * 0.24, T * 0.2, 2);
        } else {
          // zocalo y friso: la pared parece panelada, no una losa plana
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.fillRect(px, py + T - 13, T, 13);
          ctx.fillStyle = shadeHex(base, -0.12);
          ctx.fillRect(px, py + T - 13, T, 13);
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fillRect(px, py + T - 13, T, 1.5);
          ctx.strokeStyle = 'rgba(0,0,0,0.16)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px + 0.5, py + 11);
          ctx.lineTo(px + 0.5, py + T - 14);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.035)';
          ctx.beginPath();
          ctx.moveTo(px + T * 0.5, py + 12);
          ctx.lineTo(px + T * 0.5, py + T - 14);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.055)';
          ctx.fillRect(px + 4, py + 13, T - 8, 1.5);
        }

        // cara superior iluminada (efecto 3/4)
        ctx.fillStyle = exterior ? 'rgba(190,215,255,0.20)' : shadeHex(base, 0.18);
        ctx.fillRect(px, py, T, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.11)';
        ctx.fillRect(px, py, T, 2.5);
        ctx.strokeStyle = 'rgba(0,0,0,0.30)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
      } else if (v === 2) {
        drawDesk(px, py, zoneKind[y][x]);
      } else {
        drawStudyCell(px, py, zoneKind[y][x]);
      }
    }
  }

  // ---------- puertas animadas: marco, hojas y umbral ----------
  drawDoors(x0, x1, y0, y1);

  // ---------- decoracion con volumen ----------
  drawDecor(x0, x1, y0, y1, false);

  // ---------- nombres de las salas ----------
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  for (const room of ROOMS) {
    if (room.x > x1 + 2 || room.x + room.w < x0 - 2 || room.y > y1 + 2 || room.y + room.h < y0 - 2) continue;
    const label = room.name.toUpperCase();
    const tw = ctx.measureText(label).width;
    const lx = (room.x + 1.2) * T, ly = (room.y + 1.15) * T;
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = 'rgba(8,12,20,0.75)';
    roundRect(ctx, lx - 8, ly, tw + 22, 21, 6); ctx.fill();
    ctx.fillStyle = shadeHex(room.floor, 0.42);
    roundRect(ctx, lx - 8, ly, 4, 21, 2); ctx.fill();
    ctx.fillStyle = 'rgba(235,242,255,0.9)';
    ctx.fillText(label, lx + 3, ly + 11);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'center';

  // ---------- lamparas ----------
  for (const L of LAMPS) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(L.x + 2, L.y + 7, 9, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3b4557';
    ctx.fillRect(L.x - 2.5, L.y - 4, 5, 11);
    ctx.beginPath(); ctx.arc(L.x, L.y - 8, 7.5, 0, TAU);
    ctx.fillStyle = S.night ? 'rgba(255,242,196,0.98)' : 'rgba(255,242,196,0.7)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(58,68,88,0.95)';
    ctx.stroke();
  }
}

/* decoracion del mapa (solo visual) */
function drawDecor(x0, x1, y0, y1, ground) {
  const esSuelo = (k) => (k === 'court' || k === 'stage' || k === 'fountain' || k === 'track' ||
    k === 'trim' || k === 'rug' || k === 'runner' || k === 'emblem' || k === 'flowerbed' || k === 'hopscotch' ||
    k === 'missionpad' || k === 'path' || k === 'arrow' || k === 'roomfloor' ||
    k === 'floorlabel' || k === 'crosswalk' || k === 'longjump' || k === 'plaza' || k === 'runway');
  for (const d of decor) {
    if (esSuelo(d.kind) !== !!ground) continue;
    const w = d.w || 1, h = d.h || 1;
    if (d.x + w < x0 - 3 || d.y + h < y0 - 3 || d.x > x1 + 3 || d.y > y1 + 3) continue;
    const px = d.x * T, py = d.y * T;
    switch (d.kind) {
      case 'roomfloor': {
        const rw = w * T, rh = h * T;
        const style = d.style || '';
        ctx.save();
        roundRect(ctx, px, py, rw, rh, 4); ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 2;
        roundRect(ctx, px + 5, py + 5, rw - 10, rh - 10, 4); ctx.stroke();
        if (style === 'aula') {
          // moqueta escolar con cuadricula fina y junta central
          ctx.strokeStyle = 'rgba(255,255,255,0.035)';
          ctx.lineWidth = 1;
          for (let xx = px + T * 2; xx < px + rw - 6; xx += T * 2) {
            ctx.beginPath(); ctx.moveTo(xx, py + 8); ctx.lineTo(xx, py + rh - 8); ctx.stroke();
          }
          for (let yy = py + T * 2; yy < py + rh - 6; yy += T * 2) {
            ctx.beginPath(); ctx.moveTo(px + 8, yy); ctx.lineTo(px + rw - 8, yy); ctx.stroke();
          }
          ctx.fillStyle = 'rgba(255,255,255,0.025)';
          ctx.fillRect(px + 8, py + rh * 0.5 - 1, rw - 16, 2);
        } else if (style === 'lib') {
          // tarima de madera calida
          ctx.fillStyle = 'rgba(255,205,135,0.055)';
          for (let yy = py + 8; yy < py + rh - 8; yy += 11) ctx.fillRect(px + 6, yy, rw - 12, 1);
          ctx.fillStyle = 'rgba(255,225,170,0.035)';
          for (let xx = px + 22; xx < px + rw - 10; xx += T * 1.6) {
            for (let yy = py + 8; yy < py + rh - 8; yy += 22) ctx.fillRect(xx, yy, 1, 11);
          }
        } else if (style === 'staff') {
          // moqueta con rombos, sala de descanso
          ctx.strokeStyle = 'rgba(255,218,185,0.045)';
          ctx.lineWidth = 1;
          for (let yy = py - rw; yy < py + rh + rw; yy += T) {
            ctx.beginPath(); ctx.moveTo(px, yy); ctx.lineTo(px + rw, yy + rw); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(px, yy); ctx.lineTo(px + rw, yy - rw); ctx.stroke();
          }
        } else if (style === 'lab') {
          // baldosa de laboratorio con juntas y puntos de nivel
          ctx.strokeStyle = 'rgba(160,230,255,0.075)';
          ctx.lineWidth = 1;
          for (let xx = px + T; xx < px + rw; xx += T) {
            ctx.beginPath(); ctx.moveTo(xx, py + 6); ctx.lineTo(xx, py + rh - 6); ctx.stroke();
          }
          for (let yy = py + T; yy < py + rh; yy += T) {
            ctx.beginPath(); ctx.moveTo(px + 6, yy); ctx.lineTo(px + rw - 6, yy); ctx.stroke();
          }
          ctx.fillStyle = 'rgba(180,245,255,0.1)';
          for (let xx = px + T; xx < px + rw; xx += T) {
            for (let yy = py + T; yy < py + rh; yy += T) ctx.fillRect(xx - 1, yy - 1, 2, 2);
          }
        } else if (style === 'pc') {
          // suelo tecnico elevado y canaletas de cables
          ctx.strokeStyle = 'rgba(120,190,255,0.07)';
          ctx.lineWidth = 1;
          for (let xx = px + T; xx < px + rw; xx += T) {
            ctx.beginPath(); ctx.moveTo(xx, py + 6); ctx.lineTo(xx, py + rh - 6); ctx.stroke();
          }
          for (let yy = py + T; yy < py + rh; yy += T) {
            ctx.beginPath(); ctx.moveTo(px + 6, yy); ctx.lineTo(px + rw - 6, yy); ctx.stroke();
          }
          ctx.strokeStyle = 'rgba(90,170,255,0.08)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px + rw * 0.2, py + rh * 0.5);
          ctx.lineTo(px + rw * 0.8, py + rh * 0.5);
          ctx.stroke();
        } else if (style === 'cafe') {
          // damero inclinado de cafeterIA
          ctx.fillStyle = 'rgba(255,255,255,0.026)';
          for (let yy = 0; yy < h + w; yy++) {
            for (let xx = 0; xx < w + h; xx++) {
              if ((xx + yy) % 2) continue;
              const x0 = px + (xx - yy) * T * 0.5;
              const y0 = py + (xx + yy) * T * 0.5;
              if (x0 < px || x0 > px + rw || y0 < py || y0 > py + rh) continue;
              ctx.fillRect(x0, y0, T * 0.5, T * 0.5);
            }
          }
        } else if (style === 'workshop' || style === 'store') {
          // hormigon con manchas y marcas de palet
          ctx.fillStyle = 'rgba(255,255,255,0.045)';
          for (let i = 0; i < 46; i++) {
            const sx = px + 8 + ((i * 73) % Math.max(10, rw - 16));
            const sy = py + 8 + ((i * 41) % Math.max(10, rh - 16));
            ctx.fillRect(sx, sy, 1.5, 1.5);
          }
          ctx.strokeStyle = 'rgba(255,220,150,0.04)';
          ctx.lineWidth = 3;
          roundRect(ctx, px + T, py + T, rw - T * 2, rh - T * 2, 3); ctx.stroke();
          if (style === 'workshop') {
            ctx.fillStyle = 'rgba(255,205,90,0.06)';
            for (let xx = px + 10; xx < px + rw - 10; xx += 18) {
              ctx.fillRect(xx, py + 8, 9, 2);
              ctx.fillRect(xx, py + rh - 10, 9, 2);
            }
          }
        } else if (style === 'gym' || style === 'pavilion') {
          // tarima deportiva: lamas largas y lineas de union
          ctx.fillStyle = 'rgba(255,220,160,0.04)';
          for (let yy = py + 8; yy < py + rh - 8; yy += 13) ctx.fillRect(px + 6, yy, rw - 12, 1);
          ctx.strokeStyle = 'rgba(255,255,255,0.04)';
          ctx.lineWidth = 1;
          for (let xx = px + T * 2; xx < px + rw - 8; xx += T * 2) {
            ctx.beginPath(); ctx.moveTo(xx, py + 8); ctx.lineTo(xx, py + rh - 8); ctx.stroke();
          }
        } else if (style === 'music' || style === 'theater') {
          // moqueta acustica con puntos y paneles
          ctx.fillStyle = 'rgba(255,255,255,0.035)';
          for (let yy = py + 12; yy < py + rh - 8; yy += 16) {
            for (let xx = px + 12; xx < px + rw - 8; xx += 16) {
              ctx.beginPath(); ctx.arc(xx, yy, 1.2, 0, TAU); ctx.fill();
            }
          }
          ctx.strokeStyle = 'rgba(220,190,255,0.045)';
          ctx.lineWidth = 2;
          roundRect(ctx, px + T, py + T, rw - T * 2, rh - T * 2, 3); ctx.stroke();
        }
        if (d.code) {
          ctx.globalAlpha = 0.055;
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold ' + Math.round(Math.min(rw, rh) * 0.3) + 'px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(d.code, px + rw / 2, py + rh * 0.56);
        }
        ctx.restore();
        break;
      }
      case 'court':
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 3;
        ctx.setLineDash([12, 9]);
        ctx.strokeRect(px, py, w * T, h * T);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(px + (w * T) / 2, py); ctx.lineTo(px + (w * T) / 2, py + h * T);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px + (w * T) / 2, py + (h * T) / 2, T * 1.4, 0, TAU);
        ctx.stroke();
        break;
      case 'stage':
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        roundRect(ctx, px, py + 8, w * T, h * T, 6); ctx.fill();
        ctx.fillStyle = '#6a4a2f';
        roundRect(ctx, px, py, w * T, h * T, 6); ctx.fill();
        ctx.fillStyle = '#845c39';
        roundRect(ctx, px, py, w * T, 10, 6); ctx.fill();
        break;
      case 'fountain': {
        const cx = px, cy = py, rr = (d.r || 2) * T;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(cx, cy + 6, rr, rr * 0.6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#4b5468';
        ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.62, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2f6f8f';
        ctx.beginPath(); ctx.ellipse(cx, cy - 2, rr * 0.78, rr * 0.48, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(180,230,255,0.55)';
        ctx.beginPath(); ctx.ellipse(cx - rr * 0.2, cy - 6, rr * 0.3, rr * 0.16, 0, 0, TAU); ctx.fill();
        break;
      }
      case 'board':
        ctx.fillStyle = '#2f2a24';
        roundRect(ctx, px - 4, py - 4, w * T + 8, h * T + 8, 4); ctx.fill();
        ctx.fillStyle = '#1f5c46';
        roundRect(ctx, px, py, w * T, h * T, 3); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px + 10, py + h * T * 0.4);
        ctx.lineTo(px + w * T * 0.4, py + h * T * 0.4);
        ctx.moveTo(px + 10, py + h * T * 0.7);
        ctx.lineTo(px + w * T * 0.65, py + h * T * 0.7);
        ctx.stroke();
        break;
      case 'hoop': {
        const cx = px, cy = py, rr = (d.r || 1) * T;
        ctx.fillStyle = '#39414f';
        ctx.fillRect(cx - 3, cy - rr, 6, rr);
        ctx.fillStyle = '#e8eaf0';
        roundRect(ctx, cx - rr * 0.55, cy - rr - 10, rr * 1.1, rr * 0.55, 3); ctx.fill();
        ctx.strokeStyle = '#ff8a3d';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy - rr * 0.55, rr * 0.28, 0, TAU); ctx.stroke();
        break;
      }
      case 'track': {
        // pista de atletismo (elipse de césped, calles y numeros)
        const cx = px + (w * T) / 2, cy = py + (h * T) / 2;
        ctx.fillStyle = 'rgba(120,90,70,0.30)';
        ctx.beginPath(); ctx.ellipse(cx, cy, (w * T) / 2, (h * T) / 2, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(70,150,90,0.22)';
        ctx.beginPath(); ctx.ellipse(cx, cy, (w * T) / 2 - 34, (h * T) / 2 - 26, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.30)';
        ctx.lineWidth = 3;
        ctx.setLineDash([16, 12]);
        ctx.beginPath(); ctx.ellipse(cx, cy, (w * T) / 2 - 14, (h * T) / 2 - 12, 0, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx, cy, (w * T) / 2 - 27, (h * T) / 2 - 21, 0, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx, cy, (w * T) / 2 - 40, (h * T) / 2 - 30, 0, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        // Numeros de calle en la recta superior y linea de salida.
        ctx.fillStyle = 'rgba(255,255,255,0.58)';
        ctx.font = 'bold 9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < 6; i++) {
          const nx = cx - (w * T) * 0.31 + i * (w * T) * 0.124;
          ctx.fillText(String(i + 1), nx, py + 13);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.42)';
        ctx.fillRect(px + (w * T) * 0.82, py + 8, 2.5, (h * T) * 0.22);
        break;
      }
      case 'floorlabel': {
        // Rotulo pintado en el suelo: solo orienta, no bloquea.
        const label = d.text || '';
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(d.ang || 0);
        ctx.font = '900 13px system-ui, sans-serif';
        const lw = ctx.measureText(label).width;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 0.23;
        ctx.fillStyle = d.color || '#dce8ff';
        ctx.fillText(label, 0, 0);
        ctx.globalAlpha = 0.13;
        ctx.fillRect(-lw / 2, 8, lw, 2);
        if (d.sub) {
          ctx.globalAlpha = 0.16;
          ctx.font = 'bold 8px system-ui, sans-serif';
          ctx.fillText(d.sub, 0, 17);
        }
        ctx.restore();
        break;
      }
      case 'crosswalk': {
        const cw = w * T, ch = h * T;
        ctx.save();
        ctx.globalAlpha = 0.38;
        ctx.fillStyle = 'rgba(238,244,255,0.9)';
        const bars = Math.max(4, Math.round(w * 1.4));
        for (let i = 0; i < bars; i++) {
          const bw = (cw - 10) / (bars * 1.7);
          const bx = px + 5 + i * ((cw - 10) / bars);
          ctx.fillRect(bx, py + 3, bw, ch - 6);
        }
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = '#dce8ff';
        ctx.fillRect(px, py, cw, 1.5);
        ctx.fillRect(px, py + ch - 1.5, cw, 1.5);
        ctx.restore();
        break;
      }
      case 'longjump': {
        const lw = w * T, lh = h * T;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        roundRect(ctx, px + 3, py + 5, lw, lh, 5); ctx.fill();
        ctx.fillStyle = '#b98f55';
        roundRect(ctx, px, py, lw, lh, 5); ctx.fill();
        ctx.strokeStyle = 'rgba(255,235,190,0.4)';
        ctx.lineWidth = 2;
        roundRect(ctx, px + 2, py + 2, lw - 4, lh - 4, 4); ctx.stroke();
        ctx.strokeStyle = 'rgba(120,82,45,0.42)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 6; i++) {
          ctx.beginPath();
          ctx.moveTo(px + 6, py + (lh / 6) * i);
          ctx.lineTo(px + lw - 6, py + (lh / 6) * i + 3);
          ctx.stroke();
        }
        ctx.fillStyle = '#f0e6d2';
        ctx.fillRect(px + 2, py + lh - 7, lw - 4, 5);
        ctx.restore();
        break;
      }
      case 'hurdle': {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(d.ang || 0);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        roundRect(ctx, -24, 6, 48, 5, 2); ctx.fill();
        ctx.strokeStyle = '#dbe4f2';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-22, 2); ctx.lineTo(-22, -9); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(22, 2); ctx.lineTo(22, -9); ctx.stroke();
        ctx.strokeStyle = '#ffcf5c';
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(-21, -8); ctx.lineTo(21, -8); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-21, -5); ctx.lineTo(21, -5); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'tree': {
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        ctx.beginPath(); ctx.ellipse(px + 3, py + 14, 24, 9, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5b4326';
        ctx.fillRect(px - 5, py - 6, 10, 22);
        ctx.fillStyle = '#2f6b3f';
        ctx.beginPath(); ctx.arc(px - 12, py - 16, 17, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(px + 12, py - 18, 18, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3d8b4f';
        ctx.beginPath(); ctx.arc(px, py - 32, 19, 0, TAU); ctx.fill();
        ctx.fillStyle = '#4ea863';
        ctx.beginPath(); ctx.arc(px - 6, py - 36, 11, 0, TAU); ctx.fill();
        break;
      }
      case 'bleachers': {
        const bw = w * T, bh = h * T;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        roundRect(ctx, px + 4, py + 7, bw, bh, 4); ctx.fill();
        // Cuatro tablones escalonados con huecos para que se lean como gradas.
        const rows = 4, step = (bh * 0.94) / rows;
        for (let i = 0; i < rows; i++) {
          const ry = py + i * step;
          ctx.fillStyle = i % 2 ? '#755a41' : '#8d7052';
          roundRect(ctx, px, ry, bw, step * 0.66, 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.14)';
          ctx.fillRect(px + 5, ry + 1.5, bw - 10, 1.8);
          ctx.fillStyle = 'rgba(35,25,18,0.42)';
          ctx.fillRect(px, ry + step * 0.66, bw, 1.5);
        }
        // Laterales de la grada.
        ctx.fillStyle = '#5f4833';
        ctx.fillRect(px, py, 4, bh * 0.86);
        ctx.fillRect(px + bw - 4, py, 4, bh * 0.86);
        ctx.strokeStyle = 'rgba(45,35,25,0.5)';
        ctx.lineWidth = 1.5;
        roundRect(ctx, px, py, bw, bh * 0.86, 4); ctx.stroke();
        break;
      }
      case 'flagpole': {
        const t = performance.now() / 1000;
        const flap = Math.sin(t * 3.1) * 4;
        ctx.fillStyle = 'rgba(0,0,0,0.26)';
        ctx.beginPath(); ctx.ellipse(px, py + 3, 15, 5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#8d98aa';
        ctx.fillRect(px - 2, py - 92, 4, 96);
        ctx.fillStyle = '#c7d1e2';
        ctx.beginPath(); ctx.arc(px, py - 94, 3.5, 0, TAU); ctx.fill();
        // Bandera del colegio ondeando.
        ctx.fillStyle = '#b73545';
        ctx.beginPath();
        ctx.moveTo(px + 2, py - 90);
        ctx.quadraticCurveTo(px + 27, py - 95 + flap, px + 50, py - 84 + flap * 1.6);
        ctx.lineTo(px + 50, py - 67 + flap * 1.6);
        ctx.quadraticCurveTo(px + 27, py - 74 + flap, px + 2, py - 70);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,240,200,0.9)';
        ctx.beginPath(); ctx.arc(px + 24, py - 80 + flap * 0.7, 5.5, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px + 2, py - 90); ctx.lineTo(px + 2, py - 70); ctx.stroke();
        break;
      }
      case 'pennants': {
        const pw = w * T;
        const t = performance.now() / 1000;
        const cols = ['#ffcf5c', '#5aa9ff', '#ff6b8a', '#7ee787', '#c77dff'];
        ctx.strokeStyle = 'rgba(225,235,250,0.32)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px + pw / 2, py + 9 + Math.sin(t * 1.7) * 1.5, px + pw, py);
        ctx.stroke();
        const n = Math.max(6, Math.round(w * 1.8));
        for (let i = 0; i < n; i++) {
          const fx = px + (i + 0.5) * (pw / n);
          const fy = py + Math.sin(((i + 0.5) / n) * Math.PI) * 7;
          const sway = Math.sin(t * 2.2 + i) * 2;
          ctx.fillStyle = cols[i % cols.length];
          ctx.beginPath();
          ctx.moveTo(fx - 5, fy);
          ctx.lineTo(fx + 5, fy);
          ctx.lineTo(fx + sway, fy + 12);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.beginPath();
          ctx.moveTo(fx - 5, fy);
          ctx.lineTo(fx, fy);
          ctx.lineTo(fx + sway, fy + 12);
          ctx.closePath(); ctx.fill();
        }
        break;
      }
      case 'chart': {
        const col = d.color || '#8fd0ff';
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        roundRect(ctx, px - 17, py - 26, 34, 48, 3); ctx.fill();
        ctx.fillStyle = '#f0ead8';
        roundRect(ctx, px - 19, py - 28, 34, 48, 3); ctx.fill();
        ctx.fillStyle = col;
        ctx.fillRect(px - 16, py - 25, 28, 22);
        ctx.fillStyle = 'rgba(14,22,35,0.88)';
        ctx.font = '900 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.text || '', px - 2, py - 14);
        ctx.fillStyle = '#3c4658';
        ctx.fillRect(px - 16, py + 1, 28, 2);
        ctx.fillRect(px - 16, py + 6, 21, 2);
        if (d.sub) {
          ctx.fillStyle = '#59657a';
          ctx.font = 'bold 5.5px system-ui, sans-serif';
          ctx.fillText(d.sub, px - 2, py + 16);
        }
        // Pequeño dibujo segun la asignatura.
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        if (d.icon === 'math') {
          ctx.beginPath(); ctx.moveTo(px - 13, py + 12); ctx.lineTo(px + 9, py + 12); ctx.stroke();
          ctx.beginPath(); ctx.arc(px - 2, py + 12, 4, 0, TAU); ctx.stroke();
        } else if (d.icon === 'science') {
          ctx.beginPath(); ctx.arc(px - 7, py + 10, 4, 0, TAU); ctx.stroke();
          ctx.beginPath(); ctx.arc(px + 5, py + 10, 4, 0, TAU); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(px - 7, py + 14); ctx.lineTo(px + 5, py + 14); ctx.stroke();
        } else if (d.icon === 'language') {
          ctx.beginPath(); ctx.moveTo(px - 13, py + 10); ctx.lineTo(px - 7, py + 16); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(px - 13, py + 16); ctx.lineTo(px - 7, py + 10); ctx.stroke();
        } else if (d.icon === 'history') {
          ctx.beginPath(); ctx.arc(px - 2, py + 13, 6, 0, TAU); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(px - 2, py + 13); ctx.lineTo(px - 2, py + 8); ctx.stroke();
        }
        break;
      }
      case 'fumehood': {
        const fw = w * T, fh = h * T;
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        roundRect(ctx, px + 3, py + 6, fw, fh, 4); ctx.fill();
        ctx.fillStyle = '#3f4b5c';
        roundRect(ctx, px, py, fw, fh, 4); ctx.fill();
        ctx.fillStyle = '#6d7f95';
        roundRect(ctx, px + 2, py + 2, fw - 4, fh * 0.38, 3); ctx.fill();
        ctx.fillStyle = 'rgba(150,230,240,0.55)';
        roundRect(ctx, px + 4, py + fh * 0.42, fw - 8, fh * 0.34, 2); ctx.fill();
        ctx.fillStyle = '#c7d6e6';
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(px + 7 + i * (fw - 16) / 2.2, py + fh * 0.47, 2, 8);
        }
        ctx.fillStyle = '#2b3340';
        ctx.fillRect(px + fw - 14, py + 4, 8, 4);
        break;
      }
      case 'globe': {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath(); ctx.ellipse(px + 2, py + 13, 15, 5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#8a6a44';
        ctx.fillRect(px - 3, py + 3, 6, 12);
        ctx.fillStyle = '#6f5334';
        roundRect(ctx, px - 11, py + 13, 22, 5, 2); ctx.fill();
        ctx.fillStyle = '#3d8fc4';
        ctx.beginPath(); ctx.arc(px, py - 4, 12, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5fbf7a';
        ctx.beginPath(); ctx.arc(px - 5, py - 7, 4.5, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(px + 5, py - 1, 3.5, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(230,245,255,0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(px, py - 4, 4, 12, 0.35, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(px, py - 4, 12, 0, TAU); ctx.stroke();
        break;
      }
      case 'coffee': {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        roundRect(ctx, px - 14, py + 6, 38, 20, 3); ctx.fill();
        ctx.fillStyle = '#3d3a40';
        roundRect(ctx, px - 16, py - 8, 34, 28, 4); ctx.fill();
        ctx.fillStyle = '#6b6570';
        roundRect(ctx, px - 13, py - 5, 28, 9, 2); ctx.fill();
        ctx.fillStyle = '#1c1c22';
        ctx.fillRect(px - 8, py + 6, 14, 9);
        ctx.fillStyle = '#b9834b';
        ctx.fillRect(px - 9, py + 12, 5, 3);
        ctx.fillStyle = 'rgba(245,235,215,0.75)';
        const t = performance.now() / 1000;
        for (let i = 0; i < 2; i++) {
          const sx = px + 5 + i * 4;
          ctx.beginPath();
          ctx.arc(sx, py - 12 - Math.sin(t * 2 + i) * 2, 2.2, 0, TAU); ctx.fill();
        }
        break;
      }
      case 'crate': {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        roundRect(ctx, px - 14, py + 8, 34, 18, 3); ctx.fill();
        ctx.fillStyle = '#8a623b';
        roundRect(ctx, px - 16, py - 4, 32, 24, 3); ctx.fill();
        ctx.strokeStyle = '#5f4027';
        ctx.lineWidth = 2;
        ctx.strokeRect(px - 13, py - 1, 26, 18);
        ctx.beginPath(); ctx.moveTo(px - 13, py - 1); ctx.lineTo(px + 13, py + 17); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px + 13, py - 1); ctx.lineTo(px - 13, py + 17); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(px - 16, py - 4, 32, 3);
        break;
      }
      case 'wallbars': {
        const bw = w * T;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        roundRect(ctx, px + 3, py + 5, bw, 12, 3); ctx.fill();
        ctx.fillStyle = '#6b5136';
        roundRect(ctx, px, py, bw, 13, 3); ctx.fill();
        ctx.fillStyle = '#d6b17a';
        for (let i = 1; i < 7; i++) {
          const bx = px + (bw / 7) * i;
          ctx.fillRect(bx - 1.5, py - 10, 3, 20);
          ctx.beginPath(); ctx.arc(bx, py + 10, 2.2, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = '#8a6a44';
        ctx.fillRect(px + 2, py - 10, bw - 4, 3);
        break;
      }
      case 'curtain': {
        const bw = w * T, bh = h * T;
        ctx.fillStyle = 'rgba(0,0,0,0.24)';
        roundRect(ctx, px + 2, py + 5, bw, bh, 4); ctx.fill();
        ctx.fillStyle = '#642036';
        roundRect(ctx, px, py, bw, bh, 4); ctx.fill();
        // Pliegues verticales del telon.
        for (let i = 0; i < 10; i++) {
          const fx = px + (bw / 10) * i;
          ctx.fillStyle = i % 2 ? 'rgba(255,170,195,0.12)' : 'rgba(20,0,12,0.16)';
          ctx.fillRect(fx, py + 2, bw / 16, bh - 4);
        }
        ctx.fillStyle = '#c9a227';
        ctx.fillRect(px, py + bh - 4, bw, 3);
        break;
      }
      case 'lockers': {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        roundRect(ctx, px - 20, py + 6, 42, 16, 3); ctx.fill();
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i % 2 ? '#3f6ea8' : '#37628f';
          roundRect(ctx, px - 22 + i * 15, py - 12, 14, 26, 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.16)';
          roundRect(ctx, px - 22 + i * 15, py - 12, 14, 5, 2); ctx.fill();
          // rejillas de ventilacion
          ctx.fillStyle = 'rgba(10,20,35,0.28)';
          for (let v = 0; v < 3; v++) ctx.fillRect(px - 18 + i * 15, py - 3 + v * 3.5, 7, 1);
          // numero de taquilla y pomo
          ctx.fillStyle = 'rgba(225,238,255,0.78)';
          ctx.font = 'bold 6px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String((i + 1) + Math.round(px / T) % 10).padStart(2, '0'), px - 15 + i * 15, py + 11);
          ctx.fillStyle = 'rgba(220,230,245,0.7)';
          ctx.fillRect(px - 12 + i * 15, py - 2, 3, 6);
        }
        ctx.restore();
        break;
      }
      case 'sign': {
        ctx.fillStyle = '#6b7280';
        ctx.fillRect(px - 2, py - 22, 4, 26);
        ctx.fillStyle = '#f0e6d2';
        roundRect(ctx, px - 26, py - 40, 52, 22, 3); ctx.fill();
        ctx.strokeStyle = '#8a7a5c';
        ctx.lineWidth = 2;
        roundRect(ctx, px - 26, py - 40, 52, 22, 3); ctx.stroke();
        ctx.fillStyle = '#2f8f5b';
        roundRect(ctx, px - 22, py - 36, 8, 14, 2); ctx.fill();
        ctx.fillStyle = '#3a4a5c';
        ctx.fillRect(px - 10, py - 34, 30, 3);
        ctx.fillRect(px - 10, py - 28, 22, 3);
        break;
      }
      case 'goal': {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath(); ctx.ellipse(px, py + 12, 34, 9, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#e8eef8';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(px - 32, py + 12); ctx.lineTo(px - 32, py - 4);
        ctx.lineTo(px + 32, py - 4); ctx.lineTo(px + 32, py + 12);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(230,240,255,0.35)';
        ctx.lineWidth = 1;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath(); ctx.moveTo(px + i * 12, py - 4); ctx.lineTo(px + i * 12, py + 12); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(px - 32, py + 4); ctx.lineTo(px + 32, py + 4); ctx.stroke();
        break;
      }
      case 'cabinet': {
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        roundRect(ctx, px + 3, py + 8, w * T, h * T, 3); ctx.fill();
        ctx.fillStyle = '#4a5262';
        roundRect(ctx, px, py, w * T, h * T, 3); ctx.fill();
        ctx.fillStyle = '#5d6779';
        roundRect(ctx, px, py, w * T, 8, 3); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.32)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 3; i++) {
          ctx.beginPath(); ctx.moveTo(px, py + (h * T / 3) * i); ctx.lineTo(px + w * T, py + (h * T / 3) * i); ctx.stroke();
        }
        break;
      }
      case 'plant': {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(px + 2, py + 10, 14, 6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#8a5a3c';
        roundRect(ctx, px - 10, py - 2, 20, 16, 3); ctx.fill();
        ctx.fillStyle = '#3f8f52';
        ctx.beginPath(); ctx.arc(px - 6, py - 10, 9, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(px + 6, py - 12, 10, 0, TAU); ctx.fill();
        ctx.fillStyle = '#4fae63';
        ctx.beginPath(); ctx.arc(px, py - 20, 9, 0, TAU); ctx.fill();
        break;
      }
      case 'bench':
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        roundRect(ctx, px - 26, py + 4, 52, 14, 4); ctx.fill();
        ctx.fillStyle = '#7a5637';
        roundRect(ctx, px - 26, py - 6, 52, 14, 4); ctx.fill();
        ctx.fillStyle = '#95704a';
        roundRect(ctx, px - 26, py - 6, 52, 5, 3); ctx.fill();
        break;
      case 'counter':
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        roundRect(ctx, px, py + 6, w * T, h * T, 5); ctx.fill();
        ctx.fillStyle = '#5a4436';
        roundRect(ctx, px, py, w * T, h * T, 5); ctx.fill();
        ctx.fillStyle = '#7a5c46';
        roundRect(ctx, px, py, w * T, 8, 4); ctx.fill();
        break;
      case 'trim':
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 2;
        roundRect(ctx, px, py, w * T, h * T, 6); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.16)';
        ctx.lineWidth = 1;
        roundRect(ctx, px + 4, py + 4, w * T - 8, h * T - 8, 4); ctx.stroke();
        break;
      case 'rug': {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        roundRect(ctx, px + 4, py + 6, w * T, h * T, 8); ctx.fill();
        ctx.fillStyle = 'rgba(116,84,180,0.38)';
        roundRect(ctx, px, py, w * T, h * T, 8); ctx.fill();
        ctx.strokeStyle = 'rgba(200,170,255,0.45)';
        ctx.lineWidth = 3;
        roundRect(ctx, px + 7, py + 7, w * T - 14, h * T - 14, 6); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        roundRect(ctx, px + w * T * 0.32, py + h * T * 0.32, w * T * 0.36, h * T * 0.36, 4); ctx.fill();
        break;
      }
      case 'runner': {
        const rw = w * T, rh = h * T;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        roundRect(ctx, px + 3, py + 5, rw, rh, 10); ctx.fill();
        const rg = ctx.createLinearGradient(px, py, px, py + rh);
        rg.addColorStop(0, '#4b2f55');
        rg.addColorStop(0.5, d.color || '#3d2748');
        rg.addColorStop(1, '#2d1d36');
        ctx.fillStyle = rg;
        roundRect(ctx, px, py, rw, rh, 9); ctx.fill();
        ctx.strokeStyle = 'rgba(232,194,118,0.34)';
        ctx.lineWidth = 2.5;
        roundRect(ctx, px, py, rw, rh, 9); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        roundRect(ctx, px + 5, py + 5, rw - 10, rh - 10, 6); ctx.stroke();
        ctx.fillStyle = 'rgba(232,194,118,0.18)';
        ctx.fillRect(px + 9, py + 3.5, rw - 18, 1.5);
        ctx.fillRect(px + 9, py + rh - 5, rw - 18, 1.5);
        ctx.fillStyle = 'rgba(255,225,160,0.15)';
        for (let dx = 30; dx < rw - 20; dx += T * 2.2) {
          const cx2 = px + dx, cy2 = py + rh / 2;
          ctx.beginPath();
          ctx.moveTo(cx2, cy2 - 5);
          ctx.lineTo(cx2 + 7, cy2);
          ctx.lineTo(cx2, cy2 + 5);
          ctx.lineTo(cx2 - 7, cy2);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'emblem': {
        const cx = px, cy = py, rr = (d.r || 3) * T;
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = 'rgba(12,20,16,0.55)';
        ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.94, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(240,230,190,0.5)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.94, 0, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx, cy, rr * 0.78, rr * 0.72, 0, 0, TAU); ctx.stroke();
        // escudo
        ctx.fillStyle = 'rgba(240,220,140,0.34)';
        ctx.beginPath();
        ctx.moveTo(cx, cy - rr * 0.52);
        ctx.lineTo(cx + rr * 0.44, cy - rr * 0.34);
        ctx.lineTo(cx + rr * 0.36, cy + rr * 0.18);
        ctx.quadraticCurveTo(cx, cy + rr * 0.62, cx - rr * 0.36, cy + rr * 0.18);
        ctx.lineTo(cx - rr * 0.44, cy - rr * 0.34);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,240,190,0.55)';
        ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = 'rgba(255,240,190,0.6)';
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rad = i % 2 ? rr * 0.1 : rr * 0.24;
          ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
        }
        ctx.closePath(); ctx.fill();
        ctx.restore();
        break;
      }
      case 'flowerbed': {
        ctx.fillStyle = '#4a3a2a';
        roundRect(ctx, px, py, w * T, h * T, 6); ctx.fill();
        ctx.strokeStyle = 'rgba(200,190,170,0.35)';
        ctx.lineWidth = 3;
        ctx.strokeRect(px + 2, py + 2, w * T - 4, h * T - 4);
        const cols = ['#ff7b9c', '#ffd166', '#c77dff', '#ff9f6e'];
        for (let i = 0; i < 12; i++) {
          const fx = px + 14 + (i * 37) % Math.max(20, w * T - 28);
          const fy = py + h * T * 0.5 + Math.sin(i * 1.7) * h * T * 0.24;
          ctx.strokeStyle = '#3f8f52'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(fx, fy + 3); ctx.lineTo(fx, fy - 5); ctx.stroke();
          ctx.fillStyle = cols[i % cols.length];
          ctx.beginPath(); ctx.arc(fx, fy - 7, 3.4, 0, TAU); ctx.fill();
        }
        break;
      }
      case 'windows': {
        const ww = w * T, wh = h * T;
        ctx.fillStyle = 'rgba(120,200,240,0.30)';
        roundRect(ctx, px, py + 3, ww, wh, 4); ctx.fill();
        ctx.fillStyle = 'rgba(190,235,255,0.22)';
        roundRect(ctx, px + 2, py + 5, ww - 4, wh * 0.42, 3); ctx.fill();
        ctx.strokeStyle = 'rgba(185,220,250,0.55)';
        ctx.lineWidth = 2;
        roundRect(ctx, px, py + 3, ww, wh, 4); ctx.stroke();
        ctx.fillStyle = 'rgba(210,235,255,0.45)';
        ctx.fillRect(px + ww / 2 - 1, py + 3, 2, wh);
        break;
      }
      case 'hopscotch': {
        const cw = (w * T) / 2, ch = (h * T) / 5;
        ctx.save();
        ctx.globalAlpha = 0.55;
        for (let i = 0; i < 5; i++) {
          const n = i + 1;
          const cols2 = i === 1 || i === 3 ? 2 : 1;
          for (let j = 0; j < cols2; j++) {
            const bw = cols2 === 1 ? cw : cw / 2;
            const bx2 = px + (cols2 === 1 ? cw / 2 : j * cw + cw / 4);
            ctx.strokeStyle = 'rgba(255,245,210,0.75)';
            ctx.lineWidth = 3;
            ctx.strokeRect(bx2, py + i * ch, bw, ch);
            ctx.fillStyle = 'rgba(255,245,210,0.85)';
            ctx.font = 'bold 13px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(n), bx2 + bw / 2, py + i * ch + ch / 2);
          }
        }
        ctx.restore();
        break;
      }
      case 'picnic': {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        roundRect(ctx, px - 30, py + 12, 70, 18, 4); ctx.fill();
        ctx.fillStyle = '#8a6242';
        roundRect(ctx, px - 32, py, 64, 16, 4); ctx.fill();
        ctx.fillStyle = '#a97b52';
        roundRect(ctx, px - 32, py, 64, 5, 3); ctx.fill();
        ctx.fillStyle = '#6e4c32';
        ctx.fillRect(px - 24, py + 16, 4, 12);
        ctx.fillRect(px + 20, py + 16, 4, 12);
        ctx.fillStyle = '#7a5637';
        roundRect(ctx, px - 28, py + 22, 26, 6, 2); ctx.fill();
        roundRect(ctx, px + 2, py + 22, 26, 6, 2); ctx.fill();
        ctx.fillStyle = '#f0e6d2';
        ctx.beginPath(); ctx.arc(px - 9, py + 7, 4.5, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(px + 9, py + 7, 4.5, 0, TAU); ctx.fill();
        break;
      }
      case 'foodstall': {
        const fc = d.color || '#ff8f6b';
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        roundRect(ctx, px - 6, py + 34, 82, 16, 5); ctx.fill();
        ctx.fillStyle = '#6e4c32';
        roundRect(ctx, px - 8, py + 6, 86, 34, 5); ctx.fill();
        ctx.fillStyle = '#a97b52';
        roundRect(ctx, px - 4, py + 13, 78, 10, 3); ctx.fill();
        ctx.fillStyle = fc;
        roundRect(ctx, px - 12, py - 10, 94, 18, 4); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        for (let i = 0; i < 5; i++) {
          roundRect(ctx, px - 8 + i * 18, py - 8, 9, 14, 2); ctx.fill();
        }
        ctx.fillStyle = '#2b1d16';
        ctx.fillRect(px - 2, py + 25, 74, 3);
        ctx.fillStyle = '#f4e7c3';
        roundRect(ctx, px, py + 17, 72, 7, 2); ctx.fill();
        const foods = ['#ffd166', '#ff8f6b', '#7ee787', '#c77dff'];
        for (let i = 0; i < 7; i++) {
          ctx.fillStyle = foods[i % foods.length];
          ctx.beginPath(); ctx.arc(px + 7 + i * 10, py + 20, 3.2, 0, TAU); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(px - 4, py + 2); ctx.lineTo(px + 78, py + 2); ctx.stroke();
        break;
      }
      case 'bin': {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(px + 2, py + 12, 14, 5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2f5a44';
        roundRect(ctx, px - 11, py - 4, 22, 18, 4); ctx.fill();
        ctx.fillStyle = '#3d7a5a';
        roundRect(ctx, px - 13, py - 8, 26, 7, 3); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(px - 8, py, 16, 2);
        break;
      }
      case 'hedge': {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        roundRect(ctx, px + 2, py + 8, w * T, h * T, 6); ctx.fill();
        ctx.fillStyle = '#2f6b3f';
        roundRect(ctx, px, py + 2, w * T, h * T, 6); ctx.fill();
        ctx.fillStyle = '#3d8b4f';
        roundRect(ctx, px, py, w * T, h * T - 4, 6); ctx.fill();
        ctx.fillStyle = 'rgba(120,200,130,0.45)';
        for (let i = 0; i < 10; i++) {
          const hx2 = px + 10 + (i * 53) % Math.max(16, w * T - 20);
          const hy2 = py + 8 + (i * 31) % Math.max(8, h * T - 20);
          ctx.beginPath(); ctx.arc(hx2, hy2, 3.2, 0, TAU); ctx.fill();
        }
        break;
      }
      case 'piano': {
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        roundRect(ctx, px, py + 8, 58, 34, 4); ctx.fill();
        ctx.fillStyle = '#22222c';
        roundRect(ctx, px, py, 58, 36, 4); ctx.fill();
        ctx.fillStyle = '#f4f4f8';
        ctx.fillRect(px + 5, py + 22, 48, 12);
        ctx.fillStyle = '#15151b';
        for (let i = 0; i < 9; i++) {
          const kx = px + 6 + i * 5.3;
          if (i % 7 !== 2 && i % 7 !== 6) ctx.fillRect(kx, py + 22, 3, 7);
        }
        ctx.fillStyle = '#3b3b4a';
        ctx.fillRect(px + 8, py + 6, 42, 4);
        break;
      }
      case 'vending': {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        roundRect(ctx, px + 3, py + 6, 40, 48, 4); ctx.fill();
        ctx.fillStyle = '#2b3d5c';
        roundRect(ctx, px, py, 40, 50, 4); ctx.fill();
        ctx.fillStyle = '#79c8ff';
        roundRect(ctx, px + 4, py + 5, 24, 30, 3); ctx.fill();
        const snacks = ['#ff6b6b', '#ffd166', '#7ee787', '#c77dff'];
        for (let i = 0; i < 8; i++) {
          ctx.fillStyle = snacks[i % snacks.length];
          ctx.fillRect(px + 7 + (i % 3) * 7, py + 9 + Math.floor(i / 3) * 8, 6, 6);
        }
        ctx.fillStyle = '#1a2436';
        ctx.fillRect(px + 31, py + 8, 6, 12);
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(px + 32, py + 10, 4, 3);
        ctx.fillStyle = '#101827';
        roundRect(ctx, px + 4, py + 39, 24, 6, 2); ctx.fill();
        break;
      }
      case 'menu': {
        ctx.fillStyle = '#2f2a24';
        roundRect(ctx, px - 4, py - 4, w * T + 8, 30, 4); ctx.fill();
        ctx.fillStyle = '#1f4a3a';
        roundRect(ctx, px, py, w * T, 22, 3); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.fillText('MENU DEL DIA', px + w * T / 2, py + 15);
        break;
      }
      case 'server': {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        roundRect(ctx, px + 2, py + 6, 34, 46, 3); ctx.fill();
        ctx.fillStyle = '#242c3a';
        roundRect(ctx, px, py, 34, 46, 3); ctx.fill();
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = '#39465a';
          roundRect(ctx, px + 4, py + 5 + i * 8, 26, 6, 2); ctx.fill();
          ctx.fillStyle = i % 2 ? '#7ee787' : '#5aa9ff';
          ctx.fillRect(px + 6, py + 7 + i * 8, 3, 3);
        }
        break;
      }
      case 'toolwall': {
        ctx.fillStyle = '#3c342a';
        roundRect(ctx, px, py, w * T, 24, 3); ctx.fill();
        ctx.fillStyle = '#5c5040';
        roundRect(ctx, px + 3, py + 3, w * T - 6, 18, 2); ctx.fill();
        ctx.strokeStyle = '#d9dde6'; ctx.lineWidth = 2;
        for (let i = 0; i < 5; i++) {
          const tx2 = px + 14 + i * (w * T - 28) / 4;
          ctx.beginPath(); ctx.moveTo(tx2 - 6, py + 8); ctx.lineTo(tx2 + 4, py + 8); ctx.stroke();
          ctx.beginPath(); ctx.arc(tx2 + 6, py + 8, 3, 0, TAU); ctx.stroke();
        }
        break;
      }
      case 'flasks': {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(px + 22, py + 22, 22, 6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(150,230,240,0.85)';
        ctx.beginPath();
        ctx.moveTo(px + 8, py + 6); ctx.lineTo(px + 8, py + 14);
        ctx.lineTo(px + 2, py + 22); ctx.lineTo(px + 14, py + 22); ctx.lineTo(px + 8, py + 14);
        ctx.fill();
        ctx.fillStyle = 'rgba(180,255,200,0.85)';
        roundRect(ctx, px + 20, py + 10, 9, 14, 3); ctx.fill();
        ctx.fillStyle = '#ffd166';
        roundRect(ctx, px + 34, py + 13, 8, 11, 3); ctx.fill();
        break;
      }
      case 'sofa': {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        roundRect(ctx, px - 26, py + 10, 62, 24, 6); ctx.fill();
        ctx.fillStyle = '#4a5f86';
        roundRect(ctx, px - 30, py - 2, 60, 30, 7); ctx.fill();
        ctx.fillStyle = '#5f79a8';
        roundRect(ctx, px - 26, py + 2, 52, 16, 5); ctx.fill();
        ctx.fillStyle = '#7795c9';
        roundRect(ctx, px - 22, py + 5, 20, 12, 4); ctx.fill();
        roundRect(ctx, px + 2, py + 5, 20, 12, 4); ctx.fill();
        break;
      }
      case 'trophy': {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        roundRect(ctx, px - 18, py + 6, 42, 38, 3); ctx.fill();
        ctx.fillStyle = '#4a3a2c';
        roundRect(ctx, px - 22, py - 2, 42, 44, 3); ctx.fill();
        ctx.fillStyle = 'rgba(150,210,255,0.18)';
        roundRect(ctx, px - 18, py + 2, 34, 36, 2); ctx.fill();
        for (let i = 0; i < 3; i++) {
          const tx2 = px - 13 + i * 11, ty = py + 30;
          ctx.fillStyle = '#c9a227';
          ctx.beginPath();
          ctx.moveTo(tx2 - 4, ty - 12); ctx.lineTo(tx2 + 4, ty - 12);
          ctx.lineTo(tx2 + 2, ty - 4); ctx.lineTo(tx2 - 2, ty - 4);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#e8c85a';
          ctx.beginPath(); ctx.arc(tx2, ty - 15, 4, 0, TAU); ctx.fill();
          ctx.fillStyle = '#8a6a20';
          ctx.fillRect(tx2 - 5, ty - 3, 10, 3);
        }
        break;
      }
      case 'water': {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(px + 3, py + 20, 16, 6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#9aa6ba';
        roundRect(ctx, px - 12, py - 2, 26, 22, 5); ctx.fill();
        ctx.fillStyle = '#c7d2e4';
        roundRect(ctx, px - 9, py + 1, 20, 10, 3); ctx.fill();
        ctx.fillStyle = '#3d78a8';
        ctx.beginPath(); ctx.ellipse(px, py + 6, 5, 2.5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#7fe0ff';
        ctx.fillRect(px - 1, py + 7, 2, 8);
        break;
      }
      case 'clock': {
        const cx = px, cy = py;
        ctx.fillStyle = '#1b2230';
        ctx.beginPath(); ctx.arc(cx, cy, 13, 0, TAU); ctx.fill();
        ctx.fillStyle = '#eef3fb';
        ctx.beginPath(); ctx.arc(cx, cy, 10, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#2b3446'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + 5, cy + 2); ctx.stroke();
        break;
      }
      case 'poster': {
        const col = d.color || '#5aa9ff';
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        roundRect(ctx, px - 15, py - 22, 30, 40, 3); ctx.fill();
        ctx.fillStyle = '#f0ead8';
        roundRect(ctx, px - 17, py - 24, 30, 40, 3); ctx.fill();
        ctx.fillStyle = col;
        ctx.fillRect(px - 13, py - 20, 22, 16);
        ctx.fillStyle = '#3c4658';
        ctx.fillRect(px - 13, py + 1, 22, 2);
        ctx.fillRect(px - 13, py + 6, 16, 2);
        ctx.fillRect(px - 13, py + 11, 19, 2);
        break;
      }
      case 'scoreboard': {
        ctx.fillStyle = '#12161f';
        roundRect(ctx, px - 46, py - 14, 92, 34, 4); ctx.fill();
        ctx.strokeStyle = '#39465a'; ctx.lineWidth = 2;
        roundRect(ctx, px - 46, py - 14, 92, 34, 4); ctx.stroke();
        ctx.fillStyle = '#ff5d5d';
        ctx.font = 'bold 15px ui-monospace, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('12 : 08', px - 14, py + 2);
        ctx.fillStyle = '#7ee787';
        ctx.fillText('4', px + 30, py + 2);
        break;
      }
      case 'bikes': {
        ctx.strokeStyle = 'rgba(200,210,230,0.7)'; ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath(); ctx.arc(px - 18 + i * 20, py + 6, 6, 0, TAU); ctx.stroke();
        }
        ctx.strokeStyle = '#8fa3c4'; ctx.lineWidth = 2;
        for (let i = 0; i < 2; i++) {
          const bx2 = px - 20 + i * 22;
          ctx.beginPath(); ctx.arc(bx2, py + 18, 7, 0, TAU); ctx.stroke();
          ctx.beginPath(); ctx.arc(bx2 + 18, py + 18, 7, 0, TAU); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(bx2, py + 18); ctx.lineTo(bx2 + 6, py + 8);
          ctx.lineTo(bx2 + 14, py + 8); ctx.lineTo(bx2 + 18, py + 18);
          ctx.lineTo(bx2 + 9, py + 18); ctx.lineTo(bx2 + 6, py + 8);
          ctx.stroke();
        }
        break;
      }
      case 'dumpster': {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        roundRect(ctx, px - 19, py + 6, 44, 26, 3); ctx.fill();
        ctx.fillStyle = '#2f6b3f';
        roundRect(ctx, px - 22, py - 2, 44, 30, 3); ctx.fill();
        ctx.fillStyle = '#3d8b4f';
        roundRect(ctx, px - 24, py - 6, 48, 10, 3); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(px - 16, py + 6, 32, 2);
        break;
      }
      case 'missionpad': {
        const pw = w * T, ph = h * T;
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = d.color;
        roundRect(ctx, px + 4, py + 4, pw - 8, ph - 8, 14); ctx.fill();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([9, 7]);
        roundRect(ctx, px + 6, py + 6, pw - 12, ph - 12, 12); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = d.color;
        for (let i = 0; i < 4; i++) {
          const sx2 = px + 10 + (i % 2) * (pw - 26);
          const sy2 = py + 10 + Math.floor(i / 2) * (ph - 26);
          ctx.fillRect(sx2, sy2, 10, 3);
          ctx.fillRect(sx2, sy2, 3, 10);
        }
        ctx.restore();
        break;
      }
      case 'path': {
        const pw = w * T, ph = h * T;
        ctx.fillStyle = '#3a4551';
        roundRect(ctx, px, py, pw, ph, 10); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        for (let ix = 1; ix < w; ix++) {
          ctx.beginPath(); ctx.moveTo(px + ix * T, py + 4); ctx.lineTo(px + ix * T, py + ph - 4); ctx.stroke();
        }
        for (let iy = 1; iy < h; iy++) {
          ctx.beginPath(); ctx.moveTo(px + 4, py + iy * T); ctx.lineTo(px + pw - 4, py + iy * T); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(200,220,245,0.18)';
        ctx.lineWidth = 3;
        roundRect(ctx, px + 1.5, py + 1.5, pw - 3, ph - 3, 9); ctx.stroke();
        break;
      }
      case 'plaza': {
        const pw = w * T, ph = h * T;
        ctx.save();
        const pg = ctx.createLinearGradient(px, py, px, py + ph);
        pg.addColorStop(0, '#5d6670');
        pg.addColorStop(0.55, '#505963');
        pg.addColorStop(1, '#444c56');
        ctx.fillStyle = pg;
        roundRect(ctx, px, py, pw, ph, 12); ctx.fill();
        ctx.save();
        roundRect(ctx, px, py, pw, ph, 12); ctx.clip();
        for (let row = 0; row < h; row++) {
          const yy = py + row * T;
          ctx.strokeStyle = 'rgba(255,255,255,0.055)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(px, yy); ctx.lineTo(px + pw, yy); ctx.stroke();
          const off = row % 2 ? T * 0.5 : 0;
          for (let xx = px + off; xx < px + pw; xx += T) {
            ctx.strokeStyle = 'rgba(35,40,48,0.26)';
            ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy + T); ctx.stroke();
          }
        }
        ctx.fillStyle = 'rgba(255,255,255,0.026)';
        for (let i = 0; i < 18; i++) {
          const sx = px + 20 + (i * 83) % Math.max(20, pw - 40);
          const sy = py + 18 + (i * 57) % Math.max(20, ph - 36);
          ctx.fillRect(sx, sy, 16, 2);
        }
        const cx = px + pw / 2, cy = py + ph * 0.46;
        const rad = Math.min(pw, ph) * 0.22;
        ctx.globalAlpha = 0.42;
        ctx.strokeStyle = 'rgba(245,220,160,0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, rad * 0.72, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(245,220,160,0.75)';
        for (let i = 0; i < 8; i++) {
          const a = -Math.PI / 2 + i * TAU / 8;
          const long = i % 2 === 0 ? rad * 0.95 : rad * 0.48;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a - 0.14) * rad * 0.16, cy + Math.sin(a - 0.14) * rad * 0.16);
          ctx.lineTo(cx + Math.cos(a) * long, cy + Math.sin(a) * long);
          ctx.lineTo(cx + Math.cos(a + 0.14) * rad * 0.16, cy + Math.sin(a + 0.14) * rad * 0.16);
          ctx.closePath(); ctx.fill();
        }
        ctx.font = 'bold 8px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('N', cx, cy - rad - 8);
        ctx.restore();
        ctx.strokeStyle = 'rgba(238,205,140,0.32)';
        ctx.lineWidth = 3;
        roundRect(ctx, px + 2, py + 2, pw - 4, ph - 4, 11); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'runway': {
        const rw = w * T, rh = h * T;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        roundRect(ctx, px + 2, py + 3, rw, rh, 3); ctx.fill();
        ctx.fillStyle = '#8b4a3a';
        roundRect(ctx, px, py, rw, rh, 3); ctx.fill();
        ctx.strokeStyle = 'rgba(255,245,225,0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 2, py + 2, rw - 4, rh - 4);
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(px + 4, py + rh * 0.5 - 1, rw - 8, 2);
        ctx.fillStyle = '#f0e6d2';
        ctx.fillRect(px + rw - T * 0.55, py + 3, T * 0.55, rh - 6);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (let i = 0; i < 4; i++) {
          const cx2 = px + 12 + i * T * 0.8;
          ctx.beginPath();
          ctx.moveTo(cx2, py + rh * 0.3);
          ctx.lineTo(cx2 + 8, py + rh * 0.5);
          ctx.lineTo(cx2, py + rh * 0.7);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'planter': {
        const pw = w * T, ph = h * T;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        roundRect(ctx, px + 2, py + 5, pw, ph, 5); ctx.fill();
        ctx.fillStyle = '#6b4b2f';
        roundRect(ctx, px, py, pw, ph, 5); ctx.fill();
        ctx.fillStyle = '#8a6541';
        roundRect(ctx, px + 2, py + 2, pw - 4, ph - 8, 4); ctx.fill();
        ctx.fillStyle = '#3f2e1e';
        roundRect(ctx, px + 4, py + 4, pw - 8, ph - 12, 3); ctx.fill();
        for (let i = 0; i < 5; i++) {
          const bx = px + 8 + i * (pw - 16) / 4;
          ctx.fillStyle = i % 2 ? '#3f8f52' : '#4fae63';
          ctx.beginPath(); ctx.arc(bx, py + ph * 0.38, 6, 0, TAU); ctx.fill();
        }
        const col = d.color || '#ff8fb1';
        ctx.fillStyle = col;
        for (let i = 0; i < 4; i++) {
          const bx = px + 10 + i * (pw - 20) / 3;
          ctx.beginPath(); ctx.arc(bx, py + ph * 0.2, 3, 0, TAU); ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'lamppost': {
        ctx.save();
        const lx = px, ly = py;
        const ga = S.night ? 0.34 : 0.12;
        const gg = ctx.createRadialGradient(lx, ly - 32, 2, lx, ly - 32, T * 2.8);
        gg.addColorStop(0, 'rgba(255,226,150,' + ga + ')');
        gg.addColorStop(0.5, 'rgba(255,210,115,' + (ga * 0.35) + ')');
        gg.addColorStop(1, 'rgba(255,210,115,0)');
        ctx.fillStyle = gg;
        ctx.fillRect(lx - T * 2.8, ly - T * 2.8 - 32, T * 5.6, T * 5.6);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(lx + 2, ly + 5, 12, 5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2e3542';
        ctx.fillRect(lx - 2, ly - 30, 4, 34);
        ctx.fillStyle = '#4d5868';
        ctx.fillRect(lx - 3, ly - 2, 6, 4);
        ctx.fillStyle = '#f7d98a';
        roundRect(ctx, lx - 8, ly - 42, 16, 14, 4); ctx.fill();
        ctx.fillStyle = '#5a4a2e';
        roundRect(ctx, lx - 10, ly - 45, 20, 5, 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(lx - 5, ly - 39, 10, 3);
        ctx.restore();
        break;
      }
      case 'bush': {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.26)';
        ctx.beginPath(); ctx.ellipse(px + 2, py + 9, 18, 7, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2f6b3f';
        ctx.beginPath(); ctx.arc(px - 8, py, 10, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(px + 8, py - 2, 11, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3d8b4f';
        ctx.beginPath(); ctx.arc(px, py - 8, 12, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(150,220,150,0.42)';
        ctx.beginPath(); ctx.arc(px - 4, py - 12, 4, 0, TAU); ctx.fill();
        ctx.restore();
        break;
      }
      case 'huerto': {
        const pw = w * T, ph = h * T;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        roundRect(ctx, px + 3, py + 5, pw, ph, 8); ctx.fill();
        ctx.fillStyle = 'rgba(55,42,28,0.68)';
        roundRect(ctx, px, py, pw, ph, 8); ctx.fill();
        ctx.strokeStyle = '#9a7446';
        ctx.lineWidth = 3;
        roundRect(ctx, px + 4, py + 4, pw - 8, ph - 8, 6); ctx.stroke();
        for (let b = 0; b < 3; b++) {
          const bx = px + T * 0.75, by = py + T * 1.35 + b * T * 2.35;
          const bw = pw - T * 1.5, bh = T * 1.25;
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          roundRect(ctx, bx + 2, by + 4, bw, bh, 4); ctx.fill();
          ctx.fillStyle = '#7a5531';
          roundRect(ctx, bx, by, bw, bh, 4); ctx.fill();
          ctx.fillStyle = '#3e2c1d';
          roundRect(ctx, bx + 3, by + 3, bw - 6, bh - 6, 3); ctx.fill();
          for (let r = 0; r < 3; r++) {
            const yy = by + 8 + r * (bh - 16) / 2.2;
            for (let i = 0; i < 6; i++) {
              const xx = bx + 10 + i * (bw - 20) / 5;
              const c = (b + r + i) % 3;
              ctx.fillStyle = '#3f8f52';
              ctx.beginPath(); ctx.arc(xx, yy + 2, 4, 0, TAU); ctx.fill();
              ctx.fillStyle = c === 0 ? '#ff7b9c' : c === 1 ? '#ffd166' : '#7ee787';
              ctx.beginPath(); ctx.arc(xx, yy - 2, 2.5, 0, TAU); ctx.fill();
            }
          }
          ctx.fillStyle = '#c9a16a';
          ctx.fillRect(bx + 4, by + bh - 9, T * 0.8, 5);
        }
        const sx = px + T * 0.6, sy = py + T * 0.25;
        ctx.fillStyle = '#5a3f24';
        ctx.fillRect(sx + T * 0.95, sy + T * 0.42, 4, T * 0.7);
        ctx.fillStyle = '#e8d7b0';
        roundRect(ctx, sx, sy, T * 2.4, T * 0.55, 3); ctx.fill();
        ctx.fillStyle = '#35543c';
        ctx.font = 'bold 8px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('HUERTO ESCOLAR', sx + T * 1.2, sy + T * 0.28);
        const by2 = py + ph - T * 1.0;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(px + T * 1.2, by2 + 12, 12, 5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#4a6b78';
        roundRect(ctx, px + T * 0.85, by2 - 4, 22, 22, 4); ctx.fill();
        ctx.fillStyle = '#7fa5b2';
        roundRect(ctx, px + T * 0.9, by2, 19, 6, 2); ctx.fill();
        ctx.fillStyle = '#2f5a44';
        roundRect(ctx, px + pw - T * 1.8, by2 - 2, 26, 22, 3); ctx.fill();
        ctx.fillStyle = '#3d7a5a';
        roundRect(ctx, px + pw - T * 1.8, by2 - 6, 26, 7, 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'pergola': {
        const pw = w * T, ph = h * T;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        roundRect(ctx, px + 5, py + 7, pw, ph, 7); ctx.fill();
        // tarima de madera clara, distinta del cesped
        ctx.fillStyle = '#6d5a45';
        roundRect(ctx, px, py, pw, ph, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(255,225,170,0.14)';
        ctx.lineWidth = 1;
        for (let yy = py + 10; yy < py + ph - 8; yy += 11) {
          ctx.beginPath(); ctx.moveTo(px + 6, yy); ctx.lineTo(px + pw - 6, yy); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,230,180,0.08)';
        ctx.fillRect(px + 8, py + 8, pw - 16, 4);
        // mesa central y asientos
        ctx.fillStyle = 'rgba(20,14,8,0.28)';
        roundRect(ctx, px + pw * 0.27, py + ph * 0.42, pw * 0.46, ph * 0.26, 4); ctx.fill();
        ctx.fillStyle = '#4e3622';
        roundRect(ctx, px + pw * 0.3, py + ph * 0.35, pw * 0.4, ph * 0.22, 3); ctx.fill();
        ctx.fillStyle = '#c49a66';
        roundRect(ctx, px + pw * 0.32, py + ph * 0.37, pw * 0.36, ph * 0.13, 3); ctx.fill();
        ctx.fillStyle = '#f0e6d2';
        ctx.beginPath(); ctx.arc(px + pw * 0.4, py + ph * 0.43, 3, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(px + pw * 0.6, py + ph * 0.43, 3, 0, TAU); ctx.fill();
        ctx.fillStyle = '#7a5637';
        roundRect(ctx, px + pw * 0.25, py + ph * 0.7, pw * 0.2, 6, 2); ctx.fill();
        roundRect(ctx, px + pw * 0.55, py + ph * 0.7, pw * 0.2, 6, 2); ctx.fill();
        // postes y vigas
        ctx.fillStyle = '#4c3522';
        ctx.fillRect(px + 4, py + 4, 8, 8);
        ctx.fillRect(px + pw - 12, py + 4, 8, 8);
        ctx.fillRect(px + 4, py + ph - 12, 8, 8);
        ctx.fillRect(px + pw - 12, py + ph - 12, 8, 8);
        ctx.fillStyle = '#8a6541';
        ctx.fillRect(px + 2, py + 2, pw - 4, 5);
        ctx.fillRect(px + 2, py + ph - 7, pw - 4, 5);
        // cubierta de listones semitransparente
        ctx.globalAlpha = 0.44;
        ctx.fillStyle = '#d9b77a';
        for (let xx = px + 14; xx < px + pw - 10; xx += 13) ctx.fillRect(xx, py + 7, 4, ph - 14);
        ctx.globalAlpha = 1;
        // enredadera y flores en los bordes
        for (let i = 0; i < 9; i++) {
          const vx = px + 14 + (i * 41) % Math.max(20, pw - 28);
          const vy = py + (i % 2 ? 7 : ph - 9);
          ctx.fillStyle = '#3d8b4f';
          ctx.beginPath(); ctx.arc(vx, vy, 4, 0, TAU); ctx.fill();
          if (i % 3 === 0) {
            ctx.fillStyle = '#ff8fb1';
            ctx.beginPath(); ctx.arc(vx + 3, vy - 3, 2, 0, TAU); ctx.fill();
          }
        }
        // farolillos
        const t = performance.now() / 1000;
        for (let i = 0; i < 3; i++) {
          const lx = px + pw * (0.2 + i * 0.3), ly = py + ph * 0.17;
          const ga = S.night ? 0.55 : 0.2;
          const lg = ctx.createRadialGradient(lx, ly, 1, lx, ly, T * 1.4);
          lg.addColorStop(0, 'rgba(255,222,145,' + ga + ')');
          lg.addColorStop(1, 'rgba(255,222,145,0)');
          ctx.fillStyle = lg;
          ctx.fillRect(lx - T * 1.4, ly - T * 1.4, T * 2.8, T * 2.8);
          ctx.fillStyle = '#f7d98a';
          ctx.beginPath(); ctx.arc(lx, ly + Math.sin(t * 1.7 + i) * 1.2, 3, 0, TAU); ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'wallpanel': {
        const pw = w * T, ph = h * T;
        const style = d.style || 'mural';
        const col = d.color || '#8fd0ff';
        const label = d.text || '';
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.24)';
        roundRect(ctx, px + 2, py + 3, pw, ph, 4); ctx.fill();
        if (style === 'mural') {
          const mg = ctx.createLinearGradient(px, py, px + pw, py);
          mg.addColorStop(0, '#202a3a');
          mg.addColorStop(0.55, '#182130');
          mg.addColorStop(1, '#101722');
          ctx.fillStyle = mg;
          roundRect(ctx, px, py, pw, ph, 4); ctx.fill();
          ctx.globalAlpha = 0.55;
          const pal = [col, '#ff8fb1', '#7ee787', '#ffd166', '#8fd0ff'];
          for (let i = 0; i < 7; i++) {
            ctx.fillStyle = pal[i % pal.length];
            if (i % 2) {
              ctx.beginPath();
              ctx.arc(px + 14 + (i * 53) % Math.max(24, pw - 28), py + ph * 0.5, 5 + (i % 3) * 2, 0, TAU);
              ctx.fill();
            } else {
              ctx.fillRect(px + 12 + (i * 47) % Math.max(24, pw - 32), py + ph * 0.28, 10, ph * 0.44);
            }
          }
          ctx.globalAlpha = 1;
          ctx.fillStyle = 'rgba(8,12,20,0.58)';
          roundRect(ctx, px + pw * 0.24, py + 4, pw * 0.52, ph - 8, 3); ctx.fill();
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.5;
          roundRect(ctx, px, py, pw, ph, 4); ctx.stroke();
          ctx.fillStyle = '#f4f7ff';
          ctx.font = '900 ' + Math.max(8, Math.min(12, ph * 0.32)) + 'px system-ui, sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(label, px + pw / 2, py + ph / 2 + 1);
        } else {
          ctx.fillStyle = '#1b2433';
          roundRect(ctx, px, py, pw, ph, 4); ctx.fill();
          ctx.strokeStyle = col;
          ctx.globalAlpha = 0.8;
          ctx.lineWidth = 1.5;
          roundRect(ctx, px, py, pw, ph, 4); ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          if (style === 'numberline') {
            ctx.strokeStyle = 'rgba(240,232,210,0.7)';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(px + 9, py + ph * 0.62); ctx.lineTo(px + pw - 9, py + ph * 0.62); ctx.stroke();
            ctx.fillStyle = '#f0e6d2';
            ctx.font = 'bold 6px system-ui, sans-serif';
            for (let i = 0; i <= 10; i++) {
              const xx = px + 10 + i * (pw - 20) / 10;
              ctx.fillRect(xx - 1, py + ph * 0.52, 2, ph * 0.2);
              if (i % 2 === 0) ctx.fillText(String(i), xx, py + ph * 0.82);
            }
            ctx.fillStyle = col;
            ctx.font = 'bold 6.5px system-ui, sans-serif';
            ctx.fillText(label, px + pw / 2, py + ph * 0.22);
          } else if (style === 'periodic') {
            ctx.fillStyle = col;
            ctx.font = 'bold 6.5px system-ui, sans-serif';
            ctx.fillText(label, px + pw / 2, py + ph * 0.22);
            const cols2 = ['#ff8fb1', '#ffd166', '#7ee787', '#8fd0ff', '#c77dff'];
            for (let r = 0; r < 3; r++) {
              for (let c = 0; c < 12; c++) {
                const ex = px + 8 + c * (pw - 16) / 12;
                ctx.fillStyle = cols2[(r + c) % cols2.length];
                ctx.globalAlpha = 0.75;
                ctx.fillRect(ex, py + ph * 0.38 + r * 7, (pw - 16) / 12 - 2, 5);
              }
            }
            ctx.globalAlpha = 1;
          } else if (style === 'timeline') {
            ctx.strokeStyle = 'rgba(240,232,210,0.7)';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(px + 10, py + ph * 0.55); ctx.lineTo(px + pw - 10, py + ph * 0.55); ctx.stroke();
            ctx.font = 'bold 5.5px system-ui, sans-serif';
            const dates = ['1492', '1789', '1914', '1969'];
            for (let i = 0; i < 4; i++) {
              const xx = px + 18 + i * (pw - 36) / 3;
              ctx.fillStyle = col;
              ctx.beginPath(); ctx.arc(xx, py + ph * 0.55, 3, 0, TAU); ctx.fill();
              ctx.fillStyle = '#f0e6d2';
              ctx.fillText(dates[i], xx, py + ph * 0.82);
            }
            ctx.fillStyle = col;
            ctx.font = 'bold 6.5px system-ui, sans-serif';
            ctx.fillText(label, px + pw / 2, py + ph * 0.2);
          } else if (style === 'books') {
            ctx.fillStyle = '#5a3f24';
            ctx.fillRect(px + 6, py + ph * 0.45, pw - 12, ph * 0.34);
            const bcols = ['#ff8fb1', '#ffd166', '#7ee787', '#8fd0ff', '#c77dff'];
            for (let i = 0; i < 14; i++) {
              const bx = px + 8 + i * (pw - 16) / 14;
              ctx.fillStyle = bcols[i % bcols.length];
              ctx.fillRect(bx, py + ph * 0.46 + (i % 3) * 1.5, Math.max(2, (pw - 16) / 14 - 2), ph * 0.3 - (i % 3) * 1.5);
            }
            ctx.fillStyle = col;
            ctx.font = 'bold 6.5px system-ui, sans-serif';
            ctx.fillText(label, px + pw / 2, py + ph * 0.2);
          } else if (style === 'safety') {
            ctx.fillStyle = 'rgba(255,207,92,0.18)';
            for (let i = 0; i < 12; i++) ctx.fillRect(px + 6 + i * 14, py + 3, 7, 4);
            ctx.fillStyle = '#7ee787';
            roundRect(ctx, px + 8, py + ph * 0.35, 9, ph * 0.5, 2); ctx.fill();
            ctx.fillRect(px + 4, py + ph * 0.52, 17, 7);
            ctx.fillStyle = '#f4f7ff';
            ctx.font = 'bold 8px system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(label, px + 24, py + ph * 0.6);
          } else if (style === 'silence') {
            ctx.fillStyle = 'rgba(143,208,255,0.18)';
            roundRect(ctx, px + 5, py + 4, pw - 10, ph - 8, 3); ctx.fill();
            ctx.fillStyle = '#f4f7ff';
            ctx.beginPath(); ctx.arc(px + 16, py + ph * 0.5, 8, 0, TAU); ctx.fill();
            ctx.fillStyle = '#1b2433';
            ctx.beginPath(); ctx.arc(px + 16, py + ph * 0.5, 3, 0, TAU); ctx.fill();
            ctx.fillStyle = '#f4f7ff';
            ctx.font = 'bold 9px system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(label, px + 30, py + ph * 0.55);
          } else if (style === 'code') {
            ctx.fillStyle = '#7ee787';
            ctx.font = 'bold 7px ui-monospace, monospace';
            ctx.textAlign = 'left';
            ctx.fillText('</>', px + 8, py + ph * 0.5);
            ctx.fillStyle = 'rgba(126,231,135,0.55)';
            for (let i = 0; i < 4; i++) ctx.fillRect(px + 36, py + 8 + i * 6, (pw - 48) * (i % 2 ? 0.55 : 0.85), 2.5);
            ctx.fillStyle = col;
            ctx.font = 'bold 6.5px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(label, px + pw / 2, py + ph * 0.9);
          } else if (style === 'inventory') {
            ctx.fillStyle = '#e8d7b0';
            roundRect(ctx, px + 8, py + 4, pw - 16, ph - 8, 2); ctx.fill();
            ctx.fillStyle = '#5a3f24';
            ctx.fillRect(px + 14, py + 2, pw - 28, 4);
            ctx.fillStyle = '#9a7446';
            for (let i = 0; i < 3; i++) {
              ctx.fillRect(px + 14, py + 12 + i * 6, (pw - 28) * (0.55 + i * 0.12), 2);
              ctx.fillStyle = '#35543c';
              ctx.fillRect(px + 10, py + 11 + i * 6, 3, 3);
              ctx.fillStyle = '#9a7446';
            }
            ctx.fillStyle = col;
            ctx.font = 'bold 6.5px system-ui, sans-serif';
            ctx.fillText(label, px + pw / 2, py + ph * 0.9);
          } else if (style === 'school') {
            ctx.strokeStyle = col;
            ctx.lineWidth = 2;
            roundRect(ctx, px + 3, py + 3, pw - 6, ph - 6, 3); ctx.stroke();
            ctx.fillStyle = col;
            ctx.font = '900 10px system-ui, sans-serif';
            ctx.fillText(label, px + pw / 2, py + ph * 0.5);
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font = 'bold 5px system-ui, sans-serif';
            ctx.fillText('COLEGIO', px + pw / 2, py + ph * 0.25);
          }
        }
        ctx.restore();
        break;
      }
      case 'gallery': {
        const pw = w * T, ph = h * T;
        ctx.save();
        const gap = 6;
        const fw = (pw - gap * 5) / 4;
        const cols2 = ['#ff8fb1', '#ffd166', '#7ee787', '#8fd0ff'];
        for (let i = 0; i < 4; i++) {
          const fx = px + gap + i * (fw + gap);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          roundRect(ctx, fx + 2, py + 3, fw, ph, 2); ctx.fill();
          ctx.fillStyle = '#d8c4a0';
          roundRect(ctx, fx, py, fw, ph, 2); ctx.fill();
          ctx.fillStyle = '#f7f0df';
          ctx.fillRect(fx + 3, py + 3, fw - 6, ph - 6);
          ctx.fillStyle = cols2[i];
          if (i === 0) {
            ctx.beginPath(); ctx.arc(fx + fw * 0.7, py + ph * 0.3, 4, 0, TAU); ctx.fill();
            ctx.fillRect(fx + 6, py + ph * 0.55, fw - 12, 3);
          } else if (i === 1) {
            ctx.fillRect(fx + fw * 0.3, py + ph * 0.4, fw * 0.4, ph * 0.32);
            ctx.beginPath();
            ctx.moveTo(fx + fw * 0.22, py + ph * 0.4);
            ctx.lineTo(fx + fw * 0.5, py + ph * 0.18);
            ctx.lineTo(fx + fw * 0.78, py + ph * 0.4);
            ctx.closePath(); ctx.fill();
          } else if (i === 2) {
            ctx.beginPath(); ctx.arc(fx + fw * 0.5, py + ph * 0.28, 4, 0, TAU); ctx.fill();
            ctx.fillRect(fx + fw * 0.46, py + ph * 0.38, 3, ph * 0.35);
            ctx.fillRect(fx + fw * 0.3, py + ph * 0.7, fw * 0.4, 2);
          } else {
            for (let s = 0; s < 5; s++) {
              const a = -Math.PI / 2 + s * TAU / 5;
              ctx.beginPath(); ctx.arc(fx + fw * 0.5 + Math.cos(a) * 5, py + ph * 0.5 + Math.sin(a) * 5, 1.8, 0, TAU); ctx.fill();
            }
          }
        }
        ctx.restore();
        break;
      }
      case 'trophycase': {
        const pw = w * T, ph = h * T;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        roundRect(ctx, px + 3, py + 4, pw, ph, 3); ctx.fill();
        ctx.fillStyle = '#4a3a2c';
        roundRect(ctx, px, py, pw, ph, 3); ctx.fill();
        ctx.fillStyle = 'rgba(150,210,255,0.16)';
        roundRect(ctx, px + 4, py + 3, pw - 8, ph - 6, 2); ctx.fill();
        ctx.strokeStyle = '#8a6a44';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px + 4, py + 3, pw - 8, ph - 6);
        ctx.fillStyle = '#6b5136';
        ctx.fillRect(px + 6, py + ph * 0.54, pw - 12, 2);
        for (let i = 0; i < 4; i++) {
          const tx2 = px + 24 + i * (pw - 48) / 3;
          ctx.fillStyle = '#c9a227';
          ctx.beginPath();
          ctx.moveTo(tx2 - 5, py + ph * 0.35);
          ctx.lineTo(tx2 + 5, py + ph * 0.35);
          ctx.lineTo(tx2 + 2, py + ph * 0.6);
          ctx.lineTo(tx2 - 2, py + ph * 0.6);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#e8c85a';
          ctx.beginPath(); ctx.arc(tx2, py + ph * 0.3, 4, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = '#f0e6d2';
        ctx.font = 'bold 6px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('TROFEOS', px + pw / 2, py + ph * 0.85);
        ctx.restore();
        break;
      }
      case 'recordboard': {
        const pw = w * T, ph = h * T;
        ctx.save();
        ctx.fillStyle = '#4a5263';
        ctx.fillRect(px + 10, py + ph * 0.35, 4, ph * 0.62);
        ctx.fillRect(px + pw - 14, py + ph * 0.35, 4, ph * 0.62);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        roundRect(ctx, px + 4, py + 4, pw - 8, ph * 0.72, 3); ctx.fill();
        ctx.fillStyle = '#1b2433';
        roundRect(ctx, px + 2, py, pw - 4, ph * 0.7, 3); ctx.fill();
        ctx.strokeStyle = '#8fd0ff';
        ctx.lineWidth = 1.5;
        roundRect(ctx, px + 2, py, pw - 4, ph * 0.7, 3); ctx.stroke();
        ctx.fillStyle = '#8fd0ff';
        ctx.font = 'bold 7px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('RÉCORDS', px + pw / 2, py + ph * 0.16);
        ctx.fillStyle = '#f0e6d2';
        ctx.font = 'bold 5.5px ui-monospace, monospace';
        ctx.fillText('100 m   11.2 s', px + pw / 2, py + ph * 0.36);
        ctx.fillText('Salto    4,85 m', px + pw / 2, py + ph * 0.54);
        ctx.restore();
        break;
      }
      case 'startingblocks': {
        ctx.save();
        ctx.translate(px, py);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(0, 6, 15, 5, 0, 0, TAU); ctx.fill();
        for (let i = 0; i < 2; i++) {
          ctx.save();
          ctx.translate(-7 + i * 13, -3);
          ctx.rotate(0.35);
          ctx.fillStyle = '#9aa6ba';
          roundRect(ctx, -5, -2, 10, 5, 2); ctx.fill();
          ctx.fillStyle = '#5f6b7e';
          roundRect(ctx, -5, 1, 10, 2, 1); ctx.fill();
          ctx.restore();
        }
        ctx.restore();
        break;
      }
      case 'highjump': {
        const pw = w * T, ph = h * T;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        roundRect(ctx, px + 2, py + ph - 18, pw - 4, 14, 3); ctx.fill();
        ctx.fillStyle = '#2f6f8f';
        roundRect(ctx, px + 2, py + ph - 20, pw - 4, 12, 3); ctx.fill();
        ctx.strokeStyle = '#dbe4f2';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(px + 7, py + 5); ctx.lineTo(px + 7, py + ph - 12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px + pw - 7, py + 5); ctx.lineTo(px + pw - 7, py + ph - 12); ctx.stroke();
        ctx.strokeStyle = '#ffcf5c';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(px + 5, py + ph * 0.5); ctx.lineTo(px + pw - 5, py + ph * 0.5); ctx.stroke();
        ctx.fillStyle = '#dbe4f2';
        ctx.fillRect(px + 3, py + 3, 8, 4);
        ctx.fillRect(px + pw - 11, py + 3, 8, 4);
        ctx.restore();
        break;
      }
      case 'cone': {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(px + 1, py + 7, 9, 4, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#f28c28';
        ctx.beginPath();
        ctx.moveTo(px, py - 12);
        ctx.lineTo(px + 7, py + 5);
        ctx.lineTo(px - 7, py + 5);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f7f0df';
        ctx.fillRect(px - 4.5, py - 2, 9, 3);
        ctx.fillStyle = '#c96b16';
        ctx.fillRect(px - 9, py + 5, 18, 3);
        ctx.restore();
        break;
      }
      case 'equipment': {
        const pw = w * T, ph = h * T;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        roundRect(ctx, px + 2, py + ph - 8, pw - 4, 8, 3); ctx.fill();
        ctx.strokeStyle = '#4a5263';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(px + 6, py + 4); ctx.lineTo(px + 6, py + ph - 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px + pw - 6, py + 4); ctx.lineTo(px + pw - 6, py + ph - 6); ctx.stroke();
        ctx.fillStyle = '#f28c28';
        ctx.beginPath(); ctx.arc(px + pw * 0.35, py + ph * 0.4, 7, 0, TAU); ctx.fill();
        ctx.fillStyle = '#8fd0ff';
        ctx.beginPath(); ctx.arc(px + pw * 0.65, py + ph * 0.55, 6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffd166';
        ctx.beginPath(); ctx.arc(px + pw * 0.5, py + ph * 0.28, 5, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#dbe4f2';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px + pw * 0.8, py + ph * 0.35, 6, 0, TAU); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'mats': {
        const pw = w * T, ph = h * T;
        ctx.save();
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i % 2 ? '#2f6f8f' : '#c9553b';
          roundRect(ctx, px + 2 + i * 3, py + 4 + i * 4, pw - 6, ph - 10, 3); ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.16)';
          ctx.lineWidth = 1;
          roundRect(ctx, px + 3 + i * 3, py + 5 + i * 4, pw - 8, ph - 12, 3); ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'ropes': {
        const pw = w * T, ph = h * T;
        ctx.save();
        ctx.fillStyle = '#4a5263';
        ctx.fillRect(px, py, pw, 4);
        ctx.strokeStyle = 'rgba(210,190,150,0.65)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const rx = px + 10 + i * (pw - 20) / 3;
          ctx.beginPath(); ctx.moveTo(rx, py + 4); ctx.lineTo(rx, py + ph - 6); ctx.stroke();
          ctx.beginPath(); ctx.arc(rx, py + ph - 6, 4, 0, TAU); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath(); ctx.ellipse(px + pw / 2, py + ph + 4, pw * 0.45, 5, 0, 0, TAU); ctx.fill();
        ctx.restore();
        break;
      }
      case 'drumkit': {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(px + 2, py + 18, 26, 7, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c9a227';
        ctx.beginPath(); ctx.ellipse(px, py, 18, 12, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#f0e6d2';
        ctx.beginPath(); ctx.ellipse(px, py - 2, 15, 8, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#8a1f2d';
        ctx.beginPath(); ctx.ellipse(px, py - 2, 10, 5, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#8a8f9c';
        ctx.beginPath(); ctx.ellipse(px + 20, py - 10, 9, 3, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#d6b17a';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px + 18, py - 8); ctx.lineTo(px + 24, py + 2); ctx.stroke();
        ctx.fillStyle = '#23262e';
        ctx.fillRect(px - 18, py + 8, 7, 7);
        ctx.fillRect(px + 12, py + 8, 7, 7);
        ctx.fillStyle = '#e8eef8';
        ctx.beginPath(); ctx.arc(px - 16, py - 12, 2, 0, TAU); ctx.fill();
        ctx.restore();
        break;
      }
      case 'musicstand': {
        ctx.save();
        ctx.strokeStyle = '#8a8f9c';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px, py + 4); ctx.lineTo(px - 6, py + 18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px, py + 4); ctx.lineTo(px + 6, py + 18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px, py + 4); ctx.lineTo(px, py + 16); ctx.stroke();
        ctx.fillStyle = '#f0e6d2';
        roundRect(ctx, px - 12, py - 16, 24, 16, 2); ctx.fill();
        ctx.strokeStyle = '#3c4658';
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath(); ctx.moveTo(px - 9, py - 11 + i * 4); ctx.lineTo(px + 9, py - 11 + i * 4); ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'spotlights': {
        const pw = w * T, ph = h * T;
        ctx.save();
        ctx.fillStyle = '#3a4250';
        ctx.fillRect(px, py, pw, 4);
        for (let i = 0; i < 3; i++) {
          const lx = px + 10 + i * (pw - 20) / 2;
          ctx.fillStyle = '#1b2230';
          roundRect(ctx, lx - 7, py + 4, 14, 10, 3); ctx.fill();
          ctx.fillStyle = '#ffd166';
          ctx.beginPath(); ctx.arc(lx, py + 13, 4, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(255,220,140,0.08)';
          ctx.beginPath();
          ctx.moveTo(lx - 4, py + 15);
          ctx.lineTo(lx - 19, py + ph + 18);
          ctx.lineTo(lx + 19, py + ph + 18);
          ctx.lineTo(lx + 4, py + 15);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'bookcart': {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(px + 2, py + 16, 22, 6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#4a5263';
        roundRect(ctx, px - 18, py - 12, 36, 26, 3); ctx.fill();
        ctx.fillStyle = '#6b7487';
        roundRect(ctx, px - 16, py - 10, 32, 20, 2); ctx.fill();
        const cols2 = ['#ff8fb1', '#ffd166', '#7ee787', '#8fd0ff', '#c77dff'];
        for (let i = 0; i < 7; i++) {
          ctx.fillStyle = cols2[i % cols2.length];
          ctx.fillRect(px - 14 + i * 4.5, py - 8, 3, 14);
        }
        ctx.fillStyle = '#23262e';
        ctx.beginPath(); ctx.arc(px - 12, py + 16, 3, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(px + 12, py + 16, 3, 0, TAU); ctx.fill();
        ctx.restore();
        break;
      }
      case 'printer': {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(px + 2, py + 14, 22, 7, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3a4250';
        roundRect(ctx, px - 20, py - 12, 40, 26, 4); ctx.fill();
        ctx.fillStyle = '#5f6b7e';
        roundRect(ctx, px - 16, py - 9, 32, 8, 2); ctx.fill();
        ctx.fillStyle = '#1b2230';
        ctx.fillRect(px - 14, py + 4, 28, 5);
        ctx.fillStyle = '#f0e6d2';
        ctx.fillRect(px - 8, py - 4, 16, 3);
        ctx.fillStyle = '#7ee787';
        ctx.beginPath(); ctx.arc(px + 14, py + 10, 2, 0, TAU); ctx.fill();
        ctx.restore();
        break;
      }
      case 'mail': {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        roundRect(ctx, px - 18, py - 12, 36, 30, 3); ctx.fill();
        ctx.fillStyle = '#5a3f24';
        roundRect(ctx, px - 18, py - 14, 36, 28, 3); ctx.fill();
        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < 3; c++) {
            ctx.fillStyle = '#c9a16a';
            roundRect(ctx, px - 15 + c * 11, py - 11 + r * 12, 9, 10, 2); ctx.fill();
            ctx.fillStyle = 'rgba(60,70,88,0.5)';
            ctx.fillRect(px - 14 + c * 11, py - 9 + r * 12, 7, 1.5);
          }
        }
        ctx.restore();
        break;
      }
      case 'labbench': {
        const pw = w * T, ph = h * T;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        roundRect(ctx, px + 2, py + 5, pw, ph, 4); ctx.fill();
        ctx.fillStyle = '#4a5263';
        roundRect(ctx, px, py, pw, ph, 4); ctx.fill();
        ctx.fillStyle = '#6b7487';
        roundRect(ctx, px + 2, py + 2, pw - 4, ph * 0.42, 3); ctx.fill();
        ctx.fillStyle = '#7fe0ff';
        for (let i = 0; i < 3; i++) {
          const bx = px + 12 + i * (pw - 24) / 2.4;
          ctx.beginPath();
          ctx.moveTo(bx, py + ph * 0.52);
          ctx.lineTo(bx - 4, py + ph * 0.82);
          ctx.lineTo(bx + 4, py + ph * 0.82);
          ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = '#c7d6e6';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px + pw - 24, py + ph * 0.55); ctx.lineTo(px + pw - 18, py + ph * 0.3); ctx.lineTo(px + pw - 12, py + ph * 0.55); ctx.stroke();
        ctx.fillStyle = '#2b3340';
        ctx.fillRect(px + pw - 26, py + ph * 0.55, 16, 4);
        ctx.restore();
        break;
      }
      case 'condiments': {
        const pw = w * T, ph = h * T;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        roundRect(ctx, px + 2, py + 4, pw, ph, 3); ctx.fill();
        ctx.fillStyle = '#6b4b2f';
        roundRect(ctx, px, py, pw, ph, 3); ctx.fill();
        ctx.fillStyle = '#a97b52';
        roundRect(ctx, px + 2, py + 2, pw - 4, ph * 0.45, 2); ctx.fill();
        const cols2 = ['#c9553b', '#ffd166', '#f0e6d2', '#7ee787'];
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = cols2[i];
          roundRect(ctx, px + 6 + i * (pw - 12) / 4, py + 4, 4, 10, 1); ctx.fill();
        }
        ctx.fillStyle = '#f0e6d2';
        ctx.fillRect(px + 6, py + ph - 5, pw - 12, 2);
        ctx.restore();
        break;
      }
      case 'ladder': {
        ctx.save();
        ctx.strokeStyle = '#c9a16a';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(px - 7, py + 20); ctx.lineTo(px - 2, py - 18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px + 7, py + 20); ctx.lineTo(px + 12, py - 18); ctx.stroke();
        ctx.lineWidth = 2;
        for (let i = 0; i < 5; i++) {
          const yy = py - 14 + i * 7;
          const off = i * 1.1;
          ctx.beginPath(); ctx.moveTo(px - 6 + off, yy); ctx.lineTo(px + 8 + off, yy); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath(); ctx.ellipse(px + 1, py + 22, 14, 4, 0, 0, TAU); ctx.fill();
        ctx.restore();
        break;
      }
      case 'workbench': {
        const pw = w * T, ph = h * T;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        roundRect(ctx, px + 2, py + 5, pw, ph, 3); ctx.fill();
        ctx.fillStyle = '#6b4b2f';
        roundRect(ctx, px, py, pw, ph, 3); ctx.fill();
        ctx.fillStyle = '#a97b52';
        roundRect(ctx, px + 2, py + 2, pw - 4, ph * 0.35, 2); ctx.fill();
        ctx.fillStyle = '#3a4250';
        roundRect(ctx, px + pw * 0.62, py + ph * 0.45, pw * 0.22, ph * 0.35, 2); ctx.fill();
        ctx.strokeStyle = '#8a8f9c';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px + pw * 0.73, py + ph * 0.62, 4, 0, TAU); ctx.stroke();
        ctx.fillStyle = '#ffcf5c';
        ctx.fillRect(px + pw * 0.18, py + ph * 0.45, 10, 3);
        ctx.fillRect(px + pw * 0.18, py + ph * 0.45, 3, 10);
        ctx.restore();
        break;
      }
      case 'arrow': {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(d.ang || 0);
        ctx.fillStyle = 'rgba(230,240,255,0.22)';
        ctx.beginPath();
        ctx.moveTo(18, 0); ctx.lineTo(-2, -12); ctx.lineTo(-2, -5);
        ctx.lineTo(-17, -5); ctx.lineTo(-17, 5); ctx.lineTo(-2, 5);
        ctx.lineTo(-2, 12); ctx.closePath(); ctx.fill();
        ctx.restore();
        break;
      }
      case 'mission': {
        const cx = px + T / 2;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(cx, py + T - 7, 24, 8, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#28324a';
        roundRect(ctx, cx - 19, py + T - 22, 38, 14, 5); ctx.fill();
        ctx.fillStyle = '#38455f';
        roundRect(ctx, cx - 19, py + T - 22, 38, 5, 3); ctx.fill();
        ctx.fillStyle = '#46536c';
        ctx.fillRect(cx - 3, py + 12, 6, 24);
        ctx.shadowColor = d.color;
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#0b1322';
        roundRect(ctx, cx - 21, py - 20, 42, 32, 6); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 2;
        roundRect(ctx, cx - 21, py - 20, 42, 32, 6); ctx.stroke();
        ctx.fillStyle = d.color;
        ctx.font = 'bold 18px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(d.short, cx, py - 3);
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        roundRect(ctx, cx - 21, py + 14, 42, 6, 3); ctx.fill();
        ctx.restore();
        break;
      }
      case 'noticeboard': {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(px, py + 14, 30, 8, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5a4228';
        ctx.fillRect(px - 24, py - 8, 4, 24);
        ctx.fillRect(px + 20, py - 8, 4, 24);
        ctx.fillStyle = '#3d2d1b';
        roundRect(ctx, px - 31, py - 30, 62, 34, 4); ctx.fill();
        ctx.fillStyle = '#8a6a44';
        roundRect(ctx, px - 29, py - 28, 58, 30, 3); ctx.fill();
        ctx.fillStyle = '#c9a16a';
        roundRect(ctx, px - 26, py - 26, 52, 26, 2); ctx.fill();
        const cols = ['#e05d5d', '#5aa9ff', '#ffd166', '#7ee787', '#ffffff'];
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = cols[i];
          ctx.fillRect(px - 23 + (i % 3) * 16, py - 23 + Math.floor(i / 3) * 10, 12, 8);
        }
        ctx.fillStyle = '#2b2b33';
        ctx.font = 'bold 7px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('ANUNCIOS', px, py - 31);
        ctx.restore();
        break;
      }
      case 'extinguisher': {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(px, py + 12, 9, 4, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c62828';
        roundRect(ctx, px - 6, py - 16, 12, 26, 4); ctx.fill();
        ctx.fillStyle = '#e53935';
        roundRect(ctx, px - 6, py - 16, 5, 26, 4); ctx.fill();
        ctx.fillStyle = '#20242e';
        ctx.fillRect(px - 2, py - 22, 4, 7);
        ctx.strokeStyle = '#20242e'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px + 2, py - 21); ctx.lineTo(px + 8, py - 16); ctx.stroke();
        ctx.fillStyle = '#fff';
        roundRect(ctx, px - 4, py - 8, 8, 10, 1); ctx.fill();
        ctx.restore();
        break;
      }
      case 'closedgate': {
        const gw = w * T;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        roundRect(ctx, px - 10, py - 66, gw + 20, 100, 10); ctx.fill();
        ctx.fillStyle = '#2b3448';
        roundRect(ctx, px - 8, py - 62, gw + 16, 80, 10); ctx.fill();
        ctx.fillStyle = '#3d4a63';
        roundRect(ctx, px - 2, py - 56, gw + 4, 72, 8); ctx.fill();
        ctx.fillStyle = '#0a101c';
        roundRect(ctx, px + 10, py - 46, gw - 20, 52, 5); ctx.fill();
        ctx.fillStyle = 'rgba(170,185,210,0.55)';
        for (let bx2 = px + 16; bx2 < px + gw - 12; bx2 += 14) ctx.fillRect(bx2, py - 46, 3, 52);
        ctx.fillRect(px + 10, py - 24, gw - 20, 3);
        ctx.strokeStyle = '#c8ceda'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(px + 12, py - 42); ctx.lineTo(px + gw - 12, py - 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px + gw - 12, py - 42); ctx.lineTo(px + 12, py - 6); ctx.stroke();
        const lx = px + gw / 2, ly = py - 24;
        ctx.fillStyle = '#e8b23c';
        roundRect(ctx, lx - 9, ly - 4, 18, 15, 3); ctx.fill();
        ctx.strokeStyle = '#c99a2a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(lx, ly - 5, 6, Math.PI, TAU); ctx.stroke();
        ctx.fillStyle = '#6b4d12';
        ctx.beginPath(); ctx.arc(lx, ly + 2, 2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#b3261e';
        roundRect(ctx, px + gw / 2 - 78, py - 80, 156, 22, 5); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
        roundRect(ctx, px + gw / 2 - 78, py - 80, 156, 22, 5); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('SALIDA CERRADA · SIN SALIDA', px + gw / 2, py - 68.5);
        ctx.restore();
        break;
      }
    }
  }
}

function drawAuras() {
  // Aura negra del Profe Cáceres: un circulo de sombra con niebla violeta.
  for (const t of teacherList) {
    if (!t.alive || t.voidAuraT <= 0) continue;
    const R = t.voidAuraR || 190;
    const fade = clamp(t.voidAuraT / 0.8, 0, 1);
    const tn = performance.now() / 1000;
    const g = ctx.createRadialGradient(t.x, t.y, 8, t.x, t.y, R);
    g.addColorStop(0, 'rgba(0,0,0,' + (0.55 * fade).toFixed(2) + ')');
    g.addColorStop(0.48, 'rgba(9,2,17,' + (0.48 * fade).toFixed(2) + ')');
    g.addColorStop(0.78, 'rgba(53,13,78,' + (0.28 * fade).toFixed(2) + ')');
    g.addColorStop(0.93, 'rgba(112,39,154,' + (0.16 * fade).toFixed(2) + ')');
    g.addColorStop(1, 'rgba(112,39,154,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(t.x, t.y, R, 0, TAU); ctx.fill();

    ctx.save();
    ctx.strokeStyle = 'rgba(155,82,205,' + (0.6 * fade).toFixed(2) + ')';
    ctx.lineWidth = 2.4;
    ctx.setLineDash([9, 8]);
    ctx.beginPath(); ctx.arc(t.x, t.y, R, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 3; i++) {
      const a0 = tn * 0.55 + i * (TAU / 3);
      ctx.strokeStyle = 'rgba(177,105,225,' + ((0.34 - i * 0.07) * fade).toFixed(2) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(t.x, t.y, R * (0.55 + i * 0.13), a0, a0 + 1.5);
      ctx.stroke();
    }
    for (let i = 0; i < 10; i++) {
      const a = tn * 0.35 + i * (TAU / 10);
      const rr = R * (0.62 + 0.28 * Math.sin(tn * 1.4 + i));
      ctx.fillStyle = 'rgba(190,125,235,' + (0.22 * fade).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(t.x + Math.cos(a) * rr, t.y + Math.sin(a) * rr, 4 + (i % 3), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  for (const s of studentList) {
    if (!s.alive || s.escaped || s.auraT <= 0) continue;
    const ar = skinRgb(s, '120,200,255');
    const g = ctx.createRadialGradient(s.x, s.y, 40, s.x, s.y, 265);
    g.addColorStop(0, 'rgba(' + ar + ',0.16)');
    g.addColorStop(0.75, 'rgba(' + ar + ',0.10)');
    g.addColorStop(1, 'rgba(' + ar + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(s.x, s.y, 265, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(' + ar + ',0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.arc(s.x, s.y, 265, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }
}

/* apuntes de examen repartidos por el mapa. Los dorados valen más. */
function drawExamPapers() {
  const tn = performance.now() / 1000;
  for (const p of examPapers) {
    if (p.x < cam.x - 900 || p.x > cam.x + 900 || p.y < cam.y - 650 || p.y > cam.y + 650) continue;
    const golden = !!p.golden;
    const bob = Math.sin(tn * 2.6 + p.x * 0.01) * 3;
    const x = p.x, y = p.y + bob;
    ctx.save();
    const glow = ctx.createRadialGradient(x, y, 0, x, y, golden ? 42 : 30);
    glow.addColorStop(0, golden ? 'rgba(255,179,71,0.42)' : 'rgba(255,224,138,0.28)');
    glow.addColorStop(1, golden ? 'rgba(255,179,71,0)' : 'rgba(255,224,138,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, golden ? 42 : 30, 0, TAU); ctx.fill();
    ctx.translate(x, y);
    ctx.rotate(-0.1 + Math.sin(tn * 1.7 + p.y * 0.01) * 0.06);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(0, 13, 12, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = golden ? '#fff0b0' : '#fff6d8';
    roundRect(ctx, -10, -14, 20, 27, 2); ctx.fill();
    ctx.strokeStyle = golden ? '#ffb347' : '#d8b34a'; ctx.lineWidth = golden ? 1.6 : 1;
    roundRect(ctx, -10, -14, 20, 27, 2); ctx.stroke();
    ctx.fillStyle = golden ? '#ffb347' : '#ffd166';
    ctx.fillRect(-6, -8, 12, 2);
    ctx.fillRect(-6, -4, 10, 2);
    ctx.fillRect(-6, 0, 11, 2);
    if (golden) {
      ctx.fillStyle = 'rgba(255,179,71,0.28)';
      ctx.beginPath(); ctx.arc(0, 7, 5, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = golden ? '#ffb347' : '#ff5d5f';
    ctx.beginPath(); ctx.arc(7, -10, 4.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 5px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(golden ? '10' : '4', 7, -8.4);
    ctx.restore();
  }
}

/* Objetos de las tareas de limpieza. Se dibujan en el suelo y desaparecen al
   recogerlos. Cada tipo de tarea tiene su propio objeto para que se lea rápido. */
function drawTaskSpots() {
  const tn = performance.now() / 1000;
  const groups = [];
  if (S.task) groups.push({ spots: S.task.spots, color: '#ffd166', ai: false });
  for (const m of MISSIONS) {
    if (m.aiTask && m.aiTask.spots) groups.push({ spots: m.aiTask.spots, color: m.color || '#ffd166', ai: true });
  }
  for (const group of groups) {
    for (const sp of group.spots) {
      if (sp.got) continue;
      if (sp.x < cam.x - 900 || sp.x > cam.x + 900 || sp.y < cam.y - 650 || sp.y > cam.y + 650) continue;
      const bob = Math.sin(tn * 2.4 + sp.seed) * 2.5;
      const x = sp.x, y = sp.y + bob;
      ctx.save();
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 28);
      glow.addColorStop(0, hexRgba(group.color, 0.34));
      glow.addColorStop(1, hexRgba(group.color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, 28, 0, TAU); ctx.fill();
      if (group.ai) {
        ctx.strokeStyle = hexRgba(group.color, 0.75);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.stroke();
      }
      ctx.translate(x, y);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(0, 11, 11, 3.5, 0, 0, TAU); ctx.fill();

      if (sp.kind === 'balls') {
        ctx.fillStyle = '#f08a3c';
        ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#8a3b14'; ctx.lineWidth = 1.3; ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-8.5, 0); ctx.lineTo(8.5, 0);
        ctx.moveTo(0, -8.5); ctx.lineTo(0, 8.5);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(-3, -3, 2.2, Math.PI, Math.PI * 1.5); ctx.stroke();
      } else if (sp.kind === 'trays') {
        ctx.fillStyle = '#b9c4d4';
        roundRect(ctx, -11, -5, 22, 10, 3); ctx.fill();
        ctx.strokeStyle = '#6d7a8e'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = '#ff8f6b';
        ctx.beginPath(); ctx.arc(-3, 0, 3, 0, TAU); ctx.fill();
        ctx.fillStyle = '#7ee787';
        ctx.beginPath(); ctx.arc(4, 1, 2, 0, TAU); ctx.fill();
      } else if (sp.kind === 'tools') {
        ctx.fillStyle = '#ffd166';
        ctx.strokeStyle = '#8a6a1f'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(-4, 0, 4.5, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(-4, 0, 2, 0, TAU); ctx.fillStyle = '#2a3040'; ctx.fill();
        ctx.fillStyle = '#ffd166';
        roundRect(ctx, 0, -2.2, 10, 4.4, 2); ctx.fill();
        ctx.strokeStyle = '#8a6a1f'; roundRect(ctx, 0, -2.2, 10, 4.4, 2); ctx.stroke();
      } else if (sp.kind === 'books') {
        ctx.fillStyle = '#7b4b2a';
        roundRect(ctx, -10, 2, 20, 5, 2); ctx.fill();
        ctx.fillStyle = '#3f7fd1';
        roundRect(ctx, -9, -2, 18, 5, 2); ctx.fill();
        ctx.fillStyle = '#e05d7a';
        roundRect(ctx, -8, -6, 16, 5, 2); ctx.fill();
        ctx.fillStyle = '#f4e7c3';
        ctx.fillRect(-6, -5.4, 3, 3.6);
        ctx.fillRect(-6, -1.4, 3, 3.6);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(-4, -3.6); ctx.lineTo(6, -3.6); ctx.stroke();
      } else if (sp.kind === 'stains') {
        ctx.fillStyle = 'rgba(123, 211, 186, 0.72)';
        ctx.beginPath(); ctx.ellipse(0, 3, 10, 5.5, -0.25, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(220,255,245,0.85)';
        ctx.beginPath(); ctx.arc(-4, -4, 2.4, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(3, -6, 1.8, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffd166';
        roundRect(ctx, 4, 2, 9, 5, 2); ctx.fill();
        ctx.strokeStyle = '#8a6a1f'; ctx.lineWidth = 1; roundRect(ctx, 4, 2, 9, 5, 2); ctx.stroke();
      } else {
        ctx.fillStyle = '#f4e7c3';
        ctx.strokeStyle = '#c9a96a'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * TAU;
          const rr = 7 + (i % 2 ? 1.5 : -1);
          const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#b08e55';
        ctx.beginPath();
        ctx.moveTo(-3, -2); ctx.lineTo(2, 1);
        ctx.moveTo(0, -4); ctx.lineTo(3, 4);
        ctx.stroke();
      }

      // destello que ayuda a verlo de noche
      ctx.fillStyle = '#fff4cf';
      ctx.beginPath(); ctx.arc(10, -10, 1.7, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
}

/* marcadores flotantes de las misiones (van por encima de los personajes) */
function drawMissionMarkers() {
  const tn = performance.now() / 1000;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const m of MISSIONS) {
    if (m.x < cam.x - 900 || m.x > cam.x + 900 || m.y < cam.y - 650 || m.y > cam.y + 650) continue;
    const bob = Math.sin(tn * 2.2 + m.roomIdx * 1.6) * 4;
    const bx = m.x, by = m.y - 62 + bob;

    if (!m.done) {
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(tn * 3 + m.roomIdx) * 0.12;
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(m.x, m.y + 14, 27, 13, 0, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = m.color;
      ctx.beginPath(); ctx.ellipse(m.x, m.y + 14, 25, 12, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.shadowColor = m.done ? '#8bf1a6' : m.color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = m.done ? 'rgba(18,70,42,0.95)' : 'rgba(10,16,28,0.94)';
    ctx.beginPath(); ctx.arc(bx, by, 16, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = m.done ? '#8bf1a6' : m.color;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(bx, by, 16, 0, TAU); ctx.stroke();
    ctx.fillStyle = m.done ? '#8bf1a6' : m.color;
    ctx.font = 'bold ' + (String(m.short).length > 1 ? 11 : 15) + 'px system-ui, sans-serif';
    ctx.fillText(m.done ? '✓' : m.short, bx, by + 1);

    const label = m.done ? 'HECHA'
      : m.type === 'task'
        ? m.subject.toUpperCase() + ' · TAREA'
        : m.subject.toUpperCase() + (missionTimeBonus(m) > 0 ? '' : ' · REFUERZO');
    ctx.font = 'bold 9px system-ui, sans-serif';
    const lw = ctx.measureText(label).width + 14;
    ctx.fillStyle = 'rgba(8,12,22,0.86)';
    roundRect(ctx, bx - lw / 2, by + 20, lw, 15, 5); ctx.fill();
    ctx.strokeStyle = m.done ? 'rgba(139,241,166,0.6)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    roundRect(ctx, bx - lw / 2, by + 20, lw, 15, 5); ctx.stroke();
    ctx.fillStyle = m.done ? '#8bf1a6' : '#dfe8fb';
    ctx.fillText(label, bx, by + 27.5);

    if (m.type === 'task' && !m.done) {
      const pr = clamp(missionProgress(m) / missionGoal(m), 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      roundRect(ctx, bx - 20, by - 30, 40, 5, 2); ctx.fill();
      ctx.fillStyle = m.color;
      roundRect(ctx, bx - 20, by - 30, 40 * pr, 5, 2); ctx.fill();
    } else if (m.runner && !m.done) {
      const pr = clamp((m.runner.ai.solveT || 0) / 4, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      roundRect(ctx, bx - 20, by - 30, 40, 5, 2); ctx.fill();
      ctx.fillStyle = '#ffd166';
      roundRect(ctx, bx - 20, by - 30, 40 * pr, 5, 2); ctx.fill();
    }
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
}

/* ---------- personajes ---------- */
function starPath(cx, cy, outer, inner, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + i * Math.PI / points;
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// Cada personaje tiene una silueta distinta: hombros más anchos, complexión
// delgada o figura redonda. Así no todos se leen como el mismo muñeco.
const BODY_BUILD = {
  slim: 0.92, athletic: 1.05, stocky: 1.09, tall: 0.96,
  broad: 1.08, round: 1.07, neat: 0.98
};

function drawPerson(e) {
  const L = e.look || e.char.look || {};
  const r = e.r;
  const now = performance.now();
  const seed = e.blinkSeed || 0;
  const w = e.walk || 0;
  const swing = Math.sin(w) * r * 0.5;
  const dance = (e.kind === 'student' && e.speedUp > 0) ? Math.sin(now / 110) * r * 0.16 : 0;
  // Animaciones exclusivas de los trajes nuevos: flotar, rebotar y mecerse.
  const skinAnim = L.anim || '';
  const animClock = now / 1000 + seed * 0.7;
  const animBob = skinAnim === 'float'
    ? Math.sin(animClock * 2.2) * r * 0.09
    : (skinAnim === 'bounce' ? Math.abs(Math.sin(animClock * 4.4)) * r * 0.06 : 0);
  const animSway = skinAnim === 'sway' ? Math.sin(animClock * 2.5) * r * 0.055 : 0;
  // Golpe cuerpo a cuerpo: la pose se calcula con strikeT (1 -> 0). El cuerpo
  // se lanza hacia delante y el brazo/arma barre en un arco visible.
  const strikeK = (e.strikeT > 0 && e.strikeDur > 0) ? clamp(1 - e.strikeT / e.strikeDur, 0, 1) : -1;
  const striking = strikeK >= 0 && !e.celebrate;
  const strikeDir = typeof e.strikeDir === 'number' ? e.strikeDir : (e.face || 0);
  const strikeLunge = striking ? Math.sin(Math.PI * strikeK) * r * (e.strikeStyle === 'charge' ? 0.42 : 0.28) : 0;
  const bx = e.x + dance + animSway + Math.cos(strikeDir) * strikeLunge;
  const by = e.y + animBob + Math.sin(strikeDir) * strikeLunge;
  let attackHand = null;
  const fx = Math.cos(e.face || 0), fy = Math.sin(e.face || 0);
  const back = fy < -0.45;                       // va de espaldas
  const outline = 'rgba(10,14,24,0.5)';
  const skin   = L.skin   || '#f0c49b';
  const shirt  = L.shirt  || e.char.color;
  const shirt2 = L.shirt2 || shade(e.char.color, -0.35);
  // Los profesores llevan las mangas de la americana, no de la camisa.
  const armCol = L.teacher ? (L.jacket || shirt2) : shirt2;
  const pants  = L.pants  || '#2b3346';
  const shoes  = L.shoes  || ['#eceff7', '#eceff7'];
  const socks  = L.sock ? (Array.isArray(L.sock) ? L.sock : [L.sock, L.sock]) : null;
  const blink  = !e.noBlink && ((now / 1000 + seed * 1.7) % 4.6) < 0.13;
  const eating = e.eatT > 0;
  const lowHp = e.kind === 'student' && e.alive && e.hp <= e.maxHp * 0.3;
  const bobPose = Math.sin(now / 620 + seed) * r * 0.018;

  // Alas y cola de los trajes legendarios/míticos: se dibujan detrás del
  // cuerpo para que la silueta se lea incluso de espaldas.
  if (L.wings) {
    const flap = Math.sin(now / 240 + seed) * r * 0.05;
    const wingStyle = L.wingStyle || 'feather';
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(bx + side * r * 0.35, by - r * 0.55);
      if (wingStyle === 'bat') {
        ctx.fillStyle = hexRgba(L.wings, 0.92);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(side * r * 1.05, -r * 0.95 - flap, side * r * 1.34, -r * 0.1);
        ctx.quadraticCurveTo(side * r * 0.95, -r * 0.22, side * r * 0.72, r * 0.02);
        ctx.quadraticCurveTo(side * r * 0.5, -r * 0.35, 0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = shadeHex(L.wings, 0.22);
        ctx.lineWidth = 1.1;
        ctx.stroke();
        // venas de las alas
        ctx.strokeStyle = shadeHex(L.wings, -0.28);
        ctx.lineWidth = 1;
        for (let i = 1; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(side * r * 0.08, -r * 0.04);
          ctx.quadraticCurveTo(
            side * r * (0.55 + i * 0.16), -r * (0.32 + i * 0.18),
            side * r * (0.78 + i * 0.18), -r * (0.08 + i * 0.06)
          );
          ctx.stroke();
        }
      } else {
        for (let i = 0; i < 3; i++) {
          const spread = side * (0.45 + i * 0.16) + Math.sin(now / 300 + seed + i) * 0.04;
          ctx.save();
          ctx.rotate(spread);
          ctx.fillStyle = i === 0 ? shadeHex(L.wings, -0.12) : L.wings;
          ctx.beginPath();
          ctx.ellipse(
            side * r * (0.42 + i * 0.12), -r * (0.18 + i * 0.08),
            r * 0.46, r * 0.15, side * 0.35, 0, TAU
          );
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.28)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
    }
  }
  if (L.tail) {
    ctx.save();
    const sway = Math.sin(now / 260 + seed) * r * 0.16;
    // Contorno oscuro para que la cola se lea sobre cualquier fondo.
    ctx.strokeStyle = 'rgba(18,14,26,0.42)';
    ctx.lineWidth = r * 0.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx + r * 0.35, by + r * 0.42);
    ctx.quadraticCurveTo(bx + r * 1.05 + sway, by + r * 0.24, bx + r * 0.95 + sway, by - r * 0.42);
    ctx.stroke();
    ctx.strokeStyle = L.tail;
    ctx.lineWidth = r * 0.14;
    ctx.beginPath();
    ctx.moveTo(bx + r * 0.35, by + r * 0.42);
    ctx.quadraticCurveTo(bx + r * 1.05 + sway, by + r * 0.24, bx + r * 0.95 + sway, by - r * 0.42);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = r * 0.045;
    ctx.beginPath();
    ctx.moveTo(bx + r * 0.42, by + r * 0.42);
    ctx.quadraticCurveTo(bx + r * 0.95 + sway, by + r * 0.22, bx + r * 0.9 + sway, by - r * 0.34);
    ctx.stroke();
    // Punta de la cola.
    ctx.fillStyle = shadeHex(L.tail, -0.08);
    ctx.beginPath(); ctx.arc(bx + r * 0.95 + sway, by - r * 0.42, r * 0.09, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Capa de los trajes de gala: se dibuja detrás del cuerpo y ondea al andar.
  if (L.cape) {
    const flap = Math.sin(now / 180 + seed) * r * 0.12;
    ctx.fillStyle = shadeHex(L.cape, -0.26);
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.68, by - r * 0.62);
    ctx.quadraticCurveTo(bx - r * 1.2 + flap, by + r * 0.3, bx - r * 1.45 + flap, by + r * 1.22);
    ctx.quadraticCurveTo(bx, by + r * 0.98, bx + r * 1.45 - flap, by + r * 1.22);
    ctx.quadraticCurveTo(bx + r * 1.2 - flap, by + r * 0.3, bx + r * 0.68, by - r * 0.62);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.5, by - r * 0.48);
    ctx.quadraticCurveTo(bx - r * 0.98 + flap, by + r * 0.4, bx - r * 1.18 + flap, by + r * 1.02);
    ctx.stroke();
  }

  // piernas (Jonny lleva pantalon corto)
  const legH = L.shorts ? r * 0.62 : r * 0.92;
  ctx.fillStyle = pants;
  roundRect(ctx, bx - r * 0.58, by + r * 0.05 + swing * 0.3, r * 0.46, legH, 3); ctx.fill();
  roundRect(ctx, bx + r * 0.12, by + r * 0.05 - swing * 0.3, r * 0.46, legH, 3); ctx.fill();
  // costura y pliegue del pantalon: separa las piernas del fondo
  ctx.strokeStyle = shadeHex(pants, -0.28);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(bx - r * 0.39, by + r * 0.2 + swing * 0.3);
  ctx.lineTo(bx - r * 0.39, by + r * 0.2 + legH * 0.72 + swing * 0.3);
  ctx.moveTo(bx + r * 0.33, by + r * 0.2 - swing * 0.3);
  ctx.lineTo(bx + r * 0.33, by + r * 0.2 + legH * 0.72 - swing * 0.3);
  ctx.stroke();
  ctx.strokeStyle = shadeHex(pants, 0.16);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx - r * 0.52, by + r * 0.18 + swing * 0.3);
  ctx.lineTo(bx - r * 0.52, by + r * 0.16 + legH * 0.55 + swing * 0.3);
  ctx.moveTo(bx + r * 0.21, by + r * 0.18 - swing * 0.3);
  ctx.lineTo(bx + r * 0.21, by + r * 0.16 + legH * 0.55 - swing * 0.3);
  ctx.stroke();
  // bolsillos y una luz suave en las rodillas
  ctx.strokeStyle = 'rgba(8,12,22,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx - r * 0.55, by + r * 0.2 + swing * 0.3);
  ctx.quadraticCurveTo(bx - r * 0.46, by + r * 0.3 + swing * 0.3, bx - r * 0.3, by + r * 0.29 + swing * 0.3);
  ctx.moveTo(bx + r * 0.25, by + r * 0.2 - swing * 0.3);
  ctx.quadraticCurveTo(bx + r * 0.34, by + r * 0.3 - swing * 0.3, bx + r * 0.5, by + r * 0.29 - swing * 0.3);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  ctx.beginPath(); ctx.ellipse(bx - r * 0.35, by + r * 0.08 + legH * 0.62 + swing * 0.3, r * 0.14, r * 0.07, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(bx + r * 0.35, by + r * 0.08 + legH * 0.62 - swing * 0.3, r * 0.14, r * 0.07, 0, 0, TAU); ctx.fill();
  // calcetines (Elías los lleva de distinto color)
  if (socks) {
    const sy = by + r * (L.shorts ? 0.6 : 0.7);
    ctx.fillStyle = socks[0];
    roundRect(ctx, bx - r * 0.6, sy + swing * 0.3, r * 0.44, r * 0.24, 3); ctx.fill();
    ctx.fillStyle = socks[1];
    roundRect(ctx, bx + r * 0.16, sy - swing * 0.3, r * 0.44, r * 0.24, 3); ctx.fill();
  }
  // zapatos con suela
  ctx.fillStyle = shoes[0];
  roundRect(ctx, bx - r * 0.66, by + r * 0.82 + swing * 0.3, r * 0.56, r * 0.3, 3); ctx.fill();
  ctx.fillStyle = shoes[1];
  roundRect(ctx, bx + r * 0.1, by + r * 0.82 - swing * 0.3, r * 0.56, r * 0.3, 3); ctx.fill();
  if (L.shoeAccent) {
    ctx.fillStyle = L.shoeAccent;
    roundRect(ctx, bx - r * 0.61, by + r * 0.93 + swing * 0.3, r * 0.46, r * 0.075, 2); ctx.fill();
    roundRect(ctx, bx + r * 0.15, by + r * 0.93 - swing * 0.3, r * 0.46, r * 0.075, 2); ctx.fill();
  }
  // puntera, brillo y cordones
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  roundRect(ctx, bx - r * 0.6, by + r * 1.0 + swing * 0.3, r * 0.44, r * 0.075, 2); ctx.fill();
  roundRect(ctx, bx + r * 0.16, by + r * 1.0 - swing * 0.3, r * 0.44, r * 0.075, 2); ctx.fill();
  ctx.strokeStyle = 'rgba(20,24,34,0.28)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 2; i++) {
    const yy = by + r * (0.88 + i * 0.075);
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.54, yy + swing * 0.3);
    ctx.lineTo(bx - r * 0.24, yy + r * 0.025 + swing * 0.3);
    ctx.moveTo(bx + r * 0.22, yy - swing * 0.3);
    ctx.lineTo(bx + r * 0.52, yy + r * 0.025 - swing * 0.3);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(20,24,34,0.5)';
  roundRect(ctx, bx - r * 0.66, by + r * 1.05 + swing * 0.3, r * 0.56, r * 0.075, 2); ctx.fill();
  roundRect(ctx, bx + r * 0.1, by + r * 1.05 - swing * 0.3, r * 0.56, r * 0.075, 2); ctx.fill();

  // torso (con rebote al caminar)
  const bob = Math.abs(Math.sin(w)) * r * 0.08 + bobPose;
  const ty0 = by - bob;
  const tw = r * 1.52 * (BODY_BUILD[L.build] || 1), th = r * 1.2;
  // mochila asomando por detras
  if (L.bag) {
    ctx.fillStyle = shadeHex(L.bag, -0.35);
    roundRect(ctx, bx - tw * 0.6, ty0 - r * 0.6, tw * 1.2, th * 0.95, 6); ctx.fill();
    ctx.fillStyle = L.bag;
    roundRect(ctx, bx - tw * 0.53, ty0 - r * 0.52, tw * 1.06, th * 0.8, 6); ctx.fill();
    ctx.fillStyle = shadeHex(L.bag, 0.18);
    roundRect(ctx, bx - tw * 0.4, ty0 - r * 0.44, tw * 0.8, r * 0.22, 4); ctx.fill();
    // bolsillos laterales y cremallera: la mochila gana volumen y detalles
    ctx.fillStyle = shadeHex(L.bag, -0.16);
    roundRect(ctx, bx - tw * 0.59, ty0 - r * 0.12, r * 0.17, r * 0.4, 3); ctx.fill();
    roundRect(ctx, bx + tw * 0.42, ty0 - r * 0.12, r * 0.17, r * 0.4, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + tw * 0.14, ty0 - r * 0.54);
    ctx.lineTo(bx + tw * 0.3, ty0 - r * 0.54);
    ctx.stroke();
    ctx.fillStyle = shadeHex(L.bag, 0.34);
    roundRect(ctx, bx + tw * 0.28, ty0 - r * 0.58, r * 0.055, r * 0.15, 2); ctx.fill();
  }
  // camiseta
  ctx.fillStyle = shirt;
  roundRect(ctx, bx - tw / 2, ty0 - r * 0.82, tw, th, 5); ctx.fill();
  // degradado lateral
  ctx.fillStyle = shirt2;
  roundRect(ctx, bx + tw * 0.06, ty0 - r * 0.82, tw * 0.44, th, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRect(ctx, bx - tw / 2 + 2, ty0 - r * 0.82, tw * 0.3, th * 0.5, 5); ctx.fill();

  // estampados y detalles de la camiseta
  ctx.save();
  roundRect(ctx, bx - tw / 2, ty0 - r * 0.82, tw, th, 5); ctx.clip();
  if (L.pattern === 'stripe') {
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    for (let i = 0; i < 3; i++) ctx.fillRect(bx - tw / 2, ty0 - r * 0.55 + i * r * 0.3, tw, r * 0.1);
  } else if (L.pattern === 'wave') {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = r * 0.09;
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) {
      const px = bx - tw / 2 + (i / 8) * tw;
      const py = ty0 - r * 0.08 + Math.sin(i * 1.3) * r * 0.09;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.stroke();
  } else if (L.pattern === 'star') {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    starPath(bx, ty0 - r * 0.24, r * 0.28, r * 0.12, 5);
    ctx.fill();
  } else if (L.pattern === 'pocket') {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    roundRect(ctx, bx - r * 0.32, ty0 - r * 0.55, r * 0.64, r * 0.4, 3); ctx.fill();
    if (L.rulerPocket) {
      ctx.fillStyle = '#f4f7ff';
      roundRect(ctx, bx - r * 0.05, ty0 - r * 0.78, r * 0.12, r * 0.34, 1); ctx.fill();
      ctx.fillStyle = '#6b7280';
      for (let i = 0; i < 3; i++) ctx.fillRect(bx - r * 0.03, ty0 - r * 0.72 + i * r * 0.08, r * 0.05, r * 0.02);
    }
  } else if (L.pattern === 'patch') {
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    roundRect(ctx, bx + r * 0.1, ty0 - r * 0.62, r * 0.34, r * 0.3, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(30,40,55,0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 2]);
    roundRect(ctx, bx + r * 0.1, ty0 - r * 0.62, r * 0.34, r * 0.3, 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (L.stain) {
    ctx.fillStyle = 'rgba(120,70,35,0.4)';
    ctx.beginPath(); ctx.ellipse(bx + r * 0.15, ty0 - r * 0.12, r * 0.22, r * 0.17, 0.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(bx + r * 0.34, ty0 - r * 0.02, r * 0.08, 0, TAU); ctx.fill();
  }
  if (L.crumbs) {
    ctx.fillStyle = 'rgba(240,200,135,0.9)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(bx + (i - 1.5) * r * 0.16, ty0 + r * 0.18 + (i % 2) * r * 0.08, r * 0.032, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();

  const topY = ty0 - r * 0.82;
  // sombra del bajo de la camiseta
  ctx.save();
  roundRect(ctx, bx - tw / 2, topY, tw, th, 5); ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  ctx.fillRect(bx - tw / 2, topY + th - r * 0.2, tw, r * 0.2);
  ctx.restore();

  if (!L.teacher) {
    // costuras laterales y hombros de la camiseta
    ctx.strokeStyle = 'rgba(8,12,22,0.16)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(bx - tw * 0.35, topY + r * 0.1);
    ctx.quadraticCurveTo(bx - tw * 0.43, topY + th * 0.52, bx - tw * 0.37, topY + th * 0.9);
    ctx.moveTo(bx + tw * 0.35, topY + r * 0.1);
    ctx.quadraticCurveTo(bx + tw * 0.43, topY + th * 0.52, bx + tw * 0.37, topY + th * 0.9);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = r * 0.05;
    ctx.beginPath();
    ctx.moveTo(bx - tw * 0.43, topY + r * 0.23);
    ctx.quadraticCurveTo(bx - tw * 0.31, topY + r * 0.08, bx - tw * 0.16, topY + r * 0.05);
    ctx.moveTo(bx + tw * 0.43, topY + r * 0.23);
    ctx.quadraticCurveTo(bx + tw * 0.31, topY + r * 0.08, bx + tw * 0.16, topY + r * 0.05);
    ctx.stroke();
  }

  if (L.teacher) {
    // Americana con solapas y camisa blanca: los profesores se leen como
    // docentes incluso de lejos.
    const jacket = L.jacket || shadeHex(shirt, -0.3);
    const collar = L.collar || '#f2f5fb';
    ctx.fillStyle = jacket;
    ctx.beginPath();
    ctx.moveTo(bx - tw * 0.5, topY + r * 0.03);
    ctx.lineTo(bx - r * 0.3, topY + r * 0.03);
    ctx.lineTo(bx - r * 0.02, topY + r * 0.65);
    ctx.lineTo(bx - r * 0.25, topY + r * 0.88);
    ctx.lineTo(bx - tw * 0.5, topY + r * 0.4);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx + tw * 0.5, topY + r * 0.03);
    ctx.lineTo(bx + r * 0.3, topY + r * 0.03);
    ctx.lineTo(bx + r * 0.02, topY + r * 0.65);
    ctx.lineTo(bx + r * 0.25, topY + r * 0.88);
    ctx.lineTo(bx + tw * 0.5, topY + r * 0.4);
    ctx.closePath(); ctx.fill();
    // camisa blanca en V
    ctx.fillStyle = collar;
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.33, topY + r * 0.02);
    ctx.lineTo(bx, topY + r * 0.48);
    ctx.lineTo(bx + r * 0.33, topY + r * 0.02);
    ctx.closePath(); ctx.fill();
    // filo de las solapas
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.3, topY + r * 0.04);
    ctx.lineTo(bx - r * 0.02, topY + r * 0.65);
    ctx.lineTo(bx - r * 0.25, topY + r * 0.88);
    ctx.moveTo(bx + r * 0.3, topY + r * 0.04);
    ctx.lineTo(bx + r * 0.02, topY + r * 0.65);
    ctx.lineTo(bx + r * 0.25, topY + r * 0.88);
    ctx.stroke();
    // boton dorado
    ctx.fillStyle = 'rgba(255,230,160,0.9)';
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(bx + tw * 0.18, topY + r * (0.7 + i * 0.24), r * 0.036, 0, TAU);
      ctx.fill();
    }
    // pañuelo de bolsillo: un detalle de vestir que cambia la silueta
    if (L.pocketSquare) {
      const px = bx + r * 0.43, py = topY + r * 0.33;
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      roundRect(ctx, px - r * 0.16, py, r * 0.32, r * 0.18, 2); ctx.fill();
      ctx.fillStyle = L.pocketSquare;
      ctx.beginPath();
      ctx.moveTo(px - r * 0.13, py + r * 0.15);
      ctx.lineTo(px - r * 0.07, py + r * 0.01);
      ctx.lineTo(px + r * 0.01, py + r * 0.12);
      ctx.lineTo(px + r * 0.08, py + r * 0.01);
      ctx.lineTo(px + r * 0.13, py + r * 0.15);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px - r * 0.11, py + r * 0.15); ctx.lineTo(px + r * 0.11, py + r * 0.15); ctx.stroke();
    }
    // costura del hombro y abertura inferior de la americana
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(bx - tw * 0.41, topY + r * 0.13);
    ctx.quadraticCurveTo(bx - tw * 0.46, topY + th * 0.55, bx - tw * 0.42, topY + th * 0.92);
    ctx.moveTo(bx + tw * 0.41, topY + r * 0.13);
    ctx.quadraticCurveTo(bx + tw * 0.46, topY + th * 0.55, bx + tw * 0.42, topY + th * 0.92);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(bx - tw * 0.5, topY + th * 0.88);
    ctx.lineTo(bx - tw * 0.53, topY + th);
    ctx.moveTo(bx + tw * 0.5, topY + th * 0.88);
    ctx.lineTo(bx + tw * 0.53, topY + th);
    ctx.stroke();
  } else {
    // cuello redondo de la camiseta
    ctx.strokeStyle = shadeHex(shirt, -0.32);
    ctx.lineWidth = r * 0.085;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(bx, topY + r * 0.03, r * 0.36, Math.PI * 0.16, Math.PI * 0.84);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = r * 0.028;
    ctx.beginPath();
    ctx.arc(bx, topY + r * 0.05, r * 0.3, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
    ctx.lineCap = 'butt';
    if (L.hoodie) {
      // bolsillo frontal de la sudadera de Morante
      ctx.strokeStyle = shadeHex(shirt, -0.22);
      ctx.lineWidth = r * 0.055;
      ctx.beginPath();
      ctx.moveTo(bx - r * 0.36, ty0 + r * 0.02);
      ctx.quadraticCurveTo(bx - r * 0.16, ty0 + r * 0.3, bx, ty0 + r * 0.3);
      ctx.quadraticCurveTo(bx + r * 0.16, ty0 + r * 0.3, bx + r * 0.36, ty0 + r * 0.02);
      ctx.stroke();
      // cremallera y tirador de la sudadera
      ctx.strokeStyle = shadeHex(shirt, -0.34);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(bx, topY + r * 0.04);
      ctx.lineTo(bx, ty0 + r * 0.22);
      ctx.stroke();
      ctx.fillStyle = 'rgba(235,240,250,0.62)';
      for (let i = 0; i < 6; i++) ctx.fillRect(bx - r * 0.025, topY + r * 0.08 + i * r * 0.13, r * 0.05, r * 0.045);
      ctx.fillStyle = '#d9dee8';
      roundRect(ctx, bx - r * 0.055, topY + r * 0.16, r * 0.11, r * 0.15, 1); ctx.fill();
    }
  }

  const hemY = ty0 + r * 0.235;
  // Delantal de cocina / parrilla.
  if (L.apron) {
    ctx.fillStyle = L.apron;
    roundRect(ctx, bx - tw * 0.36, topY + th * 0.28, tw * 0.72, th * 0.82, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(40,40,45,0.28)';
    ctx.lineWidth = 1.2;
    roundRect(ctx, bx - tw * 0.36, topY + th * 0.28, tw * 0.72, th * 0.82, 4); ctx.stroke();
    ctx.fillStyle = shadeHex(L.apron, -0.14);
    roundRect(ctx, bx - tw * 0.2, topY + th * 0.5, tw * 0.4, r * 0.26, 3); ctx.fill();
  }
  // Banda de gala del director.
  if (L.sash) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(bx - tw * 0.45, topY + r * 0.05);
    ctx.lineTo(bx - tw * 0.26, topY + r * 0.02);
    ctx.lineTo(bx + tw * 0.45, topY + th * 0.84);
    ctx.lineTo(bx + tw * 0.23, topY + th * 0.9);
    ctx.closePath();
    ctx.fillStyle = L.sash;
    ctx.globalAlpha = 0.88;
    ctx.fill();
    ctx.restore();
  }

  // cinturon sobre la cintura
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  roundRect(ctx, bx - tw * 0.5, hemY - r * 0.06, tw, r * 0.12, 5); ctx.fill();
  ctx.fillStyle = '#1b2230';
  roundRect(ctx, bx - tw * 0.47, hemY, tw * 0.94, r * 0.11, 2); ctx.fill();
  ctx.fillStyle = '#c8a34b';
  roundRect(ctx, bx - r * 0.1, hemY + r * 0.016, r * 0.2, r * 0.078, 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  roundRect(ctx, bx - r * 0.045, hemY + r * 0.032, r * 0.09, r * 0.042, 1); ctx.fill();

  if (L.belly) {                                  // Ipa: barriguita
    ctx.fillStyle = shirt;
    ctx.beginPath(); ctx.ellipse(bx, ty0 - r * 0.1, tw * 0.62, r * 0.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.ellipse(bx, ty0 - r * 0.18, tw * 0.4, r * 0.24, 0, 0, TAU); ctx.fill();
  }
  // tirantes de la mochila sobre la camiseta
  if (L.bag) {
    ctx.strokeStyle = shadeHex(L.bag, -0.15);
    ctx.lineWidth = r * 0.16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.42, ty0 - r * 0.78);
    ctx.lineTo(bx - r * 0.3, ty0 - r * 0.05);
    ctx.moveTo(bx + r * 0.42, ty0 - r * 0.78);
    ctx.lineTo(bx + r * 0.3, ty0 - r * 0.05);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // hebillas metálicas de la mochila
    ctx.fillStyle = shadeHex(L.bag, 0.32);
    roundRect(ctx, bx - r * 0.47, ty0 - r * 0.48, r * 0.16, r * 0.09, 1); ctx.fill();
    roundRect(ctx, bx + r * 0.31, ty0 - r * 0.48, r * 0.16, r * 0.09, 1); ctx.fill();
    ctx.strokeStyle = 'rgba(20,24,34,0.35)';
    ctx.lineWidth = 1;
    roundRect(ctx, bx - r * 0.47, ty0 - r * 0.48, r * 0.16, r * 0.09, 1); ctx.stroke();
    roundRect(ctx, bx + r * 0.31, ty0 - r * 0.48, r * 0.16, r * 0.09, 1); ctx.stroke();
  }
  // chapa del colegio (alumnos) o tarjeta colgada (profesores)
  if (!L.teacher) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    roundRect(ctx, bx - r * 0.17, ty0 - r * 0.74, r * 0.34, r * 0.3, 2); ctx.fill();
    ctx.fillStyle = e.char.color;
    roundRect(ctx, bx - r * 0.11, ty0 - r * 0.68, r * 0.22, r * 0.18, 1); ctx.fill();
  } else {
    // identificación del colegio en la solapa izquierda, para que no quede
    // escondida detrás de la corbata
    ctx.strokeStyle = 'rgba(238,244,255,0.85)';
    ctx.lineWidth = r * 0.065;
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.34, topY + r * 0.08);
    ctx.lineTo(bx - r * 0.44, topY + r * 0.58);
    ctx.stroke();
    ctx.fillStyle = '#f2f6ff';
    roundRect(ctx, bx - r * 0.62, topY + r * 0.54, r * 0.38, r * 0.31, 2); ctx.fill();
    ctx.fillStyle = shadeHex(shirt, 0.18);
    roundRect(ctx, bx - r * 0.59, topY + r * 0.57, r * 0.32, r * 0.055, 1); ctx.fill();
    ctx.fillStyle = '#8892a6';
    ctx.fillRect(bx - r * 0.56, topY + r * 0.66, r * 0.26, r * 0.038);
    ctx.fillRect(bx - r * 0.56, topY + r * 0.74, r * 0.18, r * 0.038);
    ctx.fillStyle = '#c8a34b';
    ctx.beginPath(); ctx.arc(bx - r * 0.44, topY + r * 0.54, r * 0.04, 0, TAU); ctx.fill();
  }
  // contorno del torso
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2;
  roundRect(ctx, bx - tw / 2, ty0 - r * 0.82, tw, th, 5); ctx.stroke();
  // brazos
  const cuffCol = L.cuff || shadeHex(shirt2, -0.16);
  if (e.celebrate) {
    // Pose de victoria: brazos arriba y manos abiertas, meciéndose al ritmo
    // de la celebración. Solo se usa en la animación del final.
    const wave = Math.sin(now / 170 + seed) * 0.13;
    const armLen = r * 1.28, armW = r * 0.32;
    for (const side of [-1, 1]) {
      const shx = bx + side * (tw / 2 - r * 0.04);
      const shy = ty0 - r * 0.55;
      ctx.save();
      ctx.translate(shx, shy);
      ctx.rotate(-side * 2.42 + side * wave);
      ctx.fillStyle = armCol;
      roundRect(ctx, -armW / 2, -r * 0.03, armW, armLen, 3); ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.4;
      roundRect(ctx, -armW / 2, -r * 0.03, armW, armLen, 3); ctx.stroke();
      if (L.wrist) {
        ctx.fillStyle = L.wrist;
        roundRect(ctx, -armW / 2, armLen * 0.62, armW, r * 0.13, 3); ctx.fill();
      }
      // puño de la manga y reloj
      ctx.fillStyle = cuffCol;
      roundRect(ctx, -armW / 2, armLen * 0.72, armW, r * 0.1, 2); ctx.fill();
      if (L.watch && side === -1) {
        ctx.fillStyle = L.watch;
        roundRect(ctx, -armW / 2, armLen * 0.57, armW, r * 0.055, 2); ctx.fill();
      }
      if (L.teacher) {
        ctx.fillStyle = 'rgba(255,230,160,0.9)';
        ctx.beginPath(); ctx.arc(0, armLen * 0.76, r * 0.028, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(0, armLen, r * 0.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
    }
  } else if (striking) {
    // Pose de golpe: un brazo barre en arco y el otro queda en guardia.
    const atkSide = Math.cos(strikeDir) >= -0.05 ? 1 : -1;
    const sweep = Math.sin(Math.PI * clamp((strikeK - 0.05) / 0.9, 0, 1));
    const raise = Math.sin(Math.PI * clamp(strikeK / 0.72, 0, 1));
    const charge = e.strikeStyle === 'charge';
    const handX = bx + atkSide * r * (charge ? 0.72 + 0.62 * sweep : 0.58 + 0.98 * sweep);
    const handY = charge ? ty0 - r * (0.12 + 0.12 * raise) : ty0 - r * (0.22 + 0.42 * raise) + r * 0.26 * sweep;
    attackHand = {
      x: handX, y: handY, side: atkSide,
      angle: charge ? atkSide * (0.45 - 0.7 * sweep) : atkSide * (-1.25 + 2.5 * sweep)
    };
    const drawArm = (sx, sy, hx, hy, side, isStrike) => {
      const dx = hx - sx, dy = hy - sy;
      const len = Math.max(r * 0.34, Math.hypot(dx, dy));
      const ang = Math.atan2(dy, dx) - Math.PI / 2;
      const armW = r * 0.32;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(ang);
      ctx.fillStyle = armCol;
      roundRect(ctx, -armW / 2, -r * 0.03, armW, len, 3); ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.4;
      roundRect(ctx, -armW / 2, -r * 0.03, armW, len, 3); ctx.stroke();
      if (L.wrist) {
        ctx.fillStyle = L.wrist;
        roundRect(ctx, -armW / 2, len * 0.58, armW, r * 0.11, 3); ctx.fill();
      }
      ctx.fillStyle = cuffCol;
      roundRect(ctx, -armW / 2, len - r * 0.17, armW, r * 0.09, 2); ctx.fill();
      if (L.watch && side === -1) {
        ctx.fillStyle = L.watch;
        roundRect(ctx, -armW / 2, len * 0.47, armW, r * 0.05, 2); ctx.fill();
      }
      if (L.teacher) {
        ctx.fillStyle = 'rgba(255,230,160,0.9)';
        ctx.beginPath(); ctx.arc(0, len - r * 0.12, r * 0.026, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(0, len + r * 0.035, r * 0.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.2; ctx.stroke();
      if (isStrike) {
        ctx.strokeStyle = 'rgba(90,50,38,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-r * 0.1, len + r * 0.02);
        ctx.quadraticCurveTo(0, len + r * 0.07, r * 0.1, len + r * 0.02);
        ctx.stroke();
      }
      ctx.restore();
    };
    const shx = bx + atkSide * (tw / 2 - r * 0.02);
    const shy = ty0 - r * 0.55;
    const gx = bx - atkSide * (tw / 2 - r * 0.04);
    const gy = ty0 - r * 0.55;
    drawArm(gx, gy, bx - atkSide * r * 0.26, ty0 + r * 0.04, -atkSide, false);
    drawArm(shx, shy, handX, handY, atkSide, true);
  } else {
    ctx.fillStyle = armCol;
    roundRect(ctx, bx - tw / 2 - r * 0.26, ty0 - r * 0.66 + swing * 0.45, r * 0.32, r * 0.86, 3); ctx.fill();
    roundRect(ctx, bx + tw / 2 - r * 0.06, ty0 - r * 0.66 - swing * 0.45, r * 0.32, r * 0.86, 3); ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.4;
    roundRect(ctx, bx - tw / 2 - r * 0.26, ty0 - r * 0.66 + swing * 0.45, r * 0.32, r * 0.86, 3); ctx.stroke();
    roundRect(ctx, bx + tw / 2 - r * 0.06, ty0 - r * 0.66 - swing * 0.45, r * 0.32, r * 0.86, 3); ctx.stroke();
    // manos
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(bx - tw / 2 - r * 0.1, ty0 + r * 0.24 + swing * 0.45, r * 0.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(bx + tw / 2 + r * 0.1, ty0 + r * 0.24 - swing * 0.45, r * 0.2, 0, TAU); ctx.fill();
    // muñequeras
    if (L.wrist) {
      ctx.fillStyle = L.wrist;
      roundRect(ctx, bx - tw / 2 - r * 0.13, ty0 + r * 0.12 + swing * 0.45, r * 0.31, r * 0.13, 3); ctx.fill();
      roundRect(ctx, bx + tw / 2 - r * 0.04, ty0 + r * 0.12 - swing * 0.45, r * 0.31, r * 0.13, 3); ctx.fill();
    }
    // puños de la manga (los profesores llevan camisa blanca asomando)
    ctx.fillStyle = cuffCol;
    roundRect(ctx, bx - tw / 2 - r * 0.255, ty0 + r * 0.1 + swing * 0.45, r * 0.305, r * 0.09, 2); ctx.fill();
    roundRect(ctx, bx + tw / 2 - r * 0.045, ty0 + r * 0.1 - swing * 0.45, r * 0.305, r * 0.09, 2); ctx.fill();
    if (L.watch) {
      ctx.fillStyle = L.watch;
      roundRect(ctx, bx - tw / 2 - r * 0.25, ty0 + r * 0.107 + swing * 0.45, r * 0.295, r * 0.05, 2); ctx.fill();
    }
    if (L.teacher) {
      ctx.fillStyle = 'rgba(255,230,160,0.9)';
      ctx.beginPath(); ctx.arc(bx + tw / 2 + r * 0.1, ty0 + r * 0.145 - swing * 0.45, r * 0.026, 0, TAU); ctx.fill();
    }
  }

  // Bufanda de gala: rodea el cuello y cae sobre el pecho.
  if (L.scarf) {
    const sway = Math.sin(now / 320 + seed) * r * 0.04;
    ctx.fillStyle = L.scarf;
    roundRect(ctx, bx - r * 0.5, ty0 - r * 1.08, r * 1.0, r * 0.22, 7); ctx.fill();
    ctx.fillStyle = shadeHex(L.scarf, -0.18);
    roundRect(ctx, bx + r * 0.12, ty0 - r * 0.96, r * 0.22, r * 0.64 + sway, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    roundRect(ctx, bx - r * 0.5, ty0 - r * 1.08, r * 1.0, r * 0.22, 7); ctx.stroke();
  }

  // cuello y cabeza
  const headY = ty0 - r * 1.62;
  ctx.fillStyle = shadeHex(skin, -0.2);
  roundRect(ctx, bx - r * 0.16, ty0 - r * 1.08, r * 0.32, r * 0.34, 2); ctx.fill();
  // orejas
  ctx.fillStyle = shadeHex(skin, -0.1);
  ctx.beginPath(); ctx.arc(bx - r * 0.72, headY + r * 0.08, r * 0.15, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(bx + r * 0.72, headY + r * 0.08, r * 0.15, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(105,58,42,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(bx - r * 0.72, headY + r * 0.08, r * 0.075, Math.PI * 0.25, Math.PI * 0.95);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(bx + r * 0.72, headY + r * 0.08, r * 0.075, Math.PI * 0.05, Math.PI * 0.75);
  ctx.stroke();
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(bx, headY, r * 0.74, 0, TAU); ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2;
  ctx.stroke();
  // luz de borde en la cabeza
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(bx, headY, r * 0.69, Math.PI * 1.03, Math.PI * 1.34);
  ctx.stroke();
  // mejillas
  ctx.fillStyle = 'rgba(230,120,110,0.22)';
  ctx.beginPath(); ctx.arc(bx - r * 0.4, headY + r * 0.22, r * 0.15, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(bx + r * 0.4, headY + r * 0.22, r * 0.15, 0, TAU); ctx.fill();

  // pelo
  const hair = L.hair || '#2a2a34';
  ctx.fillStyle = hair;
  const hs = L.hairStyle || 'short';
  if (hs === 'bald') {
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.1, r * 0.72, Math.PI * 1.08, Math.PI * 1.92); ctx.fill();
    ctx.fillRect(bx - r * 0.72, headY - r * 0.22, r * 0.14, r * 0.4);
    ctx.fillRect(bx + r * 0.58, headY - r * 0.22, r * 0.14, r * 0.4);
  } else if (hs === 'long') {
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.22, r * 0.78, Math.PI, TAU); ctx.fill();
    roundRect(ctx, bx - r * 0.8, headY - r * 0.3, r * 0.26, r * 1.1, 4); ctx.fill();
    roundRect(ctx, bx + r * 0.54, headY - r * 0.3, r * 0.26, r * 1.1, 4); ctx.fill();
    // mechones: rompen la silueta plana del pelo largo
    ctx.strokeStyle = shadeHex(hair, -0.24);
    ctx.lineWidth = r * 0.04;
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.66, headY - r * 0.15);
    ctx.quadraticCurveTo(bx - r * 0.74, headY + r * 0.35, bx - r * 0.63, headY + r * 0.68);
    ctx.moveTo(bx + r * 0.66, headY - r * 0.15);
    ctx.quadraticCurveTo(bx + r * 0.74, headY + r * 0.35, bx + r * 0.63, headY + r * 0.68);
    ctx.stroke();
  } else if (hs === 'buzz') {
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.2, r * 0.73, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.ellipse(bx - r * 0.18, headY - r * 0.48, r * 0.36, r * 0.15, -0.2, 0, TAU); ctx.fill();
  } else if (hs === 'curly') {
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.arc(bx + i * r * 0.3, headY - r * 0.52 + Math.abs(i) * r * 0.06, r * 0.28, 0, TAU); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.24, r * 0.76, Math.PI, TAU); ctx.fill();
  } else if (hs === 'messy') {
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.24, r * 0.78, Math.PI * 0.98, TAU * 1.01); ctx.fill();
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(bx + i * r * 0.42 - r * 0.12, headY - r * 0.5);
      ctx.lineTo(bx + i * r * 0.42 + r * 0.1, headY - r * 1.05);
      ctx.lineTo(bx + i * r * 0.42 + r * 0.2, headY - r * 0.45);
      ctx.closePath(); ctx.fill();
    }
  } else if (hs === 'slick') {
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.2, r * 0.77, Math.PI, TAU); ctx.fill();
    // raya al lado y brillo de gomina
    ctx.fillStyle = shadeHex(hair, 0.22);
    ctx.beginPath(); ctx.ellipse(bx - r * 0.16, headY - r * 0.63, r * 0.52, r * 0.17, -0.18, 0, TAU); ctx.fill();
    ctx.strokeStyle = shadeHex(hair, -0.25);
    ctx.lineWidth = r * 0.035;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(bx + i * r * 0.14, headY - r * 0.74);
      ctx.quadraticCurveTo(bx + i * r * 0.1, headY - r * 0.55, bx + i * r * 0.06, headY - r * 0.38);
      ctx.stroke();
    }
  } else {
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.22, r * 0.75, Math.PI, TAU); ctx.fill();
    // raya lateral suave para que el pelo corto no parezca un casco
    ctx.strokeStyle = shadeHex(hair, -0.3);
    ctx.lineWidth = r * 0.035;
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.12, headY - r * 0.78);
    ctx.quadraticCurveTo(bx + r * 0.06, headY - r * 0.65, bx + r * 0.32, headY - r * 0.58);
    ctx.stroke();
  }
  // patillas cortas para dar volumen al peinado
  if (hs === 'short' || hs === 'slick' || hs === 'messy') {
    ctx.fillStyle = shadeHex(hair, -0.08);
    roundRect(ctx, bx - r * 0.69, headY - r * 0.12, r * 0.12, r * 0.33, 2); ctx.fill();
    roundRect(ctx, bx + r * 0.57, headY - r * 0.12, r * 0.12, r * 0.33, 2); ctx.fill();
  }
  if (hs === 'bald') {
    ctx.strokeStyle = 'rgba(255,255,255,0.26)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx - r * 0.08, headY - r * 0.22, r * 0.42, Math.PI * 1.08, Math.PI * 1.34);
    ctx.stroke();
  }
  // brillo del pelo
  if (hs !== 'bald') {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = r * 0.08;
    ctx.beginPath();
    ctx.arc(bx - r * 0.12, headY - r * 0.42, r * 0.58, Math.PI * 1.08, Math.PI * 1.45);
    ctx.stroke();
    // sombra bajo el nacimiento del pelo: da profundidad a la frente
    ctx.strokeStyle = 'rgba(25,15,20,0.10)';
    ctx.lineWidth = r * 0.055;
    ctx.beginPath();
    ctx.arc(bx, headY - r * 0.08, r * 0.63, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
  }

  // cinta del samurai / relampago
  if (L.headband) {
    ctx.fillStyle = L.headband;
    roundRect(ctx, bx - r * 0.74, headY - r * 0.42, r * 1.48, r * 0.2, 3); ctx.fill();
    ctx.strokeStyle = shadeHex(L.headband, -0.24);
    ctx.lineWidth = 1;
    roundRect(ctx, bx - r * 0.74, headY - r * 0.42, r * 1.48, r * 0.2, 3); ctx.stroke();
    ctx.fillStyle = shadeHex(L.headband, -0.12);
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.66, headY - r * 0.28);
    ctx.lineTo(bx - r * 0.95, headY + r * 0.12);
    ctx.lineTo(bx - r * 0.72, headY + r * 0.02);
    ctx.lineTo(bx - r * 0.5, headY - r * 0.18);
    ctx.closePath(); ctx.fill();
  }

  // sombreros y tocados de los trajes especiales
  if (L.hat === 'chef') {
    ctx.fillStyle = '#f7f7f2';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.arc(bx + i * r * 0.28, headY - r * 0.86, r * 0.31, 0, TAU); ctx.fill();
    }
    roundRect(ctx, bx - r * 0.46, headY - r * 0.82, r * 0.92, r * 0.34, 4); ctx.fill();
    ctx.fillStyle = '#d9d9d2';
    roundRect(ctx, bx - r * 0.44, headY - r * 0.5, r * 0.88, r * 0.1, 2); ctx.fill();
  } else if (L.hat === 'crown') {
    ctx.fillStyle = '#f7d35a';
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.58, headY - r * 0.72);
    ctx.lineTo(bx - r * 0.44, headY - r * 1.14);
    ctx.lineTo(bx - r * 0.16, headY - r * 0.9);
    ctx.lineTo(bx, headY - r * 1.24);
    ctx.lineTo(bx + r * 0.16, headY - r * 0.9);
    ctx.lineTo(bx + r * 0.44, headY - r * 1.14);
    ctx.lineTo(bx + r * 0.58, headY - r * 0.72);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff5d8f';
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.9, r * 0.08, 0, TAU); ctx.fill();
  } else if (L.hat === 'top') {
    ctx.fillStyle = '#17151c';
    roundRect(ctx, bx - r * 0.62, headY - r * 0.82, r * 1.24, r * 0.16, 4); ctx.fill();
    roundRect(ctx, bx - r * 0.4, headY - r * 1.46, r * 0.8, r * 0.72, 4); ctx.fill();
    ctx.fillStyle = L.accColor || '#d9b85a';
    roundRect(ctx, bx - r * 0.4, headY - r * 1.02, r * 0.8, r * 0.12, 2); ctx.fill();
  } else if (L.hat === 'bowler') {
    ctx.fillStyle = '#1b1a20';
    ctx.beginPath(); ctx.ellipse(bx, headY - r * 0.63, r * 0.84, r * 0.17, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.76, r * 0.49, Math.PI, TAU); ctx.fill();
    roundRect(ctx, bx - r * 0.49, headY - r * 0.8, r * 0.98, r * 0.24, 4); ctx.fill();
    ctx.fillStyle = '#5a1e2b';
    roundRect(ctx, bx - r * 0.49, headY - r * 0.63, r * 0.98, r * 0.07, 2); ctx.fill();
  } else if (L.hat === 'fedora') {
    ctx.fillStyle = '#172538';
    ctx.beginPath(); ctx.ellipse(bx, headY - r * 0.64, r * 0.9, r * 0.18, 0, 0, TAU); ctx.fill();
    roundRect(ctx, bx - r * 0.44, headY - r * 1.16, r * 0.88, r * 0.52, 5); ctx.fill();
    ctx.fillStyle = '#bfeaff';
    roundRect(ctx, bx - r * 0.44, headY - r * 0.76, r * 0.88, r * 0.09, 2); ctx.fill();
  } else if (L.hat === 'bandana') {
    ctx.fillStyle = L.accColor || '#ffb35c';
    roundRect(ctx, bx - r * 0.68, headY - r * 0.5, r * 1.36, r * 0.2, 4); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx + r * 0.6, headY - r * 0.4);
    ctx.lineTo(bx + r * 0.95, headY - r * 0.08);
    ctx.lineTo(bx + r * 0.66, headY + r * 0.04);
    ctx.closePath(); ctx.fill();
  } else if (L.hat === 'halo') {
    ctx.strokeStyle = 'rgba(205,255,250,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(bx, headY - r * 1.12, r * 0.54, r * 0.16, 0, 0, TAU); ctx.stroke();
  } else if (L.hat === 'clown') {
    ctx.fillStyle = '#ff5d8f';
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.35, headY - r * 0.7);
    ctx.lineTo(bx + r * 0.12, headY - r * 1.45);
    ctx.lineTo(bx + r * 0.42, headY - r * 0.66);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd85e';
    ctx.beginPath(); ctx.arc(bx + r * 0.14, headY - r * 1.38, r * 0.1, 0, TAU); ctx.fill();
  } else if (L.hat === 'hood') {
    ctx.strokeStyle = shadeHex(shirt2, -0.32);
    ctx.lineWidth = r * 0.3;
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.04, r * 0.92, Math.PI * 0.8, TAU * 1.2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.04, r * 0.77, Math.PI * 0.84, TAU * 1.16); ctx.stroke();
  } else if (L.hat === 'carnival') {
    // Penacho de plumas de carnaval.
    const featherCols = ['#ff4fa3', '#ffd166', '#5fe3d1', '#c77dff', '#ff8a5c'];
    for (let i = -2; i <= 2; i++) {
      ctx.save();
      ctx.translate(bx + i * r * 0.18, headY - r * 0.55);
      ctx.rotate(i * 0.24);
      ctx.fillStyle = featherCols[(i + 2) % featherCols.length];
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.62, r * 0.16, r * 0.66, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -r * 0.1); ctx.lineTo(0, -r * 1.16); ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = L.accColor || '#ffd166';
    roundRect(ctx, bx - r * 0.7, headY - r * 0.52, r * 1.4, r * 0.2, 5); ctx.fill();
    ctx.fillStyle = '#ff4fa3';
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.42, r * 0.09, 0, TAU); ctx.fill();
  } else if (L.hat === 'crescent') {
    // Luna creciente sobre la cabeza.
    ctx.fillStyle = L.accColor || '#e8f6ff';
    ctx.beginPath();
    ctx.arc(bx, headY - r * 1.02, r * 0.3, Math.PI * 0.45, Math.PI * 1.55, false);
    ctx.arc(bx + r * 0.14, headY - r * 1.02, r * 0.25, Math.PI * 1.55, Math.PI * 0.45, true);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else if (L.hat === 'helm') {
    // Casco de guardián: cubre la parte superior y deja la cara libre.
    ctx.fillStyle = '#c9d6e8';
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.06, r * 0.83, Math.PI * 1.04, Math.PI * 1.96); ctx.fill();
    ctx.fillStyle = '#8fa3bd';
    roundRect(ctx, bx - r * 0.84, headY - r * 0.22, r * 0.18, r * 0.5, 4); ctx.fill();
    roundRect(ctx, bx + r * 0.66, headY - r * 0.22, r * 0.18, r * 0.5, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.06, r * 0.72, Math.PI * 1.08, Math.PI * 1.4); ctx.stroke();
    ctx.fillStyle = L.accColor || '#7ee787';
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.1, headY - r * 0.88);
    ctx.lineTo(bx + r * 0.1, headY - r * 0.88);
    ctx.lineTo(bx + r * 0.18, headY - r * 0.55);
    ctx.lineTo(bx - r * 0.18, headY - r * 0.55);
    ctx.closePath(); ctx.fill();
  } else if (L.hat === 'beret') {
    // Boina de pastelera.
    ctx.fillStyle = '#fff4f7';
    ctx.beginPath(); ctx.ellipse(bx + r * 0.06, headY - r * 0.74, r * 0.72, r * 0.3, -0.16, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#e89ab8';
    ctx.lineWidth = r * 0.09;
    ctx.beginPath(); ctx.ellipse(bx + r * 0.06, headY - r * 0.64, r * 0.64, r * 0.16, -0.16, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#ff8fb8';
    ctx.beginPath(); ctx.arc(bx + r * 0.1, headY - r * 1.02, r * 0.09, 0, TAU); ctx.fill();
  } else if (L.hat === 'space') {
    // Casco transparente: la cara sigue viéndose.
    ctx.fillStyle = 'rgba(180,235,255,0.12)';
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.04, r * 0.98, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(180,235,255,0.8)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.04, r * 0.98, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(bx - r * 0.12, headY - r * 0.2, r * 0.7, Math.PI * 1.1, Math.PI * 1.55); ctx.stroke();
    ctx.fillStyle = '#cfd8e8';
    roundRect(ctx, bx - r * 0.78, headY + r * 0.68, r * 1.56, r * 0.18, 6); ctx.fill();
    ctx.fillStyle = '#8fa3bd';
    roundRect(ctx, bx - r * 0.6, headY + r * 0.74, r * 1.2, r * 0.08, 3); ctx.fill();
    ctx.strokeStyle = L.accColor || '#ffb35c';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(bx + r * 0.34, headY - r * 0.92); ctx.lineTo(bx + r * 0.54, headY - r * 1.34); ctx.stroke();
    ctx.fillStyle = L.accColor || '#ffb35c';
    ctx.beginPath(); ctx.arc(bx + r * 0.54, headY - r * 1.36, r * 0.08, 0, TAU); ctx.fill();
  } else if (L.hat === 'aviator') {
    // Gorra de aviador con gafas sobre la frente.
    ctx.fillStyle = '#7a4a22';
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.18, r * 0.8, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = '#5a3418';
    ctx.beginPath(); ctx.ellipse(bx + fx * r * 0.5, headY - r * 0.32, r * 0.62, r * 0.17, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2a1a10';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.2, r * 0.79, Math.PI * 1.02, Math.PI * 1.98); ctx.stroke();
    for (const side of [-1, 1]) {
      const gx = bx + side * r * 0.31;
      const gy = headY - r * 0.44;
      ctx.fillStyle = hexRgba(L.accColor || '#5fe3d1', 0.35);
      ctx.beginPath(); ctx.arc(gx, gy, r * 0.19, 0, TAU); ctx.fill();
      ctx.strokeStyle = L.accColor || '#5fe3d1';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(gx, gy, r * 0.19, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.arc(gx - r * 0.06, gy - r * 0.06, r * 0.045, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = '#2a1a10';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx - r * 0.12, headY - r * 0.44); ctx.lineTo(bx + r * 0.12, headY - r * 0.44); ctx.stroke();
  } else if (L.hat === 'catears') {
    // Orejas de gato.
    for (const side of [-1, 1]) {
      ctx.fillStyle = L.hair || '#241a2e';
      ctx.beginPath();
      ctx.moveTo(bx + side * r * 0.42, headY - r * 0.56);
      ctx.lineTo(bx + side * r * 0.78, headY - r * 1.16);
      ctx.lineTo(bx + side * r * 0.16, headY - r * 0.88);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = L.accColor || '#ff8fb8';
      ctx.beginPath();
      ctx.moveTo(bx + side * r * 0.44, headY - r * 0.62);
      ctx.lineTo(bx + side * r * 0.66, headY - r * 1.02);
      ctx.lineTo(bx + side * r * 0.28, headY - r * 0.86);
      ctx.closePath(); ctx.fill();
    }
  } else if (L.hat === 'antenna') {
    // Antenas de ídolo galáctico.
    ctx.strokeStyle = L.accColor || '#7df9ff';
    ctx.lineWidth = 2.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(bx + side * r * 0.3, headY - r * 0.76);
      ctx.quadraticCurveTo(bx + side * r * 0.62, headY - r * 1.12, bx + side * r * 0.52, headY - r * 1.42);
      ctx.stroke();
      ctx.fillStyle = side < 0 ? (L.accColor || '#7df9ff') : (L.accColor2 || '#ff5fd2');
      ctx.beginPath(); ctx.arc(bx + side * r * 0.52, headY - r * 1.44, r * 0.08, 0, TAU); ctx.fill();
    }
  } else if (L.hat === 'mortarboard') {
    // Birrete académico con borla.
    ctx.fillStyle = '#1a1028';
    ctx.beginPath();
    ctx.moveTo(bx, headY - r * 1.2);
    ctx.lineTo(bx + r * 0.98, headY - r * 0.9);
    ctx.lineTo(bx, headY - r * 0.6);
    ctx.lineTo(bx - r * 0.98, headY - r * 0.9);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a1542';
    roundRect(ctx, bx - r * 0.5, headY - r * 0.78, r * 1.0, r * 0.28, 3); ctx.fill();
    ctx.strokeStyle = L.accColor || '#ffd166';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx + r * 0.4, headY - r * 0.86);
    ctx.quadraticCurveTo(bx + r * 0.62, headY - r * 0.66, bx + r * 0.56, headY - r * 0.36);
    ctx.stroke();
    ctx.fillStyle = L.accColor || '#ffd166';
    ctx.beginPath(); ctx.arc(bx + r * 0.56, headY - r * 0.34, r * 0.075, 0, TAU); ctx.fill();
  } else if (L.hat === 'plume') {
    // Sombrero de teatro con pluma.
    ctx.fillStyle = '#1a0d24';
    ctx.beginPath(); ctx.ellipse(bx, headY - r * 0.64, r * 0.9, r * 0.17, 0, 0, TAU); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.52, headY - r * 0.68);
    ctx.quadraticCurveTo(bx, headY - r * 1.28, bx + r * 0.52, headY - r * 0.68);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = L.accColor || '#ffd166';
    roundRect(ctx, bx - r * 0.52, headY - r * 0.74, r * 1.04, r * 0.08, 2); ctx.fill();
    ctx.save();
    ctx.translate(bx + r * 0.3, headY - r * 0.88);
    ctx.rotate(-0.5);
    ctx.fillStyle = '#ff8fb8';
    ctx.beginPath(); ctx.ellipse(0, -r * 0.42, r * 0.15, r * 0.58, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 0.95); ctx.stroke();
    ctx.restore();
  }

  // cara: cejas, ojos y boca (miran hacia donde va)
  const ex = clamp(fx, -1, 1) * r * 0.2, ey = clamp(fy, -1, 1) * r * 0.1;
  // Antifaz de gala: dos lentes con puente, dibujadas antes de los ojos
  // para que la mirada quede visible.
  if (L.mask && !back) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    for (const side of [-1, 1]) {
      const mx = bx + side * r * 0.28 + ex * 0.5;
      const my = headY - r * 0.01 + ey * 0.5;
      ctx.fillStyle = L.mask;
      ctx.beginPath();
      ctx.ellipse(mx, my, r * 0.31, r * 0.21, side * 0.14, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = L.mask;
    roundRect(ctx, bx - r * 0.13 + ex * 0.5, headY - r * 0.07 + ey * 0.5, r * 0.26, r * 0.06, 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(bx - r * 0.36 + ex * 0.5, headY - r * 0.08 + ey * 0.5, r * 0.035, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(bx + r * 0.36 + ex * 0.5, headY - r * 0.08 + ey * 0.5, r * 0.035, 0, TAU); ctx.fill();
    ctx.restore();
  }
  if (!back) {
    ctx.strokeStyle = shadeHex(hair, -0.3);
    ctx.lineWidth = r * 0.1;
    ctx.beginPath();
    if (L.brows === 'angry' || striking || (e.kind === 'teacher' && e.chargeT > 0)) {
      ctx.moveTo(bx - r * 0.46 + ex, headY - r * 0.32 + ey);
      ctx.lineTo(bx - r * 0.13 + ex, headY - r * 0.2 + ey);
      ctx.moveTo(bx + r * 0.13 + ex, headY - r * 0.2 + ey);
      ctx.lineTo(bx + r * 0.46 + ex, headY - r * 0.32 + ey);
    } else {
      ctx.moveTo(bx - r * 0.44 + ex, headY - r * 0.26 + ey);
      ctx.lineTo(bx - r * 0.14 + ex, headY - r * 0.29 + ey);
      ctx.moveTo(bx + r * 0.14 + ex, headY - r * 0.29 + ey);
      ctx.lineTo(bx + r * 0.44 + ex, headY - r * 0.26 + ey);
    }
    ctx.stroke();
    // ojos (se cierran al comer, al parpadear o al peinarse)
    if (eating || (e.kind === 'teacher' && e.combT > 0)) {
      ctx.strokeStyle = '#1b1f2a';
      ctx.lineWidth = r * 0.06;
      ctx.beginPath(); ctx.arc(bx - r * 0.27 + ex, headY + r * 0.02 + ey, r * 0.12, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(bx + r * 0.27 + ex, headY + r * 0.02 + ey, r * 0.12, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    } else if (blink) {
      ctx.strokeStyle = '#1b1f2a';
      ctx.lineWidth = r * 0.06;
      ctx.beginPath();
      ctx.moveTo(bx - r * 0.38 + ex, headY + ey);
      ctx.quadraticCurveTo(bx - r * 0.27 + ex, headY + r * 0.06 + ey, bx - r * 0.16 + ex, headY + ey);
      ctx.moveTo(bx + r * 0.16 + ex, headY + ey);
      ctx.quadraticCurveTo(bx + r * 0.27 + ex, headY + r * 0.06 + ey, bx + r * 0.38 + ex, headY + ey);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(bx - r * 0.27 + ex, headY - r * 0.01 + ey, r * 0.16, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(bx + r * 0.27 + ex, headY - r * 0.01 + ey, r * 0.16, 0, TAU); ctx.fill();
      const eyeCol = L.eye || '#1b1f2a';
      ctx.fillStyle = eyeCol;
      ctx.beginPath(); ctx.arc(bx - r * 0.27 + ex * 1.5, headY - r * 0.01 + ey, r * 0.095, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(bx + r * 0.27 + ex * 1.5, headY - r * 0.01 + ey, r * 0.095, 0, TAU); ctx.fill();
      ctx.fillStyle = '#10141d';
      ctx.beginPath(); ctx.arc(bx - r * 0.27 + ex * 1.7, headY + ey, r * 0.045, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(bx + r * 0.27 + ex * 1.7, headY + ey, r * 0.045, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(bx - r * 0.3 + ex * 1.5, headY - r * 0.06 + ey, r * 0.034, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(bx + r * 0.24 + ex * 1.5, headY - r * 0.06 + ey, r * 0.034, 0, TAU); ctx.fill();
      // párpado superior: mirada más viva y menos “ojos de botón”
      ctx.strokeStyle = shadeHex(skin, -0.42);
      ctx.lineWidth = Math.max(1, r * 0.028);
      ctx.beginPath(); ctx.arc(bx - r * 0.27 + ex, headY - r * 0.01 + ey, r * 0.16, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(bx + r * 0.27 + ex, headY - r * 0.01 + ey, r * 0.16, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    }
    // nariz: una curva corta y su sombra nasal
    const noseX = bx + ex * 0.8;
    ctx.strokeStyle = shadeHex(skin, -0.38);
    ctx.lineWidth = Math.max(1, r * 0.038);
    ctx.beginPath();
    ctx.moveTo(noseX + r * 0.03, headY + r * 0.1 + ey);
    ctx.quadraticCurveTo(noseX + r * 0.1, headY + r * 0.2 + ey, noseX + r * 0.02, headY + r * 0.23 + ey);
    ctx.stroke();
    ctx.fillStyle = 'rgba(90,45,35,0.18)';
    ctx.beginPath(); ctx.ellipse(noseX + r * 0.1, headY + r * 0.235 + ey, r * 0.045, r * 0.022, 0, 0, TAU); ctx.fill();
    if (L.clownNose) {
      ctx.fillStyle = '#ff2f4f';
      ctx.beginPath(); ctx.arc(noseX + r * 0.08, headY + r * 0.18 + ey, r * 0.16, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.beginPath(); ctx.arc(noseX + r * 0.02, headY + r * 0.12 + ey, r * 0.045, 0, TAU); ctx.fill();
    }
    // ojeras de Morante
    if (L.bags) {
      ctx.strokeStyle = 'rgba(80,60,120,0.42)';
      ctx.lineWidth = r * 0.04;
      ctx.beginPath(); ctx.arc(bx - r * 0.27 + ex, headY + r * 0.09 + ey, r * 0.16, Math.PI * 0.18, Math.PI * 0.82); ctx.stroke();
      ctx.beginPath(); ctx.arc(bx + r * 0.27 + ex, headY + r * 0.09 + ey, r * 0.16, Math.PI * 0.18, Math.PI * 0.82); ctx.stroke();
    }
    // pecas de Elías
    if (L.freckles) {
      ctx.fillStyle = 'rgba(150,90,55,0.5)';
      const fr = [[-0.34, 0.2], [-0.46, 0.28], [-0.3, 0.32], [0.34, 0.2], [0.46, 0.28], [0.3, 0.32]];
      for (const p of fr) {
        ctx.beginPath(); ctx.arc(bx + p[0] * r + ex * 0.4, headY + p[1] * r + ey * 0.4, r * 0.025, 0, TAU); ctx.fill();
      }
    }
    // bigote con puntas: más expresivo que una barra plana
    if (L.moustache) {
      ctx.fillStyle = shadeHex(hair, -0.05);
      ctx.beginPath();
      ctx.moveTo(bx - r * 0.36 + ex, headY + r * 0.31 + ey);
      ctx.quadraticCurveTo(bx - r * 0.2 + ex, headY + r * 0.26 + ey, bx + ex, headY + r * 0.34 + ey);
      ctx.quadraticCurveTo(bx + r * 0.2 + ex, headY + r * 0.26 + ey, bx + r * 0.36 + ex, headY + r * 0.31 + ey);
      ctx.quadraticCurveTo(bx + r * 0.2 + ex, headY + r * 0.4 + ey, bx + ex, headY + r * 0.38 + ey);
      ctx.quadraticCurveTo(bx - r * 0.2 + ex, headY + r * 0.4 + ey, bx - r * 0.36 + ex, headY + r * 0.31 + ey);
      ctx.closePath(); ctx.fill();
    }
    // boca
    const chewing = eating && Math.sin(now / 55) > 0;
    const talking = e.talkT > 0 && Math.sin(now / 90) > 0;
    ctx.strokeStyle = 'rgba(96,44,44,0.85)';
    ctx.lineWidth = r * 0.09;
    if (chewing || talking) {
      ctx.fillStyle = 'rgba(70,30,30,0.9)';
      ctx.beginPath(); ctx.ellipse(bx + ex, headY + r * 0.42 + ey, r * 0.14, r * 0.1, 0, 0, TAU); ctx.fill();
    } else {
      ctx.beginPath();
      if (e.celebrate || L.smile) {
        ctx.arc(bx + ex, headY + r * 0.22 + ey, r * 0.26, 0.18 * Math.PI, 0.82 * Math.PI);
      } else if (striking) {
        // Dientes apretados al golpear: la cara tambien entra en la accion.
        ctx.fillStyle = 'rgba(70,30,30,0.92)';
        ctx.beginPath();
        ctx.ellipse(bx + ex, headY + r * 0.44 + ey, r * 0.2, r * 0.12, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,245,230,0.92)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(bx - r * 0.13 + ex, headY + r * 0.42 + ey);
        ctx.lineTo(bx + r * 0.13 + ex, headY + r * 0.42 + ey);
        ctx.stroke();
      } else if (e.kind === 'teacher' && e.chargeT > 0) {
        ctx.moveTo(bx - r * 0.18 + ex, headY + r * 0.46 + ey);
        ctx.lineTo(bx + r * 0.18 + ex, headY + r * 0.42 + ey);
      } else if (L.teacher) {
        ctx.moveTo(bx - r * 0.2 + ex, headY + r * 0.44 + ey);
        ctx.lineTo(bx + r * 0.2 + ex, headY + r * 0.44 + ey);
      } else {
        ctx.moveTo(bx - r * 0.17 + ex, headY + r * 0.4 + ey);
        ctx.quadraticCurveTo(bx + ex, headY + r * 0.5 + ey, bx + r * 0.17 + ex, headY + r * 0.4 + ey);
      }
      ctx.stroke();
    }
    // sombra del mentón, para separar la cara del cuello
    ctx.fillStyle = 'rgba(115,55,45,0.11)';
    ctx.beginPath(); ctx.ellipse(bx + ex * 0.55, headY + r * 0.57 + ey, r * 0.17, r * 0.05, 0, 0, TAU); ctx.fill();
    // gota de sudor cuando queda poca vida: un detalle de estado muy legible
    if (lowHp && !striking) {
      const sy = headY - r * 0.52 + Math.sin(now / 260 + seed) * r * 0.06;
      ctx.fillStyle = 'rgba(155,225,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(bx + r * 0.58, sy - r * 0.18);
      ctx.quadraticCurveTo(bx + r * 0.72, sy, bx + r * 0.58, sy + r * 0.12);
      ctx.quadraticCurveTo(bx + r * 0.44, sy, bx + r * 0.58, sy - r * 0.18);
      ctx.fill();
      ctx.strokeStyle = 'rgba(75,150,190,0.5)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  } else {
    // de espaldas: el pelo cubre la nuca
    ctx.fillStyle = hair;
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.05, r * 0.77, Math.PI * 0.94, TAU * 1.06); ctx.fill();
  }
  // gorra del profe de gimnasia
  if (L.cap && L.acc !== 'cap') {
    ctx.fillStyle = L.cap;
    ctx.beginPath(); ctx.arc(bx, headY - r * 0.2, r * 0.8, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = shadeHex(L.cap, -0.2);
    ctx.beginPath(); ctx.ellipse(bx + fx * r * 0.6, headY - r * 0.3, r * 0.64, r * 0.2, 0, 0, TAU); ctx.fill();
  }

  // complementos
  if (L.glasses) {
    const gs = L.glassesStyle || 'round';
    if (gs === 'shades') {
      // Gafas de sol: lentes oscuras con reflejo y montura metálica.
      for (const side of [-1, 1]) {
        const lx = bx + side * r * 0.29 + ex * 0.8;
        const ly = headY - r * 0.01 + ey * 0.8;
        const grad = ctx.createLinearGradient(lx - r * 0.2, ly - r * 0.16, lx + r * 0.2, ly + r * 0.16);
        grad.addColorStop(0, 'rgba(18,22,34,0.95)');
        grad.addColorStop(0.55, 'rgba(52,62,88,0.92)');
        grad.addColorStop(1, 'rgba(8,10,18,0.98)');
        ctx.fillStyle = grad;
        roundRect(ctx, lx - r * 0.24, ly - r * 0.17, r * 0.48, r * 0.34, 7); ctx.fill();
        ctx.strokeStyle = L.accColor || '#ffd166';
        ctx.lineWidth = 2;
        roundRect(ctx, lx - r * 0.24, ly - r * 0.17, r * 0.48, r * 0.34, 7); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(lx - r * 0.12, ly - r * 0.08);
        ctx.lineTo(lx + r * 0.05, ly - r * 0.12);
        ctx.stroke();
      }
      ctx.strokeStyle = L.accColor || '#ffd166';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx - r * 0.05 + ex * 0.8, headY - r * 0.02 + ey * 0.8);
      ctx.lineTo(bx + r * 0.05 + ex * 0.8, headY - r * 0.02 + ey * 0.8);
      ctx.stroke();
    } else if (gs === 'visor') {
      // Visor futurista: una banda translúcida sobre los ojos.
      const vg = ctx.createLinearGradient(bx - r * 0.7, headY, bx + r * 0.7, headY);
      vg.addColorStop(0, hexRgba(L.accColor || '#7df9ff', 0.18));
      vg.addColorStop(0.5, hexRgba(L.accColor || '#7df9ff', 0.55));
      vg.addColorStop(1, hexRgba(L.accColor2 || '#ff4fd8', 0.18));
      ctx.fillStyle = vg;
      roundRect(ctx, bx - r * 0.7 + ex * 0.5, headY - r * 0.16 + ey * 0.5, r * 1.4, r * 0.32, 8); ctx.fill();
      ctx.strokeStyle = L.accColor || '#7df9ff';
      ctx.lineWidth = 2;
      roundRect(ctx, bx - r * 0.7 + ex * 0.5, headY - r * 0.16 + ey * 0.5, r * 1.4, r * 0.32, 8); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(bx - r * 0.55 + ex * 0.5, headY - r * 0.08 + ey * 0.5);
      ctx.lineTo(bx + r * 0.45 + ex * 0.5, headY - r * 0.08 + ey * 0.5);
      ctx.stroke();
    } else {
      // Gafas redondas clásicas.
      ctx.fillStyle = 'rgba(155,215,255,0.14)';
      ctx.beginPath(); ctx.arc(bx - r * 0.27 + ex, headY + ey, r * 0.26, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(bx + r * 0.27 + ex, headY + ey, r * 0.26, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(20,24,34,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bx - r * 0.27 + ex, headY + ey, r * 0.26, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(bx + r * 0.27 + ex, headY + ey, r * 0.26, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(bx - r * 0.39 + ex, headY - r * 0.04 + ey);
      ctx.lineTo(bx - r * 0.27 + ex, headY - r * 0.16 + ey);
      ctx.stroke();
    }
  }
  if (L.tie) {
    const ty = topY + r * 0.02;
    ctx.fillStyle = '#f5f7fb';
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.31, ty); ctx.lineTo(bx + r * 0.31, ty);
    ctx.lineTo(bx, ty + r * 0.3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shadeHex(L.tie, -0.24);
    roundRect(ctx, bx - r * 0.13, ty + r * 0.27, r * 0.26, r * 0.15, 2); ctx.fill();
    ctx.fillStyle = L.tie;
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.14, ty + r * 0.4);
    ctx.lineTo(bx + r * 0.14, ty + r * 0.4);
    ctx.lineTo(bx + r * 0.19, ty + r * 0.78);
    ctx.lineTo(bx, ty + r * 1.06);
    ctx.lineTo(bx - r * 0.19, ty + r * 0.78);
    ctx.closePath(); ctx.fill();
    if (L.tieClip) {
      ctx.fillStyle = L.tieClip;
      roundRect(ctx, bx - r * 0.135, ty + r * 0.61, r * 0.27, r * 0.045, 1); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(bx - r * 0.1, ty + r * 0.625, r * 0.075, r * 0.016);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.04, ty + r * 0.45);
    ctx.lineTo(bx - r * 0.02, ty + r * 0.96);
    ctx.stroke();
  }
  // cadena de Jonny
  if (L.chain) {
    ctx.strokeStyle = '#ffd75e';
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    ctx.arc(bx, ty0 - r * 0.78, r * 0.27, Math.PI * 0.18, Math.PI * 0.82);
    ctx.stroke();
    ctx.fillStyle = '#ffd75e';
    ctx.beginPath(); ctx.arc(bx, ty0 - r * 0.48, r * 0.085, 0, TAU); ctx.fill();
  }
  // En la celebración estudiantil conservamos gorras, capuchas y cascos:
  // son parte de la identidad de cada alumno. Los objetos de las manos
  // (regla, sándwich, agenda...) sí se ocultan para levantar los brazos.
  const partyHeadgear = e.celebrate && e.kind === 'student' &&
    (L.acc === 'headphones' || L.acc === 'cap' || L.acc === 'hood');
  if (!e.celebrate || partyHeadgear) switch (L.acc) {
    case 'headphones': {
      ctx.strokeStyle = L.accColor2 || '#20242f';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(bx, headY - r * 0.08, r * 0.8, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      ctx.fillStyle = L.accColor || '#4f9bff';
      roundRect(ctx, bx - r * 0.95, headY - r * 0.3, r * 0.34, r * 0.6, 3); ctx.fill();
      roundRect(ctx, bx + r * 0.61, headY - r * 0.3, r * 0.34, r * 0.6, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      roundRect(ctx, bx - r * 0.9, headY - r * 0.24, r * 0.08, r * 0.42, 2); ctx.fill();
      break;
    }
    case 'cap': {
      const capCol = L.accColor || L.cap || '#e8544f';
      ctx.fillStyle = capCol;
      ctx.beginPath(); ctx.arc(bx, headY - r * 0.2, r * 0.78, Math.PI, TAU); ctx.fill();
      ctx.fillStyle = shadeHex(capCol, -0.18);
      ctx.beginPath();
      ctx.ellipse(bx + fx * r * 0.6, headY - r * 0.3, r * 0.62, r * 0.2, 0, 0, TAU);
      ctx.fill();
      break;
    }
    case 'hood': {
      // capucha como un aro grueso: deja la cara completamente visible
      ctx.strokeStyle = shade(shirt2, -0.2);
      ctx.lineWidth = r * 0.3;
      ctx.beginPath();
      ctx.arc(bx, headY - r * 0.02, r * 0.9, Math.PI * 0.78, TAU * 1.22);
      ctx.stroke();
      ctx.strokeStyle = shade(shirt2, 0.16);
      ctx.lineWidth = r * 0.055;
      ctx.beginPath();
      ctx.arc(bx, headY - r * 0.02, r * 0.75, Math.PI * 0.84, TAU * 1.16);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(10,10,20,0.16)';
      ctx.lineWidth = r * 0.08;
      ctx.beginPath();
      ctx.arc(bx, headY - r * 0.02, r * 0.69, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      if (L.strings) {
        ctx.strokeStyle = '#e8ecf5';
        ctx.lineWidth = r * 0.05;
        ctx.beginPath();
        ctx.moveTo(bx - r * 0.14, headY + r * 0.62);
        ctx.lineTo(bx - r * 0.18, headY + r * 1.05);
        ctx.moveTo(bx + r * 0.14, headY + r * 0.62);
        ctx.lineTo(bx + r * 0.18, headY + r * 1.05);
        ctx.stroke();
        ctx.fillStyle = '#d9dee8';
        ctx.beginPath(); ctx.arc(bx - r * 0.18, headY + r * 1.06, r * 0.05, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(bx + r * 0.18, headY + r * 1.06, r * 0.05, 0, TAU); ctx.fill();
      }
      break;
    }
    case 'ruler': {
      const hx = attackHand ? attackHand.x : bx + tw / 2 + r * 0.1;
      const hy = attackHand ? attackHand.y : by + r * 0.24 - swing * 0.45;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(attackHand ? attackHand.angle : (e.cd > 0 ? -0.5 : 0.5 + swing * 0.4));
      const rulerCol = L.accColor || '#f4f7ff';
      ctx.fillStyle = rulerCol;
      roundRect(ctx, -r * 0.12, -r * 1.5, r * 0.3, r * 1.7, 2); ctx.fill();
      ctx.strokeStyle = 'rgba(40,60,90,0.9)';
      ctx.lineWidth = 1.2;
      for (let i = 1; i <= 4; i++) {
        const yy = -r * 1.5 + i * (r * 1.7 / 5);
        ctx.beginPath(); ctx.moveTo(-r * 0.12, yy); ctx.lineTo(r * 0.02, yy); ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'baton': {
      // Batuta de director: una varilla dorada con punta luminosa.
      const hx = attackHand ? attackHand.x : bx + tw / 2 + r * 0.1;
      const hy = attackHand ? attackHand.y : by + r * 0.2 - swing * 0.45;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(attackHand ? attackHand.angle : (e.cd > 0 ? -0.5 : 0.5 + swing * 0.4));
      ctx.strokeStyle = '#6b4a1f';
      ctx.lineWidth = r * 0.14;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, r * 0.32); ctx.lineTo(0, r * 0.02); ctx.stroke();
      ctx.strokeStyle = L.accColor || '#ffe08a';
      ctx.lineWidth = r * 0.085;
      ctx.beginPath(); ctx.moveTo(0, r * 0.04); ctx.lineTo(0, -r * 1.26); ctx.stroke();
      const bg = ctx.createRadialGradient(0, -r * 1.26, 0, 0, -r * 1.26, r * 0.38);
      bg.addColorStop(0, 'rgba(255,251,232,0.95)');
      bg.addColorStop(0.38, hexRgba(L.accColor || '#ffe08a', 0.85));
      bg.addColorStop(1, hexRgba(L.accColor || '#ffe08a', 0));
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(0, -r * 1.26, r * 0.38, 0, TAU); ctx.fill();
      ctx.restore();
      break;
    }
    case 'comb': {
      // peine regla de metal: en la mano, peinándose o en ristre al embestir
      let hx, hy, ca;
      if (attackHand) {
        hx = attackHand.x; hy = attackHand.y; ca = attackHand.angle;
      } else if (e.combT > 0) {
        hx = bx + Math.sin(now / 55) * r * 0.24;
        hy = headY - r * 0.66;
        ca = -0.6 + Math.sin(now / 55) * 0.35;
      } else if (e.chargeT > 0) {
        const dir = typeof e.chargeAng === 'number' ? e.chargeAng : e.face;
        hx = bx + Math.cos(dir) * r * 1.2;
        hy = by - r * 0.1 + Math.sin(dir) * r * 0.3;
        ca = dir + Math.PI / 2;
      } else {
        hx = bx + tw / 2 + r * 0.12;
        hy = by + r * 0.22 - swing * 0.45;
        ca = 0.35 + swing * 0.35;
      }
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(ca);
      const combCol = L.accColor || '#f4f7ff';
      const mg = ctx.createLinearGradient(-r * 0.14, 0, r * 0.14, 0);
      mg.addColorStop(0, shadeHex(combCol, -0.36));
      mg.addColorStop(0.45, shadeHex(combCol, 0.12));
      mg.addColorStop(0.55, combCol);
      mg.addColorStop(1, shadeHex(combCol, -0.3));
      ctx.fillStyle = mg;
      roundRect(ctx, -r * 0.13, -r * 1.45, r * 0.26, r * 1.7, 2); ctx.fill();
      ctx.strokeStyle = 'rgba(40,55,75,0.8)';
      ctx.lineWidth = 1;
      roundRect(ctx, -r * 0.13, -r * 1.45, r * 0.26, r * 1.7, 2); ctx.stroke();
      // dientes de peine en la punta
      ctx.fillStyle = shadeHex(combCol, -0.1);
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(-r * 0.13 - r * 0.2, -r * 1.4 + i * r * 0.2, r * 0.2, r * 0.09);
      }
      // marcas de regla
      ctx.fillStyle = 'rgba(50,65,85,0.65)';
      for (let i = 1; i <= 4; i++) {
        ctx.fillRect(-r * 0.05, -r * 1.22 + i * r * 0.28, r * 0.1, r * 0.025);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(-r * 0.08, -r * 1.35, r * 0.035, r * 1.45);
      ctx.restore();
      if (e.combT > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(bx, headY - r * 0.4, r * 0.92, Math.PI * 1.12, Math.PI * 1.62); ctx.stroke();
      }
      break;
    }
    case 'sandwich': {
      if (eating) {
        // Ipa come: bocadillo en la boca, mordiscos, migas y ÑAM
        const bite = clamp(1 - e.eatT / 1.15, 0, 1);
        const sx2 = bx + r * 0.32 + Math.sin(now / 55) * r * 0.04;
        const sy2 = headY + r * 0.48;
        ctx.fillStyle = skin;
        ctx.beginPath(); ctx.arc(bx + r * 0.56, headY + r * 0.62, r * 0.17, 0, TAU); ctx.fill();
        ctx.save();
        ctx.translate(sx2, sy2);
        ctx.rotate(-0.5 + Math.sin(now / 60) * 0.08);
        const sc = 1 - bite * 0.32;
        ctx.scale(sc, sc);
        ctx.fillStyle = '#f0c987';
        roundRect(ctx, -r * 0.4, -r * 0.3, r * 0.8, r * 0.28, 2); ctx.fill();
        ctx.fillStyle = '#8dc26f';
        roundRect(ctx, -r * 0.38, -r * 0.06, r * 0.76, r * 0.16, 2); ctx.fill();
        ctx.fillStyle = '#e07b5a';
        roundRect(ctx, -r * 0.38, r * 0.08, r * 0.76, r * 0.16, 2); ctx.fill();
        ctx.fillStyle = '#f0c987';
        roundRect(ctx, -r * 0.4, r * 0.22, r * 0.8, r * 0.26, 2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#d9a45e';
        for (let i = 0; i < 4; i++) {
          const p = ((now / 500 + i * 0.27) % 1);
          ctx.globalAlpha = 0.85 * (1 - p);
          ctx.beginPath();
          ctx.arc(sx2 + (i - 1.5) * r * 0.12, sy2 + r * 0.25 + p * r * 0.75, r * 0.035, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffd166';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('¡ÑAM!', bx, headY - r * 0.98);
      } else {
        const hx = bx - tw / 2 - r * 0.1, hy = by + r * 0.24 + swing * 0.45;
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(0.4);
        ctx.fillStyle = '#f0c987';
        roundRect(ctx, -r * 0.5, -r * 0.3, r, r * 0.28, 2); ctx.fill();
        ctx.fillStyle = '#8dc26f';
        roundRect(ctx, -r * 0.48, -r * 0.06, r * 0.96, r * 0.16, 2); ctx.fill();
        ctx.fillStyle = '#e07b5a';
        roundRect(ctx, -r * 0.48, r * 0.08, r * 0.96, r * 0.16, 2); ctx.fill();
        ctx.fillStyle = '#f0c987';
        roundRect(ctx, -r * 0.5, r * 0.22, r, r * 0.26, 2); ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'agenda': {
      const hx = attackHand ? attackHand.x : bx + tw / 2 + r * 0.06;
      const hy = attackHand ? attackHand.y : by + r * 0.2;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(attackHand ? attackHand.angle : (e.swing > 0 ? -0.9 : 0.35));
      // tapas de la agenda (el color cambia con el traje)
      const coverCol = L.accColor || '#b62929';
      ctx.fillStyle = shadeHex(coverCol, -0.3);
      roundRect(ctx, -r * 0.44, -r * 0.56, r * 0.98, r * 1.28, 3); ctx.fill();
      ctx.fillStyle = coverCol;
      roundRect(ctx, -r * 0.4, -r * 0.52, r * 0.9, r * 1.2, 3); ctx.fill();
      // canto de las hojas
      ctx.fillStyle = '#f3e6c8';
      roundRect(ctx, -r * 0.1, -r * 0.46, r * 0.52, r * 1.06, 2); ctx.fill();
      ctx.fillStyle = '#c9c2a8';
      for (let i = 0; i < 3; i++) {
        roundRect(ctx, -r * 0.04, -r * 0.32 + i * r * 0.26, r * 0.4, r * 0.05, 1); ctx.fill();
      }
      // goma
      ctx.fillStyle = shadeHex(coverCol, -0.48);
      ctx.fillRect(-r * 0.46, -r * 0.56, r * 0.1, r * 1.28);
      ctx.restore();
      break;
    }
    case 'chalk': {
      const hx = attackHand ? attackHand.x : bx + tw / 2 + r * 0.1;
      const hy = attackHand ? attackHand.y : by + r * 0.24 - swing * 0.45;
      ctx.save();
      ctx.translate(hx, hy);
      if (attackHand) ctx.rotate(attackHand.angle);
      ctx.fillStyle = L.accColor || '#f7f9ff';
      roundRect(ctx, -r * 0.16, -r * 0.4, r * 0.32, r * 0.7, 2); ctx.fill();
      ctx.restore();
      break;
    }
    case 'megaphone': {
      // megáfono rojo: la voz de Cáceres se oye en todo el colegio.
      // En los retratos se inclina y se acerca al cuerpo para que no se corte.
      const compact = !!e.portrait;
      const hx = bx + tw / 2 + (compact ? -r * 0.14 : r * 0.22);
      const hy = by + r * 0.16 - swing * 0.35;
      const tipX = compact ? r * 0.56 : r * 0.62;
      const tipY = compact ? r * 0.56 : r * 0.62;
      const mouthX = compact ? r * 0.68 : r * 0.77;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate((compact ? -0.55 : -0.22) - swing * 0.55);
      // mango
      ctx.fillStyle = '#2c2638';
      roundRect(ctx, -r * 0.12, r * 0.02, r * 0.22, r * 0.52, 3); ctx.fill();
      // cuerpo del megáfono (sigue la paleta del traje)
      const megaCol = L.accColor || '#d94b6a';
      const body = ctx.createLinearGradient(-r * 0.2, 0, r * 0.9, 0);
      body.addColorStop(0, shadeHex(megaCol, -0.4));
      body.addColorStop(0.5, megaCol);
      body.addColorStop(1, shadeHex(megaCol, 0.3));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, -r * 0.26);
      ctx.lineTo(tipX, -tipY);
      ctx.lineTo(tipX, r * 0.42);
      ctx.lineTo(-r * 0.12, r * 0.12);
      ctx.closePath();
      ctx.fill();
      // boca metálica
      ctx.fillStyle = '#f3e6ef';
      ctx.beginPath();
      ctx.ellipse(mouthX, -r * 0.1, r * 0.18, r * 0.52, 0.04, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#8e3b55';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#5e1a30';
      ctx.beginPath();
      ctx.ellipse(mouthX + r * 0.02, -r * 0.1, r * 0.09, r * 0.35, 0.04, 0, TAU);
      ctx.fill();
      // brillo
      ctx.strokeStyle = 'rgba(255,220,230,0.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.02, -r * 0.2);
      ctx.lineTo(tipX - r * 0.1, -tipY + r * 0.14);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'shoes': {
      // pequeño brillo en los pies, con el color del traje
      const shoeGlow = L.accColor || L.shoeAccent || '#6ef0e0';
      ctx.fillStyle = hexRgba(shoeGlow, 0.5);
      ctx.beginPath(); ctx.arc(bx - r * 0.4, by + r * 0.95 + Math.sin(now / 90) * r * 0.06, r * 0.16, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(bx + r * 0.4, by + r * 0.95 - Math.sin(now / 90) * r * 0.06, r * 0.16, 0, TAU); ctx.fill();
      if (e.immune > 0) {
        ctx.strokeStyle = 'rgba(180,255,245,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(bx, by + r * 0.95, r * 0.72 + Math.sin(now / 80) * r * 0.06, 0, TAU);
        ctx.stroke();
      }
      break;
    }
  }

  // Si Morante roba el Reglazo, se ve una regla prestada en la mano.
  if (e.kind === 'student' && e.strikeT > 0 && e.strikeWeapon === 'ruler' &&
      L.acc !== 'ruler' && attackHand) {
    ctx.save();
    ctx.translate(attackHand.x, attackHand.y);
    ctx.rotate(attackHand.angle);
    ctx.fillStyle = '#f4f7ff';
    roundRect(ctx, -r * 0.12, -r * 1.5, r * 0.3, r * 1.7, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(40,60,90,0.9)';
    ctx.lineWidth = 1.2;
    for (let i = 1; i <= 4; i++) {
      const yy = -r * 1.5 + i * (r * 1.7 / 5);
      ctx.beginPath(); ctx.moveTo(-r * 0.12, yy); ctx.lineTo(r * 0.02, yy); ctx.stroke();
    }
    ctx.restore();
  }

  // baile de Jonny: notitas
  if (e.kind === 'student' && e.speedUp > 0) {
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < 2; i++) {
      const t2 = performance.now() / 400 + i * 1.6;
      ctx.globalAlpha = 0.55 + Math.sin(t2) * 0.35;
      ctx.fillStyle = '#ffe08a';
      ctx.fillText(i ? '\u266B' : '\u266A', bx + Math.sin(t2) * r * 0.9 + (i ? r * 0.9 : -r * 0.9), headY - r * 0.9 - (t2 % 1) * r * 0.8);
    }
    ctx.globalAlpha = 1;
  }
}

/* Estela, arco de golpe y chispas de impacto para los ataques cuerpo a cuerpo.
   Se dibuja por encima del personaje y desaparece con strikeT. */
function drawStrikeFx(e) {
  if (!(e.strikeT > 0) || !(e.strikeDur > 0)) return;
  const k = clamp(1 - e.strikeT / e.strikeDur, 0, 1);
  const dir = typeof e.strikeDir === 'number' ? e.strikeDir : (e.face || 0);
  const style = e.strikeStyle || 'swing';
  const baseCol = style === 'ruler' ? '150,255,190' :
    style === 'comb' ? '205,235,255' :
    style === 'agenda' ? '255,150,155' :
    style === 'charge' ? '255,190,120' :
    style === 'summon' ? '160,215,255' : '255,240,180';
  const col = skinRgb(e, baseCol);
  const pulse = Math.sin(Math.PI * k);
  const reach = e.r * (2.15 + 0.55 * pulse);
  const cx = e.x, cy = e.y - e.r * 0.45;
  ctx.save();

  // Resplandor del golpe
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, reach);
  g.addColorStop(0, 'rgba(' + col + ',0.30)');
  g.addColorStop(0.6, 'rgba(' + col + ',0.10)');
  g.addColorStop(1, 'rgba(' + col + ',0)');
  ctx.globalAlpha = (1 - k) * 0.9;
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, reach, 0, TAU); ctx.fill();

  // Arco principal: barre en el sentido del golpe y deja una estela doble.
  const sweep = easeOutCubic(clamp(k / 0.82, 0, 1));
  const a0 = dir - 1.75 + 2.55 * sweep;
  const a1 = a0 + 1.12;
  ctx.globalAlpha = (1 - k) * 0.92;
  ctx.strokeStyle = 'rgba(' + col + ',0.95)';
  ctx.lineWidth = e.r * 0.24 * (1 - k) + 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, reach * 0.8, a0, a1); ctx.stroke();
  ctx.globalAlpha = (1 - k) * 0.42;
  ctx.lineWidth = e.r * 0.1 * (1 - k) + 1;
  ctx.beginPath(); ctx.arc(cx, cy, reach * 0.93, a0 - 0.08, a1 + 0.04); ctx.stroke();

  // Lineas de velocidad alrededor del brazo.
  ctx.globalAlpha = (1 - k) * 0.55;
  ctx.strokeStyle = 'rgba(' + col + ',0.8)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const a = dir - 0.9 + i * 0.45;
    const r0 = e.r * (1.1 + i * 0.13);
    const r1 = r0 + e.r * (0.4 + 0.3 * pulse);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }

  // Chispas en el punto de impacto, en la fase central del golpe.
  const hit = clamp((k - 0.25) / 0.32, 0, 1);
  if (hit > 0) {
    const ix = cx + Math.cos(dir) * e.r * 1.9;
    const iy = cy + Math.sin(dir) * e.r * 1.35;
    const fade = 1 - clamp((k - 0.55) / 0.45, 0, 1);
    ctx.globalAlpha = fade;
    ctx.strokeStyle = 'rgba(255,250,210,0.95)';
    ctx.lineWidth = 2.2;
    for (let i = 0; i < 6; i++) {
      const a = dir + (i - 2.5) * 0.42;
      const rr = e.r * (0.3 + 0.7 * hit) * (i % 2 ? 1 : 0.7);
      ctx.beginPath();
      ctx.moveTo(ix, iy);
      ctx.lineTo(ix + Math.cos(a) * rr, iy + Math.sin(a) * rr);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(' + col + ',0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ix, iy, e.r * (0.35 + 0.55 * hit), 0, TAU);
    ctx.stroke();
  }

  // Aviso de carga antes del impacto de la embestida.
  if (style === 'charge' && k < 0.35) {
    ctx.globalAlpha = (0.35 - k) * 2.4;
    ctx.strokeStyle = 'rgba(' + col + ',0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, e.r * (1.1 + k * 3.2), dir - 0.8, dir + 0.8);
    ctx.stroke();
  }

  ctx.restore();
}

function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }

/* Animaciones de aura de los trajes nuevos. No modifican estadísticas ni IA:
   solo añaden brillo, pulsos, órbitas o polvo alrededor del personaje. */
function drawSkinAnimFx(e) {
  const anim = e.look && e.look.anim;
  if (!anim || e.celebrate) return;
  const now = performance.now();
  const t = now / 1000 + (e.blinkSeed || 0);
  const col = e.look.aura || (e.char && e.char.color) || '#ffffff';
  const r = e.r;
  ctx.save();
  if (anim === 'shimmer') {
    ctx.globalAlpha = 0.32 + Math.sin(t * 4.5) * 0.12;
    ctx.strokeStyle = hexRgba(col, 0.9);
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = t * 1.7 + i * TAU / 3;
      ctx.beginPath();
      ctx.arc(e.x, e.y - r * 0.55, r * (1.35 + i * 0.16), a, a + 0.75);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    for (let i = 0; i < 4; i++) {
      const a = t * 2.1 + i * 1.7;
      const rr = r * (1 + 0.35 * Math.sin(t * 3 + i));
      ctx.beginPath();
      ctx.arc(e.x + Math.cos(a) * rr, e.y - r * 0.6 + Math.sin(a) * rr * 0.65, 1.8, 0, TAU);
      ctx.fill();
    }
  } else if (anim === 'pulse') {
    for (let i = 0; i < 2; i++) {
      const k = (t * 0.9 + i * 0.5) % 1;
      ctx.globalAlpha = (1 - k) * 0.35;
      ctx.strokeStyle = hexRgba(col, 0.85);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + r * 0.92, r * (0.8 + k * 1.5), r * (0.32 + k * 0.55), 0, 0, TAU);
      ctx.stroke();
    }
  } else if (anim === 'orbit') {
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < 4; i++) {
      const a = t * 2.3 + i * TAU / 4;
      const rr = r * 1.18;
      const px = e.x + Math.cos(a) * rr;
      const py = e.y - r * 0.55 + Math.sin(a) * rr * 0.42;
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.9)' : hexRgba(col, 0.85);
      ctx.beginPath();
      ctx.arc(px, py, 2.2 + Math.sin(t * 5 + i) * 0.7, 0, TAU);
      ctx.fill();
      ctx.globalAlpha *= 0.85;
    }
  } else if (anim === 'float') {
    ctx.globalAlpha = 0.2 + Math.sin(t * 2.2) * 0.06;
    ctx.fillStyle = hexRgba(col, 0.5);
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + r * 0.98, r * 0.85, r * 0.24, 0, 0, TAU);
    ctx.fill();
  } else if (anim === 'bounce') {
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = hexRgba(col, 0.7);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + r * 0.98, r * (0.7 + 0.25 * Math.abs(Math.sin(t * 4.4))), r * 0.25, 0, 0, TAU);
    ctx.stroke();
  } else if (anim === 'sway') {
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = hexRgba(col, 0.65);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(e.x, e.y - r * 0.4, r * 1.25, -1.2 + Math.sin(t * 2.5) * 0.25, 1.9 + Math.sin(t * 2.5) * 0.25);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEntity(e) {
  if (e.summon && !e.alive) return;
  if (e.kind === 'teacher' && e.hiddenT > 0 && S.role === 'student') return;
  const isP = e.isPlayer;
  const invisible = e.kind === 'student' && e.invis > 0 && !isP;

  // Aureola del traje equipado, solo para el jugador.
  const aura = e.skin && e.look && e.look.aura;
  if (aura && !e.celebrate) {
    const pulse = 0.72 + Math.sin(performance.now() / 260 + (e.blinkSeed || 0)) * 0.12;
    const ag = ctx.createRadialGradient(e.x, e.y - e.r * 0.45, 4, e.x, e.y - e.r * 0.45, e.r * 2.4 * pulse);
    ag.addColorStop(0, 'rgba(255,255,255,0)');
    ag.addColorStop(0.55, hexRgba(aura, 0.10));
    ag.addColorStop(1, hexRgba(aura, 0));
    ctx.fillStyle = ag;
    ctx.beginPath(); ctx.arc(e.x, e.y - e.r * 0.45, e.r * 2.4 * pulse, 0, TAU); ctx.fill();
  }

  drawSkinAnimFx(e);

  // Sombra en dos capas: una huella amplia y suave y otra de contacto más
  // oscura. Así los personajes se apoyan en el suelo en vez de flotar.
  ctx.fillStyle = 'rgba(0,0,0,0.11)';
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + e.r * 0.98, e.r * 1.42, e.r * 0.58, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + e.r * 0.98, e.r * 0.94, e.r * 0.36, 0, 0, TAU);
  ctx.fill();

  if (e.kind === 'student' && e.voidSlowT > 0) {
    const now2 = performance.now() / 160;
    ctx.save();
    ctx.strokeStyle = 'rgba(145,72,190,0.55)';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + e.r * 0.95, e.r * 1.25 + Math.sin(now2) * 2, e.r * 0.45, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#12061d';
    ctx.beginPath(); ctx.arc(e.x, e.y - e.r * 0.45, e.r * 1.9, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // estela de velocidad de Luis después del reglazo
  if (e.kind === 'student' && e.luisFastT > 0) {
    const a = e.face + Math.PI;
    ctx.save();
    ctx.strokeStyle = 'rgba(126,231,135,0.72)';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const off = (i - 1) * 7;
      const px = e.x + Math.cos(a + Math.PI / 2) * off;
      const py = e.y - e.r * 0.4 + Math.sin(a + Math.PI / 2) * off;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * (18 + i * 5), py + Math.sin(a) * (18 + i * 5));
      ctx.stroke();
    }
    ctx.restore();
  }

  // estela de la embestida del Profe Quispe
  if (e.kind === 'teacher' && e.chargeT > 0) {
    const a = typeof e.chargeAng === 'number' ? e.chargeAng : e.face;
    const chargeRgb = skinRgb(e, '255,210,130');
    ctx.save();
    const cg = ctx.createRadialGradient(e.x, e.y - e.r * 0.4, 4, e.x, e.y - e.r * 0.4, e.r * 2.6);
    cg.addColorStop(0, 'rgba(' + chargeRgb + ',0.3)');
    cg.addColorStop(0.65, 'rgba(' + chargeRgb + ',0.16)');
    cg.addColorStop(1, 'rgba(' + chargeRgb + ',0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(e.x, e.y - e.r * 0.4, e.r * 2.6, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(' + chargeRgb + ',0.65)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const off = (i - 2.5) * 8;
      const len = 26 + (i % 3) * 16;
      const px = e.x - Math.cos(a) * (e.r + 4) + Math.cos(a + Math.PI / 2) * off;
      const py = e.y - Math.sin(a) * (e.r + 4) + Math.sin(a + Math.PI / 2) * off + e.r * 0.15;
      ctx.lineWidth = 2 + (i % 2);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - Math.cos(a) * len, py - Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  // aura de los profesores invocados
  if (e.summon) {
    const pulse = Math.sin(performance.now() / 150) * 0.1;
    ctx.save();
    ctx.globalAlpha = 0.35 + pulse;
    ctx.strokeStyle = e.char.color;
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 5]);
    ctx.beginPath(); ctx.ellipse(e.x, e.y + e.r * 0.98, e.r * 1.55, e.r * 0.72, 0, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.13 + pulse * 0.5;
    ctx.fillStyle = e.char.color;
    ctx.beginPath(); ctx.arc(e.x, e.y - e.r * 0.8, e.r * 2.3, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // rastro verde mientras un profesor retrocede por la onda de Luis
  if (e.kind === 'teacher' && e.retreatT > 0) {
    const pulse = 1 + Math.sin(performance.now() / 110) * 0.08;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = 'rgba(150,255,190,0.8)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + e.r * 0.98, e.r * 1.45 * pulse, e.r * 0.62 * pulse, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  ctx.save();
  if (invisible) ctx.globalAlpha = 0.25;
  drawPerson(e);
  if (e.flash > 0) {
    ctx.globalAlpha = (invisible ? 0.25 : 1) * clamp(e.flash / 0.18, 0, 1) * 0.5;
    ctx.fillStyle = '#ff5a5a';
    ctx.beginPath(); ctx.arc(e.x, e.y - e.r * 0.7, e.r * 1.4, 0, TAU); ctx.fill();
  }
  ctx.restore();
  drawStrikeFx(e);

  // bocadillo de los profesores antes de embestir y de Luis al usar su onda
  if (e.talkT > 0 && e.talkLines && e.talkLines.length) {
    const lines = e.talkLines;
    // Los dos invocados hablan a la vez: sus bocadillos se abren a los lados
    // para que no se monten uno encima del otro.
    const isSummon = !!e.summon;
    const bw = isSummon ? 160 : 228, lh = 16, bh = lines.length * lh + 18;
    const bubbleX = isSummon ? e.x + (e.summonKind === 'tercero' ? 200 : -200) : e.x;
    const bx2 = bubbleX - bw / 2, by2 = e.y - e.r * 4.2 - bh;
    const pop = clamp((2.6 - e.talkT) / 0.18, 0, 1);
    ctx.save();
    const bubbleColor = e.kind === 'student' ? 'rgba(150,255,190,0.95)' : 'rgba(220,190,255,0.95)';
    ctx.globalAlpha = Math.min(1, e.talkT / 0.2) * pop;
    ctx.fillStyle = 'rgba(12,16,30,0.95)';
    ctx.strokeStyle = bubbleColor;
    ctx.lineWidth = 2.5;
    roundRect(ctx, bx2, by2, bw, bh, 12); ctx.fill(); ctx.stroke();
    // rabito
    ctx.beginPath();
    ctx.moveTo(bubbleX - 9, by2 + bh - 1);
    ctx.lineTo(e.x, by2 + bh + 12);
    ctx.lineTo(bubbleX + 9, by2 + bh - 1);
    ctx.closePath(); ctx.fillStyle = 'rgba(12,16,30,0.95)'; ctx.fill();
    ctx.strokeStyle = bubbleColor;
    ctx.beginPath();
    ctx.moveTo(bubbleX - 9, by2 + bh);
    ctx.lineTo(e.x, by2 + bh + 12);
    ctx.lineTo(bubbleX + 9, by2 + bh);
    ctx.stroke();
    ctx.fillStyle = e.kind === 'student' ? '#e8ffef' : '#f0e6ff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], bubbleX, by2 + 17 + i * lh);
    }
    ctx.restore();
  }

  // burbuja de inmune (Elias con los zapatos al reves)
  if (e.kind === 'student' && e.immune > 0) {
    const k = 1 + Math.sin(performance.now() / 130) * 0.05;
    const cy = e.y - e.r * 0.6, rr = e.r * 2.15 * k;
    const g = ctx.createRadialGradient(e.x, cy, rr * 0.2, e.x, cy, rr);
    g.addColorStop(0, 'rgba(110,240,224,0.05)');
    g.addColorStop(0.72, 'rgba(110,240,224,0.20)');
    g.addColorStop(1, 'rgba(170,255,245,0.55)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(e.x, cy, rr, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(190,255,248,0.85)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(e.x, cy, rr, 0, TAU); ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const a = performance.now() / 480 + (i * TAU) / 3;
      ctx.beginPath();
      ctx.arc(e.x + Math.cos(a) * rr * 0.96, cy + Math.sin(a) * rr * 0.96, 2.4, 0, TAU);
      ctx.fillStyle = '#e6fffb';
      ctx.fill();
    }
  }

  // marca del jugador
  if (isP) {
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + e.r * 0.98, e.r * 1.25, e.r * 0.5, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    const bob = Math.sin(performance.now() / 260) * 3;
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - e.r * 2.7 + bob);
    ctx.lineTo(e.x - 7, e.y - e.r * 3.35 + bob);
    ctx.lineTo(e.x + 7, e.y - e.r * 3.35 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (e.kind === 'student' && e.revealed > 0) {
    const k = 1 + Math.sin(performance.now() / 140) * 0.12;
    ctx.beginPath();
    ctx.arc(e.x, e.y - e.r * 0.6, (e.r * 1.9) * k, 0, TAU);
    ctx.strokeStyle = 'rgba(255,90,90,0.95)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // nombre
  const showName = isP || e.kind === 'teacher' || e.revealed > 0 || (player && dist(e, player) < 230);
  const labelY = e.y - e.r * 3.4;
  if (showName) {
    const label = isP ? 'TÚ · ' + e.char.name : e.char.name;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tw3 = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(6,10,20,0.55)';
    roundRect(ctx, e.x - tw3 / 2 - 5, labelY - 11, tw3 + 10, 15, 7); ctx.fill();
    ctx.fillStyle = isP ? '#ffffff' : (e.summon ? '#bfe6ff' : (e.kind === 'teacher' ? '#ffc9c9' : '#cfe6ff'));
    ctx.fillText(label, e.x, labelY);
  }

  // vida
  if (e.kind === 'teacher' || isP || e.hp < e.maxHp) {
    const w = 42, h = 5, bx = e.x - w / 2, by = labelY + 5;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
    ctx.fillStyle = e.kind === 'teacher' ? '#ff5d5d' : '#4ade80';
    ctx.fillRect(bx, by, w * (e.hp / e.maxHp), h);
  }
}

function drawExam(ex) {
  ctx.save();
  ctx.translate(ex.x, ex.y);
  ctx.rotate(Math.sin(performance.now() / 180) * 0.25);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 14, 12, 5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fdfcf4';
  roundRect(ctx, -11, -14, 22, 28, 3); ctx.fill();
  ctx.strokeStyle = ex.color || 'rgba(255,90,90,0.95)'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-10, -14); ctx.lineTo(-10, 14);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(60,70,90,0.7)'; ctx.lineWidth = 1.5;
  for (let i = -6; i <= 8; i += 6) {
    ctx.beginPath(); ctx.moveTo(-4, i); ctx.lineTo(8, i); ctx.stroke();
  }
  ctx.fillStyle = ex.color || 'rgba(220,60,60,0.9)';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('A', 4, -8);
  ctx.restore();
}

function drawProjectile(p) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(p.x, p.y + p.r * 0.9, p.r * 0.9, p.r * 0.4, 0, 0, TAU); ctx.fill();
  if (p.kind === 'shout') {
    const rgb = p.rgb || '255,105,140';
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.vy, p.vx));
    ctx.fillStyle = 'rgba(' + rgb + ',0.28)';
    ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.9 - i * 0.22) + ')';
      ctx.lineWidth = 3.2 - i * 0.7;
      ctx.beginPath();
      ctx.arc(0, 0, p.r + i * 5, -0.95, 0.95);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,245,250,0.9)';
    ctx.beginPath(); ctx.arc(-2, 0, p.r * 0.28, 0, TAU); ctx.fill();
    ctx.restore();
    return;
  }
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU);
  ctx.fillStyle = p.color; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
}

function drawFx() {
  for (const f of fx) {
    const k = 1 - f.t / f.dur;
    if (f.type === 'ring') {
      const r = lerp(f.r0, f.r1, k);
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU);
      ctx.strokeStyle = 'rgba(' + f.color + ',' + (1 - k).toFixed(2) + ')';
      ctx.lineWidth = 3 + 4 * (1 - k);
      ctx.stroke();
    } else if (f.type === 'swing') {
      ctx.beginPath();
      ctx.arc(f.x, f.y, 80, f.ang - 1.15, f.ang + 1.15);
      ctx.strokeStyle = 'rgba(' + (f.color || '210,255,215') + ',' + (1 - k).toFixed(2) + ')';
      ctx.lineWidth = 12 * (1 - k) + 2;
      ctx.stroke();
    } else if (f.type === 'star') {
      ctx.strokeStyle = 'rgba(' + (f.color || '255,230,120') + ',' + (1 - k).toFixed(2) + ')';
      ctx.lineWidth = 3;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + k * 2;
        const r0 = 6 + k * 12, r1 = 18 + k * 20;
        ctx.beginPath();
        ctx.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0);
        ctx.lineTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1);
        ctx.stroke();
      }
    } else if (f.type === 'dust') {
      const rr = (f.r || 8) * (0.55 + k * 1.5);
      ctx.beginPath(); ctx.arc(f.x, f.y, rr, 0, TAU);
      ctx.fillStyle = 'rgba(' + (f.color || '175,160,145') + ',' + (0.38 * (1 - k)).toFixed(2) + ')';
      ctx.fill();
    } else if (f.type === 'spark') {
      const sp = 3 + 7 * k;
      ctx.strokeStyle = 'rgba(' + (f.color || '255,250,210') + ',' + (1 - k).toFixed(2) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(f.x - sp, f.y); ctx.lineTo(f.x + sp, f.y);
      ctx.moveTo(f.x, f.y - sp); ctx.lineTo(f.x, f.y + sp);
      ctx.moveTo(f.x - sp * 0.6, f.y - sp * 0.6); ctx.lineTo(f.x + sp * 0.6, f.y + sp * 0.6);
      ctx.moveTo(f.x + sp * 0.6, f.y - sp * 0.6); ctx.lineTo(f.x - sp * 0.6, f.y + sp * 0.6);
      ctx.stroke();
    } else if (f.type === 'theme') {
      drawThemeFx(f, k);
    }
  }
}

/* Formas propias de cada familia de trajes. Todas son cosmeticas. */
function drawThemeFx(f, k) {
  const scale = f.scale || 1;
  const alpha = Math.max(0, 1 - k);
  const col = f.color || '255,255,255';
  const accent = f.accent || '#ffffff';
  const style = f.style || 'spark';
  const seed = f.seed || 0;
  const cx = f.x, cy = f.y - 10 * scale;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalAlpha = alpha;

  if (style === 'wave') {
    ctx.strokeStyle = 'rgba(' + col + ',' + (0.75 * alpha).toFixed(2) + ')';
    ctx.lineWidth = 3;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (28 + i * 26 + k * 58) * scale, -2.4 + i * 0.24, 0.5 + i * 0.24);
      ctx.stroke();
    }
  } else if (style === 'neon') {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.4;
    ctx.globalAlpha = alpha * 0.9;
    for (let i = 0; i < 4; i++) {
      const a = seed + i * Math.PI / 2 + k * 1.8;
      const r0 = 18 * scale, r1 = (58 + k * 34) * scale;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(' + col + ',0.85)';
    ctx.beginPath(); ctx.arc(cx, cy, (22 + k * 70) * scale, 0, TAU); ctx.stroke();
  } else if (style === 'notes') {
    ctx.fillStyle = accent;
    ctx.font = 'bold ' + Math.round(18 * scale) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < 4; i++) {
      const a = seed + i * 1.8 + k * 2.2;
      const rr = (22 + k * 46 + (i % 2) * 14) * scale;
      ctx.globalAlpha = alpha * (0.7 + 0.3 * Math.sin(k * 8 + i));
      ctx.fillText(i % 2 ? '\u266B' : '\u266A', cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
  } else if (style === 'smoke') {
    for (let i = 0; i < 6; i++) {
      const a = seed + i * 1.05 + k * 0.7;
      const rr = (14 + i * 6 + k * 32) * scale;
      ctx.fillStyle = 'rgba(' + col + ',' + (0.16 * alpha).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.6, (10 + (i % 3) * 5) * scale, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(' + col + ',0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, (20 + k * 66) * scale, 0, TAU); ctx.stroke();
  } else if (style === 'gold') {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.2;
    for (let i = 0; i < 8; i++) {
      const a = seed + i * Math.PI / 4 + k * 0.5;
      const r0 = (16 + k * 18) * scale;
      const r1 = (42 + k * 42) * scale;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(' + col + ',0.85)';
    ctx.beginPath(); ctx.arc(cx, cy, (18 + k * 48) * scale, 0, TAU); ctx.stroke();
  } else if (style === 'fire') {
    for (let i = 0; i < 9; i++) {
      const a = seed + i * 0.7;
      const rr = (10 + (i % 4) * 10) * scale;
      const rise = k * (28 + (i % 3) * 15) * scale;
      ctx.fillStyle = i % 2 ? 'rgba(' + col + ',0.8)' : accent;
      ctx.globalAlpha = alpha * 0.8;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.4 - rise, (2.5 + (i % 3)) * scale, 0, TAU);
      ctx.fill();
    }
  } else if (style === 'bolt') {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.4;
    for (let i = 0; i < 3; i++) {
      const a = seed + i * 2.1 + k * 1.2;
      const sx = cx + Math.cos(a) * 20 * scale;
      const sy = cy + Math.sin(a) * 20 * scale;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(a + 0.75) * 16 * scale, sy + Math.sin(a + 0.75) * 16 * scale);
      ctx.lineTo(sx + Math.cos(a + 0.15) * 28 * scale, sy + Math.sin(a + 0.15) * 28 * scale);
      ctx.lineTo(sx + Math.cos(a + 0.9) * 46 * scale, sy + Math.sin(a + 0.9) * 46 * scale);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(' + col + ',0.8)';
    ctx.beginPath(); ctx.arc(cx, cy, (20 + k * 52) * scale, 0, TAU); ctx.stroke();
  } else if (style === 'confetti') {
    for (let i = 0; i < 12; i++) {
      const a = seed + i * 0.9;
      const rr = (12 + k * (40 + (i % 4) * 12)) * scale;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8);
      ctx.rotate(a + k * 5);
      ctx.fillStyle = i % 3 === 0 ? accent : 'rgba(' + col + ',0.9)';
      ctx.fillRect(-2.5 * scale, -2.5 * scale, 5 * scale, 5 * scale);
      ctx.restore();
    }
  } else if (style === 'slash') {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    for (let i = 0; i < 2; i++) {
      const a = -0.8 + i * 1.4 + seed * 0.1;
      const rr = (34 + k * 50) * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, a - 0.8, a + 0.8);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(' + col + ',0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, (24 + k * 58) * scale, 0, TAU); ctx.stroke();
  } else if (style === 'ice') {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = seed + i * Math.PI / 4 + k * 0.4;
      const r0 = (14 + k * 12) * scale;
      const r1 = (36 + k * 44) * scale;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(' + col + ',0.8)';
    ctx.beginPath(); ctx.arc(cx, cy, (18 + k * 52) * scale, 0, TAU); ctx.stroke();
  } else if (style === 'shadow') {
    ctx.fillStyle = 'rgba(' + col + ',' + (0.13 * alpha).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(cx, cy, (36 + k * 50) * scale, 0, TAU); ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.4;
    for (let i = 0; i < 5; i++) {
      const a = seed + i * 1.25 + k * 1.1;
      const rr = (20 + k * 60) * scale;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8);
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      ctx.stroke();
    }
  } else if (style === 'petal') {
    for (let i = 0; i < 10; i++) {
      const a = seed + i * 0.72 + k * 1.6;
      const rr = (14 + k * (38 + (i % 4) * 10)) * scale;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8);
      ctx.rotate(a + k * 3.4);
      ctx.fillStyle = i % 2 ? accent : 'rgba(' + col + ',0.85)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.2 * scale, 6.4 * scale, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(' + col + ',0.6)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, (20 + k * 50) * scale, 0, TAU); ctx.stroke();
  } else if (style === 'bubble') {
    for (let i = 0; i < 9; i++) {
      const a = seed + i * 0.9;
      const rr = (10 + (i % 4) * 9 + k * 26) * scale;
      const rad = (4 + (i % 3) * 2.5) * scale;
      ctx.fillStyle = 'rgba(' + col + ',0.12)';
      ctx.strokeStyle = i % 2 ? accent : 'rgba(' + col + ',0.8)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8 - k * 18 * scale, rad, 0, TAU);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rr - rad * 0.3, cy + Math.sin(a) * rr * 0.8 - k * 18 * scale - rad * 0.3, rad * 0.22, 0, TAU);
      ctx.fill();
    }
  } else if (style === 'rune') {
    ctx.strokeStyle = 'rgba(' + col + ',0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, (24 + k * 48) * scale, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, (16 + k * 32) * scale, 0, TAU); ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.2;
    for (let i = 0; i < 8; i++) {
      const a = seed + i * Math.PI / 4 + k * 0.6;
      const r0 = (20 + k * 40) * scale;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a + 0.28) * (r0 + 8 * scale), cy + Math.sin(a + 0.28) * (r0 + 8 * scale));
      ctx.lineTo(cx + Math.cos(a + 0.08) * (r0 + 16 * scale), cy + Math.sin(a + 0.08) * (r0 + 16 * scale));
      ctx.stroke();
    }
  } else if (style === 'cosmic') {
    ctx.strokeStyle = 'rgba(' + col + ',0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, (22 + k * 46) * scale, 0, TAU); ctx.stroke();
    for (let i = 0; i < 14; i++) {
      const a = seed + i * 2.4 + k * 0.8;
      const rr = (8 + (i % 5) * 9 + k * 22) * scale;
      const rad = (1.2 + (i % 3)) * scale;
      ctx.fillStyle = i % 3 === 0 ? accent : 'rgba(' + col + ',0.9)';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.75, rad, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - (18 + k * 30) * scale, cy - (18 + k * 22) * scale);
    ctx.lineTo(cx + (20 + k * 22) * scale, cy + (14 + k * 16) * scale);
    ctx.stroke();
  } else if (style === 'glitch') {
    for (let i = 0; i < 8; i++) {
      const a = seed + i * 1.1;
      const rr = (12 + (i % 4) * 12 + k * 24) * scale;
      const w = (6 + (i % 3) * 5) * scale;
      const h = (2 + (i % 2) * 3) * scale;
      ctx.fillStyle = i % 2 ? accent : 'rgba(' + col + ',0.85)';
      ctx.globalAlpha = alpha * (0.45 + 0.45 * Math.sin(k * 14 + i));
      ctx.fillRect(cx + Math.cos(a) * rr - w / 2, cy + Math.sin(a) * rr * 0.7 - h / 2, w, h);
    }
    ctx.strokeStyle = 'rgba(' + col + ',0.75)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const y = cy - (18 - i * 16) * scale + Math.sin(k * 18 + i) * 4 * scale;
      ctx.beginPath(); ctx.moveTo(cx - (34 + k * 20) * scale, y); ctx.lineTo(cx + (34 + k * 20) * scale, y); ctx.stroke();
    }
  } else if (style === 'prism') {
    const prismCols = [accent, 'rgba(' + col + ',0.9)', '#7df9ff', '#ffd166', '#ff8fb8'];
    for (let i = 0; i < 10; i++) {
      const a = seed + i * 0.9 + k * 1.4;
      const rr = (12 + (i % 5) * 9 + k * 28) * scale;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8);
      ctx.rotate(a + k * 2.2);
      ctx.fillStyle = prismCols[i % prismCols.length];
      ctx.globalAlpha = alpha * 0.9;
      ctx.beginPath();
      ctx.moveTo(0, -5 * scale);
      ctx.lineTo(4 * scale, 4 * scale);
      ctx.lineTo(-4 * scale, 4 * scale);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  } else if (style === 'vortex') {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.4;
    for (let arm = 0; arm < 3; arm++) {
      ctx.beginPath();
      for (let i = 0; i <= 18; i++) {
        const t2 = i / 18;
        const a = seed + arm * 2.1 + t2 * 4.6 + k * 2.4;
        const rr = (6 + t2 * (44 + k * 26)) * scale;
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr * 0.8;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(' + col + ',0.7)';
    ctx.beginPath(); ctx.arc(cx, cy, (6 + k * 8) * scale, 0, TAU); ctx.fill();
  } else if (style === 'wisp') {
    for (let i = 0; i < 7; i++) {
      const a = seed + i * 1.35 + k * 1.1;
      const rr = (12 + (i % 3) * 12 + k * 34) * scale;
      const wx = cx + Math.cos(a) * rr;
      const wy = cy + Math.sin(a) * rr * 0.7 - k * 12 * scale;
      const rad = (4 + (i % 3) * 2) * scale;
      const wg = ctx.createRadialGradient(wx, wy, 0, wx, wy, rad * 2.4);
      wg.addColorStop(0, accent);
      wg.addColorStop(0.45, 'rgba(' + col + ',0.5)');
      wg.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = wg;
      ctx.beginPath(); ctx.arc(wx, wy, rad * 2.4, 0, TAU); ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(wx, wy, rad * 0.55, 0, TAU); ctx.fill();
    }
  } else if (style === 'aurora') {
    for (let band = 0; band < 3; band++) {
      ctx.globalAlpha = alpha * (0.3 + band * 0.08);
      ctx.strokeStyle = band === 1 ? accent : 'rgba(' + col + ',0.85)';
      ctx.lineWidth = (2.4 - band * 0.45) * scale;
      ctx.beginPath();
      for (let i = 0; i <= 16; i++) {
        const t2 = i / 16;
        const x = cx - (42 + k * 18) * scale + t2 * (84 + k * 36) * scale;
        const y = cy - (22 - band * 12) * scale + Math.sin(t2 * 6 + k * 5 + band + seed) * (7 + band * 3) * scale;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  } else if (style === 'leaf') {
    for (let i = 0; i < 9; i++) {
      const a = seed + i * 0.9 + k * 1.2;
      const rr = (14 + (i % 4) * 9 + k * 34) * scale;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr * 0.75;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a + k * 3.2);
      ctx.fillStyle = i % 2 ? accent : 'rgba(' + col + ',0.9)';
      ctx.globalAlpha = alpha * (0.55 + 0.35 * Math.sin(k * 12 + i));
      ctx.beginPath();
      ctx.ellipse(0, 0, 4.5 * scale, 2.2 * scale, 0.5, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  } else if (style === 'portal') {
    for (let i = 0; i < 3; i++) {
      const rr = (16 + i * 14 + k * 42) * scale;
      ctx.globalAlpha = alpha * (0.5 - i * 0.1);
      ctx.strokeStyle = i % 2 ? accent : 'rgba(' + col + ',0.85)';
      ctx.lineWidth = (2.4 - i * 0.4) * scale;
      ctx.beginPath(); ctx.arc(cx, cy, rr, seed + k * 2.4 + i, seed + k * 2.4 + i + 4.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, rr, seed + k * 2.4 + i + Math.PI, seed + k * 2.4 + i + Math.PI + 4.2); ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const a = seed + i * Math.PI / 4 + k * 1.4;
      ctx.globalAlpha = alpha * 0.6;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.4 * scale;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 14 * scale, cy + Math.sin(a) * 14 * scale);
      ctx.lineTo(cx + Math.cos(a) * (24 + k * 28) * scale, cy + Math.sin(a) * (24 + k * 28) * scale);
      ctx.stroke();
    }
  } else if (style === 'starfall') {
    for (let i = 0; i < 12; i++) {
      const a = seed + i * 1.9;
      const fall = (k * 1.4 + i * 0.13) % 1;
      const px = cx + Math.cos(a) * (12 + (i % 5) * 9) * scale;
      const py = cy - (36 - fall * 74) * scale + Math.sin(a) * 8 * scale;
      ctx.globalAlpha = alpha * (0.35 + 0.55 * Math.sin(fall * Math.PI));
      ctx.fillStyle = i % 3 === 0 ? accent : 'rgba(' + col + ',0.9)';
      ctx.beginPath();
      for (let p = 0; p < 5; p++) {
        const sa = -Math.PI / 2 + p * TAU / 5;
        const sr = (p % 2 ? 1.8 : 4.2) * scale;
        const sx = px + Math.cos(sa) * sr;
        const sy = py + Math.sin(sa) * sr;
        if (p) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
      }
      ctx.closePath(); ctx.fill();
    }
  } else if (style === 'snow') {
    for (let i = 0; i < 10; i++) {
      const a = seed + i * 1.3;
      const fall = (k * 1.2 + i * 0.11) % 1;
      const px = cx + Math.cos(a) * (12 + (i % 4) * 11) * scale;
      const py = cy - (34 - fall * 70) * scale;
      ctx.globalAlpha = alpha * (0.4 + 0.4 * Math.sin(fall * Math.PI));
      ctx.strokeStyle = i % 2 ? accent : 'rgba(' + col + ',0.9)';
      ctx.lineWidth = 1.3 * scale;
      for (let arm = 0; arm < 3; arm++) {
        const aa = arm * Math.PI / 3 + k * 1.5;
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(aa) * 4 * scale, py - Math.sin(aa) * 4 * scale);
        ctx.lineTo(px + Math.cos(aa) * 4 * scale, py + Math.sin(aa) * 4 * scale);
        ctx.stroke();
      }
    }
  } else if (style === 'heart') {
    for (let i = 0; i < 8; i++) {
      const a = seed + i * 1.6 + k * 1.1;
      const rr = (12 + (i % 4) * 10 + k * 32) * scale;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr * 0.7;
      const s = (3.5 + (i % 3)) * scale;
      ctx.globalAlpha = alpha * (0.5 + 0.35 * Math.sin(k * 10 + i));
      ctx.fillStyle = i % 2 ? accent : 'rgba(' + col + ',0.9)';
      ctx.beginPath();
      ctx.moveTo(px, py + s * 0.8);
      ctx.bezierCurveTo(px - s * 1.4, py - s * 0.2, px - s * 0.5, py - s * 1.2, px, py - s * 0.35);
      ctx.bezierCurveTo(px + s * 0.5, py - s * 1.2, px + s * 1.4, py - s * 0.2, px, py + s * 0.8);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.2;
    for (let i = 0; i < 6; i++) {
      const a = seed + i * Math.PI / 3 + k * 0.6;
      const r0 = (14 + k * 14) * scale;
      const r1 = (32 + k * 40) * scale;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(' + col + ',0.8)';
    ctx.beginPath(); ctx.arc(cx, cy, (18 + k * 46) * scale, 0, TAU); ctx.stroke();
  }
  // Chispas comunes: unifican y enriquecen todas las familias de efectos.
  for (let i = 0; i < 5; i++) {
    const a = seed + i * 1.37 + k * 2.6;
    const rr = (24 + k * 34 + (i % 3) * 10) * scale;
    ctx.fillStyle = i % 2 ? accent : 'rgba(' + col + ',0.9)';
    ctx.globalAlpha = alpha * (0.35 + 0.35 * Math.sin(k * 10 + i));
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7, (1.3 + (i % 3) * 0.8) * scale, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawNight() {
  nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  nctx.globalCompositeOperation = 'source-over';
  nctx.clearRect(0, 0, VW, VH);
  nctx.fillStyle = 'rgba(4,8,28,0.9)';
  nctx.fillRect(0, 0, VW, VH);
  nctx.globalCompositeOperation = 'destination-out';

  const lights = [];
  if (player && player.alive) lights.push({ x: player.x, y: player.y, r: 430 });
  for (const L of LAMPS) lights.push({ x: L.x, y: L.y, r: 165 });
  for (const d of decor) {
    if (d.kind === 'lamppost') lights.push({ x: d.x * T, y: d.y * T - 32, r: 190 });
    else if (d.kind === 'pergola') {
      for (let i = 0; i < 3; i++) {
        lights.push({ x: (d.x + d.w * (0.2 + i * 0.3)) * T, y: (d.y + d.h * 0.17) * T, r: 115 });
      }
    }
  }

  for (const L of lights) {
    const sx = w2sx(L.x), sy = w2sy(L.y), rr = L.r * zoom;
    if (sx < -rr || sy < -rr || sx > VW + rr || sy > VH + rr) continue;
    const g = nctx.createRadialGradient(sx, sy, 0, sx, sy, rr);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.82)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    nctx.fillStyle = g;
    nctx.beginPath(); nctx.arc(sx, sy, rr, 0, TAU); nctx.fill();
  }
  nctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(nightCv, 0, 0, VW, VH);
}

function drawReveals() {
  for (const s of studentList) {
    if (!s.alive || s.escaped || s.revealed <= 0) continue;
    const sx = w2sx(s.x), sy = w2sy(s.y);
    const k = 1 + Math.sin(performance.now() / 130) * 0.15;
    ctx.beginPath(); ctx.arc(sx, sy, 22 * zoom * k, 0, TAU);
    ctx.strokeStyle = 'rgba(255,70,70,0.95)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff9d9d';
    ctx.fillText('VISTO: ' + s.char.name, sx, sy - 30 * zoom);
  }
}

function drawTexts() {
  for (const t of texts) {
    const a = clamp(t.t / 1.1, 0, 1);
    ctx.globalAlpha = a;
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(t.txt, w2sx(t.x), w2sy(t.y));
    ctx.fillStyle = t.color;
    ctx.fillText(t.txt, w2sx(t.x), w2sy(t.y));
    ctx.globalAlpha = 1;
  }
}

/* ---------------------------------------------------------------------------
   HUD
   --------------------------------------------------------------------------- */
function fitText(text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '...').width > maxW) t = t.slice(0, -1);
  return t + '...';
}

function drawCooldownBox(x, y, size, ability, cd, extra) {
  ctx.save();
  ctx.fillStyle = 'rgba(10,16,28,0.85)';
  roundRect(ctx, x, y, size, size, 10); ctx.fill();
  ctx.strokeStyle = cd > 0 ? 'rgba(120,140,175,0.5)' : 'rgba(150,220,255,0.9)';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, size, size, 10); ctx.stroke();

  if (cd > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, x, y + size * (1 - cd / ability.cd), size, size * (cd / ability.cd), 10); ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.fillStyle = cd > 0 ? '#93a3bd' : '#eaf3ff';
  const maxW = size - 10;
  const lines = [];
  let line = '';
  for (const word of ability.name.split(' ')) {
    const test = line ? line + ' ' + word : word;
    if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  while (lines.length > 3) { lines[2] = lines[2] + ' ' + lines[3]; lines.splice(3, 1); }
  const lineH = 11;
  const startY = y + size / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, li) => {
    ctx.fillText(fitText(l, maxW), x + size / 2, startY + li * lineH);
  });
  ctx.fillStyle = '#7f8ea8';
  ctx.font = 'bold 9px system-ui, sans-serif';
  if (cd > 0) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillText(cd.toFixed(1), x + size / 2, y + size - 13);
  } else {
    ctx.fillText(ability.key, x + size / 2, y + size - 9);
  }
  if (extra) {
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(extra, x + size / 2, y - 8);
  }
  ctx.restore();
}

function drawMissionTracker() {
  if (VW < 1000) return;
  const perRow = 4;
  const rows = Math.max(1, Math.ceil(MISSIONS.length / perRow));
  const cw = 306, ch = 34 + rows * 28 + 16, x = 16, y = 14;
  ctx.save();
  ctx.fillStyle = 'rgba(8,13,24,0.82)';
  roundRect(ctx, x, y, cw, ch, 14); ctx.fill();
  ctx.strokeStyle = 'rgba(120,150,200,0.45)'; ctx.lineWidth = 2;
  roundRect(ctx, x, y, cw, ch, 14); ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9db2d6';
  ctx.font = 'bold 10.5px system-ui, sans-serif';
  ctx.fillText('MISIONES Y TAREAS', x + 12, y + 17);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 10px system-ui, sans-serif';
  const collected = Math.max(0, S.papersTotal - examPapers.length);
  ctx.fillText((S.role === 'teacher' ? 'EXÁMENES ' : 'APUNTES ') + collected + '/' + S.papersTotal, x + cw - 12, y + 17);
  ctx.textAlign = 'left';

  const chipW = 64, gap = 4;
  for (let i = 0; i < MISSIONS.length; i++) {
    const m = MISSIONS[i];
    const cx = x + 12 + (i % perRow) * (chipW + gap);
    const cy = y + 24 + Math.floor(i / perRow) * 28;
    ctx.fillStyle = m.done ? 'rgba(90,220,140,0.16)' : 'rgba(255,255,255,0.06)';
    roundRect(ctx, cx, cy, chipW, 24, 7); ctx.fill();
    ctx.strokeStyle = m.done ? '#8bf1a6' : 'rgba(140,160,190,0.32)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, cx, cy, chipW, 24, 7); ctx.stroke();
    ctx.fillStyle = m.done ? '#8bf1a6' : m.color;
    ctx.font = 'bold ' + (String(m.short).length > 1 ? 9 : 11) + 'px system-ui, sans-serif';
    ctx.fillText(m.short, cx + 7, cy + 16);
    ctx.fillStyle = '#e8eefc';
    ctx.font = 'bold 10px system-ui, sans-serif';
    const prog = missionProgress(m);
    const goal = missionGoal(m);
    ctx.fillText(m.done ? '✓' : (prog > 0 ? prog + '/' + goal : '—'), cx + 26, cy + 16);
    // Azul = misión de tiempo; dorado = refuerzo; verde = tarea de limpieza.
    ctx.fillStyle = m.type === 'task' ? '#8bf1a6' : (missionTimeBonus(m) > 0 ? '#8fd0ff' : '#ffd166');
    ctx.beginPath(); ctx.arc(cx + chipW - 8, cy + 7, 2.2, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = '#93a6c4';
  ctx.font = '10px system-ui, sans-serif';
  const timeCount = MISSIONS.filter(m => missionTimeBonus(m) > 0).length;
  const taskCount = MISSIONS.filter(m => m.type === 'task').length;
  const refCount = MISSIONS.length - timeCount - taskCount;
  const tasksDone = MISSIONS.filter(m => m.type === 'task' && m.done).length;
  ctx.fillText(S.timeSaved > 0
    ? 'Reloj: −' + fmtTime(Math.round(S.timeSaved)) + ' · Tareas ' + tasksDone + '/' + taskCount
    : timeCount + ' tiempo · ' + refCount + ' refuerzo · ' + taskCount + ' tareas', x + 12, y + 24 + rows * 28 + 8);
  ctx.restore();
}

/* Panel de la tarea de limpieza activa: progreso y tiempo restante. */
function drawTaskHUD() {
  if (!S.task) return;
  const m = S.task.m;
  const rows = Math.max(1, Math.ceil(MISSIONS.length / 4));
  // En pantallas estrechas el tracker se oculta: la tarea se muestra encima
  // de la tarjeta del jugador para no tapar el reloj.
  const compact = VW < 1000;
  const cardH = player && player.kind === 'student' && player.char
    ? ((player.char.ability2) ? 184 : 170)
    : 184;
  const w = Math.min(306, VW - 32), h = 64;
  const x = 16;
  const y = compact
    ? Math.max(14, VH - cardH - 20 - 8 - h)
    : 14 + 34 + rows * 28 + 16 + 8;
  const got = S.task.collected, goal = missionGoal(m);
  ctx.save();
  ctx.fillStyle = 'rgba(8,13,24,0.86)';
  roundRect(ctx, x, y, w, h, 14); ctx.fill();
  ctx.strokeStyle = m.color; ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 14); ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = m.color;
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.fillText('TAREA: ' + m.subject.toUpperCase(), x + 12, y + 19);
  ctx.textAlign = 'right';
  ctx.fillStyle = S.task.timeLeft <= 10 ? '#ff8f8f' : '#ffd166';
  ctx.font = 'bold 12px ui-monospace, Consolas, monospace';
  ctx.fillText(Math.ceil(S.task.timeLeft) + ' s', x + w - 12, y + 19);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8eefc';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText(got + ' / ' + goal + ' objetos', x + 12, y + 38);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRect(ctx, x + 12, y + 45, w - 24, 8, 4); ctx.fill();
  ctx.fillStyle = m.color;
  roundRect(ctx, x + 12, y + 45, (w - 24) * clamp(got / goal, 0, 1), 8, 4); ctx.fill();
  ctx.fillStyle = '#93a6c4';
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('Recoge los objetos brillantes antes de que acabe el tiempo.', x + 12, y + 62);
  ctx.restore();
}

function drawHUD() {
  const p = player;
  ctx.textBaseline = 'alphabetic';

  // ---- reloj ----
  const w = 250, h = 64, x = VW / 2 - w / 2, y = 14;
  ctx.fillStyle = 'rgba(8,13,24,0.82)';
  roundRect(ctx, x, y, w, h, 14); ctx.fill();
  ctx.strokeStyle = 'rgba(120,150,200,0.45)'; ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 14); ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = S.night ? '#8fd0ff' : '#e8eefc';
  ctx.font = 'bold 30px ui-monospace, Consolas, monospace';
  ctx.fillText(fmtTime(S.timeLeft), VW / 2, y + 38);
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.fillStyle = S.night ? '#8fd0ff' : '#94a7c4';
  const phaseNext = nextPhaseSeconds();
  const finalNight = S.night && matchClock() >= MATCH_TIME - DAY_NIGHT_PERIOD;
  ctx.fillText(finalNight ? 'NOCHE · RESISTE HASTA EL FINAL'
    : (S.night ? 'NOCHE · DÍA EN ' + fmtTime(phaseNext) : 'DÍA · NOCHE EN ' + fmtTime(phaseNext)), VW / 2, y + 55);

  const bw = w - 24, bx = x + 12, by = y + h + 6;
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRect(ctx, bx, by, bw, 6, 3); ctx.fill();
  const prog = clamp(matchClock() / MATCH_TIME, 0, 1);
  ctx.save();
  roundRect(ctx, bx, by, bw, 6, 3); ctx.clip();
  const seg = bw / 4;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(105,175,240,0.26)' : 'rgba(255,204,100,0.20)';
    ctx.fillRect(bx + i * seg, by, seg, 6);
  }
  ctx.fillStyle = S.night ? '#8fd0ff' : '#f0b429';
  ctx.fillRect(bx, by, bw * prog, 6);
  ctx.restore();
  // marcas de los cambios de fase (2:00, 4:00 y 6:00)
  for (let i = 1; i <= 3; i++) {
    const nx = bx + bw * (i / 4);
    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.fillRect(nx - 1, by - 3, 2, 12);
  }

  // aviso de tiempo recortado por una mision
  if (S.timeFlash > 0) {
    const a = clamp(S.timeFlash / 1.6, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#8bf1a6';
    ctx.lineWidth = 3;
    roundRect(ctx, x, y, w, h, 14); ctx.stroke();
    ctx.fillStyle = '#8bf1a6';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('−' + MISSION_BONUS + ' s', VW / 2, y + h + 31);
    ctx.restore();
  }

  // ---- marcador ----
  const sw = 250, sx = VW - sw - 16, sy = 14;
  ctx.fillStyle = 'rgba(8,13,24,0.82)';
  roundRect(ctx, sx, sy, sw, 92, 14); ctx.fill();
  ctx.strokeStyle = 'rgba(120,150,200,0.45)'; ctx.lineWidth = 2;
  roundRect(ctx, sx, sy, sw, 92, 14); ctx.stroke();

  const aliveS = studentList.filter(s => s.alive).length;
  const mainTeachers = teacherList.filter(t => !t.summon);
  const aliveT = mainTeachers.filter(t => t.alive).length;
  ctx.textAlign = 'left';
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.fillStyle = '#7ee787';
  ctx.fillText('ESTUDIANTES EN PIE: ' + aliveS + ' / ' + studentList.length, sx + 14, sy + 26);
  ctx.fillStyle = '#ff8f8f';
  ctx.fillText('PROFESORES: ' + aliveT + ' / ' + mainTeachers.length, sx + 14, sy + 46);
  ctx.fillStyle = S.night ? '#8fd0ff' : '#ffd166';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText(finalNight ? 'NOCHE · resiste hasta el final'
    : (S.night ? 'NOCHE · amanece en ' : 'DÍA · anochece en ') + fmtTime(nextPhaseSeconds()), sx + 14, sy + 68);
  ctx.fillStyle = '#94a7c4';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('Si quedan estudiantes al 8:00, ganan ellos', sx + 14, sy + 84);

  // ---- mensajes ----
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'right';
  S.messages.forEach((m, i) => {
    ctx.globalAlpha = clamp(m.t / 2, 0, 1) * 0.95;
    ctx.fillStyle = 'rgba(6,10,20,0.6)';
    const tw = ctx.measureText(m.text).width;
    roundRect(ctx, VW - 16 - tw - 14, sy + 104 + i * 24, tw + 14, 20, 6); ctx.fill();
    ctx.fillStyle = m.color;
    ctx.fillText(m.text, VW - 23, sy + 118 + i * 24);
    ctx.globalAlpha = 1;
  });

  // ---- jugador ----
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const esAlumno = !!p && p.kind === 'student';
  const cardW = 352, cardH = esAlumno ? ((p && p.char.ability2) ? 184 : 170) : 184;
  const px = 16, py = VH - cardH - 20;
  ctx.fillStyle = 'rgba(8,13,24,0.85)';
  roundRect(ctx, px, py, cardW, cardH, 14); ctx.fill();
  ctx.strokeStyle = 'rgba(120,150,200,0.45)'; ctx.lineWidth = 2;
  roundRect(ctx, px, py, cardW, cardH, 14); ctx.stroke();

  if (p) {
    ctx.textAlign = 'left';
    ctx.fillStyle = p.char.color;
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText((S.role === 'student' ? 'ESTUDIANTE · ' : 'PROFESOR · ') + p.char.name, px + 14, py + 25);
    if (p.kind === 'teacher' && p.teacherId === 'ovidio') {
      let st = '';
      if (p.voidAuraT > 0) st += 'AURA ' + Math.ceil(p.voidAuraT) + 's';
      if (p.hiddenT > 0) st += (st ? ' · ' : '') + 'INVISIBLE ' + Math.ceil(p.hiddenT) + 's';
      if (st) {
        ctx.textAlign = 'right';
        ctx.fillStyle = '#c58cff';
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.fillText(st, px + cardW - 14, py + 25);
        ctx.textAlign = 'left';
      }
    }

    // barra de vida
    const hx = px + 14, hy = py + 36, hw = cardW - 28, hh = 18;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, hx, hy, hw, hh, 6); ctx.fill();
    const frac = clamp(p.hp / p.maxHp, 0, 1);
    ctx.fillStyle = frac > 0.5 ? '#4ade80' : (frac > 0.25 ? '#facc15' : '#ef4444');
    roundRect(ctx, hx, hy, hw * frac, hh, 6); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(Math.ceil(p.hp) + ' / ' + p.maxHp + ' PV', hx + 8, hy + 13);

    if (p.kind === 'student') {
      const ab2 = p.char.ability2;
      drawCooldownBox(px + 14, py + 64, 58, p.char.ability, p.cd, null);
      if (ab2) drawCooldownBox(px + 76, py + 64, 58, ab2, p.cd2, null);
      // estados activos como pildoras
      const efs = [];
      if (p.immune > 0) efs.push({ t: 'INMUNE ' + p.immune.toFixed(0) + 's', c: '#5fe3d1' });
      if (p.speedUp > 0) efs.push({ t: 'BAILE ' + p.speedUp.toFixed(0) + 's', c: '#ffd166' });
      if (p.invis > 0) efs.push({ t: 'INVISIBLE ' + p.invis.toFixed(0) + 's', c: '#b48cff' });
      if (p.auraT > 0) efs.push({ t: 'AURA ' + p.auraT.toFixed(0) + 's', c: '#5aa9ff' });
      if (p.voidSlowT > 0) efs.push({ t: 'LENTO 75%', c: '#c58cff' });
      else if (p.slowT > 0) efs.push({ t: 'LENTO ' + p.slowT.toFixed(0) + 's', c: '#ff9f6e' });
      if (p.revealed > 0) efs.push({ t: 'REVELADO', c: '#ff5d5d' });
      if (p.noAgenda > 0) efs.push({ t: 'SIN AGENDA', c: '#c9a227' });
      if (p.luisFastT > 0) efs.push({ t: '+45% ' + p.luisFastT.toFixed(1) + 's', c: '#7ee787' });
      if (p.foodSpeedT > 0) efs.push({ t: 'COMIDA +' + Math.round(((p.foodSpeedMul || 1) - 1) * 100) + '% ' + p.foodSpeedT.toFixed(0) + 's', c: '#ffcf5c' });
      if (p.cd > 0 && p.charId === 'luis') efs.push({ t: 'BLOQUEANDO', c: '#7ee787' });
      const ex2Base = px + (ab2 ? 140 : 82);
      let ex2 = ex2Base;
      ctx.font = 'bold 11px system-ui, sans-serif';
      if (!efs.length) {
        ctx.fillStyle = '#93a6c4';
        const names = p.char.ability.name + (ab2 ? ' + ' + ab2.name : '');
        ctx.fillText(fitText(names, px + cardW - 10 - ex2Base), ex2, py + 78);
      } else {
        for (const ef of efs) {
          const tw2 = ctx.measureText(ef.t).width + 16;
          if (ex2 + tw2 > px + cardW - 10) break;
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          roundRect(ctx, ex2, py + 63, tw2, 19, 9); ctx.fill();
          ctx.fillStyle = ef.c;
          ctx.fillText(ef.t, ex2 + 8, py + 77);
          ex2 += tw2 + 6;
        }
      }
      const descX = px + (ab2 ? 140 : 82);
      const descW = px + cardW - 10 - descX;
      ctx.fillStyle = '#93a6c4';
      ctx.font = '11px system-ui, sans-serif';
      wrapText(p.char.ability.desc, descX, py + 100, descW, 14);
      if (ab2) wrapText(ab2.desc, descX, py + 132, descW, 14);
    } else {
      let bx2 = px + 14;
      for (let i = 0; i < 3; i++) {
        drawCooldownBox(bx2, py + 70, 88, p.char.abilities[i], p.cds[i], (i === 0 && p.buffNext) ? 'DOBLE' : null);
        bx2 += 98;
      }
      ctx.textAlign = 'left';
      if (p.foodSpeedT > 0) {
        ctx.fillStyle = '#ffcf5c';
        ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.fillText('COMIDA +' + Math.round(((p.foodSpeedMul || 1) - 1) * 100) + '% · ' + p.foodSpeedT.toFixed(0) + 's', px + 14, py + cardH - 24);
      }
      ctx.fillStyle = '#7f8ea8';
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText('1 / 2 / 3 para usar cada habilidad', px + 14, py + cardH - 10);
    }
  }

  // ---- pista de controles ----
  ctx.textAlign = 'center';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(190,205,230,0.75)';
  const qHint = (p && p.kind === 'student' && p.char.ability2) ? '  ·  Q habilidad 2' : '';
  ctx.fillText(S.role === 'student'
    ? 'WASD / flechas moverte  ·  ESPACIO habilidad' + qHint + '  ·  E misión/tarea  ·  M música  ·  ESC pausa'
    : 'WASD / flechas moverte  ·  1 / 2 / 3 habilidades  ·  M música  ·  ESC pausa', VW / 2, VH - 12);

  // ---- aviso de mision cercana ----
  const nm = nearMission();
  if (nm) {
    const label = S.task && nm === S.task.m
      ? 'Tarea en curso · E cancelar'
      : nm.type === 'task'
        ? 'Tarea: ' + nm.subject + (missionProgress(nm) > 0 ? ' · ' + missionProgress(nm) + '/' + missionGoal(nm) : '')
        : 'Misión de ' + nm.subject + (nm.correct > 0 ? ' · ' + nm.correct + '/' + nm.questions.length : '') + (missionTimeBonus(nm) > 0 ? '' : ' · REFUERZO');
    ctx.font = 'bold 13px system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    const pw = tw + 48, ph = 34;
    const qx = VW / 2 - pw / 2, qy = VH - 84;
    ctx.fillStyle = 'rgba(8,13,24,0.92)';
    roundRect(ctx, qx, qy, pw, ph, 10); ctx.fill();
    ctx.strokeStyle = nm.color; ctx.lineWidth = 2;
    roundRect(ctx, qx, qy, pw, ph, 10); ctx.stroke();
    ctx.fillStyle = nm.color;
    roundRect(ctx, qx + 8, qy + 7, 20, 20, 5); ctx.fill();
    ctx.fillStyle = '#0a101c';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('E', qx + 18, qy + 21);
    ctx.fillStyle = '#e8eefc';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, qx + 36, qy + 22);
    ctx.textAlign = 'center';
  }

  drawMissionTracker();
  drawTaskHUD();
  drawMinimap();

  if (S.banner) {
    const k = clamp(S.banner.t / 0.5, 0, 1);
    ctx.globalAlpha = k;
    ctx.textAlign = 'center';
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(S.banner.text, VW / 2, VH * 0.32);
    ctx.fillStyle = S.night ? '#b6ffcf' : '#ffe9a8';
    ctx.fillText(S.banner.text, VW / 2, VH * 0.32);
    if (S.banner.sub) {
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeText(S.banner.sub, VW / 2, VH * 0.32 + 34);
      ctx.fillStyle = '#dfe8fb';
      ctx.fillText(S.banner.sub, VW / 2, VH * 0.32 + 34);
    }
    ctx.globalAlpha = 1;
  }
}

function wrapText(text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '', yy = y, lines = 0;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = word; yy += lh; lines++;
      if (lines >= 2) { ctx.fillText(line.replace(/[.,;]+$/, '') + '...', x, yy); return; }
    } else line = test;
  }
  ctx.fillText(line, x, yy);
}

function drawMinimap() {
  const mw = 210, mh = Math.round(mw * WORLD_H / WORLD_W);
  const px = VW - mw - 16, py = VH - mh - 16;
  ctx.save();
  ctx.fillStyle = 'rgba(8,13,24,0.85)';
  roundRect(ctx, px - 6, py - 6, mw + 12, mh + 12, 12); ctx.fill();
  ctx.strokeStyle = 'rgba(120,150,200,0.45)'; ctx.lineWidth = 2;
  roundRect(ctx, px - 6, py - 6, mw + 12, mh + 12, 12); ctx.stroke();

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(minimapCv, px, py, mw, mh);
  ctx.imageSmoothingEnabled = true;

  const sx = mw / WORLD_W, sy = mh / WORLD_H;
  // estudiantes
  for (const s of studentList) {
    if (!s.alive || s.escaped) continue;
    const known = s.isPlayer || S.role === 'teacher' || (player && dist(s, player) < 380) || s.revealed > 0;
    if (!known) continue;
    ctx.fillStyle = s.isPlayer ? '#ffffff' : '#7ee787';
    ctx.beginPath(); ctx.arc(px + s.x * sx, py + s.y * sy, s.isPlayer ? 4 : 3, 0, TAU); ctx.fill();
  }
  // profesores
  for (const t of teacherList) {
    if (!t.alive) continue;
    if (t.hiddenT > 0 && S.role === 'student') continue;
    let known = t.isPlayer || S.role === 'teacher';
    if (!known && player && player.alive) {
      known = dist(t, player) < 560 || hasLOS(t.x, t.y, player.x, player.y);
    }
    if (!known) continue;
    ctx.fillStyle = t.isPlayer ? '#ffffff' : '#ff5d5d';
    ctx.beginPath(); ctx.arc(px + t.x * sx, py + t.y * sy, 4, 0, TAU); ctx.fill();
  }
  // examenes
  ctx.fillStyle = '#ffe08a';
  for (const ex of exams) {
    ctx.beginPath(); ctx.arc(px + ex.x * sx, py + ex.y * sy, 2.5, 0, TAU); ctx.fill();
  }
  // apuntes de examen (los dorados brillan más)
  for (const p of examPapers) {
    ctx.fillStyle = p.golden ? '#ffb347' : '#ffe08a';
    ctx.beginPath(); ctx.arc(px + p.x * sx, py + p.y * sy, p.golden ? 3.4 : 2.2, 0, TAU); ctx.fill();
  }
  // objetos de la tarea activa
  if (S.task) {
    for (const sp of S.task.spots) {
      if (sp.got) continue;
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(px + sp.x * sx, py + sp.y * sy, 2.2, 0, TAU); ctx.fill();
    }
  }
  // tareas que están limpiando las IA
  for (const m of MISSIONS) {
    if (!m.aiTask) continue;
    ctx.fillStyle = m.color || '#ffd166';
    for (const sp of m.aiTask.spots) {
      if (sp.got) continue;
      ctx.beginPath(); ctx.arc(px + sp.x * sx, py + sp.y * sy, 2, 0, TAU); ctx.fill();
    }
  }
  // comida esparcida
  for (const f of foodItems) {
    ctx.fillStyle = f.color;
    ctx.beginPath(); ctx.arc(px + f.x * sx, py + f.y * sy, 2.1, 0, TAU); ctx.fill();
  }
  // misiones y tareas
  for (const m of MISSIONS) {
    ctx.fillStyle = m.done ? '#8bf1a6' : m.color;
    ctx.beginPath(); ctx.arc(px + m.x * sx, py + m.y * sy, 2.6, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

/* ---------------------------------------------------------------------------
   Pantallas y flujo de partida
   --------------------------------------------------------------------------- */
const $ = id => document.getElementById(id);
function showScreen(id) {
  if (id !== 'screen-end' && endCelebrationCv) {
    endCelebrationCv.classList.remove('on');
    endCelebration = null;
  }
  const screens = document.querySelectorAll('.screen');
  screens.forEach(el => el.classList.toggle('hidden', el.id !== id));
  if (id === null) screens.forEach(el => el.classList.add('hidden'));
}

function initials(name) {
  const parts = name.replace(/profe\s+/i, '').split(' ');
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

/* Dibuja al personaje en un lienzo aparte y devuelve un retrato en PNG. */
function renderPortrait(c, kind, skin) {
  const W = 160, H = 200, SS = 2;
  const pc = document.createElement('canvas');
  pc.width = W * SS; pc.height = H * SS;
  const pctx = pc.getContext('2d');
  pctx.scale(SS, SS);

  const fxCol = (skin && skin.fx && skin.fx.accent) || c.color;
  const rgb = hexToRgb(fxCol);
  const g = pctx.createRadialGradient(W / 2, 52, 4, W / 2, 92, W * 0.8);
  g.addColorStop(0, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.5)');
  g.addColorStop(0.55, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.2)');
  g.addColorStop(1, 'rgba(8,12,22,0)');
  pctx.fillStyle = g;
  pctx.fillRect(0, 0, W, H);

  pctx.strokeStyle = 'rgba(255,255,255,0.045)';
  pctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    pctx.beginPath(); pctx.moveTo(0, i * H / 6); pctx.lineTo(W, i * H / 6); pctx.stroke();
  }

  // retrato de cuerpo entero, con la cabeza lo bastante grande para ver la cara
  const R = 48;
  // Plataforma con el color de la firma visual del traje.
  pctx.strokeStyle = hexRgba(fxCol, 0.55);
  pctx.lineWidth = 1.6;
  pctx.beginPath(); pctx.ellipse(W / 2, H - 9, 44, 10, 0, 0, TAU); pctx.stroke();
  pctx.fillStyle = 'rgba(0,0,0,0.32)';
  pctx.beginPath(); pctx.ellipse(W / 2, H - 9, 36, 8, 0, 0, TAU); pctx.fill();
  const e = {
    kind, charId: c.id, char: c, name: c.name, skin: skin || null,
    look: skinLook(c.look, skin),
    x: W / 2, y: H - 8 - R * 1.12, r: R, face: Math.PI / 2,
    walk: 0, cd: 1, swing: 0, speedUp: 0, stun: 0, immune: 0, invis: 0,
    eatT: 0, talkT: 0, combT: 0, chargeT: 0, talkLines: null,
    blinkSeed: 1.3, noBlink: true, portrait: true
  };
  const old = ctx;
  ctx = pctx;
  try {
    if (skin && skin.fx) {
      drawThemeFx({
        x: W / 2, y: H * 0.34, color: skin.fx.color, accent: skin.fx.accent,
        style: skin.fx.style, scale: 0.72, seed: 1.7
      }, 0.24);
    }
    drawPerson(e);
  } finally { ctx = old; }

  return pc.toDataURL('image/png');
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* Reparte los 6 estudiantes entre la IA intentando que haya el menor número
   de repetidos posible (7 estudiantes en total, así que uno se repite). */
function rebuildAiStudents() {
  const n = S.role === 'student' ? N_STUDENTS - 1 : N_STUDENTS;
  const exclude = S.role === 'student' ? S.selected : null;
  const pool = shuffleArray(STUDENT_IDS.filter(id => id !== exclude));
  const out = [];
  for (let i = 0; i < n; i++) {
    if (i < pool.length) out.push(pool[i]);
    else out.push(choice(pool));
  }
  S.aiStudents = out;
}

function refreshAIList() {
  const sel = S.selected || (S.role === 'student' ? STUDENT_IDS[0] : TEACHER_IDS[0]);
  const items = [];
  if (S.role === 'student') {
    for (const id of TEACHER_IDS) items.push({ kind: 'teacher', id, label: TEACHERS[id].name, color: TEACHERS[id].color });
    for (const id of S.aiStudents) items.push({ kind: 'student', id, label: STUDENTS[id].name, color: STUDENTS[id].color });
  } else {
    for (const id of TEACHER_IDS) {
      if (id === sel) { items.push({ kind: 'teacher', id, label: TEACHERS[id].name + ' (TÚ)', color: TEACHERS[id].color, me: true }); continue; }
      items.push({ kind: 'teacher', id, label: TEACHERS[id].name, color: TEACHERS[id].color });
    }
    for (const id of S.aiStudents) items.push({ kind: 'student', id, label: STUDENTS[id].name, color: STUDENTS[id].color });
  }
  const box = $('ai-list');
  box.innerHTML = '';
  for (const it of items) {
    const div = document.createElement('div');
    div.className = 'ai-pill' + (it.me ? ' me' : '');
    div.innerHTML = '<i style="background:' + it.color + '"></i>' +
      '<span>' + it.label + '</span>' +
      '<em>' + (it.me ? 'TÚ' : (it.kind === 'teacher' ? 'PROFESOR IA' : 'ESTUDIANTE IA')) + '</em>';
    box.appendChild(div);
  }
  const info = $('roster-info');
  if (info) {
    info.textContent = '10 jugadores: tú (' + (S.role === 'student' ? 'estudiante' : 'profesor') + ') + 9 IA · 3 profesores y 7 estudiantes · Las IA lucen trajes al azar';
  }
}

function openSelect() {
  S.role = Math.random() < 0.5 ? 'student' : 'teacher';
  S.selected = null;
  S.aiStudents = [];
  rebuildAiStudents();

  const roll = $('role-roll');
  roll.textContent = S.role === 'student' ? 'Te toco ser ESTUDIANTE' : 'Te toco ser PROFESOR';
  roll.className = 'roll ' + S.role;

  $('select-title').textContent = S.role === 'student' ? 'Elige tu estudiante (4º)' : 'Elige tu profesor';

  const ids = S.role === 'student' ? STUDENT_IDS : TEACHER_IDS;
  const kind = S.role === 'student' ? 'student' : 'teacher';
  const grid = $('char-grid');
  grid.innerHTML = '';
  for (const id of ids) {
    const c = S.role === 'student' ? STUDENTS[id] : TEACHERS[id];
    const skin = equippedSkin(kind, id);
    let abilities = '';
    if (S.role === 'student') {
      abilities = [c.ability, c.ability2].filter(Boolean).map(a =>
        '<div class="ab"><b>' + a.name + '</b> [' + a.key + '] (' + a.cd + 's) — ' + a.desc + '</div>'
      ).join('');
    } else {
      abilities = c.abilities.map(a => '<div class="ab"><b>' + a.name + '</b> [' + a.key + '] (' + a.cd + 's) — ' + a.desc + '</div>').join('');
    }
    const card = document.createElement('button');
    card.className = 'char-card';
    card.style.setProperty('--c', c.color);
    card.style.setProperty('--sc', skin.fx.accent);
    const portrait = renderPortrait(c, kind, skin);
    card.innerHTML =
      '<div class="portrait-box"><img class="portrait" alt="' + c.name + '" src="' + portrait + '"></div>' +
      '<div class="cname">' + c.name + '</div>' +
      '<div class="ctag">' + c.tagline + '</div>' +
      '<div class="skin-tag">TRAJE · ' + skin.name + ' · ' + skin.design + '</div>' +
      '<div class="cdesc">' + (c.desc || '') + '</div>' +
      '<div class="cstats">PV ' + c.hp + ' · Velocidad ' + c.speed + '</div>' +
      abilities;
    card.onclick = () => {
      S.selected = id;
      grid.querySelectorAll('.char-card').forEach(x => x.classList.remove('sel'));
      card.classList.add('sel');
      $('btn-start').disabled = false;
      if (S.role === 'student') rebuildAiStudents();
      refreshAIList();
    };
    grid.appendChild(card);
  }
  $('btn-start').disabled = true;
  refreshAIList();
  showScreen('screen-select');
}

function currentRoster() {
  const roster = [];
  if (S.role === 'student') {
    const sel = S.selected || STUDENT_IDS[0];
    roster.push({ kind: 'student', id: sel, isPlayer: true });
    for (const id of TEACHER_IDS) roster.push({ kind: 'teacher', id });
    for (const id of S.aiStudents) roster.push({ kind: 'student', id });
  } else {
    const sel = S.selected || TEACHER_IDS[0];
    roster.push({ kind: 'teacher', id: sel, isPlayer: true });
    for (const id of TEACHER_IDS) if (id !== sel) roster.push({ kind: 'teacher', id });
    for (const id of S.aiStudents) roster.push({ kind: 'student', id });
  }
  return roster;
}

function buildMinimapImage() {
  minimapCv.width = COLS; minimapCv.height = ROWS;
  const g = minimapCv.getContext('2d');
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const v = grid[y][x];
      g.fillStyle = v === 1 ? '#2f4159' : (v === 2 ? '#46566e' : floorCol[y][x]);
      g.fillRect(x, y, 1, 1);
    }
  }
}

/* ---------------------------------------------------------------------------
   Pantalla de trajes
   --------------------------------------------------------------------------- */
let skinKind = 'student';
let skinChar = STUDENT_IDS[0];
let skinToastTimer = 0;

function openSkins() {
  S.phase = 'menu';
  skinKind = 'student';
  skinChar = STUDENT_IDS[0];
  renderSkinScreen();
  showScreen('screen-skins');
  const toast = document.getElementById('skin-toast');
  if (toast) { toast.className = 'skin-toast'; toast.textContent = ''; }
}

function setSkinKind(kind) {
  skinKind = kind;
  const ids = kind === 'student' ? STUDENT_IDS : TEACHER_IDS;
  if (!ids.includes(skinChar)) skinChar = ids[0];
  renderSkinScreen();
}

function showSkinToast(text, good) {
  const el = document.getElementById('skin-toast');
  if (!el) return;
  el.textContent = text;
  el.className = 'skin-toast on ' + (good ? 'good' : 'bad');
  clearTimeout(skinToastTimer);
  skinToastTimer = setTimeout(() => { el.className = 'skin-toast'; }, 3200);
}

const SKIN_RARITY_META = {
  'Básico': { slug: 'basico', color: '#9fb2d0' },
  'Especial': { slug: 'especial', color: '#5fd0ff' },
  'Élite': { slug: 'elite', color: '#c77dff' },
  'Legendario': { slug: 'legendario', color: '#ffb347' },
  'Mítico': { slug: 'mitico', color: '#ff5d8f' }
};
const SKIN_ANIM_LABEL = {
  sway: 'Balanceo', bounce: 'Rebote', float: 'Flotación',
  shimmer: 'Brillo', pulse: 'Pulso', orbit: 'Órbita'
};

function renderSkinScreen() {
  refreshPointsUI();
  const ids = skinKind === 'student' ? STUDENT_IDS : TEACHER_IDS;
  if (!ids.includes(skinChar)) skinChar = ids[0];
  const listBox = document.getElementById('skin-list');
  const charsBox = document.getElementById('skin-chars');
  if (!listBox || !charsBox) return;

  document.querySelectorAll('#skin-tabs .skin-tab').forEach(tab => {
    tab.classList.toggle('on', tab.dataset.kind === skinKind);
  });

  charsBox.innerHTML = '';
  for (const id of ids) {
    const c = skinKind === 'student' ? STUDENTS[id] : TEACHERS[id];
    const eq = equippedSkin(skinKind, id);
    const skins = skinsFor(skinKind, id);
    const owned = skins.filter(isSkinOwned).length;
    const pct = skins.length ? Math.round(owned / skins.length * 100) : 0;
    const btn = document.createElement('button');
    btn.className = 'skin-char' + (id === skinChar ? ' sel' : '');
    btn.style.setProperty('--c', c.color);
    btn.style.setProperty('--sc', eq ? eq.fx.accent : c.color);
    btn.innerHTML =
      '<span class="sc-avatar">' + initials(c.name) + '</span>' +
      '<span class="sc-info"><b>' + c.name + '</b><small>' + owned + ' / ' + skins.length + ' trajes</small>' +
      '<span class="sc-progress"><i style="width:' + pct + '%"></i></span></span>';
    btn.onclick = () => { skinChar = id; renderSkinScreen(); };
    charsBox.appendChild(btn);
  }

  const c = skinKind === 'student' ? STUDENTS[skinChar] : TEACHERS[skinChar];
  const eq = equippedSkin(skinKind, skinChar);
  const skins = skinsFor(skinKind, skinChar);
  listBox.innerHTML = '';
  for (const skin of skins) {
    const owned = isSkinOwned(skin);
    const active = eq && eq.id === skin.id;
    const rar = SKIN_RARITY_META[skin.rarity] || { slug: 'especial', color: skin.fx.accent };
    const card = document.createElement('div');
    card.className = 'skin-card' + (owned ? ' owned' : ' locked') +
      (active ? ' equipped' : '') + ' rarity-' + rar.slug;
    card.style.setProperty('--sc', skin.fx.accent);
    card.style.setProperty('--rar', rar.color);
    const portrait = renderPortrait(c, skinKind, skin);
    card.innerHTML =
      '<div class="skin-preview"><img alt="' + c.name + ' con traje ' + skin.name + '" src="' + portrait + '">' +
        '<span class="skin-rarity"><i></i>' + skin.rarity + '</span>' +
        (active ? '<span class="skin-equipped">EQUIPADO</span>' : '') +
      '</div>' +
      '<div class="skin-body">' +
        '<div class="skin-title"><b>' + skin.name + '</b><span>' + (skin.cost ? skin.cost + ' pts' : 'GRATIS') + '</span></div>' +
        '<div class="skin-design">Habilidad: <b>' + skin.design + '</b></div>' +
        (skin.anim ? '<div class="skin-design">Animación: <b>' + (SKIN_ANIM_LABEL[skin.anim] || skin.anim) + '</b></div>' : '') +
        '<p>' + skin.desc + '</p>' +
        '<div class="skin-palette">' +
          '<i style="background:' + (skin.look.shirt || c.look.shirt) + '"></i>' +
          '<i style="background:' + (skin.look.hair || c.look.hair) + '"></i>' +
          '<i style="background:' + skin.fx.accent + '"></i>' +
        '</div>' +
      '</div>';
    const act = document.createElement('button');
    act.className = 'skin-action';
    if (active) {
      act.textContent = 'EQUIPADO';
      act.disabled = true;
    } else if (owned) {
      act.textContent = 'EQUIPAR';
      act.onclick = () => {
        equipSkin(skinKind, skinChar, skin.id);
        renderSkinScreen();
        showSkinToast('Traje equipado: ' + skin.name, true);
      };
    } else {
      const missing = Math.max(0, skin.cost - progress.points);
      act.textContent = missing > 0 ? 'FALTAN ' + missing + ' PTS' : 'COMPRAR · ' + skin.cost + ' PTS';
      act.disabled = missing > 0;
      act.onclick = () => {
        if (buySkin(skinKind, skinChar, skin.id)) {
          renderSkinScreen();
          showSkinToast('¡Traje desbloqueado y equipado! · ' + skin.name, true);
        } else {
          showSkinToast('No tienes suficientes puntos de examen.', false);
        }
      };
    }
    card.appendChild(act);
    listBox.appendChild(card);
  }
}

function startMatch() {
  buildMap();
  buildDoorGroups();
  patrolFlows = null;
  buildMinimapImage();
  spawnExamPapers();
  entities = []; studentList = []; teacherList = [];
  exams = []; projectiles = []; fx = []; texts = [];
  S.messages = []; S.elapsed = 0; S.timeLeft = MATCH_TIME; S.night = false;
  S.timeBonus = 0; S.timeSaved = 0; S.timeFlash = 0; S.quiz = null; S.task = null; S.aiMissionTimer = 14;
  S.escaped = 0; S.downStudents = 0; S.downTeachers = 0; S.winner = null;
  S.banner = null; S.camShake = 0; S.stats = { dmg: 0 };
  S.examEarned = 0; S.examBreakdown = []; S.playFade = 0;
  S.papersBonus = false; S.answerStreak = 0; S.bestStreak = 0;
  S.chaseMusic = null;
  player = null;

  if (typeof ChaseMusic !== 'undefined') {
    ChaseMusic.reset();
    ChaseMusic.unlock();
    refreshMusicUI();
  }

  const roster = currentRoster();
  const used = Object.create(null);
  const studentAnchors = [
    { x: 20 * T, y: 61 * T }, { x: 40 * T, y: 62 * T }, { x: 66 * T, y: 61 * T },
    { x: 78 * T, y: 57 * T }, { x: 8 * T, y: 57 * T }, { x: 52 * T, y: 44 * T },    { x: 30 * T, y: 44 * T }, { x: 74 * T, y: 45 * T }
  ];
  const teacherAnchors = {
    jose: { x: 44 * T, y: 15 * T },
    ovidio: { x: 16 * T, y: 15 * T },
    segundo: { x: 76 * T, y: 15 * T }
  };
  let si = 0;

  for (const r of roster) {
    if (r.kind === 'teacher') {
      const a = teacherAnchors[r.id] || { x: 24 * T, y: 12.5 * T };
      const spot = freeSpot(a.x, a.y, T * 2.5);
      const e = makeTeacher(r.id, !!r.isPlayer, r.isPlayer ? TEACHERS[r.id].name : nameFor(TEACHERS[r.id].name, used, r.id));
      e.x = spot.x; e.y = spot.y;
      if (r.isPlayer) player = e;
      entities.push(e); teacherList.push(e);
    } else {
      const a = studentAnchors[si % studentAnchors.length];
      const spot = freeSpot(a.x, a.y, T * 2.5);
      const e = makeStudent(r.id, !!r.isPlayer, r.isPlayer ? STUDENTS[r.id].name : nameFor(STUDENTS[r.id].name, used, r.id));
      e.x = spot.x; e.y = spot.y;
      if (r.isPlayer) player = e;
      entities.push(e); studentList.push(e);
      si++;
    }
  }
  spawnFoodItems();
  cam.x = player ? player.x : WORLD_W / 2;
  cam.y = player ? player.y : WORLD_H / 2;

  showScreen(null);
  startTeacherIntro();
}

/* ---------------------------------------------------------------------------
   Entrada y bucle
   --------------------------------------------------------------------------- */
addEventListener('keydown', e => {
  keys[e.key] = true;
  if (e.key === ' ' || e.key.indexOf('Arrow') === 0) e.preventDefault();

  if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    toggleMusic();
    return;
  }

  if (S.phase === 'intro') {
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      finishTeacherIntro(true);
    }
    return;
  }

  const skinsScreen = document.getElementById('screen-skins');
  if (e.key === 'Escape' && skinsScreen && !skinsScreen.classList.contains('hidden')) {
    S.phase = 'menu'; showScreen('screen-start'); refreshPointsUI();
    return;
  }

  // con una mision abierta: 1-4 responden, ESPACIO/ENTER avanza, ESC sale
  if (S.quiz) {
    if (e.key === 'Escape') { closeMission(); return; }
    if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4') {
      if (S.quiz.locked) nextMission(); else answerMission(+e.key - 1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (S.quiz.locked) nextMission();
      e.preventDefault();
      return;
    }
    return;
  }

  if ((e.key === 'e' || e.key === 'E') && S.phase === 'playing') {
    const m = nearMission();
    if (m) { openMission(m); return; }
  }

  if (e.key === 'Escape') {
    if (S.phase === 'playing') {
      S.phase = 'paused';
      if (typeof ChaseMusic !== 'undefined') ChaseMusic.pause();
      showScreen('screen-pause');
    } else if (S.phase === 'paused') {
      S.phase = 'playing';
      if (typeof ChaseMusic !== 'undefined') ChaseMusic.resume();
      showScreen(null); last = performance.now();
    }
  }
});
addEventListener('keyup', e => { keys[e.key] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => {
  if (typeof ChaseMusic === 'undefined') return;
  if (document.hidden) ChaseMusic.pause();
  else if (S.phase === 'playing') ChaseMusic.resume();
});
canvas.addEventListener('pointerdown', () => {
  if (S.phase === 'intro') finishTeacherIntro(true);
});

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.phase === 'playing') tick(dt);
  else if (S.phase === 'intro') updateTeacherIntro(dt);
  render();
  if (S.phase === 'end' && endCelebration) renderEndCelebration();
  requestAnimationFrame(frame);
}

function init() {
  resize();
  buildMap();
  buildDoorGroups();
  patrolFlows = null;
  buildMinimapImage();
  $('btn-play').addEventListener('click', openSelect);
  $('btn-skins').addEventListener('click', openSkins);
  $('btn-skins-back').addEventListener('click', () => {
    S.phase = 'menu'; showScreen('screen-start'); refreshPointsUI();
  });
  $('skin-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.skin-tab');
    if (tab && tab.dataset.kind) setSkinKind(tab.dataset.kind);
  });
  $('btn-start').addEventListener('click', () => { if (S.selected) startMatch(); });
  $('btn-again').addEventListener('click', openSelect);
  $('btn-music').addEventListener('click', toggleMusic);
  $('btn-resume').addEventListener('click', () => {
    S.phase = 'playing';
    if (typeof ChaseMusic !== 'undefined') ChaseMusic.resume();
    showScreen(null); last = performance.now();
  });
  $('btn-quiz-close').addEventListener('click', closeMission);
  $('btn-quit').addEventListener('click', () => {
    S.phase = 'menu'; player = null; entities = []; foodItems = []; S.chaseMusic = null;
    if (typeof ChaseMusic !== 'undefined') ChaseMusic.stop();
    if (S.quiz) closeMission();
    showScreen('screen-start'); refreshPointsUI(); refreshMusicUI();
  });
  refreshPointsUI();
  refreshMusicUI();
  showScreen('screen-start');
  requestAnimationFrame(frame);
}

init();
