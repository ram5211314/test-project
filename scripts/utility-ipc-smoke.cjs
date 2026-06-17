const fs = require('node:fs');
const path = require('node:path');
const { app, utilityProcess } = require('electron');

const projectRoot = path.resolve(__dirname, '..');
const imagePath = path.resolve(projectRoot, process.argv[2] ?? 'test/DSC08348.jpg');
const workerPath = path.join(projectRoot, 'dist', 'backend', 'worker.js');
const modelPath = path.join(projectRoot, 'models', 'sharp_web_predictor.onnx');
const outputDir = path.join(projectRoot, 'output');
const taskId = `ipc_smoke_${Date.now()}`;
const capabilitiesRequestId = `cap_${Date.now()}`;
const seenStages = new Set();
let finished = false;

function fail(message) {
  if (finished) return;
  finished = true;
  console.error(`[ipc-smoke] ${message}`);
  process.exitCode = 1;
  app.quit();
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} not found: ${filePath}`);
    return false;
  }
  return true;
}

function finish(child, result) {
  const requiredStages = ['preprocessing', 'running-inference', 'ready'];
  const missing = requiredStages.filter((stage) => !seenStages.has(stage));
  if (missing.length > 0) {
    fail(`missing backend stages: ${missing.join(', ')}`);
    child.kill();
    return;
  }
  if (!result?.plyPath || !fs.existsSync(result.plyPath)) {
    fail(`PLY was not written: ${result?.plyPath ?? '<empty>'}`);
    child.kill();
    return;
  }
  finished = true;
  console.log(
    `[ipc-smoke] ok backend=${result.backend} durationMs=${result.durationMs} selected=${result.selectedGaussians} ply=${result.plyPath}`,
  );
  child.kill();
  app.quit();
}

function createConfig() {
  return {
    modelPath,
    outputDir,
    preferredProviders: ['webgpu', 'cpu'],
  };
}

function sendRun(child) {
  child.postMessage({
    type: 'run',
    taskId,
    payload: {
      imagePath,
      qualityPreset: 'balanced',
    },
    config: createConfig(),
  });
}

app.whenReady().then(() => {
  if (!requireFile(workerPath, 'worker')) return;
  if (!requireFile(modelPath, 'model')) return;
  if (!requireFile(`${modelPath}.data`, 'model data')) return;
  if (!requireFile(imagePath, 'image')) return;
  fs.mkdirSync(outputDir, { recursive: true });

  const child = utilityProcess.fork(workerPath, [], {
    cwd: projectRoot,
    serviceName: 'sharp-viewer-ipc-smoke',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk) => process.stdout.write(`[backend:stdout] ${chunk}`));
  child.stderr?.on('data', (chunk) => process.stderr.write(`[backend:stderr] ${chunk}`));

  child.on('message', (message) => {
    if (message.type === 'status') {
      seenStages.add(message.status.stage);
      console.log(
        `[ipc-smoke] status ${message.status.stage} ${message.status.progress ?? ''} ${message.status.backend ?? ''}`.trim(),
      );
      return;
    }
    if (message.type === 'capabilities') {
      console.log(
        `[ipc-smoke] capabilities preferred=${message.capabilities.preferredProviders.join('>')} supported=${message.capabilities.supportedProviders.join('>')}`,
      );
      sendRun(child);
      return;
    }
    if (message.type === 'result') {
      finish(child, message.result);
      return;
    }
    if (message.type === 'error') {
      fail(`backend error: ${message.error}`);
      child.kill();
    }
  });

  child.on('exit', (code) => {
    if (finished) return;
    fail(`backend exited before result, code=${code}`);
  });

  child.once('spawn', () => {
    console.log(`[ipc-smoke] spawned pid=${child.pid}`);
    child.postMessage({
      type: 'capabilities',
      requestId: capabilitiesRequestId,
      config: createConfig(),
    });
  });

  setTimeout(() => {
    if (finished) return;
    fail('no result after 120s');
    child.kill();
  }, 120_000).unref();
});
