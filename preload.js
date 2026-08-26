const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wallpaper', {
  list: (options) => ipcRenderer.invoke('wallpaper:list', options || {}),
  get: () => ipcRenderer.invoke('wallpaper:get'),
  set: (id) => ipcRenderer.invoke('wallpaper:set', id),
  status: () => ipcRenderer.invoke('wallpaper:status'),
  ping: () => ipcRenderer.invoke('wallpaper:ping')
});

contextBridge.exposeInMainWorld('dshApp', {
  retry: () => ipcRenderer.invoke('app:retry')
});
