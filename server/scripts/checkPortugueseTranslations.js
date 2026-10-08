'use strict';

/**
 * Check the canonical portuguese_pt translations against the language data of the repository.
 *
 * The tokens in scope are read from the repository files only, so no database is needed: the base english file,
 * every versioned english file and every file with a "translations" map (templates, help, reference data).
 * Tokens whose english text is empty have nothing to translate and are left out.
 *
 * Usage: node server/scripts/checkPortugueseTranslations.js
 */

const fs = require('fs');
const path = require('path');

const installScriptsPath = path.resolve(__dirname, '..', 'install', 'scripts');
const migrationsPath = path.join(installScriptsPath, 'migrations');
const canonicalPath = path.join(installScriptsPath, 'languages', 'portuguese_pt');

/**
 * Migration folders in execution order: "older" first, then by version
 */
function getVersionFolders() {
  const versionParts = (version) => version.split('.').map(Number);
  return fs.readdirSync(migrationsPath)
    .filter((folder) => fs.statSync(path.join(migrationsPath, folder)).isDirectory())
    .sort((a, b) => {
      if (a === 'older' || b === 'older') {
        return a === 'older' ? -1 : 1;
      }
      const aParts = versionParts(a);
      const bParts = versionParts(b);
      for (let index = 0; index < Math.max(aParts.length, bParts.length); index++) {
        const diff = (aParts[index] || 0) - (bParts[index] || 0);
        if (diff) {
          return diff;
        }
      }
      return 0;
    });
}

/**
 * JSON files of a folder, recursively, sorted by path
 */
function getJsonFiles(folderPath) {
  return fs.readdirSync(folderPath)
    .sort()
    .reduce((files, entry) => {
      const entryPath = path.join(folderPath, entry);
      if (fs.statSync(entryPath).isDirectory()) {
        return files.concat(getJsonFiles(entryPath));
      }
      return entry.endsWith('.json') ? files.concat(entryPath) : files;
    }, []);
}

/**
 * Map of token => english text, the last definition winning
 */
function getEnglishTokens() {
  const english = {};
  getVersionFolders().forEach((folder) => {
    getJsonFiles(path.join(migrationsPath, folder)).forEach((filePath) => {
      const data = JSON.parse(fs.readFileSync(filePath));
      const fileName = path.basename(filePath);

      // base language file, grouped by section
      if (
        fileName === 'english_us.json' &&
        data.sections
      ) {
        Object.values(data.sections).forEach((tokens) => {
          Object.keys(tokens).forEach((token) => {
            english[token] = tokens[token].translation;
          });
        });
      }

      // versioned english files
      if (
        fileName.startsWith('english') &&
        data.tokens
      ) {
        Object.keys(data.tokens).forEach((token) => {
          english[token] = data.tokens[token].translation;
        });
      }

      // templates, help and reference data
      if (
        data.translations &&
        typeof data.translations === 'object'
      ) {
        Object.keys(data.translations).forEach((token) => {
          const entry = data.translations[token];
          if (entry.english_us !== undefined) {
            english[token] = entry.english_us;
          } else if (entry.translation !== undefined) {
            english[token] = entry.translation;
          }
        });
      }
    });
  });

  Object.keys(english).forEach((token) => {
    if (
      typeof english[token] !== 'string' ||
      !english[token].trim()
    ) {
      delete english[token];
    }
  });

  return english;
}

/**
 * Sorted, whitespace-insensitive list of the {{placeholders}} of a text
 */
function getPlaceholders(text) {
  return [...new Set((text.match(/{{[^{}]*}}/g) || []).map((placeholder) => placeholder.replace(/\s/g, '')))].sort();
}

const english = getEnglishTokens();
const portuguese = {};
['system.json', 'templates.json'].forEach((fileName) => {
  const data = JSON.parse(fs.readFileSync(path.join(canonicalPath, fileName)));
  Object.keys(data.tokens).forEach((token) => {
    portuguese[token] = data.tokens[token].translation;
  });
});
const identicalToEnglish = new Set(JSON.parse(fs.readFileSync(path.join(canonicalPath, 'identical-to-english.json'))));

const findings = {
  'missing in the canonical files': [],
  'empty while the english text is not': [],
  'equal to the english text and not allowlisted': [],
  'placeholders differ from the english ones': [],
  'unknown to the repository language data': []
};
Object.keys(english).sort().forEach((token) => {
  const text = portuguese[token];
  if (text === undefined) {
    findings['missing in the canonical files'].push(token);
  } else if (
    typeof text !== 'string' ||
    !text.trim()
  ) {
    findings['empty while the english text is not'].push(token);
  } else {
    if (
      text.trim() === english[token].trim() &&
      !identicalToEnglish.has(token)
    ) {
      findings['equal to the english text and not allowlisted'].push(token);
    }
    if (getPlaceholders(text).join() !== getPlaceholders(english[token]).join()) {
      findings['placeholders differ from the english ones'].push(token);
    }
  }
});
Object.keys(portuguese).sort().forEach((token) => {
  if (english[token] === undefined) {
    findings['unknown to the repository language data'].push(token);
  }
});

let total = 0;
Object.keys(findings).forEach((kind) => {
  if (!findings[kind].length) {
    return;
  }
  total += findings[kind].length;
  console.log(`\n${findings[kind].length} token(s) ${kind}:`);
  findings[kind].forEach((token) => console.log(`  ${token}`));
});

if (total) {
  console.log(`\nportuguese_pt check failed: ${total} finding(s) over ${Object.keys(english).length} tokens in scope`);
  process.exit(1);
}
console.log(`portuguese_pt check passed: ${Object.keys(english).length} tokens in scope`);
