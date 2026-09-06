import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { followHomeAssistantTheme } from "./home-assistant-theme.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Handleliste root element is missing");

followHomeAssistantTheme();
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
