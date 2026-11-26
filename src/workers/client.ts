import type { WorkerRequest, WorkerResponse } from './judge.worker';

let worker: Worker | null = null;
let seq = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./judge.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve((msg as { payload?: unknown }).payload);
    else p.reject(new Error(msg.error));
  };
  worker.onerror = (e) => {
    for (const [, p] of pending) p.reject(new Error(e.message || 'Worker 错误'));
    pending.clear();
  };
  return worker;
}

export function callWorker<T = unknown>(
  type: WorkerRequest['type'],
  extra: Record<string, unknown> = {},
): Promise<T> {
  const w = getWorker();
  const id = seq++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, type, ...extra } as WorkerRequest);
  });
}
