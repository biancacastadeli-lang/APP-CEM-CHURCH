import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createInitialAdmin } from '../src/server/database.mjs';

async function ask(question) {
  const readline = createInterface({ input, output });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}

async function askHidden(question) {
  if (!input.isTTY) throw new Error('Este comando exige um terminal interativo para proteger a senha.');
  output.write(question);
  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      output.write('\n');
    };
    const onData = (character) => {
      if (character === '\u0003') {
        finish();
        reject(new Error('Operação cancelada.'));
      } else if (character === '\r' || character === '\n') {
        finish();
        resolve(value);
      } else if (character === '\u0008' || character === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += character;
      }
    };
    input.on('data', onData);
  });
}

try {
  output.write('\nInicialização do primeiro Administrador do CEM CONNECT\n\n');
  const name = await ask('Nome completo: ');
  const email = await ask('E-mail: ');
  const whatsapp = await ask('WhatsApp: ');
  const password = await askHidden('Senha: ');
  const confirmation = await askHidden('Confirme a senha: ');
  createInitialAdmin({ name, email, whatsapp, password, passwordConfirmation: confirmation });
  output.write('Primeiro Administrador criado com sucesso.\n');
} catch (error) {
  output.write(`Não foi possível criar o primeiro Administrador: ${error.message}\n`);
  process.exitCode = 1;
}
