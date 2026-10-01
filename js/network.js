/**
 * network.js — Comunicação P2P via PeerJS em topologia ESTRELA.
 *
 * O criador da sala é o HOST: mantém o estado oficial (RoomState), valida cada
 * mensagem e retransmite o estado sanitizado para todos. Clientes conversam
 * SOMENTE com o host. O Peer ID do host é `planning-poker-{roomId}`.
 *
 * ---------------------------------------------------------------------------
 * PROTOCOLO (mensagens JSON; o campo `type` é obrigatório)
 * ---------------------------------------------------------------------------
 * Cliente → Host
 *   info       { playerId? }             Consulta antes de entrar (nome da sala, lotação). Não ocupa vaga.
 *   hello      { playerId, name }        Entra ou reentra na sala (mesmo playerId = mesmo lugar e voto).
 *   vote       { value }                 Vota (valor do BARALHO). Só antes da revelação.
 *   clearVote  {}                        Remove o próprio voto.
 *   reveal     {}                        Revela os votos.
 *   newRound   {}                        Limpa os votos e volta ao estado "votando".
 *   throw      { toId, item, emoji? }    Arremessa um item em outro jogador (fromId é definido pelo host).
 *   leave      {}                        Sai na hora (sem tolerância de reconexão).
 *   ping       {}                        Heartbeat.
 *
 * Host → Cliente
 *   info       { roomName, count, max, known }
 *   welcome    { state }                 Resposta ao hello (o estado inclui selfId e myVote).
 *   state      { state }                 Estado completo sanitizado (sem valores de voto antes da revelação).
 *   event      { kind, id?, name? }      Evento para efeitos locais (som/toast):
 *                                        join | leave | vote | reveal | newRound | consensus
 *   throw      { id, fromId, toId, item, emoji? }   Arremesso validado; todos animam ao mesmo tempo.
 *   reject     { reason }                full | invalid | duplicate | busy
 *   roomClosed { reason }                O host encerrou a sala.
 *   hostLeaving {}                       A aba do host está fechando/recarregando: o cliente tenta
 *                                        reconectar na hora (volta se foi só um F5 do host).
 *   ping       {}                        Heartbeat.
 *
 * Mensagens inválidas (tipo desconhecido, tamanho excessivo, jogador inexistente,
 * valores fora do esperado) são simplesmente ignoradas pelo host.
 */

import {
  RoomState,
  MAX_JOGADORES,
  MAX_NOME,
  MAX_NOME_SALA,
  SOMENTE_HOST_CONTROLA,
  ITENS_ARREMESSO,
  LIMITE_ARREMESSOS,
  REGEX_PLAYER_ID,
  sanitizeText,
  sanitizeEmoji,
  generateId,
} from './state.js';

// ============================================================================
// Configurações de rede
// ============================================================================

export const PREFIXO_PEER = 'planning-poker-';
/** Tempo máximo para conectar ao servidor de signaling / ao host. */
export const TIMEOUT_CONEXAO_MS = 10000;
/** Quanto tempo o host espera um jogador desconectado voltar antes de removê-lo. */
export const TOLERANCIA_DESCONEXAO_MS = 10000;
/** Por quanto tempo o cliente tenta reconectar ao host antes de desistir. */
export const JANELA_RECONEXAO_MS = 9000;
const INTERVALO_PING_MS = 2000;
/** Sem receber nada por esse tempo, a conexão é considerada morta. */
const TIMEOUT_SILENCIO_MS = 8000;
/** Conexões que nunca enviaram hello são fechadas após esse tempo. */
const TIMEOUT_PENDENTE_MS = 10 * 60 * 1000;
const MAX_CONEXOES_PENDENTES = 20;
/** Tamanho máximo (em caracteres JSON) de uma mensagem cliente → host. */
const MAX_TAMANHO_MSG = 1024;

const OPCOES_PEER = {
  debug: 0, // 0 = sem logs do PeerJS no console (os erros são tratados aqui)
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ],
  },
};

const ERROS_DE_SERVIDOR = ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'];

// ============================================================================
// Utilitários
// ============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function peerDisponivel() {
  return typeof window.Peer === 'function';
}

/** Traduz erros do PeerJS / desta camada para mensagens amigáveis. */
export function mensagemErro(err) {
  switch (err?.type) {
    case 'lib':
      return 'Não foi possível carregar a biblioteca de conexão (PeerJS). Verifique sua internet ou se algum bloqueador de conteúdo está ativo.';
    case 'browser-incompatible':
      return 'Seu navegador não suporta WebRTC. Use uma versão atualizada do Chrome, Firefox, Edge ou Safari.';
    case 'peer-unavailable':
    case 'timeout':
    case 'lost':
      return 'Sala não encontrada ou encerrada.';
    case 'unavailable-id':
      return 'Este código de sala já está em uso.';
    case 'ssl-unavailable':
      return 'O site precisa ser aberto via HTTPS.';
    case 'webrtc':
      return 'Falha na conexão direta entre navegadores. Redes corporativas, VPNs ou firewalls podem bloquear o WebRTC.';
    case 'timeout-server':
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'disconnected':
      return 'Não foi possível falar com o servidor de conexão. Verifique sua internet e tente novamente.';
    case 'busy':
      return 'A sala está recebendo muitas conexões agora. Tente novamente em instantes.';
    default:
      return 'Ocorreu um erro de conexão. Tente novamente.';
  }
}

/** Emissor de eventos mínimo. */
class Emitter {
  constructor() {
    this._handlers = {};
  }
  on(evento, fn) {
    (this._handlers[evento] ||= []).push(fn);
    return this;
  }
  emit(evento, ...args) {
    for (const fn of this._handlers[evento] || []) {
      try {
        fn(...args);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

function enviar(conn, msg) {
  try {
    if (conn && conn.open) conn.send(msg);
  } catch {
    /* conexão caindo: o heartbeat cuida do resto */
  }
}

// ============================================================================
// HOST
// ============================================================================

/**
 * Eventos emitidos: state(publicState), event(msg), throw(msg), banner(texto|null)
 */
export class HostSession extends Emitter {
  constructor({ roomId, roomName, playerId, name }) {
    super();
    this.isHost = true;
    this.roomId = roomId;
    this.playerId = playerId;
    this.room = new RoomState(roomId, roomName);
    this.room.addPlayer(playerId, name, true);

    this.peer = null;
    /** @type {Map<object, {conn:any, playerId:string|null, lastSeen:number, createdAt:number}>} */
    this.conns = new Map();
    /** playerId → registro da conexão ativa */
    this.byPlayer = new Map();
    this.removalTimers = new Map();
    this.throwLog = new Map();
    this.closed = false;
    this.heartbeat = null;
    this.serverRetry = null;
  }

  /** Registra o Peer ID da sala no servidor de signaling. */
  start() {
    if (!peerDisponivel()) return Promise.reject({ type: 'lib' });
    return new Promise((resolve, reject) => {
      let aberto = false;
      const peer = new window.Peer(PREFIXO_PEER + this.roomId, OPCOES_PEER);
      this.peer = peer;

      const timer = setTimeout(() => {
        if (aberto) return;
        try { peer.destroy(); } catch { /* ignora */ }
        reject({ type: 'timeout-server' });
      }, TIMEOUT_CONEXAO_MS);

      peer.on('open', () => {
        if (!aberto) {
          aberto = true;
          clearTimeout(timer);
          this._startHeartbeat();
          resolve();
        } else {
          this.emit('banner', null); // reconectou ao servidor de signaling
        }
      });

      peer.on('connection', (conn) => this._onConnection(conn));

      peer.on('disconnected', () => {
        if (this.closed || !aberto) return;
        this.emit('banner', 'Conexão com o servidor perdida. Quem já está na sala continua jogando; novos participantes só entram após reconectar…');
        this._scheduleServerReconnect();
      });

      peer.on('error', (err) => {
        if (!aberto) {
          clearTimeout(timer);
          try { peer.destroy(); } catch { /* ignora */ }
          reject(err);
          return;
        }
        if (ERROS_DE_SERVIDOR.includes(err?.type)) this._scheduleServerReconnect();
      });
    });
  }

  /** Estado público do ponto de vista do host. */
  snapshot() {
    return this.room.toPublic(this.playerId);
  }

  /** Ação do próprio host (mesmo fluxo de validação dos clientes). */
  send(msg) {
    if (this.closed || !msg || typeof msg !== 'object') return;
    this._process(this.playerId, msg);
  }

  /** Chamado no pagehide: avisa os clientes para reconectarem já (F5 do host) ou detectarem a saída. */
  notifyUnload() {
    if (this.closed) return;
    for (const rec of this.byPlayer.values()) enviar(rec.conn, { type: 'hostLeaving' });
  }

  /** Encerra a sala para todos. */
  leave() {
    if (this.closed) return;
    this._broadcast({ type: 'roomClosed', reason: 'hostLeft' });
    this.destroy(300); // dá tempo da mensagem sair antes de derrubar o peer
  }

  destroy(atrasoMs = 0) {
    this.closed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.serverRetry);
    for (const t of this.removalTimers.values()) clearTimeout(t);
    this.removalTimers.clear();
    const peer = this.peer;
    if (peer) setTimeout(() => { try { peer.destroy(); } catch { /* ignora */ } }, atrasoMs);
  }

  // ---- conexões --------------------------------------------------------

  _scheduleServerReconnect() {
    if (this.serverRetry || this.closed) return;
    this.serverRetry = setTimeout(() => {
      this.serverRetry = null;
      const peer = this.peer;
      if (this.closed || !peer || peer.destroyed) return;
      if (peer.disconnected) {
        try { peer.reconnect(); } catch { /* tenta de novo */ }
        this._scheduleServerReconnect();
      }
    }, 3000);
  }

  _onConnection(conn) {
    if (this.closed) {
      try { conn.close(); } catch { /* ignora */ }
      return;
    }
    const rec = { conn, playerId: null, lastSeen: Date.now(), createdAt: Date.now() };
    const pendentes = [...this.conns.values()].filter((r) => !r.playerId).length;
    if (pendentes >= MAX_CONEXOES_PENDENTES) {
      conn.on('open', () => this._reject(rec, 'busy'));
      return;
    }
    this.conns.set(conn, rec);
    conn.on('data', (data) => {
      if (!this.conns.has(conn)) return;
      rec.lastSeen = Date.now();
      this._onData(rec, data);
    });
    conn.on('close', () => this._dropConnection(rec));
    conn.on('error', () => this._dropConnection(rec));
  }

  /** Conexão caiu: marca o jogador como desconectado e agenda a remoção. */
  _dropConnection(rec) {
    if (!this.conns.delete(rec.conn)) return;
    try { rec.conn.close(); } catch { /* ignora */ }

    const pid = rec.playerId;
    if (!pid || this.byPlayer.get(pid) !== rec) return;
    this.byPlayer.delete(pid);

    const p = this.room.players.get(pid);
    if (!p) return;
    p.connected = false;
    this._broadcastState();

    clearTimeout(this.removalTimers.get(pid));
    this.removalTimers.set(pid, setTimeout(() => {
      this.removalTimers.delete(pid);
      const atual = this.room.players.get(pid);
      if (atual && !atual.connected) this._removePlayer(pid);
    }, TOLERANCIA_DESCONEXAO_MS));
  }

  _removePlayer(pid) {
    const p = this.room.players.get(pid);
    if (!p) return;
    clearTimeout(this.removalTimers.get(pid));
    this.removalTimers.delete(pid);
    this.room.removePlayer(pid);
    this.throwLog.delete(pid);
    this._broadcastState();
    this._broadcast({ type: 'event', kind: 'leave', id: p.seatId, name: p.name });
  }

  _reject(rec, reason) {
    enviar(rec.conn, { type: 'reject', reason });
    this.conns.delete(rec.conn);
    setTimeout(() => { try { rec.conn.close(); } catch { /* ignora */ } }, 500);
  }

  // ---- mensagens -------------------------------------------------------

  _onData(rec, data) {
    // Validação básica: objeto, com type string e tamanho limitado
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.type !== 'string') return;
    try {
      if (JSON.stringify(data).length > MAX_TAMANHO_MSG) return;
    } catch {
      return;
    }

    switch (data.type) {
      case 'ping':
        return;
      case 'info': {
        const known = typeof data.playerId === 'string'
          && data.playerId !== this.playerId
          && this.room.players.has(data.playerId);
        enviar(rec.conn, {
          type: 'info',
          roomName: this.room.roomName,
          count: this.room.size,
          max: MAX_JOGADORES,
          known,
        });
        return;
      }
      case 'hello':
        this._onHello(rec, data);
        return;
      default:
        break;
    }

    // Daqui pra baixo, só conexões que já entraram na sala
    if (!rec.playerId || this.byPlayer.get(rec.playerId) !== rec) return;

    if (data.type === 'leave') {
      const pid = rec.playerId;
      this.conns.delete(rec.conn);
      this.byPlayer.delete(pid);
      this._removePlayer(pid);
      setTimeout(() => { try { rec.conn.close(); } catch { /* ignora */ } }, 200);
      return;
    }
    this._process(rec.playerId, data);
  }

  _onHello(rec, msg) {
    if (rec.playerId) return; // já entrou por esta conexão
    const playerId = msg.playerId;
    if (typeof playerId !== 'string' || !REGEX_PLAYER_ID.test(playerId)) return this._reject(rec, 'invalid');
    if (playerId === this.playerId) return this._reject(rec, 'duplicate');
    const nome = sanitizeText(msg.name, MAX_NOME);
    if (!nome) return this._reject(rec, 'invalid');

    let jogador = this.room.players.get(playerId);
    const novo = !jogador;
    if (novo && this.room.size >= MAX_JOGADORES) return this._reject(rec, 'full');
    if (novo) jogador = this.room.addPlayer(playerId, nome, false);
    // Reconexão: mantém lugar, nome e voto (mapeado pelo playerId, não pelo Peer ID)

    clearTimeout(this.removalTimers.get(playerId));
    this.removalTimers.delete(playerId);

    // Se havia outra conexão para o mesmo jogador (ex.: F5), ela é descartada
    const antiga = this.byPlayer.get(playerId);
    if (antiga && antiga !== rec) {
      this.conns.delete(antiga.conn);
      try { antiga.conn.close(); } catch { /* ignora */ }
    }

    rec.playerId = playerId;
    this.byPlayer.set(playerId, rec);
    jogador.connected = true;

    enviar(rec.conn, { type: 'welcome', state: this.room.toPublic(playerId) });
    this._broadcastState();
    if (novo) this._broadcast({ type: 'event', kind: 'join', id: jogador.seatId, name: jogador.name });
  }

  /** Processa uma ação de jogo (do host ou de um cliente já validado). */
  _process(pid, msg) {
    const p = this.room.players.get(pid);
    if (!p) return;
    const podeControlar = !SOMENTE_HOST_CONTROLA || p.isHost;

    switch (msg.type) {
      case 'vote':
        if (typeof msg.value === 'string' && this.room.vote(pid, msg.value)) {
          this._broadcastState();
          this._broadcast({ type: 'event', kind: 'vote' });
        }
        break;
      case 'clearVote':
        if (this.room.clearVote(pid)) this._broadcastState();
        break;
      case 'reveal':
        if (podeControlar && this.room.reveal()) {
          this._broadcastState();
          this._broadcast({ type: 'event', kind: 'reveal' });
          if (this.room.stats().consensus) this._broadcast({ type: 'event', kind: 'consensus' });
        }
        break;
      case 'newRound':
        if (podeControlar && this.room.newRound()) {
          this._broadcastState();
          this._broadcast({ type: 'event', kind: 'newRound' });
        }
        break;
      case 'throw':
        this._onThrow(p, msg);
        break;
      default:
        break; // tipo desconhecido: ignora
    }
  }

  _onThrow(de, msg) {
    const alvo = typeof msg.toId === 'string' ? this.room.findBySeat(msg.toId) : null;
    if (!alvo || alvo === de) return;
    const item = ITENS_ARREMESSO.find((i) => i.id === msg.item);
    if (!item) return;
    const emoji = item.livre ? sanitizeEmoji(msg.emoji) || item.emoji : undefined;

    // Rate limit: no máximo N arremessos por jogador a cada janela
    const agora = Date.now();
    const log = (this.throwLog.get(de.playerId) || []).filter((t) => agora - t < LIMITE_ARREMESSOS.janelaMs);
    if (log.length >= LIMITE_ARREMESSOS.max) {
      this.throwLog.set(de.playerId, log);
      return;
    }
    log.push(agora);
    this.throwLog.set(de.playerId, log);

    const out = { type: 'throw', id: generateId(8), fromId: de.seatId, toId: alvo.seatId, item: item.id };
    if (emoji) out.emoji = emoji;
    this._broadcast(out);
  }

  // ---- envio -----------------------------------------------------------

  /** Envia o estado personalizado para cada jogador (cada um recebe só o próprio voto). */
  _broadcastState() {
    for (const [pid, rec] of this.byPlayer) enviar(rec.conn, { type: 'state', state: this.room.toPublic(pid) });
    this.emit('state', this.snapshot());
  }

  /** Envia a todos os jogadores conectados e também dispara localmente no host. */
  _broadcast(msg) {
    for (const rec of this.byPlayer.values()) enviar(rec.conn, msg);
    if (msg.type === 'event') this.emit('event', msg);
    else if (msg.type === 'throw') this.emit('throw', msg);
  }

  _startHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      const agora = Date.now();
      for (const rec of [...this.conns.values()]) {
        const silencioso = agora - rec.lastSeen > TIMEOUT_SILENCIO_MS;
        const pendenteDemais = !rec.playerId && agora - rec.createdAt > TIMEOUT_PENDENTE_MS;
        if (silencioso || pendenteDemais) {
          this._dropConnection(rec);
          continue;
        }
        enviar(rec.conn, { type: 'ping' });
      }
    }, INTERVALO_PING_MS);
  }
}

// ============================================================================
// CLIENTE
// ============================================================================

/**
 * Eventos emitidos: state(publicState), event(msg), throw(msg),
 * reconnecting(), reconnected(), closed(reason: 'hostLeft' | 'full')
 */
export class ClientSession extends Emitter {
  constructor({ roomId, playerId }) {
    super();
    this.isHost = false;
    this.roomId = roomId;
    this.hostPeerId = PREFIXO_PEER + roomId;
    this.playerId = playerId;
    this.name = '';
    this.peer = null;
    this.conn = null;
    this.joined = false;
    this.closed = false;
    this.reconnecting = false;
    this.lastSeen = 0;
    this.lastState = null;
    this.waiters = [];
    this.pendingConnect = null;
    this.heartbeat = null;
  }

  /**
   * Conecta ao host e consulta as informações da sala (sem ocupar vaga).
   * Rejeita com {type:'peer-unavailable'|'timeout'} se a sala não existir.
   */
  async connect() {
    if (!peerDisponivel()) throw { type: 'lib' };
    await this._ensurePeer();
    const conn = await this._openConnection(TIMEOUT_CONEXAO_MS);
    if (this.closed) throw { type: 'lost' };
    this._attach(conn);
    this._startHeartbeat();
    this.send({ type: 'info', playerId: this.playerId });
    const info = await this._waitFor(['info'], TIMEOUT_CONEXAO_MS);
    return {
      roomName: sanitizeText(String(info.roomName ?? ''), MAX_NOME_SALA) || 'Sala',
      count: Number(info.count) || 0,
      max: Number(info.max) || MAX_JOGADORES,
      known: info.known === true,
    };
  }

  /** Entra na sala. Rejeita com {type:'reject', reason} se o host recusar. */
  async join(nome) {
    this.name = nome;
    this.send({ type: 'hello', playerId: this.playerId, name: nome });
    const resp = await this._waitFor(['welcome', 'reject'], TIMEOUT_CONEXAO_MS);
    if (resp.type === 'reject') throw { type: 'reject', reason: resp.reason };
    this.joined = true;
    return this.lastState;
  }

  send(msg) {
    enviar(this.conn, msg);
  }

  /** Sai da sala avisando o host (remoção imediata). */
  leave() {
    if (this.closed) return;
    this.send({ type: 'leave' });
    this.closed = true;
    this._rejectWaiters({ type: 'closed' });
    setTimeout(() => this.destroy(), 250);
  }

  destroy() {
    this.closed = true;
    clearInterval(this.heartbeat);
    const conn = this.conn;
    this.conn = null;
    try { conn?.close(); } catch { /* ignora */ }
    try { this.peer?.destroy(); } catch { /* ignora */ }
  }

  // ---- internos --------------------------------------------------------

  /** Garante um Peer aberto no servidor de signaling. */
  _ensurePeer() {
    const atual = this.peer;
    if (atual && !atual.destroyed && !atual.disconnected && atual.open) return Promise.resolve();

    return new Promise((resolve, reject) => {
      if (!this.peer || this.peer.destroyed) {
        this.peer = new window.Peer(OPCOES_PEER);
        this.peer.on('error', (err) => this._onPeerError(err));
      } else if (this.peer.disconnected) {
        try { this.peer.reconnect(); } catch { /* ignora */ }
      }
      const peer = this.peer;

      const finalizar = (err) => {
        clearTimeout(timer);
        peer.off('open', onOpen);
        peer.off('error', onError);
        if (err) {
          try { peer.destroy(); } catch { /* ignora */ }
          reject(err);
        } else {
          resolve();
        }
      };
      const onOpen = () => finalizar();
      const onError = (err) => {
        if (err?.type === 'peer-unavailable') return; // não é sobre o signaling
        finalizar(err?.type ? err : { type: 'network' });
      };
      const timer = setTimeout(() => finalizar({ type: 'timeout-server' }), TIMEOUT_CONEXAO_MS);
      peer.on('open', onOpen);
      peer.on('error', onError);
    });
  }

  /** Abre um DataConnection com o host, com timeout. */
  _openConnection(timeoutMs) {
    return new Promise((resolve, reject) => {
      let conn;
      try {
        conn = this.peer.connect(this.hostPeerId, { reliable: true, serialization: 'json' });
      } catch {
        reject({ type: 'webrtc' });
        return;
      }
      if (!conn) {
        reject({ type: 'network' });
        return;
      }
      let terminou = false;
      const finalizar = (err) => {
        if (terminou) return;
        terminou = true;
        clearTimeout(timer);
        if (this.pendingConnect === onPeerError) this.pendingConnect = null;
        if (err) {
          try { conn.close(); } catch { /* ignora */ }
          reject(err);
        } else {
          resolve(conn);
        }
      };
      // Erros como 'peer-unavailable' chegam pelo Peer, não pela conexão
      const onPeerError = (err) => finalizar(err);
      this.pendingConnect = onPeerError;
      const timer = setTimeout(() => finalizar({ type: 'timeout' }), timeoutMs);
      conn.on('open', () => finalizar(null));
      conn.on('error', (err) => finalizar(err?.type ? err : { type: 'webrtc' }));
    });
  }

  _onPeerError(err) {
    if (this.pendingConnect) {
      this.pendingConnect(err?.type ? err : { type: 'network' });
      return;
    }
    // Queda do signaling não derruba DataConnections existentes; o peer é
    // reaberto sob demanda em _ensurePeer() quando precisarmos reconectar.
  }

  _attach(conn) {
    this.conn = conn;
    this.lastSeen = Date.now();
    conn.on('data', (d) => { if (this.conn === conn) this._onMessage(d); });
    conn.on('close', () => { if (this.conn === conn) this._onConnectionLost(); });
    conn.on('error', () => { if (this.conn === conn) this._onConnectionLost(); });
  }

  _onMessage(msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    this.lastSeen = Date.now();

    switch (msg.type) {
      case 'welcome':
      case 'state':
        if (msg.state && typeof msg.state === 'object') {
          this.lastState = msg.state;
          this.emit('state', msg.state);
        }
        break;
      case 'event':
        this.emit('event', msg);
        break;
      case 'throw':
        this.emit('throw', msg);
        break;
      case 'roomClosed':
        this._fail('hostLeft');
        return;
      case 'hostLeaving':
        this._onConnectionLost();
        return;
      case 'reject':
        // Recusa fora de um pedido pendente (raro): encerra
        if (this.joined && !this.reconnecting) this._fail(msg.reason === 'full' ? 'full' : 'hostLeft');
        break;
      default:
        break;
    }
    this._resolveWaiters(msg);
  }

  _onConnectionLost() {
    if (this.closed) return;
    const conn = this.conn;
    this.conn = null;
    try { conn?.close(); } catch { /* ignora */ }
    this._rejectWaiters({ type: 'lost' });
    if (!this.joined) {
      this._fail('hostLeft');
      return;
    }
    if (!this.reconnecting) this._reconnect();
  }

  /**
   * Tenta reconectar ao host por até JANELA_RECONEXAO_MS. Se o host
   * recarregou a página, ele recria a sala com o mesmo ID e voltamos.
   * Se não houver host, a sala é considerada encerrada.
   */
  async _reconnect() {
    this.reconnecting = true;
    this.emit('reconnecting');
    const prazo = Date.now() + JANELA_RECONEXAO_MS;

    while (!this.closed && Date.now() < prazo) {
      try {
        await this._ensurePeer();
        const conn = await this._openConnection(Math.max(1500, Math.min(5000, prazo - Date.now())));
        if (this.closed) {
          try { conn.close(); } catch { /* ignora */ }
          return;
        }
        this._attach(conn);
        this.send({ type: 'hello', playerId: this.playerId, name: this.name });
        const resp = await this._waitFor(['welcome', 'reject'], 5000);
        if (resp.type === 'reject') {
          this.reconnecting = false;
          this._fail(resp.reason === 'full' ? 'full' : 'hostLeft');
          return;
        }
        this.reconnecting = false;
        this.emit('reconnected');
        return;
      } catch {
        const c = this.conn;
        this.conn = null;
        try { c?.close(); } catch { /* ignora */ }
        await sleep(1500);
      }
    }
    this.reconnecting = false;
    this._fail('hostLeft');
  }

  _fail(reason) {
    if (this.closed) return;
    this.closed = true;
    this.reconnecting = false;
    this._rejectWaiters({ type: 'closed' });
    this.emit('closed', reason);
    this.destroy();
  }

  _startHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      if (this.closed || !this.conn) return;
      if (Date.now() - this.lastSeen > TIMEOUT_SILENCIO_MS) {
        this._onConnectionLost();
        return;
      }
      this.send({ type: 'ping' });
    }, INTERVALO_PING_MS);
  }

  _waitFor(tipos, ms) {
    return new Promise((resolve, reject) => {
      const w = { tipos, resolve, reject };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject({ type: 'timeout' });
      }, ms);
      this.waiters.push(w);
    });
  }

  _resolveWaiters(msg) {
    const atendidos = this.waiters.filter((w) => w.tipos.includes(msg.type));
    if (!atendidos.length) return;
    this.waiters = this.waiters.filter((w) => !atendidos.includes(w));
    for (const w of atendidos) {
      clearTimeout(w.timer);
      w.resolve(msg);
    }
  }

  _rejectWaiters(err) {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) {
      clearTimeout(w.timer);
      w.reject(err);
    }
  }
}
