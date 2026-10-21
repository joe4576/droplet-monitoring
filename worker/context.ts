import type { Session } from "./repositories/session-repository";
import type { AuthService } from "./services/auth-service";
import type { DashboardService } from "./services/dashboard-service";

export interface AppEnv {
  Bindings: Env;
  Variables: {
    authService: AuthService;
    dashboardService: DashboardService;
    session: Session;
  };
}
