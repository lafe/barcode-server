import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';

import * as robotjs from 'robotjs'
import * as network from 'network';
import * as os from 'os';
import * as path from 'path';

import * as WebSocket from 'ws';
const PORT = 57891;
const wss = new WebSocket.Server({ port: PORT });

import * as b from 'bonjour'
const bonjour = b();

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

let mdnsAd;
let developmentMode = process.argv.slice(1).some(val => val === '--dev');

function createWindow() {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 1024, height: 720,
        minWidth: 800, minHeight: 600
    })

    if (developmentMode) {
        mainWindow.webContents.on('did-fail-load', () => {
            setTimeout(() => mainWindow.reload(), 2000);
        })
        mainWindow.loadURL('http://localhost:4200');
        mainWindow.webContents.openDevTools();
    } else {
        // and load the index.html of the app.
        mainWindow.loadURL('file://' + __dirname + '/index.html');
    }

    // Open the DevTools.
    // mainWindow.webContents.openDevTools()

    // Emitted when the window is closed.
    mainWindow.on('closed', function () {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null
        wss.clients.forEach(client => {
            // if (client.readyState === WebSocket.OPEN) {
            client.close();
            // }
        });
        bonjour.unpublishAll(() => {
            //bonjour.destroy()
        });

        if (mdnsAd) {
            mdnsAd.stop();
        }
    })


    try {
        var mdns = require('mdns');

        mdnsAd = mdns.createAdvertisement(mdns.tcp('http'), PORT, {
            name: 'Barcode to PC server - ' + getNumber()
        });
        mdnsAd.start();
    } catch (ex) {
        dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Error',
            message: 'Apple Bonjour is missing.\nThe app may fail to detect automatically the server.\n\nTo remove this alert try to install Barcode to PC server again an reboot your system.',
        });

        var bonjourService = bonjour.publish({ name: 'Barcode to PC server - ' + getNumber(), type: 'http', port: PORT })

        bonjourService.on('error', err => { // err is never set?
            dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'Error',
                message: 'An error occured while announcing the server.'
            });
        });
    }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', function () {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
        createWindow()
    }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

// In main process.

let ipcClient;
var settings;

ipcMain
    .on('connect', (event, arg) => {
        ipcClient = event.sender;
    }).on('sendSettings', (event, arg) => {
        settings = arg;
    }).on('getAddresses', (event, arg) => {
        network.get_interfaces_list((err, networkInterfaces) => {
            let addresses = [];

            for (let key in networkInterfaces) {
                let ip = networkInterfaces[key].ip_address;
                if (ip) {
                    addresses.push(ip);
                }
            };

            ipcClient.send('getAddresses', addresses);
        });
    }).on('getDefaultAddress', (event, arg) => {
        network.get_private_ip((err, ip) => {
            ipcClient.send('getDefaultAddress', ip);
        });
    }).on('getHostname', (event, arg) => {
        ipcClient.send('getHostname', os.hostname());
    });


wss.on('connection', (ws, req) => {
    console.log("ws(incoming connection)")

    let clientName = "unknown";
    // const clientAddress = req.connection.remoteAddress;
    ipcClient.send('onClientConnect', '');

    ws.on('message', messageData => {
        console.log('ws(message): ', messageData)
        if (!mainWindow) return;
        let messageObj = JSON.parse(messageData.toString());
        if (messageObj.action == 'putScan') {
            ipcClient.send(messageObj.action, messageObj.scan);

            if (settings.enableRealtimeStrokes) {
                settings.typedString.forEach((stringComponent) => {
                    if (stringComponent.type == 'barcode') {
                        robotjs.typeString(messageObj.scan.text);
                    } else if (stringComponent.type == 'text') {
                        robotjs.typeString(stringComponent.value);
                    } else if (stringComponent.type == 'key') {
                        robotjs.keyTap(stringComponent.value);
                    } else if (stringComponent.type == 'variable') {
                        robotjs.typeString(eval(stringComponent.value));
                    }
                });
            }

            if (settings.enableOpenInBrowser) {
                shell.openExternal(messageObj.data.scannings[0].text);
            }
        } else if (messageObj.action == 'helo') {
            let response = { "action": "helo", "data": { "version": app.getVersion() } };
            if (messageObj.data && messageObj.data.deviceName) {
                clientName = messageObj.data.deviceName;
            }
            ws.send(JSON.stringify(response));
        }
    });

    ws.on('close', () => {
        console.log('ws(close)');
    });
});


function getNumber() {
    let hostname = os.hostname();
    let result = '';
    for (let i = 0; i < hostname.length; i++) {
        result += hostname[i].charCodeAt(0);
    }
    return result.substring(0, 10);
}