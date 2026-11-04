// ============================================================================
// MÓDULO AUTOMATIZADO DE PREÇOS (CRUZAMENTO TRIPLO: BOMBA × NEGOCIADO × PAGO)
// ============================================================================

window.matrizImpactoGlobal = [];
window.dadosGraficoOscilacao = { labels: [], bomba: [], negociado: [], pago: [], volume: [], economia: [] };

// 1. CARREGA ACORDOS MANUAIS SALVOS (Para fallback)
window.carregarHistoricoPrecos = async function() {
    try {
        const BASE_API = typeof apiUrlAtual !== 'undefined' ? apiUrlAtual : window.location.origin;
        const res = await fetch(`${BASE_API}/api/precos-negociados`);
        const data = await res.json();
        window.historicoPrecosGlobal = data.precos || [];
    } catch (e) {
        console.error("Erro ao consultar preços negociados:", e);
    }
    renderMatrizViabilidade();
};

// 2. IMPORTAÇÃO MANUAL DE ARQUIVO CSV DE PREÇOS (Mantido)
window.importarCsvPrecosOuAbastecimentos = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();

    reader.onload = async function(e) {
        if (typeof showToast === 'function') showToast('A extrair e gravar preços da TruckPag...', 'warning');
        const texto = e.target.result;
        const linhas = texto.split(/\r?\n/);
        const loteParaBanco = [];

        for (let i = 0; i < linhas.length; i++) {
            const cols = linhas[i].trim().split(';');
            if (cols.length >= 13 && /^\d+$/.test(cols[0])) {
                const dtBr = cols[1].trim();
                const estab = String(cols[3] || '').replace(/"/g, '').trim();
                const comb = String(cols[9] || 'Diesel S10').replace(/"/g, '').trim();

                const limparMoeda = (s) => {
                    const limpo = String(s || '').replace(/R\$|\s|"/g, '').replace(/\./g, '').replace(',', '.').trim();
                    return limpo === '-' ? 0 : (parseFloat(limpo) || 0);
                };

                const pBomba = limparMoeda(cols[10]);
                const pNegBruto = limparMoeda(cols[11]);
                const pNegoc = pNegBruto > 0 ? pNegBruto : pBomba;

                if (pBomba > 0) {
                    const pDt = dtBr.split('/');
                    const dataIso = pDt.length === 3 ? `${pDt[2]}-${pDt[1].padStart(2, '0')}-${pDt[0].padStart(2, '0')}` : '2026-01-01';
                    loteParaBanco.push({ escopo: 'POSTO', estabelecimento: estab, combustivel: comb, data_vigencia: dataIso, data_fim: '2099-12-31', preco_bomba: pBomba, preco: pNegoc });
                }
            }
        }

        if (loteParaBanco.length === 0) {
            if (typeof showToast === 'function') showToast('Nenhum preço válido identificado no ficheiro CSV.', 'error');
            return;
        }

        try {
            const BASE_API = typeof apiUrlAtual !== 'undefined' ? apiUrlAtual : window.location.origin;
            await fetch(`${BASE_API}/api/precos-negociados`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ precos: loteParaBanco })
            });
            if (typeof showToast === 'function') showToast(`${loteParaBanco.length} acordos gravados! Recalculando...`, 'success');
            if (typeof fetchDadosAnalise === 'function') fetchDadosAnalise(false, false);
        } catch (err) {
            console.warn("Aviso ao gravar lote no servidor:", err);
        }
    };
    reader.readAsText(file, 'ISO-8859-1');
};

// 3. FILTROS DINÂMICOS DA MATRIZ
window.aplicarFiltrosMatrizPrecos = function() {
    renderMatrizViabilidade();
};

window.popularFiltrosMatriz = function(transacoesBase) {
    const selRede = document.getElementById('filtroMatrizRede');
    const selUf = document.getElementById('filtroMatrizUf');
    const selPosto = document.getElementById('filtroMatrizPosto');
    if (!selRede || !selUf || !selPosto) return;

    const vR = selRede.value || 'todos';
    const vU = selUf.value || 'todos';
    const vP = selPosto.value || 'todos';

    const redes = Array.from(new Set(transacoesBase.map(t => t.rede_posto || 'OUTROS').filter(Boolean))).sort();
    const ufs = Array.from(new Set(transacoesBase.map(t => t.uf).filter(u => u && u !== 'ND'))).sort();
    const postos = Array.from(new Set(transacoesBase.map(t => t.estabelecimento).filter(Boolean))).sort();

    selRede.innerHTML = `<option value="todos">Todas as Redes (${redes.length})</option>` + redes.map(r => `<option value="${r}">${r}</option>`).join('');
    selUf.innerHTML = `<option value="todos">Todos os Estados (${ufs.length})</option>` + ufs.map(u => `<option value="${u}">${u}</option>`).join('');
    selPosto.innerHTML = `<option value="todos">Todos os Postos (${postos.length})</option>` + postos.map(p => `<option value="${p}">${p}</option>`).join('');

    if (redes.includes(vR)) selRede.value = vR;
    if (ufs.includes(vU)) selUf.value = vU;
    if (postos.includes(vP)) selPosto.value = vP;
};

// 4. MOTOR DE CRUZAMENTO TRIPLO (O NOVO CÉREBRO MATEMÁTICO)
window.renderMatrizViabilidade = function() {
    const listaBase = Array.isArray(window.transacoesAnaliseFiltradas) ? window.transacoesAnaliseFiltradas : [];
    popularFiltrosMatriz(listaBase);

    const fRede = document.getElementById('filtroMatrizRede')?.value || 'todos';
    const fUf = document.getElementById('filtroMatrizUf')?.value || 'todos';
    const fPosto = document.getElementById('filtroMatrizPosto')?.value || 'todos';
    const fComb = document.getElementById('filtroMatrizComb')?.value || 'todos';

    const mapaMatriz = new Map();
    const evolucaoDiaria = new Map();

    let volAuditadoGlobal = 0, volDieselGlobal = 0, volArlaGlobal = 0;
    let custoBombaGlobal = 0, custoNegociadoGlobal = 0, custoPagoGlobal = 0;
    let glosaGlobal = 0, econDieselGlobal = 0, econArlaGlobal = 0;

    listaBase.forEach(t => {
        const redeAtual = t.rede_posto || 'OUTROS';
        if (fRede !== 'todos' && redeAtual !== fRede) return;
        if (fUf !== 'todos' && t.uf !== fUf) return;
        if (fPosto !== 'todos' && t.estabelecimento !== fPosto) return;

        const combUp = String(t.combustivel || '').toUpperCase();
        const isArla = combUp.includes('ARLA');
        if (fComb === 'DIESEL' && isArla) return;
        if (fComb === 'ARLA' && !isArla) return;

        const vol = parseFloat(t.volume) || 0;
        const valPago = parseFloat(t.valor_total) || 0;
        if (vol <= 0) return;

        // Recupera os 3 preços injetados independentemente pelo Backend
        const pPago = parseFloat(t.preco_pago) || (valPago / vol);
        const pBomba = parseFloat(t.preco_bomba_referencia) || pPago;
        const pNeg = parseFloat(t.preco_tabela) || pPago;

        // Cálculos Financeiros Exatos da Matriz
        const custoBombaItem = vol * pBomba;
        const custoNegocItem = vol * pNeg;
        
        // Economia = Diferença entre o Preço Seco da Bomba e o que Efetivamente se Pagou
        const econRealItem = custoBombaItem - valPago;
        
        // Glosa = Diferença prejudicial (Quando o que se pagou foi maior que o que foi acordado)
        const glosaItem = pPago > (pNeg + 0.005) ? (pPago - pNeg) * vol : 0;

        volAuditadoGlobal += vol;
        custoBombaGlobal += custoBombaItem;
        custoNegociadoGlobal += custoNegocItem;
        custoPagoGlobal += valPago;
        glosaGlobal += glosaItem;

        if (isArla) { econArlaGlobal += econRealItem; volArlaGlobal += vol; } 
        else { econDieselGlobal += econRealItem; volDieselGlobal += vol; }

        // Agrupa por Posto para a Tabela (Matriz Analítica)
        const key = `${t.estabelecimento}|${t.combustivel}`;
        if (!mapaMatriz.has(key)) {
            mapaMatriz.set(key, {
                posto: t.estabelecimento, rede: redeAtual, cidade: t.cidade || 'ND', uf: t.uf || 'ND',
                combustivel: t.combustivel || 'Diesel S10', operacoes: 0, volTotal: 0,
                custoBombaProj: 0, custoNegocProj: 0, valorPagoTotal: 0, glosaTotal: 0
            });
        }
        const m = mapaMatriz.get(key);
        m.operacoes++; m.volTotal += vol;
        m.custoBombaProj += custoBombaItem; m.custoNegocProj += custoNegocItem;
        m.valorPagoTotal += valPago; m.glosaTotal += glosaItem;

        // Agrupa por Dia para o Gráfico de Evolução (3 Linhas Separadas)
        const dia = t.data ? String(t.data).split(' ')[0] : '';
        if (dia) {
            if (!evolucaoDiaria.has(dia)) { evolucaoDiaria.set(dia, { vol: 0, valBomba: 0, valNegoc: 0, valPago: 0, econDia: 0 }); }
            const ev = evolucaoDiaria.get(dia);
            ev.vol += vol; ev.valBomba += custoBombaItem; ev.valNegoc += custoNegocItem;
            ev.valPago += valPago; ev.econDia += econRealItem;
        }
    });

    const economiaRealGlobal = custoBombaGlobal - custoPagoGlobal;
    const ganhoMedioLitro = volAuditadoGlobal > 0 ? (economiaRealGlobal / volAuditadoGlobal) : 0;

    // 4.1 Atualiza os Cards Superiores
    const kpiBar = document.getElementById('precosKpiBar');
    if (kpiBar) {
        kpiBar.innerHTML = `
            <div class="audit-kpi-mini tooltip-container" style="border-left-color:var(--info)">
                <div class="lbl"><span>📦 Volume Auditado</span> <span>ℹ️</span></div>
                <div class="val">${fmt(volAuditadoGlobal, 2)} L</div>
                <div class="sub">Em ${mapaMatriz.size} postos analisados</div>
                <div class="tooltip-box"><b>📦 Volume Cruzado:</b><br>Soma dos abastecimentos onde foi possível extrair a diferença tarifária.</div>
            </div>
            <div class="audit-kpi-mini tooltip-container" style="border-left-color:#8b5cf6">
                <div class="lbl"><span>🏷️ Cruzamento Triplo (R$)</span> <span>ℹ️</span></div>
                <div class="val">R$ ${fmt(custoNegociadoGlobal, 2)}</div>
                <div class="sub">Teto Bomba: R$ ${fmt(custoBombaGlobal, 2)} | Fatura: <b>R$ ${fmt(custoPagoGlobal, 2)}</b></div>
                <div class="tooltip-box"><b>🏷️ Os 3 Pilares Financeiros:</b><br>• <b>Sem desconto (Bomba):</b> R$ ${fmt(custoBombaGlobal, 2)}<br>• <b>Acordo/Meta:</b> R$ ${fmt(custoNegociadoGlobal, 2)}<br>• <b>Realidade da Fatura (Pago):</b> R$ ${fmt(custoPagoGlobal, 2)}</div>
            </div>
            <div class="audit-kpi-mini tooltip-container" style="border-left-color:var(--success)">
                <div class="lbl"><span>💰 Economia Real (Alta/Baixa)</span> <span>ℹ️</span></div>
                <div class="val" style="color:${economiaRealGlobal >= 0 ? 'var(--success)' : 'var(--danger)'}">
                    ${economiaRealGlobal >= 0 ? '📈 R$' : '📉 R$'} ${fmt(Math.abs(economiaRealGlobal), 2)}
                </div>
                <div class="sub">Dif: <b>${ganhoMedioLitro >= 0 ? '+' : ''}R$ ${fmt(ganhoMedioLitro, 3)} / L</b></div>
                <div class="tooltip-box"><b>💰 Lucro/Prejuízo Realizado:</b><br>Diferença real extraída: <code>(Custo Bomba Original) - Valor da Transação</code>.</div>
            </div>
            <div class="audit-kpi-mini tooltip-container" style="border-left-color:var(--danger)">
                <div class="lbl"><span>🚨 Glosa Comercial</span> <span>ℹ️</span></div>
                <div class="val" style="color:var(--danger)">R$ ${fmt(glosaGlobal, 2)}</div>
                <div class="sub">Valor passível de reembolso</div>
                <div class="tooltip-box"><b>🚨 Auditoria Negocial:</b><br>Soma dos desvios onde o posto faturou acima do preço do acordo gravado.</div>
            </div>
        `;
    }

    // Atualiza a Visão Global do Dashboard
    const cardTopoEco = document.querySelector('.kpi-card.highlight');
    if (cardTopoEco) {
        const valEl = cardTopoEco.querySelector('.value');
        if (valEl) valEl.innerHTML = `R$ ${fmt(economiaRealGlobal, 2)}`;
        const pills = cardTopoEco.querySelectorAll('.fuel-pill-main');
        if (pills.length >= 2) { pills[0].innerHTML = `R$ ${fmt(econDieselGlobal, 2)}`; pills[1].innerHTML = `R$ ${fmt(econArlaGlobal, 2)}`; }
    }

    // 4.2 Prepara o Gráfico (As 3 Linhas Descoladas)
    const dKeys = Array.from(evolucaoDiaria.keys()).sort();
    window.dadosGraficoOscilacao = {
        labels: dKeys.map(d => d.split('-').reverse().join('/')),
        bomba: dKeys.map(k => Number((evolucaoDiaria.get(k).valBomba / evolucaoDiaria.get(k).vol).toFixed(3))),
        negociado: dKeys.map(k => Number((evolucaoDiaria.get(k).valNegoc / evolucaoDiaria.get(k).vol).toFixed(3))),
        pago: dKeys.map(k => Number((evolucaoDiaria.get(k).valPago / evolucaoDiaria.get(k).vol).toFixed(3))),
        volume: dKeys.map(k => Number(evolucaoDiaria.get(k).vol.toFixed(2))),
        economia: dKeys.map(k => Number(evolucaoDiaria.get(k).econDia.toFixed(2)))
    };
    renderGraficoOscilacao();

    // 4.3 Injeta os valores lado a lado na Matriz HTML do `index.html`
    const linhas = Array.from(mapaMatriz.values()).sort((a, b) => b.volTotal - a.volTotal);
    window.matrizImpactoGlobal = linhas;

    const tb = document.getElementById('tbPrecos');
    if (tb) {
        if (linhas.length === 0) { tb.innerHTML = `<tr><td colspan="8" class="text-center" style="padding:24px; color:var(--text-muted);">Nenhum dado cruzado.</td></tr>`; return; }

        tb.innerHTML = linhas.map((m, i) => {
            const pBombaMedio = m.volTotal > 0 ? m.custoBombaProj / m.volTotal : 0;
            const pNegocMedio = m.volTotal > 0 ? m.custoNegocProj / m.volTotal : 0;
            const pPagoMedio = m.volTotal > 0 ? m.valorPagoTotal / m.volTotal : 0;

            const difUnitaria = pBombaMedio - pPagoMedio;
            const econRealPosto = m.custoBombaProj - m.valorPagoTotal;
            const temGlosa = m.glosaTotal > 0.05;

            return `<tr>
                <td><b>#${i + 1}</b></td>
                <td><b>${m.posto}</b><br><small style="color:var(--text-muted)">🏢 ${m.rede} • 📍 ${m.cidade}/${m.uf} • <b>${m.combustivel}</b></small></td>
                <td class="text-right"><b>${fmt(m.volTotal, 2)} L</b><br><small style="color:var(--text-muted)">(${m.operacoes} ops.)</small></td>
                <td class="text-right" style="color:var(--info)"><b>R$ ${fmt(pBombaMedio, 3)}</b><br><small style="color:var(--text-muted)">Total: R$ ${fmt(m.custoBombaProj, 2)}</small></td>
                <td class="text-right" style="color:var(--success)"><b>R$ ${fmt(pNegocMedio, 3)}</b><br><small style="color:var(--text-muted)">Total: R$ ${fmt(m.custoNegocProj, 2)}</small></td>
                <td class="text-right"><b style="color:${temGlosa ? 'var(--danger)' : 'var(--text-main)'}">R$ ${fmt(pPagoMedio, 3)}</b><br><small style="color:var(--text-muted)">Total: R$ ${fmt(m.valorPagoTotal, 2)}</small></td>
                <td class="text-right" style="color:${difUnitaria >= 0 ? 'var(--success)' : 'var(--danger)'}; font-weight:bold;">${difUnitaria >= 0 ? '+' : ''}R$ ${fmt(difUnitaria, 3)} / L</td>
                <td class="text-right" style="font-weight:800; color:${econRealPosto >= 0 ? 'var(--success)' : 'var(--danger)'}">
                    R$ ${fmt(econRealPosto, 2)}
                    ${temGlosa ? `<br><small style="color:var(--danger)">⚠️ Glosa: R$ ${fmt(m.glosaTotal, 2)}</small>` : ''}
                </td>
            </tr>`;
        }).join('');
    }
};

// 5. GRÁFICO VISUAL (AS 3 LINHAS)
window.renderGraficoOscilacao = function() {
    const ctx = document.getElementById('cOscilacaoPrecos');
    if (!ctx || typeof Chart === 'undefined') return;
    Chart.getChart('cOscilacaoPrecos')?.destroy();

    const d = window.dadosGraficoOscilacao;
    if (!d || d.labels.length === 0) return;

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: d.labels,
            datasets: [
                { type: 'bar', label: 'Volume Faturado (L)', data: d.volume, backgroundColor: 'rgba(59, 130, 246, 0.22)', yAxisID: 'yVol', order: 4 },
                { type: 'line', label: '🔴 1. Preço Bomba (Sem Desconto)', data: d.bomba, borderColor: '#ef4444', backgroundColor: '#ef4444', borderDash: [5, 5], borderWidth: 2.5, yAxisID: 'yPreco', order: 3 },
                { type: 'line', label: '🟢 2. Preço Acordo (O que deveria ser cobrado)', data: d.negociado, borderColor: '#10b981', backgroundColor: '#10b981', borderWidth: 3, pointRadius: 4, yAxisID: 'yPreco', order: 2 },
                { type: 'line', label: '🟠 3. Preço Pago Real (O que veio na fatura)', data: d.pago, borderColor: '#f59e0b', backgroundColor: '#f59e0b', borderWidth: 3, pointRadius: 4, yAxisID: 'yPreco', order: 1 }
            ]
        },
        options: {
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { tooltip: { callbacks: { afterBody: (ctx) => { const i = ctx[0]?.dataIndex; return i !== undefined ? `💰 Economia Real (Bomba vs Pago): R$ ${fmt(d.economia[i], 2)}` : ''; } } } },
            scales: { yPreco: { type: 'linear', position: 'left', title: { display: true, text: 'R$ por Litro' } }, yVol: { type: 'linear', position: 'right', grid: { drawOnChartArea: false } } }
        }
    });
};

// 6. EXPORTAÇÃO CSV
window.exportarRelatorioImpactoCSV = function() {
    if (!window.matrizImpactoGlobal || window.matrizImpactoGlobal.length === 0) return;
    const linhas = ["Posto;Rede;UF;Combustivel;Volume Total(L);Preco Bomba Real(R$);Preco Acordo(R$);Preco Faturado(R$);Diferenca Unitaria(R$/L);Total Bomba(R$);Total Pago Fatura(R$);Economia Real(R$);Glosa Comercial(R$)"];
    window.matrizImpactoGlobal.forEach(m => {
        const pBomb = m.volTotal > 0 ? m.custoBombaProj / m.volTotal : 0;
        const pNeg = m.volTotal > 0 ? m.custoNegocProj / m.volTotal : 0;
        const pPag = m.volTotal > 0 ? m.valorPagoTotal / m.volTotal : 0;
        linhas.push([ `"${m.posto}"`, `"${m.rede}"`, m.uf, `"${m.combustivel}"`, String(m.volTotal.toFixed(2)).replace('.', ','), String(pBomb.toFixed(3)).replace('.', ','), String(pNeg.toFixed(3)).replace('.', ','), String(pPag.toFixed(3)).replace('.', ','), String((pBomb-pPag).toFixed(3)).replace('.', ','), String(m.custoBombaProj.toFixed(2)).replace('.', ','), String(m.valorPagoTotal.toFixed(2)).replace('.', ','), String((m.custoBombaProj - m.valorPagoTotal).toFixed(2)).replace('.', ','), String(m.glosaTotal.toFixed(2)).replace('.', ',') ].join(';'));
    });
    const blob = new Blob(["\uFEFF" + linhas.join("\n")], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.setAttribute("href", URL.createObjectURL(blob));
    link.setAttribute("download", `Analise_Tripla_Precos_CavalheiroLog.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
};