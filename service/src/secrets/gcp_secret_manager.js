import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { log } from "../utils/log.js";

export function buildSecretAccessor({ projectId, secretName, secretVersion, keyFilename, client }) {
  const version = secretVersion || "latest";
  const secretPath = `projects/${projectId}/secrets/${secretName}/versions/${version}`;
  const smClient = client || new SecretManagerServiceClient({ keyFilename });

  return async function accessSecret() {
    const [response] = await smClient.accessSecretVersion({ name: secretPath });
    const payload = response?.payload?.data;
    if (!payload) {
      throw new Error("Secret Manager payload missing");
    }
    return Buffer.from(payload).toString("utf8").trim();
  };
}

export function logSecretManagerInit({ projectId, secretName, secretVersion }) {
  log.info("gcp_secret_manager_init", {
    projectId,
    secretName,
    secretVersion: secretVersion || "latest",
  });
}
