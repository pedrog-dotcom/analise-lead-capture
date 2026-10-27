# analise-lead-capture

Análise de captura de email (pop-up, questionário e checkout) e incrementalidade da venda via CRM na aquisição Weight Loss BR (Voy).

Google Apps Script com painel para escolher o período, gerar as abas da análise e exportar tabelas diárias em CSV. Instalação, definições e limitações em [INSTALACAO.md](INSTALACAO.md).

Os arquivos ficam na raiz do repositório de propósito: a integração do GitHub com o Apps Script mantém o caminho da pasta no nome do arquivo, e o painel é carregado pelo nome `Painel`.

Nenhum dado de cliente ou de pedido é versionado aqui; o script consulta as tabelas pela Data API da Nekt em tempo de execução.

## Dashboard web app

`DashboardApi.gs` e `Dashboard.html` entregam um dashboard interativo (Chart.js) com todas as análises e seleção de datas. Veja a seção "Dashboard web app" em `INSTALACAO.md`.
