const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wallpaper', {
  list: () => ipcRenderer.invoke('wallpaper:list'),
  get: () => ipcRenderer.invoke('wallpaper:get'),
  set: (id) => ipcRenderer.invoke('wallpaper:set', id),
  ping: () => ipcRenderer.invoke('wallpaper:ping')
});
