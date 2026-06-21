const WEBFLOW_API_BASE = "https://api.webflow.com/v2";

export interface WebflowCollectionSummary {
  id: string;
  displayName: string;
  singularName?: string;
  slug: string;
}

export interface WebflowField {
  id: string;
  slug: string;
  displayName?: string;
  type: string;
  isRequired?: boolean;
  validations?: {
    options?: Array<{ id?: string; name: string }>;
    collectionId?: string;
  };
}

export interface WebflowCollection extends WebflowCollectionSummary {
  fields: WebflowField[];
}

export interface WebflowItem {
  id: string;
  lastUpdated?: string;
  createdOn?: string;
  isDraft?: boolean;
  isArchived?: boolean;
  fieldData: Record<string, unknown>;
}

async function webflowFetch<T>(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${WEBFLOW_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Webflow API ${response.status}: ${response.statusText}`;
    try {
      const errorData = JSON.parse(errorText) as {
        message?: string;
        error?: string;
        errors?: Array<{ param?: string; description?: string; message?: string }>;
      };
      if (errorData.errors?.length) {
        errorMessage = errorData.errors
          .map((e) => (e.param && e.description ? `${e.param}: ${e.description}` : e.message ?? JSON.stringify(e)))
          .join("; ");
      } else {
        errorMessage = errorData.message || errorData.error || errorMessage;
      }
    } catch {
      if (errorText) errorMessage += ` - ${errorText.slice(0, 500)}`;
    }
    throw new Error(errorMessage);
  }

  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

export async function listCollections(
  token: string,
  siteId: string,
): Promise<WebflowCollectionSummary[]> {
  const data = await webflowFetch<{ collections: WebflowCollectionSummary[] }>(
    token,
    `/sites/${siteId}/collections`,
  );
  return data.collections ?? [];
}

export async function getCollection(
  token: string,
  collectionId: string,
): Promise<WebflowCollection> {
  return webflowFetch<WebflowCollection>(token, `/collections/${collectionId}`);
}

export async function listCollectionItems(
  token: string,
  collectionId: string,
): Promise<WebflowItem[]> {
  const allItems: WebflowItem[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await webflowFetch<{ items: WebflowItem[] }>(
      token,
      `/collections/${collectionId}/items?limit=${limit}&offset=${offset}`,
    );
    const items = data.items ?? [];
    allItems.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }

  return allItems;
}

export async function createCollectionItem(
  token: string,
  collectionId: string,
  fieldData: Record<string, unknown>,
  isDraft = false,
): Promise<WebflowItem> {
  return webflowFetch<WebflowItem>(token, `/collections/${collectionId}/items`, {
    method: "POST",
    body: JSON.stringify({ fieldData, isDraft }),
  });
}

export async function updateCollectionItem(
  token: string,
  collectionId: string,
  itemId: string,
  fieldData: Record<string, unknown>,
  isDraft = false,
): Promise<WebflowItem> {
  return webflowFetch<WebflowItem>(token, `/collections/${collectionId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify({ fieldData, isDraft }),
  });
}

export async function publishCollectionItems(
  token: string,
  collectionId: string,
  itemIds: string[],
): Promise<void> {
  if (!itemIds.length) return;
  await webflowFetch(token, `/collections/${collectionId}/items/publish`, {
    method: "POST",
    body: JSON.stringify({ itemIds }),
  });
}

export async function unpublishCollectionItem(
  token: string,
  collectionId: string,
  itemId: string,
): Promise<void> {
  await webflowFetch(token, `/collections/${collectionId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify({ isDraft: true }),
  });
}

export async function archiveCollectionItem(
  token: string,
  collectionId: string,
  itemId: string,
): Promise<void> {
  await webflowFetch(token, `/collections/${collectionId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify({ isArchived: true }),
  });
}

export async function unarchiveCollectionItem(
  token: string,
  collectionId: string,
  itemId: string,
): Promise<void> {
  await webflowFetch(token, `/collections/${collectionId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify({ isArchived: false }),
  });
}
