export type CollectorStatus = 'ACTIVE' | 'INACTIVE' | 'ALL';

export type CollectorUserMetadata = { fullName: string; username: string };
export type EligibleCollectorUser = CollectorUserMetadata & { id: string };

export type Collector = {
  id: string;
  identification: string;
  firstName: string;
  firstLastName: string;
  secondLastName?: string;
  phone: string;
  alternativePhone?: string;
  email?: string;
  birthDate: string;
  address: string;
  photoFileKey?: string | null;
  userId: string | null;
  user?: CollectorUserMetadata | null;
  isActive: boolean;
};

export type CollectorPage = { items: Collector[]; total: number; pages: number };
