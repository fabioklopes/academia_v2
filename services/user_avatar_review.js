'use strict';

/**
 * Avatar self-service (módulo de reconhecimento facial): aluno envia
 * uma nova foto, ela fica PENDING até um professor/admin aprovar ou
 * recusar. Reaproveita o mesmo diretório/otimização de imagem já
 * usado para fotos de usuário (config/multer_user_photo.js, lib/avatar_image.js).
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const Usuario = require('../models/Usuario');
const Notificacao = require('../models/Notificacao');
const { sequelize } = require('../models/db');
const { uploadsDir } = require('../config/multer_user_photo');
const { formatTimestampForFile, optimizeImageTo1MB } = require('../lib/avatar_image');
const { isFacialRecognitionEnabled } = require('../config/compreface_config');
const compreFaceClient = require('./compreface_client');

const MIN_DIMENSION_PX = 400;

function getFileNameFromPath(photoPath) {
    if (typeof photoPath !== 'string' || !photoPath) {
        return '';
    }
    return path.basename(photoPath);
}

async function removeFileIfExists(fileName) {
    if (!fileName) {
        return;
    }
    const filePath = path.join(uploadsDir, fileName);
    if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
    }
}

/** Valida e salva a foto enviada pelo próprio usuário como pendente de aprovação. */
async function submitPendingAvatar(usuario, tempFileName) {
    const tempFilePath = path.join(uploadsDir, tempFileName);

    try {
        const metadata = await sharp(tempFilePath).metadata();
        if (!metadata.width || !metadata.height || metadata.width < MIN_DIMENSION_PX || metadata.height < MIN_DIMENSION_PX) {
            throw new Error(`A foto precisa ter pelo menos ${MIN_DIMENSION_PX}x${MIN_DIMENSION_PX} pixels.`);
        }

        await removeFileIfExists(getFileNameFromPath(usuario.photo_pending_path));

        const timestamp = formatTimestampForFile(new Date());
        const finalFileName = `pending_${usuario.id}_${timestamp}.jpg`;
        const finalFilePath = path.join(uploadsDir, finalFileName);
        await optimizeImageTo1MB(tempFilePath, finalFilePath);

        if (fs.existsSync(tempFilePath)) {
            await fs.promises.unlink(tempFilePath);
        }

        usuario.photo_pending_path = `/uploads/users/${finalFileName}`;
        usuario.photo_status = 'PENDING';
        usuario.photo_rejected_reason = null;
        await usuario.save();

        return usuario;
    } catch (error) {
        if (fs.existsSync(tempFilePath)) {
            await fs.promises.unlink(tempFilePath);
        }
        throw error;
    }
}

/** Professor/admin aprova a foto pendente: ela passa a ser o avatar oficial do usuário. */
async function approveAvatar(usuario, reviewerUserCode) {
    if (usuario.photo_status !== 'PENDING' || !usuario.photo_pending_path) {
        throw new Error('Este usuário não possui foto pendente de aprovação.');
    }

    await removeFileIfExists(getFileNameFromPath(usuario.photo));

    usuario.photo = usuario.photo_pending_path;
    usuario.photo_pending_path = null;
    usuario.photo_status = 'APPROVED';
    usuario.photo_rejected_reason = null;
    usuario.photo_reviewed_by = reviewerUserCode;
    usuario.photo_reviewed_at = new Date();
    usuario.compreface_subject_id = usuario.user_code;
    await usuario.save();

    await Notificacao.create({
        user_code: usuario.user_code,
        kind: 'AVATAR_APROVADO',
        title: 'Sua foto de perfil foi aprovada',
        body: 'A foto que você enviou foi aprovada e já é seu avatar oficial.'
    });

    await registerSubjectBestEffort(usuario);

    return usuario;
}

/**
 * Cadastra o avatar aprovado no CompreFace, se o serviço estiver habilitado.
 * Best-effort: se o CompreFace estiver fora do ar, a aprovação local não falha
 * por isso — só fica sem o cadastro biométrico até a próxima tentativa.
 */
async function registerSubjectBestEffort(usuario) {
    if (!isFacialRecognitionEnabled()) {
        return;
    }
    try {
        const filePath = path.join(uploadsDir, getFileNameFromPath(usuario.photo));
        const buffer = await fs.promises.readFile(filePath);
        await compreFaceClient.addSubjectExample(usuario.user_code, buffer);
    } catch (err) {
        console.error('[reconhecimento-facial] Falha ao cadastrar subject no CompreFace:', err.message);
    }
}

/** Professor/admin recusa a foto pendente, com motivo, para o usuário refazer. */
async function rejectAvatar(usuario, reviewerUserCode, reason) {
    if (usuario.photo_status !== 'PENDING' || !usuario.photo_pending_path) {
        throw new Error('Este usuário não possui foto pendente de aprovação.');
    }
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmedReason) {
        throw new Error('Informe o motivo da recusa.');
    }

    await removeFileIfExists(getFileNameFromPath(usuario.photo_pending_path));

    usuario.photo_pending_path = null;
    usuario.photo_status = 'REJECTED';
    usuario.photo_rejected_reason = trimmedReason;
    usuario.photo_reviewed_by = reviewerUserCode;
    usuario.photo_reviewed_at = new Date();
    await usuario.save();

    await Notificacao.create({
        user_code: usuario.user_code,
        kind: 'AVATAR_RECUSADO',
        title: 'Sua foto de perfil foi recusada',
        body: trimmedReason
    });

    return usuario;
}

/** Estatísticas de adesão ao avatar padrão (dashboard de rollout do admin). */
async function getAvatarRolloutStats() {
    const rows = await Usuario.findAll({
        attributes: ['photo_status', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
        where: { user_status: 'A' },
        group: ['photo_status'],
        raw: true
    });

    const counts = { NONE: 0, PENDING: 0, APPROVED: 0, REJECTED: 0 };
    let total = 0;
    rows.forEach((row) => {
        counts[row.photo_status] = Number(row.total);
        total += Number(row.total);
    });

    return {
        total,
        counts,
        approvedPercent: total > 0 ? Math.round((counts.APPROVED / total) * 100) : 0,
        allApproved: total > 0 && counts.APPROVED === total
    };
}

module.exports = {
    MIN_DIMENSION_PX,
    submitPendingAvatar,
    approveAvatar,
    rejectAvatar,
    getAvatarRolloutStats
};
