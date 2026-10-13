import type { CollectorPrecollectionClock } from '../../application/collector-precollection/collector-precollection.ports';

export class CostaRicaClock implements CollectorPrecollectionClock {
  today(value = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(value);
  }
}
