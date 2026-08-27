"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const bridge = Object.freeze({
  platform: "windows",
  version: "1.2.3",
  secrets: Object.freeze({
    delete: (key) => ipcRenderer.invoke("credential:delete", key),
    get: (key) => ipcRenderer.invoke("credential:get", key),
    set: (key, value) => ipcRenderer.invoke("credential:set", key, value),
  }),
  saveTextFile: (request) => ipcRenderer.invoke("export:save-json", request),
});

contextBridge.exposeInMainWorld("calorieStewardDesktop", bridge);
