import {
  KanbanCardDetail,
  KanbanCardFieldOverride,
  KanbanCardOverrides,
  KanbanDetailSection,
} from "@/lib/types";

export const CARD_OVERRIDES_ATTRIBUTE_KEY = "kanban_card_overrides";

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string) {
  return normalizeText(value).toLowerCase();
}

function normalizeFieldOverride(value: unknown): KanbanCardFieldOverride | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const sectionTitle =
    typeof record.sectionTitle === "string" ? normalizeText(record.sectionTitle) : "";
  const label = typeof record.label === "string" ? normalizeText(record.label) : "";
  const fieldValue =
    typeof record.value === "string"
      ? record.value.replace(/\s+/g, " ").trim()
      : typeof record.value === "number" && Number.isFinite(record.value)
        ? String(record.value)
        : "";

  if (!sectionTitle || !label) {
    return null;
  }

  return {
    sectionTitle,
    label,
    value: fieldValue,
  };
}

function normalizeOverrides(value: unknown): KanbanCardOverrides {
  if (!value || typeof value !== "object") {
    return { fields: [] };
  }

  const record = value as Record<string, unknown>;
  const title =
    typeof record.title === "string" && normalizeText(record.title)
      ? normalizeText(record.title)
      : null;
  const fields = Array.isArray(record.fields)
    ? record.fields
        .map(normalizeFieldOverride)
        .filter((field): field is KanbanCardFieldOverride => Boolean(field))
    : [];

  return {
    title,
    fields,
  };
}

export function parseCardOverrides(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    try {
      return normalizeOverrides(JSON.parse(value));
    } catch {
      return { fields: [] } satisfies KanbanCardOverrides;
    }
  }

  return normalizeOverrides(value);
}

export function serializeCardOverrides(overrides: KanbanCardOverrides) {
  const title =
    typeof overrides.title === "string" && normalizeText(overrides.title)
      ? normalizeText(overrides.title)
      : null;
  const fields = overrides.fields
    .map(normalizeFieldOverride)
    .filter((field): field is KanbanCardFieldOverride => Boolean(field))
    .filter((field) => field.value);

  if (!title && !fields.length) {
    return null;
  }

  return JSON.stringify({
    ...(title ? { title } : {}),
    fields,
  } satisfies KanbanCardOverrides);
}

export function applyCardOverrides(
  detail: KanbanCardDetail,
  overrides: KanbanCardOverrides,
) {
  if (!overrides.title && !overrides.fields.length) {
    return detail;
  }

  const orderedSections: KanbanDetailSection[] = detail.sections.map((section) => ({
    ...section,
    fields: [...section.fields],
  }));
  const sectionIndexByKey = new Map(
    orderedSections.map((section, index) => [normalizeKey(section.title), index]),
  );

  for (const override of overrides.fields) {
    const sectionKey = normalizeKey(override.sectionTitle);
    const labelKey = normalizeKey(override.label);
    const existingIndex = sectionIndexByKey.get(sectionKey);

    let targetSection: KanbanDetailSection;
    if (existingIndex === undefined) {
      targetSection = {
        id: `override:${sectionKey}`,
        title: override.sectionTitle,
        fields: [],
      };
      orderedSections.push(targetSection);
      sectionIndexByKey.set(sectionKey, orderedSections.length - 1);
    } else {
      targetSection = orderedSections[existingIndex];
    }

    const fieldIndex = targetSection.fields.findIndex(
      (field) => normalizeKey(field.label) === labelKey,
    );

    if (!override.value) {
      if (fieldIndex !== -1) {
        targetSection.fields.splice(fieldIndex, 1);
      }
      continue;
    }

    if (fieldIndex === -1) {
      targetSection.fields.push({
        label: override.label,
        value: override.value,
      });
      continue;
    }

    targetSection.fields[fieldIndex] = {
      ...targetSection.fields[fieldIndex],
      value: override.value,
    };
  }

  return {
    ...detail,
    leadName: overrides.title ?? detail.leadName,
    sections: orderedSections.filter((section) => section.fields.length > 0),
  };
}
