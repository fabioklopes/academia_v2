/**
 * Relacionamentos entre tabelas que o Sequelize precisa conhecer.
 * Metas ↔ Turmas (N:N) e Notificações → Usuário.
 */

const Usuario = require('./Usuario');
const Turma = require('./Turma');
const MetaAula = require('./MetaAula');
const MetaAulaTurma = require('./MetaAulaTurma');
const Notificacao = require('./Notificacao');

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
