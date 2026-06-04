'use strict';

const path = require('path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const SESSION_DIR = process.env.WHATSAPP_SESSION_DIR || path.join(__dirname, '..', '.whatsapp-session');
const RATE_LIMIT_MS = Number(process.env.WHATSAPP_RATE_LIMIT_MS) || 4000;

let client = null;
let isReady = false;
let queue = Promise.resolve();

function initializeWhatsappNotifications() {
    if (client) {
        return client;
    }

    client = new Client({
        authStrategy: new LocalAuth({
            clientId: 'academia',
            dataPath: SESSION_DIR
        }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', (qr) => {
        qrcode.generate(qr, { small: true });
        console.log('WhatsApp Web: QR code gerado. Escaneie com o app do WhatsApp.');
    });

    client.on('ready', () => {
        isReady = true;
        console.log('WhatsApp Web: conexão estabelecida. Cliente pronto.');
    });

    client.on('auth_failure', (msg) => {
        console.error('WhatsApp Web: falha de autenticação', msg);
    });

    client.on('disconnected', (reason) => {
        isReady = false;
        console.warn('WhatsApp Web: desconectado:', reason);
        setTimeout(() => {
            try {
                client.initialize();
            } catch (err) {
                console.error('WhatsApp Web: erro ao reinicializar cliente', err);
            }
        }, 5000);
    });

    client.initialize();
    return client;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWhatsappMessage(phoneDigits, text) {
    if (!client || !isReady) {
        throw new Error('Whatsapp client não está pronto.');
    }

    const normalized = String(phoneDigits).replace(/\D/g, '');
    if (normalized.length !== 11) {
        throw new Error('Número de WhatsApp inválido.');
    }

    const chatId = `55${normalized}@c.us`;
    const now = Date.now();
    const earliestNext = Math.max(0, RATE_LIMIT_MS - (now - (sendWhatsappMessage.lastSentAt || 0)));
    if (earliestNext > 0) {
        await delay(earliestNext);
    }

    const message = await client.sendMessage(chatId, text);
    sendWhatsappMessage.lastSentAt = Date.now();
    return message;
}

async function enqueueSend(phoneDigits, text) {
    queue = queue.then(() => sendWhatsappMessage(phoneDigits, text)).catch((err) => {
        console.error('Erro no envio de WhatsApp:', err.message);
    });
    return queue;
}

module.exports = {
    initializeWhatsappNotifications,
    enqueueSend,
    isWhatsappReady: () => isReady
};
