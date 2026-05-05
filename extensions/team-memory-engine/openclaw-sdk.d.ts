// Type shim for OpenClaw plugin SDK — types provided at runtime by host framework
declare module "openclaw/plugin-sdk/plugin-entry" {
  export interface OpenClawPluginApi {
    logger: { info(msg: string): void; warn(msg: string): void; error(msg: string): void; debug(msg: string): void };
    config: Record<string, unknown>;
    pluginConfig: unknown;
    runtime: Record<string, unknown>;
    resolveConfig(key: string): string | undefined;
    resolvePath(path: string): string;
    on(event: string, handler: (event: unknown, ctx: unknown) => Promise<void> | void): void;
    registerTool(tool: unknown, opts: unknown): void;
    registerCli(fn: (ctx: { program: unknown }) => void, opts: unknown): void;
    registerService(svc: { id: string; start(): Promise<void> | void; stop(): void }): void;
    registerInteractiveHandler(handler: unknown): void;
  }
  export function definePluginEntry(plugin: unknown): unknown;
}
