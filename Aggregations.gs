/**
 * Agregações puras (sem APIs do Apps Script), para poderem ser testadas em Node.
 * Entrada: linhas das consultas de pedidos e de leads (objetos com os nomes das colunas do SQL).
 */

const CLASSES_ = ['A', 'B', 'C', 'D', 'X'];
const CLASS_DESC_ = {
  A: 'Pop-up em visita anterior à compra (sem questionário nem conta)',
  B: 'Questionário em visita anterior à compra (sem conta criada)',
  C: 'Conta criada no checkout em visita anterior à compra',
  D: 'Email capturado só na visita da compra',
  X: 'Sem email vinculado ao pedido (não classificável)'
};
const TIER_KEYS_ = ['1 clique ate 24h', '2 abertura ate 24h', '3 envio ate 24h', '4 sem toque ate 24h'];
const BUCKET_KEYS_ = ['1 ate 1h', '2 1h a 6h', '3 6h a 24h', '4 1 a 3 dias', '5 3 a 7 dias', '6 7 a 14 dias', '7 14 a 30 dias', '8 mais de 30 dias'];
const SOURCES_ = ['fb', 'google', 'instagram', 'influencer', 'crm', 'tiktok', 'affiliates', '(sem utm)'];
const LEAD_SOURCES_ = ['fb', 'google', 'instagram', 'influencer', 'crm', 'tiktok', 'affiliates', '(sem utm)', 'outros'];

function num_(v) { return v === null || v === undefined || v === '' || isNaN(Number(v)) ? 0 : Number(v); }
function div_(a, b) { return b ? a / b : 0; }

/** Quantil por interpolação linear (igual ao padrão do pandas). */
function quantile_(sortedAsc, q) {
  if (!sortedAsc.length) return null;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

/** Segunda-feira da semana de uma data ISO (YYYY-MM-DD). */
function weekStart_(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function topN_(counter, n) {
  return Object.keys(counter).map(function (k) { return [k, counter[k]]; })
    .sort(function (a, b) { return b[1] - a[1]; }).slice(0, n).map(function (x) { return x[0]; });
}

/** Agrega os pedidos. */
function computeOrders_(rows) {
  const out = { total: rows.length, classes: {}, tiers: {}, campaigns: {}, sources: {}, time: {}, timeCrm: {}, promos: {}, campAttr: {}, weekly: {}, sessionSrc: {}, srcOrders: {}, daily: {}, coverage: {} };
  CLASSES_.forEach(function (k) {
    out.classes[k] = { n: 0, crm: 0, netCrm: 0, netNon: 0, discCrm: 0, discNon: 0, grossCrm: 0, grossNon: 0 };
    out.tiers[k] = { crm: 0, crmSess: 0 }; TIER_KEYS_.forEach(function (t) { out.tiers[k][t] = 0; });
    out.time[k] = { n: 0, gaps: [] }; out.timeCrm[k] = { n: 0, gaps: [] };
    BUCKET_KEYS_.forEach(function (b) { out.time[k][b] = 0; out.timeCrm[k][b] = 0; });
  });
  const J = out.journey = { hist: {}, capsSum: 0, capsN: 0, stepSum: { pop: 0, quiz: 0, ck: 0 }, stepHist: { pop: {}, quiz: {}, ck: {} }, lv: {}, rnk: {}, visSum: 0 };
  ['A', 'B', 'C'].forEach(function (s) { J.lv[s] = { n: 0, crm: 0, prevPop: 0, prevQuiz: 0, prevAny: 0 }; });
  const campCount = {}, campRows = {}, campAttrCount = {}, promoRows = {}, sessCount = {};
  let withSession = 0;
  rows.forEach(function (r) {
    const k = r.cls, crm = num_(r.is_crm) === 1;
    const net = num_(r.net), disc = num_(r.disc), gross = num_(r.gross);
    const c = out.classes[k];
    c.n++; if (num_(r.has_sess) === 1) withSession++;
    if (crm) { c.crm++; c.netCrm += net; c.discCrm += disc; c.grossCrm += gross; } else { c.netNon += net; c.discNon += disc; c.grossNon += gross; }
    if (crm) {
      const t = out.tiers[k]; t.crm++; if (r.tier) t[r.tier] = (t[r.tier] || 0) + 1; if (num_(r.crm_sess) === 1) t.crmSess++;
    }
    // intervalos (A, B, C)
    if (k === 'A' || k === 'B' || k === 'C') {
      if (r.gap_rec_h !== null && r.gap_rec_h !== undefined && r.gap_rec_h !== '') {
        out.time[k].n++; out.time[k].gaps.push(Number(r.gap_rec_h)); if (r.bucket) out.time[k][r.bucket]++;
        if (crm) { out.timeCrm[k].n++; out.timeCrm[k].gaps.push(Number(r.gap_rec_h)); if (r.bucket) out.timeCrm[k][r.bucket]++; }
      }
      // campanha e fonte da captura
      const camp = r.cap_camp || '', src = r.cap_src || '';
      if (camp) {
        campCount[camp] = (campCount[camp] || 0) + 1;
        const cr = campRows[camp] = campRows[camp] || { A: 0, B: 0, C: 0, Acrm: 0, Bcrm: 0, Ccrm: 0 };
        cr[k]++; if (crm) cr[k + 'crm']++;
      }
      const sr = out.srcOrders[src] = out.srcOrders[src] || { n: 0, crm: 0, A: 0, B: 0, C: 0, net: 0, disc: 0, gross: 0 };
      sr.n++; sr[k]++; if (crm) sr.crm++; sr.net += net; sr.disc += disc; sr.gross += gross;
    }
    if (crm) {
      const p = r.promotion_code || '(sem código)';
      const pr = promoRows[p] = promoRows[p] || { n: 0, disc: 0, net: 0 }; pr.n++; pr.disc += disc; pr.net += net;
      if (r.camp_attr) {
        campAttrCount[r.camp_attr] = (campAttrCount[r.camp_attr] || 0) + 1;
        const ca = out.campAttr[r.camp_attr] = out.campAttr[r.camp_attr] || { A: 0, B: 0, C: 0, D: 0, X: 0 }; ca[k]++;
      }
      const ss = r.s_us ? r.s_us : '(sem sessão ou direto)';
      sessCount[ss] = (sessCount[ss] || 0) + 1;
    }
    // jornada de capturas (visitas de até 60 min)
    if (k !== 'X') {
      const vp = num_(r.v_pop), vq = num_(r.v_quiz), vc = num_(r.v_ck), nc = Math.max(1, vp + vq + vc), hk = nc >= 8 ? '8+' : String(nc);   // todo comprador com email deixou o email ao menos 1 vez (checkout)
      const h = J.hist[hk] = J.hist[hk] || { n: 0, crm: 0 }; h.n++; if (crm) { h.crm++; J.crmN = (J.crmN || 0) + 1; }
      J.capsSum += nc; J.capsN++; J.visSum += num_(r.n_vis);
      J.stepSum.pop += vp; J.stepSum.quiz += vq; J.stepSum.ck += vc;
      [['pop', vp], ['quiz', vq], ['ck', vc]].forEach(function (p) { const b = p[1] >= 3 ? '3+' : String(p[1]); J.stepHist[p[0]][b] = (J.stepHist[p[0]][b] || 0) + 1; });
      const lv = J.lv[r.lv_step];
      if (lv) { lv.n++; if (crm) lv.crm++; if (num_(r.prev_pop) === 1) lv.prevPop++; if (num_(r.prev_quiz) === 1) lv.prevQuiz++; if (num_(r.prev_any) === 1) lv.prevAny++; }
    }
    if (r.rnk !== null && r.rnk !== undefined && r.rnk !== '') { const rk = num_(r.rnk) >= 5 ? '5+' : String(num_(r.rnk)); const x = J.rnk[rk] = J.rnk[rk] || { n: 0, crm: 0 }; x.n++; if (crm) x.crm++; }
    // semana
    const w = weekStart_(r.data_brt);
    const wk = out.weekly[w] = out.weekly[w] || { n: 0, crm: 0, net: 0 }; wk.n++; if (crm) wk.crm++; wk.net += net;
    // diário
    const dk = r.data_brt + '|' + k + '|' + (r.cap_src || '');
    const dd = out.daily[dk] = out.daily[dk] || { data: r.data_brt, cls: k, src: r.cap_src || '', n: 0, crm: 0, gross: 0, net: 0, disc: 0, netCrm: 0 };
    dd.n++; if (crm) { dd.crm++; dd.netCrm += net; } dd.gross += gross; dd.net += net; dd.disc += disc;
  });
  out.coverage.sessionShare = div_(withSession, rows.length);
  out.campaignOrder = topN_(campCount, 28); out.campaigns = campRows; out.campaignTotals = campCount;
  out.promos = promoRows; out.promoOrder = topN_(Object.keys(promoRows).reduce(function (a, p) { a[p] = promoRows[p].n; return a; }, {}), 20);
  out.campAttrOrder = topN_(campAttrCount, 15); out.campAttrCount = campAttrCount;
  out.sessionSrc = sessCount; out.sessionOrder = topN_(sessCount, 8);
  // quantis
  CLASSES_.forEach(function (k) {
    ['time', 'timeCrm'].forEach(function (key) {
      const g = out[key][k].gaps.slice().sort(function (a, b) { return a - b; });
      out[key][k].q = { p50: quantile_(g, .5), p25: quantile_(g, .25), p75: quantile_(g, .75), p90: quantile_(g, .9) };
    });
  });
  return out;
}

/** Agrega os leads (3 agrupamentos da consulta). */
function computeLeads_(rows, params) {
  const out = { src: {}, srcStep: {}, srcAll: {}, land: {}, daily: [], buckets: {}, totalSrc: {} };
  const sumKeys = ['leads', 's_el7', 's_cv7', 's_cr7', 's_el14', 's_cv14', 's_cr14', 's_net14', 's_disc14', 's_net14crm'];
  const bKeys = ['s_b1h', 's_b6h', 's_b1d', 's_b3d', 's_b7d', 's_b14d', 's_c1h', 's_c6h', 's_c1d', 's_c3d', 's_c7d', 's_c14d', 's_el14', 's_cv14', 's_dsum14', 's_cvall', 's_dsumall', 'leads'];
  const lKeys = ['l_leads', 'l_el7', 'l_cv7', 'l_cr7', 'l_el14', 'l_cv14', 'l_cr14', 'l_net14', 'l_disc14'];
  bKeys.forEach(function (b) { out.buckets[b] = 0; });
  rows.forEach(function (r) {
    const inS = String(r.in_s) === 'true';
    if (r.sec === 'src' && inS) {
      const u = r.usb;
      const o = out.src[u] = out.src[u] || {}; sumKeys.forEach(function (k) { o[k] = (o[k] || 0) + num_(r[k]); });
      const st = out.srcStep[r.fstep] = out.srcStep[r.fstep] || {}; sumKeys.forEach(function (k) { st[k] = (st[k] || 0) + num_(r[k]); });
      sumKeys.forEach(function (k) { out.srcAll[k] = (out.srcAll[k] || 0) + num_(r[k]); });
      bKeys.forEach(function (k) { out.buckets[k] += num_(r[k]); });
    } else if (r.sec === 'src') {
      const o = out.totalSrc.fora = out.totalSrc.fora || { leads: 0 }; o.leads += num_(r.leads);
      bKeys.forEach(function (k) { out.buckets[k] += num_(r[k]); });
    } else if (r.sec === 'land') {
      const key = r.cls_l + '|' + (String(r.exp_l) === 'true' ? 'sim' : 'nao');
      const o = out.land[key] = out.land[key] || {}; lKeys.forEach(function (k) { o[k] = (o[k] || 0) + num_(r[k]); });
    } else if (r.sec === 'dia') {
      out.daily.push(r);
    }
  });
  // diário por classe no marco (para pré/pós e vazão)
  out.landRows = rows.filter(function (r) { return r.sec === 'land'; });
  return out;
}

/** Soma colunas de linhas 'land' entre duas datas (inclusive) e, opcionalmente, para uma classe. */
function sumLand_(landRows, from, to, cols, cls) {
  const o = {}; cols.forEach(function (c) { o[c] = 0; });
  landRows.forEach(function (r) {
    if (r.dia >= from && r.dia <= to && (!cls || r.cls_l === cls)) cols.forEach(function (c) { o[c] += num_(r[c]); });
  });
  return o;
}

/** Intervalo de confiança de Wilson (95% por padrão). */
function wilson_(k, n, z) {
  z = z || 1.96;
  if (!n) return [0, 0];
  const p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}

/**
 * Leads para um intervalo, a partir das linhas guardadas (agrupamentos 'dia' e 'land', ambos aditivos por dia).
 * A fonte 'src' é reconstruída somando as linhas 'dia' a partir de utmFrom.
 */
function leadsForRange_(rows, start, end, utmFrom) {
  const sel = [];
  rows.forEach(function (r) {
    if (r.dia < start || r.dia > end) return;
    if (r.nw !== undefined && String(r.nw).toLowerCase() !== 'true') return;   // só leads novos
    if (r.sec === 'land') sel.push(r);
    else if (r.sec === 'dia') {
      sel.push(r);
      sel.push(Object.assign({}, r, { sec: 'src', in_s: r.dia >= utmFrom ? 'true' : 'false' }));
    }
  });
  return computeLeads_(sel, {});
}
