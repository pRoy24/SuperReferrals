import {
  processorAuthTokenFromRequest,
  readProcessorAccountSessionCookie
} from "./account-session";
import {
  restoreProcessorAccountSession,
  restoreProcessorAuthTokenSession
} from "./orchestrator";

export async function restoreConsoleCustomer(request: Request) {
  const authToken = processorAuthTokenFromRequest(request);
  if (authToken) {
    const authCustomer = await restoreProcessorAuthTokenSession(authToken).catch(() => undefined);
    if (authCustomer) {
      return authCustomer;
    }
  }
  return restoreProcessorAccountSession(
    readProcessorAccountSessionCookie(request.headers.get("cookie"))
  );
}
