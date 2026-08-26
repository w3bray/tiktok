import fs from 'node:fs';
import path from 'node:path';

const COLORS = {
  info: '\x1b[36m',
  ok: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  step: '\x1b[35m',
};
const RESET = '\x1b[0m';

export class Logger {
  constructor(logsDir) {
    fs.mkdirSync(logsDir, { recursive: true });
    this.file = path.join(logsDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  }

  #write(level, message, data) {
    const entry = { ts: new Date().toISOString(), level, message, ...(data ? { data } : {}) };
    fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`);
  }

  #print(level, message) {
    const time = new Date().toLocaleTimeString('pt-BR');
    console.log(`${COLORS[level] ?? ''}[${time}] ${message}${RESET}`);
  }

  info(message, data) {
    this.#print('info', message);
    this.#write('info', message, data);
  }

  ok(message, data) {
    this.#print('ok', `✓ ${message}`);
    this.#write('ok', message, data);
  }

  warn(message, data) {
    this.#print('warn', `! ${message}`);
    this.#write('warn', message, data);
  }

  error(message, data) {
    this.#print('error', `✗ ${message}`);
    this.#write('error', message, data);
  }

  step(message, data) {
    this.#print('step', `\n▶ ${message}`);
    this.#write('step', message, data);
  }
}
