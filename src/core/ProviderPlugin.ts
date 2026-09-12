import type { Plugin, PluginContext, PluginManifest } from '../contract.js';
import type { AgentProvider } from './ChatEngine.js';

export class ProviderPlugin implements Plugin {
  readonly manifest: PluginManifest;

  constructor(
    public readonly provider: AgentProvider,
    category = 'provider'
  ) {
    this.manifest = {
      id: provider.id,
      name: provider.name,
      version: '0.1.0',
      description: `Agent provider "${provider.name}" (${provider.id}) exposed as a chat plugin.`,
      enabled: true,
      category,
    };
  }

  async initialize(_ctx: PluginContext): Promise<void> {
    // No-op: providers are driven directly by ChatEngine.
  }

  async shutdown(): Promise<void> {
    // No-op: providers hold no disposable resources.
  }
}