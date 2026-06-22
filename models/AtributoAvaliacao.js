'use strict';

/**
 * Modelo para avaliações de atributos de alunos.
 * Cada registro representa uma sessão de avaliação (por data/aluno).
 * Pontuação por atributo: 0–3 por avaliação; máximo 1 avaliação por aluno/dia.
 */

const db = require('./db');

const AtributoAvaliacao = db.sequelize.define('tb_atributos_avaliacoes', {
    id: {
        type: db.Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    user_code: {
        type: db.Sequelize.STRING(5),
        allowNull: false
    },
    evaluation_date: {
        type: db.Sequelize.DATEONLY,
        allowNull: false
    },
    forca: {
        type: db.Sequelize.TINYINT,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0, max: 3 }
    },
    tecnica: {
        type: db.Sequelize.TINYINT,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0, max: 3 }
    },
    resistencia: {
        type: db.Sequelize.TINYINT,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0, max: 3 }
    },
    agilidade: {
        type: db.Sequelize.TINYINT,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0, max: 3 }
    },
    ataque: {
        type: db.Sequelize.TINYINT,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0, max: 3 }
    },
    defesa: {
        type: db.Sequelize.TINYINT,
        allowNull: false,
        defaultValue: 0,
        validate: { min: 0, max: 3 }
    },
    evaluated_by: {
        type: db.Sequelize.STRING(5),
        allowNull: false
    }
}, {
    indexes: [
        { unique: true, fields: ['user_code', 'evaluation_date'] }
    ]
});

module.exports = AtributoAvaliacao;
