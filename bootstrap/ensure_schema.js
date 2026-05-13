'use strict';

const Turma = require('../models/Turma');
const TurmaAluno = require('../models/TurmaAluno');
const MensagemProfessor = require('../models/MensagemProfessor');
const MensagemProfessorOcultacao = require('../models/MensagemProfessorOcultacao');
const MensagemProfessorLeitura = require('../models/MensagemProfessorLeitura');
const AppActivityLog = require('../models/AppActivityLog');
const Notificacao = require('../models/Notificacao');
const { sequelize, Sequelize } = require('../models/db');

async function ensureUsuarioEmailNotUnique() {
    const dialect = sequelize.getDialect();

    if (dialect !== 'mysql' && dialect !== 'mariadb') {
        return;
    }

    const [indexes] = await sequelize.query(`
        SELECT INDEX_NAME
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'tb_usuarios'
          AND COLUMN_NAME = 'email'
          AND NON_UNIQUE = 0
          AND INDEX_NAME <> 'PRIMARY'
    `);

    for (const row of indexes) {
        if (!row || !row.INDEX_NAME) {
            continue;
        }

        await sequelize.query(`ALTER TABLE tb_usuarios DROP INDEX \`${row.INDEX_NAME}\``);
        console.log(`Indice unico removido em tb_usuarios.email: ${row.INDEX_NAME}`);
    }
}

async function ensureUsuarioClassCodeColumn() {
    const queryInterface = sequelize.getQueryInterface();
    const tableDescription = await queryInterface.describeTable('tb_usuarios');

    if (!tableDescription.class_code) {
        await queryInterface.addColumn('tb_usuarios', 'class_code', {
            type: Sequelize.STRING(5),
            allowNull: true
        });
        console.log('Coluna class_code adicionada em tb_usuarios.');
    }
}

async function ensureUsuarioBirthdayMessagesDisabledColumn() {
    const queryInterface = sequelize.getQueryInterface();
    const tableDescription = await queryInterface.describeTable('tb_usuarios');

    if (!tableDescription.birthday_messages_disabled) {
        await queryInterface.addColumn('tb_usuarios', 'birthday_messages_disabled', {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false
        });
        console.log('Coluna birthday_messages_disabled adicionada em tb_usuarios.');
    }
}

async function ensureUsuarioBirthdayMessagesDisabledYearColumn() {
    const queryInterface = sequelize.getQueryInterface();
    const tableDescription = await queryInterface.describeTable('tb_usuarios');

    if (!tableDescription.birthday_messages_disabled_year) {
        await queryInterface.addColumn('tb_usuarios', 'birthday_messages_disabled_year', {
            type: Sequelize.INTEGER,
            allowNull: true
        });
        console.log('Coluna birthday_messages_disabled_year adicionada em tb_usuarios.');
    }

    await queryInterface.bulkUpdate(
        'tb_usuarios',
        { birthday_messages_disabled_year: new Date().getFullYear() },
        {
            birthday_messages_disabled: true,
            birthday_messages_disabled_year: null
        }
    );
}

async function ensureTurmaSchema() {
    await Turma.sync();
    await TurmaAluno.sync();
    await MensagemProfessor.sync();
    await MensagemProfessorOcultacao.sync();
    await MensagemProfessorLeitura.sync();
    await AppActivityLog.sync({ alter: true });
    await Notificacao.sync({ alter: true });
    await ensureUsuarioClassCodeColumn();
    await ensureUsuarioBirthdayMessagesDisabledColumn();
    await ensureUsuarioBirthdayMessagesDisabledYearColumn();
}

module.exports = {
    ensureUsuarioEmailNotUnique,
    ensureTurmaSchema
};
