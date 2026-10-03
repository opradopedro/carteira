// Tela de bloqueio: aparece ao abrir o app e ao voltar depois do tempo configurado.
import { conferirPin, desbloquearComBiometria, desativar, lerConfig } from './bloqueio';

let aberta: Promise<void> | null = null;

const FALHAS = 'bloqueioFalhas';
function lerFalhas(): { n: number; ate: number } {
  try { return JSON.parse(localStorage.getItem(FALHAS) || '') || { n: 0, ate: 0 }; } catch { return { n: 0, ate: 0 }; }
}
const salvarFalhas = (f: { n: number; ate: number }) => { try { localStorage.setItem(FALHAS, JSON.stringify(f)); } catch { /* ignora */ } };

/** Mostra a tela de bloqueio e resolve quando o usuário desbloquear. */
export function mostrarBloqueio(): Promise<void> {
  if (aberta) return aberta;
  aberta = new Promise<void>(resolve => {
    const cfg = lerConfig();
    const el = document.createElement('div');
    el.id = 'lock';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'App bloqueado');
    el.innerHTML = `
      <div class="lock-box">
        <img src="${import.meta.env.BASE_URL}icons/icon.svg" alt="" width="64" height="64">
        <h1>Minha Carteira</h1>
        <div class="sub">Desbloqueie para ver seus investimentos.</div>
        ${cfg?.cred ? '<button type="button" class="btn primary lock-bio" id="lockBio">Usar digital ou rosto</button>' : ''}
        <form id="lockForm" autocomplete="off">
          <input id="lockPin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="12" placeholder="PIN do app" aria-label="PIN do app" autocomplete="off">
          <button class="btn ${cfg?.cred ? '' : 'primary'}" type="submit">Entrar</button>
        </form>
        <div class="err" id="lockErr" hidden></div>
        <button type="button" class="lock-esqueci" id="lockEsqueci">Esqueci o PIN</button>
      </div>`;
    document.body.appendChild(el);
    document.body.classList.add('bloqueado');
    const err = el.querySelector<HTMLElement>('#lockErr')!;
    const pin = el.querySelector<HTMLInputElement>('#lockPin')!;
    const erro = (m: string) => { err.textContent = m; err.hidden = false; };

    const liberar = () => {
      salvarFalhas({ n: 0, ate: 0 });
      el.classList.add('saindo');
      document.body.classList.remove('bloqueado', 'coberto');
      setTimeout(() => el.remove(), 200);
      aberta = null;
      resolve();
    };
    const bio = async () => {
      try { if (await desbloquearComBiometria()) liberar(); else erro('Não foi possível confirmar. Tente de novo ou use o PIN.'); }
      catch { erro('Digital cancelada. Use o PIN ou toque em "Usar digital" de novo.'); }
    };
    el.querySelector('#lockBio')?.addEventListener('click', bio);
    el.querySelector('#lockForm')!.addEventListener('submit', async e => {
      e.preventDefault();
      const f = lerFalhas();
      if (Date.now() < f.ate) { erro(`Muitas tentativas. Espere ${Math.ceil((f.ate - Date.now()) / 1000)} s.`); return; }
      if (await conferirPin(pin.value)) { liberar(); return; }
      const n = f.n + 1;
      const espera = n >= 5 ? 30_000 * 2 ** (n - 5) : 0;
      salvarFalhas({ n, ate: Date.now() + espera });
      pin.value = '';
      erro(espera ? `PIN errado. Espere ${espera / 1000} s para tentar de novo.` : 'PIN errado.');
    });
    const esq = el.querySelector<HTMLButtonElement>('#lockEsqueci')!;
    esq.addEventListener('click', () => {
      if (esq.dataset.armed) {
        // Sem servidor não há como recuperar: apaga tudo deste aparelho (restaure um backup depois).
        desativar();
        try { localStorage.clear(); } catch { /* ignora */ }
        const req = indexedDB.deleteDatabase('carteira');
        req.onsuccess = req.onerror = req.onblocked = () => location.reload();
        return;
      }
      esq.dataset.armed = '1';
      esq.textContent = 'Sem o PIN, o único jeito é apagar os dados deste aparelho e restaurar um backup. Toque de novo para apagar tudo.';
    });
    if (cfg?.cred) setTimeout(bio, 300); else setTimeout(() => pin.focus(), 300);
  });
  return aberta;
}

export const bloqueioAberto = () => !!aberta;
