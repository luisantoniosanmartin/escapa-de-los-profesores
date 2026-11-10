'use strict';
/* ============================================================================
   ESCAPA DE LOS PROFESORES - datos, personajes y mapa del colegio
   ============================================================================ */

const T       = 48;                    // tamano de tile en pixeles
const COLS    = 96;                    // mapa XXL
const ROWS    = 66;
const WORLD_W = COLS * T;              // 4608 px
const WORLD_H = ROWS * T;              // 3168 px

const MATCH_TIME  = 480;               // la partida dura 8 minutos
const DAY_NIGHT_PERIOD = 120;          // cada 2 minutos cambia entre dia y noche
const MAX_PLAYERS = 10;                // jugador + 9 IA
const N_TEACHERS  = 3;                 // 3 profesores
const N_STUDENTS  = MAX_PLAYERS - N_TEACHERS;   // 7 estudiantes

const TAU = Math.PI * 2;
const clamp   = (v, a, b) => (v < a ? a : (v > b ? b : v));
const lerp    = (a, b, t) => a + (b - a) * t;
const rnd     = (a, b) => a + Math.random() * (b - a);
const rndInt  = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const choice  = (arr) => arr[(Math.random() * arr.length) | 0];
const dist    = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dxy     = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
function normAng(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }

/* ============================================================================
   COLORES
   ============================================================================ */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}
function shadeHex(hex, amt) {
  return amt < 0 ? mixHex(hex, '#000000', -amt) : mixHex(hex, '#ffffff', amt);
}
function hexRgba(hex, alpha) {
  const c = hexToRgb(hex);
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')';
}

/* Cada IA recibe una variante de color para no confundir a los repetidos */
const VARIANT_TINTS = ['#ffffff', '#ffd9a0', '#ffb3c1', '#a0d8ff', '#c8ffb0', '#e0c8ff', '#ffe08a', '#9ff0e2'];
const VARIANT_HAIR  = ['#000000', '#4a2f1c', '#6b4423', '#1b1b26', '#8a5a3a'];

function variantLook(look, seed) {
  const out = Object.assign({}, look);
  const t = VARIANT_TINTS[Math.floor(seed * VARIANT_TINTS.length) % VARIANT_TINTS.length];
  out.shirt  = mixHex(look.shirt, t, 0.24);
  out.shirt2 = shadeHex(out.shirt, -0.24);
  const h = VARIANT_HAIR[Math.floor(seed * 37 * VARIANT_HAIR.length) % VARIANT_HAIR.length];
  out.hair = mixHex(look.hair, h, 0.35);
  const s = Math.random() < 0.5 ? '#8a5a34' : '#ffe0c0';
  out.skin = mixHex(look.skin, s, 0.12);
  return out;
}

/* ============================================================================
   ESTUDIANTES
   ============================================================================ */
const STUDENTS = {
  leonardo: {
    id: 'leonardo', name: 'Leonardo', color: '#5aa9ff', tagline: 'El de la onda lenta',
    desc: 'El más tranquilo de 4º. Su música frena a los profesores que se acercan demasiado.',
    hp: 110, speed: 132,
    look: { skin: '#f0c49b', hair: '#252533', shirt: '#4f9bff', shirt2: '#3b7ad4', pants: '#2c3346', shoes: ['#e8ecf5', '#e8ecf5'], acc: 'headphones', hairStyle: 'short', bag: '#2f4d7a', pattern: 'wave', sock: '#dfe8ff', wrist: '#4f9bff', eye: '#2f6fd0', build: 'slim', cuff: '#dfe8ff' },
    ability: { id: 'slow', name: 'Ralentizar', key: 'ESPACIO', cd: 12,
      desc: 'Crea un aura: los profesores que estén cerca se mueven al 50% de velocidad durante 6 s.' }
  },
  jonny: {
    id: 'jonny', name: 'Jonny', color: '#ffd166', tagline: 'El bailarín',
    desc: 'El alma de la fiesta. Cuando empieza a bailar no hay profesor que lo pille.',
    hp: 100, speed: 138,
    look: { skin: '#c98d5a', hair: '#2b1a0f', shirt: '#ffd166', shirt2: '#e0ad3f', pants: '#2f3550', shoes: ['#f5f7ff', '#f5f7ff'], acc: 'cap', hairStyle: 'curly', bag: '#8a3b3b', smile: true, pattern: 'star', chain: true, shorts: true, sock: '#ffd166', wrist: '#ffd166', eye: '#6b3d1d', build: 'athletic', shoeAccent: '#ffd166' },
    ability: { id: 'dance', name: 'Baile', key: 'ESPACIO', cd: 10,
      desc: 'Se pone a bailar y aumenta su velocidad un 75% durante 5 s.' }
  },
  morante: {
    id: 'morante', name: 'Morante', color: '#b48cff', tagline: 'El fantasma del patio',
    desc: 'Siempre está en otro sitio. De noche se esfuma sin dejar rastro.',
    hp: 100, speed: 132,
    look: { skin: '#e5b58c', hair: '#1d1d27', shirt: '#a97df7', shirt2: '#8459cf', pants: '#23232f', shoes: ['#2a2a36', '#2a2a36'], acc: 'hood', hairStyle: 'long', bag: '#22222c', hoodie: true, strings: true, bags: true, sock: '#2a2a36', eye: '#7b5bd6', build: 'slim', cuff: '#b9a6e8' },
    ability: { id: 'invis', name: 'Invisibilidad', key: 'ESPACIO', cd: 15,
      desc: 'Solo funciona de NOCHE: se vuelve invisible 5 s y los profesores no pueden verlo.' },
    ability2: { id: 'steal', name: 'Robar habilidad', key: 'Q', cd: 16,
      desc: 'Le roba una habilidad al azar a otro estudiante y la usa al instante.' }
  },
  luis: {
    id: 'luis', name: 'Luis', color: '#7ee787', tagline: 'El de la regla',
    desc: 'El delegado de la clase. Lleva la regla hasta en el bolsillo de la camisa.',
    hp: 118, speed: 126,
    look: { skin: '#d9a273', hair: '#3d2716', shirt: '#6fdc79', shirt2: '#4fae5c', pants: '#2d3a2f', shoes: ['#ffffff', '#ffffff'], acc: 'ruler', hairStyle: 'short', bag: '#3f5a3f', glasses: true, pattern: 'pocket', rulerPocket: true, sock: '#7ee787', wrist: '#7ee787', eye: '#2f7a3d', build: 'neat', watch: '#e9c46a', cuff: '#eaffea' },
    ability: { id: 'ruler', name: 'Reglazo', key: 'ESPACIO', cd: 8,
      desc: 'Golpea con la regla: 20 de daño y 2 s sin moverse. Luis corre un 45% más rápido durante 4 s. Mientras recarga, bloquea y recibe 40% menos daño.' },
    ability2: { id: 'pageWave', name: '¿Por cuál página?', key: 'Q', cd: 12,
      desc: 'Grita «¿Por cuál página vas?» y lanza una onda: los profesores alcanzados retroceden 1,2 s.' }
  },
  ipa: {
    id: 'ipa', name: 'Ipa', color: '#ff9f6e', tagline: 'El hambriento',
    desc: 'Nunca tiene suficiente comida. Su bocadillo le devuelve la vida en plena persecución.',
    hp: 132, speed: 122,
    look: { skin: '#f2c39d', hair: '#33261a', shirt: '#ff9a63', shirt2: '#e07a45', pants: '#3a3040', shoes: ['#e8ecf5', '#e8ecf5'], acc: 'sandwich', hairStyle: 'buzz', belly: true, bag: '#6a3f2a', stain: true, crumbs: true, smile: true, sock: '#ff9f6e', wrist: '#ff9f6e', eye: '#b9662b', build: 'round', shoeAccent: '#ff9f6e', cuff: '#ffe2cf' },
    ability: { id: 'eat', name: 'Comer', key: 'ESPACIO', cd: 12,
      desc: 'Se come su bocadillo y regenera 35 puntos de vida.' }
  },
  elias: {
    id: 'elias', name: 'Elías', color: '#5fe3d1', tagline: 'El de los zapatos al revés',
    desc: 'Se levantó con los zapatos cambiados. Va lento, pero nada le hace daño.',
    hp: 112, speed: 130,
    look: { skin: '#e9bd97', hair: '#241a2e', shirt: '#54dcc9', shirt2: '#37b3a3', pants: '#2b3348', shoes: ['#ff5d5d', '#4d8dff'], acc: 'shoes', hairStyle: 'messy', bag: '#3a4a6a', patch: true, freckles: true, sock: ['#ff5d5d', '#4d8dff'], eye: '#2a8f84', build: 'slim', shoeAccent: '#5fe3d1', cuff: '#d6fff8' },
    ability: { id: 'shoes', name: 'Zapatos al revés', key: 'ESPACIO', cd: 14,
      desc: 'Se pone los zapatos mal: durante 5 s se mueve al 50% de velocidad, pero es INMUNE a todos los ataques.' }
  }
};

/* ============================================================================
   PROFESORES
   ============================================================================ */
const TEACHERS = {
  jose: {
    id: 'jose', name: 'Profe Rojas', color: '#ff5d5d', tagline: 'El de la agenda',
    desc: 'El profesor más rápido con la agenda. Si te decomisa algo, el siguiente golpe duele el doble.',
    hp: 180, speed: 108,
    look: { skin: '#e3b087', hair: '#3a3a44', shirt: '#ff5d5d', shirt2: '#d13b3b', pants: '#232c40', shoes: ['#1e1e26', '#1e1e26'], acc: 'agenda', hairStyle: 'short', glasses: true, tie: '#8b1e1e', teacher: true, brows: 'angry', jacket: '#8f2424', collar: '#f2f5fb', build: 'stocky', pocketSquare: '#ffd0d0', tieClip: '#e9c46a', watch: '#e9c46a', cuff: '#f2f5fb' },
    abilities: [
      { name: 'Agendazo',        key: '1', cd: 2,  desc: 'Golpea con la agenda: 23 de daño.' },
      { name: 'Decomiso',        key: '2', cd: 9,  desc: 'Quita la agenda a un estudiante al azar: tu próximo Agendazo hace EL DOBLE de daño (46).' },
      { name: 'Examen sorpresa', key: '3', cd: 13, desc: 'Invoca un examen que persigue al estudiante más cercano. Si lo toca: 10 de daño y revela su ubicación.' }
    ]
  },
  ovidio: {
    id: 'ovidio', name: 'Profe Cáceres', color: '#e35d8a', tagline: 'El del grito',
    desc: 'Su voz retumba en todo el colegio. Cambia de lugar con otro profesor y deja un aura negra que frena a cualquiera.',
    hp: 172, speed: 110,
    look: { skin: '#c58a62', hair: '#181621', shirt: '#4a2b52', shirt2: '#35203f', pants: '#211b2c', shoes: ['#15131c', '#15131c'], acc: 'megaphone', hairStyle: 'slick', glasses: false, tie: '#b51f4e', teacher: true, brows: 'angry', moustache: true, jacket: '#2a1d35', collar: '#e9e4f5', build: 'tall', pocketSquare: '#f4b8cd', tieClip: '#f2cf74', watch: '#d9c8ff', cuff: '#f2effb' },
    abilities: [
      { name: '¡Siéntate!',              key: '1', cd: 7,  desc: 'Grito a distancia: lanza una onda sonora que hace 40 de daño al primer estudiante que alcance.' },
      { name: 'No me hagas perder el tiempo', key: '2', cd: 16, desc: 'Se intercambia con otro profesor y deja un aura negra durante 8 s: quien entre se vuelve 75 % más lento.' },
      { name: 'No puedes vencerme',      key: '3', cd: 20, desc: 'Se vuelve invisible para los estudiantes durante 6 s.' }
    ]
  },
  segundo: {
    id: 'segundo', name: 'Profe Quispe', color: '#c77dff', tagline: 'El del peine regla',
    desc: 'Pinta canas de respeto y peina con precisión. Su peine regla de metal no perdona a nadie.',
    hp: 175, speed: 114,
    look: { skin: '#c88b5c', hair: '#3a3440', shirt: '#8f5bd6', shirt2: '#6f3fb0', pants: '#242a3e', shoes: ['#1e1e26', '#1e1e26'], acc: 'comb', hairStyle: 'slick', tie: '#4a1f6b', teacher: true, brows: 'angry', moustache: true, jacket: '#5d2f8a', collar: '#f2effb', build: 'broad', pocketSquare: '#dec7ff', tieClip: '#d9b85a', watch: '#e9c46a', cuff: '#f3efff' },
    abilities: [
      { name: 'Peine regla',       key: '1', cd: 2.4, desc: 'Golpea con su peine regla de metal: 30 de daño al estudiante más cercano que tenga delante.' },
      { name: 'Invocar profes',    key: '2', cd: 18,  desc: 'Invoca al Profe Primero y al Profe Tercero durante 9 s. El Primero persigue al estudiante más cercano; el Tercero, al tercero más cercano.' },
      { name: 'Castigo de recreo', key: '3', cd: 16,  desc: 'Avisa y embiste hacia delante: 60 de daño a todo lo que pille. Si choca con un estudiante, se detiene y se peina 1 s.' }
    ]
  }
};

/* Profesores que invoca el Profe Quispe. Son temporales y no cuentan como
   los 3 profesores principales de la partida. */
const SUMMON_TEACHERS = {
  primero: {
    name: 'Profe Primero', color: '#63c5ff', rgb: '99,197,255',
    desc: 'Profesor invocado. Persigue al estudiante más cercano.',
    look: { skin: '#e3b087', hair: '#2c3444', shirt: '#3f8fd6', shirt2: '#2f6fae', pants: '#1d2536', shoes: ['#1e1e26', '#1e1e26'], acc: 'agenda', hairStyle: 'short', glasses: true, tie: '#1d4f7a', teacher: true, brows: 'angry', ghost: '#63c5ff', jacket: '#245d91', collar: '#edf5ff' }
  },
  tercero: {
    name: 'Profe Tercero', color: '#8bf1a6', rgb: '139,241,166',
    desc: 'Profesor invocado. Persigue al tercer estudiante más cercano.',
    look: { skin: '#d8a273', hair: '#3a2a1c', shirt: '#3fbf7a', shirt2: '#2f9460', pants: '#20302a', shoes: ['#1e1e26', '#1e1e26'], acc: 'chalk', hairStyle: 'bald', glasses: true, tie: '#1f5a3a', teacher: true, brows: 'angry', ghost: '#8bf1a6', jacket: '#26764a', collar: '#eefaf3' }
  }
};

const STUDENT_IDS = ['leonardo', 'jonny', 'morante', 'luis', 'ipa', 'elias'];
const TEACHER_IDS = ['jose', 'ovidio', 'segundo'];

/* ============================================================================
   TRAJES
   Cada personaje empieza con su traje Clasico. Los trajes especiales cuestan
   Puntos de examen y cambian el aspecto del personaje y el diseno visual de sus
   habilidades. Los campos de "look" se mezclan con el aspecto base.
   ============================================================================ */
const SKINS = {
  student: {
    leonardo: [
      {
        id: 'base', name: 'Clásico', cost: 0, rarity: 'Básico',
        desc: 'La ropa de todos los días y su onda azul de siempre.',
        design: 'Onda azul',
        fx: { color: '120,200,255', accent: '#8fd0ff', style: 'wave' },
        look: {}
      },
      {
        id: 'neon', name: 'Neón', cost: 35, rarity: 'Especial',
        desc: 'Chaqueta luminosa y auriculares de neón para frenar el ruido del colegio.',
        design: 'Eco de neón',
        fx: { color: '90,245,255', accent: '#ff4fd8', style: 'neon' },
        look: {
          shirt: '#17d9ff', shirt2: '#0b78b5', pants: '#1b1834',
          shoes: ['#f4fbff', '#f4fbff'], sock: '#ff4fd8', wrist: '#ff4fd8',
          bag: '#14152e', pattern: 'wave', hair: '#e7fbff', eye: '#11b6d8',
          accColor: '#ff4fd8', accColor2: '#e8fbff', shoeAccent: '#ff4fd8',
          aura: '#5ff3ff'
        }
      },
      {
        id: 'vinilo', name: 'Vinilo', cost: 75, rarity: 'Élite',
        desc: 'Coleccionista de discos: dorado, marrón y una onda que suena a viejo estudio.',
        design: 'Surco de vinilo',
        fx: { color: '255,207,107', accent: '#fff0b8', style: 'notes' },
        look: {
          shirt: '#f7c95c', shirt2: '#b0771d', pants: '#34281f',
          shoes: ['#7a4a22', '#7a4a22'], sock: '#f7c95c', wrist: '#f7c95c',
          bag: '#573a22', pattern: 'stripe', hair: '#2a1a10', eye: '#8a5a20',
          accColor: '#fff0b8', accColor2: '#6d4a2a', shoeAccent: '#fff0b8',
          aura: '#ffcf6b', scarf: '#fff0b8'
        }
      },
      {
        id: 'estelar', name: 'DJ Estelar', cost: 95, rarity: 'Legendario',
        desc: 'Cabina cósmica, visor de neón y una onda que parece venir de otra galaxia.',
        design: 'Órbita de neón',
        fx: { color: '125,249,255', accent: '#ff4fd8', style: 'cosmic' },
        look: {
          shirt: '#1b2a6b', shirt2: '#0b1238', pants: '#10162c',
          shoes: ['#e8fbff', '#e8fbff'], sock: '#7df9ff', wrist: '#ff4fd8',
          bag: '#101a38', pattern: 'wave', hair: '#cfe8ff', eye: '#7df9ff',
          acc: 'headphones', accColor: '#7df9ff', accColor2: '#ff4fd8',
          glasses: true, glassesStyle: 'visor', cuff: '#e8fbff',
          shoeAccent: '#ff4fd8', aura: '#7df9ff'
        }
      },
      {
        id: 'maestro', name: 'Maestro Celestial', cost: 150, rarity: 'Mítico',
        desc: 'Batuta dorada, corona de constelaciones y un pentagrama que ordena el caos.',
        design: 'Pentagrama estelar',
        fx: { color: '255,225,150', accent: '#c9b6ff', style: 'rune' },
        look: {
          shirt: '#f5f0ff', shirt2: '#c9b6ff', pants: '#2a2440',
          shoes: ['#f7d35a', '#f7d35a'], sock: '#c9b6ff', wrist: '#f7d35a',
          bag: '#2a2440', pattern: 'star', hair: '#f7f3ff', eye: '#7b5bd6',
          acc: 'baton', accColor: '#ffe08a', hat: 'crown', cape: '#f0e6ff',
          scarf: '#ffd166', cuff: '#fff4d6', shoeAccent: '#f7d35a',
          aura: '#c9b6ff'
        }
      }
    ],
    jonny: [
      {
        id: 'base', name: 'Clásico', cost: 0, rarity: 'Básico',
        desc: 'Gorra roja, cadena dorada y ganas de bailar hasta el final.',
        design: 'Ritmo dorado',
        fx: { color: '255,220,120', accent: '#ffe08a', style: 'notes' },
        look: {}
      },
      {
        id: 'cumbia', name: 'Cumbia', cost: 35, rarity: 'Especial',
        desc: 'Camisa de fiesta y gorra amarilla: el patio entero se vuelve pista de baile.',
        design: 'Fiesta de cumbia',
        fx: { color: '255,110,90', accent: '#ffcf3f', style: 'confetti' },
        look: {
          shirt: '#e63946', shirt2: '#9e1f32', pants: '#2c2138',
          shoes: ['#ffcf3f', '#ffcf3f'], sock: '#ffcf3f', wrist: '#ffcf3f',
          bag: '#5c1c2b', pattern: 'star', hair: '#1a1010', eye: '#c62b3e',
          accColor: '#ffcf3f', shoeAccent: '#ffcf3f', aura: '#ff8a5c'
        }
      },
      {
        id: 'disco', name: 'Disco', cost: 75, rarity: 'Élite',
        desc: 'Traje brillante, sombrero de copa y pasos que dejan destellos por todo el mapa.',
        design: 'Bola de disco',
        fx: { color: '215,182,255', accent: '#ff5fd2', style: 'spark' },
        look: {
          shirt: '#b388ff', shirt2: '#6c3fd1', pants: '#31254d',
          shoes: ['#f4f0ff', '#f4f0ff'], sock: '#ff5fd2', wrist: '#ff5fd2',
          bag: '#24183e', pattern: 'star', hair: '#1a1428', eye: '#7b4bff',
          acc: null, hat: 'top', accColor: '#f4f0ff', shoeAccent: '#ff5fd2',
          glasses: true, glassesStyle: 'shades', aura: '#d7b6ff'
        }
      },
      {
        id: 'carnaval', name: 'Rey del Carnaval', cost: 95, rarity: 'Legendario',
        desc: 'Penacho de colores, capa dorada y confeti que no deja de caer mientras baila.',
        design: 'Confeti real',
        fx: { color: '255,79,163', accent: '#ffd166', style: 'confetti' },
        look: {
          shirt: '#ff4fa3', shirt2: '#b01f6b', pants: '#1b2b4a',
          shoes: ['#ffd166', '#ffd166'], sock: '#ff4fa3', wrist: '#ffd166',
          bag: '#3a1030', pattern: 'star', hair: '#1a1010', eye: '#ff4fa3',
          hat: 'carnival', cape: '#ffd166', mask: '#ffd166',
          accColor: '#ffd166', shoeAccent: '#ff4fa3', aura: '#ff4fa3'
        }
      },
      {
        id: 'idolo', name: 'Ídolo Galáctico', cost: 150, rarity: 'Mítico',
        desc: 'Estrella del pop intergaláctico: antenas, gafas de sol y una firma de cometa.',
        design: 'Firma de cometa',
        fx: { color: '143,208,255', accent: '#ff5fd2', style: 'prism' },
        look: {
          shirt: '#2b3f8f', shirt2: '#14205a', pants: '#10162e',
          shoes: ['#f4f0ff', '#f4f0ff'], sock: '#ff5fd2', wrist: '#7df9ff',
          bag: '#101a38', pattern: 'star', hair: '#e7fbff', eye: '#ff5fd2',
          acc: 'shoes', accColor: '#7df9ff', glasses: true,
          glassesStyle: 'shades', hat: 'antenna', cape: '#7df9ff',
          shoeAccent: '#ff5fd2', aura: '#7df9ff'
        }
      }
    ],
    morante: [
      {
        id: 'base', name: 'Clásico', cost: 0, rarity: 'Básico',
        desc: 'Sudadera violeta con capucha y ojeras de no haber dormido nada.',
        design: 'Espectro violeta',
        fx: { color: '190,160,255', accent: '#c9b6ff', style: 'smoke' },
        look: {}
      },
      {
        id: 'espectro', name: 'Espectro', cost: 35, rarity: 'Especial',
        desc: 'Blanco fantasmal y una aureola fría: desaparece como una aparición.',
        design: 'Aparición helada',
        fx: { color: '168,255,244', accent: '#e6ffff', style: 'ice' },
        look: {
          shirt: '#e9fbff', shirt2: '#b6e8ef', pants: '#213a45',
          shoes: ['#dffbff', '#dffbff'], sock: '#b6e8ef', bag: '#1d3f47',
          hair: '#dffcff', eye: '#2fd9c6', cuff: '#f4ffff', aura: '#a8fff4',
          hat: 'halo', wings: '#dffcff', wingStyle: 'feather'
        }
      },
      {
        id: 'sombra', name: 'Sombra', cost: 75, rarity: 'Élite',
        desc: 'Negro absoluto y ojos rojos. Hasta los profesores dudan si sigue ahí.',
        design: 'Vacío rojo',
        fx: { color: '255,54,92', accent: '#ff365c', style: 'shadow' },
        look: {
          shirt: '#17131f', shirt2: '#0a0810', pants: '#0d0b12',
          shoes: ['#321018', '#321018'], sock: '#5f1424', bag: '#1c0b12',
          hair: '#08080d', eye: '#ff365c', cuff: '#3a1a24', aura: '#ff365c',
          brows: 'angry', smile: false, bags: true, strings: false,
          wings: '#2a1238', wingStyle: 'bat'
        }
      },
      {
        id: 'lunar', name: 'Espectro Lunar', cost: 95, rarity: 'Legendario',
        desc: 'Luz de luna, alas de niebla y pétalos que flotan cuando desaparece.',
        design: 'Marea lunar',
        fx: { color: '190,235,255', accent: '#7fd7ff', style: 'petal' },
        look: {
          shirt: '#dfeaff', shirt2: '#9bb8d9', pants: '#1b2638',
          shoes: ['#cfeaff', '#cfeaff'], sock: '#9bb8d9', bag: '#1b2638',
          hair: '#e8f6ff', eye: '#7fd7ff', cuff: '#f4ffff',
          hat: 'crescent', wings: '#bfe8ff', wingStyle: 'feather',
          aura: '#bfe8ff'
        }
      },
      {
        id: 'vacio', name: 'Señor del Vacío', cost: 150, rarity: 'Mítico',
        desc: 'Alas de sombra, ojos violeta y un fallo en la realidad que nadie quiere mirar.',
        design: 'Falla del vacío',
        fx: { color: '180,92,255', accent: '#ff365c', style: 'glitch' },
        look: {
          shirt: '#1a0f2e', shirt2: '#0a0614', pants: '#0b0814',
          shoes: ['#2a1238', '#2a1238'], sock: '#4b1f7a', bag: '#0b0814',
          hair: '#0b0814', eye: '#c77dff', cuff: '#3a1a5a',
          hat: 'hood', wings: '#4b1f7a', wingStyle: 'bat',
          brows: 'angry', smile: false, bags: true, strings: false,
          aura: '#b45cff'
        }
      }
    ],
    luis: [
      {
        id: 'base', name: 'Clásico', cost: 0, rarity: 'Básico',
        desc: 'Regla en el bolsillo, camisa verde y cara de delegado responsable.',
        design: 'Reglazo verde',
        fx: { color: '150,255,190', accent: '#7ee787', style: 'spark' },
        look: {}
      },
      {
        id: 'prefecto', name: 'Prefecto', cost: 35, rarity: 'Especial',
        desc: 'Uniforme azul marino con detalles dorados. La disciplina se lleva con estilo.',
        design: 'Sello dorado',
        fx: { color: '255,214,110', accent: '#f6d36b', style: 'gold' },
        look: {
          shirt: '#274690', shirt2: '#1a2f63', pants: '#141d33',
          shoes: ['#1a1a22', '#1a1a22'], sock: '#d9b85a', wrist: '#d9b85a',
          bag: '#1e2a45', pattern: 'pocket', rulerPocket: true, watch: '#e9c46a',
          cuff: '#edf3ff', hair: '#241a12', eye: '#5c7fdc', tie: '#d9b85a',
          accColor: '#f6d36b', aura: '#6f9cff'
        }
      },
      {
        id: 'samurai', name: 'Samurái', cost: 75, rarity: 'Élite',
        desc: 'Cinta roja, capa y una regla que ya no parece un utensilio escolar.',
        design: 'Tajo del samurái',
        fx: { color: '255,107,122', accent: '#ffd7dc', style: 'slash' },
        look: {
          shirt: '#f2f2f0', shirt2: '#b91f2e', pants: '#211b20',
          shoes: ['#f2f2f0', '#f2f2f0'], sock: '#b91f2e', wrist: '#b91f2e',
          bag: '#5a121a', pattern: 'stripe', hair: '#1a1214', eye: '#b91f2e',
          glasses: false, rulerPocket: false, accColor: '#f2f2f0',
          headband: '#b91f2e', cape: '#b91f2e', scarf: '#b91f2e',
          aura: '#ff6b7a'
        }
      },
      {
        id: 'guardian', name: 'Guardián del Orden', cost: 95, rarity: 'Legendario',
        desc: 'Casco de plata, capa azul y un sello de runas que pone orden en el recreo.',
        design: 'Sello de orden',
        fx: { color: '180,215,255', accent: '#7ee787', style: 'rune' },
        look: {
          shirt: '#dce8ff', shirt2: '#6f8fbf', pants: '#1d2a44',
          shoes: ['#f2f7ff', '#f2f7ff'], sock: '#7ee787', wrist: '#7ee787',
          bag: '#1d2a44', pattern: 'pocket', rulerPocket: true, watch: '#e9c46a',
          cuff: '#f4f9ff', hair: '#1a2233', eye: '#5c7fdc',
          hat: 'helm', cape: '#2f5fbf', scarf: '#7ee787',
          accColor: '#dce8ff', aura: '#7ee787'
        }
      },
      {
        id: 'emperador', name: 'Emperador de la Regla', cost: 150, rarity: 'Mítico',
        desc: 'Corona, capa dorada y un decreto imperial: la regla se respeta o se repite el curso.',
        design: 'Decreto imperial',
        fx: { color: '255,225,150', accent: '#fff4d6', style: 'prism' },
        look: {
          shirt: '#fff4d6', shirt2: '#d9b85a', pants: '#2a2233',
          shoes: ['#f7d35a', '#f7d35a'], sock: '#fff4d6', wrist: '#f7d35a',
          bag: '#2a2233', pattern: 'pocket', rulerPocket: true, watch: '#fff4d6',
          cuff: '#fffdf2', hair: '#2a1a12', eye: '#d9b85a', tie: '#d9b85a',
          hat: 'crown', cape: '#ffd166', scarf: '#fff4d6',
          accColor: '#fff4d6', aura: '#ffd166'
        }
      }
    ],
    ipa: [
      {
        id: 'base', name: 'Clásico', cost: 0, rarity: 'Básico',
        desc: 'Sudadera naranja con manchas de bocadillo y mucha hambre.',
        design: 'Bocadillo caliente',
        fx: { color: '255,190,120', accent: '#ffb27d', style: 'spark' },
        look: {}
      },
      {
        id: 'chef', name: 'Chef', cost: 35, rarity: 'Especial',
        desc: 'Gorro de cocinero y delantal impecable. Su bocadillo ahora es alta cocina.',
        design: 'Receta dorada',
        fx: { color: '255,225,150', accent: '#fff4cf', style: 'gold' },
        look: {
          shirt: '#f7f7f4', shirt2: '#d9d9d2', pants: '#2f2f35',
          shoes: ['#1e1e26', '#1e1e26'], sock: '#ffffff', wrist: '#ffffff',
          bag: '#5b3b2b', stain: false, crumbs: false, pattern: 'pocket',
          hair: '#2b1d12', eye: '#8a4f2b', hat: 'chef', apron: '#ffffff',
          accColor: '#ff5d5d', aura: '#ffe59a'
        }
      },
      {
        id: 'bbq', name: 'Parrillero', cost: 75, rarity: 'Élite',
        desc: 'Delantal de asado, pañuelo y un aura de brasas que da hasta miedo.',
        design: 'Brasas de parrilla',
        fx: { color: '255,120,64', accent: '#ffb35c', style: 'fire' },
        look: {
          shirt: '#7b3f24', shirt2: '#4d2417', pants: '#2b211c',
          shoes: ['#3a2418', '#3a2418'], sock: '#ff9a63', wrist: '#ff9a63',
          bag: '#4a2a1b', stain: true, crumbs: false, pattern: 'stripe',
          hair: '#1a120d', eye: '#ff9a63', hat: 'bandana', apron: '#5c3521',
          accColor: '#ffb35c', glasses: true, glassesStyle: 'shades',
          aura: '#ff7b45'
        }
      },
      {
        id: 'pastelera', name: 'Maestra Pastelera', cost: 95, rarity: 'Legendario',
        desc: 'Boina, delantal de azúcar y burbujas de fresa que endulzan hasta el peor examen.',
        design: 'Azúcar de fresa',
        fx: { color: '255,214,232', accent: '#ff8fb8', style: 'bubble' },
        look: {
          shirt: '#ffd6e8', shirt2: '#e89ab8', pants: '#3a2a35',
          shoes: ['#fff4f7', '#fff4f7'], sock: '#ff8fb8', wrist: '#ff8fb8',
          bag: '#5b3b2b', stain: false, crumbs: true, pattern: 'pocket',
          hair: '#33261a', eye: '#b9662b', hat: 'beret', apron: '#fff4f7',
          accColor: '#ff8fb8', cuff: '#fff4f7', aura: '#ffb8d0'
        }
      },
      {
        id: 'devorador', name: 'Devorador de Estrellas', cost: 150, rarity: 'Mítico',
        desc: 'Casco espacial, bufanda estelar y un hambre capaz de comerse una constelación.',
        design: 'Banquete cósmico',
        fx: { color: '255,179,92', accent: '#c77dff', style: 'cosmic' },
        look: {
          shirt: '#5b2a86', shirt2: '#31154a', pants: '#1a1026',
          shoes: ['#ffb35c', '#ffb35c'], sock: '#c77dff', wrist: '#ffb35c',
          bag: '#1a1026', stain: true, crumbs: true, pattern: 'star',
          hair: '#2a1a12', eye: '#ffb35c', hat: 'space', scarf: '#ffb35c',
          accColor: '#ffb35c', cuff: '#ffd6a8', aura: '#c77dff'
        }
      }
    ],
    elias: [
      {
        id: 'base', name: 'Clásico', cost: 0, rarity: 'Básico',
        desc: 'Zapatos cambiados, calcetines distintos y una suerte increíble.',
        design: 'Chispazo invertido',
        fx: { color: '110,240,224', accent: '#6ff0e0', style: 'bolt' },
        look: {}
      },
      {
        id: 'payaso', name: 'Payaso', cost: 35, rarity: 'Especial',
        desc: 'Nariz roja, colores chillones y un truco que lo vuelve inmune al daño.',
        design: 'Confeti cómico',
        fx: { color: '255,214,92', accent: '#ff5d8f', style: 'confetti' },
        look: {
          shirt: '#ffd85e', shirt2: '#d89d1f', pants: '#4b2b72',
          shoes: ['#ff5d5d', '#5d8bff'], sock: ['#ff5d5d', '#5d8bff'],
          wrist: '#ff5d8f', bag: '#6a2d55', pattern: 'star', hair: '#5b2a7a',
          eye: '#3d7a6f', clownNose: true, hat: 'clown',
          accColor: '#ff5d8f', shoeAccent: '#ffd85e', aura: '#ffd85e'
        }
      },
      {
        id: 'relampago', name: 'Relámpago', cost: 75, rarity: 'Élite',
        desc: 'Cinta amarilla y zapatillas eléctricas: lento por fuera, imparable por dentro.',
        design: 'Tormenta amarilla',
        fx: { color: '255,240,92', accent: '#8fd0ff', style: 'bolt' },
        look: {
          shirt: '#ffe95c', shirt2: '#d6b200', pants: '#17233d',
          shoes: ['#8fd0ff', '#8fd0ff'], sock: ['#ffe95c', '#8fd0ff'],
          wrist: '#8fd0ff', bag: '#1e355c', pattern: 'stripe', hair: '#22283a',
          eye: '#2a8f84', headband: '#ffe95c', cape: '#3b82f6',
          scarf: '#ffe95c', accColor: '#8fd0ff', shoeAccent: '#ffe95c',
          aura: '#ffe95c'
        }
      },
      {
        id: 'crononauta', name: 'Crononauta', cost: 95, rarity: 'Legendario',
        desc: 'Chaqueta de aviador, bufanda turquesa y un reloj que siempre marca la hora del recreo.',
        design: 'Segundo exacto',
        fx: { color: '255,190,120', accent: '#5fe3d1', style: 'rune' },
        look: {
          shirt: '#b87333', shirt2: '#7a4a22', pants: '#22303f',
          shoes: ['#5fe3d1', '#ffb35c'], sock: ['#5fe3d1', '#ffb35c'],
          wrist: '#5fe3d1', bag: '#3a2a1b', pattern: 'stripe', hair: '#241a2e',
          eye: '#2a8f84', hat: 'aviator', scarf: '#5fe3d1', freckles: true,
          accColor: '#5fe3d1', shoeAccent: '#5fe3d1', aura: '#5fe3d1'
        }
      },
      {
        id: 'gato', name: 'Gato de la Suerte', cost: 150, rarity: 'Mítico',
        desc: 'Orejas, cola y siete vidas de suerte: sus zapatos cambiados ahora destellan arcoíris.',
        design: 'Suerte de siete vidas',
        fx: { color: '255,209,102', accent: '#ff8fb8', style: 'prism' },
        look: {
          shirt: '#ffb347', shirt2: '#5fe3d1', pants: '#2b3348',
          shoes: ['#ff5d5d', '#4d8dff'], sock: ['#ff5d5d', '#4d8dff'],
          wrist: '#ff8fb8', bag: '#3a4a6a', pattern: 'star', hair: '#241a2e',
          eye: '#ffd166', hat: 'catears', tail: '#e9bd97', freckles: true,
          smile: true, accColor: '#ff8fb8', shoeAccent: '#5fe3d1',
          aura: '#ffd166'
        }
      }
    ]
  },
  teacher: {
    jose: [
      {
        id: 'base', name: 'Clásico', cost: 0, rarity: 'Básico',
        desc: 'Americana roja, agenda de cuero y cero paciencia.',
        design: 'Agendazo rojo',
        fx: { color: '255,150,155', accent: '#ff5d5d', style: 'spark' },
        look: {}
      },
      {
        id: 'director', name: 'Director', cost: 55, rarity: 'Especial',
        desc: 'Traje oscuro, banda dorada y la autoridad de quien firma los boletines.',
        design: 'Decreto dorado',
        fx: { color: '255,219,120', accent: '#d9b85a', style: 'gold' },
        look: {
          shirt: '#2b2d3a', shirt2: '#171923', pants: '#161821',
          shoes: ['#111118', '#111118'], tie: '#d9b85a', jacket: '#10121a',
          collar: '#f7f1df', pocketSquare: '#d9b85a', tieClip: '#ffe08a',
          watch: '#e9c46a', cuff: '#f7f1df', hair: '#22212a',
          accColor: '#d9b85a', sash: '#d9b85a', aura: '#ffd56a'
        }
      },
      {
        id: 'inspector', name: 'Inspector', cost: 110, rarity: 'Élite',
        desc: 'Gabinete azul, guantes blancos y un examen sorpresa que congela el aula.',
        design: 'Expediente glacial',
        fx: { color: '150,220,255', accent: '#d6f3ff', style: 'ice' },
        look: {
          shirt: '#3a6ea8', shirt2: '#24476e', pants: '#172538',
          shoes: ['#111820', '#111820'], tie: '#0e2a47', jacket: '#10233a',
          collar: '#f4fbff', pocketSquare: '#bfeaff', tieClip: '#cfefff',
          watch: '#b9dcf0', cuff: '#f4fbff', hair: '#20242b',
          accColor: '#bfeaff', hat: 'fedora', scarf: '#bfeaff',
          aura: '#96dcff'
        }
      },
      {
        id: 'rector', name: 'Rector Supremo', cost: 130, rarity: 'Legendario',
        desc: 'Birrete, capa académica y runas de autoridad: hasta el timbre pide permiso.',
        design: 'Cátedra eterna',
        fx: { color: '220,190,255', accent: '#ffd166', style: 'rune' },
        look: {
          shirt: '#3a1f5c', shirt2: '#241238', pants: '#1a1028',
          shoes: ['#151018', '#151018'], tie: '#ffd166', jacket: '#2a1542',
          collar: '#f7f1df', pocketSquare: '#ffd166', tieClip: '#ffe08a',
          watch: '#ffd166', cuff: '#f7f1df', hair: '#22212a',
          accColor: '#ffd166', hat: 'mortarboard', cape: '#3a1f5c',
          sash: '#ffd166', aura: '#c9a0ff'
        }
      },
      {
        id: 'cronos', name: 'Cronomaestro', cost: 200, rarity: 'Mítico',
        desc: 'Reloj de bolsillo, gabardina roja y un aula detenida un segundo antes del recreo.',
        design: 'Detención del tiempo',
        fx: { color: '255,120,120', accent: '#ffd166', style: 'glitch' },
        look: {
          shirt: '#2b1a1a', shirt2: '#160d0d', pants: '#120a0a',
          shoes: ['#0e0808', '#0e0808'], tie: '#ffd166', jacket: '#1a0e0e',
          collar: '#f7f1df', pocketSquare: '#ff5d5d', tieClip: '#ffd166',
          watch: '#ffd166', cuff: '#f7f1df', hair: '#22212a',
          accColor: '#ffd166', hat: 'top', cape: '#8b1e1e',
          scarf: '#ffd166', glasses: true, glassesStyle: 'shades',
          aura: '#ff5d5d'
        }
      }
    ],
    ovidio: [
      {
        id: 'base', name: 'Clásico', cost: 0, rarity: 'Básico',
        desc: 'Traje violeta, megáfono rojo y una voz que retumba en todo el colegio.',
        design: 'Grito magenta',
        fx: { color: '255,95,130', accent: '#ff9ab4', style: 'wave' },
        look: {}
      },
      {
        id: 'opera', name: 'Ópera', cost: 55, rarity: 'Especial',
        desc: 'Capa de escenario, sombrero de copa y un grito que parece salir de un teatro.',
        design: 'Aria de ópera',
        fx: { color: '210,160,255', accent: '#ffd56a', style: 'notes' },
        look: {
          shirt: '#3d1a52', shirt2: '#251033', pants: '#16101f',
          shoes: ['#0d0a12', '#0d0a12'], tie: '#d9b85a', jacket: '#1b0d27',
          collar: '#fbf5df', pocketSquare: '#ffd56a', tieClip: '#ffe08a',
          watch: '#d9b85a', cuff: '#fbf5df', hair: '#17101d',
          accColor: '#ffd56a', cape: '#5b1c74', hat: 'top', aura: '#d6a0ff'
        }
      },
      {
        id: 'locutor', name: 'Locutor', cost: 110, rarity: 'Élite',
        desc: 'Chaqueta de radio, megáfono cromado y un aura negra que corta el sonido.',
        design: 'Onda de radio',
        fx: { color: '255,80,70', accent: '#e8f3ff', style: 'neon' },
        look: {
          shirt: '#8f1d1d', shirt2: '#5c1010', pants: '#17141a',
          shoes: ['#0e0d10', '#0e0d10'], tie: '#111118', jacket: '#16151a',
          collar: '#f2f5fb', pocketSquare: '#ff5a4f', tieClip: '#c9d6e8',
          watch: '#c9d6e8', cuff: '#f2f5fb', hair: '#101014',
          accColor: '#dfe9f7', accColor2: '#8b1d1d', glasses: true,
          glassesStyle: 'shades', aura: '#ff5a4f'
        }
      },
      {
        id: 'divo', name: 'Divo del Teatro', cost: 130, rarity: 'Legendario',
        desc: 'Sombrero con pluma, antifaz dorado y una lluvia de pétalos cuando su voz sube.',
        design: 'Aplauso de terciopelo',
        fx: { color: '255,120,190', accent: '#ffd166', style: 'petal' },
        look: {
          shirt: '#6b1f8a', shirt2: '#3d1050', pants: '#1a0d24',
          shoes: ['#0d0a12', '#0d0a12'], tie: '#ffd166', jacket: '#2a0d3a',
          collar: '#fff4d6', pocketSquare: '#ffd166', tieClip: '#ffe08a',
          watch: '#ffd166', cuff: '#fff4d6', hair: '#17101d',
          accColor: '#ffd166', hat: 'plume', cape: '#8a1f5c',
          mask: '#ffd166', aura: '#ff8fb8'
        }
      },
      {
        id: 'abismo', name: 'Voz del Abismo', cost: 200, rarity: 'Mítico',
        desc: 'Capucha, alas de sombra y un eco rojo que sigue sonando cuando ya no hay nadie.',
        design: 'Eco sin fondo',
        fx: { color: '255,80,90', accent: '#b45cff', style: 'vortex' },
        look: {
          shirt: '#1a0d1f', shirt2: '#0d0612', pants: '#0b040e',
          shoes: ['#080308', '#080308'], tie: '#ff5a4f', jacket: '#120816',
          collar: '#d8c8e8', pocketSquare: '#ff5a4f', tieClip: '#b45cff',
          watch: '#ff5a4f', cuff: '#d8c8e8', hair: '#0b0610',
          accColor: '#ff5a4f', hat: 'hood', wings: '#5a0f2a',
          wingStyle: 'bat', mask: '#ff5a4f', cape: '#1a0d1f',
          aura: '#ff5a4f'
        }
      }
    ],
    segundo: [
      {
        id: 'base', name: 'Clásico', cost: 0, rarity: 'Básico',
        desc: 'Traje morado, peine regla de metal y canas que imponen respeto.',
        design: 'Peinazo metálico',
        fx: { color: '205,235,255', accent: '#d9c8ff', style: 'slash' },
        look: {}
      },
      {
        id: 'barbero', name: 'Barbero', cost: 55, rarity: 'Especial',
        desc: 'Delantal blanco, bigote perfecto y un peine que brilla como una navaja.',
        design: 'Filo de barbería',
        fx: { color: '255,225,160', accent: '#ffffff', style: 'gold' },
        look: {
          shirt: '#f4f4ef', shirt2: '#cfcfc6', pants: '#2a2630',
          shoes: ['#19171d', '#19171d'], tie: '#b91f2e', jacket: '#5a1e2b',
          collar: '#ffffff', pocketSquare: '#ffffff', tieClip: '#d9b85a',
          watch: '#d9b85a', cuff: '#ffffff', hair: '#d8d8d8', moustache: true,
          apron: '#f4f4ef', hat: 'bowler', accColor: '#ffffff', aura: '#ffe1a0'
        }
      },
      {
        id: 'verdugo', name: 'Verdugo', cost: 110, rarity: 'Élite',
        desc: 'Capa negra, mirada de recreo eterno y un castigo que no perdona.',
        design: 'Castigo sombrío',
        fx: { color: '139,241,166', accent: '#c6ffd5', style: 'shadow' },
        look: {
          shirt: '#1d2b22', shirt2: '#0f1813', pants: '#111711',
          shoes: ['#0a0d0a', '#0a0d0a'], tie: '#0b100c', jacket: '#0c120e',
          collar: '#d8e3d8', pocketSquare: '#8bf1a6', tieClip: '#7a9b7e',
          watch: '#8bf1a6', cuff: '#d8e3d8', hair: '#e5e9e3',
          accColor: '#c6ffd5', cape: '#0a0f0b', hat: 'hood',
          wings: '#0a0f0b', wingStyle: 'bat', aura: '#8bf1a6'
        }
      },
      {
        id: 'monarca', name: 'Monarca de la Barbería', cost: 130, rarity: 'Legendario',
        desc: 'Corona, capa carmesí y una barbería tan elegante que el castigo parece un honor.',
        design: 'Corona de navaja',
        fx: { color: '255,225,160', accent: '#ffffff', style: 'prism' },
        look: {
          shirt: '#f4f4ef', shirt2: '#cfcfc6', pants: '#2a2630',
          shoes: ['#19171d', '#19171d'], tie: '#b91f2e', jacket: '#5a1e2b',
          collar: '#ffffff', pocketSquare: '#ffd166', tieClip: '#d9b85a',
          watch: '#d9b85a', cuff: '#ffffff', hair: '#e5e9e3', moustache: true,
          apron: '#f4f4ef', hat: 'crown', cape: '#b91f2e',
          scarf: '#ffd166', accColor: '#ffd166', aura: '#ffe1a0'
        }
      },
      {
        id: 'segador', name: 'Segador de Recreo', cost: 200, rarity: 'Mítico',
        desc: 'Alas oscuras, guadaña de peine y fuegos fatuos que anuncian el último recreo.',
        design: 'Último recreo',
        fx: { color: '139,241,166', accent: '#c6ffd5', style: 'wisp' },
        look: {
          shirt: '#0f1813', shirt2: '#070c08', pants: '#0a0f0b',
          shoes: ['#060806', '#060806'], tie: '#0b100c', jacket: '#0a0f0b',
          collar: '#d8e3d8', pocketSquare: '#8bf1a6', tieClip: '#7a9b7e',
          watch: '#8bf1a6', cuff: '#d8e3d8', hair: '#e5e9e3', moustache: true,
          accColor: '#c6ffd5', hat: 'hood', wings: '#0a0f0b',
          wingStyle: 'bat', cape: '#0a0f0b', aura: '#8bf1a6'
        }
      }
    ]
  }
};

/* ----------------------------------------------------------------------------
   Trajes extra: seis diseños nuevos por personaje (más de cinco), con nuevas
   animaciones de cuerpo y efectos. Los precios suben para que el catálogo
   siga siendo una meta a largo plazo.
   ---------------------------------------------------------------------------- */
const EXTRA_SKIN_PRICES = {
  student: { 'Especial': 80, 'Élite': 160, 'Legendario': 260, 'Mítico': 420 },
  teacher: { 'Especial': 120, 'Élite': 220, 'Legendario': 340, 'Mítico': 560 }
};

const EXTRA_SKIN_PALETTES = {
  leonardo: { main: '#4f9bff', alt: '#3b7ad4', deep: '#1b2a4a', accent: '#7df9ff', hair: '#252533', eye: '#2f6fd0', glow: '#5aa9ff' },
  jonny:    { main: '#ffd166', alt: '#e0ad3f', deep: '#2f3550', accent: '#ff8f5d', hair: '#2b1a0f', eye: '#6b3d1d', glow: '#ffd166' },
  morante:  { main: '#a97df7', alt: '#8459cf', deep: '#23232f', accent: '#c77dff', hair: '#1d1d27', eye: '#7b5bd6', glow: '#b48cff' },
  luis:     { main: '#6fdc79', alt: '#4fae5c', deep: '#2d3a2f', accent: '#ffd166', hair: '#3d2716', eye: '#2f7a3d', glow: '#7ee787' },
  ipa:      { main: '#ff9a63', alt: '#e07a45', deep: '#3a3040', accent: '#ffe08a', hair: '#33261a', eye: '#b9662b', glow: '#ff9f6e' },
  elias:    { main: '#54dcc9', alt: '#37b3a3', deep: '#2b3348', accent: '#ff5d5d', hair: '#241a2e', eye: '#2a8f84', glow: '#5fe3d1' },
  jose:     { main: '#ff5d5d', alt: '#d13b3b', deep: '#232c40', accent: '#ffd166', hair: '#3a3a44', eye: '#2a2a35', glow: '#ff5d5d' },
  ovidio:   { main: '#4a2b52', alt: '#35203f', deep: '#211b2c', accent: '#f2cf74', hair: '#181621', eye: '#2a1d35', glow: '#e35d8a' },
  segundo:  { main: '#8f5bd6', alt: '#6f3fb0', deep: '#242a3e', accent: '#dec7ff', hair: '#3a3440', eye: '#2a2430', glow: '#c77dff' }
};

const EXTRA_SKIN_THEMES = [
  {
    id: 'tropical', name: 'Tropical', teacherName: 'Tropical', rarity: 'Especial',
    design: 'Palmera y sol', anim: 'sway',
    desc: 'Traje fresco con hojas, sol y una animación de balanceo',
    fx: { style: 'leaf', color: '120,240,180', accent: '#8ef0b0' },
    look: p => ({
      shirt: p.main, shirt2: p.alt, pants: p.deep,
      shoes: [p.accent, p.accent], sock: p.accent, wrist: p.accent,
      hair: p.hair, eye: p.eye, pattern: 'wave', hat: 'beret',
      accColor: p.accent, aura: p.glow
    })
  },
  {
    id: 'goleador', name: 'Goleador', teacherName: 'Director Deportivo', rarity: 'Especial',
    design: 'Jersey y medalla', anim: 'bounce',
    desc: 'Jersey deportivo con medalla y una animación de rebote',
    fx: { style: 'confetti', color: '255,214,92', accent: '#ff8f5d' },
    look: p => ({
      shirt: p.alt, shirt2: p.main, pants: '#1e2433',
      shoes: ['#ffffff', '#ffffff'], sock: p.accent, wrist: p.accent,
      hair: p.hair, eye: p.eye, pattern: 'stripe', headband: p.accent,
      accColor: p.accent, shorts: true, build: 'athletic', chain: true,
      aura: p.glow
    })
  },
  {
    id: 'cientifico', name: 'Científico', teacherName: 'Catedrático Cuántico', rarity: 'Élite',
    design: 'Bata y átomo', anim: 'float',
    desc: 'Bata luminosa, visor y una animación de flotación',
    fx: { style: 'aurora', color: '150,220,255', accent: '#9ff0e2' },
    look: p => ({
      shirt: '#f4f7ff', shirt2: '#dbe6ff', pants: '#26324a',
      shoes: ['#ffffff', '#ffffff'], sock: '#cfe0ff', wrist: p.main,
      hair: p.hair, eye: p.eye, glasses: true, glassesStyle: 'visor',
      accColor: p.main, accColor2: p.accent, cuff: '#ffffff',
      collar: '#ffffff', pattern: 'pocket', hat: 'antenna', aura: p.glow
    })
  },
  {
    id: 'faraon', name: 'Faraón', teacherName: 'Faraón del Colegio', rarity: 'Élite',
    design: 'Oro y vendas', anim: 'shimmer',
    desc: 'Oro, vendas y una animación de brillo',
    fx: { style: 'portal', color: '255,209,102', accent: '#ffe8a3' },
    look: p => ({
      shirt: p.main, shirt2: p.alt, pants: p.deep,
      shoes: [p.accent, p.accent], sock: p.accent, wrist: p.accent,
      hair: p.hair, eye: p.eye, pattern: 'star', hat: 'crown',
      collar: '#ffd166', cape: p.alt, tie: '#ffd166',
      pocketSquare: '#ffd166', tieClip: '#ffd166', watch: '#ffd166',
      cuff: '#ffe8a3', accColor: '#ffd166', aura: p.glow
    })
  },
  {
    id: 'dragon', name: 'Dragón', teacherName: 'Dragón del Recreo', rarity: 'Legendario',
    design: 'Escamas y alas', anim: 'pulse',
    desc: 'Escamas, alas y una animación de pulso',
    fx: { style: 'fire', color: '255,120,80', accent: '#ffd166' },
    look: p => ({
      shirt: p.main, shirt2: p.alt, pants: p.deep,
      shoes: [p.deep, p.deep], sock: p.alt, wrist: p.accent,
      hair: p.hair, eye: p.eye, pattern: 'stripe',
      wings: p.alt, wingStyle: 'bat', tail: p.alt, scarf: p.accent,
      cape: p.deep, accColor: p.accent, aura: p.glow
    })
  },
  {
    id: 'galactico', name: 'Galáctico', teacherName: 'Deidad Cósmica', rarity: 'Mítico',
    design: 'Órbita y estrellas', anim: 'orbit',
    desc: 'Órbita estelar, visor y una animación de partículas',
    fx: { style: 'starfall', color: '170,150,255', accent: '#ff8fd8' },
    look: p => ({
      shirt: p.main, shirt2: p.alt, pants: '#0b1026',
      shoes: [p.accent, p.accent], sock: p.accent, wrist: p.accent,
      hair: p.hair, eye: p.eye, pattern: 'star', hat: 'space',
      glasses: true, glassesStyle: 'visor', accColor: p.main,
      accColor2: p.accent, cape: p.deep, wings: p.accent,
      wingStyle: 'feather', aura: p.glow
    })
  }
];

for (const kind of ['student', 'teacher']) {
  for (const charId in SKINS[kind]) {
    const p = EXTRA_SKIN_PALETTES[charId];
    if (!p) continue;
    const charName = kind === 'student' ? STUDENTS[charId].name : TEACHERS[charId].name;
    for (const th of EXTRA_SKIN_THEMES) {
      SKINS[kind][charId].push({
        id: th.id,
        name: kind === 'teacher' ? (th.teacherName || th.name) : th.name,
        cost: EXTRA_SKIN_PRICES[kind][th.rarity] || 0,
        rarity: th.rarity,
        desc: th.desc + ' de ' + charName + '.',
        design: th.design,
        fx: Object.assign({}, th.fx),
        anim: th.anim,
        look: th.look(p)
      });
    }
  }
}

/* Los trajes ahora cuestan bastante más: el catálogo es una meta de largo plazo. */
for (const kind of ['student', 'teacher']) {
  for (const charId in SKINS[kind]) {
    for (const skin of SKINS[kind][charId]) {
      if (skin.cost > 0 && EXTRA_SKIN_PRICES[kind][skin.rarity]) {
        skin.cost = EXTRA_SKIN_PRICES[kind][skin.rarity];
      }
    }
  }
}

const SKIN_BY_ID = Object.create(null);
for (const kind of ['student', 'teacher']) {
  for (const charId in SKINS[kind]) {
    for (const skin of SKINS[kind][charId]) {
      skin.key = kind + ':' + charId + ':' + skin.id;
      SKIN_BY_ID[skin.key] = skin;
    }
  }
}

function skinsFor(kind, charId) {
  return (SKINS[kind] && SKINS[kind][charId]) || [];
}

function skinById(kind, charId, skinId) {
  return SKIN_BY_ID[kind + ':' + charId + ':' + skinId] ||
    (SKINS[kind] && SKINS[kind][charId] && SKINS[kind][charId][0]) || null;
}

function baseSkin(kind, charId) {
  const list = skinsFor(kind, charId);
  return list.find(s => s.cost === 0) || list[0] || null;
}

function skinLook(baseLook, skin) {
  const look = Object.assign({}, baseLook || {}, (skin && skin.look) || {});
  if (skin && skin.anim) look.anim = skin.anim;
  return look;
}

/* ============================================================================
   MAPA DEL COLEGIO (96 x 66 tiles)
   grid: 0 = libre, 1 = muro, 2 = pupitre/mesa, 3 = mobiliario (estanteria, silla...)
   ============================================================================ */
const ROOMS = [
  { x:  3, y:  3, w: 13, h: 10, name: 'Aula 4A',            kind: 'aula',     code: '4A',   floor: '#27354f', floor2: '#2d3d59', doors: ['S', 'E'] },
  { x: 19, y:  3, w: 13, h: 10, name: 'Aula 4B',            kind: 'aula',     code: '4B',   floor: '#27354f', floor2: '#2d3d59', doors: ['S'] },
  { x: 35, y:  3, w: 13, h: 10, name: 'Aula 4C',            kind: 'aula',     code: '4C',   floor: '#27354f', floor2: '#2d3d59', doors: ['S', 'W'] },
  { x: 51, y:  3, w: 13, h: 10, name: 'Aula 4D',            kind: 'aula',     code: '4D',   floor: '#27354f', floor2: '#2d3d59', doors: ['S', 'E'] },
  { x: 67, y:  3, w: 17, h: 10, name: 'Sala de Informatica',kind: 'pc',       code: 'INFO', floor: '#263a3f', floor2: '#2c4449', doors: ['S', 'W'] },
  { x:  3, y: 18, w: 14, h: 13, name: 'Laboratorio',        kind: 'lab',      code: 'LAB',  floor: '#22424a', floor2: '#274a53', doors: ['E'] },
  { x: 21, y: 18, w: 14, h: 13, name: 'Biblioteca',         kind: 'lib',      code: 'BIB',  floor: '#3b3458', floor2: '#423b62', doors: ['E', 'W'] },
  { x: 39, y: 18, w: 13, h: 13, name: 'Sala de Profesores', kind: 'staff',    code: 'PROF', floor: '#4a3340', floor2: '#533a49', doors: ['W', 'S', 'E'] },
  { x: 56, y: 18, w: 22, h: 13, name: 'Gimnasio',           kind: 'gym',      code: 'GYM',  floor: '#3d3b2c', floor2: '#464330', doors: ['W', 'S'] },
  { x: 81, y: 18, w: 12, h: 13, name: 'Aula de Musica',     kind: 'music',    code: 'MUS',  floor: '#3c3050', floor2: '#453757', doors: ['W', 'S'] },
  { x:  3, y: 35, w: 15, h: 13, name: 'Cafeteria',          kind: 'cafe',     code: 'CAF',  floor: '#44352c', floor2: '#4d3c32', doors: ['E', 'N'] },
  { x: 21, y: 35, w: 14, h: 13, name: 'Taller de Tecnologia',kind: 'workshop',code: 'TALL', floor: '#3d3730', floor2: '#463f37', doors: ['E', 'N'] },
  { x: 38, y: 35, w: 12, h: 13, name: 'Almacen',            kind: 'store',    code: 'ALM',  floor: '#3a3a41', floor2: '#44444c', doors: ['N', 'E'] },
  { x: 53, y: 35, w: 18, h: 13, name: 'Salon de Actos',     kind: 'theater',  code: 'ACT',  floor: '#432f4a', floor2: '#4c3654', doors: ['N', 'W', 'S'] },
  { x: 74, y: 35, w: 19, h: 13, name: 'Pabellon',           kind: 'pavilion', code: 'PAB',  floor: '#38374a', floor2: '#413f55', doors: ['N', 'W'] }
];

/* Carteles de asignatura que dan identidad a cada aula. */
const SUBJECT_CHARTS = {
  '4A': { text: 'π',    sub: 'MATEMÁTICAS', color: '#ffd166', icon: 'math' },
  '4B': { text: 'H₂O',  sub: 'CIENCIAS',    color: '#5fe3d1', icon: 'science' },
  '4C': { text: 'ABC',  sub: 'LENGUA',      color: '#8fd0ff', icon: 'language' },
  '4D': { text: '1492', sub: 'HISTORIA',    color: '#c77dff', icon: 'history' }
};

const CORRIDOR_FLOOR  = '#171f31';
const CORRIDOR_FLOOR2 = '#1b2438';
const PATIO_FLOOR     = '#2b3a33';
const PATIO_FLOOR2    = '#31413a';

const LAMPS = [
  { x:  8 * T, y: 15 * T }, { x: 26 * T, y: 15 * T }, { x: 42 * T, y: 15 * T },
  { x: 58 * T, y: 15 * T }, { x: 74 * T, y: 15 * T }, { x: 90 * T, y: 15 * T },
  { x:  8 * T, y: 32.5 * T }, { x: 26 * T, y: 32.5 * T }, { x: 42 * T, y: 32.5 * T },
  { x: 58 * T, y: 32.5 * T }, { x: 74 * T, y: 32.5 * T }, { x: 90 * T, y: 32.5 * T },
  { x: 16 * T, y: 51 * T }, { x: 34 * T, y: 51 * T }, { x: 52 * T, y: 51 * T },
  { x: 70 * T, y: 51 * T }, { x: 88 * T, y: 51 * T },
  { x: 30 * T, y: 61 * T }, { x: 62 * T, y: 61 * T }
];

/* ============================================================================
   MISIONES DE CLASE (8 de preguntas + 6 tareas de limpieza)
   - 4 misiones de tiempo: cada acierto recorta 20 segundos del reloj.
   - 4 misiones de refuerzo: dan puntos de examen sin tocar el reloj.
   - 6 tareas: recoge 5 objetos por la sala antes de que acabe el tiempo.
   ============================================================================ */
const MISSION_BONUS = 20;              // segundos que resta cada acierto de tiempo

const MISSIONS = [
  {
    id: 'mate', subject: 'Matemáticas', short: 'M', roomIdx: 0, color: '#ffd166', timeBonus: MISSION_BONUS,
    questions: [
      { q: '¿Cuánto es el 15 % de 200?', opts: ['20', '30', '40', '15'], a: 1, why: '200 × 0,15 = 30.' },
      { q: 'Si 3x + 6 = 21, ¿cuánto vale x?', opts: ['3', '5', '7', '9'], a: 1, why: '3x = 21 − 6 = 15, así que x = 5.' },
      { q: '¿Cuál es el área de un rectángulo de 8 cm por 5 cm?', opts: ['13 cm²', '26 cm²', '40 cm²', '80 cm²'], a: 2, why: 'Área = base × altura = 8 × 5 = 40 cm².' },
      { q: '¿Cuánto suman los tres ángulos de un triángulo?', opts: ['90°', '180°', '270°', '360°'], a: 1, why: 'Los ángulos de cualquier triángulo suman 180°.' },
      { q: '¿Cuánto vale 2 elevado a 5 (2⁵)?', opts: ['10', '16', '25', '32'], a: 3, why: '2 × 2 × 2 × 2 × 2 = 32.' }
    ]
  },
  {
    id: 'cien', subject: 'Ciencias', short: 'C', roomIdx: 1, color: '#5fe3d1', timeBonus: MISSION_BONUS,
    questions: [
      { q: '¿Qué gas necesitamos respirar para vivir?', opts: ['Nitrógeno', 'Oxígeno', 'Dióxido de carbono', 'Helio'], a: 1, why: 'Nuestras células necesitan oxígeno para obtener energía.' },
      { q: '¿Cuál es el planeta más cercano al Sol?', opts: ['Venus', 'Mercurio', 'La Tierra', 'Marte'], a: 1, why: 'Mercurio es el primero desde el Sol.' },
      { q: '¿Qué órgano bombea la sangre por todo el cuerpo?', opts: ['Los pulmones', 'El hígado', 'El corazón', 'El riñón'], a: 2, why: 'El corazón late y empuja la sangre por las arterias.' },
      { q: '¿A qué temperatura hierve el agua a nivel del mar?', opts: ['0 °C', '50 °C', '100 °C', '200 °C'], a: 2, why: 'A nivel del mar el agua hierve a 100 °C.' },
      { q: '¿Cómo se llama el proceso con el que las plantas fabrican su alimento?', opts: ['Fotosíntesis', 'Digestión', 'Respiración', 'Evaporación'], a: 0, why: 'Con luz, agua y dióxido de carbono hacen la fotosíntesis.' }
    ]
  },
  {
    id: 'leng', subject: 'Lengua', short: 'L', roomIdx: 2, color: '#8fd0ff', timeBonus: MISSION_BONUS,
    questions: [
      { q: '¿Cuál de estas palabras es un sustantivo?', opts: ['Correr', 'Mesa', 'Rápido', 'Azul'], a: 1, why: 'Mesa nombra un objeto: es un sustantivo.' },
      { q: '¿Qué signo se escribe al final de una pregunta?', opts: ['El punto .', 'La coma ,', 'El signo ?', 'El punto y coma ;'], a: 2, why: 'Las preguntas van entre signos de interrogación: ¿...?' },
      { q: '¿Cuál es el antónimo de valiente?', opts: ['Fuerte', 'Decidido', 'Cobarde', 'Osado'], a: 2, why: 'Cobarde significa lo contrario de valiente.' },
      { q: '¿Cuántas sílabas tiene la palabra mariposa?', opts: ['Dos', 'Tres', 'Cuatro', 'Cinco'], a: 2, why: 'Ma-ri-po-sa: cuatro sílabas.' },
      { q: '¿Qué oración está escrita correctamente?', opts: ['ayer fui al parque con mis amigos.', 'Ayer fui al parque con mis amigos.', 'Ayer Fui Al Parque Con Mis Amigos.', 'Ayer fui al parque con mis amigo.'], a: 1, why: 'Empieza con mayúscula y termina con punto.' }
    ]
  },
  {
    id: 'hist', subject: 'Historia', short: 'H', roomIdx: 3, color: '#c77dff', timeBonus: MISSION_BONUS,
    questions: [
      { q: '¿En qué año llegó Cristóbal Colón a América?', opts: ['1453', '1492', '1512', '1521'], a: 1, why: 'Llegó el 12 de octubre de 1492.' },
      { q: '¿Qué civilización construyó las pirámides de Giza?', opts: ['La romana', 'La griega', 'La egipcia', 'La maya'], a: 2, why: 'Las pirámides de Giza son monumentos del antiguo Egipto.' },
      { q: '¿Quién fue el primer emperador de Roma?', opts: ['Julio César', 'Augusto', 'Nerón', 'Trajano'], a: 1, why: 'Augusto fue el primer emperador romano.' },
      { q: '¿Qué gran muralla se construyó para proteger la antigua China?', opts: ['La muralla de Adriano', 'La muralla de Berlín', 'La Gran Muralla', 'La muralla de Babilonia'], a: 2, why: 'La Gran Muralla china se construyó para frenar las invasiones del norte.' },
      { q: '¿En qué siglo comenzó la Revolución Industrial?', opts: ['Siglo XVI', 'Siglo XVII', 'Siglo XVIII', 'Siglo XIX'], a: 2, why: 'Comenzó en la segunda mitad del siglo XVIII, en Inglaterra.' }
    ]
  },
  {
    id: 'info', subject: 'Informática', short: 'I', roomIdx: 4, color: '#7ee787', timeBonus: 0,
    questions: [
      { q: '¿Qué dispositivo se usa principalmente para escribir en un ordenador?', opts: ['El ratón', 'El teclado', 'El monitor', 'El altavoz'], a: 1, why: 'El teclado sirve para introducir texto y comandos.' },
      { q: '¿Qué significan las siglas WWW?', opts: ['World Wide Web', 'Web World Wide', 'Wide Web World', 'World Web Wide'], a: 0, why: 'WWW significa World Wide Web, la red mundial.' },
      { q: '¿Qué unidad se usa para medir el almacenamiento de un archivo?', opts: ['El píxel', 'El byte', 'El hercio', 'El vatio'], a: 1, why: 'El byte es una unidad de información digital.' },
      { q: '¿Qué lenguaje se usa para dar estilo a una página web?', opts: ['HTML', 'CSS', 'Python', 'SQL'], a: 1, why: 'CSS define colores, tamaños y estilos visuales.' },
      { q: '¿Qué combinación de teclas se usa normalmente para copiar?', opts: ['Ctrl + V', 'Ctrl + C', 'Ctrl + Z', 'Ctrl + P'], a: 1, why: 'Ctrl + C copia; Ctrl + V pega.' }
    ]
  },
  {
    id: 'quim', subject: 'Química', short: 'Q', roomIdx: 5, color: '#5fe3d1', timeBonus: 0,
    questions: [
      { q: '¿Cuál es la fórmula química del agua?', opts: ['CO₂', 'H₂O', 'O₂', 'NaCl'], a: 1, why: 'El agua tiene dos átomos de hidrógeno y uno de oxígeno.' },
      { q: '¿Qué gas absorben las plantas para hacer la fotosíntesis?', opts: ['Oxígeno', 'Nitrógeno', 'Dióxido de carbono', 'Helio'], a: 2, why: 'Las plantas toman dióxido de carbono y liberan oxígeno.' },
      { q: '¿Qué indica el pH de una disolución?', opts: ['Su temperatura', 'Su acidez o basicidad', 'Su masa', 'Su volumen'], a: 1, why: 'El pH mide si una disolución es ácida, neutra o básica.' },
      { q: '¿Cuál es el símbolo químico del oro?', opts: ['Ag', 'Au', 'Fe', 'Cu'], a: 1, why: 'Au viene del latín aurum, oro.' },
      { q: '¿Qué partícula del átomo tiene carga negativa?', opts: ['El protón', 'El neutrón', 'El electrón', 'El núcleo'], a: 2, why: 'Los electrones tienen carga negativa.' }
    ]
  },
  {
    id: 'lite', subject: 'Literatura', short: 'B', roomIdx: 6, color: '#c77dff', timeBonus: 0,
    questions: [
      { q: '¿Quién escribió Don Quijote de la Mancha?', opts: ['Federico García Lorca', 'Miguel de Cervantes', 'Gabriel García Márquez', 'Antonio Machado'], a: 1, why: 'Miguel de Cervantes publicó la primera parte en 1605.' },
      { q: '¿Qué es una rima consonante?', opts: ['Solo coinciden las vocales', 'Coinciden vocales y consonantes', 'No coincide ningún sonido', 'Solo coinciden las primeras letras'], a: 1, why: 'En la rima consonante coinciden todos los sonidos desde la última vocal tónica.' },
      { q: '¿A qué género pertenece una obra escrita para ser representada?', opts: ['Lírico', 'Épico', 'Dramático', 'Didáctico'], a: 2, why: 'El género dramático está pensado para el teatro.' },
      { q: '¿Qué figura literaria compara dos cosas usando «como»?', opts: ['Metáfora', 'Símil', 'Hipérbole', 'Personificación'], a: 1, why: 'El símil o comparación usa nexos como «como».' },
      { q: '¿Quién escribió La casa de Bernarda Alba?', opts: ['Rosalía de Castro', 'Federico García Lorca', 'Gloria Fuertes', 'Miguel Hernández'], a: 1, why: 'Federico García Lorca escribió esta obra de teatro en 1936.' }
    ]
  },
  {
    id: 'musi', subject: 'Música', short: '♪', roomIdx: 9, color: '#ff8fb8', timeBonus: 0,
    questions: [
      { q: '¿Cuántas notas tiene la escala musical básica?', opts: ['5', '6', '7', '8'], a: 2, why: 'Do, re, mi, fa, sol, la, si: siete notas.' },
      { q: '¿Qué instrumento tiene teclas blancas y negras?', opts: ['La guitarra', 'El piano', 'La flauta', 'El violín'], a: 1, why: 'El piano tiene un teclado con teclas blancas y negras.' },
      { q: '¿Qué indica el compás en una partitura?', opts: ['La altura de las notas', 'La organización de los tiempos', 'El nombre del compositor', 'El volumen'], a: 1, why: 'El compás organiza los pulsos y tiempos de la obra.' },
      { q: '¿Quién compuso la Quinta Sinfonía?', opts: ['Mozart', 'Beethoven', 'Bach', 'Vivaldi'], a: 1, why: 'Ludwig van Beethoven compuso la Quinta Sinfonía.' },
      { q: '¿A qué familia pertenece el violín?', opts: ['Viento', 'Percusión', 'Cuerda', 'Electrónica'], a: 2, why: 'El violín es un instrumento de cuerda frotada.' }
    ]
  },
  {
    // Tareas de limpieza: se recogen objetos por la sala y se paga al terminar.
    id: 'clean4a', type: 'task', taskKind: 'trash', subject: 'Limpieza del aula',
    short: 'LZ', roomIdx: 0, spot: 1, color: '#ffb347', timeBonus: 0, goal: 5,
    rewardPer: 2, rewardComplete: 10, rewardFast: 10, fastTime: 25, taskTime: 50,
    questions: []
  },
  {
    id: 'cleangym', type: 'task', taskKind: 'balls', subject: 'Gimnasio limpio',
    short: 'GY', roomIdx: 8, color: '#8bf1a6', timeBonus: 0, goal: 5,
    rewardPer: 2, rewardComplete: 10, rewardFast: 10, fastTime: 25, taskTime: 50,
    questions: []
  },
  {
    id: 'cleancafe', type: 'task', taskKind: 'trays', subject: 'Cafetería limpia',
    short: 'CF', roomIdx: 10, color: '#ff8fb8', timeBonus: 0, goal: 5,
    rewardPer: 2, rewardComplete: 10, rewardFast: 10, fastTime: 25, taskTime: 50,
    questions: []
  },
  {
    id: 'cleanworkshop', type: 'task', taskKind: 'tools', subject: 'Taller ordenado',
    short: 'TL', roomIdx: 11, color: '#ffd166', timeBonus: 0, goal: 5,
    rewardPer: 2, rewardComplete: 10, rewardFast: 10, fastTime: 25, taskTime: 50,
    questions: []
  },
  {
    id: 'cleanlab', type: 'task', taskKind: 'stains', subject: 'Laboratorio limpio',
    short: 'LB', roomIdx: 5, spot: 1, color: '#8fd0ff', timeBonus: 0, goal: 5,
    rewardPer: 2, rewardComplete: 10, rewardFast: 10, fastTime: 25, taskTime: 50,
    questions: []
  },
  {
    id: 'cleanlib', type: 'task', taskKind: 'books', subject: 'Biblioteca ordenada',
    short: 'BB', roomIdx: 6, spot: 1, color: '#c9b6ff', timeBonus: 0, goal: 5,
    rewardPer: 2, rewardComplete: 10, rewardFast: 10, fastTime: 25, taskTime: 50,
    questions: []
  }
];

/* ============================================================================
   COMIDA PERUANA ESPARCIDA POR EL MAPA
   - Cura vida, da velocidad temporal o ambas cosas.
   - Las IA estudiantes también pueden recogerla.
   ============================================================================ */
const FOOD_TYPES = [
  { id: 'inca', name: 'Inca Kola', short: 'INCA', color: '#ffd166', accent: '#ff5d5d', heal: 0, speedT: 7, speedMul: 1.35, weight: 20, desc: '+35 % de velocidad durante 7 s' },
  { id: 'pan', name: 'Pan con jamón', short: 'PAN', color: '#f4c27a', accent: '#ff8f6b', heal: 32, speedT: 0, speedMul: 1, weight: 20, desc: 'Cura 32 de vida' },
  { id: 'arroz', name: 'Arroz con leche', short: 'ARROZ', color: '#f4e7c3', accent: '#c9a96a', heal: 22, speedT: 5, speedMul: 1.15, weight: 18, desc: 'Cura 22 y +15 % de velocidad durante 5 s' },
  { id: 'chicha', name: 'Chicha morada', short: 'CHICHA', color: '#a86bd6', accent: '#e0b3ff', heal: 12, speedT: 6, speedMul: 1.25, weight: 14, desc: 'Cura 12 y +25 % de velocidad durante 6 s' },
  { id: 'empanada', name: 'Empanada', short: 'EMP', color: '#ffb347', accent: '#c97a1f', heal: 40, speedT: 0, speedMul: 1, weight: 14, desc: 'Cura 40 de vida' },
  { id: 'lucuma', name: 'Lúcuma', short: 'LUC', color: '#ffcf5c', accent: '#8a6a1f', heal: 15, speedT: 4, speedMul: 1.2, weight: 14, desc: 'Cura 15 y +20 % de velocidad durante 4 s' }
];
const FOOD_TARGET = 14;

let grid = [];          // solidez
let zoneKind = [];      // tipo de sala de cada tile (para dibujar muebles y muros)
let floorCol = [];      // color del suelo por tile
let doorTiles = [];     // tiles de puerta
let decor = [];         // decoracion (solo visual), en tiles

function isSolidTile(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return true;
  return grid[ty][tx] !== 0;
}

function carveDoor(room, side) {
  const midX = room.x + Math.floor(room.w / 2);
  const midY = room.y + Math.floor(room.h / 2);
  const put = (x, y) => {
    if (x < 1 || y < 1 || x > COLS - 2 || y > ROWS - 2) return;
    grid[y][x] = 0;
    floorCol[y][x] = room.floor;
    doorTiles.push({ x, y });
  };
  if (side === 'N') { put(midX - 1, room.y); put(midX, room.y); }
  if (side === 'S') { put(midX - 1, room.y + room.h - 1); put(midX, room.y + room.h - 1); }
  if (side === 'W') { put(room.x, midY - 1); put(room.x, midY); }
  if (side === 'E') { put(room.x + room.w - 1, midY - 1); put(room.x + room.w - 1, midY); }
}

/* fila de mobiliario con huecos para poder pasar */
function rowOfSeats(y, x0, x1, every) {
  for (let x = x0; x <= x1; x++) {
    if ((x - x0) % every === 0) continue;
    if (grid[y][x] === 0) grid[y][x] = 3;
  }
}

function fillFurniture(room) {
  const r = room;
  switch (r.kind) {
    case 'aula':
    case 'cafe':
    case 'lab':
      for (let y = r.y + 2; y <= r.y + r.h - 3; y += 2)
        for (let x = r.x + 2; x <= r.x + r.w - 3; x += 2)
          if (grid[y][x] === 0) grid[y][x] = 2;
      break;
    case 'lib':
    case 'store':
      for (let i = 0; i < 3; i++) rowOfSeats(r.y + 2 + i * 3, r.x + 2, r.x + r.w - 3, r.kind === 'lib' ? 5 : 4);
      break;
    case 'pc':
    case 'workshop':
      for (let i = 0; i < 4; i++) rowOfSeats(r.y + 2 + i * 3, r.x + 2, r.x + r.w - 3, 3);
      break;
    case 'theater':
      // Cuatro filas: la quinta quedaba encima del escenario.
      for (let i = 0; i < 4; i++) rowOfSeats(r.y + 2 + i * 2, r.x + 2, r.x + r.w - 3, 4);
      break;
    case 'staff': {
      const ty = r.y + Math.floor(r.h / 2);
      for (let x = r.x + 3; x <= r.x + r.w - 4; x++) if (grid[ty][x] === 0) grid[ty][x] = 3;
      break;
    }
    case 'gym':
    case 'pavilion':
      for (let x = r.x + 2; x <= r.x + r.w - 4; x++) {
        // deja un hueco central para que el marcador no se monte sobre los aparatos
        if (Math.abs(x - (r.x + r.w / 2)) <= 2) continue;
        if (grid[r.y + 1][x] === 0) grid[r.y + 1][x] = 3;
      }
      break;
    case 'music':
      for (let x = r.x + 3; x <= r.x + r.w - 4; x += 4) {
        if (grid[r.y + 3][x] === 0) grid[r.y + 3][x] = 3;
        if (grid[r.y + 7][x] === 0) grid[r.y + 7][x] = 3;
      }
      break;
  }
}

function buildMap() {
  grid = [];
  zoneKind = [];
  floorCol = [];
  doorTiles = [];
  decor = [];

  for (let y = 0; y < ROWS; y++) {
    grid.push(new Array(COLS).fill(0));
    zoneKind.push(new Array(COLS).fill(null));
    floorCol.push(new Array(COLS).fill(0));
  }
  // damero de pasillo y patio
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const par = (x + y) % 2 === 0;
      if (y >= 48) floorCol[y][x] = par ? PATIO_FLOOR : PATIO_FLOOR2;
      else floorCol[y][x] = par ? CORRIDOR_FLOOR : CORRIDOR_FLOOR2;
    }
  }

  // muros exteriores
  for (let x = 0; x < COLS; x++) { grid[0][x] = 1; grid[ROWS - 1][x] = 1; }
  for (let y = 0; y < ROWS; y++) { grid[y][0] = 1; grid[y][COLS - 1] = 1; }

  for (const room of ROOMS) {
    for (let x = room.x; x < room.x + room.w; x++) {
      grid[room.y][x] = 1;
      grid[room.y + room.h - 1][x] = 1;
      zoneKind[room.y][x] = room.kind;
      zoneKind[room.y + room.h - 1][x] = room.kind;
    }
    for (let y = room.y; y < room.y + room.h; y++) {
      grid[y][room.x] = 1;
      grid[y][room.x + room.w - 1] = 1;
      zoneKind[y][room.x] = room.kind;
      zoneKind[y][room.x + room.w - 1] = room.kind;
    }
    for (let y = room.y + 1; y < room.y + room.h - 1; y++)
      for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
        floorCol[y][x] = ((x + y) % 2 === 0) ? room.floor : room.floor2;
        zoneKind[y][x] = room.kind;
      }

    // Suelo decorativo por estancia: madera, moqueta, baldosas, hormigon...
    // Es solo visual y va debajo de los muebles, asi que no altera colisiones.
    decor.push({
      kind: 'roomfloor', x: room.x + 1, y: room.y + 1,
      w: room.w - 2, h: room.h - 2, style: room.kind, code: room.code, color: room.floor
    });

    for (const d of room.doors) carveDoor(room, d);
    fillFurniture(room);

    // Pizarra sobre la pared norte, salvo donde hay puerta norte o el aula usa
    // otra pared para sus murales. Asi no se tapa ninguna salida.
    const northDoor = room.doors.includes('N');
    if (!northDoor && room.kind !== 'gym' && room.kind !== 'cafe' && room.kind !== 'pavilion' && room.kind !== 'theater') {
      decor.push({ kind: 'board', x: room.x + 3, y: room.y + 0.28, w: room.w - 6, h: 0.44 });
    }
    // zocalo interior de la sala
    decor.push({ kind: 'trim', x: room.x + 1, y: room.y + 1, w: room.w - 2, h: room.h - 2 });
    // ventanas en la pared norte (a los lados de la pizarra)
    if (['aula', 'pc', 'lab', 'lib', 'staff', 'music', 'workshop', 'store'].includes(room.kind)) {
      decor.push({ kind: 'windows', x: room.x + 1.2, y: room.y + 0.08, w: 1.7, h: 0.42 });
      decor.push({ kind: 'windows', x: room.x + room.w - 2.9, y: room.y + 0.08, w: 1.7, h: 0.42 });
    }
    // decoracion especial
    if (room.kind === 'gym' || room.kind === 'pavilion') {
      decor.push({ kind: 'court', x: room.x + 3.5, y: room.y + 3.5, w: room.w - 7, h: room.h - 6 });
      decor.push({ kind: 'hoop', x: room.x + room.w / 2, y: room.y + 4, r: 1.1 });
      decor.push({ kind: 'hoop', x: room.x + room.w / 2, y: room.y + room.h - 4, r: 1.1 });
      // En el pabellon la puerta norte queda libre: el marcador va a la pared sur.
      const sbY = room.kind === 'pavilion' ? room.y + room.h - 0.7 : room.y + 0.55;
      decor.push({ kind: 'scoreboard', x: room.x + room.w / 2, y: sbY });
      decor.push({ kind: 'pennants', x: room.x + 2.4, y: room.y + 2.0, w: room.w - 4.8 });
      if (room.kind === 'gym') {
        decor.push({ kind: 'wallbars', x: room.x + 1.4, y: room.y + room.h - 1.15, w: 6.2 });
      }
    }
    if (room.kind === 'music') {
      decor.push({ kind: 'stage', x: room.x + 2, y: room.y + room.h - 4, w: room.w - 4, h: 2 });
      // El piano va sobre el escenario, no encima de la fila de instrumentos.
      decor.push({ kind: 'piano', x: room.x + 3.4, y: room.y + room.h - 2.6 });
      decor.push({ kind: 'poster', x: room.x + room.w - 1.5, y: room.y + 3.4, color: '#b48cff' });
    }
    if (room.kind === 'theater') {
      decor.push({ kind: 'stage', x: room.x + 3, y: room.y + room.h - 4, w: room.w - 6, h: 2.4 });
      decor.push({ kind: 'curtain', x: room.x + 3, y: room.y + room.h - 4.35, w: room.w - 6, h: 0.8 });
    }
    if (room.kind === 'cafe') {
      decor.push({ kind: 'counter', x: room.x + 0.65, y: room.y + 2, w: 0.9, h: room.h - 4 });
      // La maquina va en el hueco de la fila de mesas, lejos de la puerta norte.
      decor.push({ kind: 'vending', x: room.x + 9.0, y: room.y + 1.15 });
      // El menu se cuelga en la pared sur para no tapar la puerta norte.
      decor.push({ kind: 'menu', x: room.x + 3, y: room.y + room.h - 0.65, w: room.w - 6 });
    }
    if (room.kind === 'pc') {
      decor.push({ kind: 'cabinet', x: room.x + 1.2, y: room.y + 0.65, w: 1.2, h: 0.85 });
      decor.push({ kind: 'server', x: room.x + room.w - 2.2, y: room.y + 0.7 });
    }
    if (room.kind === 'workshop') {
      decor.push({ kind: 'cabinet', x: room.x + room.w - 2.4, y: room.y + room.h - 2.6, w: 1.2, h: 1.2 });
      // Pared de herramientas en la pared sur, sin tapar la puerta norte.
      decor.push({ kind: 'toolwall', x: room.x + 3, y: room.y + room.h - 0.75, w: room.w - 6 });
      decor.push({ kind: 'crate', x: room.x + 1.15, y: room.y + room.h - 2.0 });
    }
    if (room.kind === 'store') {
      decor.push({ kind: 'cabinet', x: room.x + 1.2, y: room.y + room.h - 2.6, w: 1.2, h: 1.2 });
      decor.push({ kind: 'crate', x: room.x + room.w - 2.0, y: room.y + room.h - 2.1 });
    }
    if (room.kind === 'lab') {
      decor.push({ kind: 'flasks', x: room.x + 4, y: room.y + 3.4 });
      decor.push({ kind: 'flasks', x: room.x + 8.6, y: room.y + 7.2 });
      // Campana extractora y ducha lavaojos: detalle de laboratorio real.
      decor.push({ kind: 'fumehood', x: room.x + 1.6, y: room.y + room.h - 2.0, w: 2.2, h: 0.85 });
      decor.push({ kind: 'water', x: room.x + room.w - 2.0, y: room.y + room.h - 2.0 });
    }
    if (room.kind === 'lib') {
      decor.push({ kind: 'rug', x: room.x + 4, y: room.y + 5, w: room.w - 8, h: 4 });
      // Sofa en el rincon de lectura, libre de las estanterias superiores.
      decor.push({ kind: 'sofa', x: room.x + 3.2, y: room.y + room.h - 2.9 });
      decor.push({ kind: 'globe', x: room.x + room.w - 2.0, y: room.y + 2.0 });
    }
    if (room.kind === 'staff') {
      decor.push({ kind: 'sofa', x: room.x + 2.4, y: room.y + room.h - 3.2 });
      decor.push({ kind: 'trophy', x: room.x + room.w - 2.2, y: room.y + 2.2 });
      decor.push({ kind: 'water', x: room.x + 2.1, y: room.y + 1.6 });
      decor.push({ kind: 'coffee', x: room.x + room.w - 2.0, y: room.y + 4.0 });
    }
    if (room.kind === 'aula') {
      // Reloj en la pared este, sin pisar la pizarra ni la ventana.
      decor.push({ kind: 'clock', x: room.x + room.w - 0.45, y: room.y + 3.15 });
      // Cartel de asignatura en la pared libre: cada aula tiene el suyo.
      const chart = SUBJECT_CHARTS[room.code];
      const chartRight = room.doors.includes('W');
      if (chart) {
        decor.push({
          kind: 'chart',
          x: chartRight ? room.x + room.w - 0.55 : room.x + 0.55,
          y: room.y + 5.2,
          text: chart.text, sub: chart.sub, color: chart.color, icon: chart.icon
        });
      }
    }
    if (room.kind === 'lib' || room.kind === 'staff') decor.push({ kind: 'plant', x: room.x + room.w - 2, y: room.y + room.h - 2 });
  }

  // ---------- alfombras de los pasillos ----------
  // Son solo decoracion de suelo: no bloquean el paso ni cambian las colisiones.
  // Dejan libres los umbrales de las puertas para que la animacion se vea limpia.
  decor.push({ kind: 'runner', x: 1.1, y: 14.15, w: 93.8, h: 1.9, color: '#3d2748' });
  decor.push({ kind: 'runner', x: 1.1, y: 31.75, w: 93.8, h: 1.9, color: '#3d2748' });

  // ---------- esquinas de MISION/TAREA en las 8 aulas y salas ----------
  for (const m of MISSIONS) {
    const room = ROOMS[m.roomIdx];
    // Las misiones de una misma sala usan esquinas distintas para no solaparse.
    const slot = m.spot || 0;
    let tx, ty;
    if (slot === 1) { tx = room.x + 2; ty = room.y + room.h - 2; }
    else if (slot === 2) { tx = room.x + room.w - 3; ty = room.y + 2; }
    else if (slot === 3) { tx = room.x + 2; ty = room.y + 2; }
    else { tx = room.x + room.w - 3; ty = room.y + room.h - 2; }
    // despeja la esquina para que se pueda llegar a la terminal
    for (let yy = ty - 1; yy <= ty; yy++) {
      for (let xx = tx - 1; xx <= tx + 1; xx++) {
        if (xx <= room.x || xx >= room.x + room.w - 1 || yy <= room.y || yy >= room.y + room.h - 1) continue;
        grid[yy][xx] = 0;
        floorCol[yy][xx] = ((xx + yy) % 2 === 0) ? room.floor : room.floor2;
      }
    }
    m.tx = tx; m.ty = ty;
    m.x = tx * T + T / 2;
    m.y = ty * T + T / 2;
    m.ax = m.x;
    m.ay = (ty - 1) * T + T / 2;
    m.done = false;
    m.index = 0;
    m.correct = 0;
    m.progress = 0;
    m.runner = null;
    m.flow = null;

    decor.push({ kind: 'missionpad', x: tx - 1, y: ty - 1, w: 3, h: 2, color: m.color });
    decor.push({ kind: 'mission', x: tx, y: ty, color: m.color, short: m.short });
  }

  // ---------- pasillos: objetos separados por carriles ----------
  // Taquillas contra los muros, una cada 18 tiles para dejar respirar al pasillo.
  const lockers = [];
  for (let x = 14; x < 92; x += 18) lockers.push([x, 13.35], [x, 33.35]);
  for (let y = 20; y < 46; y += 8) lockers.push([1.6, y], [93.4, y]);
  for (const l of lockers) decor.push({ kind: 'lockers', x: l[0], y: l[1] });

  // Plantas en el carril bajo, separadas de las taquillas y de los bancos.
  const plants = [];
  for (let x = 8; x <= 88; x += 16) { plants.push([x, 16.55]); plants.push([x, 34.25]); }
  plants.push([52, 45], [18, 45]);
  for (const p of plants) decor.push({ kind: 'plant', x: p[0], y: p[1] });

  const signs = [[26, 15.9], [58, 15.9], [26, 31.9], [58, 31.9], [42, 49.4], [74, 49.4]];
  for (const s of signs) decor.push({ kind: 'sign', x: s[0], y: s[1] });

  const benches = [[36, 14.8], [72, 14.8], [38, 32.6], [74, 32.6], [14, 59], [82.5, 60.1]];
  for (const b of benches) decor.push({ kind: 'bench', x: b[0], y: b[1] });

  // fuentes de agua, maquinas expendedoras y extintores en huecos libres
  decor.push({ kind: 'water', x: 48.4, y: 14.2 });
  decor.push({ kind: 'water', x: 48.4, y: 33.8 });
  decor.push({ kind: 'vending', x: 12.4, y: 14.15 });
  decor.push({ kind: 'vending', x: 80.4, y: 33.8 });

  // tablones de anuncios, extintores y flechas pintadas en los pasillos
  const boards = [[22, 13.15], [60.6, 13.15], [24, 33.15], [60, 33.15]];
  for (const b of boards) decor.push({ kind: 'noticeboard', x: b[0], y: b[1] });
  const ext = [[11, 13.55], [47, 13.55], [83, 13.55], [13, 33.45], [47, 33.45], [83, 33.45]];
  for (const e of ext) decor.push({ kind: 'extinguisher', x: e[0], y: e[1] });
  const arrows = [
    { x: 32, y: 15.7, ang: 0 }, { x: 60, y: 15.7, ang: Math.PI },
    { x: 32, y: 33.9, ang: Math.PI / 2 }, { x: 66, y: 33.9, ang: -Math.PI / 2 },
    { x: 52, y: 47.4, ang: Math.PI / 2 }, { x: 52, y: 50.6, ang: -Math.PI / 2 }
  ];
  for (const a of arrows) decor.push({ kind: 'arrow', x: a.x, y: a.y, ang: a.ang });

  // plaza central del patio y acceso a la puerta principal (cerrada)
  decor.push({ kind: 'plaza', x: 46, y: 48, w: 12, h: 10 });
  decor.push({ kind: 'path', x: 48, y: 58, w: 8, h: 7 });

  // ---------- patio grande ----------
  // La pista y la cancha caben completas dentro del mapa.
  decor.push({ kind: 'track', x: 8, y: 50.5, w: 36, h: 14 });          // pista de atletismo
  decor.push({ kind: 'court', x: 20, y: 54.8, w: 12, h: 8.4 });        // cancha de baloncesto
  decor.push({ kind: 'hoop', x: 26, y: 55.2, r: 1 });
  decor.push({ kind: 'hoop', x: 26, y: 62.8, r: 1 });
  decor.push({ kind: 'fountain', x: 52, y: 58.8, r: 2.4 });
  decor.push({ kind: 'emblem', x: 76, y: 58, r: 3.6 });                // escudo del colegio pintado en el patio
  decor.push({ kind: 'hopscotch', x: 61, y: 57.4, w: 3, h: 5 });        // rayuela pintada
  decor.push({ kind: 'picnic', x: 64, y: 52.6 });
  decor.push({ kind: 'picnic', x: 67, y: 63.4 });
  // Puestos de comida: decorativos, recuerdan de dónde salen los objetos curativos.
  decor.push({ kind: 'foodstall', x: 48.5, y: 52.2, color: '#ff8f6b' });
  decor.push({ kind: 'foodstall', x: 74, y: 52.2, color: '#ffd166' });
  decor.push({ kind: 'bin', x: 44.2, y: 49.4 });
  decor.push({ kind: 'bin', x: 59.8, y: 49.4 });
  decor.push({ kind: 'bin', x: 84, y: 57.2 });
  decor.push({ kind: 'bench', x: 47.2, y: 57.6 });
  decor.push({ kind: 'bench', x: 56.8, y: 57.6 });
  decor.push({ kind: 'flowerbed', x: 45.4, y: 55.4, w: 3.4, h: 1 });
  decor.push({ kind: 'flowerbed', x: 55.2, y: 55.4, w: 3.4, h: 1 });
  const trees = [[5.5, 52], [5.5, 63], [20, 49.6], [44, 52.2], [62, 50.5], [71, 51.5], [80, 52], [84, 62], [86, 51]];
  for (const t of trees) decor.push({ kind: 'tree', x: t[0], y: t[1] });

  // ---------- puerta principal: cerrada con cadenas (no se puede salir) ----------
  decor.push({ kind: 'closedgate', x: 48, y: ROWS - 1, w: 8 });
  decor.push({ kind: 'flowerbed', x: 44.6, y: 63.6, w: 3.2, h: 1 });
  decor.push({ kind: 'flowerbed', x: 56.2, y: 63.6, w: 3.2, h: 1 });
  decor.push({ kind: 'sign', x: 44.4, y: 62.8 });
  decor.push({ kind: 'sign', x: 59.6, y: 62.8 });

  // ---------- jardin y zona de bicis (esquina inferior derecha) ----------
  decor.push({ kind: 'hedge', x: 86, y: 54.5, w: 8, h: 1 });
  decor.push({ kind: 'hedge', x: 86, y: 63.5, w: 8, h: 1 });
  decor.push({ kind: 'hedge', x: 86, y: 55.5, w: 1, h: 8 });
  decor.push({ kind: 'hedge', x: 93, y: 55.5, w: 1, h: 8 });
  decor.push({ kind: 'flowerbed', x: 87.3, y: 57.2, w: 4.4, h: 1.1 });
  decor.push({ kind: 'bikes', x: 87.6, y: 56.3 });
  decor.push({ kind: 'dumpster', x: 91.2, y: 62.5 });
  decor.push({ kind: 'bench', x: 90.6, y: 59.0 });
  decor.push({ kind: 'tree', x: 88, y: 61 });

  // ---------- senalizacion pintada y vida en el patio ----------
  // Texto de suelo translucido para orientarse sin tapar el mapa.
  decor.push({ kind: 'floorlabel', x: 9.4,  y: 15.78, w: 7, h: 1.1, text: 'AULAS 4A-4D  →', color: '#cfe3ff' });
  decor.push({ kind: 'floorlabel', x: 65.4, y: 15.78, w: 7, h: 1.1, text: 'PATIO  ↓', color: '#c9f7d7' });
  decor.push({ kind: 'floorlabel', x: 11.8, y: 32.78, w: 7, h: 1.1, text: 'TALLER · ALMACÉN  →', color: '#ffe0b3' });
  decor.push({ kind: 'floorlabel', x: 69.2, y: 32.78, w: 7, h: 1.1, text: 'GIMNASIO · MÚSICA  →', color: '#e2d5ff' });
  decor.push({ kind: 'floorlabel', x: 52.0, y: 48.95, w: 7, h: 1.1, text: 'PATIO CENTRAL', color: '#d6ffe4' });
  decor.push({ kind: 'floorlabel', x: 30.0, y: 49.15, w: 7, h: 1.1, text: 'ZONA DEPORTIVA', color: '#ffe6a8' });

  // Paso de cebra entre el pasillo y el patio.
  decor.push({ kind: 'crosswalk', x: 47.7, y: 47.25, w: 8.6, h: 0.95 });

  // Pista: foso de salto y vallas para que no sea solo una elipse.
  decor.push({ kind: 'longjump', x: 36.1, y: 59.6, w: 4.3, h: 2.8 });
  decor.push({ kind: 'hurdle', x: 12.8, y: 54.7, ang: 0 });
  decor.push({ kind: 'hurdle', x: 12.8, y: 60.4, ang: 0 });
  decor.push({ kind: 'hurdle', x: 34.2, y: 54.7, ang: 0 });

  // Gradas junto a la pista, bandera del colegio y banderines del patio.
  decor.push({ kind: 'bleachers', x: 9.4,  y: 48.9, w: 7.6, h: 1.05 });
  decor.push({ kind: 'bleachers', x: 66.4, y: 48.9, w: 6.2, h: 1.05 });
  decor.push({ kind: 'flagpole', x: 79.4, y: 50.15 });
  decor.push({ kind: 'pennants', x: 44.8, y: 49.35, w: 13.2 });

  // ---------- pasada de diseno: plaza, huerto, pergola y detalles ----------
  // Todo lo que sigue es decorativo: no modifica grid, puertas ni rutas.
  const byCode = {};
  for (const rr of ROOMS) byCode[rr.code] = rr;
  const r4a = byCode['4A'], r4b = byCode['4B'], r4c = byCode['4C'], r4d = byCode['4D'];
  const rInfo = byCode['INFO'], rLab = byCode['LAB'], rBib = byCode['BIB'];
  const rProf = byCode['PROF'], rGym = byCode['GYM'], rMus = byCode['MUS'];
  const rCaf = byCode['CAF'], rTall = byCode['TALL'], rAlm = byCode['ALM'];
  const rAct = byCode['ACT'], rPab = byCode['PAB'];

  // Plaza central: pavimento, rosa de los vientos, jardineras y farolas.
  decor.push({ kind: 'planter', x: 46.7, y: 48.7, w: 1.6, h: 1.1, color: '#5fe3d1' });
  decor.push({ kind: 'planter', x: 55.7, y: 48.7, w: 1.6, h: 1.1, color: '#ffd166' });
  decor.push({ kind: 'lamppost', x: 45.3, y: 50.2 });
  decor.push({ kind: 'lamppost', x: 58.7, y: 50.2 });
  decor.push({ kind: 'lamppost', x: 45.3, y: 55.6 });
  decor.push({ kind: 'lamppost', x: 58.7, y: 55.6 });
  decor.push({ kind: 'bench', x: 48.0, y: 57.1 });
  decor.push({ kind: 'bench', x: 56.0, y: 57.1 });

  // Entrada al patio: farolas, arbustos y jardineria.
  decor.push({ kind: 'lamppost', x: 47.2, y: 60.0 });
  decor.push({ kind: 'lamppost', x: 56.8, y: 60.0 });
  decor.push({ kind: 'lamppost', x: 47.2, y: 63.2 });
  decor.push({ kind: 'lamppost', x: 56.8, y: 63.2 });
  decor.push({ kind: 'bush', x: 3.4, y: 48.8 });
  decor.push({ kind: 'bush', x: 30.2, y: 49.2 });
  decor.push({ kind: 'bush', x: 69.4, y: 49.2 });
  decor.push({ kind: 'bush', x: 78.6, y: 49.3 });
  decor.push({ kind: 'bush', x: 84.6, y: 49.3 });
  decor.push({ kind: 'bush', x: 7.7, y: 53.2 });

  // Huerto escolar en la franja oeste del patio.
  decor.push({ kind: 'huerto', x: 1.4, y: 53.9, w: 5.9, h: 8.7 });

  // Pergola y zona de descanso en la esquina noreste.
  decor.push({ kind: 'pergola', x: 87.9, y: 48.9, w: 6.5, h: 3.8 });
  decor.push({ kind: 'planter', x: 88.3, y: 53.1, w: 1.7, h: 0.8, color: '#ff8fb1' });
  decor.push({ kind: 'planter', x: 92.3, y: 53.1, w: 1.7, h: 0.8, color: '#5fe3d1' });

  // Murales en la fachada que da al patio.
  decor.push({ kind: 'wallpanel', style: 'mural', x: 4.4, y: 47.08, w: 7.4, h: 0.78, text: 'CAFETERÍA', color: '#ffb45e' });
  decor.push({ kind: 'wallpanel', style: 'mural', x: 22.4, y: 47.08, w: 7.2, h: 0.78, text: 'TALLER', color: '#ffcf5c' });
  decor.push({ kind: 'wallpanel', style: 'mural', x: 39.4, y: 47.08, w: 7.4, h: 0.78, text: 'ALMACÉN', color: '#9fb8d8' });
  decor.push({ kind: 'wallpanel', style: 'mural', x: 54.4, y: 47.08, w: 6.2, h: 0.78, text: 'SALÓN DE ACTOS', color: '#d48bff' });
  decor.push({ kind: 'wallpanel', style: 'mural', x: 75.4, y: 47.08, w: 14.0, h: 0.78, text: 'PABELLÓN SAN PATRICIO', color: '#8fd0ff' });

  // Pista: pasillo de salto, tacos de salida, salto de altura y senalizacion.
  decor.push({ kind: 'runway', x: 31.7, y: 60.4, w: 4.5, h: 1.05 });
  decor.push({ kind: 'startingblocks', x: 9.8, y: 54.6 });
  decor.push({ kind: 'startingblocks', x: 9.8, y: 60.4 });
  decor.push({ kind: 'highjump', x: 42.0, y: 53.4, w: 1.6, h: 2.6 });
  decor.push({ kind: 'cone', x: 16.4, y: 52.2 });
  decor.push({ kind: 'cone', x: 36.6, y: 52.2 });
  decor.push({ kind: 'cone', x: 16.4, y: 63.0 });
  decor.push({ kind: 'cone', x: 36.6, y: 63.0 });
  decor.push({ kind: 'recordboard', x: 37.4, y: 48.9, w: 4.4, h: 1.3 });
  decor.push({ kind: 'water', x: 33.2, y: 49.3 });

  // Pasillos: vitrina de trofeos, galeria de dibujos y lema del colegio.
  decor.push({ kind: 'trophycase', x: 35.0, y: 13.15, w: 5.2, h: 0.8 });
  decor.push({ kind: 'gallery', x: 4.2, y: 13.15, w: 7.2, h: 0.85 });
  decor.push({ kind: 'gallery', x: 76.0, y: 13.15, w: 7.0, h: 0.85 });
  decor.push({ kind: 'gallery', x: 4.2, y: 33.15, w: 7.0, h: 0.85 });
  decor.push({ kind: 'trophycase', x: 42.2, y: 33.15, w: 4.8, h: 0.8 });
  decor.push({ kind: 'wallpanel', style: 'school', x: 52.0, y: 13.15, w: 6.0, h: 0.85, text: 'SAN PATRICIO', color: '#e8c85a' });

  // Aulas: paneles de asignatura en la pared sur.
  decor.push({ kind: 'wallpanel', style: 'numberline', x: r4a.x + 1.8, y: r4a.y + r4a.h - 0.82, w: 5.2, h: 0.68, text: 'NÚMEROS', color: '#ffd166' });
  decor.push({ kind: 'wallpanel', style: 'periodic', x: r4b.x + 1.8, y: r4b.y + r4b.h - 0.82, w: 5.2, h: 0.68, text: 'TABLA PERIÓDICA', color: '#5fe3d1' });
  decor.push({ kind: 'wallpanel', style: 'books', x: r4c.x + 1.8, y: r4c.y + r4c.h - 0.82, w: 5.0, h: 0.68, text: 'LECTURA', color: '#8fd0ff' });
  decor.push({ kind: 'wallpanel', style: 'timeline', x: r4d.x + 1.8, y: r4d.y + r4d.h - 0.82, w: 5.2, h: 0.68, text: 'LÍNEA DEL TIEMPO', color: '#c77dff' });
  decor.push({ kind: 'wallpanel', style: 'code', x: rInfo.x + 1.8, y: rInfo.y + rInfo.h - 0.82, w: 4.6, h: 0.68, text: 'CÓDIGO', color: '#7ee787' });

  // Laboratorio, biblioteca, sala de profesores, gimnasio y musica.
  decor.push({ kind: 'labbench', x: rLab.x + 3.4, y: rLab.y + 0.9, w: 3.6, h: 0.85 });
  decor.push({ kind: 'wallpanel', style: 'safety', x: rLab.x + 5.0, y: rLab.y + rLab.h - 0.82, w: 4.2, h: 0.68, text: 'SEGURIDAD', color: '#ffcf5c' });
  decor.push({ kind: 'wallpanel', style: 'silence', x: rBib.x + 2.0, y: rBib.y + rBib.h - 0.82, w: 3.6, h: 0.68, text: 'SILENCIO', color: '#8fd0ff' });
  decor.push({ kind: 'bookcart', x: rBib.x + 7.0, y: rBib.y + rBib.h - 3.2 });
  decor.push({ kind: 'printer', x: rProf.x + 4.4, y: rProf.y + 1.4 });
  decor.push({ kind: 'mail', x: rProf.x + rProf.w - 0.7, y: rProf.y + 8.2 });
  decor.push({ kind: 'ropes', x: rGym.x + 17.0, y: rGym.y + 2.2, w: 2.6, h: 1.4 });
  decor.push({ kind: 'equipment', x: rGym.x + 17.4, y: rGym.y + rGym.h - 2.4, w: 2.4, h: 1.0 });
  decor.push({ kind: 'mats', x: rGym.x + 14.2, y: rGym.y + rGym.h - 2.2, w: 2.4, h: 0.9 });
  decor.push({ kind: 'drumkit', x: rMus.x + rMus.w - 3.2, y: rMus.y + rMus.h - 2.7 });
  decor.push({ kind: 'musicstand', x: rMus.x + 2.2, y: rMus.y + 5.0 });
  decor.push({ kind: 'musicstand', x: rMus.x + 5.2, y: rMus.y + 5.0 });

  // Cafeteria, taller, almacen, salon de actos y pabellon.
  decor.push({ kind: 'clock', x: rCaf.x + rCaf.w - 1.0, y: rCaf.y + 3.2 });
  decor.push({ kind: 'condiments', x: rCaf.x + 10.8, y: rCaf.y + 1.2, w: 1.8, h: 0.6 });
  decor.push({ kind: 'workbench', x: rTall.x + 5.0, y: rTall.y + 7.0, w: 3.0, h: 0.85 });
  decor.push({ kind: 'ladder', x: rAlm.x + rAlm.w - 2.0, y: rAlm.y + 3.2 });
  decor.push({ kind: 'wallpanel', style: 'inventory', x: rAlm.x + 1.4, y: rAlm.y + rAlm.h - 0.82, w: 4.6, h: 0.68, text: 'INVENTARIO', color: '#ffcf5c' });
  decor.push({ kind: 'spotlights', x: rAct.x + 1.4, y: rAct.y + 1.2, w: 5.4, h: 0.7 });
  decor.push({ kind: 'spotlights', x: rAct.x + 11.0, y: rAct.y + 1.2, w: 4.6, h: 0.7 });
  decor.push({ kind: 'bleachers', x: rPab.x + 1.4, y: rPab.y + rPab.h - 2.0, w: 6.8, h: 0.85 });
  decor.push({ kind: 'equipment', x: rPab.x + rPab.w - 3.8, y: rPab.y + rPab.h - 2.2, w: 2.0, h: 0.9 });
}

