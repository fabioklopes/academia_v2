jest.mock('../../../config/compreface_config', () => ({
    getConfig: () => ({
        baseUrl: 'http://127.0.0.1:8000',
        apiKey: 'test-api-key',
        detProbThreshold: 0.8,
        similarityThreshold: 0.92,
        timeoutMs: 5000
    })
}));

const {
    recognizeFaces,
    addSubjectExample,
    removeSubjectExamples,
    healthCheck
} = require('../../../services/compreface_client');

describe('services/compreface_client', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('recognizeFaces envia POST multipart com a API key e retorna o JSON', async () => {
        const fakeResponse = { result: [{ box: { x_min: 1, y_min: 2, x_max: 3, y_max: 4 }, subjects: [] }] };
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify(fakeResponse)
        });

        const result = await recognizeFaces(Buffer.from('fake-image'));

        expect(result).toEqual(fakeResponse);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, options] = fetchSpy.mock.calls[0];
        expect(String(url)).toContain('/api/v1/recognition/recognize');
        expect(options.method).toBe('POST');
        expect(options.headers['x-api-key']).toBe('test-api-key');
    });

    test('addSubjectExample envia PUT com o subject na query', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => '{"image_id":"abc"}'
        });

        await addSubjectExample('AB123', Buffer.from('fake-avatar'));

        const [url, options] = fetchSpy.mock.calls[0];
        expect(String(url)).toContain('/api/v1/recognition/faces');
        expect(String(url)).toContain('subject=AB123');
        expect(options.method).toBe('PUT');
    });

    test('removeSubjectExamples envia DELETE com o subject na query', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => '{}'
        });

        await removeSubjectExamples('AB123');

        const [url, options] = fetchSpy.mock.calls[0];
        expect(String(url)).toContain('subject=AB123');
        expect(options.method).toBe('DELETE');
    });

    test('lança erro com statusCode 502 quando o CompreFace responde com erro', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue({
            ok: false,
            status: 401,
            text: async () => JSON.stringify({ message: 'Invalid API key' })
        });

        await expect(recognizeFaces(Buffer.from('x'))).rejects.toMatchObject({
            message: 'Invalid API key',
            statusCode: 502,
            compreFaceStatus: 401
        });
    });

    test('healthCheck retorna true quando o serviço responde ok', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });
        expect(await healthCheck()).toBe(true);
    });

    test('healthCheck retorna false quando a requisição falha', async () => {
        jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
        expect(await healthCheck()).toBe(false);
    });
});
