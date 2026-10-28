/**
 * Análise de captura de email e venda via CRM na aquisição WL BR.
 * Menu: Análise CRM WL > Abrir painel. Escolha início e fim, rode a análise e baixe as tabelas diárias.
 */

const SHEET_NAMES_ = {
  resumo: 'Resumo', inc: 'Incrementalidade', camp: 'Captura x UTM campaign', src: 'Captura x UTM source', tempo: 'Tempo até conversão',
  rent: 'Rentabilidade e prob por UTM', extras: 'Extras', met: 'Metodologia', base: 'Base pedidos', dOrd: 'Diário aquisições', dLead: 'Diário leads'
};

const NEKT_URL_ = 'https://api.nekt.ai/api/v1/sql-query/';

const DEFAULT_CFG_ = {
  project: '',                 // vazio: as consultas rodam na Nekt e usam `dataset`.`tabela`
  dataset: 'manual_default',   // dataset (layer) das tabelas na Nekt
  dataStart: '2026-08-30',     // início do histórico de eventos de captura no lake
  minCohort: '2026-09-02'      // primeira data de coorte de leads considerada confiável
};

const DEFAULT_PARAMS_ = { start: '2026-09-01', end: '', utmFrom: '2026-09-29', launch: '2026-10-02', margin: 50 };

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Análise CRM WL')
    .addItem('Abrir dashboard (web app)', 'openDashboard')
    .addItem('Abrir painel', 'showPanel')
    .addItem('Testar conexão com a Nekt', 'testConnectionMenu')
    .addItem('Atualizar dados do dashboard', 'refreshData')
    .addItem('Agendar atualização diária (6h)', 'installDailyTrigger')
    .addToUi();
}

function openDashboard() {
  const url = ScriptApp.getService().getUrl();
  const ui = SpreadsheetApp.getUi();
  if (!url) {
    ui.alert('O dashboard ainda não foi implantado.\n\nNo editor do Apps Script: Implantar > Nova implantação > tipo App da Web > Executar como: eu > Acesso: apenas eu > Implantar. Depois volte aqui e clique de novo em Abrir dashboard.');
    return;
  }
  const html = HtmlService.createHtmlOutput('<p style="font-family:Arial">Abrindo o dashboard... Se não abrir, <a href="' + url + '" target="_blank">clique aqui</a>.</p><script>window.open(' + JSON.stringify(url) + ', "_blank");</script>').setWidth(360).setHeight(90);
  ui.showModalDialog(html, 'Dashboard');
}

function showPanel() {
  const html = HtmlService.createHtmlOutputFromFile('Painel').setWidth(560).setHeight(720);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Análise CRM WL');
}

function testConnectionMenu() {
  const r = testConnection();
  SpreadsheetApp.getUi().alert(r.message);
}

function todayBr_() { return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd'); }

/** ---------- Configuração e estado do painel ---------- */
function getConfig_() {
  const raw = PropertiesService.getDocumentProperties().getProperty('cfg');
  return Object.assign({}, DEFAULT_CFG_, raw ? JSON.parse(raw) : {}, { project: '' });
}

function getPanelState() {
  const props = PropertiesService.getDocumentProperties();
  const last = props.getProperty('params');
  const p = Object.assign({}, DEFAULT_PARAMS_, last ? JSON.parse(last) : {});
  const yesterday = addDays_(todayBr_(), -1);
  if (!p.end || p.end > yesterday) p.end = yesterday;
  const cfg = getConfig_();
  return { cfg: { dataset: cfg.dataset }, hasKey: !!getNektKey_(), params: p, today: todayBr_(), lastRun: props.getProperty('lastRun') || '' };
}

function getNektKey_() { return PropertiesService.getScriptProperties().getProperty('NEKT_API_KEY') || ''; }

function saveConfig(cfg) {
  const dataset = String(cfg.dataset || '').trim();
  if (!/^[A-Za-z0-9_]+$/.test(dataset)) throw new Error('Nome de dataset inválido.');
  const key = String(cfg.apiKey || '').trim();
  if (key) {
    if (/\s/.test(key) || key.length < 10) throw new Error('Chave da API da Nekt inválida.');
    PropertiesService.getScriptProperties().setProperty('NEKT_API_KEY', key);
  }
  PropertiesService.getDocumentProperties().setProperty('cfg', JSON.stringify(Object.assign({}, getConfig_(), { dataset: dataset })));
  return { ok: true };
}

function normalizeParams_(p, cfg) {
  const today = todayBr_();
  const P = {
    start: assertDate_(p.start, 'início'), end: assertDate_(p.end, 'fim'), utmFrom: assertDate_(p.utmFrom || DEFAULT_PARAMS_.utmFrom, 'UTM confiável desde'),
    launch: assertDate_(p.launch || DEFAULT_PARAMS_.launch, 'lançamento do retargeting'), margin: Number(p.margin),
    dataStart: cfg.dataStart, minCohort: cfg.minCohort
  };
  if (P.start > P.end) throw new Error('A data de início não pode ser depois da data final.');
  if (P.end > today) throw new Error('A data final não pode ser futura.');
  if (isNaN(P.margin) || P.margin < 0 || P.margin > 100) throw new Error('Margem deve estar entre 0 e 100.');
  P.margin = P.margin / 100;
  P.utmFromEff = P.utmFrom > P.start ? P.utmFrom : P.start;
  P.generatedAt = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
  return P;
}

/** ---------- Nekt (Data API) ---------- */
const NUM_COLS_ = /^(is_crm|gross|net|disc|gap_rec_h|conv_gap_h|pay_gap_h|crm_sess|rnk|has_sess|ed|ea|ec|leads|s_(el|cv|cr|net|disc|b|c)\w*|l_\w+|(el|cv|cr)\d+|t1h|t1d|t3d|cvall|sdtc)$/;

/** Executa o SQL pela Data API da Nekt (CSV) e devolve linhas como objetos, com números convertidos. */
function runQuery_(cfg, sql) {
  const key = getNektKey_();
  if (!key) throw new Error('Informe a chave da API da Nekt no painel (Configuração) antes de rodar.');
  const res = UrlFetchApp.fetch(NEKT_URL_, {
    method: 'post', contentType: 'application/json', headers: { 'x-api-key': key },
    payload: JSON.stringify({ sql: sql, mode: 'csv' }), muteHttpExceptions: true
  });
  const code = res.getResponseCode(), text = res.getContentText();
  if (code === 401 || code === 403) throw new Error('A Nekt recusou a chave da API (HTTP ' + code + '). Gere outra em Configurações > API Keys.');
  if (code >= 300) throw new Error('Erro da Nekt (HTTP ' + code + '): ' + text.slice(0, 400));
  const body = JSON.parse(text);
  if (body.state !== 'SUCCEEDED') throw new Error('Consulta na Nekt terminou como ' + body.state + (body.state_change_reason ? ': ' + body.state_change_reason : '') + '.');
  return parseNektFiles_(body.presigned_urls || []);
}

function parseNektFiles_(urls) {
  const rows = [];
  urls.forEach(function (u) {
    const r = UrlFetchApp.fetch(u, { muteHttpExceptions: true });
    if (r.getResponseCode() >= 300) throw new Error('Falha ao baixar o resultado da Nekt (HTTP ' + r.getResponseCode() + ').');
    let txt = r.getContentText();
    if (!txt || !txt.trim()) return;
    const grid = Utilities.parseCsv(txt);
    if (grid.length < 2) return;
    const head = grid[0];
    for (let i = 1; i < grid.length; i++) rows.push(csvRow_(head, grid[i]));
  });
  return rows;
}

function csvRow_(head, cells) {
  const o = {};
  head.forEach(function (h, j) {
    const v = cells[j];
    if (v === undefined || v === '' || v === null) { o[h] = null; return; }
    o[h] = NUM_COLS_.test(h) ? Number(v) : v;
  });
  return o;
}

function testConnection() {
  const cfg = getConfig_();
  const sql = 'SELECT (SELECT CAST(MAX(SAFE_CAST(system_checkout_at AS TIMESTAMP)) AS STRING) FROM ' + tbl_(cfg, 'webhook_v2_orders_lake') + ' WHERE LOWER(brand_at_checkout)=\'voy\') AS ultimo_pedido, ' +
    '(SELECT CAST(TIMESTAMP_SECONDS(MAX(timestamp)) AS STRING) FROM ' + tbl_(cfg, 'wl_customer_io_activities') + ') AS ultima_atividade';
  const r = runQuery_(cfg, sql)[0];
  return { ok: true, message: 'Conexão com a Nekt ok.\nÚltimo pedido Voy no lake: ' + r.ultimo_pedido + ' (UTC)\nÚltima atividade do Customer.io (WL): ' + r.ultima_atividade + ' (UTC)' };
}

/** ---------- Execução principal ---------- */
function getOrCreateSheet_(ss, name, resetLayout) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  if (resetLayout) {
    sh.setRowHeights(1, sh.getMaxRows(), 21);
    sh.setColumnWidths(1, sh.getMaxColumns(), 100);
    sh.setFrozenRows(0); sh.setFrozenColumns(0);
  }
  return sh;
}

function runAnalysis(params) {
  const t0 = Date.now(), cfg = getConfig_(), P = normalizeParams_(params, cfg);
  const props = PropertiesService.getDocumentProperties();
  props.setProperty('params', JSON.stringify({ start: P.start, end: P.end, utmFrom: P.utmFrom, launch: P.launch, margin: P.margin * 100 }));
  const warnings = [];
  if (P.start < cfg.dataStart) warnings.push('O início é anterior a ' + fmtDateBr_(cfg.dataStart) + ' (começo do histórico de captura): a maioria dos pedidos cairá na classe D.');
  if (P.utmFrom < '2026-09-28') warnings.push('A UTM do questionário só é confiável desde 28/09/2026; a análise por UTM source fica distorcida antes disso.');

  const orders = runQuery_(cfg, buildOrdersSql_(cfg, P.start, P.end));
  if (!orders.length) throw new Error('Nenhuma aquisição confirmada no período escolhido.');
  const leadStart = P.start < cfg.minCohort ? cfg.minCohort : P.start;
  const leadRows = leadStart <= P.end ? runQuery_(cfg, buildLeadsSql_(cfg, leadStart, P.end, P.utmFromEff < leadStart ? leadStart : P.utmFromEff)) : [];
  if (!leadRows.length) warnings.push('Sem coortes de leads no período (início mínimo de coorte: ' + fmtDateBr_(cfg.minCohort) + ').');
  const O = computeOrders_(orders), L = computeLeads_(leadRows, P);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  writeBase_(getOrCreateSheet_(ss, SHEET_NAMES_.base, false), orders);
  writeIncrementalidade_(getOrCreateSheet_(ss, SHEET_NAMES_.inc, true), O, L, P);
  writeCampaign_(getOrCreateSheet_(ss, SHEET_NAMES_.camp, true), O, P);
  writeSource_(getOrCreateSheet_(ss, SHEET_NAMES_.src, true), O, L, P);
  writeTempo_(getOrCreateSheet_(ss, SHEET_NAMES_.tempo, true), O, L, P);
  writeRent_(getOrCreateSheet_(ss, SHEET_NAMES_.rent, true), O, L, P);
  writeExtras_(getOrCreateSheet_(ss, SHEET_NAMES_.extras, true), O, P);
  writeMetodologia_(getOrCreateSheet_(ss, SHEET_NAMES_.met, true), P);
  writeResumo_(getOrCreateSheet_(ss, SHEET_NAMES_.resumo, true), O, L, P);
  writeDaily_(getOrCreateSheet_(ss, SHEET_NAMES_.dOrd, false), DAILY_ORD_HEADS_, dailyOrdersRows_(O), true);
  writeDaily_(getOrCreateSheet_(ss, SHEET_NAMES_.dLead, false), DAILY_LEAD_HEADS_, dailyLeadsRows_(L, P.utmFromEff), true);

  // ordem das abas
  [SHEET_NAMES_.resumo, SHEET_NAMES_.inc, SHEET_NAMES_.camp, SHEET_NAMES_.src, SHEET_NAMES_.tempo, SHEET_NAMES_.rent, SHEET_NAMES_.extras, SHEET_NAMES_.met, SHEET_NAMES_.dOrd, SHEET_NAMES_.dLead, SHEET_NAMES_.base]
    .forEach(function (n, i) { const s = ss.getSheetByName(n); if (s) { ss.setActiveSheet(s); ss.moveActiveSheet(i + 1); } });
  ss.setActiveSheet(ss.getSheetByName(SHEET_NAMES_.resumo));

  const secs = Math.round((Date.now() - t0) / 1000);
  const msg = 'Análise de ' + fmtDateBr_(P.start) + ' a ' + fmtDateBr_(P.end) + ' gerada: ' + fmtNum_(O.total) + ' aquisições, ' + fmtNum_(leadRows.length) + ' linhas de leads, ' + secs + 's.';
  props.setProperty('lastRun', msg);
  return { ok: true, message: msg, warnings: warnings };
}

/** ---------- Exportação diária (CSV) ---------- */
function getDailyCsv(kind) {
  const name = kind === 'leads' ? SHEET_NAMES_.dLead : SHEET_NAMES_.dOrd;
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) throw new Error('Rode a análise antes de exportar: a aba "' + name + '" está vazia.');
  const values = sh.getDataRange().getValues();
  const csv = values.map(function (row) {
    return row.map(function (v) {
      if (v instanceof Date) return Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM-dd');
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
  }).join('\n');
  return { filename: (kind === 'leads' ? 'leads_diario_' : 'aquisicoes_diario_') + todayBr_() + '.csv', csv: csv };
}
