/**
 * Escritores de abas. Convenções de cor: azul = dado vindo do BigQuery ou premissa; verde = fórmula que lê outra aba;
 * preto = fórmula local; vermelho = alerta; fundo amarelo = premissa editável.
 */

const COLOR_ = { blue: '#0000FF', green: '#008000', black: '#000000', red: '#FF0000', white: '#FFFFFF' };
const FILL_ = { header: '#1F3864', total: '#F2F2F2', yellow: '#FFFF00', grey: '#D9D9D9' };
const FMT_ = { num: '#,##0;(#,##0);-', pct: '0.0%', pct2: '0.00%', brl: '"R$" #,##0.00', date: 'dd/mm/yyyy', dec1: '#,##0.0' };

function SB_(sheet) { this.s = sheet; this.cells = {}; this.maxR = 0; this.maxC = 0; this.heights = {}; this.widths = {}; this.freeze = null; }
SB_.prototype.put = function (r, c, v, o) {
  o = o || {};
  this.cells[r + ',' + c] = { v: v, fmt: o.fmt, color: o.color || COLOR_.black, bold: !!o.bold, italic: !!o.italic, fill: o.fill, size: o.size, wrap: !!o.wrap, halign: o.halign };
  if (r > this.maxR) this.maxR = r; if (c > this.maxC) this.maxC = c;
};
SB_.prototype.header = function (r, c0, heads, height) {
  const self = this;
  heads.forEach(function (h, i) { self.put(r, c0 + i, h, { bold: true, color: COLOR_.white, fill: FILL_.header, wrap: true, halign: 'center' }); });
  if (height) this.heights[r] = height;
};
SB_.prototype.flush = function () {
  const R = this.maxR, C = this.maxC, s = this.s;
  if (!R || !C) return;
  const mk = function (def) { const a = []; for (let i = 0; i < R; i++) { a.push(new Array(C).fill(def)); } return a; };
  const vals = mk(''), fmts = mk('0.###############'), colors = mk(COLOR_.black), weights = mk('normal'), styles = mk('normal'), fills = mk(null), wraps = mk(false), aligns = mk('normal'), sizes = mk(10);
  const self = this;
  Object.keys(this.cells).forEach(function (k) {
    const p = k.split(','), r = Number(p[0]) - 1, c = Number(p[1]) - 1, x = self.cells[k];
    vals[r][c] = x.v === undefined || x.v === null ? '' : x.v;
    if (x.fmt) fmts[r][c] = x.fmt;
    colors[r][c] = x.color; weights[r][c] = x.bold ? 'bold' : 'normal'; styles[r][c] = x.italic ? 'italic' : 'normal';
    fills[r][c] = x.fill || null; wraps[r][c] = x.wrap; aligns[r][c] = x.halign || 'general'; if (x.size) sizes[r][c] = x.size;
  });
  const rg = s.getRange(1, 1, R, C);
  rg.setFontFamily('Arial'); rg.setValues(vals); rg.setNumberFormats(fmts); rg.setFontColors(colors); rg.setFontWeights(weights);
  rg.setFontStyles(styles); rg.setBackgrounds(fills); rg.setWraps(wraps); rg.setHorizontalAlignments(aligns); rg.setFontSizes(sizes);
  rg.setVerticalAlignment('top');
  Object.keys(this.heights).forEach(function (r) { s.setRowHeight(Number(r), self.heights[r]); });
  Object.keys(this.widths).forEach(function (c) { s.setColumnWidth(Number(c), self.widths[c]); });
  if (this.freeze) { s.setFrozenRows(this.freeze.rows || 0); s.setFrozenColumns(this.freeze.cols || 0); }
};

function colL_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function isoToDate_(iso) { const p = String(iso).split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
function fmtPct_(x, d) { return (x * 100).toFixed(d === undefined ? 1 : d).replace('.', ',') + '%'; }
function fmtNum_(x) { return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function fmtBrl_(x) { return 'R$ ' + fmtNum_(x); }
function fmtDateBr_(iso) { const p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
function wid_(sb, map) { Object.keys(map).forEach(function (c) { sb.widths[c] = map[c]; }); }

/** ---------- Incrementalidade ---------- */
function writeIncrementalidade_(sh, O, L, P) {
  const sb = new SB_(sh), B = { color: COLOR_.blue }, G = { color: COLOR_.green };
  sb.put(1, 1, 'Incrementalidade da venda via CRM por etapa de captura anterior à sessão de compra (WL BR, aquisições confirmadas, ' + fmtDateBr_(P.start) + ' a ' + fmtDateBr_(P.end) + ')', { bold: true, size: 13 });
  sb.put(2, 1, 'Venda via CRM = aquisição confirmada com cupom da lista do SQL de CRM. Classe = etapa mais profunda de captura do email antes do início da sessão de compra (sem duplicidade: cada cliente cai em uma única classe).', { italic: true, size: 9 });
  sb.header(4, 1, ['Classe', 'Descrição', 'Aquisições', 'Com cupom CRM', '% CRM', 'Receita líquida CRM', 'Receita líquida não CRM', 'Líquido médio CRM', 'Líquido médio não CRM', 'Desconto médio CRM', 'Desconto médio não CRM', 'Prêmio de desconto do CRM'], 44);
  CLASSES_.forEach(function (k, i) {
    const r = 5 + i, c = O.classes[k];
    sb.put(r, 1, k, { bold: true }); sb.put(r, 2, CLASS_DESC_[k]);
    sb.put(r, 3, c.n, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 4, c.crm, { color: COLOR_.blue, fmt: FMT_.num });
    sb.put(r, 5, '=IF(C' + r + '=0,0,D' + r + '/C' + r + ')', { fmt: FMT_.pct });
    sb.put(r, 6, c.netCrm, { color: COLOR_.blue, fmt: FMT_.brl }); sb.put(r, 7, c.netNon, { color: COLOR_.blue, fmt: FMT_.brl });
    sb.put(r, 8, '=IF(D' + r + '=0,0,F' + r + '/D' + r + ')', { fmt: FMT_.brl }); sb.put(r, 9, '=IF(C' + r + '-D' + r + '=0,0,G' + r + '/(C' + r + '-D' + r + '))', { fmt: FMT_.brl });
    sb.put(r, 10, div_(c.discCrm, c.crm), { color: COLOR_.blue, fmt: FMT_.brl }); sb.put(r, 11, div_(c.discNon, c.n - c.crm), { color: COLOR_.blue, fmt: FMT_.brl });
    sb.put(r, 12, '=J' + r + '-K' + r, { fmt: FMT_.brl });
  });
  sb.put(10, 1, 'Total', { bold: true, fill: FILL_.total });
  [3, 4, 6, 7].forEach(function (c) { sb.put(10, c, '=SUM(' + colL_(c) + '5:' + colL_(c) + '9)', { bold: true, fill: FILL_.total, fmt: c < 5 ? FMT_.num : FMT_.brl }); });
  sb.put(10, 5, '=IF(C10=0,0,D10/C10)', { bold: true, fill: FILL_.total, fmt: FMT_.pct });

  sb.put(12, 1, 'Engajamento CRM dos pedidos com cupom (quanto o toque de email está próximo da compra)', { bold: true, size: 11 });
  sb.header(13, 1, ['Classe', 'Pedidos CRM', 'Clique até 24h', 'Abertura até 24h', 'Envio até 24h', 'Sem toque até 24h', '% clique até 24h', '% envio ou menos', 'Sessão de compra veio de utm crm', '% sessão CRM'], 44);
  CLASSES_.forEach(function (k, i) {
    const r = 14 + i, t = O.tiers[k];
    sb.put(r, 1, k, { bold: true }); sb.put(r, 2, '=D' + (5 + i), { fmt: FMT_.num });
    TIER_KEYS_.forEach(function (tk, j) { sb.put(r, 3 + j, t[tk] || 0, { color: COLOR_.blue, fmt: FMT_.num }); });
    sb.put(r, 7, '=IF(B' + r + '=0,0,C' + r + '/B' + r + ')', { fmt: FMT_.pct }); sb.put(r, 8, '=IF(B' + r + '=0,0,(E' + r + '+F' + r + ')/B' + r + ')', { fmt: FMT_.pct });
    sb.put(r, 9, t.crmSess, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 10, '=IF(B' + r + '=0,0,I' + r + '/B' + r + ')', { fmt: FMT_.pct });
  });

  sb.put(20, 1, 'Contraste de exposição ao CRM (marco de 24h após a primeira captura; desfecho em 14 dias a partir do marco)', { bold: true, size: 11 });
  sb.put(21, 1, 'Leads que ainda não tinham comprado no marco. Exposto = recebeu ao menos 1 email entregue entre 24h e 8 dias após a captura. Não é experimento: leads sem entrega tendem a ser inalcançáveis ou menos engajados, então o lift abaixo é um teto, não uma estimativa causal.', { italic: true, size: 9 });
  sb.header(22, 1, ['Classe no marco', 'Expostos (elegíveis 14d)', 'Conversões expostos', 'Taxa expostos', 'Não expostos (elegíveis 14d)', 'Conversões não expostos', 'Taxa não expostos', 'Lift absoluto (p.p.)', 'Share incremental (teto)', 'Conv CRM expostos', 'Taxa CRM expostos', 'Receita líquida 14d expostos'], 56);
  ['A', 'B', 'C'].forEach(function (k, i) {
    const r = 23 + i, e = L.land[k + '|sim'] || {}, n = L.land[k + '|nao'] || {};
    sb.put(r, 1, k, { bold: true });
    sb.put(r, 2, e.l_el14 || 0, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 3, e.l_cv14 || 0, { color: COLOR_.blue, fmt: FMT_.num });
    sb.put(r, 4, '=IF(B' + r + '=0,0,C' + r + '/B' + r + ')', { fmt: FMT_.pct2 });
    sb.put(r, 5, n.l_el14 || 0, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 6, n.l_cv14 || 0, { color: COLOR_.blue, fmt: FMT_.num });
    sb.put(r, 7, '=IF(E' + r + '=0,0,F' + r + '/E' + r + ')', { fmt: FMT_.pct2 });
    sb.put(r, 8, '=(D' + r + '-G' + r + ')*100', { fmt: '0.00' });
    sb.put(r, 9, '=IF(D' + r + '=0,0,MAX(0,(D' + r + '-G' + r + ')/D' + r + '))', { fmt: FMT_.pct });
    sb.put(r, 10, e.l_cr14 || 0, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 11, '=IF(B' + r + '=0,0,J' + r + '/B' + r + ')', { fmt: FMT_.pct2 });
    sb.put(r, 12, e.l_net14 || 0, { color: COLOR_.blue, fmt: FMT_.brl });
  });
  sb.put(26, 1, 'Classe C no marco tem poucos não expostos (n pequeno): ler com cautela.', { italic: true, size: 9 });

  // pré e pós lançamento
  const launch = P.launch, minus14 = addDays_(launch, -14);
  const lastObs = addDays_(todayBr_(), -9); // coortes com 7 dias completos após o marco
  const preFrom = minus14 < P.start ? P.start : minus14, preTo = addDays_(launch, -1);
  const posFrom = launch, posTo = P.end < lastObs ? P.end : lastObs;
  sb.put(28, 1, 'Antes e depois do lançamento do retargeting (jornadas Retargeting_All e Retargeting_RecentLeads, ativas em ' + fmtDateBr_(launch) + ')', { bold: true, size: 11 });
  sb.put(29, 1, 'Coortes por data da primeira captura; desfecho de 7 dias a partir do marco de 24h. A mistura de leads muda no período (mais mídia), então não isola o efeito do CRM. Só aparece se o período escolhido cobre as datas.', { italic: true, size: 9 });
  sb.header(30, 1, ['Período', 'Início', 'Fim', 'Leads elegíveis 7d', 'Conv 7d', 'Taxa conv 7d', 'Conv CRM 7d', 'Taxa CRM 7d']);
  [['Antes (14 dias)', preFrom, preTo], ['Depois', posFrom, posTo]].forEach(function (x, i) {
    const r = 31 + i, ok = x[1] <= x[2];
    const s = ok ? sumLand_(L.landRows, x[1], x[2], ['l_el7', 'l_cv7', 'l_cr7']) : { l_el7: 0, l_cv7: 0, l_cr7: 0 };
    sb.put(r, 1, x[0], { bold: true }); sb.put(r, 2, isoToDate_(x[1]), { color: COLOR_.blue, fmt: FMT_.date }); sb.put(r, 3, isoToDate_(x[2]), { color: COLOR_.blue, fmt: FMT_.date });
    sb.put(r, 4, s.l_el7, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 5, s.l_cv7, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 6, '=IF(D' + r + '=0,0,E' + r + '/D' + r + ')', { fmt: FMT_.pct2 });
    sb.put(r, 7, s.l_cr7, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 8, '=IF(D' + r + '=0,0,G' + r + '/D' + r + ')', { fmt: FMT_.pct2 });
    if (!ok) sb.put(r, 9, 'Período fora do intervalo escolhido ou sem dias completos', { color: COLOR_.red });
  });

  sb.put(35, 1, 'Ponto de equilíbrio do cupom CRM (prêmio de desconto vs margem do pedido incremental)', { bold: true, size: 11 });
  sb.put(36, 1, 'Se o cliente compraria de qualquer forma, o CRM custa só a diferença de desconto vs a promoção que ele usaria. Se é incremental, gera a margem do pedido inteiro.', { italic: true, size: 9 });
  sb.put(37, 1, 'Margem de contribuição sobre a receita líquida (premissa, preencher)', { bold: true });
  sb.put(37, 5, P.margin, { color: COLOR_.blue, fmt: FMT_.pct, fill: FILL_.yellow });
  sb.put(37, 6, 'Sem COGS na base: o valor padrão é placeholder. Ajuste com a margem real.', { color: COLOR_.red });
  sb.header(39, 1, ['Classe', 'Líquido médio CRM', 'Prêmio de desconto', 'Margem por pedido incremental', 'Share incremental de equilíbrio', 'Share incremental teto (exposição)', 'Folga vs teto'], 44);
  ['A', 'B', 'C'].forEach(function (k, i) {
    const r = 40 + i;
    sb.put(r, 1, k, { bold: true }); sb.put(r, 2, '=H' + (5 + i), { fmt: FMT_.brl }); sb.put(r, 3, '=MAX(0,L' + (5 + i) + ')', { fmt: FMT_.brl });
    sb.put(r, 4, '=B' + r + '*$E$37', { fmt: FMT_.brl }); sb.put(r, 5, '=IF(C' + r + '+D' + r + '=0,0,C' + r + '/(C' + r + '+D' + r + '))', { fmt: FMT_.pct });
    sb.put(r, 6, '=I' + (23 + i), { fmt: FMT_.pct }); sb.put(r, 7, '=F' + r + '-E' + r, { fmt: FMT_.pct });
  });
  // holdout
  const lastDay = P.end, from21 = addDays_(lastDay, -20);
  const sB = sumLand_(L.landRows, from21 < P.start ? P.start : from21, lastDay, ['l_leads'], 'B').l_leads;
  sb.put(44, 1, 'Dimensionamento de holdout para medir incrementalidade de verdade (10% a 20% dos leads fora do retargeting)', { bold: true, size: 11 });
  sb.put(45, 1, 'Taxa base de conversão em 14 dias (classe B, expostos)'); sb.put(45, 5, '=D24', { fmt: FMT_.pct2 });
  sb.put(46, 1, 'Lift relativo mínimo a detectar'); sb.put(46, 5, 0.2, { color: COLOR_.blue, fmt: FMT_.pct, fill: FILL_.yellow });
  sb.put(47, 1, 'z alfa/2 (95%) + z beta (80% poder)'); sb.put(47, 5, 2.8, { color: COLOR_.blue, fmt: '0.00', fill: FILL_.yellow });
  sb.put(48, 1, 'Leads por braço', { bold: true }); sb.put(48, 5, '=IF(E45=0,0,ROUNDUP(2*E47^2*E45*(1-E45)/(E45*E46)^2,0))', { fmt: FMT_.num });
  sb.put(49, 1, 'Novos leads classe B por semana (média dos últimos 21 dias do período)'); sb.put(49, 5, sB / 3, { color: COLOR_.blue, fmt: FMT_.num });
  sb.put(50, 1, 'Semanas para fechar o holdout com 20% da base', { bold: true }); sb.put(50, 5, '=IF(E49=0,0,E48/(E49*0.2))', { fmt: '0.0' });
  wid_(sb, { 1: 90, 2: 330 }); for (let c = 3; c <= 12; c++) sb.widths[c] = 112;
  sb.flush();
}

/** ---------- Captura x UTM campaign ---------- */
function writeCampaign_(sh, O, P) {
  const sb = new SB_(sh);
  sb.put(1, 1, 'Volume de capturas por etapa e UTM campaign (capturado antes da sessão de compra) e aquisições por etapa', { bold: true, size: 13 });
  sb.put(2, 1, 'Cada cliente aparece uma vez, na classe da etapa mais profunda. A UTM campaign é a da captura mais recente da própria etapa (pop-up ou questionário) e, no checkout, a da sessão do primeiro pedido. Questionário sem UTM até 28/09/2026 aparece como (sem utm).', { italic: true, size: 9 });
  sb.header(4, 1, ['UTM campaign', 'A pop-up apenas', 'B questionário', 'C checkout', 'Total aquisições', '% do total', 'A com CRM', 'B com CRM', 'C com CRM', 'Total com CRM', '% CRM'], 32);
  const names = O.campaignOrder, nR = names.length, tot = 5 + nR + 1, ro = 5 + nR;
  names.forEach(function (n, i) {
    const r = 5 + i, c = O.campaigns[n];
    sb.put(r, 1, n, { color: COLOR_.blue });
    ['A', 'B', 'C'].forEach(function (k, j) { sb.put(r, 2 + j, c[k], { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 7 + j, c[k + 'crm'], { color: COLOR_.blue, fmt: FMT_.num }); });
    sb.put(r, 5, '=SUM(B' + r + ':D' + r + ')', { fmt: FMT_.num }); sb.put(r, 6, '=IF($E$' + tot + '=0,0,E' + r + '/$E$' + tot + ')', { fmt: FMT_.pct });
    sb.put(r, 10, '=SUM(G' + r + ':I' + r + ')', { fmt: FMT_.num }); sb.put(r, 11, '=IF(E' + r + '=0,0,J' + r + '/E' + r + ')', { fmt: FMT_.pct });
  });
  sb.put(ro, 1, 'Outras campanhas', { bold: true }); sb.put(tot, 1, 'Total A+B+C', { bold: true, fill: FILL_.total });
  ['A', 'B', 'C'].forEach(function (k, j) {
    sb.put(tot, 2 + j, O.classes[k].n, { color: COLOR_.blue, bold: true, fmt: FMT_.num, fill: FILL_.total });
    sb.put(tot, 7 + j, O.classes[k].crm, { color: COLOR_.blue, bold: true, fmt: FMT_.num, fill: FILL_.total });
    sb.put(ro, 2 + j, '=' + colL_(2 + j) + tot + '-SUM(' + colL_(2 + j) + '5:' + colL_(2 + j) + (ro - 1) + ')', { fmt: FMT_.num });
    sb.put(ro, 7 + j, '=' + colL_(7 + j) + tot + '-SUM(' + colL_(7 + j) + '5:' + colL_(7 + j) + (ro - 1) + ')', { fmt: FMT_.num });
  });
  [ro, tot].forEach(function (r) {
    const o = r === tot ? { bold: true, fill: FILL_.total } : {};
    sb.put(r, 5, '=SUM(B' + r + ':D' + r + ')', Object.assign({ fmt: FMT_.num }, o)); sb.put(r, 6, '=IF($E$' + tot + '=0,0,E' + r + '/$E$' + tot + ')', Object.assign({ fmt: FMT_.pct }, o));
    sb.put(r, 10, '=SUM(G' + r + ':I' + r + ')', Object.assign({ fmt: FMT_.num }, o)); sb.put(r, 11, '=IF(E' + r + '=0,0,J' + r + '/E' + r + ')', Object.assign({ fmt: FMT_.pct }, o));
  });
  wid_(sb, { 1: 330 }); for (let c = 2; c <= 11; c++) sb.widths[c] = 100;
  sb.freeze = { rows: 4, cols: 1 };
  sb.flush();
}

/** ---------- Captura x UTM source ---------- */
function writeSource_(sh, O, L, P) {
  const sb = new SB_(sh);
  sb.put(1, 1, 'Captura por UTM source: compradores por etapa (base de pedidos) e funil de leads por primeira etapa', { bold: true, size: 13 });
  sb.header(3, 1, ['UTM source da captura', 'A pop-up apenas', 'B questionário', 'C checkout', 'Total aquisições', '% CRM (A+B+C)', 'Aquisições com CRM'], 32);
  const ro = 4 + SOURCES_.length, tot = ro + 1;
  SOURCES_.forEach(function (s, i) {
    const r = 4 + i, x = O.srcOrders[s] || { A: 0, B: 0, C: 0, crm: 0 };
    sb.put(r, 1, s, { color: COLOR_.blue });
    ['A', 'B', 'C'].forEach(function (k, j) { sb.put(r, 2 + j, x[k], { color: COLOR_.blue, fmt: FMT_.num }); });
    sb.put(r, 5, '=SUM(B' + r + ':D' + r + ')', { fmt: FMT_.num }); sb.put(r, 7, x.crm, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 6, '=IF(E' + r + '=0,0,G' + r + '/E' + r + ')', { fmt: FMT_.pct });
  });
  sb.put(ro, 1, 'Outras fontes ou sem sessão registrada (principalmente classe C)', { bold: true }); sb.put(tot, 1, 'Total A+B+C', { bold: true, fill: FILL_.total });
  let totCrm = 0;
  ['A', 'B', 'C'].forEach(function (k, j) {
    totCrm += O.classes[k].crm;
    sb.put(tot, 2 + j, O.classes[k].n, { color: COLOR_.blue, bold: true, fmt: FMT_.num, fill: FILL_.total });
    sb.put(ro, 2 + j, '=' + colL_(2 + j) + tot + '-SUM(' + colL_(2 + j) + '4:' + colL_(2 + j) + (ro - 1) + ')', { fmt: FMT_.num });
  });
  sb.put(tot, 7, totCrm, { color: COLOR_.blue, bold: true, fmt: FMT_.num, fill: FILL_.total }); sb.put(ro, 7, '=G' + tot + '-SUM(G4:G' + (ro - 1) + ')', { fmt: FMT_.num });
  [ro, tot].forEach(function (r) {
    const o = r === tot ? { bold: true, fill: FILL_.total } : {};
    sb.put(r, 5, '=SUM(B' + r + ':D' + r + ')', Object.assign({ fmt: FMT_.num }, o)); sb.put(r, 6, '=IF(E' + r + '=0,0,G' + r + '/E' + r + ')', Object.assign({ fmt: FMT_.pct }, o));
  });
  sb.put(tot + 2, 1, 'Funil de leads por primeira etapa de captura (coortes a partir de ' + fmtDateBr_(P.utmFromEff) + ', desfecho em 14 dias desde a captura)', { bold: true, size: 11 });
  sb.header(tot + 3, 1, ['Primeira etapa', 'Leads na coorte', 'Elegíveis 14d', 'Conversões 14d', 'Taxa conv 14d', 'Conversões CRM 14d', 'Taxa CRM 14d'], 44);
  [['popup', 'Pop-up'], ['quiz', 'Questionário']].forEach(function (x, i) {
    const r = tot + 4 + i, s = L.srcStep[x[0]] || {};
    sb.put(r, 1, x[1], { bold: true }); sb.put(r, 2, s.leads || 0, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 3, s.s_el14 || 0, { color: COLOR_.blue, fmt: FMT_.num });
    sb.put(r, 4, s.s_cv14 || 0, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 5, '=IF(C' + r + '=0,0,D' + r + '/C' + r + ')', { fmt: FMT_.pct2 });
    sb.put(r, 6, s.s_cr14 || 0, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 7, '=IF(C' + r + '=0,0,F' + r + '/C' + r + ')', { fmt: FMT_.pct2 });
  });
  wid_(sb, { 1: 330 }); for (let c = 2; c <= 7; c++) sb.widths[c] = 112;
  sb.flush();
}

/** ---------- Tempo até conversão ---------- */
function writeTempo_(sh, O, L, P) {
  const sb = new SB_(sh);
  const bl = ['até 1h', '1h a 6h', '6h a 24h', '1 a 3 dias', '3 a 7 dias', '7 a 14 dias', '14 a 30 dias', 'mais de 30 dias'];
  sb.put(1, 1, 'Tempo até a conversão depois da captura', { bold: true, size: 13 });
  sb.put(3, 1, '1) Compradores: distribuição do intervalo entre a captura da etapa e o início da sessão de compra', { bold: true, size: 11 });
  function block(r0, key, title) {
    sb.header(r0, 1, ['Classe', title].concat(bl).concat(['Mediana (h)', 'P25 (h)', 'P75 (h)', 'P90 (h)']), 32);
    ['A', 'B', 'C'].forEach(function (k, i) {
      const r = r0 + 1 + i, t = O[key][k];
      sb.put(r, 1, k, { bold: true }); sb.put(r, 2, t.n, { color: COLOR_.blue, fmt: FMT_.num });
      BUCKET_KEYS_.forEach(function (b, j) { sb.put(r, 3 + j, '=IF($B' + r + '=0,0,' + t[b] + '/$B' + r + ')', { fmt: FMT_.pct }); });
      [t.q.p50, t.q.p25, t.q.p75, t.q.p90].forEach(function (v, j) { sb.put(r, 11 + j, v === null ? '' : Math.round(v * 10) / 10, { color: COLOR_.blue, fmt: FMT_.dec1 }); });
    });
  }
  block(4, 'time', 'Aquisições');
  sb.put(8, 1, 'Mesma tabela para pedidos com cupom CRM', { bold: true, size: 11 });
  block(9, 'timeCrm', 'Aquisições CRM');
  sb.put(14, 1, 'Compradores com captura visível só a partir de ' + fmtDateBr_(P.dataStart) + ': o intervalo longo está subestimado, principalmente nas primeiras semanas. Classe C usa a data de criação da conta, que pode ser bem anterior.', { italic: true, size: 9 });
  sb.put(16, 1, '2) Leads: conversão acumulada desde a primeira captura (coortes elegíveis a 14 dias completos, a partir de ' + fmtDateBr_(P.utmFromEff) + ')', { bold: true, size: 11 });
  sb.header(17, 1, ['Janela', 'Conversões acumuladas', '% do total em 14d', 'Conversões CRM acumuladas', '% do total CRM em 14d', 'Taxa de conversão acumulada (leads)', 'Taxa CRM acumulada (leads)'], 44);
  const bk = L.buckets, el = (L.srcAll && L.srcAll.s_el14) || 0;
  const win = [['até 1h', bk.s_b1h, null], ['até 6h', bk.s_b6h, null], ['até 1 dia', bk.s_b1d, bk.s_c1d], ['até 3 dias', bk.s_b3d, bk.s_c3d], ['até 7 dias', bk.s_b7d, bk.s_c7d], ['até 14 dias', bk.s_b14d, bk.s_c14d]];
  win.forEach(function (w, i) {
    const r = 18 + i;
    sb.put(r, 1, w[0], { bold: true }); sb.put(r, 2, w[1], { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 3, '=IF($B$23=0,0,B' + r + '/$B$23)', { fmt: FMT_.pct });
    if (w[2] === null) { sb.put(r, 4, 'n/d'); sb.put(r, 5, 'n/d'); sb.put(r, 7, 'n/d'); }
    else { sb.put(r, 4, w[2], { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 5, '=IF($D$23=0,0,D' + r + '/$D$23)', { fmt: FMT_.pct }); sb.put(r, 7, '=IF($B$25=0,0,D' + r + '/$B$25)', { fmt: FMT_.pct2 }); }
    sb.put(r, 6, '=IF($B$25=0,0,B' + r + '/$B$25)', { fmt: FMT_.pct2 });
  });
  sb.put(25, 1, 'Leads elegíveis (14d)', { bold: true }); sb.put(25, 2, el, { color: COLOR_.blue, fmt: FMT_.num });
  wid_(sb, { 1: 150 }); for (let c = 2; c <= 14; c++) sb.widths[c] = 100;
  sb.flush();
}

/** ---------- Rentabilidade e probabilidade por UTM ---------- */
function writeRent_(sh, O, L, P) {
  const sb = new SB_(sh);
  sb.put(1, 1, 'Rentabilidade do cliente e probabilidade de converter por CRM, por UTM source da captura', { bold: true, size: 13 });
  sb.put(2, 1, 'Coortes de leads capturados a partir de ' + fmtDateBr_(P.utmFromEff) + ' (a UTM do questionário só é confiável desde 28/09/2026). Desfecho: primeira aquisição confirmada em até 7 e 14 dias da captura. Receita = líquida do primeiro pedido, sem COGS e sem recorrência (janela curta).', { italic: true, size: 9 });
  sb.put(3, 1, 'Margem de contribuição (premissa)', { bold: true }); sb.put(3, 4, '=Incrementalidade!E37', { color: COLOR_.green, fmt: FMT_.pct });
  sb.put(4, 1, 'z para intervalo de confiança', { bold: true }); sb.put(4, 4, 1.96, { color: COLOR_.blue, fmt: '0.00' });
  sb.header(6, 1, ['UTM source', 'Elegíveis 7d', 'P(conv 7d)', 'Conv CRM 7d', 'P(CRM 7d)', 'IC95% inf', 'IC95% sup', 'Elegíveis 14d', 'P(conv 14d)', 'Conv CRM 14d', 'P(CRM 14d)', 'IC95% inf', 'IC95% sup', 'Receita líq 14d', 'Receita líq por lead', 'Líquido médio por comprador', 'Desconto médio por comprador', 'Receita líq CRM por lead', 'Contribuição por lead'], 58);
  const wil = function (p, n, side, r) {
    const sign = side === 'lo' ? '-' : '+';
    return '=IF(' + n + r + '=0,0,(' + p + r + '+$D$4^2/(2*' + n + r + ')' + sign + '$D$4*SQRT(' + p + r + '*(1-' + p + r + ')/' + n + r + '+$D$4^2/(4*' + n + r + '^2)))/(1+$D$4^2/' + n + r + '))';
  };
  LEAD_SOURCES_.forEach(function (u, i) {
    const r = 7 + i, s = L.src[u] || {};
    const cv7 = s.s_cv7 || 0, cv14 = s.s_cv14 || 0;
    sb.put(r, 1, u, { color: COLOR_.blue });
    sb.put(r, 2, s.s_el7 || 0, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 3, div_(cv7, s.s_el7 || 0), { color: COLOR_.blue, fmt: FMT_.pct2 });
    sb.put(r, 4, s.s_cr7 || 0, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 5, '=IF(B' + r + '=0,0,D' + r + '/B' + r + ')', { fmt: FMT_.pct2 });
    sb.put(r, 6, wil('E', 'B', 'lo', r), { fmt: FMT_.pct2 }); sb.put(r, 7, wil('E', 'B', 'hi', r), { fmt: FMT_.pct2 });
    sb.put(r, 8, s.s_el14 || 0, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 9, div_(cv14, s.s_el14 || 0), { color: COLOR_.blue, fmt: FMT_.pct2 });
    sb.put(r, 10, s.s_cr14 || 0, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 11, '=IF(H' + r + '=0,0,J' + r + '/H' + r + ')', { fmt: FMT_.pct2 });
    sb.put(r, 12, wil('K', 'H', 'lo', r), { fmt: FMT_.pct2 }); sb.put(r, 13, wil('K', 'H', 'hi', r), { fmt: FMT_.pct2 });
    sb.put(r, 14, s.s_net14 || 0, { color: COLOR_.blue, fmt: FMT_.brl }); sb.put(r, 15, '=IF(H' + r + '=0,0,N' + r + '/H' + r + ')', { fmt: FMT_.brl });
    sb.put(r, 16, cv14 ? (s.s_net14 || 0) / cv14 : 0, { color: COLOR_.blue, fmt: FMT_.brl }); sb.put(r, 17, cv14 ? (s.s_disc14 || 0) / cv14 : 0, { color: COLOR_.blue, fmt: FMT_.brl });
    sb.put(r, 18, '=IF(H' + r + '=0,0,' + (s.s_net14crm || 0) + '/H' + r + ')', { fmt: FMT_.brl }); sb.put(r, 19, '=O' + r + '*$D$3', { fmt: FMT_.brl });
  });
  const rt = 7 + LEAD_SOURCES_.length;
  sb.put(rt, 1, 'Total', { bold: true, fill: FILL_.total });
  [2, 4, 8, 10, 14].forEach(function (c) { sb.put(rt, c, '=SUM(' + colL_(c) + '7:' + colL_(c) + (rt - 1) + ')', { bold: true, fill: FILL_.total, fmt: c === 14 ? FMT_.brl : FMT_.num }); });
  sb.put(rt, 3, '=IF(B' + rt + '=0,0,SUMPRODUCT(B7:B' + (rt - 1) + ',C7:C' + (rt - 1) + ')/B' + rt + ')', { bold: true, fill: FILL_.total, fmt: FMT_.pct2 });
  sb.put(rt, 5, '=IF(B' + rt + '=0,0,D' + rt + '/B' + rt + ')', { bold: true, fill: FILL_.total, fmt: FMT_.pct2 });
  sb.put(rt, 9, '=IF(H' + rt + '=0,0,SUMPRODUCT(H7:H' + (rt - 1) + ',I7:I' + (rt - 1) + ')/H' + rt + ')', { bold: true, fill: FILL_.total, fmt: FMT_.pct2 });
  sb.put(rt, 11, '=IF(H' + rt + '=0,0,J' + rt + '/H' + rt + ')', { bold: true, fill: FILL_.total, fmt: FMT_.pct2 });
  sb.put(rt, 15, '=IF(H' + rt + '=0,0,N' + rt + '/H' + rt + ')', { bold: true, fill: FILL_.total, fmt: FMT_.brl });
  sb.put(rt + 1, 1, 'Linhas com poucos leads elegíveis (tiktok, affiliates, outros) são ruído: veja o intervalo de confiança. P(conv) soma conversões de qualquer origem; P(CRM) só as com cupom da lista do SQL.', { italic: true, size: 9 });
  sb.put(rt + 3, 1, 'Compradores por UTM source da captura (base de pedidos, só classes A, B e C)', { bold: true, size: 11 });
  sb.header(rt + 4, 1, ['UTM source', 'Aquisições', 'Com CRM', '% CRM', 'Líquido médio', 'Desconto médio', 'Bruto médio', 'Taxa de desconto'], 32);
  SOURCES_.forEach(function (s, i) {
    const r = rt + 5 + i, x = O.srcOrders[s] || { n: 0, crm: 0, net: 0, disc: 0, gross: 0 };
    sb.put(r, 1, s, { color: COLOR_.blue }); sb.put(r, 2, x.n, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 3, x.crm, { color: COLOR_.blue, fmt: FMT_.num });
    sb.put(r, 4, '=IF(B' + r + '=0,0,C' + r + '/B' + r + ')', { fmt: FMT_.pct }); sb.put(r, 5, div_(x.net, x.n), { color: COLOR_.blue, fmt: FMT_.brl });
    sb.put(r, 6, div_(x.disc, x.n), { color: COLOR_.blue, fmt: FMT_.brl }); sb.put(r, 7, div_(x.gross, x.n), { color: COLOR_.blue, fmt: FMT_.brl });
    sb.put(r, 8, '=IF(G' + r + '=0,0,F' + r + '/G' + r + ')', { fmt: FMT_.pct });
  });
  wid_(sb, { 1: 150 }); for (let c = 2; c <= 19; c++) sb.widths[c] = 100;
  sb.flush();
}

/** ---------- Extras ---------- */
function writeExtras_(sh, O, P) {
  const sb = new SB_(sh);
  sb.put(1, 1, 'Outras análises', { bold: true, size: 13 });
  sb.put(3, 1, '1) Mix de cupom nas aquisições CRM', { bold: true, size: 11 });
  sb.header(4, 1, ['Promoção', 'Pedidos', '% dos pedidos CRM', 'Desconto médio', 'Líquido médio']);
  const promos = O.promoOrder.filter(function (p) { return CRM_PROMOS_.indexOf(p) >= 0; });
  promos.forEach(function (p, i) {
    const r = 5 + i, x = O.promos[p];
    sb.put(r, 1, p, { color: COLOR_.blue }); sb.put(r, 2, x.n, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 3, '=B' + r + '/SUM($B$5:$B$' + (4 + promos.length) + ')', { fmt: FMT_.pct });
    sb.put(r, 4, div_(x.disc, x.n), { color: COLOR_.blue, fmt: FMT_.brl }); sb.put(r, 5, div_(x.net, x.n), { color: COLOR_.blue, fmt: FMT_.brl });
  });
  let r2 = 6 + promos.length;
  sb.put(r2, 1, '2) Campanhas de CRM que recebem a atribuição (último clique, senão última abertura, senão último envio em 30 dias)', { bold: true, size: 11 });
  sb.header(r2 + 1, 1, ['Campanha', 'Pedidos CRM', '% do total', 'Classe A', 'Classe B', 'Classe C', 'Classe D']);
  const totCrm = CLASSES_.reduce(function (a, k) { return a + O.classes[k].crm; }, 0);
  O.campAttrOrder.forEach(function (c, i) {
    const r = r2 + 2 + i, x = O.campAttr[c];
    sb.put(r, 1, c, { color: COLOR_.blue }); sb.put(r, 2, O.campAttrCount[c], { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 3, totCrm ? '=B' + r + '/' + totCrm : 0, { fmt: FMT_.pct });
    ['A', 'B', 'C', 'D'].forEach(function (k, j) { sb.put(r, 4 + j, x[k], { color: COLOR_.blue, fmt: FMT_.num }); });
  });
  const r3 = r2 + 3 + O.campAttrOrder.length;
  sb.put(r3, 1, '3) Tendência semanal das aquisições e do share CRM', { bold: true, size: 11 });
  sb.header(r3 + 1, 1, ['Semana (início)', 'Aquisições', 'Com CRM', '% CRM', 'Líquido médio', 'Observação']);
  Object.keys(O.weekly).sort().forEach(function (w, i) {
    const r = r3 + 2 + i, x = O.weekly[w];
    sb.put(r, 1, isoToDate_(w), { color: COLOR_.blue, fmt: FMT_.date }); sb.put(r, 2, x.n, { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 3, x.crm, { color: COLOR_.blue, fmt: FMT_.num });
    sb.put(r, 4, '=IF(B' + r + '=0,0,C' + r + '/B' + r + ')', { fmt: FMT_.pct }); sb.put(r, 5, div_(x.net, x.n), { color: COLOR_.blue, fmt: FMT_.brl });
    if (w <= P.launch && addDays_(w, 6) >= P.launch) sb.put(r, 6, 'Retargeting_All e RecentLeads entram em ' + fmtDateBr_(P.launch), { color: COLOR_.red });
    const lastComplete = P.end < addDays_(todayBr_(), -1) ? P.end : addDays_(todayBr_(), -1);
    if (w < P.start || addDays_(w, 6) > lastComplete) sb.put(r, 6, 'Semana parcial no período', { color: COLOR_.red });
  });
  const r4 = r3 + 3 + Object.keys(O.weekly).length;
  sb.put(r4, 1, '4) Origem da sessão de compra dos pedidos com cupom CRM', { bold: true, size: 11 });
  sb.header(r4 + 1, 1, ['UTM source da sessão', 'Pedidos CRM', '%']);
  O.sessionOrder.forEach(function (s, i) {
    const r = r4 + 2 + i; sb.put(r, 1, s, { color: COLOR_.blue }); sb.put(r, 2, O.sessionSrc[s], { color: COLOR_.blue, fmt: FMT_.num }); sb.put(r, 3, totCrm ? '=B' + r + '/' + totCrm : 0, { fmt: FMT_.pct });
  });
  wid_(sb, { 1: 330, 2: 90, 3: 100, 4: 100, 5: 100, 6: 300 });
  sb.flush();
}

/** ---------- Metodologia ---------- */
function writeMetodologia_(sh, P) {
  const sb = new SB_(sh);
  const L = [
    ['Metodologia, definições e limitações', { bold: true, size: 13 }],
    ['Escopo: Voy (WL), Brasil, aquisições (order_context acquisition) confirmadas, checkout de ' + fmtDateBr_(P.start) + ' a ' + fmtDateBr_(P.end) + ' (fuso America/Sao_Paulo). Mesma base do SQL de CRM enviado (categoria Weight Loss, Brasil).', {}],
    ['Venda via CRM: promotion_code na lista do SQL (' + CRM_PROMOS_.join(', ') + '). Fonte do código: crm_atribuicao_cupons. O flag is_cupom_crm da tabela não é igual a essa lista (marca menos pedidos), por isso a lista é usada.', {}],
    ['Etapas de captura (Customer.io da Voy): pop-up = evento form_submit (formulários wl-br-popup-*, inclui captura de rodapé); questionário = evento questionnaire_lead (email e telefone); checkout = criação da conta (dim_customer_created_at), que coincide com o início do primeiro pedido.', {}],
    ['Sessão de compra: sessão em webhook_v2_order_sessions_lake (início da sessão). Quando não há sessão para o pedido, usa o checkout menos 10 minutos. Captura anterior = ocorreu antes do início da sessão de compra.', {}],
    ['Classes sem duplicidade (hierarquia): C se a conta foi criada antes da sessão de compra; senão B se houve questionário antes; senão A se houve pop-up antes; D se não há captura prévia visível; X se o pedido não tem email vinculado.', {}],
    ['Limitação 1: o histórico de eventos de captura no lake começa em ' + fmtDateBr_(P.dataStart) + '. Quem foi capturado antes disso aparece como D, então A, B e C ficam subestimados e D superestimado, principalmente nas primeiras semanas.', { color: COLOR_.red }],
    ['Limitação 2: a UTM do questionário só é registrada de forma confiável desde 28/09/2026; antes, a maioria dos leads vem sem UTM. As análises por UTM source usam coortes a partir da data "UTM confiável desde" definida no painel.', { color: COLOR_.red }],
    ['Limitação 3: não há grupo de controle nas jornadas CRM, então incrementalidade causal não é identificável. O contraste expostos vs não expostos é um teto; o antes e depois do lançamento do retargeting mistura mudança de mix de mídia.', { color: COLOR_.red }],
    ['Limitação 4: sem COGS e sem recorrência na janela, a rentabilidade usa receita líquida do primeiro pedido; a margem de contribuição é uma premissa editável.', { color: COLOR_.red }],
    ['Sessão anterior à compra: o lake não traz as sessões da jornada, só a sessão do pedido. A captura mais recente da etapa antes dessa sessão faz o papel de captura na sessão anterior; a aba Tempo até conversão mostra a distância entre as duas.', {}],
    ['Marco de 24h (análise de leads): classe do lead = etapa mais profunda até 24h após a primeira captura; desfecho contado só depois do marco, para evitar viés de olhar o futuro. Lead que já comprou antes de capturar é excluído. Janelas dos desfechos só entram quando completas até 00:00 de hoje (fuso Brasil).', {}],
    ['Contagens vêm do BigQuery (azul); razões, totais e intervalos de confiança são fórmulas. A aba Base pedidos traz 1 linha por aquisição para tabelas dinâmicas.', {}],
    ['Convenções de cor: azul = dado trazido do BigQuery ou premissa; verde = fórmula que lê outra aba; preto = fórmula local; vermelho = alerta; fundo amarelo = premissa para editar.', {}]
  ];
  L.forEach(function (x, i) { sb.put(i + 1, 1, x[0], Object.assign({ wrap: true }, x[1])); sb.heights[i + 1] = i === 0 ? 24 : 46; });
  sb.widths[1] = 900;
  sb.flush();
}

/** ---------- Base pedidos ---------- */
const BASE_COLS_ = ['order_id', 'data_brt', 'cls', 'is_crm', 'promotion_code', 'gross', 'net', 'disc', 'cap_src', 'cap_camp', 'gap_rec_h', 'conv_gap_h', 'pay_gap_h', 'tier', 's_us', 'crm_sess', 'rnk', 'has_sess', 'ed', 'ea', 'ec', 'camp_attr', 'bucket'];
const BASE_HEADS_ = ['order_id', 'data_checkout', 'classe', 'cupom_crm', 'promocao', 'receita_bruta', 'receita_liquida', 'desconto', 'captura_utm_source', 'captura_utm_campaign', 'h_captura_ate_sessao', 'h_captura_ate_pedido', 'h_captura_ate_pagamento', 'faixa_toque_crm', 'sessao_utm_source', 'sessao_crm', 'rank_sessao', 'tem_sessao', 'emails_entregues_30d', 'emails_abertos_30d', 'emails_clicados_30d', 'campanha_crm_atribuida', 'faixa_tempo_captura'];

function writeBase_(sh, rows) {
  sh.clear();
  const heads = [BASE_HEADS_];
  sh.getRange(1, 1, 1, heads[0].length).setValues(heads).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(FILL_.header).setWrap(true);
  const chunk = 4000;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk).map(function (r) {
      return BASE_COLS_.map(function (c) {
        let v = r[c];
        if (c === 'data_brt') return isoToDate_(v);
        if (v === null || v === undefined) return '';
        return v;
      });
    });
    const rg = sh.getRange(2 + i, 1, part.length, BASE_COLS_.length);
    rg.setValues(part); rg.setFontColor(COLOR_.blue); rg.setFontFamily('Arial');
  }
  if (rows.length) {
    sh.getRange(2, 2, rows.length, 1).setNumberFormat(FMT_.date);
    sh.getRange(2, 6, rows.length, 3).setNumberFormat(FMT_.brl);
    sh.getRange(2, 11, rows.length, 3).setNumberFormat('0.0');
  }
  sh.setFrozenRows(1);
}

/** ---------- Exportações diárias ---------- */
const DAILY_ORD_HEADS_ = ['data', 'classe', 'utm_source_captura', 'aquisicoes', 'aquisicoes_crm', 'receita_bruta', 'receita_liquida', 'desconto', 'receita_liquida_crm'];
function dailyOrdersRows_(O) {
  return Object.keys(O.daily).map(function (k) { return O.daily[k]; })
    .sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : a.cls < b.cls ? -1 : a.cls > b.cls ? 1 : a.src < b.src ? -1 : a.src > b.src ? 1 : 0; })
    .map(function (d) { return [d.data, d.cls, d.src, d.n, d.crm, Math.round(d.gross * 100) / 100, Math.round(d.net * 100) / 100, Math.round(d.disc * 100) / 100, Math.round(d.netCrm * 100) / 100]; });
}
const DAILY_LEAD_HEADS_ = ['data_primeira_captura', 'primeira_etapa', 'utm_source', 'leads', 'elegiveis_7d', 'conv_7d', 'conv_crm_7d', 'elegiveis_14d', 'conv_14d', 'conv_crm_14d', 'receita_liquida_14d', 'desconto_14d', 'utm_confiavel'];
function dailyLeadsRows_(L, utmFrom) {
  return L.daily.map(function (r) {
    return [r.dia, r.fstep, r.usb, num_(r.leads), num_(r.s_el7), num_(r.s_cv7), num_(r.s_cr7), num_(r.s_el14), num_(r.s_cv14), num_(r.s_cr14), Math.round(num_(r.s_net14) * 100) / 100, Math.round(num_(r.s_disc14) * 100) / 100, r.dia >= utmFrom ? 'sim' : 'nao'];
  }).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] < b[2] ? -1 : 1; });
}
function writeDaily_(sh, heads, rows, dateCol) {
  sh.clear();
  sh.getRange(1, 1, 1, heads.length).setValues([heads]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(FILL_.header).setFontFamily('Arial');
  if (rows.length) {
    const vals = rows.map(function (r) { return r.map(function (v, i) { return i === 0 && dateCol ? isoToDate_(v) : v; }); });
    const rg = sh.getRange(2, 1, vals.length, heads.length); rg.setValues(vals); rg.setFontFamily('Arial'); rg.setFontColor(COLOR_.blue);
    sh.getRange(2, 1, vals.length, 1).setNumberFormat(FMT_.date);
  }
  sh.setFrozenRows(1);
}

/** ---------- Resumo (SCQA) ---------- */
function buildNarrative_(O, L, P) {
  const cls = O.classes, N = O.total, crmTot = CLASSES_.reduce(function (a, k) { return a + cls[k].crm; }, 0);
  const sh = function (k) { return div_(cls[k].crm, cls[k].n); };
  const tierShare = function (k, t) { return div_(O.tiers[k][t] || 0, O.tiers[k].crm); };
  const lift = function (k) {
    const e = L.land[k + '|sim'] || {}, n = L.land[k + '|nao'] || {};
    const pe = div_(e.l_cv14 || 0, e.l_el14 || 0), pn = div_(n.l_cv14 || 0, n.l_el14 || 0);
    return { pe: pe, pn: pn, teto: pe ? Math.max(0, (pe - pn) / pe) : 0 };
  };
  const prem = function (k) { const c = cls[k]; return div_(c.discCrm, c.crm) - div_(c.discNon, c.n - c.crm); };
  const lB = lift('B'), lC = lift('C');
  const aovCrmB = div_(cls.B.netCrm, cls.B.crm), aovNonB = div_(cls.B.netNon, cls.B.n - cls.B.crm);
  const srcP = function (u) { const s = L.src[u] || {}; return { cv: div_(s.s_cv14 || 0, s.s_el14 || 0), cr: div_(s.s_cr14 || 0, s.s_el14 || 0), rev: div_(s.s_net14 || 0, s.s_el14 || 0) }; };
  const bk = L.buckets;
  const margin = P.margin;
  const be = function (k) { const p = Math.max(0, prem(k)), m = div_(cls[k].netCrm, cls[k].crm) * margin; return p + m ? p / (p + m) : 0; };
  const promoTop = O.promoOrder[0], promoShare = promoTop ? div_(O.promos[promoTop].n, crmTot) : 0;
  const lines = {
    s: [
      'As ' + fmtNum_(N) + ' aquisições confirmadas do período se dividem pela etapa mais profunda de captura do email antes da sessão de compra: ' + fmtNum_(cls.B.n) + ' no questionário (' + fmtPct_(div_(cls.B.n, N)) + '), ' + fmtNum_(cls.C.n) + ' no checkout (' + fmtPct_(div_(cls.C.n, N)) + '), apenas ' + fmtNum_(cls.A.n) + ' só no pop-up (' + fmtPct_(div_(cls.A.n, N)) + ') e ' + fmtNum_(cls.D.n) + ' sem captura prévia visível (' + fmtPct_(div_(cls.D.n, N)) + ').',
      fmtNum_(crmTot) + ' aquisições (' + fmtPct_(div_(crmTot, N)) + ') usaram cupom CRM' + (promoTop ? '; ' + fmtPct_(promoShare, 0) + ' delas com ' + promoTop : '') + '. O share CRM é de ' + fmtPct_(sh('A')) + ' no pop-up, ' + fmtPct_(sh('B')) + ' no questionário e ' + fmtPct_(sh('C')) + ' no checkout, contra ' + fmtPct_(sh('D')) + ' entre quem não tem captura prévia visível.'
    ],
    c: [
      'Não dá para afirmar incrementalidade causal: as jornadas CRM não têm grupo de controle e o histórico de captura no lake só começa em ' + fmtDateBr_(P.dataStart) + ' (a classe D fica superestimada e A, B e C subestimados).',
      'Quem recebeu email converte mais que quem não recebeu (questionário: ' + fmtPct_(lB.pe, 2) + ' contra ' + fmtPct_(lB.pn, 2) + ' em 14 dias), mas esse é um teto, porque quem não recebe tende a ser inalcançável. Veja a aba Incrementalidade para o antes e depois do lançamento do retargeting.',
      'Engajamento: só ' + fmtPct_(tierShare('B', '1 clique ate 24h'), 0) + ' dos pedidos CRM do questionário e ' + fmtPct_(tierShare('C', '1 clique ate 24h'), 0) + ' dos do checkout tiveram clique em email até 24h antes da compra; ' + fmtPct_(tierShare('B', '3 envio ate 24h'), 0) + ' dos do questionário tiveram só envio. Parte do cupom provavelmente vai para quem já ia comprar.'
    ],
    w: [
      'O custo de subsidiar quem compraria de qualquer forma é baixo: o cupom CRM custa em média ' + fmtBrl_(prem('B')) + ' a mais de desconto por pedido no questionário (' + fmtBrl_(prem('C')) + ' no checkout) contra o desconto médio de pedidos sem CRM, e o líquido médio do pedido CRM no questionário é ' + fmtBrl_(aovCrmB) + ' contra ' + fmtBrl_(aovNonB) + ' sem CRM. Com margem de ' + fmtPct_(margin, 0) + ' (premissa, editável na aba Incrementalidade), o ponto de equilíbrio é ~' + fmtPct_(be('B'), 0) + ' de pedidos incrementais no questionário e ~' + fmtPct_(be('C'), 0) + ' no checkout.',
      'Quem decide é a magnitude do share incremental: o teto observacional é ' + fmtPct_(lB.teto, 0) + ' (questionário) e ' + fmtPct_(lC.teto, 0) + ' (checkout); o indicador conservador de engajamento (clique até 24h) é ' + fmtPct_(tierShare('B', '1 clique ate 24h'), 0) + ' e ' + fmtPct_(tierShare('C', '1 clique ate 24h'), 0) + '. Só um holdout fecha a conta.',
      'Por origem da captura (coortes a partir de ' + fmtDateBr_(P.utmFromEff) + '), a chance de converter por CRM em 14 dias é de ' + fmtPct_(srcP('fb').cr, 2) + ' para fb, ' + fmtPct_(srcP('google').cr, 2) + ' para google, ' + fmtPct_(srcP('instagram').cr, 2) + ' para instagram e ' + fmtPct_(srcP('influencer').cr, 2) + ' para influencer; leads de utm crm chegam a ' + fmtPct_(srcP('crm').cr, 1) + '. Receita líquida do primeiro pedido por lead em 14 dias: ' + fmtBrl_(srcP('google').rev) + ' google, ' + fmtBrl_(srcP('fb').rev) + ' fb, ' + fmtBrl_(srcP('instagram').rev) + ' instagram, ' + fmtBrl_(srcP('influencer').rev) + ' influencer.',
      'Tempo: ' + fmtPct_(div_(bk.s_b1d, bk.s_b14d), 0) + ' das conversões em 14 dias acontecem em até 24h da captura e ' + fmtPct_(div_(bk.s_b7d, bk.s_b14d), 0) + ' em até 7 dias; nas vendas CRM, ' + fmtPct_(div_(bk.s_c1d, bk.s_c14d), 0) + ' em 24h e ' + fmtPct_(div_(bk.s_c7d, bk.s_c14d), 0) + ' em 7 dias. No questionário, a mediana entre a captura e a sessão de compra é ' + (O.time.B.q.p50 === null ? 'n/d' : Math.round(O.time.B.q.p50) + 'h') + '. O esforço de retargeting precisa estar concentrado nas primeiras 72h.'
    ],
    n: [
      '1. Holdout de 20% dos leads no marco de 24h nas jornadas de retargeting: os tamanhos de amostra e o prazo estão nas fórmulas da aba Incrementalidade.',
      '2. Corrigir o UTM do questionário para períodos anteriores a 28/09/2026 e gravar o id da sessão de captura.',
      '3. Incluir o nome do evento na tabela de atividades do Customer.io na Nekt e fazer backfill de captura anterior a ' + fmtDateBr_(P.dataStart) + ' para reduzir a classe D.',
      '4. Informar a margem bruta real da WL para trocar o placeholder e, com recorrência observada, incluir a receita da assinatura na rentabilidade por origem.'
    ]
  };
  return lines;
}

function writeResumo_(sh, O, L, P) {
  const sb = new SB_(sh), T = buildNarrative_(O, L, P);
  sb.put(1, 1, 'Captura de email e venda via CRM na aquisição WL BR: onde o CRM converte e quanto disso é incremental', { bold: true, size: 13 });
  sb.put(2, 1, 'Escopo: Voy, Brasil, Weight Loss, aquisições confirmadas com checkout de ' + fmtDateBr_(P.start) + ' a ' + fmtDateBr_(P.end) + '. Venda via CRM = cupom da lista do SQL de CRM. Gerado em ' + P.generatedAt + '.', { italic: true, size: 9 });
  let r = 4;
  const sec = function (title, arr) {
    sb.put(r, 1, title, { bold: true, size: 11 }); r++;
    arr.forEach(function (t) { sb.put(r, 1, t, { wrap: true }); sb.heights[r] = 15 * Math.max(1, Math.ceil(t.length / 112)) + 6; r++; });
    r++;
  };
  sec('Situação', T.s); sec('Complicação', T.c);
  sec('So-What: o cupom CRM se paga com pouca incrementalidade, mas ninguém sabe se ela existe', T.w);
  sec('Now-What: medir com holdout e corrigir o rastreio antes de decidir o desconto', T.n);
  sb.put(r, 1, 'Indicadores (lidos das abas de análise)', { bold: true, size: 11 }); r++;
  sb.header(r, 1, ['Indicador', 'Valor']); r++;
  [['Aquisições confirmadas', '=Incrementalidade!C10', FMT_.num], ['Aquisições com cupom CRM', '=Incrementalidade!D10', FMT_.num], ['% CRM', '=Incrementalidade!E10', FMT_.pct],
   ['% CRM classe A (só pop-up)', '=Incrementalidade!E5', FMT_.pct], ['% CRM classe B (questionário)', '=Incrementalidade!E6', FMT_.pct], ['% CRM classe C (checkout)', '=Incrementalidade!E7', FMT_.pct],
   ['% CRM classe D (sem captura prévia visível)', '=Incrementalidade!E8', FMT_.pct], ['Prêmio de desconto do CRM, classe B', '=Incrementalidade!L6', FMT_.brl],
   ['Equilíbrio de share incremental, classe B', '=Incrementalidade!E41', FMT_.pct], ['Teto de share incremental, classe B', '=Incrementalidade!F41', FMT_.pct],
   ['Leads por braço do holdout', '=Incrementalidade!E48', FMT_.num], ['Semanas para fechar o holdout', '=Incrementalidade!E50', '0.0']].forEach(function (k) {
    sb.put(r, 1, k[0]); sb.put(r, 2, k[1], { color: COLOR_.green, fmt: k[2] }); r++;
  });
  sb.widths[1] = 900; sb.widths[2] = 110;
  sb.flush();
}
