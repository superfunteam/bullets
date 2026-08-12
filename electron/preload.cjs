const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bulletsDesktop', {
  notifications: {
    isSupported: () => ipcRenderer.invoke('desktop:notifications-supported'),
    schedule: notifications => ipcRenderer.invoke('desktop:schedule-notifications', notifications),
  },
  onRoute: listener => {
    const handler = (_event, route) => listener(route);
    ipcRenderer.on('desktop:route', handler);
    return () => ipcRenderer.removeListener('desktop:route', handler);
  },
});
