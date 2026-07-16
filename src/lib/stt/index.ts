import type { STTProvider } from "@/types";

/**
 * STT adapter registry. Similar to TTS, manages multiple STT providers.
 */

const providers = new Map<string, STTProvider>();
let activeProviderId: string | null = null;

export function registerSTTProvider(provider: STTProvider): void {
  providers.set(provider.providerId, provider);
}

export function setActiveSTTProvider(id: string): void {
  const provider = providers.get(id);
  if (!provider) {
    throw new Error(`STT provider "${id}" not registered`);
  }
  if (!provider.isAvailable()) {
    throw new Error(`STT provider "${id}" is not available in this WebView`);
  }
  activeProviderId = id;
}

export function getActiveSTTProvider(): STTProvider | undefined {
  return activeProviderId ? providers.get(activeProviderId) : undefined;
}

export function getAvailableSTTProviders(): STTProvider[] {
  return Array.from(providers.values()).filter((provider) => provider.isAvailable());
}
