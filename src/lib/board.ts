import { getServerEnv, trimTrailingSlash } from "@/lib/env";
import { fetchInboxes, fetchPipelineConversations } from "@/lib/chatwoot-api";
import { getKommoPipelines, getPipelineById } from "@/lib/kommo-structure";
import { readScheduleFromAttributes } from "@/lib/schedule";
import {
  BoardBreakdownItem,
  BoardResponse,
  ChatwootConversation,
  ChatwootInbox,
  KanbanCardData,
  KanbanColumnData,
} from "@/lib/types";

const FALLBACK_STAGE_ID = "stage:unmapped";

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isImportedDump(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  return /^(Kommo Timeline|Lead Snapshot)/i.test(value.trim());
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

function resolveCard(
  conversation: ChatwootConversation,
  inboxById: Map<number, ChatwootInbox>,
  chatwootBaseUrl: string,
) {
  const customAttributes = conversation.custom_attributes ?? {};
  const schedule = readScheduleFromAttributes(customAttributes);
  const sender = conversation.meta?.sender;
  const stageName = asString(customAttributes.kommo_stage) ?? "Sem etapa";
  const pipelineName = asString(customAttributes.kommo_pipeline) ?? "Sem funil";
  const inbox = inboxById.get(conversation.inbox_id);
  const channelLabel = humanizeChannel(
    conversation.meta?.channel ?? inbox?.channel_type,
  );
  const leadId = asString(customAttributes.kommo_lead_id);
  const title =
    asString(sender?.name) ??
    asString(customAttributes.kommo_lead_proposta) ??
    `Lead #${leadId ?? conversation.id}`;
  const messageCandidates = [
    conversation.last_non_activity_message?.content,
    conversation.messages?.[0]?.content,
  ];
  const latestMessage = compactText(
    messageCandidates.find((candidate) => candidate && !isImportedDump(candidate)),
    140,
  );
  const fallbackDescription =
    asString(customAttributes.kommo_lead_proposta) ??
    asString(customAttributes.kommo_lead_comentarios) ??
    asString(customAttributes.kommo_lead_tags) ??
    "Sem mensagem recente";

  const card: KanbanCardData = {
    id: conversation.id,
    title,
    description: latestMessage || compactText(fallbackDescription, 140),
    contactThumbnail: sender?.thumbnail ?? null,
    pipelineName,
    stageName,
    stageColor: "#94a3b8",
    inboxName: inbox?.name ?? `Inbox ${conversation.inbox_id}`,
    channelLabel,
    conversationStatus: humanizeStatus(conversation.status),
    priority: conversation.priority ?? null,
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
    scheduledAt: schedule.scheduledAt,
    taskType: schedule.taskType,
    scheduleUpdatedAt: schedule.scheduleUpdatedAt,
    scheduleUpdatedBy: schedule.scheduleUpdatedBy,
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

  return {
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
}
