import { readdirSync, statSync } from 'node:fs'
const dirs = ['.dsh-dev/.dsh/projects', '.dsh-dev/.dsh/sessions']
for (const d of dirs) {
  try { console.log(d, readdirSync(d).slice(0, 3)) } catch { console.log(d, 'missing') }
}
