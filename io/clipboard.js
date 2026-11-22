export function parseTSV(text) {
  const rows=[[]];
  let field='', quoted=false, start=true;
  for (let i=0;i<text.length;i++) {
    const ch=text[i];
    if (quoted) {
      if (ch==='"' && text[i+1]==='"') {field+='"';i++;}
      else if(ch==='"') quoted=false;
      else field+=ch;
    } else if (ch==='"' && start) {quoted=true;start=false;}
    else if (ch==='\t' || ch==='\n' || ch==='\r') {
      rows.at(-1).push(field);
      if (ch!=='\t') {
        if (ch==='\r'&&text[i+1]==='\n') i++;
        if (i===text.length-1) return rows;
        rows.push([]);
      }
      field='';start=true;
    } else {field+=ch;start=false;}
  }
  rows.at(-1).push(field);
  return rows;
}
export const tsv = rows => rows.map(row=>row.map(value=>{
  const s=String(value ?? '');
  return /["\t\r\n]/.test(s) ? '"'+s.replaceAll('"','""')+'"' : s;
}).join('\t')).join('\r\n');
