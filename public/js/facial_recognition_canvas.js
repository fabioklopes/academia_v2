(function () {
    function init() {
        const dataEl = document.getElementById('rfData');
        if (!dataEl) {
            return;
        }

        let data;
        try {
            data = JSON.parse(dataEl.textContent);
        } catch (e) {
            return;
        }

        const canvas = document.getElementById('rfCanvas');
        if (canvas) {
            drawCanvas(canvas, data);
        }

        setupCancelar(data);

        if (data.status === 'REVIEW') {
            setupReview(data);
        }
    }

    function setupCancelar(data) {
        const cancelarBtn = document.getElementById('rfBtnCancelar');
        if (!cancelarBtn) {
            return;
        }
        cancelarBtn.addEventListener('click', async function () {
            if (!confirm('Cancelar e excluir esta foto? Esta ação não pode ser desfeita.')) {
                return;
            }
            cancelarBtn.disabled = true;
            try {
                const res = await fetch(`/reconhecimento-facial/${data.fotoId}/cancelar`, { method: 'POST' });
                const json = await res.json();
                if (!json.ok) {
                    showAlert(json.mensagem || 'Erro ao cancelar.', 'danger');
                    return;
                }
                window.location.href = '/reconhecimento-facial';
            } catch (err) {
                showAlert('Erro de comunicação: ' + err.message, 'danger');
            } finally {
                cancelarBtn.disabled = false;
            }
        });
    }

    function drawCanvas(canvas, data) {
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = function () {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            ctx.drawImage(img, 0, 0);

            (data.rostos || []).forEach(function (rosto) {
                const x = rosto.box_x_min;
                const y = rosto.box_y_min;
                const w = rosto.box_x_max - rosto.box_x_min;
                const h = rosto.box_y_max - rosto.box_y_min;
                const cor = rosto.status === 'RECOGNIZED' ? '#28a745' : (rosto.status === 'IGNORED' ? '#6c757d' : '#dc3545');
                ctx.strokeStyle = cor;
                ctx.lineWidth = Math.max(2, Math.round(canvas.width / 300));
                ctx.strokeRect(x, y, w, h);
            });
        };
        img.onerror = function () {
            const msg = document.getElementById('rfCanvasError');
            if (msg) {
                msg.classList.remove('d-none');
            }
        };
        img.src = data.imageUrl;
    }

    async function fetchAllAlunos(classCode) {
        const alunos = [];
        let page = 1;
        let totalPages = 1;
        do {
            const res = await fetch(`/turmas/matriculados/${encodeURIComponent(classCode)}?page=${page}`);
            const json = await res.json().catch(function () { return {}; });
            if (!json.ok) break;
            alunos.push(...(json.alunos || []));
            totalPages = (json.pagination && json.pagination.totalPages) || 1;
            page += 1;
        } while (page <= totalPages);
        return alunos;
    }

    function showAlert(msg, tipo) {
        let alertEl = document.getElementById('rfReviewAlert');
        if (!alertEl) {
            alertEl = document.createElement('div');
            alertEl.id = 'rfReviewAlert';
            alertEl.setAttribute('role', 'alert');
            const anchor = document.getElementById('rfCanvas');
            if (anchor && anchor.parentNode) {
                anchor.parentNode.insertAdjacentElement('afterend', alertEl);
            } else {
                document.body.prepend(alertEl);
            }
        }
        alertEl.className = `alert alert-${tipo}`;
        alertEl.textContent = msg;
    }

    async function setupReview(data) {
        const container = document.getElementById('rfNaoReconhecidos');
        const aplicarBtn = document.getElementById('rfBtnAplicar');

        const naoReconhecidos = (data.rostos || []).filter(function (r) { return r.status === 'UNRECOGNIZED'; });

        if (container) {
            if (naoReconhecidos.length === 0) {
                container.innerHTML = '<p class="text-center text-success">Todos os rostos foram reconhecidos ou identificados.</p>';
            } else {
                const alunos = await fetchAllAlunos(data.classCode);
                const options = alunos
                    .map(function (a) { return `<option value="${a.user_code}">${a.full_name}</option>`; })
                    .join('');

                container.innerHTML = naoReconhecidos.map(function (rosto, idx) {
                    return `
                        <div class="card mb-2" data-rosto-id="${rosto.id}">
                            <div class="card-body d-flex flex-wrap align-items-center gap-2">
                                <span class="fw-semibold">Rosto não reconhecido #${idx + 1}</span>
                                <select class="form-select form-select-sm rf-select-aluno" style="max-width:260px;">
                                    <option value="">Selecione o aluno...</option>
                                    ${options}
                                </select>
                                <button type="button" class="btn btn-sm btn-success rf-btn-identificar">Identificar</button>
                                <button type="button" class="btn btn-sm btn-outline-secondary rf-btn-ignorar">Ignorar (não é aluno)</button>
                            </div>
                        </div>
                    `;
                }).join('');

                container.querySelectorAll('.rf-btn-identificar').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        const card = btn.closest('[data-rosto-id]');
                        const rostoId = card.getAttribute('data-rosto-id');
                        const select = card.querySelector('.rf-select-aluno');
                        const userCode = select ? select.value : '';
                        if (!userCode) {
                            showAlert('Selecione o aluno antes de identificar.', 'danger');
                            return;
                        }
                        identificar(data.fotoId, rostoId, { userCode });
                    });
                });

                container.querySelectorAll('.rf-btn-ignorar').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        const card = btn.closest('[data-rosto-id]');
                        const rostoId = card.getAttribute('data-rosto-id');
                        identificar(data.fotoId, rostoId, { ignore: true });
                    });
                });
            }
        }

        if (aplicarBtn) {
            aplicarBtn.addEventListener('click', async function () {
                if (!confirm('Aplicar presença para os alunos reconhecidos? Esta ação não pode ser desfeita.')) {
                    return;
                }
                aplicarBtn.disabled = true;
                try {
                    const res = await fetch(`/reconhecimento-facial/${data.fotoId}/aplicar`, { method: 'POST' });
                    const json = await res.json();
                    if (!json.ok) {
                        showAlert(json.mensagem || 'Erro ao aplicar presença.', 'danger');
                        return;
                    }
                    let msg = `Presença aplicada para ${json.applied} aluno(s).`;
                    if (json.skipped && json.skipped.length > 0) {
                        msg += ` ${json.skipped.length} ignorado(s) (já tinham presença no dia).`;
                    }
                    showAlert(msg, 'success');
                    setTimeout(function () { window.location.reload(); }, 1200);
                } catch (err) {
                    showAlert('Erro de comunicação: ' + err.message, 'danger');
                } finally {
                    aplicarBtn.disabled = false;
                }
            });
        }
    }

    async function identificar(fotoId, rostoId, body) {
        try {
            const res = await fetch(`/reconhecimento-facial/${fotoId}/identificar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({ rostoId }, body))
            });
            const json = await res.json();
            if (!json.ok) {
                showAlert(json.mensagem || 'Erro ao identificar.', 'danger');
                return;
            }
            window.location.reload();
        } catch (err) {
            showAlert('Erro de comunicação: ' + err.message, 'danger');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
