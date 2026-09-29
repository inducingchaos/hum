import { render } from "preact";
import { App, boot } from "./app.tsx";
import { log } from "./log.ts";
import "@fontsource-variable/geist-mono/wght.css";
import "./style.css";

render(<App />, document.getElementById("app")!);
void boot();

if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  navigator.serviceWorker.register("/sw.js").catch((e) => log(`service worker failed: ${e.message}`));
}
