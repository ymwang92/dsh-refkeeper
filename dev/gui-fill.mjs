/** Fill the refkeeper manual form in DOM order (title, doi, year, authors, …). */
import { execFileSync } from 'node:child_process'

const port = process.argv[2] ?? '9333'
const values = JSON.parse(process.argv[3] ?? '[]')
const script = `(() => {
  const panel = document.querySelector('section[aria-label="dsh-refkeeper panel"]');
  if (!panel) return { error: 'panel not found' };
  const values = ${JSON.stringify(values)};
  const fields = [...panel.querySelectorAll('input,textarea')].filter((e) => e.type !== 'radio');
  const set = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  values.forEach((v, i) => { if (fields[i] && v !== null) set(fields[i], v); });
  return { count: fields.length, now: fields.map((f) => (f.value || '').slice(0, 24)) };
})()`
process.stdout.write(execFileSync('node', ['dev/gui-eval.mjs', port, script], { encoding: 'utf8' }))
