/**
 * ui.js — Renderização das telas, mesa, baralho, menu de arremessos e animações.
 *
 * Regra de segurança: dados vindos de usuários (nomes, nome da sala, emojis)
 * entram no DOM SOMENTE via textContent / createElement. Nada de innerHTML.
 */

import {
  BARALHO,
  ITENS_ARREMESSO,
  EMOJIS_RAPIDOS,
  LIMITE_ARREMESSOS,
  SOUNDBOARD,
  LIMITE_SOUNDBOARD,
  MAX_NOME,
  MAX_NOME_SALA,
  SOMENTE_HOST_CONTROLA,
  sanitizeText,
  sanitizeEmoji,
} from './state.js';
import * as sound from './sound.js';

// ============================================================================
// Configurações visuais
// ============================================================================
const DURACAO_MANCHA_MS = 6000;   // quanto tempo a mancha do ovo fica na carta
const DURACAO_DARDO_MS = 5000;    // quanto tempo o dardo fica cravado
const MAX_RESIDUOS_POR_CARTA = 6;
const DURACAO_CONFETE_MS = 2800;
const DURACAO_TOAST_MS = 2600;
const DURACAO_PISCAR_SOM_MS = 3200;  // quanto tempo o botão de som pisca após um som silenciado
const ATRASO_VIRADA_MS = 70;      // atraso escalonado entre cartas ao revelar
const CORES_CONFETE = ['#00ffa3', '#6bffcb', '#ffb86c', '#e8eaed', '#ff8fab', '#7dd3fc'];

const $ = (id) => document.getElementById(id);
const movimentoReduzido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

let handlers = {};
let current = null;        // último estado recebido
let pendingVote;           // seleção otimista (undefined = nenhuma pendente)
let roomLink = '';
let centerKey = '';
let menuTargetId = null;
let menuReturnFocus = null;
let confettiToken = 0;
const playerEls = new Map();   // seatId → referências dos elementos do jogador
const activeAnims = new Set();
let meusArremessos = [];       // aviso local de rate limit
let piscarSomTimer = null;
let meusSons = [];             // aviso local de rate limit da soundboard
let dicaSomMostrada = false;

/** Cria um elemento com propriedades seguras. Filhos string viram nós de texto. */
function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const f of filhos) if (f !== null && f !== undefined) e.append(f);
  return e;
}

// ============================================================================
// Inicialização
// ============================================================================

export function init(h) {
  handlers = h;

  $('create-name').maxLength = MAX_NOME;
  $('join-name').maxLength = MAX_NOME;
  $('create-room').maxLength = MAX_NOME_SALA;

  $('form-create').addEventListener('submit', onCreateSubmit);
  $('form-join').addEventListener('submit', onJoinSubmit);
  for (const id of ['create-name', 'create-room', 'join-name']) {
    $(id).addEventListener('input', () => setFieldError(id, ''));
  }

  $('btn-copy').addEventListener('click', (e) => copyLink(e.currentTarget));
  $('btn-clear').addEventListener('click', () => { clearEffects(); toast('Efeitos limpos'); });
  $('btn-leave').addEventListener('click', () => handlers.onLeave?.());
  $('btn-reveal').addEventListener('click', () => handlers.onReveal?.());
  $('btn-new-round').addEventListener('click', () => handlers.onNewRound?.());
  $('btn-sound').addEventListener('click', () => {
    sound.setMuted(!sound.isMuted());
    updateSoundUI();
  });
  // Som tocou com o áudio mudo: o botão pisca indicando que dá pra ativar
  sound.onSomSilenciado(piscarBotaoSom);
  $('volume').addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    sound.setVolume(v);
    if (sound.isMuted() && v > 0) sound.setMuted(false);
    updateSoundUI();
  });

  // Landing: botões que rolam até uma seção (sem mexer no hash, que é usado pelo roteamento)
  for (const b of document.querySelectorAll('[data-scroll]')) {
    b.addEventListener('click', () => $(b.dataset.scroll)?.scrollIntoView({ behavior: movimentoReduzido() ? 'auto' : 'smooth', block: 'start' }));
  }
  observarRevelacoes();

  buildDeck();
  buildThrowMenu();
  buildSoundboard();
  updateSoundUI();
  window.addEventListener('resize', () => { closeThrowMenu(); closeSoundboard(); });
}

// ============================================================================
// Telas
// ============================================================================

const TELAS = ['loading', 'landing', 'home', 'join', 'message', 'room'];

function showScreen(nome) {
  closeThrowMenu();
  closeSoundboard();
  const mudou = $(`screen-${nome}`).hidden;
  for (const t of TELAS) $(`screen-${t}`).hidden = t !== nome;
  if (mudou) window.scrollTo(0, 0);
  if (nome !== 'room') {
    document.title = nome === 'landing' ? 'Planning Poker — estimativas em equipe, sem enrolação' : 'Planning Poker';
    setBanner(null);
  }
}

/** Homepage do projeto. */
export function showLanding() {
  showScreen('landing');
}

/** Elementos .reveal aparecem suavemente quando entram na tela. */
function observarRevelacoes() {
  const alvos = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || movimentoReduzido()) {
    alvos.forEach((a) => a.classList.add('is-visible'));
    return;
  }
  const obs = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-visible');
      obs.unobserve(e.target);
    }
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  alvos.forEach((a) => obs.observe(a));
}

export function showLoading(texto) {
  $('loading-text').textContent = texto;
  showScreen('loading');
}

export function showHome({ name = '' } = {}) {
  showScreen('home');
  $('create-name').value = name;
  $('create-room').value = '';
  setFieldError('create-name', '');
  setFieldError('create-room', '');
  setBusy('form-create', false);
  (name ? $('create-room') : $('create-name')).focus();
}

export function showJoin({ roomName, count, max, name = '' }) {
  $('join-room-name').textContent = roomName;
  $('join-count').textContent = `${count} de ${max} participantes na sala`;
  $('join-name').value = name;
  setFieldError('join-name', '');
  setBusy('form-join', false);
  showScreen('join');
  $('join-name').focus();
  $('join-name').select();
}

export function setJoinBusy(ocupado) {
  setBusy('form-join', ocupado);
}

export function showJoinError(msg) {
  setFieldError('join-name', msg);
  $('join-name').focus();
}

/** Tela genérica de mensagem (erro, sala cheia, sala encerrada...). */
export function showMessage({ icon = '⚠️', title, text = '', actions = [] }) {
  $('message-icon').textContent = icon;
  $('message-title').textContent = title;
  $('message-text').textContent = text;
  $('message-actions').replaceChildren(
    ...actions.map((a) => el('button', {
      type: 'button',
      class: `btn ${a.primary ? 'btn-primary' : 'btn-ghost'}`,
      text: a.label,
      onclick: a.onClick,
    })),
  );
  showScreen('message');
  $('message-actions').querySelector('button')?.focus();
}

export function showRoom({ link }) {
  roomLink = link;
  current = null;
  pendingVote = undefined;
  centerKey = '';
  playerEls.clear();
  $('row-top').replaceChildren();
  $('row-bottom').replaceChildren();
  $('table-center').replaceChildren();
  $('table').classList.remove('is-consensus');
  clearEffects();
  showScreen('room');
  updateSoundUI();
}

function onCreateSubmit(e) {
  e.preventDefault();
  const name = sanitizeText($('create-name').value, MAX_NOME);
  const roomName = sanitizeText($('create-room').value, MAX_NOME_SALA);
  setFieldError('create-name', name ? '' : 'Informe seu nome.');
  setFieldError('create-room', roomName ? '' : 'Informe o nome da sala.');
  if (!name || !roomName) {
    (name ? $('create-room') : $('create-name')).focus();
    return;
  }
  setBusy('form-create', true);
  handlers.onCreate?.({ name, roomName });
}

function onJoinSubmit(e) {
  e.preventDefault();
  const name = sanitizeText($('join-name').value, MAX_NOME);
  if (!name) {
    showJoinError('Informe seu nome.');
    return;
  }
  handlers.onJoin?.(name);
}

function setFieldError(id, msg) {
  $(`${id}-error`).textContent = msg;
  $(id).setAttribute('aria-invalid', msg ? 'true' : 'false');
}

function setBusy(formId, ocupado) {
  const btn = $(formId).querySelector('button[type="submit"]');
  btn.disabled = ocupado;
  btn.setAttribute('aria-busy', String(ocupado));
  btn.textContent = ocupado ? btn.dataset.busy : btn.dataset.label;
}

// ============================================================================
// Sala: renderização a partir do estado
// ============================================================================

export function renderState(state) {
  if (!state || !Array.isArray(state.players)) return;
  current = state;
  pendingVote = undefined; // o estado do host é a verdade

  const self = state.players.find((p) => p.id === state.selfId) || null;
  const canControl = !SOMENTE_HOST_CONTROLA || !!self?.isHost;

  const roomName = sanitizeText(String(state.roomName ?? ''), MAX_NOME_SALA) || 'Sala';
  $('room-name').textContent = roomName;
  document.title = `${roomName} · Planning Poker`;
  const contador = $('room-count');
  contador.textContent = `${state.players.length}/${state.max}`;
  contador.title = `${state.players.length} de ${state.max} participantes`;
  contador.setAttribute('aria-label', contador.title);

  renderPlayers(state, self);
  renderCenter(state, canControl);
  renderActions(state, canControl);
  renderDeck();

  if (menuTargetId && !state.players.some((p) => p.id === menuTargetId)) closeThrowMenu();
}

/** Distribui os jogadores em duas fileiras equilibradas; o próprio jogador fica embaixo. */
function renderPlayers(state, self) {
  const ids = new Set(state.players.map((p) => p.id));
  for (const [id, refs] of playerEls) {
    if (!ids.has(id)) {
      refs.root.remove();
      playerEls.delete(id);
    }
  }

  const outros = state.players.filter((p) => p !== self);
  const n = state.players.length;
  const qtdBaixo = self ? Math.max(1, Math.floor(n / 2)) : Math.floor(n / 2);
  const qtdCima = n - qtdBaixo;
  const cima = outros.slice(0, qtdCima);
  const baixo = outros.slice(qtdCima);
  if (self) baixo.splice(Math.floor(baixo.length / 2), 0, self);

  const stats = state.revealed ? state.stats : null;
  let idx = 0;
  for (const [fileira, lista] of [[$('row-top'), cima], [$('row-bottom'), baixo]]) {
    lista.forEach((p, i) => {
      let refs = playerEls.get(p.id);
      if (!refs) {
        refs = createPlayerEl(p, p === self);
        playerEls.set(p.id, refs);
      }
      updatePlayerEl(refs, p, state, stats, idx++);
      if (fileira.children[i] !== refs.root) fileira.insertBefore(refs.root, fileira.children[i] || null);
    });
  }
}

function createPlayerEl(p, isSelf) {
  const value = el('span', { class: 'pcard-value' });
  const inner = el('span', { class: 'pcard-inner' },
    el('span', { class: 'pcard-face pcard-back' }),
    el('span', { class: 'pcard-face pcard-front' }, value));
  const card = isSelf
    ? el('div', { class: 'pcard', role: 'img' }, inner)
    : el('button', { type: 'button', class: 'pcard', 'aria-haspopup': 'dialog' }, inner);
  const residue = el('span', { class: 'residue', 'aria-hidden': 'true' });
  const tag = el('span', { class: 'ptag', 'aria-hidden': 'true' });
  const hostBadge = el('span', { class: 'host-badge', role: 'img', 'aria-label': 'Host', title: 'Host da sala', text: '👑' });
  const nameText = el('span', { class: 'pname-text' });
  const root = el('div', { class: isSelf ? 'player is-self' : 'player' },
    tag,
    el('div', { class: 'pcard-wrap' }, card, residue),
    el('span', { class: 'pname' }, hostBadge, nameText));

  const refs = { id: p.id, isSelf, root, card, inner, value, residue, tag, hostBadge, nameText };
  if (!isSelf) card.addEventListener('click', () => openThrowMenu(refs.id, card));
  return refs;
}

function updatePlayerEl(refs, p, state, stats, idx) {
  const nome = String(p.name ?? '');
  const votoRevelado = state.revealed && p.vote != null ? String(p.vote) : null;
  const menor = !!(stats && stats.min != null && votoRevelado === stats.min);
  const maior = !!(stats && stats.max != null && votoRevelado === stats.max);

  const c = refs.root.classList;
  c.toggle('is-voted', !!p.voted);
  c.toggle('is-revealed', votoRevelado !== null);
  c.toggle('is-offline', !p.connected);
  c.toggle('is-low', menor);
  c.toggle('is-high', maior);

  refs.hostBadge.hidden = !p.isHost;
  refs.nameText.textContent = refs.isSelf ? `${nome} (você)` : nome;
  refs.root.title = p.connected ? '' : `${nome} está reconectando…`;
  refs.value.textContent = votoRevelado ?? '';
  refs.inner.style.transitionDelay = state.revealed ? `${idx * ATRASO_VIRADA_MS}ms` : '0ms';
  refs.tag.textContent = menor ? 'menor' : maior ? 'maior' : '';

  const situacao = votoRevelado !== null ? `votou ${votoRevelado}`
    : state.revealed ? 'não votou'
      : p.voted ? 'já votou' : 'ainda não votou';
  const extra = p.connected ? '' : ', reconectando';
  refs.card.setAttribute('aria-label', refs.isSelf
    ? `Você: ${situacao}`
    : `${nome}${p.isHost ? ' (host)' : ''}: ${situacao}${extra}. Arremessar algo`);
}

function renderCenter(state, canControl) {
  const n = state.players.length;
  const votaram = state.players.filter((p) => p.voted).length;
  const chave = JSON.stringify([state.revealed, state.round, state.allVoted, votaram, n, canControl, state.stats]);
  $('table').classList.toggle('is-consensus', !!(state.revealed && state.stats?.consensus));
  if (chave === centerKey) return;
  centerKey = chave;

  const nos = [];
  if (state.revealed && state.stats) {
    nos.push(...statsNodes(state.stats));
  } else if (state.allVoted && votaram > 0) {
    nos.push(el('p', { class: 'center-title', text: 'Todos votaram!' }));
    if (canControl) {
      nos.push(el('button', { type: 'button', class: 'btn btn-primary', text: 'Revelar', onclick: () => handlers.onReveal?.() }));
    } else {
      nos.push(el('p', { class: 'center-sub', text: 'Aguardando o host revelar…' }));
    }
  } else {
    nos.push(el('p', { class: 'center-title', text: 'Escolha suas cartas!' }));
    if (n > 1) nos.push(el('p', { class: 'center-sub', text: `${votaram} de ${n} votaram` }));
    else nos.push(inviteNode());
  }
  $('table-center').replaceChildren(...nos);
}

function statsNodes(stats) {
  const fmtNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? fmt.format(v) : '—');
  const stat = (rotulo, valor) => el('div', { class: 'stat' },
    el('span', { class: 'stat-value', text: valor }),
    el('span', { class: 'stat-label', text: rotulo }));

  const nos = [];
  if (stats.consensus) nos.push(el('p', { class: 'consensus-badge', text: '🎉 Consenso!' }));
  else if (stats.allDifferent) nos.push(el('p', { class: 'consensus-badge divergence-badge', text: '🤯 Ninguém concordou!' }));
  nos.push(el('div', { class: 'stats' },
    stat('Média', fmtNum(stats.average)),
    stat('Mediana', fmtNum(stats.median)),
    stat('Moda', Array.isArray(stats.mode) && stats.mode.length ? stats.mode.map(fmtNum).join(' · ') : '—')));
  if (Array.isArray(stats.distribution) && stats.distribution.length) {
    nos.push(el('div', { class: 'dist', role: 'list', 'aria-label': 'Distribuição dos votos' },
      ...stats.distribution.map((d) => el('span', { class: 'dist-chip', role: 'listitem', text: `${d.value} × ${d.count}` }))));
  }
  return nos;
}

function inviteNode() {
  const input = el('input', { class: 'invite-input', type: 'text', readonly: true, 'aria-label': 'Link da sala', value: roomLink });
  input.addEventListener('focus', () => input.select());
  const btn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: (e) => copyLink(e.currentTarget) },
    el('span', { class: 'btn-label', text: 'Copiar link' }));
  return el('div', { class: 'invite' },
    el('p', { class: 'center-sub', text: 'Convide o time compartilhando o link:' }),
    el('div', { class: 'invite-row' }, input, btn));
}

function renderActions(state, canControl) {
  const votaram = state.players.filter((p) => p.voted).length;
  const revelar = $('btn-reveal');
  const nova = $('btn-new-round');
  revelar.hidden = !canControl;
  nova.hidden = !canControl;
  revelar.disabled = state.revealed || votaram === 0;
  nova.disabled = !state.revealed && votaram === 0;
}

// ============================================================================
// Baralho
// ============================================================================

function buildDeck() {
  const deck = $('deck');
  for (const v of BARALHO) {
    const rotulo = v === '?' ? 'Votar: não sei' : v === '☕' ? 'Votar: pausa para café' : `Votar ${v}`;
    deck.append(el('button', {
      type: 'button',
      class: 'deck-card',
      'aria-pressed': 'false',
      'aria-label': rotulo,
      dataset: { value: v },
      text: v,
      onclick: () => onDeckClick(v),
    }));
  }
  // Navegação por setas entre as cartas
  deck.addEventListener('keydown', (e) => {
    const botoes = [...deck.querySelectorAll('.deck-card:not(:disabled)')];
    const i = botoes.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % botoes.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + botoes.length) % botoes.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = botoes.length - 1;
    if (j === null) return;
    e.preventDefault();
    botoes[j].focus();
    botoes[j].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

function meuVoto() {
  if (!current) return null;
  return pendingVote !== undefined ? pendingVote : current.myVote;
}

function onDeckClick(valor) {
  if (!current || current.revealed) return;
  if (meuVoto() === valor) {
    pendingVote = null; // clicar de novo na carta selecionada remove o voto
    handlers.onClearVote?.();
  } else {
    pendingVote = valor;
    handlers.onVote?.(valor);
  }
  renderDeck();
}

function renderDeck() {
  const meu = meuVoto();
  const travado = !current || current.revealed;
  $('deck').classList.toggle('is-locked', travado);
  for (const b of $('deck').children) {
    b.setAttribute('aria-pressed', String(b.dataset.value === meu));
    b.disabled = travado;
  }
  $('deck-label').textContent = travado
    ? 'Votos revelados — inicie uma nova votação para votar de novo'
    : meu != null ? 'Clique de novo na carta para remover seu voto' : 'Escolha sua carta';
}

// ============================================================================
// Menu de arremesso
// ============================================================================

function buildThrowMenu() {
  for (const item of ITENS_ARREMESSO) {
    $('throw-items').append(el('button', {
      type: 'button',
      class: 'throw-item',
      onclick: () => doThrow(item.id, item.livre ? item.emoji : undefined),
    },
    el('span', { class: 'throw-emo', 'aria-hidden': 'true', text: item.emoji }),
    el('span', { text: item.rotulo })));
  }
  for (const e of EMOJIS_RAPIDOS) {
    $('throw-emojis').append(el('button', {
      type: 'button', class: 'emoji-btn', 'aria-label': `Arremessar ${e}`, text: e, onclick: () => doThrow('emoji', e),
    }));
  }
  $('throw-custom').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const e = sanitizeEmoji($('custom-emoji').value);
    if (!e) {
      $('custom-emoji-error').textContent = 'Digite ou cole um emoji válido.';
      return;
    }
    doThrow('emoji', e);
  });
  $('custom-emoji').addEventListener('input', () => { $('custom-emoji-error').textContent = ''; });
  $('throw-close').addEventListener('click', () => closeThrowMenu());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('throw-menu').hidden) {
      e.preventDefault();
      closeThrowMenu();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    const menu = $('throw-menu');
    if (menu.hidden || menu.contains(e.target) || e.target.closest?.('.pcard')) return;
    closeThrowMenu(false);
  }, true);
}

function openThrowMenu(alvoId, ancora) {
  if (!current) return;
  const alvo = current.players.find((p) => p.id === alvoId);
  if (!alvo) return;
  menuTargetId = alvoId;
  menuReturnFocus = ancora;
  $('throw-title').textContent = `Arremessar em ${alvo.name}`;
  $('custom-emoji').value = '';
  $('custom-emoji-error').textContent = '';

  closeSoundboard(false);
  const menu = $('throw-menu');
  menu.hidden = false;
  posicionarPopover(menu, ancora);
  menu.querySelector('.throw-item')?.focus();
}

/** Posiciona um popover perto da âncora (no celular vira "bottom sheet" via CSS). */
function posicionarPopover(menu, ancora) {
  if (window.matchMedia('(max-width: 560px)').matches) {
    menu.style.left = '';
    menu.style.top = '';
    return;
  }
  const r = ancora.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = r.left + r.width / 2 - mw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  let top = r.bottom + 10;
  if (top + mh > window.innerHeight - 8) top = r.top - mh - 10;
  top = Math.max(8, top);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function closeThrowMenu(devolverFoco = true) {
  const menu = $('throw-menu');
  if (menu.hidden) return;
  const tinhaFoco = menu.contains(document.activeElement);
  menu.hidden = true;
  menuTargetId = null;
  if (devolverFoco && tinhaFoco && menuReturnFocus?.isConnected) menuReturnFocus.focus();
  menuReturnFocus = null;
}

function doThrow(item, emoji) {
  if (!menuTargetId) return;
  // Aviso local do rate limit (o host é quem realmente aplica)
  const agora = Date.now();
  meusArremessos = meusArremessos.filter((t) => agora - t < LIMITE_ARREMESSOS.janelaMs);
  if (meusArremessos.length >= LIMITE_ARREMESSOS.max) {
    toast('Calma! Muitos arremessos seguidos 😅');
    closeThrowMenu();
    return;
  }
  meusArremessos.push(agora);
  handlers.onThrow?.({ toId: menuTargetId, item, emoji });
  closeThrowMenu();
}

// ============================================================================
// Soundboard (sons que tocam para a sala inteira)
// ============================================================================

function buildSoundboard() {
  const grade = $('board-items');
  for (const som of SOUNDBOARD) {
    grade.append(el('button', {
      type: 'button',
      class: 'throw-item board-item',
      dataset: { som: som.id },
      'aria-label': `Tocar ${som.rotulo} para todos`,
      onclick: () => tocarParaTodos(som.id),
    },
    el('span', { class: 'throw-emo', 'aria-hidden': 'true', text: som.emoji }),
    el('span', { text: som.rotulo })));
  }
  $('btn-board').addEventListener('click', () => {
    if ($('board-menu').hidden) openSoundboard();
    else closeSoundboard();
  });
  $('board-close').addEventListener('click', () => closeSoundboard());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('board-menu').hidden) {
      e.preventDefault();
      closeSoundboard();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    const menu = $('board-menu');
    if (menu.hidden || menu.contains(e.target) || $('btn-board').contains(e.target)) return;
    closeSoundboard(false);
  }, true);
}

function openSoundboard() {
  closeThrowMenu(false);
  const menu = $('board-menu');
  menu.hidden = false;
  $('btn-board').setAttribute('aria-expanded', 'true');
  posicionarPopover(menu, $('btn-board'));
  menu.querySelector('.board-item')?.focus();
}

function closeSoundboard(devolverFoco = true) {
  const menu = $('board-menu');
  if (menu.hidden) return;
  const tinhaFoco = menu.contains(document.activeElement);
  menu.hidden = true;
  $('btn-board').setAttribute('aria-expanded', 'false');
  if (devolverFoco && tinhaFoco) $('btn-board').focus();
}

function tocarParaTodos(id) {
  // Aviso local do rate limit (o host é quem realmente aplica)
  const agora = Date.now();
  meusSons = meusSons.filter((t) => agora - t < LIMITE_SOUNDBOARD.janelaMs);
  if (meusSons.length >= LIMITE_SOUNDBOARD.max) {
    toast('Segura a emoção! Espere uns segundinhos 🎧');
    return;
  }
  meusSons.push(agora);
  handlers.onSoundboard?.(id);
}

/** Som da soundboard chegou: balão com o emoji em cima de quem tocou + destaque no botão. */
export function mostrarSomTocado(msg) {
  const som = SOUNDBOARD.find((s) => s.id === msg?.id);
  if (!som || $('screen-room').hidden) return;

  const botao = $('board-items').querySelector(`[data-som="${som.id}"]`);
  if (botao) {
    botao.classList.remove('is-playing');
    void botao.offsetWidth;
    botao.classList.add('is-playing');
  }

  const refs = playerEls.get(msg.fromId);
  if (!refs || document.hidden) return;
  const balao = el('span', { class: 'sound-bubble', 'aria-hidden': 'true', text: som.emoji });
  refs.root.append(balao);
  setTimeout(() => balao.remove(), 1800);
}

// ============================================================================
// Animações de arremesso
// ============================================================================

function centro(no) {
  const r = no.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Anima um nó e o remove ao terminar. Funciona mesmo sem Web Animations API. */
function animar(no, quadros, opcoes, aoTerminar) {
  if (typeof no.animate !== 'function') {
    no.remove();
    aoTerminar?.();
    return;
  }
  const a = no.animate(quadros, opcoes);
  activeAnims.add(a);
  a.onfinish = () => {
    activeAnims.delete(a);
    no.remove();
    aoTerminar?.();
  };
  a.oncancel = () => activeAnims.delete(a);
}

function noFx(ponto, texto, classe = 'projectile') {
  const n = el('span', { class: classe, text: texto });
  n.style.left = `${ponto.x}px`;
  n.style.top = `${ponto.y}px`;
  $('fx-layer').append(n);
  return n;
}

/** Quadros de uma trajetória em arco (curva de Bézier quadrática). */
function trajetoria(s, e, cfg, reduzido) {
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const dist = Math.hypot(dx, dy);
  const arco = reduzido ? 0 : Math.min(240, 60 + dist * 0.35);
  const c = { x: s.x + dx / 2, y: Math.min(s.y, e.y) - arco };
  const passos = reduzido ? 2 : 32;
  const sentido = dx < 0 ? -1 : 1;
  const quadros = [];
  let anguloFinal = 0;

  for (let i = 0; i <= passos; i++) {
    const t = i / passos;
    const u = 1 - t;
    const x = u * u * s.x + 2 * u * t * c.x + t * t * e.x;
    const y = u * u * s.y + 2 * u * t * c.y + t * t * e.y;
    // Direção do voo (derivada da curva)
    const vx = 2 * u * (c.x - s.x) + 2 * t * (e.x - c.x);
    const vy = 2 * u * (c.y - s.y) + 2 * t * (e.y - c.y);
    anguloFinal = (Math.atan2(vy, vx) * 180) / Math.PI;

    let rot = 0;
    if (cfg.orientar) rot = anguloFinal + (cfg.anguloBase || 0);
    else if (cfg.giro && !reduzido) rot = cfg.giro * t * sentido;
    const escala = reduzido ? 1 : 1 + 0.35 * Math.sin(Math.PI * t);
    quadros.push({
      transform: `translate(${x - s.x}px, ${y - s.y}px) translate(-50%, -50%) rotate(${rot}deg) scale(${escala})`,
      offset: t,
    });
  }
  const duracao = reduzido ? 250 : Math.min(1400, (cfg.duracao ?? 650) + dist * 0.4);
  return { quadros, duracao, anguloFinal, sentido };
}

/** Executa a animação de um arremesso recebido do host (todos veem ao mesmo tempo). */
export function animateThrow(msg) {
  // Aba em segundo plano não desenha frames: a animação ficaria "congelada" e rodaria atrasada
  if ($('screen-room').hidden || !msg || document.hidden) return;
  const cfg = ITENS_ARREMESSO.find((i) => i.id === msg.item);
  const alvo = playerEls.get(msg.toId);
  if (!cfg || !alvo) return;

  const simbolo = cfg.livre ? sanitizeEmoji(msg.emoji) || cfg.emoji : cfg.emoji;
  const origem = playerEls.get(msg.fromId);
  const s = origem ? centro(origem.card) : { x: window.innerWidth / 2, y: window.innerHeight + 30 };
  const e = centro(alvo.card);
  const reduzido = movimentoReduzido();
  const { quadros, duracao, anguloFinal, sentido } = trajetoria(s, e, cfg, reduzido);

  // Só os 6 itens principais têm som (emojis do seletor/livres voam em silêncio)
  const comSom = !cfg.livre || simbolo === cfg.emoji;
  if (comSom && cfg.somNo === 'lancamento') sound.play(cfg.som);
  const proj = noFx(s, simbolo);
  animar(proj, quadros, { duration: duracao, easing: 'linear', fill: 'forwards' }, () => {
    const refs = playerEls.get(msg.toId);
    if (!refs) return;
    if (comSom && cfg.somNo === 'impacto') sound.play(cfg.som);
    impacto(cfg, refs, centro(refs.card), simbolo, { anguloFinal, sentido, reduzido });
  });
}

function impacto(cfg, refs, p, simbolo, { anguloFinal, sentido, reduzido }) {
  if (!reduzido && typeof refs.card.animate === 'function') {
    refs.card.animate([
      { transform: 'translateX(0) rotate(0)' },
      { transform: 'translateX(-5px) rotate(-4deg)' },
      { transform: 'translateX(4px) rotate(3deg)' },
      { transform: 'translateX(-2px) rotate(-1deg)' },
      { transform: 'translateX(0) rotate(0)' },
    ], { duration: 380, easing: 'ease-out' });
  }

  switch (cfg.impacto) {
    case 'mancha': // ovo estoura e deixa uma mancha que some depois
      adicionarResiduo(refs, el('span', { class: 'residue-item splat' }, el('span', { class: 'splat-yolk' })), DURACAO_MANCHA_MS);
      if (!reduzido) estilhacos(p, ['#fefce8', '#fde047', '#ffffff'], 12);
      break;
    case 'crava': // dardo fica cravado na carta
      adicionarResiduo(refs, el('span', { class: 'residue-item dart-stuck', text: simbolo }), DURACAO_DARDO_MS);
      break;
    case 'explode': // coração "explode" em coraçõezinhos
      animar(noFx(p, simbolo), [
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: 'translate(-50%, -50%) scale(2.4)', opacity: 0 },
      ], { duration: 500, easing: 'ease-out' });
      if (!reduzido) explosaoDeSimbolos(p, simbolo, 7);
      break;
    case 'plana': { // aviãozinho segue planando e some
      const rad = (anguloFinal * Math.PI) / 180;
      const rot = anguloFinal + (cfg.anguloBase || 0);
      animar(noFx(p, simbolo), [
        { transform: `translate(0, 0) translate(-50%, -50%) rotate(${rot}deg)`, opacity: 1 },
        { transform: `translate(${Math.cos(rad) * 90}px, ${Math.sin(rad) * 90 + 30}px) translate(-50%, -50%) rotate(${rot + 25}deg) scale(.6)`, opacity: 0 },
      ], { duration: 700, easing: 'ease-out' });
      break;
    }
    default: { // 'quica': papelzinho / emoji quicam e caem
      const d = sentido;
      animar(noFx(p, simbolo), reduzido
        ? [{ opacity: 1, transform: 'translate(-50%, -50%)' }, { opacity: 0, transform: 'translate(-50%, -50%)' }]
        : [
          { transform: 'translate(0, 0) translate(-50%, -50%) rotate(0deg)', opacity: 1, offset: 0 },
          { transform: `translate(${d * 28}px, -46px) translate(-50%, -50%) rotate(${d * 140}deg)`, opacity: 1, offset: 0.3 },
          { transform: `translate(${d * 52}px, 12px) translate(-50%, -50%) rotate(${d * 230}deg)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${d * 66}px, -10px) translate(-50%, -50%) rotate(${d * 290}deg)`, opacity: 1, offset: 0.72 },
          { transform: `translate(${d * 80}px, 34px) translate(-50%, -50%) rotate(${d * 340}deg)`, opacity: 0, offset: 1 },
        ], { duration: 900, easing: 'ease-out' });
    }
  }
}

function adicionarResiduo(refs, no, duracaoMs) {
  while (refs.residue.children.length >= MAX_RESIDUOS_POR_CARTA) refs.residue.firstElementChild.remove();
  no.style.setProperty('--rot', `${Math.round(Math.random() * 60 - 30)}deg`);
  no.style.left = `${50 + (Math.random() * 30 - 15)}%`;
  no.style.top = `${45 + (Math.random() * 30 - 15)}%`;
  refs.residue.append(no);
  setTimeout(() => {
    no.classList.add('is-fading');
    setTimeout(() => no.remove(), 700);
  }, duracaoMs);
}

function estilhacos(p, cores, qtd) {
  for (let i = 0; i < qtd; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 25 + Math.random() * 35;
    const n = noFx(p, '', 'particle');
    n.style.background = cores[i % cores.length];
    animar(n, [
      { transform: 'translate(-50%, -50%) translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(-50%, -50%) translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(.3)`, opacity: 0 },
    ], { duration: 450 + Math.random() * 200, easing: 'ease-out' });
  }
}

function explosaoDeSimbolos(p, simbolo, qtd) {
  for (let i = 0; i < qtd; i++) {
    const a = (i / qtd) * Math.PI * 2 - Math.PI / 2;
    const d = 40 + Math.random() * 25;
    const n = noFx(p, simbolo, 'projectile projectile-sm');
    animar(n, [
      { transform: 'translate(-50%, -50%) translate(0, 0) scale(.4)', opacity: 1 },
      { transform: `translate(-50%, -50%) translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(1)`, opacity: 0 },
    ], { duration: 650, easing: 'ease-out' });
  }
}

/** Remove (só para este usuário) os efeitos residuais e os itens em voo. */
export function clearEffects() {
  for (const a of activeAnims) {
    try { a.cancel(); } catch { /* ignora */ }
  }
  activeAnims.clear();
  $('fx-layer').replaceChildren();
  for (const r of document.querySelectorAll('.residue')) r.replaceChildren();
}

// ============================================================================
// Confete (consenso)
// ============================================================================

export function celebrate() {
  if (movimentoReduzido()) return;
  const canvas = $('confetti');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const token = ++confettiToken;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.hidden = false;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const mesa = centro($('table'));
  const particulas = Array.from({ length: 150 }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const v = 6 + Math.random() * 9;
    return {
      x: mesa.x, y: mesa.y,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      w: 5 + Math.random() * 5, h: 8 + Math.random() * 7,
      r: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.35,
      cor: CORES_CONFETE[Math.floor(Math.random() * CORES_CONFETE.length)],
    };
  });

  const t0 = performance.now();
  const quadro = (t) => {
    if (token !== confettiToken) return;
    const dt = t - t0;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.max(0, Math.min(1, 1 - (dt - DURACAO_CONFETE_MS * 0.6) / (DURACAO_CONFETE_MS * 0.4)));
    for (const p of particulas) {
      p.vy += 0.28;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.cor;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (dt < DURACAO_CONFETE_MS) {
      requestAnimationFrame(quadro);
    } else {
      ctx.clearRect(0, 0, W, H);
      canvas.hidden = true;
    }
  };
  requestAnimationFrame(quadro);
}

// ============================================================================
// Diversos: toast, banner, copiar, som
// ============================================================================

export function toast(texto) {
  const area = $('toast');
  const t = el('div', { class: 'toast', text: texto });
  area.append(t);
  while (area.children.length > 3) area.firstElementChild.remove();
  setTimeout(() => {
    t.classList.add('is-leaving');
    setTimeout(() => t.remove(), 300);
  }, DURACAO_TOAST_MS);
}

export function setBanner(texto) {
  const b = $('conn-banner');
  b.hidden = !texto;
  b.textContent = texto || '';
}

async function copyText(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Fallback para navegadores sem Clipboard API
    const ta = el('textarea', { readonly: true, 'aria-hidden': 'true' });
    ta.value = texto;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignora */ }
    ta.remove();
    return ok;
  }
}

async function copyLink(btn) {
  const ok = await copyText(roomLink);
  if (!ok) {
    toast('Não foi possível copiar. Copie o link da barra de endereço.');
    return;
  }
  const label = btn.querySelector('.btn-label');
  if (label && !label.dataset.orig) label.dataset.orig = label.textContent;
  btn.classList.add('is-copied');
  if (label) label.textContent = 'Copiado!';
  toast('Link copiado! Agora é só compartilhar.');
  clearTimeout(btn._copiaTimer);
  btn._copiaTimer = setTimeout(() => {
    btn.classList.remove('is-copied');
    if (label) label.textContent = label.dataset.orig;
  }, 2000);
}

function piscarBotaoSom() {
  if ($('screen-room').hidden || document.hidden) return;
  const btn = $('btn-sound');
  // Reinicia a animação se já estiver piscando
  btn.classList.remove('is-nudging');
  void btn.offsetWidth;
  btn.classList.add('is-nudging');
  clearTimeout(piscarSomTimer);
  piscarSomTimer = setTimeout(() => btn.classList.remove('is-nudging'), DURACAO_PISCAR_SOM_MS);
  if (!dicaSomMostrada) {
    dicaSomMostrada = true;
    toast('Rolou um efeito sonoro! Ative o som no 🔇 lá em cima.');
  }
}

function updateSoundUI() {
  const mudo = sound.isMuted();
  if (!mudo) {
    clearTimeout(piscarSomTimer);
    $('btn-sound').classList.remove('is-nudging');
  }
  const btn = $('btn-sound');
  btn.setAttribute('aria-pressed', String(mudo));
  btn.setAttribute('aria-label', mudo ? 'Ativar som' : 'Desativar som');
  btn.title = mudo ? 'Ativar som' : 'Desativar som';
  btn.querySelector('.icon-sound-on').hidden = mudo;
  btn.querySelector('.icon-sound-off').hidden = !mudo;
  $('volume').value = String(Math.round(sound.getVolume() * 100));
}
