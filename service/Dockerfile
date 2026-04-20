FROM node:22-bookworm-slim

WORKDIR /app

COPY service/package.json ./
RUN npm install --omit=dev

COPY service/src ./src
COPY service/prompts_sets ./prompts_sets

ENV NODE_ENV=production
ENV LLM_SERVICE_PORT=8012
ENV GCP_SA_KEY_PATH=/run/secrets/gcp-sa-key.json

EXPOSE 8012

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "start"]
