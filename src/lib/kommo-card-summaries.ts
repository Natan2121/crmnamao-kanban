import "server-only";

import summaries from "@/lib/data/kommo-card-summaries.generated.json";
import {
  ChatwootConversation,
  KanbanCardDetail,
  KanbanDetailField,
  KanbanDetailSection,
} from "@/lib/types";

type StoredCardSummary = Omit<KanbanCardDetail, "conversationId" | "quickEdit">;

const summaryIndex = summaries as Record<string, StoredCardSummary>;

const EXCLUDED_FIELD_LABELS = new Set([
  "Lead ID",
  "Contato ID",
  "Empresa ID",
  "Pipeline ID",
  "Etapa ID",
  "Criado em",
  "Atualizado em",
  "Fechado em",
  "ID",
]);

const IMPORTANT_FIELD_ORDER: Array<{
  matcher: RegExp;
  score: number;
}> = [
  { matcher: /^(nome|empresa|contato)/i, score: 0 },
  { matcher: /(cnpj|telefone|celular|whatsapp|email|e-mail|web|site|endereco|endereço)/i, score: 1 },
  { matcher: /(origem|tags|preco|preço|valor|proposta|canal)/i, score: 2 },
  {
    matcher: /(valid|vigenc|venc|licenc|licenç|risco|cnae|atividade|ramo|segmento|cli)/i,
    score: 3,
  },
];

const COMPANY_FIELD_MATCHERS = [
  /empresa|razao|raz[aã]o|fantasia|estabelecimento/i,
  /(cnpj|cnae|atividade|ramo|segmento|porte|risco)/i,
  /(valid|vigenc|venc|licenc|licen[çc]|cli)/i,
  /(endereco|endere[çc]o|bairro|cidade|uf|cep|site|imovel|im[oó]vel)/i,
];

const COMPANY_SUMMARY_MATCHERS = [
  ...COMPANY_FIELD_MATCHERS,
  /(origem|preco|preco|proposta|canal|status|funil|etapa)/i,
];

function normalizeText(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();

  if (!trimmed || !/[ÃÂâ]/.test(trimmed)) {
    return trimmed;
  }

  try {
    const repaired = Buffer.from(trimmed, "latin1").toString("utf8").trim();

    if (!repaired || repaired.includes("\uFFFD")) {
      return trimmed;
    }

    const brokenMarkers = (input: string) => input.match(/[ÃÂâ]/g)?.length ?? 0;
    return brokenMarkers(repaired) < brokenMarkers(trimmed) ? repaired : trimmed;
  } catch {
    return trimmed;
  }
}

function normalizeLookup(value: string) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function normalizeLabel(value: string) {
  return normalizeText(value)
    .replace(/\bPre\.?o\b/i, "Preco")
    .replace(/\bPre\?o\b/i, "Preco")
    .replace(/^created at$/i, "Criado em")
    .replace(/^updated at$/i, "Atualizado em")
    .replace(/^closed at$/i, "Fechado em")
    .replace(/^price$/i, "Preco")
    .replace(/^id$/i, "ID")
    .replace(/^tags$/i, "Tags")
    .replace(/^Validade do Cli$/i, "Validade do CLI")
    .replace(/^Vigencia Cli$/i, "Vigencia CLI")
    .replace(/^Preco$/i, "Preco");
}

function uniqueValues(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    if (!value) {
      continue;
    }

    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function toDisplayValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string") {
    return normalizeText(value);
  }

  return "";
}

function tryResolveAttachmentName(value: string) {
  if (!value.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as { file_name?: string };
    return parsed.file_name ? normalizeText(parsed.file_name) : null;
  } catch {
    return null;
  }
}

function humanizeChannel(value: string) {
  if (value.includes("WebWidget")) return "Site";
  if (value.includes("Whatsapp")) return "WhatsApp";
  if (value.includes("Email")) return "Email";
  if (value.includes("Telegram")) return "Telegram";
  if (value.includes("Api")) return "API";
  return value.replace("Channel::", "");
}

function humanizeStatus(value: string) {
  const map: Record<string, string> = {
    open: "Aberta",
    pending: "Pendente",
    resolved: "Resolvida",
    snoozed: "Adiada",
  };

  return map[value] ?? value;
}

function formatDateValue(value: string, label: string) {
  const normalizedLabel = normalizeLookup(label);

  if (/^\d{10}$/.test(value) && /(valid|vigenc|venc)/i.test(normalizedLabel)) {
    return new Intl.DateTimeFormat("pt-BR").format(new Date(Number(value) * 1000));
  }

  return value;
}

function normalizeField(field: KanbanDetailField) {
  const label = normalizeLabel(field.label);
  let value = normalizeText(field.value);

  if (!label || !value || EXCLUDED_FIELD_LABELS.has(label)) {
    return null;
  }

  const attachmentName = tryResolveAttachmentName(value);
  if (attachmentName) {
    value = attachmentName;
  } else if (
    value.startsWith("{") ||
    value.startsWith("[") ||
    value.includes("file_uuid") ||
    value.includes("version_uuid")
  ) {
    return null;
  }

  if (label === "Canal") {
    value = humanizeChannel(value);
  }

  if (label === "Status") {
    value = humanizeStatus(value);
  }

  value = formatDateValue(value, label);

  return { label, value } satisfies KanbanDetailField;
}

function fieldPriority(label: string) {
  const normalized = normalizeLookup(label);
  const match = IMPORTANT_FIELD_ORDER.find((item) => item.matcher.test(normalized));
  return match?.score ?? 9;
}

function isCompanySummaryFieldLabel(label: string) {
  const normalized = normalizeLookup(label);
  return COMPANY_SUMMARY_MATCHERS.some((matcher) => matcher.test(normalized));
}

function dedupeFields(fields: KanbanDetailField[]) {
  const seen = new Set<string>();
  const output: KanbanDetailField[] = [];

  for (const field of fields) {
    const key = `${field.label.toLowerCase()}::${field.value.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(field);
  }

  return output;
}

function sortSections(sections: KanbanDetailSection[]) {
  const sectionPriority = (title: string) => {
    const normalized = normalizeText(title).toLowerCase();
    if (normalized.includes("empresa")) return 0;
    if (normalized.includes("contato")) return 1;
    if (normalized.includes("lead")) return 2;
    return 3;
  };

  return [...sections].sort((left, right) => {
    const leftPriority = sectionPriority(left.title);
    const rightPriority = sectionPriority(right.title);

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.title.localeCompare(right.title, "pt-BR");
  });
}

function normalizeSections(sections: KanbanDetailSection[]) {
  const normalizedSections = sections
    .map((section) => {
      const fields = dedupeFields(
        section.fields
          .map(normalizeField)
          .filter((field): field is KanbanDetailField => Boolean(field)),
      )
        .sort((left, right) => {
          const leftPriority = fieldPriority(left.label);
          const rightPriority = fieldPriority(right.label);

          if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority;
          }

          return left.label.localeCompare(right.label, "pt-BR");
        })
        .slice(0, 12);

      if (!fields.length) {
        return null;
      }

      return {
        id: section.id,
        title: normalizeText(section.title),
        fields,
      } satisfies KanbanDetailSection;
    })
    .filter((section): section is KanbanDetailSection => Boolean(section));

  return sortSections(normalizedSections);
}

function humanizeAttributeKey(key: string) {
  return normalizeText(
    key
      .replace(/^kommo_(lead|contact|company)_/, "")
      .replace(/_/g, " ")
      .trim(),
  )
    .replace(/\bcli\b/i, "CLI")
    .replace(/\bcnae\b/i, "CNAE")
    .replace(/\bcnpj\b/i, "CNPJ");
}

function pushField(
  fields: KanbanDetailField[],
  label: string,
  value: unknown,
  seenLabels: Set<string>,
) {
  const normalizedValue = toDisplayValue(value);
  const normalizedLabel = normalizeLabel(label);

  if (!normalizedLabel || !normalizedValue || seenLabels.has(normalizedLabel)) {
    return;
  }

  const normalizedField = normalizeField({
    label: normalizedLabel,
    value: normalizedValue,
  });

  if (!normalizedField) {
    return;
  }

  fields.push(normalizedField);
  seenLabels.add(normalizedField.label);
}

function collectAttributeFields(
  source: Record<string, unknown> | undefined,
  prefix: "kommo_lead_" | "kommo_contact_" | "kommo_company_",
  fields: KanbanDetailField[],
  seenLabels: Set<string>,
) {
  if (!source) {
    return;
  }

  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith(prefix)) {
      continue;
    }

    pushField(fields, humanizeAttributeKey(key), value, seenLabels);
  }
}

function collectMatchingFields(
  sourceFields: KanbanDetailField[],
  matcher: (label: string) => boolean,
  targetFields: KanbanDetailField[],
  seenLabels: Set<string>,
) {
  for (const field of sourceFields) {
    if (!matcher(field.label)) {
      continue;
    }

    pushField(targetFields, field.label, field.value, seenLabels);
  }
}

function extractCompanyNames(fields: KanbanDetailField[]) {
  return uniqueValues(
    fields
      .filter((field) =>
        /(empresa|razao|raz[aã]o|fantasia|estabelecimento)/i.test(
          normalizeLookup(field.label),
        ),
      )
      .map((field) => field.value),
  );
}

export interface ResolvedKommoCardSummary {
  leadId: string | null;
  leadName: string | null;
  contactNames: string[];
  companyNames: string[];
  sections: KanbanDetailSection[];
}

export function getKommoCardSummary(leadId: string | null | undefined) {
  if (!leadId) {
    return null;
  }

  const storedSummary = summaryIndex[leadId];
  if (!storedSummary) {
    return null;
  }

  return {
    leadId: storedSummary.leadId ? normalizeText(storedSummary.leadId) : null,
    leadName: storedSummary.leadName ? normalizeText(storedSummary.leadName) : null,
    contactNames: uniqueValues(storedSummary.contactNames),
    companyNames: uniqueValues(storedSummary.companyNames),
    sections: normalizeSections(storedSummary.sections ?? []),
  } satisfies ResolvedKommoCardSummary;
}

export function buildFallbackCardSummary(
  conversation: ChatwootConversation,
): ResolvedKommoCardSummary {
  const customAttributes = conversation.custom_attributes ?? {};
  const sender = conversation.meta?.sender;
  const leadId =
    typeof customAttributes.kommo_lead_id === "string"
      ? customAttributes.kommo_lead_id
      : typeof customAttributes.kommo_lead_id === "number"
        ? String(customAttributes.kommo_lead_id)
        : null;

  const leadFields: KanbanDetailField[] = [];
  const leadSeen = new Set<string>();
  pushField(leadFields, "Nome do lead", sender?.name ?? `Lead #${leadId ?? conversation.id}`, leadSeen);
  pushField(leadFields, "Funil", customAttributes.kommo_pipeline, leadSeen);
  pushField(leadFields, "Etapa", customAttributes.kommo_stage, leadSeen);
  pushField(leadFields, "Status", conversation.status, leadSeen);
  pushField(leadFields, "Canal", conversation.meta?.channel, leadSeen);
  pushField(leadFields, "Preco", customAttributes.kommo_lead_price, leadSeen);
  collectAttributeFields(customAttributes, "kommo_lead_", leadFields, leadSeen);

  const contactFields: KanbanDetailField[] = [];
  const contactSeen = new Set<string>();
  pushField(contactFields, "Nome", sender?.name, contactSeen);
  pushField(contactFields, "Email", sender?.email, contactSeen);
  pushField(contactFields, "Telefone", sender?.phone_number, contactSeen);
  collectAttributeFields(sender?.custom_attributes, "kommo_contact_", contactFields, contactSeen);

  const companyFields: KanbanDetailField[] = [];
  const companySeen = new Set<string>();
  collectAttributeFields(customAttributes, "kommo_company_", companyFields, companySeen);
  collectAttributeFields(sender?.custom_attributes, "kommo_company_", companyFields, companySeen);
  pushField(
    companyFields,
    "Empresa",
    sender?.name ?? customAttributes.kommo_company_name ?? `Lead #${leadId ?? conversation.id}`,
    companySeen,
  );
  collectMatchingFields(leadFields, isCompanySummaryFieldLabel, companyFields, companySeen);
  collectMatchingFields(
    contactFields,
    (label) => /(telefone|celular|whatsapp|email|e-mail)/i.test(normalizeLookup(label)),
    companyFields,
    companySeen,
  );

  return {
    leadId,
    leadName: normalizeText(sender?.name ?? `Lead #${leadId ?? conversation.id}`),
    contactNames: uniqueValues([sender?.name]),
    companyNames: extractCompanyNames(companyFields),
    sections: normalizeSections(
      [
        {
          id: "fallback-company",
          title: "Empresa",
          fields: companyFields,
        },
        {
          id: "fallback-contact",
          title: "Contato",
          fields: contactFields,
        },
        {
          id: "fallback-lead",
          title: "Lead",
          fields: leadFields,
        },
      ].filter((section) => section.fields.length),
    ),
  };
}

export function mergeCardSummaries(
  primary: ResolvedKommoCardSummary | null,
  secondary: ResolvedKommoCardSummary | null,
) {
  if (!primary) {
    return secondary;
  }

  if (!secondary) {
    return primary;
  }

  const sectionMap = new Map<string, KanbanDetailSection>();

  for (const section of sortSections([...primary.sections, ...secondary.sections])) {
    const sectionKey = normalizeText(section.title).toLowerCase();
    const current = sectionMap.get(sectionKey);

    if (!current) {
      sectionMap.set(sectionKey, {
        ...section,
        fields: dedupeFields([...section.fields]),
      });
      continue;
    }

    sectionMap.set(sectionKey, {
      ...current,
      fields: dedupeFields([...current.fields, ...section.fields]).sort((left, right) => {
        const leftPriority = fieldPriority(left.label);
        const rightPriority = fieldPriority(right.label);

        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        return left.label.localeCompare(right.label, "pt-BR");
      }),
    });
  }

  return {
    leadId: primary.leadId ?? secondary.leadId,
    leadName: primary.leadName ?? secondary.leadName,
    contactNames: uniqueValues([...primary.contactNames, ...secondary.contactNames]),
    companyNames: uniqueValues([...primary.companyNames, ...secondary.companyNames]),
    sections: sortSections([...sectionMap.values()]),
  } satisfies ResolvedKommoCardSummary;
}
