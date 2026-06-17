const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, protocol } = require('electron');

const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'output');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sharp-viewer',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function findLatestPly() {
  return fs.readdirSync(outputDir)
    .filter((file) => file.endsWith('.ply'))
    .map((file) => {
      const fullPath = path.join(outputDir, file);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.fullPath;
}

function fail(message) {
  console.error(`[viewer-smoke] ${message}`);
  process.exitCode = 1;
  app.quit();
}

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-webgl');

app.whenReady().then(async () => {
  const plyPath = path.resolve(projectRoot, process.argv[2] ?? findLatestPly() ?? '');
  if (!plyPath || !fs.existsSync(plyPath)) {
    fail(`PLY not found: ${plyPath}`);
    return;
  }

  const plyUrl = `sharp-viewer://output/${encodeURIComponent(path.basename(plyPath))}`;
  protocol.handle('sharp-viewer', async (request) => {
    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': '*',
      'cross-origin-resource-policy': 'cross-origin',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    const url = new URL(request.url);
    const requestedName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (url.hostname !== 'output' || requestedName !== path.basename(plyPath)) {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }
    const data = await fs.promises.readFile(plyPath);
    return new Response(data, {
      headers: {
        ...corsHeaders,
        'content-type': 'application/octet-stream',
        'content-length': String(data.byteLength),
      },
    });
  });

  const win = new BrowserWindow({
    width: 960,
    height: 640,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  });

  ipcMain.once('viewer-smoke-result', (_event, result) => {
    if (result?.ok) {
      console.log(
        `[viewer-smoke] ok durationMs=${result.durationMs} scenes=${result.sceneCount} canvas=${result.width}x${result.height}`,
      );
      app.quit();
    } else {
      fail(result?.error ?? 'unknown renderer error');
    }
  });

  win.webContents.on('console-message', (_event, _level, message) => {
    console.log(`[viewer-console] ${message}`);
  });

  const preloadRequire = path.join(projectRoot, 'scripts', 'viewer-smoke.cjs');
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #10101a; }
    canvas { display: block; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    (async () => {
      const { ipcRenderer } = require('electron');
      const { createRequire } = require('module');
      const requireFromProject = createRequire(${JSON.stringify(preloadRequire)});
      const THREE = requireFromProject('three');
      const GaussianSplats3D = requireFromProject('@mkkellogg/gaussian-splats-3d');
      const started = performance.now();

      try {
        const root = document.getElementById('root');
        const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
        renderer.setPixelRatio(1);
        renderer.setSize(root.clientWidth, root.clientHeight);
        root.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x10101a);
        const camera = new THREE.PerspectiveCamera(65, root.clientWidth / root.clientHeight, 0.1, 500);
        camera.position.set(0, 0, 5);
        camera.lookAt(0, 0, 0);

        const viewer = new GaussianSplats3D.DropInViewer({
          gpuAcceleratedSort: false,
          integerBasedSort: false,
          sphericalHarmonicsDegree: 0,
          sharedMemoryForWorkers: false,
          enableSIMDInSort: false,
          dynamicScene: false,
          optimizeSplatData: true,
          freeIntermediateSplatData: true,
        });
        scene.add(viewer);

        let frames = 0;
        const animate = () => {
          frames += 1;
          renderer.render(scene, camera);
          if (frames < 240) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);

        const fetchProbe = await fetch(${JSON.stringify(plyUrl)});
        if (!fetchProbe.ok) throw new Error('fetch probe failed: ' + fetchProbe.status);
        console.log('fetch probe bytes=' + (await fetchProbe.arrayBuffer()).byteLength);

        await viewer.addSplatScene(${JSON.stringify(plyUrl)}, {
          format: GaussianSplats3D.SceneFormat.Ply,
          splatAlphaRemovalThreshold: 5,
          showLoadingUI: false,
        });

        for (let i = 0; i < 5; i++) {
          renderer.render(scene, camera);
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }

        ipcRenderer.send('viewer-smoke-result', {
          ok: true,
          durationMs: Math.round(performance.now() - started),
          sceneCount: viewer.getSceneCount(),
          width: renderer.domElement.width,
          height: renderer.domElement.height,
        });
      } catch (error) {
        ipcRenderer.send('viewer-smoke-result', {
          ok: false,
          error: error && error.stack ? error.stack : String(error),
        });
      }
    })();
  </script>
</body>
</html>`;

  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cross-origin-resource-policy': 'cross-origin',
    });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  app.once('quit', () => server.close());
  await win.loadURL(`http://127.0.0.1:${port}/`);

  setTimeout(() => {
    fail(`viewer did not finish after 60s: ${plyPath}`);
    win.destroy();
  }, 60_000).unref();
});
