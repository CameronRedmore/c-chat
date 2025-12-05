import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const packageJsonPath = path.join(rootDir, 'package.json');
const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');

function bumpVersion(version, type = 'patch') {
    const parts = version.split('.').map(Number);
    if (type === 'major') {
        parts[0]++;
        parts[1] = 0;
        parts[2] = 0;
    } else if (type === 'minor') {
        parts[1]++;
        parts[2] = 0;
    } else {
        parts[2]++;
    }
    return parts.join('.');
}

function updateFile(filePath, regex, replacement) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const newContent = content.replace(regex, replacement);
    fs.writeFileSync(filePath, newContent, 'utf-8');
}

function main() {
    // Branch check
    try {
        const branch = execSync('git branch --show-current').toString().trim();
        if (branch !== 'main') {
            console.log(`Skipping version bump on branch "${branch}". Only runs on "main".`);
            return;
        }
    } catch (e) {
        console.warn('Could not determine branch, proceeding with version bump anyway.');
    }

    const args = process.argv.slice(2);
    const bumpTypeIndex = args.indexOf('--bump');
    const bumpType = bumpTypeIndex !== -1 ? args[bumpTypeIndex + 1] : 'patch';

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const currentVersion = packageJson.version;
    const newVersion = bumpVersion(currentVersion, bumpType);

    console.log(`Bumping version from ${currentVersion} to ${newVersion}`);

    // Update package.json
    packageJson.version = newVersion;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');

    // Update Cargo.toml
    updateFile(cargoTomlPath, /^version = ".*"/m, `version = "${newVersion}"`);

    // Update tauri.conf.json
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));
    tauriConf.version = newVersion;
    fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf-8');

    console.log('Version updated in package.json, Cargo.toml, and tauri.conf.json');

    // Stage files
    try {
        execSync(`git add "${packageJsonPath}" "${cargoTomlPath}" "${tauriConfPath}"`, { stdio: 'inherit' });
        console.log('Staged updated files');
    } catch (error) {
        console.error('Failed to stage files:', error);
        process.exit(1);
    }
}

main();
