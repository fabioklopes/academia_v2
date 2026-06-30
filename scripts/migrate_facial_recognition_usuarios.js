/**
 * Adiciona colunas de avatar self-service / aprovação de foto e
 * vínculo com o CompreFace na tabela tb_usuarios.
 *
 * Uso: node scripts/migrate_facial_recognition_usuarios.js
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
        'photo_status',
        `ALTER TABLE \`${TABLE}\` ADD COLUMN \`photo_status\` ENUM('NONE','PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'NONE'`
    );
    await addColumnIfMissing(
        'photo_pending_path',
        `ALTER TABLE \`${TABLE}\` ADD COLUMN \`photo_pending_path\` VARCHAR(255) NULL`
    );
    await addColumnIfMissing(
        'photo_rejected_reason',
        `ALTER TABLE \`${TABLE}\` ADD COLUMN \`photo_rejected_reason\` VARCHAR(255) NULL`
    );
    await addColumnIfMissing(
        'photo_reviewed_by',
        `ALTER TABLE \`${TABLE}\` ADD COLUMN \`photo_reviewed_by\` VARCHAR(5) NULL`
    );
    await addColumnIfMissing(
        'photo_reviewed_at',
        `ALTER TABLE \`${TABLE}\` ADD COLUMN \`photo_reviewed_at\` DATETIME NULL`
    );
    await addColumnIfMissing(
        'compreface_subject_id',
        `ALTER TABLE \`${TABLE}\` ADD COLUMN \`compreface_subject_id\` VARCHAR(64) NULL`
    );

    console.log('Migração concluída.');
    await sequelize.close();
    process.exit(0);
}

if (require.main === module) {
    main().catch(async (err) => {
        console.error('Erro na migração:', err.message);
        try {
            await sequelize.close();
        } catch (_e) {
            // ignore
        }
        process.exit(1);
    });
}

module.exports = { main, columnExists, addColumnIfMissing, TABLE };
