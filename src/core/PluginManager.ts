import { PluginError } from '../contract.js';
import type { Plugin, PluginManifest, PluginHealthResult, PluginContext } from '../contract.js';

export interface PluginHealth {
  readonly pluginId: string;
  readonly manifest: PluginManifest;
  readonly health: PluginHealthResult | 'not_initialized';
}

export class PluginManager {
  private readonly registry = new Map<string, Plugin>();
  private readonly manifests = new Map<string, PluginManifest>();
  private readonly initialized = new Set<string>();

  async register(plugin: Plugin): Promise<void> {
    const { id } = plugin.manifest;
    if (this.registry.has(id)) {
      throw new PluginError(`Duplicate plugin id: "${id}"`, 'DUPLICATE');
    }
    this.registry.set(id, plugin);
    this.manifests.set(id, plugin.manifest);
  }

  async unregister(id: string): Promise<void> {
    const plugin = this.registry.get(id);
    if (!plugin) return;
    await plugin.shutdown();
    this.registry.delete(id);
    this.manifests.delete(id);
    this.initialized.delete(id);
  }

  list(): PluginManifest[] {
    return [...this.manifests.values()];
  }

  get(id: string): Plugin | undefined {
    return this.registry.get(id);
  }

  async initializeAll(ctx: PluginContext): Promise<void> {
    for (const [id, plugin] of this.registry) {
      if (!this.initialized.has(id)) {
        await plugin.initialize(ctx);
        this.initialized.add(id);
      }
    }
  }

  async health(pluginId?: string): Promise<PluginHealth[]> {
    const results: PluginHealth[] = [];
    const entries = pluginId
      ? [[pluginId, this.registry.get(pluginId)] as const].filter(
          (e): e is [string, Plugin] => e[1] !== undefined
        )
      : [...this.registry.entries()];

    for (const [id, plugin] of entries) {
      const manifest = this.manifests.get(id)!;
      if (!this.initialized.has(id)) {
        results.push({ pluginId: id, manifest, health: 'not_initialized' });
        continue;
      }
      if (plugin.healthCheck) {
        const hc = await plugin.healthCheck();
        results.push({ pluginId: id, manifest, health: hc });
      } else {
        results.push({ pluginId: id, manifest, health: { status: 'ok' } });
      }
    }
    return results;
  }
}
