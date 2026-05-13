/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    testMatch: ['**/*.test.js'],
    clearMocks: true,
    resetMocks: false,
    restoreMocks: true,
    testTimeout: 30000,
    collectCoverageFrom: [
        'app.js',
        'lib/**/*.js',
        'config/**/*.js',
        'utils/**/*.js',
        'models/**/*.js',
        'scripts/**/*.js',
        '!**/node_modules/**'
    ],
    coveragePathIgnorePatterns: ['/node_modules/'],
    globalTeardown: '<rootDir>/tests/globalTeardown.cjs',
    // Pool Sequelize mantém handles; encerramento limpo via globalTeardown + saída garantida em CI
    forceExit: true
};
