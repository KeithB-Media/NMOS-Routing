// One grammar for global search, column filters and route/tag suggestions.
// Unquoted words are ANDed; unquoted | separates OR branches.
// Quoted terms match an entire field (or individual tag) exactly.
const dashCharacters = /[-\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/u;
const normalizeDashes = value => value.replace(/[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/gu,'-').replace(/\s*-\s*/gu,'-');
export function compileSearch(query = '', {caseFolded = false} = {}) {
  const branches = [[]];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|(\|)|([^\s|" ]+)/g;
  let token, needsDashNormalization = false;
  while ((token = re.exec(query))) {
    if (token[2]) { branches.push([]); continue; }
    const exact = token[1] !== undefined;
    let value = (exact ? token[1].replace(/\\"/g, '"') : token[3]).toLocaleLowerCase();
    if (!value) continue;
    if (exact) branches.at(-1).push(fields => fields.some(f => f === value));
    else {
      if(dashCharacters.test(value)){value=normalizeDashes(value);needsDashNormalization=true;}
      if (/[?*]/.test(value)) {
        const pattern = value.split('').map(c => c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
        const wildcard = new RegExp(pattern, 'u');
        branches.at(-1).push((fields,loose) => loose.some(f => wildcard.test(f)));
      } else branches.at(-1).push((fields,loose) => loose.some(f => f.includes(value)));
    }
  }
  const active = branches.filter(b => b.length);
  return value => {
    if (!active.length) return true;
    const values = Array.isArray(value) ? value : [value];
    const fields = caseFolded ? values : values.filter(v => v != null).map(v => String(v).toLocaleLowerCase());
    const loose = needsDashNormalization ? fields.map(normalizeDashes) : fields;
    return active.some(b => b.every(test => test(fields,loose)));
  };
}
