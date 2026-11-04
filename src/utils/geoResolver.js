const {
    MAPA_ESTADO_NOME_PARA_UF,
    COORDENADAS_CIDADES_BR,
    COORDENADAS_UF_CENTRO
} = require('../config/constants');
const { normalizarTexto } = require('./helpers');

// ============================================================================
// MOTOR DE GEOLOCALIZAÇÃO PRECISA DE MUNICÍPIOS E ESTADOS BRASILEIROS
// ============================================================================

function normalizarUf(ufAtual, estab, cidade) {
    let u = normalizarTexto(ufAtual);
    if (MAPA_ESTADO_NOME_PARA_UF[u]) return MAPA_ESTADO_NOME_PARA_UF[u];
    if (u && u !== 'ND' && u.length === 2 && COORDENADAS_UF_CENTRO[u]) return u;

    // Verifica se a cidade tem "/UF" (ex: "SAO BORJA/RS")
    const cidStr = String(cidade || '').toUpperCase().trim();
    if (cidStr.includes('/')) {
        const p = cidStr.split('/').pop().trim();
        if (p.length === 2 && COORDENADAS_UF_CENTRO[p]) return p;
    }

    const m = String(estab || '').match(/\|\s*([A-Z]{2})\s*-/i) || String(estab || '').match(/-\s*([A-Z]{2})\s*-/i);
    if (m && COORDENADAS_UF_CENTRO[m[1].toUpperCase()]) return m[1].toUpperCase();

    const estabNorm = normalizarTexto(estab);
    for (const [k] of Object.entries(COORDENADAS_CIDADES_BR)) {
        const [nomeCid, siglaUf] = k.split('/');
        if (nomeCid.length >= 5 && estabNorm.includes(nomeCid)) return siglaUf;
    }

    if (estabNorm.includes('CAVALHEIRO')) return 'RO';
    return 'ND';
}

function resolverCoordenadaPosto(estabelecimento, cidade, uf, coordPostoStr) {
    // 1. Tenta ler coordenada explícita vinda da TruckPag (ex: "-15.601, -56.097")
    if (coordPostoStr) {
        const m = String(coordPostoStr).match(/(-?\d+\.\d+)\s*[,;]\s*(-?\d+\.\d+)/);
        if (m) {
            const lat = parseFloat(m[1]);
            const lng = parseFloat(m[2]);
            if (lat < 6 && lat > -35 && lng < -30 && lng > -75) {
                return { lat, lng, precisao: 'GPS_POSTO' };
            }
        }
    }

    const cidNorm = normalizarTexto(cidade).replace(/\/[A-Z]{2}$/, '').trim();
    const ufNorm = normalizarUf(uf, estabelecimento, cidade);
    const chaveCompleta = `${cidNorm}/${ufNorm}`;

    // 2. Procura Cidade/UF exata no dicionário
    let base = COORDENADAS_CIDADES_BR[chaveCompleta];

    // 3. Procura apenas pelo nome da cidade se UF estiver vazia
    if (!base && cidNorm && cidNorm !== 'ND') {
        const chaveEncontrada = Object.keys(COORDENADAS_CIDADES_BR).find(k => k.startsWith(`${cidNorm}/`));
        if (chaveEncontrada) base = COORDENADAS_CIDADES_BR[chaveEncontrada];
    }

    // 4. Procura nome da cidade contido no próprio nome do Posto
    if (!base) {
        const estabNorm = normalizarTexto(estabelecimento);
        for (const [k, coord] of Object.entries(COORDENADAS_CIDADES_BR)) {
            const nomeCid = k.split('/')[0];
            if (nomeCid.length >= 4 && estabNorm.includes(nomeCid)) {
                base = coord;
                break;
            }
        }
    }

    // 5. Fallback para o centro do Estado (UF) — evitando jogar outros estados em Brasília
    if (!base) {
        base = COORDENADAS_UF_CENTRO[ufNorm] || { lat: -15.601, lng: -56.097 };
    }

    // Deslocamento determinístico mínimo (~300m a 1,2km) apenas para dois postos da mesma cidade não ficarem 100% sobrepostos
    const strHash = normalizarTexto(estabelecimento) + chaveCompleta;
    let hash = 0;
    for (let i = 0; i < strHash.length; i++) hash = (hash * 31 + strHash.charCodeAt(i)) % 10000;
    const angle = (hash / 10000) * Math.PI * 2;
    const radius = 0.002 + ((hash % 100) / 100) * 0.008;

    return {
        lat: Number((base.lat + radius * Math.cos(angle)).toFixed(5)),
        lng: Number((base.lng + radius * Math.sin(angle)).toFixed(5)),
        precisao: 'MUNICIPIO'
    };
}

module.exports = {
    normalizarUf,
    resolverCoordenadaPosto
};