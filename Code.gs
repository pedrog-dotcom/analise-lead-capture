/**
 * Análise de captura de email e venda via CRM na aquisição WL BR.
 * Menu: Análise CRM WL > Abrir painel. Escolha início e fim, rode a análise e baixe as tabelas diárias.
 */

const SHEET_NAMES_ = {
  resumo: 'Resumo', inc: 'Incrementalidade', camp: 'Captura x UTM campaign', src: 'Captura x UTM source', tempo: 'Tempo até conversão',
  rent: 'Rentabilidade e prob por UTM', extras: 'Extras', met: 'Metodologia', base: 'Base pedidos', dOrd: 'Diário aquisições', dLead: 'Diário leads'
};

const DEFAULT_CFG_ = {
  project: '',                 // projeto GCP que contém os datasets da Nekt (obrigatório)
  billingProject: '',          // projeto que paga a consulta (vazio = mesmo projeto)
  dataset: 'manual_default',   // dataset das tabelas da Nekt
  location: '',                // ex.: US, southamerica-east1 (vazio = automático)
  dataStart: '2026-08-30',     // início do histórico de eventos de captura no lake
  minCohort: '2026-09-02'      // primeira data de coorte de leads considerada confiável
};

const DEFAULT_PARAMS_ = { start: '2026-09-01', end: '', utmFrom: '2026-09-29', launch: '2026-10-02', margin: 50 };

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Análise CRM WL')
    .addItem('Abrir painel', 'showPanel')
    .addItem('Testar conexão com o BigQuery', 'testConnectionMenu')
    .addToUi();
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
  return Object.assign({}, DEFAULT_CFG_, raw ? JSON.parse(raw) : {});
}

function getPanelState() {
  const props = PropertiesService.getDocumentProperties();
  const last = props.getProperty('params');
  const p = Object.assign({}, DEFAULT_PARAMS_, last ? JSON.parse(last) : {});
  const yesterday = addDays_(todayBr_(), -1);
  if (!p.end || p.end > yesterday) p.end = yesterday;
  return { cfg: getConfig_(), params: p, today: todayBr_(), lastRun: props.getProperty('lastRun') || '' };
}

function saveConfig(cfg) {
  const clean = {};
  ['project', 'billingProject', 'dataset', 'location'].forEach(function (k) { clean[k] = String(cfg[k] || '').trim(); });
  if (clean.project && !/^[a-z][a-z0-9\-:.]{4,60}$/i.test(clean.project)) throw new Error('ID de projeto GCP inválido.');
  if (!/^[A-Za-z0-9_]+$/.test(clean.dataset)) throw new Error('Nome de dataset inválido.');
  const cur = getConfig_();
  PropertiesService.getDocumentProperties().setProperty('cfg', JSON.stringify(Object.assign({}, cur, clean)));
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

/** ---------- BigQuery ---------- */
function runQuery_(cfg, sql) {
  if (!cfg.project) throw new Error('Informe o projeto GCP no painel (Configuração) antes de rodar.');
  const billing = cfg.billingProject || cfg.project;
  const request = { query: sql, useLegacySql: false, timeoutMs: 60000, maxResults: 10000 };
  if (cfg.location) request.location = cfg.location;
  let res = BigQuery.Jobs.query(request, billing);
  const jobId = res.jobReference.jobId, location = res.jobReference.location;
  let tries = 0;
  while (!res.jobComplete) {
    if (++tries > 100) throw new Error('A consulta demorou mais de 5 minutos.');
    Utilities.sleep(3000);
    res = BigQuery.Jobs.getQueryResults(billing, jobId, { maxResults: 10000, location: location });
  }
  const fields = res.schema.fields;
  const rows = [];
  let page = res;
  while (true) {
    (page.rows || []).forEach(function (r) { rows.push(bqRow_(fields, r)); });
    if (!page.pageToken) break;
    page = BigQuery.Jobs.getQueryResults(billing, jobId, { maxResults: 10000, pageToken: page.pageToken, location: location });
  }
  return rows;
}

function bqRow_(fields, r) {
  const o = {};
  fields.forEach(function (f, i) {
    let v = r.f[i].v;
    if (v === null || v === undefined) { o[f.name] = null; return; }
    if (f.type === 'INTEGER' || f.type === 'FLOAT' || f.type === 'NUMERIC' || f.type === 'INT64' || f.type === 'FLOAT64') v = Number(v);
    else if (f.type === 'BOOLEAN' || f.type === 'BOOL') v = String(v) === 'true';
    o[f.name] = v;
  });
  return o;
}

function testConnection() {
  const cfg = getConfig_();
  const sql = 'SELECT (SELECT CAST(MAX(SAFE_CAST(system_checkout_at AS TIMESTAMP)) AS STRING) FROM ' + tbl_(cfg, 'webhook_v2_orders_lake') + ' WHERE LOWER(brand_at_checkout)=\'voy\') AS ultimo_pedido, ' +
    '(SELECT CAST(TIMESTAMP_SECONDS(MAX(timestamp)) AS STRING) FROM ' + tbl_(cfg, 'wl_customer_io_activities') + ') AS ultima_atividade';
  const r = runQuery_(cfg, sql)[0];
  return { ok: true, message: 'Conexão ok.\nÚltimo pedido Voy no lake: ' + r.ultimo_pedido + ' (UTC)\nÚltima atividade do Customer.io (WL): ' + r.ultima_atividade + ' (UTC)' };
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
