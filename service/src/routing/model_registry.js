import { MODEL_ROUTING_CONFIG } from "../config/model_config.js";

export function getOrderedModels() {
  return [...MODEL_ROUTING_CONFIG.models].sort((a, b) => a.priority - b.priority);
}

export function getModelById(id) {
  return MODEL_ROUTING_CONFIG.models.find((m) => m.id === id) || null;
}
