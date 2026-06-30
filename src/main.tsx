import React from "react";
import ReactDOM from "react-dom/client";
import { patchConsole } from "./lib/webview-log";
import App from "./App";
import "./styles/global.css";

patchConsole();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
