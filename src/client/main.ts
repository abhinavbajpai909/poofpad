import { parseRoute } from "./router";
import { showLanding } from "./ui/landing";
import { showMessage } from "./ui/message";
import { showPad } from "./ui/pad-view";

const app = document.getElementById("app");

if (app) {
  const route = parseRoute(location.pathname);
  switch (route.kind) {
    case "landing":
      showLanding(app);
      break;
    case "pad":
      showPad(app, route.padId);
      break;
    case "notFound":
      showMessage(app, "Page not found");
      break;
  }
}
