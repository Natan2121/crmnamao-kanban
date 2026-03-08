export interface KommoStage {
  id: number;
  name: string;
  sort: number;
  color: string;
  type: number;
  pipelineId: number;
}

export interface KommoPipeline {
  id: number;
  name: string;
  sort: number;
  isMain: boolean;
  statuses: KommoStage[];
}

export interface ChatwootInbox {
  id: number;
  name: string;
  channel_type: string;
}

export interface ChatwootContactMeta {
  id?: number;
  name?: string;
  email?: string;
  phone_number?: string;
  thumbnail?: string | null;
}

export interface ChatwootConversation {
  id: number;
  account_id: number;
  inbox_id: number;
  status: string;
  priority: string | null;
  unread_count: number;
  labels: string[];
  created_at: number;
  updated_at: number;
  last_activity_at: number;
  meta?: {
    sender?: ChatwootContactMeta;
    channel?: string;
    assignee?: { name?: string | null } | null;
    team?: { name?: string | null } | null;
  };
  custom_attributes?: Record<string, unknown>;
  messages?: Array<{
    content?: string | null;
  }>;
  last_non_activity_message?: {
    content?: string | null;
  } | null;
}

export interface KanbanCardData {
  id: number;
  title: string;
  description: string;
  pipelineName: string;
  stageName: string;
  stageColor: string;
  inboxName: string;
  channelLabel: string;
  conversationStatus: string;
  unreadCount: number;
  tags: string[];
  lastActivityAt: number;
  createdAt: number;
  updatedAt: number;
  assigneeName: string | null;
  teamName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  price: number | null;
  leadId: string | null;
  openUrl: string;
}

export interface KanbanColumnData {
  id: string;
  title: string;
  color: string;
  cards: KanbanCardData[];
}

export interface PipelineSummary {
  id: number;
  name: string;
  isMain: boolean;
  stageCount: number;
}

export interface BoardBreakdownItem {
  key: string;
  label: string;
  count: number;
}

export interface BoardMetrics {
  totalCards: number;
  stageCount: number;
  unreadCards: number;
  channelBreakdown: BoardBreakdownItem[];
  statusBreakdown: BoardBreakdownItem[];
}

export interface BoardResponse {
  accountId: number;
  chatwootBaseUrl: string;
  fetchedAt: string;
  pipelines: PipelineSummary[];
  selectedPipeline: {
    id: number;
    name: string;
  };
  columns: KanbanColumnData[];
  metrics: BoardMetrics;
}
