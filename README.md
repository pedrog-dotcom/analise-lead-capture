# analise-lead-capture

Análise de captura de email (pop-up, questionário e checkout) e incrementalidade da venda via CRM na aquisição Weight Loss BR (Voy).

- `apps-script/`: Google Apps Script com painel para escolher o período, gerar as abas da análise e exportar tabelas diárias em CSV. Instalação e definições em [apps-script/README.md](apps-script/README.md).

Nenhum dado de cliente ou de pedido é versionado aqui; o script lê as tabelas da Nekt no BigQuery em tempo de execução.
