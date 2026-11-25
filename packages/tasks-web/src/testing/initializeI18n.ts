import { initializeI18n } from "~/i18n/initializeI18n";

// The app initializes GT at startup; components using its hooks need the same here.
initializeI18n(() => {});
