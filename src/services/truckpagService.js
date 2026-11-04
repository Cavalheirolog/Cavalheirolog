require('dotenv').config();
const axios = require('axios');
const { delay } = require('../utils/helpers');

// ============================================================================
// SERVIÇO DE INTEGRAÇÃO COM A API TRUCKPAG
// ============================================================================

const API_BASE = (process.env.TRUCKPAG_API_URL || 'https://api.truckpag.com.br').replace(/\/$/, '');

let tokenCache = null;
let tokenExpiraEm = 0;

async function auth(forcarRenovacao = false) {
    if (!forcarRenovacao && tokenCache && Date.now() < tokenExpiraEm - 300000) return tokenCache;
    try {
        const user = process.env.TRUCKPAG_USER;
        const pass = process.env.TRUCKPAG_PASS_MD5;
        const authHeader = Buffer.from(`${user}:${pass}`).toString('base64');
        const res = await axios.post(`${API_BASE}/auth`, null, {
            headers: { 'Authorization': `Basic ${authHeader}` },
            timeout: 60000
        });
        tokenCache = res.data.token || res.data.access_token || res.data;
        tokenExpiraEm = res.data.expires ? (res.data.expires * 1000) : Date.now() + (3 * 60 * 60 * 1000);
        return tokenCache;
    } catch (err) {
        console.error(`❌ ERRO Auth TruckPag: ${err.message}`);
        throw new Error("Falha na autenticação com a API TruckPag.");
    }
}

async function fetchComRetentativa(url, headers, maxTentativas = 3) {
    for (let i = 0; i < maxTentativas; i++) {
        try {
            const res = await axios.get(url, { headers, timeout: 60000 });
            return res.data;
        } catch (err) {
            const status = err.response ? err.response.status : null;
            if ([401, 403].includes(status)) {
                await delay(1500);
                const novoToken = await auth(true);
                headers['Authorization'] = `Bearer ${novoToken}`;
                continue;
            }
            if ([400, 404].includes(status)) return null;
            await delay(2500 * (i + 1));
        }
    }
    return null;
}

async function baixarUnicoDia(dtIso, token) {
    const headers = { 'Authorization': `Bearer ${token}` };
    const dtCompacta = dtIso.replace(/-/g, '');
    const transacoesDoDia = [];
    const notasDoDia = [];
    const idsTransBaixados = new Set();
    const idsNotasBaixadas = new Set();

    let pagTrans = 1;
    while (true) {
        const offset = (pagTrans - 1) * 500;
        const paramsTrans = `?todas=S&dtini=${dtCompacta}&dtfim=${dtCompacta}&pagina=${pagTrans}&page=${pagTrans}&limit=500&offset=${offset}`;
        const dataTrans = await fetchComRetentativa(`${API_BASE}/Transacoes${paramsTrans}`, headers);
        if (!dataTrans) break;

        const loteTrans = Array.isArray(dataTrans) ? dataTrans : (dataTrans.Transacoes || dataTrans.data || []);
        if (!Array.isArray(loteTrans) || loteTrans.length === 0) break;

        let novos = 0;
        loteTrans.forEach(t => {
            const idStr = String(t.Transacao || t.IdTransacao || t.id || '').trim();
            if (idStr && !idsTransBaixados.has(idStr)) {
                idsTransBaixados.add(idStr);
                transacoesDoDia.push(t);
                novos++;
            }
        });

        if (novos === 0 || loteTrans.length < 500) break;
        pagTrans++;
        await delay(1100);
    }

    if (transacoesDoDia.length > 0) {
        await delay(900);
        let pagNfe = 1;
        while (true) {
            const offset = (pagNfe - 1) * 500;
            const paramsNfe = `?todas=S&dtIni=${dtIso}&dtFim=${dtIso}&pagina=${pagNfe}&page=${pagNfe}&limit=500&offset=${offset}`;
            const dataNfe = await fetchComRetentativa(`${API_BASE}/NotaFiscal/Vinculo${paramsNfe}`, headers);
            if (!dataNfe) break;

            const loteNotas = Array.isArray(dataNfe) ? dataNfe : (dataNfe.Notas || dataNfe.Vinculos || dataNfe.data || []);
            if (!Array.isArray(loteNotas) || loteNotas.length === 0) break;

            let novasNotas = 0;
            loteNotas.forEach(n => {
                const idTr = String(n.IdTransacao || n.Transacao || '').trim();
                const chave = String(n.ChaveNFe || n.chave_nfe || '').trim();
                const uk = `${idTr}_${chave}`;
                if (idTr && !idsNotasBaixadas.has(uk)) {
                    idsNotasBaixadas.add(uk);
                    notasDoDia.push(n);
                    novasNotas++;
                }
            });

            if (novasNotas === 0 || loteNotas.length < 500) break;
            pagNfe++;
            await delay(1100);
        }
    }

    return { dtIso, transacoes: transacoesDoDia, notas: notasDoDia };
}

module.exports = {
    auth,
    fetchComRetentativa,
    baixarUnicoDia
};