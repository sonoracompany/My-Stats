import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm'
import { parseTikTok, parseWeekly, isWeeklyPrint, isMonthPrint, parseMonth, fixMonth } from './tiktok.js?v=__V__'
import { readEach } from './ocr.js?v=__V__'
import { WITHDRAW_FEE_USD, livePct, daysPct, weekStartOf, weekEndOf, weekDays, payoutRate, ledger, monthEarned, limitFor, LIMIT_TIERS, lifetime } from './rewards.js?v=__V__'

// A chave anon é pública por design; os dados são protegidos pelo RLS (supabase/schema.sql).
const SUPABASE_URL = 'https://tolmprwwnishdohhhuad.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvbG1wcnd3bmlzaGRvaGhodWFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MzA4NjEsImV4cCI6MjEwODIwNjg2MX0.iOfEVjMH8bIQNr9V6Y8CGJA4xsUWpJ0oomNnzAXtfdA'

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const app = document.getElementById('app')
const sheet = document.getElementById('sheet')
const toastEl = document.getElementById('toast')

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const brl = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0)
const usd = v => 'US$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0)
const int = v => new Intl.NumberFormat('pt-BR').format(Number(v) || 0)
const today = () => new Date().toLocaleDateString('sv-SE')
const fmtDate = d => d ? new Date(d + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
const fmtDateTime = d => d ? new Date(d).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
const toLocalInput = iso => { const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
const hours = min => { const m = Number(min) || 0; return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` }

const LIVE_STATUS = { planejada: 'Planejada', feita: 'Feita', cancelada: 'Cancelada' }
const VIDEO_STATUS = { ideia: 'Ideia', roteiro: 'Roteiro', gravado: 'Gravado', postado: 'Postado' }
const PAY_STATUS = { pendente: 'Pendente', pago: 'Pago' }
const PAY_KIND = { entrada: 'Entrada (R$)', saida: 'Saída (R$)', saque: 'Saque TikTok (US$)' }


const ENTITIES = {
  lives: {
    table: 'lives', title: 'Lives', single: 'live', order: ['date', false], importer: true,
    fields: [
      { key: 'title', label: 'Título da live', type: 'text', upper: true },
      { key: 'date', label: 'Data', type: 'date', required: true, half: true },
      { key: 'duration_min', label: 'Duração (min)', type: 'int', half: true },
      { key: 'rewards_usd', label: 'Recompensas (US$)', type: 'money', half: true },
      { key: 'diamonds', label: 'Diamantes', type: 'int', half: true },
      { key: 'views', label: 'Visualizações', type: 'int', half: true },
      { key: 'unique_viewers', label: 'Espectadores únicos', type: 'int', half: true },
      { key: 'active_viewers', label: 'Espectadores ativos', type: 'int', half: true },
      { key: 'avg_watch_sec', label: 'Tempo médio (s)', type: 'int', half: true },
      { key: 'peak_viewers', label: 'Pico simultâneo', type: 'int', half: true },
      { key: 'avg_viewers', label: 'Média simultânea', type: 'int', half: true },
      { key: 'new_followers', label: 'Novos seguidores', type: 'int', half: true },
      { key: 'gifters', label: 'Presenteadores', type: 'int', half: true },
      { key: 'comments', label: 'Comentários', type: 'int', half: true },
      { key: 'shares', label: 'Compartilhamentos', type: 'int', half: true },
      { key: 'likes', label: 'Curtidas', type: 'int' },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    item: r => ({
      title: r.title || fmtDate(r.date),
      meta: [r.title && fmtDate(r.date), r.duration_min && hours(r.duration_min), r.new_followers != null && `+${int(r.new_followers)} seg.`].filter(Boolean).join(' · '),
      value: r.rewards_usd != null ? usd(r.rewards_usd) : '',
    }),
  },
  payments: {
    table: 'payments', title: 'Pagamentos', single: 'pagamento', order: ['date', false],
    fields: [
      { key: 'description', label: 'Descrição', type: 'text', required: true },
      { key: 'amount', label: 'Valor', type: 'money', required: true, half: true },
      { key: 'date', label: 'Data', type: 'date', required: true, default: today, half: true },
      { key: 'kind', label: 'Tipo', type: 'select', options: PAY_KIND, default: () => 'entrada', half: true },
      { key: 'status', label: 'Status', type: 'select', options: PAY_STATUS, default: () => 'pendente', half: true },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    item: r => ({
      title: r.description,
      meta: `${fmtDate(r.date)} · ${r.kind === 'saque' ? 'Saque TikTok · ' : ''}${PAY_STATUS[r.status]}`,
      value: r.kind === 'saque' ? usd(r.amount) : `${r.kind === 'saida' ? '−' : '+'}${brl(r.amount)}`,
      tone: r.status === 'pendente' ? 'warn' : r.kind === 'saida' ? 'neg' : 'pos',
    }),
  },
  videos: {
    table: 'video_plans', title: 'Vídeos', single: 'plano de vídeo', order: ['created_at', false],
    fields: [
      { key: 'title', label: 'Título', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: VIDEO_STATUS, default: () => 'ideia', half: true },
      { key: 'due_date', label: 'Prazo', type: 'date', half: true },
      { key: 'idea', label: 'Ideia / gancho', type: 'textarea' },
      { key: 'plan', label: 'Plano de ação', type: 'textarea', rows: 6 },
    ],
    item: r => ({
      title: r.title,
      meta: [VIDEO_STATUS[r.status], r.due_date && `prazo ${fmtDate(r.due_date)}`].filter(Boolean).join(' · '),
      tag: r.status,
    }),
  },
  agenda: {
    table: 'live_plans', title: 'Agenda', single: 'live planejada', order: ['scheduled_at', true],
    fields: [
      { key: 'theme', label: 'Tema', type: 'text', required: true },
      { key: 'scheduled_at', label: 'Quando', type: 'datetime', required: true },
      { key: 'status', label: 'Status', type: 'select', options: LIVE_STATUS, default: () => 'planejada', half: true },
      { key: 'goal', label: 'Meta', type: 'text', half: true },
      { key: 'checklist', label: 'Checklist / roteiro', type: 'textarea', rows: 6 },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    item: r => ({
      title: r.theme,
      meta: [fmtDateTime(r.scheduled_at), r.goal && `meta: ${r.goal}`].filter(Boolean).join(' · '),
      tag: r.status,
    }),
  },
}

// Tabelas usadas só pela aba Recompensas (sem formulário genérico)
ENTITIES.withdrawals = { table: 'withdrawals', order: ['created_at', false] }
ENTITIES.snapshots = { table: 'reward_snapshots', order: ['taken_at', false] }
ENTITIES.summaries = { table: 'month_summaries', order: ['month', false], optional: true }   // resumo do mês (migração 005)
ENTITIES.goals = { table: 'goals', order: ['month', false], optional: true }   // meta de diamantes do mês (migração 004)

// Ícones (traço) usados nas telas
const IC = {
  text: '<rect class="d" x="5" y="3" width="14" height="18" rx="4"/><rect x="5" y="3" width="14" height="18" rx="4"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  copy: '<rect class="d" x="8" y="8" width="12" height="12" rx="4"/><rect x="8" y="8" width="12" height="12" rx="4"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  target: '<circle class="d" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  pen: '<path class="d" d="M4 19v-2.5L15.5 5a2.1 2.1 0 0 1 3 3L7.5 20H5a1 1 0 0 1-1-1z"/><path d="M4 19v-2.5L15.5 5a2.1 2.1 0 0 1 3 3L7.5 20H5a1 1 0 0 1-1-1zM13.5 7l3 3"/>',
  home: '<path class="d" d="M5 10.5l5.6-4.6a2.2 2.2 0 0 1 2.8 0L19 10.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19z"/><path d="M3.5 11.7l7.1-5.8a2.2 2.2 0 0 1 2.8 0l7.1 5.8M5 10.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-8.5M10 20.5v-4.5a2 2 0 0 1 4 0v4.5"/>',
  live: '<rect class="d" x="9" y="3" width="6" height="11" rx="4.5"/><rect x="9" y="3" width="6" height="11" rx="4.5"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
  stats: '<rect x="4" y="12" width="4" height="8" rx="2"/><rect class="d" x="10" y="4" width="4" height="16" rx="2"/><rect x="10" y="4" width="4" height="16" rx="2"/><rect x="16" y="9" width="4" height="11" rx="2"/>',
  gem: '<path class="d" d="M7.6 4.5h8.8a1.5 1.5 0 0 1 1.2.6l2.7 3.5a1.2 1.2 0 0 1-.05 1.5l-7.1 8.6a1.5 1.5 0 0 1-2.3 0L3.75 10.1a1.2 1.2 0 0 1-.05-1.5l2.7-3.5a1.5 1.5 0 0 1 1.2-.6z"/><path d="M7.6 4.5h8.8a1.5 1.5 0 0 1 1.2.6l2.7 3.5a1.2 1.2 0 0 1-.05 1.5l-7.1 8.6a1.5 1.5 0 0 1-2.3 0L3.75 10.1a1.2 1.2 0 0 1-.05-1.5l2.7-3.5a1.5 1.5 0 0 1 1.2-.6zM3.6 9.3h16.8M10.3 4.5 8.7 9.3 12 18.6l3.3-9.3-1.6-4.8"/>',
  cam: '<path class="d" d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  usd: '<circle class="d" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="M14.6 9.3c-.5-.8-1.4-1.3-2.6-1.3-1.5 0-2.6.8-2.6 1.9 0 2.7 5.2 1.3 5.2 4.2 0 1.1-1.1 1.9-2.6 1.9-1.2 0-2.2-.5-2.7-1.3M12 6.5V8M12 16v1.5"/>',
  clock: '<circle class="d" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  user: '<circle class="d" cx="12" cy="8" r="4"/><circle cx="12" cy="8" r="4"/><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
  eye: '<path class="d" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  heart: '<path class="d" d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/>',
  flame: '<path class="d" d="M12 21c-3.9 0-6.5-2.7-6.5-6.2 0-3.9 3.3-5.8 4.3-9.8 2.4 1.6 3.2 3.9 3.2 3.9s1.1-1 1.5-2.6c2.3 1.9 4 4.7 4 8.5 0 3.5-2.6 6.2-6.5 6.2z"/><path d="M12 21c-3.9 0-6.5-2.7-6.5-6.2 0-3.9 3.3-5.8 4.3-9.8 2.4 1.6 3.2 3.9 3.2 3.9s1.1-1 1.5-2.6c2.3 1.9 4 4.7 4 8.5 0 3.5-2.6 6.2-6.5 6.2zM12 21c-1.6 0-2.7-1.1-2.7-2.6 0-1.7 1.5-2.5 2.7-4.1 1.2 1.6 2.7 2.4 2.7 4.1 0 1.5-1.1 2.6-2.7 2.6z"/>',
  trophy: '<path class="d" d="M8.5 4h7a1 1 0 0 1 1 1v4.5a4.5 4.5 0 0 1-9 0V5a1 1 0 0 1 1-1z"/><path d="M8.5 4h7a1 1 0 0 1 1 1v4.5a4.5 4.5 0 0 1-9 0V5a1 1 0 0 1 1-1zM7.5 6H5.5a2.5 2.5 0 0 0 2.4 3.6M16.5 6h2a2.5 2.5 0 0 1-2.4 3.6M12 14v3M10 17h4a1 1 0 0 1 1 .9l.3 1.6a.8.8 0 0 1-.8 1H9.5a.8.8 0 0 1-.8-1l.3-1.6a1 1 0 0 1 1-.9z"/>',
  cal: '<rect class="d" x="3.5" y="5" width="17" height="15.5" rx="4.5"/><rect x="3.5" y="5" width="17" height="15.5" rx="4.5"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01"/>',
  shield: '<path class="d" d="M11.3 3.8a2 2 0 0 1 1.4 0L18 5.7a1.5 1.5 0 0 1 1 1.4v4.4c0 4.6-3 7.9-7 9-4-1.1-7-4.4-7-9V6z"/><path d="M11.3 3.8a2 2 0 0 1 1.4 0L18 5.7a1.5 1.5 0 0 1 1 1.4v4.4c0 4.6-3 7.9-7 9-4-1.1-7-4.4-7-9V6zM9 12l2 2 4-4"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  back: '<path d="M14.5 6 8.5 12l6 6"/>',
  bank: '<rect class="d" x="3" y="6.5" width="18" height="13.5" rx="4.5"/><rect x="3" y="6.5" width="18" height="13.5" rx="4.5"/><path d="M6.5 6.5V6a2 2 0 0 1 2.4-2l8.6 1.6M21 11.5h-3.5a1.75 1.75 0 0 0 0 3.5H21"/>',
}
const NOTE = '<rect x="2.5" y="6" width="19" height="12" rx="3.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6.2 9.6h.01M17.8 14.4h.01"/>'
const ic = k => `<svg viewBox="0 0 24 24">${IC[k]}</svg>`

const TABS = [
  { id: 'home', label: 'Início', icon: 'home' },
  { id: 'lives', label: 'Lives', icon: 'live' },
  { id: 'stats', label: 'Estatísticas', icon: 'stats' },
  { id: 'rewards', label: 'Recompensas', icon: 'gem' },
]

const state = { tab: 'home', rtab: 'saldo', lmonth: null, lsort: 'data', wmonth: null, smonth: null, data: {}, rate: readCachedRate() }

function readCachedRate() {
  try { return JSON.parse(localStorage.getItem('usd-brl')) } catch { return null }
}

// Dólar comercial do dia: AwesomeAPI (gratuita, sem chave, atualiza o dia todo).
// Se ela falhar, a reserva é a PTAX do Banco Central, a cotação oficial (só em dias úteis).
const RATE_SOURCES = [
  async () => {
    const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL')
    const q = (await res.json()).USDBRL
    return { commercial: Number(q.bid), at: q.create_date, source: 'AwesomeAPI' }
  },
  async () => {
    const day = d => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`
    const end = new Date()
    const start = new Date(end.getTime() - 7 * 864e5)   // fins de semana e feriados não têm PTAX
    const url = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)'
      + `?@dataInicial='${day(start)}'&@dataFinalCotacao='${day(end)}'&$format=json&$orderby=dataHoraCotacao%20desc&$top=1`
    const q = (await (await fetch(url)).json()).value[0]
    return { commercial: Number(q.cotacaoVenda), at: q.dataHoraCotacao, source: 'Banco Central' }
  },
]

async function loadRate() {
  for (const source of RATE_SOURCES) {
    try {
      const rate = await source()
      if (!(rate.commercial > 0)) continue
      state.rate = rate
      try { localStorage.setItem('usd-brl', JSON.stringify(rate)) } catch {}
      return rate
    } catch {
      // tenta a próxima fonte
    }
  }
  // Sem internet: segue com a última cotação salva
  return state.rate
}

function toast(msg) {
  // com uma janela aberta, o aviso precisa estar dentro dela para aparecer por cima
  ;(sheet.open && !sheet.classList.contains('closing') ? sheet : document.body).append(toastEl)
  toastEl.textContent = msg
  toastEl.classList.add('show')
  clearTimeout(toast.t)
  toast.t = setTimeout(() => toastEl.classList.remove('show'), 2600)
}

async function load(name) {
  const e = ENTITIES[name]
  const { data, error } = await sb.from(e.table).select('*').order(e.order[0], { ascending: e.order[1] })
  if (error) {
    // tabela opcional ainda não criada no banco (ex.: metas antes da migração 004): segue sem ela
    if (e.optional) return (state.data[name] = state.data[name] || [])
    toast('Erro ao carregar: ' + error.message); return state.data[name] || []
  }
  // títulos de lives sempre em maiúsculas, inclusive os salvos antes dessa regra
  if (name === 'lives') for (const l of data) if (l.title) l.title = l.title.toLocaleUpperCase('pt-BR')
  return (state.data[name] = data)
}

// ---------- Login ----------

function renderLogin() {
  app.innerHTML = `
    <main class="login">
      <h1>My <span>Stats</span></h1>
      <p class="muted">Entre com o seu usuário do Supabase.</p>
      <form id="login" class="stack">
        <label class="field"><span>E-mail</span><input name="email" type="email" autocomplete="username" required></label>
        <label class="field"><span>Senha</span><input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn primary" type="submit">Entrar</button>
      </form>
    </main>`
  document.getElementById('login').addEventListener('submit', async ev => {
    ev.preventDefault()
    const f = new FormData(ev.target)
    const btn = ev.target.querySelector('button')
    btn.disabled = true
    const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') })
    btn.disabled = false
    if (error) toast('Não foi possível entrar: ' + error.message)
  })
}

// ---------- Shell ----------

function renderShell() {
  app.innerHTML = `
    <header class="top"><div><small id="kicker"></small><h1 id="title"></h1></div>
      <div class="top-actions">
        <button id="prints" class="ibtn" aria-label="Mandar prints">${ic('cam')}<span>Prints</span><i class="due" hidden></i></button>
      </div></header>
    <main id="view"></main>
    <nav class="tabs">${TABS.map(t => `
      <button data-tab="${t.id}" aria-label="${t.label}">${ic(t.icon)}<span>${t.label}</span></button>`).join('')}
    </nav>`
  app.querySelector('.tabs').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-tab]')
    if (b) go(b.dataset.tab)
  })
  document.getElementById('prints').addEventListener('click', openPrints)
  go(state.tab)
}

// Puxar pra atualizar: no topo da tela, arrastar pra baixo mostra um diamante girando e busca os dados de novo
{
  const ptr = document.createElement('div'); ptr.className = 'ptr'
  let y0 = null, dy = 0, busy = false
  const set = d => { ptr.style.opacity = Math.min(d / 70, 1); ptr.style.transform = `translateY(${Math.min(d * 0.5, 50)}px) scale(${0.6 + Math.min(d / 200, 0.4)}) rotate(${d * 3}deg)` }
  addEventListener('touchstart', e => { if (scrollY <= 0 && !sheet.open && !busy && signedIn) { y0 = e.touches[0].clientY; dy = 0 } }, { passive: true })
  addEventListener('touchmove', e => {
    if (y0 == null) return
    dy = Math.max(0, e.touches[0].clientY - y0)
    if (dy > 6) { if (!ptr.isConnected) { ptr.innerHTML = ic('gem'); document.body.append(ptr) } set(dy) }
  }, { passive: true })
  addEventListener('touchend', async () => {
    if (y0 == null) return
    y0 = null
    if (!ptr.isConnected) return
    ptr.style.transition = 'transform .35s var(--ease), opacity .35s'
    if (dy > 90) {
      busy = true; set(90); ptr.classList.add('spin')
      await Promise.all([reload(), new Promise(r => setTimeout(r, 700))])
      ptr.classList.remove('spin'); busy = false
    }
    set(0)
    setTimeout(() => { ptr.style.transition = ''; if (!busy) ptr.remove() }, 380)
  })
}

// Parallax dos doodles do fundo: só mexe enquanto rola, e fica parado com "Reduzir movimento"
{
  const still = matchMedia('(prefers-reduced-motion: reduce)')
  let ticking = false
  // camada própria: mexer só no transform dela não obriga o navegador a recalcular a página inteira
  const layer = document.createElement('div')
  layer.className = 'doodles'
  layer.setAttribute('aria-hidden', 'true')
  document.body.prepend(layer)
  addEventListener('scroll', () => {
    if (still.matches || ticking) return
    ticking = true
    requestAnimationFrame(() => {
      const y = scrollY
      layer.style.transform = `translate3d(${(-y * 0.18) % 180}px, ${(-y * 0.07) % 180}px, 0)`
      ticking = false
    })
  }, { passive: true })
}

// O que cada aba precisa do banco
const NEEDS = { home: ['lives', 'withdrawals', 'goals', 'summaries'], career: ['lives', 'withdrawals', 'goals', 'summaries'], live: ['lives', 'withdrawals'], lives: ['lives', 'summaries'], stats: ['lives', 'withdrawals', 'summaries'], rewards: ['lives', 'withdrawals', 'snapshots', 'summaries'] }
const DRAW = { home: a => renderHome(a), career: a => renderCareer(a), live: a => renderLive(a), lives: a => renderLives(a), stats: a => renderStats(a), rewards: a => renderRewards(a) }

async function fetchFor(tab) {
  const sig = () => JSON.stringify([...NEEDS[tab].map(n => state.data[n]), state.data.settings, state.rate?.commercial])
  const before = sig()
  await Promise.all([...NEEDS[tab].map(load), tab === 'rewards' && loadSettings(), tab !== 'lives' && freshRate()])
  return sig() !== before
}

// Busca de novo e redesenha só se algo mudou, sem animação (depois de salvar, ao voltar para o app)
async function reload(tab = state.tab) {
  if (!DRAW[tab]) return
  if (await fetchFor(tab) && state.tab === tab) DRAW[tab](false)
}

const TAB_ORDER = ['home', 'career', 'lives', 'live', 'stats', 'rewards']
// páginas extras: para onde a pílula flutuante de voltar leva
const BACK = { career: ['home', 'Início'], live: ['lives', 'Lives'] }
const pill = document.createElement('button')
pill.type = 'button'; pill.className = 'lx-backf'; pill.hidden = true
pill.addEventListener('click', () => go(pill.dataset.to))
function backPill(tab) {
  const t = BACK[tab]
  pill.hidden = !t; pill.classList.remove('on')
  if (!t) return
  pill.dataset.to = t[0]; pill.setAttribute('aria-label', `Voltar para ${t[1]}`)
  pill.innerHTML = `${ic('back')}<span>${t[1]}</span>`
  if (!pill.isConnected) document.body.append(pill)
}
// a pílula aparece quando o botão de voltar do topo sai da tela
{
  let tick = false
  addEventListener('scroll', () => {
    if (tick || pill.hidden) return
    tick = true
    requestAnimationFrame(() => { tick = false; pill.classList.toggle('on', scrollY > 90) })
  }, { passive: true })
}   // a Carreira abre pelo Início; a página da live, pela Lives
const LUXE = ['home', 'career', 'lives', 'live', 'stats']   // telas com o topo esmeralda de ponta a ponta (sem o cabeçalho de sempre)
function go(tab) {
  const from = TAB_ORDER.indexOf(state.tab), to = TAB_ORDER.indexOf(tab)
  const v = document.getElementById('view')
  v.classList.remove('slide-l', 'slide-r')
  if (from !== to) { void v.offsetWidth; v.classList.add(to > from ? 'slide-r' : 'slide-l') }
  state.tab = tab
  const tabId = { career: 'home', live: 'lives' }[tab] || tab
  app.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tabId))
  app.querySelector('.tabs').style.setProperty('--ti', TABS.findIndex(t => t.id === tabId))   // o destaque desliza até a aba
  document.body.classList.toggle('luxe', LUXE.includes(tab))
  backPill(tab)
  document.getElementById('title').textContent = { home: 'E aí, Galli!', career: 'Carreira', live: 'Live', rewards: 'Recompensas', stats: 'Estatísticas' }[tab] ?? ENTITIES[tab].title
  const kicker = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  document.getElementById('kicker').textContent = tab === 'home' ? kicker[0].toUpperCase() + kicker.slice(1).replace('-feira', '') : ''
  window.scrollTo(0, 0)
  if (!DRAW[tab]) return renderList(tab)
  // Com dados na memória, desenha na hora (sem "Carregando…") e atualiza por trás
  const cached = NEEDS[tab].every(n => state.data[n]) && (tab !== 'rewards' || state.data.settings)
  if (cached) DRAW[tab](true)
  else document.getElementById('view').innerHTML = '<p class="muted center">Carregando…</p>'
  fetchFor(tab).then(changed => { if (state.tab === tab && (changed || !cached)) DRAW[tab](!cached) })
}

// ---------- Peças de tela ----------

const sumOf = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)
const avgOf = (rows, k) => { const v = rows.map(r => Number(r[k])).filter(n => n > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0 }
const brl0 = v => 'R$ ' + new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.round(Number(v) || 0))
const dec = (v, d = 1) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }).format(v)
// números grandes com K e M: 1.963.400 → "1,96M"; 536.600 → "537K"
const compact = v => (v >= 1e6 ? `${dec(v / 1e6, 2)}M` : v >= 1e4 ? `${int(Math.round(v / 1e3))}K` : int(Math.round(v)))
const ymOf = d => d.toLocaleDateString('sv-SE').slice(0, 7)
const prevYm = ym => { const [y, m] = ym.split('-').map(Number); return ymOf(new Date(y, m - 2, 15)) }
const monthWord = ym => new Date(`${ym}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long' })
const cap = t => t ? t[0].toUpperCase() + t.slice(1) : t
const weekday = d => new Date(`${d}T12:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')

// chuva de diamantes (ou notinhas) caindo dentro do card principal
const RAIN = [[6, 34, 14, 0], [22, 24, 11, -6], [38, 38, 17, -3], [54, 28, 12, -9], [70, 32, 15, -1], [86, 26, 10, -5], [14, 30, 16, -11], [62, 22, 13, -8], [94, 34, 18, -13], [46, 26, 12, -14]]
const rain = shape => `<div class="floaters" aria-hidden="true">${RAIN.map(([x, sz, d, dl]) => `<svg viewBox="0 0 24 24" style="left:${x}%;width:${sz}px;height:${sz}px;animation-duration:${d}s;animation-delay:${dl}s">${shape}</svg>`).join('')}</div>`
const GEM_LINE = () => IC.gem.replace(/<path class="d"[^>]*\/>/, '')

// seletores com "polegar" que desliza: --n opções, --i a escolhida
const slideTo = (el, i) => { if (el) requestAnimationFrame(() => requestAnimationFrame(() => el.style.setProperty('--i', i))) }

const sec = (title, body, side = '') => `<section class="sec"><div class="sec-h"><h2>${title}</h2>${side}</div>${body}</section>`

const ring = (pct, big, label) => `<div class="ring"><svg viewBox="0 0 84 84"><circle class="bg" cx="42" cy="42" r="36"/><circle ${pct > 0.5 ? '' : 'hidden '}class="fg" cx="42" cy="42" r="36" pathLength="100" stroke-dasharray="${Math.min(Math.max(pct, 0), 100).toFixed(1)} 100"/></svg><div><b>${big}</b><span>${label}</span></div></div>`

// parte do card dividido (nome com ícone, número, comparação e uma linha de apoio)
const qcell = (icon, label, value, extra = '', rate = '', money = false) =>
  `<div class="q ${money ? 'money' : ''}"><small>${ic(icon)}${esc(label)}</small><span class="vr"><b>${esc(value)}</b>${extra}</span>${rate ? `<i class="rate">${esc(rate)}</i>` : ''}</div>`

function monthPicker(ym, sub, attr, i, n) {
  const [m, y] = new Date(`${ym}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).split(' de ')
  return `
    <div class="month">
      <button type="button" ${attr}="-1" aria-label="Mês anterior" ${i === 0 ? 'disabled' : ''}>${ic('back')}</button>
      <div><b>${esc(cap(m))} <em>${esc(y)}</em></b><span>${esc(sub)}</span></div>
      <button type="button" ${attr}="1" aria-label="Próximo mês" ${i === n - 1 ? 'disabled' : ''}>${ic('chev')}</button>
    </div>`
}

// ---------- Início ----------

// arco da meta: meia-volta de raio 130 dentro de um quadro 300×165 (f vai de 0 a 1)
const arcPt = f => { const a = Math.PI * (1 - Math.min(Math.max(f, 0), 1)); return [150 + 130 * Math.cos(a), 150 - 130 * Math.sin(a)] }
const greet = () => { const h = new Date().getHours(); return h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite' }
const monShort = d => d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
const shortMonthYear = d => `${monShort(d)}/${d.getFullYear()}`
// 59.600 → "59,6K"; 1.963.400 → "1,96M"
const mil1 = v => (v >= 1e6 ? `${dec(v / 1e6, 2)}M` : v >= 1e3 ? `${dec(v / 1e3, 1).replace(/,0$/, '')}K` : int(Math.round(v)))
// 100.000.000 → "100M"; 2.500.000 → "2,5M"
const goalLabel = v => (v >= 1e6 ? `${dec(v / 1e6, 2).replace(/,?0+$/, '')}M` : compact(v))
// por extenso, nos marcos: "1 milhão", "25 milhões"
const millions = v => (v === 1e6 ? '1 milhão' : `${dec(v / 1e6, 2).replace(/,?0+$/, '')} milhões`)
// dólares curtos: US$ 7.853 → "US$ 7,9K"
const usdK = v => (v >= 1e3 ? `US$ ${dec(v / 1e3, 1).replace(/,0$/, '')}K` : usd0(Math.round(v)))
// diamantes do mês: lives registradas ou o resumo do TikTok, o que for maior
const monthGems = (lives, ym) => Math.max(sumOf(lives.filter(l => l.date?.startsWith(ym)), 'diamonds'), Number(summaryOf(ym)?.diamonds) || 0)

// Meta do acumulado: no ritmo dos últimos 3 meses fechados, quando chega
function lifeForecast(total, lives) {
  const g = (state.data.goals || []).find(x => x.month === 'total')
  let m = prevYm(today().slice(0, 7))
  const vals = []
  for (let k = 0; k < 3; k++) { const v = monthGems(lives, m); if (v) vals.push(v); m = prevYm(m) }
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  const goal = Number(g?.diamonds) || 0
  const left = goal - total
  const at = n => { const d = new Date(); d.setDate(15); d.setMonth(d.getMonth() + n); return d }
  const months = goal && left > 0 && avg ? Math.ceil(left / avg) : 0
  return { goal, left, avg, nAvg: vals.length, months, at,
    when: months ? shortMonthYear(at(months)) : '', whenLong: months ? at(months).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '' }
}

// cartão de live do Início: data, título, diamantes, duração e valor, barrinha contra a melhor do mês
function liveCard(l, max, bestId) {
  const sub = [l.duration_min && hours(l.duration_min), l.rewards_usd != null && usd(l.rewards_usd)].filter(Boolean).join(' · ')
  const best = l.id === bestId
  return `<button type="button" class="nb-lc ${best ? 'nb-best' : ''}" data-edit="lives" data-id="${l.id}">
    <span class="nb-top"><span class="nb-date">${esc(weekday(l.date).toUpperCase())} <b>${esc(`${l.date.slice(8)}/${l.date.slice(5, 7)}`)}</b></span>${best ? `<span class="nb-crown">${ic('trophy')}melhor do mês</span>` : ''}</span>
    <b class="nb-title">${esc(l.title || fmtDate(l.date))}</b>
    <span class="nb-gem">${ic('gem')}<b>${l.diamonds != null ? esc(int(l.diamonds)) : '—'}</b></span>
    <span class="nb-sub">${esc(sub)}</span>
    <span class="nb-bar"><span style="width:${Math.min((Number(l.diamonds) || 0) / (max || 1) * 100, 100).toFixed(1)}%"></span></span>
  </button>`
}

function renderHome(animate) {
  const view = document.getElementById('view')
  const { lives, withdrawals } = state.data
  const goals = state.data.goals || []

  const now = new Date()
  const ym = today().slice(0, 7)
  const pym = prevYm(ym)
  const day = now.getDate()
  const ml = lives.filter(l => l.date?.startsWith(ym))
  const pAll = lives.filter(l => l.date?.startsWith(pym))
  const pSame = pAll.filter(l => +l.date.slice(8) <= day)   // mês passado até o mesmo dia
  const saques = withdrawals.filter(w => w.date?.startsWith(ym)).length

  const gems = sumOf(ml, 'diamonds')
  const mins = sumOf(ml, 'duration_min')
  const rewards = sumOf(ml, 'rewards_usd')
  const net = Math.max(rewards - saques * WITHDRAW_FEE_USD, 0)
  const commercial = state.rate?.commercial
  const payout = payoutRate(withdrawals, commercial)
  const rate = payout?.rate ?? null
  const life = lifetime(lives)
  const mName = monthWord(ym), pName = monthWord(pym), pAbbr = `${pName.slice(0, 3)}.`
  const nDays = new Date(+ym.slice(0, 4), +ym.slice(5), 0).getDate()
  const daysLeft = nDays - day + 1

  // arco: a meta do mês; sem meta, compara com o mês passado inteiro
  const goal = goals.find(g => g.month === ym)
  const ref = Number(goal?.diamonds) || sumOf(pAll, 'diamonds')
  const frac = ref ? gems / ref : 0
  const exp = goal ? arcPt(day / nDays) : null
  const dot = arcPt(frac)

  // "O mês até agora": uma frase com o ritmo
  const sameGems = sumOf(pSame, 'diamonds')
  const vsP = sameGems ? (gems - sameGems) / sameGems * 100 : null
  const perDay = gems / day
  const left = goal ? goal.diamonds - gems : 0
  let lead
  if (!ml.length) lead = `Nenhuma live registrada em ${esc(mName)} ainda.`
  else {
    lead = vsP != null ? `Você está <em>${int(Math.round(Math.abs(vsP)))}% ${vsP >= 0 ? 'acima' : 'abaixo'}</em> de ${esc(pName)}. ` : ''
    const close = `${esc(mName)} fecha com <b>${esc(mil1(perDay * nDays))}</b>`
    if (goal && left <= 0) lead += `Meta batida: <b>+${esc(int(-left))}</b> além dos ${esc(goalLabel(goal.diamonds))}.`
    else if (goal) {
      const d = Math.ceil(left / perDay)
      lead += `Faltam <b>${esc(int(left))}</b> diamantes — no seu ritmo, ${d <= daysLeft ? `a meta chega em <b>${d} ${d === 1 ? 'dia' : 'dias'}</b>` : close}.`
    } else lead += `No seu ritmo, ${close}.`
  }
  const hint = goal && left > 0 ? `<span>Precisa de <b>${esc(mil1(left / daysLeft))}</b> por dia${gems ? `<br>sua média é ${esc(mil1(perDay))}` : ''}</span>`
    : goal ? `<span>Meta de <b>${esc(goalLabel(goal.diamonds))}</b> batida 🎉</span>`
      : '<span>Defina uma meta pra ver<br>quanto falta por dia</span>'

  // carreira (abre a tela Carreira)
  const lf = lifeForecast(life.diamonds, lives)
  const lifeSub = !lf.goal ? `≈ ${usd0(Math.round(life.usd))} desde nov/2023`
    : lf.left <= 0 ? `Meta de ${goalLabel(lf.goal)} batida!`
      : `${int(Math.floor(life.diamonds / lf.goal * 100))}% de ${goalLabel(lf.goal)}${lf.when ? ` · ~ ${lf.when}` : ''}`

  // dólar
  const last = withdrawals[0]
  const diff = last && commercial ? commercial - Number(last.rate_brl) : null
  const fxNote = diff != null ? `No saque fica <b>R$ ${esc(dec(Math.abs(diff), 2))}</b> por dólar ${diff >= 0 ? 'no caminho' : 'a mais'} · último saque ${esc(shortDate(`${last.date}T12:00`))}`
    : payout?.source === 'comercial' ? 'Sem saque registrado: estimado pelo comercial − R$ 0,18'
      : !commercial ? 'Dólar comercial: sem conexão agora' : ''

  // comparativos com o mês passado
  const perLive = ml.length ? rewards / ml.length : 0
  const pPerLive = pAll.length ? sumOf(pAll, 'rewards_usd') / pAll.length : 0
  const money = v => (rate ? brl0(v * rate) : usd(v))
  const plus = v => '+' + int(v)
  const cmp = [
    ['user', 'Seguidores', sumOf(ml, 'new_followers'), sumOf(pSame, 'new_followers'), plus, 'g'],
    ['usd', 'Por live', perLive, pPerLive, money, 'c'],
    ['eye', 'Pico médio', avgOf(ml, 'peak_viewers'), avgOf(pAll, 'peak_viewers'), v => int(Math.round(v)), 'g'],
    ['heart', 'Curtidas', sumOf(ml, 'likes'), sumOf(pSame, 'likes'), compact, 'g'],
  ]
  const tile = ([icon, label, a, b, fmt, tone]) => {
    const m = Math.max(a, b) || 1
    const p = b ? Math.round((a - b) / b * 100) : null
    const up = p == null || p >= 0
    return `<div class="nb-t ${up ? '' : 'dn'}"><small><span class="si ${tone}">${ic(icon)}</span>${esc(label)}</small><b>${esc(fmt(a))}</b>
      <span class="nb-mb" aria-hidden="true">${pAll.length ? `<i style="height:${(b / m * 100).toFixed(0)}%"></i>` : ''}<i style="height:${(a / m * 100).toFixed(0)}%"></i></span>
      ${pAll.length ? `<span class="nb-prev">${p != null ? `<em class="${up ? 'u' : 'd'}">${up ? '↑' : '↓'} ${Math.abs(p)}%</em>` : ''}${esc(pAbbr)}: ${b ? esc(fmt(b)) : '—'}</span>` : ''}</div>`
  }

  // últimas lives
  const bestId = [...ml].sort((a, b) => (b.diamonds || 0) - (a.diamonds || 0))[0]?.id
  const recent = lives.slice(0, 3)
  const max = Math.max(...ml.map(l => Number(l.diamonds) || 0), ...recent.map(l => Number(l.diamonds) || 0), 1)

  const tag = `${weekday(today()).toUpperCase()} · ${day} ${monShort(now).toUpperCase()}`
  view.innerHTML = `
    <div class="lx">
      <section class="lx-hero">
        <div class="lx-bar"><span>${esc(tag)}</span><button type="button" class="lx-prints" data-prints>${ic('cam')}Prints<i class="due" hidden></i></button></div>
        <p class="lx-hi">${greet()}, <b>Galli</b></p>
        <div class="lx-gauge">
          <svg viewBox="0 0 300 165" aria-hidden="true">
            <defs><linearGradient id="lxg" x1="0" x2="1"><stop offset="0" stop-color="#c6f59a" stop-opacity=".35"/><stop offset="1" stop-color="#c6f59a"/></linearGradient></defs>
            <path d="M20 150 A130 130 0 0 1 280 150" fill="none" stroke="rgb(255 255 255 / .12)" stroke-width="2"/>
            <path class="lx-arc" ${frac > 0 ? '' : 'visibility="hidden"'} d="M20 150 A130 130 0 0 1 280 150" fill="none" stroke="url(#lxg)" stroke-width="3.5" stroke-linecap="round" pathLength="100" stroke-dasharray="${(Math.min(frac, 1) * 100).toFixed(2)} 100"/>
            ${exp ? `<circle cx="${exp[0].toFixed(1)}" cy="${exp[1].toFixed(1)}" r="4" fill="#0a5640" stroke="#e2742f" stroke-width="2"/>` : ''}
            <g class="lx-dot" ${ref ? '' : 'visibility="hidden"'} transform="translate(${dot[0].toFixed(1)} ${dot[1].toFixed(1)})"><circle r="12" fill="#c6f59a" opacity=".18"/><circle r="6" fill="#c6f59a"/></g>
          </svg>
          <div class="lx-num"><small>DIAMANTES · ${esc(mName.toUpperCase())}</small><b class="lx-n">${esc(int(gems))}</b>${ref ? `<span class="lx-pct"><i>${int(Math.round(frac * 100))}%</i>${goal ? 'da meta' : `de ${esc(pName)}`}</span>` : ''}</div>
          <div class="lx-ends"><span>0</span>${exp ? '<span class="lx-tick"><i></i>esperado hoje</span>' : '<span></span>'}<button type="button" class="lx-goal" data-goal>${ic('target')}<b>${goal ? esc(goalLabel(goal.diamonds)) : 'Definir meta'}</b>${ic('pen')}</button></div>
        </div>
        <div class="lx-glass">
          <div><small><i>${ic('usd')}</i>saldo do mês</small><b class="num">${esc(rate ? brl0(net * rate) : usd(net))}</b></div>
          <div><small><i>${ic('live')}</i>lives</small><b class="num">${ml.length}</b></div>
          <div><small><i>${ic('clock')}</i>ao vivo</small><b class="num">${esc(hours(mins))}</b></div>
        </div>
      </section>

      <section class="lx-sheet">
        <div class="lx-lead">
          <small>O MÊS ATÉ AGORA</small>
          <p>${lead}</p>
          <div class="lx-hint">${ic('target')}${hint}<button type="button" data-goal>${goal ? 'Editar meta' : 'Definir meta'}</button></div>
        </div>
        <div class="nx">
          <button type="button" class="cx-teaser" data-career aria-label="Abrir sua carreira">
            <span class="cx-ic">${ic('trophy')}</span>
            <span class="cx-t"><small>SUA CARREIRA</small><b>${esc(int(life.diamonds))}</b><span>${esc(lifeSub)}</span></span>
            <span class="cx-go">${ic('chev')}</span>
            ${lf.goal ? `<i class="cx-line"><i style="width:${Math.min(life.diamonds / lf.goal * 100, 100).toFixed(1)}%"></i></i>` : ''}
          </button>
          <div class="nx-card nx-fx">
            <span class="si c">${ic('usd')}</span>
            <div><small>${payout?.source === 'saque' ? 'Dólar do saque' : 'Dólar estimado'}</small><b class="num">${rate ? esc(brlRate(rate)) : '—'}</b></div>
            <div><small>Comercial hoje${state.rate?.source === 'Banco Central' ? ' (BC)' : ''}</small><b class="num">${commercial ? esc(`R$ ${dec(commercial, 2)}`) : '—'}</b></div>
            ${fxNote ? `<p>${fxNote}</p>` : ''}
          </div>
          ${ml.length || pAll.length ? `<div class="nx-h"><small>${pAll.length ? `COMPARADO A ${esc(pName.toUpperCase())}` : `${esc(mName.toUpperCase())} ATÉ AGORA`}</small>${pAll.length ? `<small>ATÉ DIA ${day}</small>` : ''}</div>
          <div class="nb-grid">${cmp.map(tile).join('')}</div>
          ${pAll.length ? `<div class="nb-leg"><span><u></u>${esc(pName)}</span><span><i></i>${esc(mName)}</span></div>` : ''}` : ''}
          <div class="nx-h"><small>ÚLTIMAS LIVES</small><button type="button" class="nx-all" data-go-lives>Ver todas${ic('chev')}</button></div>
          ${lives.length ? `<div class="nb-lives">${recent.map(l => liveCard(l, max, bestId)).join('')}</div>` : empty('Nenhuma live registrada.', 'lives')}
        </div>
        <button id="logout" class="btn ghost lx-out">Sair</button>
      </section>
    </div>`
  bindList(view)
  if (animate) reveal(view)
  lxAnim(view, frac, gems, animate)
  updateDue()
  view.querySelector('[data-prints]').addEventListener('click', openPrints)
  view.querySelectorAll('[data-goal]').forEach(b => b.addEventListener('click', () => openGoal(ym)))
  view.querySelector('[data-career]').addEventListener('click', () => go('career'))
  if (goal && gems >= goal.diamonds) {
    setTimeout(() => celebrate(goal.diamonds, ym), animate ? 1700 : 0)
    view.querySelector('.lx-pct')?.addEventListener('click', () => celebrate(goal.diamonds, ym, true))
  }
  view.querySelector('[data-go-lives]').addEventListener('click', () => go('lives'))
  document.getElementById('logout').addEventListener('click', () => sb.auth.signOut())
}

// o arco sobe do zero até onde você está, com o ponto acompanhando e o número e a % contando junto
function lxAnim(root, frac, total, animate) {
  if (!animate || still() || !total) return
  const arc = root.querySelector('.lx-arc'), dot = root.querySelector('.lx-dot'), num = root.querySelector('.lx-n'), pct = root.querySelector('.lx-pct i')
  const target = Math.min(frac, 1), t0 = performance.now(), dur = 1600
  const ease = t => 1 - (1 - t) ** 4
  const step = t => {
    const k = Math.min((t - t0) / dur, 1), e = ease(k)
    arc.setAttribute('stroke-dasharray', `${(target * e * 100).toFixed(2)} 100`)
    const [x, y] = arcPt(target * e)
    dot.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`)
    num.textContent = int(Math.round(total * e))
    if (pct) pct.textContent = `${int(Math.round(frac * 100 * e))}%`
    if (k < 1) requestAnimationFrame(step)
  }
  step(t0)
  requestAnimationFrame(step)
}

// ---------- Carreira (abre pelo Início) ----------

function renderCareer(animate) {
  const view = document.getElementById('view')
  const { lives, withdrawals } = state.data
  const life = lifetime(lives)
  const total = life.diamonds
  const lf = lifeForecast(total, lives)
  const rate = payoutRate(withdrawals, state.rate?.commercial)?.rate
  const end = lf.goal || 1e8   // sem meta, a trilha vai até 100M
  const f = Math.min(total / end, 1)
  const cur = today().slice(0, 7)
  const [cy, cm] = cur.split('-').map(Number)
  const nMonths = (cy - 2023) * 12 + (cm - 11) + 1   // desde nov/2023, contando o mês atual
  const brlBig = v => (v >= 1e6 ? `R$ ${dec(v / 1e6, 1)}M` : brl0(v))

  const marks = [0.1, 0.25, 0.5, 0.75, 1].map(k => k * end)
  const goalRow = !lf.goal ? '<span>Defina uma meta para a carreira</span>'
    : lf.left <= 0 ? '<span>Meta batida! 🎉</span>'
      : `<span>Faltam <b>${esc(mil1(lf.left))}</b>${lf.when ? ` · chega ~ ${esc(lf.when)}` : ''}</span>`

  let lead
  if (!lf.goal) lead = 'Defina uma meta para a carreira e veja aqui quando você chega nela.'
  else if (lf.left <= 0) lead = `Você passou dos <em>${esc(goalLabel(lf.goal))}</em>! Hora de pensar na próxima meta.`
  else if (!lf.avg) lead = `Faltam <b>${esc(mil1(lf.left))}</b>. Ainda não há meses fechados para calcular o seu ritmo.`
  else lead = `Faltam <b>${esc(mil1(lf.left))}</b>. Com a média ${lf.nAvg === 1 ? 'do último mês' : `dos últimos ${lf.nAvg} meses`} (<b>${esc(mil1(lf.avg))} por mês</b>), você chega aos <em>${esc(goalLabel(lf.goal))}</em> em <b>${esc(lf.whenLong)}</b>.`

  // mês a mês: os últimos 6 meses com dados (lives registradas ou resumo do TikTok)
  const months = []
  for (let k = 0, m = cur; k < 6; k++, m = prevYm(m)) months.unshift([m, monthGems(lives, m)])
  const withData = months.filter(([, v]) => v)
  const top = Math.max(...months.map(([, v]) => v), 1)
  const bestM = withData.filter(([m]) => m < cur).sort((a, b) => b[1] - a[1])[0]?.[0]
  const monthsHtml = withData.length >= 2 ? `
      <div class="lx-block">
        <div class="lx-row lx-h"><small>MÊS A MÊS</small><small>DIAMANTES</small></div>
        ${withData.map(([m, v]) => `<div class="cx-yr ${m === cur ? 'cx-cur' : m === bestM ? 'cx-best' : ''}"><span>${esc(cap(monthWord(m)))}<small>${m === cur ? 'em andamento' : m === bestM ? 'melhor mês' : m.slice(0, 4)}</small></span><i><i style="width:${(v / top * 100).toFixed(1)}%"></i></i><b class="num">${esc(mil1(v))}</b></div>`).join('')}
      </div>` : ''

  // marcos: os que já passou e a previsão dos próximos
  const steps = [...new Set([1e6, 1e7, 2.5e7, 5e7, 7.5e7, end])].filter(v => v <= end).sort((a, b) => a - b)
  const msHtml = steps.map(v => {
    if (v <= total) return `<div class="cx-mi"><i></i><b>${esc(millions(v))}</b><span>alcançado</span></div>`
    const n = lf.avg ? Math.ceil((v - total) / lf.avg) : 0
    return `<div class="cx-mi fut"><i></i><b>${esc(millions(v))}</b><span>${n ? `previsão ~ ${esc(shortMonthYear(lf.at(n)))}` : `faltam ${esc(mil1(v - total))}`}</span></div>`
  }).join('')

  // melhores meses entre os que têm dados
  const all = new Set([...lives.map(l => l.date?.slice(0, 7)), ...(state.data.summaries || []).map(s => s.month)].filter(m => m && m < cur))
  const ranked = [...all].map(m => [m, monthGems(lives, m), lives.filter(l => l.date?.startsWith(m)).length]).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const bestHtml = ranked.length >= 2 ? `
      <div class="lx-block">
        <div class="lx-row lx-h"><small>MELHORES MESES</small><small>REGISTRADOS</small></div>
        ${ranked.map(([m, v, n], i) => `<div class="rk"><span class="pos ${i === 0 ? 'g' : ''}">${i + 1}º</span><div class="t"><b>${esc(cap(monthWord(m)))} de ${m.slice(0, 4)}</b><span>${n ? `${n} ${n === 1 ? 'live' : 'lives'}` : 'resumo do TikTok'}</span></div><b class="num">${esc(mil1(v))}</b></div>`).join('')}
      </div>` : ''

  view.innerHTML = `
    <div class="lx cx">
      <section class="lx-hero cx-hero">
        <div class="lx-bar"><button type="button" class="lx-prints" data-back>${ic('back')}Início</button><span>DESDE NOV/2023</span></div>
        <p class="lx-hi">Sua <b>carreira</b></p>
        <div class="cx-big"><small>DIAMANTES NO TOTAL</small><b data-count>${esc(int(total))}</b><span>≈ ${esc(usd0(Math.round(life.usd)))} em recompensas</span></div>
        <div class="cx-track">
          <div class="cx-rail"><i style="width:${(f * 100).toFixed(1)}%"></i></div>
          ${marks.map(v => `<span class="cx-ms ${v <= total ? 'ok' : 'fut'}" style="left:${(v / end * 100).toFixed(1)}%"><i></i>${esc(goalLabel(v))}</span>`).join('')}
          <span class="cx-now" style="left:${(f * 100).toFixed(1)}%"></span>
        </div>
        <div class="cx-goalrow">${goalRow}<button type="button" class="lx-goal" data-lgoal>${ic('target')}<b>${lf.goal ? esc(goalLabel(lf.goal)) : 'Definir meta'}</b>${ic('pen')}</button></div>
        <div class="lx-glass">
          <div><small><i>${ic('cal')}</i>meses</small><b class="num">${nMonths}</b></div>
          <div><small><i>${ic('stats')}</i>por mês</small><b class="num">${esc(mil1(total / nMonths))}</b></div>
          <div><small><i>${ic('usd')}</i>em reais</small><b class="num">${rate ? esc(brlBig(life.usd * rate)) : '—'}</b></div>
        </div>
      </section>
      <section class="lx-sheet">
        <div class="lx-lead"><small>NO RITMO ATUAL</small><p>${lead}</p></div>
        ${monthsHtml}
        <div class="lx-block">
          <div class="lx-row lx-h"><small>MARCOS</small><small>${lf.avg ? 'NO RITMO ATUAL' : ''}</small></div>
          <div class="cx-tl">${msHtml}</div>
        </div>
        ${bestHtml}
      </section>
    </div>`
  if (animate) reveal(view)
  view.querySelector('[data-back]').addEventListener('click', () => go('home'))
  view.querySelector('[data-lgoal]').addEventListener('click', () => openGoal('total'))
}

// Meta de diamantes do mês (ou do acumulado, com ym = 'total'): definir, mudar e ver as dos meses anteriores
function openGoal(ym) {
  const goals = state.data.goals || []
  const cur = goals.find(g => g.month === ym)
  const done = m => sumOf(state.data.lives.filter(l => l.date?.startsWith(m)), 'diamonds')
  const total = ym === 'total'
  const past = total ? [] : goals.filter(g => g.month !== ym && g.month !== 'total').slice(0, 6)
  sheet.innerHTML = `
    <form method="dialog" class="sheet-body">
      <div class="sheet-head"><button type="button" class="link" data-close>Cancelar</button><strong>${total ? 'Meta do acumulado' : `Meta de ${esc(monthWord(ym))}`}</strong><button type="submit" class="link strong">Salvar</button></div>
      <div class="fields"><label class="field" for="goal-v"><span>${total ? 'Diamantes no total' : 'Diamantes no mês'}</span><input id="goal-v" name="v" type="text" inputmode="numeric" placeholder="${total ? '100.000.000' : '2.500.000'}" value="${cur ? esc(int(cur.diamonds)) : ''}" required></label></div>
      ${past.length ? `<div class="card"><h3>Metas anteriores</h3>${past.map(g => { const d = done(g.month); return `<div class="row"><span>${esc(cap(monthWord(g.month)))} ${g.month.slice(0, 4)}</span><b class="${d >= g.diamonds ? 'up' : 'down'}">${esc(compact(d))} de ${esc(compact(g.diamonds))}</b></div>` }).join('')}</div>` : ''}
      ${cur ? '<button type="button" class="btn danger" data-delete>Tirar a meta</button>' : ''}
    </form>`
  const form = sheet.querySelector('form')
  sheet.querySelector('[data-close]').addEventListener('click', () => closeSheet())
  sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const { error } = await sb.from('goals').delete().eq('month', ym)
    if (error) return toast('Erro ao tirar: ' + error.message)
    closeSheet(); toast('Meta removida'); reload()
  })
  form.addEventListener('submit', async ev => {
    ev.preventDefault()
    const diamonds = parseInt(form.v.value.replace(/\D/g, ''), 10)
    if (!(diamonds > 0)) return toast('Coloque quantos diamantes')
    const save = form.querySelector('[type=submit]')
    if (save.disabled) return
    save.disabled = true
    const { error } = await sb.from('goals').upsert({ month: ym, diamonds }, { onConflict: 'user_id,month' })
    if (error) { save.disabled = false; return toast(/goals/.test(error.message) ? 'Falta criar a tabela de metas no Supabase (migração 004).' : 'Erro ao salvar: ' + error.message) }
    closeSheet(650); toast('Meta salva'); reload()
  })
  sheet.showModal()
  document.activeElement?.blur()
}

const compactUsd = v => (v >= 1000 && v % 1000 === 0 ? `US$ ${int(v / 1000)}K` : usd0(v))

const brlRate = r => 'R$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(r)

async function freshRate() {
  if (state.rate && Date.now() - (state.rateFetched || 0) < 30 * 60e3) return
  await loadRate()
  state.rateFetched = Date.now()
}

// ---------- Animação ao rolar ----------

const revealer = new IntersectionObserver(entries => {
  // os que entram juntos na tela aparecem em cascata, de cima pra baixo
  let k = 0
  for (const e of entries.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)) {
    if (!e.isIntersecting) continue
    e.target.style.transitionDelay = `${Math.min(k++, 6) * 70}ms`
    e.target.classList.add('in')
    revealer.unobserve(e.target)
  }
}, { rootMargin: '0px 0px -8% 0px' })

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// contador subindo do zero até o valor (só na primeira vez que a tela aparece)
function countUp(el) {
  const txt = el.textContent, target = Number(txt.replace(/\D/g, ''))
  if (!target || still() || /,\d{2}$/.test(txt)) return
  const pre = txt.match(/^\D*/)[0], t0 = performance.now(), dur = 900
  const step = t => {
    const p = Math.min((t - t0) / dur, 1)
    el.textContent = p < 1 ? pre + int(Math.round(target * (1 - (1 - p) ** 3))) : txt
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// meta batida: chuva de diamantes com o fundo desfocado (uma vez por mês)
function celebrate(goal, ym, again = false) {
  const key = `goal-party-${ym}`
  if (!again) try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1') } catch {}
  if (document.querySelector('.toastx')) return
  if (still()) return toast('Meta batida! 💎')
  const bl = document.createElement('div'); bl.className = 'blurbg'
  const box = document.createElement('div'); box.className = 'party'
  // primeiro uma explosão saindo do meio, depois a chuva
  const burst = Array.from({ length: 16 }, (_, i) => {
    const a = i / 16 * Math.PI * 2, r = 130 + Math.random() * 90, sz = 16 + Math.random() * 16
    return `<svg class="burst" viewBox="0 0 24 24" style="width:${sz}px;height:${sz}px;--bx:${Math.cos(a) * r}px;--by:${Math.sin(a) * r}px;--r:${(Math.random() - 0.5) * 540}deg">${IC.gem}</svg>`
  }).join('')
  box.innerHTML = burst + Array.from({ length: 34 }, () => {
    const sz = 14 + Math.random() * 22
    return `<svg viewBox="0 0 24 24" style="left:${Math.random() * 100}%;width:${sz}px;height:${sz}px;--dx:${(Math.random() - 0.5) * 120}px;--r:${(Math.random() - 0.5) * 720}deg;animation-duration:${2.2 + Math.random() * 1.8}s;animation-delay:${0.35 + Math.random() * 1.2}s">${IC.gem}</svg>`
  }).join('')
  const t = document.createElement('div'); t.className = 'toastx'
  t.innerHTML = `<i class="tg">${IC.trophy ? `<svg viewBox="0 0 24 24">${IC.trophy}</svg>` : ''}</i><b>Meta batida!</b><span>${esc(int(goal))} diamantes em ${esc(monthWord(ym))}</span><small>toque pra fechar</small>`
  document.body.append(bl, box, t)
  let done = false
  const close = () => {
    if (done) return; done = true
    t.classList.add('bye'); bl.classList.add('off'); box.classList.add('off')
    setTimeout(() => { bl.remove(); box.remove(); t.remove() }, 450)
  }
  bl.addEventListener('click', close); t.addEventListener('click', close)
  setTimeout(close, 4500)
}

// cartões aparecem ao rolar, em cascata; as linhas de dentro entram uma por uma e os gráficos só se formam quando aparecem
const REVEAL = '.feature, .life, .fxp, .sec, .month, .seg, .best, .chartcard, .card, .form, .proj, .ret, .rec, .quad, .empty, .cx-teaser, .nx-card, .nb-grid, .nb-lc, .ls-best, .ls-list, .ls-wk, .ls-seg, .lx-h, .nx-h, .ld-note, .st-streak, .nb-leg, .ls-c3, .lx-lead, .st-empty'
function reveal(root) {
  root.querySelectorAll('[data-count]').forEach(countUp)
  root.querySelectorAll('.lv .crown, .rec.new .rt svg').forEach(x => x.classList.add('wiggle'))
  root.querySelectorAll(REVEAL).forEach(el => {
    if (el.parentElement.closest('.reveal')) return   // já entra junto com o cartão de fora
    el.querySelectorAll('.nx-row, .cx-yr, .st-c, .rk, .ls-row, .ls-cr').forEach((r, k) => r.style.setProperty('--r', k))
    el.classList.add('reveal')
    revealer.observe(el)
  })
}
// rolada rápida: o que ficou acima da tela sem ter aparecido aparece na hora (para não ficar escondido ao voltar)
{
  let tick = false
  addEventListener('scroll', () => {
    if (tick) return
    tick = true
    requestAnimationFrame(() => {
      tick = false
      document.querySelectorAll('.reveal:not(.in)').forEach(el => { if (el.getBoundingClientRect().bottom < 0) { el.classList.add('in'); revealer.unobserve(el) } })
    })
  }, { passive: true })
}

const empty = (msg, name) => `<div class="empty"><p class="muted">${esc(msg)}</p><button class="btn" data-new="${name}">Adicionar</button></div>`

function list(name, rows) {
  const e = ENTITIES[name]
  return `<ul class="list">${rows.map(r => {
    const it = e.item(r)
    return `<li><button data-edit="${name}" data-id="${r.id}">
      <div class="txt"><strong>${esc(it.title)}</strong>${it.meta ? `<span>${esc(it.meta)}</span>` : ''}</div>
      ${it.value ? `<em class="${it.tone || ''}">${esc(it.value)}</em>` : ''}
      ${it.tag ? `<i class="tag ${esc(it.tag)}">${esc((LIVE_STATUS[it.tag] || VIDEO_STATUS[it.tag]))}</i>` : ''}
    </button></li>`
  }).join('')}</ul>`
}

function bindList(root) {
  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const row = state.data[b.dataset.edit].find(r => r.id === b.dataset.id)
    openForm(b.dataset.edit, row)
  }))
  root.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => openForm(b.dataset.new)))
}

// ---------- Listas ----------

async function renderList(name) {
  const view = document.getElementById('view')
  if (!state.data[name]) view.innerHTML = '<p class="muted center">Carregando…</p>'
  else paint(name)
  await load(name)
  if (state.tab === name) paint(name)
}

function paint(name) {
  const view = document.getElementById('view')
  const rows = state.data[name] || []
  view.innerHTML = rows.length ? list(name, rows) : empty(`Nada por aqui ainda.`, name)
  bindList(view)
  reveal(view)
}

// ---------- Formulário ----------

function input(f, v) {
  const id = `f-${f.key}`
  const req = f.required ? 'required' : ''
  let el
  if (f.type === 'textarea') el = `<textarea id="${id}" name="${f.key}" rows="${f.rows || 3}" ${req}>${esc(v)}</textarea>`
  else if (f.type === 'select') el = `<select id="${id}" name="${f.key}">${Object.entries(f.options).map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
  else if (f.type === 'int') el = `<input id="${id}" name="${f.key}" type="number" inputmode="numeric" step="1" min="0" value="${esc(v)}" ${req}>`
  else if (f.type === 'money') el = `<input id="${id}" name="${f.key}" type="text" inputmode="decimal" placeholder="0,00" value="${v != null && v !== '' ? esc(String(v).replace('.', ',')) : ''}" ${req}>`
  else if (f.type === 'date') el = `<input id="${id}" name="${f.key}" type="date" value="${esc(v)}" ${req}>`
  else if (f.type === 'datetime') el = `<input id="${id}" name="${f.key}" type="datetime-local" value="${v ? esc(toLocalInput(v)) : ''}" ${req}>`
  else el = `<input id="${id}" name="${f.key}" type="text" value="${esc(v)}" ${f.upper ? 'autocapitalize="characters" class="upper"' : ''} ${req}>`
  return `<label class="field ${f.half ? 'half' : ''}" for="${id}"><span>${esc(f.label)}</span>${el}</label>`
}

function parse(f, raw) {
  const s = String(raw ?? '').trim()
  if (s === '') return null
  if (f.upper) return s.toLocaleUpperCase('pt-BR')
  if (f.type === 'int') return parseInt(s, 10)
  if (f.type === 'money') {
    // "1.500,50" e "1500.50" viram 1500.5
    const thousands = !s.includes(',') && /^\d{1,3}(\.\d{3})+$/.test(s)   // "1.500" = mil e quinhentos
    const n = Number(s.includes(',') || thousands ? s.replace(/\./g, '').replace(',', '.') : s)
    if (Number.isNaN(n)) throw new Error(`Valor inválido em "${f.label}"`)
    return n
  }
  if (f.type === 'datetime') return new Date(s).toISOString()
  return s
}

function openForm(name, row, prefill) {
  const e = ENTITIES[name]
  const editing = !!row
  sheet.innerHTML = `
    <form method="dialog" class="sheet-body">
      <div class="sheet-head">
        <button type="button" class="link" data-close>Cancelar</button>
        <strong>${editing ? 'Editar' : 'Nova'} ${esc(e.single)}</strong>
        <button type="submit" class="link strong">Salvar</button>
      </div>
      ${e.importer ? `
      <div class="importer">
        <label class="btn primary file-btn" for="import-files">Escolher prints</label>
        <input id="import-files" type="file" accept="image/*" multiple hidden>
        <p class="muted">Selecione os 3 prints da live (Viewership, Engagement e Rewards) de uma vez.</p>
        <details>
          <summary>Colar texto em vez disso</summary>
          <button type="button" class="btn" data-paste>Colar dados do print</button>
          <textarea id="import-text" rows="3" placeholder="Ou cole o texto aqui…" aria-label="Texto do print"></textarea>
        </details>
        <span id="import-status" class="muted" role="status"></span>
        <details class="raw-box" hidden><summary>Ver texto lido</summary><pre id="import-raw"></pre></details>
      </div>` : ''}
      <div class="fields">${e.fields.map(f => input(f, editing ? row[f.key] : f.default?.() ?? '')).join('')}</div>
      ${editing ? '<button type="button" class="btn danger" data-delete>Excluir</button>' : ''}
    </form>`
  const form = sheet.querySelector('form')
  if (e.importer) {
    const apply = bindImporter(form, e)
    if (prefill) apply(prefill)
  }
  sheet.querySelector('[data-close]').addEventListener('click', () => closeSheet())
  sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!confirm('Excluir este registro?')) return
    const { error } = await sb.from(e.table).delete().eq('id', row.id)
    if (error) return toast('Erro ao excluir: ' + error.message)
    closeSheet(); toast('Excluído'); reload()
  })
  form.addEventListener('submit', async ev => {
    ev.preventDefault()
    let values
    try {
      const fd = new FormData(form)
      values = Object.fromEntries(e.fields.map(f => [f.key, parse(f, fd.get(f.key))]))
    } catch (err) { return toast(err.message) }
    // trava o botão: dois toques rápidos em "Salvar" criavam a live duas vezes
    const save = form.querySelector('[type=submit]')
    if (save.disabled) return
    save.disabled = true
    const q = editing ? sb.from(e.table).update(values).eq('id', row.id) : sb.from(e.table).insert(values)
    const { error } = await q
    if (error) { save.disabled = false; return toast('Erro ao salvar: ' + error.message) }
    closeSheet(650); toast('Salvo'); reload()
  })
  sheet.showModal()
  // o iPhone foca o primeiro botão ao abrir (o "Cancelar") e desenha um contorno nele
  document.activeElement?.blur()
}

function bindImporter(form, e) {
  const box = form.querySelector('#import-text')
  const status = form.querySelector('#import-status')
  const filled = new Set()
  const apply = text => {
    const data = parseTikTok(text)
    let n = 0
    for (const f of e.fields) {
      if (data[f.key] == null) continue
      const el = form.elements[f.key]
      el.value = f.type === 'money' ? String(data[f.key]).replace('.', ',') : data[f.key]
      el.closest('.field').classList.add('auto')
      filled.add(f.key); n++
    }
    // Sem a recompensa no print, calcula: diamantes × US$ 0,01 × porcentagem da live (duração e seguidores)
    let calculated = false
    const rewardsEl = form.elements.rewards_usd
    if (data.rewards_usd == null && !rewardsEl.value && num(form.elements.diamonds.value)) {
      const pctLive = livePct(num(form.elements.duration_min.value), num(form.elements.new_followers.value))
      rewardsEl.value = (num(form.elements.diamonds.value) * pctLive / 10000).toFixed(2).replace('.', ',')
      rewardsEl.closest('.field').classList.add('auto', 'calc')
      calculated = true
    }
    status.textContent = n
      ? `${filled.size} campos preenchidos.${calculated ? ' Recompensa calculada pelos diamantes: confira no print.' : ''} Confira antes de salvar.`
      : 'Não encontrei dados da live nesse texto.'
  }
  form.querySelector('[data-paste]').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) return apply(text)
    } catch {}
    box.focus()
    status.textContent = 'Cole o texto na caixa abaixo.'
  })
  box.addEventListener('input', () => { if (box.value.trim()) { apply(box.value); box.value = '' } })
  const files = form.querySelector('#import-files')
  const pick = form.querySelector('.file-btn')
  files.addEventListener('change', async () => {
    if (!files.files.length) return
    pick.classList.add('busy')
    try {
      const text = (await readEach([...files.files], msg => { status.textContent = msg })).join('\n')
      form.querySelector('#import-raw').textContent = text
      form.querySelector('.raw-box').hidden = false
      apply(text)
    } catch (err) {
      status.textContent = err.message || 'Não consegui ler os prints. Tente colar o texto.'
    } finally {
      pick.classList.remove('busy')
      files.value = ''
    }
  })
  return apply
}

// botão vira um check desenhando (o formulário fecha logo depois)
function checkmark(btn) {
  if (!btn || still()) return
  btn.style.minWidth = btn.offsetWidth + 'px'
  btn.classList.add('saved')
  btn.innerHTML = '<svg class="ok" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
}

function closeSheet(delay = 0) {
  if (delay && !still()) { checkmark(sheet.querySelector('[type=submit]')); return setTimeout(() => closeSheet(), delay) }
  sheet.classList.add('closing')
  setTimeout(() => { sheet.close(); sheet.classList.remove('closing') }, still() ? 0 : 280)
}
sheet.addEventListener('click', ev => { if (ev.target === sheet) closeSheet() })
sheet.addEventListener('cancel', ev => { ev.preventDefault(); closeSheet() })

// ---------- Lives: mês a mês ----------

const shortDay = d => new Date(`${d}T12:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })

// Totais do mês. Num mês que já fechou e tem o resumo do TikTok (prints do mês inteiro),
// os totais vêm do resumo (as lives registradas podem não cobrir o mês todo); a lista continua sendo a das lives.
function monthStats(lives, month, livesOnly = false) {
  const ls = lives.filter(l => l.date?.startsWith(month))
  const sum = livesOnly ? null : summaryOf(month)
  const fromSummary = !!sum?.diamonds && sum.diamonds > sumOf(ls, 'diamonds')
  const agg = fromSummary ? [sum] : ls
  const total = k => sumOf(agg, k)
  const days = new Set(ls.map(l => l.date)).size
  const gems = total('diamonds')
  const min = total('duration_min')
  return { ls, agg, fromSummary, days, gems, min, usd: total('rewards_usd'),
    perDay: fromSummary ? null : days ? gems / days : 0, perHour: min ? gems / (min / 60) : null, perLive: fromSummary ? null : ls.length ? gems / ls.length : 0 }
}
const summaryOf = month => (state.data.summaries || []).find(r => r.month === month)?.data

const perHour = l => (l.duration_min ? (Number(l.diamonds) || 0) / (l.duration_min / 60) : 0)

const LSORT = ['data', 'diamantes', 'hora']
const dm = d => `${d.slice(8)}/${d.slice(5, 7)}`
// linha de live da lista: data, título, duração e valor, diamantes e por hora (toque abre a folha de edição)
const lsRow = (l, bestId) => `<button type="button" class="ls-row" data-edit="lives" data-id="${l.id}">
    <span class="nx-dt"><b>${esc(l.date.slice(8))}</b><small>${esc(weekday(l.date).toUpperCase())}</small></span>
    <span class="ls-rt"><b>${l.id === bestId ? `<span class="nx-crown">${ic('trophy')}</span>` : ''}${esc(l.title || fmtDate(l.date))}</b><span>${esc([l.duration_min && hours(l.duration_min), l.rewards_usd != null && usd(l.rewards_usd)].filter(Boolean).join(' · '))}</span></span>
    <span class="ls-rg"><b>${l.diamonds != null ? esc(int(l.diamonds)) : '—'}</b>${perHour(l) ? `<small>${esc(mil1(perHour(l)))}/h</small>` : ''}</span>
  </button>`

function renderLives(animate) {
  const view = document.getElementById('view')
  const { lives } = state.data
  const months = [...new Set([today().slice(0, 7), ...lives.map(l => l.date?.slice(0, 7)).filter(Boolean)])].sort()
  if (!months.includes(state.lmonth)) state.lmonth = months.at(-1)
  const i = months.indexOf(state.lmonth)
  const ym = state.lmonth
  const s = monthStats(lives, ym)
  // mês em andamento: compara com o mês anterior só até o mesmo dia (senão 1 dia de novembro vira "↓ 98%")
  const current = ym === today().slice(0, 7)
  const sameDay = current && i > 0
  const nowDay = new Date().getDate()
  const prev = i > 0 ? (sameDay ? monthStats(lives.filter(l => +l.date?.slice(8) <= nowDay), months[i - 1], true) : monthStats(lives, months[i - 1])) : null
  const mName = monthWord(ym), pName = prev ? monthWord(months[i - 1]) : ''
  const [y, m] = ym.split('-').map(Number)
  const nDays = new Date(y, m, 0).getDate()

  // calendário: quanto mais verde, mais diamantes no dia; o melhor dia em cobre
  const byDay = Array.from({ length: nDays }, (_, d) => sumOf(s.ls.filter(l => +l.date.slice(8) === d + 1), 'diamonds'))
  const top = Math.max(...byDay, 0)
  const topDay = byDay.indexOf(top) + 1
  const offset = new Date(y, m - 1, 1).getDay()   // semana começa no domingo
  const cal = `<div class="ls-cal">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<span class="h">${d}</span>`).join('')}${'<i class="x"></i>'.repeat(offset)}${byDay.map((v, d) => {
    const fut = current && d + 1 > nowDay
    const a = v && top ? 0.25 + v / top * 0.75 : 0
    const cls = fut ? 'fut' : !v ? 'off' : v === top ? 'max' : a > 0.62 ? 'hi' : ''
    return `<i class="${cls}${current && d + 1 === nowDay ? ' now' : ''}" style="--a:${a.toFixed(2)}"><b>${d + 1}</b></i>` }).join('')}</div>
    <div class="ls-leg"><span>menos ${[0.3, 0.55, 0.8, 1].map(a => `<i style="--a:${a}"></i>`).join('')} mais</span>${top ? `<span><i class="max"></i>melhor dia · ${String(topDay).padStart(2, '0')}/${String(m).padStart(2, '0')}</span>` : ''}</div>`

  const pct = (a, b) => (b ? Math.round((a - b) / b * 100) : null)
  // mês fechado com o resumo do TikTok: o que o resumo não traz (ex.: horas ao vivo) aparece como "—", e não como zero
  const has = k => !s.fromSummary || summaryOf(ym)?.[k] != null
  const usdM = has('rewards_usd') ? s.usd : null, minM = has('duration_min') ? s.min : null
  const gp = prev ? pct(s.gems, prev.gems) : null
  const pill = gp != null ? `<span class="ls-pill"><i>${gp >= 0 ? '↑' : '↓'} ${Math.abs(gp)}%</i>vs ${esc(pName)}${sameDay ? ` até dia ${nowDay}` : ''}</span>` : ''

  let body
  if (!s.ls.length) body = `<div class="lx-block">${empty('Nenhuma live neste mês.', 'lives')}</div>`
  else {
    const best = [...s.ls].sort((a, b) => (b.diamonds || 0) - (a.diamonds || 0))[0]
    const rows = [
      ['gem', 'Diamantes', s.gems, prev?.gems, compact, 'g'],
      ['usd', 'Recompensas', usdM, prev?.usd, usdK, 'c'],
      ['cal', 'Por dia de live', s.perDay, prev?.perDay, mil1, 'g'],
      ['clock', 'Por hora', s.perHour, prev?.perHour, mil1, 'g'],
      ['live', 'Por live', s.perLive, prev?.perLive, mil1, 'g'],
      ['clock', 'Ao vivo', minM, prev?.min, hours, 'g'],
    ]
    const cmp = rows.map(([icon, label, a, b, fmt, tone]) => {
      const p = a != null && b ? pct(a, b) : null
      return `<div class="nx-row"><span class="si ${tone}">${ic(icon)}</span><div><b>${esc(label)}</b>${prev ? `<small>${esc(pName)}: ${b ? esc(fmt(b)) : '—'}</small>` : ''}</div>
        <div class="nx-v"><b>${a == null ? '—' : esc(fmt(a))}</b>${p != null ? `<em class="${p >= 0 ? 'u' : 'd'}">${p >= 0 ? '↑' : '↓'} ${Math.abs(p)}%</em>` : ''}</div></div>`
    }).join('')
    // lista: por data (agrupada por semana), por diamantes ou por hora
    let list
    if (state.lsort === 'data') {
      const weeks = new Map()
      for (const l of s.ls) { const w = weekStartOf(new Date(`${l.date}T12:00`)); if (!weeks.has(w)) weeks.set(w, []); weeks.get(w).push(l) }
      list = [...weeks].map(([w, ls]) => {
        const a = new Date(`${w}T12:00`), b = new Date(a); b.setDate(a.getDate() + 6)
        const label = a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${monShort(b)}` : `${a.getDate()} ${monShort(a)} – ${b.getDate()} ${monShort(b)}`
        return `<div class="ls-wk"><b>${esc(label)}</b><span>${ls.length} ${ls.length === 1 ? 'live' : 'lives'} · ${esc(mil1(sumOf(ls, 'diamonds')))}</span></div><div class="ls-list">${ls.map(l => lsRow(l, best.id)).join('')}</div>`
      }).join('')
    } else {
      const sorted = state.lsort === 'diamantes' ? [...s.ls].sort((a, b) => (b.diamonds || 0) - (a.diamonds || 0)) : [...s.ls].sort((a, b) => perHour(b) - perHour(a))
      list = `<div class="ls-list" style="margin-top:12px">${sorted.map(l => lsRow(l, best.id)).join('')}</div>`
    }
    body = `
      <div class="lx-block"><div class="lx-row lx-h"><small>${prev ? `COMPARADO A ${esc(pName.toUpperCase())}` : 'O MÊS'}</small>${sameDay ? `<small>ATÉ DIA ${nowDay}</small>` : ''}</div>
        <div class="nx-card ls-cmp">${cmp}</div>
        ${s.fromSummary ? '<p class="ld-note">' + ic('cal') + '<span>Totais do resumo do TikTok (o mês inteiro); a lista mostra as lives registradas.</span></p>' : ''}</div>
      <div class="lx-block">
        <button type="button" class="ls-best" data-live="${best.id}" aria-label="Ver todos os dados da melhor live">
          <span class="ls-bh"><span class="ls-bi">${ic('trophy')}</span><span class="ls-bt"><small>MELHOR DO MÊS · ${esc(weekday(best.date).toUpperCase())} ${esc(dm(best.date))}</small><b>${esc(best.title || fmtDate(best.date))}</b></span><span class="ls-bgo">${ic('chev')}</span></span>
          <span class="ls-bk"><span><b>${esc(mil1(Number(best.diamonds) || 0))}</b><small>diamantes</small></span><span><b>${perHour(best) ? esc(mil1(perHour(best))) : '—'}</b><small>por hora</small></span><span><b>${best.new_followers != null ? `+${esc(int(best.new_followers))}` : '—'}</b><small>seguidores</small></span></span>
          <span class="ls-bmore">Ver todos os dados da live</span>
        </button>
      </div>
      <div class="lx-block"><div class="lx-row lx-h"><small>LIVES DO MÊS</small></div>
        <div class="ls-seg slider" role="group" aria-label="Ordenar" style="--n:3;--i:${state.lsortPrev ?? LSORT.indexOf(state.lsort)}">${[['data', 'Data'], ['diamantes', 'Diamantes'], ['hora', 'Por hora']].map(([k, l]) => `<button type="button" data-lsort="${k}" aria-pressed="${state.lsort === k}">${l}</button>`).join('')}</div>
        ${list}
      </div>`
  }

  const [mw, yw] = new Date(`${ym}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).split(' de ')
  view.innerHTML = `
    <div class="lx ls">
      <section class="lx-hero">
        <div class="lx-bar"><span>LIVES</span><button type="button" class="lx-prints" data-prints>${ic('cam')}Prints<i class="due" hidden></i></button></div>
        <div class="ls-month">
          <button type="button" data-month="-1" aria-label="Mês anterior" ${i === 0 ? 'disabled' : ''}>${ic('back')}</button>
          <div><b>${esc(cap(mw))} <em>${esc(yw)}</em></b><small>${s.ls.length} ${s.ls.length === 1 ? 'live' : 'lives'} · ${s.days} ${s.days === 1 ? 'dia' : 'dias'} de live</small></div>
          <button type="button" data-month="1" aria-label="Próximo mês" ${i === months.length - 1 ? 'disabled' : ''}>${ic('chev')}</button>
        </div>
        <div class="ls-big"><small>DIAMANTES EM ${esc(mName.toUpperCase())}</small><b>${esc(int(s.gems))}</b>${pill}</div>
        ${cal}
        <div class="lx-glass">
          <div><small><i>${ic('live')}</i>por live</small><b class="num">${s.perLive == null ? '—' : esc(mil1(s.perLive))}</b></div>
          <div><small><i>${ic('clock')}</i>por hora</small><b class="num">${s.perHour == null ? '—' : esc(mil1(s.perHour))}</b></div>
          <div><small><i>${ic('cal')}</i>ao vivo</small><b class="num">${minM == null ? '—' : esc(hours(minM))}</b></div>
        </div>
      </section>
      <section class="lx-sheet">${body}</section>
    </div>`
  view.querySelectorAll('[data-month]').forEach(b => b.addEventListener('click', () => {
    state.lmonth = months[i + Number(b.dataset.month)]
    renderLives()
  }))
  slideTo(view.querySelector('.ls-seg.slider'), LSORT.indexOf(state.lsort)); state.lsortPrev = null
  view.querySelectorAll('[data-lsort]').forEach(b => b.addEventListener('click', () => { state.lsortPrev = LSORT.indexOf(state.lsort); state.lsort = b.dataset.lsort; renderLives() }))
  view.querySelector('[data-live]')?.addEventListener('click', e => { state.liveId = e.currentTarget.dataset.live; go('live') })
  view.querySelector('[data-prints]').addEventListener('click', openPrints)
  updateDue()
  bindList(view)
  if (animate) reveal(view)
}

// ---------- Página da live (abre pelo cartão da melhor live do mês) ----------

function renderLive(animate) {
  const view = document.getElementById('view')
  const { lives, withdrawals } = state.data
  const l = lives.find(x => x.id === state.liveId)
  if (!l) return go('lives')
  const ym = l.date.slice(0, 7)
  const ml = lives.filter(x => x.date?.startsWith(ym))
  const rank = [...ml].sort((a, b) => (b.diamonds || 0) - (a.diamonds || 0)).findIndex(x => x.id === l.id) + 1
  const rate = payoutRate(withdrawals, state.rate?.commercial)?.rate
  const gems = Number(l.diamonds) || 0
  const ph = perHour(l)
  const n = v => (v == null ? null : Number(v))
  const dlong = new Date(`${l.date}T12:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).replace('-feira', '')
  const tag = `${weekday(l.date).toUpperCase()} · ${+l.date.slice(8)} ${monShort(new Date(`${l.date}T12:00`)).toUpperCase()}`
  const mName = monthWord(ym)

  // comparada à média do mês
  const avgPh = avgOf(ml.map(x => ({ v: perHour(x) })), 'v')
  const cmpRows = [
    ['gem', 'Diamantes', gems, avgOf(ml, 'diamonds'), mil1],
    ['clock', 'Por hora', ph, avgPh, mil1],
    ['cal', 'Duração', n(l.duration_min), avgOf(ml, 'duration_min'), v => hours(Math.round(v))],
    ['eye', 'Pico', n(l.peak_viewers), avgOf(ml, 'peak_viewers'), v => int(Math.round(v))],
    ['user', 'Seguidores', n(l.new_followers), avgOf(ml, 'new_followers'), v => '+' + int(Math.round(v))],
  ].filter(([, , a, b]) => a != null && a > 0 && b)
  const cmp = cmpRows.map(([icon, label, a, b, fmt]) => {
    const p = Math.round((a - b) / b * 100), mx = Math.max(a, b), up = p >= 0
    return `<div class="ls-cr"><div class="ls-crh"><span class="si g">${ic(icon)}</span><span class="ls-crl">${esc(label)}<small>média: ${esc(fmt(b))}</small></span><b>${esc(fmt(a))}</b><em class="${up ? 'u' : 'd'}">${up ? '↑' : '↓'} ${Math.abs(p)}%</em></div>
      <div class="ls-cb"><u style="width:${(b / mx * 100).toFixed(0)}%"></u><i class="${up ? '' : 'd'}" style="width:${(a / mx * 100).toFixed(0)}%"></i></div></div>`
  }).join('')
  const avgG = avgOf(ml, 'diamonds')
  const note = !ml.length || ml.length < 2 || !ph || !avgPh ? ''
    : gems >= avgG && ph < avgPh ? 'Rendeu mais no total, mas menos por hora: lives longas tendem a render menos por hora.'
      : gems >= avgG ? 'Acima da média do mês no total e por hora.'
        : ph >= avgPh ? 'Rendeu menos no total, mas mais por hora: foi uma live mais curta e forte.'
          : 'Abaixo da média do mês no total e por hora.'

  const tiles = list => list.filter(([, v]) => v != null && !Number.isNaN(v)).map(([label, v]) => `<div><small>${label}</small><b>${esc(v)}</b></div>`).join('')
  const pub = tiles([
    ['Visualizações', l.views != null ? mil1(l.views) : null], ['Espectadores', l.unique_viewers != null ? mil1(l.unique_viewers) : null], ['Ativos', l.active_viewers != null ? mil1(l.active_viewers) : null],
    ['Pico', l.peak_viewers != null ? int(l.peak_viewers) : null], ['Média ao vivo', l.avg_viewers != null ? int(l.avg_viewers) : null], ['Tempo médio', l.avg_watch_sec != null ? `${int(l.avg_watch_sec)} s` : null]])
  const eng = tiles([
    ['Curtidas', l.likes != null ? mil1(l.likes) : null], ['Comentários', l.comments != null ? mil1(l.comments) : null], ['Compartilha&shy;mentos', l.shares != null ? mil1(l.shares) : null],
    ['Presentea&shy;dores', l.gifters != null ? int(l.gifters) : null], ['💎 por presenteador', l.gifters ? int(Math.round(gems / l.gifters)) : null], ['💎 por espectador', l.unique_viewers ? dec(gems / l.unique_viewers, 2) : null]])

  // recompensa: a porcentagem da live pelas regras do TikTok
  const pctL = livePct(l.duration_min, l.new_followers)
  const base = pctL - ((l.new_followers ?? 0) >= 5 ? 2 : 0)
  const why = { 38: '38% por 25 min ou mais', 35: '35% por 10 min ou mais', 30: '30% por 5 min ou mais', 20: '20% (menos de 5 min)' }[base] + ((l.new_followers ?? 0) >= 5 ? ' + 2% por 5 novos seguidores' : '')
  const usdV = l.rewards_usd != null ? Number(l.rewards_usd) : gems * 0.01 * pctL / 100
  const same = l.title ? lives.filter(x => x.title === l.title) : []
  const sameBest = same.length ? Math.max(...same.map(x => Number(x.diamonds) || 0)) : 0

  view.innerHTML = `
    <div class="lx ls ld">
      <section class="lx-hero ld-hero">
        <div class="lx-bar"><button type="button" class="lx-prints" data-back>${ic('back')}Lives</button><span>${esc(tag)}</span></div>
        <div class="ld-title"><span class="ld-tag">${ic('trophy')}${rank === 1 ? `melhor live de ${esc(mName)} · 1ª de ${ml.length}` : `${rank}ª de ${ml.length} em ${esc(mName)}`}</span><h2>${esc(l.title || fmtDate(l.date))}</h2><p>${esc(dlong)}${l.duration_min ? ` · ${esc(hours(l.duration_min))} ao vivo` : ''}</p></div>
        <div class="ls-big"><small>DIAMANTES</small><b data-count>${esc(int(gems))}</b><span class="ld-money">≈ ${esc(usd(usdV))}${rate ? ` · ${esc(brl0(usdV * rate))}` : ''}</span></div>
        <div class="lx-glass">
          <div><small><i>${ic('clock')}</i>por hora</small><b class="num">${ph ? esc(mil1(ph)) : '—'}</b></div>
          <div><small><i>${ic('user')}</i>seguidores</small><b class="num">${l.new_followers != null ? `+${esc(int(l.new_followers))}` : '—'}</b></div>
          <div><small><i>${ic('eye')}</i>pico</small><b class="num">${l.peak_viewers != null ? esc(int(l.peak_viewers)) : '—'}</b></div>
        </div>
      </section>
      <section class="lx-sheet">
        ${cmp ? `<div class="lx-block"><div class="lx-row lx-h"><small>COMPARADA À MÉDIA DO MÊS</small><small>${ml.length} LIVES</small></div>
          <div class="nx-card">${cmp}</div>
          <div class="nb-leg"><span><u></u>média do mês</span><span><i></i>esta live</span></div>
          ${note ? `<p class="ld-note">${ic('clock')}<span>${note}</span></p>` : ''}</div>` : ''}
        ${pub ? `<div class="lx-block"><div class="lx-row lx-h"><small>PÚBLICO</small></div><div class="ls-c3">${pub}</div></div>` : ''}
        ${eng ? `<div class="lx-block"><div class="lx-row lx-h"><small>ENGAJAMENTO</small></div><div class="ls-c3 ld-eng">${eng}</div></div>` : ''}
        <div class="lx-block"><div class="lx-row lx-h"><small>RECOMPENSA DA LIVE</small></div>
          <div class="nx-card ld-rw">
            <div><span>Porcentagem</span><b>${pctL}%</b><small>${esc(why)}</small></div>
            <div><span>Em dólares</span><b>${esc(usd(usdV))}</b><small>${esc(int(gems))} diamantes × US$ 0,01 × ${pctL}%${l.rewards_usd != null && Math.abs(usdV - gems * 0.01 * pctL / 100) > 0.5 ? ' (valor do print)' : ''}</small></div>
            ${rate ? `<div><span>Em reais</span><b>≈ ${esc(brl0(usdV * rate))}</b><small>no dólar do último saque (${esc(brlRate(rate))})</small></div>` : ''}
          </div>
          <p class="ld-note">${ic('cal')}<span>Também conta para o semanal da semana (até 13% a mais).</span></p></div>
        ${same.length >= 2 ? `<div class="lx-block"><div class="lx-row lx-h"><small>ESSE TÍTULO</small></div>
          <div class="nx-card ld-tt"><span class="si g">${ic('live')}</span><div><b>${esc(l.title)}</b><small>${same.length} lives com esse título · média ${esc(mil1(avgOf(same, 'diamonds')))}</small></div>${gems === sameBest ? '<em>melhor</em>' : ''}</div></div>` : ''}
        <button type="button" class="ld-edit" data-edit="lives" data-id="${l.id}">${ic('pen')}Editar dados da live</button>
      </section>
    </div>`
  view.querySelector('[data-back]').addEventListener('click', () => go('lives'))
  bindList(view)
  if (animate) reveal(view)
}

// ---------- Estatísticas (abas Público / Engajamento / Ritmo) ----------

const stH = (t, side = '') => `<div class="lx-row lx-h"><small>${t}</small>${side ? `<small>${side}</small>` : ''}</div>`
// pílula de comparação ("↑ 6%"); vazia quando não há com o que comparar
const stPill = (cur, before) => { if (!before || cur == null) return ''; const p = Math.round((cur - before) / before * 100); return `<em class="${p >= 0 ? 'u' : 'd'}">${p >= 0 ? '↑' : '↓'} ${Math.abs(p)}%</em>` }
const stRow = (icon, label, sub, value, pill = '', tone = 'g') => `<div class="nx-row"><span class="si ${tone}">${ic(icon)}</span><div><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div><div class="nx-v"><b>${esc(value)}</b>${pill}</div></div>`
const stNote = (icon, html) => `<p class="ld-note">${ic(icon)}<span>${html}</span></p>`
const stEmpty = msg => `<div class="lx-block"><p class="st-empty">${esc(msg)}</p></div>`
// foguinho da sequência: fogo colorido (amarelo → laranja → vermelho) com miolo claro
const FLAME = `<svg class="st-flame" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="flo" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff4d2e"/><stop offset=".55" stop-color="#ff8a1f"/><stop offset="1" stop-color="#ffc24a"/></linearGradient><linearGradient id="fli" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffd25c"/><stop offset="1" stop-color="#fff6d6"/></linearGradient></defs><path fill="url(#flo)" stroke="none" d="M12.6 2.2c.5 3.1-1.3 4.8-2.9 6.6C8 10.7 6.2 12.6 6.2 15.5c0 3.5 2.6 6.3 5.9 6.3s5.9-2.6 5.9-6.3c0-2.5-1.1-4.4-2.4-6-.3 1.4-1 2.4-2.1 2.9.5-3.7-.4-7.4-1.9-10.2z"/><path fill="url(#fli)" stroke="none" d="M12.1 21.8c-1.9 0-3.3-1.4-3.3-3.3 0-2 1.3-3.1 2.3-4.5.3 1 .9 1.7 1.7 2 0-1.3.5-2.5 1.3-3.4 1 1.3 1.8 2.8 1.8 4.4 0 2.6-1.6 4.8-3.8 4.8z"/></svg>`

// sequência de dias com live (hoje ainda pode ter live, então a conta começa ontem se hoje não teve)
function streakCard(lives) {
  const days = new Set(lives.map(l => l.date))
  if (!days.size) return ''
  const ymd = d => d.toLocaleDateString('sv-SE')
  const d = new Date()
  const liveToday = days.has(ymd(d))
  if (!liveToday) d.setDate(d.getDate() - 1)
  let streak = 0
  while (days.has(ymd(d))) { streak++; d.setDate(d.getDate() - 1) }
  let best = 0, run = 0
  const all = [...days].sort()
  for (let i = 0; i < all.length; i++) {
    const gap = i ? (new Date(`${all[i]}T12:00`) - new Date(`${all[i - 1]}T12:00`)) / 864e5 : 1
    run = gap === 1 ? run + 1 : 1
    best = Math.max(best, run)
  }
  const cells = Array.from({ length: 14 }, (_, i) => {
    const x = new Date(); x.setDate(x.getDate() - 13 + i)
    const letter = x.toLocaleDateString('pt-BR', { weekday: 'narrow' }).toUpperCase()
    return `<span class="${days.has(ymd(x)) ? 'on' : ''} ${i === 13 ? 'now' : ''}" style="--i:${i}"><i></i>${letter}</span>`
  }).join('')
  const title = streak ? `${streak} ${streak === 1 ? 'dia seguido' : 'dias seguidos'} com live` : 'Nenhuma live ontem nem hoje'
  const sub = streak && streak >= best ? 'é o seu recorde! 🎉' : `${streak ? `faltam ${best - streak} pro` : 'seu'} recorde de ${best} ${best === 1 ? 'dia' : 'dias'}${liveToday ? '' : ' · hoje ainda não teve live'}`
  return `<div class="st-streak"><div class="st-sh"><span class="st-fl"><i class="st-glow"></i>${FLAME}</span><div><small>SEQUÊNCIA</small><b>${title}</b><span>${sub}</span></div></div><div class="st-days">${cells}</div></div>`
}

// Público: visualizações → espectadores → presenteadores → seguidores
function funnelCard(s, prev) {
  const f = st => { const t = k => sumOf(st.agg, k); return { views: t('views'), unique: t('unique_viewers'), gifters: t('gifters'), followers: t('new_followers'), gems: t('diamonds') } }
  const F = f(s)
  if (!F.views || !F.unique) return ''
  const P = prev ? f(prev) : {}
  const rows = [
    stRow('eye', 'Visualizações', 'total do mês', mil1(F.views), stPill(F.views, P.views)),
    stRow('user', 'Espectadores', `${dec(F.unique / F.views * 100, 0)}% das visualizações`, mil1(F.unique), stPill(F.unique, P.unique)),
    F.gifters ? stRow('gem', 'Presenteadores', `${dec(F.gifters / F.unique * 100)}% do público`, int(F.gifters), stPill(F.gifters / F.unique, P.unique ? P.gifters / P.unique : 0)) : '',
    stRow('heart', 'Novos seguidores', `${dec(F.followers / F.unique * 1000)} a cada mil espectadores`, '+' + int(F.followers), stPill(F.followers / F.unique, P.unique ? P.followers / P.unique : 0)),
  ].join('')
  return `<div class="lx-block">${stH('PÚBLICO', prev ? `VS ${esc(monthWord(prevYm(state.smonth)).toUpperCase())}` : '')}<div class="nx-card">${rows}</div>
    ${F.gifters ? stNote('gem', `Média de <b>${esc(int(Math.round(F.gems / F.gifters)))}</b> diamantes por presenteador.`) : ''}</div>`
}

// Vindos dos vídeos: quantas pessoas entraram na live depois de ver um vídeo seu
function videosCard(ym) {
  const a = summaryOf(ym)
  if (!a?.video_joined) return ''
  const b = summaryOf(prevYm(ym)) || {}
  const share = a.unique_viewers ? a.video_joined / a.unique_viewers * 100 : null
  return `<div class="lx-block">${stH('VINDOS DOS VÍDEOS', a.period ? `ATÉ ${esc(shortDate(`${a.period[1]}T12:00`))}` : '')}
    <div class="nx-card st-vid"><span class="si c">${ic('cam')}</span><div><b>${esc(int(a.video_joined))} pessoas</b><small>entraram na live depois de ver um vídeo seu${share != null ? ` · ${esc(dec(share, 1))}% do público do mês` : ''}</small></div>${stPill(a.video_joined, b.video_joined)}</div>
    ${stNote('live', share != null && share < 5 ? 'Quase todo o público chega pela entrega normal das lives. Postar com frequência pode trazer mais gente pelos vídeos.' : 'Os vídeos já trazem uma parte boa do público das lives.')}</div>`
}

// Seu público: gênero, idade e países do mês, comparados com o mês anterior
const COUNTRY = { Brazil: ['🇧🇷', 'Brasil'], Philippines: ['🇵🇭', 'Filipinas'], Italy: ['🇮🇹', 'Itália'], 'United Kingdom': ['🇬🇧', 'Reino Unido'], 'United States': ['🇺🇸', 'Estados Unidos'], Portugal: ['🇵🇹', 'Portugal'], Spain: ['🇪🇸', 'Espanha'], Mexico: ['🇲🇽', 'México'], Indonesia: ['🇮🇩', 'Indonésia'], Germany: ['🇩🇪', 'Alemanha'], France: ['🇫🇷', 'França'], Argentina: ['🇦🇷', 'Argentina'], Japan: ['🇯🇵', 'Japão'], Others: ['', 'Outros'] }
function audienceCard(ym) {
  const row = (state.data.summaries || []).find(r => r.month === ym)
  const a = row?.data
  if (!a || (a.female_pct == null && !a.ages && !a.countries)) return ''
  const b = summaryOf(prevYm(ym)) || {}
  const pName = monthWord(prevYm(ym))
  const pts = (cur, before) => {
    if (before == null || cur == null) return '<em></em>'
    const d = cur - before
    return d === 0 ? '<em>=</em>' : `<em class="${d > 0 ? 'up' : 'dn'}">${d > 0 ? '↑' : '↓'} ${Math.abs(d)} ${Math.abs(d) === 1 ? 'pt' : 'pts'}</em>`
  }
  const ages = AGE_ORDER.filter(k => a.ages?.[k] != null && a.ages[k] <= 100 && (k !== '13-17' || a.ages[k] > 0)).map(k => [k, a.ages[k]])
  const countries = mergeCountries([], (a.countries || []).map(([n, v]) => [n.replace(/^(?:[A-Z][A-Za-z]{0,2}\s)+(?=[A-Z][a-z])/, ''), v]))
  const topAge = Math.max(...ages.map(([, v]) => v), 1)
  const bc = Object.fromEntries(b.countries || [])
  const fd = b.female_pct != null ? a.female_pct - b.female_pct : 0
  return `<div class="lx-block">${stH('SEU PÚBLICO')}<div class="nx-card st-aud">
    ${a.female_pct != null ? `
    <div class="st-ah"><small>GÊNERO</small><span class="st-lg"><i class="f"></i>mulheres <i class="m"></i>homens</span></div>
    <div class="st-g"><i style="width:${a.female_pct}%">${a.female_pct}%</i><i style="width:${a.male_pct}%">${a.male_pct}%</i></div>
    ${b.female_pct != null ? `<p class="st-gc">${esc(pName)}: ${b.female_pct}% · ${b.male_pct}%${fd ? ` <em class="${fd > 0 ? 'up' : 'dn'}">${fd > 0 ? '↑' : '↓'} ${Math.abs(fd)} ${Math.abs(fd) === 1 ? 'pt' : 'pts'} mulheres</em>` : ''}</p>` : ''}` : ''}
    ${ages.length ? `<div class="st-ah"><small>IDADE</small><span>% do público</span></div>
    ${ages.map(([k, v]) => `<div class="cx-yr ${v === topAge ? 'cx-best' : ''}"><span>${k.replace('-', '–')}${b.ages?.[k] != null ? `<small>${esc(pName.slice(0, 3))}.: ${b.ages[k]}%</small>` : ''}</span><i><i style="width:${(v / topAge * 100).toFixed(1)}%"></i></i><b>${v}%</b></div>`).join('')}` : ''}
    ${countries.length ? `<div class="st-ah"><small>PAÍSES</small><span>${b.countries ? `vs ${esc(pName)}` : ''}</span></div>
    ${countries.map(([n, v]) => { const [flag, name] = COUNTRY[n] || ['', n]; return `<div class="st-c"><span>${flag ? flag + ' ' : ''}${esc(name)}</span><b>${v}%</b>${n === 'Others' ? '<em></em>' : pts(v, bc[n])}</div>` }).join('')}` : ''}
    <p class="st-foot">${ic('cal')}${a.period ? `Dados de ${esc(a.period[0].slice(8))} a ${esc(shortDate(`${a.period[1]}T12:00`))} · ` : ''}${ym === today().slice(0, 7) ? `print de ${esc(shortDate(row.updated_at))} · atualize toda semana` : `resumo de ${esc(monthWord(ym))}`}</p>
  </div></div>`
}

// Engajamento: a cada mil visualizações, por espectador e quanto vale cada mil visualizações
function engagementCard(s, prev, rate) {
  const f = st => {
    const t = k => sumOf(st.agg, k)
    const views = t('views'), unique = t('unique_viewers')
    return { views, com: views ? t('comments') / views * 1000 : null, sha: views ? t('shares') / views * 1000 : null,
      per: unique ? t('diamonds') / unique : null, mil: views && rate ? t('rewards_usd') * rate / views * 1000 : null }
  }
  const F = f(s)
  if (!F.views) return ''
  const P = prev ? f(prev) : {}
  const rows = [
    F.com != null && stRow('heart', 'Comentários', 'a cada mil visualizações', dec(F.com, 0), stPill(F.com, P.com)),
    F.sha != null && stRow('live', 'Compartilhamentos', 'a cada mil visualizações', dec(F.sha, 0), stPill(F.sha, P.sha)),
    F.per != null && stRow('gem', 'Diamantes por espectador', 'média do mês', dec(F.per, 2), stPill(F.per, P.per)),
    F.mil != null && stRow('usd', 'Cada mil visualizações', 'quanto rendeu em reais', brl0(F.mil), stPill(F.mil, P.mil), 'c'),
  ].filter(Boolean).join('')
  return `<div class="lx-block">${stH('ENGAJAMENTO', prev ? `VS ${esc(monthWord(prevYm(state.smonth)).toUpperCase())}` : '')}<div class="nx-card">${rows}</div></div>`
}

// Retenção: tempo médio assistido e pico médio
function retentionCard(s, prev, ym) {
  const cur = avgOf(s.agg, 'avg_watch_sec')
  if (!cur) return ''
  // resumo do mês e média das lives medem de jeitos diferentes: só compara igual com igual
  const before = prev ? avgOf(prev.agg, 'avg_watch_sec') : 0
  const mixed = prev && before && prev.fromSummary !== s.fromSummary
  const d = before && !mixed ? Math.round(cur - before) : null
  const pName = monthWord(prevYm(ym))
  const top = Math.max(cur, before) * 1.15
  const bar = (label, v, on) => `<div class="cx-yr ${on ? 'cx-cur' : ''}"><span>${esc(label)}</span><i><i style="width:${(v / top * 100).toFixed(1)}%"></i></i><b>${Math.round(v)} s</b></div>`
  const peak = avgOf(s.agg, 'peak_viewers'), pPeak = prev && !mixed ? avgOf(prev.agg, 'peak_viewers') : 0
  return `<div class="lx-block">${stH('RETENÇÃO')}<div class="nx-card st-ret">
    <div class="st-rh"><div><small>TEMPO MÉDIO ASSISTIDO</small><b>${Math.round(cur)} s</b></div>${d != null ? `<em class="${d >= 0 ? 'u' : 'd'}">${d >= 0 ? '↑' : '↓'} ${Math.abs(d)} s vs ${esc(pName)}</em>` : ''}</div>
    ${before ? bar(pName, before, false) : ''}${bar(monthWord(ym), cur, true)}
    ${peak ? `<div class="st-kv"><span>Pico médio por live</span><b>${esc(int(Math.round(peak)))}${pPeak ? ` <small>(${esc(pName.slice(0, 3))}.: ${esc(int(Math.round(pPeak)))})</small>` : ''}</b></div>` : ''}
  </div>${mixed ? stNote('cal', `${esc(cap(monthWord(s.fromSummary ? ym : prevYm(ym))))} vem do resumo do mês do TikTok, que mede o tempo médio de um jeito diferente da média das lives.`) : s.fromSummary ? stNote('cal', 'Do resumo do mês do TikTok.') : ''}</div>`
}

// média de diamantes por live em cada dia da semana (todas as lives), de domingo a sábado
function weekdayCard(lives) {
  const ls = lives.filter(l => l.date && Number(l.diamonds) > 0)
  if (ls.length < 5) return ''
  const names = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
  const avg = [0, 1, 2, 3, 4, 5, 6].map(d => {
    const g = ls.filter(l => new Date(`${l.date}T12:00`).getDay() === d)
    return { d, n: g.length, v: g.length ? sumOf(g, 'diamonds') / g.length : 0 }
  })
  const best = avg.reduce((a, b) => (b.v > a.v ? b : a))
  return `<div class="lx-block">${stH('MELHOR DIA DA SEMANA', 'MÉDIA POR LIVE')}<div class="nx-card st-chart">
    <div class="st-wk">${avg.map((a, k) => `<div class="${a === best ? 'wk-top' : ''}" style="--i:${k}"><b>${a.v ? esc(compactK(a.v)) : ''}</b><i style="height:${(a.v / best.v * 100).toFixed(1)}%"></i><span>${names[a.d][0]}</span></div>`).join('')}</div>
    ${stNote('trophy', `<b>${names[best.d]}</b> rende mais: média de <b>${esc(mil1(best.v))}</b> diamantes por live.`)}</div></div>`
}
const compactK = v => (v >= 1e6 ? `${dec(v / 1e6, 1)}M` : `${int(Math.round(v / 1e3))}K`)

// diamantes por hora de acordo com o tamanho da live
function durationCard(lives) {
  const ls = lives.filter(l => Number(l.duration_min) > 0 && Number(l.diamonds) > 0)
  if (ls.length < 5) return ''
  const groups = [['Até 1h', 0, 60], ['1h a 2h', 60, 120], ['2h a 3h', 120, 180], ['Mais de 3h', 180, 1e9]].map(([label, a, b]) => {
    const g = ls.filter(l => l.duration_min > a && l.duration_min <= b)
    const h = sumOf(g, 'duration_min') / 60
    return { label, n: g.length, v: h ? sumOf(g, 'diamonds') / h : 0 }
  }).filter(g => g.n)
  const best = groups.reduce((a, b) => (b.v > a.v ? b : a))
  return `<div class="lx-block">${stH('DURAÇÃO IDEAL', 'DIAMANTES POR HORA')}<div class="nx-card st-chart">
    ${groups.map(g => `<div class="cx-yr ${g === best ? 'cx-best' : ''}"><span>${g.label}<small>${g.n} ${g.n === 1 ? 'live' : 'lives'}</small></span><i><i style="width:${(g.v / best.v * 100).toFixed(1)}%"></i></i><b>${esc(mil1(g.v))}/h</b></div>`).join('')}
    ${stNote('clock', `Lives de <b>${best.label.toLowerCase()}</b> rendem mais diamantes por hora.`)}</div></div>`
}

// títulos usados mais de uma vez, pela média de diamantes por live
function titlesCard(lives) {
  const by = new Map()
  for (const l of lives) if (l.title && Number(l.diamonds) > 0) by.set(l.title, [...(by.get(l.title) || []), l])
  const rows = [...by].filter(([, g]) => g.length > 1).map(([t, g]) => ({ t, n: g.length, avg: sumOf(g, 'diamonds') / g.length, best: Math.max(...g.map(l => Number(l.diamonds))) }))
    .sort((a, b) => b.avg - a.avg).slice(0, 5)
  if (rows.length < 2) return ''
  return `<div class="lx-block">${stH('TÍTULOS CAMPEÕES', 'MÉDIA POR LIVE')}<div class="nx-card st-rk">${rows.map((r, i) => `
    <div class="rk"><span class="pos ${i === 0 ? 'g' : ''}">${i + 1}º</span><div class="t"><b>${esc(r.t)}</b><span>${r.n} lives · melhor ${esc(mil1(r.best))}</span></div><b>${esc(mil1(r.avg))}</b></div>`).join('')}</div></div>`
}

// recordes desde que as lives são registradas no app
function recordsCard(lives) {
  const top = k => lives.filter(l => Number(l[k]) > 0).reduce((a, l) => (!a || Number(l[k]) > Number(a[k]) ? l : a), null)
  const byMonth = {}
  for (const l of lives) if (l.date) byMonth[l.date.slice(0, 7)] = (byMonth[l.date.slice(0, 7)] || 0) + (Number(l.diamonds) || 0)
  for (const r of state.data.summaries || []) if (r.data?.diamonds) byMonth[r.month] = Math.max(byMonth[r.month] || 0, r.data.diamonds)
  const bestMonth = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0]
  const days = [...new Set(lives.map(l => l.date).filter(Boolean))].sort()
  let best = 0, run = 0, bestEnd = null
  days.forEach((d, i) => {
    run = i && (new Date(`${d}T12:00`) - new Date(`${days[i - 1]}T12:00`)) / 864e5 === 1 ? run + 1 : 1
    if (run > best) { best = run; bestEnd = d }
  })
  const fresh = d => d && (Date.now() - new Date(`${d}T12:00`)) / 864e5 <= 7
  const when = d => `${shortDate(`${d}T12:00`)}${fresh(d) ? ' · novo recorde' : ''}`
  const gem = top('diamonds'), fol = top('new_followers'), peak = top('peak_viewers')
  const rows = [
    gem && stRow('trophy', 'Maior live', when(gem.date), mil1(Number(gem.diamonds)), '', fresh(gem.date) ? 'c' : 'g'),
    fol && stRow('user', 'Mais seguidores numa live', when(fol.date), '+' + int(fol.new_followers), '', fresh(fol.date) ? 'c' : 'g'),
    peak && stRow('eye', 'Maior pico', when(peak.date), int(peak.peak_viewers), '', fresh(peak.date) ? 'c' : 'g'),
    bestMonth && bestMonth[1] && stRow('cal', 'Melhor mês', new Date(`${bestMonth[0]}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), compact(bestMonth[1])),
    best > 1 && stRow('flame', 'Maior sequência', `até ${new Date(`${bestEnd}T12:00`).toLocaleDateString('pt-BR')}`, `${best} dias`),
  ].filter(Boolean)
  if (!rows.length) return ''
  return `<div class="lx-block">${stH('RECORDES')}<div class="nx-card">${rows.join('')}</div>${stNote('trophy', 'Recordes desde que você começou a registrar as lives no app.')}</div>`
}

const STABS = [['pub', 'Público'], ['eng', 'Engajamento'], ['rit', 'Ritmo']]
function statsPane(tab, s, prev, rate) {
  const { lives } = state.data
  const parts = tab === 'pub' ? [funnelCard(s, prev), videosCard(state.smonth), audienceCard(state.smonth)]
    : tab === 'eng' ? [engagementCard(s, prev, rate), retentionCard(s, prev, state.smonth)]
      : [weekdayCard(lives), durationCard(lives), titlesCard(lives), recordsCard(lives)]
  const html = parts.filter(Boolean).join('')
  return html || stEmpty(tab === 'rit' ? 'Registre pelo menos 5 lives para ver o seu ritmo.' : 'Mande os prints do resumo do mês (Overview e Viewer insights) ou registre lives com os prints para ver estes números.')
}

// número que conta do zero até o valor, já no formato curto (ex.: 2,77M)
function countFmt(el, target, fmt) {
  if (!el || !target || still()) return
  const t0 = performance.now(), dur = 1300
  const step = t => { const k = Math.min((t - t0) / dur, 1); el.textContent = fmt(target * (1 - (1 - k) ** 4)); if (k < 1) requestAnimationFrame(step) }
  requestAnimationFrame(step)
}

function renderStats(animate) {
  const view = document.getElementById('view')
  const { lives, withdrawals } = state.data
  const current = today().slice(0, 7)
  const months = [...new Set([current, ...lives.map(l => l.date?.slice(0, 7)).filter(Boolean)])].sort()
  if (!months.includes(state.smonth)) state.smonth = current
  const i = months.indexOf(state.smonth)
  const ym = state.smonth
  const s = monthStats(lives, ym)
  const prev = i > 0 ? monthStats(lives, months[i - 1]) : null
  const rate = payoutRate(withdrawals, state.rate?.commercial)?.rate ?? null
  const tab = state.stab || 'pub'

  // projeção (mês em andamento) ou como o mês fechou
  const isCur = ym === current
  const [y, m] = ym.split('-').map(Number)
  const nDays = new Date(y, m, 0).getDate(), day = new Date().getDate()
  const total = isCur ? s.gems / day * nDays : s.gems
  const totalUsd = total * 0.01 * 0.51
  const mName = monthWord(ym), next = monthWord(ymOf(new Date(y, m, 15))).slice(0, 3)
  const pg = prev?.gems ? Math.round((s.gems - prev.gems) / prev.gems * 100) : null
  const brlK = v => (v >= 1e6 ? `R$ ${dec(v / 1e6, 2)}M` : v >= 1e3 ? `R$ ${dec(v / 1e3, 1).replace(/,0$/, '')}K` : brl0(v))
  const [mw, yw] = new Date(`${ym}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).split(' de ')

  view.innerHTML = `
    <div class="lx ls st">
      <section class="lx-hero">
        <div class="lx-bar"><span>ESTATÍSTICAS</span><button type="button" class="lx-prints" data-prints>${ic('cam')}Prints<i class="due" hidden></i></button></div>
        <div class="ls-month">
          <button type="button" data-smonth="-1" aria-label="Mês anterior" ${i === 0 ? 'disabled' : ''}>${ic('back')}</button>
          <div><b>${esc(cap(mw))} <em>${esc(yw)}</em></b><small>${s.ls.length} ${s.ls.length === 1 ? 'live' : 'lives'} · ${s.days} ${s.days === 1 ? 'dia' : 'dias'} de live</small></div>
          <button type="button" data-smonth="1" aria-label="Próximo mês" ${i === months.length - 1 ? 'disabled' : ''}>${ic('chev')}</button>
        </div>
        <div class="ls-big"><small>${esc(mName.toUpperCase())} ${isCur ? 'DEVE FECHAR COM' : 'FECHOU COM'}</small><b data-proj>${total ? esc(compact(total)) : '—'}</b>
          ${isCur && total ? `<span class="ls-pill"><i>dia ${day} de ${nDays}</i>no ritmo de hoje</span>` : pg != null ? `<span class="ls-pill"><i>${pg >= 0 ? '↑' : '↓'} ${Math.abs(pg)}%</i>vs ${esc(monthWord(months[i - 1]))}</span>` : ''}</div>
        ${isCur && total ? `<div class="st-prog"><i style="width:${(s.gems / total * 100).toFixed(1)}%"></i><u style="left:${(s.gems / total * 100).toFixed(1)}%"></u></div>
        <div class="st-progl"><span>${esc(compact(s.gems))} até agora</span><span>+${esc(compact(total - s.gems))} previstos</span></div>` : ''}
        <div class="lx-glass">
          <div><small><i>${ic('usd')}</i>em dólares</small><b class="num">${total ? esc(usdK(totalUsd)) : '—'}</b></div>
          <div><small><i>${ic('bank')}</i>em reais</small><b class="num">${total && rate ? esc(brlK(totalUsd * rate)) : '—'}</b></div>
          <div><small><i>${ic('shield')}</i>limite ${esc(next)}.</small><b class="num">${total ? esc(compactUsd(limitFor(totalUsd).tier[1])) : '—'}</b></div>
        </div>
      </section>
      <section class="lx-sheet">
        ${lives.length ? `<div class="lx-block">${streakCard(lives)}</div>` : ''}
        <div class="lx-block st-tabs"><div class="ls-seg slider" role="group" aria-label="Assunto" style="--n:3;--i:${STABS.findIndex(([k]) => k === tab)}">${STABS.map(([k, l]) => `<button type="button" data-stab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div></div>
        <div data-stpane>${statsPane(tab, s, prev, rate)}</div>
      </section>
    </div>`
  view.querySelectorAll('[data-smonth]').forEach(b => b.addEventListener('click', () => {
    state.smonth = months[i + Number(b.dataset.smonth)]
    renderStats()
  }))
  const seg = view.querySelector('.ls-seg')
  view.querySelectorAll('[data-stab]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.stab === state.stab) return
    state.stab = b.dataset.stab
    view.querySelectorAll('[data-stab]').forEach(x => x.setAttribute('aria-pressed', x === b))
    slideTo(seg, STABS.findIndex(([k]) => k === state.stab))
    const pane = view.querySelector('[data-stpane]')
    pane.innerHTML = statsPane(state.stab, s, prev, rate)
    bindList(pane); reveal(pane)
  }))
  view.querySelector('[data-prints]').addEventListener('click', openPrints)
  updateDue()
  bindList(view)
  if (animate) { reveal(view); countFmt(view.querySelector('[data-proj]'), total, compact) }
}

// ---------- Recompensas ----------

const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
const pct = v => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v)}%`
const usd0 = v => 'US$ ' + new Intl.NumberFormat('pt-BR').format(v)
const num = v => Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0
const shortDate = d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const METHOD = { payoneer: 'Payoneer', pix: 'Pix' }
const BANK = { inter: 'Inter', nubank: 'Nubank' }
const SUB_TABS = { saldo: 'Saldo', missoes: 'Missões', limite: 'Limite', regras: 'Regras' }

async function loadSettings() {
  const { data } = await sb.from('settings').select('*').maybeSingle()
  return (state.data.settings = data || { daily_limit_usd: 5000 })
}

function renderRewards(animate) {
  const view = document.getElementById('view')
  updateDue()

  const L = ledger(state.data)
  const payout = payoutRate(state.data.withdrawals, state.rate?.commercial)
  const ctx = { L, payout, rate: payout?.rate }
  view.innerHTML = `
    <div class="seg slider" role="tablist" style="--n:4;--i:${state.rtabPrev ?? Object.keys(SUB_TABS).indexOf(state.rtab)}">${Object.entries(SUB_TABS).map(([id, label]) =>
      `<button role="tab" data-rtab="${id}" aria-selected="${state.rtab === id}">${label}</button>`).join('')}</div>
    <div id="rpanel" class="panel">${{ saldo: saldoPanel, missoes: missoesPanel, limite: limitePanel, regras: regrasPanel }[state.rtab](ctx)}</div>`
  view.querySelector('.seg').addEventListener('click', ev => {
    const b = ev.target.closest('[data-rtab]')
    if (!b || b.dataset.rtab === state.rtab) return
    state.rtabPrev = Object.keys(SUB_TABS).indexOf(state.rtab)
    state.rtab = b.dataset.rtab
    renderRewards(true)
  })
  slideTo(view.querySelector('.seg.slider'), Object.keys(SUB_TABS).indexOf(state.rtab)); state.rtabPrev = null
  ;({ saldo: bindSaldo, missoes: bindMissoes, limite: bindLimite, regras: () => {} })[state.rtab](view, ctx)
  if (animate) reveal(view)
}

const noPrint = () => `
  <div class="empty"><p class="muted">Mande o print de <b>Upcoming rewards</b> (Content rewards) para o app saber o seu saldo.</p>
  <button class="btn primary" type="button" data-open-prints>Mandar prints</button></div>`

const got = w => (w.amount_usd - WITHDRAW_FEE_USD) * w.rate_brl

function saldoPanel({ L, payout, rate }) {
  const wds = state.data.withdrawals
  const ym = today().slice(0, 7)
  const earned = monthEarned(state.data, ym)
  const fromLives = sumOf(state.data.lives.filter(l => l.date?.startsWith(ym)), 'rewards_usd')
  const received = wds.filter(w => w.date?.startsWith(ym)).reduce((a, w) => a + got(w), 0)
  const last = wds[0]
  const lastRate = last?.rate_brl ?? (rate ? rate.toFixed(4) : '')
  const via = last?.method || 'payoneer', bank = last?.bank || 'inter'
  const entries = [
    ...(L.credit ? [{ when: L.credit.at, label: `Semanal ${shortDate(`${L.credit.week}T12:00`)}`, usd: L.credit.usd }] : []),
    ...state.data.lives.filter(l => l.rewards_usd != null).slice(0, 5).map(l => ({ when: new Date(`${l.date}T12:00`), label: `Live · ${shortDate(`${l.date}T12:00`)}`, usd: l.rewards_usd })),
  ].sort((a, b) => b.when - a.when).slice(0, 6)
  const r = reportData(wds)
  const seg = (name, opts, on) => `<div class="seg2 slider" data-pick="${name}" style="--n:2;--i:${Object.keys(opts).indexOf(on)}">${Object.entries(opts).map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${k === on}">${l}</button>`).join('')}</div>`
  return `
    <div class="feature hero">${rain(NOTE)}
      <div class="k"><i>${ic('usd')}</i>Saldo de ${esc(monthWord(ym))}${rate ? `<em>US$ 1 = ${esc(brlRate(rate))}</em>` : ''}</div>
      <div class="big num" data-count>${rate ? esc(brl0(earned * rate)) : esc(usd(earned))}</div>
      <div class="sub"><span class="num">${esc(usd(earned))}</span> em recompensas no mês${rate ? ' · estimado em reais' : ''}</div>
      <div class="kpis"><div><span>Nas lives</span><b>${esc(usd0(Math.round(fromLives)))}</b></div><div><span>Semanais</span><b>${esc(usd0(Math.round(earned - fromLives)))}</b></div><div><span>Já sacado</span><b>${esc(brl0(received))}</b></div></div>
    </div>

    ${L.snap ? sec('Na conta agora', `<div class="quad">
      ${qcell('usd', 'Disponível', usd(L.available), '', rate ? `≈ ${brl(Math.max(L.available - WITHDRAW_FEE_USD, 0) * rate)}` : '', true)}
      ${qcell('cal', 'A receber', usd(L.upcoming.usd), '', `cai seg. ${shortDate(weekEndOf(L.current))} à 1h · ${pct(L.upcoming.pct)}`)}
    </div>`, `<span>print de ${esc(shortDate(L.snap.taken_at))}</span>`) : noPrint()}

    ${sec('Registrar saque', `
    <form class="form" id="w-form">
      <div class="opt"><span>Saque via</span>${seg('method', METHOD, via)}</div>
      <div class="opt"><span>Caiu no</span>${seg('bank', BANK, bank)}</div>
      <input type="hidden" name="method" value="${via}"><input type="hidden" name="bank" value="${bank}">
      <div class="grid">
        <label class="field" for="w-amount"><span>Sacado no TikTok (US$)</span><input id="w-amount" name="amount" type="text" inputmode="decimal" placeholder="0,00" required></label>
        <label class="field" for="w-rate"><span id="w-rate-lbl">${via === 'pix' ? 'Cotação do Pix' : 'Dólar no Payoneer'}</span><input id="w-rate" name="rate" type="text" inputmode="decimal" value="${esc(String(lastRate).replace('.', ','))}" required></label>
      </div>
      <label class="field" for="w-date"><span>Data</span><input id="w-date" name="date" type="date" value="${today()}"></label>
      <div class="sum"><div><span>Taxa do TikTok</span><b>− US$ 3,00</b></div><div><span>Cai na sua conta</span><b class="acc" id="w-total">R$ 0,00</b></div></div>
      <p class="hint" id="w-warn"></p>
      <button class="btn primary" type="submit">Registrar saque</button>
    </form>`)}

    ${sec(r ? `Saques de ${esc(monthWord(r.ym))}` : 'Saques', r ? `<div class="group">
      ${r.ws.slice().reverse().map(w => `<button type="button" class="lv" data-withdrawal="${w.id}">
        <span class="dt"><b>${esc(w.date.slice(8))}</b><small>${esc(weekday(w.date))}</small></span>
        <div class="t"><b>${esc(METHOD[w.method] || 'Payoneer')} <span class="bk" style="display:inline">→ ${esc(BANK[w.bank] || 'Inter')}</span></b><span class="num">${esc(usd0(Math.round(w.amount_usd)))} × ${esc(dec(Number(w.rate_brl), 4))}</span></div>
        <b class="g">${esc(brl0(got(w)))}</b></button>`).join('')}
      <div class="wfoot"><div><span>Recebido no mês</span><b>${esc(brl(r.total))}</b><small>${r.ws.length} ${r.ws.length === 1 ? 'saque' : 'saques'}</small></div><button type="button" data-report>${ic('text')}Relatório</button></div>
    </div>` : '<p class="muted small" style="padding:0 6px">Nenhum saque registrado.</p>',
      r && r.months.length > 1 ? `<span class="wmonth"><button type="button" data-wmonth="-1" aria-label="Mês anterior" ${r.i === 0 ? 'disabled' : ''}>${ic('back')}</button><button type="button" data-wmonth="1" aria-label="Próximo mês" ${r.i === r.months.length - 1 ? 'disabled' : ''}>${ic('chev')}</button></span>` : '')}

    ${entries.length ? sec('Últimas entradas', `<div class="card">${entries.map(e => `<div class="row"><span>${esc(e.label)}</span><b class="up num">+${esc(usd(e.usd))}</b></div>`).join('')}</div>`) : ''}`
}

// Relatório do mês: só os rendimentos, em reais (para o contador fazer o DAS)
function reportData(wds) {
  const months = [...new Set(wds.map(w => w.date?.slice(0, 7)).filter(Boolean))].sort()
  if (!months.length) return null
  if (!months.includes(state.wmonth)) state.wmonth = months.at(-1)
  const ws = wds.filter(w => w.date?.startsWith(state.wmonth)).sort((a, b) => a.date.localeCompare(b.date))
  const total = ws.reduce((a, w) => a + got(w), 0)
  const text = `Olá, segue o relatório atualizado do mês.\n📊 Rendimentos de ${monthWord(state.wmonth)}: ${brl(total)}`
  return { ym: state.wmonth, months, i: months.indexOf(state.wmonth), ws, total, text }
}

function openReport() {
  const { text, ym } = reportData(state.data.withdrawals)
  sheet.innerHTML = `
    <div class="sheet-body">
      <div class="sheet-head"><span></span><strong>Relatório de ${esc(monthWord(ym))}</strong><button type="button" class="link" data-close>OK</button></div>
      <p class="muted small" style="text-align:center">Texto pronto pra mandar no WhatsApp do contador</p>
      <pre class="wa">${esc(text)}</pre>
      <button class="btn primary" type="button" data-copy>${ic('copy')}Copiar texto</button>
    </div>`
  sheet.querySelector('[data-close]').addEventListener('click', closeSheet)
  sheet.querySelector('[data-copy]').addEventListener('click', async ev => {
    try {
      await navigator.clipboard.writeText(text)
      ev.currentTarget.innerHTML = `${ic('copy')}Copiado!`
    } catch {
      // sem acesso à área de transferência: seleciona o texto para copiar na mão
      getSelection().selectAllChildren(sheet.querySelector('.wa'))
      toast('Toque em Copiar no texto selecionado')
    }
  })
  sheet.showModal()
  document.activeElement?.blur()
}

function bindSaldo(view, { L }) {
  view.querySelectorAll('[data-wmonth]').forEach(b => b.addEventListener('click', () => {
    const r = reportData(state.data.withdrawals)
    state.wmonth = r.months[r.i + Number(b.dataset.wmonth)]
    renderRewards(false)
  }))
  view.querySelector('[data-report]')?.addEventListener('click', openReport)
  view.querySelector('[data-open-prints]')?.addEventListener('click', openPrints)
  const form = view.querySelector('#w-form')
  const calc = () => {
    const amount = num(form.amount.value)
    const rate = num(form.rate.value)
    const pix = form.method.value === 'pix'
    view.querySelector('#w-total').textContent = brl(Math.max(amount - WITHDRAW_FEE_USD, 0) * rate)
    const limit = currentLimit().usd
    view.querySelector('#w-warn').textContent =
      amount && amount < 9 ? 'O saque mínimo é US$ 9.'
      : pix && !amount ? 'Pelo Pix o saque mínimo é US$ 9'
      : amount > limit ? `Seu limite é ${usd0(limit)} por dia.`
      : L.snap && form.date.value >= L.snap.taken_at.slice(0, 10) && amount > L.available + 0.005 ? `Mais do que o disponível (${usd(L.available)}).` : ''
  }
  // Payoneer ou Pix, Inter ou Nubank
  form.querySelectorAll('[data-pick]').forEach(g => g.addEventListener('click', ev => {
    const b = ev.target.closest('[data-v]')
    if (!b) return
    g.querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', x === b))
    g.style.setProperty('--i', [...g.querySelectorAll('[data-v]')].indexOf(b))
    form[g.dataset.pick].value = b.dataset.v
    if (g.dataset.pick === 'method') view.querySelector('#w-rate-lbl').textContent = b.dataset.v === 'pix' ? 'Cotação do Pix' : 'Dólar no Payoneer'
    calc()
  }))
  form.addEventListener('input', calc)
  form.date.addEventListener('change', calc)
  calc()
  form.addEventListener('submit', async ev => {
    ev.preventDefault()
    const amount = num(form.amount.value)
    const rate = num(form.rate.value)
    if (amount < 9) return toast('O saque mínimo é US$ 9.')
    if (!rate) return toast('Coloque a cotação do dólar.')
    const date = form.date.value || today()
    const btn = form.querySelector('[type=submit]')
    if (btn.disabled) return
    btn.disabled = true
    const row = { amount_usd: amount, rate_brl: rate, date, method: form.method.value, bank: form.bank.value }
    let { error } = await sb.from('withdrawals').insert(row)
    // banco ainda sem as colunas novas (migração 004): salva sem a forma e o banco
    if (error && /method|bank/.test(error.message)) ({ error } = await sb.from('withdrawals').insert({ amount_usd: amount, rate_brl: rate, date }))
    if (error) { btn.disabled = false; return toast('Erro ao registrar: ' + error.message) }
    state.wmonth = date.slice(0, 7)   // a lista mostra o mês do saque que acabou de entrar
    checkmark(btn)
    toast('Saque registrado')
    setTimeout(() => reload('rewards'), still() ? 0 : 700)
  })
  view.querySelectorAll('[data-withdrawal]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Excluir este saque?')) return
    const { error } = await sb.from('withdrawals').delete().eq('id', b.dataset.withdrawal)
    if (error) return toast('Erro ao excluir: ' + error.message)
    toast('Saque excluído')
    reload('rewards')
  }))
}

function missoesPanel({ L, rate }) {
  const days = weekDays(L.current)
  const minutesByDay = Object.fromEntries(days.map(d => [d, 0]))
  for (const l of L.weekLives) if (l.date in minutesByDay) minutesByDay[l.date] += Number(l.duration_min) || 0
  const valid = days.filter(d => minutesByDay[d] >= 25).length
  const snapThisWeek = L.snap && (L.snap.week_start || '') === L.current ? L.snap : null
  const last = state.data.lives[0]
  const lp = last ? livePct(last.duration_min, last.new_followers) : 0
  const endLabel = shortDate(`${days[6]}T12:00`)
  const letters = days.map(d => new Date(`${d}T12:00`).toLocaleDateString('pt-BR', { weekday: 'narrow' }).toUpperCase())
  const ld = snapThisWeek?.league_days ?? 0
  return `
    <div class="feature">
      <div class="k"><i>${ic('cal')}</i>Semana de ${esc(days[0].slice(5, 7) === days[6].slice(5, 7) ? days[0].slice(8) : shortDate(`${days[0]}T12:00`))} a ${esc(endLabel)}<em>${L.snap ? `${pct(L.upcoming.pct)} de 13%` : 'sem print'}</em></div>
      <div class="ringrow"><div><div class="big num">${L.snap ? esc(usd(L.upcoming.usd)) : '—'}</div>
        <div class="sub">${L.snap ? `<span class="num">${esc(int(L.upcoming.gems))}</span> diamantes · ${L.upcoming.fromPrint ? `do print de ${esc(shortDate(L.snap.taken_at))}` : `estimativa com ${pct(L.upcoming.pct)}`}` : 'Mande o print de Upcoming rewards'}</div></div>
        ${L.snap ? ring(L.upcoming.pct / 13 * 100, pct(L.upcoming.pct), 'de 13%') : ''}</div>
    </div>

    ${sec('Dias válidos de live', `<div class="card"><div class="days">${days.map((d, k) => `<i class="${minutesByDay[d] >= 25 ? 'on' : ''}" title="${d}">${letters[k]}</i>`).join('')}</div>
      <div class="row"><span>Dia com 25 min ou mais · 2 dias = 8%</span><em>+${daysPct(valid)}%</em></div></div>`)}

    ${sec(`Manter liga ${esc(L.snap?.league || 'A1')}`, `<div class="card"><div class="days">${[1, 2, 3, 4, 5, 6, 7].map(d => `<button type="button" data-mld="${d}" class="${d <= ld ? 'on' : ''}" aria-label="${d} de 7 dias" ${snapThisWeek ? '' : 'disabled'}>${d}</button>`).join('')}</div>
      <div class="row"><span>${snapThisWeek?.league_days != null ? 'Toque para corrigir os dias' : snapThisWeek ? 'Toque no último dia mantido' : 'Atualiza com o print de domingo'}</span><em>${snapThisWeek?.league_days != null ? '+1%' : '—'}</em></div>
      <p class="muted small">Manter A1–A3 a semana toda = 1%, superar a melhor liga = 3%.</p></div>`)}

    ${sec('Outras', `<div class="card">
      <div class="row"><span>Fãs ativos · 10+ / 25+ / 100+</span><em>${snapThisWeek?.fans_done ? 'concluída' : '—'}</em></div>
      ${last ? `<div class="mission"><div class="row"><b>Última live · ${esc(shortDate(`${last.date}T12:00`))}</b><em>${lp}%</em></div>
        <div class="ladder">${[
          ['5 min ou mais', '30%', last.duration_min >= 5],
          ['10 min ou mais', '35%', last.duration_min >= 10],
          ['25 min ou mais', '38%', last.duration_min >= 25],
          [`5 novos seguidores (fez ${int(last.new_followers ?? 0)})`, '+2%', (last.new_followers ?? 0) >= 5],
        ].map(([what, p, done]) => `<div class="step ${done ? 'done' : ''}"><span class="dot">${done ? CHECK : ''}</span><span>${esc(what)}</span><b>${p}</b></div>`).join('')}</div>
        ${last.diamonds ? `<div class="row"><span class="num">${esc(int(last.diamonds))} × US$ 0,01 × ${lp}%</span><b class="num">${esc(usd(last.diamonds * 0.01 * lp / 100))}</b></div>` : ''}</div>` : ''}
    </div>`)}

    ${sec('Simulador', `<div class="form">
      <label class="field" for="sim-gems"><span>Se a próxima live fizer quantos diamantes?</span><input id="sim-gems" type="number" inputmode="numeric" min="0" value="80000"></label>
      <div class="row"><span>Na live (40%)</span><b class="num" id="sim-live">US$ 0,00</b></div>
      <div class="row"><span>A mais no semanal</span><b class="num" id="sim-week">US$ 0,00</b></div>
      <div class="row"><span>Total em reais</span><b class="num acc" id="sim-brl">${rate ? 'R$ 0,00' : '—'}</b></div>
    </div>`)}`
}

function bindMissoes(view, { L, rate }) {
  view.querySelectorAll('[data-mld]').forEach(b => b.addEventListener('click', async () => {
    const d = Number(b.dataset.mld)
    const days = L.snap.league_days === d ? d - 1 : d
    const { error } = await sb.from('reward_snapshots').update({ league_days: days }).eq('id', L.snap.id)
    if (error) return toast('Erro ao salvar: ' + error.message)
    reload('rewards')
  }))
  const sim = view.querySelector('#sim-gems')
  queueMicrotask(() => sim.dispatchEvent(new Event('input')))
  sim.addEventListener('input', ev => {
    const gems = Number(ev.target.value) || 0
    const live = gems * 0.01 * 0.4
    const week = gems * 0.01 * (L.upcoming?.pct || 0) / 100
    view.querySelector('#sim-live').textContent = usd(live)
    view.querySelector('#sim-week').textContent = usd(week)
    if (rate) view.querySelector('#sim-brl').textContent = '≈ ' + brl((live + week) * rate)
  })
}

// Limite deste mês, pelas regras: sai do ganho do mês passado na tabela do TikTok.
// O ganho do mês passado vem das lives e semanais registrados ou do resumo do mês, o que for maior.
// Sem nenhum dado do mês passado, usa o último limite salvo.
function currentLimit() {
  const prev = prevYm(today().slice(0, 7))
  const earned = Math.max(monthEarned(state.data, prev), Number(summaryOf(prev)?.rewards_usd) || 0)
  return earned > 0 ? { usd: limitFor(earned).tier[1], earned, auto: true } : { usd: Number(state.data.settings?.daily_limit_usd) || 100, earned: 0, auto: false }
}

function limitePanel() {
  const month = today().slice(0, 7)
  const earned = monthEarned(state.data, month)
  const { tier, next } = limitFor(earned)
  const lim = currentLimit()
  const current = lim.usd
  const prevName = monthWord(prevYm(month))
  const nextName = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('pt-BR', { month: 'long' })
  const progress = next ? earned / next[0] : 1
  return `
    <div class="feature">
      <div class="k"><i>${ic('shield')}</i>Limite de saque por dia<em>este mês</em></div>
      <div class="big num">${esc(usd0(current))}</div>
      <div class="sub">${lim.auto ? `pelo ganho de ${esc(prevName)}: <span class="num">${esc(usd(lim.earned))}</span>` : 'sem dados do mês passado: último limite salvo'}</div>
    </div>
    <div class="card">
      <div class="row"><span>Limite de ${esc(nextName)}</span><i class="pill ${tier[1] >= current ? 'ok' : 'down'}">${esc(usd0(tier[1]))} por dia</i></div>
      <div class="row"><span>Ganho neste mês (estimado)</span><b class="num">${esc(usd(earned))}</b></div>
      ${next ? `<div class="row" style="font-size:12px"><span>Rumo aos ${esc(usd0(next[0]))}</span><b class="num">${esc(int(Math.round(progress * 100)))}%</b></div>` : ''}
      <div class="track" style="background:var(--s2);margin-top:-6px"><i style="transform:scaleX(${Math.min(Math.max(progress, 0), 1)});background:linear-gradient(90deg,var(--p1),var(--accent-2))"></i></div>
      <p class="muted small">${next ? `Faltam <b class="num">${esc(usd(next[0] - earned))}</b> este mês para o limite de ${esc(nextName)} subir para ${esc(usd0(next[1]))} por dia.` : 'Você está na faixa mais alta.'} Conta as recompensas das lives registradas e os semanais que já caíram.</p>
    </div>
    ${sec('Tabela do TikTok', `<div class="card">
      <table>
        <thead><tr><th>Ganho no mês</th><th>Limite no mês seguinte</th></tr></thead>
        <tbody>${[...LIMIT_TIERS].reverse().map(([min, lim]) =>
          `<tr class="${min === tier[0] ? 'here' : next && min === next[0] ? 'next' : ''}"><td>${esc(usd0(min))}${min === tier[0] ? ' · você' : ''}</td><td>${esc(usd0(lim))}</td></tr>`).join('')}</tbody>
      </table></div>`)}`
}

function bindLimite() {}

function regrasPanel() {
  const table = rows => `<table><tbody>${rows.map(([a, b, tone]) => `<tr><td>${a}</td><td${tone ? ` class="${tone}"` : ''}>${b}</td></tr>`).join('')}</tbody></table>`
  return `
    <div class="feature">
      <div class="k"><i>${ic('gem')}</i>Como vira dinheiro</div>
      <div class="big" style="font-size:27px">250 diamantes = US$ 1</div>
      <div class="sub">Cada diamante vale US$ 0,01 e você fica com a sua porcentagem (40% por live).<br>Ex.: <span class="num">104.000 × US$ 0,01 × 40% = US$ 416,00</span></div>
    </div>
    ${sec('Por live · até 40%', `<div class="card">${table([['Menos de 5 min', '20%'], ['5 min ou mais', '30%'], ['10 min ou mais', '35%'], ['25 min ou mais', '38%'], ['+ 5 novos seguidores', '+2%']])}</div>`)}
    ${sec('Por semana · até 13%', `<div class="card">${table([['1 dia válido (25 min+)', '6%'], ['2 dias válidos ou mais', '8%'], ['10+ fãs ativos', '1%'], ['25+ fãs ativos', '1,5%'], ['100+ fãs ativos', '2%'], ['Manter liga A1–A3', '1%'], ['Superar a melhor liga', '3%']])}
      <p class="muted small">A semana vai de segunda a domingo e vira na segunda à 1h. O semanal cai no saldo nessa hora.</p></div>`)}
    ${sec('Liga · fragmentos por dia', `<div class="card">${table([['Top 1% no fechamento do dia', '+3', 'pos'], ['Top 10%', '+2', 'pos'], ['Top 20%', '+1', 'pos'], ['Top 60%', '0'], ['Abaixo disso ou sem live', '−1', 'neg']])}
      <p class="muted small">+4 fragmentos sobe de liga, −4 cai. Escudos bloqueiam uma perda cada, até 10. O Guardião pode forjar fragmentos (3 chances por semana) e mandar 1 escudo por semana. A posição muda o dia todo: vale a do fechamento.</p></div>`)}
    ${sec('Saque', `<div class="card">${table([['Taxa (Payoneer e Pix)', 'US$ 3 por saque'], ['Mínimo', 'US$ 9'], ['Pix', 'até US$ 2.500 por saque'], ['Payoneer', 'até o limite diário']])}</div>`)}`
}

// ---------- Prints ----------

// Domingo a partir das 18h, se ainda não chegou o print de Upcoming rewards do dia
function updateDue() {
  const now = new Date()
  const snap = state.data.snapshots?.[0]
  const sentToday = snap && new Date(snap.taken_at).toDateString() === now.toDateString()
  const due = now.getDay() === 0 && now.getHours() >= 18 && !sentToday
  document.querySelectorAll('#prints .due, [data-prints] .due').forEach(dot => { dot.hidden = !due })
  return due
}

function openPrints() {
  const due = updateDue()
  sheet.innerHTML = `
    <div class="sheet-body prints-sheet">
      <div class="sheet-head"><span></span><strong>Mandar prints</strong><button type="button" class="link" data-close>Fechar</button></div>
      ${due ? '<i class="pill">domingo: falta o semanal</i>' : ''}
      <label class="btn primary file-btn" for="prints-files">Escolher prints</label>
      <input id="prints-files" type="file" accept="image/*" multiple hidden>
      <p class="muted small">Pode escolher prints de tipos diferentes juntos: o app reconhece cada um sozinho.</p>
      <span class="muted small" id="prints-status" role="status"></span>
      <div id="prints-result"></div>
      <ol class="routine">
        <li><b>Depois de cada live</b><span>3 prints da análise da live: Viewership, Engagement e Rewards.</span><em>registra a live</em></li>
        <li><b>Toda semana e no fim do mês</b><span>LIVE Analytics → Overview (Custom, o mês inteiro): Key metrics e Viewer insights.</span><em>resumo e público do mês</em></li>
        <li><b>Domingo à noite</b><span>1 print: Content rewards → Upcoming rewards (a tela das missões).</span><em>atualiza saldo, semanal e liga</em></li>
        <li><b>Quando sacar</b><span>Sem print: Recompensas → Saldo → Registrar saque.</span><em>registra o saque</em></li>
      </ol>
    </div>`
  sheet.querySelector('[data-close]').addEventListener('click', closeSheet)
  const input = sheet.querySelector('#prints-files')
  const pick = sheet.querySelector('.file-btn')
  const status = sheet.querySelector('#prints-status')
  const result = sheet.querySelector('#prints-result')
  input.addEventListener('change', async () => {
    if (!input.files.length) return
    pick.classList.add('busy')
    result.innerHTML = ''
    try {
      const texts = await readEach([...input.files], msg => { status.textContent = msg })
      const weekly = texts.filter(isWeeklyPrint)
      const monthly = texts.filter(t => !isWeeklyPrint(t) && isMonthPrint(t))
      const live = texts.filter(t => !isWeeklyPrint(t) && !isMonthPrint(t)).join('\n')
      const liveData = live.trim() ? parseTikTok(live) : {}
      const liveFields = Object.keys(liveData).length
      status.textContent = ''
      if (weekly.length) showWeekly(result, weekly)
      if (monthly.length) showMonth(result, monthly)
      if (liveFields) {
        result.insertAdjacentHTML('beforeend', `
          <div class="card"><div class="row"><b>Live${liveData.date ? ` de ${esc(shortDate(`${liveData.date}T12:00`))}` : ''}</b><span class="muted">${liveFields} campos lidos</span></div>
          <button class="btn primary" type="button" data-open-live>Conferir e salvar a live</button></div>`)
        result.querySelector('[data-open-live]').addEventListener('click', () => {
          sheet.close()
          openForm('lives', null, live)
        })
      }
      if (!weekly.length && !monthly.length && !liveFields) status.textContent = 'Não reconheci esses prints. Use os da análise da live ou o de Upcoming rewards.'
    } catch (err) {
      status.textContent = err.message || 'Não consegui ler os prints.'
    } finally {
      pick.classList.remove('busy')
      input.value = ''
    }
  })
  sheet.showModal()
  document.activeElement?.blur()
}

// Resumo do mês (Key metrics e Viewer insights do período inteiro): confere e salva no mês escolhido
const MONTH_FIELDS = [
  ['diamonds', 'Diamantes'], ['rewards_usd', 'Recompensas (US$)'], ['duration_min', 'Duração (min)'], ['views', 'Visualizações'],
  ['unique_viewers', 'Espectadores únicos'], ['active_viewers', 'Espectadores ativos'], ['avg_watch_sec', 'Tempo médio (s)'],
  ['peak_viewers', 'Pico simultâneo'], ['avg_viewers', 'Média simultânea'], ['gifters', 'Presenteadores'],
  ['new_followers', 'Novos seguidores'], ['comments', 'Comentários'], ['shares', 'Compartilhamentos'], ['likes', 'Curtidas'],
  ['video_joined', 'Vieram dos vídeos'],
]
// países de vários prints (a tela rola): o mais novo vale; "Outros" sempre por último
function mergeCountries(a = [], b = [], sameBatch = false) {
  // entre prints da mesma vez, junta (a tela rola); um print novo que já tem "Outros" é a lista inteira e substitui a salva
  const m = new Map(!sameBatch && b.some(([k]) => k === 'Others') ? [] : a)
  for (const [k, v] of b) m.set(k, v)
  return [...m].sort((x, y) => (x[0] === 'Others') - (y[0] === 'Others') || y[1] - x[1])
}
const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55+']

function showMonth(result, texts) {
  const parsed = texts.map(t => parseMonth(t))
  const data = {}
  for (const p of parsed) for (const [k, v] of Object.entries(p)) {
    if (k === 'ages') data.ages = { ...data.ages, ...v }   // vários prints da mesma tela rolada se completam
    else if (k === 'countries') data.countries = mergeCountries(data.countries, v, true)
    else if (k === 'period') data.period = v
    else if (k !== 'month') data[k] = v
  }
  fixMonth(data)
  // prints de público não têm data: sem o gráfico do mês junto, vão para o mês atual
  // o mês sai do período do topo do print ("Oct 1 - Oct 29"); sem ele, do eixo do gráfico; sem nada, o mês atual
  const month = parsed.find(p => p.period)?.month || parsed.find(p => p.month)?.month || today().slice(0, 7)
  const dm = d => `${d.slice(8)}/${d.slice(5, 7)}`
  const period = data.period ? `${dm(data.period[0])} a ${dm(data.period[1])}` : null
  const spans = data.period && data.period[0].slice(0, 7) !== data.period[1].slice(0, 7)
  const metrics = MONTH_FIELDS.filter(([k]) => data[k] != null)
  const aud = [data.video_followers_pct != null && `vídeos ${data.video_followers_pct}/${data.video_new_pct ?? 100 - data.video_followers_pct}`, data.female_pct != null && `gênero ${data.female_pct}/${data.male_pct}`, data.ages && `${Object.keys(data.ages).length} faixas de idade`, data.countries && `${data.countries.length} países`].filter(Boolean)
  result.insertAdjacentHTML('beforeend', `
    <form class="card" id="m-form"><h3>Resumo do mês</h3>
      <label class="field" for="m-month"><span>Mês</span><input id="m-month" name="month" type="month" value="${month}" required></label>
      <div class="row"><span>Período do print</span><b>${period ? esc(period) : 'não li o período'}</b></div>
      ${spans ? '<p class="small neg">O período pega mais de um mês: no TikTok, escolha em Custom do dia 1 ao último dia do mês.</p>' : ''}
      ${!period ? '<p class="small muted">Mande junto o print do topo do Overview (onde aparece "Custom · Oct 1 - Oct 29") pra o app saber o período.</p>' : ''}
      ${metrics.length ? `<div class="fields" style="box-shadow:none;padding:0">${metrics.map(([k, l]) => `<label class="field half auto" for="m-${k}"><span>${esc(l)}</span><input id="m-${k}" name="${k}" type="text" inputmode="decimal" value="${esc(int(data[k]))}"></label>`).join('')}</div>
      <p class="muted small">O TikTok arredonda o mês (2.6M, 4.1K). Se a leitura perdeu um ponto (41K no lugar de 4.1K), corrija aqui.</p>` : ''}
      ${aud.length ? `<div class="row"><span>Público</span><b>${esc(aud.join(' · '))}</b></div>` : ''}
      <button class="btn primary" type="submit">Salvar resumo</button></form>`)
  const form = result.querySelector('#m-form')
  form.addEventListener('submit', async ev => {
    ev.preventDefault()
    const btn = form.querySelector('[type=submit]')
    if (btn.disabled) return
    btn.disabled = true
    for (const [k] of metrics) { const v = num(form[k].value); if (v) data[k] = v; else delete data[k] }
    const ym = form.month.value
    // junta com o que já tinha do mês (ex.: números num dia, público no outro); o print novo substitui o antigo
    const before = summaryOf(ym) || {}
    const merged = { ...before, ...data, ...(data.ages ? { ages: { ...before.ages, ...data.ages } } : {}), ...(data.countries ? { countries: mergeCountries(before.countries, data.countries) } : {}) }
    const { error } = await sb.from('month_summaries').upsert({ month: ym, data: merged, updated_at: new Date().toISOString() }, { onConflict: 'user_id,month' })
    if (error) {
      btn.disabled = false
      return result.insertAdjacentHTML('beforeend', `<p class="small neg">Não salvou: ${esc(/month_summaries/.test(error.message) ? 'falta criar a tabela no Supabase (migração 005).' : error.message)}</p>`)
    }
    closeSheet()
    toast(`Resumo de ${monthWord(ym)} salvo`)
    reload()
  })
}

function showWeekly(result, texts) {
  // vários prints da mesma tela (rolada) se completam
  const data = Object.assign({}, ...texts.map(t => Object.fromEntries(Object.entries(parseWeekly(t)).filter(([, v]) => v != null))))
  data.week_start ??= weekStartOf()
  // a leitura não achou a porcentagem: completa com a do último print da mesma semana (dá pra corrigir abaixo)
  if (data.weekly_pct == null) {
    const prev = (state.data.snapshots || []).find(s => s.week_start === data.week_start && Number(s.weekly_pct))
    if (prev) data.weekly_pct = Number(prev.weekly_pct)
    if (data.weekly_pct && data.upcoming_usd && !data.week_diamonds) data.week_diamonds = Math.round(data.upcoming_usd / (data.weekly_pct / 100) / 0.01 / 100) * 100
  }
  const rows = [
    ['Disponível para sacar', data.available_usd != null ? usd(data.available_usd) : null],
    ['A receber da semana', data.upcoming_usd != null ? usd(data.upcoming_usd) : null],
    ['Semana', shortDate(`${data.week_start}T12:00`) + ' a ' + shortDate(new Date(weekEndOf(data.week_start) - 2 * 3600e3))],

    ['Liga', data.league || null],
    ['Dias válidos', data.valid_days_done ? 'concluída' : null],
    ['Fãs ativos', data.fans_done ? 'concluída' : null],
  ].filter(([, v]) => v)
  result.insertAdjacentHTML('beforeend', `
    <div class="card"><h3>Upcoming rewards</h3>
      ${rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
      <div class="grid">
        <label class="field" for="wk-gems"><span>Diamantes da semana</span><input id="wk-gems" type="text" inputmode="numeric" value="${data.week_diamonds ? esc(int(data.week_diamonds)) : ''}" placeholder="356.900"></label>
        <label class="field" for="wk-pct"><span>Semanal (%)</span><input id="wk-pct" type="text" inputmode="decimal" value="${data.weekly_pct != null ? esc(String(data.weekly_pct).replace('.', ',')) : ''}" placeholder="11"></label>
      </div>
      ${data.weekly_pct == null ? '<p class="small neg">Não consegui ler a porcentagem: confira no print e coloque acima.</p>' : ''}
      <div class="row"><span>Dias mantidos na liga</span><b class="muted small">${data.league_days != null ? 'lido do print' : 'toque para marcar'}</b></div>
      <div class="days">${[1, 2, 3, 4, 5, 6, 7].map(d => `<button type="button" data-ld="${d}" aria-label="${d} de 7 dias">${d}</button>`).join('')}</div>
      ${data.available_usd == null ? '<p class="muted small">Não achei o saldo disponível nesse print.</p>' : ''}
      <details class="raw-box"><summary class="muted small">Ver texto lido</summary><pre>${esc(texts.join('\n=====\n'))}</pre></details>
      <button class="btn primary" type="button" data-save-week ${data.available_usd == null ? 'disabled' : ''}>Salvar semana</button></div>`)
  // dias mantidos: vem da leitura, mas dá para corrigir tocando nas bolinhas
  const paint = () => result.querySelectorAll('[data-ld]').forEach(b => {
    const on = Number(b.dataset.ld) <= (data.league_days ?? 0)
    b.classList.toggle('on', on)
  })
  result.querySelectorAll('[data-ld]').forEach(b => b.addEventListener('click', () => {
    const d = Number(b.dataset.ld)
    data.league_days = data.league_days === d ? d - 1 : d
    paint()
  }))
  paint()
  result.querySelector('[data-save-week]').addEventListener('click', async ev => {
    const g = num(result.querySelector('#wk-gems').value), p = num(result.querySelector('#wk-pct').value)
    if (p && (p < 6 || p > 13)) return toast('O semanal vai de 6% a 13%')
    data.week_diamonds = g || null
    data.weekly_pct = p || null
    if (data.weekly_pct && !data.week_diamonds && data.upcoming_usd) data.week_diamonds = Math.round(data.upcoming_usd / (data.weekly_pct / 100) / 0.01 / 100) * 100
    ev.target.disabled = true
    const { error } = await sb.from('reward_snapshots').insert(data)
    if (error) {
      ev.target.disabled = false
      // o aviso comum fica atrás da janela aberta: mostra o erro dentro dela
      return result.insertAdjacentHTML('beforeend', `<p class="small neg">Não salvou: ${esc(error.message)}</p>`)
    }
    closeSheet()
    toast('Semana atualizada')
    if (state.tab === 'rewards') reload('rewards')
    else updateDue()
  })
}

// ---------- Início da sessão ----------

let signedIn = null
sb.auth.onAuthStateChange((_event, session) => {
  const now = !!session
  if (now === signedIn) return
  signedIn = now
  state.data = {}
  now ? renderShell() : renderLogin()
})

// Sem zoom: o iPhone ignora o "user-scalable=no" da página, então o gesto de pinça é cancelado aqui
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false })
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault() }, { passive: false })

// ---------- Atualização automática ----------

// O GitHub Pages deixa o iPhone guardar a página por 10 minutos. Ao abrir ou voltar para o app,
// pergunta ao servidor (sem cache) qual é a versão publicada e, se mudou, abre a nova na hora.
const VERSION = '__V__'   // trocado pelo commit na publicação

async function checkUpdate() {
  if (VERSION === '__' + 'V__') return   // rodando localmente, sem versão
  if (sheet.open) return                 // não recarrega com um cadastro aberto (ex.: voltando da galeria de fotos)
  try {
    const html = await (await fetch(`./?check=${Date.now()}`, { cache: 'no-store' })).text()
    const latest = html.match(/app\.js\?v=(\w+)/)?.[1]
    if (latest && latest !== VERSION) {
      try { sessionStorage.setItem('updated', '1') } catch {}
      location.replace(`./?v=${latest}`)
    }
  } catch {
    // sem internet: segue com a versão atual
  }
}

checkUpdate()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  checkUpdate()
  if (signedIn && !sheet.open) reload()   // dados frescos ao voltar para o app
})
try {
  if (sessionStorage.getItem('updated')) { sessionStorage.removeItem('updated'); setTimeout(() => toast('App atualizado'), 600) }
} catch {}
