import { openDB, type IDBPDatabase } from 'idb';
import type { Lancamento, Precos } from '../core/types';
import type { SerieDiaria, SerieMensal } from '../core/perf';

/** Tudo fica no aparelho, no IndexedDB do navegador. */
export interface Config {
  brapiToken?: string;
  cgKey?: string;
  tema?: 'auto' | 'claro' | 'escuro';
}

export interface Indices {
  cdi: SerieDiaria;
  ipca: SerieMensal;
  selic: number | null;
  em: string;
}

interface KV {
  precos: Precos;
  config: Config;
  indices: Indices;
  cotEm: string;
}

let dbp: Promise<IDBPDatabase> | null = null;
const db = () =>
  (dbp ||= openDB('carteira', 1, {
    upgrade(d) {
      d.createObjectStore('lancs', { keyPath: 'id' });
      d.createObjectStore('kv');
    },
  }));

export async function getLancs(): Promise<Lancamento[]> {
  return (await db()).getAll('lancs');
}

export async function putLancs(ls: Lancamento[]): Promise<void> {
  const tx = (await db()).transaction('lancs', 'readwrite');
  await Promise.all([...ls.map(l => tx.store.put(l)), tx.done]);
}

export async function deleteLanc(id: string): Promise<void> {
  await (await db()).delete('lancs', id);
}

export async function replaceAllLancs(ls: Lancamento[]): Promise<void> {
  const tx = (await db()).transaction('lancs', 'readwrite');
  await tx.store.clear();
  await Promise.all([...ls.map(l => tx.store.put(l)), tx.done]);
}

export async function getKV<K extends keyof KV>(k: K): Promise<KV[K] | undefined> {
  return (await db()).get('kv', k);
}

export async function setKV<K extends keyof KV>(k: K, v: KV[K]): Promise<void> {
  await (await db()).put('kv', v, k);
}

export async function clearAll(): Promise<void> {
  const d = await db();
  await d.clear('lancs');
  await d.clear('kv');
}

/** Pede ao navegador para não apagar os dados quando faltar espaço. */
export async function requestPersist(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
