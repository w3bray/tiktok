/**
 * Testa o wrapper do adb contra um binario falso: confere o parsing das
 * saidas reais dos comandos e se os argumentos saem na ordem certa
 * (inclusive o -s <serial>). Nao precisa de adb nem de aparelho.
 *
 *   node test/android-adb.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Adb } from '../android/src/adb.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-adb-'));
const log = path.join(dir, 'chamadas.txt');
const binary = path.join(dir, 'adb');

fs.writeFileSync(
  binary,
  `#!/bin/sh
echo "$*" >> ${JSON.stringify(log)}
case "$*" in
  *"devices"*)
    printf 'List of devices attached\\nABC123\\tdevice\\nZZZ999\\tunauthorized\\n' ;;
  *"wm size"*)
    printf 'Physical size: 1080x2400\\n' ;;
  *"pm list packages"*)
    printf 'package:com.android.settings\\npackage:com.zhiliaoapp.musically\\n' ;;
  *"dumpsys window"*)
    printf 'mCurrentFocus=Window{a1b2 u0 com.zhiliaoapp.musically/com.ss.android.ugc.aweme.main.MainActivity}\\n' ;;
esac
`,
  { mode: 0o755 },
);

const adb = new Adb({ binary, serial: 'ABC123' });
let checks = 0;

const check = async (name, fn) => {
  await fn();
  checks += 1;
  console.log(`  ok ${name}`);
};

const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n');

await check('lista aparelhos e separa os nao autorizados', async () => {
  const devices = await adb.devices();
  assert.deepEqual(devices, [
    { serial: 'ABC123', state: 'device' },
    { serial: 'ZZZ999', state: 'unauthorized' },
  ]);
});

await check('le o tamanho da tela', async () => {
  assert.deepEqual(await adb.screenSize(), { width: 1080, height: 2400 });
});

await check('lista pacotes instalados sem o prefixo package:', async () => {
  const packages = await adb.installedPackages();
  assert.ok(packages.includes('com.zhiliaoapp.musically'));
  assert.equal(
    packages.some((name) => name.startsWith('package:')),
    false,
  );
});

await check('extrai o pacote em primeiro plano', async () => {
  assert.equal(await adb.currentPackage(), 'com.zhiliaoapp.musically');
});

await check('monta os argumentos de toque, swipe e voltar', async () => {
  const before = calls().length;
  await adb.tap(120, 340);
  await adb.swipe(1, 2, 3, 4, 250);
  await adb.back();

  const novos = calls().slice(before);
  assert.deepEqual(novos, [
    '-s ABC123 shell input tap 120 340',
    '-s ABC123 shell input swipe 1 2 3 4 250',
    '-s ABC123 shell input keyevent 4',
  ]);
});

await check('sem serial, nao passa -s', async () => {
  const semSerial = new Adb({ binary });
  const before = calls().length;
  await semSerial.tap(5, 6);
  assert.deepEqual(calls().slice(before), ['shell input tap 5 6']);
});

await check('erro de tela ilegivel e explicito', async () => {
  const quebrado = new Adb({ binary: path.join(dir, 'nao-existe') });
  await assert.rejects(() => quebrado.screenSize(), /ENOENT/);
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\nOK: ${checks} verificacoes passaram.`);
