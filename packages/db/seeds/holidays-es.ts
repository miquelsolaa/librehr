export interface HolidayDefinition {
  date: string; // YYYY-MM-DD
  name: {
    ca: string;
    es: string;
    en: string;
  };
  scope: "national" | "regional";
  region?: string;
}

export const spanishHolidays2026_2027: HolidayDefinition[] = [
  // 2026 National
  {
    date: "2026-01-01",
    name: { ca: "Cap d'Any", es: "Año Nuevo", en: "New Year's Day" },
    scope: "national",
  },
  {
    date: "2026-01-06",
    name: { ca: "Reis", es: "Epifanía del Señor", en: "Epiphany" },
    scope: "national",
  },
  {
    date: "2026-04-03",
    name: { ca: "Divendres Sant", es: "Viernes Santo", en: "Good Friday" },
    scope: "national",
  },
  {
    date: "2026-05-01",
    name: {
      ca: "Festa del Treball",
      es: "Fiesta del Trabajo",
      en: "Labour Day",
    },
    scope: "national",
  },
  {
    date: "2026-08-15",
    name: { ca: "L'Assumpció", es: "Asunción de la Virgen", en: "Assumption" },
    scope: "national",
  },
  {
    date: "2026-10-12",
    name: {
      ca: "Festa Nacional d'Espanya",
      es: "Fiesta Nacional de España",
      en: "National Day of Spain",
    },
    scope: "national",
  },
  {
    date: "2026-11-01",
    name: { ca: "Tots Sants", es: "Todos los Santos", en: "All Saints Day" },
    scope: "national",
  },
  {
    date: "2026-12-06",
    name: {
      ca: "Dia de la Constitució",
      es: "Día de la Constitución",
      en: "Constitution Day",
    },
    scope: "national",
  },
  {
    date: "2026-12-08",
    name: {
      ca: "La Immaculada Concepció",
      es: "Inmaculada Concepción",
      en: "Immaculate Conception",
    },
    scope: "national",
  },
  {
    date: "2026-12-25",
    name: { ca: "Nadal", es: "Navidad", en: "Christmas Day" },
    scope: "national",
  },

  // 2026 Catalunya
  {
    date: "2026-04-06",
    name: {
      ca: "Dilluns de Pasqua",
      es: "Lunes de Pascua",
      en: "Easter Monday",
    },
    scope: "regional",
    region: "CT",
  },
  {
    date: "2026-06-24",
    name: { ca: "Sant Joan", es: "San Juan", en: "Saint John's Day" },
    scope: "regional",
    region: "CT",
  },
  {
    date: "2026-09-11",
    name: {
      ca: "Diada Nacional de Catalunya",
      es: "Fiesta Nacional de Cataluña",
      en: "National Day of Catalonia",
    },
    scope: "regional",
    region: "CT",
  },
  {
    date: "2026-12-26",
    name: { ca: "Sant Esteve", es: "San Esteban", en: "Saint Stephen's Day" },
    scope: "regional",
    region: "CT",
  },

  // 2027 National
  {
    date: "2027-01-01",
    name: { ca: "Cap d'Any", es: "Año Nuevo", en: "New Year's Day" },
    scope: "national",
  },
  {
    date: "2027-01-06",
    name: { ca: "Reis", es: "Epifanía del Señor", en: "Epiphany" },
    scope: "national",
  },
  {
    date: "2027-03-26",
    name: { ca: "Divendres Sant", es: "Viernes Santo", en: "Good Friday" },
    scope: "national",
  },
  {
    date: "2027-05-01",
    name: {
      ca: "Festa del Treball",
      es: "Fiesta del Trabajo",
      en: "Labour Day",
    },
    scope: "national",
  },
  {
    date: "2027-08-15",
    name: { ca: "L'Assumpció", es: "Asunción de la Virgen", en: "Assumption" },
    scope: "national",
  },
  {
    date: "2027-10-12",
    name: {
      ca: "Festa Nacional d'Espanya",
      es: "Fiesta Nacional de España",
      en: "National Day of Spain",
    },
    scope: "national",
  },
  {
    date: "2027-11-01",
    name: { ca: "Tots Sants", es: "Todos los Santos", en: "All Saints Day" },
    scope: "national",
  },
  {
    date: "2027-12-06",
    name: {
      ca: "Dia de la Constitució",
      es: "Día de la Constitución",
      en: "Constitution Day",
    },
    scope: "national",
  },
  {
    date: "2027-12-08",
    name: {
      ca: "La Immaculada Concepció",
      es: "Inmaculada Concepción",
      en: "Immaculate Conception",
    },
    scope: "national",
  },
  {
    date: "2027-12-25",
    name: { ca: "Nadal", es: "Navidad", en: "Christmas Day" },
    scope: "national",
  },

  // 2027 Catalunya
  {
    date: "2027-03-29",
    name: {
      ca: "Dilluns de Pasqua",
      es: "Lunes de Pascua",
      en: "Easter Monday",
    },
    scope: "regional",
    region: "CT",
  },
  {
    date: "2027-06-24",
    name: { ca: "Sant Joan", es: "San Juan", en: "Saint John's Day" },
    scope: "regional",
    region: "CT",
  },
  {
    date: "2027-09-11",
    name: {
      ca: "Diada Nacional de Catalunya",
      es: "Fiesta Nacional de Cataluña",
      en: "National Day of Catalonia",
    },
    scope: "regional",
    region: "CT",
  },
  {
    date: "2027-12-26",
    name: { ca: "Sant Esteve", es: "San Esteban", en: "Saint Stephen's Day" },
    scope: "regional",
    region: "CT",
  },
];
