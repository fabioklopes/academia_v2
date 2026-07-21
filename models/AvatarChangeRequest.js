const db = require('./db');

// tb_avatar_change_requests — solicitações de alunos aguardando aprovação de novo avatar
const AvatarChangeRequest = db.sequelize.define('tb_avatar_change_requests', {
    user_code: {
        type: db.Sequelize.STRING(5),
        allowNull: false
    },
    temp_photo_filename: {
        type: db.Sequelize.STRING,
        allowNull: false
    }
});

AvatarChangeRequest.associate = models => {
    if (!models || !models.Usuario) {
        return;
    }

    AvatarChangeRequest.belongsTo(models.Usuario, {
        as: 'aluno',
        foreignKey: 'user_code',
        targetKey: 'user_code'
    });
};

module.exports = AvatarChangeRequest;
