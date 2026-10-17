const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(path.join(__dirname, '..', 'src'));
let failed = 0;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`ok    ${path.relative(path.join(__dirname, '..'), file)}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${path.relative(path.join(__dirname, '..'), file)}`);
    console.error(String(err.stderr || err.message));
  }
}

console.log(`\n${files.length - failed}/${files.length} files passed syntax check.`);
process.exit(failed ? 1 : 0);
