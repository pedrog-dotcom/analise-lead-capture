/**
 * Consultas SQL (dialeto BigQuery, executadas na Nekt) parametrizadas por período.
 * Todas as datas entram como 'YYYY-MM-DD' (validadas) e são interpretadas no fuso America/Sao_Paulo.
 */

const CRM_PROMOS_ = [
  'VOY_BR_10_OFF_CRM_ACQ_ALWAYSON_CPS', 'VOY_BR_20_OFF_CRM_ACQ_ALWAYSON_CPS', 'VOY_BR_25_OFF_CRM_ACQ_ALWAYSON_CPS',
  'VOY_BR_30_OFF_CRM_ACQ_ALWAYSON_CPS', 'VOY_CRM_POPUP_40_OFF', 'voy_br_15_off_voyfriday_acq',
  'voy_br_25_off_crm_acq', 'voy_br_30_off_crm_acq', 'voy_br_35_off_crm_acq'
];

function assertDate_(s, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) throw new Error('Data inválida em ' + label + ': ' + s);
  return String(s);
}

function addDays_(isoDate, n) {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Nome qualificado de tabela: `projeto.dataset.tabela` (ou `dataset`.`tabela` se projeto vazio). */
function tbl_(cfg, name) {
  return cfg.project ? '`' + cfg.project + '.' + cfg.dataset + '.' + name + '`' : '`' + cfg.dataset + '`.`' + name + '`';
}

function crmList_() {
  return CRM_PROMOS_.map(function (p) { return "'" + p + "'"; }).join(',');
}

/** Pedaços de SQL compartilhados entre a consulta de pedidos e a de leads. */
function sharedCtes_(cfg) {
  const aiFrom = addDays_(assertDate_(cfg.dataStart, 'dataStart'), -30);
  return `
cu0 AS (SELECT id, ANY_VALUE(LOWER(TRIM(email))) AS email FROM ${tbl_(cfg, 'wl_customer_io_customers')} GROUP BY id),
ai AS (SELECT customer_identifiers.id AS id, ANY_VALUE(LOWER(TRIM(customer_identifiers.email))) AS email FROM ${tbl_(cfg, 'wl_customer_io_activities')} WHERE timestamp >= UNIX_SECONDS(TIMESTAMP('${aiFrom}')) AND customer_identifiers.email IS NOT NULL GROUP BY 1),
fa AS (SELECT LOWER(TRIM(customer_identifiers.email)) AS email, MIN(timestamp) AS t0 FROM ${tbl_(cfg, 'wl_customer_io_activities')} WHERE customer_identifiers.email IS NOT NULL GROUP BY 1),
tch AS (SELECT order_id, ANY_VALUE(cio_customer_id) AS cio FROM ${tbl_(cfg, 'webhook_v2_cio_crm_touches_lake')} WHERE brand='Voy' GROUP BY order_id),
sess AS (SELECT order_id, ANY_VALUE(SAFE_CAST(session_started_at AS TIMESTAMP)) AS sess_ts, ANY_VALUE(user_session_rank) AS rnk, ANY_VALUE(utm_source) AS s_us, ANY_VALUE(utm_campaign) AS s_uc FROM ${tbl_(cfg, 'webhook_v2_order_sessions_lake')} WHERE brand='Voy' GROUP BY order_id),
cl AS (SELECT dim_customer_customer_id AS customer_id, MIN(SAFE_CAST(dim_customer_created_at AS TIMESTAMP)) AS created_ts FROM ${tbl_(cfg, 'webhook_v2_customers_lake')} GROUP BY 1),
cap AS (
  SELECT LOWER(TRIM(COALESCE(JSON_VALUE(data,'$.email'), customer_identifiers.email))) AS email, TIMESTAMP_SECONDS(timestamp) AS ts,
    IF(JSON_VALUE(data,'$.form_id') IS NOT NULL,'popup','quiz') AS step,
    COALESCE(REGEXP_EXTRACT(LOWER(JSON_VALUE(data,'$.utm_source')), r'([a-z0-9_.\\-]+)'),'(sem utm)') AS us,
    COALESCE(REGEXP_EXTRACT(LOWER(JSON_VALUE(data,'$.utm_campaign')), r'([a-z0-9_.\\-]+)'),'(sem utm)') AS uc,
    LOWER(TRIM(JSON_VALUE(data,'$.utm_campaign'))) AS ucr
  FROM ${tbl_(cfg, 'wl_customer_io_activities')}
  WHERE type='event' AND timestamp >= UNIX_SECONDS(TIMESTAMP('${cfg.dataStart}'))
    AND (JSON_VALUE(data,'$.form_id') IS NOT NULL OR JSON_VALUE(data,'$.landing_url') IS NOT NULL OR JSON_VALUE(data,'$.quiz_completed') IS NOT NULL OR JSON_VALUE(data,'$.peso_desejado') IS NOT NULL)
    AND IFNULL(JSON_VALUE(data,'$.form_url'),'') NOT LIKE '%nao-apagar-teste%'
)`;
}

function normSrcSql_(col) {
  return `CASE WHEN ${col} IN ('inf','influencer','creators','partnerships') THEN 'influencer'
 WHEN ${col} IN ('ig','instagram','instagramvoy') THEN 'instagram'
 WHEN ${col} IN ('tiktok','tiktokorganico') THEN 'tiktok' ELSE ${col} END`;
}

/**
 * Consulta de pedidos: 1 linha por aquisição confirmada (WL, Brasil) com checkout em [start, end] (BRT).
 */
function buildOrdersSql_(cfg, start, end) {
  assertDate_(start, 'início'); assertDate_(end, 'fim'); assertDate_(cfg.dataStart, 'dataStart');
  const endExcl = addDays_(end, 1);
  return `WITH${sharedCtes_(cfg)},
promo AS (SELECT order_id, ANY_VALUE(promotion_code) AS promotion_code, ANY_VALUE(emails_entregues_30d) AS ed, ANY_VALUE(emails_abertos_30d) AS ea, ANY_VALUE(emails_clicados_30d) AS ec, ANY_VALUE(abertura_campanha) AS ab_c, ANY_VALUE(clique_campanha) AS cl_c, ANY_VALUE(envio_campanha) AS en_c, ANY_VALUE(abertura_horas_antes) AS ab_h, ANY_VALUE(clique_horas_antes) AS cl_h, ANY_VALUE(envio_horas_antes) AS en_h FROM ${tbl_(cfg, 'crm_atribuicao_cupons')} WHERE brand='Voy' GROUP BY order_id),
o AS (
  SELECT x.order_id, x.customer_id, SAFE_CAST(x.system_checkout_at AS TIMESTAMP) AS checkout_ts, SAFE_CAST(x.payment_completed_at AS TIMESTAMP) AS paid_ts,
    x.gross_revenue_local AS gross, x.net_revenue_local AS net, x.discount_local AS disc,
    p.promotion_code, p.ed, p.ea, p.ec, p.ab_c, p.cl_c, p.en_c, p.ab_h, p.cl_h, p.en_h,
    p.promotion_code IN (${crmList_()}) AS is_crm,
    COALESCE(cu0.email, ai.email) AS email, s.sess_ts, s.rnk, s.s_us, cl.created_ts,
    COALESCE(s.sess_ts, TIMESTAMP_SUB(SAFE_CAST(x.system_checkout_at AS TIMESTAMP), INTERVAL 10 MINUTE)) AS t_sess
  FROM ${tbl_(cfg, 'webhook_v2_orders_lake')} x
  JOIN promo p ON p.order_id=x.order_id
  LEFT JOIN tch t ON t.order_id=x.order_id LEFT JOIN cu0 ON cu0.id=t.cio LEFT JOIN ai ON ai.id=t.cio LEFT JOIN sess s ON s.order_id=x.order_id LEFT JOIN cl ON cl.customer_id=x.customer_id
  WHERE LOWER(x.brand_at_checkout)='voy' AND x.order_context='acquisition' AND x.is_confirmed AND x.order_taxonomy_business_category='weight_loss'
    AND INITCAP(REPLACE(x.country,'_',' '))='Brazil'
    AND SAFE_CAST(x.system_checkout_at AS TIMESTAMP) >= TIMESTAMP('${start} 00:00:00', 'America/Sao_Paulo')
    AND SAFE_CAST(x.system_checkout_at AS TIMESTAMP) < TIMESTAMP('${endExcl} 00:00:00', 'America/Sao_Paulo')
),
ev AS (
  SELECT o.order_id, c.ts, c.step, c.us, c.uc FROM o JOIN cap c ON c.email=o.email AND c.ts <= o.checkout_ts
  UNION ALL
  SELECT o.order_id, o.created_ts, 'ck', CAST(NULL AS STRING), CAST(NULL AS STRING) FROM o WHERE o.created_ts <= o.checkout_ts
  UNION ALL
  SELECT o.order_id, o.checkout_ts, 'zbuy', CAST(NULL AS STRING), CAST(NULL AS STRING) FROM o
),
evv AS (SELECT ev.*, IF(TIMESTAMP_DIFF(ts, LAG(ts) OVER (PARTITION BY order_id ORDER BY ts, step), MINUTE) <= 60, 0, 1) AS nv FROM ev),
evn AS (SELECT evv.*, SUM(nv) OVER (PARTITION BY order_id ORDER BY ts, step ROWS UNBOUNDED PRECEDING) AS vis FROM evv),
bv AS (SELECT order_id, MAX(IF(step='zbuy', vis, NULL)) AS bvis FROM evn GROUP BY 1),
jr AS (
  SELECT e.order_id, MIN(e.ts) AS first_cap, COUNT(DISTINCT e.vis) AS n_vis,
    COUNT(DISTINCT IF(e.step='popup', e.vis, NULL)) AS v_pop, COUNT(DISTINCT IF(e.step='quiz', e.vis, NULL)) AS v_quiz, COUNTIF(e.step='ck') AS v_ck,
    COUNTIF(e.step='popup' AND e.vis < bv.bvis) AS popup_pre, COUNTIF(e.step='quiz' AND e.vis < bv.bvis) AS quiz_pre, COUNTIF(e.step='ck' AND e.vis < bv.bvis) AS ck_pre,
    MAX(IF(e.vis < bv.bvis, e.vis, NULL)) AS lvis,
    ARRAY_AGG(STRUCT(e.step AS step, e.us AS us, e.uc AS uc) ORDER BY e.ts, e.step LIMIT 1)[OFFSET(0)] AS fe
  FROM evn e JOIN bv ON bv.order_id=e.order_id WHERE e.step != 'zbuy' GROUP BY 1
),
lv AS (
  SELECT e.order_id, CASE WHEN LOGICAL_OR(e.step='ck') THEN 'C' WHEN LOGICAL_OR(e.step='quiz') THEN 'B' ELSE 'A' END AS lv_step
  FROM evn e JOIN jr ON jr.order_id=e.order_id AND e.vis=jr.lvis WHERE e.step != 'zbuy' GROUP BY 1
),
pv AS (
  SELECT e.order_id, LOGICAL_OR(e.step='popup') AS prev_pop, LOGICAL_OR(e.step='quiz') AS prev_quiz, TRUE AS prev_any
  FROM evn e JOIN jr ON jr.order_id=e.order_id AND e.vis<jr.lvis WHERE e.step != 'zbuy' GROUP BY 1
),
fo AS (
  SELECT q.customer_id, ARRAY_AGG(STRUCT(s.s_us AS us, s.s_uc AS uc) ORDER BY SAFE_CAST(q.system_checkout_at AS TIMESTAMP) LIMIT 1)[OFFSET(0)] AS f
  FROM ${tbl_(cfg, 'webhook_v2_orders_lake')} q LEFT JOIN sess s ON s.order_id=q.order_id
  WHERE LOWER(q.brand_at_checkout)='voy' AND q.order_context IN ('acquisition','unconfirmed-acquisition') AND q.customer_id IN (SELECT customer_id FROM o) GROUP BY 1
),
r AS (
  SELECT o.*, jr.first_cap, jr.n_vis, jr.v_pop, jr.v_quiz, jr.v_ck, lv.lv_step, IFNULL(pv.prev_pop, FALSE) AS prev_pop, IFNULL(pv.prev_quiz, FALSE) AS prev_quiz, IFNULL(pv.prev_any, FALSE) AS prev_any,
    CASE WHEN o.email IS NULL THEN 'X' WHEN IFNULL(jr.ck_pre,0)>0 THEN 'C' WHEN IFNULL(jr.quiz_pre,0)>0 THEN 'B' WHEN IFNULL(jr.popup_pre,0)>0 THEN 'A' ELSE 'D' END AS cls,
    IF(jr.fe.step='ck', fo.f.us, jr.fe.us) AS cap_us_raw, IF(jr.fe.step='ck', fo.f.uc, jr.fe.uc) AS cap_camp,
    TIMESTAMP_DIFF(o.checkout_ts, jr.first_cap, SECOND)/3600 AS gap_rec_h
  FROM o LEFT JOIN jr ON jr.order_id=o.order_id LEFT JOIN lv ON lv.order_id=o.order_id LEFT JOIN pv ON pv.order_id=o.order_id LEFT JOIN fo ON fo.customer_id=o.customer_id
)
SELECT r.order_id, FORMAT_DATE('%Y-%m-%d', DATE(r.checkout_ts, 'America/Sao_Paulo')) AS data_brt, r.cls, IF(IFNULL(r.is_crm, FALSE), 1, 0) AS is_crm,
  r.promotion_code, r.gross, r.net, r.disc,
  ${normSrcSql_('r.cap_us_raw')} AS cap_src, r.cap_camp, r.gap_rec_h,
  TIMESTAMP_DIFF(r.t_sess, r.first_cap, SECOND)/3600 AS conv_gap_h, TIMESTAMP_DIFF(r.paid_ts, r.first_cap, SECOND)/3600 AS pay_gap_h,
  CASE WHEN NOT IFNULL(r.is_crm, FALSE) THEN '' WHEN r.cl_h <= 24 THEN '1 clique ate 24h' WHEN r.ab_h <= 24 THEN '2 abertura ate 24h' WHEN r.en_h <= 24 THEN '3 envio ate 24h' ELSE '4 sem toque ate 24h' END AS tier,
  r.s_us, IF(LOWER(IFNULL(r.s_us,''))='crm', 1, 0) AS crm_sess, r.rnk, IF(r.sess_ts IS NOT NULL, 1, 0) AS has_sess,
  r.ed, r.ea, r.ec, IF(IFNULL(r.is_crm, FALSE), COALESCE(r.cl_c, r.ab_c, r.en_c), NULL) AS camp_attr,
  CASE WHEN r.gap_rec_h IS NULL THEN '' WHEN r.gap_rec_h <= 1 THEN '1 ate 1h' WHEN r.gap_rec_h <= 6 THEN '2 1h a 6h' WHEN r.gap_rec_h <= 24 THEN '3 6h a 24h'
    WHEN r.gap_rec_h <= 72 THEN '4 1 a 3 dias' WHEN r.gap_rec_h <= 168 THEN '5 3 a 7 dias' WHEN r.gap_rec_h <= 336 THEN '6 7 a 14 dias' WHEN r.gap_rec_h <= 720 THEN '7 14 a 30 dias' ELSE '8 mais de 30 dias' END AS bucket,
  IFNULL(r.n_vis, 0) AS n_vis, IFNULL(r.v_pop, 0) AS v_pop, IFNULL(r.v_quiz, 0) AS v_quiz, IFNULL(r.v_ck, 0) AS v_ck, IFNULL(r.lv_step, '') AS lv_step,
  IF(r.prev_pop, 1, 0) AS prev_pop, IF(r.prev_quiz, 1, 0) AS prev_quiz, IF(r.prev_any, 1, 0) AS prev_any
FROM r
ORDER BY r.checkout_ts`;
}

/**
 * Consulta de leads: coortes por data da primeira captura em [start, end] (BRT).
 * Observação dos desfechos vai até 00:00 BRT de hoje (dia parcial fica de fora).
 * Três agrupamentos: (fonte, etapa, utm_confiável) | (dia, classe no marco, exposto) | (dia, etapa, fonte).
 */
function buildLeadsSql_(cfg, start, end, utmFrom) {
  assertDate_(start, 'início'); assertDate_(end, 'fim'); assertDate_(utmFrom, 'início do UTM confiável');
  const endExcl = addDays_(end, 1);
  const minCohort = assertDate_(cfg.minCohort, 'minCohort');
  return `WITH${sharedCtes_(cfg)},
promo AS (SELECT order_id, ANY_VALUE(promotion_code) AS pc FROM ${tbl_(cfg, 'crm_atribuicao_cupons')} WHERE brand='Voy' GROUP BY order_id),
ordall AS (
  SELECT x.order_id, x.order_context, x.is_confirmed, SAFE_CAST(x.system_checkout_at AS TIMESTAMP) AS cts, x.net_revenue_local AS net, x.discount_local AS disc,
    p.pc IN (${crmList_()}) AS is_crm,
    COALESCE(cu0.email, ai.email) AS email, cl.created_ts
  FROM ${tbl_(cfg, 'webhook_v2_orders_lake')} x
  LEFT JOIN promo p ON p.order_id=x.order_id LEFT JOIN tch t ON t.order_id=x.order_id LEFT JOIN cu0 ON cu0.id=t.cio LEFT JOIN ai ON ai.id=t.cio
  LEFT JOIN cl ON cl.customer_id=x.customer_id
  WHERE LOWER(x.brand_at_checkout)='voy' AND x.order_taxonomy_business_category='weight_loss' AND INITCAP(REPLACE(x.country,'_',' '))='Brazil'
    AND SAFE_CAST(x.system_checkout_at AS TIMESTAMP) >= TIMESTAMP('2026-01-01')
),
cutoff AS (SELECT TIMESTAMP(CURRENT_DATE('America/Sao_Paulo'), 'America/Sao_Paulo') AS cut),
leads AS (
  SELECT email, MIN(ts) AS first_ts, ARRAY_AGG(STRUCT(step AS step, us AS us) ORDER BY ts LIMIT 1)[OFFSET(0)] AS f, MIN(IF(step='quiz', ts, NULL)) AS fq
  FROM cap WHERE email LIKE '%@%' GROUP BY email
  HAVING MIN(ts) >= TIMESTAMP('${start} 00:00:00', 'America/Sao_Paulo') AND MIN(ts) < TIMESTAMP('${endExcl} 00:00:00', 'America/Sao_Paulo')
     AND MIN(ts) >= TIMESTAMP('${minCohort} 00:00:00', 'America/Sao_Paulo')
),
ck AS (SELECT email, MIN(LEAST(COALESCE(created_ts, cts), cts)) AS ck_ts FROM ordall WHERE order_context IN ('acquisition','unconfirmed-acquisition') AND email IS NOT NULL GROUP BY 1),
pb AS (SELECT email, MIN(cts) AS first_buy FROM ordall WHERE is_confirmed AND order_context NOT LIKE 'unconfirmed%' AND email IS NOT NULL GROUP BY 1),
cv AS (
  SELECT l.email, ARRAY_AGG(STRUCT(o.cts AS cts, o.net AS net, o.disc AS disc, IFNULL(o.is_crm, FALSE) AS is_crm) ORDER BY o.cts LIMIT 1)[OFFSET(0)] AS c
  FROM leads l JOIN ordall o ON o.email=l.email AND o.is_confirmed AND o.order_context='acquisition' AND o.cts >= l.first_ts GROUP BY l.email
),
dl AS (SELECT LOWER(TRIM(customer_identifiers.email)) AS email, timestamp AS ts FROM ${tbl_(cfg, 'wl_customer_io_activities')} WHERE type='delivered_email' AND timestamp >= UNIX_SECONDS(TIMESTAMP('${cfg.dataStart}')) AND customer_identifiers.email IS NOT NULL),
ex AS (SELECT l.email, COUNTIF(d.ts > UNIX_SECONDS(l.first_ts)+86400 AND d.ts <= UNIX_SECONDS(l.first_ts)+86400+604800) AS nx FROM leads l JOIN dl d ON d.email=l.email GROUP BY l.email),
fl AS (
  SELECT l.email, l.first_ts, l.f.step AS fstep,
    CASE WHEN l.f.us IN ('inf','influencer','creators','partnerships') THEN 'influencer' WHEN l.f.us IN ('ig','instagram','instagramvoy') THEN 'instagram' WHEN l.f.us IN ('tiktok','tiktokorganico') THEN 'tiktok' WHEN l.f.us IN ('fb','google','crm','(sem utm)','affiliates') THEN l.f.us ELSE 'outros' END AS usb,
    l.fq, ck.ck_ts, cv.c, IFNULL(ex.nx,0) AS nx, (fa.t0 IS NULL OR fa.t0 >= UNIX_SECONDS(l.first_ts) - 3600) AS nw
  FROM leads l LEFT JOIN ck ON ck.email=l.email LEFT JOIN cv ON cv.email=l.email LEFT JOIN ex ON ex.email=l.email LEFT JOIN pb ON pb.email=l.email LEFT JOIN fa ON fa.email=l.email
  WHERE pb.first_buy IS NULL OR pb.first_buy >= l.first_ts
),
m AS (
  SELECT fl.*, TIMESTAMP_DIFF(c.cts, first_ts, MINUTE) AS dtc, TIMESTAMP_ADD(first_ts, INTERVAL 24 HOUR) AS lm,
    nx>0 AS exp_l, DATE(first_ts,'America/Sao_Paulo') AS d,
    first_ts >= TIMESTAMP('${utmFrom} 00:00:00', 'America/Sao_Paulo') AS in_s,
    first_ts <= TIMESTAMP_SUB(cutoff.cut, INTERVAL 7 DAY) AS e7, first_ts <= TIMESTAMP_SUB(cutoff.cut, INTERVAL 14 DAY) AS e14,
    first_ts <= TIMESTAMP_SUB(cutoff.cut, INTERVAL 8 DAY) AS le7, first_ts <= TIMESTAMP_SUB(cutoff.cut, INTERVAL 15 DAY) AS le14
  FROM fl CROSS JOIN cutoff
),
k AS (
  SELECT *, (c.cts IS NULL OR c.cts > lm) AS in_l,
    CASE WHEN ck_ts <= lm THEN 'C' WHEN fq <= lm THEN 'B' ELSE 'A' END AS cls_l,
    IF(c.cts IS NOT NULL AND c.cts > lm, TIMESTAMP_DIFF(c.cts, lm, MINUTE), NULL) AS dtl
  FROM m
)
SELECT CASE WHEN GROUPING(usb)=0 AND GROUPING(d)=1 THEN 'src' WHEN GROUPING(d)=0 AND GROUPING(usb)=0 THEN 'dia' ELSE 'land' END AS sec,
  FORMAT_DATE('%Y-%m-%d', d) AS dia, fstep, usb, cls_l, exp_l, in_s, nw,
  COUNT(*) AS leads,
  COUNTIF(e7) AS s_el7, COUNTIF(e7 AND c.cts IS NOT NULL AND dtc<=10080) AS s_cv7, COUNTIF(e7 AND c.is_crm AND dtc<=10080) AS s_cr7,
  COUNTIF(e14) AS s_el14, COUNTIF(e14 AND c.cts IS NOT NULL AND dtc<=20160) AS s_cv14, COUNTIF(e14 AND c.is_crm AND dtc<=20160) AS s_cr14,
  SUM(IF(e14 AND c.cts IS NOT NULL AND dtc<=20160, c.net, 0)) AS s_net14, SUM(IF(e14 AND c.cts IS NOT NULL AND dtc<=20160, c.disc, 0)) AS s_disc14, SUM(IF(e14 AND c.is_crm AND dtc<=20160, c.net, 0)) AS s_net14crm,
  COUNTIF(e14 AND dtc<=60) AS s_b1h, COUNTIF(e14 AND dtc<=360) AS s_b6h, COUNTIF(e14 AND dtc<=1440) AS s_b1d, COUNTIF(e14 AND dtc<=4320) AS s_b3d, COUNTIF(e14 AND dtc<=10080) AS s_b7d, COUNTIF(e14 AND dtc<=20160) AS s_b14d,
  COUNTIF(e14 AND c.is_crm AND dtc<=60) AS s_c1h, COUNTIF(e14 AND c.is_crm AND dtc<=360) AS s_c6h, COUNTIF(e14 AND c.is_crm AND dtc<=1440) AS s_c1d, COUNTIF(e14 AND c.is_crm AND dtc<=4320) AS s_c3d, COUNTIF(e14 AND c.is_crm AND dtc<=10080) AS s_c7d, COUNTIF(e14 AND c.is_crm AND dtc<=20160) AS s_c14d,
  SUM(IF(e14 AND c.cts IS NOT NULL AND dtc<=20160, dtc, 0)) AS s_dsum14, COUNTIF(c.cts IS NOT NULL) AS s_cvall, SUM(IF(c.cts IS NOT NULL, dtc, 0)) AS s_dsumall,
  COUNTIF(in_l) AS l_leads, COUNTIF(in_l AND le14) AS l_el14, COUNTIF(in_l AND le14 AND dtl<=20160) AS l_cv14, COUNTIF(in_l AND le14 AND c.is_crm AND dtl<=20160) AS l_cr14,
  COUNTIF(in_l AND le7) AS l_el7, COUNTIF(in_l AND le7 AND dtl<=10080) AS l_cv7, COUNTIF(in_l AND le7 AND c.is_crm AND dtl<=10080) AS l_cr7,
  SUM(IF(in_l AND le14 AND dtl<=20160, c.net, 0)) AS l_net14, SUM(IF(in_l AND le14 AND dtl<=20160, c.disc, 0)) AS l_disc14
FROM k
GROUP BY GROUPING SETS ((fstep, usb, in_s, nw), (d, cls_l, exp_l, nw), (d, fstep, usb, nw))
ORDER BY sec, dia, usb`;
}

/**
 * Leads por campanha da Meta: 1 linha por (dia da primeira captura, utm_campaign da primeira captura).
 * Lead = email novo (primeira captura no período); quem já tinha comprado antes da captura fica de fora.
 */
function buildCampLeadsSql_(cfg, start, end) {
  assertDate_(start, 'início'); assertDate_(end, 'fim');
  const endExcl = addDays_(end, 1);
  return `WITH${sharedCtes_(cfg)},
promo AS (SELECT order_id, ANY_VALUE(promotion_code) AS pc FROM ${tbl_(cfg, 'crm_atribuicao_cupons')} WHERE brand='Voy' GROUP BY order_id),
ordall AS (
  SELECT x.order_context, x.is_confirmed, SAFE_CAST(x.system_checkout_at AS TIMESTAMP) AS cts, p.pc IN (${crmList_()}) AS is_crm, COALESCE(cu0.email, ai.email) AS email
  FROM ${tbl_(cfg, 'webhook_v2_orders_lake')} x
  LEFT JOIN promo p ON p.order_id=x.order_id LEFT JOIN tch t ON t.order_id=x.order_id LEFT JOIN cu0 ON cu0.id=t.cio LEFT JOIN ai ON ai.id=t.cio
  WHERE LOWER(x.brand_at_checkout)='voy' AND x.order_taxonomy_business_category='weight_loss' AND INITCAP(REPLACE(x.country,'_',' '))='Brazil'
    AND SAFE_CAST(x.system_checkout_at AS TIMESTAMP) >= TIMESTAMP('2026-01-01')
),
cutoff AS (SELECT TIMESTAMP(CURRENT_DATE('America/Sao_Paulo'), 'America/Sao_Paulo') AS cut),
leads AS (
  SELECT email, MIN(ts) AS first_ts, ARRAY_AGG(STRUCT(us AS us, ucr AS ucr) ORDER BY ts LIMIT 1)[OFFSET(0)] AS f
  FROM cap WHERE email LIKE '%@%' GROUP BY email
  HAVING MIN(ts) >= TIMESTAMP('${start} 00:00:00', 'America/Sao_Paulo') AND MIN(ts) < TIMESTAMP('${endExcl} 00:00:00', 'America/Sao_Paulo')
),
pb AS (SELECT email, MIN(cts) AS first_buy FROM ordall WHERE is_confirmed AND order_context NOT LIKE 'unconfirmed%' AND email IS NOT NULL GROUP BY 1),
cv AS (
  SELECT l.email, ARRAY_AGG(STRUCT(o.cts AS cts, IFNULL(o.is_crm, FALSE) AS is_crm) ORDER BY o.cts LIMIT 1)[OFFSET(0)] AS c
  FROM leads l JOIN ordall o ON o.email=l.email AND o.is_confirmed AND o.order_context='acquisition' AND o.cts >= l.first_ts GROUP BY l.email
),
m AS (
  SELECT DATE(l.first_ts,'America/Sao_Paulo') AS d, COALESCE(NULLIF(l.f.ucr,''),'(sem campanha)') AS uc, cv.c,
    CASE WHEN l.f.us IN ('inf','influencer','creators','partnerships') THEN 'influencer' WHEN l.f.us IN ('ig','instagram','instagramvoy') THEN 'instagram' WHEN l.f.us IN ('tiktok','tiktokorganico') THEN 'tiktok' WHEN l.f.us IN ('fb','google','crm','(sem utm)','affiliates') THEN l.f.us ELSE 'outros' END AS usb,
    TIMESTAMP_DIFF(cv.c.cts, l.first_ts, MINUTE) AS dtc,
    l.first_ts <= TIMESTAMP_SUB(cutoff.cut, INTERVAL 3 DAY) AS e3, l.first_ts <= TIMESTAMP_SUB(cutoff.cut, INTERVAL 7 DAY) AS e7, l.first_ts <= TIMESTAMP_SUB(cutoff.cut, INTERVAL 14 DAY) AS e14
  FROM leads l LEFT JOIN cv ON cv.email=l.email LEFT JOIN pb ON pb.email=l.email LEFT JOIN fa ON fa.email=l.email CROSS JOIN cutoff
  WHERE (pb.first_buy IS NULL OR pb.first_buy >= l.first_ts) AND (fa.t0 IS NULL OR fa.t0 >= UNIX_SECONDS(l.first_ts) - 3600)
)
SELECT FORMAT_DATE('%Y-%m-%d', d) AS dia, usb, uc, COUNT(*) AS leads,
  COUNTIF(e3) AS el3, COUNTIF(e3 AND dtc<=4320) AS cv3, COUNTIF(e3 AND c.is_crm AND dtc<=4320) AS cr3,
  COUNTIF(e7) AS el7, COUNTIF(e7 AND dtc<=10080) AS cv7, COUNTIF(e7 AND c.is_crm AND dtc<=10080) AS cr7,
  COUNTIF(e14) AS el14, COUNTIF(e14 AND dtc<=20160) AS cv14, COUNTIF(e14 AND c.is_crm AND dtc<=20160) AS cr14,
  COUNTIF(e7 AND dtc<=60) AS t1h, COUNTIF(e7 AND dtc<=1440) AS t1d, COUNTIF(e7 AND dtc<=4320) AS t3d,
  COUNTIF(c.cts IS NOT NULL) AS cvall, COUNTIF(c.is_crm) AS crall, SUM(IF(c.cts IS NOT NULL, dtc, 0)) AS sdtc
FROM m GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`;
}

/**
 * Disparos de CRM x conversão por etapa de captura (marco de 72h).
 * Etapa = a mais avançada até 72h depois da primeira captura (C checkout > B questionário > A pop-up).
 * Disparos = emails entregues + ações (WhatsApp/SMS) enviadas nas primeiras 72h.
 * Desfecho = compra entre 72h e 14 dias, só para quem não comprou antes de 72h e tem 14 dias completos.
 * Também traz disparos em 14 dias (cortados na compra) para a média descritiva.
 */
function buildSendsSql_(cfg, start, end) {
  assertDate_(start, 'início'); assertDate_(end, 'fim');
  const endExcl = addDays_(end, 1);
  return `WITH${sharedCtes_(cfg)},
promo AS (SELECT order_id, ANY_VALUE(promotion_code) AS pc FROM ${tbl_(cfg, 'crm_atribuicao_cupons')} WHERE brand='Voy' GROUP BY order_id),
ordall AS (
  SELECT x.order_context, x.is_confirmed, SAFE_CAST(x.system_checkout_at AS TIMESTAMP) AS cts, p.pc IN (${crmList_()}) AS is_crm,
    COALESCE(cu0.email, ai.email) AS email, cl.created_ts
  FROM ${tbl_(cfg, 'webhook_v2_orders_lake')} x
  LEFT JOIN promo p ON p.order_id=x.order_id LEFT JOIN tch t ON t.order_id=x.order_id LEFT JOIN cu0 ON cu0.id=t.cio LEFT JOIN ai ON ai.id=t.cio
  LEFT JOIN cl ON cl.customer_id=x.customer_id
  WHERE LOWER(x.brand_at_checkout)='voy' AND x.order_taxonomy_business_category='weight_loss' AND INITCAP(REPLACE(x.country,'_',' '))='Brazil'
    AND SAFE_CAST(x.system_checkout_at AS TIMESTAMP) >= TIMESTAMP('2026-01-01')
),
cutoff AS (SELECT TIMESTAMP(CURRENT_DATE('America/Sao_Paulo'), 'America/Sao_Paulo') AS cut),
leads AS (
  SELECT email, MIN(ts) AS first_ts, MIN(IF(step='quiz', ts, NULL)) AS fq
  FROM cap WHERE email LIKE '%@%' GROUP BY email
  HAVING MIN(ts) >= TIMESTAMP('${start} 00:00:00', 'America/Sao_Paulo') AND MIN(ts) < TIMESTAMP('${endExcl} 00:00:00', 'America/Sao_Paulo')
),
ck AS (SELECT email, MIN(LEAST(COALESCE(created_ts, cts), cts)) AS ck_ts FROM ordall WHERE order_context IN ('acquisition','unconfirmed-acquisition') AND email IS NOT NULL GROUP BY 1),
pb AS (SELECT email, MIN(cts) AS first_buy FROM ordall WHERE is_confirmed AND order_context NOT LIKE 'unconfirmed%' AND email IS NOT NULL GROUP BY 1),
cv AS (
  SELECT l.email, ARRAY_AGG(STRUCT(o.cts AS cts, IFNULL(o.is_crm, FALSE) AS is_crm) ORDER BY o.cts LIMIT 1)[OFFSET(0)] AS c
  FROM leads l JOIN ordall o ON o.email=l.email AND o.is_confirmed AND o.order_context='acquisition' AND o.cts >= l.first_ts GROUP BY l.email
),
msg AS (
  SELECT LOWER(TRIM(customer_identifiers.email)) AS email, TIMESTAMP_SECONDS(timestamp) AS ts, type='delivered_email' AS is_mail
  FROM ${tbl_(cfg, 'wl_customer_io_activities')}
  WHERE type IN ('delivered_email','sent_action') AND timestamp >= UNIX_SECONDS(TIMESTAMP('${start}')) AND customer_identifiers.email IS NOT NULL
),
base AS (
  SELECT l.email, l.first_ts, TIMESTAMP_ADD(l.first_ts, INTERVAL 72 HOUR) AS lm, cv.c,
    CASE WHEN ck.ck_ts <= TIMESTAMP_ADD(l.first_ts, INTERVAL 72 HOUR) THEN 'C' WHEN l.fq <= TIMESTAMP_ADD(l.first_ts, INTERVAL 72 HOUR) THEN 'B' ELSE 'A' END AS st,
    l.first_ts <= TIMESTAMP_SUB(cutoff.cut, INTERVAL 14 DAY) AS e14
  FROM leads l LEFT JOIN ck ON ck.email=l.email LEFT JOIN cv ON cv.email=l.email LEFT JOIN pb ON pb.email=l.email LEFT JOIN fa ON fa.email=l.email CROSS JOIN cutoff
  WHERE (pb.first_buy IS NULL OR pb.first_buy >= l.first_ts) AND (fa.t0 IS NULL OR fa.t0 >= UNIX_SECONDS(l.first_ts) - 3600)
),
cnt AS (
  SELECT b.email,
    COUNTIF(m.ts > b.first_ts AND m.ts <= b.lm AND m.is_mail) AS m72, COUNTIF(m.ts > b.first_ts AND m.ts <= b.lm AND NOT m.is_mail) AS a72,
    COUNTIF(m.ts > b.first_ts AND m.ts <= LEAST(TIMESTAMP_ADD(b.first_ts, INTERVAL 14 DAY), IFNULL(b.c.cts, TIMESTAMP('2100-01-01')))) AS s14
  FROM base b JOIN msg m ON m.email=b.email AND m.ts > b.first_ts AND m.ts <= TIMESTAMP_ADD(b.first_ts, INTERVAL 14 DAY)
  GROUP BY b.email
),
k AS (
  SELECT b.*, IFNULL(n.m72,0) AS m72, IFNULL(n.a72,0) AS a72, IFNULL(n.s14,0) AS s14, IFNULL(n.m72,0)+IFNULL(n.a72,0) AS t72,
    (b.c.cts IS NULL OR b.c.cts > b.lm) AS in_l, DATE(b.first_ts,'America/Sao_Paulo') AS d
  FROM base b LEFT JOIN cnt n ON n.email=b.email
)
SELECT FORMAT_DATE('%Y-%m-%d', d) AS dia, st,
  CASE WHEN t72=0 THEN '0' WHEN t72<=2 THEN '1-2' WHEN t72<=5 THEN '3-5' WHEN t72<=9 THEN '6-9' ELSE '10+' END AS bk,
  COUNT(*) AS n_all, COUNTIF(e14) AS n14, SUM(IF(e14, s14, 0)) AS s14_sum,
  COUNTIF(e14 AND in_l) AS el, SUM(IF(e14 AND in_l, s14, 0)) AS s14_el, SUM(IF(e14 AND in_l, m72, 0)) AS m72_sum, SUM(IF(e14 AND in_l, a72, 0)) AS a72_sum,
  COUNTIF(e14 AND in_l AND c.cts IS NOT NULL AND c.cts <= TIMESTAMP_ADD(first_ts, INTERVAL 14 DAY)) AS cv,
  COUNTIF(e14 AND in_l AND c.is_crm AND c.cts <= TIMESTAMP_ADD(first_ts, INTERVAL 14 DAY)) AS cr
FROM k GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`;
}
