const db = require('./db');

/**
 * Modelo da tabela tb_presenca_fotos — fotos de turma enviadas para
 * reconhecimento facial, usadas para aplicar presença em lote.
 */
const PresencaFoto = db.sequelize.define(
    'PresencaFoto',
    {
        id: {
            type: db.Sequelize.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        class_code: {
            type: db.Sequelize.STRING(5),
            allowNull: false
        },
        class_type: {
            type: db.Sequelize.ENUM('Integral', 'Gi', 'No-Gi'),
            allowNull: false
        },
        reference_date: {
            type: db.Sequelize.DATEONLY,
            allowNull: false
        },
        weekday_label: {
            type: db.Sequelize.STRING(20),
            allowNull: false
        },
        sequence_label: {
            type: db.Sequelize.STRING(10),
            allowNull: true
        },
        file_path: {
            type: db.Sequelize.STRING(255),
            allowNull: false
        },
        file_hash: {
            type: db.Sequelize.STRING(64),
            allowNull: false
        },
        uploaded_by: {
            type: db.Sequelize.STRING(5),
            allowNull: false
        },
        status: {
            type: db.Sequelize.ENUM('PROCESSING', 'REVIEW', 'APPLIED', 'CANCELLED', 'FAILED'),
            allowNull: false,
            defaultValue: 'PROCESSING'
        },
        compreface_raw_response: {
            type: db.Sequelize.JSON,
            allowNull: true
        },
        applied_at: {
            type: db.Sequelize.DATE,
            allowNull: true
        },
        applied_by: {
            type: db.Sequelize.STRING(5),
            allowNull: true
        }
    },
    {
        tableName: 'tb_presenca_fotos',
        timestamps: true,
        underscored: true
    }
);

module.exports = PresencaFoto;
