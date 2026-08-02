import { useEffect } from 'react';
import { useNotificationsStore } from '../store/useNotificationsStore';

/**
 * The header bell's unread count — and nothing else.
 *
 * Kept apart from `useNotifications()` deliberately: the bell renders on four
 * screens (Dashboard, Split, Statistics, Profile) and needs **one number**, not
 * a page of rows. Subscribing those screens to the whole notifications store
 * would re-render four headers every time a row was marked read, and would make
 * the bell a reason to fetch a list nobody is looking at.
 *
 * ---
 * **THE NUMBER IS `PageResponse.totalElements` FROM
 * `GET /notifications?read=false&size=1`.**
 *
 * It is never `content.length`, which is capped by the page size and would
 * make the badge report a page parameter instead of the user's inbox
 * (`backend/README.md` §17.5 / §17.10). There is **no**
 * `GET /notifications/unread-count` to call: it is recommended and not built,
 * and it needs a System Architect ruling because it is an addition to §12
 * (§17.5, §17.8 flag 1). The store owns the probe; this hook only triggers it.
 *
 * ---
 * **IT IS CACHE-FIRST, AND THAT HAS A KNOWN LIMIT.**
 *
 * The probe runs once per session and is then refreshed on every mark-read and
 * on every visit to the Notifications screen (`useNotifications`). So a
 * notification that arrives *while the app is open* does not bump the badge
 * until the user opens the screen. §12 is poll-based with no push or websocket
 * mechanism this phase (api-overview.md §12, ADR 0014's "Out of scope"), so the
 * only alternative is a timer or a refresh on every screen focus — four screens
 * × every tab switch — which is a meaningful request volume to spend on a badge
 * before the cheap count endpoint §17.5 recommends exists. Flagged in this
 * round's report rather than decided here.
 *
 * @returns {number} The account's unread notification count. `0` both when
 *   nothing is unread and when the probe has not succeeded yet — the bell
 *   renders no badge for either, which is the honest default for an unknown
 *   count.
 */
export function useUnreadNotificationCount() {
  const unreadCount = useNotificationsStore((state) => state.unreadCount);
  const loadUnreadCount = useNotificationsStore((state) => state.loadUnreadCount);

  useEffect(() => {
    // A no-op once the probe has succeeded, so four bells share one request.
    loadUnreadCount();
  }, [loadUnreadCount]);

  return unreadCount;
}
