export type MerchantStatus = 'active' | 'suspended';

export interface Merchant {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  webhookUrl: string | null;
  status: MerchantStatus;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  label: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export type OrderStatus = 'pending' | 'confirmed' | 'failed';

export interface Order {
  id: string;
  merchantAddress: string;
  amount: string;
  status: OrderStatus;
  onChainId: string;
  metadata: any;
  createdAt: string;
}

export interface WebhookConfig {
  webhookUrl: string | null;
  webhookSecret?: string; // Only returned on creation
}

export interface Session {
  merchant: Merchant;
}

export interface ApiKeyCreationResponse {
  fullKey: string;
  prefix: string;
  label: string;
  createdAt: string;
  warning: string;
}