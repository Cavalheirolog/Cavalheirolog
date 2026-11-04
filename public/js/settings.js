// ============================================================================
// MÓDULO DE CONFIGURAÇÕES, LAYOUT, TEMAS E DIAGNÓSTICO DO SERVIDOR
// ============================================================================

window.selecionarCorPreset = function(hex) {
    const input = document.getElementById('cfgColor1');
    if (input) input.value = hex;
};

window.restaurarLayoutPadrao = async function() {
    configSistema = { ...PADRAO_FABRICA_CONFIG };
    aplicarConfiguracoesNaInterface();
    await salvarConfig();
};

async function carregarConfiguracoesServidor() {
    try {
        const salvoLocal = localStorage.getItem('cavalheiro_config_v4');
        if (salvoLocal) {
            configSistema = { ...configSistema, ...JSON.parse(salvoLocal) };
        }
        const BASE_API = apiUrlAtual || URL_PADRAO;
        const user = sessionStorage.getItem('logged_user') || '';
        const res = await fetch(`${BASE_API}/api/configuracoes?utilizador=${encodeURIComponent(user)}`);
        const data = await res.json();
        if (data.ok && data.config) {
            configSistema = { ...configSistema, ...data.config };
        }
    } catch (_) {}
    aplicarConfiguracoesNaInterface();
}

function aplicarConfiguracoesNaInterface() {
    document.documentElement.style.setProperty('--chart-color-1', configSistema.corPrimaria || '#3b82f6');
    document.body.setAttribute('data-density', configSistema.densidadeTabela || 'padrao');
    document.body.setAttribute('data-kpi-style', configSistema.estiloCardsKpi || 'detalhado');

    isDark = (configSistema.tema === 'dark');
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

    const colorInput = document.getElementById('cfgColor1');
    if (colorInput) colorInput.value = configSistema.corPrimaria || '#3b82f6';
    
    const chartType = document.getElementById('cfgChartType');
    if (chartType) chartType.value = configSistema.formatoGraficoTop10 || 'bar';

    const chartAbc = document.getElementById('cfgChartAbcType');
    if (chartAbc) chartAbc.value = configSistema.formatoGraficoAbc || 'doughnut';

    const dens = document.getElementById('cfgDensidade');
    if (dens) dens.value = configSistema.densidadeTabela || 'padrao';

    const estiloKpi = document.getElementById('cfgEstiloKpi');
    if (estiloKpi) estiloKpi.value = configSistema.estiloCardsKpi || 'detalhado';

    const apiUrlInp = document.getElementById('cfgApiUrl');
    if (apiUrlInp) apiUrlInp.value = apiUrlAtual;

    const checksMap = {
        'v_kpipostos': 'exibirKpiPostos',
        'v_kpivolume': 'exibirKpiVolume',
        'v_kpifaturamento': 'exibirKpiFaturamento',
        'v_telemetriakml': 'exibirTelemetriaKmL',
        'v_kpieconomia': 'exibirKpiEconomia',
        'v_topvol': 'exibirTopVolume',
        'v_topeco': 'exibirTopEconomia',
        'v_classabc': 'exibirCurvaAbc',
        'v_resumoredes': 'exibirResumoRedes',
        'v_resumoufs': 'exibirResumoUFs',
        'v_sazonalidadesemana': 'exibirSazonalidadeSemana',
        'v_mixcombustivel': 'exibirMixCombustivel',
        'v_simuladorabc': 'exibirSimuladorAbc',
        'v_alertasfrota': 'exibirAlertasFrota',
        'v_rankingplacas': 'exibirRankingPlacas',
        'v_rankingmotoristas': 'exibirRankingMotoristas'
    };

    for (const [idEl, prop] of Object.entries(checksMap)) {
        const el = document.getElementById(idEl);
        if (el) el.checked = configSistema[prop] !== false;
    }

    const setDisp = (id, show, mode = 'block') => {
        const el = document.getElementById(id);
        if (el) el.style.display = show ? mode : 'none';
    };
    setDisp('box_topvol', configSistema.exibirTopVolume !== false, 'grid');
    setDisp('box_topeco', configSistema.exibirTopEconomia !== false, 'flex');
    setDisp('box_classabc', configSistema.exibirCurvaAbc !== false, 'flex');
    setDisp('box_resumoredes', configSistema.exibirResumoRedes !== false, 'block');
    setDisp('box_resumoufs', configSistema.exibirResumoUFs !== false, 'block');
    setDisp('box_sazonalidadesemana', configSistema.exibirSazonalidadeSemana !== false, 'flex');
    setDisp('box_mixcombustivel', configSistema.exibirMixCombustivel !== false, 'flex');
    setDisp('box_simuladorabc', configSistema.exibirSimuladorAbc !== false, 'flex');
    setDisp('box_alertasfrota', configSistema.exibirAlertasFrota !== false, 'block');
    setDisp('box_rankingplacas', configSistema.exibirRankingPlacas !== false, 'block');
    setDisp('box_rankingmotoristas', configSistema.exibirRankingMotoristas !== false, 'block');
}

window.salvarConfig = async function() {
    configSistema.corPrimaria = document.getElementById('cfgColor1')?.value || '#3b82f6';
    configSistema.formatoGraficoTop10 = document.getElementById('cfgChartType')?.value || 'bar';
    configSistema.formatoGraficoAbc = document.getElementById('cfgChartAbcType')?.value || 'doughnut';
    configSistema.densidadeTabela = document.getElementById('cfgDensidade')?.value || 'padrao';
    configSistema.estiloCardsKpi = document.getElementById('cfgEstiloKpi')?.value || 'detalhado';

    configSistema.exibirKpiPostos = document.getElementById('v_kpipostos')?.checked ?? true;
    configSistema.exibirKpiVolume = document.getElementById('v_kpivolume')?.checked ?? true;
    configSistema.exibirKpiFaturamento = document.getElementById('v_kpifaturamento')?.checked ?? true;
    configSistema.exibirTelemetriaKmL = document.getElementById('v_telemetriakml')?.checked ?? true;
    configSistema.exibirKpiEconomia = document.getElementById('v_kpieconomia')?.checked ?? true;
    configSistema.exibirTopVolume = document.getElementById('v_topvol')?.checked ?? true;
    configSistema.exibirTopEconomia = document.getElementById('v_topeco')?.checked ?? true;
    configSistema.exibirCurvaAbc = document.getElementById('v_classabc')?.checked ?? true;
    configSistema.exibirResumoRedes = document.getElementById('v_resumoredes')?.checked ?? true;
    configSistema.exibirResumoUFs = document.getElementById('v_resumoufs')?.checked ?? true;
    configSistema.exibirSazonalidadeSemana = document.getElementById('v_sazonalidadesemana')?.checked ?? true;
    configSistema.exibirMixCombustivel = document.getElementById('v_mixcombustivel')?.checked ?? true;
    configSistema.exibirSimuladorAbc = document.getElementById('v_simuladorabc')?.checked ?? true;
    configSistema.exibirAlertasFrota = document.getElementById('v_alertasfrota')?.checked ?? true;
    configSistema.exibirRankingPlacas = document.getElementById('v_rankingplacas')?.checked ?? true;
    configSistema.exibirRankingMotoristas = document.getElementById('v_rankingmotoristas')?.checked ?? true;

    localStorage.setItem('cavalheiro_config_v4', JSON.stringify(configSistema));

    const novaApiUrl = document.getElementById('cfgApiUrl')?.value.trim().replace(/\/$/, "");
    if (novaApiUrl) {
        apiUrlAtual = novaApiUrl;
        localStorage.setItem('cavalheiro_api_url', apiUrlAtual);
    }

    try {
        const BASE_API = apiUrlAtual || URL_PADRAO;
        const user = sessionStorage.getItem('logged_user') || '';
        await fetch(`${BASE_API}/api/configuracoes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ utilizador: user, config: configSistema })
        });
    } catch (_) {}

    aplicarConfiguracoesNaInterface();
    const modal = document.getElementById('settingsModal');
    if (modal) modal.style.display = 'none';
    
    if (typeof processarDadosAnalise === 'function') processarDadosAnalise();
    if (typeof renderTabContent === 'function') renderTabContent();
    showToast('Layout e parâmetros aplicados com sucesso!', 'success');
};

window.abrirModalStatusSistema = async function() {
    const modal = document.getElementById('statusModal');
    if (modal) modal.style.display = 'flex';
    try {
        const BASE_API = apiUrlAtual || URL_PADRAO;
        const res = await fetch(`${BASE_API}/api/status-sistema`);
        const data = await res.json();
        const bd = data.bancoDados || {};
        const resumoEl = document.getElementById('statusSistemaResumo');
        if (resumoEl) {
            resumoEl.innerHTML = `
                <div class="audit-kpi-mini" style="border-left-color:var(--success)">
                    <div class="lbl">Estado Backend</div>
                    <div class="val" style="color:var(--success)">ONLINE</div>
                    <div class="sub">${data.dataHoraServidor || ''}</div>
                </div>
                <div class="audit-kpi-mini">
                    <div class="lbl">Compras Líquidas</div>
                    <div class="val">${bd.totalAnaliseLiquida || 0}</div>
                    <div class="sub">Tabela Análise</div>
                </div>
                <div class="audit-kpi-mini">
                    <div class="lbl">Histórico Bruto</div>
                    <div class="val">${bd.totalAuditoriaBruta || 0}</div>
                    <div class="sub">Tabela Auditoria</div>
                </div>
                <div class="audit-kpi-mini">
                    <div class="lbl">Acordos Preço</div>
                    <div class="val">${bd.totalAcordosPreco || 0}</div>
                    <div class="sub">SQLite: ${bd.tamanhoMB || 0} MB</div>
                </div>
            `;
        }
        const tb = document.getElementById('tbSyncLogs');
        if (tb) {
            tb.innerHTML = (data.ultimosLogs || []).map(l => `
                <tr>
                    <td><b>${l.data_hora}</b></td>
                    <td><span class="badge blue">${l.origem}</span></td>
                    <td>${l.periodo}</td>
                    <td class="text-right"><b>${l.inseridos_analise}</b></td>
                    <td class="text-right">${l.inseridos_auditoria}</td>
                    <td class="text-right" style="color:var(--danger)">${l.estornos_filtrados}</td>
                    <td><span class="badge ${l.status==='OK'?'green':'red'}">${l.status}</span></td>
                </tr>
            `).join('') || `<tr><td colspan="7" class="text-center">Nenhum registo de log encontrado.</td></tr>`;
        }
    } catch (e) {
        showToast('Não foi possível consultar o estado do servidor.', 'error');
    }
};