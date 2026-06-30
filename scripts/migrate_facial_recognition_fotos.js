/**
 * Cria as tabelas tb_presenca_fotos (fotos de turma enviadas para
 * reconhecimento facial) e tb_presenca_foto_rostos (rostos detectados
 * em cada foto, com o respectivo aluno identificado).
 *
 * Uso: node scripts/migrate_facial_recognition_fotos.js
 */
require('dotenv').config();
const { sequelize } = require('../models/db');

async function tableExists(table) {
    const dbName = sequelize.config.database;
    const [rows] = await sequelize.query(
        `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = :dbName AND TABLE_NAME = :tableName`,
        {
            replacements: { dbName, tableName: table }
        }
    );
    return Number(rows[0].cnt) > 0;
}

async function createTableIfMissing(table, ddl) {
    if (await tableExists(table)) {
        console.log(`[skip] ${table} já existe.`);
        return;
    }
    await sequelize.query(ddl);
    console.log(`[ok] ${table} criada.`);
}

async function main() {
    await sequelize.authenticate();
    console.log('Conexão OK. Aplicando migração de tabelas de reconhecimento facial...');

    await createTableIfMissing(
        'tb_presenca_fotos',
        `CREATE TABLE \`tb_presenca_fotos\` (
            \`id\` INT AUTO_INCREMENT PRIMARY KEY,
            \`class_code\` VARCHAR(5) NOT NULL,
            \`class_type\` ENUM('Integral','Gi','No-Gi') NOT NULL,
            \`reference_date\` DATE NOT NULL,
            \`weekday_label\` VARCHAR(20) NOT NULL,
            \`sequence_label\` VARCHAR(10) NULL,
            \`file_path\` VARCHAR(255) NOT NULL,
            \`file_hash\` VARCHAR(64) NOT NULL,
            \`uploaded_by\` VARCHAR(5) NOT NULL,
            \`status\` ENUM('PROCESSING','REVIEW','APPLIED','CANCELLED','FAILED') NOT NULL DEFAULT 'PROCESSING',
            \`compreface_raw_response\` JSON NULL,
            \`applied_at\` DATETIME NULL,
            \`applied_by\` VARCHAR(5) NULL,
            \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY \`uq_presenca_foto_dedupe\` (\`class_code\`, \`reference_date\`, \`sequence_label\`, \`file_hash\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await createTableIfMissing(
        'tb_presenca_foto_rostos',
        `CREATE TABLE \`tb_presenca_foto_rostos\` (
            \`id\` INT AUTO_INCREMENT PRIMARY KEY,
            \`presenca_foto_id\` INT NOT NULL,
            \`box_x_min\` INT NOT NULL,
            \`box_y_min\` INT NOT NULL,
            \`box_x_max\` INT NOT NULL,
            \`box_y_max\` INT NOT NULL,
            \`matched_user_code\` VARCHAR(5) NULL,
            \`match_source\` ENUM('AUTO','MANUAL','NONE') NOT NULL DEFAULT 'NONE',
            \`match_similarity\` DECIMAL(5,4) NULL,
            \`status\` ENUM('RECOGNIZED','UNRECOGNIZED','IGNORED') NOT NULL DEFAULT 'UNRECOGNIZED',
            \`presenca_id\` INT NULL,
            \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY \`idx_presenca_foto\` (\`presenca_foto_id\`),
            KEY \`idx_matched_user\` (\`matched_user_code\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
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

module.exports = { main, tableExists, createTableIfMissing };
