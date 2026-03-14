const SCHEDULE_KEYS = {
  scheduledAt: "kommo_lead_proxima_consulta",
  taskType: "kommo_task_type",
  updatedAt: "kanban_schedule_updated_at",
  updatedBy: "kanban_schedule_updated_by",
} as const;

export const DEFAULT_TASK_TYPE = "follow_up";

export const TASK_TYPE_OPTIONS = [
  { value: "follow_up", label: "Follow-up" },
  { value: "reuniao", label: "Reuniao" },
  { value: "ligacao", label: "Ligacao" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "visita", label: "Visita" },
  { value: "tarefa", label: "Tarefa" },
] as const;

const TASK_TYPE_SET = new Set<string>(
  TASK_TYPE_OPTIONS.map((option) => option.value),
);

export type ScheduleTaskType = (typeof TASK_TYPE_OPTIONS)[number]["value"];

export interface CardScheduleData {
  scheduledAt: string | null;
  taskType: ScheduleTaskType | null;
  scheduleUpdatedAt: string | null;
  scheduleUpdatedBy: string | null;
}

function toIsoString(date: Date) {
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseNumericTimestamp(value: string) {
  if (!/^\d{10,13}$/.test(value)) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return value.length === 10 ? parsed * 1000 : parsed;
}

export function normalizeScheduleValue(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    const numericTimestamp = parseNumericTimestamp(trimmed);
    if (numericTimestamp !== null) {
      return toIsoString(new Date(numericTimestamp));
    }

    return toIsoString(new Date(trimmed));
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = value < 1_000_000_000_000 ? value * 1000 : value;
    return toIsoString(new Date(normalized));
  }

  if (value instanceof Date) {
    return toIsoString(value);
  }

  return null;
}

export function normalizeTaskTypeValue(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return TASK_TYPE_SET.has(normalized)
    ? (normalized as ScheduleTaskType)
    : null;
}

export function readScheduleFromAttributes(
  customAttributes?: Record<string, unknown> | null,
): CardScheduleData {
  const source = customAttributes ?? {};
  const updatedByValue = source[SCHEDULE_KEYS.updatedBy];

  return {
    scheduledAt: normalizeScheduleValue(source[SCHEDULE_KEYS.scheduledAt]),
    taskType: normalizeTaskTypeValue(source[SCHEDULE_KEYS.taskType]),
    scheduleUpdatedAt: normalizeScheduleValue(source[SCHEDULE_KEYS.updatedAt]),
    scheduleUpdatedBy:
      typeof updatedByValue === "string" && updatedByValue.trim()
        ? updatedByValue.trim()
        : null,
  };
}

export function getTaskTypeLabel(taskType: string | null | undefined) {
  const match = TASK_TYPE_OPTIONS.find((option) => option.value === taskType);
  return match?.label ?? "Tarefa";
}

export function toDatetimeLocalValue(isoDate: string | null | undefined) {
  if (!isoDate) {
    return "";
  }

  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

export function fromDatetimeLocalValue(value: string) {
  if (!value.trim()) {
    return null;
  }

  return normalizeScheduleValue(new Date(value));
}

export function buildScheduleAttributes(
  currentAttributes: Record<string, unknown> | null | undefined,
  options: {
    scheduledAt: string | null;
    taskType: ScheduleTaskType | null;
    updatedAt: string;
    updatedBy: string | null;
  },
) {
  return {
    ...(currentAttributes ?? {}),
    [SCHEDULE_KEYS.scheduledAt]: options.scheduledAt,
    [SCHEDULE_KEYS.taskType]: options.taskType,
    [SCHEDULE_KEYS.updatedAt]: options.updatedAt,
    [SCHEDULE_KEYS.updatedBy]: options.updatedBy,
  };
}

export function getScheduleKeys() {
  return SCHEDULE_KEYS;
}
