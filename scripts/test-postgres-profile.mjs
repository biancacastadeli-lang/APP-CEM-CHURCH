import assert from 'node:assert/strict';
import { normalizeBirthDate, profileBootstrap } from '../src/server/postgres-profile.mjs';

assert.equal(normalizeBirthDate(''), null, 'Data de nascimento pode permanecer opcional.');
assert.equal(normalizeBirthDate('1990-01-20'), '1990-01-20', 'Data ISO válida deve ser aceita.');
assert.throws(() => normalizeBirthDate('2099-01-01'), /Data de nascimento inválida/, 'Data futura deve ser rejeitada.');

const membership = { id: 'cell-1', name: 'Célula de teste', weekday: 3, meetingTime: '19:30:00', location: 'Local', active: true };
const profile = {
  name: 'Pessoa de teste', email: null, whatsapp: '5511999999999', birthDate: null,
  roles: ['member', 'leader', 'supervisor'], membership, leaderships: [membership], secretariats: [], supervisedCells: [membership], settings: { profileEditing: true }
};
const bootstrap = profileBootstrap({ personId: 'person-1' }, profile);
assert.equal(bootstrap.currentUser.cellId, membership.id, 'A célula atual deriva da membresia ativa.');
assert.deepEqual(bootstrap.currentUser.roles, profile.roles, 'Múltiplos papéis devem permanecer distintos.');
assert.equal(Object.hasOwn(bootstrap.profile, 'password_hash'), false, 'O perfil não pode transportar hash de senha.');
assert.equal(Object.hasOwn(bootstrap.profile, 'password_salt'), false, 'O perfil não pode transportar salt de senha.');

console.log('Verificação concluída: perfil próprio valida data opcional, múltiplos papéis e dados seguros.');
