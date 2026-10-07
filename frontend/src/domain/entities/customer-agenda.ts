export type CustomerAgendaAssignmentStatus = 'ALL' | 'ASSIGNED' | 'UNASSIGNED';
export type CustomerAgendaItemStatus = 'ASSIGNED' | 'WITHOUT_ROUTE' | 'WITHOUT_COLLECTOR' | 'INVALID_ROUTE' | 'INVALID_COLLECTOR';
export type CustomerAgendaPageSize = 10 | 20 | 50;

export type CustomerAgendaFilters = {
  search: string;
  collectorId: string;
  routeId: string;
  provinceCode: string;
  cantonCode: string;
  districtCode: string;
  assignmentStatus: CustomerAgendaAssignmentStatus;
  page: number;
  pageSize: CustomerAgendaPageSize;
};

export type CustomerAgendaOption = { id: string; name: string };
export type CustomerAgendaRouteOption = CustomerAgendaOption & { collectorId: string | null };
export type CustomerAgendaProvinceOption = { code: number; name: string };
export type CustomerAgendaCantonOption = { code: number; name: string; provinceCode: number };
export type CustomerAgendaDistrictOption = { code: number; name: string; cantonCode: number };
export type CustomerAgendaItem = {
  customerId: string;
  customerName: string;
  identification: string;
  primaryPhone: string | null;
  activeLoanCount: number;
  assignmentStatus: CustomerAgendaItemStatus;
  route: CustomerAgendaOption | null;
  collector: CustomerAgendaOption | null;
  territory: null | {
    provinceCode: number;
    provinceName: string;
    cantonCode: number;
    cantonName: string;
    districtCode: number;
    districtName: string;
  };
};

export type CustomerAgendaResult = {
  summary: {
    total: number;
    assigned: number;
    unassigned: number;
    withoutRoute: number;
    routeWithoutCollector: number;
    invalidRoute: number;
    invalidCollector: number;
  };
  pagination: { page: number; pageSize: CustomerAgendaPageSize; total: number; totalPages: number };
  options: {
    collectors: CustomerAgendaOption[];
    routes: CustomerAgendaRouteOption[];
    provinces: CustomerAgendaProvinceOption[];
    cantons: CustomerAgendaCantonOption[];
    districts: CustomerAgendaDistrictOption[];
  };
  items: CustomerAgendaItem[];
};
