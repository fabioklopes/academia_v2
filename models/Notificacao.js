const db = require('./db');

// tb_notificacoes — avisos in-app para alunos (ex.: decisão de solicitação de presença)
const Notificacao = db.sequelize.define('tb_notificacoes', {
    user_code: {
        type: db.Sequelize.STRING(5),
        allowNull: false
    },
    kind: {
        type: db.Sequelize.STRING(32),
        allowNull: false
    },
    title: {
        type: db.Sequelize.STRING(120),
        allowNull: false
    },
    body: {
        type: db.Sequelize.TEXT,
        allowNull: true
    },
    presenca_id: {
        type: db.Sequelize.INTEGER,
        allowNull: true
    },
    read_at: {
        type: db.Sequelize.DATE,
        allowNull: true
    }
});

Notificacao.associate = (models) => {
    if (!models || !models.Usuario) {
        return;
    }
    Notificacao.belongsTo(models.Usuario, {
        as: 'destinatario',
        foreignKey: 'user_code',
        targetKey: 'user_code'
    });
};

module.exports = Notificacao;
