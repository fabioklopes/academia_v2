/**
 * Desfaz as migrations do módulo de reconhecimento facial: remove as
 * colunas adicionadas em tb_usuarios e apaga tb_presenca_fotos /
 * tb_presenca_foto_rostos. Idempotente — pode ser rodado mais de uma vez.
 *
 * Uso: node scripts/rollback_facial_recognition.js
 */
require('dotenv').config();
const { sequelize } = require('../models/db');

const USUARIOS_TABLE = 'tb_usuarios';
const USUARIOS_COLUMNS = [
    'photo_status',
    'photo_pending_path',
    'photo_rejected_reason',
    'photo_reviewed_by',
    'photo_reviewed_at',
    'compreface_subject_id'
];
const FOTOS_TABLES = ['tb_presenca_foto_rostos', 'tb_presenca_fotos'];

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

async function dropColumnIfPresent(table, column) {
    if (!(await columnExists(table, column))) {
        console.log(`[skip] ${table}.${column} não existe.`);
        return;
    }
    await sequelize.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
    console.log(`[ok] ${table}.${column} removida.`);
}

async function dropTableIfPresent(table) {
    await sequelize.query(`DROP TABLE IF EXISTS \`${table}\``);
    console.log(`[ok] ${table} removida (se existia).`);
}

async function main() {
    await sequelize.authenticate();
    console.log('Conexão OK. Revertendo migrations de reconhecimento facial...');

    for (const table of FOTOS_TABLES) {
        await dropTableIfPresent(table);
    }

    for (const column of USUARIOS_COLUMNS) {
        await dropColumnIfPresent(USUARIOS_TABLE, column);
    }

    console.log('Rollback concluído.');
    await sequelize.close();
    process.exit(0);
}

if (require.main === module) {
    main().catch(async (err) => {
        console.error('Erro no rollback:', err.message);
        try {
            await sequelize.close();
        } catch (_e) {
            // ignore
        }
        process.exit(1);
    });
}

module.exports = { main, columnExists, dropColumnIfPresent, dropTableIfPresent, USUARIOS_TABLE, USUARIOS_COLUMNS, FOTOS_TABLES };
