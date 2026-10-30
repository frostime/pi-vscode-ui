import { WebviewActionDispatcher } from "@frostime/pi-client/host";
import type { DispatchConnection, WebviewActionDispatcherDependencies } from "@frostime/pi-client/host";
import type { WebviewToHostMessage } from "@frostime/pi-client/shared/bridge/webviewToHost";
import type { DesktopProjectNavigation } from "./DesktopProjectNavigation.js";
import type { DesktopResume } from "./DesktopResume.js";

/** Desktop navigation policy around the same schema-validated shared actions. */
export class DesktopActionDispatcher extends WebviewActionDispatcher {
  readonly #registry: WebviewActionDispatcherDependencies["registry"];
  readonly #resume: DesktopResume;
  readonly #navigation: DesktopProjectNavigation;

  constructor(inputs: WebviewActionDispatcherDependencies, resume: DesktopResume, navigation: DesktopProjectNavigation) {
    super(inputs);
    this.#registry = inputs.registry;
    this.#resume = resume;
    this.#navigation = navigation;
  }

  override async dispatch(message: WebviewToHostMessage, connection: DispatchConnection): Promise<void> {
    if (connection.surface.kind === "sidebar") {
      switch (message.type) {
        case "resumeSession":
          await this.#resume.run(() => this.#navigation.run(() => this.#registry.resumeSession())).catch(() => undefined);
          return;
        case "createSession":
          await this.#navigation.run(() => this.#registry.createSession(message.ephemeral ?? false));
          this.#resume.hide();
          return;
        case "createSessionWithArguments":
          await this.#navigation.run(() => this.#registry.createSessionWithCustomArguments());
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
