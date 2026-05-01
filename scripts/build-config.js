// Compiles configs/<ACTIVE_CONFIG> (a YAML file) into config.json.
// ACTIVE_CONFIG is read from .env (or the calling process env).
// config.json is the runtime artifact loaded by server.js and models.py;
// configs/*.yaml files are the authored source of truth.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const repoRoot = path.resolve(__dirname, '..');
const active = process.env.ACTIVE_CONFIG;

if (!active) {
    console.error('ACTIVE_CONFIG is not set. Add it to .env (see .env.example).');
    process.exit(1);
}

const yamlPath = path.join(repoRoot, 'configs', active);
if (!fs.existsSync(yamlPath)) {
    console.error(`ACTIVE_CONFIG=${active} but ${yamlPath} does not exist.`);
    process.exit(1);
}

const src = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
const outPath = path.join(repoRoot, 'config.json');
fs.writeFileSync(outPath, JSON.stringify(src, null, 4) + '\n');
console.log(`config.json regenerated from configs/${active}`);
