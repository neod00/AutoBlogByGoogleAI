const fs = require('fs');
const j = JSON.parse(fs.readFileSync('test_tone.json', 'utf8'));

console.log('TITLE:', j.title);
console.log('CAT:', j.category);

const html = '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>'
  + 'body{max-width:720px;margin:40px auto;padding:0 20px;font-family:sans-serif;line-height:1.8;color:#1e293b}'
  + 'h1{font-size:1.6rem}h2{margin-top:2rem;border-bottom:2px solid #e2e8f0;padding-bottom:.5rem}'
  + 'h3{color:#334155}table{width:100%;border-collapse:collapse;margin:1rem 0}'
  + 'th,td{border:1px solid #e2e8f0;padding:8px 12px;text-align:left}th{background:#f8fafc}'
  + '</style></head><body><h1>' + j.title + '</h1>'
  + '<p style="color:#64748b">' + j.category + '</p><hr>'
  + j.html + '</body></html>';
fs.writeFileSync('test_preview.html', html, 'utf8');
console.log('Preview saved');
