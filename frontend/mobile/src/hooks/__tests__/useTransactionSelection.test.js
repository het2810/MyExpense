import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockDeleteTransaction = jest.fn();
jest.mock('../../store/useTransactionsStore', () => ({
  useTransactionsStore: selector => selector({ deleteTransaction: mockDeleteTransaction }),
}));

const { useTransactionSelection } = require('../useTransactionSelection');

function renderSelection() {
  const ref = { current: null };
  function Probe() {
    ref.current = useTransactionSelection();
    return null;
  }
  let renderer;
  act(() => {
    renderer = TestRenderer.create(<Probe />);
  });
  return { ref, renderer };
}

beforeEach(() => mockDeleteTransaction.mockReset());

test('long press starts selection, taps toggle, last deselect exits', () => {
  const { ref, renderer } = renderSelection();
  act(() => ref.current.startSelection('a'));
  act(() => ref.current.toggle('b'));
  expect([...ref.current.selectedIds]).toEqual(['a', 'b']);
  act(() => ref.current.toggle('a'));
  act(() => ref.current.toggle('b'));
  expect(ref.current.isSelecting).toBe(false);
  act(() => renderer.unmount());
});

test('bulk delete deletes each id; failures stay selected with an error', async () => {
  mockDeleteTransaction.mockImplementation(async id =>
    id === 'b'
      ? { success: false, error: 'Nope' }
      : { success: true, error: null },
  );
  const { ref, renderer } = renderSelection();
  act(() => ref.current.startSelection('a'));
  act(() => ref.current.toggle('b'));
  act(() => ref.current.toggle('c'));
  await act(async () => {
    await ref.current.deleteSelected();
  });
  expect(mockDeleteTransaction).toHaveBeenCalledTimes(3);
  expect([...ref.current.selectedIds]).toEqual(['b']);
  expect(ref.current.deleteError).toBe('Nope');
  act(() => renderer.unmount());
});
