// ============================================================================
// MÓDULO DE AUDITORIA FISCAL DE NFE, COMPLIANCE CNPJ ICMS E EXPORTAÇÃO
// ============================================================================

window.conciliarCsvAnaliticoNavegador = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const BASE_API = apiUrlAtual || URL_PADRAO;
            showToast('A conciliar relatório CSV da TruckPag com a base de dados...', 'warning');
            const res = await fetch(`${BASE_API}/api/conciliar-csv`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conteudoCsv: e.target.result, nomeArquivo: file.name })
            });
            const data = await res.json();
            if (data.ok) {
                showToast(data.message, 'success');
                await buscarAuditoriaIndependente(false);
                if (typeof fetchDadosAnalise === 'function') await fetchDadosAnalise(false, false);
            } else {
                showToast(data.error || 'Erro ao conciliar CSV.', 'error');
            }
        } catch (err) {
            showToast('Falha ao enviar CSV para conciliação.', 'error');
        }
    };
    reader.readAsText(file, 'ISO-8859-1');
};

window.buscarAuditoriaIndependente = async function(sincronizarNaApi = false) {
    const dtIni = document.getElementById('auditDtIni').value;
    const dtFim = document.getElementById('auditDtFim').value;
    const btnSync = document.getElementById('btnAuditSyncApi');

    if (!dtIni || !dtFim) {
        showToast('Selecione a Data Inicial e Final da Auditoria.', 'warning');
        return;
    }

    try {
        if (btnSync) {
            btnSync.disabled = true;
            btnSync.innerHTML = '⏳ Sincronizando TruckPag...';
        }
        const BASE_API = apiUrlAtual || URL_PADRAO;

        if (sincronizarNaApi) {
            await fetch(`${BASE_API}/api/buscar-auditoria`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dtIni, dtFim })
            });
        }

        const res = await fetch(`${BASE_API}/api/auditoria?dtIni=${dtIni}&dtFim=${dtFim}`);
        const data = await res.json();
        transacoesAuditoriaGlobal = data.transacoes || [];
        resumoAuditoriaBackend = data.resumoAuditoria || null;

        filtrarTabelaAuditoriaLocal();
        showToast(`Auditoria atualizada: ${transacoesAuditoriaGlobal.length} transações carregadas.`, 'success');
    } catch (e) {
        showToast('Falha ao consultar Auditoria no Servidor.', 'error');
    } finally {
        if (btnSync) {
            btnSync.disabled = false;
            btnSync.innerHTML = '🔄 Sincronizar API';
        }
    }
};

window.filtrarTabelaAuditoriaLocal = function() {
    const statusNfe = document.getElementById('auditFiltroNfe')?.value || 'todos';
    const modeloNfe = document.getElementById('auditFiltroModeloNfe')?.value || 'todos';
    const slaAtraso = document.getElementById('auditFiltroSla')?.value || 'todos';
    const ocorrencia = document.getElementById('auditFiltroOcorrencia')?.value || 'todos';
    const statusCnpj = document.getElementById('auditFiltroCnpj')?.value || 'todos';
    const termo = document.getElementById('intSearchInput')?.value.toLowerCase().trim() || '';

    transacoesAuditoriaFiltradas = transacoesAuditoriaGlobal.filter(t => {
        const tipoTr = String(t.tipo_transacao || 'COMPRA').toUpperCase();
        const statusTr = String(t.status_transacao || 'APROVADA').toUpperCase();
        const cnpjEsperado = t.cnpj_esperado || getCNPJEstruturado(t.uf, t.cidade, t.estabelecimento);
        const cnpjEmitido = formatarCNPJ(t.cnpj_cliente || '');
        const hasNfe = t.status_nfe === 'Vinculada' && Boolean(t.chave_nfe);
        const ehCompraAtiva = ['COMPRA', 'MANUAL'].includes(tipoTr) && statusTr === 'APROVADA' && Number(t.volume) > 0;

        let avalCnpj = t.status_cnpj;
        if (!avalCnpj) {
            if (!ehCompraAtiva) avalCnpj = 'ISENTO_ESTORNO';
            else if (hasNfe) avalCnpj = (cnpjEmitido === cnpjEsperado) ? 'OK' : 'DIVERGENTE';
            else avalCnpj = 'AGUARDANDO_NFE';
        }

        if (statusNfe !== 'todos' && t.status_nfe !== statusNfe) return false;
        if (modeloNfe !== 'todos' && t.modelo_nfe !== modeloNfe) return false;
        if (slaAtraso !== 'todos' && t.faixa_sla !== slaAtraso) return false;

        if (ocorrencia === 'COMPRA_APROVADA' && !ehCompraAtiva) return false;
        if (ocorrencia === 'ESTORNO' && tipoTr !== 'ESTORNO') return false;

        if (statusCnpj !== 'todos' && avalCnpj !== statusCnpj) return false;

        if (termo) {
            const txt = `${t.id} ${t.data} ${t.estabelecimento} ${t.rede_posto} ${t.cidade} ${t.uf} ${t.placa} ${t.motorista} ${t.chave_nfe} ${t.numero_nfe} ${t.cartao} ${t.equipamento} ${t.cnpj_posto} ${t.cnpj_cliente} ${t.mensagem}`.toLowerCase();
            if (!txt.includes(termo)) return false;
        }
        return true;
    });

    renderizarKpisETabelaAuditoria();
};

function renderizarKpisETabelaAuditoria() {
    const totalListadas = transacoesAuditoriaFiltradas.length;
    const comprasAtivas = transacoesAuditoriaFiltradas.filter(t => ['COMPRA', 'MANUAL'].includes(String(t.tipo_transacao || 'COMPRA').toUpperCase()) && String(t.status_transacao || 'APROVADA').toUpperCase() === 'APROVADA' && Number(t.volume) > 0).length;
    const totalEstornosRecusas = totalListadas - comprasAtivas;
    const nfeVinc = transacoesAuditoriaFiltradas.filter(t => t.status_nfe === 'Vinculada').length;
    const nfeMod55 = transacoesAuditoriaFiltradas.filter(t => t.modelo_nfe === '55').length;
    const nfeMod65 = transacoesAuditoriaFiltradas.filter(t => t.modelo_nfe === '65').length;
    const nfePend = transacoesAuditoriaFiltradas.filter(t => t.status_nfe !== 'Vinculada' && ['COMPRA', 'MANUAL'].includes(String(t.tipo_transacao || 'COMPRA').toUpperCase()) && String(t.status_transacao || 'APROVADA').toUpperCase() === 'APROVADA' && Number(t.volume) > 0).length;
    const slaCritico = transacoesAuditoriaFiltradas.filter(t => t.faixa_sla === 'CRITICO_5D').length;

    let cnpjOkCount = 0, cnpjDivCount = 0, icmsGarantido = 0, icmsRisco = 0;
    transacoesAuditoriaFiltradas.forEach(t => {
        if (['COMPRA', 'MANUAL'].includes(t.tipo_transacao) && t.status_transacao === 'APROVADA' && Number(t.volume) > 0) {
            const cred = Number(t.credito_icms_estimado) || 0;
            if (t.status_nfe === 'Vinculada') {
                const esp = t.cnpj_esperado || getCNPJEstruturado(t.uf, t.cidade, t.estabelecimento);
                const rec = formatarCNPJ(t.cnpj_cliente || '');
                if (rec === esp) { cnpjOkCount++; icmsGarantido += cred; }
                else { cnpjDivCount++; icmsRisco += cred; }
            } else {
                icmsRisco += cred;
            }
        }
    });

    const auditKpiBar = document.getElementById('auditKpiBar');
    if (auditKpiBar) {
        auditKpiBar.innerHTML = `
            <div class="audit-kpi-mini tooltip-container">
                <div class="lbl"><span>📋 Total TruckPag</span></div>
                <div class="val">${totalListadas}</div>
                <div class="sub">${comprasAtivas} Válidas | ${totalEstornosRecusas} Est.</div>
            </div>
            <div class="audit-kpi-mini tooltip-container" style="border-left-color: #10b981;">
                <div class="lbl"><span>✅ NFe Vinculadas</span></div>
                <div class="val" style="color:#10b981">${nfeVinc}</div>
                <div class="sub">Mod.55: ${nfeMod55} | Mod.65: ${nfeMod65}</div>
            </div>
            <div class="audit-kpi-mini tooltip-container" style="border-left-color: var(--warning);">
                <div class="lbl"><span>⏳ NFe Pendentes</span></div>
                <div class="val" style="color:var(--warning)">${nfePend}</div>
                <div class="sub">Crítico (&ge;5d): <b style="color:var(--danger)">${slaCritico}</b></div>
            </div>
            <div class="audit-kpi-mini tooltip-container" style="border-left-color: #0ea5e9;">
                <div class="lbl"><span>🏛️ CNPJ ICMS OK</span></div>
                <div class="val" style="color:#0ea5e9">${cnpjOkCount}</div>
                <div class="sub">Filial Correta</div>
            </div>
            <div class="audit-kpi-mini tooltip-container" style="border-left-color: #ef4444; cursor:pointer;" onclick="toggleRankingInadimplenciaFiscal()">
                <div class="lbl"><span>❌ CNPJ Divergente</span></div>
                <div class="val" style="color:#ef4444">${cnpjDivCount}</div>
                <div class="sub">Ver Ranking</div>
            </div>
            <div class="audit-kpi-mini tooltip-container" style="border-left-color: var(--success);">
                <div class="lbl"><span>💰 ICMS Garantido</span></div>
                <div class="val" style="color:var(--success)">R$ ${fmt(icmsGarantido)}</div>
                <div class="sub">NFe + CNPJ OK</div>
            </div>
            <div class="audit-kpi-mini tooltip-container" style="border-left-color: var(--danger); cursor:pointer;" onclick="toggleRankingInadimplenciaFiscal()">
                <div class="lbl"><span>⚠️ ICMS em Risco</span></div>
                <div class="val" style="color:var(--danger)">R$ ${fmt(icmsRisco)}</div>
                <div class="sub">Pendente</div>
            </div>
        `;
    }

    const rankFiscal = resumoAuditoriaBackend?.rankingInadimplenciaFiscal || [];
    const tbRankFiscal = document.getElementById('tbInadimplenciaFiscal');
    if (tbRankFiscal) {
        tbRankFiscal.innerHTML = rankFiscal.map(r => `
            <tr>
                <td><b>${r.posto}</b></td>
                <td><span class="badge blue">${r.uf}</span></td>
                <td class="text-right">${r.totalCompras}</td>
                <td class="text-right" style="color:var(--warning); font-weight:800;">${r.nfePendentes}</td>
                <td class="text-right" style="color:var(--danger); font-weight:800;">${r.cnpjDivergente}</td>
                <td class="text-right" style="color:var(--danger); font-weight:800;">R$ ${fmt(r.icmsEmRisco)}</td>
            </tr>
        `).join('') || `<tr><td colspan="6" class="text-center">Nenhuma pendência fiscal encontrada.</td></tr>`;
    }

    const tb = document.getElementById('tbInt');
    if (!tb) return;

    if (transacoesAuditoriaFiltradas.length === 0) {
        tb.innerHTML = `<tr><td colspan="6" class="text-center" style="padding:35px; color:var(--text-muted); font-weight:bold;">Nenhuma transação encontrada na Auditoria.</td></tr>`;
        return;
    }

    tb.innerHTML = transacoesAuditoriaFiltradas.map(t => {
        const partesData = (t.data || '').split(' ');
        const dtStr = partesData[0] ? partesData[0].split('-').reverse().join('/') : 'ND';
        const horaStr = partesData[1] || '';
        const tipoTr = String(t.tipo_transacao || 'COMPRA').toUpperCase();
        const statusTr = String(t.status_transacao || 'APROVADA').toUpperCase();
        const isArla = String(t.combustivel || '').toUpperCase().includes('ARLA');

        let badgeOcorrencia = `<span class="badge green">🟢 COMPRA APROVADA</span>`;
        if (tipoTr === 'MANUAL' && statusTr === 'APROVADA') {
            badgeOcorrencia = `<span class="badge blue">🛠️ MANUAL APROVADO</span>`;
        } else if (tipoTr === 'ESTORNO' || statusTr === 'ESTORNADA') {
            badgeOcorrencia = `<span class="badge red">❌ ESTORNO / RECUSADA</span>`;
        }

        const cnpjEsperado = t.cnpj_esperado || getCNPJEstruturado(t.uf, t.cidade, t.estabelecimento);
        const cnpjRecebido = formatarCNPJ(t.cnpj_cliente || '');
        const hasNfe = t.status_nfe === 'Vinculada' && Boolean(t.chave_nfe);
        const ehCompraAtiva = ['COMPRA', 'MANUAL'].includes(tipoTr) && statusTr === 'APROVADA' && Number(t.volume) > 0;

        let blocoFiscalHtml = '';
        if (!ehCompraAtiva) {
            blocoFiscalHtml = `<div class="nfe-card estorno"><div style="font-size:11px; font-weight:800; color:var(--danger);">🚫 ISENTA / RECUSADA</div></div>`;
        } else if (hasNfe) {
            const isCnpjOk = (cnpjRecebido === cnpjEsperado);
            const badgeCnpj = isCnpjOk
                ? `<span class="badge green">✅ CNPJ OK (${cnpjEsperado})</span>`
                : `<span class="badge red">❌ Divergência ICMS | Emitido: ${cnpjRecebido || 'ND'} | Esperado: ${cnpjEsperado}</span>`;

            blocoFiscalHtml = `
                <div class="nfe-card vinculada">
                    <div style="font-size:11.5px; font-weight:800; color:var(--success);">✅ NFe VINCULADA (${t.modelo_nfe === '55' ? 'Mod. 55' : 'Mod. 65'})</div>
                    <div class="nfe-chave-box">🔑 ${t.chave_nfe}</div>
                    <div class="cnpj-compare-box">${badgeCnpj}</div>
                    <div class="nfe-links">
                        <button type="button" class="btn-nfe" onclick="copiarChaveNFe('${t.chave_nfe}')">📋 Copiar</button>
                        <button type="button" class="btn-nfe alt" onclick="baixarNFePdf('${t.chave_nfe}')">📄 DANFE</button>
                    </div>
                </div>
            `;
        } else {
            blocoFiscalHtml = `
                <div class="nfe-card ${t.faixa_sla === 'CRITICO_5D' ? 'critico' : 'pendente'}">
                    <div style="font-size:11.5px; font-weight:800; color:var(--warning);">⏳ AGUARDANDO NFE (${t.dias_sem_nota || 0} dias)</div>
                    <div style="font-size:11px; color:var(--text-muted);">CNPJ Esperado: <b>${cnpjEsperado}</b></div>
                </div>
            `;
        }

        return `
            <tr>
                <td><b>${dtStr}</b><br><small style="color:var(--text-muted)">${horaStr}</small></td>
                <td><div style="font-size:13px; font-weight:800;">#${t.id}</div>${badgeOcorrencia}</td>
                <td><b>${t.estabelecimento}</b><br><small style="color:var(--text-muted)">📍 ${t.cidade || 'ND'}/${t.uf || 'ND'}</small></td>
                <td class="text-center"><span class="badge blue">🚛 ${t.placa || 'ND'}</span><br><small><b>${t.motorista || 'ND'}</b></small></td>
                <td class="text-right"><div style="font-size:13px; font-weight:800;">${fmt(t.volume)} L</div><span class="badge ${isArla?'blue':'warning'}">${isArla?'Arla':'Diesel'}</span><br><b>R$ ${fmt(t.valor_total)}</b></td>
                <td>${blocoFiscalHtml}</td>
            </tr>
        `;
    }).join('');
}

window.toggleRankingInadimplenciaFiscal = function() {
    const box = document.getElementById('boxRankingInadimplenciaFiscal');
    if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
};

window.exportarCSVAuditoria = function() {
    if (!transacoesAuditoriaFiltradas || transacoesAuditoriaFiltradas.length === 0) {
        showToast("Nenhum dado na Auditoria para exportar.", "error");
        return;
    }
    const linhas = ["Data;Transacao;Tipo;Status;Posto;Rede;Cidade;UF;Placa;Motorista;Combustivel;Volume(L);Valor Total(R$);Status NFe;Chave NFe;CNPJ Posto;CNPJ Cliente"];
    transacoesAuditoriaFiltradas.forEach(t => {
        const dtStr = t.data ? t.data.split(' ')[0].split('-').reverse().join('/') : 'ND';
        linhas.push([
            dtStr, t.id, t.tipo_transacao, t.status_transacao, `"${t.estabelecimento}"`, `"${t.rede_posto}"`, `"${t.cidade}"`, t.uf, t.placa, `"${t.motorista}"`, t.combustivel,
            String(t.volume).replace('.', ','), String(t.valor_total).replace('.', ','), t.status_nfe, t.chave_nfe || '', formatarCNPJ(t.cnpj_posto), formatarCNPJ(t.cnpj_cliente)
        ].join(';'));
    });
    const blob = new Blob(["\uFEFF" + linhas.join("\n")], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.setAttribute("href", URL.createObjectURL(blob));
    link.setAttribute("download", `auditoria_cavalheirolog.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    showToast('Relatório de Auditoria exportado!', 'success');
};