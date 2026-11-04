const { dbGet, dbRun } = require('../config/database');

// ============================================================================
// CONTROLADOR DE AUTENTICAÇÃO E USUÁRIOS
// ============================================================================

async function login(req, res) {
    try {
        const { username, passwordHash } = req.body;
        
        if (!username || !passwordHash) {
            return res.status(400).json({ ok: false, error: 'Usuário e senha são obrigatórios.' });
        }

        const user = await dbGet(`SELECT * FROM usuarios_sistema WHERE username = ?`, [username]);
        
        if (user && user.password_hash === passwordHash) {
            const perms = user.perms_json ? JSON.parse(user.perms_json) : {};
            return res.json({ ok: true, username: user.username, perms });
        } else {
            return res.status(401).json({ ok: false, error: 'Credenciais inválidas.' });
        }
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
}

async function salvarUsuario(req, res) {
    try {
        const { username, passwordHash, perms } = req.body;
        
        if (!username || !passwordHash) {
            return res.status(400).json({ ok: false, error: 'Usuário e senha são obrigatórios.' });
        }

        const permsJson = JSON.stringify(perms || {});
        const isAdmin = username === 'pedro.cavalheirolog' ? 1 : 0;

        await dbRun(
            `INSERT OR REPLACE INTO usuarios_sistema (username, password_hash, is_admin, perms_json, criado_em) 
             VALUES (?, ?, ?, ?, datetime('now', 'localtime'))`,
            [username, passwordHash, isAdmin, permsJson]
        );

        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
}

module.exports = { login, salvarUsuario };