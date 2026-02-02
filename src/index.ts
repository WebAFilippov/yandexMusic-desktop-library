/**
 * Yandex Music Desktop Library
 * 
 * TypeScript library for controlling Yandex Music desktop application on Windows.
 * Provides event-based and promise-based APIs for media control and volume management.
 * 
 * @packageDocumentation
 */

export { YandexMusicController } from './controller.js';
export { YandexMusicController as default } from './controller.js';
export type {
  ControllerOptions,
  MediaData,
  VolumeData,
  ControllerEvents,
  ConnectionState,
} from './types.js';
