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
}

/**
 * Data about the currently playing track
 */
export interface TrackData {
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

  /**
   * Current system volume level (0-100)
   */
  volume: number;

  /**
   * Whether the system volume is muted
   */
  isMuted: boolean;
}

/**
 * Volume change event data
 */
export interface VolumeData {
  /**
   * Current volume level (0-100)
   */
  volume: number;

  /**
   * Whether volume is muted
   */
  isMuted: boolean;
}

/**
 * Events emitted by YandexMusicController
 */
export interface ControllerEvents {
  /**
   * Emitted when track information changes or when Yandex Music state changes
   */
  track: [data: TrackData | null];

  /**
   * Emitted when system volume changes
   */
  volume: [data: VolumeData];

  /**
   * Emitted when an error occurs
   */
  error: [error: Error];

  /**
   * Emitted when the controller process exits
   */
  exit: [code: number | null];
}
