# Yandex Music Desktop Library

[![npm version](https://badge.fury.io/js/yandex-music-desktop-library.svg)](https://www.npmjs.com/package/yandex-music-desktop-library)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TypeScript library for controlling **Yandex Music desktop application** on Windows. Provides event-based and promise-based APIs for media control, volume management, and real-time track information.

## ⚠️ Requirements

- **Windows 10/11** (version 1809 or later)
- **Node.js** 14.0.0 or later
- **Yandex Music** desktop application installed and running

## 🚀 Installation

```bash
npm install yandex-music-desktop-library
```

**Note**: This package is **Windows-only** and includes a native C# executable (~90MB).

## 📖 Quick Start

```typescript
// Option 1: Default import
import ymc from 'yandex-music-desktop-library';

// Option 2: Named import
import { YandexMusicController } from 'yandex-music-desktop-library';

// Create controller with custom options
const controller = new ymc({
  thumbnailSize: 200,      // Thumbnail size in pixels (default: 150)
  thumbnailQuality: 90,    // JPEG quality 1-100 (default: 85)
  autoRestart: true,       // Auto-restart on crash (default: true)
  restartDelay: 1000       // Restart delay in ms (default: 1000)
});

// Event-based API - listen for media changes (track, artist, playback status)
controller.on('media', (data) => {
  if (data) {
    console.log(`🎵 Now playing: ${data.title} by ${data.artist}`);
    console.log(`📀 Album: ${data.album}`);
    console.log(`▶️ Status: ${data.playbackStatus}`);
    // Note: volume and isMuted are in a separate 'volume' event
  } else {
    console.log('⏹️ Yandex Music is not running');
  }
});

// Listen for volume changes (separate from media)
controller.on('volume', ({ volume, isMuted }) => {
  console.log(`🔊 Volume: ${volume}% (Muted: ${isMuted})`);
});

// Handle errors
controller.on('error', (error) => {
  console.error('Controller error:', error.message);
});

// Handle controller exit/restart
controller.on('exit', (code) => {
  console.log('Controller exited with code:', code);
  // If autoRestart is true, controller will restart automatically
});

// Start the controller
await controller.start();

// Promise-based API - control playback
await controller.playPause();
await controller.next();
await controller.previous();

// Control volume
await controller.setVolume(75);
await controller.volumeUp(5);   // Increase by 5%
await controller.volumeDown(3); // Decrease by 3%
await controller.toggleMute();

// Stop the controller
await controller.stop();
```

## 🔌 Electron Integration

### Basic Usage

```typescript
import ymc from 'yandex-music-desktop-library';
import { ipcMain } from 'electron';

const controller = new ymc({
  thumbnailSize: 150,
  thumbnailQuality: 85,
  autoRestart: true
});

// Start controller when app is ready
app.whenReady().then(async () => {
  await controller.start();
});

// IPC handlers for renderer process
ipcMain.handle('play-pause', () => controller.playPause());
ipcMain.handle('next-track', () => controller.next());
ipcMain.handle('previous-track', () => controller.previous());
ipcMain.handle('set-volume', (_, value) => controller.setVolume(value));
ipcMain.handle('volume-up', (_, step) => controller.volumeUp(step));
ipcMain.handle('volume-down', (_, step) => controller.volumeDown(step));
ipcMain.handle('toggle-mute', () => controller.toggleMute());

// Send media updates to renderer (track info only)
controller.on('media', (data) => {
  mainWindow.webContents.send('media-update', data);
});

// Send volume updates to renderer (separate from media)
controller.on('volume', (data) => {
  mainWindow.webContents.send('volume-update', data);
});

// Cleanup on quit
app.on('before-quit', async () => {
  await controller.stop();
});
```

### Production Build with electron-builder

**Important:** The library includes a native C# executable (~90MB) that must be unpacked from the ASAR archive to work in production.

Add to your `package.json`:

```json
{
  "build": {
    "asarUnpack": [
      "node_modules/yandex-music-desktop-library/bin/**/*"
    ]
  }
}
```

#### Auto-detection (Default)

The library automatically detects the executable location in most cases:

```typescript
import ymc from 'yandex-music-desktop-library';

// Works in both development and production
const controller = new ymc();
await controller.start();
```

#### Custom Executable Path (if auto-detection fails)

If the library cannot find the executable automatically, provide a custom path:

```typescript
import ymc from 'yandex-music-desktop-library';
import path from 'path';

const controller = new ymc({
  // Absolute path
  executablePath: path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'yandex-music-desktop-library',
    'bin',
    'win-x64',
    'YandexMusicController.exe'
  )
});

await controller.start();
```

The library will try these paths in order:
1. Custom `executablePath` (if provided)
2. Standard npm location
3. Electron asar.unpacked location
4. Current working directory locations

## 📡 MQTT / ESP32 Integration

Perfect for DIY hardware controllers:

```typescript
import ymc from 'yandex-music-desktop-library';
import mqtt from 'mqtt';

const controller = new ymc();
const client = mqtt.connect('mqtt://your-esp32-ip');

// Start controller
await controller.start();

// Send track data to ESP32
controller.on('media', (data) => {
  if (data) {
    client.publish('media/current', JSON.stringify({
      title: data.title,
      artist: data.artist,
      album: data.album,
      status: data.playbackStatus,
      hasThumbnail: !!data.thumbnailBase64
    }));

    // Send thumbnail separately (it's large)
    if (data.thumbnailBase64) {
      client.publish('media/thumbnail', data.thumbnailBase64);
    }
  }
});

// Send volume data to ESP32 (separate topic)
controller.on('volume', (data) => {
  client.publish('media/volume', JSON.stringify({
    volume: data.volume,
    isMuted: data.isMuted
  }));
});

// Receive commands from ESP32
client.subscribe('esp32/commands');
client.on('message', (topic, message) => {
  const cmd = message.toString();
  
  switch (cmd) {
    case 'playpause':
      controller.playPause();
      break;
    case 'next':
      controller.next();
      break;
    case 'prev':
      controller.previous();
      break;
    case 'vol_up':
      controller.volumeUp(5);
      break;
    case 'vol_down':
      controller.volumeDown(5);
      break;
    case 'mute':
      controller.toggleMute();
      break;
  }
});
```

## 📋 API Reference

### ControllerOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `thumbnailSize` | `number` | `150` | Thumbnail size in pixels (1-1000) |
| `thumbnailQuality` | `number` | `85` | JPEG quality (1-100) |
| `autoRestart` | `boolean` | `true` | Auto-restart on crash |
| `restartDelay` | `number` | `1000` | Restart delay in milliseconds |
| `executablePath` | `string` | `undefined` | Custom path to C# executable (auto-detected if not provided) |

### MediaData

**Media data** - track information only (no volume fields):

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Session unique identifier |
| `appId` | `string` | Application identifier |
| `appName` | `string` | Human-readable app name |
| `title` | `string` | Track title |
| `artist` | `string` | Track artist |
| `album` | `string` | Album name |
| `playbackStatus` | `'Playing' \| 'Paused' \| 'Stopped' \| 'Unknown'` | Current playback status |
| `thumbnailBase64` | `string \| null` | Base64-encoded JPEG thumbnail |
| `isFocused` | `boolean` | Whether this is the focused session |

### VolumeData

**Volume data** - volume and mute status only:

| Property | Type | Description |
|----------|------|-------------|
| `volume` | `number` | System volume level (0-100) |
| `isMuted` | `boolean` | Whether volume is muted |

### YandexMusicController

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Start the controller |
| `stop()` | `Promise<void>` | Stop the controller |
| `isRunning()` | `boolean` | Check if controller is active |
| `play()` | `Promise<void>` | Start playback |
| `pause()` | `Promise<void>` | Pause playback |
| `playPause()` | `Promise<void>` | Toggle play/pause |
| `next()` | `Promise<void>` | Skip to next track |
| `previous()` | `Promise<void>` | Skip to previous track |
| `volumeUp(stepPercent?)` | `Promise<void>` | Increase volume (default step: 3) |
| `volumeDown(stepPercent?)` | `Promise<void>` | Decrease volume (default step: 3) |
| `setVolume(value)` | `Promise<void>` | Set volume to specific value (0-100) |
| `toggleMute()` | `Promise<void>` | Toggle mute state |

#### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `media` | `MediaData \| null` | Emitted when track/media info changes. `null` when Yandex Music is not running. |
| `volume` | `VolumeData` | Emitted when system volume or mute state changes |
| `error` | `Error` | Emitted when an error occurs |
| `exit` | `number \| null` | Emitted when the controller process exits |

## 🛠️ Development

```bash
# Clone repository
git clone https://github.com/WebAFilippov/yandexMusic-desktop-library.git
cd yandexMusic-desktop-library

# Install dependencies
npm install

# Build TypeScript
npm run build

# The C# executable will be automatically built and included in bin/win-x64/
```

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🐛 Issues

If you find a bug, please [create an issue](https://github.com/WebAFilippov/yandexMusic-desktop-library/issues) with:
- Windows version
- Node.js version
- Steps to reproduce
- Error messages (if any)

## 💡 Related Projects

- [YandexMusicController](https://github.com/WebAFilippov/af-csharp-yandexMusic) - The C# backend service

---

**Note**: This package is for Windows only and requires the Yandex Music desktop application to be installed.
