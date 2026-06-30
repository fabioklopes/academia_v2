# Relatório de Segurança — Integração com CompreFace

Documento exigido pelo requisito de `RECONHECIMENTO_FACIAL.txt`: "Caso seja necessário integração com alguma API, analise antes o nível de segurança e faça um relatório antes da aplicação dessa integração. Não quero nenhum dado vazado ou alguma imagem exposta na rede."

Este relatório cobre a decisão de arquitetura, a topologia de rede, o tratamento de dados biométricos e os riscos residuais aceitos. Deve ser revisado/aprovado antes da Fase 3 (integração real com a API do CompreFace) do plano de implementação do módulo de reconhecimento facial.

## 1. Escolha do motor: CompreFace self-hosted

CompreFace é um software open-source (Exadel) de reconhecimento facial, distribuído via Docker, que roda inteiramente em infraestrutura própria — não é um serviço de nuvem de terceiros. Foi escolhido em vez de APIs de nuvem (AWS Rekognition, Azure Face, Google Vision) justamente porque nenhuma foto de aluno ou de turma sai da rede controlada pelo operador da aplicação.

O SDK oficial `compreface-javascript-sdk` **não será usado**: é distribuído como módulo ESM puro, incompatível com o restante do projeto (CommonJS, `require`). Em vez disso, o client (`services/compreface_client.js`) é escrito do zero usando `fetch`/`FormData` nativos do Node 24 contra a REST API documentada do CompreFace. Isso reduz a superfície de risco — o código que fala com o serviço de reconhecimento é 100% auditável e não depende de manutenção de uma lib externa de terceiro.

## 2. Topologia de rede

- O container do CompreFace é publicado com bind explícito em loopback: `ports: ["127.0.0.1:8000:8000"]` — nunca `0.0.0.0`. Isso impede qualquer acesso à API de reconhecimento vindo de fora da própria máquina/rede interna onde a aplicação roda.
- Nenhuma porta do CompreFace é exposta publicamente, em nenhum ambiente (dev, homologação, produção).
- O navegador do usuário **nunca** fala diretamente com o CompreFace. O fluxo é sempre: navegador → servidor Node (autenticado por sessão) → CompreFace (rede interna). A API key do CompreFace fica exclusivamente em variável de ambiente do servidor (`COMPREFACE_RECOGNITION_API_KEY`) e nunca é enviada ao front-end.
- A comunicação servidor↔CompreFace é HTTP simples (não HTTPS) por estarem ambos na mesma máquina/rede interna confiável via loopback. Essa decisão é aceitável **apenas** nessa topologia. Se em algum momento o CompreFace passar a rodar em host separado do servidor da aplicação, será obrigatório usar TLS ou um túnel privado (ex. WireGuard/SSH) antes de liberar tráfego entre eles — não transmitir imagens/biometria em texto claro entre máquinas distintas.

## 3. Dados enviados e armazenados

- O único identificador enviado ao CompreFace por aluno é o `user_code` (código curto já existente no sistema), usado como `subject`. Nenhum nome, e-mail, telefone ou outro dado pessoal é enviado ao CompreFace.
- O CompreFace armazena, por subject, os embeddings faciais derivados da foto de avatar aprovada — não a foto original em si (comportamento padrão do serviço).
- Ao recusar uma matrícula (`user_status='C'`), o servidor chama `removeSubjectExamples(userCode)` para apagar o cadastro biométrico do CompreFace — minimização de retenção de dado sensível mesmo sem exigência legal explícita no requisito original.
- Reenvio de avatar (recusado → refeito) também dispara remoção do exemplo anterior antes de cadastrar o novo, evitando acúmulo de biometria obsoleta.

## 4. Fotos de turma (grupo) — armazenamento e acesso

- Fotos de turma enviadas para reconhecimento **não** são salvas em `uploads/` (pasta servida publicamente sem autenticação via `express.static`, ver `config/register_express_stack.js:30`). Vão para `private_uploads/presenca_fotos/`, fora de qualquer rota estática.
- O único modo de acesso a essas imagens é a rota `GET /reconhecimento-facial/:id/imagem`, que exige sessão autenticada e `ensureProfessorRoute`, e responde com `Cache-Control: private, no-store` (sem cache em proxies/CDNs intermediários).
- Esse comportamento é diferente do avatar de perfil (`/uploads/users`), que hoje é público por URL direta — isso é um comportamento pré-existente do sistema, fora do escopo deste módulo alterar agora, e fica registrado como débito técnico a considerar separadamente (ver "Riscos residuais" abaixo).

## 5. Hardening de upload

Tanto o upload de avatar quanto o de foto de turma passam a validar, antes de gravar qualquer arquivo em disco:
- Tipo MIME restrito a `image/jpeg`, `image/png`, `image/webp`.
- Tamanho máximo de arquivo (8 MB) e limite de 1 arquivo por requisição.

Hoje (antes deste módulo) o multer de avatar (`config/multer_user_photo.js`) não tinha nenhuma dessas validações — um arquivo arbitrário podia ser gravado fisicamente em disco antes de qualquer checagem (que só acontecia depois, implicitamente, ao tentar processar com `sharp`). Esse hardening é aplicado retroativamente ao multer existente como parte da Fase 1.

## 6. Disponibilidade / modo degradado

Se o serviço CompreFace estiver fora do ar, `compreface_config.isFacialRecognitionEnabled()` + uma checagem de saúde com timeout curto (3s) fazem a tela do módulo mostrar um aviso e impedir novas tentativas de reconhecimento, sem derrubar o restante da aplicação. Nenhuma rota fora de `routes/facial_recognition.js` depende do CompreFace — presença manual, login, cadastro de aluno etc. continuam funcionando normalmente mesmo com o serviço indisponível.

## 7. Riscos residuais aceitos (e mitigação futura)

| Risco | Por que foi aceito agora | Mitigação futura |
|---|---|---|
| `/uploads/users` (avatares de perfil) continua público sem autenticação | Comportamento pré-existente do sistema; mudar exigiria revisar todos os templates que hoje renderizam `<img src="{{photo}}">` diretamente | Avaliar, em fase de polimento, estender a mesma autenticação usada nas fotos de turma também aos avatares |
| Tráfego servidor↔CompreFace em HTTP simples, não HTTPS | Loopback/rede interna confiável, sem trânsito por rede pública | Se a topologia mudar (CompreFace em outro host), exigir TLS/túnel antes de liberar |
| Sem rate limiting dedicado nas rotas de upload/reconhecimento | Fora do escopo original do requisito; rotas já exigem sessão de professor/admin autenticada | Avaliar rate limiting se uso em produção revelar abuso ou erro de integração gerando tráfego excessivo ao CompreFace |

## 8. Conclusão

A integração proposta mantém todo o processamento de imagens e biometria dentro de infraestrutura própria, sem envio a serviços de terceiros, com a API de reconhecimento acessível apenas via loopback/rede interna e nunca diretamente pelo navegador. As fotos de turma usadas para presença ficam protegidas por autenticação, diferente do que ocorre hoje com avatares de perfil. Os riscos residuais identificados são pré-existentes ao módulo ou de baixo impacto dada a topologia self-hosted, e ficam documentados para decisão futura.

**Aprovação para seguir à Fase 3 (integração real com a API do CompreFace): pendente de confirmação do responsável pela aplicação.**
