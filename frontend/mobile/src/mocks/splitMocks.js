/**
 * MOCK DATA — locally defined placeholder data, not sourced from any API.
 * There is no backend groups/split endpoint yet; this feeds the Split
 * Groups List screen only. Replace with React Query-backed data once the
 * Backend Engineer publishes the relevant endpoints.
 */

export const splitSummary = {
  totalYouOwe: 1400,
  totalYouAreOwed: 1600,
  currencySymbol: '₹',
};

export const activeGroups = [
  {
    id: 'group-1',
    name: 'Flatmates',
    memberCount: 4,
    lastActivity: 'Electricity bill • 2 days ago',
    yourBalance: 1600,
  },
  {
    id: 'group-2',
    name: 'Goa Trip',
    memberCount: 6,
    lastActivity: 'Hotel booking • 5 days ago',
    yourBalance: -1400,
  },
  {
    id: 'group-3',
    name: 'Office Lunch Club',
    memberCount: 8,
    lastActivity: 'Friday lunch • 1 week ago',
    yourBalance: 0,
  },
];
