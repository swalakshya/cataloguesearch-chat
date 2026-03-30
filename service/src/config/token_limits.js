export const DEFAULT_TOKEN_LIMITS = {
  openai: {
    "gpt-4o": 128000,
    "*": 120000,
  },
  gemini: {
    "gemini-2.5-pro": 1048576,
    "gemini-2.5-flash": 1048576,
    "*": 1048576,
  },
  default: {
    "*": 120000,
  },
};
