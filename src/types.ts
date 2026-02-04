/**
 * Options for configuring the YandexMusicController
 */
export interface ControllerOptions {
  /**
   * Thumbnail size in pixels. Must be between 1 and 1000.
   * @default 150
   */
  thumbnailSize?: number;

  /**
   * JPEG quality for thumbnails. Must be between 1 and 100.
   * @default 85
   */
  thumbnailQuality?: number;

  /**
   * Whether to automatically restart the controller if it crashes.
   * @default true
   */
  autoRestart?: boolean;

  /**
   * Delay in milliseconds before auto-restart.
   * @default 1000
   */
  restartDelay?: number;

  /**
   * Custom path to the C# executable. 
   * If not provided, will try to auto-detect the executable.
   * Useful for Electron production builds with asarUnpack.
   * @default undefined (auto-detect)
   */
  executablePath?: string;

  /**
   * Maximum restart delay in milliseconds with exponential backoff.
   * Prevents restart spam by capping the delay at this value.
   * @default 30000 (30 seconds)
   */
  maxRestartDelay?: number;
}

/**
 * Audio device information
 */
export interface AudioDevice {
  /**
   * Unique device identifier (Windows device ID)
   */
  id: string;

  /**
   * Human-readable device name (e.g., "Speakers (Realtek)")
   */
  name: string;

  /**
   * Whether this is the default/active device
   */
  isDefault: boolean;

  /**
   * Whether the device is muted
   */
  isMuted: boolean;

  /**
   * Current volume level (0-100)
   */
  volume: number;
}

/**
 * Error data from C# service
 */
export interface ErrorData {
  /**
   * Error code for programmatic handling
   */
  code: string;

  /**
   * Human-readable error message
   */
  message: string;

  /**
   * Additional error details (optional)
   */
  details?: Record<string, unknown>;
}

/**
 * Media data - track information only (no volume)
 */
export interface MediaData {
  /**
   * Unique identifier for the session
   */
  id: string;

  /**
   * Application identifier
   */
  appId: string;

  /**
   * Human-readable application name
   */
  appName: string;

  /**
   * Track title
   */
  title: string;

  /**
   * Track artist
   */
  artist: string;

  /**
   * Album name
   */
  album: string;

  /**
   * Current playback status
   */
  playbackStatus: 'Playing' | 'Paused' | 'Stopped' | 'Unknown';

  /**
   * Base64-encoded thumbnail image (JPEG), or null if not available
   */
  thumbnailBase64: string | null;

  /**
   * Whether this is the currently focused media session
   */
  isFocused: boolean;
}

/**
 * Connection state of the controller
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/**
 * Events emitted by YandexMusicController
 */
export interface ControllerEvents {
  /**
   * Emitted when connection state changes
   */
  state: [state: ConnectionState];

  /**
   * Emitted when track/media information changes
   * Receives null when Yandex Music is not running
   */
  media: [data: MediaData | null];

  /**
   * Emitted when audio devices change (volume, mute, device added/removed, default changed)
   * Array contains ALL audio devices
   */
  volume: [devices: AudioDevice[]];

  /**
   * Emitted when an error occurs in the C# service
   */
  error: [error: ErrorData];

  /**
   * Emitted when the controller process exits
   */
  exit: [code: number | null];
}
