/**
 * Relacionamentos entre tabelas que o Sequelize precisa conhecer.
 * Metas ↔ Turmas (N:N) e Notificações → Usuário.
 */

const Usuario = require('./Usuario');
const Turma = require('./Turma');
const MetaAula = require('./MetaAula');
const MetaAulaTurma = require('./MetaAulaTurma');
const Notificacao = require('./Notificacao');
const Presenca = require('./Presenca');
const PresencaFoto = require('./PresencaFoto');
const PresencaFotoRosto = require('./PresencaFotoRosto');

MetaAula.belongsTo(Usuario, {
    as: 'criador',
    foreignKey: 'created_by',
    targetKey: 'user_code'
});
MetaAula.belongsToMany(Turma, {
    through: MetaAulaTurma,
    foreignKey: 'meta_id',
    otherKey: 'class_code',
    targetKey: 'class_code',
    as: 'turmas'
});
Turma.belongsToMany(MetaAula, {
    through: MetaAulaTurma,
    foreignKey: 'class_code',
    otherKey: 'meta_id',
    sourceKey: 'class_code',
    as: 'metas'
});
MetaAulaTurma.belongsTo(MetaAula, {
    foreignKey: 'meta_id',
    targetKey: 'id'
});
MetaAulaTurma.belongsTo(Turma, {
    foreignKey: 'class_code',
    targetKey: 'class_code'
});

Notificacao.belongsTo(Usuario, {
    as: 'destinatario',
    foreignKey: 'user_code',
    targetKey: 'user_code'
});

// Reconhecimento facial: foto de turma -> turma/professor, e rostos detectados -> foto/aluno/presença
PresencaFoto.belongsTo(Turma, {
    as: 'turma',
    foreignKey: 'class_code',
    targetKey: 'class_code'
});
PresencaFoto.belongsTo(Usuario, {
    as: 'professor',
    foreignKey: 'uploaded_by',
    targetKey: 'user_code'
});
PresencaFoto.belongsTo(Usuario, {
    as: 'aplicadoPor',
    foreignKey: 'applied_by',
    targetKey: 'user_code'
});
PresencaFoto.hasMany(PresencaFotoRosto, {
    as: 'rostos',
    foreignKey: 'presenca_foto_id'
});

PresencaFotoRosto.belongsTo(PresencaFoto, {
    as: 'foto',
    foreignKey: 'presenca_foto_id'
});
PresencaFotoRosto.belongsTo(Usuario, {
    as: 'aluno',
    foreignKey: 'matched_user_code',
    targetKey: 'user_code'
});
PresencaFotoRosto.belongsTo(Presenca, {
    as: 'presenca',
    foreignKey: 'presenca_id'
});

