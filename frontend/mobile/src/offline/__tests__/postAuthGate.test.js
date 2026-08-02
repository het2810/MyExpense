import { ApiError, TRANSPORT_STATUS, NETWORK_UNAVAILABLE } from '../../api/apiError';

jest.mock('../../api/budgetApi', () => ({
  getActivePeriod: jest.fn(),
  upsertPeriod: jest.fn(),
}));
jest.mock('../connectivity', () => ({
  ...jest.requireActual('../connectivity'),
  getIsOnline: jest.fn(() => true),
}));

const budgetApi = require('../../api/budgetApi');
const { resolveGateActivePeriod } = require('../../store/postAuthGate');
const { useBudgetStore } = require('../../store/useBudgetStore');

beforeEach(() => {
  useBudgetStore.getState().resetBudget();
  budgetApi.getActivePeriod.mockReset();
});

test('backend down with no cache opens the Dashboard instead of blocking', async () => {
  budgetApi.getActivePeriod.mockRejectedValue(
    new ApiError({ status: TRANSPORT_STATUS, code: NETWORK_UNAVAILABLE, message: 'refused' }),
  );
  const result = await resolveGateActivePeriod('user-1');
  expect(result).toMatchObject({ resolved: true, periodUnknown: true, errorMessage: null });
});

test('a real server error still keeps the splash Retry', async () => {
  budgetApi.getActivePeriod.mockRejectedValue(
    new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'boom' }),
  );
  const result = await resolveGateActivePeriod('user-1');
  expect(result.resolved).toBe(false);
  expect(result.periodUnknown).toBe(false);
});

test('no saved period (404) still routes to Budget Settings', async () => {
  budgetApi.getActivePeriod.mockRejectedValue(
    new ApiError({ status: 404, code: 'NO_ACTIVE_PERIOD', message: 'none' }),
  );
  const result = await resolveGateActivePeriod('user-1');
  expect(result).toMatchObject({ resolved: true, activePeriod: null, periodUnknown: false });
});
