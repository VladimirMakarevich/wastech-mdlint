// Config error type. Relocated out of the (removed) legacy loader at the P3.09 cutover so the v2
// config path owns it. Thrown by loadConfiguration; the CLI maps it to exit code 2.
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
