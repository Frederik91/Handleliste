const HOME_ASSISTANT_THEME_VARIABLES = [
  "--card-background-color",
  "--divider-color",
  "--error-color",
  "--primary-background-color",
  "--primary-color",
  "--primary-text-color",
  "--secondary-text-color",
  "--text-primary-color",
] as const;

export function followHomeAssistantTheme(): () => void {
  if (window.parent === window) {
    return () => undefined;
  }

  try {
    const parentRoot = window.parent.document.documentElement;
    const applyTheme = () => {
      const parentStyles = window.parent.getComputedStyle(parentRoot);
      for (const variable of HOME_ASSISTANT_THEME_VARIABLES) {
        const value = parentStyles.getPropertyValue(variable).trim();
        if (value) {
          document.documentElement.style.setProperty(variable, value);
        }
      }
    };
    applyTheme();

    const observer = new MutationObserver(applyTheme);
    observer.observe(parentRoot, {
      attributeFilter: ["class", "style"],
      attributes: true,
    });
    return () => observer.disconnect();
  } catch {
    // A separately hosted development page may be cross-origin. CSS fallbacks remain usable.
    return () => undefined;
  }
}
