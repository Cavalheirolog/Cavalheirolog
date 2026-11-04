const { parseTruckPagNum, formatarCNPJ, normalizarTexto } = require('./helpers');
const { normalizarUf } = require('./geoResolver');

// ============================================================================
// REGRAS DE NEGÓCIO: CNPJ ICMS, CHAVE NFE (MÓDULO 11), REDES E TELEMETRIA
// ============================================================================

function obterCNPJEstruturado(uf, cidade, posto) {
    const u = normalizarUf(uf, posto, cidade);
    const c = normalizarTexto(cidade);
    const p = normalizarTexto(posto);

    if (u === 'PA' && (p.includes('MIRIAM') || p.includes('MIRIAN')) && (c.includes('ITAITUBA') || c.includes('MIRITITUBA') || p.includes('ITAITUBA') || p.includes('MIRITITUBA'))) {
        return '07.689.042/0009-88';
    }

    const estadosFinal73 = ['SP', 'MG', 'BA', 'PE', 'MA', 'SE', 'AL', 'TO', 'PA', 'ES', 'RJ', 'PI'];
    if (estadosFinal73.includes(u)) return '07.689.042/0004-73';
    if (u === 'MT') return '07.689.042/0009-88';

    return '07.689.042/0001-20';
}

function inspecionarChaveNFe(chaveBruta) {
    const chave = String(chaveBruta || '').replace(/\D/g, '');
    if (chave.length !== 44) {
        return { valida: false, modelo: '', descricaoModelo: 'Sem Chave', numeroNota: '', serie: '', anoMes: '', cnpjEmitente: '' };
    }

    let soma = 0;
    let peso = 2;
    for (let i = 42; i >= 0; i--) {
        soma += parseInt(chave[i], 10) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    const dvEsperado = (resto === 0 || resto === 1) ? 0 : (11 - resto);
    const dvInformado = parseInt(chave[43], 10);
    const valida = (dvEsperado === dvInformado);

    const anoMes = `20${chave.substring(2, 4)}-${chave.substring(4, 6)}`;
    const cnpjEmitente = formatarCNPJ(chave.substring(6, 20));
    const modelo = chave.substring(20, 22);
    const serie = String(parseInt(chave.substring(22, 25), 10));
    const numeroNota = String(parseInt(chave.substring(25, 34), 10));
    const descricaoModelo = modelo === '55' ? 'NF-e (Mod. 55)' : (modelo === '65' ? 'NFC-e (Mod. 65)' : `Mod. ${modelo}`);

    return { valida, modelo, descricaoModelo, numeroNota, serie, anoMes, cnpjEmitente };
}

function classificarTipoBomba(estabelecimento, tipoOriginal) {
    const t = String(tipoOriginal || '').toUpperCase().trim();
    const e = String(estabelecimento || '').toUpperCase().trim();

    if (t === 'INTERNO' || t.includes('BOMBA INTERNA') || t.includes('ABASTECIMENTO INTERNO')) return 'Interno';
    if (t === 'EXTERNO' || t.includes('POSTO EXTERNO') || t.includes('REDE CREDENCIADA')) return 'Externo';

    if (e.includes('BOMBA INTERNA') || e.includes('GARAGEM') || e.includes('COMBOIO') || /\bINTERNA\b/.test(e)) {
        return 'Interno';
    }
    return 'Externo';
}

function extrairRedePosto(estabelecimento) {
    const e = normalizarTexto(estabelecimento);
    if (!e) return 'OUTROS';

    if (e.includes('BOMBA INTERNA')) return 'BOMBA INTERNA CAVALHEIRO';
    if (e.includes('REDE 7') || e.includes('POSTO 7')) return 'REDE 7';
    if (e.includes('MIRIAN') || e.includes('MIRIAM')) return 'REDE MIRIAN';
    if (e.includes('DOM PEDRO') || e.startsWith('DP ')) return 'REDE DOM PEDRO';
    if (e.includes('MARAJO')) return 'REDE MARAJÓ';
    if (e.includes('DECIO')) return 'REDE DÉCIO';
    if (e.includes('ALDO')) return 'REDE ALDO';
    if (e.includes('PLATINAO')) return 'REDE PLATINÃO';
    if (e.includes('SAO GONCALO')) return 'REDE SÃO GONÇALO';
    if (e.includes('BUFFON')) return 'REDE BUFFON';
    if (e.includes('GRAAL')) return 'REDE GRAAL';
    if (e.includes('POSTO 44')) return 'REDE POSTO 44';
    if (e.includes('MONTE CARLO')) return 'REDE MONTE CARLO';
    if (e.includes('D ANGELIS')) return 'REDE D ANGELIS';
    if (e.includes('REFORCO')) return 'REDE REFORÇO';
    if (e.includes('TREVO') || e.includes('TREVAO')) return 'REDE TREVÃO';
    if (e.includes('SIM REDE')) return 'SIM REDE';
    if (e.includes('REDE DUQUE') || e.includes('DUQUE POSTO')) return 'REDE DUQUE';
    if (e.includes('REDE AZUL')) return 'REDE AZUL';

    const matchRede = e.match(/REDE\s+([A-Z0-9\s]{2,20})/);
    if (matchRede) {
        return `REDE ${matchRede[1].split('|')[0].split('-')[0].trim()}`;
    }
    return 'INDEPENDENTE / OUTROS';
}

function classificarSubtipoCombustivel(combustivel) {
    const c = String(combustivel || '').toUpperCase().trim();
    if (c.includes('ARLA')) return 'Arla 32';
    if (c.includes('S500') || c.includes('COMUM')) return 'Diesel S500';
    if (c.includes('ADITIVADO')) return 'Diesel S10 Aditivado';
    return 'Diesel S10';
}

function extrairIdsEstornadosDaMensagem(idTransacaoAtual, mensagem) {
    const idAtualStr = String(idTransacaoAtual || '').trim();
    const msg = String(mensagem || '');
    const ids = new Set();

    const regex = /transa[cç][aã]o\s*(\d{5,15})/gi;
    let match;
    while ((match = regex.exec(msg)) !== null) {
        const idEncontrado = match[1].trim();
        if (idEncontrado && idEncontrado !== idAtualStr) {
            ids.add(idEncontrado);
        }
    }
    return Array.from(ids);
}

function calcularMetricasHodometro(hodAnt, hodAtual, volume, combustivel, kmPercorridoExplicito = 0) {
    const ant = parseTruckPagNum(hodAnt);
    const atu = parseTruckPagNum(hodAtual);
    const vol = parseTruckPagNum(volume);
    const percorrido = parseTruckPagNum(kmPercorridoExplicito);
    const isArla = String(combustivel || '').toUpperCase().includes('ARLA');

    if (isArla || vol <= 0) {
        return { hodAnt: ant, hodAtu: atu, kmRodado: 0, kmPorLitro: 0 };
    }

    let diffKm = percorrido > 0 ? percorrido : ((ant > 0 && atu > ant) ? Number((atu - ant).toFixed(1)) : 0);
    if (diffKm <= 0) return { hodAnt: ant, hodAtu: atu, kmRodado: 0, kmPorLitro: 0 };

    const media = Number((diffKm / vol).toFixed(2));
    if (diffKm > 3500 || media < 0.8 || media > 7.5) {
        return { hodAnt: ant, hodAtu: atu, kmRodado: 0, kmPorLitro: 0 };
    }
    return { hodAnt: ant, hodAtu: atu, kmRodado: diffKm, kmPorLitro: media };
}

module.exports = {
    obterCNPJEstruturado,
    inspecionarChaveNFe,
    classificarTipoBomba,
    extrairRedePosto,
    classificarSubtipoCombustivel,
    extrairIdsEstornadosDaMensagem,
    calcularMetricasHodometro
};