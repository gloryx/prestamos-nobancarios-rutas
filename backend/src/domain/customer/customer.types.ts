export type IdentificationType = 'NATIONAL' | 'FOREIGN';
export type Gender = 'MALE' | 'FEMALE';
export type Nationality = 'COSTA_RICAN' | 'NICARAGUAN' | 'PANAMANIAN' | 'HONDURAN' | 'OTHER';

export type Customer = {
  id: string;
  identificationType: IdentificationType;
  identification: string;
  firstName: string;
  middleName?: string;
  firstLastName: string;
  secondLastName?: string;
  gender: Gender;
  birthDate: string;
  primaryPhone: string;
  secondaryPhone?: string;
  email?: string;
  nationality: Nationality;
  otherNationality?: string;
  identificationFrontFileKey: string;
  observations?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerAddress = {
  id: string;
  customerId: string;
  districtCode: number;
  exactAddress: string;
  latitude?: number;
  longitude?: number;
  propertyPhotoFileKey?: string;
  createdAt: Date;
  updatedAt: Date;
};
