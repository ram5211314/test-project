const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const includeModels = args.includes('--include-models');
const unpackedOnly = args.includes('--dir');
const rootDir = path.resolve(__dirname, '..');

function run(command, commandArgs, extraEnv = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('npm', ['run', 'build']);

const builderArgs = ['electron-builder', '--config', 'electron-builder.config.cjs'];
if (unpackedOnly) {
  builderArgs.push('--dir');
}

run('npx', builderArgs, {
  INCLUDE_MODELS: includeModels ? 'true' : 'false',
});
