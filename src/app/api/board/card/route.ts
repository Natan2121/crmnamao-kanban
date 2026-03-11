import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  applyCardOverrides,
  CARD_OVERRIDES_ATTRIBUTE_KEY,
  parseCardOverrides,
  serializeCardOverrides,
} from "@/lib/card-overrides";
import {
  createConversationAttachmentNote,
  fetchAgents,
  fetchConversation,
  fetchTeams,
  updateContact,
  updateConversationAssignment,
  updateConversationCustomAttributes,
  updateConversationPriority,
  updateConversationStatus,
} from "@/lib/chatwoot-api";
import {
  buildFallbackCardSummary,
  getKommoCardSummary,
  mergeCardSummaries,
} from "@/lib/kommo-card-summaries";
import { getKommoPipelines } from "@/lib/kommo-structure";
import { assertAppAccess } from "@/lib/security";
import {
  ConversationPriorityValue,
  ConversationStatusValue,
  KanbanCardQuickEdit,
  KanbanCardDetail,
  KanbanCardFieldOverride,
  KanbanCardOverrides,
  KanbanDetailSection,
  KanbanResponsibleOption,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const editableFieldSchema = z.object({
  sectionTitle: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(80),
  value: z.string().max(4000),
});

const patchSchema = z.object({
  conversationId: z.number().int().positive(),
  title: z.string().trim().min(1).max(160),
  pipelineId: z.number().int().positive(),
  stageName: z.string().trim().min(1).max(120),
  status: z.enum(["open", "pending", "resolved", "snoozed"]),
  responsibleKey: z.string().trim().max(64).optional(),
  priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
  price: z.string().trim().max(64).optional(),
  fields: z.array(editableFieldSchema).max(160),
});

function asLeadId(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeLookup(value: string) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function fieldKey(sectionTitle: string, label: string) {
  return `${normalizeLookup(sectionTitle)}::${normalizeLookup(label)}`;
}

function flattenSections(sections: KanbanDetailSection[]) {
  return sections.flatMap<KanbanCardFieldOverride>((section) =>
    section.fields.map((field) => ({
      sectionTitle: section.title,
      label: field.label,
      value: field.value,
    })),
  );
}

function isContactSection(sectionTitle: string) {
  return normalizeLookup(sectionTitle).includes("contato");
}

function isLeadSection(sectionTitle: string) {
  return normalizeLookup(sectionTitle).includes("lead");
}

function isNameLabel(label: string) {
  const normalized = normalizeLookup(label);
  return normalized === "nome" || normalized === "nome do lead";
}

function isEmailLabel(label: string) {
  const normalized = normalizeLookup(label);
  return normalized === "email" || normalized === "e-mail";
}

function isPhoneLabel(label: string) {
  const normalized = normalizeLookup(label);
  return (
    normalized === "telefone" ||
    normalized === "celular" ||
    normalized === "whatsapp"
  );
}

function isPriceLabel(label: string) {
  const normalized = normalizeLookup(label);
  return normalized === "preco" || normalized === "valor";
}

function isStageLabel(label: string) {
  return normalizeLookup(label) === "etapa";
}

function isPipelineLabel(label: string) {
  return normalizeLookup(label) === "funil";
}

function isStatusLabel(label: string) {
  return normalizeLookup(label) === "status";
}

function isChannelLabel(label: string) {
  return normalizeLookup(label) === "canal";
}

function parsePrice(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error("Valor invalido.");
  }

  return parsed;
}

function normalizeOptionalText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizePriority(
  value: string | null | undefined,
): ConversationPriorityValue {
  switch (value?.trim().toLowerCase()) {
    case "urgent":
    case "high":
    case "medium":
    case "low":
      return value.trim().toLowerCase() as ConversationPriorityValue;
    default:
      return "none";
  }
}

function formatPriceInput(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return "";
}

function buildResponsibleKey(type: KanbanResponsibleOption["type"], id: number | null) {
  if (type === "none" || !id) {
    return "none";
  }

  return `${type}:${id}`;
}

function parseResponsibleKey(responsibleKey: string | undefined) {
  if (!responsibleKey || responsibleKey === "none") {
    return {
      assigneeId: null,
      teamId: null,
      preserveCurrent: responsibleKey === undefined,
    };
  }

  if (
    responsibleKey.startsWith("current-agent:") ||
    responsibleKey.startsWith("current-team:")
  ) {
    return {
      assigneeId: undefined,
      teamId: undefined,
      preserveCurrent: true,
    };
  }

  const [type, rawId] = responsibleKey.split(":");
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Responsavel invalido.");
  }

  if (type === "agent") {
    return {
      assigneeId: id,
      teamId: null,
      preserveCurrent: false,
    };
  }

  if (type === "team") {
    return {
      assigneeId: null,
      teamId: id,
      preserveCurrent: false,
    };
  }

  throw new Error("Responsavel invalido.");
}

async function loadResponsibleOptions(
  conversation: Awaited<ReturnType<typeof fetchConversation>>,
) {
  const [agentsResult, teamsResult] = await Promise.allSettled([
    fetchAgents(),
    fetchTeams(),
  ]);

  const agents =
    agentsResult.status === "fulfilled" ? agentsResult.value : [];
  const teams =
    teamsResult.status === "fulfilled" ? teamsResult.value : [];

  const options: KanbanResponsibleOption[] = [
    {
      key: "none",
      label: "Sem responsavel",
      type: "none",
    },
    ...agents.map((agent) => ({
      key: buildResponsibleKey("agent", agent.id),
      label: agent.available_name?.trim() || agent.name?.trim() || agent.email?.trim() || `Agente #${agent.id}`,
      type: "agent" as const,
    })),
    ...teams.map((team) => ({
      key: buildResponsibleKey("team", team.id),
      label: `Equipe: ${team.name}`,
      type: "team" as const,
    })),
  ];

  const assigneeId = conversation.meta?.assignee?.id;
  const assigneeName = conversation.meta?.assignee?.name?.trim() || null;
  const teamId = conversation.meta?.team?.id;
  const teamName = conversation.meta?.team?.name?.trim() || null;

  let responsibleKey = "none";

  if (Number.isInteger(assigneeId) && assigneeId && options.some((option) => option.key === buildResponsibleKey("agent", assigneeId))) {
    responsibleKey = buildResponsibleKey("agent", assigneeId);
  } else if (assigneeName) {
    const matchingAgent = options.find(
      (option) => option.type === "agent" && option.label === assigneeName,
    );
    if (matchingAgent) {
      responsibleKey = matchingAgent.key;
    } else {
      const fallbackKey = `current-agent:${encodeURIComponent(assigneeName)}`;
      options.push({
        key: fallbackKey,
        label: assigneeName,
        type: "agent",
      });
      responsibleKey = fallbackKey;
    }
  } else if (Number.isInteger(teamId) && teamId && options.some((option) => option.key === buildResponsibleKey("team", teamId))) {
    responsibleKey = buildResponsibleKey("team", teamId);
  } else if (teamName) {
    const teamLabel = `Equipe: ${teamName}`;
    const matchingTeam = options.find(
      (option) => option.type === "team" && option.label === teamLabel,
    );
    if (matchingTeam) {
      responsibleKey = matchingTeam.key;
    } else {
      const fallbackKey = `current-team:${encodeURIComponent(teamName)}`;
      options.push({
        key: fallbackKey,
        label: teamLabel,
        type: "team",
      });
      responsibleKey = fallbackKey;
    }
  }

  return {
    responsibleKey,
    responsibleOptions: options,
  } satisfies Pick<KanbanCardQuickEdit, "responsibleKey" | "responsibleOptions">;
}

async function buildCardDetail(
  conversationId: number,
  conversation: Awaited<ReturnType<typeof fetchConversation>>,
) {
  const leadId = asLeadId(conversation.custom_attributes?.kommo_lead_id);
  const kommoSummary = getKommoCardSummary(leadId);
  const fallbackSummary = buildFallbackCardSummary(conversation);
  const mergedSummary = mergeCardSummaries(kommoSummary, fallbackSummary);

  if (!mergedSummary) {
    return null;
  }

  const quickEdit = {
    price: formatPriceInput(conversation.custom_attributes?.kommo_lead_price),
    priority: normalizePriority(conversation.priority),
    ...(await loadResponsibleOptions(conversation)),
  } satisfies KanbanCardQuickEdit;

  const baseDetail = {
    conversationId,
    ...mergedSummary,
    quickEdit,
  } satisfies KanbanCardDetail;
  const runtimeDetail =
    fallbackSummary && fallbackSummary.sections.length
      ? applyCardOverrides(baseDetail, {
          fields: flattenSections(fallbackSummary.sections),
        })
      : baseDetail;

  const manualOverrides = parseCardOverrides(
    conversation.custom_attributes?.[CARD_OVERRIDES_ATTRIBUTE_KEY],
  );

  return applyCardOverrides(
    runtimeDetail,
    manualOverrides,
  );
}

export async function GET(request: NextRequest) {
  try {
    assertAppAccess(request);

    const conversationIdParam = request.nextUrl.searchParams.get("conversationId");
    const conversationId = Number(conversationIdParam);

    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return NextResponse.json(
        { error: "conversationId invalido." },
        { status: 400 },
      );
    }

    const conversation = await fetchConversation(conversationId);
    const detail = await buildCardDetail(conversationId, conversation);

    if (!detail) {
      return NextResponse.json(
        { error: "Nao foi possivel montar o resumo do card." },
        { status: 404 },
      );
    }

    return NextResponse.json(detail);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao montar o resumo do card.";

    return NextResponse.json(
      { error: message },
      { status: message === "Nao autorizado." ? 401 : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAppAccess(request);

    const formData = await request.formData();
    const parsedConversationId = Number(formData.get("conversationId"));
    const noteValue = formData.get("note");
    const note =
      typeof noteValue === "string" ? noteValue.trim().slice(0, 2000) : "";
    const attachments = [
      ...formData.getAll("attachments[]"),
      ...formData.getAll("attachments"),
    ].filter((value): value is File => value instanceof File && value.size > 0);

    if (!Number.isInteger(parsedConversationId) || parsedConversationId <= 0) {
      return NextResponse.json(
        { error: "conversationId invalido." },
        { status: 400 },
      );
    }

    if (!attachments.length) {
      return NextResponse.json(
        { error: "Selecione pelo menos um arquivo para anexar." },
        { status: 422 },
      );
    }

    await fetchConversation(parsedConversationId);
    await createConversationAttachmentNote(parsedConversationId, {
      content: note,
      attachments,
    });

    return NextResponse.json({
      ok: true,
      uploadedCount: attachments.length,
      message: `${attachments.length} arquivo${attachments.length === 1 ? "" : "s"} anexado${attachments.length === 1 ? "" : "s"} na conversa.`,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao anexar os arquivos.";

    return NextResponse.json(
      { error: message },
      { status: message === "Nao autorizado." ? 401 : 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertAppAccess(request);
    const payload = patchSchema.parse(await request.json());

    const pipeline = getKommoPipelines().find(
      (candidate) => candidate.id === payload.pipelineId,
    );

    if (!pipeline) {
      return NextResponse.json({ error: "Funil invalido." }, { status: 422 });
    }

    const stage = pipeline.statuses.find(
      (candidate) => candidate.name === payload.stageName,
    );

    if (!stage) {
      return NextResponse.json(
        { error: "A etapa escolhida nao existe no funil selecionado." },
        { status: 422 },
      );
    }

    const conversation = await fetchConversation(payload.conversationId);
    const currentDetail = await buildCardDetail(payload.conversationId, conversation);
    const senderId = conversation.meta?.sender?.id;
    const currentCustomAttributes = {
      ...(conversation.custom_attributes ?? {}),
    };
    const currentFieldValues = new Map(
      flattenSections(currentDetail?.sections ?? []).map((field) => [
        fieldKey(field.sectionTitle, field.label),
        normalizeText(field.value),
      ]),
    );
    const existingOverrides = parseCardOverrides(
      currentCustomAttributes[CARD_OVERRIDES_ATTRIBUTE_KEY],
    );
    const preservedOverrides = new Map(
      existingOverrides.fields.map((field) => [fieldKey(field.sectionTitle, field.label), field]),
    );
    const nextOverrides: KanbanCardOverrides = {
      title: payload.title,
      fields: [],
    };
    const contactUpdates: {
      name?: string | null;
      email?: string | null;
      phoneNumber?: string | null;
    } = {};
    const responsibleUpdate = parseResponsibleKey(payload.responsibleKey);
    const parsedPrice = parsePrice(payload.price);

    for (const field of payload.fields) {
      const key = fieldKey(field.sectionTitle, field.label);
      preservedOverrides.delete(key);

      if (isChannelLabel(field.label)) {
        continue;
      }

      if (isContactSection(field.sectionTitle) && isNameLabel(field.label)) {
        if (senderId) {
          const normalizedValue = normalizeText(field.value);
          if (currentFieldValues.get(key) === normalizedValue) {
            continue;
          }
          contactUpdates.name = normalizedValue || null;
          continue;
        }
      }

      if (isContactSection(field.sectionTitle) && isEmailLabel(field.label)) {
        if (senderId) {
          const normalizedValue = normalizeText(field.value);
          if (currentFieldValues.get(key) === normalizedValue) {
            continue;
          }
          contactUpdates.email = normalizedValue || null;
          continue;
        }
      }

      if (isContactSection(field.sectionTitle) && isPhoneLabel(field.label)) {
        if (senderId) {
          const normalizedValue = normalizeText(field.value);
          if (currentFieldValues.get(key) === normalizedValue) {
            continue;
          }
          contactUpdates.phoneNumber = normalizedValue || null;
          continue;
        }
      }

      if (
        isLeadSection(field.sectionTitle) &&
        isNameLabel(field.label) &&
        normalizeText(field.value)
      ) {
        nextOverrides.fields.push({
          sectionTitle: field.sectionTitle,
          label: field.label,
          value: normalizeText(field.value),
        });
        continue;
      }

      if (isPriceLabel(field.label) || isPipelineLabel(field.label) || isStageLabel(field.label) || isStatusLabel(field.label)) {
        continue;
      }

      const normalizedValue = normalizeText(field.value);
      if (!normalizedValue) {
        continue;
      }

      nextOverrides.fields.push({
        sectionTitle: field.sectionTitle,
        label: field.label,
        value: normalizedValue,
      });
    }

    for (const field of preservedOverrides.values()) {
      nextOverrides.fields.push(field);
    }

    currentCustomAttributes.kommo_pipeline = pipeline.name;
    currentCustomAttributes.kommo_stage = stage.name;
    currentCustomAttributes.kommo_stage_changed_at = new Date().toISOString();

    if (parsedPrice === undefined) {
      // keep current price
    } else if (parsedPrice === null) {
      delete currentCustomAttributes.kommo_lead_price;
    } else {
      currentCustomAttributes.kommo_lead_price = parsedPrice;
    }

    const serializedOverrides = serializeCardOverrides(nextOverrides);
    if (serializedOverrides) {
      currentCustomAttributes[CARD_OVERRIDES_ATTRIBUTE_KEY] = serializedOverrides;
    } else {
      delete currentCustomAttributes[CARD_OVERRIDES_ATTRIBUTE_KEY];
    }

    const currentSender = conversation.meta?.sender;
    if (
      contactUpdates.name !== undefined &&
      normalizeOptionalText(contactUpdates.name) ===
        normalizeOptionalText(currentSender?.name)
    ) {
      delete contactUpdates.name;
    }
    if (
      contactUpdates.email !== undefined &&
      normalizeOptionalText(contactUpdates.email) ===
        normalizeOptionalText(currentSender?.email)
    ) {
      delete contactUpdates.email;
    }
    if (
      contactUpdates.phoneNumber !== undefined &&
      normalizeOptionalText(contactUpdates.phoneNumber) ===
        normalizeOptionalText(currentSender?.phone_number)
    ) {
      delete contactUpdates.phoneNumber;
    }

    if (senderId) {
      await updateContact(senderId, contactUpdates);
    }

    if (!responsibleUpdate.preserveCurrent) {
      await updateConversationAssignment(payload.conversationId, {
        assigneeId: responsibleUpdate.assigneeId,
        teamId: responsibleUpdate.teamId,
      });
    }

    const nextPriority = payload.priority ?? normalizePriority(conversation.priority);
    if (nextPriority !== normalizePriority(conversation.priority)) {
      await updateConversationPriority(payload.conversationId, nextPriority);
    }

    if (
      payload.status !== conversation.status &&
      (["open", "pending", "resolved", "snoozed"] as ConversationStatusValue[]).includes(
        payload.status,
      )
    ) {
      await updateConversationStatus(payload.conversationId, payload.status);
    }

    await updateConversationCustomAttributes(
      payload.conversationId,
      currentCustomAttributes,
    );

    const updatedConversation = await fetchConversation(payload.conversationId);
    const detail = await buildCardDetail(payload.conversationId, updatedConversation);

    if (!detail) {
      return NextResponse.json(
        { error: "Nao foi possivel remontar o card apos salvar." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      detail,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao salvar o card.";

    return NextResponse.json(
      { error: message },
      { status: message === "Nao autorizado." ? 401 : 500 },
    );
  }
}
