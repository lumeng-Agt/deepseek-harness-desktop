const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wallpaper', {
  list: (options) => ipcRenderer.invoke('wallpaper:list', options || {}),
  get: () => ipcRenderer.invoke('wallpaper:get'),
  prepare: (id) => ipcRenderer.invoke('wallpaper:prepare', id),
  set: (id) => ipcRenderer.invoke('wallpaper:set', id),
  roots: () => ipcRenderer.invoke('wallpaper:roots'),
  chooseRoot: () => ipcRenderer.invoke('wallpaper:choose-root'),
  removeRoot: (directory) => ipcRenderer.invoke('wallpaper:remove-root', directory),
  rescan: () => ipcRenderer.invoke('wallpaper:rescan'),
  clearCache: () => ipcRenderer.invoke('wallpaper:clear-cache'),
  status: () => ipcRenderer.invoke('wallpaper:status'),
  ping: () => ipcRenderer.invoke('wallpaper:ping')
});

contextBridge.exposeInMainWorld('dshApp', {
  retry: () => ipcRenderer.invoke('app:retry'),
  status: () => ipcRenderer.invoke('app:status')
});
