declare module "web-push" {
  export function sendNotification(
    subscription: PushSubscription,
    payload?: string | Buffer | null,
    options?: RequestOptions,
  ): Promise<SendResult>;

  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;

  export function generateVAPIDKeys(): VapidKeys;

  export function setGCMAPIKey(apiKey: string | null): void;

  export type ContentEncoding = "aesgcm" | "aes128gcm";

  export type Urgency = "very-low" | "low" | "normal" | "high";

  export interface VapidKeys {
    publicKey: string;
    privateKey: string;
  }

  export interface PushSubscription {
    endpoint: string;
    expirationTime?: null | number;
    keys: {
      p256dh: string;
      auth: string;
    };
  }

  export interface Headers {
    [header: string]: string;
  }

  export interface RequestOptions {
    gcmAPIKey?: string | undefined;
    vapidDetails?: { subject: string; publicKey: string; privateKey: string } | undefined;
    timeout?: number | undefined;
    TTL?: number | undefined;
    headers?: Headers | undefined;
    contentEncoding?: ContentEncoding | undefined;
    urgency?: Urgency | undefined;
    topic?: string | undefined;
    proxy?: string | undefined;
    agent?: unknown;
  }

  export interface SendResult {
    statusCode: number;
    body: string;
    headers: Headers;
  }

  export class WebPushError extends Error {
    readonly statusCode: number;
    readonly headers: Headers;
    readonly body: string;
    readonly endpoint: string;
    constructor(message: string, statusCode: number, headers: Headers, body: string, endpoint: string);
  }
}
