import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DaemonAuthManager, type AuthCredentialSource } from './manager.js';

interface DeviceCoordinatorOptions {
  authManager: DaemonAuthManager;
  verificationUrl?: string | null;
  autoLaunch?: boolean;
  challengeTtlMs?: number;
  logger?: (message: string) => void;
}

interface ChallengeRecord {
  id: string;
  createdAt: number;
  expiresAt: number;
  endpointHint?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface BeginDeviceFlowOptions {
  endpoint?: string | null;
  metadata?: Record<string, unknown> | null;
  mode?: string | null;
}

export interface CompleteDeviceFlowOptions {
  challengeId: string;
  token: string;
  endpoint?: string | null;
  expiresAt?: string | null;
  obtainedAt?: string | null;
  metadata?: Record<string, unknown> | null;
  source?: AuthCredentialSource;
}

export class DeviceAuthCoordinator {
  private readonly authManager: DaemonAuthManager;
  private readonly verificationUrl?: string | null;
  private readonly autoLaunch: boolean;
  private readonly challengeTtlMs: number;
  private readonly logger: (message: string) => void;
  private readonly challenges = new Map<string, ChallengeRecord>();

  constructor(options: DeviceCoordinatorOptions) {
    this.authManager = options.authManager;
    this.verificationUrl = options.verificationUrl ?? null;
    this.autoLaunch = options.autoLaunch ?? false;
    this.challengeTtlMs = options.challengeTtlMs ?? 5 * 60_000;
    this.logger = options.logger ?? ((message) => console.info('[powersync-daemon][auth] %s', message));
  }

  async begin(options: BeginDeviceFlowOptions = {}): Promise<void> {
    this.cleanupExpiredChallenges();

    const challengeId = this.generateChallengeId();
    const createdAt = Date.now();
    const expiresAt = createdAt + this.challengeTtlMs;

    this.challenges.set(challengeId, {
      id: challengeId,
      createdAt,
      expiresAt,
      endpointHint: options.endpoint ?? null,
      metadata: options.metadata ?? null,
    });

    const verificationUrl = this.verificationUrl ? this.buildVerificationUrl(challengeId) : null;
    const reason = verificationUrl
      ? `Complete daemon login in your browser: ${verificationUrl}`
      : `Complete daemon login via explorer using code ${challengeId}`;
    const context: Record<string, unknown> = {
      type: 'device',
      challengeId,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      verificationUrl,
      mode: options.mode ?? 'device-code',
    };

    await this.authManager.setPending(reason, context);
    this.logger(`device login pending (${challengeId})`);

    if (verificationUrl && this.autoLaunch) {
      this.launchBrowser(verificationUrl);
    }
  }

  async complete(options: CompleteDeviceFlowOptions): Promise<boolean> {
    const challenge = this.challenges.get(options.challengeId);
    if (!challenge) {
      await this.authManager.setError('Invalid or expired device challenge.', {
        type: 'device',
        challengeId: options.challengeId,
        reason: 'unknown_challenge',
      });
      return false;
    }

    if (Date.now() > challenge.expiresAt) {
      this.challenges.delete(options.challengeId);
      await this.authManager.setError('Device login expired. Restart the sign-in flow.', {
        type: 'device',
        challengeId: options.challengeId,
        reason: 'expired',
      });
      return false;
    }

    const endpoint = options.endpoint ?? challenge.endpointHint ?? this.authManager.getDefaultEndpoint();
    if (!endpoint) {
      await this.authManager.setError('Device login missing PowerSync endpoint configuration.', {
        type: 'device',
        challengeId: options.challengeId,
        reason: 'missing_endpoint',
      });
      return false;
    }

    this.challenges.delete(options.challengeId);

    await this.authManager.setReadyCredentials(
      {
        endpoint,
        token: options.token,
        expiresAt: options.expiresAt ?? undefined,
        obtainedAt: options.obtainedAt ?? undefined,
        metadata: options.metadata ?? undefined,
      },
      { source: options.source ?? 'device' },
    );
    this.logger(`device login completed (${options.challengeId})`);
    return true;
  }

  private generateChallengeId(): string {
    return randomBytes(6).toString('hex');
  }

  private cleanupExpiredChallenges(): void {
    const now = Date.now();
    for (const [id, record] of this.challenges.entries()) {
      if (now > record.expiresAt) {
        this.challenges.delete(id);
      }
    }
  }

  private buildVerificationUrl(challengeId: string): string {
    if (!this.verificationUrl) return '';
    const separator = this.verificationUrl.includes('?') ? '&' : '?';
    return `${this.verificationUrl}${separator}device_code=${encodeURIComponent(challengeId)}`;
  }

  private launchBrowser(url: string): void {
    const platform = process.platform;
    let command: string | null = null;
    let args: string[] = [];

    if (platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (platform === 'win32') {
      command = 'cmd';
      args = ['/c', 'start', '""', url.replace(/&/g, '^&')];
    } else {
      command = 'xdg-open';
      args = [url];
    }

    if (!command) return;

    try {
      const child = spawn(command, args, {
        stdio: 'ignore',
        detached: true,
      });
      child.unref();
    } catch (error) {
      this.logger(`failed to launch browser for device login (${(error as Error)?.message ?? error})`);
    }
  }
}
