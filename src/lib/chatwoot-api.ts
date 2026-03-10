import { getServerEnv, trimTrailingSlash } from "@/lib/env";
import {
  ChatwootContactMeta,
  ChatwootConversation,
  ChatwootInbox,
  ConversationStatusValue,
} from "@/lib/types";

interface ConversationsIndexResponse {
  data: {
    meta: {
      all_count: number;
    };
    payload: ChatwootConversation[];
  };
}

interface InboxesResponse {
  payload: ChatwootInbox[];
}

const REQUEST_TIMEOUT_MS = 10_000;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const CACHE_TTL_MS = 15_000;

let inboxCache:
  | {
      expiresAt: number;
      value: ChatwootInbox[];
    }
  | null = null;

let conversationsCache:
  | {
      expiresAt: number;
      value: ChatwootConversation[];
    }
  | null = null;

function upsertConversationCacheEntry(conversation: ChatwootConversation) {
  if (!conversationsCache) {
    return;
  }

  const nextValue = [...conversationsCache.value];
  const index = nextValue.findIndex((item) => item.id === conversation.id);

  if (index === -1) {
    nextValue.push(conversation);
  } else {
    nextValue[index] = conversation;
  }

  conversationsCache = {
    ...conversationsCache,
    value: nextValue,
  };
}

function accountScopedPath(path: string) {
  const { CHATWOOT_ACCOUNT_ID } = getServerEnv();
  return `/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}${path}`;
}

async function chatwootRequest(path: string, init?: RequestInit) {
  const env = getServerEnv();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${trimTrailingSlash(env.CHATWOOT_BASE_URL)}${path}`,
        {
          ...init,
          cache: "no-store",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            api_access_token: env.CHATWOOT_API_TOKEN,
            ...init?.headers,
          },
        },
      );

      if (!response.ok) {
        const details = await response.text();
        const error = new Error(
          `Chatwoot ${response.status} em ${path}: ${details || "sem corpo de resposta"}`,
        );

        if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === 3) {
          throw error;
        }

        lastError = error;
      } else {
        return response;
      }
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("Falha ao consultar o Chatwoot.");

      if (attempt === 3) {
        break;
      }
    } finally {
      clearTimeout(timeout);
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 300));
  }

  throw lastError ?? new Error("Falha ao consultar o Chatwoot.");
}

async function chatwootFetch<T>(path: string, init?: RequestInit) {
  const response = await chatwootRequest(path, init);
  const body = await response.text();

  if (!body) {
    throw new Error(`Chatwoot respondeu sem JSON em ${path}.`);
  }

  return JSON.parse(body) as T;
}

export async function fetchInboxes(force = false) {
  if (!force && inboxCache && inboxCache.expiresAt > Date.now()) {
    return inboxCache.value;
  }

  const response = await chatwootFetch<InboxesResponse>(accountScopedPath("/inboxes"));
  const value = response.payload ?? [];

  inboxCache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value,
  };

  return value;
}

export async function fetchConversation(conversationId: number) {
  return chatwootFetch<ChatwootConversation>(
    accountScopedPath(`/conversations/${conversationId}`),
  );
}

export async function updateContact(
  contactId: number,
  updates: {
    name?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
  },
) {
  const payload: Record<string, string | null> = {};

  if (updates.name !== undefined) {
    payload.name = updates.name;
  }

  if (updates.email !== undefined) {
    payload.email = updates.email;
  }

  if (updates.phoneNumber !== undefined) {
    payload.phone_number = updates.phoneNumber;
  }

  if (!Object.keys(payload).length) {
    return null;
  }

  const response = await chatwootRequest(accountScopedPath(`/contacts/${contactId}`), {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  const body = await response.text();

  if (!body) {
    return null;
  }

  return JSON.parse(body) as ChatwootContactMeta;
}

export async function updateConversationCustomAttributes(
  conversationId: number,
  customAttributes: Record<string, unknown>,
) {
  const conversation = await chatwootFetch<ChatwootConversation>(
    accountScopedPath(`/conversations/${conversationId}/custom_attributes`),
    {
      method: "POST",
      body: JSON.stringify({
        custom_attributes: customAttributes,
      }),
    },
  );

  upsertConversationCacheEntry(conversation);
  return conversation;
}

export async function updateConversationStatus(
  conversationId: number,
  status: ConversationStatusValue,
) {
  const conversation = await chatwootFetch<ChatwootConversation>(
    accountScopedPath(`/conversations/${conversationId}/toggle_status`),
    {
      method: "POST",
      body: JSON.stringify({
        status,
      }),
    },
  );

  upsertConversationCacheEntry(conversation);
  return conversation;
}

export async function fetchAllConversations(force = false) {
  if (!force && conversationsCache && conversationsCache.expiresAt > Date.now()) {
    return conversationsCache.value;
  }

  const conversations: ChatwootConversation[] = [];
  let page = 1;
  let expectedTotal = Number.POSITIVE_INFINITY;

  while (conversations.length < expectedTotal) {
    const response = await chatwootFetch<ConversationsIndexResponse>(
      `${accountScopedPath("/conversations")}?page=${page}&status=all`,
    );

    const pagePayload = response.data?.payload ?? [];
    expectedTotal = response.data?.meta?.all_count ?? pagePayload.length;
    conversations.push(...pagePayload);

    if (!pagePayload.length || conversations.length >= expectedTotal) {
      break;
    }

    page += 1;
  }

  conversationsCache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: conversations,
  };

  return conversations;
}

export async function fetchPipelineConversations(
  pipelineName: string,
  force = false,
) {
  const conversations = await fetchAllConversations(force);

  return conversations.filter(
    (conversation) => conversation.custom_attributes?.kommo_pipeline === pipelineName,
  );
}
