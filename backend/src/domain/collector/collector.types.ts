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
  photoFileKey: string | null;
  userId: string | null;
  user?: CollectorUserMetadata | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CollectorUserMetadata = { fullName: string; username: string };
export type EligibleCollectorUser = { id: string; fullName: string; username: string };
