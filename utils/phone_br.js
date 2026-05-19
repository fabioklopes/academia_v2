/**
 * Valida número de celular brasileiro: 11 dígitos (DDD + 9 + 8 dígitos).
 * Retorna { ok: true, phone } ou { ok: false, message } com texto amigável.
 */
function validateBrazilMobilePhone(raw) {
    const phoneRaw = String(raw ?? '').trim();
    if (!phoneRaw) {
        return { ok: false, message: 'Informe o WhatsApp com DDD e 11 dígitos.' };
    }
    if (!/^\d+$/.test(phoneRaw)) {
        return {
            ok: false,
            message: 'No WhatsApp, use apenas números, sem letras, espaços ou símbolos.'
        };
    }
    if (phoneRaw.length !== 11) {
        return { ok: false, message: 'Informe o WhatsApp com DDD e 11 dígitos.' };
    }
    return { ok: true, phone: phoneRaw };
}

module.exports = { validateBrazilMobilePhone };
