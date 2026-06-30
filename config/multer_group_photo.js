/**
 * Configuração do Multer para upload de fotos de turma (reconhecimento facial).
 * Diferente das fotos de avatar, estas vão para private_uploads/ — pasta
 * FORA do express.static, nunca acessível por URL pública direta.
 */

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const uploadsDir = path.join(__dirname, '..', 'private_uploads', 'presenca_fotos');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
        const tempName = `temp_${Date.now()}_${Math.round(Math.random() * 1e9)}${path.extname(file.originalname || '.jpg')}`;
        cb(null, tempName);
    }
});

const ALLOWED_MIME_TYPES = /^image\/(jpeg|png|webp)$/;

const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
        const ok = ALLOWED_MIME_TYPES.test(file.mimetype);
        if (ok) {
            return cb(null, true);
        }
        const err = new Error('Formato de imagem inválido. Envie JPEG, PNG ou WEBP.');
        err.statusCode = 400;
        return cb(err, false);
    }
});

module.exports = { uploadsDir, upload };
