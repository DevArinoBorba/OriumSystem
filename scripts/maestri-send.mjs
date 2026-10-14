import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '..');
const receipts = path.join(root, '.local', 'maestri-messages');
const args = process.argv.slice(2);
const writeReceipt = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');

async function runWorker(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid receipt ID');
  const file = path.join(receipts, `${id}.json`);
  const receipt = JSON.parse(await readFile(file, 'utf8'));
  let cli;
  try {
    const message = await readFile(receipt.messageFile, 'utf8');
    receipt.state = 'running';
    receipt.startedAt = new Date().toISOString();
    await writeReceipt(file, receipt);
    cli = spawn(process.env.MAESTRI_CLI || 'maestri', ['ask', receipt.agent, message.trim()], {
      cwd: root, shell: false, windowsHide: true, stdio: 'ignore',
    });
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        cli.kill(); // Only this helper's own CLI child; never the recipient agent.
        resolve({ state: 'timeout', exitCode: null });
      }, 15 * 60 * 1000);
      cli.once('error', () => { clearTimeout(timer); resolve({ state: 'failed', exitCode: null }); });
      cli.once('exit', (code) => {
        clearTimeout(timer);
        resolve({ state: code === 0 ? 'completed' : 'failed', exitCode: code });
      });
    });
    Object.assign(receipt, result, { finishedAt: new Date().toISOString() });
    await writeReceipt(file, receipt);
  } catch {
    Object.assign(receipt, { state: 'failed', finishedAt: new Date().toISOString(), exitCode: null });
    await writeReceipt(file, receipt);
  }
  if (receipt.state === 'failed' || receipt.state === 'timeout') {
    // Required first diagnosis on a Maestri failure; no terminal content or secrets persisted.
    const debug = spawn(process.env.MAESTRI_CLI || 'maestri', ['debug'], {
      cwd: root, shell: false, windowsHide: true, stdio: 'ignore',
    });
    debug.once('error', () => {});
  }
}

async function main() {
  if (args[0] === '--worker' && args.length === 2) return runWorker(args[1]);
  if (args.length !== 4 || args[0] !== '--agent' || args[2] !== '--message-file' || !args[1].trim()) {
    throw new Error('Usage: node scripts/maestri-send.mjs --agent "Name" --message-file project-file.txt');
  }
  const agent = args[1];
  const messageFile = path.resolve(root, args[3]);
  const relative = path.relative(root, messageFile);
  if (relative.startsWith('..') || path.isAbsolute(relative) || /^\.env(?:\.|$)/i.test(path.basename(messageFile))) {
    throw new Error('Message file must be inside this project and cannot be an environment file');
  }
  const message = (await readFile(messageFile, 'utf8')).trim();
  if (!message || message.length > 12000) throw new Error('Message must contain 1..12000 characters');
  await mkdir(receipts, { recursive: true });
  const id = randomUUID();
  const receiptFile = path.join(receipts, `${id}.json`);
  await writeReceipt(receiptFile, { id, agent, messageFile, state: 'queued', queuedAt: new Date().toISOString() });
  const worker = spawn(process.execPath, [script, '--worker', id], {
    cwd: root, shell: false, detached: true, windowsHide: true, stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    worker.once('spawn', resolve);
    worker.once('error', reject);
  });
  worker.unref();
  console.log(JSON.stringify({ id, state: 'queued', receiptFile }));
}

main().catch((error) => {
  console.error(error.message === 'Usage: node scripts/maestri-send.mjs --agent "Name" --message-file project-file.txt'
    ? error.message : 'Unable to enqueue Maestri message. Check arguments and project file.');
  process.exitCode = 1;
});
