import { parseRoute } from "./router";
import { showLanding } from "./ui/landing";
import { showMessage } from "./ui/message";
import { showPad } from "./ui/pad-view";
import { showPrivacy } from "./ui/privacy";

const app = document.getElementById("app");

if (app) {
  const route = parseRoute(location.pathname);
  switch (route.kind) {
    case "landing":
      showLanding(app);
      break;
    case "privacy":
      showPrivacy(app);
      break;
    case "pad":
      window.addEventListener("hashchange", () => location.reload());
      void showPad(app, route.padId);
      break;
    case "notFound":
      showMessage(app, "Page not found");
      break;
  }
}
