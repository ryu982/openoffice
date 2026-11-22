# Quadro branco: brainstorming, esboços e anotações

O editor de quadro branco abre arquivos `.whiteboard` em uma aba. Você pode organizar notas adesivas, texto, formas, conectores, tabelas, adesivos, imagens, cartões de link e traços livres à mão em quadros infinitos ou páginas fixas, trazer páginas de PDF como plano de fundo, exportar como imagem ou PDF e trabalhar com o painel de IA. Tudo roda localmente no seu PC.

## Abrir e criar

- Um novo quadro começa como quadro livre infinito pelo bloco **Quadro branco** na tela inicial ou em Novo no menu Arquivo.
- O editor abre arquivos `.whiteboard` pelo diálogo abrir, arrastando para a janela, pelos arquivos recentes, árvore de pastas, Visualização rápida (Espaço) ou Google Drive. No Windows, instalar o GenOffice o registra como programa padrão para `.whiteboard`.
- Arquivos Excalidraw (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) são importados como um novo quadro sem título. O arquivo original nunca é sobrescrito, fechar sem editar não pergunta se deseja salvar e o primeiro salvamento sugere `.whiteboard` na mesma pasta. Elementos não suportados como incorporações da web são ignorados exibindo a contagem em um aviso. No Windows, `.excalidraw` aparece apenas em "Abrir com".
- Se o quadro já estiver aberto, a aba dele vai para a frente.

## Edição e ferramentas

- Um único arquivo `.whiteboard` pode misturar quadros livres e páginas fixas (tela 16:9, A4 retrato ou paisagem e tamanhos personalizados de páginas PDF) na barra de páginas.
- As ferramentas incluem seleção, notas adesivas, texto formatado, oito formas, conectores e setas, caneta sensível à pressão, marca-texto e borracha, imagem, tabela, adesivos integrados e cartões de link.
- Para selecionar vários objetos de uma vez, arraste um retângulo a partir de um espaço vazio com a ferramenta de seleção. Se os objetos não deixarem nenhum espaço vazio, escolha **Selecionar área** (M) na barra de ferramentas à esquerda e comece a arrastar diretamente sobre eles. Só são selecionados os objetos que ficam inteiramente dentro do retângulo. Shift+clique (ou Ctrl+clique) em um objeto o adiciona à seleção ou o remove, arrastar com Shift adiciona os objetos de outro retângulo e Ctrl+A (⌘A no Mac) seleciona todos os objetos da página atual. Arrastar qualquer um dos objetos selecionados move todos juntos, e Trazer para frente, Enviar para trás, Duplicar e Excluir se aplicam a todos, cada um como um único passo de desfazer.
- Arraste um arquivo `.pdf` sobre um quadro aberto ou escolha **Importar PDF** para transformar as páginas selecionadas em páginas de fundo fixas onde você pode desenhar e colocar notas. Abrir um `.pdf` pela tela inicial ou menu Arquivo continua abrindo no editor de PDF.
- Pressione F5 ou clique em **Apresentar** para exibir o quadro em tela cheia e avançar páginas com as setas.
- No tema escuro, barras de ferramentas, painéis e o fundo fora da página escurecem, enquanto o papel, as notas, formas e traços mantêm as cores originais do documento.

## Salvar, exportar e imprimir

- Salvar, Salvar como, salvamento automático, cópias de recuperação e verificação de conflito na visualização dividida funcionam como nos outros editores. Se nada mudou, o arquivo não é regravado.
- Exporte para PNG, SVG ou PDF para **Todas as páginas** ou **Apenas a página atual**. Em um quadro livre, a exportação e a impressão ajustam todos os objetos com margem ou usam a área inicial padrão quando vazio.
- Imprimir (Ctrl+P) oferece impressão padrão e opções avançadas de layout de página. Exportações e impressões são idênticas nos temas claro e escuro.

## Painel de IA

- Peça à IA para organizar notas adesivas, montar um modelo de oficina ou retrospectiva, adicionar formas, conectores, tabelas ou imagens, ou resumir o quadro.
- A IA recebe uma tabela de texto estruturada do quadro e, quando o modelo escolhido aceita imagens, anexa automaticamente uma imagem da página atual. Modelos somente texto funcionam apenas com a tabela.
- Cada chamada de edição da IA equivale a um passo de desfazer (Ctrl+Z), destaca na tela os objetos alterados sem modificar o arquivo salvo e mostra **Desfazer estas alterações** no cartão de resposta.
- Arquivos `.whiteboard` podem ser anexados nos painéis de IA de outros editores, citados com `@`, pesquisados na tela inicial, usados em **Criar outro documento** (incluindo conversão para Markdown sem IA) e operados pelos [comandos de terminal](help://cli) (`ieumoffice whiteboard read`, `ieumoffice whiteboard apply`, `ieumoffice create --type whiteboard`).

## Uso da internet e cartões de link

- Abrir, editar, exportar, imprimir e importar arquivos Excalidraw ou páginas PDF não envia nada para a internet.
- Clicar em um cartão de link abre endereços `http`, `https` ou `mailto` no navegador padrão.
- Somente quando você ativa explicitamente **Buscar título e imagem de visualização** ao adicionar ou editar um cartão de link o GenOffice acessa a página uma única vez e guarda a imagem de visualização dentro do arquivo `.whiteboard`.
