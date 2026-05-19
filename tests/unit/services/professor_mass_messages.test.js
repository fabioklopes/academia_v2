const { buildStudentMassMessageBellViewModel } = require('../../../services/professor_mass_messages');

describe('buildStudentMassMessageBellViewModel', () => {
    test('soma avisos e notificações no badge do header', () => {
        const vm = buildStudentMassMessageBellViewModel({ unreadCount: 2 }, 3);
        expect(vm.navbarUnreadCount).toBe(5);
        expect(vm.navbarHasUnread).toBe(true);
        expect(vm.unreadCount).toBe(2);
        expect(vm.notificationUnreadCount).toBe(3);
    });

    test('prioriza href de notificações quando há não lidas', () => {
        const vm = buildStudentMassMessageBellViewModel({ unreadCount: 1 }, 2);
        expect(vm.navbarHref).toBe('/notificacoes');
    });

    test('usa central de avisos quando só há mensagens em massa', () => {
        const vm = buildStudentMassMessageBellViewModel({ unreadCount: 4 }, 0);
        expect(vm.navbarHref).toBe('/mensagens/mestre');
        expect(vm.navbarHasUnread).toBe(true);
    });

    test('header fica idle sem pendências', () => {
        const vm = buildStudentMassMessageBellViewModel({ unreadCount: 0 }, 0);
        expect(vm.navbarHasUnread).toBe(false);
        expect(vm.navbarUnreadCount).toBe(0);
    });
});
