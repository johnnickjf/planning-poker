/**
 * sound.js — Gerenciador de efeitos sonoros (Web Audio API).
 *
 * - Só o EVENTO viaja pela rede; cada navegador toca o som localmente.
 * - Os arquivos são baixados (pré-carregados) logo no início e decodificados
 *   após a primeira interação do usuário (política de autoplay).
 * - Sons podem se sobrepor (cada play cria um BufferSource novo).
 * - Arquivo inexistente ou inválido = silêncio, sem quebrar o app.
 */

// ============================================================================
// Mapa de sons (adicione/alterar arquivos aqui; caminhos relativos ao index.html)
// ============================================================================
export const SONS = {
  egg: 'sounds/egg.mp3',
  paper: 'sounds/paper.mp3',
  plane: 'sounds/plane.mp3',
  heart: 'sounds/heart.mp3',
  dart: 'sounds/dart.mp3',
  reveal: 'sounds/reveal.mp3',
  vote: 'sounds/vote.mp3',
  join: 'sounds/join.mp3',
  newround: 'sounds/newround.mp3',
  consensus: 'sounds/consensus.mp3',
};

const LS_MUDO = 'pp-som-mudo';
const LS_VOLUME = 'pp-som-volume';
const VOLUME_PADRAO = 0.6;
const EVENTOS_DE_INTERACAO = ['pointerdown', 'pointerup', 'click', 'keydown', 'touchend'];

let ctx = null;
let master = null;
let iniciado = false;
let mudo = false;
let volume = VOLUME_PADRAO;
/** nome → AudioBuffer decodificado */
const buffers = new Map();
/** nome → ArrayBuffer baixado, aguardando o AudioContext existir */
const pendentes = new Map();

function lsGet(chave) {
  try { return localStorage.getItem(chave); } catch { return null; }
}
function lsSet(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch { /* armazenamento indisponível */ }
}

export function init() {
  if (iniciado) return;
  iniciado = true;

  mudo = lsGet(LS_MUDO) === '1';
  const v = parseFloat(lsGet(LS_VOLUME));
  volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : VOLUME_PADRAO;

  // Pré-carrega os bytes (fetch não depende de interação do usuário)
  for (const [nome, url] of Object.entries(SONS)) {
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => {
        if (!buf) return;
        pendentes.set(nome, buf);
        if (ctx) decodificarPendentes();
      })
      .catch(() => { /* arquivo ausente: falha silenciosa */ });
  }

  // O AudioContext só é criado dentro de um gesto do usuário (sem avisos no console)
  const destravar = (e) => {
    if (e.type === 'keydown' && (e.key === 'Escape' || e.key === 'Tab')) return;
    if (ctx && ctx.state === 'running') {
      for (const ev of EVENTOS_DE_INTERACAO) window.removeEventListener(ev, destravar, true);
      return;
    }
    criarContexto();
  };
  for (const ev of EVENTOS_DE_INTERACAO) window.addEventListener(ev, destravar, true);
}

function criarContexto() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    decodificarPendentes();
  } catch {
    /* sem áudio neste navegador */
  }
}

function decodificarPendentes() {
  for (const [nome, buf] of pendentes) {
    pendentes.delete(nome);
    new Promise((resolve, reject) => {
      // Suporta a API com Promise e a antiga com callbacks (Safari antigo)
      const p = ctx.decodeAudioData(buf, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    })
      .then((audio) => buffers.set(nome, audio))
      .catch(() => { /* arquivo inválido: ignora */ });
  }
}

/** Toca um som pelo nome do mapa SONS. Nunca lança erro. */
export function play(nome) {
  if (!nome || mudo || !ctx || ctx.state !== 'running') return;
  const buffer = buffers.get(nome);
  if (!buffer) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(master);
    src.start(0);
  } catch {
    /* ignora */
  }
}

export function isMuted() {
  return mudo;
}

export function setMuted(valor) {
  mudo = !!valor;
  lsSet(LS_MUDO, mudo ? '1' : '0');
}

export function getVolume() {
  return volume;
}

export function setVolume(valor) {
  volume = Math.min(1, Math.max(0, Number(valor) || 0));
  lsSet(LS_VOLUME, String(volume));
  if (master) master.gain.value = volume;
}
