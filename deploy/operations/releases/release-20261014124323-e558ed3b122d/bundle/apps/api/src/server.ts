import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { assertApplicationDatabase, connectDatabase } from './db.js';

async function main() {
  const config = loadConfig();
  const database = connectDatabase(config.DATABASE_URL);
  try {
    await assertApplicationDatabase(database);
    const app = await buildApp({ config, database });
    app.addHook('onClose', async () => { await database.pool.end(); });
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      await app.close();
    };
    process.once('SIGINT', () => { void close(); });
    process.once('SIGTERM', () => { void close(); });
    await app.listen({ host: config.API_HOST, port: config.API_PORT });
  } catch {
    await database.pool.end();
    throw new Error('API não iniciou; verificar configuração local, banco e migrations.');
  }
}
main().catch(() => { console.error('Falha de inicialização da API. Nenhum detalhe sensível foi registrado.'); process.exitCode = 1; });
