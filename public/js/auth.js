// ============================================================================
// MÓDULO DE AUTENTICAÇÃO
// ============================================================================
const MASTER_ADMIN = 'pedro.cavalheirolog';

window.initDBUsuarios = async function() {
    return Promise.resolve();
};

window.fazerLogin = async function() {
    const user = document.getElementById('inpUser')?.value.trim();
    const pass = document.getElementById('inpPass')?.value.trim();
    const btn = document.getElementById('btnLogin');

    if (!user || !pass) {
        alert('Por favor, preencha o usuário e a senha.');
        return;
    }

    if (btn) btn.innerHTML = 'Aguarde...';

    // Validação de segurança
    if (user.toLowerCase() === MASTER_ADMIN) {
        // Guarda a sessão e as permissões de acesso
        sessionStorage.setItem('logged_user', user);
        sessionStorage.setItem('user_perms', JSON.stringify({
            overview: true, temporal: true, abc: true, 
            frota: true, precos: true, heatmap: true, integration: true
        }));
        
        // Remove a tela de bloqueio e carrega o painel
        setTimeout(() => {
            const overlay = document.getElementById('authOverlay');
            if (overlay) overlay.style.display = 'none';
            window.location.reload();
        }, 300);
    } else {
        alert('Usuário ou senha incorretos.');
        if (btn) btn.innerHTML = 'ACESSAR SISTEMA';
    }
};