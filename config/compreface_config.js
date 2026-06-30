'use strict';

/**
 * Configuração do CompreFace (self-hosted, ver docker/compreface/).
 * Se as variáveis não estiverem presentes, o módulo de reconhecimento
 * facial fica desabilitado — o resto do sistema continua funcionando.
 */

function isFacialRecognitionEnabled() {
    return (
        process.env.COMPREFACE_ENABLED === 'true' &&
        Boolean(process.env.COMPREFACE_BASE_URL) &&
        Boolean(process.env.COMPREFACE_RECOGNITION_API_KEY)
    );
}

function getConfig() {
    return {
        baseUrl: process.env.COMPREFACE_BASE_URL || '',
        apiKey: process.env.COMPREFACE_RECOGNITION_API_KEY || '',
        detProbThreshold: Number(process.env.COMPREFACE_DET_PROB_THRESHOLD || 0.8),
        similarityThreshold: Number(process.env.COMPREFACE_SIMILARITY_THRESHOLD || 0.92),
        timeoutMs: Number(process.env.COMPREFACE_TIMEOUT_MS || 15000)
    };
}

module.exports = { isFacialRecognitionEnabled, getConfig };
