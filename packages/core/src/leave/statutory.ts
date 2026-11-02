import type { StandardLeaveTypeCode } from "./types.js";

export interface StatutoryLeaveDefinition {
  code: StandardLeaveTypeCode;
  legalReference: string;
  isPaid: boolean;
  requiresApproval: boolean;
  requiresAttachment: boolean;
  halfDaysAllowed: boolean;
  countsWorkingDays: boolean;
  defaultDays?: number | undefined;
  color: string;
  name: {
    ca: string;
    es: string;
    en: string;
  };
  description: {
    ca: string;
    es: string;
    en: string;
  };
}

export const STATUTORY_LEAVE_TYPES: readonly StatutoryLeaveDefinition[] = [
  {
    code: "vacation",
    legalReference: "ET art. 38",
    isPaid: true,
    requiresApproval: true,
    requiresAttachment: false,
    halfDaysAllowed: true,
    countsWorkingDays: true,
    defaultDays: 22,
    color: "#3b82f6",
    name: {
      ca: "Vacances Anuals",
      es: "Vacaciones Anuales",
      en: "Annual Vacation",
    },
    description: {
      ca: "Període de descans retribuït anual legalment garantit (mínim 30 dies naturals o 22 laborables).",
      es: "Período de descanso retribuido anual legalmente garantizado (mínimo 30 días naturales o 22 laborables).",
      en: "Statutory annual paid leave entitlement (minimum 30 calendar days or 22 working days).",
    },
  },
  {
    code: "personal_days",
    legalReference: "Conveni col·lectiu",
    isPaid: true,
    requiresApproval: true,
    requiresAttachment: false,
    halfDaysAllowed: true,
    countsWorkingDays: true,
    color: "#10b981",
    name: {
      ca: "Assumptes Propis / Lliure Disposició",
      es: "Asuntos Propios / Libre Disposición",
      en: "Personal Days",
    },
    description: {
      ca: "Dies de permís retribuït per a gestions particulars establerts per conveni col·lectiu.",
      es: "Días de permiso retribuido para gestiones particulares fijados por convenio colectivo.",
      en: "Paid personal days established by applicable collective bargaining agreement.",
    },
  },
  {
    code: "sick_leave",
    legalReference: "LGSS art. 169 & ET art. 45.1.c",
    isPaid: true,
    requiresApproval: false,
    requiresAttachment: true,
    halfDaysAllowed: false,
    countsWorkingDays: false,
    color: "#f59e0b",
    name: {
      ca: "Incapacitat Temporal (IT / Baixa Mèdica)",
      es: "Incapacidad Temporal (IT / Baja Médica)",
      en: "Temporary Medical Disability (Sick Leave)",
    },
    description: {
      ca: "Suspensió del contracte per malaltia comuna o accident amb comunicat mèdic oficial (GDPR art. 9).",
      es: "Suspensión del contrato por enfermedad o accidente con parte médico oficial (GDPR art. 9).",
      en: "Medical temporary incapacity certified by healthcare provider without diagnosis disclosure.",
    },
  },
  {
    code: "marriage",
    legalReference: "ET art. 37.3.a",
    isPaid: true,
    requiresApproval: true,
    requiresAttachment: true,
    halfDaysAllowed: false,
    countsWorkingDays: false,
    defaultDays: 15,
    color: "#ec4899",
    name: {
      ca: "Matrimoni o Parella de Fet",
      es: "Matrimonio o Pareja de Hecho",
      en: "Marriage or Civil Partnership",
    },
    description: {
      ca: "Permís retribuït de 15 dies naturals per celebració de matrimoni o registre de parella de fet.",
      es: "Permiso retribuido de 15 días naturales por matrimonio o inscripción de pareja de hecho.",
      en: "15 calendar days of paid statutory leave for marriage or registered civil partnership.",
    },
  },
  {
    code: "hospitalization_family",
    legalReference: "ET art. 37.3.b (RDL 5/2023)",
    isPaid: true,
    requiresApproval: true,
    requiresAttachment: true,
    halfDaysAllowed: true,
    countsWorkingDays: true,
    defaultDays: 5,
    color: "#8b5cf6",
    name: {
      ca: "Hospitalització o Malaltia Greu de Familiar",
      es: "Hospitalización o Enfermedad Grave de Familiar",
      en: "Family Hospitalization or Serious Illness",
    },
    description: {
      ca: "5 dies laborables per accident o malaltia greus, hospitalització o cirurgia amb repòs domiciliari de familiars fins a 2n grau o convivents.",
      es: "5 días laborables por accidente o enfermedad graves, hospitalización o intervención quirúrgica con reposo de familiares hasta 2º grado o convivientes.",
      en: "5 working days for accident, serious illness, hospitalization, or home recovery surgery of relatives up to 2nd degree or cohabitants.",
    },
  },
  {
    code: "bereavement",
    legalReference: "ET art. 37.3.b bis",
    isPaid: true,
    requiresApproval: true,
    requiresAttachment: true,
    halfDaysAllowed: false,
    countsWorkingDays: false,
    defaultDays: 2,
    color: "#64748b",
    name: {
      ca: "Defunció de Familiars",
      es: "Fallecimiento de Familiares",
      en: "Bereavement / Compassionate Leave",
    },
    description: {
      ca: "2 dies per mort de cònjuge, parella de fet o parents fins al 2n grau (4 dies si cal desplaçament).",
      es: "2 días por fallecimiento de cónyuge, pareja de hecho o parientes hasta el 2º grado (4 días con desplazamiento).",
      en: "2 days for death of spouse, civil partner, or relatives up to 2nd degree (4 days if travel required).",
    },
  },
  {
    code: "moving",
    legalReference: "ET art. 37.3.c",
    isPaid: true,
    requiresApproval: true,
    requiresAttachment: true,
    halfDaysAllowed: false,
    countsWorkingDays: false,
    defaultDays: 1,
    color: "#06b6d4",
    name: {
      ca: "Trasllat de Domicili (Mudança)",
      es: "Traslado de Domicilio Habitual",
      en: "Residential Relocation (Moving)",
    },
    description: {
      ca: "1 dia de permís retribuït per mudança del domicili habitual del treballador.",
      es: "1 día de permiso retribuido por traslado del domicilio habitual del trabajador.",
      en: "1 day of paid statutory leave for residential moving.",
    },
  },
  {
    code: "public_duty",
    legalReference: "ET art. 37.3.d",
    isPaid: true,
    requiresApproval: true,
    requiresAttachment: true,
    halfDaysAllowed: true,
    countsWorkingDays: true,
    color: "#6366f1",
    name: {
      ca: "Deure Inexcusable Públic i Personal",
      es: "Deber Inexcusable Público y Personal",
      en: "Inexcusable Civic & Public Duty",
    },
    description: {
      ca: "Temps indispensable per al compliment d'un deure públic (citacions judicials, meses electorals, votacions).",
      es: "Tiempo indispensable para el cumplimiento de un deber público y personal (citación judicial, mesa electoral).",
      en: "Time strictly required to perform civic duties (electoral polling stations, judicial summons).",
    },
  },
  {
    code: "prenatal_exams",
    legalReference: "ET art. 37.3.f",
    isPaid: true,
    requiresApproval: true,
    requiresAttachment: true,
    halfDaysAllowed: true,
    countsWorkingDays: true,
    color: "#14b8a6",
    name: {
      ca: "Exàmens Prenatals i Preparació al Part",
      es: "Exámenes Prenatales y Preparación al Parto",
      en: "Prenatal Medical Exams & Adoption",
    },
    description: {
      ca: "Temps indispensable per a la realització d'exàmens prenatals, tècniques de preparació al part i sessions d'adopció.",
      es: "Tiempo indispensable para exámenes prenatales, preparación al parto y trámites de adopción.",
      en: "Necessary time for prenatal medical visits, childbirth preparation, and adoption assessments.",
    },
  },
  {
    code: "family_force_majeure",
    legalReference: "ET art. 37.9 (RDL 5/2023)",
    isPaid: true,
    requiresApproval: true,
    requiresAttachment: true,
    halfDaysAllowed: true,
    countsWorkingDays: true,
    defaultDays: 4,
    color: "#ef4444",
    name: {
      ca: "Força Major Familiar Urgent",
      es: "Fuerza Mayor Familiar Urgente",
      en: "Family Emergency / Force Majeure",
    },
    description: {
      ca: "Fins a 4 dies a l'any retribuïts per motius familiars urgents derivats de malaltia o accident imprevisible.",
      es: "Hasta 4 días al año retribuidos por motivos familiares urgentes por enfermedad o accidente imprevisible.",
      en: "Up to 4 paid days per year for urgent family emergencies due to illness or sudden accident.",
    },
  },
  {
    code: "parental_leave_unpaid",
    legalReference: "ET art. 48 bis (RDL 5/2023)",
    isPaid: false,
    requiresApproval: true,
    requiresAttachment: true,
    halfDaysAllowed: false,
    countsWorkingDays: true,
    color: "#f97316",
    name: {
      ca: "Permís Parental (fins a 8 anys)",
      es: "Permiso Parental (hasta 8 años)",
      en: "Parental Leave (Child Up to 8 Years)",
    },
    description: {
      ca: "Permís no retribuït de fins a 8 setmanes per a la cura de fill o filla fins que compleixi 8 anys.",
      es: "Permiso no retribuido de hasta 8 semanas para el cuidado de hijo o hija hasta cumplir 8 años.",
      en: "Unpaid parental leave of up to 8 weeks for child caring until the child turns 8 years old.",
    },
  },
  {
    code: "birth_childcare",
    legalReference: "ET art. 48.4 & LGSS",
    isPaid: true,
    requiresApproval: true,
    requiresAttachment: true,
    halfDaysAllowed: false,
    countsWorkingDays: false,
    color: "#a855f7",
    name: {
      ca: "Naixement i Cura del Menor (Maternitat / Paternitat)",
      es: "Nacimiento y Cuidado del Menor (Maternidad / Paternidad)",
      en: "Birth & Childcare (Maternity / Paternity)",
    },
    description: {
      ca: "Suspensió de 16 setmanes retribuïda directament per la Seguretat Social amb reserva del lloc de treball.",
      es: "Suspensión de 16 semanas retribuida por la Seguridad Social con reserva de puesto de trabajo.",
      en: "16 weeks of statutory leave subsidized by Social Security with job guarantee.",
    },
  },
  {
    code: "education_exams",
    legalReference: "ET art. 23.1.a",
    isPaid: true,
    requiresApproval: true,
    requiresAttachment: true,
    halfDaysAllowed: true,
    countsWorkingDays: true,
    color: "#0284c7",
    name: {
      ca: "Exàmens Oficials i Formació Professional",
      es: "Exámenes Oficiales y Formación Profesional",
      en: "Official Exams & Vocational Training",
    },
    description: {
      ca: "Permís retribuït necessari per concórrer a exàmens per a l'obtenció de títols acadèmics o professionals oficials.",
      es: "Permiso retribuido necesario para concurrir a exámenes para la obtención de títulos oficiales.",
      en: "Paid statutory leave necessary to attend examinations for official educational or vocational degrees.",
    },
  },
];
