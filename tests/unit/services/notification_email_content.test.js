const {
    ACADEMY_NAME,
    SUBJECT_PREFIX,
    MAX_SUBJECT_LENGTH,
    PALETTE,
    buildSubject,
    buildActorLabel,
    buildActorDescription,
    actorRoleLabel,
    escapeHtml,
    sanitizeEmail,
    resolvePresentation,
    buildPreheader,
    renderHtml,
    renderText,
    buildNotificationEmail
} = require('../../../services/notification_email_content');

const ATOR_PROFESSOR = {
    first_name: 'Ana',
    last_name: 'Souza',
    user_code: 'PRO001',
    role: 'PRO'
};

describe('buildSubject', () => {
    test('sempre prefixa com o nome da academia', () => {
        const subject = buildSubject({ kind: 'PRESENCA_APROVADA' });
        expect(subject.startsWith(`${ACADEMY_NAME} - `)).toBe(true);
        expect(subject).toBe('CRTN Belém - Presença aprovada');
    });

    test('usa assunto direto e objetivo, sem indícios de spam', () => {
        const assuntos = [
            buildSubject({ kind: 'PRESENCA_APROVADA' }),
            buildSubject({ kind: 'PRESENCA_NEGADA' }),
            buildSubject({ kind: 'AVATAR_APROVADO' }),
            buildSubject({ kind: 'AVATAR_NEGADO' }),
            buildSubject({ kind: 'MENSAGEM_EM_MASSA' })
        ];

        for (const subject of assuntos) {
            // Sem caixa alta gritada, sem "URGENTE", sem exclamações e sem
            // palavras clássicas de spam.
            expect(subject).not.toMatch(/URGENT|ATENÇÃO|PROMO|GRÁTIS|GRATIS|CLIQUE AQUI/i);
            expect(subject).not.toMatch(/[!?]{2,}/);
            expect(subject).not.toMatch(/[!]/);
            expect(subject).not.toBe(subject.toUpperCase());
            expect(subject).toBe(subject.trim());
        }
    });

    test('assunto não passa do limite definido', () => {
        const subject = buildSubject({ extra: 'x'.repeat(400) });
        expect(subject.length).toBeLessThanOrEqual(MAX_SUBJECT_LENGTH);
        expect(subject.startsWith(SUBJECT_PREFIX)).toBe(true);
    });

    test('usa o título da notificação quando o kind é desconhecido', () => {
        expect(buildSubject({ kind: 'DESCONHECIDO', fallback: 'Aviso do sistema' }))
            .toBe('CRTN Belém - Aviso do sistema');
    });

    test('nunca devolve assunto vazio', () => {
        expect(buildSubject()).toBe('CRTN Belém - Notificação');
        expect(buildSubject({ kind: '', fallback: '' })).toBe('CRTN Belém - Notificação');
    });

    test('normaliza quebras de linha e espaços vindos do texto', () => {
        expect(buildSubject({ kind: 'DESCONHECIDO', fallback: '  Aviso\n\n  do\n sistema ' }))
            .toBe('CRTN Belém - Aviso do sistema');
    });

    test('anexa detalhe curto sem quebrar o padrão', () => {
        expect(buildSubject({ kind: 'MENSAGEM_EM_MASSA', extra: 'Graduação 1º semestre' }))
            .toBe('CRTN Belém - Novo aviso: Graduação 1º semestre');
    });

    test('acrescenta o detalhe apenas uma vez', () => {
        const subject = buildSubject({ kind: 'MENSAGEM_EM_MASSA', extra: '  ' });
        expect(subject).toBe('CRTN Belém - Novo aviso');
    });
});

describe('actor', () => {
    test('traduz o papel do autor', () => {
        expect(actorRoleLabel('PRO')).toBe('Professor');
        expect(actorRoleLabel('ADM')).toBe('Administrador');
        expect(actorRoleLabel('STD')).toBe('Aluno');
        expect(actorRoleLabel('')).toBe('Equipe CRTN Belém');
    });

    test('monta o nome a partir do primeiro e do resto do nome', () => {
        expect(buildActorLabel(ATOR_PROFESSOR)).toBe('Ana Souza');
        expect(buildActorDescription(ATOR_PROFESSOR)).toBe('Professor Ana Souza');
    });

    test('cai para o user_code quando não há nome', () => {
        expect(buildActorLabel({ first_name: '', last_name: null, user_code: 'ADM01' })).toBe('ADM01');
        expect(buildActorDescription({ first_name: '', last_name: null, user_code: 'ADM01', role: 'ADM' }))
            .toBe('Administrador ADM01');
    });

    test('sem autor usa a equipe da academia', () => {
        expect(buildActorLabel(null)).toBe('');
        expect(buildActorDescription(null)).toBe('Equipe CRTN Belém');
    });
});

describe('escapeHtml e sanitizeEmail', () => {
    test('escapa o texto para não quebrar o HTML do e-mail', () => {
        expect(escapeHtml('<script>alert("x")</script>'))
            .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
        expect(escapeHtml("d'água & cia")).toBe('d&#39;água &amp; cia');
        expect(escapeHtml(null)).toBe('');
    });

    test('aceita apenas e-mails válidos em minúsculas', () => {
        expect(sanitizeEmail('  Aluno@CRTN.com.BR ')).toBe('aluno@crtn.com.br');
        expect(sanitizeEmail('sem-arroba')).toBe('');
        expect(sanitizeEmail('a@b')).toBe('');
        expect(sanitizeEmail(null)).toBe('');
    });
});

describe('resolvePresentation', () => {
    test('mapeia os kinds existentes para um selo e uma cor', () => {
        expect(resolvePresentation('PRESENCA_APROVADA')).toMatchObject({ tone: 'positive' });
        expect(resolvePresentation('PRESENCA_NEGADA')).toMatchObject({ tone: 'negative' });
        expect(resolvePresentation('AVATAR_APROVADO')).toMatchObject({ tone: 'positive' });
        expect(resolvePresentation('AVATAR_NEGADO')).toMatchObject({ tone: 'negative' });
        expect(resolvePresentation('MENSAGEM_EM_MASSA')).toMatchObject({ tone: 'neutral' });
    });

    test('kind desconhecido cai no rótulo genérico sem quebrar', () => {
        expect(resolvePresentation('QUALQUER_COISA')).toEqual({
            subject: '',
            label: 'Notificação',
            tone: 'neutral'
        });
    });
});

describe('buildPreheader', () => {
    test('resume a mensagem e credits o autor para a prévia da caixa de entrada', () => {
        const preheader = buildPreheader({
            body: 'Sua solicitação de presença foi aprovada.',
            actorDescription: 'Professor Ana Souza'
        });
        expect(preheader).toContain('aprovada');
        expect(preheader).toContain('Professor Ana Souza');
        expect(preheader.length).toBeLessThanOrEqual(200);
    });
});

describe('renderHtml', () => {
    const base = {
        kind: 'PRESENCA_APROVADA',
        title: 'Solicitação de presença aprovada',
        body: 'Sua solicitação de presença para 05/10/2026 (Gi) foi aprovada.',
        actor: ATOR_PROFESSOR,
        actionUrl: 'https://crtn-belem.com.br/notificacoes',
        actionLabel: 'Abrir minhas notificações'
    };

    test('mostra a academia, a ação do professor e o botão de acesso', () => {
        const html = renderHtml(base);
        expect(html).toContain('CRTN Belém');
        expect(html).toContain('Presença aprovada');
        expect(html).toContain('Ação realizada por');
        expect(html).toContain('Ana Souza');
        expect(html).toContain('Professor');
        expect(html).toContain('https://crtn-belem.com.br/notificacoes');
        expect(html).toContain('Abrir minhas notificações');
    });

    test('mostra as linhas de detalhe e descarta as incompletas', () => {
        const html = renderHtml({
            ...base,
            details: [
                { label: 'Data', value: '05/10/2026' },
                { label: 'Aula', value: 'Gi (1ª Aula)' },
                { label: 'Turma', value: '' },
                { label: '', value: 'sem rótulo' }
            ]
        });
        expect(html).toContain('05/10/2026');
        expect(html).toContain('Gi (1ª Aula)');
        expect(html).not.toContain('sem rótulo');
    });

    test('escapa o motivo informado pelo professor', () => {
        const html = renderHtml({
            ...base,
            kind: 'PRESENCA_NEGADA',
            body: 'Motivo informado pelo professor: <img src=x onerror=alert(1)>'
        });
        expect(html).not.toContain('<img src=x');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    test('omite o bloco do autor quando não há responsável informado', () => {
        const html = renderHtml({ ...base, actor: null });
        expect(html).not.toContain('Ação realizada por');
    });

    test('omite o botão quando não há link', () => {
        const html = renderHtml({ ...base, actionUrl: '' });
        expect(html).not.toContain('Abrir minhas notificações');
    });

    test('explica o motivo do envio e oferece como desligar (anti-spam)', () => {
        const html = renderHtml(base);
        expect(html).toContain('Notificações por e-mail');
        expect(html).toContain('Meu Perfil');
    });

    test('transforma o opt-out em link quando a URL é conhecida', () => {
        const html = renderHtml({ ...base, optOutUrl: 'https://crtn-belem.com.br/meuperfil' });
        expect(html).toContain('<a href="https://crtn-belem.com.br/meuperfil"');
        expect(html).toContain('desligue esta opção');
    });

    test('usa bgcolor como fallback para o Outlook desktop', () => {
        const html = renderHtml(base);
        expect(html).toContain(`bgcolor="${PALETTE.accent}"`);
        expect(html).toContain(`bgcolor="${PALETTE.pageBg}"`);
        expect(html).toContain(`bgcolor="${PALETTE.cardBg}"`);
    });

    test('usa bgcolor na tabela de detalhes para o Outlook', () => {
        const html = renderHtml({ ...base, details: [{ label: 'Data', value: '05/10/2026' }] });
        expect(html).toContain('bgcolor="' + PALETTE.softBg + '"');
    });
});

describe('renderText', () => {
    test('monta a versão texto com autor, detalhes e link', () => {
        const text = renderText({
            kind: 'PRESENCA_NEGADA',
            title: 'Solicitação de presença negada',
            body: 'Sua solicitação de presença para 05/10/2026 foi negada.',
            details: [{ label: 'Data', value: '05/10/2026' }],
            actor: ATOR_PROFESSOR,
            actionUrl: 'https://crtn-belem.com.br/notificacoes',
            actionLabel: 'Abrir minhas notificações'
        });

        expect(text).toContain('CRTN Belém · Presença negada');
        expect(text).toContain('Data: 05/10/2026');
        expect(text).toContain('Ação realizada por: Ana Souza (Professor)');
        expect(text).toContain('https://crtn-belem.com.br/notificacoes');
        expect(text).toContain('Notificações por e-mail');
    });
});

describe('buildNotificationEmail', () => {
    test('devolve assunto, texto e HTML coerentes entre si', () => {
        const email = buildNotificationEmail({
            kind: 'AVATAR_NEGADO',
            title: 'Novo avatar negado',
            body: 'Sua nova foto de perfil não foi aprovada.',
            actor: { first_name: 'Bruno', last_name: 'Alves', role: 'ADM' },
            actionUrl: 'https://crtn-belem.com.br/notificacoes'
        });

        expect(email.subject).toBe('CRTN Belém - Foto de perfil não aprovada');
        expect(email.text).toContain('Ação realizada por: Bruno Alves (Administrador)');
        expect(email.html).toContain('Administrador');
        expect(email.html).toContain('CRTN Belém');
    });

    test('mantém o prefixo da academia mesmo sem kind nem título', () => {
        const email = buildNotificationEmail({ body: 'Aviso' });
        expect(email.subject.startsWith('CRTN Belém - ')).toBe(true);
        expect(email.html).toContain('Notificação');
    });
});