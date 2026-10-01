/**
 * sound.js — Gerenciador de efeitos sonoros (Web Audio API).
 *
 * - Só o EVENTO viaja pela rede; cada navegador toca o som localmente.
 * - Os arquivos são baixados (pré-carregados) logo no início e decodificados
 *   após a primeira interação do usuário (política de autoplay).
 *   Cada arquivo é baixado uma única vez, mesmo usado em vários lugares.
 * - Sons podem se sobrepor (cada play cria um BufferSource novo).
 * - O volume de cada arquivo é normalizado e sons longos são cortados com fade-out
 *   (3 s nos automáticos, 5 s na soundboard).
 * - Começa MUDO por padrão. Quando um som "tocaria" com o áudio mudo, avisa
 *   quem se inscreveu em onSomSilenciado() (a UI faz o botão de som piscar).
 * - Arquivo inexistente ou inválido = silêncio, sem quebrar o app.
 */

import { SOUNDBOARD } from './state.js';

// ============================================================================
// Sons automáticos (evento → arquivo; caminhos relativos ao index.html)
// Para tirar o som de um evento, basta remover a linha.
// ============================================================================
export const SONS_AUTOMATICOS = {
  consensus: 'sounds/consensus.mp3',   // todos os votos iguais
  divergence: 'sounds/reveal.mp3',     // todos os votos diferentes
  newround: 'sounds/newround.mp3',     // nova votação
  join: 'sounds/join.mp3',             // alguém entrou na sala
  // Arremessos (os 6 itens principais)
  paper: 'sounds/paper.mp3',
  plane: 'sounds/plane.mp3',
  egg: 'sounds/egg.mp3',
  heart: 'sounds/heart.mp3',
  dart: 'sounds/dart.mp3',
  emoji: 'sounds/emoji.mp3',
};

/** Todos os sons conhecidos: automáticos + soundboard (configurada em js/state.js). */
export const SONS = {
  ...SONS_AUTOMATICOS,
  ...Object.fromEntries(SOUNDBOARD.map((s) => [s.id, s.arquivo])),
};

/** Duração máxima (em segundos); o que passar é cortado com fade-out. */
export const DURACAO_MAXIMA = {
  automatico: 3,
  soundboard: 5,
};
const FADE_OUT_S = 0.35;
/** Pico alvo da normalização (0–1) e ganho máximo aplicado a arquivos baixos. */
const PICO_ALVO = 0.85;
const GANHO_MAXIMO = 4;

const LS_MUDO = 'pp-som-mudo';
const LS_VOLUME = 'pp-som-volume';
const MUDO_PADRAO = true;
const VOLUME_PADRAO = 0.6;
const EVENTOS_DE_INTERACAO = ['pointerdown', 'pointerup', 'click', 'keydown', 'touchend'];

const IDS_SOUNDBOARD = new Set(SOUNDBOARD.map((s) => s.id));

let ctx = null;
let master = null;
let iniciado = false;
let mudo = MUDO_PADRAO;
let volume = VOLUME_PADRAO;
/** url → { buffer: AudioBuffer, ganho: number } */
const buffers = new Map();
/** url → ArrayBuffer baixado, aguardando o AudioContext existir */
const pendentes = new Map();
/** urls cujo arquivo existe (para não "piscar" por som inexistente) */
const disponiveis = new Set();
const ouvintesSilenciados = new Set();

function lsGet(chave) {
  try { return localStorage.getItem(chave); } catch { return null; }
}
function lsSet(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch { /* armazenamento indisponível */ }
}

export function duracaoMaxima(nome) {
  return IDS_SOUNDBOARD.has(nome) ? DURACAO_MAXIMA.soundboard : DURACAO_MAXIMA.automatico;
}

/** Ganho que leva o pico do arquivo até PICO_ALVO. */
export function ganhoDeNormalizacao(buffer) {
  let pico = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const dados = buffer.getChannelData(c);
    for (let i = 0; i < dados.length; i++) {
      const v = Math.abs(dados[i]);
      if (v > pico) pico = v;
    }
  }
  return pico > 0 ? Math.min(GANHO_MAXIMO, PICO_ALVO / pico) : 1;
}

export function init() {
  if (iniciado) return;
  iniciado = true;

  const salvo = lsGet(LS_MUDO);
  mudo = salvo === null ? MUDO_PADRAO : salvo === '1';
  const v = parseFloat(lsGet(LS_VOLUME));
  volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : VOLUME_PADRAO;

  // Pré-carrega os bytes de cada arquivo uma única vez (fetch não depende de interação)
  for (const url of new Set(Object.values(SONS))) {
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => {
        if (!buf) return;
        disponiveis.add(url);
        pendentes.set(url, buf);
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
  for (const [url, buf] of pendentes) {
    pendentes.delete(url);
    new Promise((resolve, reject) => {
      // Suporta a API com Promise e a antiga com callbacks (Safari antigo)
      const p = ctx.decodeAudioData(buf, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    })
      .then((audio) => buffers.set(url, { buffer: audio, ganho: ganhoDeNormalizacao(audio) }))
      .catch(() => { disponiveis.delete(url); });
  }
}

/** Registra uma função chamada quando um som deixa de tocar porque o áudio está mudo. */
export function onSomSilenciado(fn) {
  ouvintesSilenciados.add(fn);
}

/** Toca um som pelo nome (chave de SONS). Nunca lança erro. */
export function play(nome) {
  const url = nome ? SONS[nome] : null;
  if (!url) return;
  if (mudo) {
    if (disponiveis.has(url)) {
      for (const fn of ouvintesSilenciados) {
        try { fn(nome); } catch { /* ignora */ }
      }
    }
    return;
  }
  if (!ctx || ctx.state !== 'running') return;
  const item = buffers.get(url);
  if (!item) return;
  try {
    const src = ctx.createBufferSource();
    const ganho = ctx.createGain();
    src.buffer = item.buffer;
    ganho.gain.value = item.ganho;
    src.connect(ganho);
    ganho.connect(master);

    const agora = ctx.currentTime;
    const max = duracaoMaxima(nome);
    src.start(agora);
    if (item.buffer.duration > max) {
      ganho.gain.setValueAtTime(item.ganho, agora + max - FADE_OUT_S);
      ganho.gain.linearRampToValueAtTime(0.0001, agora + max);
      src.stop(agora + max + 0.05);
    }
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
