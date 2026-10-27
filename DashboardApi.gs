/**
 * Web app com dashboard interativo.
 * Fluxo: refreshData() guarda o histórico completo em abas ocultas (pedidos e leads); o dashboard lê essas abas
 * e agrega qualquer período em segundos, sem refazer a consulta pesada na Nekt.
 */

const STORE_ORDERS_ = '_dados_pedidos';
const STORE_LEADS_ = '_dados_leads';
const LEAD_STORE_COLS_ = ['sec', 'dia', 'fstep', 'usb', 'cls_l', 'exp_l', 'leads', 's_el7', 's_cv7', 's_cr7', 's_el14', 's_cv14', 's_cr14', 's_net14', 's_disc14', 's_net14crm',
  's_b1h', 's_b6h', 's_b1d', 's_b3d', 's_b7d', 's_b14d', 's_c1d', 's_c3d', 's_c7d', 's_c14d', 'l_leads', 'l_el14', 'l_cv14', 'l_cr14', 'l_el7', 'l_cv7', 'l_cr7', 'l_net14', 'l_disc14'];

function doGet() {
  return HtmlService.createTemplateFromFile('Dashboard').evaluate()
    .setTitle('Captura de email e CRM (WL BR)')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** ---------- Atualização dos dados (histórico completo) ---------- */
function refreshData() {
  const t0 = Date.now(), cfg = getConfig_();
  const end = addDays_(todayBr_(), -1);
  const orders = runQuery_(cfg, buildOrdersSql_(cfg, cfg.dataStart, end));
  const leads = runQuery_(cfg, buildLeadsSql_(cfg, cfg.minCohort, end, cfg.minCohort)).filter(function (r) { return r.sec === 'dia' || r.sec === 'land'; });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  writeStore_(ss, STORE_ORDERS_, BASE_COLS_, orders, ['data_brt']);
  writeStore_(ss, STORE_LEADS_, LEAD_STORE_COLS_, leads, ['dia']);
  const props = PropertiesService.getDocumentProperties();
  const meta = { lastRefresh: Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm'), dataEnd: end, orders: orders.length, leadRows: leads.length };
  props.setProperty('storeMeta', JSON.stringify(meta));
  return { ok: true, message: 'Dados atualizados até ' + fmtDateBr_(end) + ': ' + fmtNum_(orders.length) + ' aquisições em ' + Math.round((Date.now() - t0) / 1000) + 's.', meta: meta };
}

function writeStore_(ss, name, cols, rows, textCols) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  const data = rows.map(function (r) { return cols.map(function (c) { const v = r[c]; return v === null || v === undefined ? '' : v; }); });
  const chunk = 4000;
  for (let i = 0; i < data.length; i += chunk) {
    const part = data.slice(i, i + chunk);
    const rg = sh.getRange(2 + i, 1, part.length, cols.length);
    textCols.forEach(function (c) { sh.getRange(2 + i, cols.indexOf(c) + 1, part.length, 1).setNumberFormat('@'); });
    rg.setValues(part);
  }
  sh.setFrozenRows(1);
  sh.hideSheet();
}

function readStore_(name, numericCols) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues(), head = values[0];
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const o = {};
    for (let j = 0; j < head.length; j++) { const v = values[i][j]; o[head[j]] = v === '' ? null : v; }
    out.push(o);
  }
  return out;
}

function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'refreshData') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshData').timeBased().everyDays(1).atHour(6).inTimezone('America/Sao_Paulo').create();
  SpreadsheetApp.getUi().alert('Atualização diária agendada para as 6h (horário de Brasília).');
}

/** ---------- Dados do dashboard ---------- */
function getDashboardState() {
  const props = PropertiesService.getDocumentProperties();
  const last = props.getProperty('dashParams'), meta = props.getProperty('storeMeta');
  const p = Object.assign({}, DEFAULT_PARAMS_, last ? JSON.parse(last) : {});
  const yesterday = addDays_(todayBr_(), -1);
  if (!p.end || p.end > yesterday) p.end = yesterday;
  return { params: p, today: todayBr_(), meta: meta ? JSON.parse(meta) : null, configured: !!getNektKey_() };
}

function getDashboardData(params) {
  const cfg = getConfig_();
  const P = normalizeParams_(params, cfg);
  PropertiesService.getDocumentProperties().setProperty('dashParams', JSON.stringify({ start: P.start, end: P.end, utmFrom: P.utmFrom, launch: P.launch, margin: P.margin * 100 }));
  const meta = PropertiesService.getDocumentProperties().getProperty('storeMeta');
  const orderRows = readStore_(STORE_ORDERS_), leadRows = readStore_(STORE_LEADS_);
  if (!orderRows.length) throw new Error('Ainda não há dados guardados. Clique em "Atualizar dados" para carregar o histórico da Nekt.');
  return buildDashboardPayload_(orderRows, leadRows, P, meta ? JSON.parse(meta) : {}, todayBr_());
}

/** Função pura (testável em Node). */
function buildDashboardPayload_(orderRows, leadRows, P, meta, today) {
  const rows = orderRows.filter(function (r) { return String(r.data_brt) >= P.start && String(r.data_brt) <= P.end; });
  if (!rows.length) throw new Error('Nenhuma aquisição confirmada no período escolhido.');
  const O = computeOrders_(rows);
  const leadStart = P.start < P.minCohort ? P.minCohort : P.start;
  const L = leadsForRange_(leadRows, leadStart, P.end, P.utmFromEff < leadStart ? leadStart : P.utmFromEff);
  CLASSES_.forEach(function (k) { delete O.time[k].gaps; delete O.timeCrm[k].gaps; });
  const T = buildNarrative_(O, L, P);
  return {
    meta: Object.assign({}, meta, { today: today, start: P.start, end: P.end, utmFrom: P.utmFromEff, launch: P.launch, margin: P.margin, dataStart: P.dataStart, minCohort: P.minCohort, ordersInRange: rows.length }),
    O: O, L: { src: L.src, srcStep: L.srcStep, srcAll: L.srcAll, land: L.land, buckets: L.buckets, landRows: L.landRows },
    narrative: T, dailyOrders: dailyOrdersRows_(O), dailyLeads: dailyLeadsRows_(L, P.utmFromEff),
    crmPromos: CRM_PROMOS_, classDesc: CLASS_DESC_
  };
}
