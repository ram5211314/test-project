const includeModels = process.env.INCLUDE_MODELS === 'true';

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.sharpviewer.app',
  productName: 'Photo Reframing',
  directories: {
    output: 'release',
    buildResources: 'assets',
  },
  files: ['dist/**/*', 'package.json'],
  extraResources: [
    {
      from: 'assets/icons/',
      to: 'assets/icons/',
      filter: ['*'],
    },
    ...(includeModels
      ? [
          {
            from: 'models/',
            to: 'models/',
            filter: ['*.onnx', '*.onnx.data'],
          },
        ]
      : []),
  ],
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.graphics-design',
    icon: 'assets/icons/icon.icns',
  },
  win: {
    target: ['portable'],
    icon: 'assets/icons/icon.ico',
  },
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Graphics',
    icon: 'assets/icons/icon.png',
  },
  asar: true,
  asarUnpack: [
    'node_modules/onnxruntime-node/**/*',
    'node_modules/sharp/**/*',
    ...(includeModels ? ['models/**/*'] : []),
  ],
};
