import { getServerEnv, trimTrailingSlash } from "@/lib/env";
import {
  fetchAllConversations,
  fetchInboxes,
  updateConversationCustomAttributes,
} from "@/lib/chatwoot-api";
import { CARD_OVERRIDES_ATTRIBUTE_KEY, parseCardOverrides } from "@/lib/card-overrides";
import { getKommoPipelines, getPipelineById } from "@/lib/kommo-structure";
import {
  BoardBreakdownItem,
  BoardResponse,
  KanbanCardHighlight,
  ChatwootConversation,
  ChatwootInbox,
  KanbanCardData,
  KanbanColumnData,
  KommoPipeline,
} from "@/lib/types";

const FALLBACK_STAGE_ID = "stage:unmapped";
const BOARD_CACHE_TTL_MS = 20_000;
const WON_STAGE_ID = 142;
const LOST_STAGE_ID = 143;
const HIGHLIGHT_PRIORITY: Array<{
  matcher: RegExp;
  label: string;
}> = [
  { matcher: /origem/, label: "Origem" },
  { matcher: /venc.*bombeir/, label: "Vencimento Bombeiros" },
  { matcher: /venc.*vigil/, label: "Vencimento Vigilancia Sanitaria" },
  { matcher: /valid.*cli/, label: "Validade do CLI" },
  { matcher: /valid/, label: "Validade" },
  { matcher: /vigenc/, label: "Vigencia" },
  { matcher: /cnae/, label: "CNAE" },
  { matcher: /segmento/, label: "Segmento" },
  { matcher: /ramo/, label: "Ramo" },
  { matcher: /atividade/, label: "Atividade" },
  { matcher: /risco/, label: "Risco" },
  { matcher: /licenc/, label: "Licenca" },
];

const boardCache = new Map<
  number,
  {
    expiresAt: number;
    value: BoardResponse;
  }
>();

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asUnixSeconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value > 1_000_000_000_000 ? value / 1000 : value);
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    const numericValue = Number(normalized);
    if (Number.isFinite(numericValue)) {
      return Math.floor(
        numericValue > 1_000_000_000_000 ? numericValue / 1000 : numericValue,
      );
    }

    const parsedDate = Date.parse(normalized);
    if (Number.isFinite(parsedDate)) {
      return Math.floor(parsedDate / 1000);
    }
  }

  return null;
}

function compactText(value: string | null | undefined, maxLength: number) {
  if (!value) {
    return "";
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}...`
    : normalized;
}

function normalizeLookup(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function humanizeChannel(channelType: string | null | undefined) {
  const channel = channelType ?? "";

  if (channel.includes("Whatsapp")) return "WhatsApp";
  if (channel.includes("WebWidget")) return "Site";
  if (channel.includes("Email")) return "Email";
  if (channel.includes("Telegram")) return "Telegram";
  if (channel.includes("Api")) return "API";
  if (channel.includes("Sms")) return "SMS";

  return channel.replace("Channel::", "") || "Canal";
}

function humanizeStatus(status: string) {
  const map: Record<string, string> = {
    open: "Aberta",
    pending: "Pendente",
    resolved: "Resolvida",
    snoozed: "Adiada",
  };

  return map[status] ?? status;
}

function resolveStageKind(
  status: Pick<KommoPipeline["statuses"][number], "id" | "type" | "name"> | undefined,
  stageName?: string | null,
): KanbanCardData["stageKind"] {
  if (status?.id === WON_STAGE_ID) {
    return "won";
  }

  if (status?.id === LOST_STAGE_ID) {
    return "lost";
  }

  if (status?.type === 1) {
    return "incoming";
  }

  const normalizedStageName = normalizeLookup(stageName ?? status?.name ?? "");
  if (normalizedStageName.includes("ganha")) {
    return "won";
  }

  if (normalizedStageName.includes("perdida") || normalizedStageName.includes("perdido")) {
    return "lost";
  }

  return "open";
}

function buildConversationUrl(
  baseUrl: string,
  accountId: number,
  conversationId: number,
  inboxId?: number,
) {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);
  const relativePath = inboxId
    ? `/app/accounts/${accountId}/inbox/${inboxId}/conversations/${conversationId}`
    : `/app/accounts/${accountId}/conversations/${conversationId}`;

  return `${normalizedBaseUrl}${relativePath}`;
}

function toHighlightValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return asString(value);
}

function isNoiseValue(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return true;
  }

  if (
    normalized.startsWith("{") ||
    normalized.startsWith("[") ||
    normalized.includes("file_uuid") ||
    normalized.includes("version_uuid")
  ) {
    return true;
  }

  return false;
}

function resolveHighlightLabel(key: string) {
  const normalizedKey = normalizeLookup(key);
  const matched = HIGHLIGHT_PRIORITY.find((item) => item.matcher.test(normalizedKey));

  if (matched) {
    return matched.label;
  }

  const label = key
    .replace(/^kommo_(contact|lead|company)_/, "")
    .replace(/_/g, " ")
    .trim();

  return label ? compactText(label, 40) : null;
}

function collectHighlights(
  source: Record<string, unknown> | undefined,
  bucket: KanbanCardHighlight[],
  seenLabels: Set<string>,
) {
  if (!source) {
    return;
  }

  for (const [key, rawValue] of Object.entries(source)) {
    if (!key.startsWith("kommo_")) {
      continue;
    }

    const normalizedKey = normalizeLookup(key);
    const isRelevant = HIGHLIGHT_PRIORITY.some((item) =>
      item.matcher.test(normalizedKey),
    );

    if (!isRelevant) {
      continue;
    }

    const value = toHighlightValue(rawValue);
    if (!value || isNoiseValue(value)) {
      continue;
    }

    const label = resolveHighlightLabel(key);
    if (!label || seenLabels.has(label)) {
      continue;
    }

    bucket.push({
      label,
      value: compactText(value, 48),
    });
    seenLabels.add(label);
  }
}

function resolveCard(
  conversation: ChatwootConversation,
  inboxById: Map<number, ChatwootInbox>,
  chatwootBaseUrl: string,
) {
  const customAttributes = conversation.custom_attributes ?? {};
  const sender = conversation.meta?.sender;
  const stageName = asString(customAttributes.kommo_stage) ?? "Sem etapa";
  const pipelineName = asString(customAttributes.kommo_pipeline) ?? "Sem funil";
  const cardOverrides = parseCardOverrides(
    customAttributes[CARD_OVERRIDES_ATTRIBUTE_KEY],
  );
  const inbox = inboxById.get(conversation.inbox_id);
  const channelLabel = humanizeChannel(
    conversation.meta?.channel ?? inbox?.channel_type,
  );
  const leadId = asString(customAttributes.kommo_lead_id);
  const highlights: KanbanCardHighlight[] = [];
  const seenLabels = new Set<string>();

  collectHighlights(sender?.custom_attributes, highlights, seenLabels);
  collectHighlights(customAttributes, highlights, seenLabels);

  const title =
    cardOverrides.title ??
    asString(sender?.name) ??
    asString(customAttributes.kommo_lead_proposta) ??
    `Lead #${leadId ?? conversation.id}`;
  const stageEnteredAt =
    asUnixSeconds(customAttributes.kommo_stage_changed_at) ??
    asUnixSeconds(customAttributes.kommo_lead_stage_changed_at) ??
    asUnixSeconds(customAttributes.kommo_stage_updated_at) ??
    asUnixSeconds(customAttributes.kommo_lead_updated_at) ??
    asUnixSeconds(customAttributes.kommo_updated_at) ??
    asUnixSeconds(conversation.updated_at) ??
    asUnixSeconds(conversation.created_at) ??
    Math.floor(Date.now() / 1000);

  const card: KanbanCardData = {
    id: conversation.id,
    title,
    description: "",
    contactThumbnail: sender?.thumbnail ?? null,
    highlights,
    pipelineName,
    stageName,
    stageId: null,
    stageKind: "unmapped",
    stageEnteredAt,
    stageColor: "#94a3b8",
    inboxName: inbox?.name ?? `Inbox ${conversation.inbox_id}`,
    channelLabel,
    conversationStatus: humanizeStatus(conversation.status),
    conversationStatusValue: conversation.status,
    unreadCount: conversation.unread_count ?? 0,
    tags: Array.isArray(conversation.labels) ? conversation.labels : [],
    lastActivityAt: conversation.last_activity_at,
    createdAt: conversation.created_at,
    updatedAt: Math.floor(conversation.updated_at),
    assigneeName: conversation.meta?.assignee?.name ?? null,
    teamName: conversation.meta?.team?.name ?? null,
    contactEmail: sender?.email ?? null,
    contactPhone: sender?.phone_number ?? null,
    price: asNumber(customAttributes.kommo_lead_price),
    leadId,
    openUrl: buildConversationUrl(
      chatwootBaseUrl,
      conversation.account_id,
      conversation.id,
      conversation.inbox_id,
    ),
  };

  return card;
}

function stageByName(pipeline: KommoPipeline, stageName: string | null) {
  if (!stageName) {
    return null;
  }

  return (
    pipeline.statuses.find((status) => status.name === stageName) ?? null
  );
}

function resolveEntryStage(pipeline: KommoPipeline) {
  return pipeline.statuses.find((status) => status.type === 1) ?? pipeline.statuses[0] ?? null;
}

function shouldBootstrapConversation(conversation: ChatwootConversation) {
  if (!["open", "pending"].includes(conversation.status)) {
    return false;
  }

  const customAttributes = conversation.custom_attributes ?? {};
  const pipelineName = asString(customAttributes.kommo_pipeline);
  const stageName = asString(customAttributes.kommo_stage);

  return !pipelineName || !stageName;
}

async function applyDefaultEntryStage(
  conversations: ChatwootConversation[],
  pipelines: KommoPipeline[],
  defaultPipeline: KommoPipeline,
) {
  let updated = false;

  const nextConversations = await Promise.all(
    conversations.map(async (conversation) => {
      if (!shouldBootstrapConversation(conversation)) {
        return conversation;
      }

      const customAttributes = {
        ...(conversation.custom_attributes ?? {}),
      };
      const currentPipelineName = asString(customAttributes.kommo_pipeline);
      const targetPipeline =
        pipelines.find((pipeline) => pipeline.name === currentPipelineName) ?? defaultPipeline;
      const targetStage =
        stageByName(targetPipeline, asString(customAttributes.kommo_stage)) ??
        resolveEntryStage(targetPipeline);

      if (!targetStage) {
        return conversation;
      }

      customAttributes.kommo_pipeline = targetPipeline.name;
      customAttributes.kommo_stage = targetStage.name;
      customAttributes.kommo_stage_changed_at = new Date().toISOString();

      const persistedConversation = await updateConversationCustomAttributes(
        conversation.id,
        customAttributes,
      );

      updated = true;

      return {
        ...conversation,
        ...persistedConversation,
        custom_attributes: {
          ...(conversation.custom_attributes ?? {}),
          ...(persistedConversation.custom_attributes ?? {}),
        },
      } satisfies ChatwootConversation;
    }),
  );

  return {
    conversations: nextConversations,
    updated,
  };
}

function sumCardValues(cards: KanbanCardData[]) {
  return cards.reduce((sum, card) => sum + (card.price ?? 0), 0);
}

function toBreakdown(source: Map<string, number>, labelResolver?: (key: string) => string) {
  return [...source.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({
      key,
      label: labelResolver ? labelResolver(key) : key,
      count,
    })) satisfies BoardBreakdownItem[];
}

export async function buildBoardResponse(
  pipelineId?: number | null,
  force = false,
): Promise<BoardResponse> {
  const env = getServerEnv();
  const pipelines = getKommoPipelines();
  const selectedPipeline = getPipelineById(pipelineId);
  const cacheKey = selectedPipeline.id;

  if (!force) {
    const cachedBoard = boardCache.get(cacheKey);
    if (cachedBoard && cachedBoard.expiresAt > Date.now()) {
      return cachedBoard.value;
    }
  }

  const [allConversations, inboxes] = await Promise.all([
    fetchAllConversations(force),
    fetchInboxes(force),
  ]);
  const defaultPipeline = getPipelineById(null);
  const {
    conversations: hydratedConversations,
    updated: autoAssignedNewLeads,
  } = await applyDefaultEntryStage(allConversations, pipelines, defaultPipeline);
  const conversations = hydratedConversations.filter(
    (conversation) => conversation.custom_attributes?.kommo_pipeline === selectedPipeline.name,
  );

  const inboxById = new Map(inboxes.map((inbox) => [inbox.id, inbox]));
  const pipelineSummaryByName = new Map(
    pipelines.map((pipeline) => [
      pipeline.name,
      {
        id: pipeline.id,
        name: pipeline.name,
        isMain: pipeline.isMain,
      stageCount: pipeline.statuses.length,
      statuses: pipeline.statuses.map((status) => ({
        id: status.id,
        name: status.name,
        color: status.color,
        kind: resolveStageKind(status),
      })),
      totalCards: 0,
      totalValue: 0,
      wonCards: 0,
        wonValue: 0,
        lostCards: 0,
        lostValue: 0,
      },
    ]),
  );
  const columns = selectedPipeline.statuses.map<KanbanColumnData>((status) => ({
    id: `stage:${status.id}`,
    title: status.name,
    color: status.color,
    stageId: status.id,
    stageKind: resolveStageKind(status),
    cardCount: 0,
    totalValue: 0,
    cards: [],
  }));
  const columnByTitle = new Map(columns.map((column) => [column.title, column]));
  const fallbackColumn: KanbanColumnData = {
    id: FALLBACK_STAGE_ID,
    title: "Sem etapa",
    color: "#94a3b8",
    stageId: null,
    stageKind: "unmapped",
    cardCount: 0,
    totalValue: 0,
    cards: [],
  };
  const channelCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  let overallCards = 0;
  let overallValue = 0;

  for (const conversation of hydratedConversations) {
    const pipelineName = asString(conversation.custom_attributes?.kommo_pipeline);
    if (!pipelineName) {
      continue;
    }

    const summary = pipelineSummaryByName.get(pipelineName);
    const pipeline = pipelines.find((item) => item.name === pipelineName);

    if (!summary || !pipeline) {
      continue;
    }

    const price = asNumber(conversation.custom_attributes?.kommo_lead_price) ?? 0;
    const stageName = asString(conversation.custom_attributes?.kommo_stage);
    const stage = stageByName(pipeline, stageName);
    const stageKind = resolveStageKind(stage ?? undefined, stageName);

    summary.totalCards += 1;
    summary.totalValue += price;
    overallCards += 1;
    overallValue += price;

    if (stageKind === "won") {
      summary.wonCards += 1;
      summary.wonValue += price;
    }

    if (stageKind === "lost") {
      summary.lostCards += 1;
      summary.lostValue += price;
    }
  }

  for (const conversation of conversations) {
    const card = resolveCard(
      conversation,
      inboxById,
      trimTrailingSlash(env.CHATWOOT_BASE_URL),
    );
    const targetColumn = columnByTitle.get(card.stageName) ?? fallbackColumn;
    const status = stageByName(selectedPipeline, targetColumn.title);

    card.stageColor = status?.color ?? fallbackColumn.color;
    card.stageId = status?.id ?? targetColumn.stageId;
    card.stageKind =
      status ? resolveStageKind(status) : targetColumn.stageKind;
    targetColumn.cards.push(card);
    targetColumn.totalValue += card.price ?? 0;

    channelCounts.set(
      card.channelLabel,
      (channelCounts.get(card.channelLabel) ?? 0) + 1,
    );
    statusCounts.set(
      card.conversationStatus,
      (statusCounts.get(card.conversationStatus) ?? 0) + 1,
    );
  }

  for (const column of columns) {
    column.cards.sort((left, right) => right.lastActivityAt - left.lastActivityAt);
    column.cardCount = column.cards.length;
    column.totalValue = sumCardValues(column.cards);
  }

  fallbackColumn.cards.sort(
    (left, right) => right.lastActivityAt - left.lastActivityAt,
  );
  fallbackColumn.cardCount = fallbackColumn.cards.length;
  fallbackColumn.totalValue = sumCardValues(fallbackColumn.cards);

  const finalColumns = fallbackColumn.cards.length
    ? [...columns, fallbackColumn]
    : columns;
  const totalValue = finalColumns.reduce((sum, column) => sum + column.totalValue, 0);
  const wonColumns = finalColumns.filter((column) => column.stageKind === "won");
  const lostColumns = finalColumns.filter((column) => column.stageKind === "lost");

  const response: BoardResponse = {
    accountId: env.CHATWOOT_ACCOUNT_ID,
    chatwootBaseUrl: trimTrailingSlash(env.CHATWOOT_BASE_URL),
    fetchedAt: new Date().toISOString(),
    pipelines: pipelines.map((pipeline) => ({
      ...(pipelineSummaryByName.get(pipeline.name) ?? {
        id: pipeline.id,
        name: pipeline.name,
        isMain: pipeline.isMain,
        stageCount: pipeline.statuses.length,
        statuses: pipeline.statuses.map((status) => ({
          id: status.id,
          name: status.name,
          color: status.color,
          kind: resolveStageKind(status),
        })),
        totalCards: 0,
        totalValue: 0,
        wonCards: 0,
        wonValue: 0,
        lostCards: 0,
        lostValue: 0,
      }),
    })),
    selectedPipeline: {
      id: selectedPipeline.id,
      name: selectedPipeline.name,
    },
    columns: finalColumns,
    metrics: {
      totalCards: conversations.length,
      stageCount: finalColumns.length,
      unreadCards: finalColumns.reduce(
        (sum, column) =>
          sum + column.cards.filter((card) => card.unreadCount > 0).length,
        0,
      ),
      totalValue,
      wonCards: wonColumns.reduce((sum, column) => sum + column.cardCount, 0),
      wonValue: wonColumns.reduce((sum, column) => sum + column.totalValue, 0),
      lostCards: lostColumns.reduce((sum, column) => sum + column.cardCount, 0),
      lostValue: lostColumns.reduce((sum, column) => sum + column.totalValue, 0),
      overallCards,
      overallValue,
      channelBreakdown: toBreakdown(channelCounts),
      statusBreakdown: toBreakdown(statusCounts),
    },
  };

  if (autoAssignedNewLeads) {
    boardCache.clear();
  }

  boardCache.set(cacheKey, {
    expiresAt: Date.now() + BOARD_CACHE_TTL_MS,
    value: response,
  });

  return response;
}

export function invalidateBoardCache() {
  boardCache.clear();
}
