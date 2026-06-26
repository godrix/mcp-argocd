import { z } from "zod";
import { ArgoCdAuthService } from "../../services/ArgoCdAuthService.js";

export function toolResponse(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function toolError(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
    isError: true,
  };
}

export function profileSchema(authService: ArgoCdAuthService) {
  const names = authService.profileNames();
  const hint =
    names.length > 0
      ? `Environment profile. Available: ${names.join(", ")}. Default: ${authService.defaultProfile}`
      : "Environment profile (qa, stg, prod).";

  return z.string().optional().describe(hint);
}
