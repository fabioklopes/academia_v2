/**
 * Adiciona colunas usadas em "Meu Perfil" / troca de e-mail
 * e ajusta tamanhos de kimono na tabela tb_usuarios.
 *
 * Uso: node scripts/migrate_tb_usuarios_meuperfil.js
 */
require('dotenv').config();
const { sequelize } = require('../models/db');

const TABLE = 'tb_usuarios';

async function columnExists(table, column) {
    const dbName = sequelize.config.database;
    const [rows] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = :dbName AND TABLE_NAME = :tableName AND COLUMN_NAME = :colName`,
        {
            replacements: { dbName, tableName: table, colName: column }
        }
    );
    return Number(rows[0].cnt) > 0;
}

async function addColumnIfMissing(column, ddl) {
    if (await columnExists(TABLE, column)) {
        console.log(`[skip] ${TABLE}.${column} já existe.`);
        return;
    }
    await sequelize.query(ddl);
    console.log(`[ok] ${TABLE}.${column} criada.`);
}

async function main() {
    await sequelize.authenticate();
    console.log('Conexão OK. Aplicando migração em', TABLE, '...');

    await addColumnIfMissing(
        'pending_email',
        `ALTER TABLE \`${TABLE}\` ADD COLUMN \`pending_email\` VARCHAR(255) NULL`
    );
    await addColumnIfMissing(
        'email_change_token_hash',
        `ALTER TABLE \`${TABLE}\` ADD COLUMN \`email_change_token_hash\` VARCHAR(255) NULL`
    );
    await addColumnIfMissing(
        'email_change_expires',
        `ALTER TABLE \`${TABLE}\` ADD COLUMN \`email_change_expires\` DATETIME NULL`
    );

    await sequelize.query(
        `ALTER TABLE \`${TABLE}\`
            MODIFY \`wagi_size\` VARCHAR(4) NOT NULL,
            MODIFY \`zubon_size\` VARCHAR(4) NOT NULL,
            MODIFY \`obi_size\` VARCHAR(3) NOT NULL`
    );
    console.log('[ok] wagi_size, zubon_size e obi_size ajustados para VARCHAR(4)/(3).');

    console.log('Migração concluída.');
    await sequelize.close();
    process.exit(0);
}

main().catch(async (err) => {
    console.error('Erro na migração:', err.message);
    try {
        await sequelize.close();
    } catch (_e) {
        // ignore
    }
    process.exit(1);
});
