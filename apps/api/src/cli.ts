import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { hashPassword } from 'better-auth/crypto';
import { createUserSchema } from '@orium/contracts';
import { connectDatabase, assertApplicationDatabase } from './db.js';
import { migrateDatabase } from './migrate.js';
import { IDENTITY_LOCK } from './identity.js';
import { recoverUserAccess } from './recovery.js';
import { runAgentCommand } from './agent.js';

async function hiddenPassword(label: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Terminal interativo obrigatório.');
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    let inEscape = false;
    let escapeType = '';
    const finish = (aborted: boolean) => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (aborted) reject(new Error('Entrada cancelada.'));
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') { finish(true); return; }
        if (inEscape) {
          if (!escapeType) {
            if (char === '[' || char === 'O') escapeType = char;
            else inEscape = false;
          } else if (escapeType === '[') {
            if (char >= '@' && char <= '~') inEscape = false;
          } else if (escapeType === 'O') {
            inEscape = false;
          }
          continue;
        }
        if (char === '\u001b') { inEscape = true; escapeType = ''; continue; }
        if (char === '\r' || char === '\n') { finish(false); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && value.length < 256) value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function askQuestion(query: string): Promise<string> {
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await reader.question(query);
  } finally {
    reader.close();
  }
}

async function bootstrap() {
  if (!process.stdin.isTTY) throw new Error('Terminal interativo obrigatório.');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL obrigatória.');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('DATABASE_URL inválida.');
  }
  if (!['postgresql:', 'postgres:'].includes(parsedUrl.protocol)) {
    throw new Error('Protocolo PostgreSQL obrigatório para banco de dados.');
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsedUrl.hostname)) {
    throw new Error('Banco loopback local obrigatório.');
  }

  const database = connectDatabase(url);
  try {
    await assertApplicationDatabase(database);
    const preCheck = await database.pool.query('SELECT id FROM auth_user LIMIT 1');
    if (preCheck.rowCount) throw new Error('Bootstrap somente em banco sem usuários; não é recuperação.');

    const inputs: { id: string; name: string; email: string; passwordHash: string }[] = [];
    for (const name of ['Arino', 'Monique']) {
      const email = await askQuestion(`E-mail de ${name}: `);
      const password = await hiddenPassword(`Senha de ${name} (entrada oculta): `);
      const confirm = await hiddenPassword('Confirme a senha (entrada oculta): ');
      if (password !== confirm) throw new Error('Confirmação não corresponde.');
      const validated = createUserSchema.parse({ name, email, password, role: 'administrator' });
      inputs.push({ id: randomUUID(), name, email: validated.email, passwordHash: await hashPassword(validated.password) });
    }
    if (inputs[0]?.email === inputs[1]?.email) throw new Error('E-mails precisam ser distintos.');

    const client = await database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [IDENTITY_LOCK]);
      const existing = await client.query('SELECT id FROM auth_user LIMIT 1');
      if (existing.rowCount) throw new Error('Bootstrap somente em banco sem usuários; não é recuperação.');
      for (const input of inputs) {
        await client.query('INSERT INTO auth_user(id,name,email) VALUES($1,$2,$3)', [input.id, input.name, input.email]);
        await client.query('INSERT INTO auth_account(id,account_id,provider_id,user_id,password) VALUES($1,$2,$3,$2,$4)', [randomUUID(), input.id, 'credential', input.passwordHash]);
        await client.query('INSERT INTO user_role(user_id,role_id) VALUES($1,$2)', [input.id, 'administrator']);
      }
      await client.query('COMMIT');
      console.log('Administradores iniciais criados. Nenhuma senha foi exibida.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await database.pool.end();
  }
}

async function recoverCLI() {
  if (!process.stdin.isTTY) throw new Error('Recuperação requer terminal interativo.');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL obrigatória.');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('DATABASE_URL inválida.');
  }
  if (!['postgresql:', 'postgres:'].includes(parsedUrl.protocol)) {
    throw new Error('Protocolo PostgreSQL obrigatório para banco de dados.');
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsedUrl.hostname)) {
    throw new Error('Banco loopback local obrigatório.');
  }

  const database = connectDatabase(url);
  try {
    await assertApplicationDatabase(database);

    const adminEmail = await askQuestion('E-mail do administrador autorizador: ');
    const adminPassword = await hiddenPassword('Senha atual do administrador autorizador (entrada oculta): ');
    const targetEmail = await askQuestion('E-mail da conta a ser recuperada: ');
    const newPassword = await hiddenPassword('Nova senha da conta (entrada oculta): ');
    const confirmPassword = await hiddenPassword('Confirme a nova senha (entrada oculta): ');
    if (newPassword !== confirmPassword) {
      throw new Error('Confirmação da nova senha não confere.');
    }

    const receipt = await recoverUserAccess(database, {
      adminEmail,
      adminPassword,
      targetEmail,
      newPassword,
    });

    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    await database.pool.end();
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Orium Agent: `agent <comando>` com entrada JSON (argumento ou stdin) e saída JSON. Nunca lança. */
async function agentCLI() {
  const command = process.argv[3] ?? '';
  let input: Record<string, unknown> = {};
  try {
    const raw = process.argv[4] ?? (await readStdin());
    input = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('not an object');
  } catch {
    console.log(JSON.stringify({ ok: false, code: 'INVALID_JSON', message: 'A entrada precisa ser um objeto JSON.' }));
    process.exitCode = 2;
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, code: 'CONFIG', message: 'DATABASE_URL ausente no ambiente do agente.' }));
    process.exitCode = 1;
    return;
  }
  const database = connectDatabase(url);
  try {
    await assertApplicationDatabase(database);
    const result = await runAgentCommand(database, command, input);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : (result as { needsClarification?: boolean }).needsClarification ? 2 : 1;
  } catch {
    console.log(JSON.stringify({ ok: false, code: 'INTERNAL_ERROR', message: 'Falha ao conectar no banco com a identidade da aplicação.' }));
    process.exitCode = 1;
  } finally {
    await database.pool.end();
  }
}

async function main() {
  if (process.argv[2] === 'migrate') {
    if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL necessária.');
    await migrateDatabase(process.env.MIGRATION_DATABASE_URL, process.env.MIGRATION_APP_ROLE);
    console.log('Migrations aplicadas.');
  } else if (process.argv[2] === 'bootstrap') await bootstrap();
  else if (process.argv[2] === 'recover') await recoverCLI();
  else if (process.argv[2] === 'agent') await agentCLI();
  else throw new Error('Comando desconhecido.');
}
const KNOWN_SAFE_MESSAGES = new Set([
  'Terminal interativo obrigatório.',
  'DATABASE_URL obrigatória.',
  'DATABASE_URL inválida.',
  'Protocolo PostgreSQL obrigatório para banco de dados.',
  'Banco loopback local obrigatório.',
  'Identidade do banco inadequada para aplicação.',
  'Bootstrap somente em banco sem usuários; não é recuperação.',
  'Confirmação não corresponde.',
  'Confirmação da nova senha não confere.',
  'E-mails precisam ser distintos.',
  'Administrador autorizador não encontrado ou inativo.',
  'Administrador autorizador não possui papel administrator e permissão roles.manage.',
  'Credencial do administrador autorizador inválida ou ambígua.',
  'Falha na autenticação do administrador autorizador: senha incorreta.',
  'Conta alvo não encontrada.',
  'Conta alvo inativa. Recuperação não reativa contas.',
  'Conta alvo não possui credencial local associada.',
  'Ambiguidade detectada: múltiplas credenciais locais para a conta alvo.',
  'Dados de recuperação inválidos. A nova senha deve ter entre 1 e 128 caracteres.',
  'Entrada cancelada.',
  'Comando desconhecido.',
  'MIGRATION_DATABASE_URL necessária.',
  'Usar migrator local separado.',
  'Papel SQL inválido.',
]);

main().catch((error) => {
  const safeMessage = error instanceof Error && KNOWN_SAFE_MESSAGES.has(error.message)
    ? `: ${error.message}`
    : '. Confira configuração, migrations, estado do banco e entradas.';
  console.error(`Operação administrativa falhou${safeMessage} Detalhes sensíveis omitidos.`);
  process.exitCode = 1;
});
