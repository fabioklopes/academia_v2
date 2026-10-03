jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
jest.mock('../../../models/Usuario', () => ({ findAll: jest.fn(), findOne: jest.fn() }));
jest.mock('../../../models/Notificacao', () => ({ update: jest.fn() }));
jest.mock('../../../models/MensagemProfessor', () => ({ update: jest.fn() }));
jest.mock('../../../services/mail_transport', () => ({ getPasswordResetTransportConfig: jest.fn() }));

const { Op } = require('sequelize');
const nodemailer = require('nodemailer');
const Usuario = require('../../../models/Usuario');
const Notificacao = require('../../../models/Notificacao');
const MensagemProfessor = require('../../../models/MensagemProfessor');
const { getPasswordResetTransportConfig } = require('../../../services/mail_transport');
const {
    NOTIFICATION_PATHS,
    findOptedInEmails,
    dispatchNotificationEmail,
    dispatchMassMessageEmail,
    safeDispatchNotificationEmail,
    runWithConcurrency
} = require('../../../services/notification_email');

const TRANSPORT_CONFIG = { host: 'smtp.test', port: 587, auth: { user: 'no-reply@crtn.com.br', pass: 'x' } };

function mockTransporter() {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '1' });
    nodemailer.createTransport.mockReturnValue({ sendMail });
    return sendMail;
}

function usuario(overrides = {}) {
    return {
        user_code: 'ALU001',
        first_name: 'João',
        last_name: 'Aluno',
        email: 'joao@aluno.com',
        role: 'STD',
        notification_email_enabled: true,
        ...overrides
    };
}

function notificacao(overrides = {}) {
    return {
        id: 10,
        user_code: 'ALU001',
        kind: 'PRESENCA_APROVADA',
        title: 'Solicitação de presença aprovada',
        body: 'Sua solicitação de presença para 05/10/2026 (Gi) foi aprovada.',
        email_sent_at: null,
        ...overrides
    };
}

beforeEach(() => {
    process.env.APP_BASE_URL = 'https://crtn-belem.com.br';
    delete process.env.PUBLIC_APP_URL;
    process.env.SMTP_FROM = 'CRTN Belém <no-reply@crtn.com.br>';
    getPasswordResetTransportConfig.mockReturnValue(TRANSPORT_CONFIG);
    Notificacao.update.mockResolvedValue([1]);
    MensagemProfessor.update.mockResolvedValue([1]);
});

describe('findOptedInEmails', () => {
    test('busca somente usuários ativos com a opção ligada', async () => {
        Usuario.findAll.mockResolvedValue([]);
        await findOptedInEmails();

        expect(Usuario.findAll).toHaveBeenCalledWith(expect.objectContaining({
            where: { user_status: 'A', notification_email_enabled: true }
        }));
    });

    test('deduplica por e-mail porque titular e dependente compartilham o endereço', async () => {
        Usuario.findAll.mockResolvedValue([
            { email: 'Familia@Email.com ', first_name: 'Titular', last_name: 'X', role: 'STD' },
            { email: 'familia@email.com', first_name: 'Dependente', last_name: 'X', role: 'STD' }
        ]);

        const resultado = await findOptedInEmails();

        expect(resultado).toHaveLength(1);
        expect(resultado[0]).toEqual({
            email: 'familia@email.com',
            first_name: 'Titular',
            last_name: 'X',
            role: 'STD'
        });
    });

    test('descarta e-mails inválidos ou vazios', async () => {
        Usuario.findAll.mockResolvedValue([
            { email: 'invalido', first_name: 'A', last_name: 'B', role: 'STD' },
            { email: '   ', first_name: 'C', last_name: 'D', role: 'STD' },
            { email: 'ok@email.com', first_name: 'E', last_name: 'F', role: 'PRO' }
        ]);

        const resultado = await findOptedInEmails();

        expect(resultado).toHaveLength(1);
        expect(resultado[0].email).toBe('ok@email.com');
    });

    test('cobre ADM, PRO e STD', async () => {
        Usuario.findAll.mockResolvedValue([
            { email: 'adm@email.com', first_name: 'A', last_name: 'Adm', role: 'ADM' },
            { email: 'pro@email.com', first_name: 'P', last_name: 'Pro', role: 'PRO' },
            { email: 'std@email.com', first_name: 'S', last_name: 'Std', role: 'STD' }
        ]);

        expect(await findOptedInEmails()).toHaveLength(3);
    });
});

describe('dispatchNotificationEmail', () => {
    test('envia o e-mail com assunto prefixado e registra o envio', async () => {
        const sendMail = mockTransporter();
        Usuario.findOne.mockResolvedValue(usuario());

        const resultado = await dispatchNotificationEmail(notificacao(), {
            actor: { first_name: 'Ana', last_name: 'Souza', role: 'PRO' },
            details: [{ label: 'Data', value: '05/10/2026' }]
        });

        expect(resultado).toMatchObject({ status: 'sent', email: 'joao@aluno.com' });
        expect(resultado.subject).toBe('CRTN Belém - Presença aprovada');

        expect(sendMail).toHaveBeenCalledTimes(1);
        const mail = sendMail.mock.calls[0][0];
        expect(mail.from).toBe('CRTN Belém <no-reply@crtn.com.br>');
        expect(mail.to).toBe('joao@aluno.com');
        expect(mail.subject.startsWith('CRTN Belém - ')).toBe(true);
        expect(mail.html).toContain('Ana Souza');
        expect(mail.html).toContain('05/10/2026');
        expect(mail.text).toContain('Ação realizada por: Ana Souza (Professor)');
        expect(mail.headers['List-Unsubscribe']).toBe('<https://crtn-belem.com.br/meuperfil>');

        expect(Notificacao.update).toHaveBeenCalledWith(
            { email_sent_at: expect.any(Date) },
            { where: { id: 10 } }
        );
    });

    test('aponta o aluno para a tela de notificações', async () => {
        const sendMail = mockTransporter();
        Usuario.findOne.mockResolvedValue(usuario());

        await dispatchNotificationEmail(notificacao());

        expect(sendMail.mock.calls[0][0].html).toContain(`${'https://crtn-belem.com.br'}${NOTIFICATION_PATHS.PRESENCA_APROVADA}`);
    });

    test('não reenvia quando a notificação já foi enviada', async () => {
        const sendMail = mockTransporter();

        const resultado = await dispatchNotificationEmail(notificacao({ email_sent_at: new Date() }));

        expect(resultado).toEqual({ status: 'skipped', reason: 'ja-enviado' });
        expect(sendMail).not.toHaveBeenCalled();
        expect(Usuario.findOne).not.toHaveBeenCalled();
    });

    test('respeita o opt-out do usuário', async () => {
        const sendMail = mockTransporter();
        Usuario.findOne.mockResolvedValue(usuario({ notification_email_enabled: false }));

        const resultado = await dispatchNotificationEmail(notificacao());

        expect(resultado).toEqual({ status: 'skipped', reason: 'opt-out' });
        expect(sendMail).not.toHaveBeenCalled();
    });

    test('envia quando o usuário não se manifestou (null é diferente de false)', async () => {
        mockTransporter();
        Usuario.findOne.mockResolvedValue(usuario({ notification_email_enabled: null }));

        const resultado = await dispatchNotificationEmail(notificacao());

        expect(resultado.status).toBe('sent');
    });

    test('pula quando não há SMTP configurado', async () => {
        getPasswordResetTransportConfig.mockReturnValue(null);

        const resultado = await dispatchNotificationEmail(notificacao());

        expect(resultado).toEqual({ status: 'skipped', reason: 'smtp-nao-configurado' });
        expect(Usuario.findOne).not.toHaveBeenCalled();
    });

    test('pula quando o destinatário não existe mais', async () => {
        mockTransporter();
        Usuario.findOne.mockResolvedValue(null);

        expect(await dispatchNotificationEmail(notificacao()))
            .toEqual({ status: 'skipped', reason: 'destinatario-nao-encontrado' });
    });

    test('pula quando o e-mail cadastrado é inválido', async () => {
        mockTransporter();
        Usuario.findOne.mockResolvedValue(usuario({ email: 'nao-e-email' }));

        expect(await dispatchNotificationEmail(notificacao()))
            .toEqual({ status: 'skipped', reason: 'email-invalido' });
    });

    test('não marca email_sent_at quando o envio falha', async () => {
        const sendMail = mockTransporter();
        sendMail.mockRejectedValue(new Error('smtp fora do ar'));
        Usuario.findOne.mockResolvedValue(usuario());

        await expect(dispatchNotificationEmail(notificacao())).rejects.toThrow('smtp fora do ar');
        expect(Notificacao.update).not.toHaveBeenCalled();
    });

    test('aceita notificação como instância do Sequelize', async () => {
        const sendMail = mockTransporter();
        Usuario.findOne.mockResolvedValue(usuario());

        await dispatchNotificationEmail({ get: () => notificacao({ id: 77 }) });

        expect(Notificacao.update).toHaveBeenCalledWith(expect.any(Object), { where: { id: 77 } });
        expect(sendMail).toHaveBeenCalledTimes(1);
    });

    test('ignora notificação vazia', async () => {
        expect(await dispatchNotificationEmail(null)).toEqual({ status: 'skipped', reason: 'notificacao-vazia' });
    });
});

describe('dispatchMassMessageEmail', () => {
    const aviso = {
        title: 'Graduação 1º semestre',
        content: 'Ajude sua turma a bater a meta de aulas. Fique ligado!',
        actor: { first_name: 'Ana', last_name: 'Souza', role: 'PRO' },
        messageIds: [5, 6]
    };

    test('envia um e-mail por destinatário sem expor a lista de destinatários', async () => {
        const sendMail = mockTransporter();
        Usuario.findAll.mockResolvedValue([
            { email: 'adm@email.com', first_name: 'A', last_name: 'Adm', role: 'ADM' },
            { email: 'pro@email.com', first_name: 'P', last_name: 'Pro', role: 'PRO' },
            { email: 'std@email.com', first_name: 'S', last_name: 'Std', role: 'STD' }
        ]);

        const resultado = await dispatchMassMessageEmail(aviso);

        expect(resultado).toMatchObject({ status: 'sent', sentCount: 3, totalCount: 3 });
        expect(sendMail).toHaveBeenCalledTimes(3);

        for (const [mail] of sendMail.mock.calls) {
            expect(mail.subject).toBe('CRTN Belém - Novo aviso: Graduação 1º semestre');
            expect(typeof mail.to).toBe('string');
            expect(mail.html).toContain('CRTN Belém');
            expect(mail.html).toContain('Ana Souza');
        }

        expect(sendMail.mock.calls.map(([mail]) => mail.to).sort())
            .toEqual(['adm@email.com', 'pro@email.com', 'std@email.com']);
    });

    test('marca as mensagens enviadas para não repetir o disparo', async () => {
        mockTransporter();
        Usuario.findAll.mockResolvedValue([{ email: 'std@email.com', first_name: 'S', last_name: 'S', role: 'STD' }]);

        await dispatchMassMessageEmail(aviso);

        expect(MensagemProfessor.update).toHaveBeenCalledWith(
            { email_sent_at: expect.any(Date) },
            { where: { id: { [Op.in]: [5, 6] } } }
        );
    });

    test('nunca atualiza a tabela inteira quando não há ids', async () => {
        mockTransporter();
        Usuario.findAll.mockResolvedValue([{ email: 'std@email.com', first_name: 'S', last_name: 'S', role: 'STD' }]);

        await dispatchMassMessageEmail({ ...aviso, messageIds: [] });

        expect(MensagemProfessor.update).not.toHaveBeenCalled();
    });

    test('não marca nada quando não há ninguém para enviar', async () => {
        mockTransporter();
        Usuario.findAll.mockResolvedValue([]);

        const resultado = await dispatchMassMessageEmail(aviso);

        expect(resultado).toEqual({ status: 'skipped', reason: 'sem-destinatarios', sentCount: 0 });
        expect(MensagemProfessor.update).not.toHaveBeenCalled();
    });

    test('uma falha individual não interrompe os demais envios', async () => {
        const sendMail = mockTransporter();
        sendMail.mockImplementation(async ({ to }) => {
            if (to === 'quebrado@email.com') {
                throw new Error('caixa cheia');
            }
            return { messageId: '1' };
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});
        Usuario.findAll.mockResolvedValue([
            { email: 'ok@email.com', first_name: 'O', last_name: 'K', role: 'STD' },
            { email: 'quebrado@email.com', first_name: 'Q', last_name: 'Q', role: 'STD' }
        ]);

        const resultado = await dispatchMassMessageEmail(aviso);

        expect(resultado).toMatchObject({ status: 'sent', sentCount: 1, totalCount: 2 });
        expect(sendMail).toHaveBeenCalledTimes(2);
    });

    test('pula quando não há SMTP configurado', async () => {
        getPasswordResetTransportConfig.mockReturnValue(null);

        expect(await dispatchMassMessageEmail(aviso))
            .toEqual({ status: 'skipped', reason: 'smtp-nao-configurado', sentCount: 0 });
    });
});

describe('safeDispatchNotificationEmail', () => {
    test('transforma falha de SMTP em resultado, sem estourar exceção', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const sendMail = mockTransporter();
        sendMail.mockRejectedValue(new Error('smtp fora do ar'));
        Usuario.findOne.mockResolvedValue(usuario());

        const resultado = await safeDispatchNotificationEmail(notificacao());

        expect(resultado).toEqual({ status: 'failed', reason: 'smtp fora do ar' });
    });
});

describe('runWithConcurrency', () => {
    test('respeita o limite de tarefas paralelas', async () => {
        let emVoo = 0;
        let maximo = 0;

        await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async () => {
            emVoo += 1;
            maximo = Math.max(maximo, emVoo);
            await new Promise((resolve) => setTimeout(resolve, 5));
            emVoo -= 1;
            return true;
        });

        expect(maximo).toBeLessThanOrEqual(3);
    });

    test('preserva a ordem dos resultados', async () => {
        const resultados = await runWithConcurrency([30, 1, 20], 2, async (ms) => {
            await new Promise((resolve) => setTimeout(resolve, ms));
            return ms;
        });

        expect(resultados).toEqual([30, 1, 20]);
    });

    test('devolve lista vazia para entrada vazia', async () => {
        const task = jest.fn();
        expect(await runWithConcurrency([], 5, task)).toEqual([]);
        expect(task).not.toHaveBeenCalled();
    });
});