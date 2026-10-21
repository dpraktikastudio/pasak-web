/** Manifest / R2 model bundle cache (Cache API). */
export const PASAK_MODELS_CACHE = "pasak-models";

/** Same-origin /models/ and /ort/ (service worker + bundled probe). */
export const PASAK_MODELS_FILES_CACHE = "pasak-models-files";

/** Hugging Face Transformers.js default browser cache key. */
export const TRANSFORMERS_CACHE = "transformers-cache";

/** App shell + precache (not cleared by model cache remove scope B). */
export const PASAK_SHELL_CACHE = "pasak-shell-v3";
