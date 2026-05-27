// Wrapper: runs generate-content.ts via child_process, captures stdout, saves clean JSON + HTML preview
const { execSync } = require('child_process');
const fs = require('fs');

const keyword = process.argv[2] || '회사에서 ChatGPT 쓸 때 모르면 손해보는 팁';
const category = process.argv[3] || 'default';

console.log(`Generating: "${keyword}" [${category}]`);

try {
  const raw = execSync(
    `npx tsx scripts/generate-content.ts "${keyword}" "${category}"`,
    { cwd: __dirname, encoding: 'utf8', env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 }
  );

  const j = JSON.parse(raw.trim());

  console.log('\n=== TITLE ===');
  console.log(j.title);
  console.log('\n=== CATEGORY ===');
  console.log(j.category);
  console.log('\n=== TAGS ===');
  console.log(j.tags.join(', '));

  const plain = j.html.replace(/<[^>]+>/g, '');
  console.log('\n=== LENGTH ===');
  console.log(plain.length + ' chars');

  // Check reading time residue
  const hasReadingTime = /예상\s*독서\s*시간|읽기\s*시간|약\s*\d+분입니다/.test(plain);
  console.log('\n=== READING TIME ===');
  console.log(hasReadingTime ? 'STILL PRESENT ❌' : 'REMOVED ✅');

  // Check tone: count ~습니다 endings
  const sentences = plain.split(/[.!?。]\s*/);
  const habni = sentences.filter(s => s.endsWith('습니다') || s.endsWith('합니다') || s.endsWith('됩니다') || s.endsWith('있습니다'));
  const casual = sentences.filter(s => /거든요|인데요|더라고요|이죠|에요|예요|나요\??/.test(s));
  console.log('\n=== TONE CHECK ===');
  console.log(`Total sentences: ${sentences.length}`);
  console.log(`~습니다 endings: ${habni.length} (${Math.round(habni.length/sentences.length*100)}%)`);
  console.log(`구어체 endings: ${casual.length} (${Math.round(casual.length/sentences.length*100)}%)`);
  console.log(habni.length / sentences.length > 0.7 ? 'TOO FORMAL ❌' : 'TONE OK ✅');

  // Check analogies
  const analogyWords = ['같은', '비슷', '처럼', '마치', '생각하면', '비유'];
  const hasAnalogies = analogyWords.some(w => plain.includes(w));
  console.log('\n=== ANALOGIES ===');
  console.log(hasAnalogies ? 'Found ✅' : 'MISSING ❌');

  // Save JSON
  fs.writeFileSync('test_tone.json', JSON.stringify(j, null, 2), 'utf8');

  // Save HTML preview
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<style>body{max-width:720px;margin:40px auto;padding:0 20px;font-family:'Apple SD Gothic Neo',sans-serif;line-height:1.8;color:#1e293b}
h1{font-size:1.6rem}h2{margin-top:2rem;border-bottom:2px solid #e2e8f0;padding-bottom:.5rem}
h3{color:#334155}table{width:100%;border-collapse:collapse;margin:1rem 0}
th,td{border:1px solid #e2e8f0;padding:8px 12px;text-align:left}th{background:#f8fafc}
blockquote{border-left:4px solid #0ea5e9;padding:.5rem 1rem;background:#f0f9ff;margin:1rem 0}
</style></head><body>
<h1>${j.title}</h1>
<p style="color:#64748b">${j.category} | ${j.tags.join(', ')}</p><hr>
${j.html}
</body></html>`;
  fs.writeFileSync('test_preview.html', html, 'utf8');
  console.log('\n✅ Preview: test_preview.html');

} catch (e) {
  console.error('Error:', e.message);
  if (e.stdout) fs.writeFileSync('test_tone_raw.txt', e.stdout, 'utf8');
  if (e.stderr) console.error('STDERR:', e.stderr.substring(0, 500));
}
