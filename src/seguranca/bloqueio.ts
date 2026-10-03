// Bloqueio do app: PIN próprio + digital/rosto do celular (WebAuthn / passkey).
// Tudo fica no aparelho. O PIN é guardado só como hash (PBKDF2); a digital é validada
// conferindo a assinatura que o celular devolve com a chave pública guardada no cadastro.

export interface ConfigBloqueio {
  ativo: boolean;
  salt: string;        // base64
  hash: string;        // base64 (PBKDF2-SHA256)
  iter: number;
  cred?: { id: string; pub: string; alg: number }; // digital cadastrada (base64)
  tempo: number;       // segundos fora do app até pedir de novo (0 = sempre)
}

const CHAVE = 'bloqueio';
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const deB64 = (s: string): Uint8Array<ArrayBuffer> => { const t = atob(s); const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
const aleatorio = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export function lerConfig(): ConfigBloqueio | null {
  try { const s = localStorage.getItem(CHAVE); return s ? JSON.parse(s) : null; } catch { return null; }
}
function salvarConfig(c: ConfigBloqueio | null) {
  if (c) localStorage.setItem(CHAVE, JSON.stringify(c)); else localStorage.removeItem(CHAVE);
}
export const bloqueioAtivo = () => !!lerConfig()?.ativo;

async function derivar(pin: string, salt: Uint8Array<ArrayBuffer>, iter: number) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, k, 256);
}

export async function definirPin(pin: string, tempo = 60) {
  const salt = aleatorio(16), iter = 210_000;
  const atual = lerConfig();
  salvarConfig({ ativo: true, salt: b64(salt), hash: b64(await derivar(pin, salt, iter)), iter, cred: atual?.cred, tempo: atual?.tempo ?? tempo });
}

export async function conferirPin(pin: string): Promise<boolean> {
  const c = lerConfig();
  if (!c) return false;
  const h = b64(await derivar(pin, deB64(c.salt), c.iter));
  return h.length === c.hash.length && h === c.hash;
}

export function definirTempo(seg: number) {
  const c = lerConfig(); if (c) salvarConfig({ ...c, tempo: seg });
}

export function desativar() { salvarConfig(null); }

/* ---------- Digital / rosto (WebAuthn) ---------- */

export async function biometriaDisponivel(): Promise<boolean> {
  try {
    return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

export async function cadastrarBiometria(): Promise<void> {
  const c = lerConfig();
  if (!c) throw new Error('Crie o PIN primeiro.');
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: aleatorio(32),
      rp: { name: 'Minha Carteira', id: location.hostname },
      user: { id: aleatorio(16), name: 'carteira', displayName: 'Minha Carteira' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none',
      timeout: 60_000,
    },
  }) as PublicKeyCredential | null;
  if (!cred) throw new Error('Cadastro cancelado.');
  const resp = cred.response as AuthenticatorAttestationResponse;
  const pub = resp.getPublicKey?.();
  const alg = resp.getPublicKeyAlgorithm?.();
  if (!pub || alg == null) throw new Error('Este navegador não informou a chave da digital.');
  salvarConfig({ ...c, cred: { id: b64(cred.rawId), pub: b64(pub), alg } });
}

export function removerBiometria() {
  const c = lerConfig(); if (c) { delete c.cred; salvarConfig(c); }
}

/** Converte assinatura ECDSA em DER para o formato r||s que o WebCrypto espera. */
function derParaRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  let i = 2;
  const ler = () => {
    i++; // 0x02
    const len = der[i++];
    let v = der.slice(i, i + len); i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32); out.set(v, 32 - v.length);
    return out;
  };
  const r = ler(), s = ler();
  const raw = new Uint8Array(64); raw.set(r); raw.set(s, 32);
  return raw;
}

export async function desbloquearComBiometria(): Promise<boolean> {
  const c = lerConfig();
  if (!c?.cred) return false;
  const desafio = aleatorio(32);
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: desafio,
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: deB64(c.cred.id) }],
      userVerification: 'required',
      timeout: 60_000,
    },
  }) as PublicKeyCredential | null;
  if (!cred) return false;
  const r = cred.response as AuthenticatorAssertionResponse;
  // Confere o desafio, o tipo e que o celular de fato verificou você (digital/rosto/PIN do aparelho).
  const cd = JSON.parse(new TextDecoder().decode(r.clientDataJSON));
  const esperado = b64(desafio).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (cd.type !== 'webauthn.get' || cd.challenge !== esperado) return false;
  const auth = new Uint8Array(r.authenticatorData);
  if (!(auth[32] & 0x04)) return false; // flag UV (usuário verificado)
  const hashCd = new Uint8Array(await crypto.subtle.digest('SHA-256', r.clientDataJSON));
  const dados = new Uint8Array(auth.length + hashCd.length); dados.set(auth); dados.set(hashCd, auth.length);
  const sig = new Uint8Array(r.signature);
  if (c.cred.alg === -7) {
    const k = await crypto.subtle.importKey('spki', deB64(c.cred.pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, derParaRaw(sig), dados);
  }
  const k = await crypto.subtle.importKey('spki', deB64(c.cred.pub), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, sig, dados);
}
