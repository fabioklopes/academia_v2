/**
 * Valida telefone celular BR (DDD + 9 dígitos) como string de 11 dígitos numéricos.
 * @param {unknown} raw
 * @returns {{ ok: true, phone: string } | { ok: false, message: string }}
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
