import assert from 'node:assert/strict';
import { publicErrorResponse } from '../src/server/http-errors.mjs';

const unexpected = new Error('relation people does not exist: internal-detail');
unexpected.stack = 'stack com detalhe interno';
const hidden = publicErrorResponse(unexpected);
assert.equal(hidden.status, 500);
assert.equal(hidden.body.error, 'Não foi possível concluir a operação.');
assert.equal(JSON.stringify(hidden.body).includes('internal-detail'), false);
assert.equal(JSON.stringify(hidden.body).includes('stack'), false);

for (const [status, message] of [[400, 'Dados inválidos.'], [401, 'Sessão necessária.'], [403, 'Sem permissão.'], [404, 'Registro não encontrado.'], [429, 'Tente novamente mais tarde.'], [503, 'Módulo em migração.']]) {
  const error = new Error(message); error.status = status;
  const response = publicErrorResponse(error);
  assert.equal(response.status, status);
  assert.equal(response.body.error, message);
}

console.log('Serialização segura de erros HTTP passou.');
