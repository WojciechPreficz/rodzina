import type {
  CreateShoppingItem,
  PatchShoppingItem,
  ShoppingItem,
  ShoppingList,
  ShoppingCategory,
} from '@rodzina/shared';
import { apiFetch } from '../../api.js';

export type ShoppingSuggestion = { name: string; category: ShoppingCategory };
export type ShoppingChange =
  | { type: 'createList'; name: string; id: string }
  | { type: 'renameList'; id: string; name: string }
  | { type: 'deleteList'; id: string }
  | { type: 'add'; listId: string; id: string; data: CreateShoppingItem }
  | { type: 'edit'; listId: string; id: string; data: PatchShoppingItem }
  | { type: 'remove'; listId: string; id: string }
  | { type: 'clear'; listId: string };

export async function listShoppingLists(signal: AbortSignal) {
  return (await apiFetch<{ lists: ShoppingList[] }>('/api/shopping/lists', { signal })).lists;
}

export async function listShoppingItems(id: string, signal: AbortSignal) {
  return (await apiFetch<{ items: ShoppingItem[] }>(`/api/shopping/lists/${id}/items`, { signal })).items;
}

export async function shoppingSuggestions(q: string, signal: AbortSignal) {
  return (
    await apiFetch<{ suggestions: ShoppingSuggestion[] }>(`/api/shopping/suggestions?q=${encodeURIComponent(q)}`, {
      signal,
    })
  ).suggestions;
}

export async function changeShopping(
  change: ShoppingChange,
  operationId?: string,
  actorId?: string,
  signal?: AbortSignal,
) {
  const send = (path: string, init: RequestInit) =>
    apiFetch(path + (operationId ? `?operationId=${operationId}${actorId ? `&actorId=${actorId}` : ''}` : ''), {
      ...init,
      ...(signal ? { signal } : {}),
    });
  switch (change.type) {
    case 'createList':
      return send('/api/shopping/lists', { method: 'POST', body: JSON.stringify({ name: change.name }) });
    case 'renameList':
      return send(`/api/shopping/lists/${change.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: change.name }),
      });
    case 'deleteList':
      return send(`/api/shopping/lists/${change.id}`, { method: 'DELETE' });
    case 'add':
      return send(`/api/shopping/lists/${change.listId}/items`, {
        method: 'POST',
        body: JSON.stringify(change.data),
      });
    case 'edit':
      return send(`/api/shopping/items/${change.id}`, { method: 'PATCH', body: JSON.stringify(change.data) });
    case 'remove':
      return send(`/api/shopping/items/${change.id}`, { method: 'DELETE' });
    case 'clear':
      return send(`/api/shopping/lists/${change.listId}/clear-checked`, { method: 'POST' });
  }
}
