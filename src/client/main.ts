const app = document.getElementById("app");

if (app) {
  const heading = document.createElement("h1");
  heading.textContent = "PoofPad";
  app.replaceChildren(heading);
}
