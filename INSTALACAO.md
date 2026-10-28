# Análise de captura de email e venda via CRM (WL BR) em Apps Script

Planilha Google com painel para escolher o dia inicial e o dia final, gerar todas as abas da análise e exportar tabelas diárias em CSV.

## O que o script faz

1. Consulta a Nekt (Data API) com duas queries parametrizadas pelo período:
   - **Pedidos**: 1 linha por aquisição confirmada da Voy (WL, Brasil) com checkout no período, já classificada pela etapa mais profunda de captura antes da sessão de compra (A pop-up apenas, B questionário, C checkout, D sem captura prévia visível, X sem email).
   - **Leads**: coortes por data da primeira captura, com marco de 24h, exposição a emails, conversão em 7 e 14 dias e agrupamentos por UTM source e por dia.
2. Calcula as agregações em JavaScript e escreve as abas (contagens em azul, razões e totais em fórmulas).
3. Gera duas tabelas diárias e permite baixá-las em CSV pelo painel.

## Instalação

1. Crie uma planilha Google nova (ou use uma existente) e abra **Extensões > Apps Script**.
2. Crie os arquivos com os nomes abaixo e cole o conteúdo de cada um:
   - `Code.gs`, `Sql.gs`, `Aggregations.gs`, `Sheets.gs`, `DashboardApi.gs` (tipo Script)
   - `Painel.html` e `Dashboard.html` (tipo HTML, nomes exatos)
   - `appsscript.json`: em **Configurações do projeto**, marque "Mostrar o arquivo de manifesto appsscript.json no editor" e cole o conteúdo.
4. Salve, volte à planilha e recarregue a página. Aparece o menu **Análise CRM WL**.
5. Abra **Análise CRM WL > Abrir painel**, expanda **Configuração da Nekt**, cole a chave de API (app.nekt.ai/settings/api-keys) e confirme o dataset `manual_default`. A chave fica nas propriedades do script, não na planilha.
6. Clique em **Testar conexão**. Na primeira vez o Google pede autorização para Planilhas e para acesso externo (chamadas à API da Nekt).

Tabelas lidas (dataset configurado): `webhook_v2_orders_lake`, `webhook_v2_order_sessions_lake`, `webhook_v2_customers_lake`, `webhook_v2_cio_crm_touches_lake`, `crm_atribuicao_cupons`, `wl_customer_io_activities`, `wl_customer_io_customers`.

## Como usar

- **Dia inicial e dia final**: período das aquisições (data do checkout, fuso Brasil) e das coortes de leads (data da primeira captura). O dia de hoje não entra, porque é parcial.
- **UTM confiável desde**: as análises por UTM source usam coortes a partir desta data (padrão 29/09/2026, quando o UTM do questionário passou a ser registrado).
- **Lançamento do retargeting**: data usada no antes e depois (padrão 02/10/2026).
- **Margem de contribuição (%)**: premissa do ponto de equilíbrio. O valor padrão de 50% é placeholder; também dá para editar a célula amarela na aba Incrementalidade e as fórmulas recalculam.
- **Rodar análise** leva de 1 a 3 minutos e reescreve todas as abas.
- **Baixar CSV diário de aquisições** e **de leads** baixam o conteúdo das abas `Diário aquisições` e `Diário leads`.

## Abas geradas

| Aba | Conteúdo |
|---|---|
| Resumo | Texto em SCQA com os números do período e indicadores ligados às outras abas |
| Incrementalidade | Share CRM por classe, engajamento do toque CRM, contraste expostos vs não expostos, antes e depois do retargeting, ponto de equilíbrio e dimensionamento de holdout |
| Captura x UTM campaign | Compradores por etapa (A, B, C) e UTM campaign, com CRM |
| Captura x UTM source | Compradores por etapa e UTM source; funil de leads por primeira etapa |
| Tempo até conversão | Distribuição do intervalo captura até sessão de compra (com mediana e percentis) e conversão acumulada dos leads |
| Rentabilidade e prob por UTM | Probabilidade de converter por CRM em 7 e 14 dias com intervalo de confiança de Wilson, receita líquida por lead e por comprador, contribuição |
| Extras | Mix de cupom, campanhas CRM que recebem a atribuição, tendência semanal, origem da sessão de compra |
| Metodologia | Definições e limitações |
| Diário aquisições | Exportação diária (abaixo) |
| Diário leads | Exportação diária (abaixo) |
| Base pedidos | 1 linha por aquisição, para tabelas dinâmicas |

## Tabelas diárias

**Diário aquisições** (grão: dia do checkout x classe x UTM source da captura):
`data, classe, utm_source_captura, aquisicoes, aquisicoes_crm, receita_bruta, receita_liquida, desconto, receita_liquida_crm`

**Diário leads** (grão: dia da primeira captura x primeira etapa x UTM source):
`data_primeira_captura, primeira_etapa, utm_source, leads, elegiveis_7d, conv_7d, conv_crm_7d, elegiveis_14d, conv_14d, conv_crm_14d, receita_liquida_14d, desconto_14d, utm_confiavel`

Os CSVs usam vírgula como separador, ponto decimal e datas em AAAA-MM-DD. Em leads, as colunas de conversão só contam coortes com janela completa (elegíveis); `utm_confiavel = nao` indica dias anteriores à data de UTM confiável.

## Definições principais

- **Venda via CRM**: aquisição com `promotion_code` na lista do SQL de CRM (a lista está em `Sql.gs`, constante `CRM_PROMOS_`).
- **Classe** (hierarquia, sem duplicidade): C se a conta foi criada antes da sessão de compra; senão B se houve questionário antes; senão A se houve pop-up antes; senão D; X se o pedido não tem email vinculado.
- **Captura anterior**: ocorreu antes do início da sessão de compra (se o pedido não tem sessão, usa checkout menos 10 minutos).
- **Marco de 24h** (leads): classe do lead pela etapa mais profunda até 24h após a primeira captura; o desfecho conta só depois do marco. Lead que já comprou antes de capturar é excluído.
- **Exposto**: recebeu ao menos 1 email entregue entre 24h e 8 dias após a primeira captura.

## Como foi validado

- As duas queries rodaram na Nekt com o período 01/09/2026 a 26/10/2026. Pedidos: 6.626 aquisições (A 131, B 3.181, C 913, D 2.247, X 154; 1.543 com CRM). A planilha anterior tinha 6.647 porque o corte inicial era em UTC e incluía 21 pedidos de 31/08/2026 entre 21h e 23h59 no horário do Brasil.
- Leads (coortes a partir de 01/10/2026): 25.975 elegíveis a 14 dias, 1.352 conversões e 315 com CRM, idêntico à planilha anterior.
- As funções de agregação foram testadas em Node com os dados reais da planilha anterior (classes, faixas de engajamento, intervalos, quantis, semanas e intervalo de Wilson) e bateram. O fluxo completo (consultas, agregações, escrita das abas, CSV) foi executado com mocks do Google Sheets.
- **Não foi executado no Google Sheets real**: o ambiente de desenvolvimento não tem acesso à sua conta. Se alguma chamada de API do Apps Script falhar, a mensagem de erro aparece no painel.

## Diferenças em relação à planilha anterior

- Janelas de desfecho dos leads no marco de 24h exigem 8 e 15 dias completos desde a primeira captura (antes eram 7 e 14); os números mudam na terceira casa decimal.
- O período é livre; o antes e depois do retargeting se ajusta ao intervalo escolhido (pré = 14 dias antes do lançamento, pós = do lançamento até o último dia com 7 dias completos de desfecho).
- As contagens são valores vindos da Nekt; razões, totais e intervalos são fórmulas. Na planilha anterior as contagens eram fórmulas sobre a base de pedidos.

## Limitações

- O histórico de eventos de captura no lake começa em 30/08/2026 (`dataStart` em `Code.gs`). Pedidos de períodos anteriores caem quase todos na classe D.
- A UTM do questionário só é confiável desde 28/09/2026.
- Não há grupo de controle nas jornadas CRM; incrementalidade causal exige holdout. O contraste expostos vs não expostos é um teto.
- Sem COGS e sem recorrência na janela: a rentabilidade usa a receita líquida do primeiro pedido.
- O nome do evento não existe na tabela de atividades; pop-up e questionário são reconhecidos pelas chaves do payload (`form_id`; `landing_url`, `quiz_completed` ou `peso_desejado`). Se o time renomear esses campos, ajuste a CTE `cap` em `Sql.gs`.

## Custos e limites

- Cada execução faz 2 queries na Nekt (a tabela de atividades é a mais pesada). Cada query conta como uso da Data API, conforme seu plano.
- O Apps Script limita a execução a 6 minutos. Se um período muito longo estourar o tempo, rode em blocos menores.

## Solução de problemas

- "Informe a chave da API da Nekt": preencha a configuração no painel.
- "A Nekt recusou a chave": gere outra em Configurações > API Keys e salve de novo.
- "Consulta na Nekt terminou como RUNNING": a Data API devolveu antes de terminar; rode de novo. Se persistir, fale com o suporte da Nekt.
- "Not found: Dataset" ou tabela: confira o nome do dataset (layer) na Nekt.
- Abas com zeros: confira se o período tem pedidos e se o início não é anterior a 30/08/2026.
- Mudou a lista de cupons CRM: edite `CRM_PROMOS_` em `Sql.gs`.

## Usando a integração com o GitHub

Mantenha os arquivos na raiz do repositório. Em subpastas o Apps Script grava o caminho no nome (por exemplo `apps-script/Painel.html`) e o painel não é encontrado ("No HTML file named Painel was found").

## Dashboard web app

O dashboard (`Dashboard.html` + `DashboardApi.gs`) mostra todas as análises com gráficos e troca de período sem consultar a Nekt a cada vez.

1. Configure a chave da API da Nekt em Análise CRM WL > Abrir painel (mesma configuração da planilha).
2. Rode **Análise CRM WL > Atualizar dados do dashboard** uma vez. Leva de 1 a 3 minutos e guarda o histórico em abas ocultas (`_dados_pedidos`, `_dados_leads`).
3. Rode **Agendar atualização diária (6h)** para manter os dados em dia.
4. No editor do Apps Script: Implantar > Nova implantação > App da Web. Executar como: você. Acesso: apenas você ou a organização (o dashboard mostra dados de clientes agregados, mas não deixe público).
5. Abra a URL do app. Escolha as datas, use os atalhos (7 dias, 30 dias, mês atual, tudo) e clique em Aplicar. Os botões de CSV exportam as tabelas diárias do período.

Observações:
- O período do dashboard só vai até ontem; janelas de conversão (7 e 14 dias) só entram quando completas, como na planilha.
- Para recarregar o histórico na hora, use o botão Atualizar dados no topo do dashboard.
- Depois de mudar o código, crie uma nova versão da implantação para a URL refletir a mudança.

## Campanhas de lead (Meta)

- O custo vem da aba **Campanhas** (colunas Day, Campaign Name, Amount Spent, custo sem imposto). O dashboard soma 12,5% de imposto (`SPEND_TAX_` em `DashboardApi.gs`).
- Campanhas com "lead" no nome são tratadas como campanhas de lead; as demais da aba, como "demais Meta".
- Leads por campanha vêm da Nekt (`buildCampLeadsSql_` em `Sql.gs`): email novo cuja primeira captura no site tem aquela utm_campaign.
- Campanhas fora da comparação ficam em `CAMP_EXCLUDE_` (`DashboardApi.gs`); hoje: `VOY_WL_META_LEADS_CREATORS_ABO`, que capta leads de creators.
- Quando a UTM gravada no site difere do nome da campanha, adicione o par em `CAMP_ALIASES_` (`DashboardApi.gs`).

## Disparos de CRM por etapa

- Consulta `buildSendsSql_` (`Sql.gs`), guardada na aba oculta `_dados_disparos`.
- Etapa = a mais avançada até 72h depois da primeira captura. Disparos = emails entregues (`delivered_email`) + WhatsApp/SMS (`sent_action`) nas primeiras 72h.
- Desfecho = compra com cupom CRM entre 72h e 14 dias, só para leads com 14 dias completos que não compraram antes de 72h.
- A decomposição aplica as taxas do pop-up ao mix de disparos do questionário para separar o efeito da quantidade de disparos do efeito do perfil do lead.

## Identidade visual

Mesma identidade dos dashboards Growth Pacing (tema Voy): verde #19301E, coral #FF8A5B, fundo #F7F6F2, fontes Archivo, Inter e JetBrains Mono.
