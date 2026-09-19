import { roles } from './data/roles.js';
import { resolveBranding } from './config/brand.js';

let data = { currentUser: null, profile: null, cells: [], people: [], managementCells: [], visitors: [], referrals: [], referralsToCell: [], notices: [], administration: null, branding: null, brandingAdministration: null };
let cells = [];
let activeRole = 'member';
let authenticated = false;
let welcomeTab = 'visitors';
let modal = null;
let toast = '';
let adminSearch = '';
let directorySearch = '';

const icons = {
  home: '⌂', cell: '◌', welcome: '♡', profile: '◉', admin: '⚙', plus: '+', arrow: '→', close: '×', check: '✓', bell: '●', people: '♧'
};

const $ = (selector) => document.querySelector(selector);
const role = () => roles[activeRole];
const branding = () => resolveBranding(data.branding);
const isWelcome = () => ['welcome1', 'welcome2', 'supervisor', 'admin'].includes(activeRole);
const isTeam2 = () => ['welcome2', 'admin'].includes(activeRole);
const canViewOperations = () => ['welcome2', 'supervisor', 'admin'].includes(activeRole);
const isLeader = () => ['leader', 'supervisor', 'admin'].includes(activeRole);
const canAdmin = () => activeRole === 'admin';
const canRefer = () => ['member', 'leader', 'welcome2', 'supervisor', 'admin'].includes(activeRole);
const canDirectoryRead = () => data.currentUser?.roles?.some((id) => ['admin', 'pastor', 'supervisor'].includes(id));
const canDirectoryManage = () => data.currentUser?.roles?.includes('admin');
const cellForUser = () => cells.find((cell) => cell.id === data.currentUser.cellId) || { id: '', name: 'Sem célula vinculada', leader: 'A definir', schedule: 'A definir', location: 'A definir', members: [], notice: 'Não há uma célula vinculada a este usuário.' };
const h = (value = '') => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const initials = (name = '') => String(name).split(' ').filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'CC';
const displayDate = (value) => /^(Agora|Hoje|Ontem)/.test(String(value)) ? value : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...options });
  const payload = await response.json();
  if (!response.ok) { const error = new Error(payload.error || 'Não foi possível salvar os dados.'); error.status = response.status; throw error; }
  return payload;
}

async function hydrate() {
  try {
    const [persisted, profileResponse] = await Promise.all([api('/api/bootstrap'), api('/api/profile')]);
    authenticated = true; data = { ...persisted, profile: profileResponse.profile, people: [], managementCells: [], branding: data.branding, brandingAdministration: null };
    cells = persisted.cells;
    if (!data.currentUser.roles.includes(activeRole)) activeRole = data.currentUser.roles[0] || 'member';
    if (data.currentUser.roles.includes('admin')) {
      try { data.brandingAdministration = await api('/api/admin/branding'); } catch { data.brandingAdministration = null; }
    }
    if (canDirectoryRead()) {
      try { const [peopleResponse, cellsResponse] = await Promise.all([api('/api/people'), api('/api/cells')]); data.people = peopleResponse.people; data.managementCells = cellsResponse.cells; } catch { data.people = []; data.managementCells = []; }
    }
    render();
  } catch (error) {
    if (error.status === 401) { authenticated = false; render(); return; }
    console.warn('Não foi possível carregar os dados persistidos.', error);
  }
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
  return ['home', 'cell', 'refer', 'welcome', 'profile', 'people', 'cells', 'admin'].includes(candidate) ? candidate : 'home';
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
  return `--theme-sand:${colors.sand};--theme-terracotta:${colors.terracotta};--theme-copper:${colors.copper};--theme-dusk:${colors.dusk};`;
}

function layout(content) {
  if (!authenticated) return loginView();
  const nav = [navItem('home', icons.home, 'Início'), navItem('cell', icons.cell, 'Minha Célula')];
  if (canRefer()) nav.push(navItem('refer', icons.plus, 'Indicar'));
  if (isWelcome()) nav.push(navItem('welcome', icons.welcome, 'Boas-Vindas'));
  if (canDirectoryRead()) { nav.push(navItem('people', icons.people, 'Pessoas')); nav.push(navItem('cells', icons.cell, 'Células')); }
  nav.push(navItem('profile', icons.profile, 'Meu Perfil'));
  if (canAdmin()) nav.push(navItem('admin', icons.admin, 'Administração'));
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
          <div class="topbar-actions"><label class="profile-switch"><span>Minha função</span><select id="role-select">${data.currentUser.roles.map((id) => `<option value="${id}" ${activeRole === id ? 'selected' : ''}>${roles[id].label}</option>`).join('')}</select></label><button class="notification" aria-label="Notificações">${icons.bell}</button><button class="avatar" data-route="profile">${initials(data.currentUser.name)}</button><button class="logout-button" data-action="logout">Sair</button></div>
        </header>
        <section class="page">${content}</section>
      </main>
      <nav class="mobile-nav">${nav.slice(0, 4).join('')}</nav>
    </div>
    ${currentRoute() === 'admin' && canAdmin() ? '<button class="button primary qr-float" data-action="load-public-qr">QR Code de Visitantes</button>' : ''}
    ${modal ? modalView() : ''}
    ${toast ? `<div class="toast">${icons.check} ${h(toast)}</div>` : ''}`;
}

function loginView() { return `<main class="login-page" style="${themeVariables()}"><section class="login-card">${brandMark()}<p class="eyebrow">ACESSO SEGURO</p><h1>Bem-vindo de volta</h1><p>Entre para cuidar, conectar e caminhar junto.</p><form id="login-form"><label>WhatsApp ou e-mail<input name="identity" autocomplete="username" required placeholder="seu@email.com"></label><label>Senha<input name="password" type="password" autocomplete="current-password" required placeholder="Sua senha"></label><button class="button primary" type="submit">Entrar</button></form><p class="login-help">Usuários são criados pela administração da igreja.</p>${toast ? `<div class="login-error">${h(toast)}</div>` : ''}</section></main>`; }

function pageTitle(eyebrow, title, text, action = '') { return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${text}</p></div>${action}</div>`; }
function stat(title, text, icon, tone = '') { return `<article class="stat-card ${tone}"><span class="stat-icon">${icon}</span><div><strong>${title}</strong><p>${text}</p></div></article>`; }
function empty(text) { return `<div class="empty">♡<p>${text}</p></div>`; }

function annualThemeBanner() {
  const theme = branding().annualTheme;
  const art = theme.bannerUrl ? `<img src="${h(theme.bannerUrl)}" alt="Banner do tema ${h(theme.name)}">` : '<div class="theme-art" aria-hidden="true"><span></span><i></i><b></b></div>';
  return `<section class="annual-theme-banner">${art}<div class="annual-theme-copy"><p class="eyebrow">${theme.year ? `${h(theme.year)} · ` : ''}TEMA ANUAL</p><h2>${h(theme.name)}</h2><p>${h(theme.subtitle)}</p></div><span class="theme-walk" aria-hidden="true">↗</span></section>`;
}

function homeView() {
  const quick = activeRole === 'welcome1'
    ? `<button class="button primary" data-modal="visitor">${icons.plus} Cadastrar visitante</button>`
    : isTeam2() ? `<button class="button primary" data-route="welcome">Abrir Boas-Vindas ${icons.arrow}</button>`
    : canRefer() ? `<button class="button primary" data-route="refer">${icons.plus} Indicar alguém</button>` : '';
  const cell = cellForUser();
  const attention = canViewOperations()
    ? `<section class="card list-card"><div class="card-heading"><div><p class="eyebrow">PARA VOCÊ</p><h2>Próximos cuidados</h2><p>Novas pessoas aguardando um próximo passo.</p></div><button class="text-button" data-route="welcome">Ver Boas-Vindas</button></div>${[...data.visitors.filter(x => x.status === 'Novo'), ...data.referrals.filter(x => x.status === 'Novo')].slice(0, 3).map(personRow).join('') || empty('Nenhum cuidado pendente por agora.')}</section>`
    : `<section class="card list-card"><div class="card-heading"><div><p class="eyebrow">PARA VOCÊ</p><h2>Conexão e avisos</h2><p>Informações da sua caminhada e da sua célula.</p></div></div>${data.notices.length ? data.notices.map((notice) => `<div class="notice-row"><span>✦</span><p>${h(notice)}</p></div>`).join('') : `<div class="next-meeting"><span>◷</span><div><strong>${h(cell.name)}</strong><p>${h(cell.schedule)} · ${h(cell.location)}</p></div></div>`}</section>`;
  const referral = isLeader() ? data.referralsToCell.filter(x => x.cellId === cell.id)[0] : null;
  return layout(`
    ${pageTitle('CEM CONNECT', `Olá, ${h(data.currentUser.name.split(' ')[0])}`, 'Um espaço simples para cuidar, conectar e caminhar junto.', quick)}
    ${annualThemeBanner()}
    <div class="gentle-note"><span>♡</span><p>O CEM CONNECT organiza informações para ajudar pessoas a cuidarem de pessoas.</p></div>
    <div class="content-grid ${referral ? '' : 'single-side'}">${attention}<section class="card"><div class="card-heading"><div><h2>${referral ? 'Encaminhamento recebido' : 'Próximo encontro'}</h2><p>${referral ? 'Uma pessoa foi encaminhada para sua célula.' : `${cell.schedule} · ${cell.location}`}</p></div>${!referral ? `<button class="text-button" data-route="cell">Ver célula</button>` : ''}</div>${referral ? `<div class="referral-card"><div class="person-avatar">${referral.person.split(' ').map(n => n[0]).join('').slice(0, 2)}</div><div><strong>${h(referral.person)}</strong><p>${h(referral.note)}</p><small>Encaminhado ${displayDate(referral.sentAt)}</small></div><button class="text-button" data-route="cell">Abrir</button></div>` : `<div class="next-meeting"><span>◷</span><div><strong>Encontro da ${h(cell.name)}</strong><p>Um momento para compartilhar e caminhar juntos.</p></div></div>`}</section></div>
  `);
}

function referView() {
  if (!canRefer()) return layout(`${pageTitle('ACESSO RESTRITO', 'Indicar alguém', 'Esta ação está disponível apenas para perfis autorizados.')}<section class="card access-card"><span>♡</span><h2>Você não possui acesso a indicações.</h2></section>`);
  return layout(`${pageTitle('INDICAR', 'Uma indicação de cuidado', 'Envie apenas nome, WhatsApp e uma observação opcional. A Equipe 2 decidirá o próximo passo.')}<section class="card referral-form-card">${formFields('referral', false, true)}</section>`);
}

function cellView() {
  const cell = cellForUser();
  const referrals = data.referralsToCell.filter(x => x.cellId === cell.id);
  return layout(`
    ${pageTitle('MINHA CÉLULA', cell.name, 'Um espaço de conexão, cuidado e comunhão.')}
    <section class="cell-hero"><div><span class="cell-symbol">◌</span><div><p>Liderada por</p><h2>${h(cell.leader)}</h2></div></div><div class="meeting-info"><span>◷</span><div><strong>${h(cell.schedule)}</strong><p>${h(cell.location)}</p></div></div></section>
    ${isLeader() && referrals.length ? `<section class="card referral-section"><div class="card-heading"><div><h2>Encaminhamentos recebidos</h2><p>Informações enviadas pela Equipe 2 para acolhimento.</p></div></div>${referrals.map(item => `<article class="referral-card"><div class="person-avatar">${item.person.split(' ').map(n => n[0]).join('').slice(0, 2)}</div><div><strong>${h(item.person)}</strong><p>${h(item.note)}</p><small>Encaminhado ${displayDate(item.sentAt)}</small></div><span class="soft-label">Para acolher</span></article>`).join('')}</section>` : ''}
    <div class="content-grid"><section class="card"><div class="card-heading"><div><h2>Integrantes</h2><p>${cell.members.length} pessoas caminhando juntas.</p></div></div><div class="member-list">${cell.members.map(name => `<div class="member"><span class="person-avatar small">${name.split(' ').map(n => n[0]).join('').slice(0, 2)}</span><span>${h(name)}</span></div>`).join('')}</div></section><section class="card"><div class="card-heading"><div><h2>Aviso da célula</h2><p>Compartilhado com os integrantes.</p></div></div><div class="notice-feature"><span>✦</span><p>${h(cell.notice)}</p></div></section></div>
  `);
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

function peopleView() {
  if (!canDirectoryRead()) return layout(`${pageTitle('ACESSO RESTRITO', 'Pessoas', 'Esta área é protegida.')}<section class="card access-card"><h2>Você não possui acesso a Pessoas.</h2></section>`);
  const term = directorySearch.toLowerCase();
  const people = data.people.filter((person) => `${person.fullName} ${person.whatsapp}`.toLowerCase().includes(term));
  return layout(`${pageTitle('PESSOAS', 'Cuidado e conexão', 'Cadastros organizados para apoiar o cuidado de cada pessoa.', canDirectoryManage() ? '<button class="button primary" data-modal="person-form">+ Pessoa</button>' : '')}<section class="card list-card"><div class="card-heading"><div><h2>Pessoas cadastradas</h2><p>Nome, situação e célula atual.</p></div></div><input id="directory-search" placeholder="Buscar por nome ou WhatsApp" value="${h(directorySearch)}">${people.map((person) => `<article class="person-row"><span class="person-avatar">${initials(person.fullName)}</span><div class="person-main"><strong>${h(person.fullName)}</strong><p>${h(statusLabel(person.personStatus))}${person.cell ? ` · ${h(person.cell.name)}` : ''}</p></div><button class="text-button" data-person-id="${person.id}">Ver ficha</button></article>`).join('') || empty('Nenhuma pessoa cadastrada.')}</section>`);
}

function cellsView() {
  if (!canDirectoryRead()) return layout(`${pageTitle('ACESSO RESTRITO', 'Células', 'Esta área é protegida.')}<section class="card access-card"><h2>Você não possui acesso a Células.</h2></section>`);
  const rows = data.managementCells.map((cell) => `<article class="person-row"><span class="person-avatar">◌</span><div class="person-main"><strong>${h(cell.name)}</strong><p>${h(weekdayLabel(cell.weekday))} · ${h(String(cell.meetingTime || '').slice(0, 5))} · ${h(cell.neighborhood)}</p><small>${h(cell.leaderName || 'Liderança pendente')}</small></div><span class="status ${cell.isActive ? '' : 'em-análise'}">${cell.isActive ? 'Ativa' : 'Inativa'}</span><button class="text-button" data-cell-id="${cell.id}">Ver ficha</button></article>`).join('') || empty('Nenhuma célula cadastrada.');
  return layout(`${pageTitle('CÉLULAS', 'Organização e cuidado', 'Informações, vínculos e participantes sem comparações.', canDirectoryManage() ? '<button class="button primary" data-modal="cell-form">Nova célula</button>' : '')}<section class="card list-card"><div class="card-heading"><div><h2>Células cadastradas</h2><p>Dia, local e liderança atual.</p></div></div>${rows}</section>`);
}

function personForm(person = null) {
  const value = (key) => h(person?.person?.[key] ?? person?.[key] ?? ''); const current = person?.person || person || {};
  return `<form id="person-form"><input type="hidden" name="id" value="${h(current.id || '')}"><label>Nome completo<input name="fullName" value="${value('fullName')}" required></label><label>WhatsApp<input name="whatsapp" value="${value('whatsapp')}" required inputmode="tel"></label><details open><summary>Dados pessoais</summary><label>Data de nascimento<input name="birthDate" type="date" value="${value('birthDate')}"></label><label>Sexo<select name="sex"><option value="">Não informado</option><option value="female" ${current.sex === 'female' ? 'selected' : ''}>Feminino</option><option value="male" ${current.sex === 'male' ? 'selected' : ''}>Masculino</option></select></label></details><details><summary>Contato e endereço</summary><label>E-mail <small>opcional</small><input name="email" type="email" value="${value('email')}"></label><label>CEP<input name="postalCode" value="${value('postalCode')}" inputmode="numeric"></label><label>Logradouro<input name="addressLine" value="${value('addressLine')}"></label><label>Número<input name="addressNumber" value="${value('addressNumber')}"></label><label>Complemento<input name="addressComplement" value="${value('addressComplement')}"></label><label>Bairro<input name="neighborhood" value="${value('neighborhood')}"></label><label>Cidade<input name="city" value="${value('city')}"></label><label>Estado<input name="state" maxlength="2" value="${value('state')}"></label></details><details><summary>Igreja e jornada</summary><label>Situação<select name="personStatus"><option value="">Não informada</option>${['member','visitor','integrating','inactive','transferred'].map((status) => `<option value="${status}" ${current.personStatus === status ? 'selected' : ''}>${statusLabel(status)}</option>`).join('')}</select></label><label class="consent"><input name="baptized" type="checkbox" ${current.baptized ? 'checked' : ''}> Batizado</label><label>Data de batismo <small>opcional</small><input name="baptizedOn" type="date" value="${value('baptizedOn')}"></label></details><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar pessoa</button></div></form>`;
}

function personDetailView(detail) {
  const person = detail.person; const address = [person.addressLine, person.addressNumber, person.addressComplement, person.neighborhood, person.city, person.state, person.postalCode].filter(Boolean).join(' · ');
  const functions = detail.functions.map((item) => `<div class="notice-row"><span>◌</span><p><strong>${h(item.name)}</strong>${item.cell ? ` · ${h(item.cell.name)}` : ' · Igreja'}</p>${canDirectoryManage() && item.scopeType === 'church' ? `<button class="text-button" data-end-church-function="${item.id}" data-person-id="${person.id}">Encerrar</button>` : ''}</div>`).join('') || '<p class="empty-state">Nenhuma função sem login ativa.</p>';
  const journey = detail.journey.modules.map((item) => `<div class="notice-row"><span>${item.completedOn ? '✓' : '○'}</span><p><strong>${h(item.name)}</strong>${item.completedOn ? ` · ${h(item.completedOn)}` : ' · Pendente'}</p></div>`).join('');
  const appRoles = detail.appRoles?.length ? `<p><strong>Acesso ao aplicativo:</strong> ${detail.appRoles.map((code) => h(roles[code]?.label || code)).join(' · ')}</p>` : '<p>A pessoa não possui acesso ao aplicativo.</p>';
  return `<section class="person-context"><span class="avatar large">${initials(person.fullName)}</span><div><h3>${h(person.fullName)}</h3><p>${h(statusLabel(person.personStatus))}${detail.membership ? ` · ${h(detail.membership.name)}` : ''}</p></div></section><div class="detail-sections"><details open><summary>Dados pessoais</summary><p>${h(person.birthDate || 'Data de nascimento não informada')} · ${h(person.sex === 'female' ? 'Feminino' : person.sex === 'male' ? 'Masculino' : 'Sexo não informado')}</p></details><details><summary>Contato</summary><p>${h(person.whatsapp)}${person.email ? ` · ${h(person.email)}` : ''}</p><p>${h(address || 'Endereço não informado')}</p></details><details><summary>Igreja e acesso</summary><p><strong>Célula atual:</strong> ${h(detail.membership?.name || 'Sem célula ativa')}</p>${appRoles}</details><details><summary>Jornada</summary>${journey}<p><strong>Batismo:</strong> ${detail.journey.baptized ? h(detail.journey.baptizedOn || 'Confirmado') : 'Não informado'}</p>${canDirectoryManage() ? `<form class="inline-form" id="journey-form"><input type="hidden" name="personId" value="${person.id}"><select name="moduleCode">${detail.journey.modules.map((item) => `<option value="${item.code}">${h(item.name)}</option>`).join('')}</select><input name="completedOn" type="date"><button class="text-button">Registrar</button></form>` : ''}</details><details><summary>Funções</summary>${functions}${canDirectoryManage() ? `<form class="inline-form" id="church-function-form"><input type="hidden" name="personId" value="${person.id}"><input type="hidden" name="functionCode" value="treasurer"><button class="text-button">Vincular Tesoureiro</button></form>` : ''}</details>${detail.history.length ? `<details><summary>Histórico</summary>${detail.history.map((item) => `<div class="notice-row"><span>•</span><p>${h(item.previousStatus || 'Início')} → <strong>${h(item.currentStatus)}</strong><br><small>${displayDate(item.createdAt)}</small></p></div>`).join('')}</details>` : ''}</div>${canDirectoryManage() ? `<div class="form-actions"><button class="button outline" data-person-edit="${person.id}">Editar pessoa</button></div>` : ''}`;
}

function cellForm(cell = null) { const item = cell?.cell || cell || {}; const value = (key) => h(item[key] ?? ''); return `<form id="cell-form"><input type="hidden" name="id" value="${value('id')}"><label>Nome da célula<input name="name" value="${value('name')}" required></label><label>Dia da semana<select name="weekday">${['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'].map((name,index)=>`<option value="${index}" ${Number(item.weekday)===index?'selected':''}>${name}</option>`).join('')}</select></label><label>Horário<input name="meetingTime" type="time" value="${h(String(item.meetingTime || '').slice(0,5))}" required></label><label>Local/endereço<input name="addressLine" value="${value('addressLine')}" required></label><label>Bairro<input name="neighborhood" value="${value('neighborhood')}" required></label><label>Cidade<input name="city" value="${value('city')}" required></label><label>Estado<input name="state" maxlength="2" value="${value('state')}" required></label><label class="consent"><input name="isActive" type="checkbox" ${item.isActive === false ? '' : 'checked'}> Célula ativa</label><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar célula</button></div></form>`; }

function cellDetailView(detail) { const peopleOptions = data.people.map((person) => `<option value="${person.id}">${h(person.fullName)}</option>`).join(''); return `<section class="person-context"><span class="avatar large">◌</span><div><h3>${h(detail.cell.name)}</h3><p>${h(weekdayLabel(detail.cell.weekday))} · ${h(String(detail.cell.meetingTime).slice(0,5))} · ${h(detail.cell.neighborhood)}</p></div></section><div class="detail-sections"><details open><summary>Informações gerais</summary><p>${h(detail.cell.addressLine)} · ${h(detail.cell.neighborhood)} · ${h(detail.cell.city)} / ${h(detail.cell.state)}</p><p>${detail.cell.isActive ? 'Célula ativa' : 'Célula inativa'}</p></details><details open><summary>Liderança e Secretaria</summary><p><strong>Líder:</strong> ${h(detail.leader?.fullName || 'Liderança pendente')}</p>${detail.secretaries.map((item)=>`<div class="notice-row"><span>◌</span><p><strong>Secretaria:</strong> ${h(item.fullName)}</p>${canDirectoryManage() ? `<button class="text-button" data-end-secretary="${item.id}" data-cell-id="${detail.cell.id}">Encerrar</button>` : ''}</div>`).join('') || '<p>Secretaria não definida.</p>'}${canDirectoryManage() ? `<form class="inline-form" id="leader-form"><input type="hidden" name="cellId" value="${detail.cell.id}"><select name="personId"><option value="">Liderança pendente</option>${peopleOptions}</select><button class="text-button">Salvar líder</button></form><form class="inline-form" id="secretary-form"><input type="hidden" name="cellId" value="${detail.cell.id}"><select name="personId">${peopleOptions}</select><button class="text-button">Adicionar secretaria</button></form>` : ''}</details><details><summary>Participantes</summary>${detail.members.map((item)=>`<div class="notice-row"><span>◌</span><p>${h(item.fullName)} · ${h(statusLabel(item.personStatus))}</p>${canDirectoryManage() ? `<button class="text-button" data-end-member="${item.id}" data-cell-id="${detail.cell.id}">Remover</button>` : ''}</div>`).join('') || '<p class="empty-state">Nenhum participante ativo.</p>'}${canDirectoryManage() ? `<form class="inline-form" id="member-form"><input type="hidden" name="cellId" value="${detail.cell.id}"><select name="personId">${peopleOptions}</select><label class="consent"><input name="transfer" type="checkbox"> Transferir se já estiver em outra célula</label><button class="text-button">Adicionar participante</button></form>` : ''}</details><details><summary>Funções de célula</summary>${detail.functions.map((item)=>`<div class="notice-row"><span>◌</span><p>${h(item.name)} · ${h(item.person.fullName)}</p>${canDirectoryManage() ? `<button class="text-button" data-end-cell-function="${item.id}" data-cell-id="${detail.cell.id}">Encerrar</button>` : ''}</div>`).join('') || '<p class="empty-state">Nenhuma função vinculada.</p>'}${canDirectoryManage() ? `<form class="inline-form" id="cell-function-form"><input type="hidden" name="cellId" value="${detail.cell.id}"><select name="functionCode"><option value="host">Anfitrião</option><option value="social_assistant">Assistente Social</option></select><select name="personId">${peopleOptions}</select><button class="text-button">Vincular função</button></form>` : ''}</details>${detail.membershipHistory.length ? `<details><summary>Histórico de participantes</summary>${detail.membershipHistory.map((item)=>`<div class="notice-row"><span>•</span><p>${h(item.fullName)} · ${h(item.startedAt)}${item.endedAt ? ` → ${h(item.endedAt)}` : ''}</p></div>`).join('')}</details>` : ''}</div>${canDirectoryManage() ? `<div class="form-actions"><button class="button outline" data-cell-edit="${detail.cell.id}">Editar célula</button></div>` : ''}`; }

function personRow(item, type) { return `<article class="person-row" data-item="${type || ''}" data-id="${item.id}"><span class="person-avatar">${item.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</span><div class="person-main"><strong>${h(item.name)}</strong><p>${h(item.whatsapp)} · ${h(item.source)}</p></div><span class="status ${item.status.toLowerCase().replaceAll(' ', '-')}">${h(item.status)}</span><button class="icon-button" data-open-person="${type || ''}:${item.id}" aria-label="Abrir ${h(item.name)}">${icons.arrow}</button></article>`; }

function welcomeView() {
  if (!isWelcome()) return layout(`${pageTitle('ACESSO RESTRITO', 'Boas-Vindas', 'Esta área está disponível apenas para as equipes autorizadas.')}<section class="card access-card"><span>♡</span><h2>Você não possui acesso a esta área.</h2><p>Use o seletor de perfil para visualizar a experiência de uma equipe autorizada.</p></section>`);
  const lists = { visitors: data.visitors, referrals: data.referrals };
  const tab = welcomeTab;
  const action = activeRole === 'welcome1' ? `<div class="button-group"><button class="button outline" data-modal="qr">▦ Abrir QR Code</button><button class="button primary" data-modal="visitor">${icons.plus} Visitante</button></div>` : '';
  return layout(`
    ${pageTitle('MINISTÉRIO BOAS-VINDAS', 'Boas-Vindas', activeRole === 'welcome1' ? 'Receba e cadastre pessoas de forma simples e acolhedora.' : 'Analise cada pessoa e defina um próximo passo de cuidado.', action)}
    <div class="welcome-intro"><span>♡</span><div><strong>A equipe organiza; as pessoas cuidam de pessoas.</strong><p>Registre somente o necessário para dar continuidade ao acolhimento.</p></div></div>
    <div class="tabs"><button class="${tab === 'visitors' ? 'active' : ''}" data-tab="visitors">Visitantes <span>${data.visitors.length}</span></button>${canViewOperations() ? `<button class="${tab === 'referrals' ? 'active' : ''}" data-tab="referrals">Indicações <span>${data.referrals.length}</span></button><button class="${tab === 'followups' ? 'active' : ''}" data-tab="followups">Acompanhamentos <span>${[...data.visitors, ...data.referrals].filter(x => x.status === 'Em análise').length}</span></button>` : ''}</div>
    <section class="card list-card"><div class="card-heading"><div><h2>${tab === 'visitors' ? 'Visitantes recebidos' : tab === 'referrals' ? 'Indicações recebidas' : 'Pessoas em acompanhamento'}</h2><p>${tab === 'followups' ? 'Registre contatos e próximos passos com simplicidade.' : activeRole === 'welcome1' ? 'Confirme os dados e envie para análise da Equipe 2.' : 'Abra uma pessoa para registrar contato e decidir o próximo passo.'}</p></div></div>${tab === 'followups' ? [...data.visitors, ...data.referrals].filter(x => x.status === 'Em análise').map(item => personRow(item, data.visitors.includes(item) ? 'visitor' : 'referral')).join('') || empty('Nenhum acompanhamento em andamento.') : lists[tab].map(item => personRow(item, tab === 'visitors' ? 'visitor' : 'referral')).join('') || empty('Nenhum registro encontrado.')}</section>
    ${activeRole === 'welcome1' ? `<section class="card tip-card"><span>▦</span><div><h2>Pré-cadastro por QR Code</h2><p>Deixe o QR Code disponível durante o culto para que visitantes preencham nome e WhatsApp em poucos segundos.</p></div><button class="button outline" data-modal="qr">Ver QR Code</button></section>` : ''}
  `);
}

function adminView() {
  if (!canAdmin()) return layout(`${pageTitle('ACESSO RESTRITO', 'Administração', 'Apenas administradores podem acessar esta área.')}<section class="card access-card"><span>⚙</span><h2>Você não possui acesso à administração.</h2><p>As configurações permanecem protegidas e disponíveis somente para perfis autorizados.</p></section>`);
  const admin = data.administration || { users: [], cells: [], people: [], auditLogs: [] };
  const users = admin.users.filter((user) => user.name.toLowerCase().includes(adminSearch.toLowerCase()));
  const cellRows = cells.map((cell) => `<article class="person-row"><span class="person-avatar">◌</span><div class="person-main"><strong>${h(cell.name)}</strong><p>${h(cell.leader)} · ${h(cell.schedule)} · ${h(cell.location)}</p></div><span class="status ${cell.active === 0 ? 'em-análise' : ''}">${cell.active === 0 ? 'Inativa' : 'Ativa'}</span><button class="text-button" data-admin-cell="${cell.id}">Editar</button></article>`).join('') || empty('Nenhuma célula cadastrada.');
  const brand = branding();
  const brandingAdmin = data.brandingAdministration || { church: null, themes: [] };
  const activeTheme = brandingAdmin.themes.find((theme) => theme.is_active) || null;
  const themeRows = brandingAdmin.themes.map((theme) => `<div class="identity-theme-line"><span>◒</span><div><strong>${h(theme.title)}</strong><p>${h(theme.subtitle || '')} · ${h(theme.year)}${theme.is_active ? ' · Ativo' : ''}</p></div><button class="text-button" data-admin-theme="${h(theme.id)}">Editar</button></div>`).join('') || '<p class="identity-help">Nenhum tema anual salvo no PostgreSQL.</p>';
  const identityPanel = `<section class="card identity-panel"><div class="card-heading"><div><p class="eyebrow">IDENTIDADE VISUAL</p><h2>Logo e tema anual</h2><p>Configuração persistida no PostgreSQL e aplicada com segurança.</p></div><div class="button-group"><button class="button outline" data-modal="admin-branding">Identidade</button><button class="button primary" data-modal="admin-theme">Novo tema</button></div></div><div class="identity-preview"><span class="brand-mark ${brand.logoUrl ? 'has-image' : ''}">${brand.logoUrl ? `<img src="${h(brand.logoUrl)}" alt="Logo configurado">` : '<span>C</span>'}</span><div><strong>${h(brand.applicationName)}</strong><p>${brandingAdmin.church ? 'Identidade persistida' : 'Fallback visual — nenhuma identidade persistida ainda'}</p></div></div><div class="identity-theme-line"><span>◒</span><div><strong>${h(activeTheme?.title || brand.annualTheme.name)}</strong><p>${h(activeTheme?.subtitle || brand.annualTheme.subtitle)}${activeTheme?.year ? ` · ${h(activeTheme.year)}` : ''}</p></div></div>${themeRows}</section>`;
  return layout(`${pageTitle('ADMINISTRAÇÃO', 'Organização da igreja', 'Gerencie acessos, células e escopos de forma simples.')}<div class="tabs"><button class="active">Usuários</button><button>Células</button><button>Supervisores</button><button>Atividades</button></div>${identityPanel}<section class="card list-card"><div class="card-heading"><div><h2>Usuários</h2><p>Acessos e funções da equipe.</p></div><button class="button primary" data-modal="admin-user">+ Usuário</button></div><input id="admin-search" placeholder="Pesquisar por nome" value="${h(adminSearch)}">${users.map(u=>`<article class="person-row"><span class="person-avatar">${u.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</span><div class="person-main"><strong>${h(u.name)}</strong><p>${u.roles.map(r=>roles[r]?.label||r).join(' · ')}</p></div><span class="status ${u.active?'':'em-análise'}">${u.active?'Ativo':'Inativo'}</span><button class="text-button" data-admin-user="${u.id}">Editar</button></article>`).join('')||empty('Nenhum usuário encontrado.')}</section><section class="card list-card"><div class="card-heading"><div><h2>Células</h2><p>Informações e membros.</p></div><button class="button outline" data-modal="admin-cell">Nova célula</button></div>${cellRows}</section><section class="card list-card"><div class="card-heading"><div><h2>Supervisores</h2><p>Defina as células supervisionadas.</p></div></div>${admin.users.filter(u=>u.roles.includes('supervisor')).map(u=>`<article class="person-row"><span class="person-avatar">SV</span><div class="person-main"><strong>${h(u.name)}</strong><p>${u.cellIds.length?u.cellIds.join(', '):'Sem células vinculadas'}</p></div><button class="text-button" data-admin-scope="${u.id}">Escopo</button></article>`).join('')||empty('Nenhum Supervisor cadastrado.')}</section><section class="card list-card"><div class="card-heading"><div><h2>Atividades recentes</h2><p>Alterações administrativas relevantes.</p></div></div>${(admin.auditLogs||[]).slice(0,8).map(log=>`<div class="notice-row"><span>✓</span><p><strong>${h(log.actor)}</strong> · ${h(log.summary)}<br><small>${displayDate(log.created_at)}</small></p></div>`).join('')||empty('Nenhuma atividade registrada.')}</section>`);
}

function modalView() {
  let title = { refer: 'Indicar alguém', visitor: 'Cadastrar visitante', qr: 'Pré-cadastro por QR Code', person: 'Cuidar desta pessoa', profile: 'Editar informações', 'person-form': 'Pessoa', 'person-detail': 'Ficha da pessoa', 'cell-form': 'Célula', 'cell-detail': 'Ficha da célula' }[modal.kind];
  let body = '';
  if (modal.kind === 'refer') body = formFields('referral');
  if (modal.kind === 'visitor') body = formFields('visitor');
  if (modal.kind === 'qr') body = `<div class="qr-layout"><div class="fake-qr" aria-label="Representação de QR Code">${Array.from({ length: 49 }, (_, i) => `<i class="${[0, 1, 5, 7, 8, 12, 13, 14, 21, 28, 35, 36, 40, 42, 43, 47, 48].includes(i) || i % 3 === 0 ? 'fill' : ''}"></i>`).join('')}</div><div><p>Este QR Code abrirá um cadastro breve para o visitante.</p><ul><li>Nome</li><li>WhatsApp</li><li>Consentimento para contato</li></ul><button class="button primary" data-modal="qr-form">Simular pré-cadastro</button></div></div>`;
  if (modal.kind === 'qr-form') { title = 'Pré-cadastro'; body = formFields('visitor', true); }
  if (modal.kind === 'person') body = personCareForm(modal.item);
  if (modal.kind === 'profile') { const profile = data.profile || data.currentUser; body = `<form id="profile-form"><label>Nome<input name="name" value="${h(profile.name)}" required></label><label>WhatsApp<input name="whatsapp" value="${h(profile.whatsapp)}" required inputmode="tel"></label><label>E-mail <small>opcional</small><input name="email" type="email" value="${h(profile.email || '')}"></label><label>Data de nascimento <small>opcional</small><input name="birthDate" type="date" value="${h(profile.birthDate || '')}"></label><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar configuração</button></div></form>`; }
  if (modal.kind === 'person-form') body = personForm(modal.item);
  if (modal.kind === 'person-detail') body = personDetailView(modal.item);
  if (modal.kind === 'cell-form') body = cellForm(modal.item);
  if (modal.kind === 'cell-detail') body = cellDetailView(modal.item);
  if (modal.kind === 'admin-user') { title = modal.item?'Editar usuário':'Novo usuário'; body = adminUserForm(modal.item); }
  if (modal.kind === 'admin-cell') { title = modal.item?'Editar célula':'Nova célula'; body = adminCellForm(modal.item); }
  if (modal.kind === 'admin-scope') { title = 'Escopo do Supervisor'; body = adminScopeForm(modal.item); }
  if (modal.kind === 'admin-branding') { title = 'Identidade da igreja'; body = adminBrandingForm(); }
  if (modal.kind === 'admin-theme') { title = modal.item ? 'Editar tema anual' : 'Novo tema anual'; body = adminThemeForm(modal.item); }
  if (modal.kind === 'reception-visitor') { title = 'Confirmar / completar cadastro'; body = receptionVisitorForm(modal.item); }
  if (modal.kind === 'admin-qr') { title = 'Pré-cadastro de visitantes'; body = `<div class="qr-public"><img src="${modal.item.image}" alt="QR Code para pré-cadastro de visitantes"><p><strong>URL pública</strong><br><a href="${h(modal.item.url)}" target="_blank" rel="noopener">${h(modal.item.url)}</a></p><p>É sua primeira vez conosco? Escaneie o QR Code e faça seu pré-cadastro.</p><div class="form-actions"><a class="button outline" download="cem-connect-visitantes.png" href="${modal.item.image}">Baixar imagem</a><button type="button" class="button primary" data-action="print-public-qr">Imprimir QR Code</button></div></div>`; }
  return `<div class="modal-backdrop"><section class="modal"><div class="modal-header"><div><p class="eyebrow">CEM CONNECT</p><h2>${title}</h2></div><button class="modal-close" data-close-modal>${icons.close}</button></div>${body}</section></div>`;
}

function formFields(kind, fromQr = false, standalone = false) {
  const isReferral = kind === 'referral';
  return `<form id="${kind}-form"><p class="form-help">${isReferral ? 'A Equipe 2 receberá esta indicação para analisar e decidir o próximo passo. Você receberá apenas a confirmação do envio.' : fromQr ? 'Leva menos de um minuto. A equipe poderá confirmar seus dados depois.' : 'Registre somente o necessário para que a Equipe 2 possa acolher esta pessoa.'}</p><label>Nome<input name="name" placeholder="Nome completo" required autocomplete="name"></label><label>WhatsApp<input name="whatsapp" placeholder="(00) 00000-0000" required inputmode="tel"></label>${isReferral || !fromQr ? `<label>Observação <small>opcional</small><textarea name="note" placeholder="Uma informação breve, se desejar."></textarea></label>` : ''}${fromQr ? `<label class="consent"><input type="checkbox" name="consent" required> Autorizo o contato da CEM Church pelo WhatsApp informado.</label>` : ''}<div class="form-actions">${standalone ? '' : '<button type="button" class="button outline" data-close-modal>Cancelar</button>'}<button class="button primary">${isReferral ? 'Enviar indicação' : 'Salvar cadastro'}</button></div></form>`;
}
function adminUserForm(user) { const selected=user?.roles||['member']; return `<form id="admin-user-form"><input name="id" type="hidden" value="${user?.id||''}"><label>Nome<input name="name" value="${h(user?.name||'')}" required></label><label>WhatsApp<input name="whatsapp" value="${h(user?.whatsapp||'')}" required></label><label>E-mail<input name="email" type="email" value="${h(user?.email||'')}" required></label>${!user?'<label>Senha inicial<input name="password" type="password" required></label>':''}<fieldset><legend>Funções</legend>${Object.entries(roles).map(([id,r])=>`<label class="consent"><input type="checkbox" name="roles" value="${id}" ${selected.includes(id)?'checked':''}> ${r.label}</label>`).join('')}</fieldset>${user?`<label class="consent"><input type="checkbox" name="active" ${user.active?'checked':''}> Acesso ativo</label><label>Nova senha <small>opcional</small><input name="newPassword" type="password"></label>`:''}<div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar</button></div></form>`; }
function adminCellForm(cell) { const current=cell?.members?.map(m=>m.id)||[]; const people=(data.administration?.people||[]); return `<form id="admin-cell-form"><input name="id" type="hidden" value="${cell?.id||''}"><label>Nome da célula<input name="name" value="${h(cell?.name||'')}" required></label><label>Dia da semana<input name="weekday" value="${h(cell?.weekday||'')}" required></label><label>Horário<input name="meetingTime" type="time" value="${h(cell?.meeting_time||cell?.meetingTime||'')}" required></label><label>Local/endereço<input name="location" value="${h(cell?.location||'')}" required></label><label>Bairro<input name="neighborhood" value="${h(cell?.neighborhood||'')}" required></label><label>Cidade<input name="city" value="${h(cell?.city||'')}" required></label><label>Estado<input name="state" value="${h(cell?.state||'')}" required></label><label class="consent"><input name="active" type="checkbox" ${cell?.active===0?'':'checked'}> Célula ativa</label><label>Liderança<select name="leader"><option value="">Liderança pendente</option>${people.map(p=>`<option value="${p.id}" ${Number(p.id)===Number(cell?.leader_person_id)?'selected':''}>${h(p.name)}</option>`).join('')}</select></label>${cell?`<label>Integrantes <small>ao selecionar alguém de outra célula, a confirmação será solicitada.</small><select name="members" multiple size="6">${people.map(p=>`<option value="${p.id}" ${current.includes(p.id)?'selected':''}>${h(p.name)}</option>`).join('')}</select></label>`:''}<div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar célula</button></div></form>`; }
function adminScopeForm(user) { return `<form id="admin-scope-form"><input name="id" type="hidden" value="${user.id}"><p class="form-help">Selecione as células que este Supervisor pode acompanhar.</p>${cells.map(c=>`<label class="consent"><input type="checkbox" name="cellIds" value="${c.id}" ${user.cellIds.includes(c.id)?'checked':''}> ${h(c.name)}</label>`).join('')}<div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar escopo</button></div></form>`; }
function adminBrandingForm() { const persisted = data.brandingAdministration?.church; return `<form id="admin-branding-form"><p class="form-help">Use URL HTTPS para o logo. O envio de arquivos será tratado em uma etapa posterior de storage.</p><label>Nome do aplicativo<input name="appName" value="${h(persisted?.app_name || '')}" placeholder="CEM CONNECT" required></label><label>Nome da igreja<input name="churchName" value="${h(persisted?.church_name || '')}" placeholder="CEM Church" required></label><label>URL do logo <small>opcional · HTTPS</small><input name="logoUrl" type="url" value="${h(persisted?.logo_url || '')}" placeholder="https://..."></label><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar identidade</button></div></form>`; }
function adminThemeForm(theme) { const colors = theme?.colors || {}; return `<form id="admin-theme-form"><input name="id" type="hidden" value="${h(theme?.id || '')}"><p class="form-help">O tema anual usa somente URL HTTPS e as cinco cores visuais permitidas.</p><label>Nome do tema<input name="name" value="${h(theme?.title || '')}" placeholder="Legado" required></label><label>Frase <small>opcional</small><input name="subtitle" value="${h(theme?.subtitle || '')}" placeholder="a luz da tua presença"></label><label>Ano<input name="year" type="number" min="2000" max="2100" value="${h(theme?.year || '')}" required></label><label>URL do banner <small>opcional · HTTPS</small><input name="bannerUrl" type="url" value="${h(theme?.banner_url || '')}" placeholder="https://..."></label><fieldset><legend>Cores <small>opcionais · #RRGGBB</small></legend><label>Primária<input name="primary" value="${h(colors.primary || '')}" placeholder="#B96745"></label><label>Secundária<input name="secondary" value="${h(colors.secondary || '')}" placeholder="#D38A53"></label><label>Destaque<input name="accent" value="${h(colors.accent || '')}" placeholder="#E8D5B5"></label><label>Fundo<input name="background" value="${h(colors.background || '')}" placeholder="#2A1E18"></label><label>Texto<input name="text" value="${h(colors.text || '')}" placeholder="#F7EEE3"></label></fieldset><label class="consent"><input name="isActive" type="checkbox" ${theme?.is_active ? 'checked' : ''}> Usar como tema anual ativo</label><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar tema</button></div></form>`; }
function receptionVisitorForm(visitor) { return `<form id="reception-visitor-form"><input type="hidden" name="id" value="${visitor.id}"><p class="form-help">Confirme somente os dados básicos de recepção.</p><label>Nome<input name="name" value="${h(visitor.name)}" required></label><label>WhatsApp<input name="whatsapp" value="${h(visitor.whatsapp)}" required inputmode="tel"></label><label>Origem<input name="source" value="${h(visitor.source)}" required></label><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar confirmação</button></div></form>`; }

function personCareForm(item) {
  const cellOptions = cells.map(cell => `<option value="${cell.id}" ${item.cellId === cell.id ? 'selected' : ''}>${h(cell.name)} — ${h(cell.schedule)}</option>`).join('');
  return `<div class="person-context"><span class="person-avatar">${item.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</span><div><strong>${h(item.name)}</strong><p>${h(item.whatsapp)} · ${h(item.source)}</p></div></div>${item.history?.length ? `<div class="history">${item.history.map(entry => `<p><small>${displayDate(entry.date)}${entry.responsible ? ` · ${h(entry.responsible)}` : ''}</small>${h(entry.text)}</p>`).join('')}</div>` : ''}<form id="care-form"><input type="hidden" name="type" value="${item.type}"><input type="hidden" name="id" value="${item.id}"><label>Registro de contato / histórico<textarea name="history" placeholder="Ex.: Ligação realizada; pessoa pediu contato na próxima semana."></textarea></label><label>Observação livre<textarea name="note" placeholder="Registre somente informações necessárias ao cuidado.">${h(item.note || '')}</textarea></label><label>Próximo passo<input name="nextStep" placeholder="Ex.: Retomar contato na próxima semana."></label><label>Status<select name="status"><option ${item.status === 'Novo' ? 'selected' : ''}>Novo</option><option ${item.status === 'Em análise' ? 'selected' : ''}>Em análise</option><option>Em acompanhamento</option><option>Encaminhado para célula</option><option>Encerrado</option></select></label><label>Responsável <small>opcional</small><input name="responsible" placeholder="Nome de quem seguirá com o cuidado"></label><label>Encaminhar para uma célula <small>opcional</small><select name="cellId"><option value="">Não encaminhar agora</option>${cellOptions}</select></label><div class="form-actions"><button type="button" class="button outline" data-close-modal>Cancelar</button><button class="button primary">Salvar próximo passo</button></div></form>`;
}

function render() {
  if (!authenticated) {
    $('#app').innerHTML = loginView();
    bindEvents();
    return;
  }
  const views = { home: homeView, cell: cellView, refer: referView, welcome: welcomeView, profile: profileView, people: peopleView, cells: cellsView, admin: adminView };
  $('#app').innerHTML = views[currentRoute()]();
  bindEvents();
}

function bindEvents() {
  $('#role-select')?.addEventListener('change', (event) => { activeRole = event.target.value; render(); });
  document.querySelectorAll('[data-route]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.route)));
  document.querySelectorAll('[data-modal]').forEach(el => el.addEventListener('click', () => { const kind = el.dataset.modal; const person = el.dataset.personEdit ? data.people.find((item) => item.id === el.dataset.personEdit) : null; const cell = el.dataset.cellEdit ? data.managementCells.find((item) => item.id === el.dataset.cellEdit) : null; modal = { kind, item: person || cell || null }; render(); }));
  document.querySelectorAll('[data-close-modal]').forEach(el => el.addEventListener('click', closeModal));
  document.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => { welcomeTab = el.dataset.tab; render(); }));
  document.querySelectorAll('[data-open-person]').forEach(el => el.addEventListener('click', () => {
    const [type, id] = el.dataset.openPerson.split(':');
    if (activeRole === 'welcome1' && type === 'visitor') { const item=data.visitors.find(person=>person.id===Number(id)); modal={kind:'reception-visitor',item}; render(); return; }
    if (!isTeam2()) { notify('Você não possui acesso aos detalhes deste registro.'); return; }
    const list = type === 'visitor' ? data.visitors : data.referrals; const item = list.find(person => person.id === Number(id)); modal = { kind: 'person', item: { ...item, type } }; render();
  }));
  $('#referral-form')?.addEventListener('submit', saveReferral);
  $('#visitor-form')?.addEventListener('submit', saveVisitor);
  $('#care-form')?.addEventListener('submit', saveCare);
  $('#profile-form')?.addEventListener('submit', saveProfile);
  $('#reception-visitor-form')?.addEventListener('submit', saveReceptionVisitor);
  $('#admin-user-form')?.addEventListener('submit', saveAdminUser); $('#admin-cell-form')?.addEventListener('submit', saveAdminCell); $('#admin-scope-form')?.addEventListener('submit', saveAdminScope); $('#admin-branding-form')?.addEventListener('submit', saveAdminBranding); $('#admin-theme-form')?.addEventListener('submit', saveAdminTheme);
  $('#admin-search')?.addEventListener('input', (event)=>{adminSearch=event.target.value; render();});
  $('#directory-search')?.addEventListener('input', (event)=>{directorySearch=event.target.value; render();});
  document.querySelectorAll('[data-person-id]').forEach((el) => el.addEventListener('click', async () => { try { modal = { kind: 'person-detail', item: await api(`/api/people/${el.dataset.personId}`) }; render(); } catch (error) { notify(error.message); } }));
  document.querySelectorAll('[data-cell-id]').forEach((el) => el.addEventListener('click', async () => { try { modal = { kind: 'cell-detail', item: await api(`/api/cells/${el.dataset.cellId}`) }; render(); } catch (error) { notify(error.message); } }));
  document.querySelectorAll('[data-person-edit]').forEach((el) => el.addEventListener('click', async () => { try { modal = { kind: 'person-form', item: await api(`/api/people/${el.dataset.personEdit}`) }; render(); } catch (error) { notify(error.message); } }));
  document.querySelectorAll('[data-cell-edit]').forEach((el) => el.addEventListener('click', async () => { try { modal = { kind: 'cell-form', item: await api(`/api/cells/${el.dataset.cellEdit}`) }; render(); } catch (error) { notify(error.message); } }));
  document.querySelectorAll('[data-admin-user]').forEach(el=>el.addEventListener('click',()=>{modal={kind:'admin-user',item:data.administration.users.find(u=>u.id===Number(el.dataset.adminUser))};render();}));
  document.querySelectorAll('[data-admin-cell]').forEach(el=>el.addEventListener('click',()=>{modal={kind:'admin-cell',item:data.administration.cells.find(c=>c.id===el.dataset.adminCell)};render();}));
  document.querySelectorAll('[data-admin-scope]').forEach(el=>el.addEventListener('click',()=>{modal={kind:'admin-scope',item:data.administration.users.find(u=>u.id===Number(el.dataset.adminScope))};render();}));
  document.querySelectorAll('[data-admin-theme]').forEach(el=>el.addEventListener('click',()=>{modal={kind:'admin-theme',item:data.brandingAdministration?.themes.find(theme=>theme.id===el.dataset.adminTheme)};render();}));
  $('#login-form')?.addEventListener('submit', login);
  $('#person-form')?.addEventListener('submit', savePerson);
  $('#cell-form')?.addEventListener('submit', saveCell);
  $('#journey-form')?.addEventListener('submit', saveJourney);
  $('#church-function-form')?.addEventListener('submit', saveChurchFunction);
  $('#leader-form')?.addEventListener('submit', saveLeader);
  $('#secretary-form')?.addEventListener('submit', saveSecretary);
  $('#member-form')?.addEventListener('submit', saveMember);
  $('#cell-function-form')?.addEventListener('submit', saveCellFunction);
  document.querySelectorAll('[data-end-member]').forEach((el) => el.addEventListener('click', () => endMemberLink(el.dataset.cellId, el.dataset.endMember)));
  document.querySelectorAll('[data-end-secretary]').forEach((el) => el.addEventListener('click', () => endSecretaryLink(el.dataset.cellId, el.dataset.endSecretary)));
  document.querySelectorAll('[data-end-cell-function]').forEach((el) => el.addEventListener('click', () => endCellFunctionLink(el.dataset.cellId, el.dataset.endCellFunction)));
  document.querySelectorAll('[data-end-church-function]').forEach((el) => el.addEventListener('click', () => endChurchFunctionLink(el.dataset.personId, el.dataset.endChurchFunction)));
  document.querySelector('[data-action="logout"]')?.addEventListener('click', logout);
  document.querySelector('[data-action="load-public-qr"]')?.addEventListener('click', loadPublicQr);
  document.querySelector('[data-action="print-public-qr"]')?.addEventListener('click', printPublicQr);
  document.querySelector('[data-action="menu"]')?.addEventListener('click', () => document.querySelector('.sidebar')?.classList.toggle('shown'));
}

function closeModal() { modal = null; render(); }
function notify(message) { toast = message; render(); setTimeout(() => { toast = ''; render(); }, 3500); }
function nextId(items) { return Math.max(0, ...items.map(item => item.id)) + 1; }
function formData(event) { return Object.fromEntries(new FormData(event.currentTarget)); }
async function saveReferral(event) { event.preventDefault(); const fields = formData(event); try { await api('/api/referrals', { method: 'POST', body: JSON.stringify({ ...fields, referredBy: data.currentUser.name }) }); await hydrate(); modal = null; navigate('home'); notify('Indicação enviada. A Equipe 2 irá analisar o próximo passo.'); } catch (error) { notify(error.message); } }
async function saveVisitor(event) { event.preventDefault(); const fields = formData(event); try { await api('/api/visitors', { method: 'POST', body: JSON.stringify({ ...fields, source: modal.kind === 'qr-form' ? 'QR Code' : 'Cadastro da Equipe 1', consent: modal.kind === 'qr-form' }) }); await hydrate(); modal = null; navigate('welcome'); notify('Visitante registrado e enviado para análise.'); } catch (error) { notify(error.message); } }
async function saveCare(event) { event.preventDefault(); const fields = formData(event); try { await api('/api/care', { method: 'POST', body: JSON.stringify(fields) }); await hydrate(); modal = null; navigate('welcome'); notify(fields.cellId ? 'Encaminhamento enviado ao líder da célula.' : 'Histórico e próximo passo salvos.'); } catch (error) { notify(error.message); } }
async function saveProfile(event) { event.preventDefault(); const fields = formData(event); try { await api('/api/profile', { method: 'PUT', body: JSON.stringify(fields) }); await hydrate(); modal = null; notify('Informações atualizadas.'); } catch (error) { notify(error.message); } }
async function savePerson(event) { event.preventDefault(); const form = new FormData(event.currentTarget); const body = Object.fromEntries(form); body.baptized = form.has('baptized'); try { if (body.id) await api(`/api/people/${body.id}`, { method: 'PUT', body: JSON.stringify(body) }); else await api('/api/people', { method: 'POST', body: JSON.stringify(body) }); modal = null; await hydrate(); notify('Pessoa salva.'); } catch (error) { notify(error.message); } }
async function saveCell(event) { event.preventDefault(); const form = new FormData(event.currentTarget); const body = Object.fromEntries(form); body.isActive = form.has('isActive'); try { if (body.id) await api(`/api/cells/${body.id}`, { method: 'PUT', body: JSON.stringify(body) }); else await api('/api/cells', { method: 'POST', body: JSON.stringify(body) }); modal = null; await hydrate(); notify('Célula salva.'); } catch (error) { notify(error.message); } }
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
async function saveReceptionVisitor(event) { event.preventDefault(); const fields = formData(event); try { await api(`/api/reception/visitors/${fields.id}`, { method: 'PUT', body: JSON.stringify(fields) }); modal = null; await hydrate(); notify('Cadastro confirmado e atualizado.'); } catch (error) { notify(error.message); } }
async function login(event) { event.preventDefault(); const fields = formData(event); try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify(fields) }); toast = ''; await hydrate(); } catch (error) { toast = error.message; render(); } }
async function logout() { await api('/api/auth/logout', { method: 'POST', body: '{}' }); authenticated = false; activeRole = 'member'; toast = ''; render(); }
async function loadPublicQr(){try{modal={kind:'admin-qr',item:await api('/api/admin/qrcode')};render()}catch(e){notify(e.message)}}
function printPublicQr(){const q=modal?.item;if(!q)return;const w=window.open('','_blank','width=700,height=800');w.document.write(`<title>QR Code de Visitantes</title><main style="font-family:system-ui;text-align:center;padding:40px"><h1>Pré-cadastro de visitantes</h1><img style="width:440px;max-width:100%" src="${q.image}"><p>É sua primeira vez conosco? Escaneie o QR Code e faça seu pré-cadastro.</p></main>`);w.document.close();w.focus();w.print();}
async function saveAdminUser(event){event.preventDefault();const f=new FormData(event.currentTarget),rolesSelected=f.getAll('roles');const body=Object.fromEntries(f);body.roles=rolesSelected;body.active=f.has('active');try{if(body.id){await api(`/api/admin/users/${body.id}`,{method:'PUT',body:JSON.stringify(body)});if(body.newPassword)await api(`/api/admin/users/${body.id}/password`,{method:'POST',body:JSON.stringify({password:body.newPassword})});}else await api('/api/admin/users',{method:'POST',body:JSON.stringify(body)});modal=null;await hydrate();notify('Usuário salvo.')}catch(e){notify(e.message)}}
async function saveAdminCell(event){event.preventDefault();const f=new FormData(event.currentTarget),body=Object.fromEntries(f);body.active=f.has('active');body.personIds=f.getAll('members');try{let id=body.id;if(id){const selected=body.personIds.map(Number);const conflict=(data.administration.people||[]).filter(p=>selected.includes(p.id)&&cells.some(c=>c.id!==id&&c.members?.some(m=>m.id===p.id)));if(conflict.length&&!confirm(`${conflict.map(p=>p.name).join(', ')} já pertence a outra célula. Transferir?`))return;await api(`/api/admin/cells/${id}`,{method:'PUT',body:JSON.stringify(body)});await api(`/api/admin/cells/${id}/leader`,{method:'PUT',body:JSON.stringify({personId:body.leader})});await api(`/api/admin/cells/${id}/members`,{method:'PUT',body:JSON.stringify({personIds:body.personIds})});}else{id=(await api('/api/admin/cells',{method:'POST',body:JSON.stringify(body)})).id;await api(`/api/admin/cells/${id}/leader`,{method:'PUT',body:JSON.stringify({personId:body.leader})});}modal=null;await hydrate();notify('Célula salva.')}catch(e){notify(e.message)}}
async function saveAdminScope(event){event.preventDefault();const f=new FormData(event.currentTarget);try{await api(`/api/admin/supervisors/${f.get('id')}/scope`,{method:'PUT',body:JSON.stringify({cellIds:f.getAll('cellIds')})});modal=null;await hydrate();notify('Escopo atualizado.')}catch(e){notify(e.message)}}
async function saveAdminBranding(event){event.preventDefault();const fields=formData(event);try{await api('/api/admin/branding/church',{method:'PUT',body:JSON.stringify(fields)});modal=null;await hydrateBranding();await hydrate();notify('Identidade atualizada.')}catch(e){notify(e.message)}}
async function saveAdminTheme(event){event.preventDefault();const form=new FormData(event.currentTarget);const colors=Object.fromEntries(['primary','secondary','accent','background','text'].map(key=>[key,String(form.get(key)||'').trim()]).filter(([,value])=>value));const body={id:form.get('id')||'',name:form.get('name'),subtitle:form.get('subtitle'),year:form.get('year'),bannerUrl:form.get('bannerUrl'),colors:Object.keys(colors).length?colors:null,isActive:form.has('isActive')};try{await api('/api/admin/branding/theme',{method:'PUT',body:JSON.stringify(body)});modal=null;await hydrateBranding();await hydrate();notify('Tema anual atualizado.')}catch(e){notify(e.message)}}

window.addEventListener('hashchange', render);
render();
hydrateBranding();
hydrate();
