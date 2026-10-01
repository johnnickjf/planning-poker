/**
 * state.js — Estado oficial da sala (mantido SOMENTE pelo host), estatísticas
 * e configurações compartilhadas entre os módulos.
 */

// ============================================================================
// Configurações gerais (altere aqui)
// ============================================================================

/** Se true, apenas o host pode usar "Revelar votos" e "Nova votação". */
export const SOMENTE_HOST_CONTROLA = false;

/** Máximo de pessoas por sala (incluindo o host). */
export const MAX_JOGADORES = 10;

/** Limites de caracteres. */
export const MAX_NOME = 20;
export const MAX_NOME_SALA = 40;

/** ID da sala: 6 caracteres sem ambíguos (sem 0/O, 1/I/L). */
export const TAMANHO_ID_SALA = 6;
const ALFABETO_ID = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REGEX_ID_SALA = new RegExp(`^[${ALFABETO_ID}]{${TAMANHO_ID_SALA}}$`);

/** playerId (UUID ou ID aleatório gerado pelo navegador). */
export const REGEX_PLAYER_ID = /^[a-zA-Z0-9-]{8,64}$/;

/** Baralho Fibonacci. */
export const BARALHO = ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?', '☕'];

/**
 * Itens que podem ser arremessados nos colegas. Para adicionar um item novo,
 * basta incluir um objeto aqui (e, se quiser, um som em sound.js).
 *  - impacto:  'quica' | 'plana' | 'mancha' | 'explode' | 'crava'
 *  - giro:     graus girados durante o voo
 *  - orientar: o item aponta na direção do voo (anguloBase corrige o desenho do emoji)
 *  - som/somNo: chave do mapa de sons e momento em que toca ('lancamento' | 'impacto')
 *  - livre:    permite escolher qualquer emoji
 */
export const ITENS_ARREMESSO = [
  { id: 'paper', emoji: '📄', rotulo: 'Papelzinho', impacto: 'quica', giro: 720, som: 'paper', somNo: 'impacto' },
  { id: 'plane', emoji: '✈️', rotulo: 'Aviãozinho', impacto: 'plana', orientar: true, anguloBase: 45, duracao: 1000, som: 'plane', somNo: 'lancamento' },
  { id: 'egg', emoji: '🥚', rotulo: 'Ovo', impacto: 'mancha', giro: 540, som: 'egg', somNo: 'impacto' },
  { id: 'heart', emoji: '❤️', rotulo: 'Coração', impacto: 'explode', giro: 0, som: 'heart', somNo: 'impacto' },
  { id: 'dart', emoji: '🎯', rotulo: 'Dardo', impacto: 'crava', giro: 0, duracao: 450, som: 'dart', somNo: 'impacto' },
  { id: 'emoji', emoji: '😀', rotulo: 'Emoji', impacto: 'quica', giro: 360, som: 'emoji', somNo: 'impacto', livre: true },
];

/** Emojis rápidos do seletor (item "emoji"). */
export const EMOJIS_RAPIDOS = ['😂', '😍', '😎', '🤔', '😱', '🥳', '👏', '🔥', '💩', '🍕', '🚀', '🐛', '🍌', '💯', '🤡', '👻'];

/** Rate limit de arremessos (aplicado pelo host; a UI só avisa). */
export const LIMITE_ARREMESSOS = { max: 5, janelaMs: 5000 };

/**
 * Soundboard: sons que qualquer pessoa toca para a sala inteira.
 * Para adicionar um som, coloque o MP3 em sounds/soundboard/ e inclua uma linha aqui
 * (o `id` precisa ser único; `rotulo` e `emoji` são o que aparece no botão).
 */
export const SOUNDBOARD = [
  // Sons que também são usados automaticamente
  { id: 'sb-consenso', arquivo: 'sounds/consensus.mp3', rotulo: 'Consenso', emoji: '🎉' },
  { id: 'sb-revelacao', arquivo: 'sounds/reveal.mp3', rotulo: 'Revelação', emoji: '🥁' },
  { id: 'sb-rodada', arquivo: 'sounds/newround.mp3', rotulo: 'Nova rodada', emoji: '🔄' },
  { id: 'sb-chegada', arquivo: 'sounds/join.mp3', rotulo: 'Chegada', emoji: '👋' },
  { id: 'sb-voto', arquivo: 'sounds/vote.mp3', rotulo: 'Voto', emoji: '🗳️' },
  { id: 'sb-ovo', arquivo: 'sounds/egg.mp3', rotulo: 'Ovo', emoji: '🥚' },
  { id: 'sb-papel', arquivo: 'sounds/paper.mp3', rotulo: 'Papel', emoji: '📄' },
  { id: 'sb-aviao', arquivo: 'sounds/plane.mp3', rotulo: 'Avião', emoji: '✈️' },
  { id: 'sb-coracao', arquivo: 'sounds/heart.mp3', rotulo: 'Coração', emoji: '❤️' },
  { id: 'sb-dardo', arquivo: 'sounds/dart.mp3', rotulo: 'Dardo', emoji: '🎯' },
  { id: 'sb-emoji', arquivo: 'sounds/emoji.mp3', rotulo: 'Emoji', emoji: '😀' },
  // Sons exclusivos da soundboard
  { id: 'sb01', arquivo: 'sounds/soundboard/01.mp3', rotulo: 'Som 1', emoji: '🎵' },
  { id: 'sb02', arquivo: 'sounds/soundboard/02.mp3', rotulo: 'Som 2', emoji: '🎶' },
  { id: 'sb03', arquivo: 'sounds/soundboard/03.mp3', rotulo: 'Som 3', emoji: '🎺' },
  { id: 'sb04', arquivo: 'sounds/soundboard/04.mp3', rotulo: 'Som 4', emoji: '💥' },
  { id: 'sb05', arquivo: 'sounds/soundboard/05.mp3', rotulo: 'Som 5', emoji: '🔔' },
  { id: 'sb06', arquivo: 'sounds/soundboard/06.mp3', rotulo: 'Som 6', emoji: '📯' },
  { id: 'sb07', arquivo: 'sounds/soundboard/07.mp3', rotulo: 'Som 7', emoji: '🎸' },
  { id: 'sb08', arquivo: 'sounds/soundboard/08.mp3', rotulo: 'Som 8', emoji: '🎹' },
];

/** Rate limit da soundboard (por pessoa). */
export const LIMITE_SOUNDBOARD = { max: 3, janelaMs: 6000 };

// ============================================================================
// Utilitários
// ============================================================================

/** Gera um ID aleatório criptograficamente seguro. */
export function generateId(tamanho = TAMANHO_ID_SALA, alfabeto = ALFABETO_ID) {
  const bytes = new Uint32Array(tamanho);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const b of bytes) id += alfabeto[b % alfabeto.length];
  return id;
}

/** UUID v4 (usa crypto.randomUUID quando disponível). */
export function generateUUID() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Limpa um texto vindo do usuário: remove caracteres de controle e de
 * direção (bidi), colapsa espaços, faz trim e corta em `max` caracteres.
 */
export function sanitizeText(valor, max) {
  if (typeof valor !== 'string') return '';
  const limpo = valor
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(limpo).slice(0, max).join('').trim();
}

/** Valida um "emoji livre": só pictogramas/componentes de emoji, curto. */
export function sanitizeEmoji(valor) {
  if (typeof valor !== 'string') return '';
  const e = valor.trim();
  if (!e || e.length > 32 || Array.from(e).length > 16) return '';
  if (!/^[\p{Extended_Pictographic}\p{Emoji_Component}]+$/u.test(e)) return '';
  if (!/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(e)) return '';
  return e;
}

// ============================================================================
// Estatísticas
// ============================================================================

/**
 * Calcula as estatísticas de uma lista de votos (strings do BARALHO).
 * Média, mediana e moda ignoram "?" e "☕".
 */
export function computeStats(votos) {
  const numericos = votos.filter((v) => /^\d+$/.test(v)).map(Number).sort((a, b) => a - b);
  const n = numericos.length;

  const average = n ? numericos.reduce((s, v) => s + v, 0) / n : null;
  const median = n ? (n % 2 ? numericos[(n - 1) / 2] : (numericos[n / 2 - 1] + numericos[n / 2]) / 2) : null;

  // Moda: valor(es) mais frequente(s). Se todos os valores distintos empatam, não há moda.
  const freq = new Map();
  for (const v of numericos) freq.set(v, (freq.get(v) || 0) + 1);
  let mode = [];
  let melhor = 0;
  for (const [v, c] of freq) {
    if (c > melhor) { melhor = c; mode = [v]; } else if (c === melhor) mode.push(v);
  }
  if (freq.size > 1 && mode.length === freq.size) mode = [];

  const consensus = votos.length >= 2 && votos.every((v) => v === votos[0]);
  const allDifferent = votos.length >= 2 && new Set(votos).size === votos.length;
  const temExtremos = n >= 2 && numericos[0] !== numericos[n - 1];

  return {
    total: votos.length,
    average,
    median,
    mode,
    consensus,
    allDifferent,
    // Strings, para comparar diretamente com os votos ('3' === '3')
    min: temExtremos ? String(numericos[0]) : null,
    max: temExtremos ? String(numericos[n - 1]) : null,
    distribution: BARALHO
      .map((value) => ({ value, count: votos.filter((v) => v === value).length }))
      .filter((d) => d.count > 0),
  };
}

// ============================================================================
// Estado da sala (vive apenas no host)
// ============================================================================

/**
 * Cada jogador tem dois identificadores:
 *  - playerId: SECRETO, vem do localStorage do jogador e serve para reconexão.
 *  - seatId:   PÚBLICO, gerado pelo host e usado no estado enviado a todos
 *              (alvo de arremessos etc.). Assim ninguém consegue "roubar"
 *              o lugar de outra pessoa copiando um ID visto no estado.
 */
export class RoomState {
  constructor(roomId, roomName) {
    this.roomId = roomId;
    this.roomName = roomName;
    /** @type {Map<string, {playerId:string, seatId:string, name:string, vote:string|null, connected:boolean, isHost:boolean, order:number}>} */
    this.players = new Map();
    this.revealed = false;
    this.round = 1;
    this._order = 0;
  }

  get size() {
    return this.players.size;
  }

  findBySeat(seatId) {
    for (const p of this.players.values()) if (p.seatId === seatId) return p;
    return null;
  }

  /** Garante nome único na sala acrescentando " (2)", " (3)"... */
  uniqueName(nome, ignorarPlayerId) {
    const usados = new Set(
      [...this.players.values()]
        .filter((p) => p.playerId !== ignorarPlayerId)
        .map((p) => p.name.toLocaleLowerCase('pt-BR')),
    );
    if (!usados.has(nome.toLocaleLowerCase('pt-BR'))) return nome;
    for (let i = 2; ; i++) {
      const sufixo = ` (${i})`;
      const base = Array.from(nome).slice(0, Math.max(1, MAX_NOME - sufixo.length)).join('').trim();
      const candidato = base + sufixo;
      if (!usados.has(candidato.toLocaleLowerCase('pt-BR'))) return candidato;
    }
  }

  addPlayer(playerId, nome, isHost = false) {
    let seatId;
    do seatId = generateId(10, 'abcdefghijkmnpqrstuvwxyz23456789');
    while (this.findBySeat(seatId));
    const jogador = {
      playerId,
      seatId,
      name: this.uniqueName(nome, playerId),
      vote: null,
      connected: true,
      isHost,
      order: this._order++,
    };
    this.players.set(playerId, jogador);
    return jogador;
  }

  removePlayer(playerId) {
    return this.players.delete(playerId);
  }

  /** Retorna true se o estado mudou. */
  vote(playerId, valor) {
    const p = this.players.get(playerId);
    if (!p || this.revealed || !BARALHO.includes(valor) || p.vote === valor) return false;
    p.vote = valor;
    return true;
  }

  clearVote(playerId) {
    const p = this.players.get(playerId);
    if (!p || this.revealed || p.vote === null) return false;
    p.vote = null;
    return true;
  }

  votes() {
    return [...this.players.values()].filter((p) => p.vote !== null).map((p) => p.vote);
  }

  /** Todos os jogadores conectados já votaram? */
  allVoted() {
    const ativos = [...this.players.values()].filter((p) => p.connected);
    return ativos.length > 0 && ativos.every((p) => p.vote !== null);
  }

  reveal() {
    if (this.revealed || this.votes().length === 0) return false;
    this.revealed = true;
    return true;
  }

  newRound() {
    if (!this.revealed && this.votes().length === 0) return false;
    for (const p of this.players.values()) p.vote = null;
    this.revealed = false;
    this.round++;
    return true;
  }

  stats() {
    return computeStats(this.votes());
  }

  /**
   * Estado sanitizado para um destinatário específico.
   * IMPORTANTE: antes da revelação, os valores dos votos NUNCA saem daqui —
   * só o booleano `voted`. O próprio voto do destinatário vai em `myVote`
   * (para restaurar a seleção após F5/reconexão).
   */
  toPublic(paraPlayerId) {
    const eu = this.players.get(paraPlayerId);
    const lista = [...this.players.values()].sort((a, b) => a.order - b.order);
    return {
      roomId: this.roomId,
      roomName: this.roomName,
      max: MAX_JOGADORES,
      round: this.round,
      revealed: this.revealed,
      allVoted: this.allVoted(),
      selfId: eu ? eu.seatId : null,
      myVote: eu ? eu.vote : null,
      players: lista.map((p) => ({
        id: p.seatId,
        name: p.name,
        isHost: p.isHost,
        connected: p.connected,
        voted: p.vote !== null,
        vote: this.revealed ? p.vote : null,
      })),
      stats: this.revealed ? this.stats() : null,
    };
  }
}
