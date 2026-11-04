import { WebviewActionDispatcher } from "@frostime/pi-client/host";
import type { DispatchConnection, WebviewActionDispatcherDependencies } from "@frostime/pi-client/host";
import type { WebviewToHostMessage } from "@frostime/pi-client/shared/bridge/webviewToHost";
import type { DesktopProjectNavigation } from "./DesktopProjectNavigation.js";
import type { DesktopResume } from "./DesktopResume.js";

/** Desktop's update preparation closes this gate; the opening counter lives in createDesktopBackend. */
export interface DesktopSessionAdmission {
  runSessionOpening<T>(work: () => Promise<T>): Promise<T>;
}

/** Desktop navigation policy around the same schema-validated shared actions. */
export class DesktopActionDispatcher extends WebviewActionDispatcher {
  readonly #registry: WebviewActionDispatcherDependencies["registry"];
  readonly #resume: DesktopResume;
  readonly #navigation: DesktopProjectNavigation;
  readonly #admission: DesktopSessionAdmission;

  constructor(inputs: WebviewActionDispatcherDependencies, resume: DesktopResume, navigation: DesktopProjectNavigation, admission: DesktopSessionAdmission) {
    super(inputs);
    this.#registry = inputs.registry;
    this.#resume = resume;
    this.#navigation = navigation;
    this.#admission = admission;
  }

  override async dispatch(message: WebviewToHostMessage, connection: DispatchConnection): Promise<void> {
    if (connection.surface.kind === "sidebar") {
      switch (message.type) {
        case "resumeSession":
          // The gate wraps discovery, picker and opening, including the no-Project
          // branch of navigation.run where the Session set is still empty.
          await this.#admission.runSessionOpening(() =>
            this.#resume.run(() => this.#navigation.run(() => this.#registry.resumeSession())).catch(() => undefined));
          return;
        case "createSession":
          await this.#admission.runSessionOpening(() => this.#navigation.run(() => this.#registry.createSession(message.ephemeral ?? false)));
          this.#resume.hide();
          return;
        case "createSessionWithArguments":
          await this.#admission.runSessionOpening(() => this.#navigation.run(() => this.#registry.createSessionWithCustomArguments()));
          this.#resume.hide();
          return;
        case "activateSession":
          await this.#navigation.activateSession(message.sessionId);
          this.#resume.hide();
          return;
      }
    }
    // Panel rejection, conversation authorization and ordinary operations stay shared.
    await super.dispatch(message, connection);
  }
}
