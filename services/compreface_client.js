'use strict';

/**
 * Client HTTP fino para a REST API do CompreFace (self-hosted, ver
 * docker/compreface/). Usa fetch/FormData/Blob nativos do Node — sem
 * nenhuma dependência nova no package.json. O SDK oficial
 * (compreface-javascript-sdk) não é usado porque é ESM puro,
 * incompatível com o restante do projeto (CommonJS).
 */

const { getConfig } = require('../config/compreface_config');

function buildUrl(path, query = {}) {
    const { baseUrl } = getConfig();
    const url = new URL(path, baseUrl);
    Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, value);
        }
    });
    return url;
}

function buildFormDataWithFile(buffer, fileName = 'photo.jpg') {
    const fd = new FormData();
    fd.append('file', new Blob([buffer]), fileName);
    return fd;
}

async function request(method, path, { query, body, isFormData } = {}) {
    const { apiKey, timeoutMs } = getConfig();
    const url = buildUrl(path, query);

    const headers = { 'x-api-key': apiKey };
    const res = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs)
    });

    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch (_e) {
        json = null;
    }

    if (!res.ok) {
        const message = (json && (json.message || json.error)) || `CompreFace respondeu ${res.status}.`;
        const err = new Error(message);
        err.statusCode = 502;
        err.compreFaceStatus = res.status;
        throw err;
    }

    return json;
}

/** Envia a foto de grupo para detecção/reconhecimento contra os subjects cadastrados. */
async function recognizeFaces(buffer, { limit = 0, detProbThreshold } = {}) {
    const { detProbThreshold: defaultThreshold } = getConfig();
    const fd = buildFormDataWithFile(buffer, 'group.jpg');

    return request('POST', '/api/v1/recognition/recognize', {
        query: {
            limit,
            det_prob_threshold: detProbThreshold ?? defaultThreshold
        },
        body: fd
    });
}

/** Cadastra a foto de avatar aprovada como exemplo de referência do subject (= user_code). */
async function addSubjectExample(userCode, buffer) {
    const fd = buildFormDataWithFile(buffer, 'avatar.jpg');

    return request('PUT', '/api/v1/recognition/faces', {
        query: { subject: userCode },
        body: fd
    });
}

/** Remove todos os exemplos cadastrados de um subject (ex.: avatar recusado/refeito, aluno desligado). */
async function removeSubjectExamples(userCode) {
    return request('DELETE', '/api/v1/recognition/faces', {
        query: { subject: userCode }
    });
}

/** Verifica rapidamente se o serviço está respondendo, sem validar a API key. */
async function healthCheck({ timeoutMs = 3000 } = {}) {
    const { baseUrl } = getConfig();
    if (!baseUrl) {
        return false;
    }
    try {
        const res = await fetch(new URL('/', baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
        return res.ok;
    } catch (_e) {
        return false;
    }
}

module.exports = { recognizeFaces, addSubjectExample, removeSubjectExamples, healthCheck };
