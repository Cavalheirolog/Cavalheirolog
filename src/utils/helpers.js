const crypto = require('crypto');

// ============================================================================
// MATEMÁTICA EXATA (CENTAVOS / MILILITROS), DATAS BRASIL E FORMATAÇÃO
// ============================================================================

const toMl = (litros) => Math.round((Number(litros) || 0) * 1000);
const fromMl = (ml) => Number((ml / 1000).toFixed(3));
const toCents = (reais) => Math.round((Number(reais) || 0) * 100);
const fromCents = (cents) => Number((cents / 100).toFixed(2));

const delay = (ms) => new Promise(res => setTimeout(res, ms));

function getDataBrasil(diasOffset = 0) {
    const data = new Date();
    data.setDate(data.getDate() + diasOffset);
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(data);
}

function getDataHoraBrasilStr() {
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(new Date());
}

function parseTruckPagNum(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return val;
    let str = String(val).replace(/"/g, '').replace('R$', '').trim();
    if (str.includes('.') && str.includes(',')) str = str.replace(/\./g, '').replace(',', '.');
    else if (str.includes(',')) str = str.replace(',', '.');
    return parseFloat(str) || 0;
}

function limparCNPJ(v) {
    return String(v || '').replace(/\D/g, '');
}

function formatarCNPJ(v) {
    const d = limparCNPJ(v);
    if (d.length !== 14) return String(v || '').trim();
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function hashSHA256(str) {
    return crypto.createHash('sha256').update(String(str)).digest('hex');
}

function normalizarTexto(str) {
    return String(str || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function normalizarDataHora(dataBrOuIso, fallbackDataIso) {
    if (!dataBrOuIso) return `${fallbackDataIso} 00:00:00`;
    let str = String(dataBrOuIso).trim();
    if (str.includes('/')) {
        const parts = str.split(/\s+/);
        const dParts = parts[0].split('/');
        let hora = parts[1] || '00:00:00';
        if (hora.length === 5) hora += ':00';
        if (dParts.length === 3) {
            return `${dParts[2]}-${dParts[1].padStart(2, '0')}-${dParts[0].padStart(2, '0')} ${hora}`.trim();
        }
    }
    if (str.length === 10) return `${str} 00:00:00`;
    return str;
}

function calcularDelayMinutos(dataTransacaoIso, dataRegistroIso) {
    if (!dataTransacaoIso || !dataRegistroIso) return 0;
    const t1 = Date.parse(dataTransacaoIso.replace(' ', 'T'));
    const t2 = Date.parse(dataRegistroIso.replace(' ', 'T'));
    if (isNaN(t1) || isNaN(t2)) return 0;
    return Math.max(0, Math.round((t2 - t1) / 60000));
}

module.exports = {
    toMl,
    fromMl,
    toCents,
    fromCents,
    delay,
    getDataBrasil,
    getDataHoraBrasilStr,
    parseTruckPagNum,
    limparCNPJ,
    formatarCNPJ,
    hashSHA256,
    normalizarTexto,
    normalizarDataHora,
    calcularDelayMinutos
};