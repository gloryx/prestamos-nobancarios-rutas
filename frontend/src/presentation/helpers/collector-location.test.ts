import { describe, expect, it, vi } from 'vitest';
import { requestCurrentLocation, validateSitePhoto } from './collector-location';

const error = (code: number): GeolocationPositionError => ({ code, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });

describe('requestCurrentLocation', () => {
  it('requests a single high-accuracy current position', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success({ coords: { latitude: 10.3, longitude: -85.8, accuracy: 12 } } as GeolocationPosition));
    await expect(requestCurrentLocation({ getCurrentPosition } as unknown as Geolocation)).resolves.toEqual({ latitude: 10.3, longitude: -85.8, accuracy: 12 });
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  });

  it('reports denied, unavailable, timeout and unsupported GPS without inventing coordinates', async () => {
    await expect(requestCurrentLocation()).rejects.toThrow('no admite ubicación GPS');
    for (const [code, message] of [[1, 'denegado'], [2, 'determinar'], [3, 'tiempo de espera']] as const) {
      const geolocation = { getCurrentPosition: (_success: PositionCallback, failure: PositionErrorCallback) => failure(error(code)) } as unknown as Geolocation;
      await expect(requestCurrentLocation(geolocation)).rejects.toThrow(message);
    }
  });

  it('rejects invalid coordinates', async () => {
    const geolocation = { getCurrentPosition: (success: PositionCallback) => success({ coords: { latitude: Number.NaN, longitude: -85, accuracy: 5 } } as GeolocationPosition) } as unknown as Geolocation;
    await expect(requestCurrentLocation(geolocation)).rejects.toThrow('coordenadas inválidas');
  });
});

describe('validateSitePhoto', () => {
  it('accepts supported photos and rejects unsafe type or size', () => {
    expect(validateSitePhoto(new File(['photo'], 'home.jpg', { type: 'image/jpeg' }))).toBeNull();
    expect(validateSitePhoto(new File(['text'], 'home.txt', { type: 'text/plain' }))).toContain('JPEG');
    expect(validateSitePhoto(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'home.png', { type: 'image/png' }))).toContain('5 MB');
  });
});
