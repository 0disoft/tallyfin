import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export interface ChildSpec { args: string[]; cwd: string; env?: NodeJS.ProcessEnv }
interface Ready { type: 'ready'; url: string }
function launch(spec: ChildSpec) {
  const child = spawn(process.execPath, spec.args, { cwd: spec.cwd, env: spec.env ?? process.env,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true });
  const exited = new Promise<void>(resolve => {
    child.once('close', () => resolve());
    child.once('error', () => resolve());
  });
  const ready = new Promise<Ready>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Development server startup timed out')), 45_000);
    child.on('message', message => {
      if (message && typeof message === 'object' && 'type' in message && message.type === 'ready' &&
        'url' in message && typeof message.url === 'string') {
        clearTimeout(timer); resolve({ type: 'ready', url: message.url });
      }
    });
    void exited.then(() => { clearTimeout(timer); reject(Error('Development server stopped')); });
  });
  return { child, exited, ready };
}
async function forceStop(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('close', () => resolve()); killer.once('error', () => { child.kill(); resolve(); });
    });
  } else child.kill('SIGKILL');
}
async function stop(handle: ReturnType<typeof launch>) {
  if (handle.child.connected) {
    try { handle.child.send({ type: 'shutdown' }, () => {}); } catch { /* process already exited */ }
  }
  const timer = setTimeout(() => { void forceStop(handle.child); }, 10_000);
  try { await handle.exited; } finally { clearTimeout(timer); }
}

/** Owns only the children it launches. No global port/process termination. */
export async function supervise(specs: ChildSpec[], onReady: (servers: Ready[]) => void, signal: AbortSignal) {
  if (signal.aborted) return;
  const handles = specs.map(launch);
  let removeAbort = () => {};
  const aborted = new Promise<'aborted'>(resolve => {
    const listener = () => resolve('aborted');
    signal.addEventListener('abort', listener, { once: true });
    removeAbort = () => signal.removeEventListener('abort', listener);
    if (signal.aborted) listener();
  });
  try {
    const ready = await Promise.race([Promise.all(handles.map(handle => handle.ready)), aborted]);
    if (ready === 'aborted') return;
    onReady(ready);
    const ended = await Promise.race([aborted, ...handles.map(handle => handle.exited)]);
    if (ended !== 'aborted') throw Error('Development server stopped');
  } finally {
    removeAbort();
    await Promise.all(handles.map(stop));
  }
}
