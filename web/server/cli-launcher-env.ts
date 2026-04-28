export function stripInheritedTelemetryEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const stripped: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("OTEL_")) continue;
    stripped[key] = value;
  }
  return stripped;
}
