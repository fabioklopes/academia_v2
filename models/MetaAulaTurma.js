const db = require('./db');

const MetaAulaTurma = db.sequelize.define('tb_meta_aula_turmas', {
    meta_id: {
        type: db.Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true
    },
    class_code: {
        type: db.Sequelize.STRING(5),
        allowNull: false,
        primaryKey: true
    }
});

MetaAulaTurma.associate = (models) => {
    if (!models || !models.MetaAula || !models.Turma) {
        return;
    }

    MetaAulaTurma.belongsTo(models.MetaAula, {
        foreignKey: 'meta_id',
        targetKey: 'id'
    });

    MetaAulaTurma.belongsTo(models.Turma, {
        foreignKey: 'class_code',
        targetKey: 'class_code'
    });
};

module.exports = MetaAulaTurma;
