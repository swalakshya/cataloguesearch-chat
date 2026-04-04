FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY prompts ./prompts
COPY prompts_v2 ./prompts_v2

ENV NODE_ENV=production
ENV LLM_SERVICE_PORT=8012
ENV GCP_SA_KEY_PATH=/run/secrets/gcp-sa-key.json

EXPOSE 8012

CMD ["npm", "start"]
