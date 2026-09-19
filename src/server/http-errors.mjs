const controlledStatuses = new Set([400, 401, 403, 404, 409, 429, 503]);
const genericMessage = 'Não foi possível concluir a operação.';

/** Converts validated application errors into safe HTTP data. */
export function publicErrorResponse(error) {
  const status = Number(error?.status);
  if (controlledStatuses.has(status) && typeof error?.message === 'string' && error.message.trim()) {
    return { status, body: { error: error.message.trim() } };
  }
  return { status: 500, body: { error: genericMessage } };
}

/** Never serialize error messages, stacks or request data into server logs. */
export function logUnexpectedServerError(error) {
  if (controlledStatuses.has(Number(error?.status))) return;
  const name = typeof error?.name === 'string' && error.name.length <= 80 ? error.name : 'UnknownError';
  console.error('CEM CONNECT: operação interna não concluída.', { name });
}
