const { main } = require('../../../utils/set_admin_password');

describe('utils/set_admin_password', () => {
    test('exporta main', () => {
        expect(typeof main).toBe('function');
    });
});
