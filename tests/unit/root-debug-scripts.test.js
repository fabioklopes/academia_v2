const { runDebugMetasAssoc } = require('../../debug_metas_assoc');
const { runTmpDebugMetas } = require('../../tmp_debug_metas');

describe('scripts de debug na raiz', () => {
    test('exportam runner async', () => {
        expect(typeof runDebugMetasAssoc).toBe('function');
        expect(typeof runTmpDebugMetas).toBe('function');
    });
});
