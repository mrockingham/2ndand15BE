import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runCycle: vi.fn(),
  buildCurrentGamePoller: vi.fn(),
  loadCurrentGameSyncConfig: vi.fn(),
  disconnect: vi.fn(),
  createPrismaClient: vi.fn(),
}));

vi.mock('../modules/sports/build-current-game-poller.js', () => ({
  buildCurrentGamePoller: mocks.buildCurrentGamePoller,
}));

vi.mock('../config/env.js', () => ({
  loadCurrentGameSyncConfig: mocks.loadCurrentGameSyncConfig,
}));

vi.mock('../common/database/prisma.js', () => ({
  createPrismaClient: mocks.createPrismaClient,
}));

const { main } = await import('./current-game-worker.js');

interface PollerConfigOverrides {
  readonly enabled?: boolean;
  readonly heartbeatSeconds?: number;
}

function buildConfig(overrides: PollerConfigOverrides = {}) {
  return {
    nodeEnv: 'test' as const,
    databaseUrl: 'postgresql://test:test@localhost:5432/test?schema=public',
    logLevel: 'silent' as const,
    currentGame: {
      provider: 'highlightly' as const,
      evaluationMode: true,
      publicationApproved: false,
      highlightly: {
        apiKey: 'test-key',
        baseUrl: 'https://american-football.highlightly.net',
        requestTimeoutMs: 10_000,
        maxRetries: 1,
      },
      embedAllowedHosts: null,
      embedPlaybackEnabled: false,
      poller: {
        enabled: overrides.enabled ?? true,
        heartbeatSeconds: overrides.heartbeatSeconds ?? 20,
        batchSize: 10,
        lockLeaseSeconds: 120,
        pregamePollSeconds: 300,
        livePollSeconds: 120,
        featuredPollSeconds: 60,
        halftimePollSeconds: 180,
        finalReconcile10Minutes: 10,
        finalReconcile60Minutes: 60,
        rateLimitDegradeThreshold: 500,
      },
    },
  };
}

function fakeReport(): unknown {
  return {
    startedAt: new Date().toISOString(),
    durationMs: 10,
    candidatesDiscovered: 0,
    claimed: 0,
    ticks: [],
    rateLimitObservation: { limit: null, remaining: null },
    degraded: false,
    dryRunPreview: null,
  };
}

beforeEach(() => {
  mocks.runCycle.mockClear();
  mocks.buildCurrentGamePoller.mockClear();
  mocks.loadCurrentGameSyncConfig.mockClear();
  mocks.disconnect.mockClear();
  mocks.createPrismaClient.mockClear();
  mocks.buildCurrentGamePoller.mockReturnValue({
    poller: { runCycle: mocks.runCycle },
    client: {},
    workerId: 'test-worker',
  });
  mocks.createPrismaClient.mockReturnValue({ $disconnect: mocks.disconnect });
  mocks.disconnect.mockResolvedValue(undefined);
  process.exitCode = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
  process.exitCode = undefined;
});

describe('current-game-worker main()', () => {
  it('refuses to start and sets exitCode=1 when the poller is disabled', async () => {
    mocks.loadCurrentGameSyncConfig.mockReturnValue(buildConfig({ enabled: false }));

    await main();

    expect(mocks.runCycle).not.toHaveBeenCalled();
    expect(mocks.createPrismaClient).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('cycles repeatedly, sleeping the configured heartbeat between cycles', async () => {
    vi.useFakeTimers();
    mocks.loadCurrentGameSyncConfig.mockReturnValue(
      buildConfig({ enabled: true, heartbeatSeconds: 5 }),
    );
    mocks.runCycle.mockResolvedValue(fakeReport());

    const mainPromise = main();

    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runCycle).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.runCycle).toHaveBeenCalledTimes(2);

    process.emit('SIGTERM');
    await mainPromise;

    expect(mocks.disconnect).toHaveBeenCalled();
  });

  it('resolves gracefully on SIGTERM mid-loop without waiting for a full heartbeat', async () => {
    vi.useFakeTimers();
    mocks.loadCurrentGameSyncConfig.mockReturnValue(
      buildConfig({ enabled: true, heartbeatSeconds: 30 }),
    );
    mocks.runCycle.mockResolvedValue(fakeReport());

    const mainPromise = main();

    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runCycle).toHaveBeenCalledTimes(1);

    process.emit('SIGTERM');
    await mainPromise;

    expect(mocks.disconnect).toHaveBeenCalled();
    expect(mocks.runCycle).toHaveBeenCalledTimes(1);
  });

  it('recovers from a failed cycle, retrying only after the normal heartbeat delay', async () => {
    vi.useFakeTimers();
    mocks.loadCurrentGameSyncConfig.mockReturnValue(
      buildConfig({ enabled: true, heartbeatSeconds: 10 }),
    );
    mocks.runCycle.mockRejectedValueOnce(new Error('cycle boom')).mockResolvedValue(fakeReport());

    const mainPromise = main();

    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runCycle).toHaveBeenCalledTimes(1);

    // Not yet the full heartbeat -- no immediate/tight retry.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.runCycle).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.runCycle).toHaveBeenCalledTimes(2);

    process.emit('SIGTERM');
    await mainPromise;

    expect(mocks.disconnect).toHaveBeenCalled();
  });
});
