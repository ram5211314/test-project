import { ipcMain, dialog } from 'electron';
import { IPC_FILE_OPEN_IMAGE, IPC_FILE_REGISTER_LOCAL } from '../../shared/ipc-channels';
import { registerLocalFile } from '../protocol/output';

export function registerFileHandlers(): void {
  ipcMain.handle(IPC_FILE_OPEN_IMAGE, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'] }],
    });
    const filePath = result.filePaths[0];
    return {
      ...result,
      referenceImageUrl: !result.canceled && filePath ? registerLocalFile(filePath) : undefined,
    };
  });

  ipcMain.handle(IPC_FILE_REGISTER_LOCAL, async (_event, filePath: string) => {
    return registerLocalFile(filePath);
  });
}
