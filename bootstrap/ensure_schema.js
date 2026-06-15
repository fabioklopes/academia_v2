'use strict';

/**
 * Ajustes automáticos no banco de dados quando o servidor sobe.
 * Garante que colunas e tabelas existam sem precisar rodar migrações manuais.
 */

const Usuario = require('../models/Usuario');
const Presenca = require('../models/Presenca');
const Turma = require('../models/Turma');
const TurmaAluno = require('../models/TurmaAluno');
const MetaAula = require('../models/MetaAula');
const MetaAulaTurma = require('../models/MetaAulaTurma');
const MensagemProfessor = require('../models/MensagemProfessor');
const MensagemProfessorOcultacao = require('../models/MensagemProfessorOcultacao');
const MensagemProfessorLeitura = require('../models/MensagemProfessorLeitura');
const AppActivityLog = require('../models/AppActivityLog');
const Notificacao = require('../models/Notificacao');
const { sequelize, Sequelize } = require('../models/db');

const USUARIOS_TABLE = 'tb_usuarios';

/**
 * Remove índices redundantes em tb_usuarios (efeito de sync alter repetido no MySQL).
 * Agrupa por colunas + unicidade e mantém só o primeiro de cada grupo.
 */
async function dedupeUsuarioRedundantIndexes() {
    const dialect = sequelize.getDialect();
    if (dialect !== 'mysql' && dialect !== 'mariadb') {
        return;
    }

    const queryInterface = sequelize.getQueryInterface();
    try {
        await queryInterface.describeTable(USUARIOS_TABLE);
    } catch (_err) {
        return;
    }

    const [rows] = await sequelize.query(`
        SELECT
            INDEX_NAME,
            MAX(NON_UNIQUE) AS non_unique,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = :tableName
          AND INDEX_NAME <> 'PRIMARY'
        GROUP BY INDEX_NAME
        ORDER BY INDEX_NAME
    `, {
        replacements: { tableName: USUARIOS_TABLE }
    });

    if (!rows || rows.length === 0) {
        return;
    }

    const groups = new Map();
    for (const row of rows) {
        const signature = `${row.non_unique}:${row.cols}`;
        if (!groups.has(signature)) {
            groups.set(signature, []);
        }
        groups.get(signature).push(row.INDEX_NAME);
    }

    for (const indexNames of groups.values()) {
        if (indexNames.length <= 1) {
            continue;
        }

        const sorted = indexNames.slice().sort();
        const keepName = sorted[0];

        for (let i = 1; i < sorted.length; i += 1) {
            const dropName = sorted[i];
            await sequelize.query(`ALTER TABLE \`${USUARIOS_TABLE}\` DROP INDEX \`${dropName}\``);
            console.log(`Indice redundante removido em ${USUARIOS_TABLE}: ${dropName} (mantido ${keepName})`);
        }
    }
}

/** Remove índice UNIQUE do e-mail para permitir mesmo e-mail em titular e dependentes. */
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

/** Remove a tabela tb_permissoes (módulo WhatsApp descontinuado). */
async function dropPermissoesTableIfExists() {
    const dialect = sequelize.getDialect();
    if (dialect !== 'mysql' && dialect !== 'mariadb') {
        return;
    }
    try {
        await sequelize.query('DROP TABLE IF EXISTS `tb_permissoes`');
        console.log('Tabela tb_permissoes removida (módulo WhatsApp descontinuado).');
    } catch (err) {
        console.error('Aviso: não foi possível remover tb_permissoes:', err.message);
    }
}

/** Adiciona coluna class_code em tb_usuarios se ainda não existir. */
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

/** Adiciona coluna para o aluno desativar mensagens de aniversário. */
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

/** Guarda em qual ano o aluno pediu para não ver mais mensagens de aniversário. */
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

/**
 * Sincroniza tabelas na ordem das dependências (FK).
 * tb_usuarios precisa existir antes de metas, mensagens etc.
 */
async function ensureTurmaSchema() {
    await dropPermissoesTableIfExists();
    await dedupeUsuarioRedundantIndexes();
    // sync() sem alter: evita criar dezenas de índices UNIQUE duplicados no MySQL.
    await Usuario.sync();
    await Presenca.sync();
    await Turma.sync();
    await TurmaAluno.sync();
    await MetaAula.sync();
    await MetaAulaTurma.sync();
    await MensagemProfessor.sync();
    await MensagemProfessorOcultacao.sync();
    await MensagemProfessorLeitura.sync();
    await AppActivityLog.sync();
    await Notificacao.sync();
    await ensureUsuarioClassCodeColumn();
    await ensureUsuarioBirthdayMessagesDisabledColumn();
    await ensureUsuarioBirthdayMessagesDisabledYearColumn();
}

module.exports = {
    dedupeUsuarioRedundantIndexes,
    ensureUsuarioEmailNotUnique,
    dropPermissoesTableIfExists,
    ensureTurmaSchema
};
