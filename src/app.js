import { roles } from './data/roles.js';
import { resolveBranding } from './config/brand.js';

let data = { currentUser: null, profile: null, cells: [], people: [], managementCells: [], teams: { ministries: [], supervisors: [], welcomeTeams: { welcome1: [], welcome2: [] } }, visitors: [], referrals: [], referralsToCell: [], notices: [], administration: null, branding: null, brandingAdministration: null, myCell: null, adminOfferings: [], receptionVisitors: [], careVisitors: [], careReferrals: [] };
let cells = [];
let activeRole = 'member';
let authenticated = false;
let welcomeTab = 'visitors';
let modal = null;
let toast = '';
let adminSearch = '';
let directorySearch = '';
let memberFilter = 'all';
let teamFocusMinistryId = null;
let myCellId = null;
let offeringFilters = { status: '', cellId: '', from: '', to: '' };

const icons = {
  home: '⌂', cell: '◌', welcome: '♡', profile: '◉', admin: '⚙', plus: '+', arrow: '→', close: '×', check: '✓', bell: '●', people: '♧', teams: '◌', reports: '▤', settings: '⚙'
};

const $ = (selector) => document.querySelector(selector);
const role = () => roles[activeRole];
const branding = () => resolveBranding(data.branding);
const isWelcome = () => ['welcome1', 'welcome2', 'supervisor', 'admin'].includes(activeRole);
const isTeam2 = () => ['welcome2', 'admin'].includes(activeRole);
const canViewOperations = () => ['welcome2', 'supervisor', 'admin'].includes(activeRole);
const isLeader = () => ['leader', 'supervisor', 'admin'].includes(activeRole);
const canAdmin = () => activeRole === 'admin';
const canRefer = () => activeRole === 'member';
const canDirectoryRead = () => data.currentUser?.roles?.some((id) => ['admin', 'pastor', 'supervisor'].includes(id));
const canDirectoryManage = () => data.currentUser?.roles?.includes('admin');
const myCellRole = () => ['member', 'leader', 'secretary'].includes(activeRole) ? activeRole : null;
const cellForUser = () => cells.find((cell) => cell.id === data.currentUser.cellId) || { id: '', name: 'Sem célula vinculada', leader: 'A definir', schedule: 'A definir', location: 'A definir', members: [], notice: 'Não há uma célula vinculada a este usuário.' };
const h = (value = '') => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const initials = (name = '') => String(name).split(' ').filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'CC';
const personAvatar = (person, className = '') => person?.photoUrl ? `<span class="person-avatar has-photo ${className}"><img src="${h(person.photoUrl)}" alt="Foto de ${h(person.fullName || person.name || '')}"></span>` : `<span class="person-avatar ${className}" aria-hidden="true">${initials(person?.fullName || person?.name)}</span>`;
const displayDate = (value) => /^(Agora|Hoje|Ontem)/.test(String(value)) ? value : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const ministries = () => data.teams?.ministries || [];
const supervisors = () => data.teams?.supervisors || [];
const peopleById = (id) => data.people.find((person) => person.id === id);

function personPicker(name, label, selectedIds = [], { multiple = false, help = '' } = {}) {
  const selected = selectedIds.map(peopleById).filter(Boolean);
  const options = data.people.map((person) => `<button type="button" class="person-picker-option" data-picker-select="${name}" data-person-id="${person.id}" data-picker-multiple="${multiple}">${personAvatar(person, 'small')}<span><strong>${h(person.fullName)}</strong><small>${h(person.whatsapp)}</small></span></button>`).join('') || '<p class="empty-state">Cadastre uma pessoa antes de vinculá-la.</p>';
  return `<section class="person-picker" data-person-picker="${name}"><label>${h(label)}<input type="search" data-picker-search="${name}" placeholder="Buscar pessoa pelo nome" autocomplete="off"></label><input type="hidden" name="${name}" value="${h(selectedIds.join(','))}"><div class="person-picker-selected" data-picker-selected="${name}">${selected.map((person) => `<span>${h(person.fullName)}<button type="button" aria-label="Remover ${h(person.fullName)}" data-picker-remove="${name}" data-person-id="${person.id}">×</button></span>`).join('') || '<small>Nenhuma pessoa selecionada.</small>'}</div><div class="person-picker-options" data-picker-options="${name}">${options}</div>${help ? `<p class="picker-help">${h(help)}</p>` : ''}</section>`;
}

function ministryPicker(name, selectedId, label = 'Ministério') {
  const choices = ministries().map((ministry) => `<button type="button" class="choice-card ${selectedId === ministry.id ? 'selected' : ''}" data-ministry-select="${name}" data-ministry-id="${ministry.id}">${h(ministry.name)}</button>`).join('') || '<p class="empty-state">Nenhum ministério disponível. A migration organizacional precisa ser aplicada.</p>';
  return `<section class="choice-picker"><label>${h(label)}</label><input type="hidden" name="${name}" value="${h(selectedId || '')}"><div class="choice-grid" data-ministry-options="${name}">${choices}</div></section>`;
}

function weekdayPicker(selectedDay) {
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return `<section class="choice-picker"><label>Dia da semana</label><input type="hidden" name="weekday" value="${h(selectedDay ?? '')}"><div class="weekday-grid">${days.map((day, index) => `<button type="button" class="weekday-choice ${Number(selectedDay) === index ? 'selected' : ''}" data-weekday-select="${index}">${day}</button>`).join('')}</div></section>`;
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...options });
  const payload = await response.json();
  if (!response.ok) { const error = new Error(payload.error || 'Não foi possível salvar os dados.'); error.status = response.status; throw error; }
  return payload;
}

async function uploadBrandingAsset(kind, file) {
  const response = await fetch(`/api/admin/branding/assets?kind=${encodeURIComponent(kind)}`, {
    method: 'POST', headers: { 'Content-Type': file.type }, body: file, credentials: 'same-origin'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.error || 'Não foi possível enviar a imagem.'); error.status = response.status; throw error; }
  return payload.asset;
}

async function uploadPersonPhoto(personId, file) {
  const response = await fetch(`/api/people/${encodeURIComponent(personId)}/photo`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file, credentials: 'same-origin' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.error || 'Não foi possível enviar a foto.'); error.status = response.status; throw error; }
  return payload;
}

async function hydrate() {
  try {
    const [persisted, profileResponse] = await Promise.all([api('/api/bootstrap'), api('/api/profile')]);
    authenticated = true; data = { ...persisted, profile: profileResponse.profile, people: [], managementCells: [], teams: { ministries: [], supervisors: [], welcomeTeams: { welcome1: [], welcome2: [] } }, branding: data.branding, brandingAdministration: null, myCell: null, adminOfferings: [], receptionVisitors: [], careVisitors: [], careReferrals: [] };
    cells = persisted.cells;
    if (!data.currentUser.roles.includes(activeRole)) activeRole = data.currentUser.roles[0] || 'member';
    if (data.currentUser.roles.includes('admin')) {
      try { data.brandingAdministration = await api('/api/admin/branding'); } catch { data.brandingAdministration = null; }
      try { data.adminOfferings = (await api('/api/admin/offerings')).offerings; } catch { data.adminOfferings = []; }
      try { data.teams = await api('/api/admin/teams'); } catch { data.teams = { ministries: [], supervisors: [], welcomeTeams: { welcome1: [], welcome2: [] } }; }
    }
    if (canDirectoryRead()) {
      try { const [peopleResponse, cellsResponse] = await Promise.all([api('/api/people'), api('/api/cells')]); data.people = peopleResponse.people; data.managementCells = cellsResponse.cells; } catch { data.people = []; data.managementCells = []; }
    }
    await hydrateMyCell(false);
    await hydrateWelcome(false);
    render();
  } catch (error) {
    if (error.status === 401) { authenticated = false; render(); return; }
    console.warn('Não foi possível carregar os dados persistidos.', error);
  }
}

async function hydrateWelcome(renderAfter = true) {
  if (!authenticated) return;
  try {
    if (activeRole === 'welcome1') data.receptionVisitors = (await api('/api/reception/visitors')).visitors;
    else if (activeRole === 'welcome2') { const [visitors, referrals] = await Promise.all([api('/api/care/visitors'), api('/api/care/referrals')]); data.careVisitors = visitors.visitors; data.careReferrals = referrals.referrals; }
    else if (activeRole === 'admin') { const [reception, visitors, referrals] = await Promise.all([api('/api/reception/visitors'), api('/api/care/visitors'), api('/api/care/referrals')]); data.receptionVisitors = reception.visitors; data.careVisitors = visitors.visitors; data.careReferrals = referrals.referrals; }
  } catch (error) {
    if (error.status !== 403) console.warn('Não foi possível carregar Boas-Vindas.', error);
  }
  if (renderAfter) render();
}

async function hydrateMyCell(renderAfter = true) {
  const asRole = myCellRole();
  data.myCell = null;
  if (!authenticated || !asRole) { if (renderAfter) render(); return; }
  try { data.myCell = await api(`/api/my-cell?as=${encodeURIComponent(asRole)}${myCellId ? `&cellId=${encodeURIComponent(myCellId)}` : ''}`); }
  catch (error) { if (error.status !== 403) console.warn('Não foi possível carregar Minha Célula.', error); }
  if (renderAfter) render();
}

async function hydrateBranding() {
  try {
    const result = await api('/api/branding');
    data = { ...data, branding: result.branding };
    render();
  } catch {
    // A identidade visual continua usando o fallback local seguro.
  }
}

function navigate(route) { window.location.hash = `#/${route}`; }
function currentRoute() {
  const candidate = window.location.hash.replace('#/', '') || 'home';
  if (canAdmin()) {
    if (candidate === 'admin') return 'settings';
    return ['home', 'people', 'teams', 'reports', 'settings', 'cells'].includes(candidate) ? candidate : 'home';
  }
  return ['home', 'cell', 'refer', 'welcome', 'profile', 'people', 'cells', 'teams', 'reports', 'settings', 'admin'].includes(candidate) ? candidate : 'home';
}

function navItem(route, icon, label) {
  return `<a class="nav-item ${currentRoute() === route ? 'active' : ''}" href="#/${route}"><span>${icon}</span>${label}</a>`;
}

function brandMark(compact = false) {
  const brand = branding();
  const image = brand.logoUrl ? `<img src="${h(brand.logoUrl)}" alt="Logo ${h(brand.churchName)}">` : '<span aria-hidden="true">C</span>';
  return `<a class="brand ${compact ? 'brand-compact' : ''}" href="#/home"><span class="brand-mark ${brand.logoUrl ? 'has-image' : ''}">${image}</span><span>${h(brand.applicationName.split(' ')[0])} <b>${h(brand.applicationName.split(' ').slice(1).join(' '))}</b></span></a>`;
}

function themeVariables() {
  const colors = branding().annualTheme.colors;
  const backgroundUrl = branding().backgroundUrl;
  const backgroundImage = /^https:\/\/[^\s]+$/i.test(backgroundUrl) ? `url(${JSON.stringify(backgroundUrl)})` : 'none';
  return `--theme-sand:${colors.sand};--theme-terracotta:${colors.terracotta};--theme-copper:${colors.copper};--theme-dusk:${colors.dusk};--app-background-image:${backgroundImage};`;
}

function layout(content) {
  if (!authenticated) return loginView();
  const adminContext = canAdmin();
  const nav = adminContext
    ? [navItem('home', icons.home, 'Home'), navItem('people', icons.people, 'Membros'), navItem('teams', icons.teams, 'Equipes'), navItem('reports', icons.reports, 'Relatórios'), navItem('settings', icons.settings, 'Configurações')]
    : [navItem('home', icons.home, 'Início'), navItem('cell', icons.cell, 'Minha Célula')];
  if (!adminContext && canRefer()) nav.push(navItem('refer', icons.plus, 'Indicar'));
  if (!adminContext && isWelcome()) nav.push(navItem('welcome', icons.welcome, 'Boas-Vindas'));
  if (!adminContext && canDirectoryRead()) { nav.push(navItem('people', icons.people, 'Pessoas')); nav.push(navItem('cells', icons.cell, 'Células')); }
  if (!adminContext) nav.push(navItem('profile', icons.profile, 'Meu Perfil'));
  if (!adminContext && canAdmin()) nav.push(navItem('admin', icons.admin, 'Administração'));
  return `
    <div class="app-shell" style="${themeVariables()}">
      <aside class="sidebar">
        ${brandMark()}
        <nav>${nav.join('')}</nav>
        <div class="sidebar-bottom"><div class="role-badge"><span>${role().initials}</span><div><small>Visualizando como</small><strong>${role().label}</strong></div></div></div>
      </aside>
      <main class="main-content">
        <header class="topbar">
          <button class="mobile-brand" data-action="menu" aria-label="Abrir menu">☰</button>
          <div class="mobile-title">CEM <b>CONNECT</b></div>
          <div class="topbar-actions"><label class="profile-switch"><span>Minha função</span><select id="role-select">${data.currentUser.roles.map((id) => `<option value="${id}" ${activeRole === id ? 'selected' : ''}>${roles[id].label}</option>`).join('')}</select></label><button class="notification" aria-label="Notificações">${icons.bell}</button><button class="avatar" ${adminContext ? 'data-modal="profile"' : 'data-route="profile"'} aria-label="Minha conta">${initials(data.currentUser.name)}</button><button class="logout-button" data-action="logout">Sair</button></div>
        </header>
        <section class="page">${content}</section>
      </main>
      <nav class="mobile-nav ${adminContext ? 'admin-mobile-nav' : ''}">${adminContext ? nav.join('') : nav.slice(0, 4).join('')}</nav>
    </div>
    ${modal ? modalView() : ''}
    ${toast ? `<div class="toast" role="status" aria-live="polite">${icons.check} ${h(toast)}</div>` : ''}`;
}

function loginView() { return `<main class="login-page" style="${themeVariables()}"><section class="login-card">${brandMark()}<div class="login-theme" aria-label="Tema anual"><p class="eyebrow">${h(branding().annualTheme.year || '')} · TEMA ANUAL</p><strong>${h(branding().annualTheme.name)}</strong><span>${h(branding().annualTheme.subtitle)}</span></div><p class="eyebrow">ACESSO SEGURO</p><h1>Bem-vindo de volta</h1><p>Entre para cuidar, conectar e caminhar junto.</p><form id="login-form"><label>WhatsApp ou e-mail<input name="identity" autocomplete="username" required placeholder="seu@email.com"></label><label>Senha<input name="password" type="password" autocomplete="current-password" required placeholder="Sua senha"></label><button class="button primary" type="submit">Entrar</button></form><p class="login-help">Usuários são criados pela administração da igreja.</p>${toast ? `<div class="login-error" role="alert">${h(toast)}</div>` : ''}</section></main>`; }

function pageTitle(eyebrow, title, text, action = '') { return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${text}</p></div>${action}</div>`; }
function stat(title, text, icon, tone = '') { return `<article class="stat-card ${tone}"><span class="stat-icon">${icon}</span><div><strong>${title}</strong><p>${text}</p></div></article>`; }
function empty(text) { return `<div class="empty">♡<p>${text}</p></div>`; }

function annualThemeBanner() {
  const theme = branding().annualTheme;
  const art = theme.bannerUrl ? `<img src="${h(theme.bannerUrl)}" alt="Banner do tema ${h(theme.name)}">` : '<div class="theme-art" aria-hidden="true"><span></span><i></i><b></b></div>';
  return `<section class="annual-theme-banner">${art}<div class="annual-theme-copy"><p class="eyebrow">${theme.year ? `${h(theme.year)} · ` : ''}TEMA ANUAL</p><h2>${h(theme.name)}</h2><p>${h(theme.subtitle)}</p></div><span class="theme-walk" aria-hidden="true">↗</span></section>`;
}

function adminMetric(route, icon, title, value, description) {
  return `<button class="admin-metric" data-route="${route}"><span class="admin-metric-icon" aria-hidden="true">${icon}</span><span><small>${h(title)}</small><strong>${h(value)}</strong><em>${h(description)}</em></span><b aria-hidden="true">→</b></button>`;
}

function adminHomeView() {
  const people = data.people || [];
  const cells = data.managementCells || [];
  const activeCells = cells.filter((cell) => cell.isActive).length;
  const leaders = cells.reduce((total, cell) => total + (cell.leaders?.length || 0), 0);
  const supervisors = data.teams?.supervisors?.length || 0;
  const careVisitors = data.careVisitors || [];
  const careReferrals = data.careReferrals || [];
  const careTotal = careVisitors.length + careReferrals.length;
  const pendingCare = [...careVisitors, ...careReferrals].filter((item) => !item.careCaseId).length;
  return layout(`
    <section class="admin-home-heading">
      <div>${brandMark(true)}<div><p class="eyebrow">ADMINISTRAÇÃO</p><h1>Visão da igreja</h1><p>Organize pessoas, equipes e informações com cuidado.</p></div></div>
      <span class="admin-context">Administrador</span>
    </section>
    ${annualThemeBanner()}
    <section class="admin-section"><div class="section-title"><div><p class="eyebrow">VISÃO GERAL</p><h2>O que precisa de atenção</h2></div></div>
      <div class="admin-metrics">
        ${adminMetric('people', '♧', 'Membros', String(people.filter((person) => person.personStatus === 'member').length), 'Cadastros ativos')}
        ${adminMetric('teams', '◌', 'Células ativas', String(activeCells), 'Estrutura em funcionamento')}
        ${adminMetric('teams', '◉', 'Lideranças', String(leaders), 'Vínculos atuais')}
        ${adminMetric('teams', '◒', 'Supervisores', String(supervisors), 'Vínculos organizacionais')}
        ${adminMetric('teams', '♡', 'Boas-Vindas', String(careTotal), pendingCare ? `${pendingCare} aguardando análise` : 'Registros operacionais')}
      </div>
    </section>
    <section class="admin-section"><div class="section-title"><div><p class="eyebrow">AÇÕES RÁPIDAS</p><h2>Organizar a igreja</h2></div></div>
      <div class="admin-quick-actions"><button class="admin-action" data-modal="person-form"><span>+</span><strong>Novo membro</strong><small>Cadastrar uma pessoa</small></button><button class="admin-action" data-modal="cell-form"><span>◌</span><strong>Nova célula</strong><small>Adicionar uma célula</small></button><button class="admin-action" data-route="teams"><span>◉</span><strong>Ver equipes</strong><small>Estrutura e vínculos</small></button><button class="admin-action" data-route="reports"><span>▤</span><strong>Ver relatórios</strong><small>Reuniões e ofertas</small></button></div>
    </section>`);
}

function homeView() {
  if (canAdmin()) return adminHomeView();
  const quick = activeRole === 'welcome1'
    ? `<button class="button primary" data-modal="reception-create">${icons.plus} Cadastrar visitante</button>`
    : isTeam2() ? `<button class="button primary" data-route="welcome">Abrir Boas-Vindas ${icons.arrow}</button>`
    : canRefer() ? `<button class="button primary" data-route="refer">${icons.plus} Indicar alguém</button>` : '';
  const cell = cellForUser();
  const careItems = activeRole === 'welcome2'
    ? [...data.careVisitors.filter((item) => !item.careCaseId), ...data.careReferrals.filter((item) => !item.careCaseId)]
    : [];
  const attention = canViewOperations()
    ? `<section class="card list-card"><div class="card-heading"><div><p class="eyebrow">PARA VOCÊ</p><h2>Próximos cuidados</h2><p>Novas pessoas aguardando um próximo passo.</p></div><button class="text-button" data-route="welcome">Ver Boas-Vindas</button></div>${careItems.slice(0, 3).map((item) => `<article class="person-row"><span class="person-avatar">${initials(item.fullName)}</span><div class="person-main"><strong>${h(item.fullName)}</strong><p>${h(item.source || 'Indicação de membro')}</p></div><span class="status em-análise">Novo</span></article>`).join('') || empty('Nenhum cuidado pendente por agora.')}</section>`
    : `<section class="card list-card"><div class="card-heading"><div><p class="eyebrow">PARA VOCÊ</p><h2>Conexão e avisos</h2><p>Informações da sua caminhada e da sua célula.</p></div></div>${data.notices.length ? data.notices.map((notice) => `<div class="notice-row"><span>✦</span><p>${h(notice)}</p></div>`).join('') : `<div class="next-meeting"><span>◷</span><div><strong>${h(cell.name)}</strong><p>${h(cell.schedule)} · ${h(cell.location)}</p></div></div>`}</section>`;
  const referral = activeRole === 'leader' ? data.myCell?.referrals?.[0] : null;
  return layout(`
    ${pageTitle('CEM CONNECT', `Olá, ${h(data.currentUser.name.split(' ')[0])}`, 'Um espaço simples para cuidar, conectar e caminhar junto.', quick)}
    ${annualThemeBanner()}
    <div class="gentle-note"><span>♡</span><p>O CEM CONNECT organiza informações para ajudar pessoas a cuidarem de pessoas.</p></div>
    <div class="content-grid ${referral ? '' : 'single-side'}">${attention}<section class="card"><div class="card-heading"><div><h2>${referral ? 'Encaminhamento recebido' : 'Próximo encontro'}</h2><p>${referral ? 'Uma pessoa foi encaminhada para sua célula.' : `${cell.schedule} · ${cell.location}`}</p></div>${!referral ? `<button class="text-button" data-route="cell">Ver célula</button>` : ''}</div>${referral ? `<div class="referral-card"><div class="person-avatar">${initials(referral.fullName)}</div><div><strong>${h(referral.fullName)}</strong><p>${h(referral.noteForCell || '')}</p><small>Encaminhado ${displayDate(referral.createdAt)}</small></div><button class="text-button" data-route="cell">Abrir</button></div>` : `<div class="next-meeting"><span>◷</span><div><strong>Encontro da ${h(cell.name)}</strong><p>Um momento para compartilhar e caminhar juntos.</p></div></div>`}</section></div>
  `);
}

function referView() {
  if (!canRefer()) return layout(`${pageTitle('ACESSO RESTRITO', 'Indicar alguém', 'Esta ação está disponível apenas para perfis autorizados.')}<section class="card access-card"><span>♡</span><h2>Você não possui acesso a indicações.</h2></section>`);
  return layout(`${pageTitle('INDICAR', 'Uma indicação de cuidado', 'Envie apenas nome, WhatsApp e uma observação opcional. A Equipe 2 decidirá o próximo passo.')}<section class="card referral-form-card">${formFields('referral', false, true)}</section>`);
}

function cellView() {
  const asRole = myCellRole(); const dashboard = data.myCell;
  if (!asRole) return layout(`${pageTitle('MINHA CÉLULA', 'Minha conexão', 'Escolha uma função de Membro, Liderança ou Secretaria para visualizar seus vínculos.')}<section class="card access-card"><span>◌</span><h2>Não há uma visão de célula para esta função.</h2><p>Minha Célula sempre respeita seus vínculos ativos.</p></section>`);
  if (!dashboard?.cell) return layout(`${pageTitle('MINHA CÉLULA', 'Minha conexão', 'Um espaço de conexão, cuidado e comunhão.')}<section class="card access-card"><span>◌</span><h2>Nenhuma célula vinculada.</h2><p>Quando houver uma membresia, liderança ou secretaria ativa, as informações aparecerão aqui.</p></section>`);
  const cell = dashboard.cell; const manager = ['leader', 'secretary'].includes(asRole); const leader = asRole === 'leader';
  const choices = dashboard.cells.length > 1 ? `<div class="button-group">${dashboard.cells.map((item) => `<button class="button ${item.id === cell.id ? 'primary' : 'outline'}" data-my-cell-select="${item.id}">${h(item.name)}</button>`).join('')}</div>` : '';
  const next = dashboard.nextMeeting ? `<div class="next-meeting"><span>◷</span><div><strong>${h(meetingStatusLabel(dashboard.nextMeeting.status))} · ${h(formatCellDate(dashboard.nextMeeting.date))}</strong><p>${h(formatTime(dashboard.nextMeeting.time))}</p></div></div>` : '<p class="empty-state">Nenhum próximo encontro registrado.</p>';
  const birthdays = dashboard.birthdays.map((person) => `<div class="notice-row"><span>✦</span><p><strong>${h(person.fullName)}</strong> · dia ${h(person.day)}</p></div>`).join('') || '<p class="empty-state">Nenhum aniversariante neste mês.</p>';
  const photoRows = dashboard.photos.map((photo) => `<div class="notice-row"><span>▧</span><p><strong>${h(photo.caption || 'Foto da reunião')}</strong><br><small>${h(photo.status === 'published' ? 'Publicada' : 'Aguardando publicação')}</small></p></div>`).join('') || '<p class="empty-state">Nenhuma foto publicada ainda.</p>';
  const meetingRows = dashboard.meetings.map((meeting) => `<article class="person-row"><span class="person-avatar">◷</span><div class="person-main"><strong>${h(formatCellDate(meeting.date))} · ${h(formatTime(meeting.time))}</strong><p>${h(meetingStatusLabel(meeting.status))}${meeting.offering ? ` · Oferta registrada` : ''}</p></div><button class="text-button" data-meeting-id="${meeting.id}" data-cell-id="${cell.id}">Abrir</button></article>`).join('') || empty('Nenhuma reunião registrada.');
  const members = dashboard.members.map((person) => `<div class="notice-row"><span class="person-avatar small">${initials(person.fullName)}</span><p><strong>${h(person.fullName)}</strong>${leader && person.whatsapp ? ` · ${h(person.whatsapp)}` : ''}${leader && person.journey?.length ? `<br><small>${h(person.journey.map((item) => item.completedOn ? `${item.name} ✓` : item.name).join(' · '))}</small>` : ''}</p></div>`).join('') || '<p class="empty-state">Nenhum integrante ativo.</p>';
  const meetingForm = manager ? `<section class="card"><div class="card-heading"><div><h2>Registrar reunião</h2><p>O horário ficará preservado no histórico.</p></div></div><form id="my-meeting-form"><input type="hidden" name="cellId" value="${cell.id}"><label>Data<input name="meetingDate" type="date" value="${today()}" required></label><label>Horário<input name="meetingTime" type="time" value="${h(String(cell.meetingTime || '').slice(0, 5))}" required></label><label>Situação<select name="status"><option value="scheduled">Programada</option><option value="held">Realizada</option><option value="not_held">Não realizada</option></select></label><label>Nota geral <small>opcional</small><textarea name="notes"></textarea></label><label>Observação se não realizada <small>opcional</small><textarea name="notHeldNote"></textarea></label><button class="button primary">Salvar reunião</button></form></section>` : '';
  const journey = leader && dashboard.members.length ? `<section class="card"><div class="card-heading"><div><h2>Jornada dos integrantes</h2><p>Atualize somente a formação da sua célula.</p></div></div><form class="inline-form" id="my-member-journey-form"><input type="hidden" name="cellId" value="${cell.id}"><select name="personId">${dashboard.members.map((person) => `<option value="${person.id}">${h(person.fullName)}</option>`).join('')}</select><select name="moduleCode">${dashboard.formationModules.map((module) => `<option value="${module.code}">${h(module.name)}</option>`).join('')}</select><input name="completedOn" type="date"><button class="text-button">Registrar jornada</button></form></section>` : '';
  const forwarded = leader ? `<section class="card list-card"><div class="card-heading"><div><h2>Visitantes encaminhados</h2><p>Informações necessárias para acolher, sem histórico privado.</p></div></div>${(dashboard.referrals || []).map((referral) => `<article class="person-row"><span class="person-avatar">${initials(referral.fullName)}</span><div class="person-main"><strong>${h(referral.fullName)}</strong><p>${h(referral.whatsapp)} · Encaminhado ${h(displayDate(referral.createdAt))}${referral.noteForCell ? ` · ${h(referral.noteForCell)}` : ''}</p></div><button class="text-button" data-return-cell-referral="${referral.id}" data-cell-id="${cell.id}">Devolver à Equipe 2</button></article>`).join('') || '<p class="empty-state">Nenhum visitante encaminhado no momento.</p>'}</section>` : '';
  return layout(`${pageTitle('MINHA CÉLULA', cell.name, 'Um espaço de conexão, cuidado e comunhão.', choices)}<section class="cell-hero"><div><span class="cell-symbol">◌</span><div><p>${asRole === 'member' ? 'Sua célula' : asRole === 'leader' ? 'Sua liderança' : 'Sua secretaria'}</p><h2>${h(weekdayLabel(cell.weekday))} · ${h(formatTime(cell.meetingTime))}</h2></div></div><div class="meeting-info"><span>⌖</span><div><strong>${h(cell.addressLine)}</strong><p>${h(cell.neighborhood)} · ${h(cell.city)} / ${h(cell.state)}</p></div></div></section><div class="content-grid"><section class="card"><div class="card-heading"><div><h2>Próximo encontro</h2><p>Informações organizadas com cuidado.</p></div></div>${next}</section><section class="card"><div class="card-heading"><div><h2>Aniversariantes do mês</h2><p>Uma oportunidade de celebrar pessoas.</p></div></div>${birthdays}</section></div>${forwarded}${manager ? `<section class="card list-card"><div class="card-heading"><div><h2>Reuniões</h2><p>Presenças, visitantes e oferta são registrados por encontro.</p></div></div>${meetingRows}</section><div class="content-grid"><section class="card"><div class="card-heading"><div><h2>Integrantes</h2><p>${dashboard.members.length} pessoas na célula.</p></div></div>${members}</section><section class="card"><div class="card-heading"><div><h2>Fotos</h2><p>${leader ? 'Publique somente fotos apropriadas.' : 'A publicação é feita pela liderança.'}</p></div></div>${photoRows}<p class="identity-help">O envio real de fotos será habilitado quando o storage seguro estiver configurado.</p></section></div>${meetingForm}${journey}` : `<section class="card"><div class="card-heading"><div><h2>Fotos publicadas</h2><p>Memórias compartilhadas pela liderança.</p></div></div>${photoRows}<p class="identity-help">As imagens serão exibidas quando o storage seguro de fotos estiver configurado.</p></section>`}`);
}

function profileView() {
  const profile = data.profile || { ...data.currentUser, birthDate: null, membership: null, leaderships: [], secretariats: [], supervisedCells: [], settings: { profileEditing: false } };
  const cell = profile.membership || cellForUser();
  const links = [
    profile.membership ? `Membro · ${profile.membership.name}` : '',
    ...profile.leaderships.map((item) => `Liderança · ${item.name}`),
    ...profile.secretariats.map((item) => `Secretaria · ${item.name}`),
    ...profile.supervisedCells.map((item) => `Supervisão · ${item.name}`)
  ].filter(Boolean);
  const birthDate = profile.birthDate ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${profile.birthDate}T00:00:00Z`)) : 'Não informado';
  return layout(`
    ${pageTitle('MEU PERFIL', 'Suas informações', 'Mantenha seus dados atualizados para permanecer conectado.')}
    <div class="profile-layout"><section class="card profile-card"><div class="profile-hero"><span class="avatar large">${initials(profile.name)}</span><div><h2>${h(profile.name)}</h2><p>${h(profile.email || 'E-mail não informado')}</p><div class="chips">${profile.roles.map(id => `<span>${h(roles[id]?.label || id)}</span>`).join('')}</div></div></div><div class="details"><div><small>WhatsApp</small><strong>${h(profile.whatsapp)}</strong></div><div><small>Data de nascimento</small><strong>${h(birthDate)}</strong></div><div><small>Minha célula</small><strong>${h(cell.name)}</strong></div></div>${profile.settings?.profileEditing ? '<button class="button outline" data-modal="profile">Configuração</button>' : ''}</section><section class="card"><div class="card-heading"><div><h2>Vínculos</h2><p>Suas conexões ministeriais atuais.</p></div></div>${links.length ? `<div class="chips profile-links">${links.map((item) => `<span>${h(item)}</span>`).join('')}</div>` : '<p class="empty-state">Nenhum vínculo de célula ativo.</p>'}</section></div>
  `);
}

const statusLabel = (value) => ({ member: 'Membro', visitor: 'Visitante', integrating: 'Em integração', inactive: 'Inativo', transferred: 'Transferido' }[value] || 'Sem situação');
const weekdayLabel = (value) => ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][Number(value)] || 'Dia a definir';
const today = () => new Date().toISOString().slice(0, 10);
const formatTime = (value) => String(value || '').slice(0, 5) || 'Horário a definir';
const formatCellDate = (value) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : 'Data a definir';
const meetingStatusLabel = (value) => ({ scheduled: 'Programada', held: 'Realizada', not_held: 'Não realizada' }[value] || 'Sem situação');

function peopleView() {
  if (!canDirectoryRead()) return layout(`${pageTitle('ACESSO RESTRITO', 'Pessoas', 'Esta área é protegida.')}<section class="card access-card"><h2>Você não possui acesso a Pessoas.</h2></section>`);
  const term = directorySearch.toLowerCase();
  const people = data.people.filter((person) => `${person.fullName} ${person.whatsapp}`.toLowerCase().includes(term) && (memberFilter === 'all' || person.personStatus === memberFilter));
  const isAdminContext = canAdmin();
  const filters = [['all', 'Todos'], ['member', 'Membros'], ['integrating', 'Integração'], ['visitor', 'Visitantes'], ['inactive', 'Inativos']];
  const rows = people.map((person) => `<button class="member-row" data-person-id="${person.id}">${personAvatar(person)}<span class="person-main"><strong>${h(person.fullName)}</strong><p>${h(statusLabel(person.personStatus))}${person.cell ? ` · ${h(person.cell.name)}` : ' · Sem célula ativa'}</p></span><span class="status ${person.personStatus === 'member' ? '' : 'em-análise'}">${h(statusLabel(person.personStatus))}</span><b aria-hidden="true">›</b></button>`).join('') || empty(isAdminContext ? 'Nenhum membro cadastrado ainda.' : 'Nenhuma pessoa cadastrada.');
  return layout(`${pageTitle(isAdminContext ? 'ADMINISTRAÇÃO' : 'PESSOAS', isAdminContext ? 'Membros' : 'Cuidado e conexão', isAdminContext ? 'Cadastros, vínculos e jornada de cada pessoa.' : 'Cadastros organizados para apoiar o cuidado de cada pessoa.', canDirectoryManage() ? `<button class="button primary" data-modal="person-form">${isAdminContext ? '+ Novo membro' : '+ Pessoa'}</button>` : '')}<section class="member-toolbar"><label class="search-field"><span aria-hidden="true">⌕</span><input id="directory-search" placeholder="Buscar por nome ou WhatsApp" value="${h(directorySearch)}"></label><div class="filter-pills" aria-label="Filtrar membros">${filters.map(([value, label]) => `<button class="filter-pill ${memberFilter === value ? 'active' : ''}" data-member-filter="${value}">${label}</button>`).join('')}</div></section><section class="card list-card member-list-card"><div class="card-heading"><div><h2>${isAdminContext ? 'Membros e pessoas' : 'Pessoas cadastradas'}</h2><p>Toque em uma pessoa para abrir sua ficha completa.</p></div><span class="list-count">${people.length}</span></div>${rows}</section>`);
}

function cellsView() {
  if (!canDirectoryRead()) return layout(`${pageTitle('ACESSO RESTRITO', 'Células', 'Esta área é protegida.')}<section class="card access-card"><h2>Você não possui acesso a Células.</h2></section>`);
  const rows = data.managementCells.map((cell) => `<article class="person-row"><span class="person-avatar">◌</span><div class="person-main"><strong>${h(cell.name)}</strong><p>${h(weekdayLabel(cell.weekday))} · ${h(String(cell.meetingTime || '').slice(0, 5))} · ${h(cell.neighborhood)}</p><small>${h(cell.leaderName || 'Liderança pendente')}</small></div><span class="status ${cell.isActive ? '' : 'em-análise'}">${cell.isActive ? 'Ativa' : 'Inativa'}</span><button class="text-button" data-cell-id="${cell.id}">Ver ficha</button></article>`).join('') || empty('Nenhuma célula cadastrada.');
  return layout(`${pageTitle('CÉLULAS', 'Organização e cuidado', 'Informações, vínculos e participantes sem comparações.', canDirectoryManage() ? '<button class="button primary" data-modal="cell-form">Nova célula</button>' : '')}<section class="card list-card"><div class="card-heading"><div><h2>Células cadastradas</h2><p>Dia, local e liderança atual.</p></div></div>${rows}</section>`);
}

function personForm(person = null) {
  const value = (key) => h(person?.person?.[key] ?? person?.[key] ?? ''); const current = person?.person || person || {};
  const photo = current.photoUrl ? `<img src="${h(current.photoUrl)}" alt="Foto atual">` : `<span class="asset-placeholder" aria-hidden="true">${initials(current.fullName)}</span>`;
  return `<form id="person-form"><input type="hidden" name="id" value="${h(current.id || '')}"><section class="person-photo-field"><div>${photo}</div><label>Foto <small>opcional · PNG, JPEG ou WebP · até 5 MB</small><input name="photoFile" type="file" accept="image/png,image/jpeg,image/webp" capture="user"></label>${current.id ? `<label class="consent"><input name="imageConsent" type="checkbox" ${current.imageConsent ? 'checked' : ''}> Autorização de uso de imagem registrada</label>` : '<label class="consent"><input name="imageConsent" type="checkbox"> Registrar autorização de uso de imagem antes de enviar foto</label>'}</section><label>Nome completo<input name="fullName" value="${value('fullName')}" required></label><label>WhatsApp<input name="whatsapp" value="${value('whatsapp')}" required inputmode="tel"></label><details open><summary>Dados pessoais</summary><label>Data de nascimento<input name="birthDate" type="date" value="${value('birthDate')}"></label><label>Sexo<select name="sex"><option value="">Não informado</option><option value="female" ${current.sex === 'female' ? 'selected' : ''}>Feminino</option><option value="male" ${current.sex === 'male' ? 'selected' : ''}>Masculino</option></select></label></details><details><summary>Contato e endereço</summary><label>E-mail <small>opcional</small><input name="email" type="email" value="${value('email')}"></label><label>CEP<input name="postalCode" value="${value('postalCode')}" inputmode="numeric"></label><label>Logradouro<input name="addressLine" value="${value('addressLine')}"></label><label>Número<input name="addressNumber" value="${value('addressNumber')}"></label><label>Complemento<input name="addressComplement" value="${value('addressComplement')}"></label><label>Bairro<input name="neighborhood" value="${value('neighborhood')}"></label><label>Cidade<input name="city" value="${value('city')}"></label><label>Estado<input name="state" maxlength="2" value="${value('state')}"></label></details><details><summary>Igreja e jornada</summary><label>Situação<select name="personStatus"><option value="">Não informada</option>${['member','visitor','integrating','inactive','transferred'].map((status) => `<option value="${status}" ${current.personStatus === status ? 'selected' : ''}>${statusLabel(status)}</option>`).join('')}</select></label><label class="consent"><input name="baptized" type="checkbox" ${current.baptized ? 'checked' : ''}> Batizado</label><label>Data de batismo <small>opcional</small><input name="baptizedOn" type="date" value="${value('baptizedOn')}"></label></details><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar pessoa</button></div></form>`;
}

function personDetailView(detail) {
  const person = detail.person; const address = [person.addressLine, person.addressNumber, person.addressComplement, person.neighborhood, person.city, person.state, person.postalCode].filter(Boolean).join(' · ');
  const functions = detail.functions.map((item) => `<div class="notice-row"><span>◌</span><p><strong>${h(item.name)}</strong>${item.cell ? ` · ${h(item.cell.name)}` : ' · Igreja'}</p>${canDirectoryManage() && item.scopeType === 'church' ? `<button class="text-button" data-end-church-function="${item.id}" data-person-id="${person.id}">Encerrar</button>` : ''}</div>`).join('') || '<p class="empty-state">Nenhuma função sem login ativa.</p>';
  const journey = detail.journey.modules.map((item) => `<div class="notice-row"><span>${item.completedOn ? '✓' : '○'}</span><p><strong>${h(item.name)}</strong>${item.completedOn ? ` · ${h(item.completedOn)}` : ' · Pendente'}</p></div>`).join('');
  const access = detail.access || { hasAccess: Boolean(detail.appRoles?.length), isActive: Boolean(detail.appRoles?.length), roles: detail.appRoles || [] };
  const appRoles = access.roles?.length ? `<p><strong>Papéis:</strong> ${access.roles.map((code) => h(roles[code]?.label || code)).join(' · ')}</p>` : '<p>Nenhum papel de acesso ativo.</p>';
  const accessAction = !access.isActive ? `<button class="button primary" data-person-grant-access="${person.id}">Conceder acesso</button>` : `<button class="button outline" data-person-revoke-access="${person.id}">Revogar acesso</button>`;
  return `<section class="person-context">${personAvatar(person, 'large')}<div><h3>${h(person.fullName)}</h3><p>${h(statusLabel(person.personStatus))}${detail.membership ? ` · ${h(detail.membership.name)}` : ''}</p></div></section><div class="detail-sections"><details open><summary>Dados pessoais</summary><p>${h(person.birthDate || 'Data de nascimento não informada')} · ${h(person.sex === 'female' ? 'Feminino' : person.sex === 'male' ? 'Masculino' : 'Sexo não informado')}</p></details><details><summary>Contato</summary><p>${h(person.whatsapp)}${person.email ? ` · ${h(person.email)}` : ''}</p><p>${h(address || 'Endereço não informado')}</p></details><details open><summary>Igreja</summary><p><strong>Célula atual:</strong> ${h(detail.membership?.name || 'Sem célula ativa')}</p><p><strong>Lideranças:</strong> ${h(detail.leaderships.map((cell) => cell.name).join(' · ') || 'Nenhuma')}</p><p><strong>Secretaria:</strong> ${h(detail.secretariats.map((cell) => cell.name).join(' · ') || 'Nenhuma')}</p></details><details open><summary>Acesso ao app</summary><p><strong>${access.isActive ? 'Acesso ativo' : 'Sem acesso ao app'}</strong></p>${appRoles}${canDirectoryManage() ? `<div class="inline-actions">${accessAction}</div>` : ''}</details><details><summary>Jornada</summary>${journey}<p><strong>Batismo:</strong> ${detail.journey.baptized ? h(detail.journey.baptizedOn || 'Confirmado') : 'Não informado'}</p>${canDirectoryManage() ? `<form class="inline-form" id="journey-form"><input type="hidden" name="personId" value="${person.id}"><select name="moduleCode">${detail.journey.modules.map((item) => `<option value="${item.code}">${h(item.name)}</option>`).join('')}</select><input name="completedOn" type="date"><button class="text-button">Registrar</button></form>` : ''}</details><details><summary>Funções</summary>${functions}${canDirectoryManage() ? `<form class="inline-form" id="church-function-form"><input type="hidden" name="personId" value="${person.id}"><input type="hidden" name="functionCode" value="treasurer"><button class="text-button">Vincular Tesoureiro</button></form>` : ''}</details>${detail.history.length ? `<details><summary>Histórico</summary>${detail.history.map((item) => `<div class="notice-row"><span>•</span><p>${h(item.previousStatus || 'Início')} → <strong>${h(item.currentStatus)}</strong><br><small>${displayDate(item.createdAt)}</small></p></div>`).join('')}</details>` : ''}</div>${canDirectoryManage() ? `<div class="form-actions"><button class="button outline" data-person-edit="${person.id}">Editar pessoa</button>${person.hasPhoto ? `<button class="button outline" data-person-remove-photo="${person.id}">Remover foto</button>` : ''}</div>` : ''}`;
}

function cellForm(cell = null) {
  const item = cell?.cell || cell || {}; const value = (key) => h(item[key] ?? '');
  const leaderIds = (cell?.leaders || item.leaders || []).map((leader) => leader.id).filter(Boolean);
  const supervisorId = cell?.supervisor?.id || item.supervisor?.id || '';
  const ministryId = cell?.ministry?.id || item.ministry?.id || '';
  return `<form id="cell-form" class="cell-form"><input type="hidden" name="id" value="${value('id')}"><section class="form-section"><p class="eyebrow">IDENTIFICAÇÃO</p><h3>Dados da célula</h3><label>Nome da célula<input name="name" value="${value('name')}" required autocomplete="organization"></label>${ministryPicker('ministryId', ministryId)}${weekdayPicker(item.weekday)}<label>Horário<input name="meetingTime" type="time" value="${h(String(item.meetingTime || '').slice(0,5))}" required></label></section><section class="form-section"><p class="eyebrow">LOCAL</p><h3>Onde a célula se reúne</h3><label>Local/endereço<input name="addressLine" value="${value('addressLine')}" required autocomplete="street-address"></label><label>Bairro<input name="neighborhood" value="${value('neighborhood')}" required></label><label>Cidade<input name="city" value="${value('city')}" required></label><label>Estado<input name="state" maxlength="2" value="${value('state')}" required autocapitalize="characters"></label></section><section class="form-section"><p class="eyebrow">ESTRUTURA</p><h3>Liderança e supervisão</h3>${personPicker('supervisorPersonId', 'Supervisor', supervisorId ? [supervisorId] : [], { help: 'Escolha uma pessoa já vinculada como Supervisora ao ministério selecionado.' })}${personPicker('leaderIds', 'Lideranças', leaderIds, { multiple: true, help: 'É possível selecionar mais de uma liderança. A credencial de acesso permanece separada deste vínculo.' })}<label class="consent"><input name="isActive" type="checkbox" ${item.isActive === false ? '' : 'checked'}> Célula ativa</label></section><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar célula</button></div></form>`;
}

function ministryForm() {
  return `<form id="ministry-form"><p class="form-help">Cadastre um ministério para organizar suas células e equipes. Nenhuma pessoa ou célula será criada automaticamente.</p><label>Nome do ministério<input name="name" maxlength="100" required placeholder="Ex.: Homens"></label><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar ministério</button></div></form>`;
}

function supervisorForm() {
  return `<form id="supervisor-form"><p class="form-help">O Supervisor é uma pessoa já cadastrada. Este vínculo organizacional não cria credencial nem acesso ao aplicativo.</p>${ministryPicker('ministryId', '')}${personPicker('personId', 'Pessoa', [], { help: 'Se a pessoa ainda não existir, cadastre-a em Membros e volte para vinculá-la.' })}<div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Vincular Supervisor</button></div></form>`;
}

function supervisorDetailView(supervisor) {
  const cells = supervisor.cells.map((cell) => `<button class="team-cell-card" data-cell-id="${cell.id}"><span class="person-avatar">◌</span><span><strong>${h(cell.name)}</strong><small>${h(weekdayLabel(cell.weekday))} · ${h(formatTime(cell.meetingTime))}</small><small>${h(cell.leaderNames.join(' · ') || 'Liderança pendente')}</small></span><b aria-hidden="true">›</b></button>`).join('') || '<p class="empty-state">Nenhuma célula vinculada a este Supervisor.</p>';
  return `<section class="person-context">${personAvatar(supervisor, 'large')}<div><h3>${h(supervisor.fullName)}</h3><p>${h(supervisor.ministry.name)} · Supervisão organizacional</p></div></section><section class="team-cell-grid">${cells}</section><p class="identity-help">Acesso ao painel e vínculo de supervisão são controlados separadamente.</p>`;
}

function welcomeTeamForm(teamCode) {
  return `<form id="welcome-team-form"><input type="hidden" name="teamCode" value="${h(teamCode || 'welcome1')}"><p class="form-help">A pessoa precisa possuir acesso individual ativo ao aplicativo. Nenhum login compartilhado é criado.</p>${personPicker('personId', 'Pessoa', [])}<div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Adicionar à equipe</button></div></form>`;
}

function cellDetailView(detail) { const peopleOptions = data.people.map((person) => `<option value="${person.id}">${h(person.fullName)}</option>`).join(''); const leaders = detail.leaders || (detail.leader ? [detail.leader] : []); return `<section class="person-context"><span class="avatar large">◌</span><div><h3>${h(detail.cell.name)}</h3><p>${h(detail.cell.ministry?.name || 'Ministério pendente')} · ${h(weekdayLabel(detail.cell.weekday))} · ${h(String(detail.cell.meetingTime).slice(0,5))}</p></div></section><div class="detail-sections"><details open><summary>Informações gerais</summary><p>${h(detail.cell.addressLine)} · ${h(detail.cell.neighborhood)} · ${h(detail.cell.city)} / ${h(detail.cell.state)}</p><p><strong>Supervisor:</strong> ${h(detail.cell.supervisor?.fullName || 'Não definido')}</p><p>${detail.cell.isActive ? 'Célula ativa' : 'Célula inativa'}</p></details><details open><summary>Lideranças e Secretaria</summary>${leaders.map((leader)=>`<div class="notice-row">${personAvatar(leader,'small')}<p><strong>${h(leader.fullName)}</strong><br><small>${leader.hasPanelAccess ? 'Acesso ao painel ativo' : 'Sem acesso individual ao painel'}</small></p></div>`).join('') || '<p>Liderança pendente.</p>'}${detail.secretaries.map((item)=>`<div class="notice-row"><span>◌</span><p><strong>Secretaria:</strong> ${h(item.fullName)}</p>${canDirectoryManage() ? `<button class="text-button" data-end-secretary="${item.id}" data-cell-id="${detail.cell.id}">Encerrar</button>` : ''}</div>`).join('') || '<p>Secretaria não definida.</p>'}${canDirectoryManage() ? `<button class="button outline" data-cell-edit="${detail.cell.id}">Editar estrutura e lideranças</button><form class="inline-form" id="secretary-form"><input type="hidden" name="cellId" value="${detail.cell.id}"><select name="personId">${peopleOptions}</select><button class="text-button">Adicionar secretaria</button></form>` : ''}</details><details><summary>Participantes</summary>${detail.members.map((item)=>`<div class="notice-row"><span>◌</span><p>${h(item.fullName)} · ${h(statusLabel(item.personStatus))}</p>${canDirectoryManage() ? `<button class="text-button" data-end-member="${item.id}" data-cell-id="${detail.cell.id}">Remover</button>` : ''}</div>`).join('') || '<p class="empty-state">Nenhum participante ativo.</p>'}${canDirectoryManage() ? `<form class="inline-form" id="member-form"><input type="hidden" name="cellId" value="${detail.cell.id}"><select name="personId">${peopleOptions}</select><label class="consent"><input name="transfer" type="checkbox"> Transferir se já estiver em outra célula</label><button class="text-button">Adicionar participante</button></form>` : ''}</details><details><summary>Funções de célula</summary>${detail.functions.map((item)=>`<div class="notice-row"><span>◌</span><p>${h(item.name)} · ${h(item.person.fullName)}</p>${canDirectoryManage() ? `<button class="text-button" data-end-cell-function="${item.id}" data-cell-id="${detail.cell.id}">Encerrar</button>` : ''}</div>`).join('') || '<p class="empty-state">Nenhuma função vinculada.</p>'}${canDirectoryManage() ? `<form class="inline-form" id="cell-function-form"><input type="hidden" name="cellId" value="${detail.cell.id}"><select name="functionCode"><option value="host">Anfitrião</option><option value="social_assistant">Assistente Social</option></select><select name="personId">${peopleOptions}</select><button class="text-button">Vincular função</button></form>` : ''}</details>${detail.membershipHistory.length ? `<details><summary>Histórico de participantes</summary>${detail.membershipHistory.map((item)=>`<div class="notice-row"><span>•</span><p>${h(item.fullName)} · ${h(item.startedAt)}${item.endedAt ? ` → ${h(item.endedAt)}` : ''}</p></div>`).join('')}</details>` : ''}</div>${canDirectoryManage() ? `<div class="form-actions"><button class="button outline" data-cell-edit="${detail.cell.id}">Editar célula</button></div>` : ''}`; }

function meetingDetailView(detail, cellId) { const meeting = detail.meeting; const leader = myCellRole() === 'leader'; const attendance = detail.members.map((person) => `<label class="inline-attendance"><span>${h(person.fullName)}</span><select name="attendance-${person.id}"><option value="present" ${person.attendanceStatus === 'present' ? 'selected' : ''}>Presente</option><option value="absent" ${person.attendanceStatus === 'absent' ? 'selected' : ''}>Ausente</option></select></label>`).join('') || '<p class="empty-state">Nenhum integrante ativo.</p>'; const visitors = detail.visitors.map((person) => `<div class="notice-row"><span>♡</span><p><strong>${h(person.fullName)}</strong>${leader ? ` · ${h(person.whatsapp)}` : ''}</p></div>`).join('') || '<p class="empty-state">Nenhum visitante registrado.</p>'; const photos = detail.photos.map((photo) => `<div class="notice-row"><span>▧</span><p><strong>${h(photo.caption || 'Foto da reunião')}</strong><br><small>${h(photo.status === 'published' ? 'Publicada' : 'Aguardando publicação')}</small></p>${leader ? `<button class="text-button" data-photo-publication="${photo.id}" data-meeting-id="${meeting.id}" data-cell-id="${cellId}" data-published="${photo.status !== 'published'}">${photo.status === 'published' ? 'Despublicar' : 'Publicar'}</button>` : ''}</div>`).join('') || '<p class="empty-state">Nenhuma foto registrada.</p>'; return `<div class="detail-sections"><details open><summary>Reunião</summary><form id="my-meeting-edit-form"><input type="hidden" name="cellId" value="${cellId}"><input type="hidden" name="meetingId" value="${meeting.id}"><label>Data<input name="meetingDate" type="date" value="${h(meeting.date)}" required></label><label>Horário<input name="meetingTime" type="time" value="${h(formatTime(meeting.time))}" required></label><label>Situação<select name="status"><option value="scheduled" ${meeting.status === 'scheduled' ? 'selected' : ''}>Programada</option><option value="held" ${meeting.status === 'held' ? 'selected' : ''}>Realizada</option><option value="not_held" ${meeting.status === 'not_held' ? 'selected' : ''}>Não realizada</option></select></label><label>Nota geral <small>opcional</small><textarea name="notes">${h(meeting.notes)}</textarea></label><label>Observação se não realizada <small>opcional</small><textarea name="notHeldNote">${h(meeting.notHeldNote)}</textarea></label><button class="text-button">Salvar reunião</button></form></details><details open><summary>Presença</summary><form id="my-attendance-form"><input type="hidden" name="cellId" value="${cellId}"><input type="hidden" name="meetingId" value="${meeting.id}">${attendance}<button class="text-button">Salvar presença</button></form></details><details><summary>Visitante presente</summary>${visitors}<form id="my-meeting-visitor-form"><input type="hidden" name="cellId" value="${cellId}"><input type="hidden" name="meetingId" value="${meeting.id}"><label>Nome<input name="fullName" required></label><label>WhatsApp<input name="whatsapp" inputmode="tel" required></label><button class="text-button">Registrar visitante</button></form></details><details><summary>Oferta</summary><p>${meeting.offering ? `Valor registrado · ${h(String(meeting.offering.amount))}` : 'Nenhum valor informado.'}</p><form id="my-meeting-offering-form"><input type="hidden" name="cellId" value="${cellId}"><input type="hidden" name="meetingId" value="${meeting.id}"><label>Valor (R$)<input name="amount" inputmode="decimal" value="${h(meeting.offering?.amount || '')}" required></label><button class="text-button">Salvar oferta</button></form></details><details><summary>Fotos</summary>${photos}<p class="identity-help">O upload depende da configuração futura de storage seguro. Nenhuma imagem é enviada por esta tela ainda.</p></details></div>`; }

function welcomeView() {
  if (!isWelcome()) return layout(`${pageTitle('ACESSO RESTRITO', 'Boas-Vindas', 'Esta área está disponível apenas para as equipes autorizadas.')}<section class="card access-card"><span>♡</span><h2>Você não possui acesso a esta área.</h2><p>Use o seletor de perfil para visualizar a experiência de uma equipe autorizada.</p></section>`);
  if (activeRole === 'welcome1') {
    const rows = data.receptionVisitors.map((visitor) => `<article class="person-row"><span class="person-avatar">${initials(visitor.fullName)}</span><div class="person-main"><strong>${h(visitor.fullName)}</strong><p>${h(visitor.whatsapp)} · ${h(visitor.source)}</p></div><span class="status ${visitor.receptionStatus === 'new' ? 'em-análise' : ''}">${h(receptionStatusLabel(visitor.receptionStatus))}</span><button class="text-button" data-reception-visitor="${visitor.id}">Confirmar</button></article>`).join('') || empty('Nenhum visitante aguardando recepção.');
    return layout(`${pageTitle('MINISTÉRIO BOAS-VINDAS', 'Recepção', 'Confirme dados essenciais e acolha cada pessoa com simplicidade.', `<div class="button-group"><button class="button outline" data-modal="pre-registration-link">Pré-cadastro público</button><button class="button primary" data-modal="reception-create">${icons.plus} Visitante</button></div>`)}<div class="welcome-intro"><span>♡</span><div><strong>Receber bem começa com atenção.</strong><p>Nome, WhatsApp e origem são suficientes para esta etapa.</p></div></div><section class="card list-card"><div class="card-heading"><div><h2>Visitantes recebidos</h2><p>Pré-cadastros e registros presenciais aguardando confirmação.</p></div></div>${rows}</section>`);
  }
  if (activeRole === 'welcome2') {
    const visitors = data.careVisitors.map((visitor) => `<article class="person-row"><span class="person-avatar">${initials(visitor.fullName)}</span><div class="person-main"><strong>${h(visitor.fullName)}</strong><p>${h(visitor.source)}${visitor.nextStep ? ` · ${h(visitor.nextStep)}` : ''}</p></div><span class="status ${visitor.careStatus === 'open' || !visitor.careStatus ? 'em-análise' : ''}">${h(careStatusLabel(visitor.careStatus || 'new'))}</span><button class="text-button" data-care-visitor="${visitor.visitorId}" data-care-case="${visitor.careCaseId || ''}">${visitor.careCaseId ? 'Abrir' : 'Iniciar'}</button></article>`).join('') || empty('Nenhum visitante aguardando acompanhamento.');
    const referrals = data.careReferrals.map((referral) => `<article class="person-row"><span class="person-avatar">${initials(referral.fullName)}</span><div class="person-main"><strong>${h(referral.fullName)}</strong><p>Indicada por ${h(referral.referrerName)}${referral.referrerNote ? ` · ${h(referral.referrerNote)}` : ''}</p></div><span class="status ${referral.careStatus === 'open' || !referral.careStatus ? 'em-análise' : ''}">${h(careStatusLabel(referral.careStatus || referral.status))}</span><button class="text-button" data-care-referral="${referral.referralId}" data-care-case="${referral.careCaseId || ''}">${referral.careCaseId ? 'Abrir' : 'Iniciar'}</button></article>`).join('') || empty('Nenhuma indicação aguardando análise.');
    return layout(`${pageTitle('MINISTÉRIO BOAS-VINDAS', 'Acompanhamento', 'Organize o cuidado com discrição e defina manualmente cada próximo passo.')}<div class="welcome-intro"><span>♡</span><div><strong>Pessoas cuidam de pessoas.</strong><p>Registros de acompanhamento são privados da Equipe 2.</p></div></div><div class="tabs"><button class="${welcomeTab === 'visitors' ? 'active' : ''}" data-tab="visitors">Visitantes</button><button class="${welcomeTab === 'referrals' ? 'active' : ''}" data-tab="referrals">Indicações</button></div><section class="card list-card"><div class="card-heading"><div><h2>${welcomeTab === 'referrals' ? 'Indicações recebidas' : 'Visitantes para acompanhamento'}</h2><p>${welcomeTab === 'referrals' ? 'A indicação original é preservada antes de iniciar o cuidado.' : 'Abra um caso somente quando o cuidado precisar começar.'}</p></div></div>${welcomeTab === 'referrals' ? referrals : visitors}</section>`);
  }
  return layout(`${pageTitle('MINISTÉRIO BOAS-VINDAS', 'Boas-Vindas', 'Acesse uma função da Equipe 1 ou Equipe 2 para trabalhar neste módulo.')}<section class="card access-card"><span>♡</span><h2>Visão operacional não disponível para esta função.</h2></section>`);
}

function receptionStatusLabel(status) { return ({ new: 'Novo', confirmed: 'Confirmado', sent_to_care: 'Em acompanhamento', closed: 'Encerrado' })[status] || status; }
function careStatusLabel(status) { return ({ new: 'Novo', open: 'Em acompanhamento', waiting: 'Aguardando', referred_to_cell: 'Encaminhado para célula', closed: 'Encerrado' })[status] || status; }

function adminView() {
  return settingsView();
}

function offeringStatusLabel(status) { return ({ pending: 'Pendente', sent: 'Enviado', confirmed: 'Confirmado' })[status] || status; }
function currency(value) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0)); }
function adminOfferingsView() {
  const rows = data.adminOfferings || [];
  const cellsForFilter = data.managementCells || [];
  return `<section class="card list-card"><div class="card-heading"><div><p class="eyebrow">CONTROLE ADMINISTRATIVO</p><h2>Ofertas</h2><p>Registros das reuniões para conferência e encaminhamento à Tesouraria.</p></div></div><form id="admin-offering-filter" class="inline-form"><select name="status"><option value="">Todos os status</option>${['pending','sent','confirmed'].map(value=>`<option value="${value}" ${offeringFilters.status===value?'selected':''}>${offeringStatusLabel(value)}</option>`).join('')}</select><select name="cellId"><option value="">Todas as células</option>${cellsForFilter.map(cell=>`<option value="${h(cell.id)}" ${offeringFilters.cellId===cell.id?'selected':''}>${h(cell.name)}</option>`).join('')}</select><input name="from" type="date" value="${h(offeringFilters.from)}"><input name="to" type="date" value="${h(offeringFilters.to)}"><button class="text-button">Filtrar</button></form>${rows.map(item=>`<article class="person-row"><span class="person-avatar">R$</span><div class="person-main"><strong>${h(formatCellDate(item.meetingDate))} · ${h(item.cell.name)}</strong><p>${h(currency(item.amount))} · ${h(offeringStatusLabel(item.status))}</p></div><span class="status ${item.status === 'pending' ? 'em-análise' : ''}">${h(offeringStatusLabel(item.status))}</span><button class="text-button" data-admin-offering="${item.meetingId}">Ver</button></article>`).join('') || empty('Nenhuma oferta encontrada para este filtro.')}</section>`;
}

function teamsView() {
  if (!canAdmin()) return layout(`${pageTitle('ACESSO RESTRITO', 'Equipes', 'Apenas administradores podem acessar esta área.')}<section class="card access-card"><h2>Você não possui acesso a Equipes.</h2></section>`);
  const structure = data.teams || { ministries: [], supervisors: [], welcomeTeams: { welcome1: [], welcome2: [] } };
  const selectedMinistry = structure.ministries.find((ministry) => ministry.id === teamFocusMinistryId) || null;
  const cells = (data.managementCells || []).filter((cell) => !selectedMinistry || cell.ministry?.id === selectedMinistry.id);
  const leaders = cells.flatMap((cell) => (cell.leaders || []).map((leader) => ({ ...leader, cell })));
  const ministryCards = structure.ministries.map((ministry) => `<button class="team-category ${selectedMinistry?.id === ministry.id ? 'selected' : ''}" data-team-ministry="${ministry.id}"><span>◒</span><div><h2>${h(ministry.name)}</h2><p>${ministry.cellCount} célula${ministry.cellCount === 1 ? '' : 's'} · ${ministry.supervisorCount} supervisor${ministry.supervisorCount === 1 ? '' : 'es'} · ${ministry.leaderCount} liderança${ministry.leaderCount === 1 ? '' : 's'}.</p></div><b>›</b></button>`).join('') || '<p class="empty-state">Nenhum ministério disponível até a migration organizacional ser aplicada.</p>';
  const cellCards = cells.map((cell) => `<button class="team-cell-card" data-cell-id="${cell.id}"><span class="person-avatar">◌</span><span><strong>${h(cell.name)}</strong><small>${h(weekdayLabel(cell.weekday))} · ${h(formatTime(cell.meetingTime))}</small><small>${h(cell.leaderName || 'Liderança pendente')} · ${h(cell.neighborhood || 'Local a definir')}</small></span><b aria-hidden="true">›</b></button>`).join('') || empty('Nenhuma célula cadastrada neste ministério.');
  const supervisorRows = structure.supervisors.filter((supervisor) => !selectedMinistry || supervisor.ministry.id === selectedMinistry.id).map((supervisor) => `<button class="team-person-row" data-team-supervisor="${supervisor.id}">${personAvatar(supervisor)}<span><strong>${h(supervisor.fullName)}</strong><small>${h(supervisor.ministry.name)} · ${supervisor.cellCount} célula${supervisor.cellCount === 1 ? '' : 's'} supervisionada${supervisor.cellCount === 1 ? '' : 's'}</small></span><b aria-hidden="true">›</b></button>`).join('') || '<p class="empty-state">Nenhum Supervisor vinculado ainda.</p>';
  const leaderRows = leaders.map((leader) => `<button class="team-person-row" data-cell-id="${leader.cell.id}">${personAvatar(leader)}<span><strong>${h(leader.fullName)}</strong><small>${h(leader.cell.ministry?.name || 'Sem ministério')} · ${h(leader.cell.name)}</small></span><b aria-hidden="true">›</b></button>`).join('') || '<p class="empty-state">Nenhuma liderança vinculada ainda.</p>';
  const welcome = structure.welcomeTeams || { welcome1: [], welcome2: [] };
  const welcomeRows = (teamCode, title, description) => `<article><span>${teamCode === 'welcome1' ? '1' : '2'}</span><div><strong>${title}</strong><p>${description}</p>${(welcome[teamCode] || []).map((person) => `<span class="team-member-chip">${h(person.fullName)}<button type="button" data-remove-welcome-member="${teamCode}" data-person-id="${person.personId}" aria-label="Remover ${h(person.fullName)}">×</button></span>`).join('') || '<small>Nenhum integrante com acesso individual ativo.</small>'}</div><button class="text-button" data-modal="welcome-team-form" data-team-code="${teamCode}">Adicionar</button></article>`;
  return layout(`${pageTitle('ADMINISTRAÇÃO', 'Equipes', 'Ministérios, pessoas e vínculos organizados para servir melhor.')}<div class="team-category-grid"><section class="team-category"><span>◒</span><div><h2>Ministérios</h2><p>${structure.ministries.length} estrutura${structure.ministries.length === 1 ? '' : 's'} disponível${structure.ministries.length === 1 ? '' : 'is'}.</p></div></section><section class="team-category"><span>◉</span><div><h2>Supervisores</h2><p>${structure.supervisors.length} vínculo${structure.supervisors.length === 1 ? '' : 's'} organizacional${structure.supervisors.length === 1 ? '' : 'is'}.</p></div></section><button class="team-category" data-route="cells"><span>◌</span><div><h2>Células</h2><p>${cells.length} célula${cells.length === 1 ? '' : 's'} ${selectedMinistry ? `em ${h(selectedMinistry.name)}` : 'cadastrada(s)'}.</p></div><b>›</b></button><section class="team-category"><span>♡</span><div><h2>Boas-Vindas</h2><p>Equipe 1 e Equipe 2 com acesso individual.</p></div></section></div><section class="admin-section"><div class="section-title"><div><p class="eyebrow">MINISTÉRIOS</p><h2>${selectedMinistry ? selectedMinistry.name : 'Estrutura por ministério'}</h2><p>${selectedMinistry ? 'Toque novamente para voltar à visão geral.' : 'Família, Jovens, Mulheres, Kids e novos ministérios.'}</p></div><div class="button-group"><button class="button outline" data-team-ministry="">Todos</button><button class="button primary" data-modal="ministry-form">+ Ministério</button></div></div><div class="team-category-grid">${ministryCards}</div></section><section class="admin-section"><div class="section-title"><div><p class="eyebrow">SUPERVISÃO</p><h2>Supervisores</h2></div><button class="button primary" data-modal="supervisor-form">+ Supervisor</button></div><div class="team-person-list">${supervisorRows}</div></section><section class="admin-section"><div class="section-title"><div><p class="eyebrow">CÉLULAS</p><h2>${selectedMinistry ? `Células · ${h(selectedMinistry.name)}` : 'Células cadastradas'}</h2></div><button class="button primary" data-modal="cell-form">+ Nova célula</button></div><div class="team-cell-grid">${cellCards}</div></section><section class="admin-section"><div class="section-title"><div><p class="eyebrow">LIDERANÇAS</p><h2>Líderes por ministério</h2><p>Liderança e credencial de acesso são vínculos separados.</p></div></div><div class="team-person-list">${leaderRows}</div></section><section class="admin-section"><div class="section-title"><div><p class="eyebrow">BOAS-VINDAS</p><h2>Equipes de recepção e acompanhamento</h2></div></div><div class="welcome-team-summary">${welcomeRows('welcome1', 'Equipe 1 — cadastro e recepção', 'Registra e confirma dados básicos de visitantes.')}${welcomeRows('welcome2', 'Equipe 2 — acompanhamento', 'Cuida dos acompanhamentos e encaminhamentos privados.')}</div></section>`);
}

function reportsView() {
  if (!canAdmin()) return layout(`${pageTitle('ACESSO RESTRITO', 'Relatórios', 'Apenas administradores podem acessar esta área.')}<section class="card access-card"><h2>Você não possui acesso a Relatórios.</h2></section>`);
  const cells = data.managementCells || [];
  return layout(`${pageTitle('ADMINISTRAÇÃO', 'Relatórios', 'Informações administrativas para organização e cuidado, sem comparações entre células.')}<section class="report-intro"><span>▤</span><div><strong>Relatórios por célula</strong><p>Selecione uma célula para consultar sua ficha e os vínculos disponíveis. Reuniões, presenças e fotos dependerão de uma consulta administrativa consolidada, ainda não exposta pela API.</p></div></section><section class="report-cell-picker"><p class="eyebrow">CÉLULAS</p><div>${cells.map((cell) => `<button class="report-cell-option" data-cell-id="${cell.id}"><strong>${h(cell.name)}</strong><small>${h(weekdayLabel(cell.weekday))} · ${h(formatTime(cell.meetingTime))}</small><span>Ver ficha ›</span></button>`).join('') || empty('Nenhuma célula cadastrada.')}</div></section>${adminOfferingsView()}`);
}

function settingsView() {
  if (!canAdmin()) return layout(`${pageTitle('ACESSO RESTRITO', 'Configurações', 'Apenas administradores podem acessar esta área.')}<section class="card access-card"><h2>Você não possui acesso a Configurações.</h2></section>`);
  const brand = branding();
  const brandingAdmin = data.brandingAdministration || { church: null, themes: [] };
  const activeTheme = brandingAdmin.themes.find((theme) => theme.is_active) || null;
  const themes = brandingAdmin.themes.map((theme) => `<button class="settings-theme-row" data-admin-theme="${h(theme.id)}"><span>◒</span><span><strong>${h(theme.title)}</strong><small>${h(theme.subtitle || '')} · ${h(theme.year)}${theme.is_active ? ' · Ativo' : ''}</small></span><b>Editar</b></button>`).join('') || '<p class="empty-state">Nenhum tema anual persistido.</p>';
  return layout(`${pageTitle('ADMINISTRAÇÃO', 'Configurações', 'Identidade, acesso à conta e recursos públicos da igreja.')}<section class="settings-grid"><article class="settings-card"><div class="settings-card-heading"><div><p class="eyebrow">IDENTIDADE VISUAL</p><h2>Logotipo</h2></div><button class="text-button" data-modal="admin-branding">Editar</button></div><div class="identity-preview"><span class="brand-mark ${brand.logoUrl ? 'has-image' : ''}">${brand.logoUrl ? `<img src="${h(brand.logoUrl)}" alt="Logo configurado">` : '<span>C</span>'}</span><div><strong>${h(brand.applicationName)}</strong><p>${brandingAdmin.church ? 'Identidade personalizada' : 'Visual padrão em uso'}</p></div></div></article><article class="settings-card"><div class="settings-card-heading"><div><p class="eyebrow">IDENTIDADE VISUAL</p><h2>Fundo do aplicativo</h2></div><button class="text-button" data-modal="admin-branding">Editar</button></div>${brand.backgroundUrl ? `<img class="settings-background-preview" src="${h(brand.backgroundUrl)}" alt="Prévia do fundo configurado">` : '<p>O fundo padrão escuro permanece ativo até uma imagem ser configurada.</p>'}</article><article class="settings-card"><div class="settings-card-heading"><div><p class="eyebrow">TEMA ANUAL</p><h2>${h(activeTheme?.title || brand.annualTheme.name)}</h2></div><button class="text-button" data-modal="admin-theme">Novo tema</button></div><p>${h(activeTheme?.subtitle || brand.annualTheme.subtitle)}</p><div class="settings-theme-list">${themes}</div></article><article class="settings-card"><div class="settings-card-heading"><div><p class="eyebrow">VISITANTES</p><h2>QR Code do visitante</h2></div><button class="text-button" data-action="load-public-qr">Abrir</button></div><p>Gere, copie, compartilhe ou baixe o QR Code que direciona ao pré-cadastro público.</p><button class="button outline" data-action="load-public-qr">Gerar QR Code</button></article><article class="settings-card"><div class="settings-card-heading"><div><p class="eyebrow">MINHA CONTA</p><h2>${h(data.currentUser.name)}</h2></div><button class="text-button" data-modal="profile">Abrir</button></div><p>Atualize somente as informações pessoais que já possuem suporte seguro.</p></article></section>`);
}

function modalView() {
  let title = { refer: 'Indicar alguém', 'pre-registration-link': 'Pré-cadastro de visitantes', profile: 'Editar informações', 'person-form': 'Pessoa', 'person-detail': 'Ficha da pessoa', 'person-access': 'Conceder acesso ao app', 'cell-form': 'Célula', 'cell-detail': 'Ficha da célula', 'ministry-form': 'Novo ministério', 'supervisor-form': 'Adicionar Supervisor', 'supervisor-detail': 'Supervisor', 'welcome-team-form': 'Integrante de Boas-Vindas' }[modal.kind];
  let body = '';
  if (modal.kind === 'refer') body = formFields('referral');
  if (modal.kind === 'pre-registration-link') { const url = new URL('/visitante', window.location.origin).toString(); body = `<p class="form-help">Compartilhe este endereço com quem estiver visitando a igreja. O formulário público solicita somente nome, WhatsApp e consentimento.</p><label>Endereço público<input value="${h(url)}" readonly></label><div class="form-actions"><button type="button" class="button outline" data-action="copy-pre-registration-url">Copiar endereço</button><a class="button primary" href="${h(url)}" target="_blank" rel="noopener">Abrir pré-cadastro</a></div>`; }
  if (modal.kind === 'profile') { const profile = data.profile || data.currentUser; body = `<form id="profile-form"><label>Nome<input name="name" value="${h(profile.name)}" required></label><label>WhatsApp<input name="whatsapp" value="${h(profile.whatsapp)}" required inputmode="tel"></label><label>E-mail <small>opcional</small><input name="email" type="email" value="${h(profile.email || '')}"></label><label>Data de nascimento <small>opcional</small><input name="birthDate" type="date" value="${h(profile.birthDate || '')}"></label><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar configuração</button></div></form>`; }
  if (modal.kind === 'person-form') body = personForm(modal.item);
  if (modal.kind === 'person-detail') body = personDetailView(modal.item);
  if (modal.kind === 'person-access') body = personAccessForm(modal.item);
  if (modal.kind === 'cell-form') body = cellForm(modal.item);
  if (modal.kind === 'cell-detail') body = cellDetailView(modal.item);
  if (modal.kind === 'ministry-form') body = ministryForm();
  if (modal.kind === 'supervisor-form') body = supervisorForm();
  if (modal.kind === 'supervisor-detail') body = supervisorDetailView(modal.item);
  if (modal.kind === 'welcome-team-form') { title = modal.item?.teamCode === 'welcome2' ? 'Adicionar à Equipe 2' : 'Adicionar à Equipe 1'; body = welcomeTeamForm(modal.item?.teamCode); }
  if (modal.kind === 'meeting-detail') { title = 'Reunião da célula'; body = meetingDetailView(modal.item, modal.cellId); }
  if (modal.kind === 'admin-user') { title = modal.item?'Editar usuário':'Novo usuário'; body = adminUserForm(modal.item); }
  if (modal.kind === 'admin-cell') { title = modal.item?'Editar célula':'Nova célula'; body = adminCellForm(modal.item); }
  if (modal.kind === 'admin-scope') { title = 'Escopo do Supervisor'; body = adminScopeForm(modal.item); }
  if (modal.kind === 'admin-branding') { title = 'Identidade da igreja'; body = adminBrandingForm(); }
  if (modal.kind === 'admin-theme') { title = modal.item ? 'Editar tema anual' : 'Novo tema anual'; body = adminThemeForm(modal.item); }
  if (modal.kind === 'admin-offering') { title = 'Oferta da reunião'; body = adminOfferingDetail(modal.item); }
  if (modal.kind === 'reception-visitor') { title = 'Confirmar / completar cadastro'; body = receptionVisitorForm(modal.item); }
  if (modal.kind === 'reception-create') { title = 'Cadastrar visitante'; body = receptionCreateForm(); }
  if (modal.kind === 'care-case') { title = 'Acompanhamento'; body = careCaseForm(modal.item); }
  if (modal.kind === 'admin-qr') { title = 'Pré-cadastro de visitantes'; body = `<div class="qr-public"><img src="${modal.item.image}" alt="QR Code para pré-cadastro de visitantes"><p><strong>URL pública</strong><br><a href="${h(modal.item.url)}" target="_blank" rel="noopener">${h(modal.item.url)}</a></p><p>É sua primeira vez conosco? Escaneie o QR Code e faça seu pré-cadastro.</p><div class="form-actions"><button type="button" class="button outline" data-action="copy-public-qr-url">Copiar URL</button><button type="button" class="button outline" data-action="share-public-qr-url">Compartilhar URL</button><a class="button outline" download="cem-connect-visitantes.png" href="${modal.item.image}">Baixar imagem</a><button type="button" class="button outline" data-action="share-public-qr-image">Compartilhar imagem</button><button type="button" class="button primary" data-action="print-public-qr">Imprimir QR Code</button></div></div>`; }
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="modal-header"><div><p class="eyebrow">CEM CONNECT</p><h2 id="modal-title">${title}</h2></div><button class="modal-close" data-close-modal aria-label="Fechar janela">${icons.close}</button></div>${body}</section></div>`;
}

function personAccessForm(detail) {
  const person = detail.person;
  const selected = new Set(detail.access?.roles?.length ? detail.access.roles : ['member']);
  return `<form id="person-access-form"><input type="hidden" name="personId" value="${h(person.id)}"><p class="form-help">A credencial é individual e não altera os vínculos de membro, liderança, supervisão ou equipe. Defina uma senha inicial diretamente com a pessoa.</p><label>Senha inicial<input name="password" type="password" autocomplete="new-password" required minlength="10"></label><p class="identity-help">Mínimo de 10 caracteres, com letra maiúscula, minúscula, número e caractere especial.</p><fieldset><legend>Papéis autorizados</legend>${Object.entries(roles).map(([code, roleInfo]) => `<label class="consent"><input type="checkbox" name="roles" value="${h(code)}" ${selected.has(code) ? 'checked' : ''}> ${h(roleInfo.label)}</label>`).join('')}</fieldset><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Conceder acesso</button></div></form>`;
}

function receptionCreateForm() { return `<form id="reception-create-form"><p class="form-help">Registre somente os dados necessários para a recepção.</p><label>Nome<input name="fullName" required maxlength="120"></label><label>WhatsApp<input name="whatsapp" required inputmode="tel"></label><label>Origem<select name="source"><option value="Culto">Culto</option><option value="Evento">Evento</option><option value="Célula">Célula</option><option value="Outro">Outro</option></select></label><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar cadastro</button></div></form>`; }
function careCaseForm(detail) {
  const care = detail.careCase; const subject = care.subject; const records = detail.records.map((record) => `<div class="notice-row"><span>•</span><p><strong>${h({ attempt: 'Tentativa', contact: 'Contato', visit: 'Visita', other: 'Outro' }[record.contactType] || record.contactType)}</strong>${record.privateNote ? `<br>${h(record.privateNote)}` : ''}${record.nextStep ? `<br><small>Próximo passo: ${h(record.nextStep)}</small>` : ''}<br><small>${h(displayDate(record.createdAt))}</small></p></div>`).join('') || '<p class="empty-state">Nenhum registro privado ainda.</p>';
  const referrals = detail.referrals.map((item) => `<div class="notice-row"><span>→</span><p><strong>${h(item.cellName)}</strong> · ${h(item.status === 'returned' ? 'Devolvido' : 'Enviado')}${item.noteForCell ? `<br><small>${h(item.noteForCell)}</small>` : ''}${item.returnNote ? `<br><small>Devolução: ${h(item.returnNote)}</small>` : ''}</p></div>`).join('') || '<p class="empty-state">Nenhum encaminhamento registrado.</p>';
  return `<section class="person-context"><span class="person-avatar">${initials(subject.fullName)}</span><div><strong>${h(subject.fullName)}</strong><p>${h(subject.whatsapp)} · ${h(subject.source)}</p>${subject.referrerName ? `<p>Indicada por ${h(subject.referrerName)}${subject.referrerNote ? ` · ${h(subject.referrerNote)}` : ''}</p>` : ''}</div></section><div class="detail-sections"><details open><summary>Próximo passo</summary><form id="care-case-update-form"><input type="hidden" name="caseId" value="${care.id}"><label>Situação<select name="status">${['open','waiting','referred_to_cell','closed'].map(status=>`<option value="${status}" ${care.status===status?'selected':''}>${careStatusLabel(status)}</option>`).join('')}</select></label><label>Próximo passo <small>opcional</small><textarea name="nextStep" maxlength="1000">${h(care.nextStep)}</textarea></label><button class="text-button">Salvar situação</button></form></details><details open><summary>Registrar contato privado</summary><form id="care-record-form"><input type="hidden" name="caseId" value="${care.id}"><label>Tipo<select name="contactType"><option value="attempt">Tentativa</option><option value="contact">Contato</option><option value="visit">Visita</option><option value="other">Outro</option></select></label><label>Observação privada <small>opcional</small><textarea name="privateNote" maxlength="5000"></textarea></label><label>Próximo passo <small>opcional</small><input name="nextStep" maxlength="1000"></label><button class="text-button">Registrar</button></form>${records}</details><details><summary>Encaminhar para célula</summary><form id="care-referral-form"><input type="hidden" name="caseId" value="${care.id}"><label>Célula<select name="cellId" required><option value="">Selecione manualmente</option>${detail.cells.map(cell=>`<option value="${cell.id}">${h(cell.name)} · ${h(cell.neighborhood)} · ${h(weekdayLabel(cell.weekday))} ${h(String(cell.meetingTime).slice(0,5))} · ${h(cell.leaderName)}</option>`).join('')}</select></label><label>Observação para a célula <small>opcional e compartilhável</small><textarea name="noteForCell" maxlength="1000"></textarea></label><button class="text-button">Encaminhar</button></form>${referrals}</details></div>`;
}

function adminOfferingDetail(detail) {
  const offer = detail.offering; const canSend = offer.status === 'pending'; const canConfirm = offer.status === 'sent';
  const history = detail.adjustments.map((item) => `<div class="notice-row"><span>↺</span><p><strong>${h(currency(item.previousAmount))} → ${h(currency(item.correctedAmount))}</strong>${item.administrativeNote ? `<br><small>${h(item.administrativeNote)}</small>` : ''}<br><small>${h(displayDate(item.createdAt))}${item.changedBy ? ` · ${h(item.changedBy)}` : ''}</small></p></div>`).join('') || '<p class="empty-state">Nenhuma correção registrada.</p>';
  return `<div class="person-context"><span class="person-avatar">R$</span><div><strong>${h(offer.cell.name)}</strong><p>${h(formatCellDate(offer.meetingDate))} · ${h(currency(offer.amount))}</p></div></div><div class="detail-sections"><details open><summary>Situação</summary><p><span class="status ${offer.status === 'pending' ? 'em-análise' : ''}">${h(offeringStatusLabel(offer.status))}</span></p><p>${offer.sentAt ? `Enviado ${h(displayDate(offer.sentAt))}${offer.sentBy ? ` por ${h(offer.sentBy)}` : ''}.` : 'Ainda não enviado à Tesouraria.'}</p>${offer.administrativeNote ? `<p><strong>Observação administrativa:</strong><br>${h(offer.administrativeNote)}</p>` : ''}${canSend || canConfirm ? `<form id="admin-offering-status-form"><input type="hidden" name="meetingId" value="${h(offer.meetingId)}"><input type="hidden" name="status" value="${canSend ? 'sent' : 'confirmed'}"><label>Observação administrativa <small>opcional</small><textarea name="administrativeNote" maxlength="2000"></textarea></label><button class="button primary">${canSend ? 'Marcar como enviado' : 'Confirmar recebimento'}</button></form>` : '<p class="identity-help">Fluxo administrativo concluído.</p>'}</details><details open><summary>Corrigir valor</summary><form id="admin-offering-correction-form"><input type="hidden" name="meetingId" value="${h(offer.meetingId)}"><label>Novo valor (R$)<input name="amount" inputmode="decimal" value="${h(offer.amount)}" required></label><label>Observação administrativa <small>opcional</small><textarea name="administrativeNote" maxlength="2000"></textarea></label><button class="text-button">Registrar correção</button></form></details><details><summary>Histórico de correções</summary>${history}</details></div>`;
}

function formFields(kind, fromQr = false, standalone = false) {
  const isReferral = kind === 'referral';
  return `<form id="${kind}-form"><p class="form-help">${isReferral ? 'A Equipe 2 receberá esta indicação para analisar e decidir o próximo passo. Você receberá apenas a confirmação do envio.' : fromQr ? 'Leva menos de um minuto. A equipe poderá confirmar seus dados depois.' : 'Registre somente o necessário para que a Equipe 2 possa acolher esta pessoa.'}</p><label>Nome<input name="name" placeholder="Nome completo" required autocomplete="name"></label><label>WhatsApp<input name="whatsapp" placeholder="(00) 00000-0000" required inputmode="tel"></label>${isReferral || !fromQr ? `<label>Observação <small>opcional</small><textarea name="note" placeholder="Uma informação breve, se desejar."></textarea></label>` : ''}${fromQr ? `<label class="consent"><input type="checkbox" name="consent" required> Autorizo o contato da CEM Church pelo WhatsApp informado.</label>` : ''}<div class="form-actions">${standalone ? '' : '<button type="button" class="button outline" data-close-modal>Cancelar</button>'}<button class="button primary">${isReferral ? 'Enviar indicação' : 'Salvar cadastro'}</button></div></form>`;
}
function adminUserForm(user) { const selected=user?.roles||['member']; return `<form id="admin-user-form"><input name="id" type="hidden" value="${user?.id||''}"><label>Nome<input name="name" value="${h(user?.name||'')}" required></label><label>WhatsApp<input name="whatsapp" value="${h(user?.whatsapp||'')}" required></label><label>E-mail<input name="email" type="email" value="${h(user?.email||'')}" required></label>${!user?'<label>Senha inicial<input name="password" type="password" required></label>':''}<fieldset><legend>Funções</legend>${Object.entries(roles).map(([id,r])=>`<label class="consent"><input type="checkbox" name="roles" value="${id}" ${selected.includes(id)?'checked':''}> ${r.label}</label>`).join('')}</fieldset>${user?`<label class="consent"><input type="checkbox" name="active" ${user.active?'checked':''}> Acesso ativo</label><label>Nova senha <small>opcional</small><input name="newPassword" type="password"></label>`:''}<div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar</button></div></form>`; }
function adminCellForm(cell) { const current=cell?.members?.map(m=>m.id)||[]; const people=(data.administration?.people||[]); return `<form id="admin-cell-form"><input name="id" type="hidden" value="${cell?.id||''}"><label>Nome da célula<input name="name" value="${h(cell?.name||'')}" required></label><label>Dia da semana<input name="weekday" value="${h(cell?.weekday||'')}" required></label><label>Horário<input name="meetingTime" type="time" value="${h(cell?.meeting_time||cell?.meetingTime||'')}" required></label><label>Local/endereço<input name="location" value="${h(cell?.location||'')}" required></label><label>Bairro<input name="neighborhood" value="${h(cell?.neighborhood||'')}" required></label><label>Cidade<input name="city" value="${h(cell?.city||'')}" required></label><label>Estado<input name="state" value="${h(cell?.state||'')}" required></label><label class="consent"><input name="active" type="checkbox" ${cell?.active===0?'':'checked'}> Célula ativa</label><label>Liderança<select name="leader"><option value="">Liderança pendente</option>${people.map(p=>`<option value="${p.id}" ${Number(p.id)===Number(cell?.leader_person_id)?'selected':''}>${h(p.name)}</option>`).join('')}</select></label>${cell?`<label>Integrantes <small>ao selecionar alguém de outra célula, a confirmação será solicitada.</small><select name="members" multiple size="6">${people.map(p=>`<option value="${p.id}" ${current.includes(p.id)?'selected':''}>${h(p.name)}</option>`).join('')}</select></label>`:''}<div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar célula</button></div></form>`; }
function adminScopeForm(user) { return `<form id="admin-scope-form"><input name="id" type="hidden" value="${user.id}"><p class="form-help">Selecione as células que este Supervisor pode acompanhar.</p>${cells.map(c=>`<label class="consent"><input type="checkbox" name="cellIds" value="${c.id}" ${user.cellIds.includes(c.id)?'checked':''}> ${h(c.name)}</label>`).join('')}<div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar escopo</button></div></form>`; }
function adminBrandingForm() { const persisted = data.brandingAdministration?.church; const currentBrand = branding(); const logo = persisted?.logo_url || ''; const background = persisted?.background_url || currentBrand.backgroundUrl || ''; return `<form id="admin-branding-form"><p class="form-help">Envie PNG, JPEG ou WebP de até 5 MB. Os arquivos públicos de identidade ficam no Storage próprio da igreja.</p><label>Nome do aplicativo<input name="appName" value="${h(persisted?.app_name || currentBrand.applicationName)}" placeholder="CEM CONNECT" required></label><label>Nome da igreja<input name="churchName" value="${h(persisted?.church_name || currentBrand.churchName)}" placeholder="CEM Church" required></label><section class="asset-control"><p>Logotipo atual</p>${logo ? `<img src="${h(logo)}" alt="Pré-visualização do logotipo atual">` : '<div class="asset-placeholder" aria-hidden="true">C</div>'}<label>Substituir logotipo<input name="logoFile" type="file" accept="image/png,image/jpeg,image/webp"></label><label class="consent"><input name="removeLogo" type="checkbox"> Remover e restaurar o visual padrão</label></section><section class="asset-control"><p>Fundo do aplicativo</p>${background ? `<img class="asset-background" src="${h(background)}" alt="Pré-visualização do fundo atual">` : '<div class="asset-placeholder banner" aria-hidden="true">Fundo padrão</div>'}<label>Substituir fundo<input name="backgroundFile" type="file" accept="image/png,image/jpeg,image/webp"></label><label class="consent"><input name="removeBackground" type="checkbox"> Restaurar fundo padrão</label></section><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar identidade</button></div></form>`; }
function adminThemeForm(theme) { const colors = theme?.colors || {}; const banner = theme?.banner_url || ''; return `<form id="admin-theme-form"><input name="id" type="hidden" value="${h(theme?.id || '')}"><p class="form-help">Título, frase e cores permanecem configuráveis. O banner aceita PNG, JPEG ou WebP de até 5 MB.</p><label>Nome do tema<input name="name" value="${h(theme?.title || '')}" placeholder="Legado" required></label><label>Frase <small>opcional</small><input name="subtitle" value="${h(theme?.subtitle || '')}" placeholder="a luz da tua presença"></label><label>Ano<input name="year" type="number" min="2000" max="2100" value="${h(theme?.year || '')}" required></label><section class="asset-control"><p>Banner atual</p>${banner ? `<img class="asset-banner" src="${h(banner)}" alt="Pré-visualização do banner atual">` : '<div class="asset-placeholder banner" aria-hidden="true">Tema anual</div>'}<label>Substituir banner<input name="bannerFile" type="file" accept="image/png,image/jpeg,image/webp"></label><label class="consent"><input name="removeBanner" type="checkbox"> Remover e restaurar o visual padrão</label></section><fieldset><legend>Cores <small>opcionais · #RRGGBB</small></legend><label>Primária<input name="primary" value="${h(colors.primary || '')}" placeholder="#B96745"></label><label>Secundária<input name="secondary" value="${h(colors.secondary || '')}" placeholder="#D38A53"></label><label>Destaque<input name="accent" value="${h(colors.accent || '')}" placeholder="#E8D5B5"></label><label>Fundo<input name="background" value="${h(colors.background || '')}" placeholder="#2A1E18"></label><label>Texto<input name="text" value="${h(colors.text || '')}" placeholder="#F7EEE3"></label></fieldset><label class="consent"><input name="isActive" type="checkbox" ${theme?.is_active ? 'checked' : ''}> Usar como tema anual ativo</label><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar tema</button></div></form>`; }
function receptionVisitorForm(visitor) { return `<form id="reception-visitor-form"><input type="hidden" name="id" value="${visitor.id}"><p class="form-help">Confirme somente os dados básicos de recepção.</p><label>Nome<input name="name" value="${h(visitor.name)}" required></label><label>WhatsApp<input name="whatsapp" value="${h(visitor.whatsapp)}" required inputmode="tel"></label><label>Origem<input name="source" value="${h(visitor.source)}" required></label><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar confirmação</button></div></form>`; }

function render() {
  if (!authenticated) {
    $('#app').innerHTML = loginView();
    bindEvents();
    return;
  }
  const views = { home: homeView, cell: cellView, refer: referView, welcome: welcomeView, profile: profileView, people: peopleView, cells: cellsView, teams: teamsView, reports: reportsView, settings: settingsView, admin: adminView };
  $('#app').innerHTML = views[currentRoute()]();
  bindEvents();
}

function bindEvents() {
  $('#role-select')?.addEventListener('change', (event) => { activeRole = event.target.value; myCellId = null; hydrateMyCell(false); hydrateWelcome(); });
  document.querySelectorAll('[data-route]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.route)));
  document.querySelectorAll('[data-modal]').forEach(el => el.addEventListener('click', () => { const kind = el.dataset.modal; const person = el.dataset.personEdit ? data.people.find((item) => item.id === el.dataset.personEdit) : null; const cell = el.dataset.cellEdit ? data.managementCells.find((item) => item.id === el.dataset.cellEdit) : null; const item = person || cell || (el.dataset.teamCode ? { teamCode: el.dataset.teamCode } : null); modal = { kind, item }; render(); }));
  document.querySelectorAll('[data-close-modal]').forEach(el => el.addEventListener('click', closeModal));
  document.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => { welcomeTab = el.dataset.tab; render(); }));
  $('#referral-form')?.addEventListener('submit', saveReferral);
  $('#profile-form')?.addEventListener('submit', saveProfile);
  $('#reception-visitor-form')?.addEventListener('submit', saveReceptionVisitor);
  $('#reception-create-form')?.addEventListener('submit', saveReceptionCreatedVisitor);
  $('#care-case-update-form')?.addEventListener('submit', saveCareCaseUpdate); $('#care-record-form')?.addEventListener('submit', saveCareRecord); $('#care-referral-form')?.addEventListener('submit', saveCareReferral);
  $('#admin-user-form')?.addEventListener('submit', saveAdminUser); $('#admin-cell-form')?.addEventListener('submit', saveAdminCell); $('#admin-scope-form')?.addEventListener('submit', saveAdminScope); $('#admin-branding-form')?.addEventListener('submit', saveAdminBranding); $('#admin-theme-form')?.addEventListener('submit', saveAdminTheme);
  $('#admin-offering-status-form')?.addEventListener('submit', saveAdminOfferingStatus); $('#admin-offering-correction-form')?.addEventListener('submit', saveAdminOfferingCorrection);
  $('#ministry-form')?.addEventListener('submit', saveMinistry); $('#supervisor-form')?.addEventListener('submit', saveSupervisor); $('#welcome-team-form')?.addEventListener('submit', saveWelcomeTeamMember);
  $('#admin-search')?.addEventListener('input', (event)=>{adminSearch=event.target.value; render();});
  $('#admin-offering-filter')?.addEventListener('submit', filterAdminOfferings);
  $('#directory-search')?.addEventListener('input', (event)=>{directorySearch=event.target.value; render();});
  document.querySelectorAll('[data-member-filter]').forEach((el) => el.addEventListener('click', () => { memberFilter = el.dataset.memberFilter; render(); }));
  document.querySelectorAll('[data-team-ministry]').forEach((el) => el.addEventListener('click', () => { teamFocusMinistryId = el.dataset.teamMinistry || null; render(); }));
  document.querySelectorAll('[data-team-supervisor]').forEach((el) => el.addEventListener('click', async () => { try { modal = { kind: 'supervisor-detail', item: await api(`/api/admin/supervisors/${el.dataset.teamSupervisor}`) }; render(); } catch (error) { notify(error.message); } }));
  document.querySelectorAll('[data-remove-welcome-member]').forEach((el) => el.addEventListener('click', () => removeWelcomeTeamMember(el.dataset.removeWelcomeMember, el.dataset.personId)));
  document.querySelectorAll('[data-picker-search]').forEach((input) => input.addEventListener('input', () => { const term = input.value.toLowerCase(); document.querySelectorAll(`[data-picker-options="${input.dataset.pickerSearch}"] .person-picker-option`).forEach((option) => { option.hidden = !option.innerText.toLowerCase().includes(term); }); }));
  document.querySelectorAll('[data-picker-select]').forEach((el) => el.addEventListener('click', () => updatePersonPicker(el.dataset.pickerSelect, el.dataset.personId, el.dataset.pickerMultiple === 'true')));
  document.querySelectorAll('[data-picker-remove]').forEach((el) => el.addEventListener('click', () => removePersonPicker(el.dataset.pickerRemove, el.dataset.personId)));
  document.querySelectorAll('[data-ministry-select]').forEach((el) => el.addEventListener('click', () => updateMinistryPicker(el.dataset.ministrySelect, el.dataset.ministryId)));
  document.querySelectorAll('[data-weekday-select]').forEach((el) => el.addEventListener('click', () => updateWeekdayPicker(el.dataset.weekdaySelect)));
  document.querySelectorAll('[data-person-id]').forEach((el) => el.addEventListener('click', async () => { try { modal = { kind: 'person-detail', item: await api(`/api/people/${el.dataset.personId}`) }; render(); } catch (error) { notify(error.message); } }));
  document.querySelectorAll('[data-cell-id]').forEach((el) => el.addEventListener('click', async () => { try { modal = { kind: 'cell-detail', item: await api(`/api/cells/${el.dataset.cellId}`) }; render(); } catch (error) { notify(error.message); } }));
  document.querySelectorAll('[data-my-cell-select]').forEach((el) => el.addEventListener('click', () => { myCellId = el.dataset.myCellSelect; hydrateMyCell(); }));
  document.querySelectorAll('[data-meeting-id]').forEach((el) => el.addEventListener('click', async () => { try { const item = await api(`/api/my-cells/${el.dataset.cellId}/meetings/${el.dataset.meetingId}?as=${encodeURIComponent(myCellRole())}`); modal = { kind: 'meeting-detail', item, cellId: el.dataset.cellId }; render(); } catch (error) { notify(error.message); } }));
  document.querySelectorAll('[data-person-edit]').forEach((el) => el.addEventListener('click', async () => { try { modal = { kind: 'person-form', item: await api(`/api/people/${el.dataset.personEdit}`) }; render(); } catch (error) { notify(error.message); } }));
  document.querySelectorAll('[data-person-grant-access]').forEach((el) => el.addEventListener('click', async () => { try { modal = { kind: 'person-access', item: await api(`/api/people/${el.dataset.personGrantAccess}`) }; render(); } catch (error) { notify(error.message); } }));
  document.querySelectorAll('[data-person-revoke-access]').forEach((el) => el.addEventListener('click', () => revokePersonAccess(el.dataset.personRevokeAccess)));
  document.querySelectorAll('[data-person-remove-photo]').forEach((el) => el.addEventListener('click', () => removePersonProfilePhoto(el.dataset.personRemovePhoto)));
  document.querySelectorAll('[data-cell-edit]').forEach((el) => el.addEventListener('click', async () => { try { modal = { kind: 'cell-form', item: await api(`/api/cells/${el.dataset.cellEdit}`) }; render(); } catch (error) { notify(error.message); } }));
  document.querySelectorAll('[data-admin-user]').forEach(el=>el.addEventListener('click',()=>{modal={kind:'admin-user',item:data.administration.users.find(u=>u.id===Number(el.dataset.adminUser))};render();}));
  document.querySelectorAll('[data-admin-cell]').forEach(el=>el.addEventListener('click',()=>{modal={kind:'admin-cell',item:data.administration.cells.find(c=>c.id===el.dataset.adminCell)};render();}));
  document.querySelectorAll('[data-admin-scope]').forEach(el=>el.addEventListener('click',()=>{modal={kind:'admin-scope',item:data.administration.users.find(u=>u.id===Number(el.dataset.adminScope))};render();}));
  document.querySelectorAll('[data-admin-theme]').forEach(el=>el.addEventListener('click',()=>{modal={kind:'admin-theme',item:data.brandingAdministration?.themes.find(theme=>theme.id===el.dataset.adminTheme)};render();}));
  document.querySelectorAll('[data-admin-offering]').forEach(el=>el.addEventListener('click',()=>openAdminOffering(el.dataset.adminOffering)));
  document.querySelectorAll('[data-reception-visitor]').forEach(el=>el.addEventListener('click',()=>{const item=data.receptionVisitors.find(visitor=>visitor.id===el.dataset.receptionVisitor);if(item){modal={kind:'reception-visitor',item:{...item,name:item.fullName}};render();}}));
  document.querySelectorAll('[data-care-visitor]').forEach(el=>el.addEventListener('click',()=>openCareVisitor(el.dataset.careVisitor,el.dataset.careCase)));
  document.querySelectorAll('[data-care-referral]').forEach(el=>el.addEventListener('click',()=>openCareReferral(el.dataset.careReferral,el.dataset.careCase)));
  $('#login-form')?.addEventListener('submit', login);
  $('#person-form')?.addEventListener('submit', savePerson);
  $('#person-access-form')?.addEventListener('submit', savePersonAccess);
  $('#cell-form')?.addEventListener('submit', saveCell);
  $('#journey-form')?.addEventListener('submit', saveJourney);
  $('#church-function-form')?.addEventListener('submit', saveChurchFunction);
  $('#leader-form')?.addEventListener('submit', saveLeader);
  $('#secretary-form')?.addEventListener('submit', saveSecretary);
  $('#member-form')?.addEventListener('submit', saveMember);
  $('#cell-function-form')?.addEventListener('submit', saveCellFunction);
  $('#my-meeting-form')?.addEventListener('submit', saveMyMeeting);
  $('#my-meeting-edit-form')?.addEventListener('submit', updateMyMeeting);
  $('#my-attendance-form')?.addEventListener('submit', saveMyAttendance);
  $('#my-meeting-visitor-form')?.addEventListener('submit', saveMyMeetingVisitor);
  $('#my-meeting-offering-form')?.addEventListener('submit', saveMyMeetingOffering);
  $('#my-member-journey-form')?.addEventListener('submit', saveMyMemberJourney);
  document.querySelectorAll('[data-photo-publication]').forEach((el) => el.addEventListener('click', () => setMyPhotoPublication(el)));
  document.querySelectorAll('[data-return-cell-referral]').forEach((el) => el.addEventListener('click', () => returnMyCellReferral(el.dataset.cellId, el.dataset.returnCellReferral)));
  document.querySelectorAll('[data-end-member]').forEach((el) => el.addEventListener('click', () => endMemberLink(el.dataset.cellId, el.dataset.endMember)));
  document.querySelectorAll('[data-end-secretary]').forEach((el) => el.addEventListener('click', () => endSecretaryLink(el.dataset.cellId, el.dataset.endSecretary)));
  document.querySelectorAll('[data-end-cell-function]').forEach((el) => el.addEventListener('click', () => endCellFunctionLink(el.dataset.cellId, el.dataset.endCellFunction)));
  document.querySelectorAll('[data-end-church-function]').forEach((el) => el.addEventListener('click', () => endChurchFunctionLink(el.dataset.personId, el.dataset.endChurchFunction)));
  document.querySelector('[data-action="logout"]')?.addEventListener('click', logout);
  document.querySelector('[data-action="load-public-qr"]')?.addEventListener('click', loadPublicQr);
  document.querySelector('[data-action="print-public-qr"]')?.addEventListener('click', printPublicQr);
  document.querySelector('[data-action="copy-pre-registration-url"]')?.addEventListener('click', copyPreRegistrationUrl);
  document.querySelector('[data-action="copy-public-qr-url"]')?.addEventListener('click', copyPublicQrUrl);
  document.querySelector('[data-action="share-public-qr-url"]')?.addEventListener('click', sharePublicQrUrl);
  document.querySelector('[data-action="share-public-qr-image"]')?.addEventListener('click', sharePublicQrImage);
  document.querySelector('[data-action="menu"]')?.addEventListener('click', () => document.querySelector('.sidebar')?.classList.toggle('shown'));
}

function closeModal() { modal = null; render(); }
function notify(message) { toast = message; render(); setTimeout(() => { toast = ''; render(); }, 3500); }
function formData(event) { return Object.fromEntries(new FormData(event.currentTarget)); }
function pickerIds(name) { return String(document.querySelector(`input[name="${name}"]`)?.value || '').split(',').filter(Boolean); }
function renderPersonPickerSelection(name, ids) { const target = document.querySelector(`[data-picker-selected="${name}"]`); const input = document.querySelector(`input[name="${name}"]`); if (!target || !input) return; input.value = ids.join(','); target.innerHTML = ids.map(peopleById).filter(Boolean).map((person) => `<span>${h(person.fullName)}<button type="button" aria-label="Remover ${h(person.fullName)}" data-picker-remove="${name}" data-person-id="${person.id}">×</button></span>`).join('') || '<small>Nenhuma pessoa selecionada.</small>'; target.querySelectorAll('[data-picker-remove]').forEach((button) => button.addEventListener('click', () => removePersonPicker(name, button.dataset.personId)));
}
function updatePersonPicker(name, personId, multiple) { const current = pickerIds(name); const ids = multiple ? [...new Set([...current, personId])] : [personId]; renderPersonPickerSelection(name, ids); }
function removePersonPicker(name, personId) { renderPersonPickerSelection(name, pickerIds(name).filter((id) => id !== personId)); }
function updateMinistryPicker(name, ministryId) { const input = document.querySelector(`input[name="${name}"]`); if (!input) return; input.value = ministryId; document.querySelectorAll(`[data-ministry-options="${name}"] [data-ministry-select]`).forEach((button) => button.classList.toggle('selected', button.dataset.ministryId === ministryId)); }
function updateWeekdayPicker(day) { const input = document.querySelector('input[name="weekday"]'); if (!input) return; input.value = day; document.querySelectorAll('[data-weekday-select]').forEach((button) => button.classList.toggle('selected', button.dataset.weekdaySelect === day)); }
async function saveReferral(event) { event.preventDefault(); const fields = formData(event); try { await api('/api/referrals', { method: 'POST', body: JSON.stringify(fields) }); await hydrate(); modal = null; navigate('home'); notify('Indicação enviada. A Equipe 2 irá analisar o próximo passo.'); } catch (error) { notify(error.message); } }
async function saveMinistry(event) { event.preventDefault(); try { await api('/api/admin/ministries', { method: 'POST', body: JSON.stringify(formData(event)) }); modal = null; await hydrate(); notify('Ministério cadastrado.'); } catch (error) { notify(error.message); } }
async function saveSupervisor(event) { event.preventDefault(); try { await api('/api/admin/supervisors', { method: 'POST', body: JSON.stringify(formData(event)) }); modal = null; await hydrate(); notify('Supervisor vinculado ao ministério.'); } catch (error) { notify(error.message); } }
async function saveWelcomeTeamMember(event) { event.preventDefault(); const fields = formData(event); try { await api(`/api/admin/welcome-teams/${fields.teamCode}/members`, { method: 'POST', body: JSON.stringify(fields) }); modal = null; await hydrate(); notify('Integrante adicionado à equipe.'); } catch (error) { notify(error.message); } }
async function removeWelcomeTeamMember(teamCode, personId) { if (!confirm('Remover esta pessoa da equipe de Boas-Vindas?')) return; try { await api(`/api/admin/welcome-teams/${teamCode}/members/${personId}`, { method: 'DELETE', body: JSON.stringify({}) }); await hydrate(); notify('Integrante removido da equipe.'); } catch (error) { notify(error.message); } }
async function copyPreRegistrationUrl() { const url = new URL('/visitante', window.location.origin).toString(); try { await navigator.clipboard.writeText(url); notify('Endereço do pré-cadastro copiado.'); } catch { notify('Não foi possível copiar automaticamente. Abra o endereço para compartilhá-lo.'); } }
async function copyPublicQrUrl() { const url = modal?.item?.url; if (!url) return; try { await navigator.clipboard.writeText(url); notify('URL do pré-cadastro copiada.'); } catch { notify('Não foi possível copiar automaticamente.'); } }
async function sharePublicQrUrl() { const url = modal?.item?.url; if (!url) return; try { if (navigator.share) await navigator.share({ title: 'Pré-cadastro de visitantes', text: 'É sua primeira vez conosco? Faça seu pré-cadastro.', url }); else await copyPublicQrUrl(); } catch (error) { if (error?.name !== 'AbortError') notify('Não foi possível compartilhar agora.'); } }
async function sharePublicQrImage() { const image = modal?.item?.image; if (!image) return; try { const blob = await fetch(image).then((response) => response.blob()); const file = new File([blob], 'cem-connect-visitantes.png', { type: blob.type || 'image/png' }); if (navigator.canShare?.({ files: [file] }) && navigator.share) { await navigator.share({ title: 'Pré-cadastro de visitantes', files: [file] }); } else { notify('Este dispositivo não permite compartilhar a imagem. Baixe-a para compartilhar.'); } } catch (error) { if (error?.name !== 'AbortError') notify('Não foi possível preparar a imagem para compartilhamento.'); } }
async function saveProfile(event) { event.preventDefault(); const fields = formData(event); try { await api('/api/profile', { method: 'PUT', body: JSON.stringify(fields) }); await hydrate(); modal = null; notify('Informações atualizadas.'); } catch (error) { notify(error.message); } }
async function savePerson(event) {
  event.preventDefault(); const form = new FormData(event.currentTarget); const photo = form.get('photoFile'); const consent = form.has('imageConsent');
  if (photo instanceof File && photo.size && !consent) { notify('Registre a autorização de uso de imagem antes de enviar a foto.'); return; }
  form.delete('photoFile'); form.delete('imageConsent'); const body = Object.fromEntries(form); body.baptized = event.currentTarget.querySelector('[name="baptized"]')?.checked === true;
  try {
    const personId = body.id || (await api('/api/people', { method: 'POST', body: JSON.stringify(body) })).id;
    if (body.id) await api(`/api/people/${personId}`, { method: 'PUT', body: JSON.stringify(body) });
    if (consent) await api(`/api/people/${personId}/image-consent`, { method: 'POST', body: JSON.stringify({ authorized: true }) });
    let photoNotice = '';
    if (photo instanceof File && photo.size) { try { await uploadPersonPhoto(personId, photo); } catch { photoNotice = ' Os dados foram salvos, mas a foto não pôde ser enviada.'; } }
    modal = null; await hydrate(); notify(`Pessoa salva.${photoNotice}`);
  } catch (error) { notify(error.message); }
}
async function savePersonAccess(event) { event.preventDefault(); const form = new FormData(event.currentTarget); const body = { password: form.get('password'), roles: form.getAll('roles') }; try { await api(`/api/people/${form.get('personId')}/access`, { method: 'POST', body: JSON.stringify(body) }); await hydrate(); await refreshPersonDetail(form.get('personId')); notify('Acesso individual concedido.'); } catch (error) { notify(error.message); } }
async function revokePersonAccess(personId) { if (!confirm('Revogar o acesso ao aplicativo? A pessoa, seus vínculos e seu histórico serão preservados.')) return; try { await api(`/api/people/${personId}/access`, { method: 'DELETE', body: '{}' }); await hydrate(); await refreshPersonDetail(personId); notify('Acesso ao aplicativo revogado.'); } catch (error) { notify(error.message); } }
async function removePersonProfilePhoto(personId) { if (!confirm('Remover a foto desta pessoa?')) return; try { await api(`/api/people/${personId}/photo`, { method: 'DELETE', body: '{}' }); await hydrate(); await refreshPersonDetail(personId); notify('Foto removida.'); } catch (error) { notify(error.message); } }
async function saveCell(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = Object.fromEntries(form);
  body.isActive = form.has('isActive');
  if (!body.ministryId) { notify('Selecione o ministério da célula.'); return; }
  if (body.weekday === '') { notify('Selecione o dia da reunião.'); return; }
  if (body.supervisorPersonId && String(body.supervisorPersonId).includes(',')) { notify('Selecione somente uma pessoa para a supervisão.'); return; }
  try {
    if (body.id) await api(`/api/cells/${body.id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/cells', { method: 'POST', body: JSON.stringify(body) });
    modal = null;
    await hydrate();
    notify('Célula salva.');
  } catch (error) { notify(error.message); }
}
async function refreshPersonDetail(id) { modal = { kind: 'person-detail', item: await api(`/api/people/${id}`) }; render(); }
async function refreshCellDetail(id) { modal = { kind: 'cell-detail', item: await api(`/api/cells/${id}`) }; render(); }
async function saveJourney(event) { event.preventDefault(); const body=formData(event); try { await api(`/api/people/${body.personId}/journey`, { method:'PUT', body:JSON.stringify(body) }); await hydrate(); await refreshPersonDetail(body.personId); notify('Jornada atualizada.'); } catch(error){notify(error.message);} }
async function saveChurchFunction(event) { event.preventDefault(); const body=formData(event); try { await api(`/api/people/${body.personId}/functions/church`, { method:'POST', body:JSON.stringify(body) }); await hydrate(); await refreshPersonDetail(body.personId); notify('Função vinculada.'); } catch(error){notify(error.message);} }
async function saveLeader(event) { event.preventDefault(); const body=formData(event); try { await api(`/api/cells/${body.cellId}/leader`, { method:'PUT', body:JSON.stringify(body) }); await hydrate(); await refreshCellDetail(body.cellId); notify('Liderança atualizada.'); } catch(error){notify(error.message);} }
async function saveSecretary(event) { event.preventDefault(); const body=formData(event); try { await api(`/api/cells/${body.cellId}/secretaries`, { method:'POST', body:JSON.stringify(body) }); await hydrate(); await refreshCellDetail(body.cellId); notify('Secretaria vinculada.'); } catch(error){notify(error.message);} }
async function saveMember(event) { event.preventDefault(); const form=new FormData(event.currentTarget); const body=Object.fromEntries(form); body.transfer=form.has('transfer'); try { await api(`/api/cells/${body.cellId}/members`, { method:'POST', body:JSON.stringify(body) }); await hydrate(); await refreshCellDetail(body.cellId); notify('Participante atualizado.'); } catch(error){notify(error.message);} }
async function saveCellFunction(event) { event.preventDefault(); const body=formData(event); try { await api(`/api/cells/${body.cellId}/functions`, { method:'POST', body:JSON.stringify(body) }); await hydrate(); await refreshCellDetail(body.cellId); notify('Função vinculada.'); } catch(error){notify(error.message);} }
async function endMemberLink(cellId, personId) { if (!confirm('Remover esta pessoa da célula? O histórico será preservado.')) return; try { await api(`/api/cells/${cellId}/members/${personId}`, { method: 'DELETE', body: JSON.stringify({}) }); await hydrate(); await refreshCellDetail(cellId); notify('Membresia encerrada.'); } catch (error) { notify(error.message); } }
async function endSecretaryLink(cellId, personId) { if (!confirm('Encerrar este vínculo de secretaria? O histórico será preservado.')) return; try { await api(`/api/cells/${cellId}/secretaries/${personId}`, { method: 'DELETE', body: JSON.stringify({}) }); await hydrate(); await refreshCellDetail(cellId); notify('Vínculo de secretaria encerrado.'); } catch (error) { notify(error.message); } }
async function endCellFunctionLink(cellId, assignmentId) { if (!confirm('Encerrar esta função? O histórico será preservado.')) return; try { await api(`/api/cells/${cellId}/functions/${assignmentId}`, { method: 'DELETE', body: JSON.stringify({}) }); await hydrate(); await refreshCellDetail(cellId); notify('Função encerrada.'); } catch (error) { notify(error.message); } }
async function endChurchFunctionLink(personId, assignmentId) { if (!confirm('Encerrar esta função? O histórico será preservado.')) return; try { await api(`/api/people/${personId}/functions/church/${assignmentId}`, { method: 'DELETE', body: JSON.stringify({}) }); await hydrate(); await refreshPersonDetail(personId); notify('Função encerrada.'); } catch (error) { notify(error.message); } }
async function refreshMyMeeting(cellId, meetingId) { const item = await api(`/api/my-cells/${cellId}/meetings/${meetingId}?as=${encodeURIComponent(myCellRole())}`); modal = { kind: 'meeting-detail', item, cellId }; render(); }
async function saveMyMeeting(event) { event.preventDefault(); const body = formData(event); try { await api(`/api/my-cells/${body.cellId}/meetings?as=${encodeURIComponent(myCellRole())}`, { method: 'POST', body: JSON.stringify(body) }); await hydrateMyCell(false); notify('Reunião registrada.'); } catch (error) { notify(error.message); } }
async function updateMyMeeting(event) { event.preventDefault(); const body = formData(event); try { await api(`/api/my-cells/${body.cellId}/meetings/${body.meetingId}?as=${encodeURIComponent(myCellRole())}`, { method: 'PUT', body: JSON.stringify(body) }); await hydrateMyCell(false); await refreshMyMeeting(body.cellId, body.meetingId); notify('Reunião atualizada.'); } catch (error) { notify(error.message); } }
async function saveMyAttendance(event) { event.preventDefault(); const form = new FormData(event.currentTarget); const cellId = form.get('cellId'); const meetingId = form.get('meetingId'); const attendance = [...form.entries()].filter(([key]) => key.startsWith('attendance-')).map(([key, status]) => ({ personId: key.slice('attendance-'.length), status })); try { await api(`/api/my-cells/${cellId}/meetings/${meetingId}/attendance?as=${encodeURIComponent(myCellRole())}`, { method: 'PUT', body: JSON.stringify({ attendance }) }); await refreshMyMeeting(cellId, meetingId); notify('Presenças registradas.'); } catch (error) { notify(error.message); } }
async function saveMyMeetingVisitor(event) { event.preventDefault(); const body = formData(event); try { await api(`/api/my-cells/${body.cellId}/meetings/${body.meetingId}/visitors?as=${encodeURIComponent(myCellRole())}`, { method: 'POST', body: JSON.stringify(body) }); await refreshMyMeeting(body.cellId, body.meetingId); notify('Visitante registrado na reunião.'); } catch (error) { notify(error.message); } }
async function saveMyMeetingOffering(event) { event.preventDefault(); const body = formData(event); try { await api(`/api/my-cells/${body.cellId}/meetings/${body.meetingId}/offering?as=${encodeURIComponent(myCellRole())}`, { method: 'PUT', body: JSON.stringify(body) }); await hydrateMyCell(false); await refreshMyMeeting(body.cellId, body.meetingId); notify('Oferta registrada.'); } catch (error) { notify(error.message); } }
async function saveMyMemberJourney(event) { event.preventDefault(); const body = formData(event); try { await api(`/api/my-cells/${body.cellId}/members/${body.personId}/journey?as=${encodeURIComponent(myCellRole())}`, { method: 'PUT', body: JSON.stringify(body) }); await hydrateMyCell(); notify('Jornada atualizada.'); } catch (error) { notify(error.message); } }
async function setMyPhotoPublication(element) { const cellId = element.dataset.cellId; const meetingId = element.dataset.meetingId; try { await api(`/api/my-cells/${cellId}/meetings/${meetingId}/photos/${element.dataset.photoPublication}/publication?as=${encodeURIComponent(myCellRole())}`, { method: 'PUT', body: JSON.stringify({ published: element.dataset.published === 'true' }) }); await hydrateMyCell(false); await refreshMyMeeting(cellId, meetingId); notify('Publicação da foto atualizada.'); } catch (error) { notify(error.message); } }
async function returnMyCellReferral(cellId, referralId) { const returnNote = window.prompt('Observação para a Equipe 2 (opcional):') ?? null; if (returnNote === null) return; try { await api(`/api/my-cells/${cellId}/referrals/${referralId}/return?as=leader`, { method: 'PUT', body: JSON.stringify({ returnNote }) }); await hydrateMyCell(); notify('Encaminhamento devolvido à Equipe 2.'); } catch (error) { notify(error.message); } }
async function saveReceptionVisitor(event) { event.preventDefault(); const fields = formData(event); try { await api(`/api/reception/visitors/${fields.id}`, { method: 'PUT', body: JSON.stringify(fields) }); modal = null; await hydrate(); notify('Cadastro confirmado e atualizado.'); } catch (error) { notify(error.message); } }
async function saveReceptionCreatedVisitor(event) { event.preventDefault(); const fields = formData(event); try { await api('/api/reception/visitors', { method: 'POST', body: JSON.stringify(fields) }); modal = null; await hydrateWelcome(); notify('Visitante cadastrado para recepção.'); } catch (error) { notify(error.message); } }
async function openCareVisitor(visitorId, caseId) { try { const id = caseId || (await api('/api/care/cases', { method: 'POST', body: JSON.stringify({ visitorId }) })).id; modal = { kind: 'care-case', item: await api(`/api/care/cases/${id}`) }; await hydrateWelcome(false); render(); } catch (error) { notify(error.message); } }
async function openCareReferral(referralId, caseId) { try { const id = caseId || (await api('/api/care/referral-cases', { method: 'POST', body: JSON.stringify({ referralId }) })).id; modal = { kind: 'care-case', item: await api(`/api/care/cases/${id}`) }; await hydrateWelcome(false); render(); } catch (error) { notify(error.message); } }
async function refreshCareCase(caseId) { modal = { kind: 'care-case', item: await api(`/api/care/cases/${caseId}`) }; await hydrateWelcome(false); render(); }
async function saveCareCaseUpdate(event) { event.preventDefault(); const body = formData(event); try { await api(`/api/care/cases/${body.caseId}`, { method: 'PUT', body: JSON.stringify(body) }); await refreshCareCase(body.caseId); notify('Situação do acompanhamento atualizada.'); } catch (error) { notify(error.message); } }
async function saveCareRecord(event) { event.preventDefault(); const body = formData(event); try { await api(`/api/care/cases/${body.caseId}/records`, { method: 'POST', body: JSON.stringify(body) }); await refreshCareCase(body.caseId); notify('Registro privado adicionado.'); } catch (error) { notify(error.message); } }
async function saveCareReferral(event) { event.preventDefault(); const body = formData(event); try { await api(`/api/care/cases/${body.caseId}/referrals`, { method: 'POST', body: JSON.stringify(body) }); await refreshCareCase(body.caseId); notify('Encaminhamento enviado à célula selecionada.'); } catch (error) { notify(error.message); } }
async function login(event) { event.preventDefault(); const fields = formData(event); try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify(fields) }); toast = ''; await hydrate(); } catch (error) { toast = error.message; render(); } }
async function logout() { await api('/api/auth/logout', { method: 'POST', body: '{}' }); authenticated = false; activeRole = 'member'; toast = ''; render(); }
async function loadPublicQr(){try{modal={kind:'admin-qr',item:await api('/api/admin/qrcode')};render()}catch(e){notify(e.message)}}
function printPublicQr(){const q=modal?.item;if(!q)return;const w=window.open('','_blank','width=700,height=800');w.document.write(`<title>QR Code de Visitantes</title><main style="font-family:system-ui;text-align:center;padding:40px"><h1>Pré-cadastro de visitantes</h1><img style="width:440px;max-width:100%" src="${q.image}"><p>É sua primeira vez conosco? Escaneie o QR Code e faça seu pré-cadastro.</p></main>`);w.document.close();w.focus();w.print();}
async function saveAdminUser(event){event.preventDefault();const f=new FormData(event.currentTarget),rolesSelected=f.getAll('roles');const body=Object.fromEntries(f);body.roles=rolesSelected;body.active=f.has('active');try{if(body.id){await api(`/api/admin/users/${body.id}`,{method:'PUT',body:JSON.stringify(body)});if(body.newPassword)await api(`/api/admin/users/${body.id}/password`,{method:'POST',body:JSON.stringify({password:body.newPassword})});}else await api('/api/admin/users',{method:'POST',body:JSON.stringify(body)});modal=null;await hydrate();notify('Usuário salvo.')}catch(e){notify(e.message)}}
async function saveAdminCell(event){event.preventDefault();const f=new FormData(event.currentTarget),body=Object.fromEntries(f);body.active=f.has('active');body.personIds=f.getAll('members');try{let id=body.id;if(id){const selected=body.personIds.map(Number);const conflict=(data.administration.people||[]).filter(p=>selected.includes(p.id)&&cells.some(c=>c.id!==id&&c.members?.some(m=>m.id===p.id)));if(conflict.length&&!confirm(`${conflict.map(p=>p.name).join(', ')} já pertence a outra célula. Transferir?`))return;await api(`/api/admin/cells/${id}`,{method:'PUT',body:JSON.stringify(body)});await api(`/api/admin/cells/${id}/leader`,{method:'PUT',body:JSON.stringify({personId:body.leader})});await api(`/api/admin/cells/${id}/members`,{method:'PUT',body:JSON.stringify({personIds:body.personIds})});}else{id=(await api('/api/admin/cells',{method:'POST',body:JSON.stringify(body)})).id;await api(`/api/admin/cells/${id}/leader`,{method:'PUT',body:JSON.stringify({personId:body.leader})});}modal=null;await hydrate();notify('Célula salva.')}catch(e){notify(e.message)}}
async function saveAdminScope(event){event.preventDefault();const f=new FormData(event.currentTarget);try{await api(`/api/admin/supervisors/${f.get('id')}/scope`,{method:'PUT',body:JSON.stringify({cellIds:f.getAll('cellIds')})});modal=null;await hydrate();notify('Escopo atualizado.')}catch(e){notify(e.message)}}
async function saveAdminBranding(event){event.preventDefault();const form=new FormData(event.currentTarget);const body={appName:form.get('appName'),churchName:form.get('churchName')};const logoFile=form.get('logoFile');const backgroundFile=form.get('backgroundFile');try{if(logoFile instanceof File&&logoFile.size)body.logoAsset=await uploadBrandingAsset('logo',logoFile);else if(form.has('removeLogo'))body.logoAsset=null;if(backgroundFile instanceof File&&backgroundFile.size)body.backgroundAsset=await uploadBrandingAsset('background',backgroundFile);else if(form.has('removeBackground'))body.backgroundAsset=null;await api('/api/admin/branding/church',{method:'PUT',body:JSON.stringify(body)});modal=null;await hydrateBranding();await hydrate();notify('Identidade atualizada.')}catch(e){notify(e.message)}}
async function saveAdminTheme(event){event.preventDefault();const form=new FormData(event.currentTarget);const colors=Object.fromEntries(['primary','secondary','accent','background','text'].map(key=>[key,String(form.get(key)||'').trim()]).filter(([,value])=>value));const body={id:form.get('id')||'',name:form.get('name'),subtitle:form.get('subtitle'),year:form.get('year'),colors:Object.keys(colors).length?colors:null,isActive:form.has('isActive')};const file=form.get('bannerFile');try{if(file instanceof File&&file.size)body.bannerAsset=await uploadBrandingAsset('banner',file);else if(form.has('removeBanner'))body.bannerAsset=null;await api('/api/admin/branding/theme',{method:'PUT',body:JSON.stringify(body)});modal=null;await hydrateBranding();await hydrate();notify('Tema anual atualizado.')}catch(e){notify(e.message)}}
async function filterAdminOfferings(event){event.preventDefault();const form=new FormData(event.currentTarget);offeringFilters={status:String(form.get('status')||''),cellId:String(form.get('cellId')||''),from:String(form.get('from')||''),to:String(form.get('to')||'')};try{const query=new URLSearchParams(Object.entries(offeringFilters).filter(([,value])=>value));data.adminOfferings=(await api(`/api/admin/offerings?${query}`)).offerings;render();}catch(error){notify(error.message)}}
async function openAdminOffering(meetingId){try{modal={kind:'admin-offering',item:await api(`/api/admin/offerings/${meetingId}`)};render();}catch(error){notify(error.message)}}
async function refreshAdminOfferings(){const query=new URLSearchParams(Object.entries(offeringFilters).filter(([,value])=>value));data.adminOfferings=(await api(`/api/admin/offerings?${query}`)).offerings;}
async function saveAdminOfferingStatus(event){event.preventDefault();const body=formData(event);try{await api(`/api/admin/offerings/${body.meetingId}/status`,{method:'PUT',body:JSON.stringify(body)});await refreshAdminOfferings();await openAdminOffering(body.meetingId);notify(body.status==='sent'?'Oferta marcada como enviada.':'Oferta confirmada.');}catch(error){notify(error.message)}}
async function saveAdminOfferingCorrection(event){event.preventDefault();const body=formData(event);try{await api(`/api/admin/offerings/${body.meetingId}/correction`,{method:'PUT',body:JSON.stringify(body)});await refreshAdminOfferings();await openAdminOffering(body.meetingId);notify('Correção registrada com histórico preservado.');}catch(error){notify(error.message)}}

window.addEventListener('hashchange', render);
window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && modal) closeModal(); });
render();
hydrateBranding();
hydrate();
