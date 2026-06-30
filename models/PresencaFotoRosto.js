const db = require('./db');

/**
 * Modelo da tabela tb_presenca_foto_rostos — cada rosto detectado numa
 * foto de turma, com a respectiva caixa delimitadora e o aluno
 * identificado (automaticamente pelo CompreFace ou manualmente pelo professor).
 */
const PresencaFotoRosto = db.sequelize.define(
    'PresencaFotoRosto',
    {
        id: {
            type: db.Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        presenca_foto_id: {
            type: db.Sequelize.INTEGER,
            allowNull: false
        },
        box_x_min: {
            type: db.Sequelize.INTEGER,
            allowNull: false
        },
        box_y_min: {
            type: db.Sequelize.INTEGER,
            allowNull: false
        },
        box_x_max: {
            type: db.Sequelize.INTEGER,
            allowNull: false
        },
        box_y_max: {
            type: db.Sequelize.INTEGER,
            allowNull: false
        },
        matched_user_code: {
            type: db.Sequelize.STRING(5),
            allowNull: true
        },
        match_source: {
            type: db.Sequelize.ENUM('AUTO', 'MANUAL', 'NONE'),
            allowNull: false,
            defaultValue: 'NONE'
        },
        match_similarity: {
            type: db.Sequelize.DECIMAL(5, 4),
            allowNull: true
        },
        status: {
            type: db.Sequelize.ENUM('RECOGNIZED', 'UNRECOGNIZED', 'IGNORED'),
            allowNull: false,
            defaultValue: 'UNRECOGNIZED'
        },
        presenca_id: {
            type: db.Sequelize.INTEGER,
            allowNull: true
        }
    },
    {
        tableName: 'tb_presenca_foto_rostos',
        timestamps: true,
        underscored: true
    }
);

module.exports = PresencaFotoRosto;
