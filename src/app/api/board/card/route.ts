import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  applyCardOverrides,
  CARD_OVERRIDES_ATTRIBUTE_KEY,
  parseCardOverrides,
  serializeCardOverrides,
} from "@/lib/card-overrides";
import {
  fetchConversation,
  updateContact,
  updateConversationCustomAttributes,
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
  ConversationStatusValue,
  KanbanCardDetail,
  KanbanCardFieldOverride,
  KanbanCardOverrides,
  KanbanDetailSection,
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

function buildCardDetail(conversationId: number, conversation: Awaited<ReturnType<typeof fetchConversation>>) {
  const leadId = asLeadId(conversation.custom_attributes?.kommo_lead_id);
  const kommoSummary = getKommoCardSummary(leadId);
  const fallbackSummary = buildFallbackCardSummary(conversation);
  const mergedSummary = mergeCardSummaries(kommoSummary, fallbackSummary);

  if (!mergedSummary) {
    return null;
  }

  const baseDetail = {
    conversationId,
    ...mergedSummary,
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
    const detail = buildCardDetail(conversationId, conversation);

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
    const senderId = conversation.meta?.sender?.id;
    const currentCustomAttributes = {
      ...(conversation.custom_attributes ?? {}),
    };
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
    const parsedPrice = parsePrice(payload.price);

    for (const field of payload.fields) {
      const key = fieldKey(field.sectionTitle, field.label);
      preservedOverrides.delete(key);

      if (isChannelLabel(field.label)) {
        continue;
      }

      if (isContactSection(field.sectionTitle) && isNameLabel(field.label)) {
        if (senderId) {
          contactUpdates.name = normalizeText(field.value) || null;
          continue;
        }
      }

      if (isContactSection(field.sectionTitle) && isEmailLabel(field.label)) {
        if (senderId) {
          contactUpdates.email = normalizeText(field.value) || null;
          continue;
        }
      }

      if (isContactSection(field.sectionTitle) && isPhoneLabel(field.label)) {
        if (senderId) {
          contactUpdates.phoneNumber = normalizeText(field.value) || null;
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

    if (senderId) {
      await updateContact(senderId, contactUpdates);
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
    const detail = buildCardDetail(payload.conversationId, updatedConversation);

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
