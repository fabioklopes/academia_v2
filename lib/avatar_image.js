'use strict';

const fs = require('fs');
const sharp = require('sharp');

/** Formata uma data como AAAAMMDDHHmmss, para nomes de arquivo únicos. */
function formatTimestampForFile(dateValue) {
    const date = new Date(dateValue);
    const pad = (n) => String(n).padStart(2, '0');

    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Redimensiona foto para 500x500 px com qualidade fixa de 80%. Resultado máximo: 2 MB. */
async function optimizeImageTo1MB(inputPath, outputPath) {
    const buffer = await sharp(inputPath)
        .resize(500, 500, {
            fit: 'cover',
            position: 'center'
        })
        .jpeg({ quality: 80, progressive: true })
        .toBuffer();

    await fs.promises.writeFile(outputPath, buffer);
    return buffer.length;
}

module.exports = { formatTimestampForFile, optimizeImageTo1MB };
