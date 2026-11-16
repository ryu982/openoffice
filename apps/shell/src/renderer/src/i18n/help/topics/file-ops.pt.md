# Operações de arquivo: renomear, excluir, exportar

Este capítulo cobre as operações de arquivo comuns a todos os editores; as opções de exportação de cada editor estão no respetivo capítulo.

O **menu ⋯** da linha do arquivo (passe o cursor sobre a linha do arquivo) reúne estas ações:

![O menu ⋯ de uma linha de arquivo](img/file-ops.png)

## Renomear

Dois pontos de entrada, um conjunto de verificações:

- **⋯ ▸ Renomear** a partir de uma linha no ecrã Início.
- **Clique duas vezes numa guia de ficheiro** para renomear no local (consulte [Guias e gestão de janelas](help://tabs-and-windows)).

As regras: a extensão é preservada automaticamente; caracteres proibidos, pontos no final e nomes reservados (CON/NUL e afins) são recusados com uma mensagem; e um nome em conflito na mesma pasta também é bloqueado. O ficheiro real no disco é renomeado, e a lista de recentes e os favoritos acompanham.

## Excluir

- **⋯ ▸ Excluir** no Início: pergunta quais os ficheiros e depois move-os para a **lixeira do sistema**, onde o sistema operacional os pode restaurar. O GenOffice não guarda nenhum desfazer próprio para isto — a recuperação é responsabilidade da lixeira, não de um aviso.

## Duplicar

**⋯ ▸ Duplicar** cria uma cópia de <nome> na mesma pasta; se houver colisão de nome, um contador é acrescentado automaticamente. A cópia entra nos **Recentes** em vez de ser aberta por si — a um clique de distância, não à sua frente.

## Salvar e Salvar Como

- **⌘S / ctrl+S** salva o ficheiro atual; um ficheiro sem título pergunta primeiro pela localização e pelo nome.
- Na maioria dos editores, a lista de tipos de ficheiro da caixa Salvar Como também oferece os formatos de exportação (PDF, imagens, outros formatos de documento). Escolher um deles grava apenas uma cópia; o documento aberto e o seu separador continuam no ficheiro original. Imagens de várias páginas são divididas em `nome-01.png`, `nome-02.png`, ….
- **Docs**: a lista Guardar como também oferece .hwp e .hwpx (Ficheiro ▸ Exportar como documento HWP… faz o mesmo). Se algo não puder ser transferido, como comentários, equações ou caixas de texto, é avisado antes de o ficheiro ser escrito.
- **Salvar Como…** grava um ficheiro novo e deixa o original intacto; as edições seguintes passam a incidir sobre o ficheiro novo.
- Cada gravação é atómica (ficheiro temporário + mudança de nome), pelo que sair a meio da escrita não corrompe o ficheiro.
- O salvamento automático segue o interruptor de cada editor; um documento novo sem ficheiro próprio só começa após o primeiro salvamento (consulte [Início rápido](help://getting-started)).

## Exportar para PDF

- **Docs**: Arquivo ▸ Exportar como PDF… (ou o botão no friso), paginado conforme a disposição atual.
- **Slides**: a exportação rasteriza página a página, com progresso para apresentações grandes.
- **Sheets**: a exportação segue a paginação de impressão.
- As exportações são renderizadas numa janela oculta e o resultado fica onde você escolher.

## Exportar para Word / imagens

- **PDF ▸ PDF para Word**: transforma o PDF num .docx (convertido localmente;layouts complexos são preservados tanto quanto possível).
- O **Docs** pode exportar páginas como imagens (PNG por página).

## Imprimir

Arquivo ▸ Imprimir (⌘P/ctrl+P) abre uma janela de impressão em cada editor. Docs, PDF, Sheets, Slides e Markdown têm a seção **Disposição das páginas** na janela de impressão de sempre, o HWP na pré-visualização de impressão, e HTML, mapa mental e diagrama numa nova janela de impressão pequena. Se não escolher nada em Disposição das páginas, a impressão funciona como antes.

- **Disposição**: escolha Uma página por folha, Várias páginas por folha (2, 4, 6, 9 ou 16), Livreto (encadernar à esquerda ou à direita), Pôster (folhas na largura e na altura, sobreposição, linhas de corte) ou Etiquetas (uma página por etiqueta ou a mesma página em todas as etiquetas, etiqueta inicial, formato A4 comum ou medidas personalizadas).
- **Só faces ímpares, só faces pares, ordem inversa**: as faces são contadas depois da disposição, sobre o que realmente sai da impressora. Serve em impressoras sem frente e verso: imprima as frentes, vire o papel e imprima os versos.
- **Reduzir para caber no papel**: só as páginas maiores que o papel escolhido são reduzidas; as menores não são ampliadas. Sheets e Markdown usam os próprios campos de papel e escala.
- **Tons de cinza e resolução da imagem**: ao imprimir com opções de Disposição das páginas, cada página vira imagem antes de ir para a impressora. Escolha a resolução entre Automática, 150, 300 ou 600 dpi.
- **Só a seleção**: Docs e Markdown imprimem só o texto selecionado, repaginado a partir da primeira página; Slides imprime os slides selecionados e PDF as páginas selecionadas. Sheets imprime o intervalo selecionado como antes.
- **Esquema da disposição e pré-visualização do resultado**: o esquema mostra na hora onde cada número de página fica no papel, e **Pré-visualizar o resultado** mostra o que foi gerado de fato. Com **Salvar o resultado disposto como PDF** é possível imprimir a mesma disposição em outro PC ou numa gráfica.
- **Janela de impressão do sistema**: para um livreto, escolha frente e verso virando pela borda curta. Deixe o intervalo de páginas e as páginas por folha como estão na janela do sistema.

Os PDFs imprimem com a ordem de páginas e as rotações atuais.

## Onde vivem os ficheiros sem título

A localização que escolher no primeiro salvamento é a casa dele. Até lá, o documento não tem ficheiro próprio: o conteúdo não salvo existe apenas como cópia de recuperação na pasta de dados da aplicação, por isso pode voltar se a aplicação se desligar de repente (veja [Guias e gestão de janelas](help://tabs-and-windows)). O Salvamento automático só assume a partir desse primeiro salvamento.
