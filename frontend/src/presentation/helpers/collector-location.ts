export type CapturedLocation = { latitude: number; longitude: number; accuracy: number };

const geolocationMessage = (error: GeolocationPositionError): string => {
  if (error.code === error.PERMISSION_DENIED) return 'El permiso de ubicación fue denegado. Habilitalo en el navegador para continuar.';
  if (error.code === error.POSITION_UNAVAILABLE) return 'El dispositivo no pudo determinar la ubicación actual.';
  if (error.code === error.TIMEOUT) return 'La solicitud de ubicación agotó el tiempo de espera. Intentá nuevamente en un lugar con mejor señal.';
  return 'No se pudo obtener la ubicación del dispositivo.';
};

export function requestCurrentLocation(geolocation?: Geolocation): Promise<CapturedLocation> {
  if (!geolocation) return Promise.reject(new Error('Este navegador no admite ubicación GPS.'));
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition((position) => {
      const { latitude, longitude, accuracy } = position.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        reject(new Error('El GPS devolvió coordenadas inválidas. No se guardó ninguna ubicación.'));
        return;
      }
      resolve({ latitude, longitude, accuracy });
    }, (error) => reject(new Error(geolocationMessage(error))), { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  });
}

export function validateSitePhoto(file?: File): string | null {
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'La foto debe ser JPEG, PNG o WEBP.';
  if (file.size > 5 * 1024 * 1024) return 'La foto no puede superar 5 MB.';
  return null;
}
