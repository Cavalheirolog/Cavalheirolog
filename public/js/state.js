// ============================================================================
// ESTADO GLOBAL DO FRONTEND, UTILITÁRIOS E DICIONÁRIOS GEOGRÁFICOS
// ============================================================================

const URL_PADRAO = window.location.protocol.startsWith('http') ? window.location.origin : 'http://localhost:3000';
let apiUrlAtual = localStorage.getItem('cavalheiro_api_url') || URL_PADRAO;

const PADRAO_FABRICA_CONFIG = {
    tema: 'dark',
    corPrimaria: '#3b82f6',
    formatoGraficoTop10: 'bar',
    formatoGraficoAbc: 'doughnut',
    densidadeTabela: 'padrao',
    estiloCardsKpi: 'detalhado',
    exibirKpiPostos: true,
    exibirKpiVolume: true,
    exibirKpiFaturamento: true,
    exibirTelemetriaKmL: true,
    exibirKpiEconomia: true,
    exibirTopVolume: true,
    exibirTopEconomia: true,
    exibirCurvaAbc: true,
    exibirResumoRedes: true,
    exibirResumoUFs: true,
    exibirSazonalidadeSemana: true,
    exibirMixCombustivel: true,
    exibirSimuladorAbc: true,
    exibirAlertasFrota: true,
    exibirRankingPlacas: true,
    exibirRankingMotoristas: true,
    metaKmPorLitro: 2.65,
    metaDescontoSimulador: 0.15,
    capacidadePadraoTanqueLitros: 1000
};

let configSistema = { ...PADRAO_FABRICA_CONFIG };

// Memória Exclusiva de Análise & BI
let transacoesAnaliseGlobal = [];
let transacoesAnaliseFiltradas = [];
let resumoAnaliseBackend = null;
let rankingsBackend = { porPosto: [], porRede: [], porUF: [], porPlaca: [], porMotorista: [], alertasOperacionais: [] };
let todosPostos = [];
let historicoPrecosGlobal = [];

// Memória Exclusiva de Auditoria NFe & ICMS
let transacoesAuditoriaGlobal = [];
let transacoesAuditoriaFiltradas = [];
let resumoAuditoriaBackend = null;

let mapInstance = null, heatLayer = null, markersLayer = null;
let isDark = true;

// Formatação global
window.fmt = function(v, casas = 2) {
    return Number(v || 0).toLocaleString('pt-PT', { minimumFractionDigits: casas, maximumFractionDigits: casas });
};

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = type === 'success' ? `✅ ${message}` : (type === 'error' ? `❌ ${message}` : `⚠️ ${message}`);
    container.appendChild(toast);
    setTimeout(() => { 
        toast.style.animation = 'fadeOut 0.3s forwards'; 
        setTimeout(() => toast.remove(), 300); 
    }, 3600);
}

function formatarCNPJ(cnpj) {
    if (!cnpj) return '';
    const limpo = String(cnpj).replace(/\D/g, '');
    if (limpo.length !== 14) return cnpj;
    return limpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

function getCNPJEstruturado(uf, cidade, posto) {
    const u = (uf || '').toUpperCase().trim();
    const cid = (cidade || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const p = (posto || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (u === 'PA' && (p.includes('MIRIAM') || p.includes('MIRIAN')) && (cid.includes('ITAITUBA') || cid.includes('MIRITITUBA') || p.includes('ITAITUBA') || p.includes('MIRITITUBA'))) {
        return '07.689.042/0009-88';
    }
    const r73 = ['SP','MG','BA','PE','MA','SE','AL','TO','PA','ES','RJ','PI'];
    if (r73.includes(u)) return '07.689.042/0004-73';
    if (u === 'MT') return '07.689.042/0009-88';
    return '07.689.042/0001-20';
}

function classificarBombaFrontend(estab, tipoAtual) {
    const t = String(tipoAtual || '').toUpperCase().trim();
    const e = String(estab || '').toUpperCase().trim();
    if (t === 'INTERNO' || t.includes('BOMBA INTERNA')) return 'Interno';
    if (t === 'EXTERNO' || t.includes('POSTO EXTERNO')) return 'Externo';
    if (e.includes('BOMBA INTERNA') || e.includes('GARAGEM') || e.includes('COMBOIO') || /\bINTERNA\b/.test(e)) return 'Interno';
    return 'Externo';
}

function limparNomePosto(nome) {
    if (!nome) return 'ND';
    return nome.replace(/POSTO EXTERNO - |BOMBA INTERNA - /ig, '').substring(0, 26);
}

// Dicionário Geográfico de Fallback no Frontend
const coordsCidadesFrontend = {
    'ALVORADA/TO': { lat: -12.479, lng: -49.124 }, 'ANAPOLIS/GO': { lat: -16.328, lng: -48.953 },
    'APARECIDA DE GOIANIA/GO': { lat: -16.819, lng: -49.246 }, 'ARAGUAINA/TO': { lat: -7.192, lng: -48.204 },
    'ARAQUARI/SC': { lat: -26.371, lng: -48.720 }, 'ARAPORA/MG': { lat: -18.438, lng: -49.187 },
    'ARARAQUARA/SP': { lat: -21.794, lng: -48.176 }, 'ARARAS/SP': { lat: -22.357, lng: -47.384 },
    'ARIQUEMES/RO': { lat: -9.913, lng: -63.040 }, 'ASSIS/SP': { lat: -22.661, lng: -50.412 },
    'BAGE/RS': { lat: -31.329, lng: -54.106 }, 'BARRA MANSA/RJ': { lat: -22.544, lng: -44.171 },
    'BARREIRAS/BA': { lat: -12.152, lng: -44.990 }, 'BARUERI/SP': { lat: -23.511, lng: -46.876 },
    'BELEM/PA': { lat: -1.455, lng: -48.490 }, 'CACHOEIRA/BA': { lat: -12.606, lng: -38.963 },
    'CACOAL/RO': { lat: -11.438, lng: -61.447 }, 'CAETANOPOLIS/MG': { lat: -19.294, lng: -44.418 },
    'CAMPINAS/SP': { lat: -22.909, lng: -47.062 }, 'CAMPO GRANDE/MS': { lat: -20.469, lng: -54.620 },
    'CAMPO NOVO DO PARECIS/MT': { lat: -13.676, lng: -57.893 }, 'CAMPOS DE JULIO/MT': { lat: -13.719, lng: -59.266 },
    'CANDEIAS DO JAMARI/RO': { lat: -8.800, lng: -63.696 }, 'CAREACU/MG': { lat: -22.043, lng: -45.698 },
    'CARIRI DO TOCANTINS/TO': { lat: -11.889, lng: -49.162 }, 'CASCAVEL/PR': { lat: -24.957, lng: -53.459 },
    'CENTRALINA/MG': { lat: -18.583, lng: -49.194 }, 'CRUZEIRO DO SUL/AC': { lat: -7.627, lng: -72.675 },
    'CUBATAO/SP': { lat: -23.895, lng: -46.425 }, 'CUIABA/MT': { lat: -15.601, lng: -56.097 },
    'CURITIBA/PR': { lat: -25.428, lng: -49.273 }, 'DIAMANTE DO NORTE/PR': { lat: -22.656, lng: -52.860 },
    'DOMINGOS MARTINS/ES': { lat: -20.360, lng: -40.659 }, 'DOURADOS/MS': { lat: -22.223, lng: -54.806 },
    'ELDORADO DO CARAJAS/PA': { lat: -6.105, lng: -49.355 }, 'ESCADA/PE': { lat: -8.359, lng: -35.228 },
    'FEIRA DE SANTANA/BA': { lat: -12.266, lng: -38.966 }, 'FERNANDOPOLIS/SP': { lat: -20.283, lng: -50.246 },
    'FRUTAL/MG': { lat: -20.025, lng: -48.935 }, 'GARUVA/SC': { lat: -26.027, lng: -48.855 },
    'GENERAL CARNEIRO/MT': { lat: -15.711, lng: -52.758 }, 'GOIANIA/GO': { lat: -16.686, lng: -49.264 },
    'GUARULHOS/SP': { lat: -23.454, lng: -46.533 }, 'GURUPI/TO': { lat: -11.729, lng: -49.068 },
    'HIDROLANDIA/GO': { lat: -16.962, lng: -49.229 }, 'IMBITUBA/SC': { lat: -28.240, lng: -48.670 },
    'ITAITUBA/PA': { lat: -4.276, lng: -55.983 }, 'ITAJAI/SC': { lat: -26.907, lng: -48.661 },
    'ITAOBIM/MG': { lat: -16.622, lng: -41.503 }, 'ITATIM/BA': { lat: -12.712, lng: -39.699 },
    'ITUIUTABA/MG': { lat: -18.969, lng: -49.465 }, 'JABOATAO DOS GUARARAPES/PE': { lat: -8.112, lng: -35.015 },
    'JACIARA/MT': { lat: -15.955, lng: -54.968 }, 'JAGUARUNA/SC': { lat: -28.614, lng: -49.025 },
    'JATAI/GO': { lat: -17.881, lng: -51.714 }, 'JI-PARANA/RO': { lat: -10.882, lng: -61.945 },
    'JOAO PINHEIRO/MG': { lat: -17.742, lng: -46.174 }, 'LUCAS DO RIO VERDE/MT': { lat: -13.056, lng: -55.910 },
    'MARACAI/SP': { lat: -22.610, lng: -50.666 }, 'MARECHAL CANDIDO RONDON/PR': { lat: -24.557, lng: -54.057 },
    'MARMELEIRO/PR': { lat: -26.148, lng: -53.026 }, 'MATUPA/MT': { lat: -10.233, lng: -54.922 },
    'MINEIROS/GO': { lat: -17.569, lng: -52.551 }, 'MIRASSOL/SP': { lat: -20.819, lng: -49.521 },
    'MIRITITUBA/PA': { lat: -4.298, lng: -55.955 }, 'MONTES CLAROS/MG': { lat: -16.728, lng: -43.863 },
    'NOVA ANDRADINA/MS': { lat: -22.238, lng: -53.343 }, 'NOVA CRIXAS/GO': { lat: -14.098, lng: -50.326 },
    'NOVA GRANADA/SP': { lat: -20.533, lng: -49.314 }, 'NOVA MUTUM/MT': { lat: -13.829, lng: -56.082 },
    'NOVA ODESSA/SP': { lat: -22.779, lng: -47.295 }, 'ORLANDIA/SP': { lat: -20.720, lng: -47.886 },
    'PARAGOMINAS/PA': { lat: -2.996, lng: -47.352 }, 'PARANAGUA/PR': { lat: -25.520, lng: -48.509 },
    'PENAPOLIS/SP': { lat: -21.419, lng: -50.077 }, 'PIMENTA BUENO/RO': { lat: -11.672, lng: -61.193 },
    'PLANALTO/BA': { lat: -14.664, lng: -40.470 }, 'POCOES/BA': { lat: -14.529, lng: -40.366 },
    'PONTA GROSSA/PR': { lat: -25.094, lng: -50.163 }, 'PORTO REAL/RJ': { lat: -22.419, lng: -44.290 },
    'PORTO VELHO/RO': { lat: -8.761, lng: -63.903 }, 'PRIMAVERA DO LESTE/MT': { lat: -15.559, lng: -54.296 },
    'RIO BRANCO/AC': { lat: -9.975, lng: -67.824 }, 'RIO VERDE/GO': { lat: -17.792, lng: -50.919 },
    'RONDONOPOLIS/MT': { lat: -16.467, lng: -54.636 }, 'RUBINEIA/SP': { lat: -20.179, lng: -51.002 },
    'SABARA/MG': { lat: -19.884, lng: -43.805 }, 'SALES OLIVEIRA/SP': { lat: -20.771, lng: -47.838 },
    'SALGUEIRO/PE': { lat: -8.073, lng: -39.119 }, 'SANTA LUZIA DO ITANHY/SE': { lat: -11.350, lng: -37.448 },
    'SANTANA DO ARAGUAIA/PA': { lat: -9.333, lng: -50.350 }, 'SANTAREM/PA': { lat: -2.443, lng: -54.708 },
    'SANTO ESTEVAO/BA': { lat: -12.430, lng: -39.128 }, 'SAO BORJA/RS': { lat: -28.660, lng: -56.004 },
    'SAO JOSE DOS PINHAIS/PR': { lat: -25.534, lng: -49.206 }, 'SAO MIGUEL DO GUAPORE/RO': { lat: -11.691, lng: -62.716 },
    'SAO PAULO/SP': { lat: -23.550, lng: -46.633 }, 'SAPEZAL/MT': { lat: -13.551, lng: -58.814 },
    'SINOP/MT': { lat: -11.864, lng: -55.505 }, 'SORRISO/MT': { lat: -12.542, lng: -55.721 },
    'TAILANDIA/PA': { lat: -2.946, lng: -48.952 }, 'TARUMA/SP': { lat: -22.746, lng: -50.577 },
    'TIO HUGO/RS': { lat: -28.578, lng: -52.599 }, 'TOLEDO/PR': { lat: -24.713, lng: -53.743 },
    'UBERLANDIA/MG': { lat: -18.918, lng: -48.277 }, 'UMBAUBA/SE': { lat: -11.383, lng: -37.658 },
    'URANIA/SP': { lat: -20.246, lng: -50.643 }, 'URUACU/GO': { lat: -14.524, lng: -49.140 },
    'VARZEA GRANDE/MT': { lat: -15.646, lng: -56.132 }, 'VENDA NOVA DO IMIGRANTE/ES': { lat: -20.329, lng: -41.131 },
    'VILHENA/RO': { lat: -12.740, lng: -60.145 }, 'VOTUPORANGA/SP': { lat: -20.422, lng: -49.972 }
};

const coordsEstados = {
    'AC':{lat:-9.97,lng:-67.82}, 'AL':{lat:-9.66,lng:-35.73}, 'BA':{lat:-12.57,lng:-41.70},
    'ES':{lat:-19.18,lng:-40.30}, 'GO':{lat:-16.32,lng:-49.45}, 'MA':{lat:-5.42,lng:-45.44},
    'MG':{lat:-18.51,lng:-44.55}, 'MS':{lat:-20.77,lng:-54.78}, 'MT':{lat:-13.50,lng:-55.80},
    'PA':{lat:-4.27,lng:-52.50}, 'PE':{lat:-8.28,lng:-37.98}, 'PI':{lat:-7.71,lng:-42.72},
    'PR':{lat:-24.89,lng:-51.55}, 'RJ':{lat:-22.54,lng:-43.50}, 'RO':{lat:-10.88,lng:-61.94},
    'RS':{lat:-29.50,lng:-53.50}, 'SC':{lat:-27.24,lng:-50.21}, 'SE':{lat:-10.90,lng:-37.07},
    'SP':{lat:-21.79,lng:-48.50}, 'TO':{lat:-10.17,lng:-48.88}
};

function obterCoordenadaSeguraFrontend(p) {
    if (p.lat && p.lng && !(Math.abs(p.lat - (-15.7)) < 0.2 && Math.abs(p.lng - (-47.9)) < 0.2)) {
        return { lat: p.lat, lng: p.lng };
    }
    const cidNorm = String(p.cidade || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const ufNorm = String(p.uf || '').toUpperCase().trim();
    const chave = `${cidNorm}/${ufNorm}`;
    let base = coordsCidadesFrontend[chave];
    if (!base && cidNorm && cidNorm !== 'ND') {
        const kEnc = Object.keys(coordsCidadesFrontend).find(k => k.startsWith(`${cidNorm}/`));
        if (kEnc) base = coordsCidadesFrontend[kEnc];
    }
    if (!base) base = coordsEstados[ufNorm] || { lat: -15.601, lng: -56.097 };

    let hash = 0;
    const s = (p.posto || '') + chave;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) % 10000;
    const angle = (hash / 10000) * Math.PI * 2;
    const radius = 0.002 + ((hash % 100) / 100) * 0.007;
    return { lat: base.lat + radius * Math.cos(angle), lng: base.lng + radius * Math.sin(angle) };
}