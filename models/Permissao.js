'use strict';

const db = require('./db');

const Permissao = db.sequelize.define('tb_permissoes', {
    user_code: {
        type: db.Sequelize.STRING(5),
        allowNull: false,
        unique: true
    },
    whatsapp_notifications_enabled: {
        type: db.Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
    }
});

Permissao.associate = (models) => {
    if (!models || !models.Usuario) {
        return;
    }

    Permissao.belongsTo(models.Usuario, {
        as: 'usuario',
        foreignKey: 'user_code',
        targetKey: 'user_code'
    });
};

module.exports = Permissao;
