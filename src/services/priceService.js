const { dbRun, dbAll } = require('../config/database');
const { normalizarTexto } = require('../utils/helpers');
const { normalizarUf } = require('../utils/geoResolver');

// ============================================================================
// SERVIÇO DE PREÇOS NEGOCIADOS E MATRIZ DE VIABILIDADE
// ============================================================================

function encontrarAcordoCompleto(transacao, listaPrecos) {
    if (!listaPrecos || listaPrecos.length === 0) return null;

    const dataIso = String(transacao.data || '').substring(0, 10);
    const estabUp = normalizarTexto(transacao.estabelecimento);
    const cnpjLimpo = String(transacao.cnpj_posto || '').replace(/\D/g, '');
    const redeUp = normalizarTexto(transacao.rede_posto || '');
    const ufUp = normalizarUf(transacao.uf, transacao.estabelecimento, transacao.cidade);
    const combUp = String(transacao.combustivel || '').toUpperCase().trim();
    const isArla = combUp.includes('ARLA');

    const compativelCombustivel = (pCombRaw) => {
        const pComb = String(pCombRaw || '').toUpperCase().trim();
        if (pComb === 'TODOS') return true;
        const pIsArla = pComb.includes('ARLA');
        if (isArla !== pIsArla) return false;
        if (isArla && pIsArla) return true;
        if (pComb === combUp) return true;
        if (pComb.includes('S500') && combUp.includes('S500')) return true;
        if (pComb.includes('S10') && combUp.includes('S10')) return true;
        if (pComb === 'DIESEL' && combUp.includes('DIESEL')) return true;
        return false;
    };

    const dentroDaVigencia = (p) => {
        const ini = String(p.data_vigencia || '2000-01-01').substring(0, 10);
        const fim = String(p.data_fim || '2099-12-31').substring(0, 10);
        return dataIso >= ini && dataIso <= fim;
    };

    const matchPosto = listaPrecos.find(p => {
        const escopo = String(p.escopo || 'POSTO').toUpperCase();
        if (escopo !== 'POSTO') return false;
        const pEstab = normalizarTexto(p.estabelecimento);
        const pCnpj = String(p.cnpj_posto || '').replace(/\D/g, '');
        const mesmoPosto = (pEstab && pEstab === estabUp) || (pCnpj && cnpjLimpo && pCnpj === cnpjLimpo);
        return mesmoPosto && compativelCombustivel(p.combustivel) && dentroDaVigencia(p);
    });
    if (matchPosto) return matchPosto;

    const matchRede = listaPrecos.find(p => {
        const escopo = String(p.escopo || '').toUpperCase();
        const alvo = normalizarTexto(p.rede_posto || p.estabelecimento);
        return escopo === 'REDE' && alvo === redeUp && compativelCombustivel(p.combustivel) && dentroDaVigencia(p);
    });
    if (matchRede) return matchRede;

    const matchUf = listaPrecos.find(p => {
        const escopo = String(p.escopo || '').toUpperCase();
        const alvo = String(p.uf || p.estabelecimento || '').toUpperCase().trim();
        return escopo === 'UF' && alvo === ufUp && compativelCombustivel(p.combustivel) && dentroDaVigencia(p);
    });
    if (matchUf) return matchUf;

    return null;
}

async function aplicarPrecosNegociadosNoBanco() {
    try {
        const precos = await dbAll(`SELECT * FROM precos_negociados ORDER BY data_vigencia DESC, id DESC`);
        if (precos.length === 0) return 0;

        let atualizados = 0;
        for (const tabela of ['analise_transacoes', 'auditoria_transacoes']) {
            const rows = await dbAll(`SELECT id, data, estabelecimento, cidade, cnpj_posto, rede_posto, uf, combustivel, preco_tabela, preco_bomba_referencia FROM ${tabela}`);
            await dbRun("BEGIN TRANSACTION");
            for (const r of rows) {
                const acordo = encontrarAcordoCompleto(r, precos);
                if (acordo && acordo.preco > 0) {
                    const novoNeg = Number(acordo.preco) || 0;
                    const novoBomba = Number(acordo.preco_bomba) > 0 ? Number(acordo.preco_bomba) : novoNeg;
                    if (Number(r.preco_tabela) !== novoNeg || Number(r.preco_bomba_referencia) !== novoBomba) {
                        await dbRun(`UPDATE ${tabela} SET preco_tabela = ?, preco_bomba_referencia = ? WHERE id = ?`, [novoNeg, novoBomba, r.id]);
                        atualizados++;
                    }
                }
            }
            await dbRun("COMMIT");
        }
        return atualizados;
    } catch (err) {
        await dbRun("ROLLBACK").catch(() => {});
        console.error("⚠️ Erro ao recalcular preços negociados:", err.message);
        return 0;
    }
}

module.exports = {
    encontrarAcordoCompleto,
    aplicarPrecosNegociadosNoBanco
};