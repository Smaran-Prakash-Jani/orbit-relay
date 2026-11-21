const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('relay', Object.freeze({
  scan: () => ipcRenderer.invoke('relay:scan'),
  preview: id => ipcRenderer.invoke('relay:preview', id),
  reset: id => ipcRenderer.invoke('relay:reset', id),
  undo: token => ipcRenderer.invoke('relay:undo', token),
  pendingUndo: () => ipcRenderer.invoke('relay:pending-undo'),
  report: () => ipcRenderer.invoke('relay:report'),
  exportReport: () => ipcRenderer.invoke('relay:export'),
  windowControl: action => ipcRenderer.invoke('relay:window', action)
}));
