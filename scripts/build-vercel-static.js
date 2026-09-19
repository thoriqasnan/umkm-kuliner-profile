const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = path.join(projectRoot, '.vercel-static-output');
const publicEntries = Object.freeze(['index.html', 'style.css', 'script.js', 'images']);

function requireSource(relativePath, expectedType) {
  const sourcePath = path.join(projectRoot, relativePath);
  let stat;
  try {
    stat = fs.statSync(sourcePath);
  } catch {
    throw new Error(`Required static source is missing: ${relativePath}`);
  }

  const matches = expectedType === 'directory' ? stat.isDirectory() : stat.isFile();
  if (!matches) {
    throw new Error(`Required static source is not a ${expectedType}: ${relativePath}`);
  }
  return sourcePath;
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });

for (const entry of publicEntries) {
  const expectedType = entry === 'images' ? 'directory' : 'file';
  const sourcePath = requireSource(entry, expectedType);
  const destinationPath = path.join(outputDirectory, entry);
  fs.cpSync(sourcePath, destinationPath, { recursive: expectedType === 'directory' });
}

const generatedEntries = fs.readdirSync(outputDirectory).sort();
const expectedEntries = [...publicEntries].sort();
if (JSON.stringify(generatedEntries) !== JSON.stringify(expectedEntries)) {
  throw new Error(`Unexpected static output entries: ${generatedEntries.join(', ')}`);
}

console.log(`Generated static output: ${path.relative(projectRoot, outputDirectory)}`);
console.log(`Public entries: ${generatedEntries.join(', ')}`);
