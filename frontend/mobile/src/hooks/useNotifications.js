import { useCallback, useEffect } from 'react';
import { useNotificationsStore } from '../store/useNotificationsStore';

/**
 * The single entry point to the account's notifications —
 * `GET /api/v1/notifications` (docs/api/api-overview.md §12.1),
 * `PATCH /api/v1/notifications/{id}/read` (§12.2) and
 * `PATCH /api/v1/notifications/read-all` (§12.3) — for the Notifications
 * screen.
 *
 * **This hook is the load trigger**, the same arrangement as
 * `useTransactions`/`useActivities`. It loads the list *and* refreshes the
 * badge: opening this screen is the one moment the app knows the user is
 * looking at their inbox, so it is the right place to force the unread probe
 * rather than letting the bell's cached count go stale behind them.
 *
 * It owns no business logic of its own: which rows are read, what the badge
 * says, and what a mark-read does to held state are all the store's, because
 * every one of those answers comes from the server (constitution §8).
 *
 * `hasMore`/`loadMore` are the pagination surface, as on `useTransactions`:
 * §12.1 answers 20 rows a page. `loadMoreError` is separate from `loadError`
 * so a failed next page is reported *below* the rows instead of replacing them.
 *
 * **`markAllRead` resolves only once the list and the badge have been
 * re-read**, because §12.3 answers a message rather than data and the server
 * owns the `updated_at` it wrote (`backend/README.md` §17.4). A caller can
 * therefore await it and trust the screen afterwards.
 *
 * @returns {{
 *   notifications: object[],
 *   unreadCount: number,
 *   totalElements: number,
 *   hasLoaded: boolean,
 *   isLoading: boolean,
 *   isLoadingMore: boolean,
 *   isMarkingAllRead: boolean,
 *   loadError: string | null,
 *   loadMoreError: string | null,
 *   markError: string | null,
 *   hasMore: boolean,
 *   markRead: (id: string) => Promise<object>,
 *   markAllRead: () => Promise<object>,
 *   loadMore: () => void,
 *   reload: () => void,
 * }}
 */
export function useNotifications() {
  const notifications = useNotificationsStore((state) => state.notifications);
  const unreadCount = useNotificationsStore((state) => state.unreadCount);
  const totalElements = useNotificationsStore((state) => state.totalElements);
  const hasLoaded = useNotificationsStore((state) => state.hasLoaded);
  const isLoading = useNotificationsStore((state) => state.isLoading);
  const isLoadingMore = useNotificationsStore((state) => state.isLoadingMore);
  const isMarkingAllRead = useNotificationsStore((state) => state.isMarkingAllRead);
  const loadError = useNotificationsStore((state) => state.loadError);
  const loadMoreError = useNotificationsStore((state) => state.loadMoreError);
  const markError = useNotificationsStore((state) => state.markError);
  const loadedPage = useNotificationsStore((state) => state.loadedPage);
  const totalPages = useNotificationsStore((state) => state.totalPages);
  const loadNotifications = useNotificationsStore((state) => state.loadNotifications);
  const loadMoreNotifications = useNotificationsStore((state) => state.loadMoreNotifications);
  const loadUnreadCount = useNotificationsStore((state) => state.loadUnreadCount);
  const markNotificationRead = useNotificationsStore((state) => state.markNotificationRead);
  const markAllNotificationsRead = useNotificationsStore(
    (state) => state.markAllNotificationsRead,
  );

  useEffect(() => {
    // Cache-first, so a no-op once a read has succeeded; after a failure
    // `hasLoaded` is still false, so re-entering the screen retries.
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    // Forced, unlike the list: the bell's count is cached for the session, and
    // this is the moment it is most likely to be out of date and most visible
    // (the badge sits in this screen's own header on the way in). One
    // `?read=false&size=1` request — `backend/README.md` §17.5.
    loadUnreadCount({ force: true });
  }, [loadUnreadCount]);

  const loadMore = useCallback(() => {
    loadMoreNotifications();
  }, [loadMoreNotifications]);

  const reload = useCallback(() => {
    loadNotifications({ force: true });
    loadUnreadCount({ force: true });
  }, [loadNotifications, loadUnreadCount]);

  return {
    notifications,
    unreadCount,
    totalElements,
    hasLoaded,
    isLoading,
    isLoadingMore,
    isMarkingAllRead,
    loadError,
    loadMoreError,
    markError,
    hasMore: hasLoaded && loadedPage + 1 < totalPages,
    markRead: markNotificationRead,
    markAllRead: markAllNotificationsRead,
    loadMore,
    reload,
  };
}
