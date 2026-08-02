import { create } from 'zustand';

/**
 * Zustand store holding the Notifications feed — docs/decisions/
 * 0012-notifications-system.md §3. A genuinely separate, independently
 * hand-authored mock dataset — deliberately NOT wired into
 * useActivityLogStore's four existing trigger points (ADR 0012 §5's
 * reasoned "no": only 2 of the 4 notification types have any Activity Log
 * event source to hook into at all, and no store in this app has ever
 * reached into another store's write path — every multi-store write is
 * orchestrated by the screen that owns it). In-memory only, no `persist`
 * middleware — same pattern as every other store in this app at this phase.
 *
 * Item shape (ADR 0012 §3 — `date`/`time` as two fields, NOT the task's own
 * illustrative combined `timestamp` — the same deliberate deviation
 * useActivityLogStore already made for the identical reason: splitting the
 * fields lets dateDisplay.js's existing getDateDisplayLabel/getTimeLabel
 * render both with zero new parsing logic, and keeps this app's two
 * event-feed shapes internally consistent with each other):
 * {
 *   id: string,             // `notification-${n}`
 *   type: 'overspending' | 'group_expense' | 'settlement' | 'reminder',
 *   message: string,        // full sentence, plain string
 *   date: string,             // 'YYYY-MM-DD'
 *   time: string,             // 'HH:mm'
 *   read: boolean,
 * }
 *
 * Seed data spans roughly the last two weeks and mixes all four types.
 * Deliberately weighted toward unread (10 of 11 unread) rather than a
 * more "realistic" handful — this makes the header bell's unread badge
 * immediately demonstrate its "9+" cap (docs/ui/design-system.md §15.2) on
 * first load, without requiring a separate demo-only code path.
 */
const initialNotifications = [
  {
    id: 'notification-1',
    type: 'overspending',
    message: "You've exceeded your monthly budget by ₹1,200.",
    date: '2026-08-15',
    time: '08:30',
    read: false,
  },
  {
    id: 'notification-2',
    type: 'group_expense',
    message: 'Rohan Mehta added "Movie tickets" (₹840) to Flatmates.',
    date: '2026-08-14',
    time: '19:45',
    read: false,
  },
  {
    id: 'notification-3',
    type: 'settlement',
    message: 'Aditi Sharma settled up with you — ₹450.',
    date: '2026-08-14',
    time: '11:30',
    read: false,
  },
  {
    id: 'notification-4',
    type: 'reminder',
    message: "Don't forget to log today's expenses before the day closes out.",
    date: '2026-08-13',
    time: '20:00',
    read: false,
  },
  {
    id: 'notification-5',
    type: 'group_expense',
    message: 'You paid ₹2,400 in Goa Trip for "Hotel booking".',
    date: '2026-08-12',
    time: '14:05',
    read: false,
  },
  {
    id: 'notification-6',
    type: 'overspending',
    message: "You've used 85% of your monthly budget — pace yourself for the rest of the month.",
    date: '2026-08-11',
    time: '08:00',
    read: false,
  },
  {
    id: 'notification-7',
    type: 'settlement',
    message: 'You settled up with Karan Verma — ₹850.',
    date: '2026-08-10',
    time: '17:20',
    read: false,
  },
  {
    id: 'notification-8',
    type: 'reminder',
    message: 'Your current budget period ends soon — review your category caps before it resets.',
    date: '2026-08-09',
    time: '09:00',
    read: false,
  },
  {
    id: 'notification-9',
    type: 'group_expense',
    message: 'Priya Nair added "Cab fare" (₹300) with you.',
    date: '2026-08-07',
    time: '21:15',
    read: false,
  },
  {
    id: 'notification-10',
    type: 'settlement',
    message: 'You settled up in Office Lunch Club — ₹600.',
    date: '2026-08-05',
    time: '13:40',
    read: false,
  },
  {
    id: 'notification-11',
    type: 'overspending',
    message: "You've used 82% of your monthly budget — pace yourself for the rest of the month.",
    date: '2026-08-02',
    time: '08:00',
    read: true,
  },
];

export const useNotificationsStore = create((set) => ({
  notifications: initialNotifications,

  /**
   * Marks a single notification read — tapping a row on NotificationsScreen
   * (docs/decisions/0012-notifications-system.md §7).
   * @param {string} id
   */
  markAsRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification,
      ),
    })),

  /**
   * Marks every notification read — NotificationsScreen's "Mark all read"
   * header action (omitted entirely when there is nothing unread).
   */
  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((notification) => ({ ...notification, read: true })),
    })),
}));
