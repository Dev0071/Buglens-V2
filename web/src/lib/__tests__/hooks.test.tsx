/**
 * Tests for React Query hooks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import {
  useDashboardStats,
  useRecentEvents,
  useEventsList,
  useRCAResult,
  useIntegrations,
  useCostSummary,
} from '../hooks';

// Mock the mock-data module to ensure we're in mock mode
vi.mock('../mock-data', async () => {
  const actual = await vi.importActual('../mock-data');
  return {
    ...actual,
    isMockMode: () => true,
    mockDelay: () => Promise.resolve(), // No delay in tests
  };
});

// Create a wrapper with QueryClient
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
  
  return Wrapper;
}

describe('useDashboardStats', () => {
  it('returns dashboard stats data', async () => {
    const { result } = renderHook(() => useDashboardStats(), {
      wrapper: createWrapper(),
    });

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    // Wait for data
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Check data shape
    expect(result.current.data).toBeDefined();
    expect(result.current.data?.totalEvents).toBeTypeOf('number');
    expect(result.current.data?.resolvedRCAs).toBeTypeOf('number');
    expect(result.current.data?.avgResolutionTime).toBeTypeOf('number');
    expect(result.current.data?.pendingAnalysis).toBeTypeOf('number');
  });
});

describe('useRecentEvents', () => {
  it('returns recent events with default limit', async () => {
    const { result } = renderHook(() => useRecentEvents(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeDefined();
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.data!.length).toBeLessThanOrEqual(5);
  });

  it('respects custom limit', async () => {
    const { result } = renderHook(() => useRecentEvents(3), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.length).toBeLessThanOrEqual(3);
  });

  it('events have required properties', async () => {
    const { result } = renderHook(() => useRecentEvents(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const event = result.current.data![0];
    expect(event).toHaveProperty('id');
    expect(event).toHaveProperty('message');
    expect(event).toHaveProperty('severity');
    expect(event).toHaveProperty('status');
    expect(event).toHaveProperty('createdAt');
  });
});

describe('useEventsList', () => {
  it('returns paginated events', async () => {
    const { result } = renderHook(() => useEventsList({ page: 1, pageSize: 5 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeDefined();
    expect(result.current.data?.events).toBeDefined();
    expect(Array.isArray(result.current.data?.events)).toBe(true);
    expect(result.current.data?.total).toBeTypeOf('number');
    expect(result.current.data?.page).toBe(1);
    expect(result.current.data?.pageSize).toBe(5);
    expect(result.current.data?.totalPages).toBeTypeOf('number');
  });

  it('filters by severity', async () => {
    const { result } = renderHook(() => useEventsList({ severity: 'high' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // All events should be high severity
    result.current.data?.events.forEach(event => {
      expect(event.severity).toBe('high');
    });
  });

  it('filters by status', async () => {
    const { result } = renderHook(() => useEventsList({ status: 'completed' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // All events should have completed status
    result.current.data?.events.forEach(event => {
      expect(event.status).toBe('completed');
    });
  });

  it('filters by search query', async () => {
    const { result } = renderHook(() => useEventsList({ search: 'TypeError' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // All events should contain TypeError
    result.current.data?.events.forEach(event => {
      expect(event.message.toLowerCase()).toContain('typeerror');
    });
  });
});

describe('useRCAResult', () => {
  it('returns null when rcaId is undefined', async () => {
    const { result } = renderHook(() => useRCAResult(undefined), {
      wrapper: createWrapper(),
    });

    // Should not fetch when disabled
    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('returns RCA result for valid ID', async () => {
    const { result } = renderHook(() => useRCAResult('rca-001'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const rca = result.current.data;
    expect(rca).toBeDefined();
    expect(rca?.id).toBe('rca-001');
    expect(rca?.title).toBeDefined();
    expect(rca?.summary).toBeDefined();
    expect(rca?.root_cause).toBeDefined();
    expect(rca?.fix_suggestion).toBeDefined();
    expect(rca?.confidence).toBeTypeOf('number');
    expect(rca?.evidence).toBeDefined();
  });

  it('returns null for non-existent ID', async () => {
    const { result } = renderHook(() => useRCAResult('non-existent'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });
});

describe('useIntegrations', () => {
  it('returns list of integrations', async () => {
    const { result } = renderHook(() => useIntegrations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeDefined();
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.data!.length).toBeGreaterThan(0);

    // Check integration shape
    const integration = result.current.data![0];
    expect(integration).toHaveProperty('id');
    expect(integration).toHaveProperty('type');
    expect(integration).toHaveProperty('name');
    expect(integration).toHaveProperty('status');
  });

  it('integrations have valid status', async () => {
    const { result } = renderHook(() => useIntegrations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const validStatuses = ['connected', 'disconnected', 'error'];
    result.current.data!.forEach(integration => {
      expect(validStatuses).toContain(integration.status);
    });
  });
});

describe('useCostSummary', () => {
  it('returns cost summary data', async () => {
    const { result } = renderHook(() => useCostSummary(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data;
    expect(data).toBeDefined();
    expect(data?.currentMonth).toBeDefined();
    expect(data?.currentMonth.totalCost).toBeTypeOf('number');
    expect(data?.currentMonth.llmCost).toBeTypeOf('number');
    expect(data?.currentMonth.tokenCount).toBeTypeOf('number');
    expect(data?.currentMonth.eventsProcessed).toBeTypeOf('number');
    expect(data?.previousMonth).toBeDefined();
    expect(data?.dailyMetrics).toBeDefined();
    expect(Array.isArray(data?.dailyMetrics)).toBe(true);
    expect(data?.projectedMonthlyCost).toBeTypeOf('number');
  });
});
