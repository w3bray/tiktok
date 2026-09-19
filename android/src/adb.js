import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseDump } from './ui.js';
import { decodePng } from './png.js';

const run = promisify(execFile);

/** Fachada fina sobre o adb: tudo que o bot faz no aparelho passa por aqui. */
export class Adb {
  constructor({ binary = 'adb', serial = '' } = {}) {
    this.binary = binary;
    this.serial = serial;
  }

  #args(args) {
    return this.serial ? ['-s', this.serial, ...args] : args;
  }

  async text(args, options = {}) {
    const { stdout } = await run(this.binary, this.#args(args), {
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    });
    return stdout.toString();
  }

  async binaryOut(args) {
    const { stdout } = await run(this.binary, this.#args(args), {
      maxBuffer: 256 * 1024 * 1024,
      encoding: 'buffer',
    });
    return stdout;
  }

  shell(command) {
    return this.text(['shell', ...command]);
  }

  /** Aparelhos autorizados. `unauthorized` significa aceitar o RSA no celular. */
  async devices() {
    const out = await this.text(['devices']);
    return out
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 2 && parts[0])
      .map(([serial, state]) => ({ serial, state }));
  }

  async screenSize() {
    const out = await this.shell(['wm', 'size']);
    const match = /(\d+)x(\d+)/.exec(out);
    if (!match) throw new Error(`Nao consegui ler o tamanho da tela: ${out.trim()}`);
    return { width: Number(match[1]), height: Number(match[2]) };
  }

  async installedPackages() {
    const out = await this.shell(['pm', 'list', 'packages']);
    return out
      .split(/\r?\n/)
      .map((line) => line.replace('package:', '').trim())
      .filter(Boolean);
  }

  async currentPackage() {
    const out = await this.shell(['dumpsys', 'window']);
    const match = /mCurrentFocus=.*?\{[^}]*\s([\w.]+)\//.exec(out);
    return match ? match[1] : '';
  }

  launch(pkg) {
    return this.shell(['monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
  }

  tap(x, y) {
    return this.shell(['input', 'tap', String(x), String(y)]);
  }

  swipe(x1, y1, x2, y2, ms = 300) {
    return this.shell(['input', 'swipe', ...[x1, y1, x2, y2, ms].map(String)]);
  }

  back() {
    return this.shell(['input', 'keyevent', '4']);
  }

  /**
   * `exec-out` evita a traducao de CRLF que corrompe a saida binaria e,
   * no dump, o texto vem seguido de "UI hierchary dumped to: ...".
   */
  async dump() {
    const out = await this.binaryOut(['exec-out', 'uiautomator', 'dump', '/dev/tty']);
    return parseDump(out.toString('utf8'));
  }

  async screenshot() {
    return decodePng(await this.binaryOut(['exec-out', 'screencap', '-p']));
  }
}
