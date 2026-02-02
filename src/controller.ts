import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { dirname, join, isAbsolute } from 'path';
import { promises as fs } from 'fs';
import { ControllerOptions, TrackData, VolumeData } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CommandMessage {
  command: string;
  stepPercent?: number;
  value?: number;
}

interface SessionMessage {
  type: 'session';
  data: TrackData | null;
}

/**
 * Controller for Yandex Music desktop application on Windows.
 * Provides both event-based and promise-based APIs for controlling playback and volume.
 * 
 * @example
 * ```typescript
 * import { YandexMusicController } from 'yandex-music-desktop-library';
 * 
 * const controller = new YandexMusicController({
 *   thumbnailSize: 200,
 *   thumbnailQuality: 90,
 *   autoRestart: true
 * });
 * 
 * // Event-based API
 * controller.on('track', (track) => {
 *   console.log(`Now playing: ${track?.title} by ${track?.artist}`);
 * });
 * 
 * await controller.start();
 * await controller.playPause();
 * await controller.setVolume(75);
 * ```
 */
export class YandexMusicController extends EventEmitter {
  private process?: ChildProcess;
  private options: Required<ControllerOptions>;
  private restartTimer?: NodeJS.Timeout;
  private isStarted = false;
  private executablePath: string;

  /**
   * Creates a new YandexMusicController instance
   * @param options - Configuration options
   */
  constructor(options: ControllerOptions = {}) {
    super();
    this.options = {
      thumbnailSize: this.clamp(options.thumbnailSize ?? 150, 1, 1000),
      thumbnailQuality: this.clamp(options.thumbnailQuality ?? 85, 1, 100),
      autoRestart: options.autoRestart ?? true,
      restartDelay: Math.max(options.restartDelay ?? 1000, 0),
      executablePath: options.executablePath ?? ''
    };

    // If executablePath is provided and absolute, use it directly
    if (options.executablePath && isAbsolute(options.executablePath)) {
      this.executablePath = options.executablePath;
    } else {
      // Auto-detect executable path
      this.executablePath = this.findExecutablePath();
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  /**
   * Auto-detects the executable path by trying multiple locations
   * - Standard npm location (development)
   * - Electron asar.unpacked location
   * - Relative paths
   */
  private findExecutablePath(): string {
    const executableName = 'YandexMusicController.exe';
    const possiblePaths: string[] = [];
    
    // 1. Standard development location from __dirname
    possiblePaths.push(join(__dirname, '..', 'bin', 'win-x64', executableName));
    
    // 2. Check if running in Electron and use resources path
    const resourcesPath = (process as any).resourcesPath;
    if (resourcesPath) {
      possiblePaths.push(
        join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'yandex-music-desktop-library', 'bin', 'win-x64', executableName),
        join(resourcesPath, 'node_modules', 'yandex-music-desktop-library', 'bin', 'win-x64', executableName)
      );
    }
    
    // 3. Try relative from current working directory (for custom installations)
    possiblePaths.push(
      join(process.cwd(), 'node_modules', 'yandex-music-desktop-library', 'bin', 'win-x64', executableName),
      join(process.cwd(), 'bin', 'win-x64', executableName)
    );
    
    // 4. Check for custom relative path from options
    if (this.options.executablePath && !isAbsolute(this.options.executablePath)) {
      possiblePaths.unshift(join(process.cwd(), this.options.executablePath));
    }

    return possiblePaths[0]; // Return first path, will be validated in start()
  }

  /**
   * Validates and finds the actual executable by checking multiple paths
   */
  private async validateExecutablePath(): Promise<string> {
    const executableName = 'YandexMusicController.exe';
    const possiblePaths: string[] = [];
    
    // Always try the configured path first
    possiblePaths.push(this.executablePath);
    
    // Additional fallback paths
    possiblePaths.push(
      // Standard npm location
      join(__dirname, '..', 'bin', 'win-x64', executableName),
      // Electron asar.unpacked
      ...((process as any).resourcesPath ? [
        join((process as any).resourcesPath, 'app.asar.unpacked', 'node_modules', 'yandex-music-desktop-library', 'bin', 'win-x64', executableName),
        join((process as any).resourcesPath, 'node_modules', 'yandex-music-desktop-library', 'bin', 'win-x64', executableName)
      ] : []),
      // Relative paths
      join(process.cwd(), 'node_modules', 'yandex-music-desktop-library', 'bin', 'win-x64', executableName),
      join(process.cwd(), 'bin', 'win-x64', executableName)
    );

    // Try each path
    for (const path of possiblePaths) {
      try {
        await fs.access(path);
        return path; // Found it!
      } catch {
        // Path doesn't exist, try next
        continue;
      }
    }

    // None of the paths worked - throw with helpful message
    throw new Error(
      `YandexMusicController.exe not found. Tried paths:\n` +
      possiblePaths.map(p => `  - ${p}`).join('\n') +
      `\n\nPlease ensure the package is properly installed. ` +
      `For Electron, add to your build config:\n` +
      `"asarUnpack": ["node_modules/yandex-music-desktop-library/bin/**/*"]`
    );
  }

  /**
   * Starts the controller and spawns the C# process
   * @returns Promise that resolves when controller is ready
   * @throws Error if controller is already running or fails to start
   */
  async start(): Promise<void> {
    if (this.isRunning()) {
      throw new Error('Controller is already running');
    }

    // Validate and find the executable
    const validPath = await this.validateExecutablePath();
    this.executablePath = validPath;

    const args = [
      `--thumbnail-size=${this.options.thumbnailSize}`,
      `--thumbnail-quality=${this.options.thumbnailQuality}`
    ];

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.executablePath, args, {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        this.process.on('error', (err) => {
          this.emit('error', err);
          reject(err);
        });

        this.process.on('exit', (code) => {
          this.isStarted = false;
          this.emit('exit', code);
          
          if (this.options.autoRestart && code !== 0 && !this.restartTimer) {
            this.restartTimer = setTimeout(() => {
              this.restartTimer = undefined;
              this.start().catch(() => {
                // Auto-restart failed, emit error
                this.emit('error', new Error('Auto-restart failed'));
              });
            }, this.options.restartDelay);
          }
        });

        // Handle stdout for JSON messages
        if (this.process.stdout) {
          const rl = createInterface({
            input: this.process.stdout,
            crlfDelay: Infinity
          });

          rl.on('line', (line) => {
            try {
              const msg = JSON.parse(line) as SessionMessage;
              if (msg.type === 'session') {
                this.emit('track', msg.data);
                
                // Also emit volume event when track data changes
                if (msg.data) {
                  this.emit('volume', {
                    volume: msg.data.volume,
                    isMuted: msg.data.isMuted
                  });
                }
              }
            } catch {
              // Ignore non-JSON lines (debug output)
            }
          });
        }

        // Handle stderr for errors
        if (this.process.stderr) {
          const rl = createInterface({
            input: this.process.stderr,
            crlfDelay: Infinity
          });

          rl.on('line', (line) => {
            this.emit('error', new Error(line));
          });
        }

        // Wait a moment for process to initialize
        setTimeout(() => {
          this.isStarted = true;
          resolve();
        }, 500);

      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Stops the controller and kills the C# process
   * @returns Promise that resolves when process is terminated
   */
  async stop(): Promise<void> {
    if (!this.isRunning()) {
      return;
    }

    // Clear restart timer
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }

    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      // Send close command
      this.sendCommand({ command: 'close' });

      // Wait for graceful exit
      const timeout = setTimeout(() => {
        this.process?.kill();
        this.isStarted = false;
        resolve();
      }, 1000);

      this.process.on('exit', () => {
        clearTimeout(timeout);
        this.isStarted = false;
        resolve();
      });
    });
  }

  /**
   * Checks if the controller is currently running
   * @returns true if process is active
   */
  isRunning(): boolean {
    return this.isStarted && this.process !== undefined && !this.process.killed;
  }

  private async sendCommand(cmd: CommandMessage): Promise<void> {
    if (!this.isRunning()) {
      throw new Error('Controller is not running. Call start() first.');
    }

    return new Promise((resolve, reject) => {
      const message = JSON.stringify(cmd) + '\n';
      this.process!.stdin!.write(message, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // Playback Controls

  /**
   * Start playback
   */
  async play(): Promise<void> {
    return this.sendCommand({ command: 'play' });
  }

  /**
   * Pause playback
   */
  async pause(): Promise<void> {
    return this.sendCommand({ command: 'pause' });
  }

  /**
   * Toggle between play and pause
   */
  async playPause(): Promise<void> {
    return this.sendCommand({ command: 'playpause' });
  }

  /**
   * Skip to next track
   */
  async next(): Promise<void> {
    return this.sendCommand({ command: 'next' });
  }

  /**
   * Skip to previous track
   */
  async previous(): Promise<void> {
    return this.sendCommand({ command: 'previous' });
  }

  // Volume Controls

  /**
   * Increase volume by specified step
   * @param stepPercent - Percentage to increase (default: 3)
   */
  async volumeUp(stepPercent: number = 3): Promise<void> {
    return this.sendCommand({ 
      command: 'volume_up', 
      stepPercent: this.clamp(stepPercent, 1, 100) 
    });
  }

  /**
   * Decrease volume by specified step
   * @param stepPercent - Percentage to decrease (default: 3)
   */
  async volumeDown(stepPercent: number = 3): Promise<void> {
    return this.sendCommand({ 
      command: 'volume_down', 
      stepPercent: this.clamp(stepPercent, 1, 100) 
    });
  }

  /**
   * Set volume to specific value
   * @param value - Volume level 0-100
   */
  async setVolume(value: number): Promise<void> {
    return this.sendCommand({ 
      command: 'set_volume', 
      value: this.clamp(value, 0, 100) 
    });
  }

  /**
   * Toggle mute state
   */
  async toggleMute(): Promise<void> {
    return this.sendCommand({ command: 'toggle_mute' });
  }
}

/**
 * Typed EventEmitter interface for YandexMusicController
 * Provides type-safe event handling with proper IntelliSense support
 */
export interface YandexMusicController {
  /**
   * Listen for track change events
   * @param event - 'track'
   * @param listener - Callback receiving TrackData or null when Yandex Music is not running
   */
  on(event: 'track', listener: (data: TrackData | null) => void): this;

  /**
   * Listen for volume change events
   * @param event - 'volume'
   * @param listener - Callback receiving VolumeData
   */
  on(event: 'volume', listener: (data: VolumeData) => void): this;

  /**
   * Listen for error events
   * @param event - 'error'
   * @param listener - Callback receiving Error object
   */
  on(event: 'error', listener: (error: Error) => void): this;

  /**
   * Listen for exit events
   * @param event - 'exit'
   * @param listener - Callback receiving exit code
   */
  on(event: 'exit', listener: (code: number | null) => void): this;

  /**
   * Emit track event
   * @param event - 'track'
   * @param data - TrackData or null
   */
  emit(event: 'track', data: TrackData | null): boolean;

  /**
   * Emit volume event
   * @param event - 'volume'
   * @param data - VolumeData
   */
  emit(event: 'volume', data: VolumeData): boolean;

  /**
   * Emit error event
   * @param event - 'error'
   * @param error - Error object
   */
  emit(event: 'error', error: Error): boolean;

  /**
   * Emit exit event
   * @param event - 'exit'
   * @param code - Exit code or null
   */
  emit(event: 'exit', code: number | null): boolean;
}
