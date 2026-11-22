# Configurações, idioma, tema e integrações MCP

## Abrir as configurações

A linha no canto inferior esquerdo do ecrã Início abre o painel de configurações (a linha por baixo mostra se há uma IA conectada). O painel tem cinco secções: Conta, IA, Geral, Integrações e Sobre.

Também pode abri-las a partir de qualquer separador com **⌘,** (Ctrl+, no Windows e no Linux), a partir de **Configurações…** no menu da aplicação num Mac (o menu com o nome da app, à esquerda da barra de menus) ou a partir de **Menu (☰) ▸ Configurações…** no Windows e no Linux. Num separador do Word, ⌘, (Ctrl+,) é subscrito, por isso abra-as pelo menu.

**Conta** mostra em que estado estão as suas conexões do Claude, do ChatGPT e do Codex, e **Gerenciar conexões** leva à secção IA. A IA tem os seus próprios artigos: [Conexão por assinatura](help://subscription) e [Modelos de IA e configurações](help://ai-models).

## Idioma

- As configurações oferecem **22 idiomas de interface**: inglês, chinês simplificado, japonês, coreano, francês, alemão, espanhol, tailandês, indonésio, russo, árabe, português, italiano, polaco, tcheco, neerlandês, malaio, hebraico, híndi, chinês tradicional e vietnamita, turco.
- A troca aplica-se de imediato e persiste; e a barra de menus do sistema é reconstruída com o novo idioma.

## Tema

Claro / Escuro / Seguir o Sistema. O modo Seguir o Sistema acompanha o aspeto do sistema operativo, e os editores mudam de aspeto em sincronia sem cintilação.

## Geral

- **Posição da barra lateral de IA** (esquerda ou direita), **Tamanho do texto do painel de IA** e **Verificação ortográfica no chat de IA**.
- **Painel de IA** — Desativado, Recolhido ou Último estado.
- **Salvar automaticamente todos os documentos** ativa a gravação automática por predefinição em todos os editores; continua a poder desativá-la para uma janela.
- **Local de salvamento** com o botão **Alterar** e **App padrão para documentos do Office** para reservar .docx / .xlsx / .pptx ao GenOffice.
- **Formato de salvamento de novos documentos HWP** escolhe se HWP ou HWPX é oferecido primeiro no primeiro salvamento de um documento novo. Os documentos abertos mantêm o próprio formato.
- **Fontes dos slides com IA** define as fontes que a IA usa numa apresentação nova quando o seu pedido não indica nenhuma. Escolha Automático, Sem serifa, Com serifa ou Títulos com serifa, e mude separadamente a fonte sem serifa e a fonte com serifa. Um modelo de design escolhido usa as próprias fontes, e as páginas acrescentadas a uma apresentação com outras fontes seguem essa apresentação.

O GenOffice não recolhe nem envia estatísticas de utilização, por isso não há nenhum interruptor para isso.

## Editores e IA

Aqui você escolhe quais editores usa e se usa a IA. A mesma lista também aparece uma vez em outros dois lugares: no passo **Escolha seus editores** das telas de boas-vindas na primeira execução e numa janela mostrada uma única vez no Início para quem já usava o GenOffice antes de esta opção existir. No começo tudo está ativado, então deixar como está não muda nada. Uma alteração vale na hora em todas as janelas abertas.

- **Editores**: Word, Excel, PowerPoint, PDF, Ferramentas de PDF, Markdown e texto, HTML, Mapa mental, Diagrama, HWP (Hangul) e Livro digital (EPUB). As ferramentas de PDF são ligadas e desligadas separadamente do editor de PDF. Pelo menos um editor tem de continuar ativado.
- **Um editor desativado** sai das listas de novos documentos: os cartões do Início, o menu **+** da barra de abas, Arquivo ▸ Novo e a lista de aplicativos padrão. Os documentos já abertos continuam abertos, e as cópias de recuperação são mantidas.
- **Ao abrir um arquivo de um editor desativado** (clique duplo, arrastar e soltar, Arquivo ▸ Abrir, arquivos recentes), você escolhe entre **Ativar e abrir** e **Cancelar**. Se abrir vários arquivos dele de uma vez, a pergunta aparece só uma vez.
- **Outras funções que abririam o resultado num editor desativado**, como converter um PDF para esse formato, perguntam antes de começar: **Ativar e abrir**, **Só criar o arquivo** (o arquivo é criado e mostrado na pasta, e o editor continua desativado) ou **Cancelar**.
- **Com os recursos de IA desativados**, somem os painéis de IA, os botões e menus de IA, o painel de perguntas do Início, a janela do agente e os avisos para conectar uma IA, e as abas Conta, IA e Habilidades saem das configurações. O GenOffice não inicia nenhum programa de IA pelas suas telas. Logins, chaves, habilidades e configurações são mantidos e voltam quando você ativa a IA de novo. Se ainda houver trabalho de IA em andamento, você é perguntado primeiro se quer **Parar e desativar**.
- A linha de comando, o MCP e este guia funcionam do mesmo jeito, com editores ou IA ativados ou não.

Mesmo com a IA ativada, ela não cria documentos novos para um editor desativado; ela pede que você o ative aqui.

## IA ▸ Avançado

Fica fechado até o abrir; a maioria das pessoas nunca precisa dele. O separador **Modelo de IA** guarda as chaves de API e os servidores que executa por conta própria, para a conversa. No separador **Mídia e busca de IA**, cada capacidade escolhe o fornecedor que a serve, e a chave e o URL base de um fornecedor são introduzidos uma vez e partilhados:

- **Busca na web**, **Geração de imagens**, **Análise de imagens** e **Análise de vídeo**, cada uma com um fornecedor, um modelo, uma chave e um URL base.
- A **busca de arquivos local** roda nesta máquina. Abaixo dela, o **reranking de busca Jev** vem **desligado por padrão**. Ao ligar, os trechos dos 20 primeiros acertos locais — até 1.200 caracteres por documento, mais nomes de arquivos e pastas — vão para o endpoint de decisão escolhido (Jev via OpenRouter ou TypeSafe, Perplexity, Liquid AI d1, Cloudflare, um motor local ou URL própria) para reordenar por relevância. Desligado, nada sai do aparelho.
- **Permitir que solicitações automáticas usem uma assinatura** vem **desligado por padrão**. Decide se um pedido vindo da linha de comandos ou de um agente de programação conectado pode usar a sua assinatura do Claude ou do Codex; consulte [Conectar um agente de programação](help://mcp).

## Sobre

- **Versão**, o endereço do projeto no GitHub e uma linha que indica o projeto de código aberto em que esta aplicação se baseia.
- **Canal de atualização**: Estável ou Beta. Alterá-lo tem efeito imediato e verifica se existe uma atualização; não reverte uma instalação Beta para Estável.

## Associações de aplicações predefinidas

As Configurações podem registar o GenOffice como a aplicação que abre ficheiros .docx / .xlsx / .pptx / .pdf e semelhantes (registo de aplicação predefinida ao nível do sistema; confirme quando for solicitado).

## Avisos de software de terceiros e atualizações

- Ajuda ▸ Avisos de software de terceiros: o inventário completo das licenças de código aberto que acompanha a aplicação.
- Menu (☰) ▸ Procurar atualizações… (num Mac, Ajuda ▸ Procurar atualizações…): inicia uma verificação manual; e se houver uma versão mais recente, o GenOffice propõe a instalação. Num Mac também está no menu da aplicação, logo abaixo de «Sobre o GenOffice».

## Integração MCP (para utilizadores avançados / clientes de IA)

**Integrações** é o painel que liga o GenOffice a um agente de programação, e tem o seu próprio artigo: Ligar um agente de programação. A versão curta — escolha um caminho (a linha de comandos, ou MCP), siga essa secção e depois inicie uma conversa nova e pergunte.

Em **Servidor HTTP local**, a aplicação também pode arrancar o servidor por si — um interruptor de ativação e uma porta —, enquanto **Avançado** acrescenta o URL de verificação de integridade e o arquivo de registro, em vez de o deixar ao assistente. Escuta apenas em localhost.

No topo de **Configurações ▸ Integrações**, **Serviços conectados** reúne Google Drive, Notion, Canva, Cofre Obsidian, Korean Law MCP, kordoc MCP e servidores MCP personalizados acima da seção de agentes de código.

## Folha de referência da linha de comandos

| Comando             | O que faz                    |
| ------------------- | ---------------------------- |
| `ieumoffice <file>` | abrir um ficheiro            |
| `ieumoffice mcp`    | iniciar o servidor MCP local |
| `ieumoffice --help` | todos os comandos e opções   |
