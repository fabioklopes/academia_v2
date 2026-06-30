const Usuario = require('../../../models/Usuario');
const {
    approveAvatar,
    rejectAvatar,
    getAvatarRolloutStats,
    MIN_DIMENSION_PX
} = require('../../../services/user_avatar_review');

describe('services/user_avatar_review', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('MIN_DIMENSION_PX é um número positivo', () => {
        expect(typeof MIN_DIMENSION_PX).toBe('number');
        expect(MIN_DIMENSION_PX).toBeGreaterThan(0);
    });

    describe('approveAvatar', () => {
        test('rejeita quando não há foto pendente', async () => {
            const usuario = { photo_status: 'NONE', photo_pending_path: null };
            await expect(approveAvatar(usuario, 'PRO01')).rejects.toThrow(
                'Este usuário não possui foto pendente de aprovação.'
            );
        });
    });

    describe('rejectAvatar', () => {
        test('rejeita quando não há foto pendente', async () => {
            const usuario = { photo_status: 'APPROVED', photo_pending_path: null };
            await expect(rejectAvatar(usuario, 'PRO01', 'motivo qualquer')).rejects.toThrow(
                'Este usuário não possui foto pendente de aprovação.'
            );
        });

        test('exige motivo não vazio', async () => {
            const usuario = { photo_status: 'PENDING', photo_pending_path: '/uploads/users/pending_1.jpg' };
            await expect(rejectAvatar(usuario, 'PRO01', '   ')).rejects.toThrow(
                'Informe o motivo da recusa.'
            );
        });
    });

    describe('getAvatarRolloutStats', () => {
        test('calcula percentual de aprovados e flag allApproved', async () => {
            jest.spyOn(Usuario, 'findAll').mockResolvedValue([
                { photo_status: 'APPROVED', total: '3' },
                { photo_status: 'PENDING', total: '1' }
            ]);

            const stats = await getAvatarRolloutStats();

            expect(stats.total).toBe(4);
            expect(stats.counts.APPROVED).toBe(3);
            expect(stats.counts.PENDING).toBe(1);
            expect(stats.counts.NONE).toBe(0);
            expect(stats.approvedPercent).toBe(75);
            expect(stats.allApproved).toBe(false);
        });

        test('allApproved é true quando 100% aprovados', async () => {
            jest.spyOn(Usuario, 'findAll').mockResolvedValue([
                { photo_status: 'APPROVED', total: '2' }
            ]);

            const stats = await getAvatarRolloutStats();

            expect(stats.approvedPercent).toBe(100);
            expect(stats.allApproved).toBe(true);
        });

        test('lida com nenhum usuário ativo sem dividir por zero', async () => {
            jest.spyOn(Usuario, 'findAll').mockResolvedValue([]);

            const stats = await getAvatarRolloutStats();

            expect(stats.total).toBe(0);
            expect(stats.approvedPercent).toBe(0);
            expect(stats.allApproved).toBe(false);
        });
    });
});
