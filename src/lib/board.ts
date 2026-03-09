import { getServerEnv, trimTrailingSlash } from "@/lib/env";
import { fetchInboxes, fetchPipelineConversations } from "@/lib/chatwoot-api";
import { getKommoPipelines, getPipelineById } from "@/lib/kommo-structure";
import {
  BoardBreakdownItem,
  BoardResponse,
  KanbanCardHighlight,
  ChatwootConversation,
  ChatwootInbox,
  KanbanCardData,
  KanbanColumnData,
} from "@/lib/types";

const FALLBACK_STAGE_ID = "stage:unmapped";
const BOARD_CACHE_TTL_MS = 20_000;
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
    asString(sender?.name) ??
    asString(customAttributes.kommo_lead_proposta) ??
    `Lead #${leadId ?? conversation.id}`;

  const card: KanbanCardData = {
    id: conversation.id,
    title,
    description: "",
    highlights,
    pipelineName,
    stageName,
    stageColor: "#94a3b8",
    inboxName: inbox?.name ?? `Inbox ${conversation.inbox_id}`,
    channelLabel,
    conversationStatus: humanizeStatus(conversation.status),
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

  const [conversations, inboxes] = await Promise.all([
    fetchPipelineConversations(selectedPipeline.name, force),
    fetchInboxes(force),
  ]);

  const inboxById = new Map(inboxes.map((inbox) => [inbox.id, inbox]));
  const columns = selectedPipeline.statuses.map<KanbanColumnData>((status) => ({
    id: `stage:${status.id}`,
    title: status.name,
    color: status.color,
    cards: [],
  }));
  const columnByTitle = new Map(columns.map((column) => [column.title, column]));
  const fallbackColumn: KanbanColumnData = {
    id: FALLBACK_STAGE_ID,
    title: "Sem etapa",
    color: "#94a3b8",
    cards: [],
  };
  const channelCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();

  for (const conversation of conversations) {
    const card = resolveCard(
      conversation,
      inboxById,
      trimTrailingSlash(env.CHATWOOT_BASE_URL),
    );
    const targetColumn = columnByTitle.get(card.stageName) ?? fallbackColumn;
    const status = selectedPipeline.statuses.find(
      (pipelineStatus) => pipelineStatus.name === targetColumn.title,
    );

    card.stageColor = status?.color ?? fallbackColumn.color;
    targetColumn.cards.push(card);

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
  }

  fallbackColumn.cards.sort(
    (left, right) => right.lastActivityAt - left.lastActivityAt,
  );

  const finalColumns = fallbackColumn.cards.length
    ? [...columns, fallbackColumn]
    : columns;

  const response: BoardResponse = {
    accountId: env.CHATWOOT_ACCOUNT_ID,
    chatwootBaseUrl: trimTrailingSlash(env.CHATWOOT_BASE_URL),
    fetchedAt: new Date().toISOString(),
    pipelines: pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      isMain: pipeline.isMain,
      stageCount: pipeline.statuses.length,
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
      channelBreakdown: toBreakdown(channelCounts),
      statusBreakdown: toBreakdown(statusCounts),
    },
  };

  boardCache.set(cacheKey, {
    expiresAt: Date.now() + BOARD_CACHE_TTL_MS,
    value: response,
  });

  return response;
}

export function invalidateBoardCache() {
  boardCache.clear();
}
