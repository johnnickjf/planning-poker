/**
 * app.js — Inicialização, identidade do jogador, roteamento por hash e
 * orquestração entre rede (network.js), interface (ui.js) e som (sound.js).
 *
 * Rotas:
 *   #               → Homepage (landing)
 *   #criar          → Criar sala
 *   #sala=ABC123    → Entrar na sala (ou reabrir, se esta aba for o host)
 */

import { REGEX_ID_SALA, REGEX_PLAYER_ID, MAX_JOGADORES, MAX_NOME, MAX_NOME_SALA, generateId, generateUUID, sanitizeText } from './state.js';
import { HostSession, ClientSession, mensagemErro } from './network.js';
import * as ui from './ui.js';
import * as sound from './sound.js';

// ============================================================================
// Chaves de armazenamento
// ============================================================================
const LS_PLAYER_ID = 'pp-player-id';   // identidade persistente (localStorage)
const LS_NOME = 'pp-nome';             // último nome usado
const SS_ID_ABA = 'pp-tab-player-id';  // identidade alternativa desta aba (quando há outra aba aberta)
const SS_HOST = 'pp-host';             // "esta aba é host da sala X" (permite F5 do host)
const CANAL_IDENTIDADE = 'pp-identidade';
const ATRASO_CONFETE_MS = 650;         // espera as cartas virarem antes de comemorar
const SALA_INVALIDA = Symbol('sala-invalida');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignora */ } }
function ssGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignora */ } }
function ssDel(k) { try { sessionStorage.removeItem(k); } catch { /* ignora */ } }

// ============================================================================
// Identidade (playerId)
// ============================================================================
/*
 * O playerId fica no localStorage, então F5 ou queda de conexão recuperam o
 * mesmo lugar, nome e voto. Para permitir testar com duas abas do mesmo
 * navegador, a aba pergunta via BroadcastChannel se outra aba já usa esse ID;
 * se sim, gera um ID próprio guardado no sessionStorage (sobrevive ao F5 da aba).
 */
let identidadeAtual = null;
let canal = null;

function idEmUso(id) {
  return new Promise((resolve) => {
    const h = (e) => {
      if (e.data?.r === 'meu' && e.data.id === id) {
        clearTimeout(t);
        canal.removeEventListener('message', h);
        resolve(true);
      }
    };
    const t = setTimeout(() => {
      canal.removeEventListener('message', h);
      resolve(false);
    }, 250);
    canal.addEventListener('message', h);
    canal.postMessage({ q: 'quem', id });
  });
}

async function obterIdentidade() {
  let id = ssGet(SS_ID_ABA) || lsGet(LS_PLAYER_ID);
  if (!id || !REGEX_PLAYER_ID.test(id)) {
    id = generateUUID();
    lsSet(LS_PLAYER_ID, id);
  }
  if ('BroadcastChannel' in window) {
    try {
      canal = new BroadcastChannel(CANAL_IDENTIDADE);
      if (await idEmUso(id)) {
        id = generateUUID();
        ssSet(SS_ID_ABA, id);
      }
      canal.onmessage = (e) => {
        if (e.data?.q === 'quem' && e.data.id === identidadeAtual) canal.postMessage({ r: 'meu', id: identidadeAtual });
      };
    } catch {
      /* sem BroadcastChannel: segue com o ID do localStorage */
    }
  }
  identidadeAtual = id;
  return id;
}

function novaIdentidadeDaAba() {
  identidadeAtual = generateUUID();
  ssSet(SS_ID_ABA, identidadeAtual);
  return identidadeAtual;
}

// ============================================================================
// Registro do host (sessionStorage, por aba)
// ============================================================================
function lerRegistroHost() {
  try {
    const r = JSON.parse(ssGet(SS_HOST) || 'null');
    if (r && REGEX_ID_SALA.test(r.roomId) && typeof r.roomName === 'string' && typeof r.name === 'string') {
      const roomName = sanitizeText(r.roomName, MAX_NOME_SALA);
      const name = sanitizeText(r.name, MAX_NOME);
      if (roomName && name) return { roomId: r.roomId, roomName, name };
    }
  } catch { /* ignora */ }
  return null;
}
const salvarRegistroHost = (r) => ssSet(SS_HOST, JSON.stringify(r));
const limparRegistroHost = () => ssDel(SS_HOST);

// ============================================================================
// Estado da aplicação
// ============================================================================
let identidadePronta = null;
let session = null;          // HostSession | ClientSession | null
let currentRoomId = null;
let roomVisible = false;
let lastState = null;
let salaRecemCriada = null;  // roomId criado nesta aba agora (para tratar colisão de ID)

const linkDaSala = (roomId) => `${location.origin}${location.pathname}#sala=${roomId}`;

function lerSalaDoHash() {
  const m = location.hash.match(/(?:^#|&)sala=([^&]*)/);
  if (!m) return null;
  let id = '';
  try { id = decodeURIComponent(m[1]).trim().toUpperCase(); } catch { return SALA_INVALIDA; }
  return REGEX_ID_SALA.test(id) ? id : SALA_INVALIDA;
}

// ============================================================================
// Roteamento
// ============================================================================
function route() {
  const roomId = lerSalaDoHash();
  if (session && roomId === currentRoomId) return;
  teardown();

  if (!roomId) {
    if (location.hash.startsWith('#criar')) ui.showHome({ name: lsGet(LS_NOME) || '' });
    else ui.showLanding();
    return;
  }
  if (roomId === SALA_INVALIDA) {
    mostrarNaoEncontrada();
    return;
  }
  currentRoomId = roomId;
  const host = lerRegistroHost();
  if (host && host.roomId === roomId) iniciarHost(host);
  else iniciarCliente(roomId);
}

/** Encerra a sessão atual (host: encerra a sala; cliente: sai da sala). */
function teardown() {
  const s = session;
  session = null;
  roomVisible = false;
  lastState = null;
  currentRoomId = null;
  if (s) {
    if (s.isHost) limparRegistroHost();
    s.leave();
  }
  ui.setBanner(null);
}

function irParaHome() {
  teardown();
  limparRegistroHost();
  if (location.hash) history.pushState(null, '', location.pathname + location.search);
  route();
}

function irParaCriar() {
  teardown();
  limparRegistroHost();
  history.pushState(null, '', '#criar');
  route();
}

function tentarNovamente() {
  const s = session;
  session = null;
  if (s) s.destroy();
  currentRoomId = null;
  route();
}

// ============================================================================
// Host
// ============================================================================
function criarSala({ name, roomName }) {
  lsSet(LS_NOME, name);
  const roomId = generateId();
  salvarRegistroHost({ roomId, roomName, name });
  salaRecemCriada = roomId;
  location.hash = `sala=${roomId}`; // dispara hashchange → route() → iniciarHost()
}

async function iniciarHost(reg, tentativa = 0) {
  const recemCriada = salaRecemCriada === reg.roomId;
  ui.showLoading(recemCriada ? 'Criando a sala…' : 'Reabrindo a sala…');
  const playerId = await identidadePronta;
  if (currentRoomId !== reg.roomId) return;

  const s = new HostSession({ roomId: reg.roomId, roomName: reg.roomName, playerId, name: reg.name });
  session = s;
  vincularSessao(s);

  try {
    await s.start();
  } catch (err) {
    if (session !== s) return;
    session = null;
    s.destroy();

    if (err?.type === 'unavailable-id') {
      if (recemCriada) {
        // Colisão de ID no broker público: gera outro código e tenta de novo
        const novo = { ...reg, roomId: generateId() };
        salvarRegistroHost(novo);
        salaRecemCriada = novo.roomId;
        currentRoomId = novo.roomId;
        history.replaceState(null, '', `#sala=${novo.roomId}`);
        iniciarHost(novo);
        return;
      }
      // Host deu F5: o servidor ainda pode estar segurando o ID antigo por alguns segundos
      if (tentativa < 6) {
        await sleep(1500);
        if (currentRoomId !== reg.roomId || session) return;
        iniciarHost(reg, tentativa + 1);
        return;
      }
      // Provavelmente outra aba é o host desta sala: entra como participante
      limparRegistroHost();
      iniciarCliente(reg.roomId);
      return;
    }
    mostrarErro('Não foi possível criar a sala', err);
    return;
  }

  if (session !== s) {
    s.leave();
    return;
  }
  salaRecemCriada = null;
  roomVisible = true;
  ui.showRoom({ link: linkDaSala(reg.roomId) });
  lastState = s.snapshot();
  ui.renderState(lastState);
  ui.toast(recemCriada ? 'Sala criada! Copie o link e convide o time.' : 'Sala reaberta.');
}

// ============================================================================
// Cliente
// ============================================================================
async function iniciarCliente(roomId) {
  ui.showLoading('Conectando à sala…');
  const playerId = await identidadePronta;
  if (currentRoomId !== roomId) return;

  const s = new ClientSession({ roomId, playerId });
  session = s;
  vincularSessao(s);

  let info;
  try {
    info = await s.connect();
  } catch (err) {
    if (session !== s) return;
    session = null;
    s.destroy();
    mostrarErroDeConexao(err);
    return;
  }
  if (session !== s) return;

  const nomeSalvo = sanitizeText(lsGet(LS_NOME) || '', MAX_NOME);
  // Reconexão após F5: o host já conhece este playerId → volta direto
  if (info.known && nomeSalvo) {
    entrar(s, nomeSalvo);
    return;
  }
  if (info.count >= info.max) {
    session = null;
    s.destroy();
    mostrarSalaCheia();
    return;
  }
  ui.showJoin({ roomName: info.roomName, count: info.count, max: info.max, name: nomeSalvo });
}

async function entrar(s, nome, jaTentouNovaIdentidade = false) {
  lsSet(LS_NOME, nome);
  ui.setJoinBusy(true);
  try {
    await s.join(nome);
  } catch (err) {
    if (session !== s) return;
    ui.setJoinBusy(false);
    if (err?.type === 'reject') {
      if (err.reason === 'duplicate' && !jaTentouNovaIdentidade) {
        // Mesmo navegador do host (ID repetido): usa uma identidade só desta aba
        s.playerId = novaIdentidadeDaAba();
        entrar(s, nome, true);
        return;
      }
      if (err.reason === 'invalid') {
        ui.showJoinError('Nome inválido. Use letras, números ou emojis.');
        return;
      }
      session = null;
      s.destroy();
      if (err.reason === 'full') mostrarSalaCheia();
      else mostrarErro('Não foi possível entrar na sala', { type: err.reason });
      return;
    }
    if (err?.type === 'closed') return; // já tratado pelo evento 'closed'
    session = null;
    s.destroy();
    mostrarErroDeConexao(err);
    return;
  }
  if (session !== s) return;
  roomVisible = true;
  ui.showRoom({ link: linkDaSala(s.roomId) });
  lastState = s.lastState;
  ui.renderState(lastState);
}

// ============================================================================
// Eventos da sessão → UI / som
// ============================================================================
function vincularSessao(s) {
  s.on('state', (st) => {
    if (session !== s) return;
    lastState = st;
    if (roomVisible) ui.renderState(st);
  });
  s.on('event', (ev) => {
    if (session === s && roomVisible) tratarEvento(ev);
  });
  s.on('throw', (msg) => {
    if (session === s && roomVisible) ui.animateThrow(msg);
  });
  s.on('sound', (msg) => {
    if (session !== s || !roomVisible) return;
    sound.play(msg.id);
    ui.mostrarSomTocado(msg);
  });
  s.on('banner', (texto) => {
    if (session === s) ui.setBanner(texto);
  });
  s.on('reconnecting', () => {
    if (session === s) ui.setBanner('Conexão perdida. Tentando reconectar…');
  });
  s.on('reconnected', () => {
    if (session !== s) return;
    ui.setBanner(null);
    ui.toast('Reconectado!');
  });
  s.on('closed', (motivo) => {
    if (session !== s) return;
    session = null;
    roomVisible = false;
    if (motivo === 'full') mostrarSalaCheia();
    else mostrarHostSaiu();
  });
}

function tratarEvento(ev) {
  const nome = typeof ev.name === 'string' ? sanitizeText(ev.name, MAX_NOME + 6) : '';
  const souEu = ev.id && ev.id === lastState?.selfId;
  // Sons automáticos só em: entrada, nova votação, consenso, todos diferentes e arremessos (ui.js)
  switch (ev.kind) {
    case 'join':
      sound.play('join');
      if (nome && !souEu) ui.toast(`${nome} entrou na sala`);
      break;
    case 'leave':
      if (nome) ui.toast(`${nome} saiu da sala`);
      break;
    case 'newRound':
      sound.play('newround');
      break;
    case 'consensus':
      setTimeout(() => {
        if (!roomVisible) return;
        sound.play('consensus');
        ui.celebrate();
      }, ATRASO_CONFETE_MS);
      break;
    case 'divergence':
      setTimeout(() => {
        if (roomVisible) sound.play('divergence');
      }, ATRASO_CONFETE_MS);
      break;
    default:
      break;
  }
}

// ============================================================================
// Ações vindas da UI
// ============================================================================
function sair() {
  if (session?.isHost && !window.confirm('Ao sair, a sala será encerrada para todos. Deseja continuar?')) return;
  irParaHome();
}

// ============================================================================
// Mensagens de erro / estado final
// ============================================================================
function mostrarNaoEncontrada() {
  ui.showMessage({
    icon: '🔍',
    title: 'Sala não encontrada ou encerrada',
    text: 'Confira o link ou peça um novo convite. Você também pode criar uma sala nova.',
    actions: [
      { label: 'Criar nova sala', primary: true, onClick: irParaCriar },
      { label: 'Tentar novamente', onClick: tentarNovamente },
    ],
  });
}

function mostrarSalaCheia() {
  ui.showMessage({
    icon: '👥',
    title: 'Sala cheia',
    text: `Esta sala já tem o máximo de ${MAX_JOGADORES} participantes.`,
    actions: [
      { label: 'Voltar ao início', primary: true, onClick: irParaHome },
      { label: 'Tentar novamente', onClick: tentarNovamente },
    ],
  });
}

function mostrarHostSaiu() {
  ui.showMessage({
    icon: '🚪',
    title: 'A sala foi encerrada porque o host saiu',
    text: 'Nada fica salvo: crie uma nova sala para continuar estimando.',
    actions: [
      { label: 'Criar nova sala', primary: true, onClick: irParaCriar },
      { label: 'Voltar ao início', onClick: irParaHome },
    ],
  });
}

function mostrarErro(titulo, err) {
  ui.showMessage({
    icon: '⚠️',
    title: titulo,
    text: mensagemErro(err),
    actions: [
      { label: 'Tentar novamente', primary: true, onClick: tentarNovamente },
      { label: 'Voltar ao início', onClick: irParaHome },
    ],
  });
}

function mostrarErroDeConexao(err) {
  if (['peer-unavailable', 'timeout', 'lost', 'closed'].includes(err?.type)) mostrarNaoEncontrada();
  else mostrarErro('Não foi possível conectar', err);
}

// ============================================================================
// Inicialização
// ============================================================================
function init() {
  sound.init();
  ui.init({
    onCreate: criarSala,
    onJoin: (nome) => {
      if (session && !session.isHost && !session.joined) entrar(session, nome);
    },
    onVote: (valor) => session?.send({ type: 'vote', value: valor }),
    onClearVote: () => session?.send({ type: 'clearVote' }),
    onReveal: () => session?.send({ type: 'reveal' }),
    onNewRound: () => session?.send({ type: 'newRound' }),
    onThrow: ({ toId, item, emoji }) => session?.send(emoji ? { type: 'throw', toId, item, emoji } : { type: 'throw', toId, item }),
    onSoundboard: (id) => session?.send({ type: 'sound', id }),
    onLeave: sair,
  });

  identidadePronta = obterIdentidade();

  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);

  // Host fechando/recarregando a aba: clientes reconectam ou detectam a saída imediatamente
  window.addEventListener('pagehide', () => {
    if (session?.isHost) session.notifyUnload();
  });

  // Avisa o host antes de fechar a aba com gente na sala
  window.addEventListener('beforeunload', (e) => {
    if (session?.isHost && !session.closed && (lastState?.players?.length || 0) > 1) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  route();
}

init();
