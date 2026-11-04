// ============================================================================
// MÓDULO DE GRÁFICOS (CHART.JS), SIMULADOR WHAT-IF E MAPA GEORREFERENCIADO
// ============================================================================

window.atualizarSimuladorAbc = function() {
    const desc = parseFloat(document.getElementById('inpSimuladorDesconto')?.value) || 0;
    const volClasseA = todosPostos.filter(p => p.abc === 'A').reduce((acc, p) => acc + p.volume, 0);
    const econSimulada = volClasseA * desc;
    const lbl = document.getElementById('lblResultadoSimulador');
    if (lbl) {
        lbl.textContent = `R$ ${fmt(econSimulada)} (sobre ${fmt(volClasseA, 0)} L Classe A)`;
    }
};

function criarConfigGraficoDinamico(formatoSelecionado, labels, valores, corPrincipal, labelSerie = 'Litros') {
    const paletteMulti = [corPrincipal, '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#ef4444'];
    let type = formatoSelecionado;
    let indexAxis = 'x';
    let fill = false;

    if (formatoSelecionado === 'horizontalBar') {
        type = 'bar';
        indexAxis = 'y';
    } else if (formatoSelecionado === 'area') {
        type = 'line';
        fill = true;
    }

    const isCircular = ['pie', 'doughnut', 'polarArea', 'radar'].includes(type);
    return {
        type,
        data: {
            labels,
            datasets: [{
                label: labelSerie,
                data: valores,
                backgroundColor: isCircular ? paletteMulti : (fill ? corPrincipal + '33' : corPrincipal),
                borderColor: corPrincipal,
                borderWidth: isCircular ? 1 : 2,
                fill,
                tension: 0.3,
                borderRadius: type === 'bar' ? 4 : 0
            }]
        },
        options: {
            indexAxis,
            maintainAspectRatio: false,
            plugins: { legend: { display: isCircular, position: 'right' } }
        }
    };
}

window.renderTabContent = function() {
    const activeTab = document.querySelector('.nav-tab.active')?.dataset.tab;
    if (!activeTab) return;

    const kpiGridAnalise = document.getElementById('kpiGrid');
    if (activeTab === 'tab-integration') {
        if (kpiGridAnalise) kpiGridAnalise.style.display = 'none';
        if (typeof filtrarTabelaAuditoriaLocal === 'function') filtrarTabelaAuditoriaLocal();
        return;
    } else {
        if (kpiGridAnalise) kpiGridAnalise.style.display = 'grid';
    }

    const color = configSistema.corPrimaria || '#3b82f6';
    const tooltipAbc = { callbacks: { title: function(ctx) { return todosPostos[ctx[0].dataIndex]?.posto || ''; } } };

    // ABA 1: VISÃO GERAL + REDES + UF
    if (activeTab === 'tab-overview') {
        Chart.getChart('cTopVol')?.destroy(); Chart.getChart('cTopEco')?.destroy(); Chart.getChart('cClassABC')?.destroy();
        const top10 = todosPostos.slice(0, 10);
        const cfgVol = criarConfigGraficoDinamico(
            configSistema.formatoGraficoTop10 || 'bar',
            top10.map(p => limparNomePosto(p.posto)),
            top10.map(p => p.volume),
            color,
            'Volume (L)'
        );
        const canvasTopVol = document.getElementById('cTopVol');
        if (canvasTopVol) new Chart(canvasTopVol, cfgVol);

        const topS = [...todosPostos].sort((a, b) => b.economia - a.economia).slice(0, 10);
        const canvasTopEco = document.getElementById('cTopEco');
        if (canvasTopEco) {
            new Chart(canvasTopEco, {
                type: 'bar',
                data: { labels: topS.map(p => limparNomePosto(p.posto)), datasets: [{ label: 'Economia Real (R$)', data: topS.map(p => p.economia), backgroundColor: topS.map(p => p.economia >= 0 ? '#10b981' : '#ef4444'), borderRadius: 4 }] },
                options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
        }

        const tipoAbcChart = configSistema.formatoGraficoAbc || 'doughnut';
        const canvasClassABC = document.getElementById('cClassABC');
        if (canvasClassABC) {
            new Chart(canvasClassABC, {
                type: tipoAbcChart,
                data: {
                    labels: ['Classe A (80% Vol)', 'Classe B (15% Vol)', 'Classe C (5% Vol)'],
                    datasets: [{ label: 'Qtd. Postos', data: [todosPostos.filter(p => p.abc === 'A').length, todosPostos.filter(p => p.abc === 'B').length, todosPostos.filter(p => p.abc === 'C').length], backgroundColor: ['#10b981', '#f59e0b', '#ef4444'] }]
                },
                options: { maintainAspectRatio: false }
            });
        }

        const tbRedes = document.getElementById('tbResumoRedes');
        const listaRedes = rankingsBackend.porRede || [];
        if (tbRedes) {
            tbRedes.innerHTML = listaRedes.map(r => `
                <tr>
                    <td><b>${r.rede}</b></td>
                    <td class="text-center">${r.qtdPostos}</td>
                    <td class="text-right"><b>${fmt(r.volumeTotal)} L</b></td>
                    <td class="text-right">${fmt(r.participacaoPct, 1)}%</td>
                    <td class="text-right">R$ ${fmt(r.precoMedio, 3)}</td>
                    <td class="text-right"><b>R$ ${fmt(r.custoTotal)}</b></td>
                    <td class="text-right" style="color:${r.economiaReal>=0?'var(--success)':'var(--danger)'}; font-weight:800;">R$ ${fmt(r.economiaReal)}</td>
                </tr>
            `).join('') || `<tr><td colspan="7" class="text-center">Sem dados no período.</td></tr>`;
        }

        const tbUfs = document.getElementById('tbResumoUFs');
        const listaUfs = rankingsBackend.porUF || [];
        if (tbUfs) {
            tbUfs.innerHTML = listaUfs.map(u => `
                <tr>
                    <td><span class="badge blue">${u.uf}</span></td>
                    <td class="text-right">${fmt(u.volumeDiesel)} L</td>
                    <td class="text-right">${fmt(u.volumeArla)} L</td>
                    <td class="text-right">R$ ${fmt(u.precoMedio, 3)}</td>
                    <td class="text-right"><b>R$ ${fmt(u.custoTotal)}</b></td>
                    <td class="text-right">${fmt(u.aliquotaIcmsPct, 1)}%</td>
                    <td class="text-right" style="color:var(--success); font-weight:800;">R$ ${fmt(u.creditoIcmsEstimado)}</td>
                </tr>
            `).join('') || `<tr><td colspan="7" class="text-center">Sem dados no período.</td></tr>`;
        }
    }

    // ABA 2: EVOLUÇÃO & SAZONALIDADE
    if (activeTab === 'tab-temporal') {
        Chart.getChart('cEvoDual')?.destroy();
        Chart.getChart('cDiaSemana')?.destroy();
        Chart.getChart('cMixCombustivel')?.destroy();

        const evoMap = new Map();
        const diasSemanaVol = [0, 0, 0, 0, 0, 0, 0];
        const mixCombMap = new Map();
        const isMensal = document.getElementById('tipoPeriodoSelect')?.value === 'mensal';
        
        transacoesAnaliseFiltradas.forEach(t => {
            let d = t.data ? t.data.split(' ')[0] : '2026-01-01';
            const dtObj = new Date(d + 'T12:00:00Z');
            if (!isNaN(dtObj)) diasSemanaVol[dtObj.getUTCDay()] += (t.volume || 0);

            const subComb = t.subtipo_combustivel || (String(t.combustivel).toUpperCase().includes('ARLA') ? 'Arla 32' : 'Diesel S10');
            mixCombMap.set(subComb, (mixCombMap.get(subComb) || 0) + (t.volume || 0));

            if (isMensal) d = d.substring(0, 7);
            if (!evoMap.has(d)) evoMap.set(d, { vol: 0, custo: 0, volTab: 0, custoTab: 0 });
            const item = evoMap.get(d);
            item.vol += t.volume;
            item.custo += t.valor_total;
            if (t.preco_tabela > 0) {
                item.volTab += t.volume;
                item.custoTab += (t.volume * t.preco_tabela);
            }
        });
        const dKeys = Array.from(evoMap.keys()).sort();
        
        const datasets = [
            { type: 'bar', label: 'Volume Abastecido (L)', data: dKeys.map(k => evoMap.get(k).vol), backgroundColor: color, yAxisID: 'y', order: 3, borderRadius: 4 },
            { type: 'line', label: 'Preço Médio Pago (R$/L)', data: dKeys.map(k => evoMap.get(k).custo / evoMap.get(k).vol), borderColor: '#ff4500', backgroundColor: '#ff4500', borderWidth: 3, pointRadius: 4, yAxisID: 'y1', order: 1 }
        ];

        if (dKeys.some(k => evoMap.get(k).volTab > 0)) {
            datasets.push({
                type: 'line', label: 'Preço Médio Negociado (R$/L)',
                data: dKeys.map(k => evoMap.get(k).volTab > 0 ? evoMap.get(k).custoTab / evoMap.get(k).volTab : null),
                borderColor: '#10b981', backgroundColor: '#10b981', borderDash: [5, 5], borderWidth: 2, pointRadius: 3, yAxisID: 'y1', order: 2
            });
        }

        const canvasEvo = document.getElementById('cEvoDual');
        if (canvasEvo) {
            new Chart(canvasEvo, { 
                type: 'line', 
                data: { labels: dKeys.map(d => d.split('-').reverse().join('/')), datasets }, 
                options: { 
                    maintainAspectRatio: false, plugins: { legend: { position: 'top' } },
                    scales: { 
                        y: { type: 'linear', position: 'left', title: { display: true, text: 'Volume (L)' } }, 
                        y1: { type: 'linear', position: 'right', title: { display: true, text: 'R$ / Litro' }, grid: { drawOnChartArea: false } } 
                    } 
                }
            });
        }

        const canvasSemana = document.getElementById('cDiaSemana');
        if (canvasSemana) {
            new Chart(canvasSemana, {
                type: 'bar',
                data: {
                    labels: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'],
                    datasets: [{ label: 'Volume (L)', data: diasSemanaVol, backgroundColor: '#f59e0b', borderRadius: 4 }]
                },
                options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
        }

        const mixKeys = Array.from(mixCombMap.keys());
        const canvasMix = document.getElementById('cMixCombustivel');
        if (canvasMix) {
            new Chart(canvasMix, {
                type: 'doughnut',
                data: {
                    labels: mixKeys,
                    datasets: [{ data: mixKeys.map(k => mixCombMap.get(k)), backgroundColor: ['#f59e0b', '#3b82f6', '#10b981', '#38bdf8'] }]
                },
                options: { maintainAspectRatio: false }
            });
        }
    }

    // ABA 3: RANKING ABC
    if (activeTab === 'tab-abc') {
        atualizarSimuladorAbc();
        Chart.getChart('cAbcBar')?.destroy();
        const canvasAbc = document.getElementById('cAbcBar');
        if (canvasAbc) {
            new Chart(canvasAbc, {
                type: 'bar',
                data: { labels: todosPostos.slice(0, 30).map((_, i) => i + 1), datasets: [{ label: 'Volume (L)', data: todosPostos.slice(0, 30).map(p => p.volume), backgroundColor: todosPostos.slice(0, 30).map(p => p.abc === 'A' ? '#10b981' : (p.abc === 'B' ? '#f59e0b' : '#ef4444')), borderRadius: 4 }] },
                options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: tooltipAbc } }
            });
        }
        
        const tb = document.getElementById('tbPostos');
        if (tb) {
            tb.innerHTML = todosPostos.map((p, i) => `
                <tr>
                    <td><b>#${i+1}</b></td>
                    <td><b>${p.posto}</b></td>
                    <td><span class="badge blue">${p.rede}</span></td>
                    <td>${p.cidade}/${p.uf}</td>
                    <td class="text-right" style="color:#f59e0b; font-weight:700;">${fmt(p.volumeDiesel)} L</td>
                    <td class="text-right" style="color:#38bdf8; font-weight:700;">${fmt(p.volumeArla)} L</td>
                    <td class="text-right"><b>${fmt(p.volume)} L</b></td>
                    <td class="text-right">R$ ${fmt(p.precoMedio, 3)}</td>
                    <td class="text-right"><b>R$ ${fmt(p.custo)}</b></td>
                    <td class="text-right" style="color:${p.economia>=0?'var(--success)':'var(--danger)'}; font-weight:800;">R$ ${fmt(p.economia)}</td>
                    <td class="text-center"><span class="badge ${p.abc==='A'?'green':(p.abc==='B'?'warning':'red')}">${p.abc}</span></td>
                </tr>
            `).join('');
        }
    }

    // ABA 4: FROTA
    if (activeTab === 'tab-frota') {
        const alertas = rankingsBackend.alertasOperacionais || [];
        const countEl = document.getElementById('countAlertasFrota');
        if (countEl) countEl.textContent = alertas.length;
        const tbAlertas = document.getElementById('tbAlertasFrota');
        if (tbAlertas) {
            if (alertas.length === 0) {
                tbAlertas.innerHTML = `<tr><td colspan="6" class="text-center" style="padding:18px; color:var(--success); font-weight:bold;">✅ Nenhuma anomalia operacional detectada.</td></tr>`;
            } else {
                tbAlertas.innerHTML = alertas.map(a => `
                    <tr>
                        <td><b>${(a.data || '').split(' ')[0].split('-').reverse().join('/')}</b></td>
                        <td><b>#${a.idTransacao}</b></td>
                        <td><span class="badge ${a.severidade==='danger'?'red':'warning'}">${a.tipo}</span></td>
                        <td><b>${a.placa}</b><br><small>${a.motorista}</small></td>
                        <td>${a.estabelecimento}</td>
                        <td>${a.detalhe}</td>
                    </tr>
                `).join('');
            }
        }

        const metaKml = configSistema.metaKmPorLitro || 2.65;
        const tbPlacas = document.getElementById('tbRankingPlacas');
        if (tbPlacas) {
            tbPlacas.innerHTML = (rankingsBackend.porPlaca || []).map(pl => {
                const corMedia = pl.kmPorLitro === 0 ? 'var(--text-muted)' : (pl.kmPorLitro >= metaKml ? 'var(--success)' : 'var(--danger)');
                return `
                    <tr>
                        <td><span class="badge blue">🚛 ${pl.placa}</span></td>
                        <td><small><b>${pl.motoristaPrincipal}</b></small></td>
                        <td class="text-right"><b>${fmt(pl.volumeDiesel)} L</b></td>
                        <td class="text-right">${fmt(pl.proporcaoArlaPct, 1)}%</td>
                        <td class="text-right">${pl.kmRodado > 0 ? fmt(pl.kmRodado, 0) + ' km' : '—'}</td>
                        <td class="text-right" style="color:${corMedia}; font-weight:800;">${pl.kmPorLitro > 0 ? fmt(pl.kmPorLitro) + ' Km/L' : '—'}</td>
                        <td class="text-right">${pl.custoPorKm > 0 ? 'R$ ' + fmt(pl.custoPorKm) : '—'}</td>
                        <td class="text-right"><b>R$ ${fmt(pl.custoTotal)}</b></td>
                    </tr>
                `;
            }).join('') || `<tr><td colspan="8" class="text-center">Sem dados.</td></tr>`;
        }

        const tbMot = document.getElementById('tbRankingMotoristas');
        if (tbMot) {
            tbMot.innerHTML = (rankingsBackend.porMotorista || []).map(m => {
                const corMedia = m.kmPorLitro === 0 ? 'var(--text-muted)' : (m.kmPorLitro >= metaKml ? 'var(--success)' : 'var(--danger)');
                return `
                    <tr>
                        <td><b>${m.motorista}</b></td>
                        <td><small>${m.placas}</small></td>
                        <td class="text-right"><b>${fmt(m.volumeTotal)} L</b></td>
                        <td class="text-right">R$ ${fmt(m.precoMedio, 3)}</td>
                        <td class="text-right">${m.kmRodado > 0 ? fmt(m.kmRodado, 0) + ' km' : '—'}</td>
                        <td class="text-right" style="color:${corMedia}; font-weight:800;">${m.kmPorLitro > 0 ? fmt(m.kmPorLitro) + ' Km/L' : '—'}</td>
                        <td class="text-right" style="color:${m.economiaReal>=0?'var(--success)':'var(--danger)'}; font-weight:800;">R$ ${fmt(m.economiaReal)}</td>
                    </tr>
                `;
            }).join('') || `<tr><td colspan="7" class="text-center">Sem dados.</td></tr>`;
        }
    }

    // ABA 5: PREÇOS
    if (activeTab === 'tab-precos') {
        const volTotalPeriodo = todosPostos.reduce((s, p) => s + p.volume, 0);
        const volAuditado = todosPostos.reduce((s, p) => s + p.volComTabela, 0);
        const custoTabelaTotal = todosPostos.reduce((s, p) => s + p.custoTabela, 0);
        const custoPagoAuditado = todosPostos.filter(p => p.volComTabela > 0).reduce((s, p) => s + p.custo, 0);
        const econLiquida = todosPostos.reduce((s, p) => s + p.economia, 0);
        const glosaTotal = todosPostos.filter(p => p.economia < 0).reduce((s, p) => s + Math.abs(p.economia), 0);
        const ganhoMedioLitro = volAuditado > 0 ? econLiquida / volAuditado : 0;

        const kpiBar = document.getElementById('precosKpiBar');
        if (kpiBar) {
            kpiBar.innerHTML = `
                <div class="audit-kpi-mini" style="border-left-color:var(--info)">
                    <div class="lbl"><span>📦 Volume Auditado</span></div>
                    <div class="val">${fmt(volAuditado)} L</div>
                    <div class="sub">${volTotalPeriodo > 0 ? fmt((volAuditado/volTotalPeriodo)*100, 1) : 0}% do total</div>
                </div>
                <div class="audit-kpi-mini" style="border-left-color:#8b5cf6">
                    <div class="lbl"><span>🏷️ Custo Tabela</span></div>
                    <div class="val">R$ ${fmt(custoTabelaTotal)}</div>
                    <div class="sub">Pago: R$ ${fmt(custoPagoAuditado)}</div>
                </div>
                <div class="audit-kpi-mini" style="border-left-color:var(--success)">
                    <div class="lbl"><span>💰 Economia Líquida</span></div>
                    <div class="val" style="color:var(--success)">R$ ${fmt(econLiquida)}</div>
                    <div class="sub">${ganhoMedioLitro>=0?'+':''}R$ ${fmt(ganhoMedioLitro, 3)}/L</div>
                </div>
                <div class="audit-kpi-mini" style="border-left-color:var(--danger)">
                    <div class="lbl"><span>🚨 Glosa Acima Acordo</span></div>
                    <div class="val" style="color:var(--danger)">R$ ${fmt(glosaTotal)}</div>
                    <div class="sub">Reembolso Passível</div>
                </div>
            `;
        }

        const tb = document.getElementById('tbPrecos');
        const mostrarTodos = document.getElementById('chkMostrarTodosPostosPreco')?.checked;
        const postosPreco = mostrarTodos ? todosPostos : todosPostos.filter(p => p.volComTabela > 0);

        if (tb) {
            tb.innerHTML = postosPreco.map((p, i) => {
                const temTabela = p.volComTabela > 0;
                const econLitro = temTabela ? p.economiaPorLitro : 0; 
                const econReal = p.economia;
                const postoEscapado = p.posto.replace(/'/g, "\\'");
                
                let statusHtml = '';
                if (!temTabela) {
                    statusHtml = `<button class="btn-sync" style="padding:4px 9px; font-size:11px; color:var(--brand-orange);" onclick="definirPrecoRapidoPosto('${postoEscapado}', ${p.precoMedio})">✏️ Definir Acordo</button>`;
                } else if (econLitro < -0.01) {
                    statusHtml = `<span class="badge red">🔴 Glosa</span> <button class="btn-sync" style="padding:3px 6px;" onclick="definirPrecoRapidoPosto('${postoEscapado}', ${p.precoTabelaMedio})">✏️</button>`;
                } else {
                    statusHtml = `<span class="badge green">🟢 No Acordo</span> <button class="btn-sync" style="padding:3px 6px;" onclick="definirPrecoRapidoPosto('${postoEscapado}', ${p.precoTabelaMedio})">✏️</button>`;
                }

                return `<tr>
                    <td><b>#${i+1}</b></td>
                    <td><b>${p.posto}</b><br><small style="color:var(--text-muted)">${p.rede} • ${p.cidade}/${p.uf}</small></td>
                    <td class="text-right">${fmt(p.volume)} L</td>
                    <td class="text-right">${temTabela ? fmt(p.volComTabela) + ' L' : '0 L'}</td>
                    <td class="text-right" style="color:var(--text-muted);">${temTabela ? 'R$ ' + fmt(p.precoBombaMedio, 3) : '—'}</td>
                    <td class="text-right" style="font-weight:800; color:var(--info);">${temTabela ? 'R$ ' + fmt(p.precoTabelaMedio, 3) : '—'}</td>
                    <td class="text-right"><b>R$ ${fmt(p.precoMedio, 3)}</b></td>
                    <td class="text-right" style="color:${econLitro>=0?'var(--success)':'var(--danger)'}; font-weight:bold;">${temTabela ? (econLitro>=0?'+':'') + 'R$ ' + fmt(econLitro, 3) : '—'}</td>
                    <td class="text-right" style="color:${econReal>=0?'var(--success)':'var(--danger)'}; font-weight:800;">${temTabela ? 'R$ ' + fmt(econReal) : 'R$ 0,00'}</td>
                    <td class="text-center">${statusHtml}</td>
                </tr>`;
            }).join('');
        }
    }

    // ABA 6: MAPA & HEATMAP
    if (activeTab === 'tab-heatmap') {
        if (!mapInstance) {
            mapInstance = L.map('heatmapMap', { zoomControl: false }).setView([-15.6, -54.0], 5);
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapInstance);
            L.control.zoom({ position: 'topright' }).addTo(mapInstance);
        }
        
        if (heatLayer) mapInstance.removeLayer(heatLayer);
        if (markersLayer) mapInstance.removeLayer(markersLayer);
        
        const pts = []; markersLayer = L.layerGroup();
        const termoBusca = document.getElementById('mapSearch')?.value.toUpperCase() || '';
        const colorMode = document.getElementById('mapColorMode')?.value || 'abc';
        const raioHeat = parseInt(document.getElementById('rngRaioHeat')?.value || '28', 10);
        const showA = document.getElementById('checkClasseA')?.checked ?? true;
        const showB = document.getElementById('checkClasseB')?.checked ?? true;
        const showC = document.getElementById('checkClasseC')?.checked ?? true;

        const maxVolPosto = todosPostos.length > 0 ? Math.max(...todosPostos.map(x => x.volume), 1) : 1;

        todosPostos.forEach(p => {
            if (termoBusca && !p.posto.toUpperCase().includes(termoBusca) && !p.cidade.toUpperCase().includes(termoBusca) && !p.uf.toUpperCase().includes(termoBusca)) return;
            if (p.abc === 'A' && !showA) return;
            if (p.abc === 'B' && !showB) return;
            if (p.abc === 'C' && !showC) return;

            const coord = obterCoordenadaSeguraFrontend(p);
            const pesoCalor = Math.min(1.0, Math.max(0.25, Math.sqrt(p.volume / maxVolPosto)));
            pts.push([coord.lat, coord.lng, pesoCalor]);

            let corPino = p.abc === 'A' ? '#10b981' : (p.abc === 'B' ? '#f59e0b' : '#ef4444');
            if (colorMode === 'preco') {
                corPino = p.precoMedio <= 6.75 ? '#10b981' : (p.precoMedio <= 7.05 ? '#f59e0b' : '#ef4444');
            } else if (colorMode === 'economia') {
                corPino = p.economia > 0 ? '#10b981' : (p.economia < 0 ? '#ef4444' : '#3b82f6');
            }

            const iconeSvg = L.divIcon({
                className: '',
                html: `<svg width="24" height="32" viewBox="0 0 24 32"><path d="M12 0C5.372 0 0 5.372 0 12C0 21 12 32 12 32C12 32 24 21 24 12C24 5.372 18.627 0 12 0Z" fill="${corPino}" stroke="#0f172a" stroke-width="1.5"/><circle cx="12" cy="12" r="5" fill="#FFF"/></svg>`,
                iconSize: [24, 32], iconAnchor: [12, 32]
            });

            L.marker([coord.lat, coord.lng], { icon: iconeSvg }).bindPopup(`
                <div style="font-size:12.5px; line-height:1.45;">
                    <b style="font-size:13.5px;">${p.posto}</b><br>
                    <span style="color:#64748b; font-weight:700;">${p.rede} • 📍 ${p.cidade}/${p.uf}</span><hr style="margin:6px 0; border-color:#e2e8f0;">
                    ⛽ Diesel: <b>${fmt(p.volumeDiesel)} L</b> | 💧 Arla: <b>${fmt(p.volumeArla)} L</b><br>
                    💲 Preço Pago: <b>R$ ${fmt(p.precoMedio, 3)}/L</b><br>
                    💰 Econ. Real: <b style="color:${p.economia>=0?'#10b981':'#ef4444'}">R$ ${fmt(p.economia)}</b> | ABC: <b>${p.abc}</b>
                </div>
            `).addTo(markersLayer);
        });
        
        heatLayer = L.heatLayer(pts, {
            radius: raioHeat,
            blur: Math.round(raioHeat * 0.65),
            maxZoom: 11,
            minOpacity: 0.35,
            gradient: { 0.25: '#3b82f6', 0.5: '#06b6d4', 0.7: '#10b981', 0.88: '#f59e0b', 1.0: '#ef4444' }
        });
        if (document.getElementById('toggleHeatmapCheck')?.checked) heatLayer.addTo(mapInstance);
        markersLayer.addTo(mapInstance);
        
        if (pts.length === 1) mapInstance.setView([pts[0][0], pts[0][1]], 11);
        else if (pts.length > 1) mapInstance.fitBounds(pts.map(p => [p[0], p[1]]), { padding: [45, 45] });

        setTimeout(() => { mapInstance.invalidateSize(); }, 350);
    }
};

window.toggleFiltroMapa = function() {
    const panel = document.getElementById('mapFloatingPanel');
    const btn = document.getElementById('btnCollapseMap');
    if (!panel || !btn) return;
    panel.classList.toggle('retraido');
    btn.innerHTML = panel.classList.contains('retraido') ? '▼ Expandir' : '▲ Retrair';
};

window.limparFiltrosMapa = function() {
    if (document.getElementById('mapSearch')) document.getElementById('mapSearch').value = '';
    if (document.getElementById('checkClasseA')) document.getElementById('checkClasseA').checked = true;
    if (document.getElementById('checkClasseB')) document.getElementById('checkClasseB').checked = true;
    if (document.getElementById('checkClasseC')) document.getElementById('checkClasseC').checked = true;
    if (document.getElementById('toggleHeatmapCheck')) document.getElementById('toggleHeatmapCheck').checked = true;
    if (document.getElementById('mapColorMode')) document.getElementById('mapColorMode').value = 'abc';
    renderTabContent();
    showToast('Filtros do mapa restaurados.', 'success');
};