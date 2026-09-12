export interface CommandParseResult {
  readonly isCommand: boolean;
  readonly command?: string;
  readonly args?: string;
  readonly raw: string;
}

export interface CommandParserOptions {
  readonly aliases?: Record<string, string>;
}

export class CommandParser {
  private readonly aliases: Record<string, string>;

  constructor(opts: CommandParserOptions = {}) {
    const aliases: Record<string, string> = {};
    for (const [alias, canonical] of Object.entries(opts.aliases ?? {})) {
      aliases[alias.replace(/^\/+/, '').toLowerCase()] = canonical.replace(/^\/+/, '').toLowerCase();
    }
    this.aliases = aliases;
  }

  parse(line: string): CommandParseResult {
    const raw = line;
    const trimmed = line.trim();
    if (!trimmed.startsWith('/')) {
      return { isCommand: false, raw };
    }
    const firstSpace = trimmed.indexOf(' ');
    const token = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
    const args = firstSpace === -1 ? undefined : trimmed.slice(firstSpace + 1).trim();
    const bare = token.slice(1).toLowerCase();
    if (!token || !bare) {
      return { isCommand: false, raw };
    }
    const command = this.aliases[bare] ?? bare;
    return { isCommand: true, command, args: args || undefined, raw };
  }
}