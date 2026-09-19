import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemberReferral, createPublicPreRegistration, listCareReferrals, listCareVisitors, listReceptionVisitors } from '../src/server/postgres-welcome.mjs';

await assert.rejects(() => createPublicPreRegistration({ name: '', whatsapp: '5511999999999', consent: true }), (error) => error.status === 400);
await assert.rejects(() => createPublicPreRegistration({ name: 'Pessoa', whatsapp: '5511999999999', consent: false }), (error) => error.status === 400);
await assert.rejects(() => listReceptionVisitors({ source: 'postgres', userId: '00000000-0000-4000-8000-000000000001', roles: ['member'] }), (error) => error.status === 403);
await assert.rejects(() => listCareVisitors({ source: 'postgres', userId: '00000000-0000-4000-8000-000000000001', roles: ['welcome1'] }), (error) => error.status === 403);
await assert.rejects(() => listCareVisitors(null), (error) => error.status === 401);
await assert.rejects(() => createMemberReferral({ source: 'postgres', userId: '00000000-0000-4000-8000-000000000001', personId: '00000000-0000-4000-8000-000000000002', roles: ['leader'] }, { name: 'Pessoa', whatsapp: '5511999999999' }), (error) => error.status === 403);
await assert.rejects(() => listCareReferrals({ source: 'postgres', userId: '00000000-0000-4000-8000-000000000001', roles: ['secretary'] }), (error) => error.status === 403);

const app = await readFile('src/app.js', 'utf8');
assert.equal(app.includes("api('/api/visitors'"), false, 'A interface não deve chamar a rota legada de visitantes.');
assert.equal(app.includes("api('/api/care'"), false, 'A interface não deve chamar a rota legada de cuidado.');
assert.equal(app.includes('fake-qr'), false, 'A interface não deve apresentar um QR Code simulado.');
assert.equal(app.includes('pre-registration-link'), true, 'A interface deve apontar para o pré-cadastro público real.');

console.log('Boas-Vindas PostgreSQL: validações públicas e limites de papel passaram sem conexão de banco.');
