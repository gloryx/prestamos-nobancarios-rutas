import type { Collector } from '../../domain/entities/collector';

export const collectorUserLabel = (collector: Pick<Collector, 'user'>): string => collector.user?.username ?? 'SIN VINCULAR';
