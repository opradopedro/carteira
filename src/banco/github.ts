// Lê os arquivos que a rotina do Claude grava num repositório PRIVADO seu no GitHub.
// O token (só leitura, só daquele repositório) fica neste aparelho e não vai no backup.

export interface ConfigGithub { repo: string; pasta: string; token: string }
export interface ArquivoGithub { path: string; sha: string }

const API = 'https://api.github.com';

async function pedir(cfg: ConfigGithub, caminho: string, accept: string): Promise<Response> {
  let r: Response;
  try {
    r = await fetch(`${API}/repos/${cfg.repo.trim()}/contents/${caminho}`, {
      headers: { Authorization: `Bearer ${cfg.token.trim()}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(20000), cache: 'no-store',
    });
  } catch { throw new Error('O GitHub não respondeu. Tente de novo em instantes.'); }
  if (r.status === 401) throw new Error('O GitHub recusou o token. Gere outro e cole em Banco → Conexão.');
  if (r.status === 404) throw new Error(`Não achei ${cfg.repo}/${caminho}. Confira o nome do repositório e da pasta, e se o token tem acesso a ele.`);
  if (r.status === 403) throw new Error('O GitHub bloqueou a leitura (token sem permissão de leitura de conteúdo, ou limite de uso).');
  if (!r.ok) throw new Error(`O GitHub respondeu com erro (${r.status}).`);
  return r;
}

/** Arquivos .json da pasta, em ordem de nome (AAAA-MM-DD.json = ordem de data). */
export async function listarArquivos(cfg: ConfigGithub): Promise<ArquivoGithub[]> {
  const r = await pedir(cfg, encodeURI(cfg.pasta.replace(/^\/+|\/+$/g, '')), 'application/vnd.github+json');
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error('O caminho informado é um arquivo, não uma pasta.');
  return (j as { type: string; name: string; path: string; sha: string }[])
    .filter(x => x.type === 'file' && x.name.endsWith('.json'))
    .map(x => ({ path: x.path, sha: x.sha }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function baixarArquivo(cfg: ConfigGithub, path: string): Promise<string> {
  return (await pedir(cfg, encodeURI(path), 'application/vnd.github.raw')).text();
}
