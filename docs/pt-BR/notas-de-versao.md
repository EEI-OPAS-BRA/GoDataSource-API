# Notas de versão

Todas as mudanças relevantes para quem usa ou administra o Go.Data estão neste arquivo, da versão mais recente para
a mais antiga. As versões seguem o calendário de publicação (`ANO.MÊS.CORREÇÃO`) e indicam a versão do Go.Data da OMS
usada como base.

[English](../en/release-notes.md)

## 2026.10.0 (base OMS 2.51.0)

Versão candidata, em validação. A data da versão final será informada na sua publicação.

### Resumo

Primeira versão estável distribuída para as instalações estaduais e municipais. É baseada no Go.Data 2.51.0 da OMS
e reúne adaptações para a vigilância no Brasil: visibilidade geográfica pelo endereço de notificação e pela cadeia de
residência, criação de registros entre municípios, novos campos de endereço, datas no padrão brasileiro e tradução
completa para o português.

### Novidades

- Visibilidade geográfica configurável por surto. Além do município de residência, a equipe passa a acessar os casos
  pelo endereço de notificação e os contatos diretos dos casos residentes no seu território.
- Criação de casos e contatos com endereço em outro município, configurável por surto, também na criação individual
  de contatos.
- Campos de endereço Logradouro, Número, Complemento e Bairro, habilitados por surto na configuração de campos. Os
  valores são salvos e exibidos no cadastro.
- Campos de endereço opcionais por surto e opção de impedir a exclusão de endereços.
- Opção "Expandido por padrão" na configuração de campos do surto, para que listas do cadastro, como Documentos,
  apareçam abertas sem clique adicional.
- Datas e horas exibidas e exportadas no formato configurado no servidor, com opção de exportar datas sem horário.
- Edição em massa das respostas de questionário de contatos, configurável por surto.
- Colunas de localização por tipo de endereço nas listas de casos, contatos e relacionamentos, com filtro de
  localização por tipo de endereço.
- Novas colunas na lista de relacionamentos: classificação, data de notificação, data de início dos sintomas e equipe
  de acompanhamento, também disponíveis na exportação.
- Pesquisa sem distinção entre maiúsculas e minúsculas.
- Consulta de contatos e seus relacionamentos pela API, com o atalho "Consulta via API" na tela de contatos.
- Tradução completa para o português do Brasil, reaplicada a cada atualização do banco de dados.

### Correções

- As cadeias de transmissão seguem a mesma visibilidade geográfica das listas.
- Os filtros das cadeias de transmissão por localização, classificação e faixa etária retornam apenas os registros
  selecionados.
- As cadeias de transmissão voltam a ser geradas quando há filtro de datas.
- Registros cadastrados apenas com endereço de notificação passam a ser vistos somente pelas equipes do local de
  notificação, e não mais por todas as equipes do surto.
- O painel de acompanhamentos deixa de apresentar erro para contatos sem residência habitual.
- A lista de localizações é atualizada imediatamente ao trocar de surto.
- Surtos e modelos deixam de ser substituídos indevidamente.
- O filtro de usuário responsável passa a listar usuários com acesso a todos os surtos, e o e-mail continua visível ao
  lado do nome.
- A importação de casos e contatos passa a mapear o usuário responsável.

### Mudanças de comportamento

- O endereço de residência habitual passa a ser obrigatório para casos e contatos, exceto em surtos configurados com
  endereço opcional.
- Usuários com restrição geográfica recebem acesso negado ao abrir diretamente registros fora do seu território.
- Pessoas fora do território do usuário aparecem nas cadeias de transmissão de forma mascarada, identificadas apenas
  pelo ID visual, e seus nomes são omitidos nos relacionamentos.
- Quem cria usuários vê e atribui apenas as permissões que possui. Administradores do sistema mantêm todas as
  permissões e veem todos os surtos.
- A localização passa a ser obrigatória na criação de contatos em grupo.
- Os textos em português dos termos do sistema são regravados a cada atualização do banco. Traduções personalizadas
  por importação de planilha nesses termos são substituídas.
- A tela de login e o menu lateral passam a exibir "build 2026.10.0" ao lado da versão.

### Problemas conhecidos

- Com a opção "Expandido por padrão" ligada em Documentos, editar um registro antigo que não tem documento cria um
  bloco vazio. Para salvar, é preciso remover esse bloco.
- Logradouro, Número, Complemento e Bairro ainda não aparecem como colunas nas listas nem na exportação.
- Em surtos sem máscara de ID visual, a pessoa de fora do território do usuário aparece sem rótulo na cadeia de
  transmissão.

### Instalação e compatibilidade

- Base: Go.Data 2.51.0 da OMS.
- Atualização a partir de qualquer versão 2.x da OMS instalada pelo código-fonte. As migrações do banco de dados são
  executadas na atualização e não têm desfazer automático, por isso o backup é obrigatório.
- Requisitos: Node.js 22 LTS e o MongoDB já utilizado pela instalação.
- O passo a passo, com backup e retorno à versão anterior, está no [Guia de atualização](atualizacao.md).

### Não incluído nesta versão

Previstos para versões futuras:

- Sincronização com o servidor nacional.
- Notificações por equipe.
- Subperguntas condicionais em questionários.
- Colunas e exportação dos campos Logradouro, Número, Complemento e Bairro.
