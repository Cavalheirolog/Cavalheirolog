// ============================================================================
// FUNÇÕES AUXILIARES GLOBAIS (Garante que formatações não falham)
// ============================================================================
window.fmt = function(val, dec = 2) {
    return Number(val || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
};

window.classificarBombaFrontend = function(estab, tipoOriginal) {
    const t = String(tipoOriginal || '').toUpperCase();
    const e = String(estab || '').toUpperCase();
    if (t === 'INTERNO' || e.includes('INTERNA') || e.includes('GARAGEM')) return 'Interno';
    return 'Externo';
};

window.limparNomePosto = function(nome) {
    return String(nome || '').replace(/\|.*/, '').replace(/-.*/, '').trim();
};

window.obterCoordenadaSeguraFrontend = function(posto) {
    if (posto.lat && posto.lng) return { lat: posto.lat, lng: posto.lng };
    return { lat: -15.6 + (Math.random() * 2 - 1), lng: -54.0 + (Math.random() * 2 - 1) }; // Fallback
};

// ============================================================================
// PONTO DE ENTRADA DO FRONTEND (INICIALIZAÇÃO E EVENT LISTENERS)
// ============================================================================

window.toggleSidebar = function() {
    const sidebar = document.getElementById('sidebar'); 
    const overlay = document.getElementById('mobileOverlay');
    if (!sidebar || !overlay) return;

    if (window.innerWidth <= 768) {
        sidebar.classList.toggle('mobile-open'); 
        overlay.classList.toggle('active');
    } else {
        const btnOpen = document.getElementById('btnOpenSidebar');
        sidebar.classList.toggle('collapsed');
        if (btnOpen) btnOpen.style.display = sidebar.classList.contains('collapsed') ? 'block' : 'none';
        setTimeout(() => { 
            Object.values(Chart.instances).forEach(c => c.resize()); 
            if (typeof mapInstance !== 'undefined' && mapInstance) mapInstance.invalidateSize(); 
        }, 350);
    }
};

function preencherAnos() {
    const a = new Date().getFullYear();
    const s = document.getElementById('selAno');
    if (!s) return;
    s.innerHTML = '';
    [a, a-1, a-2, a-3].forEach(v => s.innerHTML += `<option value="${v}">${v}</option>`);
}

window.alternarCamposPeriodo = function() {
    const val = document.getElementById('tipoPeriodoSelect')?.value;
    const boxDiario = document.getElementById('boxDiario');
    const boxMensal = document.getElementById('boxMensal');
    if (boxDiario) boxDiario.style.display = val === 'diario' ? 'block' : 'none';
    if (boxMensal) boxMensal.style.display = val === 'mensal' ? 'block' : 'none';
};

function getDatasFiltroAnalise() {
    const tipo = document.getElementById('tipoPeriodoSelect')?.value || 'diario';
    let dtIni, dtFim;
    if (tipo === 'diario') {
        dtIni = document.getElementById('dataInicio')?.value || '';
        dtFim = document.getElementById('dataFim')?.value || '';
        if (dtIni && dtFim && dtIni > dtFim) {
            const temp = dtIni; dtIni = dtFim; dtFim = temp;
            if (document.getElementById('dataInicio')) document.getElementById('dataInicio').value = dtIni; 
            if (document.getElementById('dataFim')) document.getElementById('dataFim').value = dtFim;
        }
    } else {
        const ano = document.getElementById('selAno')?.value || new Date().getFullYear(); 
        const mes = document.getElementById('selMes')?.value || '01';
        const ultimoDia = new Date(ano, parseInt(mes), 0).getDate();
        dtIni = `${ano}-${mes}-01`; 
        dtFim = `${ano}-${mes}-${String(ultimoDia).padStart(2,'0')}`;
    }
    return { dtIni, dtFim };
}

function atualizarSelectsDinamicosSidebar() {
    const selRede = document.getElementById('filtroRedeAnalise');
    const selUf = document.getElementById('filtroUfAnalise');
    if (!selRede || !selUf || typeof transacoesAnaliseGlobal === 'undefined') return;

    const valRedeAtual = selRede.value;
    const valUfAtual = selUf.value;

    const redes = Array.from(new Set(transacoesAnaliseGlobal.map(t => t.rede_posto).filter(Boolean))).sort();
    const ufs = Array.from(new Set(transacoesAnaliseGlobal.map(t => t.uf).filter(u => u && u !== 'ND'))).sort();

    selRede.innerHTML = `<option value="todos">Todas as Redes (${redes.length})</option>` + redes.map(r => `<option value="${r}">${r}</option>`).join('');
    selUf.innerHTML = `<option value="todos">Todos os Estados (${ufs.length})</option>` + ufs.map(u => `<option value="${u}">${u}</option>`).join('');

    if (redes.includes(valRedeAtual)) selRede.value = valRedeAtual;
    if (ufs.includes(valUfAtual)) selUf.value = valUfAtual;
}

window.processarDadosAnalise = function() {
    if (typeof transacoesAnaliseGlobal === 'undefined') return;

    const tipoAbast = document.getElementById('filtroTipoAbast')?.value || 'todos';
    const filtroComb = document.getElementById('filtroCombustivelAnalise')?.value || 'todos';
    const filtroRede = document.getElementById('filtroRedeAnalise')?.value || 'todos';
    const filtroUf = document.getElementById('filtroUfAnalise')?.value || 'todos';
    const buscaPlacaMot = document.getElementById('filtroPlacaMotoristaAnalise')?.value.toLowerCase().trim() || '';

    transacoesAnaliseFiltradas = transacoesAnaliseGlobal.filter(t => {
        const tipoTr = String(t.tipo_transacao || 'COMPRA').toUpperCase();
        const statusTr = String(t.status_transacao || 'APROVADA').toUpperCase();
        const servicoTr = String(t.servico || 'ABASTECIMENTO').toUpperCase();
        const idEstornada = String(t.id_transacao_estornada || '').trim();

        // BLINDAGEM FRONTAL: Assegura 100% de fiabilidade aos dados líquidos da TruckPag
        if (!['COMPRA', 'MANUAL'].includes(tipoTr) || statusTr !== 'APROVADA') return false;
        if (servicoTr.includes('MANUTENCAO') || servicoTr.includes('ESTORNO') || Number(t.volume) <= 0) return false;
        if (idEstornada !== '' && idEstornada !== '0') return false;

        t.tipoAbastecimento = classificarBombaFrontend(t.estabelecimento, t.tipoAbastecimento);
        if (tipoAbast !== 'todos' && t.tipoAbastecimento.toUpperCase() !== tipoAbast.toUpperCase()) return false;

        if (filtroComb !== 'todos') {
            const combUp = String(t.combustivel || '').toUpperCase();
            const isArla = combUp.includes('ARLA');
            if (filtroComb === 'ARLA' && !isArla) return false;
            if (filtroComb === 'DIESEL' && isArla) return false;
            if (filtroComb === 'S10' && !combUp.includes('S10')) return false;
            if (filtroComb === 'S500' && !combUp.includes('S500')) return false;
        }

        if (filtroRede !== 'todos' && t.rede_posto !== filtroRede) return false;
        if (filtroUf !== 'todos' && t.uf !== filtroUf) return false;

        if (buscaPlacaMot) {
            const alvo = `${t.placa || ''} ${t.motorista || ''} ${t.estabelecimento || ''}`.toLowerCase();
            if (!alvo.includes(buscaPlacaMot)) return false;
        }
        return true;
    });

    const statusBox = document.getElementById('statusMsg');
    if (statusBox) {
        if (transacoesAnaliseFiltradas.length > 0) {
            statusBox.innerHTML = `✅ ${transacoesAnaliseFiltradas.length} Abastecimentos Válidos`;
            statusBox.className = 'status-msg success';
        } else {
            statusBox.innerHTML = '⚠️ Sem Abastecimentos no Filtro';
            statusBox.className = 'status-msg warning';
        }
    }

    const map = new Map();
    let volMlT = 0, cusCentsT = 0, ecoCentsT = 0;
    let volDieselMl = 0, volS10Ml = 0, volS500Ml = 0, cusDieselCents = 0, ecoDieselCents = 0, volTabDieselMl = 0, cusTabDieselCents = 0, qtdDiesel = 0;
    let volArlaMl = 0, cusArlaCents = 0, ecoArlaCents = 0, volTabArlaMl = 0, cusTabArlaCents = 0, qtdArla = 0;
    let minDiesel = Infinity, maxDiesel = 0;
    let kmTotal = 0, litrosComHod = 0;
    const placasSet = new Set();

    transacoesAnaliseFiltradas.forEach(t => {
        const key = t.estabelecimento || 'POSTO ND';
        if (!map.has(key)) {
            map.set(key, {
                posto: key, rede: t.rede_posto || 'OUTROS', cidade: t.cidade||'ND', uf: t.uf||'ND', cnpj_posto: t.cnpj_posto,
                lat: t.lat || null, lng: t.lng || null,
                volume: 0, volumeDiesel: 0, volumeArla: 0, custo: 0, economia: 0, custoTabela: 0, custoBombaRef: 0, volComTabela: 0
            });
        }
        const p = map.get(key);
        if (t.placa) placasSet.add(t.placa);
        
        const vol = parseFloat(t.volume) || 0;
        const val = parseFloat(t.valor_total) || 0;
        const vLitro = vol > 0 ? val / vol : (parseFloat(t.valor_litro) || 0);
        const precoTab = parseFloat(t.preco_tabela) || 0;
        const precoBomba = parseFloat(t.preco_bomba_referencia) > 0 ? parseFloat(t.preco_bomba_referencia) : (precoTab > 0 ? Math.max(precoTab, vLitro) : vLitro);
        const combUp = String(t.combustivel || '').toUpperCase();
        const isArla = combUp.includes('ARLA');

        // Matemática em Inteiros para evitar bugs de vírgula flutuante
        const vMl = Math.round(vol * 1000);
        const cCents = Math.round(val * 100);

        p.volume += vol;
        p.custo += val;
        if (isArla) p.volumeArla += vol; else p.volumeDiesel += vol;

        if (precoTab > 0) {
            const custoRefCents = Math.round(vol * precoTab * 100);
            const custoBombaCents = Math.round(vol * precoBomba * 100);
            const ecoCents = custoRefCents - cCents;
            p.custoTabela += (custoRefCents / 100);
            p.custoBombaRef += (custoBombaCents / 100);
            p.volComTabela += vol;
            p.economia += (ecoCents / 100);
            ecoCentsT += ecoCents;

            if (isArla) {
                volTabArlaMl += vMl; cusTabArlaCents += custoRefCents; ecoArlaCents += ecoCents;
            } else {
                volTabDieselMl += vMl; cusTabDieselCents += custoRefCents; ecoDieselCents += ecoCents;
            }
        }

        volMlT += vMl;
        cusCentsT += cCents;
        if (isArla) {
            volArlaMl += vMl; cusArlaCents += cCents; qtdArla++;
        } else {
            volDieselMl += vMl; cusDieselCents += cCents; qtdDiesel++;
            if (combUp.includes('S500')) volS500Ml += vMl; else volS10Ml += vMl;
            if (vLitro > 0) {
                if (vLitro < minDiesel) minDiesel = vLitro;
                if (vLitro > maxDiesel) maxDiesel = vLitro;
            }
            const km = parseFloat(t.km_rodado) || 0;
            if (km > 0) {
                kmTotal += km;
                litrosComHod += vol;
            }
        }
    });

    const volT = volMlT / 1000;
    const cusT = cusCentsT / 100;
    const ecoT = ecoCentsT / 100;
    const volDiesel = volDieselMl / 1000;
    const cusDiesel = cusDieselCents / 100;
    const ecoDiesel = ecoDieselCents / 100;
    const volArla = volArlaMl / 1000;
    const cusArla = cusArlaCents / 100;
    const ecoArla = ecoArlaCents / 100;

    window.todosPostos = Array.from(map.values()).sort((a, b) => b.volume - a.volume);
    let acum = 0;
    window.todosPostos.forEach(p => {
        p.precoMedio = p.volume > 0 ? p.custo / p.volume : 0;
        p.precoTabelaMedio = p.volComTabela > 0 ? p.custoTabela / p.volComTabela : 0;
        p.precoBombaMedio = p.volComTabela > 0 ? p.custoBombaRef / p.volComTabela : p.precoMedio;
        p.divergenciaLitro = p.precoTabelaMedio > 0 ? p.precoMedio - p.precoTabelaMedio : 0;
        p.economiaPorLitro = p.volComTabela > 0 ? p.economia / p.volComTabela : 0;
        
        acum += p.volume;
        p.percentualAcum = volT > 0 ? (acum / volT) * 100 : 0;
        if (window.todosPostos.length <= 2) { p.abc = 'A'; } 
        else { p.abc = p.percentualAcum <= 80 ? 'A' : (p.percentualAcum <= 95 ? 'B' : 'C'); }
    });

    if (typeof atualizarPopulaAutocompletePreco === 'function') atualizarPopulaAutocompletePreco();

    const pmDiesel = volDiesel > 0 ? cusDiesel / volDiesel : 0;
    const pmArla = volArla > 0 ? cusArla / volArla : 0;
    const pctDiesel = volT > 0 ? (volDiesel / volT) * 100 : 0;
    const pctArla = volT > 0 ? (volArla / volT) * 100 : 0;
    const propArlaSobreDiesel = volDiesel > 0 ? (volArla / volDiesel) * 100 : 0;
    const mediaKmlFrota = litrosComHod > 0 ? (kmTotal / litrosComHod) : 0;

    const volComTabTotal = (volTabDieselMl + volTabArlaMl) / 1000;
    const cusTabTotal = (cusTabDieselCents + cusTabArlaCents) / 100;
    const pctCoberturaTab = volT > 0 ? (volComTabTotal / volT) * 100 : 0;
    const ecoPorLitroMedio = volComTabTotal > 0 ? (ecoT / volComTabTotal) : 0;

    const corEco = ecoT > 0 ? '#10b981' : (ecoT < 0 ? '#ef4444' : '#f59e0b');
    const statusEcoTexto = volComTabTotal === 0
        ? '⚠️ Cadastre preços na aba "Preços Negociados"'
        : `${fmt(pctCoberturaTab, 1)}% auditado (Média: ${ecoPorLitroMedio>=0?'+':''}R$ ${fmt(ecoPorLitroMedio, 3)}/L)`;

    const configSistema = typeof window.configSistema !== 'undefined' ? window.configSistema : {};
    const cardsHtml = [];

    if (configSistema.exibirKpiPostos !== false) {
        cardsHtml.push(`
            <div class="kpi-card tooltip-container">
                <div>
                    <div class="label"><span>🏢 Postos & Operações ℹ️</span> <span>100% Líquido</span></div>
                    <div class="value">${window.todosPostos.length} <small style="font-size:13px; font-weight:600; color:var(--text-muted)">Postos (${qtdDiesel + qtdArla} Op.)</small></div>
                </div>
                <div class="fuel-breakdown">
                    <div class="fuel-pill">
                        <div class="fuel-pill-header diesel">⛽ Abast. Diesel</div>
                        <div class="fuel-pill-main">${qtdDiesel} Op.</div>
                        <div class="fuel-pill-sub"><span>S10:</span> <b>${fmt(volS10Ml/1000, 2)} L</b></div>
                    </div>
                    <div class="fuel-pill">
                        <div class="fuel-pill-header arla">💧 Abast. Arla 32</div>
                        <div class="fuel-pill-main">${qtdArla} Op.</div>
                        <div class="fuel-pill-sub"><span>Prop. Diesel:</span> <b>${fmt(propArlaSobreDiesel, 1)}%</b></div>
                    </div>
                </div>
                <div class="tooltip-box">
                    <b>🏢 Como este card é calculado:</b><br>
                    Contabiliza os estabelecimentos únicos e o total de transações líquidas aprovadas (<code>COMPRA</code> + <code>MANUAL</code>), expurgando estornos, recusas e serviços de manutenção.<br>
                    • <b>Diesel S10:</b> ${fmt(volS10Ml/1000, 2)} L | <b>S500:</b> ${fmt(volS500Ml/1000, 2)} L<br>
                    • <b>Proporção Arla/Diesel:</b> <code>${fmt(volArla, 2)} L ÷ ${fmt(volDiesel, 2)} L = ${fmt(propArlaSobreDiesel, 2)}%</code>
                </div>
            </div>
        `);
    }

    // AQUI: Forçado a exibição de 2 casas decimais no visual
    if (configSistema.exibirKpiVolume !== false) {
        cardsHtml.push(`
            <div class="kpi-card tooltip-container" style="border-left-color: #f59e0b;">
                <div>
                    <div class="label"><span>⛽ Volume Total Abastecido ℹ️</span> <span>Sem Estornos</span></div>
                    <div class="value">${fmt(volT, 2)} L</div>
                </div>
                <div class="fuel-breakdown">
                    <div class="fuel-pill">
                        <div class="fuel-pill-header diesel"><span>⛽ Diesel</span> <span>${fmt(pctDiesel, 1)}%</span></div>
                        <div class="fuel-pill-main">${fmt(volDiesel, 2)} L</div>
                        <div class="fuel-pill-sub"><span>Média:</span> <b>R$ ${fmt(pmDiesel, 3)}/L</b></div>
                    </div>
                    <div class="fuel-pill">
                        <div class="fuel-pill-header arla"><span>💧 Arla 32</span> <span>${fmt(pctArla, 1)}%</span></div>
                        <div class="fuel-pill-main">${fmt(volArla, 2)} L</div>
                        <div class="fuel-pill-sub"><span>Média:</span> <b>R$ ${fmt(pmArla, 3)}/L</b></div>
                    </div>
                </div>
                <div class="tooltip-box">
                    <b>⛽ Volumetria Consolidada Exata:</b><br>
                    Soma do combustível líquido abastecido no período (com precisão original em mililitros e visual em 2 casas):<br>
                    • <b>Diesel (${fmt(pctDiesel, 1)}%):</b> <code>${fmt(volDiesel, 2)} L</code> a R$ ${fmt(pmDiesel, 3)}/L<br>
                    • <b>Arla 32 (${fmt(pctArla, 1)}%):</b> <code>${fmt(volArla, 2)} L</code> a R$ ${fmt(pmArla, 3)}/L
                </div>
            </div>
        `);
    }

    if (configSistema.exibirKpiFaturamento !== false) {
        cardsHtml.push(`
            <div class="kpi-card tooltip-container" style="border-left-color: #10b981;">
                <div>
                    <div class="label"><span>💰 Faturamento Liquidado ℹ️</span> <span>Conciliado</span></div>
                    <div class="value">R$ ${fmt(cusT, 2)}</div>
                </div>
                <div class="fuel-breakdown">
                    <div class="fuel-pill">
                        <div class="fuel-pill-header diesel">⛽ Custo Diesel</div>
                        <div class="fuel-pill-main">R$ ${fmt(cusDiesel, 2)}</div>
                        <div class="fuel-pill-sub"><span>Faixa:</span> <b>R$ ${minDiesel===Infinity?'0,00':fmt(minDiesel)} - ${fmt(maxDiesel)}</b></div>
                    </div>
                    <div class="fuel-pill">
                        <div class="fuel-pill-header arla">💧 Custo Arla 32</div>
                        <div class="fuel-pill-main">R$ ${fmt(cusArla, 2)}</div>
                        <div class="fuel-pill-sub"><span>Ticket:</span> <b>R$ ${fmt(qtdArla > 0 ? cusArla/qtdArla : 0, 2)}</b></div>
                    </div>
                </div>
                <div class="tooltip-box">
                    <b>💰 Desembolso Financeiro Líquido:</b><br>
                    Soma em centavos exatos de todas as compras e lançamentos manuais aprovados:<br>
                    • <b>Ticket Médio Diesel:</b> <code>R$ ${fmt(qtdDiesel > 0 ? cusDiesel/qtdDiesel : 0, 2)}</code> por abastecimento<br>
                    • <b>Menor/Maior Preço Diesel:</b> R$ ${minDiesel===Infinity?'0,00':fmt(minDiesel, 3)}/L até R$ ${fmt(maxDiesel, 3)}/L
                </div>
            </div>
        `);
    }

    if (configSistema.exibirTelemetriaKmL !== false) {
        const metaKml = configSistema.metaKmPorLitro || 2.65;
        const corKml = mediaKmlFrota === 0 ? 'var(--text-muted)' : (mediaKmlFrota >= metaKml ? 'var(--success)' : 'var(--warning)');
        cardsHtml.push(`
            <div class="kpi-card tooltip-container" style="border-left-color: #8b5cf6;">
                <div>
                    <div class="label"><span>🚛 Telemetria & Consumo ℹ️</span> <span>Meta: ${fmt(metaKml)} Km/L</span></div>
                    <div class="value" style="color:${corKml}">${ fmt(mediaKmlFrota)} Km/L</div>
                </div>
                <div class="fuel-breakdown">
                    <div class="fuel-pill">
                        <div class="fuel-pill-header telemetria">🛣️ Distância Auditada</div>
                        <div class="fuel-pill-main">${fmt(kmTotal, 0)} km</div>
                        <div class="fuel-pill-sub"><span>Frota Ativa:</span> <b>${placasSet.size} Placas</b></div>
                    </div>
                    <div class="fuel-pill">
                        <div class="fuel-pill-header arla">💧 Relação Arla/Diesel</div>
                        <div class="fuel-pill-main">${fmt(propArlaSobreDiesel, 2)}%</div>
                        <div class="fuel-pill-sub"><span>Padrão SCR:</span> <b>3% a 7%</b></div>
                    </div>
                </div>
                <div class="tooltip-box">
                    <b>🚛 Cálculo de Eficiência Energética (Km/L):</b><br>
                    Calculado exclusivamente sobre abastecimentos de Diesel com hodômetro plausível (<code>0,8 a 7,5 Km/L</code>), sem duplicar Km nas notas de Arla 32:<br>
                    • <b>Fórmula:</b> <code>${fmt(kmTotal, 1)} km ÷ ${fmt(litrosComHod, 2)} L = ${fmt(mediaKmlFrota)} Km/L</code>
                </div>
            </div>
        `);
    }

    if (configSistema.exibirKpiEconomia !== false) {
        cardsHtml.push(`
            <div class="kpi-card highlight tooltip-container">
                <div>
                    <div class="label"><span>📉 Economia Real no Período ℹ️</span> <span>Viabilidade</span></div>
                    <div class="value" style="color:${corEco};">R$ ${fmt(ecoT)}</div>
                    <div style="font-size:10.5px; color:#cbd5e1; margin-top:2px; font-weight:600;">${statusEcoTexto}</div>
                </div>
                <div class="fuel-breakdown">
                    <div class="fuel-pill">
                        <div class="fuel-pill-header diesel">⛽ Econ. Diesel</div>
                        <div class="fuel-pill-main" style="color:${ecoDiesel>=0?'#34d399':'#f87171'}">R$ ${fmt(ecoDiesel)}</div>
                        <div class="fuel-pill-sub"><span>Auditado:</span> <b>${fmt(volTabDieselMl/1000, 2)} L</b></div>
                    </div>
                    <div class="fuel-pill">
                        <div class="fuel-pill-header arla">💧 Econ. Arla 32</div>
                        <div class="fuel-pill-main" style="color:${ecoArla>=0?'#34d399':'#f87171'}">R$ ${fmt(ecoArla)}</div>
                        <div class="fuel-pill-sub"><span>Auditado:</span> <b>${fmt(volTabArlaMl/1000, 2)} L</b></div>
                    </div>
                </div>
                <div class="tooltip-box">
                    <b>📉 Viabilidade: Preço Negociado vs Litro Abastecido:</b><br>
                    Compara o custo que seria pago no Preço de Tabela/Negociado (<code>R$ ${fmt(cusTabTotal)}</code>) com o valor pago na transação:<br>
                    • <b>Fórmula:</b> <code>∑ (Litros × Preço Tabela/Negociado) - Valor Pago</code><br>
                    • <b>Ganho Médio por Litro:</b> <code>R$ ${fmt(ecoPorLitroMedio, 3)} / Litro</code>
                </div>
            </div>
        `);
    }

    document.getElementById('kpiGrid').innerHTML = cardsHtml.join('');
}

async function fetchDadosAnalise(sincronizarFaltantes = false, forcarReSync = false) {
    const status = document.getElementById('statusMsg');
    const btnConectar = document.getElementById('btnConectar');
    const btnForcar = document.getElementById('btnForcarSync');
    const dates = getDatasFiltroAnalise();

    if (btnConectar) btnConectar.disabled = true;
    if (btnForcar) btnForcar.disabled = true;
    if (status) {
        status.innerHTML = sincronizarFaltantes ? '⏳ Sincronizando...' : '⏳ Carregando...';
        status.className = 'status-msg warning';
    }

    try {
        const urlBase = typeof apiUrlAtual !== 'undefined' ? apiUrlAtual : 'http://localhost:3000';
        
        if (forcarReSync) {
            await fetch(`${urlBase}/api/forcar-sync-background`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dates) }).catch(e => console.log("Ignorado", e));
        } else if (sincronizarFaltantes) {
            await fetch(`${urlBase}/api/buscar-auditoria`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dates) }).catch(e => console.log("Ignorado", e));
        }

        const response = await fetch(`${urlBase}/api/dados?dtIni=${dates.dtIni}&dtFim=${dates.dtFim}`);
        if (!response.ok) throw new Error('Falha HTTP');
        
        const res = await response.json();
        window.transacoesAnaliseGlobal = res.transacoes || [];
        window.resumoAnaliseBackend = res.resumo || null;
        window.rankingsBackend = res.rankings || { porPosto: [], porRede: [], porUF: [], porPlaca: [], porMotorista: [], alertasOperacionais: [] };
        
        atualizarSelectsDinamicosSidebar();
        processarDadosAnalise();
        if (typeof renderTabContent === 'function') renderTabContent();

        if (status) {
            if (window.transacoesAnaliseGlobal.length === 0) {
                status.innerHTML = '⚠️ Sem dados no período';
                status.className = 'status-msg warning';
            } else {
                status.innerHTML = `✅ ${window.transacoesAnaliseFiltradas.length} Abastecimentos`;
                status.className = 'status-msg success';
            }
        }
    } catch (e) {
        if (status) {
            status.innerHTML = `❌ Erro de Ligação.`;
            status.className = 'status-msg error';
        }
        console.error("Erro na API:", e);
    } finally {
        if (btnConectar) btnConectar.disabled = false;
        if (btnForcar) btnForcar.disabled = false;
    }
}

// ============================================================================
// INICIALIZAÇÃO DA PÁGINA (Execução segura)
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    
    // 1. A VALIDAÇÃO DE AUTENTICAÇÃO TEM QUE SER A PRIMEIRA COISA!
    const user = sessionStorage.getItem('logged_user');
    if (user) {
        const authOverlay = document.getElementById('authOverlay');
        if (authOverlay) authOverlay.style.display = 'none';
        
        const loggedUserTag = document.getElementById('loggedUserTag');
        if (loggedUserTag) loggedUserTag.innerHTML = `👤 ${user}`;

        const perms = JSON.parse(sessionStorage.getItem('user_perms') || '{}');
        if (perms.overview !== false && document.getElementById('btn_t_overview')) document.getElementById('btn_t_overview').style.display = 'block';
        if (perms.temporal !== false && document.getElementById('btn_t_temporal')) document.getElementById('btn_t_temporal').style.display = 'block';
        if (perms.abc !== false && document.getElementById('btn_t_abc')) document.getElementById('btn_t_abc').style.display = 'block';
        if (perms.frota !== false && document.getElementById('btn_t_frota')) document.getElementById('btn_t_frota').style.display = 'block';
        if (perms.precos !== false && document.getElementById('btn_t_precos')) document.getElementById('btn_t_precos').style.display = 'block';
        if (perms.heatmap !== false && document.getElementById('btn_t_heatmap')) document.getElementById('btn_t_heatmap').style.display = 'block';
        if (perms.integration !== false && document.getElementById('btn_t_integration')) document.getElementById('btn_t_integration').style.display = 'block';
        
        const btnAdmin = document.getElementById('btnOpenAdmin');
        if (user === 'pedro.cavalheirolog' && btnAdmin) btnAdmin.style.display = 'block';
    } else {
        return;
    }

    // 2. Processa os campos visuais padrão
    preencherAnos();
    const d = new Date();
    const hojeStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (document.getElementById('dataInicio')) document.getElementById('dataInicio').value = hojeStr;
    if (document.getElementById('dataFim')) document.getElementById('dataFim').value = hojeStr;
    if (document.getElementById('auditDtIni')) document.getElementById('auditDtIni').value = hojeStr;
    if (document.getElementById('auditDtFim')) document.getElementById('auditDtFim').value = hojeStr;
    if (document.getElementById('inpDataVigPreco')) document.getElementById('inpDataVigPreco').value = hojeStr;

    // 3. Funções assíncronas do servidor
    try { if (typeof initDBUsuarios === 'function') await initDBUsuarios(); } catch(e){}
    try { if (typeof carregarConfiguracoesServidor === 'function') await carregarConfiguracoesServidor(); } catch(e){}
    try { if (typeof carregarHistoricoPrecos === 'function') await carregarHistoricoPrecos(); } catch(e){}

    const btnAdmin = document.getElementById('btnOpenAdmin');
    if (btnAdmin) btnAdmin.addEventListener('click', () => document.getElementById('adminModal').style.display = 'flex');
    
    const btnSettings = document.getElementById('btnOpenSettings');
    if (btnSettings) btnSettings.addEventListener('click', () => {
        if (typeof aplicarConfiguracoesNaInterface === 'function') aplicarConfiguracoesNaInterface();
        const settingsModal = document.getElementById('settingsModal');
        if (settingsModal) settingsModal.style.display = 'flex';
    });

    const navTabs = document.getElementById('navTabs');
    if (navTabs) {
        navTabs.addEventListener('click', e => {
            const b = e.target.closest('.nav-tab'); 
            if (!b) return;
            document.querySelectorAll('.nav-tab, .tab-content').forEach(el => el.classList.remove('active'));
            b.classList.add('active');
            const targetContent = document.getElementById(b.dataset.tab);
            if (targetContent) targetContent.classList.add('active');
            
            if (b.dataset.tab === 'tab-precos' && typeof carregarHistoricoPrecos === 'function') {
                carregarHistoricoPrecos();
            }
            if (b.dataset.tab === 'tab-integration' && (typeof transacoesAuditoriaGlobal === 'undefined' || transacoesAuditoriaGlobal.length === 0)) {
                if (typeof buscarAuditoriaIndependente === 'function') buscarAuditoriaIndependente(false);
            }
            setTimeout(() => { if (typeof renderTabContent === 'function') renderTabContent(); }, 40);
        });
    }

    const mapSearch = document.getElementById('mapSearch');
    if (mapSearch) mapSearch.addEventListener('input', () => { if(document.querySelector('.nav-tab.active')?.dataset.tab === 'tab-heatmap' && typeof renderTabContent === 'function') renderTabContent(); });
    
    const toggleHeat = document.getElementById('toggleHeatmapCheck');
    if (toggleHeat) toggleHeat.addEventListener('change', (e) => { 
        if (typeof mapInstance === 'undefined' || !mapInstance || typeof heatLayer === 'undefined' || !heatLayer) return; 
        if (e.target.checked) mapInstance.addLayer(heatLayer); else mapInstance.removeLayer(heatLayer); 
    });
    
    ['checkClasseA', 'checkClasseB', 'checkClasseC'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => { if(document.querySelector('.nav-tab.active')?.dataset.tab === 'tab-heatmap' && typeof renderTabContent === 'function') renderTabContent(); });
    });

    const btnConectar = document.getElementById('btnConectar');
    if (btnConectar) btnConectar.addEventListener('click', () => fetchDadosAnalise(true, false));

    const btnForcar = document.getElementById('btnForcarSync');
    if (btnForcar) btnForcar.addEventListener('click', () => fetchDadosAnalise(true, true));

    ['filtroTipoAbast', 'filtroCombustivelAnalise', 'filtroRedeAnalise', 'filtroUfAnalise'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => { processarDadosAnalise(); if (typeof renderTabContent === 'function') renderTabContent(); });
    });

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', () => { sessionStorage.clear(); window.location.reload(); });

    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) themeToggle.addEventListener('click', async () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const newTheme = isDark ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        
        if (typeof configSistema !== 'undefined') {
            configSistema.tema = newTheme;
            localStorage.setItem('cavalheiro_config_v4', JSON.stringify(configSistema));
        }
        
        if (typeof renderTabContent === 'function') renderTabContent();
    });

    // Arranca automaticamente a primeira aba disponível
    const primeiraAbaPermitida = document.querySelector('.nav-tab[style*="block"]');
    if (primeiraAbaPermitida) {
        primeiraAbaPermitida.click();
        fetchDadosAnalise(true, false);
    }
});