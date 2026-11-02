import { Temporal } from "temporal-polyfill";

export type HolidayScope = "national" | "regional" | "local" | "company";

export interface StatutoryHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  scope: HolidayScope;
  region?: string | undefined; // Autonomous community code (e.g. CT, MD, VC, AN, PV)
  city?: string | undefined; // Municipality name (e.g. Barcelona, Madrid, Valencia, Sevilla, Bilbao)
}

/**
 * Computes Easter Sunday for a given year using the Meeus/Jones/Butcher algorithm.
 */
function getEasterSunday(year: number): Temporal.PlainDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Temporal.PlainDate.from({ year, month, day });
}

/**
 * Returns canonical Spanish statutory national holidays (8-9 statewide holidays).
 * Fixed national holidays + Good Friday (Viernes Santo / Divendres Sant).
 */
export function getNationalHolidays(year: number): StatutoryHoliday[] {
  const easter = getEasterSunday(year);
  // Good Friday is 2 days before Easter Sunday
  const goodFriday = easter.subtract({ days: 2 }).toString();

  return [
    { date: `${year}-01-01`, name: "Cap d'Any / Año Nuevo", scope: "national" },
    {
      date: `${year}-01-06`,
      name: "Reis / Epifanía del Señor",
      scope: "national",
    },
    {
      date: goodFriday,
      name: "Divendres Sant / Viernes Santo",
      scope: "national",
    },
    {
      date: `${year}-05-01`,
      name: "Festa del Treball / Fiesta del Trabajo",
      scope: "national",
    },
    {
      date: `${year}-08-15`,
      name: "L'Assumpció / Asunción de la Virgen",
      scope: "national",
    },
    {
      date: `${year}-10-12`,
      name: "Festa Nacional d'Espanya / Fiesta Nacional",
      scope: "national",
    },
    {
      date: `${year}-11-01`,
      name: "Tots Sants / Todos los Santos",
      scope: "national",
    },
    {
      date: `${year}-12-06`,
      name: "Dia de la Constitució / Día de la Constitución",
      scope: "national",
    },
    {
      date: `${year}-12-08`,
      name: "La Puríssima / Inmaculada Concepción",
      scope: "national",
    },
    {
      date: `${year}-12-25`,
      name: "Nadal / Natividad del Señor",
      scope: "national",
    },
  ];
}

/**
 * Returns regional holidays for Spanish Autonomous Communities (Comunitats Autònomes).
 */
export function getRegionalHolidays(
  year: number,
  region: string,
): StatutoryHoliday[] {
  const normRegion = region.trim().toUpperCase();
  const easter = getEasterSunday(year);
  const holyThursday = easter.subtract({ days: 3 }).toString();
  const easterMonday = easter.add({ days: 1 }).toString();

  switch (normRegion) {
    case "CT": // Catalunya
      return [
        {
          date: easterMonday,
          name: "Dilluns de Pasqua",
          scope: "regional",
          region: "CT",
        },
        {
          date: `${year}-06-24`,
          name: "Sant Joan",
          scope: "regional",
          region: "CT",
        },
        {
          date: `${year}-09-11`,
          name: "Diada Nacional de Catalunya",
          scope: "regional",
          region: "CT",
        },
        {
          date: `${year}-12-26`,
          name: "Sant Esteve",
          scope: "regional",
          region: "CT",
        },
      ];
    case "MD": // Comunidad de Madrid
      return [
        {
          date: holyThursday,
          name: "Jueves Santo",
          scope: "regional",
          region: "MD",
        },
        {
          date: `${year}-05-02`,
          name: "Fiesta de la Comunidad de Madrid",
          scope: "regional",
          region: "MD",
        },
        {
          date: `${year}-07-25`,
          name: "Santiago Apóstol",
          scope: "regional",
          region: "MD",
        },
      ];
    case "VC": // Comunitat Valenciana
      return [
        {
          date: `${year}-03-19`,
          name: "Sant Josep / San José",
          scope: "regional",
          region: "VC",
        },
        {
          date: easterMonday,
          name: "Lunes de Pascua",
          scope: "regional",
          region: "VC",
        },
        {
          date: `${year}-06-24`,
          name: "Sant Joan",
          scope: "regional",
          region: "VC",
        },
        {
          date: `${year}-10-09`,
          name: "Dia de la Comunitat Valenciana",
          scope: "regional",
          region: "VC",
        },
      ];
    case "AN": // Andalucía
      return [
        {
          date: `${year}-02-28`,
          name: "Día de Andalucía",
          scope: "regional",
          region: "AN",
        },
        {
          date: holyThursday,
          name: "Jueves Santo",
          scope: "regional",
          region: "AN",
        },
      ];
    case "PV": // País Vasco / Euskadi
      return [
        {
          date: holyThursday,
          name: "Jueves Santo",
          scope: "regional",
          region: "PV",
        },
        {
          date: easterMonday,
          name: "Lunes de Pascua",
          scope: "regional",
          region: "PV",
        },
        {
          date: `${year}-07-25`,
          name: "Santiago Apóstol",
          scope: "regional",
          region: "PV",
        },
      ];
    default:
      return [];
  }
}

/**
 * Returns statutory municipal / local holidays (2 days per town hall / ayuntamiento).
 */
export function getMunicipalHolidays(
  year: number,
  city: string,
): StatutoryHoliday[] {
  const normCity = city.trim().toLowerCase();
  const easter = getEasterSunday(year);
  // Whit Monday / Segona Pasqua is 50 days after Easter Sunday (Pentecost Monday)
  const pentecostMonday = easter.add({ days: 50 }).toString();

  if (normCity.includes("barcelona")) {
    return [
      {
        date: pentecostMonday,
        name: "Dilluns de Pasqua Granada / Segona Pasqua",
        scope: "local",
        city: "Barcelona",
      },
      {
        date: `${year}-09-24`,
        name: "Mare de Déu de la Mercè",
        scope: "local",
        city: "Barcelona",
      },
    ];
  }

  if (normCity.includes("madrid")) {
    return [
      {
        date: `${year}-05-15`,
        name: "San Isidro Labrador",
        scope: "local",
        city: "Madrid",
      },
      {
        date: `${year}-11-09`,
        name: "Virgen de la Almudena",
        scope: "local",
        city: "Madrid",
      },
    ];
  }

  if (normCity.includes("valencia") || normCity.includes("valència")) {
    return [
      {
        date: `${year}-01-22`,
        name: "Sant Vicent Màrtir / San Vicente Mártir",
        scope: "local",
        city: "Valencia",
      },
      {
        date: easter.add({ days: 8 }).toString(), // Monday following Easter Monday (Sant Vicent Ferrer)
        name: "Sant Vicent Ferrer / San Vicente Ferrer",
        scope: "local",
        city: "Valencia",
      },
    ];
  }

  if (normCity.includes("sevilla")) {
    return [
      {
        date: `${year}-04-29`,
        name: "Miércoles de Feria de Abril",
        scope: "local",
        city: "Sevilla",
      },
      {
        date: `${year}-06-11`,
        name: "Corpus Christi",
        scope: "local",
        city: "Sevilla",
      },
    ];
  }

  if (normCity.includes("bilbao")) {
    return [
      {
        date: `${year}-07-04`,
        name: "San Valentín de Berriochoa",
        scope: "local",
        city: "Bilbao",
      },
      {
        date: `${year}-08-28`,
        name: "Viernes de la Semana Grande",
        scope: "local",
        city: "Bilbao",
      },
    ];
  }

  return [];
}

/**
 * Resolves the complete 3-tier statutory holiday calendar for a work location
 * (National + Regional Autonomous Community + Municipal Town Hall).
 */
export function resolveLocationHolidays(params: {
  year: number;
  region?: string | undefined;
  city?: string | undefined;
}): StatutoryHoliday[] {
  const { year, region, city } = params;
  const national = getNationalHolidays(year);
  const regional = region ? getRegionalHolidays(year, region) : [];
  const municipal = city ? getMunicipalHolidays(year, city) : [];

  const combined = [...national, ...regional, ...municipal];

  // Deduplicate by date (more specific local/regional overrides name if on same date)
  const byDate = new Map<string, StatutoryHoliday>();
  for (const h of combined) {
    if (!byDate.has(h.date)) {
      byDate.set(h.date, h);
    } else {
      // If clash, prioritize local over regional over national
      const existing = byDate.get(h.date)!;
      if (
        h.scope === "local" ||
        (h.scope === "regional" && existing.scope === "national")
      ) {
        byDate.set(h.date, h);
      }
    }
  }

  return Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}
