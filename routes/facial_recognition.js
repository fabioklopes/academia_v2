'use strict';

const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const Usuario = require('../models/Usuario');
const Turma = require('../models/Turma');
const Presenca = require('../models/Presenca');
const Notificacao = require('../models/Notificacao');
const PresencaFoto = require('../models/PresencaFoto');
const PresencaFotoRosto = require('../models/PresencaFotoRosto');
const { ensureProfessorRoute, ensureAdminRoute } = require('../middleware/authorization');
const { getErrorViewModel } = require('../middleware/http_errors');
const { buildPaginationVm } = require('../lib/pure_helpers');
const { presencaUtcRangeForYmd, presencaDuplicateQueryRange, presencaMatchesSolicitacaoDay } = require('../lib/presenca_dates');
const { uploadsDir: groupPhotosDir, upload: groupPhotoUpload } = require('../config/multer_group_photo');
const { upload: avatarUpload } = require('../config/multer_user_photo');
const { isFacialRecognitionEnabled } = require('../config/compreface_config');
const compreFaceClient = require('../services/compreface_client');
const {
    submitPendingAvatar,
    approveAvatar,
    rejectAvatar,
    getAvatarRolloutStats
} = require('../services/user_avatar_review');
const {
    parseReferenceDate,
    getWeekdayLabel,
    resolveClassType,
    resolveSequenceLabel,
    computeFileHash,
    decideFaceMatch,
    buildFinalFileName
} = require('../services/facial_recognition');

const PENDING_PHOTOS_PER_PAGE = 10;
const PENDING_PHOTOS_PAGES_PER_BLOCK = 8;

/** Envolve um middleware do multer para responder erro em JSON, em vez de cair no handler global de erros. */
function wrapUpload(multerMiddleware) {
    return (req, res, next) => {
        multerMiddleware(req, res, (err) => {
            if (err) {
                return res.status(err.statusCode || 400).json({ ok: false, mensagem: err.message || 'Falha no upload.' });
            }
            return next();
        });
    };
}

/** Mesma ideia, mas para rotas de formulário de página inteira: redireciona com mensagem em vez de JSON. */
function wrapUploadRedirect(multerMiddleware, redirectPath) {
    return (req, res, next) => {
        multerMiddleware(req, res, (err) => {
            if (err) {
                const mensagem = encodeURIComponent(err.message || 'Falha no upload.');
                return res.redirect(`${redirectPath}?mensagem=${mensagem}&tipo=danger`);
            }
            return next();
        });
    };
}

/**
 * Registra as rotas do módulo de reconhecimento facial.
 *
 * Fase 1: infraestrutura de fotos de turma (armazenamento fora de /uploads, rota autenticada).
 * Fase 2: avatar self-service do usuário + fila de aprovação do professor + dashboard de rollout do admin.
 * Fase 3: upload de foto de turma + detecção via CompreFace + tela de revisão com polígonos.
 * Identificação manual e aplicação de presença em lote ficam para a Fase 4.
 *
 * @param {import('express').Application} app - Aplicação Express
 * @param {{ requireMeuPerfilSession: Function, getEffectiveProfileUserId: Function }} deps - Funções do app.js
 */
function registerFacialRecognitionRoutes(app, deps = {}) {
    const { requireMeuPerfilSession, getEffectiveProfileUserId } = deps;

    // ---- Foto de turma (Fase 1): serve a imagem só para sessão autorizada ----
    app.get('/reconhecimento-facial/:id/imagem', async (req, res) => {
        const forbidden = ensureProfessorRoute(req, res);
        if (forbidden) {
            return forbidden;
        }

        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(404).end();
        }

        const foto = await PresencaFoto.findByPk(id);
        if (!foto) {
            return res.status(404).end();
        }

        const resolvedDir = path.resolve(groupPhotosDir);
        const resolvedFile = path.resolve(groupPhotosDir, path.basename(foto.file_path));
        if (!resolvedFile.startsWith(resolvedDir + path.sep) || !fs.existsSync(resolvedFile)) {
            return res.status(404).end();
        }

        res.set('Cache-Control', 'private, no-store');
        return res.sendFile(resolvedFile);
    });

    // ---- Foto de turma (Fase 3): formulário de upload ----
    app.get('/reconhecimento-facial', async (req, res) => {
        const forbidden = ensureProfessorRoute(req, res);
        if (forbidden) {
            return forbidden;
        }

        try {
            const turmas = await Turma.findAll({ where: { active: 'Y' }, order: [['class_name', 'ASC']] });
            return res.render('reconhecimento_facial', {
                pageTitle: 'Reconhecimento facial — foto de turma',
                turmas: turmas.map((t) => ({ class_code: t.class_code, class_name: t.class_name })),
                facialRecognitionEnabled: isFacialRecognitionEnabled(),
                mensagem: req.query.mensagem || '',
                tipoMensagem: req.query.tipo || ''
            });
        } catch (err) {
            console.error(err);
            const mensagem = encodeURIComponent('Erro ao abrir reconhecimento facial: ' + err.message);
            return res.redirect(`/dashboard?mensagem=${mensagem}`);
        }
    });

    app.post(
        '/reconhecimento-facial/upload',
        wrapUploadRedirect(groupPhotoUpload.single('photo'), '/reconhecimento-facial'),
        async (req, res) => {
            const forbidden = ensureProfessorRoute(req, res);
            if (forbidden) {
                if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
                return forbidden;
            }

            const classCode = String(req.body.class_code || '').trim();
            const requestedClassType = String(req.body.class_type || '').trim();

            const fail = async (mensagem) => {
                if (req.file) await fs.promises.unlink(req.file.path).catch(() => {});
                const q = encodeURIComponent(mensagem);
                return res.redirect(`/reconhecimento-facial?mensagem=${q}&tipo=danger`);
            };

            if (!req.file) {
                return fail('Selecione uma foto da turma para enviar.');
            }

            const referenceDate = parseReferenceDate(req.body.reference_date);
            if (!classCode || !referenceDate) {
                return fail('Informe a turma e a data da aula.');
            }

            let classType;
            try {
                classType = resolveClassType(referenceDate, requestedClassType);
            } catch (err) {
                return fail(err.message);
            }

            try {
                const turma = await Turma.findOne({ where: { class_code: classCode, active: 'Y' } });
                if (!turma) {
                    return fail('Turma não encontrada ou inativa.');
                }

                const weekdayLabel = getWeekdayLabel(referenceDate);
                const sequenceLabel = resolveSequenceLabel(referenceDate, classType);
                const buffer = await fs.promises.readFile(req.file.path);
                const fileHash = computeFileHash(buffer);

                const duplicateExact = await PresencaFoto.findOne({
                    where: { class_code: classCode, reference_date: referenceDate, sequence_label: sequenceLabel, file_hash: fileHash }
                });
                if (duplicateExact) {
                    return fail('Esta foto já foi enviada antes para esta turma/aula.');
                }

                const existingForDay = await PresencaFoto.findOne({
                    where: {
                        class_code: classCode,
                        reference_date: referenceDate,
                        sequence_label: sequenceLabel,
                        status: ['REVIEW', 'APPLIED']
                    }
                });

                const foto = await PresencaFoto.create({
                    class_code: classCode,
                    class_type: classType,
                    reference_date: referenceDate,
                    weekday_label: weekdayLabel,
                    sequence_label: sequenceLabel,
                    file_path: req.file.filename,
                    file_hash: fileHash,
                    uploaded_by: req.session.usuario.user_code,
                    status: 'PROCESSING'
                });

                const redirectToDetalhe = (params = {}) => {
                    const search = new URLSearchParams(params);
                    if (existingForDay) {
                        search.set('warning', '1');
                    }
                    const qs = search.toString();
                    return res.redirect(`/reconhecimento-facial/${foto.id}${qs ? `?${qs}` : ''}`);
                };

                if (!isFacialRecognitionEnabled()) {
                    foto.status = 'FAILED';
                    await foto.save();
                    return redirectToDetalhe({
                        mensagem: 'Serviço de reconhecimento facial não está habilitado/configurado.',
                        tipo: 'danger'
                    });
                }

                const healthy = await compreFaceClient.healthCheck();
                if (!healthy) {
                    foto.status = 'FAILED';
                    await foto.save();
                    return redirectToDetalhe({
                        mensagem: 'Serviço de reconhecimento facial está indisponível no momento.',
                        tipo: 'danger'
                    });
                }

                try {
                    const detection = await compreFaceClient.recognizeFaces(buffer);
                    foto.compreface_raw_response = detection;

                    const faces = (detection && detection.result) || [];
                    for (const face of faces) {
                        const match = decideFaceMatch(face.subjects);
                        await PresencaFotoRosto.create({
                            presenca_foto_id: foto.id,
                            box_x_min: face.box.x_min,
                            box_y_min: face.box.y_min,
                            box_x_max: face.box.x_max,
                            box_y_max: face.box.y_max,
                            matched_user_code: match.matchedUserCode,
                            match_source: match.matchSource,
                            match_similarity: match.similarity,
                            status: match.status
                        });
                    }

                    foto.status = 'REVIEW';
                    await foto.save();
                } catch (err) {
                    foto.status = 'FAILED';
                    await foto.save();
                    console.error('[reconhecimento-facial] Falha na detecção:', err.message);
                    return redirectToDetalhe({
                        mensagem: 'Falha ao comunicar com o serviço de reconhecimento facial: ' + err.message,
                        tipo: 'danger'
                    });
                }

                return redirectToDetalhe();
            } catch (err) {
                console.error(err);
                return fail('Erro ao processar a foto: ' + err.message);
            }
        }
    );

    app.get('/reconhecimento-facial/:id', async (req, res) => {
        const forbidden = ensureProfessorRoute(req, res);
        if (forbidden) {
            return forbidden;
        }

        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(404).render('errors/error', getErrorViewModel(404));
        }

        try {
            const foto = await PresencaFoto.findByPk(id);
            if (!foto) {
                return res.status(404).render('errors/error', getErrorViewModel(404));
            }

            const rostos = await PresencaFotoRosto.findAll({ where: { presenca_foto_id: id } });

            return res.render('reconhecimento_facial_detalhe', {
                pageTitle: 'Reconhecimento facial — revisão',
                foto: foto.get({ plain: true }),
                canvasDataJSON: JSON.stringify({
                    fotoId: foto.id,
                    classCode: foto.class_code,
                    status: foto.status,
                    imageUrl: `/reconhecimento-facial/${foto.id}/imagem`,
                    rostos: rostos.map((r) => r.get({ plain: true }))
                }),
                totalRostos: rostos.length,
                reconhecidos: rostos.filter((r) => r.status === 'RECOGNIZED').length,
                mensagem: req.query.mensagem || '',
                tipoMensagem: req.query.tipo || '',
                aviso: req.query.warning === '1'
            });
        } catch (err) {
            console.error(err);
            const mensagem = encodeURIComponent('Erro ao carregar a foto: ' + err.message);
            return res.redirect(`/reconhecimento-facial?mensagem=${mensagem}&tipo=danger`);
        }
    });

    // ---- Identificação manual de um rosto não reconhecido (Fase 4) ----
    app.post('/reconhecimento-facial/:id/identificar', async (req, res) => {
        const forbidden = ensureProfessorRoute(req, res);
        if (forbidden) {
            return forbidden;
        }

        const id = parseInt(req.params.id, 10);
        const rostoId = parseInt(req.body.rostoId, 10);
        if (!Number.isInteger(id) || !Number.isInteger(rostoId)) {
            return res.status(400).json({ ok: false, mensagem: 'Parâmetros inválidos.' });
        }

        try {
            const foto = await PresencaFoto.findByPk(id);
            if (!foto) {
                return res.status(404).json({ ok: false, mensagem: 'Foto não encontrada.' });
            }
            if (foto.status !== 'REVIEW') {
                return res.status(400).json({ ok: false, mensagem: 'Esta foto não está mais em revisão.' });
            }

            const rosto = await PresencaFotoRosto.findByPk(rostoId);
            if (!rosto || rosto.presenca_foto_id !== foto.id) {
                return res.status(404).json({ ok: false, mensagem: 'Rosto não encontrado nesta foto.' });
            }

            if (req.body.ignore === true || req.body.ignore === 'true') {
                rosto.status = 'IGNORED';
                rosto.matched_user_code = null;
                rosto.match_source = 'NONE';
                rosto.match_similarity = null;
            } else {
                const userCode = String(req.body.userCode || '').trim().toUpperCase();
                if (!userCode) {
                    return res.status(400).json({ ok: false, mensagem: 'Selecione o aluno correspondente.' });
                }

                const usuario = await Usuario.findOne({ where: { user_code: userCode } });
                if (!usuario) {
                    return res.status(404).json({ ok: false, mensagem: 'Aluno não encontrado.' });
                }

                const jaIdentificado = await PresencaFotoRosto.findOne({
                    where: {
                        presenca_foto_id: foto.id,
                        matched_user_code: userCode,
                        status: 'RECOGNIZED',
                        id: { [Op.ne]: rosto.id }
                    }
                });
                if (jaIdentificado) {
                    return res.status(400).json({ ok: false, mensagem: 'Este aluno já está identificado em outro rosto desta foto.' });
                }

                rosto.status = 'RECOGNIZED';
                rosto.matched_user_code = userCode;
                rosto.match_source = 'MANUAL';
                rosto.match_similarity = null;
            }

            await rosto.save();
            return res.json({ ok: true, rosto: rosto.get({ plain: true }) });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ ok: false, mensagem: 'Erro ao identificar rosto: ' + err.message });
        }
    });

    // ---- Aplicar presença em lote (Fase 4) ----
    app.post('/reconhecimento-facial/:id/aplicar', async (req, res) => {
        const forbidden = ensureProfessorRoute(req, res);
        if (forbidden) {
            return forbidden;
        }

        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) {
            return res.status(400).json({ ok: false, mensagem: 'Parâmetro inválido.' });
        }

        try {
            const foto = await PresencaFoto.findByPk(id);
            if (!foto) {
                return res.status(404).json({ ok: false, mensagem: 'Foto não encontrada.' });
            }
            if (foto.status !== 'REVIEW') {
                return res.status(400).json({ ok: false, mensagem: 'Esta foto não está mais em revisão.' });
            }

            const rostosReconhecidos = await PresencaFotoRosto.findAll({
                where: { presenca_foto_id: foto.id, status: 'RECOGNIZED', matched_user_code: { [Op.ne]: null } }
            });
            if (rostosReconhecidos.length === 0) {
                return res.status(400).json({ ok: false, mensagem: 'Nenhum rosto reconhecido para aplicar presença.' });
            }

            const userCodes = [...new Set(rostosReconhecidos.map((r) => r.matched_user_code))];
            const range = presencaUtcRangeForYmd(foto.reference_date);
            const dupWindow = presencaDuplicateQueryRange(foto.reference_date);

            const applied = [];
            const skipped = [];

            for (const userCode of userCodes) {
                const usuario = await Usuario.findOne({ where: { user_code: userCode } });
                if (!usuario) {
                    skipped.push({ userCode, reason: 'Usuário não encontrado.' });
                    continue;
                }

                const candidatosDup = await Presenca.findAll({
                    where: {
                        user_code: userCode,
                        request_date: { [Op.between]: [dupWindow.start, dupWindow.end] },
                        status: { [Op.ne]: 'C' }
                    },
                    attributes: ['id', 'request_date']
                });
                if (candidatosDup.some((row) => presencaMatchesSolicitacaoDay(row.request_date, foto.reference_date))) {
                    skipped.push({ userCode, reason: 'Já existe presença registrada para este dia.' });
                    continue;
                }

                const presenca = await Presenca.create({
                    request_date: range.noon,
                    user_code: userCode,
                    status: 'A',
                    class_type: foto.class_type,
                    class_code: foto.class_code,
                    processed_by: req.session.usuario.user_code
                });

                for (const rosto of rostosReconhecidos.filter((r) => r.matched_user_code === userCode)) {
                    rosto.presenca_id = presenca.id;
                    await rosto.save();
                }

                await Notificacao.create({
                    user_code: userCode,
                    kind: 'PRESENCA_AUTOMATICA',
                    title: 'Presença registrada automaticamente',
                    body: 'Você foi identificado(a) numa foto de turma e sua presença foi registrada automaticamente.',
                    presenca_id: presenca.id
                });

                applied.push(userCode);
            }

            const professor = await Usuario.findOne({ where: { user_code: foto.uploaded_by } });
            const finalFileName = buildFinalFileName({
                ymd: foto.reference_date,
                weekdayLabel: foto.weekday_label,
                sequenceLabel: foto.sequence_label,
                professorName: professor ? `${professor.first_name} ${professor.last_name}` : foto.uploaded_by
            });

            const oldFilePath = path.join(groupPhotosDir, path.basename(foto.file_path));
            const newFilePath = path.join(groupPhotosDir, finalFileName);
            if (oldFilePath !== newFilePath && fs.existsSync(oldFilePath)) {
                await fs.promises.rename(oldFilePath, newFilePath);
                foto.file_path = finalFileName;
            }

            foto.status = 'APPLIED';
            foto.applied_at = new Date();
            foto.applied_by = req.session.usuario.user_code;
            await foto.save();

            return res.json({ ok: true, applied: applied.length, appliedUserCodes: applied, skipped });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ ok: false, mensagem: 'Erro ao aplicar presença: ' + err.message });
        }
    });

    // ---- Cancelar foto de turma (Fase 4) ----
    app.post('/reconhecimento-facial/:id/cancelar', async (req, res) => {
        const forbidden = ensureProfessorRoute(req, res);
        if (forbidden) {
            return forbidden;
        }

        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) {
            return res.status(400).json({ ok: false, mensagem: 'Parâmetro inválido.' });
        }

        try {
            const foto = await PresencaFoto.findByPk(id);
            if (!foto) {
                return res.status(404).json({ ok: false, mensagem: 'Foto não encontrada.' });
            }
            if (!['REVIEW', 'FAILED'].includes(foto.status)) {
                return res.status(400).json({ ok: false, mensagem: 'Esta foto não pode mais ser cancelada.' });
            }

            const filePath = path.join(groupPhotosDir, path.basename(foto.file_path));
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
            }

            await PresencaFotoRosto.destroy({ where: { presenca_foto_id: foto.id } });

            foto.status = 'CANCELLED';
            await foto.save();

            return res.json({ ok: true, mensagem: 'Foto cancelada e removida.' });
        } catch (err) {
            console.error(err);
            return res.status(500).json({ ok: false, mensagem: 'Erro ao cancelar: ' + err.message });
        }
    });

    // ---- Avatar self-service (Fase 2) ----
    app.post(
        '/meuperfil/foto',
        requireMeuPerfilSession,
        wrapUpload(avatarUpload.single('photo')),
        async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json({ ok: false, mensagem: 'Selecione uma foto para enviar.' });
                }

                const profileUserId = getEffectiveProfileUserId(req);
                const usuario = await Usuario.findByPk(profileUserId);
                if (!usuario) {
                    return res.status(404).json({ ok: false, mensagem: 'Usuário não encontrado.' });
                }

                await submitPendingAvatar(usuario, req.file.filename);
                return res.json({
                    ok: true,
                    mensagem: 'Foto enviada! Aguarde a aprovação do professor.',
                    photo_status: usuario.photo_status,
                    photo_pending_path: usuario.photo_pending_path
                });
            } catch (err) {
                return res.status(400).json({ ok: false, mensagem: err.message || 'Falha ao enviar a foto.' });
            }
        }
    );

    // ---- Fila de aprovação (professor/admin) ----
    app.get('/professor/fotos-pendentes', async (req, res) => {
        const forbidden = ensureProfessorRoute(req, res);
        if (forbidden) {
            return forbidden;
        }

        const pageRaw = parseInt(req.query.page, 10);
        const currentPageRequested = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

        try {
            const totalItems = await Usuario.count({ where: { photo_status: 'PENDING' } });
            const paginationVm = buildPaginationVm(
                currentPageRequested,
                totalItems,
                PENDING_PHOTOS_PER_PAGE,
                PENDING_PHOTOS_PAGES_PER_BLOCK
            );
            const offset = (paginationVm.currentPage - 1) * PENDING_PHOTOS_PER_PAGE;

            const usuarios = await Usuario.findAll({
                where: { photo_status: 'PENDING' },
                order: [['first_name', 'ASC'], ['last_name', 'ASC']],
                limit: PENDING_PHOTOS_PER_PAGE,
                offset
            });

            const pendentes = usuarios.map((u) => ({
                user_code: u.user_code,
                full_name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.user_code,
                role: u.role,
                photo_pending_path: u.photo_pending_path
            }));

            return res.render('avaliacao_fotos', {
                pageTitle: 'Avaliar fotos de perfil',
                pendentes,
                pagination: paginationVm,
                mensagem: req.query.mensagem || '',
                tipoMensagem: req.query.tipo || ''
            });
        } catch (err) {
            console.error(err);
            const mensagem = encodeURIComponent('Erro ao carregar fotos pendentes: ' + err.message);
            return res.redirect(`/dashboard?mensagem=${mensagem}`);
        }
    });

    app.post('/professor/fotos-pendentes/:userCode/aprovar', async (req, res) => {
        const forbidden = ensureProfessorRoute(req, res);
        if (forbidden) {
            return forbidden;
        }

        try {
            const usuario = await Usuario.findOne({ where: { user_code: req.params.userCode } });
            if (!usuario) {
                return res.status(404).json({ ok: false, mensagem: 'Usuário não encontrado.' });
            }

            await approveAvatar(usuario, req.session.usuario.user_code);
            return res.json({ ok: true, mensagem: 'Foto aprovada.' });
        } catch (err) {
            return res.status(400).json({ ok: false, mensagem: err.message || 'Falha ao aprovar a foto.' });
        }
    });

    app.post('/professor/fotos-pendentes/:userCode/recusar', async (req, res) => {
        const forbidden = ensureProfessorRoute(req, res);
        if (forbidden) {
            return forbidden;
        }

        try {
            const usuario = await Usuario.findOne({ where: { user_code: req.params.userCode } });
            if (!usuario) {
                return res.status(404).json({ ok: false, mensagem: 'Usuário não encontrado.' });
            }

            await rejectAvatar(usuario, req.session.usuario.user_code, req.body.reason);
            return res.json({ ok: true, mensagem: 'Foto recusada.' });
        } catch (err) {
            return res.status(400).json({ ok: false, mensagem: err.message || 'Falha ao recusar a foto.' });
        }
    });

    // ---- Dashboard de rollout (admin) ----
    app.get('/admin/fotos-rollout', async (req, res) => {
        const forbidden = ensureAdminRoute(req, res);
        if (forbidden) {
            return forbidden;
        }

        try {
            const stats = await getAvatarRolloutStats();
            return res.render('fotos_rollout', {
                pageTitle: 'Adesão às fotos de perfil',
                stats
            });
        } catch (err) {
            console.error(err);
            const mensagem = encodeURIComponent('Erro ao carregar estatísticas: ' + err.message);
            return res.redirect(`/dashboard?mensagem=${mensagem}`);
        }
    });
}

module.exports = { registerFacialRecognitionRoutes };
