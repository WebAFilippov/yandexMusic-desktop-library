import { spawn, ChildProcess } from 'child_process';
import { createInterface, Interface as ReadlineInterface } from 'readline';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { dirname, join, isAbsolute } from 'path';
import { promises as fs } from 'fs';
import { ControllerOptions, MediaData, VolumeData, ConnectionState } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CommandMessage {
  command: string;
  stepPercent?: number;
  value?: number;
}

interface CMessage {
  type: 'media' | 'volume' | 'ping' | string;
  data: MediaData | VolumeData | null;
}

// Extended Process interface for Electron
interface ExtendedProcess extends NodeJS.Process {
  resourcesPath?: string;
}

/**
 * Controller for Yandex Music desktop application on Windows.
 * Provides both event-based and promise-based APIs for controlling playback and volume.
 * 
 * Features:
 * - Connection state management
 * - Exponential backoff for auto-restart
 * - Health check/ping
 * - Command retry logic
 * - Last data buffering
 * 
 * @example
 * ```typescript
 * import ymc from 'yandex-music-desktop-library';
 * 
 * const controller = new ymc({
 *   thumbnailSize: 200,
 *   thumbnailQuality: 90,
 *   autoRestart: true,
 *   maxRestartDelay: 30000
 * });
 * 
 * // Monitor connection state
 * controller.on('state', (state) => {
 *   console.log('Connection state:', state);
 * });
 * 
 * // Media events (track info only)
 * controller.on('media', (data) => {
 *   console.log('Now playing:', data?.title);
 * });
 * 
 * // Volume events (separate from media)
 * controller.on('volume', (data) => {
 *   console.log('Volume:', data.volume);
 * });
 * 
 * await controller.start();
 * ```
 */
export class YandexMusicController extends EventEmitter {
  private process?: ChildProcess;
  private options: Required<ControllerOptions> & { maxRestartDelay: number };
  private restartTimer?: NodeJS.Timeout;
  private isStarted = false;
  private executablePath: string;
  private connectionState: ConnectionState = 'disconnected';
  private restartAttempt = 0;
  private readlineInterfaces: ReadlineInterface[] = [];
  
  // Buffer last received data
  private lastMediaData: MediaData | null = null;
  private lastVolumeData: VolumeData | null = null;

  /**
   * Creates a new YandexMusicController instance
   * @param options - Configuration options
   */
  constructor(options: ControllerOptions & { maxRestartDelay?: number } = {}) {
    super();
    this.options = {
      thumbnailSize: this.clamp(options.thumbnailSize ?? 150, 1, 1000),
      thumbnailQuality: this.clamp(options.thumbnailQuality ?? 85, 1, 100),
      autoRestart: options.autoRestart ?? true,
      restartDelay: Math.max(options.restartDelay ?? 1000, 0),
      maxRestartDelay: options.maxRestartDelay ?? 30000,
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
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get last received media data
   */
  getLastMediaData(): MediaData | null {
    return this.lastMediaData;
  }

  /**
   * Get last received volume data
   */
  getLastVolumeData(): VolumeData | null {
    return this.lastVolumeData;
  }

  private setState(state: ConnectionState) {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.emit('state', state);
    }
  }

  /**
   * Calculate restart delay with exponential backoff
   */
  private getRestartDelay(): number {
    const baseDelay = this.options.restartDelay;
    const maxDelay = this.options.maxRestartDelay;
    
    // Exponential backoff: delay * 2^attempt, capped at maxDelay
    const delay = Math.min(baseDelay * Math.pow(2, this.restartAttempt), maxDelay);
    
    // Add some jitter to prevent thundering herd
    const jitter = Math.random() * 1000;
    
    return delay + jitter;
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
    const extendedProcess = process as ExtendedProcess;
    if (extendedProcess.resourcesPath) {
      possiblePaths.push(
        join(extendedProcess.resourcesPath, 'app.asar.unpacked', 'node_modules', 'yandex-music-desktop-library', 'bin', 'win-x64', executableName),
        join(extendedProcess.resourcesPath, 'node_modules', 'yandex-music-desktop-library', 'bin', 'win-x64', executableName)
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
    const extendedProcess = process as ExtendedProcess;
    possiblePaths.push(
      // Standard npm location
      join(__dirname, '..', 'bin', 'win-x64', executableName),
      // Electron asar.unpacked
      ...(extendedProcess.resourcesPath ? [
        join(extendedProcess.resourcesPath, 'app.asar.unpacked', 'node_modules', 'yandex-music-desktop-library', 'bin', 'win-x64', executableName),
        join(extendedProcess.resourcesPath, 'node_modules', 'yandex-music-desktop-library', 'bin', 'win-x64', executableName)
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

    this.setState('connecting');

    // Validate and find the executable
    let validPath: string;
    try {
      validPath = await this.validateExecutablePath();
    } catch (err) {
      this.setState('error');
      throw err;
    }
    
    this.executablePath = validPath;

    const args = [
      `--thumbnail-size=${this.options.thumbnailSize}`,
      `--thumbnail-quality=${this.options.thumbnailQuality}`
    ];

    return new Promise((resolve, reject) => {
      let resolved = false;

      const cleanup = () => {
        // Cleanup all readline interfaces
        this.readlineInterfaces.forEach(rl => rl.close());
        this.readlineInterfaces = [];
      };

      try {
        this.process = spawn(this.executablePath, args, {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        this.process.on('error', (err) => {
          this.setState('error');
          this.emit('error', err);
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        });

        this.process.on('exit', (code) => {
          this.isStarted = false;
          cleanup();
          
          // Only emit exit if we were connected (not during connection)
          if (this.connectionState === 'connected') {
            this.emit('exit', code);
          }
          
          this.setState('disconnected');
          
          if (this.options.autoRestart && code !== 0 && !this.restartTimer) {
            const delay = this.getRestartDelay();
            this.restartAttempt++;
            
            this.setState('reconnecting');
            this.emit('error', new Error(`Controller exited (code ${code}). Restarting in ${Math.round(delay/1000)}s...`));
            
            this.restartTimer = setTimeout(() => {
              this.restartTimer = undefined;
              this.start().catch(() => {
                // If restart fails, emit final error
                this.setState('error');
                this.emit('error', new Error('Auto-restart failed after multiple attempts'));
              });
            }, delay);
          } else {
            this.restartAttempt = 0; // Reset on successful stop or no auto-restart
          }
        });

        // Handle stdout for JSON messages
        if (this.process.stdout) {
          const rl = createInterface({
            input: this.process.stdout,
            crlfDelay: Infinity
          });
          this.readlineInterfaces.push(rl);

          rl.on('line', (line) => {
            try {
              const msg = JSON.parse(line) as CMessage;
              
              if (msg.type === 'media') {
                this.lastMediaData = msg.data as MediaData | null;
                this.emit('media', this.lastMediaData);
                
                // Mark as connected on first media message
                if (this.connectionState === 'connecting') {
                  this.setState('connected');
                  this.restartAttempt = 0; // Reset restart counter on successful connection
                  if (!resolved) {
                    resolved = true;
                    resolve();
                  }
                }
              } else if (msg.type === 'volume') {
                this.lastVolumeData = msg.data as VolumeData;
                this.emit('volume', this.lastVolumeData);
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
          this.readlineInterfaces.push(rl);

          rl.on('line', (line) => {
            this.emit('error', new Error(line));
          });
        }

        // Timeout for initial connection
        const connectionTimeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            this.process?.kill();
            this.setState('error');
            reject(new Error('Connection timeout: no initial data received from C# process'));
          }
        }, 10000); // 10 second timeout for initial connection

        // Clear timeout on successful connection (handled in media event above)
        this.once('media', () => {
          clearTimeout(connectionTimeout);
        });

      } catch (err) {
        this.setState('error');
        if (!resolved) {
          resolved = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
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

    this.restartAttempt = 0; // Prevent auto-restart on intentional stop

    // Clear timers
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }

    // Cleanup readline interfaces
    this.readlineInterfaces.forEach(rl => rl.close());
    this.readlineInterfaces = [];

    return new Promise((resolve) => {
      if (!this.process) {
        this.isStarted = false;
        this.setState('disconnected');
        resolve();
        return;
      }

      // Send close command
      this.sendCommand({ command: 'close' }).catch(() => {
        // Ignore errors during shutdown
      });

      // Wait for graceful exit
      const timeout = setTimeout(() => {
        this.process?.kill();
        this.isStarted = false;
        this.setState('disconnected');
        resolve();
      }, 1000);

      this.process.on('exit', () => {
        clearTimeout(timeout);
        this.isStarted = false;
        this.setState('disconnected');
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

  /**
   * Send command with retry logic
   */
  private async sendCommandWithRetry(cmd: CommandMessage, maxRetries = 3): Promise<void> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.sendCommand(cmd);
        return; // Success
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        
        // If process died, don't retry
        if (!this.isRunning()) {
          throw new Error(`Controller not running: ${lastError.message}`);
        }
        
        // Wait before retry with exponential backoff
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
        }
      }
    }
    
    throw new Error(`Command failed after ${maxRetries} attempts: ${lastError?.message}`);
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
    return this.sendCommandWithRetry({ command: 'play' });
  }

  /**
   * Pause playback
   */
  async pause(): Promise<void> {
    return this.sendCommandWithRetry({ command: 'pause' });
  }

  /**
   * Toggle between play and pause
   */
  async playPause(): Promise<void> {
    return this.sendCommandWithRetry({ command: 'playpause' });
  }

  /**
   * Skip to next track
   */
  async next(): Promise<void> {
    return this.sendCommandWithRetry({ command: 'next' });
  }

  /**
   * Skip to previous track
   */
  async previous(): Promise<void> {
    return this.sendCommandWithRetry({ command: 'previous' });
  }

  // Volume Controls

  /**
   * Increase volume by specified step
   * @param stepPercent - Percentage to increase (default: 3)
   */
  async volumeUp(stepPercent: number = 3): Promise<void> {
    return this.sendCommandWithRetry({ 
      command: 'volume_up', 
      stepPercent: this.clamp(stepPercent, 1, 100) 
    });
  }

  /**
   * Decrease volume by specified step
   * @param stepPercent - Percentage to decrease (default: 3)
   */
  async volumeDown(stepPercent: number = 3): Promise<void> {
    return this.sendCommandWithRetry({ 
      command: 'volume_down', 
      stepPercent: this.clamp(stepPercent, 1, 100) 
    });
  }

  /**
   * Set volume to specific value
   * @param value - Volume level 0-100
   */
  async setVolume(value: number): Promise<void> {
    return this.sendCommandWithRetry({ 
      command: 'set_volume', 
      value: this.clamp(value, 0, 100) 
    });
  }

  /**
   * Toggle mute state
   */
  async toggleMute(): Promise<void> {
    return this.sendCommandWithRetry({ command: 'toggle_mute' });
  }
}

/**
 * Typed EventEmitter interface for YandexMusicController
 * Provides type-safe event handling with proper IntelliSense support
 */
export interface YandexMusicController {
  /**
   * Listen for connection state changes
   * @param event - 'state'
   * @param listener - Callback receiving ConnectionState
   */
  on(event: 'state', listener: (state: ConnectionState) => void): this;

  /**
   * Listen for media change events
   * @param event - 'media'
   * @param listener - Callback receiving MediaData or null when Yandex Music is not running
   */
  on(event: 'media', listener: (data: MediaData | null) => void): this;

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
   * Emit state event
   * @param event - 'state'
   * @param state - ConnectionState
   */
  emit(event: 'state', state: ConnectionState): boolean;

  /**
   * Emit media event
   * @param event - 'media'
   * @param data - MediaData or null
   */
  emit(event: 'media', data: MediaData | null): boolean;

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
