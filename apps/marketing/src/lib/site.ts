import { RELEASE_VERSION } from "./releases";

export const GITHUB_REPOSITORY_URL = "https://github.com/krl-gr/upcomputer";
export const LICENSE_URL = `${GITHUB_REPOSITORY_URL}/blob/main/LICENSE`;

export const SOFTWARE_APPLICATION_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Up.computer",
  description:
    "A free, open-source, self-orchestrating control plane for the coding-agent CLIs you already use.",
  applicationCategory: "DeveloperApplication",
  operatingSystem: ["macOS", "Windows 10", "Windows 11", "Linux"],
  softwareVersion: RELEASE_VERSION,
  url: "https://up.computer/",
  downloadUrl: "https://up.computer/download/",
  image: "https://up.computer/icon.png",
  license: LICENSE_URL,
  // SoftwareApplication has no codeRepository; its source code is the repository.
  isBasedOn: {
    "@type": "SoftwareSourceCode",
    codeRepository: GITHUB_REPOSITORY_URL,
    license: LICENSE_URL,
  },
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
    url: "https://up.computer/download/",
  },
  publisher: {
    "@type": "Organization",
    name: "Up.computer",
    url: "https://up.computer/",
  },
} as const;
