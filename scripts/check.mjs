import { access, readFile } from 'node:fs/promises';

const requiredFiles = ['index.html', 'src/app.js', 'src/styles.css', 'src/data/roles.js'];
for (const file of requiredFiles) await access(file);
const app = await readFile('src/app.js', 'utf8');
for (const route of ['home', 'cell', 'welcome', 'profile', 'admin']) {
  if (!app.includes(`'${route}'`)) throw new Error(`Rota ausente: ${route}`);
}
console.log('Verificação concluída: estrutura e rotas do MVP estão presentes.');
