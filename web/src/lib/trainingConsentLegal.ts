/** Shown in the training opt-in dialog. Bump with consent flow if text changes materially. */
export const TRAINING_LEGAL_VERSION = "2026-10-21";

export const TRAINING_PRIVACY_POLICY = {
  title: "Privacy policy (training data)",
  sections: [
    {
      heading: "What we collect",
      body:
        "If you turn on sharing, you choose which saved expenses to send. Each share includes a scrubbed transcript, the model’s original field prediction, your corrected fields (amount, currency, item, category, merchant, date), and model version labels. We do not collect audio, account names, or passwords.",
    },
    {
      heading: "How we use it",
      body:
        "Data is used to improve Pasak’s on-device speech and extraction models. It is stored on Pasak’s server tied to a random per-device identifier, not your name or email.",
    },
    {
      heading: "Scrubbing and rejection",
      body:
        "Before storage, text is checked for patterns we reject (for example email addresses and phone numbers). Some long digit sequences may be replaced with a redaction marker.",
    },
    {
      heading: "Retention and deletion",
      body:
        "Examples stay until you turn sharing off. Turning sharing off deletes your examples from the server. Expenses on your device are not deleted.",
    },
    {
      heading: "Your choices",
      body:
        "Sharing is optional and off by default. You can turn it off at any time. You decide which rows to share or update.",
    },
  ],
};

export const TRAINING_TERMS = {
  title: "Terms (training data)",
  sections: [
    {
      heading: "Agreement",
      body:
        "By turning on sharing, you confirm you have read this privacy policy and these terms and you agree to send training data as described.",
    },
    {
      heading: "Your responsibility",
      body:
        "Do not share content you are not allowed to share. You are responsible for what you submit. Do not include payment card numbers, government IDs, or other sensitive secrets in transcripts or fields.",
    },
    {
      heading: "No warranty",
      body:
        "Model improvements are provided as-is. We may change how data is processed or stored as the product evolves, while keeping the same principles: text only, opt-in, revocable.",
    },
    {
      heading: "Changes",
      body:
        "We may update this text. Continued use after an update may require you to accept again when you next enable sharing.",
    },
  ],
};
